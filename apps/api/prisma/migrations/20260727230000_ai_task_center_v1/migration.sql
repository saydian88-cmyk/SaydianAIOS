CREATE TYPE "AiTaskType" AS ENUM ('VIDEO', 'IMAGE', 'ARTICLE', 'STORE_ANALYSIS', 'COMPETITOR_ANALYSIS', 'LIVE_ANALYSIS');
CREATE TYPE "AiTaskStatus" AS ENUM ('PENDING', 'WAITING_CONFIRMATION', 'CLAIMED', 'RUNNING', 'WAITING_INPUT', 'QUALITY_CHECK', 'UPLOADING', 'PENDING_REVIEW', 'RETURNED', 'RETRY', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "AiTaskExecutionPolicy" AS ENUM ('AUTO_WITHIN_BUDGET', 'MANUAL');

CREATE TABLE "AiTask" (
    "id" TEXT NOT NULL,
    "taskNo" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "type" "AiTaskType" NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "status" "AiTaskStatus" NOT NULL DEFAULT 'PENDING',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "executionPolicy" "AiTaskExecutionPolicy" NOT NULL DEFAULT 'AUTO_WITHIN_BUDGET',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "platform" TEXT,
    "productId" TEXT,
    "productModel" TEXT,
    "ownerEmployeeId" TEXT,
    "reviewerEmployeeId" TEXT,
    "modelPolicy" JSONB NOT NULL DEFAULT '{}',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progressMessage" TEXT,
    "estimatedCost" DOUBLE PRECISION,
    "actualCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "budgetLimit" DOUBLE PRECISION,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "failureReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiTaskInputSnapshot" (
    "id" TEXT NOT NULL,
    "aiTaskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "checksum" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "missingFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiTaskInputSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiWorkerNode" (
    "id" TEXT NOT NULL,
    "nodeCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "version" TEXT,
    "currentTaskId" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiWorkerNode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiTaskAttempt" (
    "id" TEXT NOT NULL,
    "aiTaskId" TEXT NOT NULL,
    "workerNodeId" TEXT,
    "attemptNo" INTEGER NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "codexSessionId" TEXT,
    "promptTemplate" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL DEFAULT 'v1',
    "command" TEXT,
    "logs" JSONB NOT NULL DEFAULT '{}',
    "usage" JSONB NOT NULL DEFAULT '{}',
    "exitCode" INTEGER,
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiTaskAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiTaskOutput" (
    "id" TEXT NOT NULL,
    "aiTaskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mimeType" TEXT,
    "url" TEXT,
    "assetId" TEXT,
    "contentPlanId" TEXT,
    "reportId" TEXT,
    "opsTaskId" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiTaskOutput_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiTaskDependency" (
    "parentTaskId" TEXT NOT NULL,
    "childTaskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BLOCKS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiTaskDependency_pkey" PRIMARY KEY ("parentTaskId","childTaskId")
);

CREATE TABLE "AiTaskPolicy" (
    "id" TEXT NOT NULL,
    "type" "AiTaskType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "autoExecute" BOOLEAN NOT NULL DEFAULT true,
    "dailyBudget" DOUBLE PRECISION,
    "maxConcurrency" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 1800,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiTaskPolicy_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TaskNotification" ADD COLUMN "aiTaskId" TEXT;

CREATE UNIQUE INDEX "AiTask_taskNo_key" ON "AiTask"("taskNo");
CREATE UNIQUE INDEX "AiTask_idempotencyKey_key" ON "AiTask"("idempotencyKey");
CREATE INDEX "AiTask_status_priority_createdAt_idx" ON "AiTask"("status", "priority", "createdAt");
CREATE INDEX "AiTask_type_status_createdAt_idx" ON "AiTask"("type", "status", "createdAt");
CREATE INDEX "AiTask_sourceType_sourceId_idx" ON "AiTask"("sourceType", "sourceId");
CREATE INDEX "AiTask_ownerEmployeeId_status_idx" ON "AiTask"("ownerEmployeeId", "status");
CREATE INDEX "AiTask_reviewerEmployeeId_status_idx" ON "AiTask"("reviewerEmployeeId", "status");
CREATE INDEX "AiTaskInputSnapshot_aiTaskId_kind_idx" ON "AiTaskInputSnapshot"("aiTaskId", "kind");
CREATE INDEX "AiTaskInputSnapshot_sourceType_sourceId_idx" ON "AiTaskInputSnapshot"("sourceType", "sourceId");
CREATE UNIQUE INDEX "AiWorkerNode_nodeCode_key" ON "AiWorkerNode"("nodeCode");
CREATE INDEX "AiWorkerNode_status_lastHeartbeatAt_idx" ON "AiWorkerNode"("status", "lastHeartbeatAt");
CREATE UNIQUE INDEX "AiTaskAttempt_aiTaskId_attemptNo_key" ON "AiTaskAttempt"("aiTaskId", "attemptNo");
CREATE INDEX "AiTaskAttempt_workerNodeId_status_idx" ON "AiTaskAttempt"("workerNodeId", "status");
CREATE INDEX "AiTaskOutput_aiTaskId_reviewStatus_idx" ON "AiTaskOutput"("aiTaskId", "reviewStatus");
CREATE INDEX "AiTaskOutput_assetId_idx" ON "AiTaskOutput"("assetId");
CREATE INDEX "AiTaskOutput_contentPlanId_idx" ON "AiTaskOutput"("contentPlanId");
CREATE INDEX "AiTaskOutput_reportId_idx" ON "AiTaskOutput"("reportId");
CREATE INDEX "AiTaskOutput_opsTaskId_idx" ON "AiTaskOutput"("opsTaskId");
CREATE INDEX "AiTaskDependency_childTaskId_idx" ON "AiTaskDependency"("childTaskId");
CREATE UNIQUE INDEX "AiTaskPolicy_type_key" ON "AiTaskPolicy"("type");
CREATE INDEX "TaskNotification_aiTaskId_idx" ON "TaskNotification"("aiTaskId");

ALTER TABLE "AiTask" ADD CONSTRAINT "AiTask_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiTask" ADD CONSTRAINT "AiTask_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiTask" ADD CONSTRAINT "AiTask_reviewerEmployeeId_fkey" FOREIGN KEY ("reviewerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiTaskInputSnapshot" ADD CONSTRAINT "AiTaskInputSnapshot_aiTaskId_fkey" FOREIGN KEY ("aiTaskId") REFERENCES "AiTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTaskAttempt" ADD CONSTRAINT "AiTaskAttempt_aiTaskId_fkey" FOREIGN KEY ("aiTaskId") REFERENCES "AiTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTaskAttempt" ADD CONSTRAINT "AiTaskAttempt_workerNodeId_fkey" FOREIGN KEY ("workerNodeId") REFERENCES "AiWorkerNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiTaskOutput" ADD CONSTRAINT "AiTaskOutput_aiTaskId_fkey" FOREIGN KEY ("aiTaskId") REFERENCES "AiTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTaskOutput" ADD CONSTRAINT "AiTaskOutput_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiTaskOutput" ADD CONSTRAINT "AiTaskOutput_contentPlanId_fkey" FOREIGN KEY ("contentPlanId") REFERENCES "ContentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiTaskOutput" ADD CONSTRAINT "AiTaskOutput_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiTaskOutput" ADD CONSTRAINT "AiTaskOutput_opsTaskId_fkey" FOREIGN KEY ("opsTaskId") REFERENCES "OpsTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiTaskDependency" ADD CONSTRAINT "AiTaskDependency_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "AiTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTaskDependency" ADD CONSTRAINT "AiTaskDependency_childTaskId_fkey" FOREIGN KEY ("childTaskId") REFERENCES "AiTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskNotification" ADD CONSTRAINT "TaskNotification_aiTaskId_fkey" FOREIGN KEY ("aiTaskId") REFERENCES "AiTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "AiTaskPolicy" ("id","type","enabled","autoExecute","maxConcurrency","maxAttempts","timeoutSeconds","config","createdAt","updatedAt")
VALUES
  ('aitp-video-v1','VIDEO',true,true,1,3,3600,'{"dailyMainOutput":1}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('aitp-image-v1','IMAGE',true,true,1,3,1800,'{"onlyOnDemand":true}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('aitp-article-v1','ARTICLE',true,true,1,3,1200,'{"dailyOutput":1}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('aitp-store-v1','STORE_ANALYSIS',true,true,1,3,1200,'{"requiresSnapshot":true}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('aitp-competitor-v1','COMPETITOR_ANALYSIS',true,true,1,3,1200,'{"requiresSnapshot":true}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('aitp-live-v1','LIVE_ANALYSIS',true,true,1,3,1200,'{"requiresEndedSession":true}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

UPDATE "Role"
SET "permissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest("Role"."permissions" || ARRAY['AI_TASK_VIEW','AI_TASK_MANAGE','AI_TASK_POLICY','AI_TASK_RUNNER']::TEXT[]) AS permission
)
WHERE "code" = 'SYSTEM_ADMIN';

UPDATE "Role"
SET "permissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest("Role"."permissions" || ARRAY['AI_TASK_VIEW','AI_TASK_MANAGE','AI_TASK_REVIEW']::TEXT[]) AS permission
)
WHERE "code" IN ('CONTENT_MANAGER','OPERATIONS_MANAGER');
