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

type JsonRow = Record<string, unknown>;

type ProjectCreateInput = {
  platform?: string;
  voiceoverMode?: string;
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
      scripts: {
        zh15: noVoiceover ? `无口播字幕：${keyword}｜真实场景｜核心卖点｜查看详情` : `${pattern.hook}。结合真实使用场景，展示已审核的产品价值。`,
        en15: noVoiceover ? `${keyword} | Real scene | Key benefit | Learn more` : `${keyword}. A real-life look using approved product facts.`,
        zh30: noVoiceover ? `无口播字幕节奏：痛点大字｜产品动作｜功能亮点｜使用场景｜行动引导` : `${pattern.hook}。通过真实素材说明使用场景、产品价值和操作方式，最后引导查看详情。`,
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
      },
      orderBy: { updatedAt: "desc" },
      skip: paged ? (page - 1) * pageSize : undefined,
      take: paged ? pageSize : 100,
    });
    const items = jsonSafe(rows);
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
      },
    });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    return jsonSafe({ ...plan, scriptCandidates: this.candidates(plan) });
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
