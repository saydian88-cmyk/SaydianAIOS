import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ContentStatus, IntegrationKind, JobStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AiContentService, type AiVideoCandidate } from "./ai-content.service";
import { opsConfig } from "./config";
import { ContentGuardService } from "./content-guard.service";
import { decryptIntegrationValue, encryptIntegrationValue } from "./integration-secret";
import { OssStorageService } from "./oss-storage.service";
import { PrismaService } from "./prisma.service";
import { localDateKey } from "./utils";
import {
  DEFAULT_VIDEO_POLICY_CONFIG,
  normalizeTopicText,
  VIDEO_OPPORTUNITY_SCORE_MAX,
  VIDEO_RECIPES,
  type VideoExecutionMode,
  type VideoMaterialCoverage,
  type VideoOpportunityScore,
  type VideoRecipeCode,
  type VideoScriptCandidateV3,
  type VideoShotPlanV3,
  type VideoTopicCardPayload,
} from "./video-topic-card";

type JsonRow = Record<string, unknown>;

type ProjectCreateInput = {
  platform?: string;
  voiceoverMode?: string;
  accountType?: string;
  estimatedDurationSeconds?: number;
  contentRestrictionMode?: string;
  productModel?: string;
  topic?: string;
  audience?: string;
  objective?: string;
  keywordIds?: string[];
  externalVideoIds?: string[];
  assetGapTaskId?: string;
  requestedModelId?: string;
  routingMode?: string;
  allowFallback?: boolean;
};

type GenerateInput = {
  candidateIndex?: number;
  requestedModelId?: string;
  routingMode?: string;
  allowFallback?: boolean;
};

type SimilarVideoInput = {
  outputAssetId: string;
  replaceHook?: boolean;
  hook?: string;
  replaceProduct?: boolean;
  productModel?: string;
  replaceFeature?: boolean;
  feature?: string;
};

type TopicCardListInput = {
  status?: string;
  platform?: string;
  productModel?: string;
  sourceType?: string;
  minScore?: number;
  minCoverage?: number;
};

type TopicCardApprovalInput = {
  executionMode: Exclude<VideoExecutionMode, "TOPIC_CARD_BATCH">;
  ownerId: string;
  reviewerId: string;
};

const PROVIDER_SEEDS = [
  {
    code: "BAILIAN_WAN",
    displayName: "阿里百炼 · Wan",
    region: "CN",
    baseUrl: "https://dashscope.aliyuncs.com",
    capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO", "REFERENCE_TO_VIDEO"],
    priority: 10,
  },
  {
    code: "RUNWAY",
    displayName: "Runway",
    region: "GLOBAL",
    baseUrl: "https://api.dev.runwayml.com",
    capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO", "VIDEO_EDIT"],
    priority: 20,
  },
  {
    code: "HEYGEN",
    displayName: "HeyGen",
    region: "GLOBAL",
    baseUrl: "https://api.heygen.com",
    capabilities: ["AVATAR", "TEXT_TO_VIDEO", "NATIVE_AUDIO"],
    priority: 30,
  },
  {
    code: "OPENAI_VIDEOS",
    displayName: "OpenAI Videos",
    region: "GLOBAL",
    baseUrl: "https://api.openai.com/v1",
    capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO", "VIDEO_EDIT"],
    priority: 40,
  },
  {
    code: "GOOGLE_VEO",
    displayName: "Google Veo",
    region: "GLOBAL",
    baseUrl: "https://generativelanguage.googleapis.com",
    capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO", "REFERENCE_TO_VIDEO"],
    priority: 50,
  },
  {
    code: "KLING",
    displayName: "可灵",
    region: "CN",
    baseUrl: "https://api.klingai.com",
    capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO", "VIDEO_EDIT"],
    priority: 60,
  },
  {
    code: "CUSTOM_HTTP",
    displayName: "自定义HTTP模型",
    region: "GLOBAL",
    baseUrl: null,
    capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO"],
    priority: 100,
  },
] as const;

