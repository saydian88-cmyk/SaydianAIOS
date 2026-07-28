ALTER TABLE "OpsTask"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "purgeAfter" TIMESTAMP(3),
  ADD COLUMN "deletedByEmployeeId" TEXT;

CREATE INDEX "OpsTask_deletedByEmployeeId_deletedAt_purgeAfter_idx"
  ON "OpsTask"("deletedByEmployeeId", "deletedAt", "purgeAfter");
