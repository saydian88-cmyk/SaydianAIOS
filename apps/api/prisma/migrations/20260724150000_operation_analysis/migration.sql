ALTER TABLE "OpsTask"
  ADD COLUMN "taskNo" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "assigneeEmployeeId" TEXT,
  ADD COLUMN "collaborators" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "findingId" TEXT,
  ADD COLUMN "platform" TEXT,
  ADD COLUMN "storeKey" TEXT,
  ADD COLUMN "storeName" TEXT,
  ADD COLUMN "productId" TEXT,
  ADD COLUMN "skuCode" TEXT,
  ADD COLUMN "metricKey" TEXT,
  ADD COLUMN "currentValue" DOUBLE PRECISION,
  ADD COLUMN "targetValue" DOUBLE PRECISION,
  ADD COLUMN "expectedResult" TEXT,
  ADD COLUMN "evidence" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "verification" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifier" TEXT,
  ADD COLUMN "reviewAt" TIMESTAMP(3),
  ADD COLUMN "reopenedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "OpsTask_taskNo_key" ON "OpsTask"("taskNo");
CREATE UNIQUE INDEX "OpsTask_findingId_key" ON "OpsTask"("findingId");
CREATE INDEX "OpsTask_platform_storeKey_productId_idx" ON "OpsTask"("platform", "storeKey", "productId");
CREATE INDEX "OpsTask_findingId_status_idx" ON "OpsTask"("findingId", "status");