const MODEL_SEEDS = [
  { provider: "BAILIAN_WAN", code: "wan2.5-t2v-preview", name: "Wan 文生视频", capabilities: ["TEXT_TO_VIDEO"], durations: [5, 10], resolutions: ["480P"], tags: ["DOUYIN", "CN"] },
  { provider: "BAILIAN_WAN", code: "wan2.5-i2v-preview", name: "Wan 图生视频", capabilities: ["IMAGE_TO_VIDEO"], durations: [5, 10], resolutions: ["480P"], tags: ["DOUYIN", "PRODUCT", "CN"] },
  { provider: "RUNWAY", code: "gen4_turbo", name: "Runway Gen-4 Turbo", capabilities: ["IMAGE_TO_VIDEO"], durations: [5, 10], resolutions: ["720P"], tags: ["TIKTOK", "UGC", "GLOBAL"] },
  { provider: "RUNWAY", code: "gen4.5", name: "Runway Gen-4.5", capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO"], durations: [5, 10], resolutions: ["720P"], tags: ["TIKTOK", "BRAND", "GLOBAL"] },
  { provider: "HEYGEN", code: "avatar-v3", name: "HeyGen Avatar", capabilities: ["AVATAR", "NATIVE_AUDIO"], durations: [15, 30], resolutions: ["1080P"], tags: ["FAQ", "TUTORIAL", "GLOBAL"] },
  { provider: "OPENAI_VIDEOS", code: "sora-2", name: "OpenAI Sora 2", capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO"], durations: [4, 8, 12], resolutions: ["720P"], tags: ["CREATIVE", "GLOBAL"] },
  { provider: "GOOGLE_VEO", code: "veo-3.1-fast-generate-001", name: "Google Veo 3.1 Fast", capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO"], durations: [8], resolutions: ["720P", "1080P"], tags: ["BRAND", "GLOBAL"] },
  { provider: "KLING", code: "kling-video", name: "可灵视频", capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO"], durations: [5, 10], resolutions: ["720P"], tags: ["CN"] },
] as const;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function object(value: unknown): JsonRow {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRow : {};
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)) as T;
}

function integrationKind(value?: string): IntegrationKind {
  return value === "TIKTOK" ? IntegrationKind.TIKTOK : IntegrationKind.DOUYIN;
}

function conciseVideoTopic(value: string): string {
  const cleaned = value.replace(/^参考结构[：:]\s*/, "").replace(/\s+/g, " ").trim();
  const firstSentence = cleaned.split(/[。！？!?]/)[0]?.trim() || cleaned;
  const firstChunk = firstSentence.split(" ")[0]?.trim() || firstSentence;
  const candidate = Array.from(firstChunk).length >= 8 ? firstChunk : firstSentence;
  return Array.from(candidate).slice(0, 40).join("");
}

function sourceSignals(plan: { sourceSignals: unknown }) {
  return Array.isArray(plan.sourceSignals) ? plan.sourceSignals.map(object) : [];
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: unknown, min: number, max: number) {
  return Math.min(max, Math.max(min, number(value)));
}

function topicCardSignal(plan: { sourceSignals: unknown }) {
  return sourceSignals(plan).find((item) => item.type === "VIDEO_TOPIC_CARD");
}

function recipeCode(value: unknown, fallback: VideoRecipeCode = "PAIN_SOLVE"): VideoRecipeCode {
  const normalized = String(value || "").trim().toUpperCase();
  return VIDEO_RECIPES.some((item) => item.code === normalized)
    ? normalized as VideoRecipeCode
    : fallback;
}

function normalizeOpportunityScore(value: unknown, coveragePercent: number): VideoOpportunityScore {
  const row = object(value);
  const score = {
    relevance: clamp(row.relevance, 0, VIDEO_OPPORTUNITY_SCORE_MAX.relevance),
    demand: clamp(row.demand, 0, VIDEO_OPPORTUNITY_SCORE_MAX.demand),
    trendGrowth: clamp(row.trendGrowth, 0, VIDEO_OPPORTUNITY_SCORE_MAX.trendGrowth),
    contentGap: clamp(row.contentGap, 0, VIDEO_OPPORTUNITY_SCORE_MAX.contentGap),
    commercialIntent: clamp(row.commercialIntent, 0, VIDEO_OPPORTUNITY_SCORE_MAX.commercialIntent),
    brandFit: clamp(row.brandFit, 0, VIDEO_OPPORTUNITY_SCORE_MAX.brandFit),
    assetCoverage: Math.round(clamp(coveragePercent, 0, 100) / 100 * VIDEO_OPPORTUNITY_SCORE_MAX.assetCoverage),
    shootability: clamp(row.shootability, 0, VIDEO_OPPORTUNITY_SCORE_MAX.shootability),
    novelty: clamp(row.novelty, 0, VIDEO_OPPORTUNITY_SCORE_MAX.novelty),
    total: 0,
  };
  score.total = Math.round(Object.entries(score)
    .filter(([key]) => key !== "total")
    .reduce((total, [, points]) => total + points, 0));
  return score;
}

function topicCardPayload(plan: { sourceSignals: unknown }): VideoTopicCardPayload | null {
  const signal = topicCardSignal(plan);
  if (!signal) return null;
  return object(signal.card) as unknown as VideoTopicCardPayload;
}

@Injectable()
export class VideoFactoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiContent: AiContentService,
    private readonly guard: ContentGuardService,
    private readonly oss: OssStorageService,
  ) {}

  async ensureCatalog() {
    for (const seed of PROVIDER_SEEDS) {
      const existing = await this.prisma.videoModelProvider.findUnique({ where: { code: seed.code } });
      const isBailian = seed.code === "BAILIAN_WAN";
      const bailianConfigured = isBailian && Boolean(opsConfig.bailian.apiKey);
      if (!existing) {
        await this.prisma.videoModelProvider.create({
          data: {
            code: seed.code,
            displayName: seed.displayName,
            region: seed.region,
            baseUrl: seed.baseUrl,
            capabilities: [...seed.capabilities],
            priority: seed.priority,
            enabled: bailianConfigured,
            state: bailianConfigured ? "CONFIGURED" : "UNCONFIGURED",
            message: bailianConfigured ? "已从现有百炼配置迁移，待健康检查" : "未配置",
            secretRef: bailianConfigured
              ? encryptIntegrationValue(JSON.stringify({ apiKey: opsConfig.bailian.apiKey }))
              : undefined,
          },
        });
      } else if (bailianConfigured && !existing.secretRef) {
        await this.prisma.videoModelProvider.update({
          where: { id: existing.id },
          data: {
            secretRef: encryptIntegrationValue(JSON.stringify({ apiKey: opsConfig.bailian.apiKey })),
            state: existing.state === "UNCONFIGURED" ? "CONFIGURED" : existing.state,
            enabled: true,
            message: "已从现有百炼配置迁移，待健康检查",
          },
        });
      }
    }

    const providers = await this.prisma.videoModelProvider.findMany();
    const providerByCode = new Map(providers.map((provider) => [provider.code, provider]));
    for (const seed of MODEL_SEEDS) {
      const provider = providerByCode.get(seed.provider);
      if (!provider) continue;
      await this.prisma.videoModelConfig.upsert({
        where: { providerId_code: { providerId: provider.id, code: seed.code } },
        create: {
          providerId: provider.id,
          code: seed.code,
          displayName: seed.name,
          capabilities: [...seed.capabilities],
          supportedDurations: [...seed.durations],
          supportedResolutions: [...seed.resolutions],
          scenarioTags: [...seed.tags],
          enabled: provider.enabled,
          priority: provider.priority,
        },
        update: {
          displayName: seed.name,
          capabilities: [...seed.capabilities],
          supportedDurations: [...seed.durations],
          supportedResolutions: [...seed.resolutions],
          scenarioTags: [...seed.tags],
        },
      });
    }

    const bailianImageModel = await this.prisma.videoModelConfig.findFirst({
      where: { provider: { code: "BAILIAN_WAN" }, code: opsConfig.bailian.imageToVideoModel },
    });
    const runwayModel = await this.prisma.videoModelConfig.findFirst({
      where: { provider: { code: "RUNWAY" }, code: "gen4_turbo" },
    });
    await this.prisma.videoRoutingPolicy.upsert({
      where: { policyKey: "DEFAULT_DOUYIN" },
      create: {
        policyKey: "DEFAULT_DOUYIN",
        name: "抖音默认视频路由",
        platform: "DOUYIN",
        primaryModelId: bailianImageModel?.id,
        fallbackModelIds: runwayModel ? [runwayModel.id] : [],
        rules: { capability: "IMAGE_TO_VIDEO", preferRealAssets: true },
        priority: 10,
      },
      update: {},
    });
    await this.prisma.videoRoutingPolicy.upsert({
      where: { policyKey: "DEFAULT_TIKTOK" },
      create: {
        policyKey: "DEFAULT_TIKTOK",
        name: "TikTok默认视频路由",
        platform: "TIKTOK",
        primaryModelId: runwayModel?.id,
        fallbackModelIds: bailianImageModel ? [bailianImageModel.id] : [],
        rules: { capability: "IMAGE_TO_VIDEO", preferRealAssets: true },
        priority: 10,
      },
      update: {},
    });
  }

  async registerLocalMaster(contentPlanId: string, assetId: string, taskId: string, actor: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException("视频成品不存在");
    const renderJob = await this.prisma.videoRenderJob.upsert({
      where: { idempotencyKey: `video-render:codex-local:${contentPlanId}:${assetId}` },
      create: {
        idempotencyKey: `video-render:codex-local:${contentPlanId}:${assetId}`,
        contentPlanId,
        status: "SUCCEEDED",
        renderer: "CODEX_LOCAL_FFMPEG",
        input: { source: "AI_TASK", taskId },
        output: { source: "CODEX_LOCAL", assetId },
        outputAssetId: assetId,
        outputPath: asset.storageUrl || asset.sourcePath,
        actualCost: 0,
        startedAt: asset.createdAt,
        finishedAt: new Date(),
        createdBy: actor,
      },
      update: {
        status: "SUCCEEDED",
        output: { source: "CODEX_LOCAL", assetId },
        outputAssetId: assetId,
        outputPath: asset.storageUrl || asset.sourcePath,
        failureReason: null,
        finishedAt: new Date(),
      },
    });
    await this.prisma.videoQualityCheck.updateMany({
      where: { contentPlanId, assetId, renderJobId: null },
      data: { renderJobId: renderJob.id },
    });
    return renderJob;
  }

  async backfillLocalMasterRenderJobs(actor = "系统迁移") {
    const relations = await this.prisma.contentAsset.findMany({
      where: {
        role: "VIDEO_FACTORY_MASTER",
        asset: { kind: "VIDEO" },
      },
      include: { asset: true },
    });
    for (const relation of relations) {
      await this.registerLocalMaster(
        relation.contentPlanId,
        relation.assetId,
        `backfill:${relation.contentPlanId}`,
        actor,
      );
    }
    return relations.length;
  }

  private referenceIsRelevant(reference: JsonRow, card: JsonRow) {
    const moduleSummary = Array.isArray(reference.moduleSummary) ? reference.moduleSummary : [];
    const analysis = object(reference.analysis);
    if (!moduleSummary.length && !Object.keys(analysis).length) return false;
    const referenceText = normalizeTopicText([
      reference.title,
      reference.transcript,
      JSON.stringify(moduleSummary),
      JSON.stringify(analysis),
    ].join(" "));
    const cardTerms = [
      card.productModel,
      card.mainKeyword,
      ...strings(card.auxiliaryKeywords),
      card.pain,
      card.scene,
    ].map(normalizeTopicText).filter((item) => item.length >= 2);
    const wearableTerms = ["智能手表", "血压手表", "手表", "腕表", "智能戒指", "戒指", "smartwatch", "watch", "smartring", "ring"];
    const hasWearableContext = wearableTerms.some((term) => referenceText.includes(normalizeTopicText(term)));
    const isCarOnly = ["汽车", "车钥匙", "carkey"].some((term) => referenceText.includes(normalizeTopicText(term)))
      && !["佩戴", "手腕", "表盘", "watch", "手表"].some((term) => referenceText.includes(normalizeTopicText(term)));
    return Boolean(referenceText)
      && !isCarOnly
      && hasWearableContext
      && cardTerms.some((term) => referenceText.includes(term) || term.includes(referenceText));
  }

  private materialCoverage(raw: JsonRow, allowedAssetIds: Set<string>): VideoMaterialCoverage {
    const matchedAssetIds = Array.from(new Set(strings(raw.matchedAssetIds).filter((id) => allowedAssetIds.has(id))));
    const totalShots = Math.max(1, Math.min(12, Math.round(number(raw.totalShots, 5))));
    const coveredShots = Math.min(
      totalShots,
      Math.max(0, Math.min(matchedAssetIds.length, Math.round(number(raw.coveredShots, matchedAssetIds.length)))),
    );
    return {
      totalShots,
      coveredShots,
      coveragePercent: Math.round(coveredShots / totalShots * 100),
      matchedAssetIds,
      missingShots: (Array.isArray(raw.missingShots) ? raw.missingShots.map(object) : []).map((item) => ({
        moduleType: String(item.moduleType || "SCENE"),
        description: String(item.description || "缺失镜头"),
        reason: String(item.reason || "没有匹配到已审核真实素材"),
        alternative: String(item.alternative || "优先使用产品图动画或本地程序化镜头"),
      })),
    };
  }

  private safeTopicTitle(card: JsonRow, references: Array<{ title: string | null }>) {
    const requested = String(card.title || card.topic || card.mainKeyword || "视频选题").trim();
    const copiedReference = references.some((reference) => {
      const title = normalizeTopicText(reference.title);
      return title.length >= 8 && normalizeTopicText(requested).includes(title);
    });
    const hasUnsafeClaim = /(第一|最准确|百分之百|100%|治愈|治疗|精准诊断|￥|¥|\$\s*\d|\d+\s*元)/iu.test(requested);
    if (!copiedReference && !hasUnsafeClaim) return Array.from(requested).slice(0, 80).join("");
    const recipe = VIDEO_RECIPES.find((item) => item.code === recipeCode(card.primaryRecipe));
    return `${String(card.mainKeyword || card.productModel || "赛电产品").trim()}·${recipe?.name || "内容方案"}`;
  }

  async persistTopicCards(input: {
    aiTaskId: string;
    platform: string;
    cards: unknown[];
    policyVersion?: string;
  }, actor: string) {
    const platform = integrationKind(input.platform);
    const cardPlatform: "DOUYIN" | "TIKTOK" = platform === IntegrationKind.TIKTOK ? "TIKTOK" : "DOUYIN";
    const rawCards = Array.isArray(input.cards) ? input.cards.map(object).slice(0, 30) : [];
    if (!rawCards.length) throw new BadRequestException("Codex没有返回可保存的视频选题卡");

    const productModels = Array.from(new Set(rawCards.map((item) => String(item.productModel || "").trim()).filter(Boolean)));
    const keywordIds = Array.from(new Set(rawCards.flatMap((item) => strings(item.keywordIds))));
    const externalVideoIds = Array.from(new Set(rawCards.flatMap((item) => strings(item.externalVideoIds))));
    const requestedAssetIds = Array.from(new Set(rawCards.flatMap((item) => strings(object(item.materialCoverage).matchedAssetIds))));
    const [products, keywords, references, assets] = await Promise.all([
      productModels.length
        ? this.prisma.product.findMany({ where: { modelCode: { in: productModels }, status: "READY" } })
        : Promise.resolve([]),
      keywordIds.length
        ? this.prisma.smartKeyword.findMany({
          where: { id: { in: keywordIds }, status: "ACTIVE", contentEnabled: true },
          include: { cluster: true },
        })
        : Promise.resolve([]),
      externalVideoIds.length
        ? this.prisma.externalVideo.findMany({
          where: {
            id: { in: externalVideoIds },
            platform,
            status: "READY",
            level: "REFERENCE",
            rightsStatus: "INTERNAL",
            availabilityStatus: "INACTIVE",
          },
          select: { id: true, title: true, transcript: true, moduleSummary: true, analysis: true },
        })
        : Promise.resolve([]),
      requestedAssetIds.length
        ? this.prisma.asset.findMany({
          where: {
            id: { in: requestedAssetIds },
            reviewStatus: "APPROVED",
            availabilityStatus: "ACTIVE",
            rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
            deletedAt: null,
          },
          select: { id: true },
        })
        : Promise.resolve([]),
    ]);
    const productMap = new Map(products.map((item) => [item.modelCode, item]));
    const keywordMap = new Map(keywords.map((item) => [item.id, item]));
    const referenceMap = new Map(references.map((item) => [item.id, item]));
    const allowedAssetIds = new Set(assets.map((item) => item.id));
    const day = localDateKey(new Date());
    const existingCards = await this.prisma.contentPlan.findMany({
      where: {
        kind: "VIDEO",
        planDate: {
          gte: new Date(`${day}T00:00:00+08:00`),
          lte: new Date(`${day}T23:59:59.999+08:00`),
        },
        sourceSignals: { array_contains: [{ type: "VIDEO_TOPIC_CARD" }] },
      },
      select: { sourceSignals: true },
    });
    const existingKeys = new Set(existingCards.map((item) => String(topicCardPayload(item)?.dedupeKey || "")).filter(Boolean));
    const created: Array<Record<string, unknown>> = [];
    const skipped: Array<{ index: number; reason: string }> = [];

    for (const [index, raw] of rawCards.entries()) {
      const validKeywordIds = strings(raw.keywordIds).filter((id) => keywordMap.has(id));
      const validReferences = strings(raw.externalVideoIds)
        .map((id) => referenceMap.get(id))
        .filter((reference): reference is NonNullable<typeof reference> => Boolean(reference))
        .filter((reference) => this.referenceIsRelevant(reference as unknown as JsonRow, raw));
      const productModel = String(raw.productModel || "").trim();
      const product = productMap.get(productModel);
      const missingFacts = Array.from(new Set([
        ...strings(raw.missingFacts),
        ...(!product ? ["缺少已审核产品事实"] : []),
      ]));
      const coverage = this.materialCoverage(object(raw.materialCoverage), allowedAssetIds);
      const primaryKeyword = validKeywordIds.map((id) => keywordMap.get(id)).find(Boolean);
      const mainKeyword = String(raw.mainKeyword || primaryKeyword?.keyword || "").trim();
      const clusterKey = primaryKeyword?.cluster?.canonicalKey || normalizeTopicText(mainKeyword);
      const primaryRecipe = recipeCode(raw.primaryRecipe);
      const backupRecipe = recipeCode(raw.backupRecipe, primaryRecipe === "PAIN_SOLVE" ? "UGC" : "PAIN_SOLVE");
      const dedupeKey = [
        platform,
        productModel || "UNVERIFIED",
        clusterKey,
        normalizeTopicText(raw.audience),
        normalizeTopicText(raw.pain),
        primaryRecipe,
      ].join("|");
      if (!mainKeyword || existingKeys.has(dedupeKey)) {
        skipped.push({ index, reason: !mainKeyword ? "缺少主关键词" : "同一平台、产品、人群、痛点和配方的选题已存在" });
        continue;
      }
      const scoreBreakdown = normalizeOpportunityScore(raw.scoreBreakdown, coverage.coveragePercent);
      const cardNo = `VTC-${day.replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const title = this.safeTopicTitle(raw, validReferences);
      const card: VideoTopicCardPayload = {
        cardNo,
        platform: cardPlatform,
        market: String(raw.market || (cardPlatform === "TIKTOK" ? "US" : "CN")),
        productModel: product?.modelCode,
        title,
        topic: String(raw.topic || title).trim(),
        audience: String(raw.audience || "目标消费者").trim(),
        pain: String(raw.pain || "待确认用户痛点").trim(),
        scene: String(raw.scene || "真实日常场景").trim(),
        objective: String(raw.objective || "内容种草与商品点击").trim(),
        mainKeyword,
        auxiliaryKeywords: strings(raw.auxiliaryKeywords).slice(0, 4),
        keywordIds: validKeywordIds,
        externalVideoIds: validReferences.map((item) => item.id),
        knowledgeIds: strings(raw.knowledgeIds),
        faqIds: strings(raw.faqIds),
        evidenceIds: Array.from(new Set([...strings(raw.evidenceIds), ...(product?.evidenceIds || [])])),
        sourceTypes: Array.from(new Set(strings(raw.sourceTypes).length ? strings(raw.sourceTypes) : ["SMART_KEYWORD"])),
        rationale: String(raw.rationale || "结合关键词需求、产品事实和现有素材形成的内容机会").trim(),
        reusableViralStructure: {
          hookPattern: String(object(raw.reusableViralStructure).hookPattern || ""),
          pace: String(object(raw.reusableViralStructure).pace || ""),
          shotStructure: strings(object(raw.reusableViralStructure).shotStructure),
          ctaPattern: String(object(raw.reusableViralStructure).ctaPattern || ""),
        },
        hookCandidates: strings(raw.hookCandidates).slice(0, 3),
        primaryRecipe,
        backupRecipe,
        durationSeconds: Math.max(10, Math.min(60, Math.round(number(raw.durationSeconds, 20)))),
        aspectRatio: "9:16",
        voiceoverDirection: String(raw.voiceoverDirection || "自然、可信，优先使用真实用户语言"),
        subtitleDirection: String(raw.subtitleDirection || "短句、大字、安全区内显示"),
        materialCoverage: coverage,
        scoreBreakdown,
        estimatedCosts: {
          local: Math.max(0, number(object(raw.estimatedCosts).local)),
          external: Math.max(0, number(object(raw.estimatedCosts).external)),
          currency: String(object(raw.estimatedCosts).currency || "CNY"),
        },
        missingFacts,
        riskReasons: Array.from(new Set([
          ...strings(raw.riskReasons),
          ...(validReferences.length ? ["外部爆款仅允许复用结构、Hook模式、节奏和CTA模式"] : []),
        ])),
        dedupeKey,
      };
      const plan = await this.prisma.$transaction(async (tx) => {
        const row = await tx.contentPlan.create({
          data: {
            productionNo: cardNo,
            productionStage: "TOPIC_CARD_RECOMMENDED",
            workflowVersion: 3,
            targetPlatforms: [platform],
            planDate: new Date(),
            kind: "VIDEO",
            topic: card.topic,
            productModel: card.productModel,
            audience: card.audience,
            objective: card.objective,
            score: card.scoreBreakdown.total,
            scoreBreakdown: card.scoreBreakdown as unknown as Prisma.InputJsonValue,
            hook: card.hookCandidates[0] || card.mainKeyword,
            outline: card.reusableViralStructure.shotStructure as unknown as Prisma.InputJsonValue,
            sourceSignals: [{
              type: "VIDEO_TOPIC_CARD",
              version: 3,
              policyVersion: input.policyVersion || DEFAULT_VIDEO_POLICY_CONFIG.topicCardPolicyVersion,
              aiTaskId: input.aiTaskId,
              card,
            }] as unknown as Prisma.InputJsonValue,
            evidenceIds: card.evidenceIds,
            status: ContentStatus.DRAFT,
            riskReasons: card.riskReasons,
            createdBy: actor,
            actorType: "AI",
          },
        });
        if (card.keywordIds.length) {
          await tx.smartKeywordContentRelation.createMany({
            data: card.keywordIds.map((keywordId, keywordIndex) => ({
              keywordId,
              contentPlanId: row.id,
              usageType: "VIDEO_TOPIC_CARD",
              position: keywordIndex === 0 ? "PRIMARY" : "AUXILIARY",
            })),
            skipDuplicates: true,
          });
        }
        await tx.auditLog.create({
          data: {
            actor,
            action: "VIDEO_TOPIC_CARD_CREATE",
            entityType: "ContentPlan",
            entityId: row.id,
            after: { cardNo, platform, score: card.scoreBreakdown.total, coverage: card.materialCoverage.coveragePercent },
          },
        });
        return row;
      });
      created.push({ ...jsonSafe(plan), topicCard: card });
      existingKeys.add(dedupeKey);
    }
    return { created, skipped, requested: rawCards.length };
  }

  async topicCards(query: TopicCardListInput = {}) {
    const rows = await this.prisma.contentPlan.findMany({
      where: {
        kind: "VIDEO",
        sourceSignals: { array_contains: [{ type: "VIDEO_TOPIC_CARD" }] },
        ...(query.status ? { productionStage: query.status } : { productionStage: { not: "TOPIC_CARD_ARCHIVED" } }),
        ...(query.productModel ? { productModel: query.productModel } : {}),
        ...(query.platform ? { targetPlatforms: { has: integrationKind(query.platform) } } : {}),
      },
      include: {
        assignedEmployee: true,
        keywordRelations: { include: { keyword: { include: { cluster: true } } } },
        aiTaskOutputs: { orderBy: { createdAt: "desc" }, take: 5, include: { aiTask: { select: { taskNo: true, status: true } } } },
      },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take: 300,
    });
    return jsonSafe(rows.map((row) => ({ ...row, topicCard: topicCardPayload(row) })))
      .filter((row) => {
        const card = row.topicCard;
        if (!card) return false;
        if (query.sourceType && !card.sourceTypes.includes(query.sourceType)) return false;
        if (query.minScore !== undefined && row.score < query.minScore) return false;
        if (query.minCoverage !== undefined && card.materialCoverage.coveragePercent < query.minCoverage) return false;
        return true;
      });
  }

  async topicCard(id: string) {
    const plan = await this.prisma.contentPlan.findUnique({
      where: { id },
      include: {
        assignedEmployee: true,
        keywordRelations: { include: { keyword: { include: { cluster: true } } } },
        aiTaskOutputs: { orderBy: { createdAt: "desc" }, include: { aiTask: { select: { taskNo: true, status: true } } } },
        contentAssets: { include: { asset: true } },
        videoRenderJobs: { orderBy: { createdAt: "desc" }, take: 3, include: { outputAsset: true, qualityChecks: true } },
      },
    });
    if (!plan || !topicCardSignal(plan)) throw new NotFoundException("视频选题卡不存在");
    return jsonSafe({
      ...plan,
      productionStage: this.projectedProductionStage(plan),
      topicCard: topicCardPayload(plan),
    });
  }

  async updateTopicCard(id: string, input: JsonRow, actor: string) {
    const existing = await this.prisma.contentPlan.findUnique({ where: { id } });
    if (!existing || !topicCardSignal(existing)) throw new NotFoundException("视频选题卡不存在");
    if (!["TOPIC_CARD_RECOMMENDED", "TOPIC_CARD_APPROVED"].includes(existing.productionStage)) {
      throw new BadRequestException("选题卡已经进入生产，不能再修改关键内容");
    }
    const before = topicCardPayload(existing);
    if (!before) throw new NotFoundException("视频选题卡内容不存在");
    const productModel = input.productModel !== undefined ? String(input.productModel || "").trim() : before.productModel;
    if (productModel) {
      const product = await this.prisma.product.findFirst({ where: { modelCode: productModel, status: "READY" } });
      if (!product) throw new BadRequestException("产品型号不存在或尚未审核");
    }
    const next: VideoTopicCardPayload = {
      ...before,
      ...(input.title !== undefined ? { title: String(input.title || "").trim() || before.title } : {}),
      ...(input.topic !== undefined ? { topic: String(input.topic || "").trim() || before.topic } : {}),
      ...(input.productModel !== undefined ? { productModel: productModel || undefined } : {}),
      ...(input.audience !== undefined ? { audience: String(input.audience || "").trim() || before.audience } : {}),
      ...(input.pain !== undefined ? { pain: String(input.pain || "").trim() || before.pain } : {}),
      ...(input.scene !== undefined ? { scene: String(input.scene || "").trim() || before.scene } : {}),
      ...(input.objective !== undefined ? { objective: String(input.objective || "").trim() || before.objective } : {}),
      ...(input.mainKeyword !== undefined ? { mainKeyword: String(input.mainKeyword || "").trim() || before.mainKeyword } : {}),
      ...(input.auxiliaryKeywords !== undefined ? { auxiliaryKeywords: strings(input.auxiliaryKeywords).slice(0, 4) } : {}),
      ...(input.hookCandidates !== undefined ? { hookCandidates: strings(input.hookCandidates).slice(0, 3) } : {}),
      ...(input.primaryRecipe !== undefined ? { primaryRecipe: recipeCode(input.primaryRecipe, before.primaryRecipe) } : {}),
      ...(input.backupRecipe !== undefined ? { backupRecipe: recipeCode(input.backupRecipe, before.backupRecipe) } : {}),
      ...(input.durationSeconds !== undefined ? { durationSeconds: Math.max(10, Math.min(60, Math.round(number(input.durationSeconds, before.durationSeconds)))) } : {}),
      ...(input.ownerEmployeeId !== undefined ? { ownerEmployeeId: String(input.ownerEmployeeId || "") || undefined } : {}),
      ...(input.reviewerEmployeeId !== undefined ? { reviewerEmployeeId: String(input.reviewerEmployeeId || "") || undefined } : {}),
    };
    next.dedupeKey = [
      next.platform,
      next.productModel || "UNVERIFIED",
      normalizeTopicText(next.mainKeyword),
      normalizeTopicText(next.audience),
      normalizeTopicText(next.pain),
      next.primaryRecipe,
    ].join("|");
    next.scoreBreakdown = normalizeOpportunityScore(next.scoreBreakdown, next.materialCoverage.coveragePercent);
    const signals = sourceSignals(existing).map((signal) => signal.type === "VIDEO_TOPIC_CARD"
      ? { ...signal, card: next, updatedBy: actor, updatedAt: new Date().toISOString() }
      : signal);
    await this.prisma.$transaction([
      this.prisma.contentPlan.update({
        where: { id },
        data: {
          topic: next.topic,
          productModel: next.productModel,
          audience: next.audience,
          objective: next.objective,
          score: next.scoreBreakdown.total,
          scoreBreakdown: next.scoreBreakdown as unknown as Prisma.InputJsonValue,
          hook: next.hookCandidates[0] || next.mainKeyword,
          sourceSignals: signals as unknown as Prisma.InputJsonValue,
          riskReasons: next.riskReasons,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actor,
          action: "VIDEO_TOPIC_CARD_UPDATE",
          entityType: "ContentPlan",
          entityId: id,
          before: before as unknown as Prisma.InputJsonValue,
          after: next as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);
    return this.topicCard(id);
  }

  async archiveTopicCard(id: string, actor: string) {
    const existing = await this.prisma.contentPlan.findUnique({ where: { id } });
    if (!existing || !topicCardSignal(existing)) throw new NotFoundException("视频选题卡不存在");
    if (existing.productionStage !== "TOPIC_CARD_RECOMMENDED") throw new BadRequestException("已进入生产的选题卡不能归档");
    await this.prisma.$transaction([
      this.prisma.contentPlan.update({ where: { id }, data: { productionStage: "TOPIC_CARD_ARCHIVED" } }),
      this.prisma.auditLog.create({
        data: { actor, action: "VIDEO_TOPIC_CARD_ARCHIVE", entityType: "ContentPlan", entityId: id, after: { productionStage: "TOPIC_CARD_ARCHIVED" } },
      }),
    ]);
    return { id, archived: true };
  }

  async rematchTopicCardAssets(id: string, actor: string) {
    const existing = await this.prisma.contentPlan.findUnique({ where: { id } });
    const card = existing ? topicCardPayload(existing) : null;
    if (!existing || !card) throw new NotFoundException("视频选题卡不存在");
    const assets = await this.prisma.asset.findMany({
      where: {
        kind: { in: ["VIDEO", "IMAGE"] },
        reviewStatus: "APPROVED",
        availabilityStatus: "ACTIVE",
        rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
        deletedAt: null,
        ...(card.productModel ? {
          OR: [
            { model: card.productModel },
            { products: { some: { product: { modelCode: card.productModel } } } },
          ],
        } : {}),
      },
      include: { tags: { include: { tag: true } } },
      orderBy: [{ qualityScore: "desc" }, { useCount: "desc" }, { updatedAt: "desc" }],
      take: 40,
    });
    const searchTerms = [card.scene, card.audience, card.pain, card.mainKeyword].map(normalizeTopicText).filter(Boolean);
    const ranked = assets.map((asset) => {
      const haystack = normalizeTopicText([
        asset.displayName,
        asset.contentDescription,
        asset.scene,
        asset.model,
        ...asset.tags.map((item) => item.tag.label),
      ].join(" "));
      return {
        asset,
        relevance: searchTerms.reduce((score, term) => score + (haystack.includes(term) ? 10 : 0), 0),
      };
    }).sort((a, b) => b.relevance - a.relevance || b.asset.qualityScore - a.asset.qualityScore);
    const matchedAssetIds = ranked.slice(0, 6).map((item) => item.asset.id);
    const totalShots = Math.max(1, card.materialCoverage.totalShots || 5);
    const coverage: VideoMaterialCoverage = {
      ...card.materialCoverage,
      totalShots,
      coveredShots: Math.min(totalShots, matchedAssetIds.length),
      coveragePercent: Math.round(Math.min(totalShots, matchedAssetIds.length) / totalShots * 100),
      matchedAssetIds,
      missingShots: card.materialCoverage.missingShots.slice(Math.min(totalShots, matchedAssetIds.length)),
    };
    const allowedAssetIds = new Set(matchedAssetIds);
    const normalizedCoverage = this.materialCoverage(coverage as unknown as JsonRow, allowedAssetIds);
    const signals = sourceSignals(existing).map((signal) => signal.type === "VIDEO_TOPIC_CARD"
      ? { ...signal, card: { ...card, materialCoverage: normalizedCoverage, scoreBreakdown: normalizeOpportunityScore(card.scoreBreakdown, normalizedCoverage.coveragePercent) } }
      : signal);
    await this.prisma.$transaction([
      this.prisma.contentPlan.update({
        where: { id },
        data: {
          score: normalizeOpportunityScore(card.scoreBreakdown, normalizedCoverage.coveragePercent).total,
          scoreBreakdown: normalizeOpportunityScore(card.scoreBreakdown, normalizedCoverage.coveragePercent) as unknown as Prisma.InputJsonValue,
          sourceSignals: signals as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.auditLog.create({
        data: { actor, action: "VIDEO_TOPIC_CARD_REMATCH_ASSETS", entityType: "ContentPlan", entityId: id, after: { matchedAssetIds, coveragePercent: normalizedCoverage.coveragePercent } },
      }),
    ]);
    return this.topicCard(id);
  }

  async prepareTopicCardApproval(id: string, input: TopicCardApprovalInput) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id } });
    const card = plan ? topicCardPayload(plan) : null;
    if (!plan || !card) throw new NotFoundException("视频选题卡不存在");
    if (!["TOPIC_CARD_RECOMMENDED", "TOPIC_CARD_APPROVED"].includes(plan.productionStage)) {
      throw new BadRequestException("选题卡当前不能确认执行");
    }
    if (!["SCRIPT_ONLY", "FULL_VIDEO"].includes(input.executionMode)) throw new BadRequestException("视频任务模式不正确");
    if (!input.ownerId || !input.reviewerId) throw new BadRequestException("必须指定负责人和审核人");
    const [product, employees] = await Promise.all([
      card.productModel
        ? this.prisma.product.findFirst({ where: { modelCode: card.productModel, status: "READY" } })
        : Promise.resolve(null),
      this.prisma.employee.findMany({ where: { id: { in: [input.ownerId, input.reviewerId] }, status: "ACTIVE" } }),
    ]);
    if (!product || card.missingFacts.some((item) => item.includes("产品"))) throw new BadRequestException("缺少已审核产品事实，暂不能执行");
    if (employees.length !== new Set([input.ownerId, input.reviewerId]).size) throw new BadRequestException("负责人或审核人不存在");
    return {
      plan,
      card,
      owner: employees.find((item) => item.id === input.ownerId),
      reviewer: employees.find((item) => item.id === input.reviewerId),
    };
  }

  async markTopicCardApproved(id: string, input: TopicCardApprovalInput, aiTaskId: string, actor: string) {
    const prepared = await this.prepareTopicCardApproval(id, input);
    const card: VideoTopicCardPayload = {
      ...prepared.card,
      ownerEmployeeId: input.ownerId,
      reviewerEmployeeId: input.reviewerId,
      approvedAiTaskId: aiTaskId,
      approvedExecutionMode: input.executionMode,
    };
    const signals = sourceSignals(prepared.plan);
    const nextSignals = [
      ...signals.map((signal) => signal.type === "VIDEO_TOPIC_CARD"
        ? { ...signal, card, approvedBy: actor, approvedAt: new Date().toISOString() }
        : signal),
      ...(!signals.some((signal) => signal.type === "VIDEO_FACTORY") ? [{
        type: "VIDEO_FACTORY",
        workflowVersion: 3,
        topicCardId: id,
        topicCardNo: card.cardNo,
        scriptCandidates: [],
        selectedCandidateIndex: 0,
        keywordIds: card.keywordIds,
        externalVideoIds: card.externalVideoIds,
        externalReferencePolicy: "STRUCTURE_ONLY",
        routingMode: "AUTO",
        allowFallback: false,
      }] : []),
    ];
    await this.prisma.$transaction([
      this.prisma.contentPlan.update({
        where: { id },
        data: {
          productionStage: "TOPIC_CARD_APPROVED",
          assignedEmployeeId: input.ownerId,
          assignedTo: prepared.owner?.name,
          owner: prepared.owner?.name,
          approvedBy: actor,
          approvedAt: new Date(),
          sourceSignals: nextSignals as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actor,
          action: "VIDEO_TOPIC_CARD_APPROVE",
          entityType: "ContentPlan",
          entityId: id,
          after: { aiTaskId, executionMode: input.executionMode, ownerId: input.ownerId, reviewerId: input.reviewerId },
        },
      }),
    ]);
    return this.topicCard(id);
  }

  async createCodexProject(input: {
    platform: string;
    productModel?: string;
    topic: string;
    audience: string;
    objective: string;
    keywordIds?: string[];
    externalVideoIds?: string[];
    aiTaskId: string;
  }, actor: string) {
    const platform = integrationKind(input.platform);
    const productionNo = `VF-${localDateKey(new Date()).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const plan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contentPlan.create({
        data: {
          productionNo,
          productionStage: "FACTORY_GENERATING",
          workflowVersion: 3,
          owner: actor,
          targetPlatforms: [platform],
          planDate: new Date(),
          kind: "VIDEO",
          topic: conciseVideoTopic(input.topic),
          productModel: input.productModel,
          audience: input.audience,
          objective: input.objective,
          score: 0,
          scoreBreakdown: {},
          hook: input.topic,
          outline: [],
          sourceSignals: [{
            type: "VIDEO_FACTORY",
            workflowVersion: 3,
            aiTaskId: input.aiTaskId,
            scriptCandidates: [],
            selectedCandidateIndex: 0,
            keywordIds: input.keywordIds || [],
            externalVideoIds: input.externalVideoIds || [],
            externalReferencePolicy: "STRUCTURE_ONLY",
            routingMode: "AUTO",
            allowFallback: false,
          }] as unknown as Prisma.InputJsonValue,
          evidenceIds: [],
          status: ContentStatus.DRAFT,
          riskReasons: [],
          createdBy: actor,
          assignedTo: actor,
          actorType: "AI",
        },
      });
      if (input.keywordIds?.length) {
        await tx.smartKeywordContentRelation.createMany({
          data: input.keywordIds.map((keywordId, index) => ({
            keywordId,
            contentPlanId: created.id,
            usageType: "SMART_VIDEO_FACTORY",
            position: index === 0 ? "PRIMARY" : "AUXILIARY",
          })),
          skipDuplicates: true,
        });
      }
      return created;
    });
    return this.project(plan.id);
  }

  async applyCodexProjectResult(input: {
    contentPlanId: string;
    aiTaskId: string;
    executionMode: "SCRIPT_ONLY" | "FULL_VIDEO";
    scriptCandidates: VideoScriptCandidateV3[];
    actor: string;
  }) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id: input.contentPlanId } });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    const candidates = input.scriptCandidates.slice(0, 3);
    const selected = candidates.find((item) => item.selected) || candidates[0];
    if (!selected) throw new BadRequestException("Codex未返回有效脚本候选");
    const allAssetIds = Array.from(new Set(candidates.flatMap((candidate) => candidate.shots.flatMap((shot) => shot.selectedAssetIds))));
    const validAssets = allAssetIds.length
      ? await this.prisma.asset.findMany({
        where: {
          id: { in: allAssetIds },
          reviewStatus: "APPROVED",
          availabilityStatus: "ACTIVE",
          rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
          deletedAt: null,
        },
        select: { id: true },
      })
      : [];
    const validAssetIds = new Set(validAssets.map((item) => item.id));
    const shots = selected.shots.map((shot, index): VideoShotPlanV3 => ({
      ...shot,
      sequence: index,
      durationSeconds: Math.max(2, Math.min(12, Math.round(number(shot.durationSeconds, 4)))),
      selectedAssetIds: shot.selectedAssetIds.filter((id) => validAssetIds.has(id)),
    }));
    const signals = sourceSignals(plan);
    const nextSignals = [
      ...signals.map((signal) => signal.type === "VIDEO_FACTORY"
        ? { ...signal, scriptCandidates: candidates, selectedCandidateIndex: candidates.indexOf(selected), workflowVersion: 3 }
        : signal),
      ...(!signals.some((signal) => signal.type === "AI_TASK" && signal.id === input.aiTaskId)
        ? [{ type: "AI_TASK", id: input.aiTaskId, executionMode: input.executionMode, provider: "CODEX" }]
        : []),
    ];
    const platform = plan.targetPlatforms[0] || IntegrationKind.DOUYIN;
    await this.prisma.$transaction(async (tx) => {
      await tx.contentPlan.update({
        where: { id: plan.id },
        data: {
          hook: selected.hook || plan.hook,
          score: Math.round(number(selected.score, plan.score)),
          scoreBreakdown: selected.scoreBreakdown as Prisma.InputJsonValue,
          outline: shots as unknown as Prisma.InputJsonValue,
          shootRequirements: shots.map((shot) => ({
            key: `codex-v3-${shot.sequence}`,
            title: shot.title,
            description: shot.description,
            moduleType: shot.moduleType,
            status: shot.selectedAssetIds.length ? "DONE" : "OPEN",
            selectedAssetId: shot.selectedAssetIds[0] || null,
            missingReason: shot.missingReason,
            alternativePlan: shot.alternativePlan,
          })) as unknown as Prisma.InputJsonValue,
          sourceSignals: nextSignals as unknown as Prisma.InputJsonValue,
          productionStage: "FACTORY_SCRIPT_READY",
        },
      });
      await tx.contentVariant.upsert({
        where: { contentPlanId_platform: { contentPlanId: plan.id, platform } },
        create: {
          contentPlanId: plan.id,
          platform,
          title: selected.title || plan.topic,
          body: selected.script,
          mediaType: "VIDEO",
          coverSpec: { text: selected.hook, ratio: "9:16" },
          metadata: { cta: selected.cta, templateCode: selected.templateCode },
        },
        update: {
          title: selected.title || plan.topic,
          body: selected.script,
          coverSpec: { text: selected.hook, ratio: "9:16" },
          metadata: { cta: selected.cta, templateCode: selected.templateCode },
        },
      });
      for (const shot of shots) {
        const selectedAssetId = shot.selectedAssetIds[0] || null;
        await tx.videoShot.upsert({
          where: { contentPlanId_requirementKey: { contentPlanId: plan.id, requirementKey: `codex-v3-${shot.sequence}` } },
          create: {
            contentPlanId: plan.id,
            requirementKey: `codex-v3-${shot.sequence}`,
            sequence: shot.sequence,
            title: shot.title,
            description: shot.description,
            moduleType: shot.moduleType,
            status: selectedAssetId ? "DONE" : "OPEN",
            sourcePreference: shot.sourcePreference || "REAL_ASSET_FIRST",
            durationSeconds: shot.durationSeconds,
            prompt: shot.visual,
            voiceover: shot.voiceover,
            subtitle: shot.subtitle,
            assetIds: shot.selectedAssetIds,
            selectedAssetId,
            metadata: {
              requiredAssetTags: shot.requiredAssetTags,
              missingReason: shot.missingReason,
              alternativePlan: shot.alternativePlan,
              aiTaskId: input.aiTaskId,
            },
          },
          update: {
            sequence: shot.sequence,
            title: shot.title,
            description: shot.description,
            moduleType: shot.moduleType,
            status: selectedAssetId ? "DONE" : "OPEN",
            sourcePreference: shot.sourcePreference || "REAL_ASSET_FIRST",
            durationSeconds: shot.durationSeconds,
            prompt: shot.visual,
            voiceover: shot.voiceover,
            subtitle: shot.subtitle,
            assetIds: shot.selectedAssetIds,
            selectedAssetId,
            metadata: {
              requiredAssetTags: shot.requiredAssetTags,
              missingReason: shot.missingReason,
              alternativePlan: shot.alternativePlan,
              aiTaskId: input.aiTaskId,
            },
          },
        });
      }
      if (validAssetIds.size) {
        await tx.contentAsset.createMany({
          data: Array.from(validAssetIds).map((assetId) => ({ contentPlanId: plan.id, assetId, role: "VIDEO_FACTORY_SOURCE" })),
          skipDuplicates: true,
        });
      }
      await tx.auditLog.create({
        data: {
          actor: input.actor,
          action: "VIDEO_FACTORY_CODEX_RESULT_APPLY",
          entityType: "ContentPlan",
          entityId: plan.id,
          after: {
            aiTaskId: input.aiTaskId,
            executionMode: input.executionMode,
            candidateCount: candidates.length,
            shotCount: shots.length,
            assetCount: validAssetIds.size,
          },
        },
      });
    });
    for (const assetId of validAssetIds) {
      const existingUsage = await this.prisma.assetUsage.findFirst({
        where: { assetId, businessObjectType: "CONTENT_PLAN", businessObjectId: plan.id, usageType: "VIDEO_FACTORY_SOURCE" },
      });
      if (!existingUsage) {
        await this.prisma.assetUsage.create({
          data: {
            assetId,
            usageType: "VIDEO_FACTORY_SOURCE",
            businessObjectType: "CONTENT_PLAN",
            businessObjectId: plan.id,
            usedBy: input.actor,
            actorType: "AI",
            purpose: selected.title,
            platform,
          },
        });
        await this.prisma.asset.update({ where: { id: assetId }, data: { useCount: { increment: 1 }, lastUsedAt: new Date() } });
      }
    }
    return this.project(plan.id);
  }

  async syncProjectTaskState(contentPlanId: string, taskStatus: string) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id: contentPlanId } });
    if (!plan) return null;
    let productionStage = plan.productionStage;
    if (["CLAIMED", "RUNNING", "QUALITY_CHECK", "UPLOADING"].includes(taskStatus)) {
      productionStage = "FACTORY_GENERATING";
    } else if (["FAILED", "RETURNED", "CANCELLED"].includes(taskStatus)) {
      productionStage = this.candidates(plan).length ? "FACTORY_SCRIPT_READY" : "TOPIC_CARD_APPROVED";
    }
    if (productionStage === plan.productionStage) return plan;
    return this.prisma.contentPlan.update({ where: { id: contentPlanId }, data: { productionStage } });
  }

  private providerView<T extends { secretRef: string | null }>(provider: T) {
    const { secretRef: _secretRef, ...visible } = provider;
    return { ...visible, secretConfigured: Boolean(_secretRef) };
  }

  async providers() {
    await this.ensureCatalog();
    const rows = await this.prisma.videoModelProvider.findMany({
      include: { models: { orderBy: [{ priority: "asc" }, { displayName: "asc" }] } },
      orderBy: [{ priority: "asc" }, { displayName: "asc" }],
    });
    return rows.map((row) => this.providerView(row));
  }

  async upsertProvider(input: JsonRow, actor: string, id?: string) {
    const code = String(input.code || "").trim().toUpperCase();
    const displayName = String(input.displayName || "").trim();
    if (!id && !code) throw new BadRequestException("请填写服务商代码");
    if (!displayName) throw new BadRequestException("请填写服务商名称");
    const current = id ? await this.prisma.videoModelProvider.findUnique({ where: { id } }) : null;
    if (id && !current) throw new NotFoundException("视频服务商不存在");
    const secret = object(input.secret);
    const hasSecret = Object.values(secret).some((value) => String(value || "").trim());
    const currentSecret = current?.secretRef
      ? object(JSON.parse(decryptIntegrationValue(current.secretRef) || "{}"))
      : {};
    const mergedSecret = {
      ...currentSecret,
      ...Object.fromEntries(Object.entries(secret).filter(([, value]) => String(value || "").trim())),
    };
    const enabled = Boolean(input.enabled);
    const data: Prisma.VideoModelProviderUncheckedCreateInput = {
      code: current?.code || code,
      displayName,
      region: String(input.region || current?.region || "GLOBAL"),
      baseUrl: String(input.baseUrl || "").trim() || null,
      capabilities: strings(input.capabilities),
      publicConfig: object(input.publicConfig) as Prisma.InputJsonValue,
      secretRef: hasSecret ? encryptIntegrationValue(JSON.stringify(mergedSecret)) : current?.secretRef,
      maxConcurrency: Math.max(1, Math.min(20, Number(input.maxConcurrency || 2))),
      dailyBudget: input.dailyBudget === null || input.dailyBudget === "" ? null : Math.max(0, Number(input.dailyBudget || 0)),
      priority: Math.max(1, Number(input.priority || 100)),
      enabled,
      state: hasSecret || current?.secretRef ? "CONFIGURED" : "UNCONFIGURED",
      message: hasSecret || current?.secretRef ? "配置已保存，待健康检查" : "未配置",
    };
    const provider = current
      ? await this.prisma.videoModelProvider.update({ where: { id: current.id }, data })
      : await this.prisma.videoModelProvider.create({ data });
    await this.prisma.auditLog.create({
      data: { actor, action: current ? "VIDEO_PROVIDER_UPDATE" : "VIDEO_PROVIDER_CREATE", entityType: "VideoModelProvider", entityId: provider.id, after: { code: provider.code, enabled: provider.enabled } },
    });
    return this.providerView(provider);
  }

  async checkProvider(id: string, actor: string) {
    const provider = await this.prisma.videoModelProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException("视频服务商不存在");
    if (!provider.secretRef) {
      return this.providerView(await this.prisma.videoModelProvider.update({
        where: { id },
        data: { state: "UNCONFIGURED", message: "未配置API密钥", lastCheckedAt: new Date() },
      }));
    }
    const secret = object(JSON.parse(decryptIntegrationValue(provider.secretRef) || "{}"));
    const publicConfig = object(provider.publicConfig);
    const healthPath = String(publicConfig.healthPath || "").trim();
    if (!healthPath) {
      return this.providerView(await this.prisma.videoModelProvider.update({
        where: { id },
        data: { state: "CONFIGURED", message: "凭据已保存，待首次生成任务验证", lastCheckedAt: new Date() },
      }));
    }
    const apiKey = String(secret.apiKey || "");
    const url = healthPath.startsWith("http")
      ? healthPath
      : `${String(provider.baseUrl || "").replace(/\/$/u, "")}/${healthPath.replace(/^\//u, "")}`;
    try {
      const response = await fetch(url, {
        headers: provider.code === "HEYGEN"
          ? { "X-Api-Key": apiKey }
          : { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`健康检查返回${response.status}`);
      const updated = await this.prisma.videoModelProvider.update({
        where: { id },
        data: { state: "HEALTHY", message: "连接正常", lastCheckedAt: new Date(), lastSuccessAt: new Date() },
      });
      await this.prisma.auditLog.create({ data: { actor, action: "VIDEO_PROVIDER_CHECK", entityType: "VideoModelProvider", entityId: id, after: { state: "HEALTHY" } } });
      return this.providerView(updated);
    } catch (error) {
      const updated = await this.prisma.videoModelProvider.update({
        where: { id },
        data: { state: "ERROR", message: error instanceof Error ? error.message : "连接失败", lastCheckedAt: new Date() },
      });
      return this.providerView(updated);
    }
  }

  async models() {
    await this.ensureCatalog();
    return this.prisma.videoModelConfig.findMany({
      include: { provider: { select: { id: true, code: true, displayName: true, state: true, enabled: true, message: true } } },
      orderBy: [{ priority: "asc" }, { displayName: "asc" }],
    });
  }

  async upsertModel(input: JsonRow, id?: string) {
    const providerId = String(input.providerId || "").trim();
    const code = String(input.code || "").trim();
    const displayName = String(input.displayName || "").trim();
    if (!providerId || !code || !displayName) throw new BadRequestException("服务商、模型代码和名称不能为空");
    const data = {
      providerId,
      code,
      displayName,
      capabilities: strings(input.capabilities),
      supportedRatios: strings(input.supportedRatios).length ? strings(input.supportedRatios) : ["9:16"],
      supportedDurations: strings(input.supportedDurations).map(Number).filter((value) => value > 0),
      supportedResolutions: strings(input.supportedResolutions),
      scenarioTags: strings(input.scenarioTags),
      costConfig: object(input.costConfig) as Prisma.InputJsonValue,
      modelConfig: object(input.modelConfig) as Prisma.InputJsonValue,
      priority: Math.max(1, Number(input.priority || 100)),
      enabled: Boolean(input.enabled),
    };
    if (id) {
      const existing = await this.prisma.videoModelConfig.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException("视频模型不存在");
      return this.prisma.videoModelConfig.update({ where: { id }, data });
    }
    return this.prisma.videoModelConfig.create({ data });
  }

  async routing() {
    await this.ensureCatalog();
    return this.prisma.videoRoutingPolicy.findMany({
      include: { primaryModel: { include: { provider: true } } },
      orderBy: [{ priority: "asc" }, { name: "asc" }],
    });
  }

  async saveRouting(input: JsonRow) {
    const policyKey = String(input.policyKey || "").trim().toUpperCase();
    if (!policyKey) throw new BadRequestException("请填写路由规则代码");
    return this.prisma.videoRoutingPolicy.upsert({
      where: { policyKey },
      create: {
        policyKey,
        name: String(input.name || policyKey),
        platform: String(input.platform || "").trim() || null,
        scenario: String(input.scenario || "").trim() || null,
        productModel: String(input.productModel || "").trim() || null,
        primaryModelId: String(input.primaryModelId || "").trim() || null,
        fallbackModelIds: strings(input.fallbackModelIds),
        rules: object(input.rules) as Prisma.InputJsonValue,
        priority: Math.max(1, Number(input.priority || 100)),
        active: input.active !== false,
      },
      update: {
        name: String(input.name || policyKey),
        platform: String(input.platform || "").trim() || null,
        scenario: String(input.scenario || "").trim() || null,
        productModel: String(input.productModel || "").trim() || null,
        primaryModelId: String(input.primaryModelId || "").trim() || null,
        fallbackModelIds: strings(input.fallbackModelIds),
        rules: object(input.rules) as Prisma.InputJsonValue,
        priority: Math.max(1, Number(input.priority || 100)),
        active: input.active !== false,
      },
    });
  }

  async resolveModel(input: {
    requestedModelId?: string | null;
    platform?: string | null;
    scenario?: string | null;
    capability: string;
  }) {
    await this.ensureCatalog();
    const whereAvailable = {
      enabled: true,
      capabilities: { has: input.capability },
      provider: { enabled: true, state: { in: ["CONFIGURED", "HEALTHY"] } },
    } satisfies Prisma.VideoModelConfigWhereInput;
    if (input.requestedModelId) {
      const model = await this.prisma.videoModelConfig.findFirst({
        where: { id: input.requestedModelId, ...whereAvailable },
        include: { provider: true },
      });
      if (!model) throw new BadRequestException("指定模型未配置、已停用或不支持当前生成方式");
      return { primary: model, fallbacks: [] };
    }
    const policy = await this.prisma.videoRoutingPolicy.findFirst({
      where: {
        active: true,
        AND: [
          { OR: [{ platform: input.platform || undefined }, { platform: null }] },
          { OR: [{ scenario: input.scenario || undefined }, { scenario: null }] },
        ],
      },
      orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    });
    const candidateIds = [policy?.primaryModelId, ...(policy?.fallbackModelIds || [])].filter(Boolean) as string[];
    const models = await this.prisma.videoModelConfig.findMany({
      where: { ...whereAvailable, ...(candidateIds.length ? { id: { in: candidateIds } } : {}) },
      include: { provider: true },
      orderBy: [{ priority: "asc" }, { provider: { priority: "asc" } }],
    });
    const ordered = candidateIds.length
      ? candidateIds.map((id) => models.find((model) => model.id === id)).filter(Boolean) as typeof models
      : models;
    if (!ordered.length) throw new BadRequestException("没有已配置且支持当前任务的视频模型");
    return { primary: ordered[0], fallbacks: ordered.slice(1) };
  }

  private async buildContext(input: ProjectCreateInput) {
    const platform = integrationKind(input.platform);
    const product = input.productModel
      ? await this.prisma.product.findUnique({ where: { modelCode: input.productModel } })
      : null;
    const shouldUseKeywordPool = Boolean(input.keywordIds?.length)
      || (!input.topic && !input.externalVideoIds?.length && !input.assetGapTaskId);
    const keywords = shouldUseKeywordPool
      ? await this.prisma.smartKeyword.findMany({
        where: input.keywordIds?.length
          ? { id: { in: input.keywordIds } }
          : { platform, status: "ACTIVE", contentEnabled: true, grade: { in: ["S", "A"] } },
        include: { cluster: true },
        orderBy: [{ pinned: "desc" }, { opportunityScore: "desc" }],
        take: 5,
      })
      : [];
    const knowledge = await this.prisma.knowledgeEntry.findMany({
      where: {
        status: "READY",
        externallyUsable: true,
        ...(input.productModel ? { OR: [{ model: input.productModel }, { model: null }] } : {}),
      },
      select: { id: true, type: true, title: true, reply: true, body: true, sourceLevel: true, evidenceIds: true },
      orderBy: [{ sourceLevel: "asc" }, { updatedAt: "desc" }],
      take: 30,
    });
    const assets = await this.prisma.asset.findMany({
      where: {
        kind: { in: ["VIDEO", "IMAGE"] },
        purpose: "EDITING_FOOTAGE",
        reviewStatus: "APPROVED",
        availabilityStatus: "ACTIVE",
        rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
        deletedAt: null,
        ...(product ? { products: { some: { productId: product.id } } } : {}),
      },
      select: {
        id: true, assetNo: true, displayName: true, kind: true, contentDescription: true,
        model: true, scene: true, qualityScore: true, objectKey: true,
        tags: { select: { tag: { select: { namespace: true, code: true, label: true } } } },
      },
      orderBy: [{ qualityScore: "desc" }, { updatedAt: "desc" }],
      take: 40,
    });
    const references = input.externalVideoIds?.length
      ? await this.prisma.externalVideo.findMany({
        where: {
          id: { in: input.externalVideoIds },
          level: "REFERENCE",
          rightsStatus: "INTERNAL",
          availabilityStatus: "INACTIVE",
        },
        select: { id: true, platform: true, title: true, transcript: true, moduleSummary: true, analysis: true },
      })
      : [];
    const assetGapTask = input.assetGapTaskId
      ? await this.prisma.opsTask.findFirst({
        where: { id: input.assetGapTaskId, sourceType: "AI_ASSET_GAP", status: { not: "DONE" } },
        select: { id: true, title: true, description: true, productId: true, evidence: true },
      })
      : null;
    if (input.assetGapTaskId && !assetGapTask) throw new BadRequestException("补拍任务不存在或已完成");
    return {
      platform,
      voiceoverMode: input.voiceoverMode === "NO_VOICEOVER" ? "NO_VOICEOVER" : "VOICEOVER",
      accountType: String(input.accountType || "BRAND").trim(),
      estimatedDurationSeconds: Math.max(15, Math.min(60, Number(input.estimatedDurationSeconds) || 30)),
      contentRestrictionMode: input.contentRestrictionMode === "HEALTH_RESTRICTED" ? "HEALTH_RESTRICTED" : "NORMAL",
      product,
      keywords,
      knowledge,
      assets,
      references,
      assetGapTask,
      topic: conciseVideoTopic(String(references[0]?.title || input.topic || keywords[0]?.keyword || `${input.productModel || "赛电产品"}短视频`)),
      audience: String(input.audience || keywords.find((item) => item.audience)?.audience || "目标消费者").trim(),
      objective: String(input.objective || "内容种草与商品点击").trim(),
    };
  }

  private fallbackCandidates(context: Awaited<ReturnType<VideoFactoryService["buildContext"]>>): AiVideoCandidate[] {
    const keyword = context.keywords[0]?.keyword || context.topic;
    const noVoiceover = context.voiceoverMode === "NO_VOICEOVER";
    const patterns = [
      { suffix: "痛点切入", hook: `很多人在选择${keyword}时忽略了这一点` },
      { suffix: "场景体验", hook: `${keyword}在日常场景里到底怎么用` },
      { suffix: "问答测评", hook: `关于${keyword}，大家最常问的问题` },
    ];
    return patterns.map((pattern, index) => ({
      topic: `${context.topic}·${pattern.suffix}`,
      audience: context.audience,
      objective: context.objective,
      hook: noVoiceover ? `画面字幕：${pattern.hook}` : pattern.hook,
      outline: noVoiceover
        ? ["前三秒视觉钩子与大字字幕", "产品动作与使用场景", "卖点字幕卡", "结尾行动引导"]
        : ["前三秒Hook", "真实使用场景", "已审核产品价值", "行动引导"],
      score: 70 - index,
      scoreBreakdown: { relevance: 80, assetCoverage: context.assets.length ? 80 : 20 },
      assetIds: context.assets.filter((asset) => asset.kind === "VIDEO").slice(0, 3).map((asset) => asset.id),
      referenceIds: context.references.map((item) => item.id),
      missingAssets: context.assets.some((asset) => asset.kind === "VIDEO") ? [] : ["真实使用场景镜头"],
      titleZh: `${keyword}真实体验`,
      titleEn: `${keyword} real-life experience`,
      coverTextZh: keyword,
      coverTextEn: keyword,
      hashtags: [keyword],
      scriptPackage: {
        basicInfo: {
          productModel: context.product?.modelCode || keyword,
          videoType: noVoiceover ? "NO_VOICEOVER" : "VOICEOVER",
          platform: context.platform,
          accountType: context.accountType,
          targetAudience: context.audience,
          estimatedDurationSeconds: context.estimatedDurationSeconds,
          healthContentAllowed: context.contentRestrictionMode !== "HEALTH_RESTRICTED",
        },
        positioning: {
          coreTheme: context.topic,
          communicationGoal: context.objective,
          userPainPoint: pattern.hook,
          uniqueSellingPoint: "用真实使用过程展示已审核的产品价值",
        },
        goldenHook: {
          copy: pattern.hook,
          type: pattern.suffix,
          visual: "前三秒使用真实场景与产品操作动作，不使用无关外观空镜",
          retentionReason: "先提出问题，延迟到操作结果出现后再给结论",
          openingSound: "动作先行音效，随后进入口播或首屏字幕",
        },
        voiceoverLines: [
          { text: pattern.hook, tone: "直接", speed: "稍快", emotion: "好奇", durationSeconds: 3 },
          { text: `先看${keyword}在真实场景中的进入方式和关键操作。`, tone: "说明", speed: "正常", emotion: "可信", durationSeconds: 7 },
          { text: "完整展示操作过程和结果画面，再说明已审核的核心价值。", tone: "客观", speed: "正常", emotion: "稳重", durationSeconds: 12 },
          { text: "结合自己的使用需求判断，想看完整信息可以继续查看详情。", tone: "自然", speed: "稍慢", emotion: "友好", durationSeconds: 8 },
        ],
        structure: [
          { stage: "HOOK", purpose: "提出问题并留人", content: pattern.hook },
          { stage: "BRIDGE", purpose: "从问题承接到真实场景", content: "展示人物进入使用场景" },
          { stage: "SELLING_POINT", purpose: "展开唯一核心卖点", content: "展示产品关键操作过程" },
          { stage: "PROOF", purpose: "用画面提供事实证据", content: "展示操作结果或已审核信息对应画面" },
          { stage: "RETENTION", purpose: "延迟结论并保持期待", content: "先展示过程，结果在后段出现" },
          { stage: "ENDING", purpose: "自然收束", content: "总结适用场景并引导查看详情" },
        ],
        shotRequirements: [
          {
            line: pattern.hook,
            visual: "真人使用场景中的产品动作近景",
            assetStatus: context.assets.some((asset) => asset.kind === "VIDEO") ? "COVERED" as const : "NEED_SHOOT" as const,
            factualProof: "仅证明人物正在真实操作产品，不推断未展示的功能",
            audioVisualRequirement: "问题口播必须配实际操作动作，不能用包装或佩戴空镜代替",
          },
          {
            line: `先看${keyword}的进入方式和关键操作`,
            visual: "从功能入口到操作过程的连续视频",
            assetStatus: context.assets.some((asset) => asset.kind === "VIDEO") ? "REWRITABLE" as const : "NEED_SHOOT" as const,
            factualProof: "证明画面中真实出现的入口、动作与操作步骤",
            audioVisualRequirement: "具体功能名称只有在对应界面与过程清楚可见时才能保留",
          },
          {
            line: "完整展示操作过程和结果画面",
            visual: "操作过程、等待状态与结果页面连续镜头",
            assetStatus: context.assets.some((asset) => asset.kind === "VIDEO") ? "REWRITABLE" as const : "NEED_SHOOT" as const,
            factualProof: "只说明画面实际显示的过程和结果，不作诊断或效果推断",
            audioVisualRequirement: "结果口播必须配结果页面，不能用产品外观镜头替代",
          },
          {
            line: "结合自己的使用需求判断",
            visual: "产品完整定格与自然使用场景",
            assetStatus: context.assets.length ? "COVERED" as const : "NEED_SHOOT" as const,
            factualProof: "证明产品外观与实际使用场景",
            audioVisualRequirement: "结尾保留完整产品画面和安全尾帧",
          },
        ],
        retentionDesign: ["开头只提出问题，不立即说完结论", "在操作过程后再展示结果", "用信息递进完成卖点说明"],
        subtitles: [pattern.hook.replace(/[，。！？；：]/g, ""), `先看${keyword}的真实操作过程`, "完整过程和结果画面都要看清", "结合自己的需求再判断"],
        emphasisTexts: [keyword, "真实操作", "完整过程", "结果画面"],
        soundDesign: {
          voiceProfile: noVoiceover ? "无配音，使用屏幕字幕" : "自然可信的成年配音",
          tone: "客观自然",
          emotion: "稳重、有亲和力",
          speed: "正常，重点处稍慢",
          openingSfx: "操作动作先行音效",
          keySfx: ["界面切换轻提示音", "结果出现提示音"],
          ambientSound: "保留轻微真实环境声，不盖过口播",
        },
        complianceChecks: [
          { category: "禁止词与极限词", status: "REVIEW" as const, note: "发布前按当前风险词库再次检查" },
          { category: "健康功能表达", status: "REVIEW" as const, note: "只使用监测、提醒、参考、健康管理等已审核表达" },
          { category: "画面事实", status: "PASS" as const, note: "脚本要求以真实操作、过程或结果画面作为证据" },
        ],
        ending: {
          summary: "总结真实使用过程与适用场景",
          interaction: "你更想先看哪个实际操作？",
          visual: "产品完整定格，字幕与口播结束后继续保留画面",
          safeTailSeconds: 1.5,
        },
        materialGaps: context.assets.some((asset) => asset.kind === "VIDEO") ? [] : [{
          product: context.product?.modelCode || keyword,
          action: "完整进入、操作并查看结果",
          shotSize: "竖屏中近景与界面近景",
          processOrResult: "功能操作过程和结果页面",
          shootingMethod: "1080×1920竖屏连续拍摄，画面稳定，界面清楚，保留前后各1秒",
        }],
      },
      scripts: {
        zh15: noVoiceover
          ? `0-3秒：大字字幕“${pattern.hook}”；3-8秒：连续展示${keyword}的真实使用动作；8-12秒：字幕说明已审核的核心产品价值；12-15秒：用实际场景收尾并引导查看详情。`
          : `${pattern.hook}。先从一个真实使用场景切入，再展示${keyword}的实际操作过程和已审核的核心产品价值，最后用清晰结果画面收尾，引导用户继续查看详情。`,
        en15: noVoiceover ? `${keyword} | Real scene | Key benefit | Learn more` : `${keyword}. A real-life look using approved product facts.`,
        zh30: noVoiceover
          ? `0-3秒：痛点大字字幕“${pattern.hook}”；3-8秒：展示人物进入真实使用场景；8-16秒：连续展示${keyword}的操作步骤和产品动作；16-23秒：用字幕卡说明已审核的核心价值与适用场景；23-27秒：展示操作结果或使用反馈；27-30秒：产品定格并引导查看详情。`
          : `${pattern.hook}。很多人真正需要的不是一句宣传，而是看清楚产品在日常场景中如何使用。接下来用真实素材展示${keyword}的进入方式、关键操作和结果画面，再说明已审核的核心产品价值与适用场景。看完完整过程后，再根据自己的需求判断，最后引导查看详情。`,
        en30: noVoiceover ? `Text-only pacing: pain point | product action | key benefit | use case | CTA` : `${keyword}. Show the use case, approved product value and a clear next step with real assets.`,
      },
    }));
  }

  async createProject(input: ProjectCreateInput, actor: string) {
    const context = await this.buildContext(input);
    let candidates: AiVideoCandidate[];
    try {
      candidates = await this.aiContent.generateVideoCandidates({
        platform: context.platform,
        product: context.product,
        keywords: context.keywords,
        knowledge: context.knowledge,
        assets: context.assets,
        references: context.references,
        topic: context.topic,
        audience: context.audience,
        objective: context.objective,
        voiceoverMode: context.voiceoverMode,
        generationMode: "NORMAL",
      });
    } catch {
      candidates = this.fallbackCandidates(context);
    }
    candidates = [...candidates.slice(0, 3), ...this.fallbackCandidates(context)]
      .filter((candidate, index, rows) => rows.findIndex((item) => item.topic === candidate.topic) === index)
      .slice(0, 3);
    const primary = candidates[0];
    const evidenceIds = Array.from(new Set(context.knowledge.flatMap((item) => item.evidenceIds)));
    const productionNo = `VF-${localDateKey(new Date()).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const plan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contentPlan.create({
        data: {
          productionNo,
          productionStage: "FACTORY_SCRIPT_READY",
          workflowVersion: 2,
          owner: actor,
          targetPlatforms: [context.platform],
          planDate: new Date(),
          kind: "VIDEO",
          topic: primary.topic,
          productModel: context.product?.modelCode || input.productModel,
          audience: primary.audience,
          objective: primary.objective,
          score: primary.score,
          scoreBreakdown: primary.scoreBreakdown,
          hook: primary.hook,
          outline: primary.outline,
          sourceSignals: [{
            type: "VIDEO_FACTORY",
            scriptCandidates: candidates,
            selectedCandidateIndex: 0,
            keywordIds: context.keywords.map((item) => item.id),
            externalVideoIds: context.references.map((item) => item.id),
            assetGapTaskId: context.assetGapTask?.id,
            requestedModelId: input.requestedModelId,
            routingMode: input.routingMode || "AUTO",
            allowFallback: input.allowFallback !== false,
            externalReferencePolicy: "STRUCTURE_ONLY",
            voiceoverMode: context.voiceoverMode,
            accountType: context.accountType,
            estimatedDurationSeconds: context.estimatedDurationSeconds,
            contentRestrictionMode: context.contentRestrictionMode,
          }],
          evidenceIds,
          status: ContentStatus.DRAFT,
          riskReasons: [],
          createdBy: actor,
          assignedTo: actor,
          actorType: "HUMAN",
          variants: {
            create: [{
              platform: context.platform,
              title: context.platform === "TIKTOK" ? primary.titleEn : primary.titleZh,
              body: context.platform === "TIKTOK" ? primary.scripts.en15 : primary.scripts.zh15,
              mediaType: "VIDEO",
              coverSpec: {
                text: context.platform === "TIKTOK" ? primary.coverTextEn : primary.coverTextZh,
                ratio: "9:16",
              },
              metadata: { hashtags: primary.hashtags },
            }],
          },
        },
      });
      if (context.keywords.length) {
        await tx.smartKeywordContentRelation.createMany({
          data: context.keywords.map((keyword, index) => ({
            keywordId: keyword.id,
            contentPlanId: created.id,
            usageType: "SMART_VIDEO_FACTORY",
            position: index === 0 ? "PRIMARY" : "AUXILIARY",
          })),
          skipDuplicates: true,
        });
      }
      await tx.auditLog.create({
        data: {
          actor,
          action: "VIDEO_FACTORY_PROJECT_CREATE",
          entityType: "ContentPlan",
          entityId: created.id,
          after: { productionNo, platform: context.platform, candidateCount: candidates.length },
        },
      });
      return created;
    });
    return this.project(plan.id);
  }

  async createSimilarProject(id: string, input: SimilarVideoInput, actor: string) {
    const source = await this.prisma.contentPlan.findUnique({
      where: { id },
      include: {
        videoRenderJobs: {
          where: { outputAssetId: input.outputAssetId, status: "SUCCEEDED" },
          include: { outputAsset: true },
        },
      },
    });
    if (!source || source.kind !== "VIDEO") throw new NotFoundException("智能视频项目不存在");
    const approvedOutput = source.videoRenderJobs[0]?.outputAsset;
    if (!approvedOutput || approvedOutput.reviewStatus !== "APPROVED") {
      throw new BadRequestException("只有审核通过的成片可以生成类似视频");
    }
    if (!input.replaceHook && !input.replaceProduct && !input.replaceFeature) {
      throw new BadRequestException("请至少选择一项需要替换的内容");
    }
    const hook = String(input.hook || "").trim();
    const productModel = String(input.productModel || "").trim();
    const feature = String(input.feature || "").trim();
    if (input.replaceHook && !hook) throw new BadRequestException("请填写新的钩子");
    if (input.replaceProduct && !productModel) throw new BadRequestException("请选择新的产品型号");
    if (input.replaceFeature && !feature) throw new BadRequestException("请填写新的核心功能");

    const factory = sourceSignals(source).find((item) => item.type === "VIDEO_FACTORY") || {};
    const selectedIndex = Math.max(0, Number(factory.selectedCandidateIndex || 0));
    const sourceCandidate = this.candidates(source)[selectedIndex] || this.candidates(source)[0];
    const targetProductModel = input.replaceProduct ? productModel : source.productModel || undefined;
    const replacementNotes = [
      input.replaceHook ? `钩子替换为：${hook}` : "保留原视频钩子逻辑",
      input.replaceProduct ? `产品替换为：${productModel}` : "保留原产品",
      input.replaceFeature ? `核心功能替换为：${feature}` : "保留原核心功能",
      sourceCandidate?.outline?.length ? `保留原成片节奏和镜头结构：${sourceCandidate.outline.join("；")}` : "",
    ].filter(Boolean);
    const created = await this.createProject({
      platform: source.targetPlatforms[0],
      voiceoverMode: String(factory.voiceoverMode || "VOICEOVER"),
      productModel: targetProductModel,
      topic: input.replaceFeature ? feature : source.topic,
      audience: source.audience || undefined,
      objective: `基于已审核成片生成相似视频。${replacementNotes.join("；")}`,
      routingMode: String(factory.routingMode || "AUTO"),
      requestedModelId: factory.requestedModelId ? String(factory.requestedModelId) : undefined,
      allowFallback: factory.allowFallback !== false,
    }, actor);

    const createdSignals = sourceSignals(created);
    const nextSignals = createdSignals.map((item) => item.type === "VIDEO_FACTORY" ? {
      ...item,
      derivedFromProjectId: source.id,
      derivedFromRenderJobId: source.videoRenderJobs[0].id,
      derivedFromOutputAssetId: approvedOutput.id,
      similarityMode: "APPROVED_MASTER",
      replacements: {
        hook: input.replaceHook ? hook : null,
        productModel: input.replaceProduct ? productModel : null,
        feature: input.replaceFeature ? feature : null,
      },
      scriptCandidates: Array.isArray(item.scriptCandidates)
        ? (item.scriptCandidates as unknown as AiVideoCandidate[]).map((candidate, index) => index === 0 && input.replaceHook
          ? { ...candidate, hook }
          : candidate)
        : item.scriptCandidates,
    } : item);
    await this.prisma.contentPlan.update({
      where: { id: created.id },
      data: { sourceSignals: nextSignals as Prisma.InputJsonValue },
    });
    await this.prisma.auditLog.create({
      data: {
        actor,
        action: "VIDEO_FACTORY_SIMILAR_CREATE",
        entityType: "ContentPlan",
        entityId: created.id,
        before: { sourceProjectId: source.id, outputAssetId: approvedOutput.id },
        after: { targetProductModel, replaceHook: Boolean(input.replaceHook), replaceProduct: Boolean(input.replaceProduct), replaceFeature: Boolean(input.replaceFeature) },
      },
    });

    const generated = await this.generateProject(created.id, {
      candidateIndex: 0,
      routingMode: String(factory.routingMode || "AUTO"),
      requestedModelId: factory.requestedModelId ? String(factory.requestedModelId) : undefined,
      allowFallback: factory.allowFallback !== false,
    }, actor);
    const ready = generated.videoShots?.length
      && generated.videoShots.every((shot) => shot.status === "DONE" && shot.selectedAssetId);
    if (ready) await this.enqueueRender(created.id, actor);
    return this.project(created.id);
  }

  private candidates(plan: { sourceSignals: unknown }): AiVideoCandidate[] {
    const factory = sourceSignals(plan).find((item) => item.type === "VIDEO_FACTORY");
    return Array.isArray(factory?.scriptCandidates) ? factory.scriptCandidates as unknown as AiVideoCandidate[] : [];
  }

  async generateProject(id: string, input: GenerateInput, actor: string) {
    const plan = await this.prisma.contentPlan.findUnique({
      where: { id },
      include: { contentAssets: { include: { asset: { include: { tags: true } } } } },
    });
    if (!plan || plan.kind !== "VIDEO") throw new NotFoundException("智能视频项目不存在");
    const candidates = this.candidates(plan);
    const candidateIndex = Math.max(0, Math.min(candidates.length - 1, Number(input.candidateIndex || 0)));
    const selected = candidates[candidateIndex];
    if (!selected) throw new BadRequestException("项目没有可执行脚本");
    const check = await this.guard.evaluate({
      title: selected.topic,
      body: `${selected.hook}\n${selected.outline.join("\n")}\n${selected.scripts.zh15}\n${selected.scripts.en15}`,
      productModel: plan.productModel || undefined,
      evidenceIds: plan.evidenceIds,
    });
    if (!check.allowed) throw new BadRequestException(`脚本审核未通过：${check.reasons.join("；")}`);

    const assetIds = Array.from(new Set(selected.assetIds));
    const assets = assetIds.length ? await this.prisma.asset.findMany({
      where: {
        id: { in: assetIds },
        purpose: "EDITING_FOOTAGE",
        reviewStatus: "APPROVED",
        availabilityStatus: "ACTIVE",
        rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
        kind: { in: ["VIDEO", "IMAGE"] },
      },
      include: { tags: { include: { tag: true } } },
    }) : [];
    let coverage: Array<{ description: string; matchedAssetIds: string[]; matchedVideoAssetIds: string[]; auxiliaryImageAssetIds: string[]; coverage: "EXISTING" | "MISSING"; reason: string }> = [];
    try {
      coverage = (await this.aiContent.analyzeVideoAssetCoverage({
        productModel: plan.productModel,
        script: selected,
        assets: assets.map((asset) => ({
          id: asset.id,
          kind: asset.kind,
          displayName: asset.displayName,
          description: asset.contentDescription,
          tags: asset.tags.map((item) => item.tag.label),
        })),
      })).shots;
    } catch {
      const videoIds = assets.filter((asset) => asset.kind === "VIDEO").map((asset) => asset.id);
      coverage = selected.outline.map((description, index) => ({
        description,
        matchedAssetIds: videoIds[index] ? [videoIds[index]] : [],
        matchedVideoAssetIds: videoIds[index] ? [videoIds[index]] : [],
        auxiliaryImageAssetIds: [],
        coverage: videoIds[index] ? "EXISTING" : "MISSING",
        reason: videoIds[index] ? "使用已审核真实视频素材" : "缺少匹配的连续视频镜头",
      }));
    }
    if (!coverage.length) throw new BadRequestException("未能生成分镜素材清单");

    const signals = sourceSignals(plan);
    const factorySignal = signals.find((item) => item.type === "VIDEO_FACTORY") || {};
    const routingMode = String(input.routingMode || factorySignal.routingMode || "AUTO").toUpperCase();
    const requestedModelId = String(input.requestedModelId || factorySignal.requestedModelId || "").trim() || undefined;
    const allowFallback = input.allowFallback ?? factorySignal.allowFallback !== false;
    if (coverage.some((shot) => shot.coverage === "MISSING")) {
      await this.resolveModel({ requestedModelId, platform: plan.targetPlatforms[0], scenario: "SCENE", capability: "IMAGE_TO_VIDEO" })
        .catch(async () => this.resolveModel({ requestedModelId, platform: plan.targetPlatforms[0], scenario: "SCENE", capability: "TEXT_TO_VIDEO" }));
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.videoGenerationJob.deleteMany({ where: { contentPlanId: id, status: { in: ["PENDING", "RETRY"] } } });
      await tx.videoShot.deleteMany({ where: { contentPlanId: id } });
      const requirements: Array<Record<string, unknown>> = [];
      for (let index = 0; index < coverage.length; index += 1) {
        const item = coverage[index];
        const requirementKey = `factory-shot-${index + 1}`;
        const selectedAssetId = item.matchedVideoAssetIds[0] || null;
        const shot = await tx.videoShot.create({
          data: {
            contentPlanId: id,
            requirementKey,
            sequence: index,
            title: `镜头${index + 1}`,
            description: item.description,
            moduleType: index === 0 ? "HOOK" : index === coverage.length - 1 ? "CTA" : "SCENE",
            status: selectedAssetId ? "DONE" : "OPEN",
            sourcePreference: selectedAssetId ? "REAL_ASSET" : "AI_GENERATED",
            durationSeconds: 5,
            prompt: item.description,
            assetIds: item.matchedAssetIds,
            selectedAssetId,
            requestedModelId,
            metadata: { reason: item.reason, imageAssetIds: item.auxiliaryImageAssetIds },
          },
        });
        if (!selectedAssetId) {
          await tx.videoGenerationJob.create({
            data: {
              idempotencyKey: `video-shot:${id}:${shot.id}:${candidateIndex}`,
              contentPlanId: id,
              shotId: shot.id,
              routingMode,
              requestedModelId,
              allowFallback,
              prompt: item.description,
              input: {
                platform: plan.targetPlatforms[0],
                productModel: plan.productModel,
                duration: 5,
                ratio: "9:16",
                resolution: "1080P",
                auxiliaryImageAssetIds: item.auxiliaryImageAssetIds,
              },
              createdBy: actor,
            },
          });
        }
        requirements.push({
          id: requirementKey,
          videoFactoryShotId: shot.id,
          description: item.description,
          status: selectedAssetId ? "DONE" : "IN_PROGRESS",
          coverage: selectedAssetId ? "EXISTING" : "MISSING",
          assetIds: item.matchedAssetIds,
          videoAssetIds: item.matchedVideoAssetIds,
          imageAssetIds: item.auxiliaryImageAssetIds,
          reason: item.reason,
          note: selectedAssetId ? "使用已审核真实素材" : "AI生成任务已排队",
        });
      }
      if (assets.length) {
        await tx.contentAsset.createMany({
          data: assets.map((asset) => ({ contentPlanId: id, assetId: asset.id, role: "VIDEO_FACTORY_SOURCE" })),
          skipDuplicates: true,
        });
      }
      const nextSignals = signals.map((item) => item.type === "VIDEO_FACTORY"
        ? { ...item, selectedCandidateIndex: candidateIndex, routingMode, requestedModelId, allowFallback }
        : item);
      await tx.contentPlan.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvedBy: actor,
          approvedAt: new Date(),
          topic: selected.topic,
          audience: selected.audience,
          objective: selected.objective,
          hook: selected.hook,
          outline: selected.outline,
          score: selected.score,
          scoreBreakdown: selected.scoreBreakdown,
          sourceSignals: nextSignals as Prisma.InputJsonValue,
          shootRequirements: requirements as Prisma.InputJsonValue,
          productionStage: requirements.every((item) => item.status === "DONE") ? "READY_TO_EDIT" : "FACTORY_GENERATING",
          masterVideoStatus: "PENDING",
        },
      });
      await tx.auditLog.create({
        data: { actor, action: "VIDEO_FACTORY_PROJECT_GENERATE", entityType: "ContentPlan", entityId: id, after: { candidateIndex, shotCount: coverage.length, routingMode, requestedModelId } },
      });
    });
    return this.project(id);
  }

  async enqueueShot(shotId: string, input: GenerateInput & { prompt?: string; duration?: number }, actor: string) {
    const shot = await this.prisma.videoShot.findUnique({ where: { id: shotId }, include: { contentPlan: true } });
    if (!shot) throw new NotFoundException("视频镜头不存在");
    const requestedModelId = String(input.requestedModelId || shot.requestedModelId || "").trim() || undefined;
    const routingMode = String(input.routingMode || (requestedModelId ? "FIXED" : "AUTO")).toUpperCase();
    const prompt = String(input.prompt || shot.prompt || shot.description).trim();
    const capability = strings(object(shot.metadata).imageAssetIds).length ? "IMAGE_TO_VIDEO" : "TEXT_TO_VIDEO";
    await this.resolveModel({ requestedModelId, platform: shot.contentPlan.targetPlatforms[0], scenario: shot.moduleType, capability });
    const revision = await this.prisma.videoGenerationJob.count({ where: { shotId } });
    const job = await this.prisma.videoGenerationJob.create({
      data: {
        idempotencyKey: `video-shot:${shot.contentPlanId}:${shot.id}:manual:${revision + 1}`,
        contentPlanId: shot.contentPlanId,
        shotId: shot.id,
        routingMode,
        requestedModelId,
        allowFallback: input.allowFallback ?? routingMode === "AUTO",
        prompt,
        input: {
          platform: shot.contentPlan.targetPlatforms[0],
          productModel: shot.contentPlan.productModel,
          duration: Number(input.duration || shot.durationSeconds || 5),
          ratio: "9:16",
          resolution: "1080P",
          auxiliaryImageAssetIds: strings(object(shot.metadata).imageAssetIds),
        },
        createdBy: actor,
      },
    });
    await this.prisma.videoShot.update({ where: { id: shot.id }, data: { status: "GENERATING", prompt, requestedModelId } });
    return job;
  }

  async enqueueRender(id: string, actor: string) {
    let plan = await this.prisma.contentPlan.findUnique({
      where: { id },
      include: { videoShots: { orderBy: { sequence: "asc" }, include: { selectedAsset: true } } },
    });
    if (!plan || plan.kind !== "VIDEO") throw new NotFoundException("智能视频项目不存在");
    if (!plan.videoShots.length) {
      const requirements = Array.isArray(plan.shootRequirements) ? plan.shootRequirements.map(object) : [];
      const assetIds = Array.from(new Set(requirements.flatMap((item) => strings(item.videoAssetIds).length ? strings(item.videoAssetIds) : strings(item.assetIds))));
      const videoAssets = assetIds.length ? await this.prisma.asset.findMany({ where: { id: { in: assetIds }, kind: "VIDEO" }, select: { id: true } }) : [];
      const allowed = new Set(videoAssets.map((asset) => asset.id));
      for (let index = 0; index < requirements.length; index += 1) {
        const item = requirements[index];
        const selectedAssetId = (strings(item.videoAssetIds).length ? strings(item.videoAssetIds) : strings(item.assetIds)).find((assetId) => allowed.has(assetId)) || null;
        await this.prisma.videoShot.upsert({
          where: { contentPlanId_requirementKey: { contentPlanId: id, requirementKey: String(item.id || `legacy-shot-${index + 1}`) } },
          create: {
            contentPlanId: id,
            requirementKey: String(item.id || `legacy-shot-${index + 1}`),
            sequence: index,
            title: `镜头${index + 1}`,
            description: String(item.description || ""),
            status: selectedAssetId ? "DONE" : "OPEN",
            sourcePreference: "REAL_ASSET",
            durationSeconds: 5,
            assetIds: strings(item.assetIds),
            selectedAssetId,
            metadata: { imageAssetIds: strings(item.imageAssetIds), legacy: true },
          },
          update: { selectedAssetId, status: selectedAssetId ? "DONE" : "OPEN" },
        });
      }
      plan = await this.prisma.contentPlan.findUnique({
        where: { id },
        include: { videoShots: { orderBy: { sequence: "asc" }, include: { selectedAsset: true } } },
      });
      if (!plan) throw new NotFoundException("智能视频项目不存在");
    }
    if (!plan.videoShots.length || plan.videoShots.some((shot) => shot.status !== "DONE" || !shot.selectedAssetId)) {
      throw new BadRequestException("仍有镜头未完成或未审核");
    }
    const invalid = plan.videoShots.filter((shot) =>
      !shot.selectedAsset
      || shot.selectedAsset.reviewStatus !== "APPROVED"
      || shot.selectedAsset.availabilityStatus !== "ACTIVE"
      || !["COMMERCIAL", "EDIT_ONLY"].includes(shot.selectedAsset.rightsStatus),
    );
    if (invalid.length) throw new BadRequestException(`有${invalid.length}个镜头素材尚未满足审核和使用条件`);
    const latestReturnedReview = await this.prisma.videoQualityCheck.findFirst({
      where: { contentPlanId: id, checkType: "FINAL_REVIEW", status: "REJECTED" },
      orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }],
    });
    const returnedFindings = Array.isArray(latestReturnedReview?.findings) ? latestReturnedReview.findings : [];
    const revisionFeedback = returnedFindings
      .map((item) => String(object(item).message || "").trim())
      .filter(Boolean)
      .at(-1) || "";
    const revision = await this.prisma.videoRenderJob.count({ where: { contentPlanId: id } });
    const job = await this.prisma.videoRenderJob.create({
      data: {
        idempotencyKey: `video-render:${id}:${revision + 1}`,
        contentPlanId: id,
        renderer: "HYPERFRAMES_FFMPEG",
        input: {
          ratio: "9:16",
          width: 1080,
          height: 1920,
          shotAssetIds: plan.videoShots.map((shot) => shot.selectedAssetId),
          hook: plan.hook,
          topic: plan.topic,
          revisionFeedback,
        },
        createdBy: actor,
      },
    });
    await this.prisma.contentPlan.update({ where: { id }, data: { productionStage: "EDITING", masterVideoStatus: "RUNNING" } });
    return job;
  }

  async archiveProject(id: string, actor: string) {
    const plan = await this.prisma.contentPlan.findUnique({
      where: { id },
      include: {
        videoGenerationJobs: { where: { status: { in: ["PENDING", "RUNNING", "RETRY"] } }, select: { id: true } },
        videoRenderJobs: { where: { status: { in: ["PENDING", "RUNNING", "RETRY"] } }, select: { id: true } },
      },
    });
    if (!plan || plan.kind !== "VIDEO" || !sourceSignals(plan).some((item) => item.type === "VIDEO_FACTORY")) {
      throw new NotFoundException("智能视频项目不存在");
    }
    if (![plan.owner, plan.createdBy, plan.assignedTo].filter(Boolean).includes(actor)) {
      throw new BadRequestException("只能删除自己创建的视频项目");
    }
    if (plan.productionStage === "VIDEO_FACTORY_ARCHIVED") return { id, archived: true };
    if (plan.videoGenerationJobs.length || plan.videoRenderJobs.length) {
      throw new BadRequestException("项目仍有正在生成或剪辑的任务，请等待任务结束后再删除");
    }
    const archivedAt = new Date();
    const purgeAfter = new Date(archivedAt.getTime() + 3 * 24 * 60 * 60 * 1000);
    const nextSignals = sourceSignals(plan).map((item) => item.type === "VIDEO_FACTORY" ? {
      ...item,
      archivedAt: archivedAt.toISOString(),
      purgeAfter: purgeAfter.toISOString(),
      archivedBy: actor,
      previousProductionStage: plan.productionStage,
    } : item);
    await this.prisma.$transaction([
      this.prisma.contentPlan.update({
        where: { id },
        data: {
          productionStage: "VIDEO_FACTORY_ARCHIVED",
          sourceSignals: nextSignals as Prisma.InputJsonValue,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actor,
          action: "VIDEO_FACTORY_PROJECT_ARCHIVE",
          entityType: "ContentPlan",
          entityId: id,
          before: { productionStage: plan.productionStage },
          after: { productionStage: "VIDEO_FACTORY_ARCHIVED", archivedAt, purgeAfter },
        },
      }),
    ]);
    return { id, archived: true, purgeAfter };
  }

  async recycledProjects(actor: string) {
    const rows = await this.prisma.contentPlan.findMany({
      where: {
        kind: "VIDEO",
        productionStage: "VIDEO_FACTORY_ARCHIVED",
        sourceSignals: { array_contains: [{ type: "VIDEO_FACTORY" }] },
        OR: [{ owner: actor }, { createdBy: actor }, { assignedTo: actor }],
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    const now = Date.now();
    const active: Array<Record<string, unknown>> = [];
    for (const plan of rows) {
      const signals = sourceSignals(plan);
      const factory = signals.find((item) => item.type === "VIDEO_FACTORY") || {};
      const purgeAfter = new Date(String(factory.purgeAfter || 0)).getTime();
      if (!purgeAfter || purgeAfter <= now) {
        const nextSignals = signals.map((item) => item.type === "VIDEO_FACTORY"
          ? { ...item, purgedAt: new Date().toISOString() }
          : item);
        await this.prisma.contentPlan.update({
          where: { id: plan.id },
          data: {
            productionStage: "VIDEO_FACTORY_PURGED",
            sourceSignals: nextSignals as Prisma.InputJsonValue,
          },
        });
        continue;
      }
      active.push({
        id: plan.id,
        productionNo: plan.productionNo,
        topic: plan.topic,
        productModel: plan.productModel,
        targetPlatforms: plan.targetPlatforms,
        archivedAt: factory.archivedAt,
        purgeAfter: factory.purgeAfter,
        previousProductionStage: factory.previousProductionStage,
      });
    }
    return active;
  }

  async restoreProject(id: string, actor: string) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id } });
    if (!plan || plan.kind !== "VIDEO" || plan.productionStage !== "VIDEO_FACTORY_ARCHIVED") {
      throw new NotFoundException("回收站中的视频项目不存在");
    }
    if (![plan.owner, plan.createdBy, plan.assignedTo].filter(Boolean).includes(actor)) {
      throw new BadRequestException("只能恢复自己删除的视频项目");
    }
    const signals = sourceSignals(plan);
    const factory = signals.find((item) => item.type === "VIDEO_FACTORY") || {};
    const purgeAfter = new Date(String(factory.purgeAfter || 0)).getTime();
    if (!purgeAfter || purgeAfter <= Date.now()) {
      throw new BadRequestException("该项目已超过3天恢复期限");
    }
    const previousProductionStage = String(factory.previousProductionStage || "FACTORY_SCRIPT_READY");
    const nextSignals = signals.map((item) => {
      if (item.type !== "VIDEO_FACTORY") return item;
      const { archivedAt: _archivedAt, archivedBy: _archivedBy, purgeAfter: _purgeAfter, previousProductionStage: _previous, ...rest } = item;
      return rest;
    });
    await this.prisma.$transaction([
      this.prisma.contentPlan.update({
        where: { id },
        data: {
          productionStage: previousProductionStage,
          sourceSignals: nextSignals as Prisma.InputJsonValue,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actor,
          action: "VIDEO_FACTORY_PROJECT_RESTORE",
          entityType: "ContentPlan",
          entityId: id,
          before: { productionStage: "VIDEO_FACTORY_ARCHIVED" },
          after: { productionStage: previousProductionStage },
        },
      }),
    ]);
    return this.project(id);
  }

  private projectedProductionStage(row: {
    productionStage?: string | null;
    videoRenderJobs?: Array<{ status?: string | null; outputAsset?: { reviewStatus?: string | null } | null }>;
    aiTaskOutputs?: Array<{ kind?: string | null; reviewStatus?: string | null; aiTask?: { status?: string | null } | null }>;
  }) {
    const render = row.videoRenderJobs?.[0];
    const master = render?.outputAsset;
    if (master?.reviewStatus === "APPROVED") return "PLATFORM_PACKAGING";
    if (master?.reviewStatus === "RETURNED") return "READY_TO_EDIT";
    if (render?.status === "SUCCEEDED" && master) return "VIDEO_REVIEW";
    if (render && ["PENDING", "RUNNING", "RETRY"].includes(String(render.status || ""))) return "FACTORY_GENERATING";
    const taskOutput = row.aiTaskOutputs?.find((output) => output.kind === "VIDEO_MASTER") || row.aiTaskOutputs?.[0];
    const taskStatus = String(taskOutput?.aiTask?.status || "");
    if (["CLAIMED", "RUNNING", "QUALITY_CHECK", "UPLOADING", "RETRY"].includes(taskStatus)) return "FACTORY_GENERATING";
    if (taskOutput?.kind === "VIDEO_MASTER" && taskStatus === "PENDING_REVIEW") return "VIDEO_REVIEW";
    return row.productionStage || "FACTORY_SCRIPT_READY";
  }

  async projects(query: { status?: string; platform?: string; productModel?: string; page: number; pageSize?: number }): Promise<{ items: unknown[]; total: number; page: number; pageSize: number }>;
  async projects(query: { status?: string; platform?: string; productModel?: string }): Promise<any[]>;
  async projects(query: { status?: string; platform?: string; productModel?: string; page?: number; pageSize?: number }): Promise<any> {
    const paged = Boolean(query.page || query.pageSize);
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)));
    const where: Prisma.ContentPlanWhereInput = {
      kind: "VIDEO",
      sourceSignals: { array_contains: [{ type: "VIDEO_FACTORY" }] },
      productionStage: query.status ? query.status : { not: "VIDEO_FACTORY_ARCHIVED" },
      ...(query.productModel ? { productModel: query.productModel } : {}),
      ...(query.platform ? { targetPlatforms: { has: integrationKind(query.platform) } } : {}),
    };
    const rows = await this.prisma.contentPlan.findMany({
      where,
      include: {
        variants: { orderBy: { createdAt: "asc" } },
        videoShots: { orderBy: { sequence: "asc" }, include: { selectedAsset: true, generationJobs: { orderBy: { createdAt: "desc" }, take: 1 } } },
        videoGenerationJobs: { orderBy: { createdAt: "desc" }, take: 10, include: { resolvedModel: { include: { provider: true } } } },
        videoRenderJobs: { orderBy: { createdAt: "desc" }, take: 3, include: { outputAsset: true } },
        videoQualityChecks: { orderBy: { createdAt: "desc" }, take: 10 },
        keywordRelations: { include: { keyword: true } },
        aiTaskOutputs: { orderBy: { createdAt: "desc" }, take: 5, include: { aiTask: { select: { taskNo: true, status: true } } } },
        assignedEmployee: true,
      },
      orderBy: { updatedAt: "desc" },
      skip: paged ? (page - 1) * pageSize : undefined,
      take: paged ? pageSize : 100,
    });
    const items = jsonSafe(rows.map((row) => ({
      ...row,
      productionStage: this.projectedProductionStage(row),
      topicCard: topicCardPayload(row),
    })));
    if (!paged) return items;
    const total = await this.prisma.contentPlan.count({ where });
    return { items, total, page, pageSize };
  }

  async project(id: string) {
    const plan = await this.prisma.contentPlan.findUnique({
      where: { id },
      include: {
        variants: true,
        contentAssets: { include: { asset: true } },
        videoShots: {
          orderBy: { sequence: "asc" },
          include: {
            selectedAsset: true,
            requestedModel: { include: { provider: true } },
            generationJobs: { orderBy: { createdAt: "desc" }, include: { resolvedModel: { include: { provider: true } }, attempts: true } },
          },
        },
        videoGenerationJobs: { orderBy: { createdAt: "desc" }, include: { resolvedModel: { include: { provider: true } }, attempts: true, outputAsset: true } },
        videoRenderJobs: { orderBy: { createdAt: "desc" }, include: { outputAsset: true, qualityChecks: true } },
        videoQualityChecks: { orderBy: { createdAt: "desc" } },
        keywordRelations: { include: { keyword: { include: { cluster: true } } } },
        aiTaskOutputs: { orderBy: { createdAt: "desc" }, include: { aiTask: { select: { taskNo: true, status: true } } } },
        assignedEmployee: true,
      },
    });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    return jsonSafe({
      ...plan,
      productionStage: this.projectedProductionStage(plan),
      topicCard: topicCardPayload(plan),
      scriptCandidates: this.candidates(plan),
    });
  }

  async job(id: string) {
    const generation = await this.prisma.videoGenerationJob.findUnique({
      where: { id },
      include: { attempts: true, outputAsset: true, resolvedModel: { include: { provider: true } }, qualityChecks: true },
    });
    if (generation) return jsonSafe({ kind: "GENERATION", ...generation });
    const render = await this.prisma.videoRenderJob.findUnique({
      where: { id },
      include: { outputAsset: true, qualityChecks: true },
    });
    if (render) return jsonSafe({ kind: "RENDER", ...render });
    throw new NotFoundException("视频任务不存在");
  }

  async outputUrl(assetId: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException("视频成品不存在");
    if (asset.objectKey && this.oss.isConfigured()) {
      return { assetId, url: this.oss.signedDownloadUrl(asset.objectKey, 3_600), fileName: asset.fileName };
    }
    return { assetId, url: asset.sourcePath, fileName: asset.fileName };
  }

  async reviewOutput(assetId: string, approved: boolean, actor: string, note = "") {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException("视频成品不存在");
    const generation = await this.prisma.videoGenerationJob.findFirst({
      where: { outputAssetId: assetId },
      include: { shot: true, contentPlan: { select: { sourceSignals: true } } },
    });
    const render = await this.prisma.videoRenderJob.findFirst({ where: { outputAssetId: assetId } });
    if (!generation && !render) throw new BadRequestException("该素材不是视频工厂输出");
    const failedCheck = await this.prisma.videoQualityCheck.findFirst({ where: { assetId, status: "FAILED" } });
    if (approved && failedCheck) throw new BadRequestException("自动质检未通过，不能批准使用");
    const finalReview = await this.prisma.videoQualityCheck.findFirst({
      where: { assetId, checkType: "FINAL_REVIEW" },
      orderBy: { createdAt: "desc" },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id: assetId },
        data: approved
          ? { reviewStatus: "APPROVED", availabilityStatus: "ACTIVE", rightsStatus: "COMMERCIAL", status: "READY", reviewedBy: actor, reviewedAt: new Date(), indexNeedsReview: false }
          : { reviewStatus: "RETURNED", availabilityStatus: "INACTIVE", status: "PENDING", reviewedBy: actor, reviewedAt: new Date() },
      });
      if (generation?.shotId) {
        await tx.videoShot.update({
          where: { id: generation.shotId },
          data: approved
            ? { status: "DONE", selectedAssetId: assetId, assetIds: { push: assetId } }
            : { status: "OPEN", selectedAssetId: null },
        });
        if (approved) {
          await tx.contentAsset.createMany({
            data: [{ contentPlanId: generation.contentPlanId, assetId, role: "AI_GENERATED_SHOT" }],
            skipDuplicates: true,
          });
          const factorySignal = sourceSignals(generation.contentPlan).find((item) => item.type === "VIDEO_FACTORY");
          const assetGapTaskId = String(factorySignal?.assetGapTaskId || "");
          if (assetGapTaskId) {
            await tx.opsTask.updateMany({
              where: { id: assetGapTaskId, sourceType: "AI_ASSET_GAP", status: { not: "DONE" } },
              data: {
                status: "DONE",
                completedAt: new Date(),
                completedBy: actor,
                result: `AI生成素材${asset.assetNo}已审核通过并进入素材库`,
              },
            });
          }
        }
      }
      if (render) {
        await tx.contentPlan.update({
          where: { id: render.contentPlanId },
          data: approved
            ? { masterVideoStatus: "APPROVED", productionStage: "PLATFORM_PACKAGING" }
            : { masterVideoStatus: "RETURNED", productionStage: "EDITING" },
        });
      }
      const reviewedAt = new Date();
      await tx.videoQualityCheck.updateMany({
        where: { assetId, status: { in: ["PENDING", "REVIEW_REQUIRED"] } },
        data: { status: approved ? "PASSED" : "REJECTED", reviewedBy: actor, reviewedAt },
      });
      if (finalReview) {
        const findings = Array.isArray(finalReview.findings) ? finalReview.findings : [];
        await tx.videoQualityCheck.update({
          where: { id: finalReview.id },
          data: {
            status: approved ? "PASSED" : "REJECTED",
            reviewedBy: actor,
            reviewedAt,
            findings: [
              ...findings,
              {
                type: approved ? "EMPLOYEE_APPROVAL" : "EMPLOYEE_RETURN",
                message: note || (approved ? "员工审核通过" : "员工退回修改"),
                actor,
                reviewedAt: reviewedAt.toISOString(),
              },
            ],
          },
        });
      }
      await tx.auditLog.create({
        data: { actor, action: approved ? "VIDEO_FACTORY_OUTPUT_APPROVE" : "VIDEO_FACTORY_OUTPUT_RETURN", entityType: "Asset", entityId: assetId, after: { note } },
      });
    });
    if (generation?.contentPlanId) await this.syncCompatibility(generation.contentPlanId);
    return this.project(generation?.contentPlanId || render!.contentPlanId);
  }

  async syncCompatibility(contentPlanId: string) {
    const plan = await this.prisma.contentPlan.findUnique({
      where: { id: contentPlanId },
      include: { videoShots: { orderBy: { sequence: "asc" }, include: { generationJobs: { orderBy: { createdAt: "desc" }, take: 1 } } } },
    });
    if (!plan) return;
    const requirements = plan.videoShots.map((shot) => {
      const job = shot.generationJobs[0];
      return {
        id: shot.requirementKey,
        videoFactoryShotId: shot.id,
        description: shot.description,
        status: shot.status === "DONE" ? "DONE" : shot.status === "PENDING_REVIEW" ? "IN_PROGRESS" : shot.status === "GENERATING" ? "IN_PROGRESS" : "OPEN",
        coverage: shot.selectedAssetId ? "EXISTING" : "MISSING",
        assetIds: shot.assetIds,
        videoAssetIds: shot.selectedAssetId ? [shot.selectedAssetId] : [],
        imageAssetIds: strings(object(shot.metadata).imageAssetIds),
        note: shot.status === "PENDING_REVIEW" ? "AI素材待审核" : shot.status === "DONE" ? "镜头素材已确认" : "等待素材",
        aiGeneration: job ? {
          taskId: job.id,
          status: job.status,
          prompt: job.prompt,
          duration: Number(object(job.input).duration || 5),
          model: job.resolvedModelId || job.requestedModelId || "AUTO",
          assetId: job.outputAssetId,
          failureReason: job.failureReason,
          requestedAt: job.createdAt.toISOString(),
          completedAt: job.finishedAt?.toISOString(),
        } : undefined,
      };
    });
    const allDone = requirements.length > 0 && requirements.every((item) => item.status === "DONE");
    await this.prisma.contentPlan.update({
      where: { id: contentPlanId },
      data: {
        shootRequirements: requirements as Prisma.InputJsonValue,
        productionStage: allDone ? "READY_TO_EDIT" : "FACTORY_GENERATING",
      },
    });
  }
}
