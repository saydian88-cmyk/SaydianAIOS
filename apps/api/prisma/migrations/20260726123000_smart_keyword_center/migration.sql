ALTER TABLE "ViralKeyword"
  ADD COLUMN "smartKeywordId" TEXT,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "SmartKeywordCluster" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "canonicalKey" TEXT NOT NULL,
  "description" TEXT,
  "audienceTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "painTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "valueTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sceneTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "hookTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartKeywordCluster_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartKeyword" (
  "id" TEXT NOT NULL,
  "platform" "IntegrationKind" NOT NULL,
  "productId" TEXT,
  "clusterId" TEXT,
  "keyword" TEXT NOT NULL,
  "normalizedKeyword" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'AI',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "priority" TEXT NOT NULL DEFAULT 'C',
  "reason" TEXT,
  "audience" TEXT,
  "pain" TEXT,
  "scene" TEXT,
  "notes" TEXT,
  "collectionEnabled" BOOLEAN NOT NULL DEFAULT true,
  "contentEnabled" BOOLEAN NOT NULL DEFAULT true,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "opportunityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "grade" TEXT NOT NULL DEFAULT 'C',
  "hitCount" INTEGER NOT NULL DEFAULT 0,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastCollectedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL DEFAULT '系统关键词引擎',
  "updatedBy" TEXT NOT NULL DEFAULT '系统关键词引擎',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartKeyword_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartKeywordSnapshot" (
  "id" TEXT NOT NULL,
  "keywordId" TEXT NOT NULL,
  "snapshotDate" TIMESTAMP(3) NOT NULL,
  "relevanceScore" DOUBLE PRECISION NOT NULL,
  "demandScore" DOUBLE PRECISION NOT NULL,
  "trendScore" DOUBLE PRECISION NOT NULL,
  "contentGapScore" DOUBLE PRECISION NOT NULL,
  "commercialIntentScore" DOUBLE PRECISION NOT NULL,
  "shootabilityScore" DOUBLE PRECISION NOT NULL,
  "historyScore" DOUBLE PRECISION NOT NULL,
  "opportunityScore" DOUBLE PRECISION NOT NULL,
  "grade" TEXT NOT NULL,
  "trendStage" TEXT NOT NULL DEFAULT 'STABLE',
  "formulaVersion" TEXT NOT NULL DEFAULT 'smart-keyword-v1.1',
  "metrics" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmartKeywordSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartKeywordSource" (
  "id" TEXT NOT NULL,
  "keywordId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "sourceLabel" TEXT,
  "raw" JSONB NOT NULL DEFAULT '{}',
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmartKeywordSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartKeywordDirection" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "platform" "IntegrationKind" NOT NULL,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3),
  "productIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "productSeries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "audienceTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "painTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sceneTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "competitorTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "objective" TEXT,
  "boostTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "excludeTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "explorationRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
  "priority" TEXT NOT NULL DEFAULT 'B',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartKeywordDirection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartKeywordDirectionVersion" (
  "id" TEXT NOT NULL,
  "directionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "changedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmartKeywordDirectionVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartKeywordContentRelation" (
  "id" TEXT NOT NULL,
  "keywordId" TEXT NOT NULL,
  "contentPlanId" TEXT,
  "usageType" TEXT NOT NULL,
  "position" TEXT,
  "metrics" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartKeywordContentRelation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmartKeywordCluster_canonicalKey_key" ON "SmartKeywordCluster"("canonicalKey");
CREATE INDEX "SmartKeywordCluster_name_idx" ON "SmartKeywordCluster"("name");
CREATE UNIQUE INDEX "SmartKeyword_platform_market_normalizedKeyword_key" ON "SmartKeyword"("platform", "market", "normalizedKeyword");
CREATE INDEX "SmartKeyword_platform_status_grade_opportunityScore_idx" ON "SmartKeyword"("platform", "status", "grade", "opportunityScore");
CREATE INDEX "SmartKeyword_platform_pinned_collectionEnabled_idx" ON "SmartKeyword"("platform", "pinned", "collectionEnabled");
CREATE INDEX "SmartKeyword_clusterId_idx" ON "SmartKeyword"("clusterId");
CREATE INDEX "SmartKeyword_productId_idx" ON "SmartKeyword"("productId");
CREATE UNIQUE INDEX "SmartKeywordSnapshot_keywordId_snapshotDate_key" ON "SmartKeywordSnapshot"("keywordId", "snapshotDate");
CREATE INDEX "SmartKeywordSnapshot_snapshotDate_grade_idx" ON "SmartKeywordSnapshot"("snapshotDate", "grade");
CREATE INDEX "SmartKeywordSource_keywordId_observedAt_idx" ON "SmartKeywordSource"("keywordId", "observedAt");
CREATE INDEX "SmartKeywordSource_sourceType_observedAt_idx" ON "SmartKeywordSource"("sourceType", "observedAt");
CREATE INDEX "SmartKeywordDirection_platform_active_startAt_endAt_idx" ON "SmartKeywordDirection"("platform", "active", "startAt", "endAt");
CREATE UNIQUE INDEX "SmartKeywordDirectionVersion_directionId_version_key" ON "SmartKeywordDirectionVersion"("directionId", "version");
CREATE INDEX "SmartKeywordDirectionVersion_directionId_createdAt_idx" ON "SmartKeywordDirectionVersion"("directionId", "createdAt");
CREATE UNIQUE INDEX "SmartKeywordContentRelation_keywordId_contentPlanId_usageType_key" ON "SmartKeywordContentRelation"("keywordId", "contentPlanId", "usageType");
CREATE INDEX "SmartKeywordContentRelation_contentPlanId_idx" ON "SmartKeywordContentRelation"("contentPlanId");
CREATE INDEX "ViralKeyword_smartKeywordId_idx" ON "ViralKeyword"("smartKeywordId");

