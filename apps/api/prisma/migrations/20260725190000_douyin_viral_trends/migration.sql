ALTER TABLE "ExternalVideo" ADD COLUMN "authorId" TEXT;

ALTER TABLE "ExternalMetricSnapshot"
  ADD COLUMN "authorFollowerDelta" INTEGER,
  ADD COLUMN "ageHours" DOUBLE PRECISION,
  ADD COLUMN "playVelocity" DOUBLE PRECISION,
  ADD COLUMN "engagementRate" DOUBLE PRECISION,
  ADD COLUMN "saveShareRate" DOUBLE PRECISION,
  ADD COLUMN "velocityScore" DOUBLE PRECISION,
  ADD COLUMN "engagementScore" DOUBLE PRECISION,
  ADD COLUMN "saveShareScore" DOUBLE PRECISION,
  ADD COLUMN "accountQualityScore" DOUBLE PRECISION,
  ADD COLUMN "viralIndex" DOUBLE PRECISION,
  ADD COLUMN "viralGrade" TEXT,
  ADD COLUMN "formulaVersion" TEXT;

CREATE TABLE "ViralAuthor" (
  "id" TEXT NOT NULL,
  "platform" "IntegrationKind" NOT NULL,
  "externalAuthorId" TEXT NOT NULL,
  "nickname" TEXT NOT NULL,
  "profileUrl" TEXT,
  "avatarUrl" TEXT,
  "latestFollowers" INTEGER,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ViralAuthor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ViralAuthorMetricSnapshot" (
  "id" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "followers" INTEGER,
  "followerDelta" INTEGER,
  "raw" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "ViralAuthorMetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ViralKeywordPlan" (
  "id" TEXT NOT NULL,
  "platform" "IntegrationKind" NOT NULL,
  "planDate" TIMESTAMP(3) NOT NULL,
  "model" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "generation" TEXT NOT NULL DEFAULT 'AI',
  "context" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ViralKeywordPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ViralKeyword" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "productId" TEXT,
  "keyword" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "priority" TEXT NOT NULL,
  "reason" TEXT,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "hitCount" INTEGER NOT NULL DEFAULT 0,
  "lastCollectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ViralKeyword_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ViralVideoKeywordHit" (
  "externalVideoId" TEXT NOT NULL,
  "keywordId" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "hitCount" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "ViralVideoKeywordHit_pkey" PRIMARY KEY ("externalVideoId", "keywordId")
);

CREATE TABLE "ViralCollectorDevice" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "platform" "IntegrationKind" NOT NULL DEFAULT 'DOUYIN',
  "state" TEXT NOT NULL DEFAULT 'OFFLINE',
  "chromeLoginState" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "agentVersion" TEXT,
  "lastHeartbeatAt" TIMESTAMP(3),
  "lastCollectionAt" TIMESTAMP(3),
  "lastSyncAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ViralCollectorDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ViralCollectionBatch" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "deviceId" TEXT,
  "platform" "IntegrationKind" NOT NULL,
  "keyword" TEXT,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "importedCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "raw" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ViralCollectionBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ViralAuthor_platform_externalAuthorId_key" ON "ViralAuthor"("platform", "externalAuthorId");
CREATE INDEX "ViralAuthor_platform_lastSeenAt_idx" ON "ViralAuthor"("platform", "lastSeenAt");
CREATE UNIQUE INDEX "ViralAuthorMetricSnapshot_authorId_capturedAt_key" ON "ViralAuthorMetricSnapshot"("authorId", "capturedAt");
CREATE INDEX "ViralAuthorMetricSnapshot_capturedAt_idx" ON "ViralAuthorMetricSnapshot"("capturedAt");
CREATE UNIQUE INDEX "ViralKeywordPlan_platform_planDate_key" ON "ViralKeywordPlan"("platform", "planDate");
CREATE INDEX "ViralKeywordPlan_platform_status_planDate_idx" ON "ViralKeywordPlan"("platform", "status", "planDate");
CREATE UNIQUE INDEX "ViralKeyword_planId_keyword_key" ON "ViralKeyword"("planId", "keyword");
CREATE INDEX "ViralKeyword_planId_priority_type_idx" ON "ViralKeyword"("planId", "priority", "type");
CREATE INDEX "ViralKeyword_productId_idx" ON "ViralKeyword"("productId");
CREATE INDEX "ViralVideoKeywordHit_keywordId_lastSeenAt_idx" ON "ViralVideoKeywordHit"("keywordId", "lastSeenAt");
CREATE INDEX "ViralCollectorDevice_platform_lastHeartbeatAt_idx" ON "ViralCollectorDevice"("platform", "lastHeartbeatAt");
CREATE UNIQUE INDEX "ViralCollectionBatch_batchId_key" ON "ViralCollectionBatch"("batchId");
CREATE INDEX "ViralCollectionBatch_platform_startedAt_idx" ON "ViralCollectionBatch"("platform", "startedAt");
CREATE INDEX "ViralCollectionBatch_deviceId_startedAt_idx" ON "ViralCollectionBatch"("deviceId", "startedAt");
CREATE INDEX "ExternalVideo_authorId_publishedAt_idx" ON "ExternalVideo"("authorId", "publishedAt");
CREATE INDEX "ExternalMetricSnapshot_viralGrade_viralIndex_capturedAt_idx" ON "ExternalMetricSnapshot"("viralGrade", "viralIndex", "capturedAt");

ALTER TABLE "ExternalVideo"
  ADD CONSTRAINT "ExternalVideo_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "ViralAuthor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ViralAuthorMetricSnapshot"
  ADD CONSTRAINT "ViralAuthorMetricSnapshot_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "ViralAuthor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ViralKeyword"
  ADD CONSTRAINT "ViralKeyword_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "ViralKeywordPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ViralKeyword"
  ADD CONSTRAINT "ViralKeyword_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ViralVideoKeywordHit"
  ADD CONSTRAINT "ViralVideoKeywordHit_externalVideoId_fkey"
  FOREIGN KEY ("externalVideoId") REFERENCES "ExternalVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ViralVideoKeywordHit"
  ADD CONSTRAINT "ViralVideoKeywordHit_keywordId_fkey"
  FOREIGN KEY ("keywordId") REFERENCES "ViralKeyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ViralCollectionBatch"
  ADD CONSTRAINT "ViralCollectionBatch_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "ViralCollectorDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
