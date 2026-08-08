CREATE TABLE "ContentLibraryEntry" (
  "id" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'VIDEO',
  "contentPlanId" TEXT NOT NULL,
  "outputAssetId" TEXT NOT NULL,
  "renderJobId" TEXT,
  "title" TEXT NOT NULL,
  "productModel" TEXT,
  "productCategory" TEXT,
  "platform" TEXT,
  "createdBy" TEXT,
  "snapshot" JSONB NOT NULL DEFAULT '{}',
  "visibilityStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  "hiddenAt" TIMESTAMP(3),
  "hiddenBy" TEXT,
  "hiddenWithProject" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentLibraryEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentLibraryEntry_contentPlanId_outputAssetId_key" ON "ContentLibraryEntry"("contentPlanId", "outputAssetId");
CREATE INDEX "ContentLibraryEntry_category_visibilityStatus_createdAt_idx" ON "ContentLibraryEntry"("category", "visibilityStatus", "createdAt");
CREATE INDEX "ContentLibraryEntry_productModel_platform_idx" ON "ContentLibraryEntry"("productModel", "platform");
CREATE INDEX "ContentLibraryEntry_productCategory_createdAt_idx" ON "ContentLibraryEntry"("productCategory", "createdAt");
CREATE INDEX "ContentLibraryEntry_createdBy_createdAt_idx" ON "ContentLibraryEntry"("createdBy", "createdAt");

ALTER TABLE "ContentLibraryEntry" ADD CONSTRAINT "ContentLibraryEntry_contentPlanId_fkey" FOREIGN KEY ("contentPlanId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentLibraryEntry" ADD CONSTRAINT "ContentLibraryEntry_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
