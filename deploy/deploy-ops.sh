#!/usr/bin/env bash
set -Eeuo pipefail

sha="${1:?missing git sha}"
base="/opt/saydian"
compose="$base/config/docker-compose.prod.yml"
images="$base/env/images.env"
production_env="$base/env/production.env"
registry="${GHCR_REGISTRY:-ghcr.io}"
repository="${GHCR_REPOSITORY:-saydian88-cmyk/saydianaios}"
api_image="$registry/$repository/ops-api:$sha"
admin_image="$registry/$repository/ops-admin:$sha"

mkdir -p "$base/backups" "$base/env" "$base/releases"
previous_api="$(grep '^OPS_API_IMAGE=' "$images" 2>/dev/null | cut -d= -f2- || true)"
previous_admin="$(grep '^OPS_ADMIN_IMAGE=' "$images" 2>/dev/null | cut -d= -f2- || true)"

if docker compose --env-file "$production_env" --env-file "$images" -f "$compose" ps --status running -q postgres 2>/dev/null | grep -q .; then
  stamp="$(date +%Y%m%d-%H%M%S)"
  docker compose --env-file "$production_env" --env-file "$images" -f "$compose" exec -T postgres sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
    > "$base/backups/predeploy-$stamp.dump"
fi

printf 'OPS_API_IMAGE=%s\nOPS_ADMIN_IMAGE=%s\n' "$api_image" "$admin_image" > "$images"
docker image inspect "$api_image" >/dev/null 2>&1 || docker pull "$api_image"
docker image inspect "$admin_image" >/dev/null 2>&1 || docker pull "$admin_image"
docker compose --env-file "$production_env" --env-file "$images" -f "$compose" up -d postgres
docker compose --env-file "$production_env" --env-file "$images" -f "$compose" run --rm ops-api \
  node ../../node_modules/prisma/build/index.js migrate deploy
docker compose --env-file "$production_env" --env-file "$images" -f "$compose" up -d --remove-orphans

healthy=0
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1/health >/dev/null; then healthy=1; break; fi
  sleep 3
done

if [[ "$healthy" != "1" ]]; then
  if [[ -n "$previous_api" && -n "$previous_admin" ]]; then
    printf 'OPS_API_IMAGE=%s\nOPS_ADMIN_IMAGE=%s\n' "$previous_api" "$previous_admin" > "$images"
    docker compose --env-file "$production_env" --env-file "$images" -f "$compose" up -d
  fi
  echo "health check failed; previous images restored" >&2
  exit 1
fi

printf '%s\n' "$sha" > "$base/releases/current-ops-sha"
docker image prune -f --filter "until=168h" >/dev/null
