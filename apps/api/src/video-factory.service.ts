import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ContentStatus, IntegrationKind, JobStatus, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { AiContentService, type AiVideoCandidate } from "./ai-content.service";
import { opsConfig } from "./config";
import { ContentGuardService } from "./content-guard.service";
import { decryptIntegrationValue, encryptIntegrationValue } from "./integration-secret";
import { OssStorageService } from "./oss-storage.service";
import { PrismaService } from "./prisma.service";
import { localDateKey } from "./utils";
import { WecomNotificationService } from "./wecom-notification.service";
import { canonicalVideoShotKey, validateVideoMasterMetadata } from "./video-output-validation";
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
  projectMode?: "STANDARD" | "REFERENCE_DIRECT_FULL_VIDEO" | "CODEX_DIRECT_FULL_VIDEO" | "BATCH_CODEX_DIRECT_FULL_VIDEO";
  referenceVideoUrl?: string;
  referenceDirectTaskRequirement?: string;
  referenceAudioStrategy?: "REFERENCE_ORIGINAL" | "DOUBAO_REVOICE";
  referenceVisualStrategy?: "REBUILD_PRODUCT_VISUALS" | "REUSE_REFERENCE_VISUALS";
  referenceDirectChangeSet?: Record<string, unknown>;
  platform?: string;
  voiceoverMode?: string;
  accountType?: string;
  estimatedDurationSeconds?: number;
  contentRestrictionMode?: string;
  generationMode?: string;
  scriptSource?: string;
  userProvidedDirections?: Array<{ index?: number; title?: string; content?: string }>;
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
  allowExternalGeneration?: boolean;
  deferScriptGeneration?: boolean;
  healthContentAllowed?: boolean;
  soundPrompt?: string;
  mustShowFacts?: string;
  additionalPrompt?: string;
  videoType?: string;
  keywords?: string;
  reference?: string;
  hook?: string;
  scene?: string;
  painPoint?: string;
  scriptEngines?: string[];
  batchProducts?: Array<{ model: string; count: number }>;
  batchVoiceoverSplit?: "HALF" | "ALL" | "NONE";
  batchBgmVariety?: boolean;
  batchVoiceVariety?: boolean;
  batchGenerateCoverTitle?: boolean;
  batchTaskRequirement?: string;
  libraryEntryId?: string;
  libraryReuseMode?: "CONFIG_REUSE" | "REFERENCE_DIRECT";
  targetLanguage?: "ZH" | "EN" | "OTHER";
  referenceAssetId?: string;
};

type GenerateInput = {
  candidateIndex?: number;
  requestedModelId?: string;
  routingMode?: string;
  allowFallback?: boolean;
  allowExternalGeneration?: boolean;
  prepareOnly?: boolean;
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
  allowExternalGeneration?: boolean;
  requestedModelId?: string;
};

const PROVIDER_SEEDS = [
  {
    code: "VOLCENGINE_SEEDANCE",
    displayName: "火山方舟 · Seedance 2.0",
    region: "CN",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO", "REFERENCE_TO_VIDEO", "NATIVE_AUDIO"],
    priority: 5,
    publicConfig: { adapter: "SEEDANCE_2", generateAudio: true, watermark: false },
  },
  {
    code: "BAILIAN_WAN",
    displayName: "阿里百炼 · Wan",
    region: "CN",
    baseUrl: "https://dashscope.aliyuncs.com",
    capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO", "REFERENCE_TO_VIDEO"],
    priority: 10,
    publicConfig: {},
  },
  {
    code: "RUNWAY",
    displayName: "Runway",
    region: "GLOBAL",
    baseUrl: "https://api.dev.runwayml.com",
    capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO", "VIDEO_EDIT"],
    priority: 20,
    publicConfig: {},
  },
  {
    code: "HEYGEN",
    displayName: "HeyGen",
    region: "GLOBAL",
    baseUrl: "https://api.heygen.com",
    capabilities: ["AVATAR", "TEXT_TO_VIDEO", "NATIVE_AUDIO"],
    priority: 30,
    publicConfig: {},
  },
  {
    code: "OPENAI_VIDEOS",
    displayName: "OpenAI Videos",
    region: "GLOBAL",
    baseUrl: "https://api.openai.com/v1",
    capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO", "VIDEO_EDIT"],
    priority: 40,
    publicConfig: {},
  },
  {
    code: "GOOGLE_VEO",
    displayName: "Google Veo",
    region: "GLOBAL",
    baseUrl: "https://generativelanguage.googleapis.com",
    capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO", "REFERENCE_TO_VIDEO"],
    priority: 50,
    publicConfig: {},
  },
  {
    code: "KLING",
    displayName: "可灵",
    region: "CN",
    baseUrl: "https://api-beijing.klingai.com",
    capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO", "VIDEO_EDIT"],
    priority: 60,
    publicConfig: { adapter: "KLING_API_2", endpointModel: "kling-3.0-turbo", watermark: false },
  },
  {
    code: "CUSTOM_HTTP",
    displayName: "自定义HTTP模型",
    region: "GLOBAL",
    baseUrl: null,
    capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO"],
    priority: 100,
    publicConfig: {},
  },
] as const;

