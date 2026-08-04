import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import {
  AiTaskExecutionPolicy,
  AiTaskStatus,
  AiTaskType,
  IntegrationKind,
  Prisma,
} from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { extname } from "node:path";
import { BrandDataService } from "./brand-data.service";
import { opsConfig } from "./config";
import { ContentService } from "./content.service";
import { OssStorageService } from "./oss-storage.service";
import { PrismaService } from "./prisma.service";
import { VideoFactoryService } from "./video-factory.service";
import {
  DEFAULT_VIDEO_POLICY_CONFIG,
  VIDEO_RECIPES,
  type VideoRecipeCode,
  type VideoScriptCandidateV3,
  type VideoShotPlanV3,
} from "./video-topic-card";
import { WecomNotificationService } from "./wecom-notification.service";

const taskTypes: AiTaskType[] = [
  "VIDEO",
  "IMAGE",
  "ARTICLE",
  "STORE_ANALYSIS",
  "COMPETITOR_ANALYSIS",
  "LIVE_ANALYSIS",
];
const claimableStatuses: AiTaskStatus[] = ["PENDING", "RETRY"];
const reviewableStatuses: AiTaskStatus[] = ["PENDING_REVIEW", "RETURNED"];
const smartVideoPrimaryNodeCode = text(process.env.AI_TASK_SMART_VIDEO_PRIMARY_NODE_CODE)
  || "windows-codex-video-01";
const platformKinds: IntegrationKind[] = [
  "DOUYIN", "TIKTOK", "WECHAT_OFFICIAL", "XIAOHONGSHU", "WECOM", "WECHAT_CHANNELS",
  "AMAZON", "SHOPIFY", "TMALL", "JD", "PINDUODUO",
];

type JsonRecord = Record<string, unknown>;
type UploadFile = { originalname: string; mimetype: string; size: number; buffer: Buffer };

export type AiTaskRoute = {
  version: 1;
  domain: "VIDEO_PROJECT" | "IMAGE_PROJECT";
  projectMode: "STANDARD_SMART_VIDEO" | "REFERENCE_DIRECT_FULL_VIDEO" | "CODEX_DIRECT_FULL_VIDEO" | "IMAGE_POST";
  stage: string;
  executionMode: string;
  requiredSkill: "video-editing-from-media-library" | "saidian-douyin-image-posts";
};

export const unifiedWindowsRouteKeys = [
  "STANDARD_SMART_VIDEO",
  "REFERENCE_DIRECT_FULL_VIDEO",
  "CODEX_DIRECT_FULL_VIDEO",
  "IMAGE_POST",
] as const;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function clippedText(value: unknown, maxLength: number) {
  const valueText = text(value);
  return valueText.length > maxLength ? `${valueText.slice(0, maxLength)}…` : valueText;
}

