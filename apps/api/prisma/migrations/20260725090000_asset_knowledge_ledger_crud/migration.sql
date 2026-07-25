ALTER TABLE "PlatformAccount" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Store" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "PlatformAccount_region_state_archivedAt_idx"
ON "PlatformAccount"("region", "state", "archivedAt");

CREATE INDEX "Store_archivedAt_idx"
ON "Store"("archivedAt");