const MODEL_SEEDS = [
  { provider: "VOLCENGINE_SEEDANCE", code: "doubao-seedance-2-0-260128", name: "Seedance 2.0", capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO", "REFERENCE_TO_VIDEO", "NATIVE_AUDIO"], durations: [4, 5, 8, 10, 12, 15], resolutions: ["480P", "720P", "1080P"], tags: ["DOUYIN", "FAMILY", "PRODUCT", "BRAND", "CN"] },
  { provider: "BAILIAN_WAN", code: "wan2.5-t2v-preview", name: "Wan 文生视频", capabilities: ["TEXT_TO_VIDEO"], durations: [5, 10], resolutions: ["480P"], tags: ["DOUYIN", "CN"] },
  { provider: "BAILIAN_WAN", code: "wan2.5-i2v-preview", name: "Wan 图生视频", capabilities: ["IMAGE_TO_VIDEO"], durations: [5, 10], resolutions: ["480P"], tags: ["DOUYIN", "PRODUCT", "CN"] },
  { provider: "RUNWAY", code: "gen4_turbo", name: "Runway Gen-4 Turbo", capabilities: ["IMAGE_TO_VIDEO"], durations: [5, 10], resolutions: ["720P"], tags: ["TIKTOK", "UGC", "GLOBAL"] },
  { provider: "RUNWAY", code: "gen4.5", name: "Runway Gen-4.5", capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO"], durations: [5, 10], resolutions: ["720P"], tags: ["TIKTOK", "BRAND", "GLOBAL"] },
  { provider: "HEYGEN", code: "avatar-v3", name: "HeyGen Avatar", capabilities: ["AVATAR", "NATIVE_AUDIO"], durations: [15, 30], resolutions: ["1080P"], tags: ["FAQ", "TUTORIAL", "GLOBAL"] },
  { provider: "OPENAI_VIDEOS", code: "sora-2", name: "OpenAI Sora 2", capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO"], durations: [4, 8, 12], resolutions: ["720P"], tags: ["CREATIVE", "GLOBAL"] },
  { provider: "GOOGLE_VEO", code: "veo-3.1-fast-generate-001", name: "Google Veo 3.1 Fast", capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO"], durations: [8], resolutions: ["720P", "1080P"], tags: ["BRAND", "GLOBAL"] },
  { provider: "KLING", code: "kling-video", name: "可灵 3.0 Turbo", capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO"], durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolutions: ["720P", "1080P"], tags: ["DOUYIN", "UGC", "HUMAN_ACTION", "CN"] },
] as const;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function object(value: unknown): JsonRow {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRow : {};
}

function parsedBodyValue(value: unknown) {
  if (typeof value !== "string") return value;
  const source = value.trim();
  if (!source) return undefined;
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new BadRequestException("成片证据字段不是有效JSON");
  }
}

function cleanVoiceoverText(value: unknown) {
  return String(value || "")
    .replace(/\[(?:C\d+-)?L\d+\]\s*/gi, "")
    .replace(/健康监测数据仅供日常健康管理参考[。.]?/g, "")
    .trim();
}

function comparableScriptText(value: unknown) {
  return cleanVoiceoverText(value).replace(/[\s，。！？；：,.!?;:、“”‘’"'（）()]/g, "");
}

function packageCodexCandidate(candidate: VideoScriptCandidateV3, context: {
  productModel: string;
  platform: string;
  audience: string;
  objective: string;
  accountType: string;
  estimatedDurationSeconds: number;
  healthContentAllowed: boolean;
}) {
  const current = object(candidate.scriptPackage);
  const currentVoiceover = Array.isArray(current.voiceoverLines) ? current.voiceoverLines.map(object) : [];
  const scriptLines = String(candidate.script || "")
    .split(/\r?\n/)
    .map(cleanVoiceoverText)
    .filter(Boolean);
  const sourceLines = currentVoiceover.length
    ? currentVoiceover.map((line) => cleanVoiceoverText(line.text)).filter(Boolean)
    : candidate.shots.map((shot) => cleanVoiceoverText(shot.voiceover)).filter(Boolean);
  const voiceTexts = sourceLines.length ? sourceLines : scriptLines;
  const voiceoverLines = voiceTexts.map((line, index) => {
    const previous = currentVoiceover[index] || {};
    return {
      lineId: String(previous.lineId || candidate.shots[index]?.lineId || `line_${String(index + 1).padStart(2, "0")}`),
      text: line,
      tone: String(previous.tone || "亲切自然"),
      speed: String(previous.speed || "自然短句"),
      emotion: String(previous.emotion || "真诚"),
      durationSeconds: number(previous.durationSeconds, candidate.shots[index]?.durationSeconds || 3),
    };
  });
  const currentRequirements = Array.isArray(current.shotRequirements) ? current.shotRequirements.map(object) : [];
  const shotRequirements = voiceoverLines.map((line, index) => {
    const previous = currentRequirements.find((item) => String(item.lineId || "") === line.lineId)
      || currentRequirements[index]
      || {};
    const shot = candidate.shots[index];
    const matchedVideoAssetIds = strings(previous.matchedVideoAssetIds).length
      ? strings(previous.matchedVideoAssetIds)
      : strings(shot?.selectedAssetIds);
    const auxiliaryImageAssetIds = strings(previous.auxiliaryImageAssetIds).length
      ? strings(previous.auxiliaryImageAssetIds)
      : strings(object(shot).auxiliaryImageAssetIds);
    return {
      lineId: line.lineId,
      line: line.text,
      visual: String(previous.visual || shot?.visual || shot?.description || ""),
      assetStatus: String(previous.assetStatus || (matchedVideoAssetIds.length ? "COVERED" : "NEED_SHOOT")),
      factualProof: String(previous.factualProof || shot?.visibleFacts?.join("；") || ""),
      audioVisualRequirement: String(previous.audioVisualRequirement || shot?.missingReason || shot?.alternativePlan || ""),
      matchedVideoAssetIds,
      auxiliaryImageAssetIds,
    };
  });
  const positioning = object(current.positioning);
  const goldenHook = object(current.goldenHook);
  const ending = object(current.ending);
  return {
    ...candidate,
    script: voiceoverLines.map((line) => line.text).join("\n"),
    scriptPackage: {
      ...current,
      basicInfo: {
        ...object(current.basicInfo),
        productModel: context.productModel,
        videoType: "VOICEOVER",
        platform: context.platform,
        accountType: context.accountType,
        targetAudience: context.audience,
        estimatedDurationSeconds: context.estimatedDurationSeconds,
        healthContentAllowed: context.healthContentAllowed,
      },
      positioning: {
        coreTheme: String(positioning.coreTheme || candidate.title),
        communicationGoal: String(positioning.communicationGoal || context.objective),
        userPainPoint: String(positioning.userPainPoint || ""),
        uniqueSellingPoint: String(positioning.uniqueSellingPoint || ""),
      },
      goldenHook: {
        copy: String(goldenHook.copy || candidate.hook),
        type: String(goldenHook.type || candidate.templateCode),
        visual: String(goldenHook.visual || candidate.shots[0]?.visual || ""),
        retentionReason: String(goldenHook.retentionReason || ""),
        openingSound: String(goldenHook.openingSound || ""),
      },
      voiceoverLines,
      structure: Array.isArray(current.structure) ? current.structure : [],
      shotRequirements,
      retentionDesign: strings(current.retentionDesign),
      subtitles: strings(current.subtitles).length
        ? strings(current.subtitles)
        : voiceoverLines.map((line) => line.text.replace(/[，。！？；：,.!?;:]/g, "")),
      emphasisTexts: strings(current.emphasisTexts),
      soundDesign: object(current.soundDesign),
      complianceChecks: Array.isArray(current.complianceChecks) ? current.complianceChecks : [],
      ending: {
        summary: String(ending.summary || candidate.cta),
        interaction: String(ending.interaction || candidate.cta),
        visual: String(ending.visual || candidate.shots.at(-1)?.visual || ""),
        safeTailSeconds: number(ending.safeTailSeconds, 0.35),
      },
      materialGaps: Array.isArray(current.materialGaps) ? current.materialGaps : candidate.missingAssets,
      overlayNotice: String(current.overlayNotice || (context.healthContentAllowed ? "健康监测数据仅供日常健康管理参考" : "")),
    },
  };
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)) as T;
}

function integrationKind(value?: string): IntegrationKind {
  const supported = new Set<IntegrationKind>([
    IntegrationKind.DOUYIN,
    IntegrationKind.TIKTOK,
    IntegrationKind.XIAOHONGSHU,
    IntegrationKind.BILIBILI,
    IntegrationKind.WECHAT_CHANNELS,
    IntegrationKind.KUAISHOU,
  ]);
  const candidate = String(value || "").toUpperCase() as IntegrationKind;
  return supported.has(candidate) ? candidate : IntegrationKind.DOUYIN;
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

function materialBindingFingerprint(shots: Array<{
  requirementKey: string;
  sequence: number;
  selectedAssetId: string | null;
  metadata: unknown;
}>) {
  return shots
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .map((shot) => {
      const metadata = object(shot.metadata);
      return [
        shot.requirementKey,
        shot.selectedAssetId || "",
        String(metadata.sourceIn ?? ""),
        String(metadata.sourceOut ?? ""),
      ].join(":");
    })
    .join("|");
}

function douyinViralModelScenario(description: unknown) {
  const text = String(description || "");
  return /(佩戴|抬腕|手势|手部动作|腕部动作|人物动作|真人动作|走路|跑步|运动动作)/u.test(text)
    ? "DOUYIN_VIRAL_ACTION"
    : "DOUYIN_VIRAL";
}

export function materialReviewApproved(plan: { sourceSignals: unknown; workflowVersion: number }, fingerprint?: string) {
  const factory = sourceSignals(plan).find((item) => item.type === "VIDEO_FACTORY") || {};
  const review = object(factory.materialReview);
  return review.status === "APPROVED"
    && Number(review.workflowVersion) === plan.workflowVersion
    && (!fingerprint || String(review.bindingFingerprint || "") === fingerprint);
}

export function partitionVideoShotAssetIds(
  selectedAssetIds: string[],
  auxiliaryImageAssetIds: string[],
  assets: Array<{ id: string; kind: string | null }>,
) {
  const kindById = new Map(assets.map((asset) => [asset.id, asset.kind]));
  const matchedVideoAssetIds = selectedAssetIds.filter((id) => kindById.get(id) === "VIDEO");
  const imageAssetIds = selectedAssetIds.filter((id) => kindById.get(id) === "IMAGE");
  return {
    matchedVideoAssetIds,
    auxiliaryImageAssetIds: Array.from(new Set([...auxiliaryImageAssetIds, ...imageAssetIds])),
  };
}

export function videoFactoryModule(plan: { sourceSignals: unknown }) {
  const signals = sourceSignals(plan);
  const topicModule = topicCardPayload(plan)?.factoryModule;
  const factoryModule = String(signals.find((item) => item.type === "VIDEO_FACTORY")?.factoryModule || "");
  return topicModule === "DOUYIN_VIRAL" || factoryModule === "DOUYIN_VIRAL"
    ? "DOUYIN_VIRAL"
    : "GENERAL_VIDEO_FACTORY";
}

export function videoRenderJobIsStale(
  plan: { sourceSignals: unknown },
  job: { status: string; startedAt: Date | null },
  now = new Date(),
) {
  if (job.status !== "RUNNING" || !job.startedAt) return false;
  const timeoutMs = videoFactoryModule(plan) === "DOUYIN_VIRAL" ? 10 * 60_000 : 35 * 60_000;
  return now.getTime() - job.startedAt.getTime() >= timeoutMs;
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
  private readonly systemScriptJobs = new Set<string>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiContent: AiContentService,
    private readonly guard: ContentGuardService,
    private readonly oss: OssStorageService,
    private readonly wecom: WecomNotificationService,
  ) {}

  private librarySnapshot(
    plan: { topic: string; productModel?: string | null; audience: string; objective: string; hook: string; createdBy: string; targetPlatforms: IntegrationKind[]; sourceSignals: unknown },
    output: { videoKey?: string; title?: string; tags?: string[]; reusableTaskRequirement?: string } = {},
  ) {
    const factory = sourceSignals(plan).find((item) => item.type === "VIDEO_FACTORY") || {};
    const brief = object(factory.brief);
    return {
      prompt: String(brief.additionalPrompt || plan.objective || ""),
      taskRequirement: String(output.reusableTaskRequirement || brief.additionalPrompt || plan.objective || ""),
      taskSummary: String(output.reusableTaskRequirement || ""),
      videoKey: String(output.videoKey || ""),
      tags: output.tags || [],
      reference: String(brief.reference || ""),
      project: {
        topic: plan.topic,
        productModel: plan.productModel || "",
        audience: plan.audience,
        objective: plan.objective,
        hook: plan.hook,
        platform: plan.targetPlatforms[0] || "DOUYIN",
        voiceoverMode: String(factory.voiceoverMode || "AUTO"),
        videoType: String(brief.videoType || ""),
        keywords: String(brief.keywords || ""),
        scene: String(brief.scene || ""),
        painPoint: String(brief.painPoint || ""),
        additionalPrompt: String(brief.additionalPrompt || ""),
      },
    };
  }

  private async upsertLibraryEntry(
    tx: Prisma.TransactionClient,
    plan: { id: string; topic: string; productModel?: string | null; audience: string; objective: string; hook: string; createdBy: string; targetPlatforms: IntegrationKind[]; sourceSignals: unknown },
    assetId: string,
    renderJobId: string | undefined,
    actor: string,
    renderInput: unknown = {},
  ) {
    const factory = sourceSignals(plan).find((item) => item.type === "VIDEO_FACTORY") || {};
    const brief = object(factory.brief);
    const batch = object(brief.batchDirect);
    const videoKey = String(object(renderInput).videoKey || "").trim();
    const batchProducts = Array.isArray(batch.products) ? batch.products.map(object) : [];
    const batchResult = (Array.isArray(batch.results) ? batch.results.map(object) : [])
      .find((item) => String(item.videoKey || "").trim() === videoKey) || {};
    const productIndex = Math.max(0, Number(videoKey.split("-")[0]) - 1);
    const outputProductModel = String(batchProducts[productIndex]?.model || "").split(" · ")[0].trim()
      || plan.productModel
      || "";
    const outputTitle = String(batchResult.title || plan.topic || "").trim() || plan.topic;
    const outputTags = strings(batchResult.tags);
    const reusableTaskRequirement = batchProducts.length
      ? [
        String(batch.taskRequirement || "").trim(),
        String(batch.additionalPrompt || brief.additionalPrompt || "").trim(),
        `审核成品标题：${outputTitle}`,
        outputTags.length ? `审核标签：${outputTags.join("、")}` : "",
      ].filter(Boolean).join("\n")
      : String(brief.additionalPrompt || plan.objective || "").trim();
    const snapshot = this.librarySnapshot(
      { ...plan, topic: outputTitle, productModel: outputProductModel },
      { videoKey, title: outputTitle, tags: outputTags, reusableTaskRequirement },
    );
    const product = outputProductModel
      ? await tx.product.findUnique({ where: { modelCode: outputProductModel }, select: { category: true } })
      : null;
    await tx.contentLibraryEntry.upsert({
      where: { contentPlanId_outputAssetId: { contentPlanId: plan.id, outputAssetId: assetId } },
      create: {
        contentPlanId: plan.id,
        outputAssetId: assetId,
        renderJobId,
        title: outputTitle,
        productModel: outputProductModel || null,
        productCategory: product?.category || null,
        platform: String(plan.targetPlatforms[0] || "DOUYIN"),
        createdBy: plan.createdBy,
        snapshot: snapshot as Prisma.InputJsonValue,
      },
      update: {
        title: outputTitle,
        productModel: outputProductModel || null,
        productCategory: product?.category || null,
        platform: String(plan.targetPlatforms[0] || "DOUYIN"),
        createdBy: plan.createdBy,
        snapshot: snapshot as Prisma.InputJsonValue,
        visibilityStatus: "ACTIVE",
        hiddenAt: null,
        hiddenBy: null,
        hiddenWithProject: false,
      },
    });
    await tx.auditLog.create({
      data: { actor, action: "VIDEO_LIBRARY_ENTRY_UPSERT", entityType: "ContentLibraryEntry", entityId: `${plan.id}:${assetId}`, after: { contentPlanId: plan.id, assetId } },
    });
  }

  private async notifyProjectMilestone(
    contentPlanId: string,
    milestone: string,
    title: string,
    content: string,
  ) {
    const task = await this.prisma.opsTask.findFirst({
      where: {
        sourceType: "VIDEO_PROJECT",
        sourceId: contentPlanId,
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, assigneeEmployeeId: true },
    });
    if (!task?.assigneeEmployeeId) return;
    const plan = await this.prisma.contentPlan.findUnique({
      where: { id: contentPlanId },
      select: { workflowVersion: true },
    });
    const eventKey = `${contentPlanId}:${milestone}:v${plan?.workflowVersion || 1}`;
    await this.prisma.taskNotification.upsert({
      where: {
        recipientEmployeeId_channel_eventKey: {
          recipientEmployeeId: task.assigneeEmployeeId,
          channel: "IN_APP",
          eventKey,
        },
      },
      create: {
        taskId: task.id,
        recipientEmployeeId: task.assigneeEmployeeId,
        channel: "IN_APP",
        eventKey,
        targetType: "OPS_TASK",
        targetId: task.id,
        type: milestone,
        title,
        content,
      },
      update: { title, content, taskId: task.id, targetType: "OPS_TASK", targetId: task.id },
    });
    const workbenchUrl = new URL("/saidian-work/", opsConfig.publicBaseUrl);
    workbenchUrl.searchParams.set("taskId", task.id);
    const result = await this.wecom.send(task.assigneeEmployeeId, title, content, workbenchUrl.toString());
    if (!result.configured) return;
    await this.prisma.taskNotification.upsert({
      where: {
        recipientEmployeeId_channel_eventKey: {
          recipientEmployeeId: task.assigneeEmployeeId,
          channel: "WECOM",
          eventKey,
        },
      },
      create: {
        taskId: task.id,
        recipientEmployeeId: task.assigneeEmployeeId,
        channel: "WECOM",
        eventKey,
        targetType: "OPS_TASK",
        targetId: task.id,
        type: milestone,
        title,
        content: result.sent ? content : `${content}｜${result.message || "发送失败"}`,
        sentAt: result.sent ? new Date() : null,
      },
      update: {
        title,
        content: result.sent ? content : `${content}｜${result.message || "发送失败"}`,
        sentAt: result.sent ? new Date() : null,
      },
    });
  }

  private async preMatchScriptCandidate(
    candidate: AiVideoCandidate,
    assets: Array<{
      id: string;
      kind: string | null;
      displayName: string | null;
      contentDescription: string | null;
      tags: Array<{ tag: { label: string } }>;
    }>,
  ) {
    const scriptPackage = object(candidate.scriptPackage) as Record<string, any>;
    const voiceoverLines = Array.isArray(scriptPackage.voiceoverLines)
      ? scriptPackage.voiceoverLines as Array<Record<string, any>>
      : [];
    const shotRequirements = Array.isArray(scriptPackage.shotRequirements)
      ? scriptPackage.shotRequirements as Array<Record<string, any>>
      : [];
    const descriptions = (shotRequirements.length ? shotRequirements : candidate.outline.map((line) => ({ line, visual: line })))
      .map((item, index) => String(item.visual || item.line || voiceoverLines[index]?.text || candidate.outline[index] || "").trim())
      .filter(Boolean);
    const analysisAssets = assets.map((asset) => ({
      id: asset.id,
      kind: String(asset.kind || ""),
      displayName: asset.displayName,
      description: asset.contentDescription,
      tags: asset.tags.map((item) => item.tag.label),
    }));
    const assetKinds = new Map(analysisAssets.map((asset) => [asset.id, asset.kind]));
    let coverage: Array<{
      description: string;
      matchedAssetIds: string[];
      matchedVideoAssetIds: string[];
      auxiliaryImageAssetIds: string[];
      coverage: "EXISTING" | "MISSING";
      reason: string;
    }> = [];
    const needsCoverageFallback = descriptions.some((_, index) =>
      !strings(shotRequirements[index]?.matchedVideoAssetIds)
        .some((assetId) => assetKinds.get(assetId) === "VIDEO"));
    if (needsCoverageFallback) {
      try {
        coverage = (await this.aiContent.analyzeVideoAssetCoverage({
          productModel: scriptPackage.basicInfo?.productModel,
          script: candidate,
          assets: analysisAssets,
        })).shots;
      } catch {
        coverage = descriptions.map((description) => ({
          description,
          matchedAssetIds: [],
          matchedVideoAssetIds: [],
          auxiliaryImageAssetIds: [],
          coverage: "MISSING" as const,
          reason: "素材索引暂未找到可直接证明该句内容的连续视频镜头",
        }));
      }
    }
    const usedVideoAssetIds = new Set<string>();
    const shots = descriptions.map((description, index) => {
      const matched = coverage[index] || coverage.find((item) => item.description === description);
      const requirement = shotRequirements[index] || {};
      const line = String(requirement.line || voiceoverLines[index]?.text || candidate.outline[index] || description);
      // 脚本生成模型已经基于持久化素材索引选出了真实 assetId。
      // 这些逐句绑定是第一优先级；二次覆盖分析只为模型未返回有效 ID 的句子兜底，
      // 不能把脚本阶段已经选准的素材覆盖掉。
      const generatedVideoAssetIds = strings(requirement.matchedVideoAssetIds)
        .filter((assetId) => assetKinds.get(assetId) === "VIDEO");
      const generatedImageAssetIds = strings(requirement.auxiliaryImageAssetIds)
        .filter((assetId) => assetKinds.get(assetId) === "IMAGE");
      const preferredVideoAssetIds = generatedVideoAssetIds.length
        ? generatedVideoAssetIds
        : strings(matched?.matchedVideoAssetIds).filter((assetId) => assetKinds.get(assetId) === "VIDEO");
      const duplicatedVideoAssetIds = preferredVideoAssetIds.filter((assetId) => usedVideoAssetIds.has(assetId));
      const selectedAssetIds = preferredVideoAssetIds.filter((assetId) => {
        if (usedVideoAssetIds.has(assetId)) return false;
        usedVideoAssetIds.add(assetId);
        return true;
      });
      const auxiliaryImageAssetIds = generatedImageAssetIds.length
        ? generatedImageAssetIds
        : strings(matched?.auxiliaryImageAssetIds).filter((assetId) => assetKinds.get(assetId) === "IMAGE");
      const materialMatchReason = duplicatedVideoAssetIds.length && !selectedAssetIds.length
        ? "该视频素材已绑定到前一句口播；为避免重复画面，本句改为待补齐"
        : generatedVideoAssetIds.length
        ? String(requirement.factualProof || requirement.audioVisualRequirement || "脚本生成阶段已按素材索引返回并绑定真实视频素材ID")
        : String(matched?.reason || "");
      return {
        lineId: String(requirement.lineId || `line_${String(index + 1).padStart(2, "0")}`),
        sequence: index,
        title: `镜头${index + 1}`,
        description,
        visual: description,
        voiceover: line,
        subtitle: line.replace(/[，。！？；：,.!?;:]/g, ""),
        moduleType: index === 0 ? "HOOK" : index === descriptions.length - 1 ? "CTA" : "SCENE",
        durationSeconds: Math.max(2, Math.round(Number(voiceoverLines[index]?.durationSeconds) || 4)),
        sourcePreference: selectedAssetIds.length ? "REAL_ASSET" : "REAL_ASSET_FIRST",
        selectedAssetIds,
        auxiliaryImageAssetIds,
        requiredAssetTags: [],
        missingReason: selectedAssetIds.length
          ? ""
          : duplicatedVideoAssetIds.length
            ? "该视频素材已用于前一句口播，需要不同的直接画面"
            : matched?.reason || "缺少直接匹配的视频素材",
        alternativePlan: selectedAssetIds.length ? "" : "可由真人补拍或调用AI生成，并绑定到本句脚本",
        materialMatchReason,
        materialMatchStatus: selectedAssetIds.length ? "COVERED" : "MISSING",
      };
    });
    const matchedAssetIds = shots.flatMap((shot) => [...shot.selectedAssetIds, ...shot.auxiliaryImageAssetIds]);
    return {
      ...candidate,
      assetIds: Array.from(new Set([...candidate.assetIds, ...matchedAssetIds])),
      missingAssets: shots.filter((shot) => !shot.selectedAssetIds.length).map((shot) => shot.description),
      shots,
      materialPreMatch: {
        status: "COMPLETED",
        matchedAt: new Date().toISOString(),
        total: shots.length,
        covered: shots.filter((shot) => shot.selectedAssetIds.length).length,
        missing: shots.filter((shot) => !shot.selectedAssetIds.length).length,
      },
      scriptPackage: {
        ...scriptPackage,
        shotRequirements: shots.map((shot, index) => ({
          ...(shotRequirements[index] || {}),
          lineId: shot.lineId,
          line: shot.voiceover,
          visual: shot.visual,
          assetStatus: shots[index]?.selectedAssetIds.length ? "COVERED" : "NEED_SHOOT",
          materialMatchReason: shots[index]?.materialMatchReason || "",
          matchedVideoAssetIds: shots[index]?.selectedAssetIds || [],
          matchedAssetIds: shots[index]?.selectedAssetIds || [],
          auxiliaryImageAssetIds: shots[index]?.auxiliaryImageAssetIds || [],
        })),
      },
    } as unknown as AiVideoCandidate & Record<string, unknown>;
  }

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
            publicConfig: seed.publicConfig,
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
    const seedanceModel = await this.prisma.videoModelConfig.findFirst({
      where: { provider: { code: "VOLCENGINE_SEEDANCE" }, code: "doubao-seedance-2-0-260128" },
    });
    const klingModel = await this.prisma.videoModelConfig.findFirst({
      where: { provider: { code: "KLING" }, code: "kling-video" },
    });
    const runwayModel = await this.prisma.videoModelConfig.findFirst({
      where: { provider: { code: "RUNWAY" }, code: "gen4_turbo" },
    });
    await this.prisma.videoRoutingPolicy.upsert({
      where: { policyKey: "DOUYIN_VIRAL_EXTERNAL" },
      create: {
        policyKey: "DOUYIN_VIRAL_EXTERNAL",
        name: "抖音爆款外部视频路由",
        platform: "DOUYIN",
        scenario: "DOUYIN_VIRAL",
        primaryModelId: seedanceModel?.id,
        fallbackModelIds: [klingModel?.id, bailianImageModel?.id].filter(Boolean) as string[],
        rules: { capability: "IMAGE_TO_VIDEO", preferRealAssets: true, externalGenerationOptIn: true },
        priority: 1,
      },
      update: {
        name: "抖音爆款外部视频路由",
        platform: "DOUYIN",
        scenario: "DOUYIN_VIRAL",
        primaryModelId: seedanceModel?.id,
        fallbackModelIds: [klingModel?.id, bailianImageModel?.id].filter(Boolean) as string[],
        rules: { capability: "IMAGE_TO_VIDEO", preferRealAssets: true, externalGenerationOptIn: true },
        priority: 1,
        active: true,
      },
    });
    await this.prisma.videoRoutingPolicy.upsert({
      where: { policyKey: "DOUYIN_VIRAL_ACTION" },
      create: {
        policyKey: "DOUYIN_VIRAL_ACTION",
        name: "抖音爆款人物动作增强路由",
        platform: "DOUYIN",
        scenario: "DOUYIN_VIRAL_ACTION",
        primaryModelId: klingModel?.id,
        fallbackModelIds: [seedanceModel?.id].filter(Boolean) as string[],
        rules: { capability: "TEXT_TO_VIDEO", preferRealAssets: true, externalGenerationOptIn: true },
        priority: 1,
      },
      update: {
        name: "抖音爆款人物动作增强路由",
        platform: "DOUYIN",
        scenario: "DOUYIN_VIRAL_ACTION",
        primaryModelId: klingModel?.id,
        fallbackModelIds: [seedanceModel?.id].filter(Boolean) as string[],
        rules: { capability: "TEXT_TO_VIDEO", preferRealAssets: true, externalGenerationOptIn: true },
        priority: 1,
        active: true,
      },
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

  async registerLocalMaster(contentPlanId: string, assetId: string, taskId: string, actor: string, videoKey = "") {
    const [asset, plan, projectAssets] = await Promise.all([
      this.prisma.asset.findUnique({ where: { id: assetId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } }),
      this.prisma.contentPlan.findUnique({ where: { id: contentPlanId }, include: { videoShots: true } }),
      this.prisma.contentAsset.findMany({
        where: { contentPlanId, role: { not: "VIDEO_FACTORY_MASTER" } },
        select: { assetId: true },
      }),
    ]);
    if (!asset) throw new NotFoundException("视频成品不存在");
    if (!plan) throw new NotFoundException("视频项目不存在");
    const dedicatedDouyin = videoFactoryModule(plan) === "DOUYIN_VIRAL";
    const sourceMetadata = object(object(asset.sourceSnapshot).metadata);
    const versionMetadata = object(asset.versions[0]?.technicalMetadata);
    const expectedShotLineIds = new Set(plan.videoShots
      .map((shot) => String(object(shot.metadata).lineId || "").trim())
      .filter(Boolean));
    const validation = validateVideoMasterMetadata({
      ...sourceMetadata,
      ...versionMetadata,
      width: asset.width || versionMetadata.width || sourceMetadata.width,
      height: asset.height || versionMetadata.height || sourceMetadata.height,
      durationSeconds: asset.durationSeconds || versionMetadata.durationSeconds || sourceMetadata.durationSeconds,
      codec: asset.versions[0]?.codec || versionMetadata.codec || sourceMetadata.codec,
      frameRate: versionMetadata.frameRate || sourceMetadata.frameRate,
    }, {
      requireMaterialUsage: dedicatedDouyin,
      allowedAssetIds: new Set(projectAssets.map((item) => item.assetId)),
      ...(expectedShotLineIds.size ? { expectedShotLineIds } : {}),
    });
    if (dedicatedDouyin) {
      const requiredChecks = new Set(["OUTPUT_VALIDITY", "MATERIAL_TRACE", "CONTENT_ALIGNMENT"]);
      for (const check of validation.metadata.qualityChecks) requiredChecks.delete(check.checkType);
      if (requiredChecks.size) validation.hardBlockers.push(`缺少质检项：${Array.from(requiredChecks).join("、")}`);
      const usedAssetIds = [...new Set(validation.metadata.materialUsage.map((item) => item.assetId).filter(Boolean))];
      const usedAssets = usedAssetIds.length ? await this.prisma.asset.findMany({
        where: {
          id: { in: usedAssetIds },
          reviewStatus: "APPROVED",
          availabilityStatus: "ACTIVE",
          rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
          deletedAt: null,
        },
        select: { id: true, sha256: true },
      }) : [];
      const usedAssetMap = new Map(usedAssets.map((item) => [item.id, item.sha256]));
      for (const usage of validation.metadata.materialUsage) {
        if (!usedAssetMap.has(usage.assetId)) validation.hardBlockers.push(`素材${usage.assetId || "未填写"}未审核、未启用或不可商用`);
        else if (usedAssetMap.get(usage.assetId) !== usage.sha256) validation.hardBlockers.push(`素材${usage.assetId}哈希与登记值不一致`);
      }
    }
    if (validation.hardBlockers.length) {
      const blockers = [...new Set(validation.hardBlockers)];
      await this.prisma.$transaction([
        this.prisma.asset.update({
          where: { id: asset.id },
          data: { reviewStatus: "RETURNED", availabilityStatus: "INACTIVE", status: "PENDING", reviewedBy: actor, reviewedAt: new Date() },
        }),
        this.prisma.videoQualityCheck.create({
          data: { contentPlanId, assetId, checkType: "OUTPUT_VALIDITY", status: "FAILED", score: 0, findings: blockers as unknown as Prisma.InputJsonValue },
        }),
        this.prisma.auditLog.create({
          data: { actor, action: "VIDEO_MASTER_ADMISSION_REJECTED", entityType: "Asset", entityId: asset.id, after: { reason: "INVALID_VIDEO_MASTER", blockers } },
        }),
      ]);
      throw new BadRequestException(`成片未通过准入：${blockers.join("；")}`);
    }
    const renderJob = await this.prisma.videoRenderJob.upsert({
      where: { idempotencyKey: `video-render:codex-local:${contentPlanId}:${assetId}` },
      create: {
        idempotencyKey: `video-render:codex-local:${contentPlanId}:${assetId}`,
        contentPlanId,
        status: "SUCCEEDED",
        renderer: "CODEX_LOCAL_FFMPEG",
        input: { source: "AI_TASK", taskId, ...(videoKey ? { videoKey } : {}) },
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
    for (const check of validation.metadata.qualityChecks) {
      const existingCheck = await this.prisma.videoQualityCheck.findFirst({
        where: { contentPlanId, assetId, checkType: check.checkType },
        orderBy: { createdAt: "desc" },
      });
      const data = {
        renderJobId: renderJob.id,
        status: check.status,
        score: check.score,
        findings: check.findings as Prisma.InputJsonValue,
      };
      if (existingCheck) await this.prisma.videoQualityCheck.update({ where: { id: existingCheck.id }, data });
      else await this.prisma.videoQualityCheck.create({ data: { contentPlanId, assetId, checkType: check.checkType, ...data } });
    }
    const existingFinalReview = await this.prisma.videoQualityCheck.findFirst({
      where: { contentPlanId, assetId, checkType: "FINAL_REVIEW" },
      orderBy: { createdAt: "desc" },
    });
    if (existingFinalReview) {
      await this.prisma.videoQualityCheck.update({
        where: { id: existingFinalReview.id },
        data: { renderJobId: renderJob.id, status: "REVIEW_REQUIRED", score: 0, findings: [] },
      });
    } else {
      await this.prisma.videoQualityCheck.create({
        data: { contentPlanId, assetId, renderJobId: renderJob.id, checkType: "FINAL_REVIEW", status: "REVIEW_REQUIRED", score: 0, findings: [] },
      });
    }
    await this.prisma.contentPlan.update({
      where: { id: contentPlanId },
      data: { masterVideoPath: asset.storageUrl || asset.sourcePath },
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
      try {
        await this.registerLocalMaster(
          relation.contentPlanId,
          relation.assetId,
          `backfill:${relation.contentPlanId}`,
          actor,
        );
      } catch { /* Historical records must not prevent the service from starting. */ }
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
    factoryModule?: string;
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
        factoryModule: input.factoryModule === "DOUYIN_VIRAL" ? "DOUYIN_VIRAL" : "GENERAL_VIDEO_FACTORY",
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
        kind: "VIDEO",
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
    if (input.executionMode === "FULL_VIDEO") {
      const criticalModules = new Set(["PRODUCT", "DEMO", "FUNCTION", "FEATURE", "PROOF"]);
      const missingShots = card.materialCoverage.missingShots || [];
      const criticalMissing = missingShots.filter((item) => criticalModules.has(String(item.moduleType || "").toUpperCase()));
      if (criticalMissing.length) {
        throw new BadRequestException(`产品关键镜头未覆盖：${criticalMissing.map((item) => item.description || item.moduleType).join("、")}`);
      }
      if (card.materialCoverage.coveragePercent < 100 && !input.allowExternalGeneration) {
        throw new BadRequestException("真实素材覆盖不足，请补充素材，或明确开启外部模型补充非产品场景");
      }
      if (card.materialCoverage.coveragePercent < 100 && input.allowExternalGeneration) {
        const model = input.requestedModelId
          ? await this.prisma.videoModelConfig.findFirst({
            where: { id: input.requestedModelId, enabled: true, provider: { enabled: true, state: "HEALTHY" } },
            include: { provider: true },
          })
          : await this.prisma.videoModelConfig.findFirst({
            where: {
              enabled: true,
              provider: { enabled: true, state: "HEALTHY", code: { in: ["VOLCENGINE_SEEDANCE", "KLING"] } },
            },
            include: { provider: true },
          });
        if (!model) throw new BadRequestException("外部补镜头模型尚未通过健康检查，请先配置并检查 Seedance 或 Kling");
      }
    }
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
      approvedAllowExternalGeneration: input.allowExternalGeneration === true,
      approvedRequestedModelId: input.requestedModelId || undefined,
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
    factoryModule?: string;
    routingMode?: string;
    requestedModelId?: string;
    allowFallback?: boolean;
    allowExternalGeneration?: boolean;
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
            factoryModule: input.factoryModule === "DOUYIN_VIRAL" ? "DOUYIN_VIRAL" : "GENERAL_VIDEO_FACTORY",
            routingMode: input.routingMode === "FIXED" ? "FIXED" : "AUTO",
            requestedModelId: input.requestedModelId || undefined,
            allowFallback: input.allowFallback === true,
            allowExternalGeneration: input.allowExternalGeneration === true,
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

  async createDraftProject(input: ProjectCreateInput, actor: string) {
    const productModel = String(input.productModel || "").trim();
    const videoType = String(input.videoType || "").trim();
    const referenceDirect = input.projectMode === "REFERENCE_DIRECT_FULL_VIDEO";
    const codexDirect = input.projectMode === "CODEX_DIRECT_FULL_VIDEO";
    const batchDirect = input.projectMode === "BATCH_CODEX_DIRECT_FULL_VIDEO";
    const directFullVideo = referenceDirect || codexDirect || batchDirect;
    const referenceVideoUrl = String(input.referenceVideoUrl || input.reference || "").trim();
    const codexDirectPrompt = String(input.additionalPrompt || "").trim();
    const normalizedBatchProducts = batchDirect
      ? (input.batchProducts || [])
        .map((item) => ({
          model: String(item.model || "").trim(),
          count: Math.max(2, Math.min(10, Math.round(Number(item.count || 0)))),
        }))
        .filter((item) => item.model && item.count > 0)
      : [];
    if (batchDirect) {
      if (!normalizedBatchProducts.length || normalizedBatchProducts.length > 5) {
        throw new BadRequestException("请选择 1 到 5 个产品");
      }
      const batchTotal = normalizedBatchProducts.reduce((sum, item) => sum + item.count, 0);
      if (batchTotal > 10) throw new BadRequestException("批量视频总数最多 10 条");
    }
    const requestedKeywordIds = Array.from(new Set((input.keywordIds || []).map(String).filter(Boolean)));
    const [selectedSmartKeywords, selectedViralKeywords] = requestedKeywordIds.length
      ? await Promise.all([
          this.prisma.smartKeyword.findMany({
            where: { id: { in: requestedKeywordIds }, status: "ACTIVE", contentEnabled: true },
            select: { id: true, keyword: true },
          }),
          this.prisma.viralKeyword.findMany({
            where: { id: { in: requestedKeywordIds }, active: true },
            select: { keyword: true, smartKeywordId: true },
          }),
        ])
      : [[], []];
    const keywordIds = Array.from(new Set([
      ...selectedSmartKeywords.map((item) => item.id),
      ...selectedViralKeywords.map((item) => item.smartKeywordId).filter((id): id is string => Boolean(id)),
    ]));
    const selectedKeywordText = Array.from(new Set([
      ...selectedSmartKeywords.map((item) => item.keyword),
      ...selectedViralKeywords.map((item) => item.keyword),
    ].filter(Boolean))).join("、");
    const keywords = String(input.keywords || input.topic || selectedKeywordText).trim();
    if ((referenceDirect || codexDirect) && !productModel) throw new BadRequestException("请选择产品型号");
    if (referenceDirect && !referenceVideoUrl) throw new BadRequestException("请填写参考视频链接");
    if (codexDirect && !codexDirectPrompt) throw new BadRequestException("请填写 AI 提示词");
    if (!directFullVideo && !productModel) throw new BadRequestException("请选择产品型号");
    if (!directFullVideo && !videoType) throw new BadRequestException("请选择或填写视频类型");
    if (!directFullVideo && !keywords && !input.keywordIds?.length) throw new BadRequestException("请填写或选择关键词");
    const platform = integrationKind(input.platform);
    const productionNo = `VF-${localDateKey(new Date()).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const normalizedProductModel = productModel
      || (batchDirect ? normalizedBatchProducts.map((item) => item.model.split(" · ")[0]).join("、") : "REFERENCE_VIDEO");
    const normalizedVideoType = videoType || (batchDirect ? "批量 Codex 直出" : codexDirect ? "Codex 直出视频" : "参考视频直出");
    const normalizedKeywords = keywords || (batchDirect ? "批量Codex直出" : codexDirect ? "Codex 直出" : "参考视频直出");
    const topic = conciseVideoTopic(String(input.topic || (referenceDirect
      ? `${normalizedProductModel} · 参考直出`
      : codexDirect
        ? `${normalizedProductModel} · Codex直出`
        : batchDirect
          ? `${normalizedBatchProducts.map((item) => item.model.split(" · ")[0]).join(" · ")} · 批量Codex直出`
        : `${normalizedProductModel} · ${normalizedVideoType}${normalizedKeywords ? ` · ${normalizedKeywords}` : ""}`)));
    const brief = {
      ...(input.platform ? { platform } : {}),
      ...(input.voiceoverMode ? { voiceoverMode: String(input.voiceoverMode).toUpperCase() } : {}),
      ...(input.accountType ? { accountType: String(input.accountType).toUpperCase() } : {}),
      ...(input.estimatedDurationSeconds
        ? { estimatedDurationSeconds: Math.max(15, Math.min(180, Math.round(number(input.estimatedDurationSeconds, 30)))) }
        : {}),
      ...(typeof input.healthContentAllowed === "boolean" ? { healthContentAllowed: input.healthContentAllowed } : {}),
      ...(input.generationMode
        ? { materialPolicy: String(input.generationMode).toUpperCase() === "ASSET_ONLY" ? "ASSET_ONLY" : "REAL_ASSET_FIRST" }
        : {}),
      missingMaterialStrategies: ["RESHOOT", "AI_GENERATE"],
      soundPrompt: String(input.soundPrompt || "").trim(),
      mustShowFacts: String(input.mustShowFacts || "").trim(),
      additionalPrompt: String(input.additionalPrompt || "").trim(),
      ...(directFullVideo ? {} : { videoType: normalizedVideoType, keywords: normalizedKeywords }),
      ...(referenceDirect ? { reference: referenceVideoUrl } : {}),
      ...(referenceDirect && String(input.referenceDirectTaskRequirement || "").trim()
        ? { referenceDirectTaskRequirement: String(input.referenceDirectTaskRequirement).trim() }
        : {}),
      ...(referenceDirect ? {
        referenceAudioStrategy: input.referenceAudioStrategy === "DOUBAO_REVOICE" ? "DOUBAO_REVOICE" : "REFERENCE_ORIGINAL",
        referenceVisualStrategy: input.referenceVisualStrategy === "REUSE_REFERENCE_VISUALS" ? "REUSE_REFERENCE_VISUALS" : "REBUILD_PRODUCT_VISUALS",
        ...(input.referenceDirectChangeSet ? { referenceDirectChangeSet: input.referenceDirectChangeSet } : {}),
      } : {}),
      ...(codexDirect ? { codexDirectFullVideo: true, directOutputOnly: true } : {}),
      ...(batchDirect ? {
        batchDirectFullVideo: true,
        directOutputOnly: true,
        batchDirect: {
          products: normalizedBatchProducts,
          voiceoverSplit: input.batchVoiceoverSplit === "ALL" ? "ALL" : input.batchVoiceoverSplit === "NONE" ? "NONE" : "HALF",
          bgmVariety: input.batchBgmVariety !== false,
          voiceVariety: input.batchVoiceVariety !== false,
          generateCoverTitle: input.batchGenerateCoverTitle !== false,
          additionalPrompt: String(input.additionalPrompt || "").trim(),
          taskRequirement: String(input.batchTaskRequirement || "").trim(),
          publishRecords: [],
        },
      } : {}),
      hook: String(input.hook || "").trim(),
      scene: String(input.scene || "").trim(),
      painPoint: String(input.painPoint || "").trim(),
      audience: String(input.audience || "").trim(),
      scriptEngines: directFullVideo ? ["REMOTE_CODEX"] : Array.from(new Set((input.scriptEngines?.length
        ? input.scriptEngines
        : ["SYSTEM_AI"]).map((item) => String(item).toUpperCase())))
        .filter((item) => ["REMOTE_CODEX", "SYSTEM_AI"].includes(item)),
      compliancePolicy: {
        source: "SYSTEM_RISK_TERM_AND_VISUAL_LIBRARY",
        generatedByRemoteCodex: true,
      },
      coverTitleTiming: batchDirect
        ? (input.batchGenerateCoverTitle !== false ? "WITH_VIDEO" : "AFTER_VIDEO_APPROVAL")
        : "AFTER_VIDEO_APPROVAL",
    };
    const plan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contentPlan.create({
        data: {
          productionNo,
          productionStage: "PROJECT_BRIEF",
          workflowVersion: batchDirect ? 5 : 4,
          owner: actor,
          targetPlatforms: [platform],
          planDate: new Date(),
          kind: "VIDEO",
          topic,
          productModel: normalizedProductModel,
          audience: String(input.audience || "目标用户").trim() || "目标用户",
          objective: String(input.objective || "内容测试").trim() || "内容测试",
          score: 0,
          scoreBreakdown: {},
          hook: String(input.topic || topic),
          outline: [],
          sourceSignals: [{
            type: "VIDEO_FACTORY",
            workflowVersion: batchDirect ? 5 : 4,
            projectMode: batchDirect
              ? "BATCH_CODEX_DIRECT_FULL_VIDEO"
              : referenceDirect ? "REFERENCE_DIRECT_FULL_VIDEO" : codexDirect ? "CODEX_DIRECT_FULL_VIDEO" : "SINGLE_SCRIPT_SYSTEM_FIRST",
            brief,
            scriptCandidates: [],
            selectedCandidateIndex: 0,
            scriptEngineStatus: Object.fromEntries(brief.scriptEngines.map((engine) => [engine, "PENDING"])),
            keywordIds,
            externalVideoIds: input.externalVideoIds || [],
            ...(input.libraryEntryId ? {
              libraryEntryId: input.libraryEntryId,
              libraryReuseMode: input.libraryReuseMode || "CONFIG_REUSE",
              targetLanguage: input.targetLanguage || "ZH",
              referenceAssetId: input.referenceAssetId || null,
            } : {}),
            externalReferencePolicy: referenceDirect ? "REFERENCE_STYLE_AND_BGM" : (codexDirect || batchDirect) ? "NONE" : "STRUCTURE_ONLY",
            routingMode: directFullVideo ? "CODEX_DIRECT" : "SYSTEM_FIRST",
            allowFallback: false,
          }] as unknown as Prisma.InputJsonValue,
          evidenceIds: [],
          status: ContentStatus.DRAFT,
          riskReasons: [],
          createdBy: actor,
          assignedTo: actor,
          actorType: "HUMAN",
        },
      });
      if (keywordIds.length) {
        await tx.smartKeywordContentRelation.createMany({
          data: keywordIds.map((keywordId, index) => ({
            keywordId,
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
          action: "VIDEO_FACTORY_PROJECT_DRAFT_CREATE",
          entityType: "ContentPlan",
          entityId: created.id,
          after: { productionNo, projectMode: batchDirect ? "BATCH_CODEX_DIRECT_FULL_VIDEO" : referenceDirect ? "REFERENCE_DIRECT_FULL_VIDEO" : codexDirect ? "CODEX_DIRECT_FULL_VIDEO" : "SINGLE_SCRIPT_SYSTEM_FIRST", scriptEngines: brief.scriptEngines },
        },
      });
      return created;
    });
    return this.project(plan.id);
  }

  async attachRemoteTask(contentPlanId: string, aiTaskId: string, mode: "SCRIPT_ONLY" | "FULL_VIDEO" | "COVER_TITLE", actor: string) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id: contentPlanId } });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    const signals = sourceSignals(plan);
    const nextSignals = signals.map((signal) => signal.type === "VIDEO_FACTORY"
      ? {
        ...signal,
        aiTaskId: mode === "SCRIPT_ONLY" ? aiTaskId : signal.aiTaskId,
        videoAiTaskId: mode === "FULL_VIDEO" ? aiTaskId : signal.videoAiTaskId,
        coverAiTaskId: mode === "COVER_TITLE" ? aiTaskId : signal.coverAiTaskId,
        lastTaskMode: mode,
        scriptEngineStatus: mode === "SCRIPT_ONLY"
          ? { ...object(signal.scriptEngineStatus), REMOTE_CODEX: "RUNNING" }
          : signal.scriptEngineStatus,
      }
      : signal);
    await this.prisma.$transaction([
      this.prisma.contentPlan.update({
        where: { id: contentPlanId },
        data: {
          productionStage: mode === "SCRIPT_ONLY" ? "SCRIPT_GENERATING" : mode === "COVER_TITLE" ? "PLATFORM_PACKAGING" : "EDITING",
          sourceSignals: nextSignals as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actor,
          action: mode === "SCRIPT_ONLY"
            ? "VIDEO_FACTORY_SCRIPT_TASK_SUBMIT"
            : mode === "COVER_TITLE"
              ? "VIDEO_FACTORY_COVER_TITLE_TASK_SUBMIT"
              : "VIDEO_FACTORY_VIDEO_TASK_SUBMIT",
          entityType: "ContentPlan",
          entityId: contentPlanId,
          after: { aiTaskId, mode },
        },
      }),
    ]);
    return this.project(contentPlanId);
  }

  /**
   * A returned direct-output master must be revised from its existing finished
   * video.  Preserve the original task, source asset and employee feedback so
   * the next FULL_VIDEO task is a targeted revision rather than a new project.
   */
  async prepareCodexDirectVideoRevision(contentPlanId: string, actor: string) {
    const plan = await this.prisma.contentPlan.findUnique({
      where: { id: contentPlanId },
      include: {
        videoRenderJobs: {
          where: { status: "SUCCEEDED", outputAsset: { is: { reviewStatus: "RETURNED" } } },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            outputAsset: true,
            qualityChecks: { where: { checkType: "FINAL_REVIEW" }, orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
    });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    const signals = sourceSignals(plan);
    const factory = signals.find((signal) => signal.type === "VIDEO_FACTORY") || {};
    if (!["CODEX_DIRECT_FULL_VIDEO", "REFERENCE_DIRECT_FULL_VIDEO", "BATCH_CODEX_DIRECT_FULL_VIDEO"].includes(String(factory.projectMode || ""))) {
      throw new BadRequestException("当前项目不是 Codex 直出视频模式");
    }
    const render = plan.videoRenderJobs[0];
    const asset = render?.outputAsset;
    if (!render || !asset) throw new BadRequestException("没有可按退回意见修改的成片");
    const finalReview = render.qualityChecks[0];
    const findings = Array.isArray(finalReview?.findings) ? finalReview.findings.map(object) : [];
    const latestReturn = [...findings].reverse().find((finding) => finding.type === "EMPLOYEE_RETURN") || {};
    const reviewNote = String(latestReturn.message || "请按审核意见修改成片").trim();
    const previousRevision = object(factory.directVideoRevision);
    const revision = {
      revisionNo: number(previousRevision.revisionNo, 0) + 1,
      sourceTaskId: String(factory.videoAiTaskId || "").trim(),
      sourceMasterAssetId: asset.id,
      sourceMasterName: asset.displayName || asset.fileName || asset.assetNo || asset.id,
      sourceMasterSourcePath: asset.sourcePath || "",
      sourceMasterStorageUrl: asset.storageUrl || "",
      sourceMasterObjectKey: asset.objectKey || "",
      reviewNote,
      returnedAt: asset.reviewedAt?.toISOString() || new Date().toISOString(),
      requestedAt: new Date().toISOString(),
    };
    const nextSignals = signals.map((signal) => signal.type === "VIDEO_FACTORY"
      ? {
        ...signal,
        previousVideoAiTaskId: String(signal.videoAiTaskId || "").trim(),
        videoAiTaskId: "",
        directVideoRevision: revision,
        lastTaskMode: "FULL_VIDEO",
      }
      : signal);
    await this.prisma.$transaction([
      this.prisma.contentPlan.update({
        where: { id: contentPlanId },
        data: {
          workflowVersion: { increment: 1 },
          masterVideoStatus: "PENDING",
          productionStage: "EDITING",
          sourceSignals: nextSignals as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actor,
          action: "VIDEO_FACTORY_CODEX_DIRECT_REVISION_SUBMIT",
          entityType: "ContentPlan",
          entityId: contentPlanId,
          after: revision,
        },
      }),
    ]);
    return this.project(contentPlanId);
  }

  async requestRemoteScriptAfterSystemFailure(contentPlanId: string, actor: string, note = "") {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id: contentPlanId } });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    const signals = sourceSignals(plan);
    const factory = signals.find((signal) => signal.type === "VIDEO_FACTORY") || {};
    const scriptEngineStatus = object(factory.scriptEngineStatus);
    const factoryBrief = object(factory.brief);
    if (scriptEngineStatus.SYSTEM_AI !== "FAILED") {
      throw new BadRequestException("只有系统 AI 生成失败的项目可以直接转交 Codex");
    }
    const systemAiFailureReason = String(object(factory.scriptEngineErrors).SYSTEM_AI || "系统 AI 脚本生成失败");
    const nextSignals = signals.map((signal) => signal.type === "VIDEO_FACTORY"
      ? {
        ...signal,
        brief: {
          ...factoryBrief,
          scriptEngines: Array.from(new Set([
            ...(Array.isArray(factoryBrief.scriptEngines) ? factoryBrief.scriptEngines.map(String) : ["SYSTEM_AI"]),
            "REMOTE_CODEX",
          ])),
          remoteTransferContext: {
            source: "SYSTEM_AI_FAILURE",
            systemAiFailureReason,
            userNote: note.trim(),
          },
        },
        scriptEngineStatus: { ...scriptEngineStatus, REMOTE_CODEX: "PENDING" },
        scriptEngineErrors: { ...object(signal.scriptEngineErrors), REMOTE_CODEX: "" },
      }
      : signal);
    await this.prisma.$transaction([
      this.prisma.contentPlan.update({
        where: { id: contentPlanId },
        data: {
          productionStage: "SCRIPT_RETURNED",
          sourceSignals: nextSignals as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actor,
          action: "VIDEO_FACTORY_SYSTEM_AI_FAILURE_TRANSFER_TO_CODEX",
          entityType: "ContentPlan",
          entityId: contentPlanId,
          after: { systemAiFailureReason, userNote: note.trim() },
        },
      }),
    ]);
    return this.project(contentPlanId);
  }

  async generateSystemScriptCandidate(contentPlanId: string, actor: string, regenerationPrompt = "") {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id: contentPlanId } });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    const signals = sourceSignals(plan);
    const factory = signals.find((signal) => signal.type === "VIDEO_FACTORY") || {};
    const brief = object(factory.brief);
    const context = await this.buildContext({
      platform: plan.targetPlatforms[0],
      productModel: plan.productModel || undefined,
      topic: String(brief.keywords || plan.topic),
      audience: String(brief.audience || plan.audience),
      objective: String(brief.videoType || plan.objective),
      ...(brief.voiceoverMode ? { voiceoverMode: String(brief.voiceoverMode) } : {}),
      ...(brief.materialPolicy
        ? { generationMode: String(brief.materialPolicy) === "ASSET_ONLY" ? "ASSET_ONLY" : "NORMAL" }
        : {}),
      ...(typeof brief.healthContentAllowed === "boolean"
        ? { contentRestrictionMode: brief.healthContentAllowed === false ? "HEALTH_RESTRICTED" : "NORMAL" }
        : {}),
      keywordIds: Array.isArray(factory.keywordIds) ? factory.keywordIds.map(String) : [],
      externalVideoIds: Array.isArray(factory.externalVideoIds) ? factory.externalVideoIds.map(String) : [],
      additionalPrompt: [String(brief.additionalPrompt || "").trim(), regenerationPrompt.trim()].filter(Boolean).join("\n"),
    });
    let generated: AiVideoCandidate[];
    try {
      generated = await this.aiContent.generateVideoCandidates({
        platform: context.platform,
        product: context.product,
        keywords: context.keywords,
        knowledge: context.knowledge,
        assets: context.assets,
        assetKnowledgePolicy: context.assetKnowledgePolicy,
        references: context.references,
        topic: context.topic,
        audience: context.audience,
        objective: context.objective,
        ...(brief.voiceoverMode ? { voiceoverMode: context.voiceoverMode } : {}),
        ...(brief.materialPolicy ? { generationMode: context.generationMode } : {}),
        ...(typeof brief.healthContentAllowed === "boolean"
          ? { contentRestrictionMode: context.contentRestrictionMode }
          : {}),
        scriptSource: "AI",
        userProvidedDirections: [],
        exactCount: 1,
        projectBrief: {
          videoType: brief.videoType,
          keywords: brief.keywords,
          ...(brief.reference ? { reference: brief.reference } : {}),
          ...(brief.hook ? { requestedHook: brief.hook } : {}),
          ...(brief.scene ? { scene: brief.scene } : {}),
          ...(brief.painPoint ? { painPoint: brief.painPoint } : {}),
          ...(brief.audience ? { targetAudience: brief.audience } : {}),
          ...(brief.soundPrompt ? { soundPrompt: brief.soundPrompt } : {}),
          ...(brief.mustShowFacts ? { mustShowFacts: brief.mustShowFacts } : {}),
          ...((brief.additionalPrompt || regenerationPrompt.trim())
            ? { additionalPrompt: [String(brief.additionalPrompt || "").trim(), regenerationPrompt.trim()].filter(Boolean).join("\n") }
            : {}),
          ...(brief.accountType ? { accountType: brief.accountType } : {}),
          ...(brief.estimatedDurationSeconds
            ? { estimatedDurationSeconds: brief.estimatedDurationSeconds }
            : {}),
          ...(typeof brief.healthContentAllowed === "boolean"
            ? { healthContentAllowed: brief.healthContentAllowed }
            : {}),
          ...(brief.materialPolicy ? { materialPolicy: brief.materialPolicy } : {}),
        },
      });
      if (!generated[0]) throw new BadRequestException("系统 AI 未返回有效脚本");
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : "系统 AI 脚本生成失败";
      const failedAt = new Date().toISOString();
      const scriptEngineStatus: Record<string, unknown> = {
        ...object(factory.scriptEngineStatus),
        SYSTEM_AI: "FAILED",
      };
      const nextSignals = signals.map((signal) => signal.type === "VIDEO_FACTORY"
        ? {
          ...signal,
          scriptEngineStatus,
          scriptEngineErrors: { ...object(signal.scriptEngineErrors), SYSTEM_AI: failureReason },
          systemScriptRegenerationPending: false,
          systemScriptConversation: [
            ...(Array.isArray(signal.systemScriptConversation) ? signal.systemScriptConversation : []),
            { role: "BAILIAN", status: "FAILED", at: failedAt, content: failureReason },
          ].slice(-20),
        }
        : signal);
      await this.prisma.$transaction([
        this.prisma.contentPlan.update({
          where: { id: contentPlanId },
          data: {
            productionStage: Array.isArray(factory.scriptCandidates) && factory.scriptCandidates.length
              ? "FACTORY_SCRIPT_READY"
              : "SCRIPT_GENERATING",
            sourceSignals: nextSignals as unknown as Prisma.InputJsonValue,
          },
        }),
        this.prisma.auditLog.create({
          data: {
            actor,
            action: "VIDEO_FACTORY_SYSTEM_AI_SCRIPT_FAILED",
            entityType: "ContentPlan",
            entityId: contentPlanId,
            after: { failureReason, scriptEngineStatus } as Prisma.InputJsonValue,
          },
        }),
      ]);
      return this.project(contentPlanId);
    }
    const candidate = await this.preMatchScriptCandidate({
      ...generated[0],
      generationSource: "SYSTEM_AI",
      generatedAt: new Date().toISOString(),
      regenerationPrompt: regenerationPrompt.trim() || undefined,
    } as AiVideoCandidate, context.assets);
    const current = Array.isArray(factory.scriptCandidates) ? factory.scriptCandidates : [];
    const replacingSystemCandidate = factory.systemScriptRegenerationPending === true;
    const replacedSystemCandidates = replacingSystemCandidate
      ? current.filter((item) => object(item).generationSource === "SYSTEM_AI")
      : [];
    // Regeneration creates a new active version, it does not create a second
    // active system-AI candidate.  Keep any Codex candidate for a deliberate
    // cross-engine comparison, while moving the prior system draft to history.
    const nextCandidates = [
      ...current.filter((item) => !replacingSystemCandidate || object(item).generationSource !== "SYSTEM_AI"),
      candidate,
    ].slice(-6);
    const requestedEngines = Array.isArray(brief.scriptEngines)
      ? brief.scriptEngines.map(String)
      : ["SYSTEM_AI"];
    const scriptEngineStatus: Record<string, unknown> = {
      ...object(factory.scriptEngineStatus),
      SYSTEM_AI: "COMPLETED",
    };
    const allRequestedEnginesCompleted = requestedEngines.every((engine) => scriptEngineStatus[engine] === "COMPLETED");
    const nextSignals = signals.map((signal) => signal.type === "VIDEO_FACTORY"
      ? {
        ...signal,
        scriptCandidates: nextCandidates,
        systemScriptRegenerationPending: false,
        scriptEngineStatus,
        systemScriptConversation: [
          ...(Array.isArray(signal.systemScriptConversation) ? signal.systemScriptConversation : []),
          {
            role: "BAILIAN",
            status: "COMPLETED",
            at: candidate.generatedAt,
            content: String(candidate.title || candidate.hook || "脚本与素材预匹配已返回"),
          },
        ].slice(-20),
        systemRegenerationHistory: [
          ...(Array.isArray(signal.systemRegenerationHistory) ? signal.systemRegenerationHistory : []),
          {
            generatedAt: candidate.generatedAt,
            prompt: regenerationPrompt.trim(),
            replacedSystemCandidateCount: replacedSystemCandidates.length,
            replacedSystemCandidates,
          },
        ].slice(-20),
      }
      : signal);
    await this.prisma.$transaction([
      this.prisma.contentPlan.update({
        where: { id: contentPlanId },
        data: {
          productionStage: allRequestedEnginesCompleted ? "FACTORY_SCRIPT_READY" : "SCRIPT_GENERATING",
          sourceSignals: nextSignals as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actor,
          action: "VIDEO_FACTORY_SYSTEM_AI_SCRIPT_GENERATE",
          entityType: "ContentPlan",
          entityId: contentPlanId,
          after: {
            candidateCount: nextCandidates.length,
            scriptEngineStatus,
            regenerationPrompt: regenerationPrompt.trim(),
          } as Prisma.InputJsonValue,
        },
      }),
    ]);
    if (allRequestedEnginesCompleted) {
      const preMatch = object((candidate as unknown as Record<string, unknown>).materialPreMatch);
      await this.notifyProjectMilestone(
        contentPlanId,
        "VIDEO_SCRIPT_AND_MATERIAL_MATCH_READY",
        "视频脚本与素材预匹配已完成",
        `脚本已生成，可直接审核；已匹配${Number(preMatch.covered || 0)}个镜头，缺失${Number(preMatch.missing || 0)}个镜头。`,
      ).catch(() => undefined);
    }
    return this.project(contentPlanId);
  }

  async enqueueSystemScriptCandidate(contentPlanId: string, actor: string, regenerationPrompt = "") {
    if (this.systemScriptJobs.has(contentPlanId)) return this.project(contentPlanId);
    const plan = await this.prisma.contentPlan.findUnique({ where: { id: contentPlanId } });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    const signals = sourceSignals(plan);
    const factory = signals.find((signal) => signal.type === "VIDEO_FACTORY") || {};
    const brief = object(factory.brief);
    const submittedAt = new Date().toISOString();
    const requestSummary = [
      `视频类型：${String(brief.videoType || "不限")}`,
      `产品：${String(plan.productModel || "未指定")}`,
      `关键词：${String(brief.keywords || plan.topic || "未指定")}`,
      regenerationPrompt.trim() ? `本次调整：${regenerationPrompt.trim()}` : "按项目原始要求生成",
    ].join("；");
    const nextSignals = signals.map((signal) => signal.type === "VIDEO_FACTORY"
      ? {
        ...signal,
        scriptEngineStatus: { ...object(signal.scriptEngineStatus), SYSTEM_AI: "RUNNING" },
        scriptEngineErrors: { ...object(signal.scriptEngineErrors), SYSTEM_AI: "" },
        systemScriptRegenerationPending: Array.isArray(signal.scriptCandidates)
          && signal.scriptCandidates.some((item) => object(item).generationSource === "SYSTEM_AI"),
        systemScriptStartedAt: submittedAt,
        systemScriptConversation: [
          ...(Array.isArray(signal.systemScriptConversation) ? signal.systemScriptConversation : []),
          { role: "SYSTEM", status: "SENT", at: submittedAt, content: requestSummary },
          { role: "BAILIAN", status: "RUNNING", at: submittedAt, content: "已接收任务，正在生成脚本并匹配素材" },
        ].slice(-20),
      }
      : signal);
    await this.prisma.contentPlan.update({
      where: { id: contentPlanId },
      data: {
        productionStage: "SCRIPT_GENERATING",
        sourceSignals: nextSignals as unknown as Prisma.InputJsonValue,
      },
    });
    this.systemScriptJobs.add(contentPlanId);
    void this.generateSystemScriptCandidate(contentPlanId, actor, regenerationPrompt)
      .catch(() => undefined)
      .finally(() => this.systemScriptJobs.delete(contentPlanId));
    return this.project(contentPlanId);
  }

  async reviewScript(contentPlanId: string, approved: boolean, note: string, actor: string, candidateIndex?: number) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id: contentPlanId } });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    if (plan.productionStage !== "FACTORY_SCRIPT_READY") {
      throw new BadRequestException("当前脚本和素材匹配完成后才能确认");
    }
    if (!this.candidates(plan).length) throw new BadRequestException("当前项目还没有可审核的脚本");
    const candidates = this.candidates(plan);
    const signals = sourceSignals(plan);
    const factory = signals.find((signal) => signal.type === "VIDEO_FACTORY") || {};
    const brief = object(factory.brief);
    const requestedEngines = Array.isArray(brief.scriptEngines)
      ? brief.scriptEngines.map(String)
      : ["SYSTEM_AI"];
    const scriptEngineStatus = object(factory.scriptEngineStatus);
    if (requestedEngines.some((engine) => scriptEngineStatus[engine] !== "COMPLETED")) {
      throw new BadRequestException("所选脚本引擎尚未全部完成，暂不能进入审核");
    }
    const selectedCandidateIndex = candidateIndex === undefined
      ? Math.max(0, Math.min(candidates.length - 1, Number(factory.selectedCandidateIndex || 0)))
      : Math.max(0, Math.min(candidates.length - 1, Math.round(candidateIndex)));
    const selectedCandidate = object(candidates[selectedCandidateIndex]);
    const isInitialCodexTransfer = !approved && selectedCandidate.generationSource !== "REMOTE_CODEX";
    if (!approved && !isInitialCodexTransfer && !note.trim()) {
      throw new BadRequestException("退回 Codex 脚本时必须填写修改原因");
    }
    const reviewedAt = new Date();
    const nextSignals = signals.map((signal) => signal.type === "VIDEO_FACTORY"
      ? {
        ...signal,
        ...(!approved
          ? {
            brief: { ...brief, scriptEngines: ["REMOTE_CODEX"] },
            scriptEngineStatus: {
              ...scriptEngineStatus,
              REMOTE_CODEX: "PENDING",
            },
          }
          : {}),
        selectedCandidateIndex,
        scriptReview: {
          status: approved ? "APPROVED" : isInitialCodexTransfer ? "TRANSFERRED_TO_CODEX" : "RETURNED",
          note: note.trim(),
          actor,
          reviewedAt: reviewedAt.toISOString(),
        },
      }
      : signal);
    await this.prisma.$transaction([
      this.prisma.contentPlan.update({
        where: { id: contentPlanId },
        data: {
          productionStage: approved ? "SCRIPT_APPROVED" : "SCRIPT_RETURNED",
          approvedBy: approved ? actor : null,
          approvedAt: approved ? reviewedAt : null,
          rejectedReason: approved ? null : note.trim(),
          workflowVersion: approved ? plan.workflowVersion : { increment: 1 },
          sourceSignals: nextSignals as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.approval.create({
        data: {
          contentPlanId,
          action: approved ? "SCRIPT_APPROVE" : isInitialCodexTransfer ? "SCRIPT_TRANSFER_TO_CODEX" : "SCRIPT_RETURN",
          actor,
          note: note.trim() || null,
        },
      }),
    ]);
    return this.project(contentPlanId);
  }

  /** First transfer keeps the complete existing brief; it is not a Codex return. */
  async transferScriptToCodex(contentPlanId: string, actor: string, candidateIndex?: number) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id: contentPlanId } });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    if (plan.productionStage !== "FACTORY_SCRIPT_READY") {
      throw new BadRequestException("当前项目阶段不能转交 Codex 生成脚本");
    }
    const candidates = this.candidates(plan);
    if (!candidates.length) throw new BadRequestException("当前项目还没有可转交的脚本");
    const selectedCandidateIndex = candidateIndex === undefined
      ? 0
      : Math.max(0, Math.min(candidates.length - 1, Math.round(candidateIndex)));
    if (object(candidates[selectedCandidateIndex]).generationSource === "REMOTE_CODEX") {
      throw new BadRequestException("当前脚本已由 Codex 生成，请使用退回 Codex 并填写修改原因");
    }
    const signals = sourceSignals(plan);
    const reviewedAt = new Date();
    const transferNote = "转交 Codex 生成，沿用当前项目需求、素材策略和系统脚本";
    const nextSignals = signals.map((signal) => {
      if (signal.type !== "VIDEO_FACTORY") return signal;
      const factory = object(signal);
      const brief = object(factory.brief);
      return {
        ...factory,
        brief: { ...brief, scriptEngines: ["REMOTE_CODEX"] },
        scriptEngineStatus: { ...object(factory.scriptEngineStatus), REMOTE_CODEX: "PENDING" },
        scriptEngineErrors: { ...object(factory.scriptEngineErrors), REMOTE_CODEX: "" },
        selectedCandidateIndex,
        scriptReview: { status: "TRANSFERRED_TO_CODEX", note: transferNote, actor, reviewedAt: reviewedAt.toISOString() },
      };
    });
    await this.prisma.$transaction([
      this.prisma.contentPlan.update({
        where: { id: contentPlanId },
        data: {
          productionStage: "SCRIPT_RETURNED",
          approvedBy: null,
          approvedAt: null,
          rejectedReason: transferNote,
          workflowVersion: { increment: 1 },
          sourceSignals: nextSignals as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.approval.create({ data: { contentPlanId, action: "SCRIPT_TRANSFER_TO_CODEX", actor, note: transferNote } }),
    ]);
    return this.project(contentPlanId);
  }

  async reviewMaterials(contentPlanId: string, approved: boolean, note: string, actor: string) {
    const plan = await this.prisma.contentPlan.findUnique({
      where: { id: contentPlanId },
      include: {
        videoShots: {
          orderBy: { sequence: "asc" },
          include: { selectedAsset: true },
        },
      },
    });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    if (!["MATERIAL_REVIEW", "MATERIAL_RETURNED"].includes(plan.productionStage)) {
      throw new BadRequestException("当前项目不在素材确认阶段");
    }
    if (!approved && !note.trim()) throw new BadRequestException("退回素材时必须填写具体原因");
    if (approved) {
      if (!plan.videoShots.length || plan.videoShots.some((shot) => shot.status !== "DONE" || !shot.selectedAssetId)) {
        throw new BadRequestException("仍有镜头缺少已确认素材");
      }
      const invalid = plan.videoShots.filter((shot) =>
        !shot.selectedAsset
        || shot.selectedAsset.kind !== "VIDEO"
        || shot.selectedAsset.reviewStatus !== "APPROVED"
        || shot.selectedAsset.availabilityStatus !== "ACTIVE"
        || !["COMMERCIAL", "EDIT_ONLY"].includes(shot.selectedAsset.rightsStatus));
      if (invalid.length) throw new BadRequestException(`仍有${invalid.length}个镜头素材未通过系统素材审核`);
    }
    const reviewedAt = new Date();
    const bindingFingerprint = materialBindingFingerprint(plan.videoShots);
    const signals = sourceSignals(plan);
    const nextSignals = signals.map((signal) => signal.type === "VIDEO_FACTORY"
      ? {
        ...signal,
        materialReview: {
          status: approved ? "APPROVED" : "RETURNED",
          note: note.trim(),
          actor,
          reviewedAt: reviewedAt.toISOString(),
          workflowVersion: plan.workflowVersion,
          bindingFingerprint,
        },
      }
      : signal);
    await this.prisma.$transaction([
      this.prisma.contentPlan.update({
        where: { id: contentPlanId },
        data: {
          productionStage: approved ? "READY_TO_EDIT" : "MATERIAL_RETURNED",
          sourceSignals: nextSignals as Prisma.InputJsonValue,
        },
      }),
      this.prisma.approval.create({
        data: {
          contentPlanId,
          action: approved ? "MATERIAL_APPROVE" : "MATERIAL_RETURN",
          actor,
          note: note.trim() || null,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actor,
          action: approved ? "VIDEO_PROJECT_MATERIAL_APPROVE" : "VIDEO_PROJECT_MATERIAL_RETURN",
          entityType: "ContentPlan",
          entityId: contentPlanId,
          after: { workflowVersion: plan.workflowVersion, bindingFingerprint, note: note.trim() || null },
        },
      }),
    ]);
    return this.project(contentPlanId);
  }

  async assertMaterialsApproved(contentPlanId: string) {
    const plan = await this.prisma.contentPlan.findUnique({
      where: { id: contentPlanId },
      include: { videoShots: { orderBy: { sequence: "asc" } } },
    });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    const fingerprint = materialBindingFingerprint(plan.videoShots);
    if (!materialReviewApproved(plan, fingerprint)) {
      throw new BadRequestException("素材尚未由用户确认，不能生成成片");
    }
    return plan;
  }

  async updateDraftScript(contentPlanId: string, input: {
    candidateIndex?: number;
    title: string;
    hook: string;
    script: string;
    coreTheme: string;
    communicationGoal: string;
    userPainPoint: string;
    uniqueSellingPoint: string;
    voiceoverLines: string[];
    retentionDesign: string[];
    subtitles: string[];
    emphasisTexts: string[];
    endingSummary: string;
    endingInteraction: string;
    endingVisual: string;
    changedLineIds?: string[];
  }, actor: string) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id: contentPlanId } });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    if (plan.productionStage !== "FACTORY_SCRIPT_READY") throw new BadRequestException("只有待审核脚本可以直接修改");
    const candidates = this.candidates(plan);
    if (!candidates.length) throw new BadRequestException("当前项目没有可修改的脚本");
    const signals = sourceSignals(plan);
    const factory = signals.find((signal) => signal.type === "VIDEO_FACTORY") || {};
    const brief = object(factory.brief);
    const selectedIndex = input.candidateIndex === undefined
      ? Math.max(0, Math.min(candidates.length - 1, Number(factory.selectedCandidateIndex || 0)))
      : Math.max(0, Math.min(candidates.length - 1, Math.round(input.candidateIndex)));
    const selected = candidates[selectedIndex] as unknown as Record<string, any>;
    const scriptPackage = object(selected.scriptPackage) as Record<string, any>;
    const positioning = object(scriptPackage.positioning) as Record<string, any>;
    const goldenHook = object(scriptPackage.goldenHook) as Record<string, any>;
    const ending = object(scriptPackage.ending) as Record<string, any>;
    const currentScripts = object(selected.scripts) as Record<string, any>;
    const currentVoiceover = Array.isArray(scriptPackage.voiceoverLines) ? scriptPackage.voiceoverLines as Array<Record<string, any>> : [];
    const cleanLines = (values: string[]) => values.map((item) => item.trim()).filter(Boolean);
    const voiceoverLines = cleanLines(input.voiceoverLines).length
      ? cleanLines(input.voiceoverLines)
      : cleanLines(input.script.split(/\r?\n/).map(cleanVoiceoverText));
    const currentScript = String(selected.script || currentScripts.zh30 || currentScripts.zh15 || "");
    const existingShots = Array.isArray(selected.shots) ? selected.shots as Array<Record<string, any>> : [];
    const currentRequirements = Array.isArray(scriptPackage.shotRequirements)
      ? scriptPackage.shotRequirements as Array<Record<string, any>>
      : [];
    const nextVoiceover = voiceoverLines.length
      ? voiceoverLines.map((line, index) => {
        const exactIndex = currentVoiceover.findIndex((item) => comparableScriptText(item.text) === comparableScriptText(line));
        const previous = currentVoiceover[exactIndex >= 0 ? exactIndex : index] || {};
        return {
          text: line,
          lineId: previous.lineId || existingShots[index]?.lineId || `line_${String(index + 1).padStart(2, "0")}`,
          tone: previous.tone || "亲切自然",
          speed: previous.speed || "自然短句",
          emotion: previous.emotion || "真诚",
          durationSeconds: previous.durationSeconds || existingShots[index]?.durationSeconds || 3,
        };
      })
      : currentVoiceover;
    const nextShots = nextVoiceover.map((line, index) => {
      const previous = existingShots.find((item) => item.lineId === line.lineId) || existingShots[index] || {};
      const meaningChanged = Boolean(previous.voiceover)
        && comparableScriptText(previous.voiceover) !== comparableScriptText(line.text);
      return {
        ...previous,
        lineId: line.lineId,
        sequence: index,
        voiceover: line.text,
        subtitle: line.text.replace(/[，。！？；：,.!?;:]/g, ""),
        ...(meaningChanged ? {
          selectedAssetIds: [],
          missingReason: "脚本文案已修改，需要重新匹配并确认素材",
          alternativePlan: previous.alternativePlan || "重新检索系统素材库或补拍直接对应画面",
        } : {}),
      };
    });
    const nextRequirements = nextVoiceover.map((line, index) => {
      const previous = currentRequirements.find((item) => item.lineId === line.lineId) || currentRequirements[index] || {};
      const shot = (nextShots[index] || {}) as Record<string, any>;
      const meaningChanged = Boolean(previous.line)
        && comparableScriptText(previous.line) !== comparableScriptText(line.text);
      return {
        ...previous,
        lineId: line.lineId,
        line: line.text,
        visual: previous.visual || shot.visual || shot.description || "",
        assetStatus: meaningChanged ? "REWRITABLE" : previous.assetStatus || (shot.selectedAssetIds?.length ? "COVERED" : "NEED_SHOOT"),
        factualProof: previous.factualProof || "",
        audioVisualRequirement: meaningChanged
          ? "脚本文案语义已改变，保存后自动进入素材重新匹配"
          : previous.audioVisualRequirement || "",
      };
    });
    const cleanScript = nextVoiceover.map((line) => line.text).join("\n") || input.script.trim() || currentScript;
    const nextCandidate = {
      ...selected,
      title: input.title.trim() || selected.title || selected.titleZh,
      titleZh: input.title.trim() || selected.titleZh || selected.title,
      hook: input.hook.trim() || selected.hook || goldenHook.copy,
      script: cleanScript,
      shots: nextShots,
      scripts: {
        ...currentScripts,
        zh30: cleanScript,
        zh15: cleanScript,
      },
      scriptPackage: {
        ...scriptPackage,
        positioning: {
          coreTheme: input.coreTheme.trim() || positioning.coreTheme || "",
          communicationGoal: input.communicationGoal.trim() || positioning.communicationGoal || "",
          userPainPoint: input.userPainPoint.trim() || positioning.userPainPoint || "",
          uniqueSellingPoint: input.uniqueSellingPoint.trim() || positioning.uniqueSellingPoint || "",
        },
        goldenHook: { ...goldenHook, copy: input.hook.trim() || goldenHook.copy || selected.hook || "" },
        voiceoverLines: nextVoiceover,
        shotRequirements: nextRequirements,
        retentionDesign: cleanLines(input.retentionDesign).length ? cleanLines(input.retentionDesign) : strings(scriptPackage.retentionDesign),
        subtitles: cleanLines(input.subtitles).length
          ? cleanLines(input.subtitles)
          : nextVoiceover.map((line) => line.text.replace(/[，。！？；：,.!?;:]/g, "")),
        emphasisTexts: cleanLines(input.emphasisTexts).length ? cleanLines(input.emphasisTexts) : strings(scriptPackage.emphasisTexts),
        ending: {
          ...ending,
          summary: input.endingSummary.trim() || ending.summary || "",
          interaction: input.endingInteraction.trim() || ending.interaction || "",
          visual: input.endingVisual.trim() || ending.visual || "",
        },
      },
    };
    const explicitlyChangedLineIds = new Set((input.changedLineIds || []).map(String).filter(Boolean));
    const changedLineIds = new Set(nextShots
      .filter((shot, index) => explicitlyChangedLineIds.has(String(shot.lineId))
        || comparableScriptText(existingShots[index]?.voiceover) !== comparableScriptText(shot.voiceover))
      .map((shot) => String(shot.lineId)));
    let rematchedCandidate = nextCandidate as unknown as AiVideoCandidate & Record<string, unknown>;
    if (changedLineIds.size && plan.targetPlatforms?.[0]) {
      try {
        const rematchContext = await this.buildContext({
          platform: plan.targetPlatforms[0],
          productModel: plan.productModel || undefined,
          topic: String(brief.keywords || plan.topic),
          audience: String(brief.audience || plan.audience),
          objective: String(brief.videoType || plan.objective),
          keywordIds: Array.isArray(factory.keywordIds) ? factory.keywordIds.map(String) : [],
          externalVideoIds: Array.isArray(factory.externalVideoIds) ? factory.externalVideoIds.map(String) : [],
        });
        const fullyRematched = await this.preMatchScriptCandidate(nextCandidate as unknown as AiVideoCandidate, rematchContext.assets);
        const rematchedShots = Array.isArray(fullyRematched.shots) ? fullyRematched.shots as Array<Record<string, any>> : [];
        const mergedShots: Array<Record<string, any>> = nextShots.map((shot, index) => changedLineIds.has(String(shot.lineId))
          ? rematchedShots.find((item) => String(item.lineId) === String(shot.lineId)) || rematchedShots[index] || shot
          : shot) as Array<Record<string, any>>;
        const mergedRequirements = nextRequirements.map((requirement, index) => {
          if (!changedLineIds.has(String(requirement.lineId))) return requirement;
          const shot = mergedShots[index] || {};
          return {
            ...requirement,
            assetStatus: shot.selectedAssetIds?.length ? "COVERED" : "NEED_SHOOT",
            materialMatchReason: shot.materialMatchReason || shot.missingReason || "",
            matchedAssetIds: shot.selectedAssetIds || [],
            auxiliaryImageAssetIds: shot.auxiliaryImageAssetIds || [],
          };
        });
        rematchedCandidate = {
          ...fullyRematched,
          shots: mergedShots,
          assetIds: Array.from(new Set(mergedShots.flatMap((shot) => [
            ...strings(shot.selectedAssetIds),
            ...strings(shot.auxiliaryImageAssetIds),
          ]))),
          missingAssets: mergedShots.filter((shot) => !strings(shot.selectedAssetIds).length).map((shot) => String(shot.description || shot.visual || "")),
          materialPreMatch: {
            status: "COMPLETED",
            matchedAt: new Date().toISOString(),
            total: mergedShots.length,
            covered: mergedShots.filter((shot) => strings(shot.selectedAssetIds).length).length,
            missing: mergedShots.filter((shot) => !strings(shot.selectedAssetIds).length).length,
          },
          scriptPackage: {
            ...object(fullyRematched.scriptPackage),
            shotRequirements: mergedRequirements,
          },
        } as unknown as AiVideoCandidate & Record<string, unknown>;
      } catch {
        // 保存脚本文本不能被素材索引的临时故障阻断；已变化的句子保留待重匹配标记。
      }
    }
    const nextCandidates = candidates.map((candidate, index) => index === selectedIndex ? rematchedCandidate : candidate);
    const editedAt = new Date().toISOString();
    const revisedShots = Array.isArray(rematchedCandidate.shots)
      ? rematchedCandidate.shots as Array<Record<string, any>>
      : [];
    const revisionLines = Array.from(changedLineIds).map((lineId) => {
      const before = existingShots.find((shot) => String(shot.lineId) === lineId) || {};
      const after = revisedShots.find((shot) => String(shot.lineId) === lineId) || {};
      return {
        lineId,
        beforeText: String(before.voiceover || ""),
        afterText: String(after.voiceover || ""),
        beforeAssetIds: strings(before.selectedAssetIds),
        afterAssetIds: strings(after.selectedAssetIds),
        auxiliaryImageAssetIds: strings(after.auxiliaryImageAssetIds),
        materialBindingChanged: JSON.stringify(strings(before.selectedAssetIds)) !== JSON.stringify(strings(after.selectedAssetIds)),
        materialMatchStatus: strings(after.selectedAssetIds).length ? "COVERED" : "MISSING",
      };
    });
    const nextSignals = signals.map((signal) => signal.type === "VIDEO_FACTORY"
      ? {
        ...signal,
        scriptCandidates: nextCandidates,
        selectedCandidateIndex: selectedIndex,
        scriptEditedAt: editedAt,
        scriptEditedBy: actor,
        scriptRevisionHistory: [
          ...(Array.isArray(signal.scriptRevisionHistory) ? signal.scriptRevisionHistory : []),
          {
            revision: (Array.isArray(signal.scriptRevisionHistory) ? signal.scriptRevisionHistory.length : 0) + 1,
            candidateIndex: selectedIndex,
            candidateGeneratedAt: String(selected.generatedAt || ""),
            editedAt,
            editedBy: actor,
            lines: revisionLines,
          },
        ].slice(-20),
        materialReview: { status: "PENDING", invalidatedReason: "SCRIPT_EDITED" },
      }
      : signal);
    await this.prisma.$transaction([
      this.prisma.contentPlan.update({
        where: { id: contentPlanId },
        data: {
          topic: input.title.trim() || plan.topic,
          hook: input.hook.trim() || plan.hook,
          sourceSignals: nextSignals as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.contentVariant.updateMany({
        where: { contentPlanId },
        data: {
          title: input.title.trim() || plan.topic,
          body: cleanScript,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actor,
          action: "VIDEO_FACTORY_SCRIPT_UPDATE",
          entityType: "ContentPlan",
          entityId: contentPlanId,
          after: { selectedIndex, title: input.title.trim(), hook: input.hook.trim(), changedLineIds: Array.from(changedLineIds) },
        },
      }),
    ]);
    return this.project(contentPlanId);
  }

  async createGroupedReshootTask(contentPlanId: string, assigneeEmployeeId: string, actor: string) {
    const plan = await this.prisma.contentPlan.findUnique({
      where: { id: contentPlanId },
      include: { videoShots: { orderBy: { sequence: "asc" } } },
    });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    if (!["SCRIPT_APPROVED", "READY_TO_EDIT"].includes(plan.productionStage)) {
      throw new BadRequestException("脚本审核通过后才能生成补拍任务");
    }
    const missingShots = plan.videoShots.filter((shot) => !shot.selectedAssetId);
    if (!missingShots.length) throw new BadRequestException("当前脚本没有需要补齐的素材");
    const existing = await this.prisma.opsTask.findFirst({
      where: {
        sourceType: "VIDEO_FACTORY_PROJECT",
        sourceId: contentPlanId,
        category: "CONTENT_PRODUCTION",
        status: { notIn: ["CANCELLED", "COMPLETED"] },
      },
    });
    if (existing) return existing;
    const items = missingShots.map((shot) => {
      const metadata = object(shot.metadata);
      return {
        shotId: shot.id,
        lineId: String(metadata.lineId || shot.requirementKey),
        sequence: shot.sequence,
        scriptLine: shot.voiceover || shot.subtitle || shot.description,
        title: shot.title,
        requirement: shot.description,
        missingReason: String(metadata.missingReason || ""),
        requiredAssetTags: strings(metadata.requiredAssetTags),
        allowedStrategies: ["RESHOOT", "AI_GENERATE"],
      };
    });
    const task = await this.prisma.opsTask.create({
      data: {
        taskNo: `TASK-VF-${localDateKey(new Date()).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`,
        title: `补齐脚本素材：${plan.topic}`,
        description: `本任务包含同一脚本的${items.length}个缺失镜头，请逐项补拍或发起AI生成，并上传到对应镜头项。`,
        category: "CONTENT_PRODUCTION",
        priority: "HIGH",
        status: "OPEN",
        assigneeEmployeeId,
        assignedBy: actor,
        sourceType: "VIDEO_FACTORY_PROJECT",
        sourceId: contentPlanId,
        platform: plan.targetPlatforms[0],
        evidence: {
          contentPlanId,
          productionNo: plan.productionNo,
          groupingPolicy: "ONE_TASK_PER_SCRIPT",
          items,
        } as unknown as Prisma.InputJsonValue,
        expectedResult: "所有缺失镜头均已上传或AI生成、通过审核，并绑定到对应脚本行后再提交远程剪辑。",
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actor,
        action: "VIDEO_FACTORY_GROUPED_RESHOOT_TASK_CREATE",
        entityType: "OpsTask",
        entityId: task.id,
        after: { contentPlanId, missingShotCount: items.length },
      },
    });
    return task;
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
    const signals = sourceSignals(plan);
    const factory = signals.find((signal) => signal.type === "VIDEO_FACTORY") || {};
    const brief = object(factory.brief);
    const remoteCandidates = input.scriptCandidates.slice(0, plan.workflowVersion >= 4 ? 1 : 3).map((item) => ({
      ...packageCodexCandidate(item, {
        productModel: plan.productModel || "",
        platform: String(plan.targetPlatforms[0] || "DOUYIN"),
        audience: plan.audience || "目标用户",
        objective: plan.objective || "普通种草",
        accountType: String(brief.accountType || "BRAND"),
        estimatedDurationSeconds: number(brief.estimatedDurationSeconds, 30),
        healthContentAllowed: brief.healthContentAllowed !== false,
      }),
      generationSource: "REMOTE_CODEX",
      generatedAt: new Date().toISOString(),
    }));
    // The system draft is historical context after a handoff.  Only show the
    // Codex result in the active review workspace.
    const candidates = remoteCandidates.slice(0, plan.workflowVersion >= 4 ? 1 : 3) as VideoScriptCandidateV3[];
    let selected: VideoScriptCandidateV3 & Record<string, unknown> = (
      remoteCandidates.find((item) => item.selected) || remoteCandidates[0] || candidates[0]
    ) as VideoScriptCandidateV3 & Record<string, unknown>;
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
    const usedVideoAssetIds = new Set<string>();
    const shots = selected.shots.map((shot, index): VideoShotPlanV3 => {
      const validShotAssetIds = shot.selectedAssetIds.filter((id) => validAssetIds.has(id));
      const duplicatedAssetIds = validShotAssetIds.filter((id) => usedVideoAssetIds.has(id));
      const selectedAssetIds = validShotAssetIds.filter((id) => {
        if (usedVideoAssetIds.has(id)) return false;
        usedVideoAssetIds.add(id);
        return true;
      });
      return {
        ...shot,
        sequence: index,
        lineId: String(shot.lineId || `line_${String(index + 1).padStart(2, "0")}`),
        durationSeconds: Math.max(2, Math.min(12, Math.round(number(shot.durationSeconds, 4)))),
        selectedAssetIds,
        missingReason: selectedAssetIds.length
          ? shot.missingReason
          : duplicatedAssetIds.length
            ? "该视频素材已用于前一句口播，需要不同的直接画面"
            : shot.missingReason,
        alternativePlan: selectedAssetIds.length
          ? shot.alternativePlan
          : duplicatedAssetIds.length
            ? "上传补拍素材或调用AI生成，并绑定到本句脚本"
            : shot.alternativePlan,
      };
    });
    const normalizedSelected = {
      ...selected,
      shots,
      missingAssets: shots
        .filter((shot) => !shot.selectedAssetIds.length)
        .map((shot) => ({
          moduleType: shot.moduleType,
          description: shot.description,
          reason: shot.missingReason,
          alternative: shot.alternativePlan,
        })),
    } as VideoScriptCandidateV3;
    const selectedIndex = candidates.indexOf(selected);
    if (selectedIndex >= 0) candidates[selectedIndex] = normalizedSelected;
    selected = normalizedSelected;
    const requestedEngines = Array.isArray(brief.scriptEngines)
      ? brief.scriptEngines.map(String)
      : ["REMOTE_CODEX"];
    const scriptEngineStatus: Record<string, unknown> = {
      ...object(factory.scriptEngineStatus),
      REMOTE_CODEX: "COMPLETED",
    };
    const allRequestedEnginesCompleted = requestedEngines.every((engine) => scriptEngineStatus[engine] === "COMPLETED");
    const nextSignals = [
      ...signals.map((signal) => signal.type === "VIDEO_FACTORY"
        ? {
          ...signal,
          scriptCandidates: candidates,
          selectedCandidateIndex: candidates.indexOf(selected),
          scriptEngineStatus,
          workflowVersion: plan.workflowVersion,
        }
        : signal),
      ...(!signals.some((signal) => signal.type === "AI_TASK" && signal.id === input.aiTaskId)
        ? [{ type: "AI_TASK", id: input.aiTaskId, executionMode: input.executionMode, provider: "CODEX" }]
        : []),
    ];
    const platform = plan.targetPlatforms[0] || IntegrationKind.DOUYIN;
    const canonicalShotKeys = shots.map((shot) => canonicalVideoShotKey(shot.lineId, shot.sequence));
    await this.prisma.$transaction(async (tx) => {
      await tx.contentPlan.update({
        where: { id: plan.id },
        data: {
          hook: selected.hook || plan.hook,
          score: Math.round(number(selected.score, plan.score)),
          scoreBreakdown: selected.scoreBreakdown as Prisma.InputJsonValue,
          outline: shots as unknown as Prisma.InputJsonValue,
          shootRequirements: shots.map((shot) => ({
            key: canonicalVideoShotKey(shot.lineId, shot.sequence),
            title: shot.title,
            description: shot.description,
            moduleType: shot.moduleType,
            status: shot.selectedAssetIds.length ? "DONE" : "OPEN",
            selectedAssetId: shot.selectedAssetIds[0] || null,
            missingReason: shot.missingReason,
            alternativePlan: shot.alternativePlan,
          })) as unknown as Prisma.InputJsonValue,
          sourceSignals: nextSignals as unknown as Prisma.InputJsonValue,
          productionStage: allRequestedEnginesCompleted ? "FACTORY_SCRIPT_READY" : "SCRIPT_GENERATING",
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
          metadata: {
            cta: selected.cta,
            templateCode: selected.templateCode,
            hashtags: strings(selected.hashtags),
            publicationPackage: {
              title: selected.title || plan.topic,
              coverText: selected.hook,
              commentGuide: selected.cta || "结合本条内容提出一个具体使用问题",
              publishTimeSuggestion: "由运营结合账号近7日活跃时段确认",
            },
          },
        },
        update: {
          title: selected.title || plan.topic,
          body: selected.script,
          coverSpec: { text: selected.hook, ratio: "9:16" },
          metadata: {
            cta: selected.cta,
            templateCode: selected.templateCode,
            hashtags: strings(selected.hashtags),
            publicationPackage: {
              title: selected.title || plan.topic,
              coverText: selected.hook,
              commentGuide: selected.cta || "结合本条内容提出一个具体使用问题",
              publishTimeSuggestion: "由运营结合账号近7日活跃时段确认",
            },
          },
        },
      });
      for (const shot of shots) {
        const selectedAssetId = shot.selectedAssetIds[0] || null;
        const requirementKey = canonicalVideoShotKey(shot.lineId, shot.sequence);
        await tx.videoShot.upsert({
          where: { contentPlanId_requirementKey: { contentPlanId: plan.id, requirementKey } },
          create: {
            contentPlanId: plan.id,
            requirementKey,
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
              lineId: shot.lineId || `line_${String(shot.sequence + 1).padStart(2, "0")}`,
              sourceIn: shot.sourceIn ?? null,
              sourceOut: shot.sourceOut ?? null,
              visibleFacts: shot.visibleFacts || [],
              restrictions: shot.restrictions || [],
              semanticScore: shot.semanticScore ?? null,
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
              lineId: shot.lineId || `line_${String(shot.sequence + 1).padStart(2, "0")}`,
              sourceIn: shot.sourceIn ?? null,
              sourceOut: shot.sourceOut ?? null,
              visibleFacts: shot.visibleFacts || [],
              restrictions: shot.restrictions || [],
              semanticScore: shot.semanticScore ?? null,
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
    if (allRequestedEnginesCompleted) {
      const covered = shots.filter((shot) => shot.selectedAssetIds.length).length;
      await this.notifyProjectMilestone(
        plan.id,
        "VIDEO_SCRIPT_AND_MATERIAL_MATCH_READY",
        "视频脚本与素材预匹配已完成",
        `脚本已生成，可直接审核；已匹配${covered}个镜头，缺失${shots.length - covered}个镜头。`,
      ).catch(() => undefined);
    }
    return this.project(plan.id);
  }

  /** Make a script line actionable when an older system-AI result has no VideoShot row yet. */
  async ensureScriptLineShot(contentPlanId: string, candidateIndex: number, lineIndex: number) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id: contentPlanId } });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    const candidates = this.candidates(plan);
    const candidate = object(candidates[Math.max(0, Math.min(candidates.length - 1, Math.round(candidateIndex)))]);
    const rows = Array.isArray(candidate.shots) ? candidate.shots.map(object) : [];
    const shot = rows[Math.max(0, Math.min(rows.length - 1, Math.round(lineIndex)))];
    if (!shot) throw new BadRequestException("当前脚本行不存在");
    const sequence = Math.max(0, Math.round(number(shot.sequence, lineIndex)));
    const lineId = String(shot.lineId || `line_${String(sequence + 1).padStart(2, "0")}`);
    const requirementKey = canonicalVideoShotKey(lineId, sequence);
    const requestedAssetIds = strings(shot.selectedAssetIds);
    const approvedAssets = requestedAssetIds.length
      ? await this.prisma.asset.findMany({
        where: { id: { in: requestedAssetIds }, kind: "VIDEO", reviewStatus: "APPROVED", availabilityStatus: "ACTIVE", rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] }, deletedAt: null },
        select: { id: true },
      })
      : [];
    const approvedIds = new Set(approvedAssets.map((asset) => asset.id));
    const selectedAssetIds = requestedAssetIds.filter((assetId) => approvedIds.has(assetId));
    const canonicalShot = await this.prisma.videoShot.upsert({
      where: { contentPlanId_requirementKey: { contentPlanId, requirementKey } },
      create: {
        contentPlanId,
        requirementKey,
        sequence,
        title: String(shot.title || shot.description || lineId),
        description: String(shot.description || shot.visual || shot.voiceover || ""),
        moduleType: String(shot.moduleType || "SCRIPT_LINE"),
        status: selectedAssetIds.length ? "DONE" : "OPEN",
        sourcePreference: String(shot.sourcePreference || "REAL_ASSET_FIRST"),
        durationSeconds: Math.max(2, Math.min(12, Math.round(number(shot.durationSeconds, 4)))),
        prompt: String(shot.visual || ""),
        voiceover: String(shot.voiceover || ""),
        subtitle: String(shot.subtitle || ""),
        assetIds: selectedAssetIds,
        selectedAssetId: selectedAssetIds[0] || null,
        metadata: { lineId, missingReason: String(shot.missingReason || shot.materialMatchReason || ""), alternativePlan: String(shot.alternativePlan || "") },
      },
      update: {
        sequence,
        title: String(shot.title || shot.description || lineId),
        description: String(shot.description || shot.visual || shot.voiceover || ""),
        moduleType: String(shot.moduleType || "SCRIPT_LINE"),
        status: selectedAssetIds.length ? "DONE" : "OPEN",
        durationSeconds: Math.max(2, Math.min(12, Math.round(number(shot.durationSeconds, 4)))),
        prompt: String(shot.visual || ""),
        voiceover: String(shot.voiceover || ""),
        subtitle: String(shot.subtitle || ""),
        assetIds: selectedAssetIds,
        selectedAssetId: selectedAssetIds[0] || null,
      },
    });
    await this.prisma.videoShot.deleteMany({
      where: {
        contentPlanId,
        id: { not: canonicalShot.id },
        OR: [
          { requirementKey: `system-v4-${lineId}` },
          { requirementKey: `codex-v3-${sequence}` },
          { metadata: { path: ["lineId"], equals: lineId } },
        ],
      },
    });
    return this.project(contentPlanId);
  }

  async syncProjectTaskState(contentPlanId: string, taskStatus: string) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id: contentPlanId } });
    if (!plan) return null;
    const factory = sourceSignals(plan).find((signal) => signal.type === "VIDEO_FACTORY") || {};
    const lastTaskMode = String(factory.lastTaskMode || "");
    const singleProjectFlow = plan.workflowVersion >= 4;
    let productionStage = plan.productionStage;
    if (["CLAIMED", "RUNNING", "QUALITY_CHECK", "UPLOADING"].includes(taskStatus)) {
      productionStage = lastTaskMode === "SCRIPT_ONLY"
        ? "SCRIPT_GENERATING"
        : lastTaskMode === "COVER_TITLE"
          ? "PLATFORM_PACKAGING"
          : "EDITING";
    } else if (["FAILED", "RETURNED", "CANCELLED"].includes(taskStatus)) {
      productionStage = lastTaskMode === "COVER_TITLE"
        ? "PLATFORM_PACKAGING"
        : lastTaskMode === "FULL_VIDEO"
          ? "READY_TO_EDIT"
          : singleProjectFlow
            ? (this.candidates(plan).length ? "SCRIPT_RETURNED" : "PROJECT_BRIEF")
            : (this.candidates(plan).length ? "FACTORY_SCRIPT_READY" : "TOPIC_CARD_APPROVED");
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
    if (provider.code === "VOLCENGINE_SEEDANCE") {
      const apiKey = String(secret.apiKey || "");
      const url = `${String(provider.baseUrl || "").replace(/\/$/u, "")}/contents/generations/tasks/__saydian_connection_check__`;
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(15_000),
        });
        if ([401, 403].includes(response.status)) throw new Error("API密钥无效或未开通Seedance权限");
        if (response.status >= 500) throw new Error(`火山方舟服务返回${response.status}`);
        const updated = await this.prisma.videoModelProvider.update({
          where: { id },
          data: {
            state: "HEALTHY",
            message: "连接正常，模型权限将在首次生成时确认",
            lastCheckedAt: new Date(),
            lastSuccessAt: new Date(),
          },
        });
        await this.prisma.auditLog.create({
          data: { actor, action: "VIDEO_PROVIDER_CHECK", entityType: "VideoModelProvider", entityId: id, after: { state: "HEALTHY" } },
        });
        return this.providerView(updated);
      } catch (error) {
        const updated = await this.prisma.videoModelProvider.update({
          where: { id },
          data: { state: "ERROR", message: error instanceof Error ? error.message : "连接失败", lastCheckedAt: new Date() },
        });
        return this.providerView(updated);
      }
    }
    if (provider.code === "KLING") {
      const apiKey = String(secret.apiKey || "");
      const url = `${String(provider.baseUrl || "").replace(/\/$/u, "")}/tasks`;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 1 }),
          signal: AbortSignal.timeout(15_000),
        });
        const payload = await response.json().catch(() => ({})) as JsonRow;
        if ([401, 403].includes(response.status)) throw new Error("API密钥无效");
        if (!response.ok || Number(payload.code ?? 0) !== 0) {
          throw new Error(String(payload.message || `可灵服务返回${response.status}`));
        }
        const updated = await this.prisma.videoModelProvider.update({
          where: { id },
          data: {
            state: "HEALTHY",
            message: "连接正常，可灵 3.0 Turbo 已启用",
            lastCheckedAt: new Date(),
            lastSuccessAt: new Date(),
          },
        });
        await this.prisma.auditLog.create({
          data: { actor, action: "VIDEO_PROVIDER_CHECK", entityType: "VideoModelProvider", entityId: id, after: { state: "HEALTHY" } },
        });
        return this.providerView(updated);
      } catch (error) {
        const updated = await this.prisma.videoModelProvider.update({
          where: { id },
          data: { state: "ERROR", message: error instanceof Error ? error.message : "连接失败", lastCheckedAt: new Date() },
        });
        return this.providerView(updated);
      }
    }
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
        kind: "VIDEO",
        purpose: "EDITING_FOOTAGE",
        reviewStatus: "APPROVED",
        availabilityStatus: "ACTIVE",
        rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
        deletedAt: null,
        ...((product || input.productModel)
          ? {
            OR: [
              ...(product ? [{ products: { some: { productId: product.id } } }] : []),
              ...(input.productModel ? [{ model: input.productModel }] : []),
            ],
          }
          : {}),
      },
      select: {
        id: true, assetNo: true, displayName: true, kind: true, contentDescription: true,
        model: true, scene: true, qualityScore: true, objectKey: true,
        aiIndex: true, searchText: true, indexVersion: true, indexConfidence: true, indexNeedsReview: true,
        tags: { select: { tag: { select: { namespace: true, code: true, label: true } } } },
        segments: {
          select: {
            id: true, moduleType: true, startSeconds: true, endSeconds: true,
            transcript: true, confidence: true, status: true,
          },
          orderBy: { startSeconds: "asc" },
          take: 20,
        },
      },
      orderBy: [{ indexNeedsReview: "asc" }, { qualityScore: "desc" }, { useCount: "asc" }, { updatedAt: "desc" }],
      take: 80,
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
      generationMode: input.generationMode === "ASSET_ONLY" ? "ASSET_ONLY" : "NORMAL",
      scriptSource: input.scriptSource === "USER" ? "USER" : "AI",
      userProvidedDirections: (input.userProvidedDirections || [])
        .map((item, index) => ({
          index: Number.isFinite(Number(item.index)) ? Number(item.index) : index,
          title: String(item.title || "").trim(),
          content: String(item.content || "").trim(),
        }))
        .filter((item) => item.content),
      product,
      keywords,
      knowledge,
      assets,
      assetKnowledgePolicy: {
        source: "PERSISTENT_STRUCTURED_ASSET_INDEX",
        instruction: "写脚本前先按产品、功能、动作、场景、景别和有效时段检索assets中的持久化索引；围绕已审核可调用的VIDEO素材设计逐句镜头。indexNeedsReview和indexConfidence只作为辅助信息，不是准入门槛。不得凭文件名推断功能，不得使用图片。只有索引无法提供直接视频证据时才列为缺失素材。",
        minimumPreferredIndexConfidence: null,
        learnedAssetCount: assets.filter((asset) => asset.indexVersion >= 4).length,
        reviewRequiredAssetCount: assets.filter((asset) => asset.indexNeedsReview).length,
      },
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
    if (input.deferScriptGeneration) return this.createDraftProject(input, actor);
    const context = await this.buildContext(input);
    let candidates: AiVideoCandidate[];
    try {
      candidates = await this.aiContent.generateVideoCandidates({
        platform: context.platform,
        product: context.product,
        keywords: context.keywords,
        knowledge: context.knowledge,
        assets: context.assets,
        assetKnowledgePolicy: context.assetKnowledgePolicy,
        references: context.references,
        topic: context.topic,
        audience: context.audience,
        objective: context.objective,
        voiceoverMode: context.voiceoverMode,
        generationMode: context.generationMode,
        contentRestrictionMode: context.contentRestrictionMode,
        scriptSource: context.scriptSource,
        userProvidedDirections: context.userProvidedDirections,
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
            allowFallback: input.allowFallback === true,
            allowExternalGeneration: input.allowExternalGeneration === true,
            externalReferencePolicy: "STRUCTURE_ONLY",
            voiceoverMode: context.voiceoverMode,
            accountType: context.accountType,
            estimatedDurationSeconds: context.estimatedDurationSeconds,
            contentRestrictionMode: context.contentRestrictionMode,
            generationMode: context.generationMode,
            scriptSource: context.scriptSource,
            userProvidedDirections: context.userProvidedDirections,
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
              metadata: {
                hashtags: primary.hashtags,
                publicationPackage: {
                  title: context.platform === "TIKTOK" ? primary.titleEn : primary.titleZh,
                  coverText: context.platform === "TIKTOK" ? primary.coverTextEn : primary.coverTextZh,
                  commentGuide: "结合本条内容提出一个具体使用问题",
                  publishTimeSuggestion: "由运营结合账号近7日活跃时段确认",
                },
              },
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
      allowFallback: factory.allowFallback === true,
      allowExternalGeneration: factory.allowExternalGeneration === true,
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

    await this.generateProject(created.id, {
      candidateIndex: 0,
      routingMode: String(factory.routingMode || "AUTO"),
      requestedModelId: factory.requestedModelId ? String(factory.requestedModelId) : undefined,
      allowFallback: factory.allowFallback === true,
      allowExternalGeneration: factory.allowExternalGeneration === true,
    }, actor);
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
    const selectedRecord = selected as unknown as Record<string, unknown>;
    const rawSelectedShots = Array.isArray(selectedRecord.shots)
      ? selectedRecord.shots as Array<Record<string, unknown>>
      : [];
    const selectedShots: Array<Record<string, unknown> & { lineId: string }> = Array.from(new Map<string, Record<string, unknown> & { lineId: string }>(rawSelectedShots.map((shot, index) => {
      const lineId = String(shot.lineId || `line_${String(index + 1).padStart(2, "0")}`).trim();
      return [lineId, { ...shot, lineId }];
    })).values());
    const selectedOutline = Array.isArray(selectedRecord.outline)
      ? strings(selectedRecord.outline)
      : selectedShots.map((shot) => String(shot.visual || shot.description || shot.voiceover || "")).filter(Boolean);
    const selectedScripts = object(selectedRecord.scripts);
    const selectedScript = String(selectedRecord.script || selectedScripts.zh15 || selectedScripts.zh30 || "").trim();
    const selectedTitle = String(selectedRecord.topic || selectedRecord.title || plan.topic || "").trim();
    const selectedAudience = String(selectedRecord.audience || plan.audience || "").trim();
    const selectedObjective = String(selectedRecord.objective || plan.objective || "").trim();
    const check = await this.guard.evaluate({
      title: selectedTitle,
      body: `${String(selectedRecord.hook || "").trim()}\n${selectedOutline.join("\n")}\n${selectedScript}\n${String(selectedScripts.en15 || "").trim()}`,
      productModel: plan.productModel || undefined,
      evidenceIds: plan.evidenceIds,
    });
    if (!check.allowed) throw new BadRequestException(`脚本审核未通过：${check.reasons.join("；")}`);

    const assetIds = Array.from(new Set([
      ...strings(selectedRecord.assetIds),
      ...selectedShots.flatMap((shot) => [...strings(shot.selectedAssetIds), ...strings(shot.auxiliaryImageAssetIds)]),
    ]));
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
    const preMatchedShots = selectedShots;
    let coverage: Array<{ lineId: string; moduleType: string; description: string; matchedAssetIds: string[]; matchedVideoAssetIds: string[]; auxiliaryImageAssetIds: string[]; coverage: "EXISTING" | "MISSING"; reason: string }> = preMatchedShots.map((shot, index) => {
      const selectedAssetIds = strings(shot.selectedAssetIds);
      const { matchedVideoAssetIds, auxiliaryImageAssetIds } = partitionVideoShotAssetIds(
        selectedAssetIds,
        strings(shot.auxiliaryImageAssetIds),
        assets,
      );
      return {
        lineId: String(shot.lineId || `line_${String(index + 1).padStart(2, "0")}`),
        moduleType: String(shot.moduleType || (index === 0 ? "HOOK" : index === preMatchedShots.length - 1 ? "CTA" : "SCENE")).toUpperCase(),
        description: String(shot.visual || shot.description || shot.voiceover || ""),
        matchedAssetIds: Array.from(new Set([...selectedAssetIds, ...auxiliaryImageAssetIds])),
        matchedVideoAssetIds,
        auxiliaryImageAssetIds,
        coverage: matchedVideoAssetIds.length || auxiliaryImageAssetIds.length ? "EXISTING" : "MISSING",
        reason: String(shot.materialMatchReason || shot.missingReason || (matchedVideoAssetIds.length || auxiliaryImageAssetIds.length ? "脚本生成阶段已按分镜完成素材预匹配" : "缺少明确匹配的真实素材")),
      };
    });
    if (!coverage.length) {
      try {
        const analyzed = (await this.aiContent.analyzeVideoAssetCoverage({
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
        coverage = analyzed.map((item, index) => ({
          ...item,
          lineId: `line_${String(index + 1).padStart(2, "0")}`,
          moduleType: index === 0 ? "HOOK" : index === analyzed.length - 1 ? "CTA" : "SCENE",
        }));
      } catch {
        coverage = selectedOutline.map((description, index) => ({
          lineId: `line_${String(index + 1).padStart(2, "0")}`,
          moduleType: index === 0 ? "HOOK" : index === selectedOutline.length - 1 ? "CTA" : "SCENE",
          description,
          matchedAssetIds: [],
          matchedVideoAssetIds: [],
          auxiliaryImageAssetIds: [],
          coverage: "MISSING",
          reason: "自动素材匹配失败，未按文件顺序替代，请重新匹配或补充素材",
        }));
      }
    }
    if (!coverage.length) throw new BadRequestException("未能生成分镜素材清单");
    const signals = sourceSignals(plan);
    const factorySignal = signals.find((item) => item.type === "VIDEO_FACTORY") || {};
    const factoryModule = videoFactoryModule(plan);
    const routingMode = String(input.routingMode || factorySignal.routingMode || "AUTO").toUpperCase();
    const requestedModelId = String(input.requestedModelId || factorySignal.requestedModelId || "").trim() || undefined;
    const allowExternalGeneration = input.allowExternalGeneration === true;
    const allowFallback = allowExternalGeneration && (input.allowFallback ?? factorySignal.allowFallback === true);
    const criticalModules = new Set(["PRODUCT", "DEMO", "FUNCTION", "FEATURE", "PROOF"]);
    const criticalMissing = coverage.filter((shot) => shot.coverage === "MISSING" && criticalModules.has(shot.moduleType));
    if (factoryModule === "DOUYIN_VIRAL" && criticalMissing.length) {
      throw new BadRequestException(`产品关键镜头缺失：${criticalMissing.map((shot) => shot.description).join("、")}。请补充已审核真实素材后再生成完整视频`);
    }
    if (!input.prepareOnly && allowExternalGeneration && coverage.some((shot) => shot.coverage === "MISSING")) {
      const modelRequirements = Array.from(new Map(coverage
        .filter((shot) => shot.coverage === "MISSING")
        .map((shot) => {
          const scenario = factoryModule === "DOUYIN_VIRAL" ? douyinViralModelScenario(shot.description) : "SCENE";
          const capability = shot.auxiliaryImageAssetIds.length ? "IMAGE_TO_VIDEO" : "TEXT_TO_VIDEO";
          return [`${scenario}:${capability}`, { scenario, capability }];
        })).values());
      await Promise.all(modelRequirements.map(async ({ scenario, capability }) => {
        await this.resolveModel({ requestedModelId, platform: plan.targetPlatforms[0], scenario, capability });
      }));
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.videoGenerationJob.deleteMany({ where: { contentPlanId: id, status: { in: ["PENDING", "RETRY"] } } });
      const requirements: Array<Record<string, unknown>> = [];
      const canonicalShotKeys: string[] = [];
      for (let index = 0; index < coverage.length; index += 1) {
        const item = coverage[index];
        const requirementKey = canonicalVideoShotKey(item.lineId, index);
        canonicalShotKeys.push(requirementKey);
        const selectedAssetId = item.matchedVideoAssetIds[0] || null;
        const shot = await tx.videoShot.upsert({
          where: { contentPlanId_requirementKey: { contentPlanId: id, requirementKey } },
          create: {
            contentPlanId: id,
            requirementKey,
            sequence: index,
            title: `镜头${index + 1}`,
            description: item.description,
            moduleType: item.moduleType,
            status: selectedAssetId ? "DONE" : "OPEN",
            sourcePreference: selectedAssetId ? "REAL_ASSET" : (allowExternalGeneration && !input.prepareOnly ? "AI_GENERATED" : "REAL_ASSET_FIRST"),
            durationSeconds: 5,
            prompt: item.description,
            assetIds: item.matchedAssetIds,
            selectedAssetId,
            requestedModelId,
            metadata: {
              lineId: item.lineId,
              candidateIndex,
              candidateGeneratedAt: String((selected as unknown as Record<string, unknown>).generatedAt || ""),
              reason: item.reason,
              imageAssetIds: item.auxiliaryImageAssetIds,
            },
          },
          update: {
            sequence: index,
            title: `镜头${index + 1}`,
            description: item.description,
            moduleType: item.moduleType,
            status: selectedAssetId ? "DONE" : "OPEN",
            sourcePreference: selectedAssetId ? "REAL_ASSET" : (allowExternalGeneration && !input.prepareOnly ? "AI_GENERATED" : "REAL_ASSET_FIRST"),
            prompt: item.description,
            assetIds: item.matchedAssetIds,
            selectedAssetId,
            requestedModelId,
            metadata: {
              lineId: item.lineId,
              candidateIndex,
              candidateGeneratedAt: String((selected as unknown as Record<string, unknown>).generatedAt || ""),
              reason: item.reason,
              imageAssetIds: item.auxiliaryImageAssetIds,
            },
          },
        });
        if (!selectedAssetId && !input.prepareOnly && allowExternalGeneration) {
          const modelScenario = factoryModule === "DOUYIN_VIRAL"
            ? douyinViralModelScenario(item.description)
            : "SCENE";
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
                factoryModule,
                modelScenario,
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
          status: selectedAssetId ? "DONE" : (allowExternalGeneration && !input.prepareOnly ? "IN_PROGRESS" : "OPEN"),
          coverage: selectedAssetId ? "EXISTING" : "MISSING",
          assetIds: item.matchedAssetIds,
          videoAssetIds: item.matchedVideoAssetIds,
          imageAssetIds: item.auxiliaryImageAssetIds,
          reason: item.reason,
          note: selectedAssetId
            ? "使用已审核真实素材"
            : (allowExternalGeneration && !input.prepareOnly ? "外部生成任务已排队" : "等待补充已审核真实素材或明确开启外部生成"),
        });
      }
      await tx.videoShot.deleteMany({
        where: {
          contentPlanId: id,
          requirementKey: { notIn: canonicalShotKeys },
          OR: [
            { requirementKey: { startsWith: "system-v4-" } },
            { requirementKey: { startsWith: "codex-v3-" } },
            { requirementKey: { startsWith: "factory-shot-" } },
          ],
        },
      });
      if (assets.length) {
        await tx.contentAsset.createMany({
          data: assets.map((asset) => ({ contentPlanId: id, assetId: asset.id, role: "VIDEO_FACTORY_SOURCE" })),
          skipDuplicates: true,
        });
      }
      const allMaterialsReady = requirements.every((item) => item.status === "DONE");
      const automaticBindingFingerprint = coverage
        .map((item, index) => [canonicalVideoShotKey(item.lineId, index), item.matchedVideoAssetIds[0] || "", "", ""].join(":"))
        .join("|");
      const nextSignals = signals.map((item) => item.type === "VIDEO_FACTORY"
        ? {
          ...item,
          selectedCandidateIndex: candidateIndex,
          routingMode,
          requestedModelId,
          allowFallback,
          allowExternalGeneration,
          ...(allMaterialsReady ? {
            materialReview: {
              status: "APPROVED",
              actor: "SYSTEM",
              reviewedAt: new Date().toISOString(),
              workflowVersion: plan.workflowVersion,
              bindingFingerprint: automaticBindingFingerprint,
              automatic: true,
            },
          } : {}),
        }
        : item);
      await tx.contentPlan.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvedBy: actor,
          approvedAt: new Date(),
          topic: selectedTitle,
          audience: selectedAudience,
          objective: selectedObjective,
          hook: String(selectedRecord.hook || "").trim(),
          outline: selectedOutline,
          score: Number(selectedRecord.score || 0),
          scoreBreakdown: object(selectedRecord.scoreBreakdown) as Prisma.InputJsonValue,
          sourceSignals: nextSignals as Prisma.InputJsonValue,
          shootRequirements: requirements as Prisma.InputJsonValue,
          productionStage: allMaterialsReady
            ? "READY_TO_EDIT"
            : (allowExternalGeneration && !input.prepareOnly ? "FACTORY_GENERATING" : "SCRIPT_APPROVED"),
          masterVideoStatus: "PENDING",
        },
      });
      await tx.auditLog.create({
        data: { actor, action: "VIDEO_FACTORY_PROJECT_GENERATE", entityType: "ContentPlan", entityId: id, after: { candidateIndex, shotCount: coverage.length, routingMode, requestedModelId } },
      });
    });
    const missingCount = coverage.filter((item) => item.coverage === "MISSING").length;
    await this.notifyProjectMilestone(
      id,
      missingCount ? "VIDEO_MATERIAL_ACTION_REQUIRED" : "VIDEO_READY_TO_GENERATE",
      missingCount ? "脚本已通过，请处理缺失素材" : "脚本已通过，可直接生成视频",
      missingCount
        ? `脚本审核已通过，仍有${missingCount}个镜头需要真人补拍或调用AI生成。`
        : "脚本审核已通过，素材已经齐全，可以直接提交视频生成任务。",
    ).catch(() => undefined);
    return this.project(id);
  }

  async enqueueShot(shotId: string, input: GenerateInput & { prompt?: string; duration?: number }, actor: string) {
    const shot = await this.prisma.videoShot.findUnique({ where: { id: shotId }, include: { contentPlan: true } });
    if (!shot) throw new NotFoundException("视频镜头不存在");
    const factory = sourceSignals(shot.contentPlan).find((item) => item.type === "VIDEO_FACTORY") || {};
    if (videoFactoryModule(shot.contentPlan) === "DOUYIN_VIRAL" && factory.allowExternalGeneration !== true) {
      throw new BadRequestException("该项目未开启外部视觉模型，请在重新创作或选题卡确认时明确开启");
    }
    const requestedModelId = String(input.requestedModelId || shot.requestedModelId || "").trim() || undefined;
    const routingMode = String(input.routingMode || (requestedModelId ? "FIXED" : "AUTO")).toUpperCase();
    const prompt = String(input.prompt || shot.prompt || shot.description).trim();
    const capability = strings(object(shot.metadata).imageAssetIds).length ? "IMAGE_TO_VIDEO" : "TEXT_TO_VIDEO";
    const scenario = videoFactoryModule(shot.contentPlan) === "DOUYIN_VIRAL"
      ? douyinViralModelScenario(shot.description)
      : shot.moduleType;
    await this.resolveModel({ requestedModelId, platform: shot.contentPlan.targetPlatforms[0], scenario, capability });
    const revision = await this.prisma.videoGenerationJob.count({ where: { shotId } });
    const job = await this.prisma.videoGenerationJob.create({
      data: {
        idempotencyKey: `video-shot:${shot.contentPlanId}:${shot.id}:manual:${revision + 1}`,
        contentPlanId: shot.contentPlanId,
        shotId: shot.id,
        routingMode,
        requestedModelId,
        allowFallback: input.allowFallback === true,
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
      if (videoFactoryModule(plan) === "DOUYIN_VIRAL") {
        throw new BadRequestException("抖音爆款项目缺少标准分镜，不能按旧素材数组顺序合成");
      }
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
    const activeRender = await this.prisma.videoRenderJob.findFirst({
      where: { contentPlanId: id, status: { in: ["PENDING", "RUNNING", "RETRY"] } },
      orderBy: { createdAt: "desc" },
    });
    if (activeRender && !videoRenderJobIsStale(plan, activeRender)) return activeRender;
    if (activeRender) {
      await this.prisma.videoRenderJob.update({
        where: { id: activeRender.id },
        data: { status: "FAILED", failureReason: "渲染进程中断，已重新排队", finishedAt: new Date() },
      });
    }
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
          shots: plan.videoShots.map((shot) => ({
            lineId: String(object(shot.metadata).lineId || "").trim(),
            sequence: shot.sequence,
            assetId: shot.selectedAssetId,
            scriptLine: shot.description,
            sourceIn: number(object(shot.metadata).sourceIn, 0),
            sourceOut: number(object(shot.metadata).sourceOut, number(object(shot.metadata).sourceIn, 0) + number(shot.durationSeconds, 5)),
          })),
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

  async archiveProject(id: string, actor: string, allowAdminOverride = false, hideLibraryEntries = false) {
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
    if (!allowAdminOverride && ![plan.owner, plan.createdBy, plan.assignedTo].filter(Boolean).includes(actor)) {
      throw new BadRequestException("只能删除自己创建的视频项目");
    }
    if (plan.productionStage === "VIDEO_FACTORY_ARCHIVED") return { id, archived: true };
    const archivedAt = new Date();
    const purgeAfter = new Date(archivedAt.getTime() + 3 * 24 * 60 * 60 * 1000);
    const activeAiStatuses = [
      "PENDING",
      "WAITING_CONFIRMATION",
      "CLAIMED",
      "RUNNING",
      "WAITING_INPUT",
      "QUALITY_CHECK",
      "UPLOADING",
      "PENDING_REVIEW",
      "RETURNED",
      "RETRY",
    ] as const;
    const activeJobStatuses = ["PENDING", "RUNNING", "RETRY"] as const;
    const [aiTaskCount, generationJobCount, renderJobCount] = await Promise.all([
      this.prisma.aiTask.count({
        where: {
          sourceType: "VIDEO_FACTORY_PROJECT",
          sourceId: id,
          status: { in: [...activeAiStatuses] },
        },
      }),
      this.prisma.videoGenerationJob.count({
        where: { contentPlanId: id, status: { in: [...activeJobStatuses] } },
      }),
      this.prisma.videoRenderJob.count({
        where: { contentPlanId: id, status: { in: [...activeJobStatuses] } },
      }),
    ]);
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
      this.prisma.aiTask.updateMany({
        where: {
          sourceType: "VIDEO_FACTORY_PROJECT",
          sourceId: id,
          status: { in: [...activeAiStatuses] },
        },
        data: {
          status: "CANCELLED",
          progressMessage: "所属视频项目已删除，任务同步取消",
          finishedAt: archivedAt,
          lockedBy: null,
          lockedAt: null,
          heartbeatAt: null,
        },
      }),
      this.prisma.videoGenerationJob.updateMany({
        where: { contentPlanId: id, status: { in: [...activeJobStatuses] } },
        data: {
          status: "CANCELLED",
          finishedAt: archivedAt,
          failureReason: "所属视频项目已删除，生成任务同步取消",
          nextAttemptAt: null,
        },
      }),
      this.prisma.videoRenderJob.updateMany({
        where: { contentPlanId: id, status: { in: [...activeJobStatuses] } },
        data: {
          status: "CANCELLED",
          finishedAt: archivedAt,
          failureReason: "所属视频项目已删除，剪辑任务同步取消",
        },
      }),
      this.prisma.opsTask.updateMany({
        where: {
          sourceType: "VIDEO_PROJECT",
          sourceId: id,
          deletedAt: null,
        },
        data: {
          deletedAt: archivedAt,
          purgeAfter,
          status: "CANCELLED",
        },
      }),
      ...(hideLibraryEntries ? [this.prisma.contentLibraryEntry.updateMany({
        where: { contentPlanId: id, category: "VIDEO", visibilityStatus: "ACTIVE" },
        data: { visibilityStatus: "HIDDEN", hiddenAt: archivedAt, hiddenBy: actor, hiddenWithProject: true },
      })] : []),
      this.prisma.auditLog.create({
        data: {
          actor,
          action: "VIDEO_FACTORY_PROJECT_ARCHIVE",
          entityType: "ContentPlan",
          entityId: id,
          before: { productionStage: plan.productionStage },
          after: {
            productionStage: "VIDEO_FACTORY_ARCHIVED",
            archivedAt,
            purgeAfter,
            cancelledAiTasks: aiTaskCount,
            cancelledGenerationJobs: generationJobCount,
            cancelledRenderJobs: renderJobCount,
            hideLibraryEntries,
          },
        },
      }),
    ]);
    return {
      id,
      archived: true,
      purgeAfter,
      cancelledAiTasks: aiTaskCount,
      cancelledGenerationJobs: generationJobCount,
      cancelledRenderJobs: renderJobCount,
      hiddenLibraryEntries: hideLibraryEntries,
    };
  }

  async recycledProjects(actor: string) {
    const rows = await this.prisma.contentPlan.findMany({
      where: {
        kind: "VIDEO",
        productionStage: "VIDEO_FACTORY_ARCHIVED",
        sourceSignals: { array_contains: [{ type: "VIDEO_FACTORY" }] },
      },
      // The project list is a creation queue, not an activity feed: an old
      // project being retried must not jump ahead of a newly created project.
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const now = Date.now();
    const active: Array<Record<string, unknown>> = [];
    for (const plan of rows) {
      const signals = sourceSignals(plan);
      const factory = signals.find((item) => item.type === "VIDEO_FACTORY") || {};
      // The employee recycle bin is private. Project ownership or assignment
      // is not enough: only the employee who performed the deletion may see it.
      if (String(factory.archivedBy || "") !== actor) continue;
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
    if (String(factory.archivedBy || "") !== actor) {
      throw new BadRequestException("只能恢复自己删除的视频项目");
    }
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
      this.prisma.opsTask.updateMany({
        where: {
          sourceType: "VIDEO_PROJECT",
          sourceId: id,
          deletedAt: { not: null },
        },
        data: {
          deletedAt: null,
          purgeAfter: null,
          deletedByEmployeeId: null,
        },
      }),
      this.prisma.contentLibraryEntry.updateMany({
        where: { contentPlanId: id, hiddenWithProject: true },
        data: { visibilityStatus: "ACTIVE", hiddenAt: null, hiddenBy: null, hiddenWithProject: false },
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
    sourceSignals?: Prisma.JsonValue;
    videoRenderJobs?: Array<{ status?: string | null; outputAsset?: { reviewStatus?: string | null } | null }>;
    aiTaskOutputs?: Array<{ kind?: string | null; reviewStatus?: string | null; aiTask?: { status?: string | null } | null }>;
  }) {
    const persistedStage = String(row.productionStage || "");
    if (["PACKAGING_REVIEW", "READY_TO_PUBLISH", "PUBLISHING", "TRACKING"].includes(persistedStage)) {
      return persistedStage;
    }
    // A returned historical master can remain on the project while Codex
    // uploads its replacement. Prefer the newest reviewable output instead
    // of letting that old returned asset force the whole project back to
    // “修改中”.
    const renders = row.videoRenderJobs || [];
    const render = renders.find((item) => {
      const reviewStatus = String(item.outputAsset?.reviewStatus || "").toUpperCase();
      return String(item.status || "").toUpperCase() === "SUCCEEDED"
        && Boolean(item.outputAsset)
        && !["APPROVED", "RETURNED"].includes(reviewStatus);
    }) || renders.find((item) => ["PENDING", "RUNNING", "RETRY"].includes(String(item.status || "").toUpperCase()))
      || renders[0];
    const master = render?.outputAsset;
    if (master?.reviewStatus === "APPROVED") return "PLATFORM_PACKAGING";
    if (master?.reviewStatus === "RETURNED") {
      const factory = sourceSignals({ sourceSignals: row.sourceSignals || [] }).find((signal) => signal.type === "VIDEO_FACTORY") || {};
      const revision = object(factory.directVideoRevision);
      if (["CODEX_DIRECT_FULL_VIDEO", "BATCH_CODEX_DIRECT_FULL_VIDEO"].includes(String(factory.projectMode || "")) && String(revision.requestedAt || "")) {
        return "FACTORY_GENERATING";
      }
      return "READY_TO_EDIT";
    }
    if (render?.status === "SUCCEEDED" && master) return "VIDEO_REVIEW";
    if (render && ["PENDING", "RUNNING", "RETRY"].includes(String(render.status || ""))) return "FACTORY_GENERATING";
    const taskOutput = row.aiTaskOutputs?.find((output) => output.kind === "VIDEO_MASTER") || row.aiTaskOutputs?.[0];
    const taskStatus = String(taskOutput?.aiTask?.status || "");
    if (["CLAIMED", "RUNNING", "QUALITY_CHECK", "UPLOADING", "RETRY"].includes(taskStatus)) return "FACTORY_GENERATING";
    if (taskOutput?.kind === "VIDEO_MASTER" && taskStatus === "PENDING_REVIEW") return "VIDEO_REVIEW";
    const completedScriptOutput = row.aiTaskOutputs?.some((output) =>
      output.kind === "VIDEO_PROJECT"
      && ["COMPLETED", "PENDING_REVIEW"].includes(String(output.aiTask?.status || "")));
    if (completedScriptOutput && ["PROJECT_BRIEF", "SCRIPT_GENERATING"].includes(persistedStage)) {
      return "FACTORY_SCRIPT_READY";
    }
    return row.productionStage || "FACTORY_SCRIPT_READY";
  }

  async projects(query: { status?: string; platform?: string; productModel?: string; createdBy?: string; page: number; pageSize?: number }): Promise<{ items: unknown[]; total: number; page: number; pageSize: number }>;
  async projects(query: { status?: string; platform?: string; productModel?: string; createdBy?: string }): Promise<any[]>;
  async projects(query: { status?: string; platform?: string; productModel?: string; createdBy?: string; page?: number; pageSize?: number }): Promise<any> {
    const paged = Boolean(query.page || query.pageSize);
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)));
    const finalProductStages = ["VIDEO_REVIEW", "PLATFORM_PACKAGING", "PACKAGING_REVIEW", "READY_TO_PUBLISH", "PUBLISHING", "TRACKING"];
    const where: Prisma.ContentPlanWhereInput = {
      kind: "VIDEO",
      sourceSignals: { array_contains: [{ type: "VIDEO_FACTORY" }] },
      ...(query.createdBy ? { createdBy: query.createdBy } : {}),
      ...(query.status === "FINAL_PRODUCT"
        ? { productionStage: { in: finalProductStages } }
        : { productionStage: query.status ? query.status : { not: "VIDEO_FACTORY_ARCHIVED" } }),
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
        optimizations: { orderBy: { checkpointHours: "asc" } },
        libraryEntries: { where: { category: "VIDEO" }, orderBy: { createdAt: "desc" }, take: 1 },
        assignedEmployee: true,
      },
      // Keep the newest created project first.  Activity on an older project
      // must not reshuffle the employee's project queue.
      orderBy: { createdAt: "desc" },
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
        optimizations: { orderBy: { checkpointHours: "asc" } },
        libraryEntries: { where: { category: "VIDEO" }, orderBy: { createdAt: "desc" }, take: 1 },
        assignedEmployee: true,
      },
    });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    return jsonSafe({
      ...plan,
      productionStage: this.projectedProductionStage(plan),
      topicCard: topicCardPayload(plan),
      scriptCandidates: this.candidates(plan),
      activeAiTasks: await this.activeProjectAiTasks(plan),
    });
  }

  private async activeProjectAiTasks(plan: { sourceSignals: Prisma.JsonValue }) {
    const factory = sourceSignals(plan).find((signal) => signal.type === "VIDEO_FACTORY") || {};
    const taskIds = Array.from(new Set([
      String(factory.aiTaskId || "").trim(),
      String(factory.videoAiTaskId || "").trim(),
      String(factory.coverAiTaskId || "").trim(),
    ].filter(Boolean)));
    if (!taskIds.length) return [];
    return this.prisma.aiTask.findMany({
      where: { id: { in: taskIds } },
      select: {
        id: true,
        taskNo: true,
        type: true,
        title: true,
        status: true,
        progress: true,
        progressMessage: true,
        failureReason: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        finishedAt: true,
      },
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

  async uploadMaster(
    contentPlanId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
    body: Record<string, unknown>,
    actor: string,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException("请选择需要上传的MP4成片");
    if (!file.originalname.toLowerCase().endsWith(".mp4") && file.mimetype !== "video/mp4") {
      throw new BadRequestException("成片只支持MP4格式");
    }
    const width = Math.max(0, Number(body.width || 0));
    const height = Math.max(0, Number(body.height || 0));
    const duration = Math.max(0, Number(body.durationSeconds || 0));
    const codec = String(body.codec || "").trim().toLowerCase();
    const frameRate = String(body.frameRate || "").trim();
    if (!width || !height || !duration || !codec || !frameRate) {
      throw new BadRequestException("请提供成片宽度、高度、时长、编码和帧率");
    }
    const plan = await this.prisma.contentPlan.findUnique({
      where: { id: contentPlanId },
      select: {
        id: true,
        topic: true,
        productModel: true,
        sourceSignals: true,
        contentAssets: { select: { assetId: true, role: true } },
        videoShots: { select: { metadata: true } },
      },
    });
    if (!plan) throw new NotFoundException("智能视频项目不存在");
    const hash = createHash("sha256").update(file.buffer).digest("hex");
    const sourceAssetIds = [...new Set([
      ...strings(body.sourceAssetIds),
      ...plan.contentAssets
        .filter((item) => item.role !== "VIDEO_FACTORY_MASTER")
        .map((item) => item.assetId),
    ])];
    const generatedSceneFiles = strings(body.generatedSceneFiles);
    const suppliedMetadata = object(parsedBodyValue(body.metadata));
    const metadata: JsonRow = {
      source: String(suppliedMetadata.source || body.renderer || "CODEX_LOCAL_FFMPEG"),
      codec,
      frameRate,
      width,
      height,
      durationSeconds: duration,
      usedAssetIds: sourceAssetIds,
      generatedSceneFiles,
      materialUsage: parsedBodyValue(body.materialUsage) || suppliedMetadata.materialUsage || [],
      qualityChecks: parsedBodyValue(body.qualityChecks) || suppliedMetadata.qualityChecks || [],
      contentAlignment: parsedBodyValue(body.contentAlignment) || suppliedMetadata.contentAlignment || {},
    };
    if (videoFactoryModule(plan) === "DOUYIN_VIRAL") {
      const allowedAssetIds = new Set(plan.contentAssets
        .filter((item) => item.role !== "VIDEO_FACTORY_MASTER")
        .map((item) => item.assetId));
      const expectedShotLineIds = new Set(plan.videoShots
        .map((shot) => String(object(shot.metadata).lineId || "").trim())
        .filter(Boolean));
      const validation = validateVideoMasterMetadata(metadata, {
        requireMaterialUsage: true,
        allowedAssetIds,
        ...(expectedShotLineIds.size ? { expectedShotLineIds } : {}),
      });
      const requiredChecks = new Set(["OUTPUT_VALIDITY", "MATERIAL_TRACE", "CONTENT_ALIGNMENT"]);
      for (const check of validation.metadata.qualityChecks) requiredChecks.delete(check.checkType);
      if (requiredChecks.size) validation.hardBlockers.push(`缺少质检项：${Array.from(requiredChecks).join("、")}`);
      const usedAssetIds = [...new Set(validation.metadata.materialUsage.map((item) => item.assetId).filter(Boolean))];
      const usableAssets = usedAssetIds.length ? await this.prisma.asset.findMany({
        where: {
          id: { in: usedAssetIds },
          reviewStatus: "APPROVED",
          availabilityStatus: "ACTIVE",
          rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
          deletedAt: null,
        },
        select: { id: true, sha256: true },
      }) : [];
      const usableMap = new Map(usableAssets.map((item) => [item.id, item.sha256]));
      for (const usage of validation.metadata.materialUsage) {
        if (!usableMap.has(usage.assetId)) validation.hardBlockers.push(`素材${usage.assetId || "未填写"}未审核、未启用或不可商用`);
        else if (usableMap.get(usage.assetId) !== usage.sha256) validation.hardBlockers.push(`素材${usage.assetId}哈希与登记值不一致`);
      }
      if (validation.hardBlockers.length) {
        throw new BadRequestException(`成片未通过准入：${[...new Set(validation.hardBlockers)].join("；")}`);
      }
      Object.assign(metadata, validation.metadata, { outputValidation: { valid: true, hardBlockers: [] } });
    }
    const existing = await this.prisma.videoRenderJob.findUnique({
      where: { idempotencyKey: `manual-master:${contentPlanId}:${hash}` },
      include: { outputAsset: true },
    });
    if (existing?.outputAsset) {
      const snapshot = object(existing.outputAsset.sourceSnapshot);
      const sourceSnapshot = ({
        ...snapshot,
        renderer: String(metadata.source || "MANUAL_UPLOAD"),
        renderJobId: existing.id,
        shotAssetIds: sourceAssetIds,
        metadata: { ...object(snapshot.metadata), ...metadata },
      }) as unknown as Prisma.InputJsonValue;
      const asset = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.asset.update({
          where: { id: existing.outputAsset!.id },
          data: { sourceSnapshot },
        });
        await tx.assetVersion.updateMany({
          where: { assetId: existing.outputAsset!.id },
          data: { codec, technicalMetadata: metadata as unknown as Prisma.InputJsonValue },
        });
        return updated;
      });
      return jsonSafe({ renderJob: existing, asset });
    }

    const renderJobId = randomUUID();
    const assetId = randomUUID();
    const publicNo = `SD-FINAL-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const objectKey = this.oss.derivedObjectKey(renderJobId, "video-master", 1, hash, ".mp4");
    const stored = await this.oss.uploadGeneratedBuffer({
      objectKey,
      buffer: file.buffer,
      actor,
      sourceType: "AI_GENERATED",
      sha256: hash,
      originalName: file.originalname,
    });
    const asset = await this.prisma.$transaction(async (tx) => {
      const created = await tx.asset.create({
        data: {
          id: assetId,
          sourceKey: `VIDEO_FACTORY_MANUAL_MASTER:${contentPlanId}:${hash}`,
          sourceType: "AI_GENERATED",
          sourcePath: `oss://${objectKey}`,
          fileName: file.originalname,
          originalFileName: file.originalname,
          extension: ".mp4",
          mediaType: "VIDEO",
          kind: "VIDEO",
          assetNo: publicNo,
          displayName: `智能视频成片-${plan.topic}`,
          level: "FINISHED",
          productScope: plan.productModel ? "MODEL" : "UNKNOWN",
          processingStatus: "READY_FOR_REVIEW",
          reviewStatus: "PENDING",
          availabilityStatus: "INACTIVE",
          rightsStatus: "AUTH_REQUIRED",
          sha256: hash,
          sizeBytes: file.size,
          modifiedAt: new Date(),
          width,
          height,
          durationSeconds: duration,
          aspectRatio: `${width}:${height}`,
          model: plan.productModel,
          status: "PENDING",
          qualityScore: 85,
          contentDescription: plan.topic,
          sourceSnapshot: ({ renderer: String(metadata.source || "MANUAL_UPLOAD"), renderJobId, shotAssetIds: sourceAssetIds, metadata }) as unknown as Prisma.InputJsonValue,
          aiIndex: { source: "VIDEO_FACTORY_MANUAL_MASTER", contentPlanId },
          searchText: `${plan.productModel || ""} ${plan.topic} 智能视频成片`,
          indexNeedsReview: true,
          storageProvider: "ALIYUN_OSS",
          objectKey,
          objectVersionId: stored.objectVersionId,
          etag: stored.etag,
          storageUrl: stored.storageUrl,
          storageSyncedAt: stored.uploadedAt,
          discoveredBy: actor,
          versions: {
            create: {
              version: 1,
              sha256: hash,
              sourcePath: `oss://${objectKey}`,
              objectKey,
              objectVersionId: stored.objectVersionId,
              etag: stored.etag,
              storageUrl: stored.storageUrl,
              createdBy: actor,
              originalFileName: file.originalname,
              mimeType: "video/mp4",
              extension: ".mp4",
              sizeBytes: file.size,
              width,
              height,
              durationSeconds: duration,
              codec,
              technicalMetadata: metadata as unknown as Prisma.InputJsonValue,
            },
          },
        },
      });
      await tx.videoRenderJob.create({
        data: {
          id: renderJobId,
          idempotencyKey: `manual-master:${contentPlanId}:${hash}`,
          contentPlanId,
          status: "SUCCEEDED",
          renderer: String(metadata.source || "MANUAL_UPLOAD"),
          input: { sourceAssetIds, generatedSceneFiles },
          output: ({ objectKey, assetId, renderer: String(metadata.source || "MANUAL_UPLOAD") }) as Prisma.InputJsonValue,
          outputAssetId: assetId,
          outputPath: `oss://${objectKey}`,
          actualCost: Number(body.actualCost || 0),
          startedAt: new Date(),
          finishedAt: new Date(),
          createdBy: actor,
        },
      });
      await tx.contentPlan.update({
        where: { id: contentPlanId },
        data: { masterVideoPath: `oss://${objectKey}`, masterVideoStatus: "READY_FOR_REVIEW", productionStage: "VIDEO_REVIEW" },
      });
      await tx.contentAsset.create({ data: { contentPlanId, assetId, role: "VIDEO_FACTORY_MASTER" } });
      const metadataChecks = Array.isArray(metadata.qualityChecks) ? metadata.qualityChecks.map(object) : [];
      if (metadataChecks.length) {
        await tx.videoQualityCheck.createMany({
          data: metadataChecks.map((check) => ({
            contentPlanId,
            assetId,
            renderJobId,
            checkType: String(check.checkType || "").toUpperCase(),
            status: String(check.status || "REVIEW_REQUIRED").toUpperCase(),
            score: Math.max(0, Math.min(100, Math.round(Number(check.score) || 0))),
            findings: (Array.isArray(check.findings) ? check.findings : []) as Prisma.InputJsonValue,
          })),
        });
      } else {
        await tx.videoQualityCheck.create({
          data: { contentPlanId, assetId, renderJobId, checkType: "OUTPUT_VALIDITY", status: "PASSED", score: 95, findings: [{ width, height, duration, codec, frameRate }] },
        });
      }
      await tx.videoQualityCheck.create({
        data: { contentPlanId, assetId, renderJobId, checkType: "FINAL_REVIEW", status: "REVIEW_REQUIRED", score: 0, findings: [{ message: "请核对字幕、配音、产品外形、功能画面和CTA" }] },
      });
      return created;
    });
    await this.notifyProjectMilestone(contentPlanId, "VIDEO_REVIEW", "视频成片等待审核", plan.topic);
    return jsonSafe({ renderJobId, asset });
  }

  async reviewOutput(assetId: string, approved: boolean, actor: string, note = "", contentConfirmed = false) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!asset) throw new NotFoundException("视频成品不存在");
    const generation = await this.prisma.videoGenerationJob.findFirst({
      where: { outputAssetId: assetId },
      include: { shot: true, contentPlan: { select: { sourceSignals: true } } },
    });
    const render = await this.prisma.videoRenderJob.findFirst({
      where: { outputAssetId: assetId },
      include: { contentPlan: true },
    });
    if (!generation && !render) throw new BadRequestException("该素材不是视频工厂输出");
    const contentPlan = render?.contentPlan || generation?.contentPlan;
    const checks = await this.prisma.videoQualityCheck.findMany({ where: { assetId }, orderBy: { createdAt: "desc" } });
    const latestChecks = new Map<string, typeof checks[number]>();
    for (const check of checks) if (!latestChecks.has(check.checkType)) latestChecks.set(check.checkType, check);
    const failedCheck = [...latestChecks.values()].find((check) => check.status === "FAILED");
    if (approved && failedCheck) throw new BadRequestException(`${failedCheck.checkType}未通过，不能批准使用`);
    if (approved && contentPlan && videoFactoryModule(contentPlan) === "DOUYIN_VIRAL") {
      const metadata = {
        ...object(object(asset.sourceSnapshot).metadata),
        ...object(asset.versions[0]?.technicalMetadata),
        width: asset.width,
        height: asset.height,
        durationSeconds: asset.durationSeconds,
        codec: asset.versions[0]?.codec,
      };
      const validation = validateVideoMasterMetadata(metadata, { requireMaterialUsage: true });
      if (!validation.valid) throw new BadRequestException(`成片准入未通过：${validation.hardBlockers.join("；")}`);
      for (const required of ["OUTPUT_VALIDITY", "MATERIAL_TRACE"] as const) {
        if (latestChecks.get(required)?.status !== "PASSED") throw new BadRequestException(`${required}未通过，不能批准使用`);
      }
      const alignment = latestChecks.get("CONTENT_ALIGNMENT");
      if (!alignment) throw new BadRequestException("缺少内容一致性质检，不能批准使用");
      if (alignment.status === "REVIEW_REQUIRED" && (!contentConfirmed || !note.trim())) {
        throw new BadRequestException("内容一致性需要人工确认，请勾选确认并填写审核说明");
      }
      if (!new Set(["PASSED", "REVIEW_REQUIRED"]).has(alignment.status)) {
        throw new BadRequestException("内容与选题或脚本不一致，不能批准使用");
      }
    }
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
        await tx.contentVariant.updateMany({
          where: { contentPlanId: render.contentPlanId },
          data: approved
            ? {
              packagingStatus: "APPROVED",
              mediaPath: asset.storageUrl || asset.sourcePath,
              packagedAt: new Date(),
              packagingReviewedBy: actor,
              packagingReviewedAt: new Date(),
              packagingRejectedReason: null,
            }
            : {
              packagingStatus: "RETURNED",
              packagingReviewedBy: actor,
              packagingReviewedAt: new Date(),
              packagingRejectedReason: note || "成片已退回修改",
            },
        });
        if (approved) await this.upsertLibraryEntry(tx, render.contentPlan, assetId, render.id, actor, render.input);
        else await tx.contentLibraryEntry.updateMany({
          where: { contentPlanId: render.contentPlanId, outputAssetId: assetId },
          data: { visibilityStatus: "HIDDEN", hiddenAt: new Date(), hiddenBy: actor },
        });
      }
      const reviewedAt = new Date();
      const alignmentReview = latestChecks.get("CONTENT_ALIGNMENT");
      if (approved && contentConfirmed && alignmentReview?.status === "REVIEW_REQUIRED") {
        const findings = Array.isArray(alignmentReview.findings) ? alignmentReview.findings : [];
        await tx.videoQualityCheck.update({
          where: { id: alignmentReview.id },
          data: {
            status: "PASSED",
            reviewedBy: actor,
            reviewedAt,
            findings: [...findings, { type: "MANUAL_CONTENT_CONFIRMATION", message: note, actor }] as Prisma.InputJsonValue,
          },
        });
      }
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
        data: {
          actor,
          action: approved ? "VIDEO_FACTORY_OUTPUT_APPROVE" : "VIDEO_FACTORY_OUTPUT_RETURN",
          entityType: "Asset",
          entityId: assetId,
          after: { note, contentConfirmed },
        },
      });
    });
    if (generation?.contentPlanId) await this.syncCompatibility(generation.contentPlanId);
    return this.project(generation?.contentPlanId || render!.contentPlanId);
  }

  async outputRevisionTaskId(assetId: string) {
    const direct = await this.prisma.aiTaskOutput.findFirst({
      where: { assetId, kind: "VIDEO_MASTER" },
      orderBy: { createdAt: "desc" },
      select: { aiTaskId: true },
    });
    if (direct?.aiTaskId) return direct.aiTaskId;
    const render = await this.prisma.videoRenderJob.findFirst({
      where: { outputAssetId: assetId },
      orderBy: { createdAt: "desc" },
      include: { contentPlan: { select: { sourceSignals: true } } },
    });
    if (!render) throw new NotFoundException("成片未关联可重新执行的AI任务");
    const factory = sourceSignals(render.contentPlan).find((item) => item.type === "VIDEO_FACTORY") || {};
    const taskId = String(factory.videoAiTaskId || factory.aiTaskId || "").trim();
    if (!taskId) throw new BadRequestException("该历史成片没有可重新执行的AI任务，请从原项目创建新任务");
    return taskId;
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
    const signals = sourceSignals(plan);
    const bindingFingerprint = materialBindingFingerprint(plan.videoShots);
    const nextSignals = signals.map((signal) => signal.type === "VIDEO_FACTORY" && allDone
      ? {
        ...signal,
        materialReview: {
          status: "APPROVED",
          actor: "SYSTEM",
          reviewedAt: new Date().toISOString(),
          workflowVersion: plan.workflowVersion,
          bindingFingerprint,
          automatic: true,
        },
      }
      : signal);
    await this.prisma.contentPlan.update({
      where: { id: contentPlanId },
      data: {
        shootRequirements: requirements as Prisma.InputJsonValue,
        sourceSignals: nextSignals as Prisma.InputJsonValue,
        productionStage: allDone ? "READY_TO_EDIT" : "FACTORY_GENERATING",
      },
    });
  }
}
