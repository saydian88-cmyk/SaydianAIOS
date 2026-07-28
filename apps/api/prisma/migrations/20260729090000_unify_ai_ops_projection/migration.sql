ALTER TABLE "TaskNotification"
  ADD COLUMN "eventKey" TEXT,
  ADD COLUMN "targetType" TEXT,
  ADD COLUMN "targetId" TEXT;

UPDATE "TaskNotification"
SET
  "targetType" = CASE
    WHEN "taskId" IS NOT NULL THEN 'OPS_TASK'
    WHEN "aiTaskId" IS NOT NULL THEN 'AI_TASK'
    ELSE NULL
  END,
  "targetId" = COALESCE("taskId", "aiTaskId");

DELETE FROM "TaskNotification" newer
USING "TaskNotification" older
WHERE newer."id" <> older."id"
  AND newer."createdAt" >= older."createdAt"
  AND newer."recipientEmployeeId" IS NOT DISTINCT FROM older."recipientEmployeeId"
  AND newer."channel" = older."channel"
  AND newer."type" = older."type"
  AND newer."taskId" IS NOT DISTINCT FROM older."taskId"
  AND newer."aiTaskId" IS NOT DISTINCT FROM older."aiTaskId"
  AND (newer."createdAt" > older."createdAt" OR newer."id" > older."id");

UPDATE "TaskNotification"
SET "eventKey" = CONCAT(
  COALESCE("aiTaskId", 'NO_AI'),
  ':',
  "type",
  ':',
  COALESCE("taskId", 'NO_TASK')
);

CREATE UNIQUE INDEX "TaskNotification_recipientEmployeeId_channel_eventKey_key"
  ON "TaskNotification"("recipientEmployeeId", "channel", "eventKey");

UPDATE "AiTaskOutput" output
SET "opsTaskId" = task."sourceId"
FROM "AiTask" task
WHERE output."aiTaskId" = task."id"
  AND task."sourceType" = 'WORKBENCH_CONTENT_REQUEST'
  AND task."sourceId" IS NOT NULL
  AND output."kind" <> 'OPS_TASK'
  AND EXISTS (SELECT 1 FROM "OpsTask" ops WHERE ops."id" = task."sourceId");

UPDATE "AiTaskOutput" output
SET "opsTaskId" = task."sourceId"
FROM "OpsTask" duplicate
JOIN "AiTask" task ON task."id" = duplicate."sourceId"
WHERE output."opsTaskId" = duplicate."id"
  AND duplicate."sourceType" = 'AI_TASK'
  AND duplicate."category" = 'AI_DELIVERY'
  AND task."sourceType" = 'WORKBENCH_CONTENT_REQUEST'
  AND task."sourceId" IS NOT NULL
  AND output."kind" <> 'OPS_TASK'
  AND EXISTS (SELECT 1 FROM "OpsTask" original WHERE original."id" = task."sourceId");

UPDATE "OpsTask" duplicate
SET
  "status" = 'CANCELLED',
  "deletedAt" = NOW(),
  "purgeAfter" = NOW() + INTERVAL '30 days',
  "result" = '历史重复交付任务已归并至原始员工任务'
FROM "AiTask" task
WHERE duplicate."sourceType" = 'AI_TASK'
  AND duplicate."category" = 'AI_DELIVERY'
  AND duplicate."sourceId" = task."id"
  AND task."sourceType" = 'WORKBENCH_CONTENT_REQUEST'
  AND task."sourceId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "OpsTask" original WHERE original."id" = task."sourceId");
