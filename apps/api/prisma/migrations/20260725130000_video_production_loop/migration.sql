ALTER TABLE "ContentPlan"
  ADD COLUMN "productionNo" TEXT,
  ADD COLUMN "productionStage" TEXT NOT NULL DEFAULT 'SCRIPT_REVIEW',
  ADD COLUMN "workflowVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "owner" TEXT,
  ADD COLUMN "targetPlatforms" "IntegrationKind"[] NOT NULL DEFAULT ARRAY[]::"IntegrationKind"[],
  ADD COLUMN "shootRequirements" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "masterVideoPath" TEXT,
  ADD COLUMN "masterVideoStatus" TEXT NOT NULL DEFAULT 'PENDING';

CREATE UNIQUE INDEX "ContentPlan_productionNo_key" ON "ContentPlan"("productionNo");
CREATE INDEX "ContentPlan_productionStage_planDate_idx" ON "ContentPlan"("productionStage", "planDate");

ALTER TABLE "ContentVariant"
  ADD COLUMN "packagingStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "coverSpec" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "packagedAt" TIMESTAMP(3),
  ADD COLUMN "packagingReviewedBy" TEXT,
  ADD COLUMN "packagingReviewedAt" TIMESTAMP(3),
  ADD COLUMN "packagingRejectedReason" TEXT,
  ADD COLUMN "manualPublishUrl" TEXT,
  ADD COLUMN "manualExternalId" TEXT,
  ADD COLUMN "manualPublishedAt" TIMESTAMP(3);

CREATE INDEX "ContentVariant_packagingStatus_platform_idx" ON "ContentVariant"("packagingStatus", "platform");

CREATE TABLE "ContentOptimizationSuggestion" (
  "id" TEXT NOT NULL,
  "contentPlanId" TEXT NOT NULL,
  "checkpointHours" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  "summary" TEXT NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "recommendations" JSONB NOT NULL DEFAULT '[]',
  "rulePatch" JSONB NOT NULL DEFAULT '{}',
  "generatedBy" TEXT NOT NULL DEFAULT '系统数据复盘',
  "confirmedBy" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "rejectedBy" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentOptimizationSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentOptimizationSuggestion_contentPlanId_checkpointHours_key"
  ON "ContentOptimizationSuggestion"("contentPlanId", "checkpointHours");
CREATE INDEX "ContentOptimizationSuggestion_status_createdAt_idx"
  ON "ContentOptimizationSuggestion"("status", "createdAt");
ALTER TABLE "ContentOptimizationSuggestion"
  ADD CONSTRAINT "ContentOptimizationSuggestion_contentPlanId_fkey"
  FOREIGN KEY ("contentPlanId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
