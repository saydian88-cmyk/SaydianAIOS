ALTER TABLE "Asset"
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "purgeAfter" TIMESTAMP(3);

CREATE INDEX "Asset_deletedAt_purgeAfter_idx" ON "Asset"("deletedAt", "purgeAfter");
