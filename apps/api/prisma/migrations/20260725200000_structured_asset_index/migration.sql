ALTER TABLE "Asset"
ADD COLUMN "aiIndex" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "searchText" TEXT,
ADD COLUMN "indexVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "indexConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "indexNeedsReview" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "indexReviewedAt" TIMESTAMP(3),
ADD COLUMN "indexReviewCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Asset_indexVersion_processingStatus_idx"
ON "Asset"("indexVersion", "processingStatus");
