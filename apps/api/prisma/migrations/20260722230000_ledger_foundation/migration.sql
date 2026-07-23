-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('DOUYIN', 'TIKTOK', 'AMAZON', 'SHOPIFY', 'WECHAT_CHANNELS', 'XIAOHONGSHU', 'WECHAT_OFFICIAL', 'WECOM', 'TMALL', 'JD', 'PINDUODUO', 'SAIDIAN_MALL', 'JUSHUITAN', 'FEIGUA', 'WEB_SEARCH', 'LOCAL_ASSET', 'WECOM_DRIVE', 'HELP_CENTER', 'EVIDENCE_WORKBOOK', 'ALIYUN_OSS');

-- CreateEnum
CREATE TYPE "IntegrationState" AS ENUM ('UNCONFIGURED', 'CONFIGURED', 'HEALTHY', 'DEGRADED', 'ERROR');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('DRAFT', 'PENDING', 'READY', 'BLOCKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SCHEDULED', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('VIDEO', 'ARTICLE', 'SHORT_POST', 'WECHAT_MOMENT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'RETRY', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlertLevel" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "WorkItemType" AS ENUM ('CUSTOMER_SERVICE', 'SHIPMENT', 'AFTER_SALE', 'REFUND', 'WORK_ORDER');

-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('DAILY', 'WEEKLY', 'COMPETITOR', 'LIVE_REVIEW', 'SHOP', 'TREND');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('HUMAN', 'AI', 'SYSTEM', 'PLATFORM');

-- CreateEnum
CREATE TYPE "BusinessSnapshotType" AS ENUM ('PRODUCT', 'INVENTORY', 'ORDER', 'SHIPMENT', 'AFTER_SALE', 'REFUND', 'CUSTOMER_SERVICE', 'WORK_ORDER');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "AssetLevel" AS ENUM ('ORIGINAL', 'MODULE', 'FINISHED', 'REFERENCE', 'AI_GENERATED');

-- CreateEnum
CREATE TYPE "ProductScope" AS ENUM ('MODEL', 'SERIES', 'BRAND', 'COMMON', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AssetProcessingStatus" AS ENUM ('RECEIVED', 'HASHED', 'STORED', 'ANALYZING', 'READY_FOR_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "AssetReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'RETURNED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AssetAvailabilityStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssetRightsStatus" AS ENUM ('COMMERCIAL', 'INTERNAL', 'EDIT_ONLY', 'AUTH_REQUIRED', 'EXPIRED', 'PROHIBITED');

-- CreateEnum
CREATE TYPE "VideoModuleType" AS ENUM ('HOOK', 'PAIN', 'SCENE', 'FEATURE', 'BENEFIT', 'PROOF', 'DEMO', 'COMPARE', 'UGC', 'STORY', 'TRANSITION', 'TRAFFIC', 'OFFER', 'CTA', 'ENDING');

-- CreateEnum
CREATE TYPE "AssetTagSource" AS ENUM ('AI', 'HUMAN', 'IMPORT', 'RULE');

-- CreateEnum
CREATE TYPE "AssetRelationType" AS ENUM ('SOURCE_OF', 'SEGMENT_OF', 'DERIVED_FROM', 'PREVIEW_OF', 'NEAR_DUPLICATE', 'DUPLICATE_OF');

-- CreateEnum
CREATE TYPE "AssetJobType" AS ENUM ('TECHNICAL_METADATA', 'THUMBNAIL', 'PROXY_VIDEO', 'OCR', 'TRANSCRIPTION', 'KEYFRAMES', 'SCENE_SEGMENTATION', 'CONTENT_UNDERSTANDING', 'TAGGING', 'NEAR_DUPLICATE');

-- CreateEnum
CREATE TYPE "AssetJobStatus" AS ENUM ('PENDING', 'RUNNING', 'RETRY', 'SUCCEEDED', 'FAILED', 'UNCONFIGURED');

-- CreateEnum
CREATE TYPE "CloudMediaProvider" AS ENUM ('ALIYUN_IMS', 'ALIYUN_BAILIAN');

-- CreateEnum
CREATE TYPE "CloudMediaJobType" AS ENUM ('MEDIA_INFO', 'PROXY_VIDEO', 'SCREENSHOTS', 'SEGMENTATION', 'TRANSCRIPTION', 'VIDEO_UNDERSTANDING', 'SEGMENT_ANALYSIS', 'MODULE_CLASSIFICATION', 'ASSET_SCORING', 'REMAKE_BRIEF');

-- CreateEnum
CREATE TYPE "CloudMediaJobStatus" AS ENUM ('PENDING', 'SUBMITTED', 'PROCESSING', 'RETRY', 'SUCCEEDED', 'FAILED', 'UNCONFIGURED');

-- CreateEnum
CREATE TYPE "AssetScoreKind" AS ENUM ('OWNED_ASSET', 'EXTERNAL_REFERENCE');

-- CreateEnum
CREATE TYPE "ExternalVideoStatus" AS ENUM ('DISCOVERED', 'QUEUED', 'ANALYZING', 'READY', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RemakeTaskStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UploadBatchStatus" AS ENUM ('DRAFT', 'UPLOADING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "UploadEventResult" AS ENUM ('CREATED', 'EXACT_DUPLICATE', 'FAILED');

-- CreateEnum
CREATE TYPE "AssetReviewAction" AS ENUM ('APPROVE', 'RETURN', 'INTERNAL_ONLY', 'REJECT');

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "kind" "IntegrationKind" NOT NULL,
    "displayName" TEXT NOT NULL,
    "state" "IntegrationState" NOT NULL DEFAULT 'UNCONFIGURED',
    "capabilities" TEXT[],
    "capabilityStatus" JSONB NOT NULL DEFAULT '{}',
    "region" TEXT NOT NULL DEFAULT 'CN',
    "publicConfig" JSONB NOT NULL DEFAULT '{}',
    "secretRef" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "message" TEXT NOT NULL DEFAULT '未配置',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "employeeNo" TEXT,
    "name" TEXT NOT NULL,
    "departmentId" TEXT,
    "role" TEXT NOT NULL DEFAULT '运营',
    "wecomUserId" TEXT,
    "mobileMasked" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modelCode" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "evidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "RecordStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSku" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "externalMappings" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAccount" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'CN',
    "state" "IntegrationState" NOT NULL DEFAULT 'UNCONFIGURED',
    "capabilityStatus" JSONB NOT NULL DEFAULT '{}',
    "ownerEmployeeId" TEXT,
    "message" TEXT NOT NULL DEFAULT '未配置',
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "platformAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "externalStoreId" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'CN',
    "state" "IntegrationState" NOT NULL DEFAULT 'UNCONFIGURED',
    "ownerEmployeeId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "modifiedAt" TIMESTAMP(3) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" DOUBLE PRECISION,
    "aspectRatio" TEXT,
    "model" TEXT,
    "scene" TEXT,
    "evidenceIds" TEXT[],
    "restriction" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'PENDING',
    "qualityScore" INTEGER NOT NULL DEFAULT 0,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "performance" JSONB NOT NULL DEFAULT '{}',
    "sourceSnapshot" JSONB NOT NULL DEFAULT '{}',
    "storageProvider" TEXT NOT NULL DEFAULT 'LOCAL_SOURCE',
    "objectKey" TEXT,
    "objectVersionId" TEXT,
    "etag" TEXT,
    "storageUrl" TEXT,
    "storageSyncedAt" TIMESTAMP(3),
    "storageError" TEXT,
    "discoveredBy" TEXT NOT NULL DEFAULT '系统素材扫描',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assetNo" TEXT,
    "displayName" TEXT,
    "kind" "AssetKind",
    "level" "AssetLevel" NOT NULL DEFAULT 'ORIGINAL',
    "productScope" "ProductScope" NOT NULL DEFAULT 'UNKNOWN',
    "processingStatus" "AssetProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "reviewStatus" "AssetReviewStatus" NOT NULL DEFAULT 'PENDING',
    "availabilityStatus" "AssetAvailabilityStatus" NOT NULL DEFAULT 'INACTIVE',
    "rightsStatus" "AssetRightsStatus" NOT NULL DEFAULT 'AUTH_REQUIRED',
    "originalFileName" TEXT,
    "contentDescription" TEXT,
    "acquiredAt" TIMESTAMP(3),
    "isOriginal" BOOLEAN NOT NULL DEFAULT false,
    "perceptualHash" TEXT,
    "analysisVersion" INTEGER NOT NULL DEFAULT 0,
    "lastAnalysisAt" TIMESTAMP(3),
    "createdByEmployeeId" TEXT,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetVersion" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "objectKey" TEXT,
    "objectVersionId" TEXT,
    "etag" TEXT,
    "storageUrl" TEXT,
    "createdByEmployeeId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "originalFileName" TEXT,
    "mimeType" TEXT,
    "extension" TEXT,
    "sizeBytes" BIGINT,
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" DOUBLE PRECISION,
    "codec" TEXT,
    "previewObjectKey" TEXT,
    "previewUrl" TEXT,
    "technicalMetadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "AssetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandProfileVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "positioning" TEXT,
    "story" TEXT,
    "tone" JSONB NOT NULL DEFAULT '{}',
    "visual" JSONB NOT NULL DEFAULT '{}',
    "marketVersions" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "effectiveAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaqEntry" (
    "id" TEXT NOT NULL,
    "faqNo" TEXT NOT NULL,
    "standardQuestion" TEXT NOT NULL,
    "shortAnswer" TEXT NOT NULL,
    "detailedAnswer" TEXT,
    "category" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'zh-CN',
    "market" TEXT NOT NULL DEFAULT 'CN',
    "frequency" INTEGER NOT NULL DEFAULT 0,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "source" TEXT NOT NULL,
    "sourceLevel" TEXT NOT NULL DEFAULT 'B',
    "productId" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'PENDING',
    "externallyUsable" BOOLEAN NOT NULL DEFAULT false,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaqEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaqVariant" (
    "id" TEXT NOT NULL,
    "faqId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaqVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetProduct" (
    "assetId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "scope" "ProductScope" NOT NULL DEFAULT 'MODEL',
    "confidence" DOUBLE PRECISION,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetProduct_pkey" PRIMARY KEY ("assetId","productId")
);

-- CreateTable
CREATE TABLE "TagDefinition" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TagDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetTag" (
    "assetId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "source" "AssetTagSource" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "modelVersion" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetTag_pkey" PRIMARY KEY ("assetId","tagId")
);

-- CreateTable
CREATE TABLE "AssetRelation" (
    "id" TEXT NOT NULL,
    "parentAssetId" TEXT NOT NULL,
    "childAssetId" TEXT NOT NULL,
    "type" "AssetRelationType" NOT NULL,
    "score" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadBatch" (
    "id" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "status" "UploadBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceType" TEXT NOT NULL,
    "productScope" "ProductScope" NOT NULL DEFAULT 'UNKNOWN',
    "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assetKind" "AssetKind",
    "contentDescription" TEXT,
    "originalStatus" BOOLEAN NOT NULL DEFAULT false,
    "rightsStatus" "AssetRightsStatus" NOT NULL DEFAULT 'AUTH_REQUIRED',
    "acquiredAt" TIMESTAMP(3),
    "uploadedByEmployeeId" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "receivedCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadEvent" (
    "id" TEXT NOT NULL,
    "uploadBatchId" TEXT NOT NULL,
    "assetId" TEXT,
    "uploadedByEmployeeId" TEXT,
    "originalFileName" TEXT NOT NULL,
    "sha256" TEXT,
    "sizeBytes" BIGINT NOT NULL,
    "result" "UploadEventResult" NOT NULL,
    "failureReason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetAnalysisJob" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "AssetJobType" NOT NULL,
    "status" "AssetJobStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "modelVersion" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 4,
    "nextAttemptAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "input" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetAnalysisJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetReviewDecision" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "action" "AssetReviewAction" NOT NULL,
    "note" TEXT,
    "reviewerEmployeeId" TEXT,
    "reviewer" TEXT NOT NULL,
    "before" JSONB NOT NULL DEFAULT '{}',
    "after" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetUsage" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "usageType" TEXT NOT NULL,
    "businessObjectType" TEXT NOT NULL,
    "businessObjectId" TEXT NOT NULL,
    "usedByEmployeeId" TEXT,
    "usedBy" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL DEFAULT 'HUMAN',
    "purpose" TEXT,
    "platform" "IntegrationKind",
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetMetricSnapshot" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "usageId" TEXT,
    "platform" "IntegrationKind",
    "accountId" TEXT,
    "externalId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "consultations" INTEGER,
    "orders" INTEGER,
    "revenue" DECIMAL(18,2),
    "unavailableFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "raw" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "AssetMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetSegment" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "startSeconds" DOUBLE PRECISION NOT NULL,
    "endSeconds" DOUBLE PRECISION NOT NULL,
    "transcript" TEXT,
    "moduleType" "VideoModuleType",
    "confidence" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "analysisVersion" INTEGER NOT NULL,
    "previewObjectKey" TEXT,
    "materializedAssetId" TEXT,
    "createdBy" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetGapSnapshot" (
    "id" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "productId" TEXT,
    "productModel" TEXT,
    "assetKind" "AssetKind" NOT NULL,
    "category" TEXT NOT NULL,
    "requiredCount" INTEGER NOT NULL,
    "activeCount" INTEGER NOT NULL,
    "gapCount" INTEGER NOT NULL,
    "severity" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL DEFAULT '系统缺口分析',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetGapSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudMediaJob" (
    "id" TEXT NOT NULL,
    "assetId" TEXT,
    "externalVideoId" TEXT,
    "provider" "CloudMediaProvider" NOT NULL,
    "type" "CloudMediaJobType" NOT NULL,
    "status" "CloudMediaJobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "externalJobId" TEXT,
    "model" TEXT,
    "modelVersion" TEXT,
    "inputObjectKey" TEXT,
    "requestPayload" JSONB NOT NULL DEFAULT '{}',
    "resultPayload" JSONB NOT NULL DEFAULT '{}',
    "usage" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 4,
    "nextAttemptAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "callbackToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudMediaJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudMediaOutput" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "outputType" TEXT NOT NULL,
    "objectKey" TEXT,
    "url" TEXT,
    "startSecond" DOUBLE PRECISION,
    "endSecond" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloudMediaOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetScoreSnapshot" (
    "id" TEXT NOT NULL,
    "assetId" TEXT,
    "externalVideoId" TEXT,
    "kind" "AssetScoreKind" NOT NULL,
    "score" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "dimensions" JSONB NOT NULL DEFAULT '{}',
    "explanation" TEXT,
    "scoringVersion" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalVideo" (
    "id" TEXT NOT NULL,
    "platform" "IntegrationKind" NOT NULL,
    "externalContentId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "accountName" TEXT,
    "title" TEXT,
    "description" TEXT,
    "publishedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ExternalVideoStatus" NOT NULL DEFAULT 'DISCOVERED',
    "rightsStatus" "AssetRightsStatus" NOT NULL DEFAULT 'INTERNAL',
    "level" "AssetLevel" NOT NULL DEFAULT 'REFERENCE',
    "availabilityStatus" "AssetAvailabilityStatus" NOT NULL DEFAULT 'INACTIVE',
    "sourceObjectKey" TEXT,
    "previewObjectKey" TEXT,
    "transcript" TEXT,
    "moduleSummary" JSONB NOT NULL DEFAULT '[]',
    "analysis" JSONB NOT NULL DEFAULT '{}',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalMetricSnapshot" (
    "id" TEXT NOT NULL,
    "externalVideoId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "followers" INTEGER,
    "unavailableFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "raw" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ExternalMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemakeTask" (
    "id" TEXT NOT NULL,
    "taskNo" TEXT NOT NULL,
    "externalVideoId" TEXT NOT NULL,
    "sourceStartSecond" DOUBLE PRECISION,
    "sourceEndSecond" DOUBLE PRECISION,
    "productId" TEXT,
    "ownerEmployeeId" TEXT,
    "status" "RemakeTaskStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "brief" JSONB NOT NULL DEFAULT '{}',
    "score" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL DEFAULT 'AI爆款分析',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemakeTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceClaim" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "entityIdentifier" TEXT,
    "coveredObject" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "confirmedFact" TEXT,
    "publicWording" TEXT,
    "internalRestriction" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'PENDING',
    "raw" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL,
    "commercialName" TEXT NOT NULL,
    "pageFacts" TEXT,
    "nameplateModel" TEXT,
    "registeredModel" TEXT,
    "registrationNumber" TEXT,
    "productionRelation" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'PENDING',
    "requiredAction" TEXT,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhraseRule" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "blockedText" TEXT NOT NULL,
    "replacement" TEXT,
    "condition" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhraseRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeEntry" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "model" TEXT,
    "summary" TEXT,
    "reply" TEXT,
    "body" TEXT,
    "source" TEXT NOT NULL,
    "sourceRefs" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'PENDING',
    "audience" TEXT NOT NULL DEFAULT 'customer',
    "sourceLevel" TEXT NOT NULL DEFAULT 'B',
    "validUntil" TIMESTAMP(3),
    "externallyUsable" BOOLEAN NOT NULL DEFAULT false,
    "evidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "updatedAtSource" TIMESTAMP(3),
    "raw" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPlan" (
    "id" TEXT NOT NULL,
    "planDate" TIMESTAMP(3) NOT NULL,
    "kind" "ContentKind" NOT NULL,
    "topic" TEXT NOT NULL,
    "productModel" TEXT,
    "audience" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "scoreBreakdown" JSONB NOT NULL DEFAULT '{}',
    "hook" TEXT NOT NULL,
    "outline" JSONB NOT NULL DEFAULT '[]',
    "sourceSignals" JSONB NOT NULL DEFAULT '[]',
    "evidenceIds" TEXT[],
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "riskReasons" TEXT[],
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL DEFAULT '系统内容引擎',
    "assignedTo" TEXT,
    "assignedEmployeeId" TEXT,
    "actorType" "ActorType" NOT NULL DEFAULT 'AI',
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "promptVersion" TEXT,
    "rejectedReason" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentVariant" (
    "id" TEXT NOT NULL,
    "contentPlanId" TEXT NOT NULL,
    "platform" "IntegrationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mediaType" TEXT,
    "mediaPath" TEXT,
    "coverPath" TEXT,
    "targetAccountId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentAsset" (
    "contentPlanId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "ContentAsset_pkey" PRIMARY KEY ("contentPlanId","assetId","role")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "contentPlanId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishJob" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "contentPlanId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "remoteId" TEXT,
    "remoteUrl" TEXT,
    "receipt" JSONB NOT NULL DEFAULT '{}',
    "lastError" TEXT,
    "operator" TEXT NOT NULL DEFAULT '系统发布',
    "operatorType" "ActorType" NOT NULL DEFAULT 'SYSTEM',
    "operatorEmployeeId" TEXT,
    "platformAccountId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "publishJobId" TEXT,
    "remoteId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "views" INTEGER,
    "completionRate" DOUBLE PRECISION,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "consultations" INTEGER,
    "orders" INTEGER,
    "unavailableFields" TEXT[],
    "raw" JSONB NOT NULL DEFAULT '{}',
    "capturedBy" TEXT NOT NULL DEFAULT '系统数据巡查',

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentRecord" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "remoteContentId" TEXT NOT NULL,
    "remoteCommentId" TEXT NOT NULL,
    "authorName" TEXT,
    "text" TEXT NOT NULL,
    "category" TEXT,
    "confidence" DOUBLE PRECISION,
    "knowledgeRef" TEXT,
    "suggestedReply" TEXT,
    "riskReasons" TEXT[],
    "requiresHuman" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAtRemote" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplyJob" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "replyText" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "knowledgeRef" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "platformReceipt" JSONB NOT NULL DEFAULT '{}',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplyJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "remoteRoomId" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "lastCapturedAt" TIMESTAMP(3),
    "latestSnapshot" JSONB NOT NULL DEFAULT '{}',
    "issueSummary" TEXT[],
    "reportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopWorkItem" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "type" "WorkItemType" NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "owner" TEXT,
    "createdAtRemote" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "overdue" BOOLEAN NOT NULL DEFAULT false,
    "sourceSnapshot" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopWorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "platformAccountId" TEXT,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "importedBy" TEXT NOT NULL,
    "importedByEmployeeId" TEXT,
    "recordsReceived" INTEGER NOT NULL DEFAULT 0,
    "recordsImported" INTEGER NOT NULL DEFAULT 0,
    "recordsRejected" INTEGER NOT NULL DEFAULT 0,
    "unavailableFields" TEXT[],
    "errors" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSnapshot" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "platformAccountId" TEXT,
    "storeId" TEXT,
    "importBatchId" TEXT,
    "type" "BusinessSnapshotType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL DEFAULT 'current',
    "status" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "ownerEmployeeId" TEXT,
    "amount" DECIMAL(18,2),
    "currency" TEXT,
    "sourceUrl" TEXT,
    "unavailableFields" TEXT[],
    "payload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "BusinessSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributionTouch" (
    "id" TEXT NOT NULL,
    "attributionCode" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "contentPlanId" TEXT,
    "publishJobId" TEXT,
    "integrationId" TEXT,
    "platformAccountId" TEXT,
    "employeeId" TEXT,
    "externalEventId" TEXT,
    "source" TEXT NOT NULL,
    "medium" TEXT,
    "campaign" TEXT,
    "consultations" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(18,2),
    "currency" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributionTouch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSourceHealth" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "platformAccountId" TEXT,
    "state" "IntegrationState" NOT NULL,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "message" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "unavailableFields" TEXT[],
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataSourceHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "platform" "IntegrationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "accountId" TEXT,
    "shopId" TEXT,
    "liveRoomId" TEXT,
    "watchUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorSnapshot" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "products" JSONB NOT NULL DEFAULT '[]',
    "promotions" JSONB NOT NULL DEFAULT '[]',
    "contentFrequency" INTEGER,
    "liveFrequency" INTEGER,
    "visibleSales" DOUBLE PRECISION,
    "unavailableFields" TEXT[],
    "changes" JSONB NOT NULL DEFAULT '[]',
    "raw" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "CompetitorSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendSignal" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "volume" DOUBLE PRECISION,
    "changeRate" DOUBLE PRECISION,
    "sentiment" TEXT,
    "opportunity" TEXT,
    "action" TEXT,
    "raw" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "TrendSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "level" "AlertLevel" NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "owner" TEXT,
    "dueAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "owner" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "result" TEXT,
    "completedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpsTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "title" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "sentAt" TIMESTAMP(3),
    "sendReceipt" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "nextAttemptAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 4,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "result" JSONB NOT NULL DEFAULT '{}',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopVersion" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "rules" JSONB NOT NULL,
    "changeNote" TEXT NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "effectiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SopVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB NOT NULL DEFAULT '{}',
    "after" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Integration_kind_key" ON "Integration"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeNo_key" ON "Employee"("employeeNo");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_wecomUserId_key" ON "Employee"("wecomUserId");

-- CreateIndex
CREATE INDEX "Employee_departmentId_status_idx" ON "Employee"("departmentId", "status");

-- CreateIndex
CREATE INDEX "Employee_name_idx" ON "Employee"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_modelCode_key" ON "Product"("modelCode");

-- CreateIndex
CREATE INDEX "Product_category_status_idx" ON "Product"("category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSku_skuCode_key" ON "ProductSku"("skuCode");

-- CreateIndex
CREATE INDEX "ProductSku_productId_active_idx" ON "ProductSku"("productId", "active");

-- CreateIndex
CREATE INDEX "PlatformAccount_region_state_idx" ON "PlatformAccount"("region", "state");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAccount_integrationId_externalAccountId_key" ON "PlatformAccount"("integrationId", "externalAccountId");

-- CreateIndex
CREATE INDEX "Store_region_state_idx" ON "Store"("region", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Store_platformAccountId_externalStoreId_key" ON "Store"("platformAccountId", "externalStoreId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_sourceKey_key" ON "Asset"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_assetNo_key" ON "Asset"("assetNo");

-- CreateIndex
CREATE INDEX "Asset_sha256_idx" ON "Asset"("sha256");

-- CreateIndex
CREATE INDEX "Asset_model_status_idx" ON "Asset"("model", "status");

-- CreateIndex
CREATE INDEX "Asset_storageProvider_storageSyncedAt_idx" ON "Asset"("storageProvider", "storageSyncedAt");

-- CreateIndex
CREATE INDEX "Asset_kind_level_processingStatus_idx" ON "Asset"("kind", "level", "processingStatus");

-- CreateIndex
CREATE INDEX "Asset_reviewStatus_availabilityStatus_rightsStatus_idx" ON "Asset"("reviewStatus", "availabilityStatus", "rightsStatus");

-- CreateIndex
CREATE INDEX "Asset_createdByEmployeeId_createdAt_idx" ON "Asset"("createdByEmployeeId", "createdAt");

-- CreateIndex
CREATE INDEX "Asset_perceptualHash_idx" ON "Asset"("perceptualHash");

-- CreateIndex
CREATE INDEX "AssetVersion_sha256_idx" ON "AssetVersion"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_assetId_version_key" ON "AssetVersion"("assetId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfileVersion_version_key" ON "BrandProfileVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "FaqEntry_faqNo_key" ON "FaqEntry"("faqNo");

-- CreateIndex
CREATE INDEX "FaqEntry_category_status_frequency_idx" ON "FaqEntry"("category", "status", "frequency");

-- CreateIndex
CREATE INDEX "FaqEntry_productId_market_language_idx" ON "FaqEntry"("productId", "market", "language");

-- CreateIndex
CREATE UNIQUE INDEX "FaqVariant_faqId_question_key" ON "FaqVariant"("faqId", "question");

-- CreateIndex
CREATE INDEX "AssetProduct_productId_confirmed_idx" ON "AssetProduct"("productId", "confirmed");

-- CreateIndex
CREATE INDEX "TagDefinition_namespace_active_sortOrder_idx" ON "TagDefinition"("namespace", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TagDefinition_namespace_code_key" ON "TagDefinition"("namespace", "code");

-- CreateIndex
CREATE INDEX "AssetTag_tagId_confirmed_idx" ON "AssetTag"("tagId", "confirmed");

-- CreateIndex
CREATE INDEX "AssetRelation_childAssetId_type_idx" ON "AssetRelation"("childAssetId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "AssetRelation_parentAssetId_childAssetId_type_key" ON "AssetRelation"("parentAssetId", "childAssetId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "UploadBatch_batchNo_key" ON "UploadBatch"("batchNo");

-- CreateIndex
CREATE INDEX "UploadBatch_status_createdAt_idx" ON "UploadBatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "UploadBatch_uploadedByEmployeeId_createdAt_idx" ON "UploadBatch"("uploadedByEmployeeId", "createdAt");

-- CreateIndex
CREATE INDEX "UploadEvent_uploadBatchId_result_idx" ON "UploadEvent"("uploadBatchId", "result");

-- CreateIndex
CREATE INDEX "UploadEvent_assetId_occurredAt_idx" ON "UploadEvent"("assetId", "occurredAt");

-- CreateIndex
CREATE INDEX "AssetAnalysisJob_status_nextAttemptAt_createdAt_idx" ON "AssetAnalysisJob"("status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetAnalysisJob_assetId_type_modelVersion_key" ON "AssetAnalysisJob"("assetId", "type", "modelVersion");

-- CreateIndex
CREATE INDEX "AssetReviewDecision_assetId_createdAt_idx" ON "AssetReviewDecision"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetUsage_assetId_createdAt_idx" ON "AssetUsage"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetUsage_businessObjectType_businessObjectId_idx" ON "AssetUsage"("businessObjectType", "businessObjectId");

-- CreateIndex
CREATE INDEX "AssetMetricSnapshot_assetId_capturedAt_idx" ON "AssetMetricSnapshot"("assetId", "capturedAt");

-- CreateIndex
CREATE INDEX "AssetMetricSnapshot_externalId_capturedAt_idx" ON "AssetMetricSnapshot"("externalId", "capturedAt");

-- CreateIndex
CREATE INDEX "AssetSegment_assetId_startSeconds_idx" ON "AssetSegment"("assetId", "startSeconds");

-- CreateIndex
CREATE INDEX "AssetSegment_moduleType_status_idx" ON "AssetSegment"("moduleType", "status");

-- CreateIndex
CREATE INDEX "AssetGapSnapshot_snapshotDate_severity_idx" ON "AssetGapSnapshot"("snapshotDate", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "AssetGapSnapshot_snapshotDate_productModel_assetKind_catego_key" ON "AssetGapSnapshot"("snapshotDate", "productModel", "assetKind", "category");

-- CreateIndex
CREATE UNIQUE INDEX "CloudMediaJob_idempotencyKey_key" ON "CloudMediaJob"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CloudMediaJob_callbackToken_key" ON "CloudMediaJob"("callbackToken");

-- CreateIndex
CREATE INDEX "CloudMediaJob_status_nextAttemptAt_createdAt_idx" ON "CloudMediaJob"("status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX "CloudMediaJob_assetId_type_idx" ON "CloudMediaJob"("assetId", "type");

-- CreateIndex
CREATE INDEX "CloudMediaJob_externalVideoId_type_idx" ON "CloudMediaJob"("externalVideoId", "type");

-- CreateIndex
CREATE INDEX "CloudMediaJob_provider_externalJobId_idx" ON "CloudMediaJob"("provider", "externalJobId");

-- CreateIndex
CREATE INDEX "CloudMediaOutput_jobId_outputType_idx" ON "CloudMediaOutput"("jobId", "outputType");

-- CreateIndex
CREATE INDEX "CloudMediaOutput_objectKey_idx" ON "CloudMediaOutput"("objectKey");

-- CreateIndex
CREATE INDEX "AssetScoreSnapshot_assetId_createdAt_idx" ON "AssetScoreSnapshot"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetScoreSnapshot_externalVideoId_createdAt_idx" ON "AssetScoreSnapshot"("externalVideoId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetScoreSnapshot_kind_score_createdAt_idx" ON "AssetScoreSnapshot"("kind", "score", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalVideo_platform_status_discoveredAt_idx" ON "ExternalVideo"("platform", "status", "discoveredAt");

-- CreateIndex
CREATE INDEX "ExternalVideo_publishedAt_idx" ON "ExternalVideo"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalVideo_platform_externalContentId_key" ON "ExternalVideo"("platform", "externalContentId");

-- CreateIndex
CREATE INDEX "ExternalMetricSnapshot_capturedAt_idx" ON "ExternalMetricSnapshot"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalMetricSnapshot_externalVideoId_capturedAt_key" ON "ExternalMetricSnapshot"("externalVideoId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RemakeTask_taskNo_key" ON "RemakeTask"("taskNo");

-- CreateIndex
CREATE INDEX "RemakeTask_status_score_createdAt_idx" ON "RemakeTask"("status", "score", "createdAt");

-- CreateIndex
CREATE INDEX "RemakeTask_ownerEmployeeId_status_idx" ON "RemakeTask"("ownerEmployeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_commercialName_key" ON "ProductMapping"("commercialName");

-- CreateIndex
CREATE UNIQUE INDEX "PhraseRule_category_blockedText_key" ON "PhraseRule"("category", "blockedText");

-- CreateIndex
CREATE INDEX "KnowledgeEntry_type_status_audience_idx" ON "KnowledgeEntry"("type", "status", "audience");

-- CreateIndex
CREATE INDEX "ContentPlan_planDate_kind_idx" ON "ContentPlan"("planDate", "kind");

-- CreateIndex
CREATE INDEX "ContentPlan_status_idx" ON "ContentPlan"("status");

-- CreateIndex
CREATE INDEX "ContentVariant_targetAccountId_idx" ON "ContentVariant"("targetAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVariant_contentPlanId_platform_key" ON "ContentVariant"("contentPlanId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "PublishJob_idempotencyKey_key" ON "PublishJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PublishJob_status_nextAttemptAt_idx" ON "PublishJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MetricSnapshot_remoteId_capturedAt_idx" ON "MetricSnapshot"("remoteId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MetricSnapshot_integrationId_remoteId_capturedAt_key" ON "MetricSnapshot"("integrationId", "remoteId", "capturedAt");

-- CreateIndex
CREATE INDEX "CommentRecord_status_requiresHuman_idx" ON "CommentRecord"("status", "requiresHuman");

-- CreateIndex
CREATE UNIQUE INDEX "CommentRecord_integrationId_remoteCommentId_key" ON "CommentRecord"("integrationId", "remoteCommentId");

-- CreateIndex
CREATE UNIQUE INDEX "ReplyJob_idempotencyKey_key" ON "ReplyJob"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LiveSession_integrationId_remoteRoomId_key" ON "LiveSession"("integrationId", "remoteRoomId");

-- CreateIndex
CREATE INDEX "ShopWorkItem_overdue_status_idx" ON "ShopWorkItem"("overdue", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ShopWorkItem_integrationId_remoteId_type_key" ON "ShopWorkItem"("integrationId", "remoteId", "type");

-- CreateIndex
CREATE INDEX "ImportBatch_status_createdAt_idx" ON "ImportBatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ImportBatch_integrationId_kind_idx" ON "ImportBatch"("integrationId", "kind");

-- CreateIndex
CREATE INDEX "BusinessSnapshot_type_occurredAt_idx" ON "BusinessSnapshot"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "BusinessSnapshot_status_dueAt_idx" ON "BusinessSnapshot"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSnapshot_integrationId_type_sourceId_sourceVersion_key" ON "BusinessSnapshot"("integrationId", "type", "sourceId", "sourceVersion");

-- CreateIndex
CREATE UNIQUE INDEX "AttributionTouch_externalEventId_key" ON "AttributionTouch"("externalEventId");

-- CreateIndex
CREATE INDEX "AttributionTouch_attributionCode_occurredAt_idx" ON "AttributionTouch"("attributionCode", "occurredAt");

-- CreateIndex
CREATE INDEX "AttributionTouch_contentPlanId_eventType_idx" ON "AttributionTouch"("contentPlanId", "eventType");

-- CreateIndex
CREATE INDEX "DataSourceHealth_integrationId_checkedAt_idx" ON "DataSourceHealth"("integrationId", "checkedAt");

-- CreateIndex
CREATE INDEX "DataSourceHealth_state_checkedAt_idx" ON "DataSourceHealth"("state", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Competitor_platform_name_key" ON "Competitor"("platform", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorSnapshot_competitorId_capturedAt_key" ON "CompetitorSnapshot"("competitorId", "capturedAt");

-- CreateIndex
CREATE INDEX "TrendSignal_keyword_capturedAt_idx" ON "TrendSignal"("keyword", "capturedAt");

-- CreateIndex
CREATE INDEX "Alert_status_level_idx" ON "Alert"("status", "level");

-- CreateIndex
CREATE INDEX "OpsTask_status_dueAt_idx" ON "OpsTask"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationJob_idempotencyKey_key" ON "AutomationJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AutomationJob_status_scheduledAt_nextAttemptAt_idx" ON "AutomationJob"("status", "scheduledAt", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "SopVersion_kind_version_key" ON "SopVersion"("kind", "version");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSku" ADD CONSTRAINT "ProductSku_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAccount" ADD CONSTRAINT "PlatformAccount_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAccount" ADD CONSTRAINT "PlatformAccount_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_createdByEmployeeId_fkey" FOREIGN KEY ("createdByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVersion" ADD CONSTRAINT "AssetVersion_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVersion" ADD CONSTRAINT "AssetVersion_createdByEmployeeId_fkey" FOREIGN KEY ("createdByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaqEntry" ADD CONSTRAINT "FaqEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaqVariant" ADD CONSTRAINT "FaqVariant_faqId_fkey" FOREIGN KEY ("faqId") REFERENCES "FaqEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetProduct" ADD CONSTRAINT "AssetProduct_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetProduct" ADD CONSTRAINT "AssetProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetTag" ADD CONSTRAINT "AssetTag_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetTag" ADD CONSTRAINT "AssetTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "TagDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRelation" ADD CONSTRAINT "AssetRelation_parentAssetId_fkey" FOREIGN KEY ("parentAssetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRelation" ADD CONSTRAINT "AssetRelation_childAssetId_fkey" FOREIGN KEY ("childAssetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadBatch" ADD CONSTRAINT "UploadBatch_uploadedByEmployeeId_fkey" FOREIGN KEY ("uploadedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadEvent" ADD CONSTRAINT "UploadEvent_uploadBatchId_fkey" FOREIGN KEY ("uploadBatchId") REFERENCES "UploadBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadEvent" ADD CONSTRAINT "UploadEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadEvent" ADD CONSTRAINT "UploadEvent_uploadedByEmployeeId_fkey" FOREIGN KEY ("uploadedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAnalysisJob" ADD CONSTRAINT "AssetAnalysisJob_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetReviewDecision" ADD CONSTRAINT "AssetReviewDecision_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetReviewDecision" ADD CONSTRAINT "AssetReviewDecision_reviewerEmployeeId_fkey" FOREIGN KEY ("reviewerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetUsage" ADD CONSTRAINT "AssetUsage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetUsage" ADD CONSTRAINT "AssetUsage_usedByEmployeeId_fkey" FOREIGN KEY ("usedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMetricSnapshot" ADD CONSTRAINT "AssetMetricSnapshot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMetricSnapshot" ADD CONSTRAINT "AssetMetricSnapshot_usageId_fkey" FOREIGN KEY ("usageId") REFERENCES "AssetUsage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetSegment" ADD CONSTRAINT "AssetSegment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudMediaJob" ADD CONSTRAINT "CloudMediaJob_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudMediaJob" ADD CONSTRAINT "CloudMediaJob_externalVideoId_fkey" FOREIGN KEY ("externalVideoId") REFERENCES "ExternalVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudMediaOutput" ADD CONSTRAINT "CloudMediaOutput_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CloudMediaJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetScoreSnapshot" ADD CONSTRAINT "AssetScoreSnapshot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetScoreSnapshot" ADD CONSTRAINT "AssetScoreSnapshot_externalVideoId_fkey" FOREIGN KEY ("externalVideoId") REFERENCES "ExternalVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalMetricSnapshot" ADD CONSTRAINT "ExternalMetricSnapshot_externalVideoId_fkey" FOREIGN KEY ("externalVideoId") REFERENCES "ExternalVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemakeTask" ADD CONSTRAINT "RemakeTask_externalVideoId_fkey" FOREIGN KEY ("externalVideoId") REFERENCES "ExternalVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemakeTask" ADD CONSTRAINT "RemakeTask_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemakeTask" ADD CONSTRAINT "RemakeTask_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlan" ADD CONSTRAINT "ContentPlan_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVariant" ADD CONSTRAINT "ContentVariant_contentPlanId_fkey" FOREIGN KEY ("contentPlanId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVariant" ADD CONSTRAINT "ContentVariant_targetAccountId_fkey" FOREIGN KEY ("targetAccountId") REFERENCES "PlatformAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAsset" ADD CONSTRAINT "ContentAsset_contentPlanId_fkey" FOREIGN KEY ("contentPlanId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAsset" ADD CONSTRAINT "ContentAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_contentPlanId_fkey" FOREIGN KEY ("contentPlanId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_contentPlanId_fkey" FOREIGN KEY ("contentPlanId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ContentVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_operatorEmployeeId_fkey" FOREIGN KEY ("operatorEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_publishJobId_fkey" FOREIGN KEY ("publishJobId") REFERENCES "PublishJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentRecord" ADD CONSTRAINT "CommentRecord_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyJob" ADD CONSTRAINT "ReplyJob_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "CommentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopWorkItem" ADD CONSTRAINT "ShopWorkItem_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_importedByEmployeeId_fkey" FOREIGN KEY ("importedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSnapshot" ADD CONSTRAINT "BusinessSnapshot_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSnapshot" ADD CONSTRAINT "BusinessSnapshot_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSnapshot" ADD CONSTRAINT "BusinessSnapshot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSnapshot" ADD CONSTRAINT "BusinessSnapshot_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSnapshot" ADD CONSTRAINT "BusinessSnapshot_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionTouch" ADD CONSTRAINT "AttributionTouch_contentPlanId_fkey" FOREIGN KEY ("contentPlanId") REFERENCES "ContentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionTouch" ADD CONSTRAINT "AttributionTouch_publishJobId_fkey" FOREIGN KEY ("publishJobId") REFERENCES "PublishJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionTouch" ADD CONSTRAINT "AttributionTouch_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionTouch" ADD CONSTRAINT "AttributionTouch_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionTouch" ADD CONSTRAINT "AttributionTouch_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSourceHealth" ADD CONSTRAINT "DataSourceHealth_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSourceHealth" ADD CONSTRAINT "DataSourceHealth_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorSnapshot" ADD CONSTRAINT "CompetitorSnapshot_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