CREATE TABLE "OperationAnalysisRun" (
  "id" TEXT NOT NULL,
  "runNo" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "source" TEXT NOT NULL,
  "sourceName" TEXT NOT NULL,
  "fileHash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "dataFreshness" TEXT NOT NULL DEFAULT 'CURRENT',
  "importedCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "completeness" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "ruleVersion" TEXT NOT NULL DEFAULT 'operation-rules-v1',
  "modelVersion" TEXT NOT NULL DEFAULT 'rule-engine-v1',
  "errors" JSONB NOT NULL DEFAULT '[]',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "OperationAnalysisRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreMetricSnapshot" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "storeKey" TEXT NOT NULL,
  "storeName" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "salesAmount" DOUBLE PRECISION,
  "salesOrders" INTEGER,
  "salesItems" INTEGER,
  "netSalesAmount" DOUBLE PRECISION,
  "netOrders" INTEGER,
  "netItems" INTEGER,
  "discountAmount" DOUBLE PRECISION,
  "productCost" DOUBLE PRECISION,
  "freightCost" DOUBLE PRECISION,
  "refundCost" DOUBLE PRECISION,
  "adSpend" DOUBLE PRECISION,
  "platformFees" DOUBLE PRECISION,
  "taxCost" DOUBLE PRECISION,
  "refundRate" DOUBLE PRECISION,
  "discountRate" DOUBLE PRECISION,
  "basicContribution" DOUBLE PRECISION,
  "fullContribution" DOUBLE PRECISION,
  "averageOrderValue" DOUBLE PRECISION,
  "salesChangeRate" DOUBLE PRECISION,
  "inventoryCoverDays" DOUBLE PRECISION,
  "dataCompleteness" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "sourceRef" TEXT NOT NULL,
  "unavailableFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "raw" JSONB NOT NULL DEFAULT '{}',
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoreMetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductMetricSnapshot" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "storeKey" TEXT NOT NULL,
  "storeName" TEXT NOT NULL,
  "productId" TEXT,
  "modelCode" TEXT,
  "skuCode" TEXT NOT NULL,
  "platformProductId" TEXT,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "salesAmount" DOUBLE PRECISION,
  "salesOrders" INTEGER,
  "salesItems" INTEGER,
  "netSalesAmount" DOUBLE PRECISION,
  "refundCost" DOUBLE PRECISION,
  "productCost" DOUBLE PRECISION,
  "freightCost" DOUBLE PRECISION,
  "adSpend" DOUBLE PRECISION,
  "platformFees" DOUBLE PRECISION,
  "taxCost" DOUBLE PRECISION,
  "refundRate" DOUBLE PRECISION,
  "basicContribution" DOUBLE PRECISION,
  "fullContribution" DOUBLE PRECISION,
  "inventoryQuantity" DOUBLE PRECISION,
  "inventoryCoverDays" DOUBLE PRECISION,
  "dataCompleteness" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "sourceRef" TEXT NOT NULL,
  "unavailableFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "raw" JSONB NOT NULL DEFAULT '{}',
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductMetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompetitorProductSnapshot" (
  "id" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "competitorName" TEXT NOT NULL,
  "shopName" TEXT,
  "productKey" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "productUrl" TEXT,
  "imageUrl" TEXT,
  "price" DOUBLE PRECISION,
  "promotion" TEXT,
  "visibleSales" DOUBLE PRECISION,
  "reviewCount" INTEGER,
  "rating" DOUBLE PRECISION,
  "titleKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sellingPoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "contentFrequency" INTEGER,
  "liveFrequency" INTEGER,
  "changes" JSONB NOT NULL DEFAULT '[]',
  "missingFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sourceRef" TEXT,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "raw" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "CompetitorProductSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationFinding" (
  "id" TEXT NOT NULL,
  "findingNo" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "platform" TEXT,
  "storeKey" TEXT,
  "storeName" TEXT,
  "productId" TEXT,
  "skuCode" TEXT,
  "severity" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "metricKey" TEXT,
  "currentValue" DOUBLE PRECISION,
  "baselineValue" DOUBLE PRECISION,
  "ruleVersion" TEXT NOT NULL DEFAULT 'operation-rules-v1',
  "modelVersion" TEXT NOT NULL DEFAULT 'rule-engine-v1',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "sourceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "missingFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "suggestion" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  "taskId" TEXT,
  "firstFoundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastFoundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  "confirmedBy" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationFinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationTaskHistory" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "note" TEXT,
  "data" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationTaskHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationAnalysisRun_runNo_key" ON "OperationAnalysisRun"("runNo");
CREATE UNIQUE INDEX "OperationAnalysisRun_fileHash_key" ON "OperationAnalysisRun"("fileHash");
CREATE INDEX "OperationAnalysisRun_periodEnd_status_idx" ON "OperationAnalysisRun"("periodEnd", "status");
CREATE UNIQUE INDEX "StoreMetricSnapshot_runId_platform_storeKey_key" ON "StoreMetricSnapshot"("runId", "platform", "storeKey");
CREATE INDEX "StoreMetricSnapshot_platform_storeKey_periodEnd_idx" ON "StoreMetricSnapshot"("platform", "storeKey", "periodEnd");
CREATE UNIQUE INDEX "ProductMetricSnapshot_runId_platform_storeKey_skuCode_key" ON "ProductMetricSnapshot"("runId", "platform", "storeKey", "skuCode");
CREATE INDEX "ProductMetricSnapshot_modelCode_skuCode_periodEnd_idx" ON "ProductMetricSnapshot"("modelCode", "skuCode", "periodEnd");
CREATE UNIQUE INDEX "CompetitorProductSnapshot_platform_productKey_capturedAt_key" ON "CompetitorProductSnapshot"("platform", "productKey", "capturedAt");
CREATE INDEX "CompetitorProductSnapshot_platform_competitorName_capturedAt_idx" ON "CompetitorProductSnapshot"("platform", "competitorName", "capturedAt");
CREATE UNIQUE INDEX "OperationFinding_findingNo_key" ON "OperationFinding"("findingNo");
CREATE INDEX "OperationFinding_status_severity_lastFoundAt_idx" ON "OperationFinding"("status", "severity", "lastFoundAt");
CREATE INDEX "OperationFinding_dedupeKey_status_idx" ON "OperationFinding"("dedupeKey", "status");
CREATE INDEX "OperationTaskHistory_taskId_createdAt_idx" ON "OperationTaskHistory"("taskId", "createdAt");

ALTER TABLE "StoreMetricSnapshot" ADD CONSTRAINT "StoreMetricSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "OperationAnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductMetricSnapshot" ADD CONSTRAINT "ProductMetricSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "OperationAnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationTaskHistory" ADD CONSTRAINT "OperationTaskHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OpsTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