ALTER TABLE "SmartKeyword"
  ADD CONSTRAINT "SmartKeyword_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SmartKeyword"
  ADD CONSTRAINT "SmartKeyword_clusterId_fkey"
  FOREIGN KEY ("clusterId") REFERENCES "SmartKeywordCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SmartKeywordSnapshot"
  ADD CONSTRAINT "SmartKeywordSnapshot_keywordId_fkey"
  FOREIGN KEY ("keywordId") REFERENCES "SmartKeyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartKeywordSource"
  ADD CONSTRAINT "SmartKeywordSource_keywordId_fkey"
  FOREIGN KEY ("keywordId") REFERENCES "SmartKeyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartKeywordDirectionVersion"
  ADD CONSTRAINT "SmartKeywordDirectionVersion_directionId_fkey"
  FOREIGN KEY ("directionId") REFERENCES "SmartKeywordDirection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartKeywordContentRelation"
  ADD CONSTRAINT "SmartKeywordContentRelation_keywordId_fkey"
  FOREIGN KEY ("keywordId") REFERENCES "SmartKeyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartKeywordContentRelation"
  ADD CONSTRAINT "SmartKeywordContentRelation_contentPlanId_fkey"
  FOREIGN KEY ("contentPlanId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ViralKeyword"
  ADD CONSTRAINT "ViralKeyword_smartKeywordId_fkey"
  FOREIGN KEY ("smartKeywordId") REFERENCES "SmartKeyword"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "SmartKeyword" (
  "id", "platform", "productId", "keyword", "normalizedKeyword", "language", "market",
  "type", "source", "status", "priority", "reason", "collectionEnabled", "contentEnabled",
  "pinned", "locked", "opportunityScore", "grade", "hitCount", "firstSeenAt",
  "lastSeenAt", "lastCollectedAt", "createdBy", "updatedBy", "createdAt", "updatedAt"
)
SELECT
  CONCAT('sk_', MD5(CONCAT(p."platform"::TEXT, '|', LOWER(TRIM(k."keyword"))))),
  p."platform",
  MAX(k."productId"),
  k."keyword",
  LOWER(TRIM(k."keyword")),
  CASE WHEN p."platform" = 'TIKTOK' THEN 'en' ELSE 'zh-CN' END,
  CASE WHEN p."platform" = 'TIKTOK' THEN 'US' ELSE 'CN' END,
  MAX(k."type"),
  'LEGACY',
  'ACTIVE',
  MIN(k."priority"),
  MAX(k."reason"),
  true,
  true,
  BOOL_OR(k."locked"),
  BOOL_OR(k."locked"),
  LEAST(100, 55 + SUM(k."hitCount") * 2),
  CASE WHEN SUM(k."hitCount") >= 15 THEN 'S' WHEN SUM(k."hitCount") >= 8 THEN 'A' WHEN SUM(k."hitCount") >= 3 THEN 'B' ELSE 'C' END,
  SUM(k."hitCount"),
  MIN(k."createdAt"),
  MAX(k."updatedAt"),
  MAX(k."lastCollectedAt"),
  '历史关键词迁移',
  '历史关键词迁移',
  MIN(k."createdAt"),
  MAX(k."updatedAt")
FROM "ViralKeyword" k
JOIN "ViralKeywordPlan" p ON p."id" = k."planId"
GROUP BY p."platform", k."keyword"
ON CONFLICT ("platform", "market", "normalizedKeyword") DO NOTHING;

UPDATE "ViralKeyword" k
SET "smartKeywordId" = s."id"
FROM "ViralKeywordPlan" p, "SmartKeyword" s
WHERE p."id" = k."planId"
  AND s."platform" = p."platform"
  AND s."normalizedKeyword" = LOWER(TRIM(k."keyword"));
