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
workbench_image="$registry/$repository/ops-workbench:$sha"

mkdir -p "$base/backups" "$base/env" "$base/releases"
previous_api="$(grep '^OPS_API_IMAGE=' "$images" 2>/dev/null | cut -d= -f2- || true)"
previous_admin="$(grep '^OPS_ADMIN_IMAGE=' "$images" 2>/dev/null | cut -d= -f2- || true)"
previous_workbench="$(grep '^OPS_WORKBENCH_IMAGE=' "$images" 2>/dev/null | cut -d= -f2- || true)"
previous_workbench="${previous_workbench:-$workbench_image}"

find "$base/backups" -type f -name 'predeploy-*.dump' -mtime +14 -delete
mapfile -t stale_backups < <(find "$base/backups" -maxdepth 1 -type f -name 'predeploy-*.dump' -printf '%T@ %p\n' | sort -nr | tail -n +4 | cut -d' ' -f2-)
if ((${#stale_backups[@]})); then
  rm -f -- "${stale_backups[@]}"
fi

if docker compose --env-file "$production_env" --env-file "$images" -f "$compose" ps --status running -q postgres 2>/dev/null | grep -q .; then
  stamp="$(date +%Y%m%d-%H%M%S)"
  docker compose --env-file "$production_env" --env-file "$images" -f "$compose" exec -T postgres sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
    > "$base/backups/predeploy-$stamp.dump"
fi

printf 'OPS_API_IMAGE=%s\nOPS_ADMIN_IMAGE=%s\nOPS_WORKBENCH_IMAGE=%s\n' "$api_image" "$admin_image" "$workbench_image" > "$images"
docker image inspect "$api_image" >/dev/null 2>&1 || docker pull "$api_image"
docker image inspect "$admin_image" >/dev/null 2>&1 || docker pull "$admin_image"
docker image inspect "$workbench_image" >/dev/null 2>&1 || docker pull "$workbench_image"
docker compose --env-file "$production_env" --env-file "$images" -f "$compose" up -d postgres
docker compose --env-file "$production_env" --env-file "$images" -f "$compose" run --rm --user root ops-api \
  sh -c 'mkdir -p data/upload-inbox data/derived data/bootstrap && chown -R 1001:1001 data'
failed_migrations="$(
  docker compose --env-file "$production_env" --env-file "$images" -f "$compose" exec -T postgres sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT migration_name FROM \"_prisma_migrations\" WHERE finished_at IS NULL AND rolled_back_at IS NULL"' \
    || true
)"
while IFS= read -r failed_migration; do
  [[ -n "$failed_migration" ]] || continue
  docker compose --env-file "$production_env" --env-file "$images" -f "$compose" run --rm ops-api \
    node node_modules/prisma/build/index.js migrate resolve --rolled-back "$failed_migration"
done <<< "$failed_migrations"
docker compose --env-file "$production_env" --env-file "$images" -f "$compose" run --rm ops-api \
  node node_modules/prisma/build/index.js migrate deploy
docker compose --env-file "$production_env" --env-file "$images" -f "$compose" run --rm ops-api \
  node_modules/.bin/tsx prisma/seed.ts
docker compose --env-file "$production_env" --env-file "$images" -f "$compose" run --rm ops-api \
  node_modules/.bin/tsx prisma/backfill-video-factory.ts
docker compose --env-file "$production_env" --env-file "$images" -f "$compose" run --rm ops-api \
  node_modules/.bin/tsx prisma/backfill-task-projection-v2.ts --apply
docker compose --env-file "$production_env" --env-file "$images" -f "$compose" up -d --remove-orphans
docker compose --env-file "$production_env" --env-file "$images" -f "$compose" restart gateway

healthy=0
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1/health >/dev/null \
    && curl -fsS -H 'Host: stest.saydian.cn' https://127.0.0.1/saidian-admin/ -k >/dev/null \
    && curl -fsS -H 'Host: stest.saydian.cn' https://127.0.0.1/saidian-work/ -k >/dev/null; then healthy=1; break; fi
  sleep 3
done

if [[ "$healthy" != "1" ]]; then
  if [[ -n "$previous_api" && -n "$previous_admin" && -n "$previous_workbench" ]]; then
    printf 'OPS_API_IMAGE=%s\nOPS_ADMIN_IMAGE=%s\nOPS_WORKBENCH_IMAGE=%s\n' "$previous_api" "$previous_admin" "$previous_workbench" > "$images"
    docker compose --env-file "$production_env" --env-file "$images" -f "$compose" up -d
  fi
  echo "health check failed; previous images restored" >&2
  exit 1
fi

if ! docker compose --env-file "$production_env" --env-file "$images" -f "$compose" ps --status running -q video-worker | grep -q .; then
  echo "video worker health check failed" >&2
  exit 1
fi

printf '%s\n' "$sha" > "$base/releases/current-ops-sha"
docker image prune -af --filter "until=24h" >/dev/null
