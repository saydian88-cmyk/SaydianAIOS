CREATE TYPE "AssetPurpose" AS ENUM ('EDITING_FOOTAGE', 'PACKAGING_RESOURCE');
CREATE TYPE "PackagingResourceCategory" AS ENUM (
  'BGM',
  'BRAND_ELEMENT',
  'FONT',
  'LICENSE_DOCUMENT',
  'TEXT_EFFECT',
  'VIDEO_EFFECT',
  'STICKER',
  'SOUND_EFFECT',
  'OTHER'
);

ALTER TABLE "Asset"
  ADD COLUMN "purpose" "AssetPurpose" NOT NULL DEFAULT 'EDITING_FOOTAGE',
  ADD COLUMN "packagingCategory" "PackagingResourceCategory",
  ADD COLUMN "packagingMetadata" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "UploadBatch"
  ADD COLUMN "purpose" "AssetPurpose" NOT NULL DEFAULT 'EDITING_FOOTAGE',
  ADD COLUMN "packagingCategory" "PackagingResourceCategory";

CREATE INDEX "Asset_purpose_packagingCategory_reviewStatus_availabilityStatus_idx"
  ON "Asset"("purpose", "packagingCategory", "reviewStatus", "availabilityStatus");
