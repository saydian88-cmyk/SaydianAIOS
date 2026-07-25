ALTER TABLE "UploadBatch"
ADD COLUMN "contentPlanId" TEXT,
ADD COLUMN "shootRequirementId" TEXT;

CREATE INDEX "UploadBatch_contentPlanId_shootRequirementId_idx"
ON "UploadBatch"("contentPlanId", "shootRequirementId");
