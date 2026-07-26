UPDATE "VideoModelConfig" AS model
SET
  "enabled" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "VideoModelProvider" AS provider
WHERE model."providerId" = provider."id"
  AND provider."code" = 'BAILIAN_WAN'
  AND provider."enabled" = TRUE
  AND provider."secretRef" IS NOT NULL
  AND model."code" IN ('wan2.5-t2v-preview', 'wan2.5-i2v-preview');
