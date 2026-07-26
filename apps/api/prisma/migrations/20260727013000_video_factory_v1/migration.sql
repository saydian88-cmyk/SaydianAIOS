CREATE TABLE "VideoModelProvider" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "state" "IntegrationState" NOT NULL DEFAULT 'UNCONFIGURED',
    "region" TEXT NOT NULL DEFAULT 'GLOBAL',
    "baseUrl" TEXT,
    "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "publicConfig" JSONB NOT NULL DEFAULT '{}',
    "secretRef" TEXT,
    "maxConcurrency" INTEGER NOT NULL DEFAULT 2,
    "dailyBudget" DOUBLE PRECISION,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT NOT NULL DEFAULT '未配置',
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VideoModelProvider_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VideoModelConfig" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "supportedRatios" TEXT[] NOT NULL DEFAULT ARRAY['9:16']::TEXT[],
    "supportedDurations" INTEGER[] NOT NULL DEFAULT ARRAY[5, 10]::INTEGER[],
    "supportedResolutions" TEXT[] NOT NULL DEFAULT ARRAY['480P']::TEXT[],
    "scenarioTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "costConfig" JSONB NOT NULL DEFAULT '{}',
    "modelConfig" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VideoModelConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VideoRoutingPolicy" (
    "id" TEXT NOT NULL,
    "policyKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT,
    "scenario" TEXT,
    "productModel" TEXT,
    "primaryModelId" TEXT,
    "fallbackModelIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "rules" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VideoRoutingPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VideoShot" (
    "id" TEXT NOT NULL,
    "contentPlanId" TEXT NOT NULL,
    "requirementKey" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "moduleType" TEXT NOT NULL DEFAULT 'SCENE',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "sourcePreference" TEXT NOT NULL DEFAULT 'AUTO',
    "durationSeconds" INTEGER NOT NULL DEFAULT 5,
    "prompt" TEXT,
    "voiceover" TEXT,
    "subtitle" TEXT,
    "assetIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "selectedAssetId" TEXT,
    "requestedModelId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VideoShot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VideoGenerationJob" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "contentPlanId" TEXT NOT NULL,
    "shotId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "routingMode" TEXT NOT NULL DEFAULT 'AUTO',
    "requestedModelId" TEXT,
    "resolvedModelId" TEXT,
    "allowFallback" BOOLEAN NOT NULL DEFAULT true,
    "prompt" TEXT NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "outputAssetId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "estimatedCost" DOUBLE PRECISION,
    "actualCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VideoGenerationJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VideoGenerationAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "externalJobId" TEXT,
    "request" JSONB NOT NULL DEFAULT '{}',
    "response" JSONB NOT NULL DEFAULT '{}',
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VideoGenerationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VideoRenderJob" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "contentPlanId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "renderer" TEXT NOT NULL DEFAULT 'HYPERFRAMES_FFMPEG',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "outputAssetId" TEXT,
    "outputPath" TEXT,
    "estimatedCost" DOUBLE PRECISION,
    "actualCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VideoRenderJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VideoQualityCheck" (
    "id" TEXT NOT NULL,
    "contentPlanId" TEXT NOT NULL,
    "assetId" TEXT,
    "generationJobId" TEXT,
    "renderJobId" TEXT,
    "checkType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "score" INTEGER NOT NULL DEFAULT 0,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VideoQualityCheck_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VideoModelProvider_code_key" ON "VideoModelProvider"("code");
CREATE INDEX "VideoModelProvider_enabled_state_priority_idx" ON "VideoModelProvider"("enabled", "state", "priority");
CREATE UNIQUE INDEX "VideoModelConfig_providerId_code_key" ON "VideoModelConfig"("providerId", "code");
CREATE INDEX "VideoModelConfig_enabled_priority_idx" ON "VideoModelConfig"("enabled", "priority");
CREATE UNIQUE INDEX "VideoRoutingPolicy_policyKey_key" ON "VideoRoutingPolicy"("policyKey");
CREATE INDEX "VideoRoutingPolicy_active_platform_scenario_priority_idx" ON "VideoRoutingPolicy"("active", "platform", "scenario", "priority");
CREATE UNIQUE INDEX "VideoShot_contentPlanId_requirementKey_key" ON "VideoShot"("contentPlanId", "requirementKey");
CREATE INDEX "VideoShot_contentPlanId_sequence_idx" ON "VideoShot"("contentPlanId", "sequence");
CREATE INDEX "VideoShot_status_idx" ON "VideoShot"("status");
CREATE UNIQUE INDEX "VideoGenerationJob_idempotencyKey_key" ON "VideoGenerationJob"("idempotencyKey");
CREATE INDEX "VideoGenerationJob_status_nextAttemptAt_createdAt_idx" ON "VideoGenerationJob"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "VideoGenerationJob_contentPlanId_createdAt_idx" ON "VideoGenerationJob"("contentPlanId", "createdAt");
CREATE INDEX "VideoGenerationJob_shotId_createdAt_idx" ON "VideoGenerationJob"("shotId", "createdAt");
CREATE UNIQUE INDEX "VideoGenerationAttempt_jobId_attemptNo_key" ON "VideoGenerationAttempt"("jobId", "attemptNo");
CREATE INDEX "VideoGenerationAttempt_providerId_status_idx" ON "VideoGenerationAttempt"("providerId", "status");
CREATE INDEX "VideoGenerationAttempt_externalJobId_idx" ON "VideoGenerationAttempt"("externalJobId");
CREATE UNIQUE INDEX "VideoRenderJob_idempotencyKey_key" ON "VideoRenderJob"("idempotencyKey");
CREATE INDEX "VideoRenderJob_status_createdAt_idx" ON "VideoRenderJob"("status", "createdAt");
CREATE INDEX "VideoRenderJob_contentPlanId_createdAt_idx" ON "VideoRenderJob"("contentPlanId", "createdAt");
CREATE INDEX "VideoQualityCheck_contentPlanId_status_idx" ON "VideoQualityCheck"("contentPlanId", "status");
CREATE INDEX "VideoQualityCheck_assetId_idx" ON "VideoQualityCheck"("assetId");

ALTER TABLE "VideoModelConfig" ADD CONSTRAINT "VideoModelConfig_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "VideoModelProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoRoutingPolicy" ADD CONSTRAINT "VideoRoutingPolicy_primaryModelId_fkey" FOREIGN KEY ("primaryModelId") REFERENCES "VideoModelConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoShot" ADD CONSTRAINT "VideoShot_contentPlanId_fkey" FOREIGN KEY ("contentPlanId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoShot" ADD CONSTRAINT "VideoShot_selectedAssetId_fkey" FOREIGN KEY ("selectedAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoShot" ADD CONSTRAINT "VideoShot_requestedModelId_fkey" FOREIGN KEY ("requestedModelId") REFERENCES "VideoModelConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoGenerationJob" ADD CONSTRAINT "VideoGenerationJob_contentPlanId_fkey" FOREIGN KEY ("contentPlanId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoGenerationJob" ADD CONSTRAINT "VideoGenerationJob_shotId_fkey" FOREIGN KEY ("shotId") REFERENCES "VideoShot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoGenerationJob" ADD CONSTRAINT "VideoGenerationJob_requestedModelId_fkey" FOREIGN KEY ("requestedModelId") REFERENCES "VideoModelConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoGenerationJob" ADD CONSTRAINT "VideoGenerationJob_resolvedModelId_fkey" FOREIGN KEY ("resolvedModelId") REFERENCES "VideoModelConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoGenerationJob" ADD CONSTRAINT "VideoGenerationJob_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoGenerationAttempt" ADD CONSTRAINT "VideoGenerationAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "VideoGenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoGenerationAttempt" ADD CONSTRAINT "VideoGenerationAttempt_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "VideoModelProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VideoGenerationAttempt" ADD CONSTRAINT "VideoGenerationAttempt_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "VideoModelConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VideoRenderJob" ADD CONSTRAINT "VideoRenderJob_contentPlanId_fkey" FOREIGN KEY ("contentPlanId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoRenderJob" ADD CONSTRAINT "VideoRenderJob_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoQualityCheck" ADD CONSTRAINT "VideoQualityCheck_contentPlanId_fkey" FOREIGN KEY ("contentPlanId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoQualityCheck" ADD CONSTRAINT "VideoQualityCheck_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoQualityCheck" ADD CONSTRAINT "VideoQualityCheck_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "VideoGenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoQualityCheck" ADD CONSTRAINT "VideoQualityCheck_renderJobId_fkey" FOREIGN KEY ("renderJobId") REFERENCES "VideoRenderJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