function compactJsonText(value: unknown, maxLength: number) {
  try {
    return clippedText(JSON.stringify(value ?? {}), maxLength);
  } catch {
    return "";
  }
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

/**
 * Resolve only business routes that are unambiguous from structured task data.
 * Titles and instructions are deliberately excluded: they are display/creative
 * content and must never decide which local Skill receives a task.
 */
export function aiTaskRoute(task: {
  type?: string | null;
  sourceType?: string | null;
  input?: Prisma.JsonValue | JsonRecord | null;
}): AiTaskRoute | null {
  const input = object(task.input);
  const type = text(task.type).toUpperCase();
  const sourceType = text(task.sourceType || input.sourceType).toUpperCase();
  const executionMode = text(input.executionMode).toUpperCase();
  const workflowGuard = object(input.workflowGuard);
  const stage = text(workflowGuard.stage || input.stage || executionMode).toUpperCase();

  if (type === "VIDEO" && sourceType === "VIDEO_FACTORY_PROJECT"
    && ["FULL_VIDEO", "SCRIPT_ONLY", "SIMILAR_VIDEO", "NO_VOICE_VIDEO", "COVER_TITLE"].includes(executionMode)) {
    const explicitMode = text(input.projectMode).toUpperCase();
    const projectMode = input.referenceDirectFullVideo === true || explicitMode === "REFERENCE_DIRECT_FULL_VIDEO"
      ? "REFERENCE_DIRECT_FULL_VIDEO"
      : input.codexDirectFullVideo === true || explicitMode === "CODEX_DIRECT_FULL_VIDEO"
        ? "CODEX_DIRECT_FULL_VIDEO"
        : "STANDARD_SMART_VIDEO";
    return {
      version: 1,
      domain: "VIDEO_PROJECT",
      projectMode,
      stage: stage || executionMode,
      executionMode,
      requiredSkill: "video-editing-from-media-library",
    };
  }

  if (type === "IMAGE" && (sourceType === "IMAGE_PROJECT" || Boolean(text(input.imageProjectId)))
    && (executionMode === "IMAGE_POST" || !executionMode)) {
    return {
      version: 1,
      domain: "IMAGE_PROJECT",
      projectMode: "IMAGE_POST",
      stage: stage || "IMAGE_POST",
      executionMode: "IMAGE_POST",
      requiredSkill: "saidian-douyin-image-posts",
    };
  }
  return null;
}

export function aiTaskTargetNodeCode(task: {
  sourceType?: string | null;
  input?: Prisma.JsonValue | JsonRecord | null;
}) {
  const requestedNodeCode = text(object(task.input).preferredNodeCode).toLowerCase();
  if (requestedNodeCode) return requestedNodeCode;
  return task.sourceType === "VIDEO_FACTORY_PROJECT" ? smartVideoPrimaryNodeCode : "";
}

export function aiTaskExecutionMode(task: {
  type?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  input?: Prisma.JsonValue | JsonRecord | null;
}) {
  const input = object(task.input);
  const explicitMode = text(input.executionMode).toUpperCase();
  const inputSourceType = text(input.sourceType).toUpperCase();
  const sourceType = text(task.sourceType).toUpperCase();
  if (text(task.type).toUpperCase() === "IMAGE" && (
    explicitMode === "IMAGE_POST"
    || sourceType === "IMAGE_PROJECT"
    || inputSourceType === "IMAGE_PROJECT"
    || Boolean(text(input.imageProjectId))
  )) return "IMAGE_POST";
  return explicitMode || "DEFAULT";
}

export function runnerCanClaimTask(
  task: Parameters<typeof aiTaskExecutionMode>[0],
  supportedExecutionModes: unknown,
  supportedRouteKeys?: unknown,
) {
  const declaredRouteKeys = strings(supportedRouteKeys).map((item) => item.toUpperCase());
  if (declaredRouteKeys.length) {
    const route = aiTaskRoute(task);
    return Boolean(route && declaredRouteKeys.includes(route.projectMode));
  }
  // IMAGE_POST is a separate business task type. It must only be claimed by a
  // runner that explicitly advertises the dispatcher/image-post capability.
  // Legacy imagegen runners only know the coarse IMAGE enum and therefore must
  // never receive an image-project task.
  if (aiTaskExecutionMode(task) !== "IMAGE_POST") return true;
  return strings(supportedExecutionModes)
    .map((item) => item.toUpperCase())
    .includes("IMAGE_POST");
}

function normalizeTaskOutputSizes<T>(task: T): T {
  const source = object(task);
  if (!Array.isArray(source.outputs)) return task;
  return {
    ...source,
    outputs: source.outputs.map((raw) => {
      const output = object(raw);
      if (!output.asset || typeof output.asset !== "object") return output;
      const asset = object(output.asset);
      return {
        ...output,
        asset: {
          ...asset,
          sizeBytes: typeof asset.sizeBytes === "bigint" ? asset.sizeBytes.toString() : asset.sizeBytes,
        },
      };
    }),
  } as T;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

/** Accept the platform labels returned by a skill while persisting the system enum. */
function packagingPlatform(value: unknown) {
  const raw = text(value);
  const normalized = raw.toUpperCase().replace(/[\s_-]+/g, "");
  const aliases: Record<string, string> = {
    "抖音": "DOUYIN",
    DOUYIN: "DOUYIN",
    TIKTOK: "TIKTOK",
    "小红书": "XIAOHONGSHU",
    XIAOHONGSHU: "XIAOHONGSHU",
    "B站": "BILIBILI",
    BILIBILI: "BILIBILI",
    "快手": "KUAISHOU",
    KUAISHOU: "KUAISHOU",
    "视频号": "WECHAT_CHANNELS",
    WECHATCHANNELS: "WECHAT_CHANNELS",
  };
  return aliases[raw] || aliases[normalized] || raw.toUpperCase();
}

/**
 * Older cover-title runners wrote the target platform into the human-readable
 * description instead of metadata.platform.  Keep accepting that payload so a
 * successfully generated single-platform cover is not stranded in WAITING_INPUT.
 */
function coverOutputPlatform(metadata: unknown) {
  const row = object(metadata);
  const explicit = row.platform || row.channel || row.targetPlatform;
  if (text(explicit)) return packagingPlatform(explicit);
  const description = text(row.description);
  const matched = description.match(/\bplatform\s*[=:]\s*([A-Z_]+)/i);
  return matched?.[1] ? packagingPlatform(matched[1]) : "";
}

export function videoScriptOutputMetadata(candidates: unknown[]) {
  const normalized = candidates.map(object);
  const selected = normalized.find((candidate) => candidate.selected === true) || normalized[0] || {};
  return {
    script: selected,
    scriptCount: normalized.length,
    selectedCandidate: Math.max(0, normalized.indexOf(selected)),
  };
}

function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function videoRecipe(value: unknown): VideoRecipeCode {
  const normalized = text(value).toUpperCase();
  return VIDEO_RECIPES.some((item) => item.code === normalized)
    ? normalized as VideoRecipeCode
    : "PAIN_SOLVE";
}

function normalizeVideoScriptCandidates(value: unknown): VideoScriptCandidateV3[] {
  if (!Array.isArray(value)) return [];
  return value.map(object).slice(0, 3).map((candidate, candidateIndex) => {
    const rawShots = Array.isArray(candidate.shots) ? candidate.shots : [];
    const shots: VideoShotPlanV3[] = rawShots.map((rawShot, shotIndex) => {
      const shot = typeof rawShot === "string" ? { description: rawShot } : object(rawShot);
      return {
        sequence: shotIndex,
        moduleType: text(shot.moduleType).toUpperCase() || (shotIndex === 0 ? "HOOK" : "SCENE"),
        title: text(shot.title) || `镜头${shotIndex + 1}`,
        description: text(shot.description || shot.visual) || `执行脚本第${shotIndex + 1}个画面`,
        durationSeconds: Math.max(2, Math.min(12, Math.round(number(shot.durationSeconds) || 4))),
        visual: text(shot.visual || shot.description),
        voiceover: text(shot.voiceover),
        subtitle: text(shot.subtitle),
        requiredAssetTags: strings(shot.requiredAssetTags),
        selectedAssetIds: strings(shot.selectedAssetIds),
        sourcePreference: text(shot.sourcePreference).toUpperCase() || "REAL_ASSET_FIRST",
        missingReason: text(shot.missingReason),
        alternativePlan: text(shot.alternativePlan) || "优先使用产品图动画或程序化文字镜头",
        lineId: text(shot.lineId || shot.line_id) || `line_${String(shotIndex + 1).padStart(2, "0")}`,
        sourceIn: shot.sourceIn === undefined && shot.source_in === undefined ? null : number(shot.sourceIn ?? shot.source_in),
        sourceOut: shot.sourceOut === undefined && shot.source_out === undefined ? null : number(shot.sourceOut ?? shot.source_out),
        visibleFacts: strings(shot.visibleFacts || shot.visible_facts),
        restrictions: strings(shot.restrictions),
        semanticScore: shot.semanticScore === undefined && shot.semantic_score === undefined ? null : number(shot.semanticScore ?? shot.semantic_score),
      };
    });
    const scoreBreakdown = object(candidate.scoreBreakdown);
    const scriptPackage = object(candidate.scriptPackage);
    return {
      title: text(candidate.title) || `脚本候选${candidateIndex + 1}`,
      hook: text(candidate.hook),
      script: text(candidate.script),
      cta: text(candidate.cta),
      score: Math.max(0, Math.min(100, number(candidate.score) || 0)),
      scoreBreakdown: Object.fromEntries(Object.entries(scoreBreakdown).map(([key, score]) => [key, number(score) || 0])),
      templateCode: videoRecipe(candidate.templateCode),
      shots,
      missingAssets: (Array.isArray(candidate.missingAssets) ? candidate.missingAssets.map(object) : []).map((item) => ({
        moduleType: text(item.moduleType).toUpperCase() || "SCENE",
        description: text(item.description) || "缺失镜头",
        reason: text(item.reason) || "没有匹配到已审核素材",
        alternative: text(item.alternative) || "产品图动画、本地程序化镜头或员工补拍",
      })),
      selected: candidate.selected === true || candidateIndex === 0,
      scriptPackage,
    };
  });
}

function dateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = text(value).toUpperCase() as T;
  return allowed.includes(normalized) ? normalized : fallback;
}

@Injectable()
export class AiTaskCenterService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oss: OssStorageService,
    private readonly videoFactory: VideoFactoryService,
    private readonly content: ContentService,
    private readonly brandData: BrandDataService,
    private readonly wecom: WecomNotificationService,
  ) {}

  async onModuleInit() {
    for (const type of taskTypes) {
      const seeded = await this.prisma.aiTaskPolicy.upsert({
        where: { type },
        create: {
          type,
          maxConcurrency: 1,
          maxAttempts: 3,
          timeoutSeconds: type === "VIDEO" ? 3600 : type === "IMAGE" ? 1800 : 1200,
          config: type === "VIDEO"
            ? DEFAULT_VIDEO_POLICY_CONFIG
            : type === "IMAGE"
              ? { onlyOnDemand: true }
              : { requiresSnapshot: ["STORE_ANALYSIS", "COMPETITOR_ANALYSIS", "LIVE_ANALYSIS"].includes(type) },
        },
        update: {},
      });
      if (seeded.type === "VIDEO") {
        const current = object(seeded.config);
        const config = {
          ...DEFAULT_VIDEO_POLICY_CONFIG,
          ...current,
          topicCardPolicyVersion: text(current.topicCardPolicyVersion) === "v2.0"
            ? DEFAULT_VIDEO_POLICY_CONFIG.topicCardPolicyVersion
            : text(current.topicCardPolicyVersion) || DEFAULT_VIDEO_POLICY_CONFIG.topicCardPolicyVersion,
          dailyTopicCards: { ...DEFAULT_VIDEO_POLICY_CONFIG.dailyTopicCards, ...object(current.dailyTopicCards) },
          videoRecipes: Array.isArray(current.videoRecipes) && current.videoRecipes.length
            ? current.videoRecipes
            : VIDEO_RECIPES,
        };
        if (JSON.stringify(config) !== JSON.stringify(current)) {
          await this.prisma.aiTaskPolicy.update({ where: { type: "VIDEO" }, data: { config: json(config) } });
        }
      }
    }
    await this.videoFactory.backfillLocalMasterRenderJobs();
    const completedMasters = await this.prisma.aiTaskOutput.findMany({
      where: {
        kind: "VIDEO_MASTER",
        assetId: { not: null },
      },
      select: { aiTaskId: true },
      distinct: ["aiTaskId"],
    });
    const completedTaskIds = completedMasters.map((item) => item.aiTaskId);
    if (completedTaskIds.length) {
      await this.prisma.opsTask.updateMany({
        where: {
          sourceType: "AI_TASK",
          sourceId: { in: completedTaskIds },
          category: "CONTENT_PRODUCTION",
          status: { not: "COMPLETED" },
        },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          completedBy: "系统迁移",
          result: "Codex已完成并上传主成片，无需补拍",
        },
      });
    }
    await this.backfillVideoScriptOutputs();
  }

  private async backfillVideoScriptOutputs() {
    const projectOutputs = await this.prisma.aiTaskOutput.findMany({
      where: {
        kind: "VIDEO_PROJECT",
        contentPlanId: { not: null },
        aiTask: {
          type: "VIDEO",
          sourceType: "VIDEO_FACTORY_PROJECT",
        },
      },
      select: {
        aiTaskId: true,
        contentPlanId: true,
        aiTask: {
          select: {
            input: true,
            platform: true,
            productModel: true,
          },
        },
        contentPlan: {
          select: {
            topic: true,
            productModel: true,
            sourceSignals: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    for (const output of projectOutputs) {
      if (!output.contentPlanId || !output.contentPlan) continue;
      if (text(object(output.aiTask.input).executionMode).toUpperCase() !== "SCRIPT_ONLY") continue;
      const exists = await this.prisma.aiTaskOutput.findFirst({
        where: {
          aiTaskId: output.aiTaskId,
          kind: "VIDEO_SCRIPT",
          contentPlanId: output.contentPlanId,
        },
        select: { id: true },
      });
      if (exists) continue;
      const factory = (Array.isArray(output.contentPlan.sourceSignals)
        ? output.contentPlan.sourceSignals.map(object)
        : []).find((signal) => text(signal.type).toUpperCase() === "VIDEO_FACTORY");
      const candidates = Array.isArray(factory?.scriptCandidates) ? factory.scriptCandidates : [];
      if (!candidates.length) continue;
      const scriptMetadata = videoScriptOutputMetadata(candidates);
      const selectedScript = object(scriptMetadata.script);
      await this.prisma.aiTaskOutput.create({
        data: {
          aiTaskId: output.aiTaskId,
          kind: "VIDEO_SCRIPT",
          title: text(selectedScript.title) || `${output.contentPlan.topic} · 完整脚本`,
          contentPlanId: output.contentPlanId,
          reviewStatus: "PENDING",
          metadata: json({
            ...scriptMetadata,
            executionMode: "SCRIPT_ONLY",
            productModel: output.contentPlan.productModel || output.aiTask.productModel,
            platform: output.aiTask.platform,
            backfilled: true,
          }),
        },
      });
    }
  }

  async overview() {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const [statusCounts, typeCounts, cost, workers, policies, pendingReview, failed, wecom] = await Promise.all([
      this.prisma.aiTask.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.aiTask.groupBy({ by: ["type"], _count: { _all: true } }),
      this.prisma.aiTask.aggregate({ where: { createdAt: { gte: from } }, _sum: { actualCost: true }, _count: true }),
      this.prisma.aiWorkerNode.findMany({ orderBy: { displayName: "asc" } }),
      this.prisma.aiTaskPolicy.findMany({ orderBy: { type: "asc" } }),
      this.prisma.aiTask.count({ where: { status: "PENDING_REVIEW" } }),
      this.prisma.aiTask.count({ where: { status: "FAILED" } }),
      this.wecom.status(),
    ]);
    return {
      statusCounts,
      typeCounts,
      today: { taskCount: cost._count, actualCost: cost._sum.actualCost || 0 },
      workers: workers.map((worker) => ({
        ...worker,
        tokenHash: undefined,
        online: Boolean(worker.lastHeartbeatAt && worker.lastHeartbeatAt.getTime() > Date.now() - 90_000),
      })),
      policies,
      pendingReview,
      failed,
      notification: wecom,
    };
  }

  async tasks(query: Record<string, string | undefined>) {
    const type = enumValue(query.type, taskTypes, "" as AiTaskType);
    const status = text(query.status).toUpperCase() as AiTaskStatus;
    const where: Prisma.AiTaskWhereInput = {
      ...(taskTypes.includes(type) ? { type } : {}),
      ...(status ? { status } : {}),
      ...(query.platform ? { platform: query.platform.toUpperCase() } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.ownerEmployeeId ? { ownerEmployeeId: query.ownerEmployeeId } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.keyword ? {
        OR: [
          { taskNo: { contains: query.keyword, mode: "insensitive" } },
          { title: { contains: query.keyword, mode: "insensitive" } },
          { instructions: { contains: query.keyword, mode: "insensitive" } },
        ],
      } : {}),
    };
    const tasks = await this.prisma.aiTask.findMany({
      where,
      include: this.includeTask(),
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      take: 500,
    });
    return tasks.map(normalizeTaskOutputSizes);
  }

  async task(id: string) {
    const task = await this.prisma.aiTask.findUnique({ where: { id }, include: this.includeTask(true) });
    if (!task) throw new NotFoundException("AI任务不存在");
    return normalizeTaskOutputSizes(task);
  }

  async createTask(body: JsonRecord, actor: string) {
    const type = enumValue(body.type, taskTypes, "ARTICLE");
    const title = text(body.title) || this.defaultTitle(type);
    const sourceType = text(body.sourceType) || "MANUAL";
    const sourceId = text(body.sourceId) || null;
    const executionPolicy = body.autoExecute === false
      ? "MANUAL"
      : enumValue(body.executionPolicy, ["AUTO_WITHIN_BUDGET", "MANUAL"] as const, "AUTO_WITHIN_BUDGET");
    const idempotencyKey = text(body.idempotencyKey)
      || `ai-task:${type}:${sourceType}:${sourceId || randomBytes(8).toString("hex")}:${text(body.bucket) || dateKey()}`;
    const existing = await this.prisma.aiTask.findUnique({ where: { idempotencyKey }, include: this.includeTask() });
    if (existing) return { ...existing, duplicate: true };
    const policy = await this.policy(type);
    const snapshot = await this.buildSnapshot(type, body);
    const estimatedCost = number(body.estimatedCost);
    const budgetLimit = number(body.budgetLimit);
    const modelPolicy = object(body.modelPolicy);
    const requestedExecutionClass = text(body.executionClass || modelPolicy.executionClass).toUpperCase();
    const executionClass = requestedExecutionClass === "EXTERNAL_PAID"
      ? "EXTERNAL_PAID"
      : ["STORE_ANALYSIS", "COMPETITOR_ANALYSIS", "LIVE_ANALYSIS"].includes(type)
        ? "ANALYSIS"
        : "CODEX_SKILL";
    const usesPaidExternal = executionClass === "EXTERNAL_PAID" && modelPolicy.allowExternalGeneration === true;
    const budgetState = !usesPaidExternal
      ? { allowed: true, message: executionClass === "ANALYSIS" ? "本地Codex分析任务" : "本地Codex Skill任务" }
      : await this.budgetState(type, policy.dailyBudget, estimatedCost, budgetLimit);
    const rawInput = object(body.input);
    const executionMode = text(rawInput.executionMode).toUpperCase();
    const resolvedTaskRoute = aiTaskRoute({ type, sourceType, input: rawInput });
    const missingRequired = snapshot.missingFields.length > 0
      && (["STORE_ANALYSIS", "COMPETITOR_ANALYSIS", "LIVE_ANALYSIS"].includes(type)
        || (type === "VIDEO" && executionMode === "TOPIC_CARD_BATCH"));
    const status: AiTaskStatus = missingRequired
      ? "WAITING_INPUT"
      : executionPolicy === "MANUAL" || !policy.autoExecute || !budgetState.allowed
        ? "WAITING_CONFIRMATION"
        : "PENDING";
    const taskNo = `AIT-${dateKey().replace(/-/g, "")}-${randomBytes(4).toString("hex").toUpperCase()}`;
    const task = await this.prisma.aiTask.create({
      data: {
        taskNo,
        idempotencyKey,
        type,
        title,
        instructions: text(body.instructions) || null,
        status,
        priority: text(body.priority).toUpperCase() || "MEDIUM",
        executionPolicy,
        sourceType,
        sourceId,
        platform: text(body.platform).toUpperCase() || null,
        productId: text(body.productId) || null,
        productModel: text(body.productModel) || null,
        ownerEmployeeId: text(body.ownerEmployeeId) || null,
        reviewerEmployeeId: text(body.reviewerEmployeeId) || null,
        modelPolicy: json({ ...modelPolicy, executionClass }),
        input: json({
          ...rawInput,
          // Route metadata is generated by the system. Ignore any caller
          // supplied taskRoute/requiredSkill and persist the authoritative one.
          ...(resolvedTaskRoute ? { taskRoute: resolvedTaskRoute } : { taskRoute: undefined }),
          ...(sourceType === "VIDEO_FACTORY_PROJECT"
            ? { preferredNodeCode: aiTaskTargetNodeCode({ sourceType, input: object(body.input) }) }
            : {}),
          executionClass,
          budgetState,
        }),
        estimatedCost,
        budgetLimit,
        maxRetries: policy.maxAttempts,
        dueAt: body.dueAt ? new Date(text(body.dueAt)) : null,
        progressMessage: status === "WAITING_INPUT"
          ? `缺少数据：${snapshot.missingFields.join("、")}`
          : status === "WAITING_CONFIRMATION"
            ? executionPolicy === "MANUAL" || !policy.autoExecute
              ? "等待管理员确认后由Codex执行"
              : budgetState.message
            : "等待Codex执行器领取",
        createdBy: actor,
        inputSnapshots: {
          create: [{
            kind: "TASK_CONTEXT",
            sourceType,
            sourceId,
            checksum: hash(JSON.stringify(snapshot.payload)),
            payload: json(snapshot.payload),
            missingFields: snapshot.missingFields,
          }],
        },
      },
      include: this.includeTask(true),
    });
    await this.audit(actor, "AI_TASK_CREATE", task.id, { type, status, sourceType, sourceId });
    const sourceOpsTaskId = await this.syncSourceOpsTask(task, status, task.progressMessage || undefined);
    if (task.ownerEmployeeId) {
      await this.notify(task.id, task.ownerEmployeeId, "AI_TASK_CREATED", "AI任务已创建", task.title, sourceOpsTaskId);
    }
    return { ...task, duplicate: false };
  }

  async updateTask(id: string, body: JsonRecord, actor: string) {
    const before = await this.ensureTask(id);
    if (["CLAIMED", "RUNNING", "UPLOADING", "QUALITY_CHECK"].includes(before.status)) {
      throw new BadRequestException("任务执行中，不能修改关键配置");
    }
    const updated = await this.prisma.aiTask.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: text(body.title) || before.title } : {}),
        ...(body.instructions !== undefined ? { instructions: text(body.instructions) || null } : {}),
        ...(body.priority !== undefined ? { priority: text(body.priority).toUpperCase() || before.priority } : {}),
        ...(body.ownerEmployeeId !== undefined ? { ownerEmployeeId: text(body.ownerEmployeeId) || null } : {}),
        ...(body.reviewerEmployeeId !== undefined ? { reviewerEmployeeId: text(body.reviewerEmployeeId) || null } : {}),
        ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(text(body.dueAt)) : null } : {}),
        ...(body.budgetLimit !== undefined ? { budgetLimit: number(body.budgetLimit) ?? null } : {}),
        ...(body.estimatedCost !== undefined ? { estimatedCost: number(body.estimatedCost) ?? null } : {}),
        ...(body.platform !== undefined ? { platform: text(body.platform) || null } : {}),
        ...(body.productId !== undefined ? { productId: text(body.productId) || null } : {}),
        ...(body.productModel !== undefined ? { productModel: text(body.productModel) || null } : {}),
        ...(body.autoExecute !== undefined ? { executionPolicy: body.autoExecute === false ? "MANUAL" : "AUTO_WITHIN_BUDGET" } : {}),
        ...(body.modelPolicy !== undefined ? { modelPolicy: json(body.modelPolicy) } : {}),
        ...(body.input !== undefined ? { input: json({ ...object(before.input), ...object(body.input) }) } : {}),
      },
      include: this.includeTask(true),
    });
    await this.audit(actor, "AI_TASK_UPDATE", id, { before: before.status, fields: Object.keys(body) });
    return updated;
  }

  async revise(id: string, body: JsonRecord, actor: string) {
    const before = await this.ensureTask(id);
    if (["CLAIMED", "RUNNING", "UPLOADING", "QUALITY_CHECK"].includes(before.status)) {
      throw new BadRequestException("任务执行中，不能重新编辑");
    }
    const updated = await this.updateTask(id, body, actor);
    const revisionInput = {
      ...object(updated.input),
      revisionAt: new Date().toISOString(),
      revisionBy: actor,
    };
    await this.prisma.$transaction([
      this.prisma.aiTask.update({
        where: { id },
        data: {
          input: json(revisionInput),
          output: json({}),
          status: "PENDING",
          progress: 0,
          progressMessage: "参数已修改，等待Codex重新执行",
          failureReason: null,
          retryCount: 0,
          lockedAt: null,
          lockedBy: null,
          heartbeatAt: null,
          startedAt: null,
          finishedAt: null,
          reviewedAt: null,
          reviewedBy: null,
          reviewNote: null,
        },
      }),
      this.prisma.aiTaskInputSnapshot.create({
        data: {
          aiTaskId: id,
          kind: "TASK_REVISION",
          sourceType: "ADMIN_EDIT",
          sourceId: id,
          checksum: hash(JSON.stringify(revisionInput)),
          payload: json(revisionInput),
          missingFields: [],
        },
      }),
    ]);
    await this.audit(actor, "AI_TASK_REVISE", id, { fromStatus: before.status, fields: Object.keys(body) });
    await this.syncSourceOpsTask({ ...updated, input: revisionInput }, "PENDING", "参数已修改，等待Codex重新执行");
    return this.task(id);
  }

  async requestRevision(id: string, note: string, actor: string) {
    const task = await this.ensureTask(id);
    const feedback = text(note);
    if (!feedback) throw new BadRequestException("请填写修改反馈");
    if (["CLAIMED", "RUNNING", "UPLOADING", "QUALITY_CHECK"].includes(task.status)) {
      throw new BadRequestException("任务执行中，请等待本次执行结束后再反馈");
    }
    const input = object(task.input);
    const feedbackHistory = Array.isArray(input.feedbackHistory) ? input.feedbackHistory : [];
    await this.prisma.$transaction([
      this.prisma.aiTask.update({
        where: { id },
        data: {
          status: "WAITING_CONFIRMATION",
          progress: 0,
          progressMessage: "收到修改反馈，等待管理员确认",
          reviewNote: feedback,
          input: json({
            ...input,
            feedbackHistory: [...feedbackHistory, { note: feedback, actor, createdAt: new Date().toISOString() }],
          }),
          lockedAt: null,
          lockedBy: null,
          heartbeatAt: null,
        },
      }),
      this.prisma.aiTaskInputSnapshot.create({
        data: {
          aiTaskId: id,
          kind: "REVISION_REQUEST",
          sourceType: "WORKBENCH_FEEDBACK",
          sourceId: text(input.opsTaskId) || task.sourceId,
          checksum: hash(feedback),
          payload: json({ note: feedback, actor }),
          missingFields: [],
        },
      }),
    ]);
    await this.syncSourceOpsTask(task, "WAITING_CONFIRMATION", "修改反馈已提交，等待管理员确认。");
    await this.audit(actor, "AI_TASK_REVISION_REQUEST", id, { note: feedback });
    return this.task(id);
  }

  async start(id: string, actor: string) {
    const task = await this.ensureTask(id);
    if (!["WAITING_CONFIRMATION", "RETURNED", "PENDING"].includes(task.status)) {
      throw new BadRequestException("任务当前不能启动");
    }
    const snapshots = await this.prisma.aiTaskInputSnapshot.findMany({ where: { aiTaskId: id } });
    const missing = snapshots.flatMap((item) => item.missingFields);
    if (missing.length && ["STORE_ANALYSIS", "COMPETITOR_ANALYSIS", "LIVE_ANALYSIS"].includes(task.type)) {
      throw new BadRequestException(`任务仍缺少数据：${Array.from(new Set(missing)).join("、")}`);
    }
    const updated = await this.prisma.aiTask.update({
      where: { id },
      data: {
        status: "PENDING",
        progress: 0,
        progressMessage: "已确认，等待Codex执行器领取",
        failureReason: null,
        lockedAt: null,
        lockedBy: null,
        heartbeatAt: null,
      },
    });
    await this.syncSourceOpsTask(updated, "PENDING", updated.progressMessage || undefined);
    await this.audit(actor, "AI_TASK_START", id, { fromStatus: task.status });
    return updated;
  }

  async cancel(id: string, actor: string) {
    const task = await this.ensureTask(id);
    if (["COMPLETED", "CANCELLED"].includes(task.status)) throw new BadRequestException("任务已经结束");
    const updated = await this.prisma.aiTask.update({
      where: { id },
      data: { status: "CANCELLED", finishedAt: new Date(), progressMessage: "任务已取消", lockedAt: null, lockedBy: null },
    });
    await this.syncSourceOpsTask(updated, "CANCELLED", "任务已取消");
    const projectId = text(object(task.input).existingContentPlanId);
    if (projectId) await this.videoFactory.syncProjectTaskState(projectId, "CANCELLED");
    await this.audit(actor, "AI_TASK_CANCEL", id, { fromStatus: task.status });
    return updated;
  }

  async retry(id: string, actor: string) {
    const task = await this.ensureTask(id);
    if (!["FAILED", "RETURNED", "RETRY"].includes(task.status)) throw new BadRequestException("任务当前不能重试");
    const taskInput = object(task.input);
    const isDirectOutputTask = task.type === "VIDEO"
      && text(taskInput.executionMode).toUpperCase() === "FULL_VIDEO"
      && (taskInput.codexDirectFullVideo === true || taskInput.referenceDirectFullVideo === true);
    // The first recovery retry may have been consumed by an older worker that
    // wrote an invalid result-contract envelope. Allow one final registration-
    // only retry, never a fresh render and never unlimited retries.
    const priorRecoveryAttempts = Math.max(
      0,
      Number(taskInput.outputRegistrationRecoveryAttempts || 0),
      text(taskInput.outputRegistrationRecoveryAttemptedAt) ? 1 : 0,
    );
    const isDirectOutputRecovery = isDirectOutputTask && priorRecoveryAttempts < 2;
    const priorImageRoutingRecoveryAttempts = Math.max(
      0,
      Number(taskInput.imageProjectRoutingRecoveryAttempts || 0),
      text(taskInput.imageProjectRoutingRecoveryAttemptedAt) ? 1 : 0,
    );
    const failureReason = text(task.failureReason);
    const isLegacyImageRoutingFailure = task.sourceType === "IMAGE_PROJECT"
      && task.type === "IMAGE"
      && /requiredSkill|fixed route|固定路由|imagegen/i.test(failureReason);
    // Two recovery attempts may already have been consumed by a stale worker
    // that was still running the pre-IMAGE_POST router. Keep one final bounded
    // attempt so the repaired envelope can be claimed by the upgraded worker.
    const isImageProjectRoutingRecovery = isLegacyImageRoutingFailure
      && priorImageRoutingRecoveryAttempts < 3;
    if (task.retryCount >= task.maxRetries && !isDirectOutputRecovery && !isImageProjectRoutingRecovery) {
      throw new BadRequestException("任务已达到最大重试次数");
    }
    const recoveryInput = isDirectOutputRecovery
      ? json({
        ...taskInput,
        outputRegistrationRecoveryAttemptedAt: new Date().toISOString(),
        outputRegistrationRecoveryAttempts: priorRecoveryAttempts + 1,
      })
      : isImageProjectRoutingRecovery
        ? json({
          ...taskInput,
          // Older image-project tasks were created before the IMAGE_POST
          // execution envelope was persisted.  Merely putting the same input
          // back in the queue makes the package builder fall back to the
          // generic IMAGE/imagegen route, so repair the envelope before the
          // task can be claimed again.
          executionMode: "IMAGE_POST",
          sourceType: "IMAGE_PROJECT",
          imageProjectId: text(taskInput.imageProjectId) || text(task.sourceId),
          imageProjectRoutingRecoveryAttemptedAt: new Date().toISOString(),
          imageProjectRoutingRecoveryAttempts: priorImageRoutingRecoveryAttempts + 1,
        })
        : undefined;
    const updated = await this.prisma.aiTask.update({
      where: { id },
      data: {
        status: "RETRY",
        // This is a one-time recovery path for a direct-output task whose
        // MP4 was already rendered but could not be registered by the API.
        // Keep the exhausted count intact: a later worker failure remains
        // terminal, so this never turns into unlimited retries.
        ...(isDirectOutputRecovery || isImageProjectRoutingRecovery ? {} : { retryCount: { increment: 1 } }),
        ...(recoveryInput ? { input: recoveryInput } : {}),
        progress: 0,
        progressMessage: isDirectOutputRecovery
          ? "正在恢复已生成成片并重新登记，不会重新剪辑"
          : isImageProjectRoutingRecovery
            ? "正在使用修复后的图文制作路由重新执行"
            : "等待重新执行",
        failureReason: null,
        lockedAt: null,
        lockedBy: null,
        heartbeatAt: null,
      },
    });
    await this.syncSourceOpsTask(
      updated,
      "RETRY",
      isDirectOutputRecovery
        ? "正在恢复已生成成片并重新登记，不会重新剪辑"
        : isImageProjectRoutingRecovery
          ? "正在使用修复后的图文制作路由重新执行"
          : "正在准备重新执行",
    );
    await this.audit(
      actor,
      isDirectOutputRecovery
        ? "AI_TASK_OUTPUT_REGISTRATION_RECOVERY"
        : isImageProjectRoutingRecovery
          ? "AI_TASK_IMAGE_ROUTING_RECOVERY"
          : "AI_TASK_RETRY",
      id,
      {
        retryCount: isDirectOutputRecovery || isImageProjectRoutingRecovery ? task.retryCount : task.retryCount + 1,
        recoveryOnly: isDirectOutputRecovery || isImageProjectRoutingRecovery,
        imageProjectRoutingRecovery: isImageProjectRoutingRecovery,
      },
    );
    return updated;
  }

  async review(id: string, body: JsonRecord, actor: string) {
    const task = await this.prisma.aiTask.findUnique({ where: { id }, include: { outputs: true } });
    if (!task || !reviewableStatuses.includes(task.status)) throw new BadRequestException("任务当前不在待审核状态");
    const action = text(body.action).toUpperCase();
    if (!["APPROVE", "RETURN"].includes(action)) throw new BadRequestException("审核动作不正确");
    const note = text(body.note);
    if (action === "RETURN" && !note) throw new BadRequestException("退回时必须填写修改要求");
    if (action === "RETURN") {
      await this.prisma.$transaction([
        this.prisma.aiTask.update({
          where: { id },
          data: { status: "RETURNED", reviewNote: note, reviewedAt: new Date(), reviewedBy: actor, progressMessage: "审核退回，等待重新执行" },
        }),
        this.prisma.aiTaskOutput.updateMany({ where: { aiTaskId: id, reviewStatus: "PENDING" }, data: { reviewStatus: "RETURNED" } }),
      ]);
      const projectId = text(object(task.input).existingContentPlanId);
      if (projectId) await this.videoFactory.syncProjectTaskState(projectId, "RETURNED");
      const sourceOpsTaskId = await this.syncSourceOpsTask(task, "RETURNED", note);
      if (task.ownerEmployeeId) await this.notify(id, task.ownerEmployeeId, "AI_TASK_RETURNED", "AI任务被退回", note, sourceOpsTaskId);
      await this.audit(actor, "AI_TASK_REVIEW_RETURN", id, { note });
      return this.task(id);
    }

    for (const output of task.outputs.filter((item) => item.reviewStatus === "PENDING")) {
      if (output.assetId) {
        if (task.type === "VIDEO" && output.kind === "VIDEO_MASTER") {
          await this.videoFactory.reviewOutput(output.assetId, true, actor, note);
        } else {
          await this.brandData.reviewAsset(output.assetId, true, actor, note);
        }
      }
      if (output.contentPlanId && task.type === "ARTICLE") {
        await this.content.approve(output.contentPlanId, actor, note);
      }
      await this.prisma.aiTaskOutput.update({ where: { id: output.id }, data: { reviewStatus: "APPROVED" } });
    }

    const videoExecutionMode = text(object(task.input).executionMode).toUpperCase();
    if (task.type === "VIDEO"
      && videoExecutionMode !== "SCRIPT_ONLY"
      && !task.outputs.some((item) => item.kind === "VIDEO_MASTER")) {
      const project = task.outputs.find((item) => item.contentPlanId)?.contentPlanId;
      if (project) {
        try {
          await this.videoFactory.enqueueRender(project, actor);
          await this.prisma.aiTask.update({
            where: { id },
            data: { status: "RUNNING", progress: 75, progressMessage: "镜头已审核，正在生成主成片", reviewedAt: new Date(), reviewedBy: actor, reviewNote: note || null },
          });
          await this.syncSourceOpsTask(task, "RUNNING", "镜头已审核，正在生成主成片");
          await this.audit(actor, "AI_TASK_VIDEO_RENDER_START", id, { contentPlanId: project });
          return this.task(id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "视频渲染尚未就绪";
          await this.prisma.aiTask.update({ where: { id }, data: { status: "RUNNING", progressMessage: message } });
          await this.syncSourceOpsTask(task, "RUNNING", "视频正在处理中，请稍后查看进度");
          return this.task(id);
        }
      }
    }

    await this.prisma.aiTask.update({
      where: { id },
      data: { status: "COMPLETED", progress: 100, progressMessage: "审核通过，任务完成", reviewedAt: new Date(), reviewedBy: actor, reviewNote: note || null, finishedAt: new Date() },
    });
    const sourceOpsTaskId = await this.syncSourceOpsTask(task, "COMPLETED", "AI成果已审核通过，可在原任务中查看。");
    if (task.ownerEmployeeId) {
      await this.notify(id, task.ownerEmployeeId, "AI_TASK_APPROVED", "AI任务审核通过", task.title, sourceOpsTaskId);
    }
    await this.audit(actor, "AI_TASK_REVIEW_APPROVE", id, { note });
    return this.task(id);
  }

  async convertToOpsTask(id: string, body: JsonRecord, actor: string) {
    const task = await this.prisma.aiTask.findUnique({ where: { id }, include: { outputs: true } });
    if (!task) throw new NotFoundException("AI任务不存在");
    const requestedOpsTaskId = text(object(task.input).opsTaskId);
    const existing = requestedOpsTaskId
      ? await this.prisma.opsTask.findUnique({ where: { id: requestedOpsTaskId } })
      : await this.prisma.opsTask.findFirst({ where: { sourceType: "AI_TASK", sourceId: task.id } });
    if (existing) {
      await this.prisma.aiTaskOutput.updateMany({
        where: { aiTaskId: id, kind: { not: "OPS_TASK" }, opsTaskId: null },
        data: { opsTaskId: existing.id },
      });
      await this.prisma.opsTask.update({
        where: { id: existing.id },
        data: {
          result: "AI成果已生成并审核通过，可在任务详情中预览或下载。",
          evidence: json({
            ...object(existing.evidence),
            aiTaskId: id,
            aiTaskNo: task.taskNo,
            outputIds: task.outputs.map((item) => item.id),
          }),
        },
      });
      return existing;
    }
    const opsTask = await this.prisma.opsTask.create({
      data: {
        taskNo: `TASK-${dateKey().replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`,
        title: text(body.title) || task.title,
        description: text(body.description) || text(object(task.output).summary) || task.instructions,
        category: text(body.category) || this.opsCategory(task.type),
        priority: text(body.priority).toUpperCase() || task.priority,
        status: text(body.assigneeEmployeeId) || task.ownerEmployeeId ? "ACCEPTED" : "OPEN",
        assigneeEmployeeId: text(body.assigneeEmployeeId) || task.ownerEmployeeId,
        requiredRoleCode: text(body.requiredRoleCode) || this.requiredRole(task.type),
        assignedBy: actor,
        sourceType: "AI_TASK",
        sourceId: task.id,
        platform: task.platform,
        productId: task.productId,
        expectedResult: text(body.expectedResult) || "按AI分析建议完成执行并提交结果",
        dueAt: body.dueAt ? new Date(text(body.dueAt)) : task.dueAt,
        evidence: json({ aiTaskNo: task.taskNo, outputIds: task.outputs.map((item) => item.id), summary: object(task.output).summary }),
      },
    });
    const output = await this.prisma.aiTaskOutput.create({
      data: { aiTaskId: id, kind: "OPS_TASK", title: opsTask.title, opsTaskId: opsTask.id, reviewStatus: "APPROVED" },
    });
    await this.prisma.aiTaskOutput.updateMany({
      where: { aiTaskId: id, kind: { not: "OPS_TASK" } },
      data: { opsTaskId: opsTask.id },
    });
    if (opsTask.assigneeEmployeeId && body.skipNotification !== true) {
      await this.prisma.taskNotification.create({
        data: { taskId: opsTask.id, aiTaskId: id, recipientEmployeeId: opsTask.assigneeEmployeeId, type: "ASSIGNED", title: "收到AI成果任务", content: opsTask.title },
      });
    }
    await this.audit(actor, "AI_TASK_TO_OPS_TASK", id, { opsTaskId: opsTask.id, outputId: output.id });
    return opsTask;
  }

  policies() {
    return this.prisma.aiTaskPolicy.findMany({ orderBy: { type: "asc" } });
  }

  async updatePolicies(rows: unknown[], actor: string) {
    if (!Array.isArray(rows)) throw new BadRequestException("策略格式不正确");
    for (const item of rows.map(object)) {
      const type = enumValue(item.type, taskTypes, "" as AiTaskType);
      if (!taskTypes.includes(type)) continue;
      await this.prisma.aiTaskPolicy.upsert({
        where: { type },
        create: {
          type,
          enabled: item.enabled !== false,
          autoExecute: item.autoExecute !== false,
          dailyBudget: number(item.dailyBudget),
          maxConcurrency: Math.max(1, Number(item.maxConcurrency || 1)),
          maxAttempts: Math.max(1, Number(item.maxAttempts || 3)),
          timeoutSeconds: Math.max(60, Number(item.timeoutSeconds || 1200)),
          config: json(item.config),
        },
        update: {
          enabled: item.enabled !== false,
          autoExecute: item.autoExecute !== false,
          dailyBudget: number(item.dailyBudget) ?? null,
          maxConcurrency: Math.max(1, Number(item.maxConcurrency || 1)),
          maxAttempts: Math.max(1, Number(item.maxAttempts || 3)),
          timeoutSeconds: Math.max(60, Number(item.timeoutSeconds || 1200)),
          config: json(item.config),
        },
      });
    }
    await this.audit(actor, "AI_TASK_POLICY_UPDATE", "POLICIES", { count: rows.length });
    return this.policies();
  }

  async runners() {
    const rows = await this.prisma.aiWorkerNode.findMany({ orderBy: { displayName: "asc" } });
    return rows.map((row) => ({
      ...row,
      tokenHash: undefined,
      online: Boolean(row.lastHeartbeatAt && row.lastHeartbeatAt.getTime() > Date.now() - 90_000),
    }));
  }

  async createRunner(body: JsonRecord, actor: string) {
    const nodeCode = text(body.nodeCode).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    if (!nodeCode) throw new BadRequestException("请填写执行节点编码");
    const existing = await this.prisma.aiWorkerNode.findUnique({ where: { nodeCode } });
    if (existing) throw new BadRequestException("执行节点编码已存在");
    const token = randomBytes(32).toString("base64url");
    const node = await this.prisma.aiWorkerNode.create({
      data: {
        nodeCode,
        displayName: text(body.displayName) || nodeCode,
        tokenHash: hash(token),
        capabilities: strings(body.capabilities).filter((item) => taskTypes.includes(item as AiTaskType)),
        status: "OFFLINE",
      },
    });
    await this.audit(actor, "AI_RUNNER_CREATE", node.id, { nodeCode });
    return { ...node, tokenHash: undefined, token };
  }

  async rotateRunnerToken(id: string, actor: string) {
    const node = await this.prisma.aiWorkerNode.findUnique({ where: { id } });
    if (!node) throw new NotFoundException("执行节点不存在");
    const token = randomBytes(32).toString("base64url");
    const updated = await this.prisma.aiWorkerNode.update({
      where: { id },
      data: {
        tokenHash: hash(token),
        status: "OFFLINE",
        currentTaskId: null,
        currentSkill: null,
        lastHeartbeatAt: null,
      },
    });
    await this.audit(actor, "AI_RUNNER_TOKEN_ROTATE", id, { nodeCode: node.nodeCode });
    return { ...updated, tokenHash: undefined, token };
  }

  async claimRunner(token: string, body: JsonRecord) {
    const node = await this.runner(token, text(body.nodeCode));
    await this.releaseStaleTasks();
    const capabilities = node.capabilities.length ? node.capabilities as AiTaskType[] : taskTypes;
    const tasks = await this.prisma.aiTask.findMany({
      where: {
        status: { in: claimableStatuses },
        type: { in: capabilities },
        childDependencies: { none: { parentTask: { status: { not: "COMPLETED" } } } },
      },
      orderBy: [{ priority: "asc" }, { dueAt: "asc" }, { createdAt: "asc" }],
      // Filtering by node routing, execution mode and per-type concurrency is
      // performed below. A small pre-filter limit lets a queue full of VIDEO
      // jobs that are temporarily at concurrency capacity starve later IMAGE
      // jobs forever. Scan a bounded but sufficiently broad window so other
      // supported task types can still be claimed.
      take: 200,
    });
    for (const candidate of tasks) {
      if (!runnerCanClaimTask(candidate, body.supportedExecutionModes, body.supportedRouteKeys)) continue;
      const targetNodeCode = aiTaskTargetNodeCode(candidate);
      if (targetNodeCode && targetNodeCode !== node.nodeCode.toLowerCase()) continue;
      const staleReason = await this.videoProjectTaskStaleReason(candidate);
      if (staleReason) {
        await this.prisma.aiTask.update({
          where: { id: candidate.id },
          data: {
            status: "CANCELLED",
            failureReason: staleReason,
            progressMessage: `任务已自动停止：${staleReason}`,
            finishedAt: new Date(),
            lockedBy: null,
            lockedAt: null,
            heartbeatAt: null,
          },
        });
        await this.syncSourceOpsTask(candidate, "CANCELLED", `任务已自动停止：${staleReason}`);
        continue;
      }
      const policy = await this.policy(candidate.type);
      if (!policy.enabled) continue;
      const running = await this.prisma.aiTask.count({
        where: {
          type: candidate.type,
          status: { in: ["CLAIMED", "RUNNING", "QUALITY_CHECK", "UPLOADING"] },
          // Concurrency is a per-runner capacity limit. A colleague's node
          // processing another VIDEO task must not block a smart-video task
          // that is explicitly routed to this dedicated node.
          lockedBy: node.nodeCode,
        },
      });
      if (running >= policy.maxConcurrency) continue;
      const claimed = await this.prisma.aiTask.updateMany({
        where: { id: candidate.id, status: candidate.status },
        data: {
          status: "CLAIMED",
          lockedBy: node.nodeCode,
          lockedAt: new Date(),
          heartbeatAt: new Date(),
          startedAt: candidate.startedAt || new Date(),
          progress: 5,
          progressMessage: "Codex执行器已领取",
        },
      });
      if (!claimed.count) continue;
      const attemptNo = await this.prisma.aiTaskAttempt.count({ where: { aiTaskId: candidate.id } }) + 1;
      const attempt = await this.prisma.aiTaskAttempt.create({
        data: {
          aiTaskId: candidate.id,
          workerNodeId: node.id,
          attemptNo,
          status: "RUNNING",
          promptTemplate: candidate.type.toLowerCase(),
          promptVersion: "v1",
          startedAt: new Date(),
        },
      });
      await this.prisma.aiWorkerNode.update({
        where: { id: node.id },
        data: {
          status: "BUSY",
          version: text(body.version) || node.version,
          currentTaskId: candidate.id,
          currentSkill: null,
          lastHeartbeatAt: new Date(),
          lastError: null,
        },
      });
      const contentPlanId = text(object(candidate.input).existingContentPlanId);
      if (contentPlanId) await this.videoFactory.syncProjectTaskState(contentPlanId, "CLAIMED");
      await this.syncSourceOpsTask(candidate, "CLAIMED", "Codex已领取任务，正在处理");
      return {
        task: await this.task(candidate.id),
        attemptId: attempt.id,
        policy: { timeoutSeconds: policy.timeoutSeconds, maxAttempts: policy.maxAttempts },
      };
    }
    await this.prisma.aiWorkerNode.update({
      where: { id: node.id },
      data: {
        status: "ONLINE",
        version: text(body.version) || node.version,
        currentTaskId: null,
        currentSkill: null,
        lastHeartbeatAt: new Date(),
      },
    });
    return { task: null };
  }

  async runnerPackage(token: string, id: string, body: JsonRecord) {
    const node = await this.runner(token, text(body.nodeCode));
    await this.ensureRunnerTask(node.nodeCode, id);
    const task = await this.task(id);
    const input = object(task.input);
    const resolvedTaskRoute = aiTaskRoute(task);
    const modelPolicy = object(task.modelPolicy);
    const dedicatedDouyin = text(input.factoryModule).toUpperCase() === "DOUYIN_VIRAL";
    const executionMode = text(input.executionMode).toUpperCase() || (task.type === "VIDEO" ? "FULL_VIDEO" : "DEFAULT");
    const localLibraryCodexTask = text(input.executionClass).toUpperCase() === "CODEX_SKILL"
      && text(input.skillName).toLowerCase() === "video-editing-from-media-library";
    const codexDirectFullVideo = task.type === "VIDEO"
      && executionMode === "FULL_VIDEO"
      && (input.codexDirectFullVideo === true || localLibraryCodexTask);
    const referenceDirectFullVideo = task.type === "VIDEO"
      && executionMode === "FULL_VIDEO"
      && input.referenceDirectFullVideo === true;
    const localDirectFullVideo = codexDirectFullVideo || referenceDirectFullVideo;
    const existingDirectInput = object(input.codexDirectInput);
    const existingReferenceInput = object(input.referenceDirectInput);
    const projectBrief = object(input.projectBrief);
    const packageInputBase = codexDirectFullVideo
      ? {
        executionMode: "FULL_VIDEO",
        executionClass: "CODEX_SKILL",
        skillName: "video-editing-from-media-library",
        codexDirectFullVideo: true,
        codexDirectInput: {
          productModel: text(existingDirectInput.productModel) || text(task.productModel),
          prompt: text(existingDirectInput.prompt)
            || text(input.aiPrompt)
            || text(projectBrief.additionalPrompt)
            || text(projectBrief.prompt),
          creativeMode: text(existingDirectInput.creativeMode) || text(input.creativeMode) || "FULL_VIDEO",
        },
      }
      : referenceDirectFullVideo
        ? {
          executionMode: "FULL_VIDEO",
          executionClass: "CODEX_SKILL",
          skillName: "video-editing-from-media-library",
          referenceDirectFullVideo: true,
          referenceDirectInput: {
            productModel: text(existingReferenceInput.productModel) || text(task.productModel),
            referenceVideoUrl: text(existingReferenceInput.referenceVideoUrl)
              || text(input.referenceVideoUrl)
              || text(projectBrief.reference),
            prompt: text(existingReferenceInput.prompt) || text(projectBrief.additionalPrompt),
            ...(Object.keys(object(existingReferenceInput.revision)).length
              ? { revision: object(existingReferenceInput.revision) }
              : {}),
          },
        }
      : input;
    const packageInput = {
      ...packageInputBase,
      ...(resolvedTaskRoute ? { taskRoute: resolvedTaskRoute } : {}),
    };
    const imagePostProject = task.type === "IMAGE"
      && executionMode === "IMAGE_POST"
      && (text(task.sourceType).toUpperCase() === "IMAGE_PROJECT"
        || text(input.sourceType).toUpperCase() === "IMAGE_PROJECT"
        || Boolean(input.imageProjectId));
    const assetIds = new Set<string>();
    if (!localDirectFullVideo) {
      for (const snapshot of task.inputSnapshots || []) {
        const payload = object(snapshot.payload);
        for (const item of Array.isArray(payload.assets) ? payload.assets.map(object) : []) {
          const assetId = text(item.id);
          if (assetId) assetIds.add(assetId);
        }
      }
      if (task.type === "VIDEO" && executionMode === "SCRIPT_ONLY" && text(task.productModel)) {
        const modelAssets = await this.prisma.asset.findMany({
          where: {
            deletedAt: null,
            kind: { in: ["VIDEO", "IMAGE"] },
            reviewStatus: "APPROVED",
            availabilityStatus: "ACTIVE",
            rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
            products: { some: { product: { modelCode: text(task.productModel) } } },
          },
          select: { id: true },
        });
        for (const asset of modelAssets) assetIds.add(asset.id);
      }
    }
    const assets = assetIds.size
      ? await this.prisma.asset.findMany({
        where: {
          id: { in: Array.from(assetIds) },
          reviewStatus: "APPROVED",
          availabilityStatus: "ACTIVE",
          rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
        },
        select: {
          id: true,
          assetNo: true,
          displayName: true,
          kind: true,
          mediaType: true,
          extension: true,
          sha256: true,
          sizeBytes: true,
          width: true,
          height: true,
          durationSeconds: true,
          contentDescription: true,
          objectKey: true,
          storageUrl: true,
          sourcePath: true,
          qualityScore: true,
          reviewStatus: true,
          availabilityStatus: true,
          rightsStatus: true,
          updatedAt: true,
          aiIndex: true,
          searchText: true,
          indexVersion: true,
          indexConfidence: true,
          indexNeedsReview: true,
          products: { select: { productId: true, scope: true, confidence: true, confirmed: true } },
          tags: { select: { confidence: true, source: true, tag: { select: { code: true, label: true, namespace: true } } } },
          segments: {
            orderBy: { startSeconds: "asc" },
            select: {
              id: true,
              startSeconds: true,
              endSeconds: true,
              transcript: true,
              moduleType: true,
              confidence: true,
              status: true,
              analysisVersion: true,
              materializedAssetId: true,
            },
          },
        },
      })
      : [];
    const libraryState = await this.systemMaterialIndexStatus();
    return {
      task: {
        id: task.id,
        taskNo: task.taskNo,
        type: task.type,
        title: task.title,
        instructions: localDirectFullVideo ? "" : task.instructions,
        platform: task.platform,
        productModel: task.productModel,
        sourceType: task.sourceType,
        sourceId: task.sourceId,
        input: packageInput,
        modelPolicy,
      },
      snapshots: (localDirectFullVideo ? [] : task.inputSnapshots || []).map((snapshot) => ({
        id: snapshot.id,
        kind: snapshot.kind,
        sourceType: snapshot.sourceType,
        sourceId: snapshot.sourceId,
        checksum: snapshot.checksum,
        payload: snapshot.payload,
        missingFields: snapshot.missingFields,
        capturedAt: snapshot.capturedAt,
      })),
      assets: assets.map((asset) => {
        const { objectKey, sourcePath, ...metadata } = asset;
        let downloadUrl: string | null = null;
        if (objectKey) {
          try {
            downloadUrl = this.oss.signedDownloadUrl(objectKey, 3_600);
          } catch {
            downloadUrl = /^https?:\/\//iu.test(asset.storageUrl || "") ? asset.storageUrl : null;
          }
        } else if (/^https?:\/\//iu.test(asset.storageUrl || "")) {
          downloadUrl = asset.storageUrl;
        }
        return {
          ...metadata,
          sizeBytes: asset.sizeBytes.toString(),
          downloadUrl,
          localPath: null,
        };
      }),
      execution: {
        mode: executionMode,
        strategy: ["IMAGE", "ARTICLE"].includes(task.type) || dedicatedDouyin
          ? "CODEX_SKILL"
          : text(modelPolicy.strategy).toUpperCase() || "CODEX_FIRST",
        allowExternalGeneration: ["IMAGE", "ARTICLE"].includes(task.type)
          ? false
          : modelPolicy.allowExternalGeneration === true,
        requiredSkill: resolvedTaskRoute?.requiredSkill || (localDirectFullVideo
          ? "video-editing-from-media-library"
          : task.type === "VIDEO"
          && dedicatedDouyin
          && ["TOPIC_CARD_BATCH", "FULL_VIDEO", "SCRIPT_ONLY"].includes(executionMode)
          ? "saydian-douyin-viral-video-generator"
          : task.type === "VIDEO"
            && ["FULL_VIDEO", "SCRIPT_ONLY", "SIMILAR_VIDEO", "NO_VOICE_VIDEO", "COVER_TITLE"].includes(executionMode)
            ? "saidian-ai-task-dispatcher"
          : task.type === "IMAGE"
            ? (imagePostProject
              ? "saidian-ai-task-dispatcher"
              : "imagegen")
            : task.type === "ARTICLE"
              ? "build-health-brand-trust-content"
            : undefined),
        fallbackOrder: localDirectFullVideo
          ? ["LOCAL_FULL_SKILL", "INTERNAL_SCRIPT_AND_SHOT_PLAN", "MANDATORY_QC", "FINAL_VIDEO_ONLY"]
          : task.type === "VIDEO"
          && executionMode === "FULL_VIDEO"
          ? [
            "APPROVED_REAL_VIDEO",
            "PRODUCT_IMAGE_AUXILIARY_OVERLAY",
            "LOCAL_MEDIA_TOOLS",
            "EXTERNAL_VISUAL_IF_EXPLICITLY_ALLOWED",
            "RESHOOT_OPS_TASK",
          ]
          : undefined,
        downstreamSkill: resolvedTaskRoute?.requiredSkill
          || (imagePostProject ? "saidian-douyin-image-posts" : undefined),
        taskRoute: resolvedTaskRoute || undefined,
        videoModelRouting: dedicatedDouyin
          ? {
            policyVersion: "douyin-viral-v1",
            localFirst: true,
            requiresConfiguredProvider: true,
            externalShotAllocation: {
              SEEDANCE_2: 70,
              KLING: 30,
            },
            recipeRoutes: {
              PAIN_SOLVE: "SEEDANCE_2",
              GIFT_EMOTION: "SEEDANCE_2",
              CONTRARIAN: "SEEDANCE_2",
              FAQ: "APPROVED_REAL_ASSET",
              REVIEW: "APPROVED_REAL_ASSET",
              COMPARISON: "APPROVED_REAL_ASSET",
              UGC: "KLING",
              VISUAL_AD: "SEEDANCE_2",
            },
            shotRoutes: {
              FAMILY_STORY: "SEEDANCE_2",
              PRODUCT_ATMOSPHERE: "SEEDANCE_2",
              MULTI_SHOT: "SEEDANCE_2",
              IMAGE_TO_VIDEO: "SEEDANCE_2",
              HUMAN_ACTION: "KLING",
              ELDER_GESTURE: "KLING",
              SPORTS_ACTION: "KLING",
              PRODUCT_CLOSEUP: "APPROVED_REAL_ASSET",
              FUNCTION_PROOF: "APPROVED_REAL_ASSET",
            },
          }
          : undefined,
        healthContentAllowed: input.healthContentAllowed !== false,
        output: task.type === "VIDEO"
          ? { aspectRatio: "9:16", width: 1080, height: 1920, format: "mp4" }
          : undefined,
      },
      materialLibrary: {
        source: "SYSTEM_ASSET_LIBRARY",
        transport: "ALIYUN_OSS",
        revision: libraryState.revision,
        indexedAssets: libraryState.indexedAssets,
        pendingLearning: libraryState.pendingLearning,
        taskWhitelistFrozenAt: new Date().toISOString(),
      },
    };
  }

  async runnerMaterialIndex(token: string, body: JsonRecord) {
    await this.runner(token, text(body.nodeCode));
    const rawCursor = text(body.cursor);
    const [cursorTime = "", cursorId = ""] = rawCursor.split("|");
    const parsedCursor = cursorTime ? new Date(cursorTime) : null;
    const cursor = parsedCursor && !Number.isNaN(parsedCursor.getTime()) ? parsedCursor : null;
    const assets = await this.prisma.asset.findMany({
      where: cursor ? {
        OR: [
          { updatedAt: { gt: cursor } },
          ...(cursorId ? [{ updatedAt: cursor, id: { gt: cursorId } }] : []),
        ],
      } : {},
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: 500,
      select: {
        id: true,
        assetNo: true,
        displayName: true,
        kind: true,
        mediaType: true,
        extension: true,
        sha256: true,
        sizeBytes: true,
        width: true,
        height: true,
        durationSeconds: true,
        contentDescription: true,
        storageUrl: true,
        reviewStatus: true,
        availabilityStatus: true,
        rightsStatus: true,
        deletedAt: true,
        updatedAt: true,
        aiIndex: true,
        searchText: true,
        indexVersion: true,
        indexConfidence: true,
        indexNeedsReview: true,
        products: {
          select: {
            productId: true,
            scope: true,
            confidence: true,
            confirmed: true,
            product: { select: { modelCode: true, category: true, name: true } },
          },
        },
        tags: { select: { confidence: true, source: true, tag: { select: { code: true, label: true, namespace: true } } } },
        segments: {
          orderBy: { startSeconds: "asc" },
          select: {
            id: true,
            startSeconds: true,
            endSeconds: true,
            transcript: true,
            moduleType: true,
            confidence: true,
            status: true,
            analysisVersion: true,
            materializedAssetId: true,
          },
        },
      },
    });
    const state = await this.systemMaterialIndexStatus();
    const nextCursor = assets.length
      ? `${assets[assets.length - 1]!.updatedAt.toISOString()}|${assets[assets.length - 1]!.id}`
      : rawCursor || `${state.revision}|${state.revisionAssetId || ""}`;
    return {
      ...state,
      source: "SYSTEM_ASSET_LIBRARY",
      transport: "ALIYUN_OSS",
      revision: state.revision,
      cursor: nextCursor,
      hasMore: assets.length === 500,
      changes: assets.map(({ sizeBytes, ...asset }) => {
        const usable = !asset.deletedAt
          && asset.reviewStatus === "APPROVED"
          && asset.availabilityStatus === "ACTIVE"
          && ["COMMERCIAL", "EDIT_ONLY"].includes(asset.rightsStatus);
        return {
          ...asset,
          sizeBytes: sizeBytes.toString(),
          updatedAt: asset.updatedAt.toISOString(),
          deletedAt: asset.deletedAt?.toISOString() || null,
          usable,
        };
      }),
    };
  }

  async runnerMaterialDownloads(token: string, body: JsonRecord) {
    await this.runner(token, text(body.nodeCode));
    const ids = Array.from(new Set(
      (Array.isArray(body.assetIds) ? body.assetIds : []).map((item) => text(item)).filter(Boolean),
    )).slice(0, 1_000);
    if (!ids.length) return { downloads: [] };
    const assets = await this.prisma.asset.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        reviewStatus: "APPROVED",
        availabilityStatus: "ACTIVE",
        rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
      },
      select: { id: true, sha256: true, objectKey: true, storageUrl: true },
    });
    return {
      downloads: assets.map((asset) => {
        let downloadUrl: string | null = null;
        if (asset.objectKey) {
          try { downloadUrl = this.oss.signedDownloadUrl(asset.objectKey, 7_200); } catch { downloadUrl = null; }
        } else if (/^https?:\/\//iu.test(asset.storageUrl || "")) {
          downloadUrl = asset.storageUrl;
        }
        return { id: asset.id, sha256: asset.sha256, downloadUrl };
      }),
    };
  }

  async runnerMaterialMirrorIndex(token: string, body: JsonRecord) {
    await this.runner(token, text(body.nodeCode));
    const rawCursor = text(body.cursor);
    const [cursorTime = "", cursorId = ""] = rawCursor.split("|");
    const parsedCursor = cursorTime ? new Date(cursorTime) : null;
    const cursor = parsedCursor && !Number.isNaN(parsedCursor.getTime()) ? parsedCursor : null;
    const assets = await this.prisma.asset.findMany({
      where: cursor ? {
        OR: [
          { updatedAt: { gt: cursor } },
          ...(cursorId ? [{ updatedAt: cursor, id: { gt: cursorId } }] : []),
        ],
      } : {},
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: 1_000,
      select: {
        id: true,
        assetNo: true,
        displayName: true,
        kind: true,
        extension: true,
        sha256: true,
        sizeBytes: true,
        // Local runners use these fields to map legacy assets whose old OSS objects are unavailable.
        sourcePath: true,
        purpose: true,
        packagingMetadata: true,
        reviewStatus: true,
        availabilityStatus: true,
        rightsStatus: true,
        deletedAt: true,
        updatedAt: true,
        aiIndex: true,
        searchText: true,
        indexVersion: true,
        indexConfidence: true,
        products: {
          select: { product: { select: { modelCode: true, category: true, name: true } } },
        },
      },
    });
    const nextCursor = assets.length
      ? `${assets[assets.length - 1]!.updatedAt.toISOString()}|${assets[assets.length - 1]!.id}`
      : rawCursor;
    return {
      cursor: nextCursor,
      hasMore: assets.length === 1_000,
      changes: assets.map(({ sizeBytes, ...asset }) => ({
        ...asset,
        sizeBytes: sizeBytes.toString(),
        updatedAt: asset.updatedAt.toISOString(),
        deletedAt: asset.deletedAt?.toISOString() || null,
        usable: !asset.deletedAt
          && asset.reviewStatus === "APPROVED"
          && asset.availabilityStatus === "ACTIVE"
          && ["COMMERCIAL", "EDIT_ONLY"].includes(asset.rightsStatus),
      })),
    };
  }

  async systemMaterialIndexStatus() {
    const [latest, totalAssets, indexedAssets, pendingLearning, disabledAssets] = await Promise.all([
      this.prisma.asset.findFirst({ orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { id: true, updatedAt: true } }),
      this.prisma.asset.count({ where: { deletedAt: null } }),
      this.prisma.asset.count({ where: { deletedAt: null, indexVersion: { gte: 4 }, indexNeedsReview: false } }),
      this.prisma.asset.count({
        where: {
          deletedAt: null,
          OR: [{ indexVersion: { lt: 4 } }, { indexNeedsReview: true }],
        },
      }),
      this.prisma.asset.count({
        where: {
          OR: [{ deletedAt: { not: null } }, { availabilityStatus: { not: "ACTIVE" } }],
        },
      }),
    ]);
    return {
      revision: latest ? latest.updatedAt.toISOString() : new Date(0).toISOString(),
      revisionAssetId: latest?.id || null,
      totalAssets,
      indexedAssets,
      pendingLearning,
      disabledAssets,
      learningProvider: "ALIYUN_BAILIAN",
      transport: "ALIYUN_OSS",
      indexVersion: 4,
    };
  }

  async runnerCheckpoint(token: string, id: string, body: JsonRecord) {
    const node = await this.runner(token, text(body.nodeCode));
    const task = await this.ensureRunnerTask(node.nodeCode, id);
    const attempt = await this.prisma.aiTaskAttempt.findFirst({
      where: { aiTaskId: id, workerNodeId: node.id, status: "RUNNING" },
      orderBy: { attemptNo: "desc" },
    });
    const checkpoint = {
      stage: text(body.stage) || "RUNNING",
      message: text(body.message),
      data: object(body.data),
      savedAt: new Date().toISOString(),
    };
    const attemptLogs = object(attempt?.logs);
    const checkpointHistory = [
      ...(Array.isArray(attemptLogs.checkpoints) ? attemptLogs.checkpoints : []),
      checkpoint,
    ].slice(-100);
    await this.prisma.$transaction([
      this.prisma.aiTask.update({
        where: { id },
        data: {
          status: enumValue(body.status, ["RUNNING", "QUALITY_CHECK", "UPLOADING"] as const, task.status as "RUNNING"),
          progress: Math.max(task.progress, Math.min(99, Number(body.progress || task.progress))),
          progressMessage: checkpoint.message || task.progressMessage,
          heartbeatAt: new Date(),
        },
      }),
      ...(attempt ? [
        this.prisma.aiTaskAttempt.update({
          where: { id: attempt.id },
          data: { logs: json({ ...attemptLogs, checkpoint, checkpoints: checkpointHistory }) },
        }),
      ] : []),
      this.prisma.aiWorkerNode.update({
        where: { id: node.id },
        data: {
          status: "BUSY",
          currentTaskId: id,
          currentSkill: text(object(body.data).currentSkill) || node.currentSkill,
          lastHeartbeatAt: new Date(),
        },
      }),
    ]);
    return { ok: true, checkpoint };
  }

  async runnerHeartbeat(token: string, id: string, body: JsonRecord) {
    const node = await this.runner(token, text(body.nodeCode));
    const task = await this.ensureRunnerTask(node.nodeCode, id);
    await this.prisma.$transaction([
      this.prisma.aiTask.update({
        where: { id },
        data: {
          heartbeatAt: new Date(),
          status: task.status === "CLAIMED" ? "RUNNING" : task.status,
          progress: number(body.progress) ?? task.progress,
          progressMessage: text(body.message) || task.progressMessage,
        },
      }),
      this.prisma.aiWorkerNode.update({
        where: { id: node.id },
        data: {
          status: "BUSY",
          currentTaskId: id,
          currentSkill: text(body.currentSkill) || node.currentSkill,
          lastHeartbeatAt: new Date(),
        },
      }),
    ]);
    return { ok: true };
  }

  async runnerProgress(token: string, id: string, body: JsonRecord) {
    const node = await this.runner(token, text(body.nodeCode));
    const task = await this.ensureRunnerTask(node.nodeCode, id);
    return this.prisma.aiTask.update({
      where: { id },
      data: {
        status: enumValue(body.status, ["RUNNING", "QUALITY_CHECK", "UPLOADING"] as const, task.status as "RUNNING"),
        heartbeatAt: new Date(),
        progress: Math.max(task.progress, Math.min(99, Number(body.progress || task.progress))),
        progressMessage: text(body.message) || task.progressMessage,
      },
    });
  }

  async runnerOutput(token: string, id: string, body: JsonRecord, file?: UploadFile) {
    const node = await this.runner(token, text(body.nodeCode));
    const task = await this.ensureRunnerTask(node.nodeCode, id);
    const requestedOpsTaskId = text(object(task.input).opsTaskId) || undefined;
    if (!file) {
      const outputKind = text(body.kind) || "STRUCTURED_RESULT";
      const version = (await this.prisma.aiTaskOutput.count({
        where: { aiTaskId: id, kind: outputKind },
      })) + 1;
      return this.prisma.aiTaskOutput.create({
        data: {
          aiTaskId: id,
          kind: outputKind,
          title: text(body.title) || task.title,
          mimeType: text(body.mimeType) || "application/json",
          opsTaskId: requestedOpsTaskId,
          reviewStatus: "PENDING",
          metadata: json({
            ...object(body.metadata),
            version,
            isFinal: ["ARTICLE", "ARTICLE_OUTPUT"].includes(outputKind),
            previewKind: ["ARTICLE", "ARTICLE_OUTPUT"].includes(outputKind) ? "ARTICLE" : "DOCUMENT",
          }),
        },
      });
    }
    if (!this.oss.isConfigured()) throw new BadRequestException(this.oss.configurationMessage());
    const extension = extname(file.originalname) || this.extensionForMime(file.mimetype);
    const sha256 = hash(file.buffer);
    const stored = await this.oss.uploadBuffer({
      buffer: file.buffer,
      originalName: file.originalname,
      sha256,
      extension,
      actor: `Codex:${node.nodeCode}`,
      sourceType: "AI_TASK",
      category: "derived",
    });
    const kind = (
      file.mimetype.startsWith("video/") ? "VIDEO"
      : file.mimetype.startsWith("image/") ? "IMAGE"
      : file.mimetype.startsWith("audio/") ? "AUDIO"
      : "DOCUMENT"
    ) as "VIDEO" | "IMAGE" | "AUDIO" | "DOCUMENT";
    const metadata = object(body.metadata);
    const width = number(metadata.width);
    const height = number(metadata.height);
    const durationSeconds = number(metadata.durationSeconds);
    const sourceKey = `AI_TASK:${id}:${sha256}`;
    const existingAsset = await this.prisma.asset.findUnique({ where: { sourceKey } });
    const assetData = {
      sourcePath: `oss://${stored.objectKey}`,
      fileName: file.originalname,
      originalFileName: file.originalname,
      extension,
      mediaType: file.mimetype,
      kind,
      displayName: text(body.title) || task.title,
      sha256,
      sizeBytes: file.size,
      modifiedAt: new Date(),
      ...(width && width > 0 ? { width: Math.round(width) } : {}),
      ...(height && height > 0 ? { height: Math.round(height) } : {}),
      ...(durationSeconds && durationSeconds > 0 ? { durationSeconds } : {}),
      ...(width && height ? { aspectRatio: `${Math.round(width)}:${Math.round(height)}` } : {}),
      storageProvider: "ALIYUN_OSS",
      objectKey: stored.objectKey,
      objectVersionId: stored.objectVersionId,
      etag: stored.etag,
      storageUrl: stored.storageUrl,
      storageSyncedAt: stored.uploadedAt,
      sourceSnapshot: json({
        ...object(existingAsset?.sourceSnapshot),
        aiTaskId: id,
        nodeCode: node.nodeCode,
        metadata,
      }),
    };
    let asset;
    try {
      asset = existingAsset
      ? await this.prisma.asset.update({
        where: { id: existingAsset.id },
        data: assetData,
      })
      : await this.prisma.asset.create({
        data: {
          sourceKey,
          sourceType: "AI_GENERATED",
          ...assetData,
          // AI outputs have no source evidence records at creation time. The field is
          // still required by the Asset model, and leaving it out makes a successful
          // OSS upload fail while registering the result for review.
          evidenceIds: [],
          assetNo: `AST-AI-${dateKey().replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`,
          level: "AI_GENERATED",
          productScope: task.productId || task.productModel ? "MODEL" : "UNKNOWN",
          processingStatus: "READY_FOR_REVIEW",
          reviewStatus: "PENDING",
          availabilityStatus: "INACTIVE",
          rightsStatus: "AUTH_REQUIRED",
          status: "PENDING",
          qualityScore: 0,
          discoveredBy: `Codex AI任务 ${task.taskNo}`,
          ...(task.productId ? { products: { create: { productId: task.productId, scope: "MODEL", confidence: 1, confirmed: true } } } : {}),
        },
      });
    } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "UNKNOWN";
      throw new BadRequestException(`AI成片素材登记失败（${code}）。成片已保留，可直接重试，无需重新剪辑。`);
    }
    const outputKind = text(body.kind) || `${kind}_OUTPUT`;
    const existingOutput = await this.prisma.aiTaskOutput.findFirst({
      where: { aiTaskId: id, kind: outputKind, assetId: asset.id },
      orderBy: { createdAt: "desc" },
    });
    const version = existingOutput
      ? number(object(existingOutput.metadata).version) || 1
      : (await this.prisma.aiTaskOutput.count({ where: { aiTaskId: id, kind: outputKind } })) + 1;
    const isFinal = outputKind === "VIDEO_MASTER"
      || ["IMAGE", "IMAGE_OUTPUT", "IMAGE_MASTER", "ARTICLE", "ARTICLE_OUTPUT"].includes(outputKind);
    const outputData = {
      title: text(body.title) || task.title,
      mimeType: file.mimetype,
      url: stored.storageUrl,
      assetId: asset.id,
      opsTaskId: requestedOpsTaskId,
      metadata: json({
        ...metadata,
        version,
        isFinal,
        previewKind: kind,
        width: width || undefined,
        height: height || undefined,
        durationSeconds: durationSeconds || undefined,
        sizeBytes: file.size,
      }),
    };
    try {
      return existingOutput
        ? this.prisma.aiTaskOutput.update({
          where: { id: existingOutput.id },
          data: outputData,
        })
        : this.prisma.aiTaskOutput.create({
          data: {
            aiTaskId: id,
            kind: outputKind,
            reviewStatus: "PENDING",
            ...outputData,
          },
        });
    } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "UNKNOWN";
      throw new BadRequestException(`AI成片输出登记失败（${code}）。成片已保留，可直接重试，无需重新剪辑。`);
    }
  }

  async runnerOutputMetadata(token: string, taskNo: string, body: JsonRecord) {
    const node = await this.runner(token, text(body.nodeCode));
    const task = await this.prisma.aiTask.findUnique({ where: { taskNo } });
    if (!task) throw new NotFoundException("AI任务不存在");
    const kind = text(body.kind) || "VIDEO_MASTER";
    const output = await this.prisma.aiTaskOutput.findFirst({
      where: { aiTaskId: task.id, kind },
      orderBy: { createdAt: "desc" },
      include: { asset: true },
    });
    if (!output) throw new NotFoundException("AI任务成片不存在");
    if (!output.assetId || !output.asset) throw new NotFoundException("AI任务成片素材不存在");
    const metadata: JsonRecord = {
      ...object(output.metadata),
      ...object(body.metadata),
      repairedBy: `Codex:${node.nodeCode}`,
      repairedAt: new Date().toISOString(),
    };
    const width = number(metadata.width);
    const height = number(metadata.height);
    const durationSeconds = number(metadata.durationSeconds);
    const [updatedOutput, updatedAsset] = await this.prisma.$transaction([
      this.prisma.aiTaskOutput.update({
        where: { id: output.id },
        data: { metadata: json(metadata) },
      }),
      this.prisma.asset.update({
        where: { id: output.assetId },
        data: {
          ...(width && width > 0 ? { width: Math.round(width) } : {}),
          ...(height && height > 0 ? { height: Math.round(height) } : {}),
          ...(durationSeconds && durationSeconds > 0 ? { durationSeconds } : {}),
          ...(width && height ? { aspectRatio: `${Math.round(width)}:${Math.round(height)}` } : {}),
          sourceSnapshot: json({
            ...object(output.asset?.sourceSnapshot),
            metadata,
          }),
        },
      }),
    ]);
    return {
      ok: true,
      taskNo,
      outputId: updatedOutput.id,
      assetId: updatedAsset.id,
      metadata,
    };
  }

  async runnerComplete(token: string, id: string, body: JsonRecord) {
    const node = await this.runner(token, text(body.nodeCode));
    const task = await this.ensureRunnerTask(node.nodeCode, id);
    const staleReason = await this.videoProjectTaskStaleReason(task);
    if (staleReason) {
      await this.prisma.$transaction([
        this.prisma.aiTask.update({
          where: { id },
          data: {
            status: "CANCELLED",
            failureReason: staleReason,
            progressMessage: `结果未写入项目：${staleReason}`,
            finishedAt: new Date(),
            lockedBy: null,
            lockedAt: null,
            heartbeatAt: null,
          },
        }),
        this.prisma.aiTaskAttempt.updateMany({
          where: { aiTaskId: id, workerNodeId: node.id, status: "RUNNING" },
          data: { status: "CANCELLED", finishedAt: new Date() },
        }),
        this.prisma.aiWorkerNode.update({
          where: { id: node.id },
          data: {
            status: "ONLINE",
            currentTaskId: null,
            currentSkill: null,
            lastHeartbeatAt: new Date(),
            lastError: staleReason,
          },
        }),
      ]);
      await this.syncSourceOpsTask(task, "CANCELLED", `结果未写入项目：${staleReason}`);
      return { ok: false, status: "CANCELLED", message: staleReason };
    }
    const activeAttempt = await this.prisma.aiTaskAttempt.findFirst({
      where: { aiTaskId: id, workerNodeId: node.id, status: "RUNNING" },
      orderBy: { attemptNo: "desc" },
    });
    const result = object(body.result);
    const domain = await this.finalizeDomain(task, result, `Codex:${node.nodeCode}`);
    const status = domain.status;
    const progress = status === "RUNNING"
      ? 65
      : status === "WAITING_INPUT"
        ? Math.min(Math.max(task.progress || 60, 60), 90)
        : 100;
    await this.prisma.$transaction([
      this.prisma.aiTask.update({
        where: { id },
        data: {
          status,
          output: json(result),
          progress,
          progressMessage: domain.message,
          actualCost: number(body.actualCost) || task.actualCost,
          finishedAt: ["PENDING_REVIEW", "COMPLETED"].includes(status) ? new Date() : null,
          heartbeatAt: null,
          lockedAt: null,
          lockedBy: null,
        },
      }),
      this.prisma.aiTaskAttempt.updateMany({
        where: { aiTaskId: id, workerNodeId: node.id, status: "RUNNING" },
        data: {
          status: "SUCCEEDED",
          exitCode: number(body.exitCode) ?? 0,
          usage: json(body.usage),
          logs: json({ ...object(activeAttempt?.logs), ...object(body.logs) }),
          finishedAt: new Date(),
        },
      }),
      this.prisma.aiWorkerNode.update({
        where: { id: node.id },
        data: {
          status: "ONLINE",
          currentTaskId: null,
          currentSkill: null,
          lastHeartbeatAt: new Date(),
          lastError: null,
        },
      }),
    ]);
    const requestedOpsTaskId = text(object(task.input).opsTaskId);
    if (requestedOpsTaskId) {
      await this.prisma.$transaction([
        this.prisma.aiTaskOutput.updateMany({
          where: { aiTaskId: id, kind: { not: "OPS_TASK" } },
          data: { opsTaskId: requestedOpsTaskId },
        }),
        this.prisma.opsTask.update({
          where: { id: requestedOpsTaskId },
          data: {
            result: domain.message,
            evidence: json({
              ...object((await this.prisma.opsTask.findUnique({ where: { id: requestedOpsTaskId }, select: { evidence: true } }))?.evidence),
              aiTaskId: id,
              aiTaskNo: task.taskNo,
              aiStatus: status,
            }),
          },
        }),
      ]);
    }
    let linkedOpsTaskId = await this.syncSourceOpsTask(task, status, domain.message);
    linkedOpsTaskId ||= requestedOpsTaskId || undefined;
    if (!linkedOpsTaskId && status === "WAITING_INPUT") {
      linkedOpsTaskId = (await this.prisma.aiTaskOutput.findFirst({
        where: { aiTaskId: id, opsTaskId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { opsTaskId: true },
      }))?.opsTaskId || undefined;
    }
    if (status === "PENDING_REVIEW" && task.reviewerEmployeeId) {
      await this.notify(id, task.reviewerEmployeeId, "AI_TASK_REVIEW", "AI结果等待审核", task.title, linkedOpsTaskId);
    } else if (status === "WAITING_INPUT" && task.ownerEmployeeId) {
      await this.notify(id, task.ownerEmployeeId, "AI_TASK_WAITING_INPUT", "AI任务需要补充资料", domain.message, linkedOpsTaskId);
    }
    return this.task(id);
  }

  /** Replays a completed cover-title payload that was left in WAITING_INPUT by an older runner payload. */
  async reconcileCoverTitleTask(id: string) {
    const task = await this.prisma.aiTask.findUnique({ where: { id } });
    if (!task || text(object(task.input).executionMode) !== "COVER_TITLE") return this.task(id);
    if (task.status !== "WAITING_INPUT") return this.task(id);
    const result = object(task.output);
    if (!Object.keys(result).length) return this.task(id);

    const domain = await this.finalizeDomain(task, result, "system-cover-title-reconcile");
    const status = domain.status;
    const progress = status === "WAITING_INPUT"
      ? Math.min(Math.max(task.progress || 60, 60), 90)
      : 100;
    await this.prisma.aiTask.update({
      where: { id },
      data: {
        status,
        progress,
        progressMessage: domain.message,
        finishedAt: ["PENDING_REVIEW", "COMPLETED"].includes(status) ? new Date() : null,
      },
    });
    await this.syncSourceOpsTask(task, status, domain.message);
    if (status === "PENDING_REVIEW" && task.reviewerEmployeeId) {
      await this.notify(id, task.reviewerEmployeeId, "AI_TASK_REVIEW", "AI结果等待审核", task.title);
    }
    return this.task(id);
  }

  async runnerFail(token: string, id: string, body: JsonRecord) {
    const node = await this.runner(token, text(body.nodeCode));
    const task = await this.ensureRunnerTask(node.nodeCode, id);
    const activeAttempt = await this.prisma.aiTaskAttempt.findFirst({
      where: { aiTaskId: id, workerNodeId: node.id, status: "RUNNING" },
      orderBy: { attemptNo: "desc" },
    });
    const nextRetry = task.retryCount + 1;
    const terminal = nextRetry >= task.maxRetries;
    const message = text(body.error || body.message) || "Codex执行失败";
    await this.prisma.$transaction([
      this.prisma.aiTask.update({
        where: { id },
        data: {
          status: terminal ? "FAILED" : "RETRY",
          retryCount: nextRetry,
          failureReason: message,
          progressMessage: terminal ? "任务执行失败" : "等待自动重试",
          lockedAt: null,
          lockedBy: null,
          heartbeatAt: null,
          finishedAt: terminal ? new Date() : null,
        },
      }),
      this.prisma.aiTaskAttempt.updateMany({
        where: { aiTaskId: id, workerNodeId: node.id, status: "RUNNING" },
        data: {
          status: "FAILED",
          failureReason: message,
          exitCode: number(body.exitCode),
          logs: json({ ...object(activeAttempt?.logs), ...object(body.logs) }),
          finishedAt: new Date(),
        },
      }),
      this.prisma.aiWorkerNode.update({
        where: { id: node.id },
        data: {
          status: "ERROR",
          currentTaskId: null,
          currentSkill: null,
          lastHeartbeatAt: new Date(),
          lastError: message,
        },
      }),
    ]);
    const contentPlanId = text(object(task.input).existingContentPlanId);
    if (contentPlanId && terminal) await this.videoFactory.syncProjectTaskState(contentPlanId, "FAILED");
    const employeeMessage = terminal ? "AI执行未完成，请在任务详情中查看处理建议。" : "AI执行暂未完成，系统正在自动重试。";
    const linkedOpsTaskId = await this.syncSourceOpsTask(task, terminal ? "FAILED" : "RETRY", employeeMessage);
    if (terminal && task.ownerEmployeeId) {
      await this.notify(id, task.ownerEmployeeId, "AI_TASK_FAILED", "AI任务执行未完成", employeeMessage, linkedOpsTaskId);
    }
    return this.task(id);
  }

  async outputUrl(id: string) {
    const output = await this.prisma.aiTaskOutput.findUnique({ where: { id }, include: { asset: true } });
    if (!output) throw new NotFoundException("任务输出不存在");
    if (output.asset?.objectKey) return { url: this.oss.signedDownloadUrl(output.asset.objectKey) };
    if (output.url) return { url: output.url };
    throw new NotFoundException("任务输出没有可下载文件");
  }

  async createDailyTopicCardTasks(
    now = new Date(),
    actor = "系统自动化",
    platforms: Array<"DOUYIN" | "TIKTOK"> = ["DOUYIN", "TIKTOK"],
    factoryModule = "",
  ) {
    const key = dateKey(now);
    const policy = await this.policy("VIDEO");
    const config = object(policy.config);
    const counts = object(config.dailyTopicCards);
    const policyVersion = text(config.topicCardPolicyVersion) || DEFAULT_VIDEO_POLICY_CONFIG.topicCardPolicyVersion;
    const results: Record<string, unknown> = {};
    for (const platform of platforms) {
      const resolvedFactoryModule = factoryModule === "DOUYIN_VIRAL" || (!factoryModule && platform === "DOUYIN")
        ? "DOUYIN_VIRAL"
        : "GENERAL_VIDEO_FACTORY";
      const cardCount = Math.max(1, Math.min(30, Math.round(number(counts[platform]) || DEFAULT_VIDEO_POLICY_CONFIG.dailyTopicCards[platform])));
      const task = await this.createTask({
        type: "VIDEO",
        title: `${platform === "DOUYIN" ? "抖音" : "TikTok"}视频选题卡 ${key}`,
        platform,
        sourceType: "DAILY_VIDEO_TOPIC_CARDS",
        sourceId: `${key}:${platform}`,
        idempotencyKey: `ai-task:topic-card:${resolvedFactoryModule === "DOUYIN_VIRAL" ? "douyin-viral:" : ""}${platform}:${key}:${policyVersion}`,
        estimatedCost: 0,
        skipPaidBudget: true,
        input: {
          executionMode: "TOPIC_CARD_BATCH",
          factoryModule: resolvedFactoryModule,
          cardCount,
          policyVersion,
          manualApprovalRequired: true,
        },
        modelPolicy: {
          strategy: "CODEX_FIRST",
          allowExternalGeneration: false,
          allowFallback: false,
        },
      }, actor);
      results[platform] = { id: task.id, status: task.status, cardCount, duplicate: task.duplicate };
    }
    return results;
  }

  async createDailyContentTasks(now = new Date(), actor = "系统自动化") {
    const key = dateKey(now);
    const keyword = await this.prisma.smartKeyword.findFirst({
      where: { status: "ACTIVE", contentEnabled: true, grade: { in: ["S", "A"] } },
      include: { product: true },
      orderBy: [{ pinned: "desc" }, { opportunityScore: "desc" }],
    });
    const common = {
      sourceType: "DAILY_AI_PLAN",
      sourceId: key,
      bucket: key,
      productId: keyword?.productId,
      productModel: keyword?.product?.modelCode,
      platform: keyword?.platform || "DOUYIN",
      input: keyword ? { keywordId: keyword.id, keyword: keyword.keyword } : {},
    };
    const article = await this.createTask({
      ...common,
      type: "ARTICLE",
      title: `每日智能软文 ${key}`,
      idempotencyKey: `ai-task:daily:article:${key}`,
    }, actor);
    return { article: { id: article.id, status: article.status } };
  }

  async createDailyAnalysisTasks(now = new Date(), actor = "系统自动化") {
    const key = dateKey(now);
    const store = await this.createTask({
      type: "STORE_ANALYSIS",
      title: `店铺经营分析 ${key}`,
      sourceType: "DAILY_OPERATION_ANALYSIS",
      sourceId: key,
      idempotencyKey: `ai-task:daily:store:${key}`,
    }, actor);
    const competitor = await this.createTask({
      type: "COMPETITOR_ANALYSIS",
      title: `竞品变化分析 ${key}`,
      sourceType: "DAILY_COMPETITOR_ANALYSIS",
      sourceId: key,
      idempotencyKey: `ai-task:daily:competitor:${key}`,
    }, actor);
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lives = await this.prisma.liveSession.findMany({
      where: { endedAt: { gte: from, lte: now } },
      orderBy: { endedAt: "desc" },
      take: 20,
    });
    const liveTasks = [];
    for (const live of lives) {
      liveTasks.push(await this.createTask({
        type: "LIVE_ANALYSIS",
        title: `直播复盘：${live.title || live.remoteRoomId}`,
        sourceType: "LIVE_SESSION",
        sourceId: live.id,
        idempotencyKey: `ai-task:live:${live.id}`,
      }, actor));
    }
    return {
      store: { id: store.id, status: store.status },
      competitor: { id: competitor.id, status: competitor.status },
      live: liveTasks.map((item) => ({ id: item.id, status: item.status })),
    };
  }

  @Interval(15_000)
  async reconcileVideoTasks() {
    const tasks = await this.prisma.aiTask.findMany({
      where: { type: "VIDEO", status: { in: ["RUNNING", "QUALITY_CHECK"] } },
      include: { outputs: true },
      take: 20,
    });
    for (const task of tasks) {
      const projectId = task.outputs.find((item) => item.contentPlanId)?.contentPlanId;
      if (!projectId) continue;
      const project = await this.prisma.contentPlan.findUnique({
        where: { id: projectId },
        include: {
          videoGenerationJobs: true,
          videoRenderJobs: true,
        },
      });
      if (!project) continue;
      const linkedOpsTaskId = await this.sourceOpsTaskId(task);
      const failed = [...project.videoGenerationJobs, ...project.videoRenderJobs].find((item) => item.status === "FAILED");
      if (failed) {
        await this.prisma.aiTask.update({ where: { id: task.id }, data: { status: "FAILED", failureReason: failed.failureReason || "视频子任务失败", finishedAt: new Date() } });
        continue;
      }
      const generatedAssetIds = project.videoGenerationJobs.map((item) => item.outputAssetId).filter(Boolean) as string[];
      for (const assetId of generatedAssetIds) {
        if (!task.outputs.some((item) => item.assetId === assetId)) {
          const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
          await this.prisma.aiTaskOutput.create({
            data: { aiTaskId: task.id, kind: "VIDEO_SHOT", title: asset?.displayName || "AI补拍镜头", mimeType: "video/mp4", assetId, url: asset?.storageUrl, reviewStatus: "PENDING", contentPlanId: projectId },
          });
        }
      }
      if (generatedAssetIds.length) {
        const pending = await this.prisma.asset.count({ where: { id: { in: generatedAssetIds }, reviewStatus: { not: "APPROVED" } } });
        if (pending) {
          await this.prisma.aiTask.update({ where: { id: task.id }, data: { status: "PENDING_REVIEW", progress: 70, progressMessage: `${pending}个AI镜头等待审核` } });
          if (task.reviewerEmployeeId) await this.notify(task.id, task.reviewerEmployeeId, "AI_VIDEO_SHOT_REVIEW", "AI补拍镜头等待审核", task.title, linkedOpsTaskId);
          continue;
        }
      }
      const render = project.videoRenderJobs.find((item) => item.status === "SUCCEEDED" && item.outputAssetId);
      if (render?.outputAssetId && !task.outputs.some((item) => item.assetId === render.outputAssetId)) {
        const asset = await this.prisma.asset.findUnique({ where: { id: render.outputAssetId } });
        await this.prisma.aiTaskOutput.create({
          data: { aiTaskId: task.id, kind: "VIDEO_MASTER", title: asset?.displayName || "智能视频主成片", mimeType: "video/mp4", assetId: render.outputAssetId, url: asset?.storageUrl, reviewStatus: "PENDING", contentPlanId: projectId },
        });
        await this.prisma.aiTask.update({ where: { id: task.id }, data: { status: "PENDING_REVIEW", progress: 95, progressMessage: "主成片已上传，等待审核" } });
        if (task.reviewerEmployeeId) await this.notify(task.id, task.reviewerEmployeeId, "AI_VIDEO_REVIEW", "智能视频主成片等待审核", task.title, linkedOpsTaskId);
      }
    }
  }

  private async finalizeDomain(task: Awaited<ReturnType<AiTaskCenterService["ensureRunnerTask"]>>, result: JsonRecord, actor: string) {
    if (task.type === "VIDEO") {
      const projectInput = object(result.project);
      const taskInput = object(task.input);
      const executionMode = enumValue(
        taskInput.executionMode,
        ["TOPIC_CARD_BATCH", "SCRIPT_ONLY", "FULL_VIDEO", "SIMILAR_VIDEO", "NO_VOICE_VIDEO", "COVER_TITLE"] as const,
        "FULL_VIDEO",
      );
      if (executionMode === "TOPIC_CARD_BATCH") {
        const persisted = await this.videoFactory.persistTopicCards({
          aiTaskId: task.id,
          platform: text(taskInput.platform || task.platform) || "DOUYIN",
          cards: Array.isArray(result.topicCards) ? result.topicCards : [],
          policyVersion: text(taskInput.policyVersion) || DEFAULT_VIDEO_POLICY_CONFIG.topicCardPolicyVersion,
          factoryModule: text(taskInput.factoryModule).toUpperCase(),
        }, actor);
        for (const raw of persisted.created) {
          const card = object(raw);
          const existingOutput = await this.prisma.aiTaskOutput.findFirst({
            where: { aiTaskId: task.id, kind: "VIDEO_TOPIC_CARD", contentPlanId: text(card.id) },
          });
          if (!existingOutput && text(card.id)) {
            await this.prisma.aiTaskOutput.create({
              data: {
                aiTaskId: task.id,
                kind: "VIDEO_TOPIC_CARD",
                title: text(card.topic) || "视频选题卡",
                contentPlanId: text(card.id),
                reviewStatus: "PENDING",
                metadata: json({
                  cardNo: text(card.productionNo),
                  score: number(card.score) || 0,
                  manualApprovalRequired: true,
                }),
              },
            });
          }
        }
        if (!persisted.created.length && !persisted.skipped.length) {
          return { status: "WAITING_INPUT" as AiTaskStatus, message: "Codex未返回可保存的视频选题卡" };
        }
        return {
          status: "COMPLETED" as AiTaskStatus,
          message: `已生成${persisted.created.length}张选题卡，${persisted.skipped.length}张重复或无效卡片已跳过，等待管理员确认`,
        };
      }
      if (executionMode === "COVER_TITLE") {
        const contentPlanId = text(taskInput.existingContentPlanId);
        const packagingSource = Array.isArray(result.packaging)
          ? result.packaging
          : Array.isArray(result.platformPackaging)
            ? result.platformPackaging
            : Array.isArray(result.platformTitles)
              ? result.platformTitles
              : [];
        const packaging = packagingSource.map(object);
        if (!contentPlanId || !packaging.length) {
          return {
            status: "WAITING_INPUT" as AiTaskStatus,
            message: "封面标题任务已回传，但缺少按平台组织的标题与封面文案结果，未写入项目。请检查 AI 任务返回的 packaging 字段后重新提交。",
          };
        }
        const plan = await this.prisma.contentPlan.findUnique({
          where: { id: contentPlanId },
          include: { variants: true },
        });
        if (!plan) return { status: "WAITING_INPUT" as AiTaskStatus, message: "智能视频项目不存在" };
        const outputs = await this.prisma.aiTaskOutput.findMany({
          where: { aiTaskId: task.id, assetId: { not: null }, mimeType: { startsWith: "image/" } },
          orderBy: { createdAt: "desc" },
          include: { asset: { select: { storageUrl: true } } },
        });
        const updates = [];
        const availableVariants = [...plan.variants];
        const usedOutputIds = new Set<string>();
        const skipped: string[] = [];
        for (const [index, item] of packaging.entries()) {
          const platform = packagingPlatform(item.platform || item.channel || item.targetPlatform);
          let variant = availableVariants.find((candidate) => candidate.platform === platform)
            || (availableVariants.length === 1 ? availableVariants[0] : undefined);
          // Draft video projects deliberately do not carry placeholder platform
          // variants.  Create the destination record only when the returned
          // platform is one of the project's declared target platforms.
          if (!variant && platform && plan.targetPlatforms.includes(platform as IntegrationKind)) {
            variant = await this.prisma.contentVariant.upsert({
              where: { contentPlanId_platform: { contentPlanId, platform: platform as IntegrationKind } },
              create: {
                contentPlanId,
                platform: platform as IntegrationKind,
                title: "待审核标题",
                body: "",
                mediaType: "VIDEO",
                metadata: {},
              },
              update: {},
            });
            availableVariants.push(variant);
          }
          const coverOutput = outputs.find((candidate) => !usedOutputIds.has(candidate.id)
            && coverOutputPlatform(candidate.metadata) === String(variant?.platform || platform))
            || (outputs.length === 1 && !usedOutputIds.has(outputs[0].id) ? outputs[0] : undefined)
            || (outputs.length === packaging.length && !usedOutputIds.has(outputs[index]?.id)
              ? outputs[index]
              : undefined);
          const title = text(item.title || item.titleZh || item.platformTitle);
          const body = text(item.body || item.copy || item.description || item.publishCopy);
          const coverText = text(item.coverText || item.cover_text || item.coverTextZh || item.cover_title || object(item.cover).text);
          const coverUrl = coverOutput?.url || coverOutput?.asset?.storageUrl || "";
          if (!variant || !coverOutput?.assetId || !coverUrl || !title || !coverText) {
            skipped.push(platform || `第${index + 1}项`);
            continue;
          }
          usedOutputIds.add(coverOutput.id);
          updates.push(this.prisma.contentVariant.update({
            where: { id: variant.id },
            data: {
              title,
              body,
              coverPath: coverUrl,
              coverSpec: json({
                coverText,
                hashtags: strings(item.hashtags),
                contentFingerprint: text(item.contentFingerprint),
                compliance: object(item.compliance),
                coverAssetId: coverOutput.assetId,
                aiTaskId: task.id,
              }),
              packagingStatus: "PENDING_REVIEW",
              packagedAt: new Date(),
              packagingRejectedReason: null,
              metadata: json({
                ...object(variant.metadata),
                coverAssetId: coverOutput.assetId,
                coverAiTaskId: task.id,
              }),
            },
          }));
          updates.push(this.prisma.aiTaskOutput.update({
            where: { id: coverOutput.id },
            data: {
              contentPlanId,
              reviewStatus: "PENDING",
              metadata: json({
                ...object(coverOutput.metadata),
                platform: String(variant.platform),
              }),
            },
          }));
        }
        if (!updates.length) {
          const detail = [
            packaging.length ? `收到${packaging.length}条平台结果` : "未收到平台结果",
            outputs.length ? `已登记${outputs.length}张封面文件` : "未登记封面文件",
            skipped.length ? `未能匹配：${skipped.join("、")}` : "",
          ].filter(Boolean).join("；");
          return { status: "WAITING_INPUT" as AiTaskStatus, message: `封面标题结果未能写入项目。${detail}` };
        }
        updates.push(this.prisma.contentPlan.update({
          where: { id: contentPlanId },
          data: { productionStage: "PACKAGING_REVIEW" },
        }));
        await this.prisma.$transaction(updates);
        return {
          status: "PENDING_REVIEW" as AiTaskStatus,
          message: skipped.length
            ? `已写入${Math.floor((updates.length - 1) / 2)}个平台封面标题；其余${skipped.length}个平台需重新生成。`
            : "封面和标题已回传，等待用户审核",
        };
      }
      const existingContentPlanId = text(taskInput.existingContentPlanId);
      const directFullVideo = executionMode === "FULL_VIDEO"
        && (taskInput.codexDirectFullVideo === true || taskInput.referenceDirectFullVideo === true);
      if (directFullVideo) {
        if (!existingContentPlanId) {
          return { status: "WAITING_INPUT" as AiTaskStatus, message: "Codex 直出任务缺少关联视频项目" };
        }
        const masterOutput = await this.prisma.aiTaskOutput.findFirst({
          where: {
            aiTaskId: task.id,
            assetId: { not: null },
            OR: [{ kind: "VIDEO_MASTER" }, { mimeType: { startsWith: "video/" } }],
          },
          orderBy: { createdAt: "desc" },
        });
        if (!masterOutput?.assetId) {
          return { status: "RUNNING" as AiTaskStatus, message: "Codex 直出处理中，等待最终成片回传" };
        }
        const project = await this.prisma.contentPlan.findUnique({ where: { id: existingContentPlanId } });
        if (!project) return { status: "WAITING_INPUT" as AiTaskStatus, message: "关联视频项目不存在" };
        const renderJob = await this.videoFactory.registerLocalMaster(project.id, masterOutput.assetId, task.id, actor);
        const currentSignals = Array.isArray(project.sourceSignals)
          ? project.sourceSignals.map(object)
          : [];
        const nextSignals = currentSignals.map((signal) => signal.type === "VIDEO_FACTORY"
          ? {
            ...signal,
            // The revision has delivered a new master. Keep a small audit
            // trail but remove the active marker so all projections show the
            // video review instead of a stale “Codex 修改中” state.
            directVideoRevision: undefined,
            lastCompletedDirectVideoRevision: signal.directVideoRevision || undefined,
          }
          : signal);
        await this.prisma.$transaction([
          this.prisma.contentAsset.upsert({
            where: { contentPlanId_assetId_role: { contentPlanId: project.id, assetId: masterOutput.assetId, role: "VIDEO_FACTORY_MASTER" } },
            create: { contentPlanId: project.id, assetId: masterOutput.assetId, role: "VIDEO_FACTORY_MASTER" },
            update: {},
          }),
          this.prisma.contentPlan.update({
            where: { id: project.id },
            data: {
              masterVideoStatus: "READY_FOR_REVIEW",
              productionStage: "VIDEO_REVIEW",
              sourceSignals: json(nextSignals),
            },
          }),
          this.prisma.aiTaskOutput.update({
            where: { id: masterOutput.id },
            data: { kind: "VIDEO_MASTER", contentPlanId: project.id, reviewStatus: "PENDING" },
          }),
          this.prisma.videoQualityCheck.create({
            data: {
              contentPlanId: project.id,
              assetId: masterOutput.assetId,
              renderJobId: renderJob.id,
              checkType: "FINAL_REVIEW",
              status: "REVIEW_REQUIRED",
              score: 0,
              findings: json([{ message: "Codex 直出成片已回传，请审核最终成片" }]),
            },
          }),
        ]);
        await this.prisma.opsTask.updateMany({
          where: { sourceType: "AI_TASK", sourceId: task.id, category: "CONTENT_PRODUCTION", status: { not: "COMPLETED" } },
          data: { status: "COMPLETED", completedAt: new Date(), completedBy: actor, result: "Codex 直出成片已回传，等待最终审核" },
        });
        return { status: "PENDING_REVIEW" as AiTaskStatus, message: "Codex 直出成片已回传，等待最终审核" };
      }
      let scriptCandidates = normalizeVideoScriptCandidates(
        Array.isArray(projectInput.scriptCandidates) ? projectInput.scriptCandidates : result.scriptCandidates,
      );
      if (!scriptCandidates.length) {
        return { status: "WAITING_INPUT" as AiTaskStatus, message: "Codex未返回符合V3结构的脚本和分镜" };
      }
      const taskModelPolicy = object(task.modelPolicy);
      const requestedModelId = text(taskModelPolicy.requestedModelId) || undefined;
      const linkedProjectOutput = existingContentPlanId
        ? null
        : await this.prisma.aiTaskOutput.findFirst({
          where: { aiTaskId: task.id, kind: "VIDEO_PROJECT", contentPlanId: { not: null } },
          orderBy: { createdAt: "desc" },
        });
      const reusableContentPlanId = existingContentPlanId || linkedProjectOutput?.contentPlanId || "";
      const existingProject = reusableContentPlanId
        ? await this.prisma.contentPlan.findUnique({ where: { id: reusableContentPlanId } })
        : null;
      if (executionMode === "SCRIPT_ONLY") {
        const selectedScript = scriptCandidates.find((candidate) => candidate.selected) || scriptCandidates[0];
        scriptCandidates = [{ ...selectedScript, selected: true }];
      }
      if (executionMode !== "SCRIPT_ONLY" && linkedProjectOutput?.contentPlanId && existingProject) {
        const [generationJobCount, renderJobCount] = await Promise.all([
          this.prisma.videoGenerationJob.count({ where: { contentPlanId: existingProject.id } }),
          this.prisma.videoRenderJob.count({ where: { contentPlanId: existingProject.id } }),
        ]);
        if (generationJobCount > 0 || renderJobCount > 0) {
          return {
            status: "RUNNING" as AiTaskStatus,
            message: "已复用原视频项目，现有镜头生成与渲染任务继续执行",
          };
        }
      }
      const project = existingProject || await this.videoFactory.createCodexProject({
        platform: enumValue(projectInput.platform || task.platform, ["DOUYIN", "TIKTOK"] as const, "DOUYIN"),
        productModel: text(projectInput.productModel || task.productModel) || undefined,
        topic: text(projectInput.topic) || task.title,
        audience: text(projectInput.audience) || "目标用户",
        objective: text(projectInput.objective) || "内容测试",
        keywordIds: strings(projectInput.keywordIds),
        externalVideoIds: strings(projectInput.externalVideoIds),
        aiTaskId: task.id,
        factoryModule: text(taskInput.factoryModule).toUpperCase(),
        routingMode: requestedModelId ? "FIXED" : "AUTO",
        requestedModelId,
        allowFallback: taskModelPolicy.allowFallback !== false,
      }, actor);
      await this.videoFactory.applyCodexProjectResult({
        contentPlanId: project.id,
        aiTaskId: task.id,
        executionMode: executionMode === "SCRIPT_ONLY" ? "SCRIPT_ONLY" : "FULL_VIDEO",
        scriptCandidates,
        actor,
      });
      const existingProjectOutput = await this.prisma.aiTaskOutput.findFirst({
        where: { aiTaskId: task.id, kind: "VIDEO_PROJECT", contentPlanId: project.id },
      });
      if (!existingProjectOutput) {
        await this.prisma.aiTaskOutput.create({
          data: {
            aiTaskId: task.id,
            kind: "VIDEO_PROJECT",
            title: project.topic,
            contentPlanId: project.id,
            reviewStatus: executionMode === "SCRIPT_ONLY" ? "PENDING" : "APPROVED",
            metadata: json({
              productionNo: project.productionNo,
              executionMode,
              scriptCandidates: scriptCandidates.length,
              selectedCandidate: scriptCandidates.findIndex((item) => item.selected),
            }),
          },
        });
      }
      if (executionMode === "SCRIPT_ONLY") {
        const scriptMetadata = videoScriptOutputMetadata(scriptCandidates);
        const selectedScript = object(scriptMetadata.script);
        const existingScriptOutput = await this.prisma.aiTaskOutput.findFirst({
          where: { aiTaskId: task.id, kind: "VIDEO_SCRIPT", contentPlanId: project.id },
        });
        if (!existingScriptOutput) {
          await this.prisma.aiTaskOutput.create({
            data: {
              aiTaskId: task.id,
              kind: "VIDEO_SCRIPT",
              title: text(selectedScript.title) || `${project.topic} · 完整脚本`,
              contentPlanId: project.id,
              reviewStatus: "PENDING",
              metadata: json({
                ...scriptMetadata,
                executionMode,
                productModel: project.productModel,
                platform: task.platform,
              }),
            },
          });
        }
        return {
          status: "PENDING_REVIEW" as AiTaskStatus,
          message: "单套完整脚本、逐句素材绑定和缺口清单已进入视频工厂，等待审核",
        };
      }

      const masterOutput = await this.prisma.aiTaskOutput.findFirst({
        where: {
          aiTaskId: task.id,
          assetId: { not: null },
          OR: [{ kind: "VIDEO_MASTER" }, { mimeType: { startsWith: "video/" } }],
        },
        orderBy: { createdAt: "desc" },
      });
      if (masterOutput?.assetId) {
        const renderJob = await this.videoFactory.registerLocalMaster(project.id, masterOutput.assetId, task.id, actor);
        await this.prisma.$transaction([
          this.prisma.contentAsset.upsert({
            where: {
              contentPlanId_assetId_role: {
                contentPlanId: project.id,
                assetId: masterOutput.assetId,
                role: "VIDEO_FACTORY_MASTER",
              },
            },
            create: { contentPlanId: project.id, assetId: masterOutput.assetId, role: "VIDEO_FACTORY_MASTER" },
            update: {},
          }),
          this.prisma.contentPlan.update({
            where: { id: project.id },
            data: {
              masterVideoStatus: "READY_FOR_REVIEW",
              productionStage: "VIDEO_REVIEW",
            },
          }),
          this.prisma.aiTaskOutput.update({
            where: { id: masterOutput.id },
            data: { kind: "VIDEO_MASTER", contentPlanId: project.id, reviewStatus: "PENDING" },
          }),
          this.prisma.videoQualityCheck.create({
            data: {
              contentPlanId: project.id,
              assetId: masterOutput.assetId,
              renderJobId: renderJob.id,
              checkType: "FINAL_REVIEW",
              status: "REVIEW_REQUIRED",
              score: 0,
              findings: json([{ message: "Codex本地成片已上传，请核对产品外形、字幕、配音和CTA" }]),
            },
          }),
        ]);
        await this.prisma.opsTask.updateMany({
          where: {
            sourceType: "AI_TASK",
            sourceId: task.id,
            category: "CONTENT_PRODUCTION",
            status: { not: "COMPLETED" },
          },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            completedBy: actor,
            result: "Codex已完成并上传主成片，无需补拍",
          },
        });
        return { status: "PENDING_REVIEW" as AiTaskStatus, message: "Codex本地成片已上传，等待审核" };
      }

      const modelPolicy = taskModelPolicy;
      if (modelPolicy.allowExternalGeneration === true) {
        const requestedModelId = text(modelPolicy.requestedModelId) || undefined;
        await this.videoFactory.generateProject(project.id, {
          candidateIndex: Math.max(0, scriptCandidates.findIndex((item) => item.selected === true)),
          requestedModelId,
          routingMode: requestedModelId ? "FIXED" : "AUTO",
          allowFallback: modelPolicy.allowFallback !== false,
        }, actor);
        return { status: "RUNNING" as AiTaskStatus, message: "本地素材不足，已按任务许可进入外部视觉能力补齐" };
      }

      const existingReshoot = await this.prisma.opsTask.findFirst({
        where: { sourceType: "AI_TASK", sourceId: task.id, category: "CONTENT_PRODUCTION" },
      });
      const reshoot = existingReshoot || await this.prisma.opsTask.create({
        data: {
          taskNo: `TASK-AI-${dateKey().replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`,
          title: `补拍素材：${project.topic}`,
          description: text(result.summary) || "现有素材和本地AI能力未能形成合格成片，请按脚本与分镜补拍。",
          category: "CONTENT_PRODUCTION",
          priority: "HIGH",
          status: "OPEN",
          assigneeEmployeeId: task.ownerEmployeeId,
          assignedBy: actor,
          sourceType: "AI_TASK",
          sourceId: task.id,
          platform: task.platform,
          productId: task.productId,
          evidence: json({
            aiTaskId: task.id,
            contentPlanId: project.id,
            scriptCandidates,
            missingAssets: scriptCandidates.find((item) => item.selected)?.missingAssets || [],
          }),
          expectedResult: "上传符合分镜要求、产品外形真实且可商用的视频素材",
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      await this.prisma.aiTaskOutput.create({
        data: {
          aiTaskId: task.id,
          kind: "RESHOOT_REQUIRED",
          title: reshoot.title,
          contentPlanId: project.id,
          opsTaskId: reshoot.id,
          reviewStatus: "PENDING",
          metadata: json({ reason: "LOCAL_ASSET_AND_TOOL_EXHAUSTED" }),
        },
      });
      return { status: "WAITING_INPUT" as AiTaskStatus, message: "本地素材与AI工具无法形成合格成片，已创建补拍任务" };
    }
    if (task.type === "ARTICLE") {
      const article = object(result.article);
      if (!text(article.title || article.topic)) return { status: "WAITING_INPUT" as AiTaskStatus, message: "Codex未返回可用软文内容" };
      const variants = object(article.variants);
      const requestedPlatforms = Object.keys(variants).filter((item) => platformKinds.includes(item as IntegrationKind)) as IntegrationKind[];
      const platforms = requestedPlatforms.length ? requestedPlatforms : ["WECHAT_OFFICIAL", "XIAOHONGSHU", "WECOM"] as IntegrationKind[];
      const plan = await this.prisma.contentPlan.create({
        data: {
          planDate: new Date(),
          kind: "ARTICLE",
          topic: text(article.topic) || text(article.title),
          productModel: task.productModel,
          audience: text(article.audience) || "目标用户",
          objective: text(article.objective) || "品牌内容",
          score: Math.max(0, Math.min(100, Number(article.score || 80))),
          scoreBreakdown: json(article.scoreBreakdown),
          hook: text(article.hook) || text(article.title),
          outline: json(article.outline),
          sourceSignals: json([{ type: "AI_TASK", id: task.id }]),
          evidenceIds: strings(article.evidenceIds),
          riskReasons: strings(article.riskReasons),
          status: "PENDING_APPROVAL",
          createdBy: actor,
          actorType: "AI",
          aiProvider: "CODEX",
          promptVersion: "ai-task-article-v1",
          targetPlatforms: platforms,
          variants: {
            create: platforms.map((platform) => ({
              platform,
              title: text(article.title),
              body: text(variants[platform]) || text(article.body),
              mediaType: platform === "WECOM" ? "text/plain" : "text/markdown",
              metadata: json({ summary: text(result.summary), keywords: strings(article.keywords), cta: text(article.cta) }),
              status: "DRAFT",
            })),
          },
        },
      });
      await this.prisma.aiTaskOutput.create({
        data: { aiTaskId: task.id, kind: "ARTICLE_PLAN", title: plan.topic, contentPlanId: plan.id, reviewStatus: "PENDING", metadata: json({ platforms }) },
      });
      return { status: "PENDING_REVIEW" as AiTaskStatus, message: "软文已进入线上内容审核" };
    }
    if (task.type === "IMAGE") {
      const input = object(task.input);
      if ((text(task.sourceType) === "IMAGE_PROJECT" || text(input.sourceType) === "IMAGE_PROJECT" || Boolean(input.imageProjectId))
        && text(input.executionMode).toUpperCase() === "IMAGE_POST") {
        const contentPlanId = text(task.sourceId || input.imageProjectId);
        const plan = contentPlanId
          ? await this.prisma.contentPlan.findUnique({ where: { id: contentPlanId }, include: { variants: true } })
          : null;
        if (!plan) return { status: "WAITING_INPUT" as AiTaskStatus, message: "图文项目不存在，无法写入图文制作结果" };

        const imagePost = object(result.imagePost || result.imageProject || result);
        const uploadedImages = await this.prisma.aiTaskOutput.findMany({
          where: {
            aiTaskId: task.id,
            assetId: { not: null },
            mimeType: { startsWith: "image/" },
          },
          orderBy: { createdAt: "asc" },
          include: { asset: { select: { storageUrl: true } } },
        });
        const outputFileName = (value: string) => value.replace(/\\/g, "/").split("/").pop() || value;
        const outputForPage = (page: JsonRecord, index: number) => {
          const requestedPath = text(page.outputFile || page.file || page.filePath || page.path);
          const requestedName = outputFileName(requestedPath);
          return uploadedImages.find((output) => {
            const metadata = object(output.metadata);
            const savedPath = text(metadata.workspaceOutputPath || metadata.outputFile || metadata.filePath || metadata.path);
            return Boolean(requestedPath) && (
              savedPath === requestedPath
              || outputFileName(savedPath) === requestedName
              || outputFileName(output.title) === requestedName
            );
          }) || (uploadedImages.length === 1 ? uploadedImages[0] : uploadedImages[index]);
        };
        const pages = Array.isArray(imagePost.pages)
          ? imagePost.pages.map(object).filter((item) => text(item.title || item.pageTitle || item.text)).map((page, index) => {
            const output = outputForPage(page, index);
            return {
              ...page,
              imageUrl: text(output?.url || output?.asset?.storageUrl),
              imageAssetId: text(output?.assetId),
              outputFile: text(page.outputFile || page.file || page.filePath || object(output?.metadata).workspaceOutputPath),
            };
          })
          : [];
        const title = text(imagePost.title || imagePost.postTitle || imagePost.topic) || plan.topic;
        const publishCopy = text(imagePost.publishCopy || imagePost.body || imagePost.copy || imagePost.caption);
        const tags = strings(imagePost.tags || imagePost.hashtags || imagePost.labels);
        if (!pages.length && !publishCopy && !title) {
          return { status: "WAITING_INPUT" as AiTaskStatus, message: "图文制作任务已返回，但缺少图文页、标题或发布文案" };
        }
        const previous = plan.variants.find((variant) => variant.platform === "DOUYIN");
        const metadata = {
          ...object(previous?.metadata),
          pages,
          tags,
          publishCopy,
          imageProjectTaskId: task.id,
          generatedAt: new Date().toISOString(),
        };
        await this.prisma.$transaction([
          this.prisma.contentVariant.upsert({
            where: { contentPlanId_platform: { contentPlanId: plan.id, platform: "DOUYIN" } },
            create: {
              contentPlanId: plan.id,
              platform: "DOUYIN",
              title,
              body: publishCopy,
              mediaType: "IMAGE_POST",
              metadata: json(metadata),
              status: "PENDING_APPROVAL",
            },
            update: {
              title,
              body: publishCopy,
              mediaType: "IMAGE_POST",
              metadata: json(metadata),
              status: "PENDING_APPROVAL",
            },
          }),
          this.prisma.contentPlan.update({
            where: { id: plan.id },
            data: {
              topic: title || plan.topic,
              productionStage: "IMAGE_REVIEW",
              status: "PENDING_APPROVAL",
              rejectedReason: null,
            },
          }),
        ]);
        const existingOutput = await this.prisma.aiTaskOutput.findFirst({
          where: { aiTaskId: task.id, kind: "IMAGE_PROJECT_RESULT", contentPlanId: plan.id },
        });
        if (!existingOutput) {
          await this.prisma.aiTaskOutput.create({
            data: {
              aiTaskId: task.id,
              kind: "IMAGE_PROJECT_RESULT",
              title,
              contentPlanId: plan.id,
              reviewStatus: "PENDING",
              metadata: json({ pages, tags, publishCopy }),
            },
          });
        }
        return { status: "PENDING_REVIEW" as AiTaskStatus, message: "图文、标题、发布文案和标签已回传，等待审核" };
      }
      const outputCount = await this.prisma.aiTaskOutput.count({ where: { aiTaskId: task.id, assetId: { not: null } } });
      if (!outputCount) {
        const brief = object(result.imageBrief);
        await this.prisma.aiTaskOutput.create({
          data: { aiTaskId: task.id, kind: "IMAGE_BRIEF", title: "图片生成任务书", mimeType: "application/json", reviewStatus: "PENDING", metadata: json(brief) },
        });
        return { status: "WAITING_INPUT" as AiTaskStatus, message: "图片生成能力未配置或未输出图片文件" };
      }
      return { status: "PENDING_REVIEW" as AiTaskStatus, message: "图片已上传素材中心，等待审核" };
    }
    const kind = task.type === "STORE_ANALYSIS" ? "SHOP" : task.type === "COMPETITOR_ANALYSIS" ? "COMPETITOR" : "LIVE_REVIEW";
    const report = await this.prisma.report.create({
      data: {
        kind,
        title: task.title,
        periodFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
        periodTo: new Date(),
        summary: text(result.summary) || "AI分析已完成",
        sections: json(result.sections),
        metrics: json(result.metrics),
        actions: json(result.actions),
      },
    });
    await this.prisma.aiTaskOutput.create({
      data: { aiTaskId: task.id, kind: `${task.type}_REPORT`, title: report.title, reportId: report.id, reviewStatus: "PENDING", metadata: json({ summary: report.summary, findings: result.findings }) },
    });
    return { status: "PENDING_REVIEW" as AiTaskStatus, message: "分析报告已生成，等待审核和任务分配" };
  }

  private async buildSnapshot(type: AiTaskType, body: JsonRecord) {
    const productId = text(body.productId);
    const productModel = text(body.productModel);
    const baseInput = object(body.input);
    const executionMode = text(baseInput.executionMode || body.executionMode).toUpperCase();
    if (type === "VIDEO" && executionMode === "COVER_TITLE") {
      const contentPlanId = text(baseInput.existingContentPlanId || body.sourceId);
      const masterAssetId = text(baseInput.masterAssetId);
      const [contentPlan, masterAsset] = await Promise.all([
        contentPlanId
          ? this.prisma.contentPlan.findUnique({
            where: { id: contentPlanId },
            include: { variants: true },
          })
          : Promise.resolve(null),
        masterAssetId
          ? this.prisma.asset.findFirst({
            where: {
              id: masterAssetId,
              reviewStatus: "APPROVED",
              availabilityStatus: "ACTIVE",
              rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
              deletedAt: null,
            },
            select: {
              id: true,
              assetNo: true,
              displayName: true,
              kind: true,
              mediaType: true,
              contentDescription: true,
              storageUrl: true,
              sha256: true,
              width: true,
              height: true,
              durationSeconds: true,
              qualityScore: true,
            },
          })
          : Promise.resolve(null),
      ]);
      const missingFields: string[] = [];
      if (!contentPlan) missingFields.push("智能视频项目");
      if (!masterAsset) missingFields.push("已审核成片");
      return {
        payload: {
          ...baseInput,
          contentPlan: contentPlan
            ? {
              id: contentPlan.id,
              productionNo: contentPlan.productionNo,
              topic: contentPlan.topic,
              productModel: contentPlan.productModel,
              targetPlatforms: contentPlan.targetPlatforms,
              variants: contentPlan.variants.map((variant) => ({
                platform: variant.platform,
                title: variant.title,
                body: variant.body,
                rejectedReason: variant.packagingRejectedReason,
              })),
            }
            : null,
          assets: masterAsset ? [masterAsset] : [],
        },
        missingFields,
      };
    }
    if (type === "VIDEO" && executionMode === "TOPIC_CARD_BATCH") {
      const platform = enumValue(baseInput.platform || body.platform, ["DOUYIN", "TIKTOK"] as const, "DOUYIN");
      const market = platform === "TIKTOK" ? "US" : "CN";
      const [products, keywords, knowledge, faqs, externalVideos, assets, historicalContent, comments] = await Promise.all([
        this.prisma.product.findMany({
          where: { status: "READY" },
          select: {
            id: true,
            name: true,
            modelCode: true,
            category: true,
            evidenceIds: true,
            metadata: true,
            skus: { where: { active: true }, select: { skuCode: true, name: true, attributes: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 30,
        }),
        this.prisma.smartKeyword.findMany({
          where: {
            platform,
            status: "ACTIVE",
            contentEnabled: true,
            market: { in: [market, platform === "TIKTOK" ? "GLOBAL" : "CN"] },
          },
          include: {
            product: { select: { id: true, modelCode: true, name: true } },
            cluster: true,
            snapshots: { orderBy: { snapshotDate: "desc" }, take: 1 },
            sources: { orderBy: { observedAt: "desc" }, take: 5 },
          },
          orderBy: [{ pinned: "desc" }, { opportunityScore: "desc" }, { lastSeenAt: "desc" }],
          take: 80,
        }),
        this.prisma.knowledgeEntry.findMany({
          where: { status: "READY", externallyUsable: true },
          select: { id: true, title: true, summary: true, category: true, evidenceIds: true },
          orderBy: { updatedAt: "desc" },
          take: 60,
        }),
        this.prisma.faqEntry.findMany({
          where: { status: "READY", externallyUsable: true, market: { in: [market, "GLOBAL"] } },
          include: { product: { select: { id: true, modelCode: true, name: true } } },
          orderBy: [{ frequency: "desc" }, { updatedAt: "desc" }],
          take: 60,
        }),
        this.prisma.externalVideo.findMany({
          where: {
            platform,
            status: "READY",
            rightsStatus: "INTERNAL",
            level: "REFERENCE",
            availabilityStatus: "INACTIVE",
          },
          select: {
            id: true,
            platform: true,
            sourceUrl: true,
            accountName: true,
            title: true,
            description: true,
            publishedAt: true,
            transcript: true,
            moduleSummary: true,
            analysis: true,
            metrics: { orderBy: { capturedAt: "desc" }, take: 1 },
          },
          orderBy: [{ publishedAt: "desc" }, { discoveredAt: "desc" }],
          take: 80,
        }),
        this.prisma.asset.findMany({
          where: {
            reviewStatus: "APPROVED",
            availabilityStatus: "ACTIVE",
            rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
            deletedAt: null,
          },
          select: {
            id: true,
            assetNo: true,
            displayName: true,
            kind: true,
            model: true,
            scene: true,
            mediaType: true,
            contentDescription: true,
            storageUrl: true,
            qualityScore: true,
            rightsStatus: true,
            products: { include: { product: { select: { id: true, modelCode: true, name: true } } } },
            tags: { include: { tag: true } },
          },
          orderBy: [{ qualityScore: "desc" }, { useCount: "desc" }],
          take: 160,
        }),
        this.prisma.contentPlan.findMany({
          where: {
            kind: "VIDEO",
            targetPlatforms: { has: platform },
            productionStage: { notIn: ["TOPIC_CARD_RECOMMENDED", "TOPIC_CARD_APPROVED"] },
          },
          select: {
            id: true,
            topic: true,
            productModel: true,
            audience: true,
            objective: true,
            score: true,
            hook: true,
            sourceSignals: true,
            publishedAt: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 40,
        }),
        this.prisma.commentRecord.findMany({
          where: { integration: { kind: platform } },
          select: {
            id: true,
            remoteContentId: true,
            text: true,
            category: true,
            confidence: true,
            riskReasons: true,
            createdAtRemote: true,
          },
          orderBy: { createdAtRemote: "desc" },
          take: 80,
        }),
      ]);
      const usableReferences = externalVideos.filter((item) => {
        const modules = Array.isArray(item.moduleSummary) ? item.moduleSummary : [];
        return modules.length > 0 || Object.keys(object(item.analysis)).length > 0;
      });
      const topicProducts = products.map((item) => ({
        id: item.id,
        name: item.name,
        modelCode: item.modelCode,
        category: item.category,
        evidenceIds: item.evidenceIds,
        skus: item.skus.map((sku) => ({
          skuCode: sku.skuCode,
          name: sku.name,
          attributes: compactJsonText(sku.attributes, 500),
        })),
      }));
      const topicKeywords = keywords.map((item) => ({
        id: item.id,
        keyword: item.keyword,
        normalizedKeyword: item.normalizedKeyword,
        type: item.type,
        priority: item.priority,
        reason: clippedText(item.reason, 300),
        audience: clippedText(item.audience, 180),
        pain: clippedText(item.pain, 180),
        scene: clippedText(item.scene, 180),
        opportunityScore: item.opportunityScore,
        grade: item.grade,
        product: item.product,
        cluster: item.cluster ? {
          id: item.cluster.id,
          name: item.cluster.name,
          audienceTerms: item.cluster.audienceTerms,
          painTerms: item.cluster.painTerms,
          valueTerms: item.cluster.valueTerms,
          sceneTerms: item.cluster.sceneTerms,
          hookTerms: item.cluster.hookTerms,
        } : null,
        latestSnapshot: item.snapshots[0] ? {
          demandScore: item.snapshots[0].demandScore,
          trendScore: item.snapshots[0].trendScore,
          contentGapScore: item.snapshots[0].contentGapScore,
          commercialIntentScore: item.snapshots[0].commercialIntentScore,
          opportunityScore: item.snapshots[0].opportunityScore,
          trendStage: item.snapshots[0].trendStage,
        } : null,
        sources: item.sources.map((source) => ({
          sourceType: source.sourceType,
          sourceLabel: clippedText(source.sourceLabel, 120),
          observedAt: source.observedAt,
        })),
      }));
      const topicFaqs = faqs.map((item) => ({
        id: item.id,
        question: clippedText(item.standardQuestion, 260),
        shortAnswer: clippedText(item.shortAnswer, 500),
        detailedAnswer: clippedText(item.detailedAnswer, 800),
        category: item.category,
        intent: item.intent,
        frequency: item.frequency,
        product: item.product,
      }));
      const topicReferences = usableReferences.slice(0, 30).map((item) => ({
        id: item.id,
        platform: item.platform,
        accountName: clippedText(item.accountName, 120),
        title: clippedText(item.title, 260),
        description: clippedText(item.description, 600),
        publishedAt: item.publishedAt,
        transcriptExcerpt: clippedText(item.transcript, 1_200),
        reusableStructure: compactJsonText(item.moduleSummary, 2_400),
        analysisSummary: compactJsonText(item.analysis, 2_400),
        latestMetrics: compactJsonText(item.metrics[0], 1_000),
      }));
      const topicAssets = assets.slice(0, 80).map((item) => ({
        id: item.id,
        assetNo: item.assetNo,
        displayName: item.displayName,
        kind: item.kind,
        model: item.model,
        scene: item.scene,
        mediaType: item.mediaType,
        description: clippedText(item.contentDescription, 320),
        qualityScore: item.qualityScore,
        rightsStatus: item.rightsStatus,
        products: item.products.map((relation) => relation.product),
        tags: item.tags.slice(0, 12).map((relation) => relation.tag.label),
      }));
      const topicComments = comments.map((item) => ({
        id: item.id,
        remoteContentId: item.remoteContentId,
        text: clippedText(item.text, 360),
        category: item.category,
        confidence: item.confidence,
        riskReasons: item.riskReasons,
        createdAt: item.createdAtRemote,
      }));
      const missingFields: string[] = [];
      if (!products.length) missingFields.push("已审核产品资料");
      if (!keywords.length) missingFields.push("可用于选题的智能关键词");
      return {
        payload: {
          ...baseInput,
          executionMode: "TOPIC_CARD_BATCH",
          platform,
          market,
          products: topicProducts,
          keywords: topicKeywords,
          knowledge,
          faqs: topicFaqs,
          comments: topicComments,
          externalVideos: topicReferences,
          assets: topicAssets,
          historicalContent,
          videoRecipes: VIDEO_RECIPES,
          opportunityWeights: {
            relevance: 20,
            demand: 15,
            trend: 10,
            contentGap: 10,
            commercialIntent: 10,
            brandFit: 10,
            materialCoverage: 15,
            shootability: 5,
            novelty: 5,
          },
          requirements: {
            exactCount: Math.max(1, Math.min(30, Math.round(number(baseInput.cardCount) || 10))),
            manualApprovalRequired: true,
            externalVisualModelsAllowed: false,
            inputScope: "high-relevance summaries only",
          },
        },
        missingFields,
      };
    }
    if (["VIDEO", "IMAGE", "ARTICLE"].includes(type)) {
      const existingContentPlanId = text(baseInput.existingContentPlanId || body.sourceId);
      const existingContentPlan = type === "VIDEO" && existingContentPlanId
        ? await this.prisma.contentPlan.findUnique({
            where: { id: existingContentPlanId },
            select: { sourceSignals: true },
          })
        : null;
      const isVideoTopicCard = Array.isArray(existingContentPlan?.sourceSignals)
        && existingContentPlan.sourceSignals.some((signal) => object(signal).type === "VIDEO_TOPIC_CARD");
      if (type === "VIDEO" && existingContentPlanId && isVideoTopicCard) {
        const topicCard = await this.videoFactory.topicCard(existingContentPlanId);
        const card = object(topicCard.topicCard);
        const keywordIds = strings(card.keywordIds);
        const faqIds = strings(card.faqIds);
        const knowledgeIds = strings(card.knowledgeIds);
        const externalVideoIds = strings(card.externalVideoIds);
        const requestedAssetIds = strings(object(card.materialCoverage).matchedAssetIds);
        const [product, keywords, faqs, knowledge, externalVideos, assets] = await Promise.all([
          topicCard.productModel
            ? this.prisma.product.findFirst({
              where: { modelCode: topicCard.productModel, status: "READY" },
              include: { skus: { where: { active: true } } },
            })
            : Promise.resolve(null),
          this.prisma.smartKeyword.findMany({
            where: { id: { in: keywordIds }, status: "ACTIVE", contentEnabled: true },
            include: { cluster: true, product: { select: { id: true, modelCode: true, name: true } } },
          }),
          this.prisma.faqEntry.findMany({
            where: { id: { in: faqIds }, status: "READY", externallyUsable: true },
            include: { product: { select: { id: true, modelCode: true, name: true } } },
          }),
          this.prisma.knowledgeEntry.findMany({
            where: { id: { in: knowledgeIds }, status: "READY", externallyUsable: true },
            select: { id: true, title: true, summary: true, category: true, evidenceIds: true },
          }),
          this.prisma.externalVideo.findMany({
            where: {
              id: { in: externalVideoIds },
              status: "READY",
              rightsStatus: "INTERNAL",
              level: "REFERENCE",
              availabilityStatus: "INACTIVE",
            },
            select: { id: true, platform: true, sourceUrl: true, title: true, transcript: true, moduleSummary: true, analysis: true },
          }),
          this.prisma.asset.findMany({
            where: {
              id: { in: requestedAssetIds },
              reviewStatus: "APPROVED",
              availabilityStatus: "ACTIVE",
              rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
              deletedAt: null,
            },
            select: {
              id: true,
              assetNo: true,
              displayName: true,
              kind: true,
              model: true,
              scene: true,
              mediaType: true,
              contentDescription: true,
              storageUrl: true,
              sha256: true,
              width: true,
              height: true,
              durationSeconds: true,
              qualityScore: true,
            },
          }),
        ]);
        const missingFields: string[] = [];
        if (!product) missingFields.push("已审核产品事实");
        if (!keywords.length) missingFields.push("有效关键词");
        return {
          payload: {
            ...baseInput,
            executionMode: executionMode || "FULL_VIDEO",
            topicCard: card,
            contentPlan: {
              id: topicCard.id,
              productionNo: topicCard.productionNo,
              topic: topicCard.topic,
              productModel: topicCard.productModel,
              platform: topicCard.targetPlatforms[0],
              audience: topicCard.audience,
              objective: topicCard.objective,
              score: topicCard.score,
            },
            product,
            keywords,
            faqs,
            knowledge,
            externalVideos,
            assets,
            videoRecipe: videoRecipe(card.primaryRecipe),
            externalVisualModelsAllowed: object(body.modelPolicy).allowExternalGeneration === true,
          },
          missingFields,
        };
      }
      const requestedModelId = text(object(body.modelPolicy).requestedModelId);
      const [product, keywords, knowledge, assets, requestedModel] = await Promise.all([
        productId
          ? this.prisma.product.findUnique({ where: { id: productId } })
          : productModel
            ? this.prisma.product.findUnique({ where: { modelCode: productModel } })
            : Promise.resolve(null),
        this.prisma.smartKeyword.findMany({
          where: {
            status: "ACTIVE",
            ...(type === "VIDEO" ? { contentEnabled: true } : {}),
            ...(productId ? { productId } : {}),
          },
          orderBy: [{ pinned: "desc" }, { opportunityScore: "desc" }],
          take: 20,
        }),
        this.prisma.knowledgeEntry.findMany({
          where: { status: "READY", externallyUsable: true },
          select: { id: true, title: true, summary: true, category: true, evidenceIds: true },
          orderBy: { updatedAt: "desc" },
          take: 30,
        }),
        this.prisma.asset.findMany({
          where: {
            reviewStatus: "APPROVED",
            availabilityStatus: "ACTIVE",
            rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
            ...(productId ? { products: { some: { productId } } } : {}),
          },
          select: { id: true, assetNo: true, displayName: true, kind: true, contentDescription: true, storageUrl: true, qualityScore: true },
          orderBy: [{ qualityScore: "desc" }, { useCount: "desc" }],
          take: 30,
        }),
        requestedModelId
          ? this.prisma.videoModelConfig.findUnique({
            where: { id: requestedModelId },
            select: {
              id: true,
              code: true,
              displayName: true,
              enabled: true,
              capabilities: true,
              provider: { select: { code: true, displayName: true, enabled: true, state: true } },
            },
          })
          : Promise.resolve(null),
      ]);
      return {
        payload: {
          ...baseInput,
          product,
          keywords,
          knowledge,
          assets,
          externalVisualModelsAllowed: object(body.modelPolicy).allowExternalGeneration === true,
          requestedVisualModel: requestedModel
            ? {
              ...requestedModel,
              configured: requestedModel.enabled
                && requestedModel.provider.enabled
                && ["CONFIGURED", "HEALTHY"].includes(requestedModel.provider.state),
            }
            : null,
        },
        missingFields: [] as string[],
      };
    }
    if (type === "STORE_ANALYSIS") {
      const run = await this.prisma.operationAnalysisRun.findFirst({ where: { status: "SUCCEEDED" }, orderBy: { periodEnd: "desc" } });
      const stores = run ? await this.prisma.storeMetricSnapshot.findMany({ where: { runId: run.id }, take: 100 }) : [];
      const products = run ? await this.prisma.productMetricSnapshot.findMany({ where: { runId: run.id }, take: 200 }) : [];
      return { payload: { ...baseInput, run, stores, products }, missingFields: run && stores.length ? [] : ["店铺经营快照"] };
    }
    if (type === "COMPETITOR_ANALYSIS") {
      const [watchlist, snapshots, products] = await Promise.all([
        this.prisma.competitor.findMany({ where: { active: true }, take: 100 }),
        this.prisma.competitorSnapshot.findMany({ orderBy: { capturedAt: "desc" }, take: 100 }),
        this.prisma.competitorProductSnapshot.findMany({ orderBy: { capturedAt: "desc" }, take: 200 }),
      ]);
      return { payload: { ...baseInput, watchlist, snapshots, products }, missingFields: snapshots.length || products.length ? [] : ["竞品快照"] };
    }
    const sourceId = text(body.sourceId);
    const live = sourceId
      ? await this.prisma.liveSession.findUnique({ where: { id: sourceId } })
      : await this.prisma.liveSession.findFirst({ where: { endedAt: { not: null } }, orderBy: { endedAt: "desc" } });
    return { payload: { ...baseInput, live }, missingFields: live?.endedAt ? [] : ["已结束直播数据"] };
  }

  private async budgetState(type: AiTaskType, dailyBudget?: number | null, estimatedCost?: number, budgetLimit?: number) {
    if (dailyBudget === null || dailyBudget === undefined) return { allowed: false, message: "该任务类型每日预算未配置，等待确认" };
    if (dailyBudget <= 0) return { allowed: false, message: "该任务类型每日预算为0，等待确认" };
    if (budgetLimit !== undefined && estimatedCost !== undefined && estimatedCost > budgetLimit) return { allowed: false, message: "预计费用超过单任务预算，等待确认" };
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const spent = await this.prisma.aiTask.aggregate({ where: { type, createdAt: { gte: from } }, _sum: { actualCost: true } });
    const used = spent._sum.actualCost || 0;
    if (!estimatedCost || estimatedCost <= 0) {
      return used < dailyBudget
        ? { allowed: true, message: `每日预算已配置，今日已用${used}` }
        : { allowed: false, message: `今日预算已用完，今日已用${used}` };
    }
    return used + estimatedCost <= dailyBudget
      ? { allowed: true, message: `预计费用${estimatedCost}，今日已用${used}` }
      : { allowed: false, message: `预计费用将超过每日预算，今日已用${used}` };
  }

  private async policy(type: AiTaskType) {
    return this.prisma.aiTaskPolicy.upsert({
      where: { type },
      create: { type, maxConcurrency: 1, maxAttempts: 3, timeoutSeconds: type === "VIDEO" ? 3600 : 1200 },
      update: {},
    });
  }

  private async runner(token: string, requestedCode: string) {
    if (!token) throw new BadRequestException("执行节点凭证缺失");
    const tokenHash = hash(token);
    const node = requestedCode
      ? await this.prisma.aiWorkerNode.findUnique({ where: { nodeCode: requestedCode } })
      : await this.prisma.aiWorkerNode.findFirst({ where: { tokenHash } });
    if (!node || node.tokenHash !== tokenHash) throw new BadRequestException("执行节点凭证无效");
    return node;
  }

  private async ensureRunnerTask(nodeCode: string, id: string) {
    const task = await this.prisma.aiTask.findFirst({ where: { id, lockedBy: nodeCode } });
    if (!task) throw new BadRequestException("任务未由当前执行节点领取");
    if (["CANCELLED", "COMPLETED"].includes(task.status)) throw new BadRequestException("任务已经结束");
    return task;
  }

  private async ensureTask(id: string) {
    const task = await this.prisma.aiTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException("AI任务不存在");
    return task;
  }

  private async releaseStaleTasks() {
    const staleAt = new Date(Date.now() - 5 * 60 * 1000);
    const stale = await this.prisma.aiTask.findMany({
      where: {
        status: { in: ["CLAIMED", "RUNNING", "QUALITY_CHECK", "UPLOADING"] },
        OR: [
          // A normal runner-owned task has a lock and periodically refreshes
          // its heartbeat.  It is safe to release only after that heartbeat is
          // stale.
          { lockedBy: { not: null }, heartbeatAt: { lt: staleAt } },
          // Older runners could clear the lock after reporting a partial
          // result, while leaving the task in an executing status.  Such a
          // task can never be claimed again and otherwise remains stuck in
          // the employee project forever.  Treat it as an orphan once it has
          // not changed for the same timeout window.
          { lockedBy: null, updatedAt: { lt: staleAt } },
        ],
      },
      select: { id: true, lockedBy: true, retryCount: true, maxRetries: true },
    });
    for (const task of stale) {
      const terminal = task.retryCount + 1 >= task.maxRetries;
      await this.prisma.aiTask.update({
        where: { id: task.id },
        data: {
          status: terminal ? "FAILED" : "RETRY",
          retryCount: { increment: 1 },
          failureReason: "Codex执行节点心跳超时",
          lockedBy: null,
          lockedAt: null,
          heartbeatAt: null,
          finishedAt: terminal ? new Date() : null,
        },
      });
      if (task.lockedBy) {
        await this.prisma.aiWorkerNode.updateMany({
          where: { nodeCode: task.lockedBy },
          data: {
            status: "OFFLINE",
            currentTaskId: null,
            currentSkill: null,
            lastError: "任务心跳超时",
          },
        });
      }
    }
  }

  private async videoProjectTaskStaleReason(task: {
    sourceType?: string | null;
    sourceId?: string | null;
    input?: unknown;
  }) {
    if (task.sourceType !== "VIDEO_FACTORY_PROJECT" || !task.sourceId) return "";
    const input = object(task.input);
    const mode = text(input.executionMode).toUpperCase();
    const guard = object(input.workflowGuard);
    const identity = object(input.scriptIdentity);
    const expectedWorkflowVersion = number(
      guard.workflowVersion ?? identity.workflowVersion ?? input.workflowVersion,
    );
    const plan = await this.prisma.contentPlan.findUnique({
      where: { id: task.sourceId },
      select: { workflowVersion: true, productionStage: true },
    });
    if (!plan) return "所属智能视频项目已不存在或已归档";
    if (expectedWorkflowVersion && expectedWorkflowVersion !== plan.workflowVersion) {
      return `项目版本已更新（任务v${expectedWorkflowVersion}，当前v${plan.workflowVersion}）`;
    }
    const allowedStages: Record<string, string[]> = {
      SCRIPT_ONLY: ["PROJECT_BRIEF", "SCRIPT_RETURNED", "SCRIPT_GENERATING"],
      FULL_VIDEO: ["READY_TO_EDIT", "EDITING"],
      COVER_TITLE: ["VIDEO_APPROVED", "PLATFORM_PACKAGING", "PACKAGING_REVIEW"],
    };
    const allowed = allowedStages[mode];
    if (allowed && !allowed.includes(plan.productionStage)) {
      return `项目已不在${mode}对应阶段（当前：${plan.productionStage}）`;
    }
    return "";
  }

  private includeTask(full = false) {
    return {
      product: { select: { id: true, modelCode: true, name: true } },
      owner: { select: { id: true, name: true, wecomUserId: true } },
      reviewer: { select: { id: true, name: true, wecomUserId: true } },
      outputs: { orderBy: { createdAt: "desc" as const }, include: { asset: true, contentPlan: true, report: true, opsTask: true } },
      inputSnapshots: full ? { orderBy: { capturedAt: "desc" as const } } : false,
      attempts: full ? { orderBy: { attemptNo: "desc" as const }, include: { workerNode: { select: { nodeCode: true, displayName: true } } } } : false,
      notifications: full ? { orderBy: { createdAt: "desc" as const } } : false,
    };
  }

  private async sourceOpsTaskId(task: {
    id: string;
    sourceType?: string | null;
    sourceId?: string | null;
    input?: Prisma.JsonValue | null;
  }) {
    const requested = text(object(task.input).opsTaskId)
      || (task.sourceType === "WORKBENCH_CONTENT_REQUEST" ? text(task.sourceId) : "");
    if (requested) {
      const exists = await this.prisma.opsTask.findUnique({ where: { id: requested }, select: { id: true } });
      if (exists) return exists.id;
    }
    return (await this.prisma.aiTaskOutput.findFirst({
      where: { aiTaskId: task.id, opsTaskId: { not: null }, kind: { not: "OPS_TASK" } },
      orderBy: { createdAt: "desc" },
      select: { opsTaskId: true },
    }))?.opsTaskId || undefined;
  }

  private async syncSourceOpsTask(
    task: {
      id: string;
      taskNo?: string | null;
      sourceType?: string | null;
      sourceId?: string | null;
      input?: Prisma.JsonValue | null;
    },
    aiStatus: AiTaskStatus,
    message?: string,
  ) {
    const opsTaskId = await this.sourceOpsTaskId(task);
    if (!opsTaskId) return undefined;
    const current = await this.prisma.opsTask.findUnique({
      where: { id: opsTaskId },
      select: { evidence: true, status: true },
    });
    if (!current) return undefined;
    const opsStatus = aiStatus === "WAITING_CONFIRMATION"
      ? "ACCEPTED"
      : ["PENDING", "CLAIMED", "RUNNING", "QUALITY_CHECK", "UPLOADING", "RETRY"].includes(aiStatus)
        ? "IN_PROGRESS"
        : aiStatus === "PENDING_REVIEW"
          ? "REVIEW"
          : ["WAITING_INPUT", "RETURNED", "FAILED"].includes(aiStatus)
            ? "RETURNED"
            : aiStatus === "COMPLETED"
              ? "COMPLETED"
              : aiStatus === "CANCELLED"
                ? "CANCELLED"
                : current.status;
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.aiTaskOutput.updateMany({
        where: { aiTaskId: task.id, kind: { not: "OPS_TASK" } },
        data: { opsTaskId },
      }),
      this.prisma.opsTask.update({
        where: { id: opsTaskId },
        data: {
          status: opsStatus,
          result: message || undefined,
          evidence: json({
            ...object(current.evidence),
            aiTaskId: task.id,
            aiTaskNo: task.taskNo,
            aiStatus,
            aiUpdatedAt: now.toISOString(),
          }),
          ...(opsStatus === "IN_PROGRESS" ? { startedAt: now } : {}),
          ...(opsStatus === "REVIEW" ? { submittedAt: now, reviewAt: now } : {}),
          ...(["RETURNED"].includes(opsStatus) ? { returnedAt: now, returnReason: message || "请补充资料或查看处理建议" } : {}),
          ...(opsStatus === "COMPLETED" ? { completedAt: now, completedBy: "AI任务中心", returnReason: null } : {}),
        },
      }),
    ]);
    return opsTaskId;
  }

  private async notify(aiTaskId: string, employeeId: string, type: string, title: string, content: string, taskId?: string) {
    if (!taskId) return;
    const safeContent = this.employeeMessage(content);
    const eventKey = `${aiTaskId}:${type}:${taskId}`;
    await this.prisma.taskNotification.upsert({
      where: { recipientEmployeeId_channel_eventKey: { recipientEmployeeId: employeeId, channel: "IN_APP", eventKey } },
      create: {
        aiTaskId,
        taskId,
        recipientEmployeeId: employeeId,
        channel: "IN_APP",
        eventKey,
        targetType: "OPS_TASK",
        targetId: taskId,
        type,
        title,
        content: safeContent,
      },
      update: { title, content: safeContent, taskId, targetType: "OPS_TASK", targetId: taskId },
    });
    const configuredWorkbenchUrl = new URL(opsConfig.webBaseUrl);
    const publicUrl = new URL(opsConfig.publicBaseUrl);
    const workbenchUrl = ["127.0.0.1", "localhost"].includes(configuredWorkbenchUrl.hostname)
      && !["127.0.0.1", "localhost"].includes(publicUrl.hostname)
      ? new URL("/saidian-work/", publicUrl)
      : configuredWorkbenchUrl;
    workbenchUrl.search = "";
    workbenchUrl.hash = "";
    workbenchUrl.searchParams.set("taskId", taskId);
    const result = await this.wecom.send(employeeId, title, safeContent, workbenchUrl.toString());
    if (result.configured) {
      await this.prisma.taskNotification.upsert({
        where: { recipientEmployeeId_channel_eventKey: { recipientEmployeeId: employeeId, channel: "WECOM", eventKey } },
        create: {
          aiTaskId,
          taskId,
          recipientEmployeeId: employeeId,
          channel: "WECOM",
          eventKey,
          targetType: "OPS_TASK",
          targetId: taskId,
          type,
          title,
          content: result.sent ? safeContent : `${safeContent}｜${result.message || "发送失败"}`,
          sentAt: result.sent ? new Date() : null,
        },
        update: {
          title,
          content: result.sent ? safeContent : `${safeContent}｜${result.message || "发送失败"}`,
          sentAt: result.sent ? new Date() : null,
          taskId,
          targetType: "OPS_TASK",
          targetId: taskId,
        },
      });
    }
  }

  private employeeMessage(message: string) {
    const value = text(message);
    if (!value) return "任务状态已更新，请进入任务详情查看。";
    if (/(\n\s+at\s|stack|traceback|schema|jsonl|timeout|manager|exception|error:)/i.test(value)) {
      return "AI处理暂未完成，请进入任务详情查看处理建议或等待系统重试。";
    }
    return clippedText(value, 240);
  }

  private async audit(actor: string, action: string, entityId: string, after: unknown) {
    await this.prisma.auditLog.create({ data: { actor, action, entityType: "AiTask", entityId, after: json(after) } });
  }

  private defaultTitle(type: AiTaskType) {
    return {
      VIDEO: "智能视频生成",
      IMAGE: "智能图片生成",
      ARTICLE: "智能软文生成",
      STORE_ANALYSIS: "店铺经营分析",
      COMPETITOR_ANALYSIS: "竞品变化分析",
      LIVE_ANALYSIS: "直播复盘分析",
    }[type];
  }

  private opsCategory(type: AiTaskType) {
    return ["STORE_ANALYSIS", "COMPETITOR_ANALYSIS"].includes(type) ? "运营分析" : type === "LIVE_ANALYSIS" ? "LIVE_REVIEW" : "CONTENT";
  }

  private requiredRole(type: AiTaskType) {
    return type === "VIDEO" ? "VIDEO_SPECIALIST"
      : type === "IMAGE" ? "DESIGNER"
        : type === "LIVE_ANALYSIS" ? "LIVE_HOST"
          : ["STORE_ANALYSIS", "COMPETITOR_ANALYSIS"].includes(type) ? "CONTENT_OPERATOR"
            : "CONTENT_OPERATOR";
  }

  private extensionForMime(mime: string) {
    const values: Record<string, string> = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/webp": ".webp",
      "video/mp4": ".mp4",
      "audio/mpeg": ".mp3",
      "application/pdf": ".pdf",
    };
    return values[mime] || ".bin";
  }
}
