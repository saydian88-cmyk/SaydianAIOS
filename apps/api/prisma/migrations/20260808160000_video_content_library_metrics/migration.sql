ALTER TABLE "ContentLibraryEntry"
  ADD COLUMN "latestViews" INTEGER,
  ADD COLUMN "latestLikes" INTEGER,
  ADD COLUMN "latestComments" INTEGER,
  ADD COLUMN "latestMetricAt" TIMESTAMP(3),
  ADD COLUMN "latestMetricCheckpointHours" INTEGER,
  ADD COLUMN "metricHistory" JSONB NOT NULL DEFAULT '[]';

WITH latest AS (
  SELECT DISTINCT ON (job."contentPlanId")
    job."contentPlanId", metric."views", metric."likes", metric."comments", metric."capturedAt",
    CASE
      WHEN EXTRACT(EPOCH FROM (metric."capturedAt" - job."publishedAt")) / 3600 >= 720 THEN 720
      WHEN EXTRACT(EPOCH FROM (metric."capturedAt" - job."publishedAt")) / 3600 >= 168 THEN 168
      WHEN EXTRACT(EPOCH FROM (metric."capturedAt" - job."publishedAt")) / 3600 >= 72 THEN 72
      WHEN EXTRACT(EPOCH FROM (metric."capturedAt" - job."publishedAt")) / 3600 >= 3 THEN 3
      ELSE NULL
    END AS checkpoint
  FROM "MetricSnapshot" metric
  JOIN "PublishJob" job ON job."id" = metric."publishJobId"
  WHERE job."publishedAt" IS NOT NULL
  ORDER BY job."contentPlanId", metric."capturedAt" DESC
)
UPDATE "ContentLibraryEntry" entry
SET "latestViews" = latest."views",
    "latestLikes" = latest."likes",
    "latestComments" = latest."comments",
    "latestMetricAt" = latest."capturedAt",
    "latestMetricCheckpointHours" = latest.checkpoint
FROM latest
WHERE entry."contentPlanId" = latest."contentPlanId";

WITH checkpoints("checkpointHours") AS (VALUES (3), (72), (168), (720)),
ranked AS (
  SELECT
    entry."id" AS "entryId", checkpoints."checkpointHours", metric."capturedAt", metric."views", metric."likes", metric."comments",
    ROW_NUMBER() OVER (
      PARTITION BY entry."id", checkpoints."checkpointHours"
      ORDER BY ABS(EXTRACT(EPOCH FROM (metric."capturedAt" - (job."publishedAt" + make_interval(hours => checkpoints."checkpointHours")))))
    ) AS rank
  FROM "ContentLibraryEntry" entry
  JOIN "PublishJob" job ON job."contentPlanId" = entry."contentPlanId" AND job."publishedAt" IS NOT NULL
  JOIN "MetricSnapshot" metric ON metric."publishJobId" = job."id"
  CROSS JOIN checkpoints
), histories AS (
  SELECT "entryId", jsonb_agg(jsonb_build_object(
    'checkpointHours', "checkpointHours",
    'capturedAt', "capturedAt",
    'views', "views",
    'likes', "likes",
    'comments', "comments"
  ) ORDER BY "checkpointHours") AS history
  FROM ranked
  WHERE rank = 1
  GROUP BY "entryId"
)
UPDATE "ContentLibraryEntry" entry
SET "metricHistory" = histories.history
FROM histories
WHERE entry."id" = histories."entryId";

CREATE INDEX "ContentLibraryEntry_category_visibilityStatus_latestViews_idx"
  ON "ContentLibraryEntry"("category", "visibilityStatus", "latestViews");
CREATE INDEX "ContentLibraryEntry_category_visibilityStatus_latestLikes_idx"
  ON "ContentLibraryEntry"("category", "visibilityStatus", "latestLikes");
CREATE INDEX "ContentLibraryEntry_category_visibilityStatus_latestComments_idx"
  ON "ContentLibraryEntry"("category", "visibilityStatus", "latestComments");
