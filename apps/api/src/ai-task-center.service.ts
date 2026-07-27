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
import { ContentService } from "./content.service";
import { OssStorageService } from "./oss-storage.service";
import { PrismaService } from "./prisma.service";
import { VideoFactoryService } from "./video-factory.service";
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
const platformKinds: IntegrationKind[] = [
  "DOUYIN", "TIKTOK", "WECHAT_OFFICIAL", "XIAOHONGSHU", "WECOM", "WECHAT_CHANNELS",
  "AMAZON", "SHOPIFY", "TMALL", "JD", "PINDUODUO",
];

type JsonRecord = Record<string, unknown>;
type UploadFile = { originalname: string; mimetype: string; size: number; buffer: Buffer };

function text(value: unknown) {
  return String(value ?? "").trim();
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

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
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
      await this.prisma.aiTaskPolicy.upsert({
        where: { type },
        create: {
          type,
          maxConcurrency: 1,
          maxAttempts: 3,
          timeoutSeconds: type === "VIDEO" ? 3600 : type === "IMAGE" ? 1800 : 1200,
          config: type === "VIDEO"
            ? { dailyMainOutput: 1 }
            : type === "IMAGE"
              ? { onlyOnDemand: true }
              : { requiresSnapshot: ["STORE_ANALYSIS", "COMPETITOR_ANALYSIS", "LIVE_ANALYSIS"].includes(type) },
        },
        update: {},
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
    return this.prisma.aiTask.findMany({
      where,
      include: this.includeTask(),
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      take: 500,
    });
  }

  async task(id: string) {
    const task = await this.prisma.aiTask.findUnique({ where: { id }, include: this.includeTask(true) });
    if (!task) throw new NotFoundException("AI任务不存在");
    return task;
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
    const budgetState = await this.budgetState(type, policy.dailyBudget, estimatedCost, budgetLimit);
    const missingRequired = snapshot.missingFields.length > 0
      && ["STORE_ANALYSIS", "COMPETITOR_ANALYSIS", "LIVE_ANALYSIS"].includes(type);
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
        modelPolicy: json(body.modelPolicy),
        input: json({ ...object(body.input), budgetState }),
        estimatedCost,
        budgetLimit,
        maxRetries: policy.maxAttempts,
        dueAt: body.dueAt ? new Date(text(body.dueAt)) : null,
        progressMessage: status === "WAITING_INPUT"
          ? `缺少数据：${snapshot.missingFields.join("、")}`
          : status === "WAITING_CONFIRMATION"
            ? budgetState.message
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
    if (task.ownerEmployeeId) await this.notify(task.id, task.ownerEmployeeId, "AI_TASK_CREATED", "AI任务已创建", task.title);
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
        ...(body.modelPolicy !== undefined ? { modelPolicy: json(body.modelPolicy) } : {}),
      },
      include: this.includeTask(true),
    });
    await this.audit(actor, "AI_TASK_UPDATE", id, { before: before.status, fields: Object.keys(body) });
    return updated;
  }

  async start(id: string, actor: string) {
    const task = await this.ensureTask(id);
    if (!["WAITING_CONFIRMATION", "WAITING_INPUT", "RETURNED", "FAILED", "PENDING"].includes(task.status)) {
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
    await this.audit(actor, "AI_TASK_CANCEL", id, { fromStatus: task.status });
    return updated;
  }

  async retry(id: string, actor: string) {
    const task = await this.ensureTask(id);
    if (!["FAILED", "RETURNED", "RETRY"].includes(task.status)) throw new BadRequestException("任务当前不能重试");
    if (task.retryCount >= task.maxRetries) throw new BadRequestException("任务已达到最大重试次数");
    const updated = await this.prisma.aiTask.update({
      where: { id },
      data: {
        status: "RETRY",
        retryCount: { increment: 1 },
        progress: 0,
        progressMessage: "等待重新执行",
        failureReason: null,
        lockedAt: null,
        lockedBy: null,
        heartbeatAt: null,
      },
    });
    await this.audit(actor, "AI_TASK_RETRY", id, { retryCount: task.retryCount + 1 });
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
      if (task.ownerEmployeeId) await this.notify(id, task.ownerEmployeeId, "AI_TASK_RETURNED", "AI任务被退回", note);
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
          await this.audit(actor, "AI_TASK_VIDEO_RENDER_START", id, { contentPlanId: project });
          return this.task(id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "视频渲染尚未就绪";
          await this.prisma.aiTask.update({ where: { id }, data: { status: "RUNNING", progressMessage: message } });
          return this.task(id);
        }
      }
    }

    await this.prisma.aiTask.update({
      where: { id },
      data: { status: "COMPLETED", progress: 100, progressMessage: "审核通过，任务完成", reviewedAt: new Date(), reviewedBy: actor, reviewNote: note || null, finishedAt: new Date() },
    });
    if (task.ownerEmployeeId) await this.notify(id, task.ownerEmployeeId, "AI_TASK_APPROVED", "AI任务审核通过", task.title);
    await this.audit(actor, "AI_TASK_REVIEW_APPROVE", id, { note });
    return this.task(id);
  }

  async convertToOpsTask(id: string, body: JsonRecord, actor: string) {
    const task = await this.prisma.aiTask.findUnique({ where: { id }, include: { outputs: true } });
    if (!task) throw new NotFoundException("AI任务不存在");
    const linked = task.outputs.find((item) => item.opsTaskId);
    if (linked?.opsTaskId) {
      return this.prisma.opsTask.findUnique({ where: { id: linked.opsTaskId } });
    }
    const opsTask = await this.prisma.opsTask.create({
      data: {
        taskNo: `TASK-${dateKey().replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`,
        title: text(body.title) || task.title,
        description: text(body.description) || text(object(task.output).summary) || task.instructions,
        category: text(body.category) || this.opsCategory(task.type),
        priority: text(body.priority).toUpperCase() || task.priority,
        status: text(body.assigneeEmployeeId) ? "ACCEPTED" : "OPEN",
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
    if (opsTask.assigneeEmployeeId) {
      await this.prisma.taskNotification.create({
        data: { taskId: opsTask.id, recipientEmployeeId: opsTask.assigneeEmployeeId, type: "ASSIGNED", title: "收到AI分析改进任务", content: opsTask.title },
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
      data: { tokenHash: hash(token), status: "OFFLINE", currentTaskId: null, lastHeartbeatAt: null },
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
      take: 20,
    });
    for (const candidate of tasks) {
      const policy = await this.policy(candidate.type);
      if (!policy.enabled) continue;
      const running = await this.prisma.aiTask.count({ where: { type: candidate.type, status: { in: ["CLAIMED", "RUNNING", "QUALITY_CHECK", "UPLOADING"] } } });
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
        data: { status: "BUSY", version: text(body.version) || node.version, currentTaskId: candidate.id, lastHeartbeatAt: new Date(), lastError: null },
      });
      return {
        task: await this.task(candidate.id),
        attemptId: attempt.id,
        policy: { timeoutSeconds: policy.timeoutSeconds, maxAttempts: policy.maxAttempts },
      };
    }
    await this.prisma.aiWorkerNode.update({
      where: { id: node.id },
      data: { status: "ONLINE", version: text(body.version) || node.version, currentTaskId: null, lastHeartbeatAt: new Date() },
    });
    return { task: null };
  }

  async runnerPackage(token: string, id: string, body: JsonRecord) {
    const node = await this.runner(token, text(body.nodeCode));
    await this.ensureRunnerTask(node.nodeCode, id);
    const task = await this.task(id);
    const assetIds = new Set<string>();
    for (const snapshot of task.inputSnapshots || []) {
      const payload = object(snapshot.payload);
      for (const item of Array.isArray(payload.assets) ? payload.assets.map(object) : []) {
        const assetId = text(item.id);
        if (assetId) assetIds.add(assetId);
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
        },
      })
      : [];
    const input = object(task.input);
    const modelPolicy = object(task.modelPolicy);
    return {
      task: {
        id: task.id,
        taskNo: task.taskNo,
        type: task.type,
        title: task.title,
        instructions: task.instructions,
        platform: task.platform,
        productModel: task.productModel,
        sourceType: task.sourceType,
        sourceId: task.sourceId,
        input,
        modelPolicy,
      },
      snapshots: (task.inputSnapshots || []).map((snapshot) => ({
        id: snapshot.id,
        kind: snapshot.kind,
        sourceType: snapshot.sourceType,
        sourceId: snapshot.sourceId,
        checksum: snapshot.checksum,
        payload: snapshot.payload,
        missingFields: snapshot.missingFields,
        capturedAt: snapshot.capturedAt,
      })),
      assets: assets.map((asset) => ({
        ...asset,
        downloadUrl: asset.objectKey
          ? this.oss.signedDownloadUrl(asset.objectKey, 3_600)
          : /^https?:\/\//iu.test(asset.storageUrl || "")
            ? asset.storageUrl
            : null,
        localPath: asset.objectKey ? null : asset.sourcePath,
      })),
      execution: {
        mode: text(input.executionMode).toUpperCase() || (task.type === "VIDEO" ? "FULL_VIDEO" : "DEFAULT"),
        strategy: text(modelPolicy.strategy).toUpperCase() || "CODEX_FIRST",
        allowExternalGeneration: modelPolicy.allowExternalGeneration === true,
        output: task.type === "VIDEO"
          ? { aspectRatio: "9:16", width: 1080, height: 1920, format: "mp4" }
          : undefined,
      },
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
          data: { logs: json({ ...object(attempt.logs), checkpoint }) },
        }),
      ] : []),
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
        data: { status: "BUSY", currentTaskId: id, lastHeartbeatAt: new Date() },
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
    if (!file) {
      return this.prisma.aiTaskOutput.create({
        data: {
          aiTaskId: id,
          kind: text(body.kind) || "STRUCTURED_RESULT",
          title: text(body.title) || task.title,
          mimeType: text(body.mimeType) || "application/json",
          reviewStatus: "PENDING",
          metadata: json(body.metadata),
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
    const kind = file.mimetype.startsWith("video/") ? "VIDEO" : file.mimetype.startsWith("image/") ? "IMAGE" : file.mimetype.startsWith("audio/") ? "AUDIO" : "DOCUMENT";
    const asset = await this.prisma.asset.create({
      data: {
        sourceKey: `AI_TASK:${id}:${sha256}`,
        sourceType: "AI_GENERATED",
        sourcePath: `oss://${stored.objectKey}`,
        fileName: file.originalname,
        originalFileName: file.originalname,
        extension,
        mediaType: file.mimetype,
        kind,
        assetNo: `AST-AI-${dateKey().replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`,
        displayName: text(body.title) || task.title,
        level: "AI_GENERATED",
        productScope: task.productId || task.productModel ? "MODEL" : "UNKNOWN",
        processingStatus: "READY_FOR_REVIEW",
        reviewStatus: "PENDING",
        availabilityStatus: "INACTIVE",
        rightsStatus: "AUTH_REQUIRED",
        sha256,
        sizeBytes: file.size,
        modifiedAt: new Date(),
        status: "PENDING",
        qualityScore: 0,
        storageProvider: "ALIYUN_OSS",
        objectKey: stored.objectKey,
        objectVersionId: stored.objectVersionId,
        etag: stored.etag,
        storageUrl: stored.storageUrl,
        storageSyncedAt: stored.uploadedAt,
        discoveredBy: `Codex AI任务 ${task.taskNo}`,
        sourceSnapshot: json({ aiTaskId: id, nodeCode: node.nodeCode, metadata: object(body.metadata) }),
        ...(task.productId ? { products: { create: { productId: task.productId, scope: "MODEL", confidence: 1, confirmed: true } } } : {}),
      },
    });
    return this.prisma.aiTaskOutput.create({
      data: {
        aiTaskId: id,
        kind: text(body.kind) || `${kind}_OUTPUT`,
        title: text(body.title) || task.title,
        mimeType: file.mimetype,
        url: stored.storageUrl,
        assetId: asset.id,
        reviewStatus: "PENDING",
        metadata: json(body.metadata),
      },
    });
  }

  async runnerComplete(token: string, id: string, body: JsonRecord) {
    const node = await this.runner(token, text(body.nodeCode));
    const task = await this.ensureRunnerTask(node.nodeCode, id);
    const result = object(body.result);
    const domain = await this.finalizeDomain(task, result, `Codex:${node.nodeCode}`);
    const status = domain.status;
    await this.prisma.$transaction([
      this.prisma.aiTask.update({
        where: { id },
        data: {
          status,
          output: json(result),
          progress: status === "RUNNING" ? 65 : 100,
          progressMessage: domain.message,
          actualCost: number(body.actualCost) || task.actualCost,
          finishedAt: ["PENDING_REVIEW", "COMPLETED", "WAITING_INPUT"].includes(status) ? new Date() : null,
          heartbeatAt: new Date(),
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
          logs: json(body.logs),
          finishedAt: new Date(),
        },
      }),
      this.prisma.aiWorkerNode.update({
        where: { id: node.id },
        data: { status: "ONLINE", currentTaskId: null, lastHeartbeatAt: new Date(), lastError: null },
      }),
    ]);
    if (status === "PENDING_REVIEW" && task.reviewerEmployeeId) {
      await this.notify(id, task.reviewerEmployeeId, "AI_TASK_REVIEW", "AI结果等待审核", task.title);
    } else if (status === "WAITING_INPUT" && task.ownerEmployeeId) {
      await this.notify(id, task.ownerEmployeeId, "AI_TASK_WAITING_INPUT", "AI任务需要补充资料", domain.message);
    }
    return this.task(id);
  }

  async runnerFail(token: string, id: string, body: JsonRecord) {
    const node = await this.runner(token, text(body.nodeCode));
    const task = await this.ensureRunnerTask(node.nodeCode, id);
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
        data: { status: "FAILED", failureReason: message, exitCode: number(body.exitCode), logs: json(body.logs), finishedAt: new Date() },
      }),
      this.prisma.aiWorkerNode.update({
        where: { id: node.id },
        data: { status: "ERROR", currentTaskId: null, lastHeartbeatAt: new Date(), lastError: message },
      }),
    ]);
    if (terminal && task.ownerEmployeeId) await this.notify(id, task.ownerEmployeeId, "AI_TASK_FAILED", "AI任务执行失败", message);
    return this.task(id);
  }

  async outputUrl(id: string) {
    const output = await this.prisma.aiTaskOutput.findUnique({ where: { id }, include: { asset: true } });
    if (!output) throw new NotFoundException("任务输出不存在");
    if (output.asset?.objectKey) return { url: this.oss.signedDownloadUrl(output.asset.objectKey) };
    if (output.url) return { url: output.url };
    throw new NotFoundException("任务输出没有可下载文件");
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
    const video = await this.createTask({
      ...common,
      type: "VIDEO",
      title: `每日智能视频 ${key}`,
      idempotencyKey: `ai-task:daily:video:${key}`,
    }, actor);
    const article = await this.createTask({
      ...common,
      type: "ARTICLE",
      title: `每日智能软文 ${key}`,
      idempotencyKey: `ai-task:daily:article:${key}`,
    }, actor);
    return { video: { id: video.id, status: video.status }, article: { id: article.id, status: article.status } };
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
          if (task.reviewerEmployeeId) await this.notify(task.id, task.reviewerEmployeeId, "AI_VIDEO_SHOT_REVIEW", "AI补拍镜头等待审核", task.title);
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
        if (task.reviewerEmployeeId) await this.notify(task.id, task.reviewerEmployeeId, "AI_VIDEO_REVIEW", "智能视频主成片等待审核", task.title);
      }
    }
  }

  private async finalizeDomain(task: Awaited<ReturnType<AiTaskCenterService["ensureRunnerTask"]>>, result: JsonRecord, actor: string) {
    if (task.type === "VIDEO") {
      const projectInput = object(result.project);
      const taskInput = object(task.input);
      const executionMode = enumValue(taskInput.executionMode, ["SCRIPT_ONLY", "FULL_VIDEO"] as const, "FULL_VIDEO");
      const scriptCandidates = Array.isArray(projectInput.scriptCandidates)
        ? projectInput.scriptCandidates.map(object)
        : [];
      const selectedCandidate = scriptCandidates.find((item) => item.selected === true) || scriptCandidates[0] || {};
      const existingContentPlanId = text(taskInput.existingContentPlanId);
      const existingProject = existingContentPlanId
        ? await this.prisma.contentPlan.findUnique({ where: { id: existingContentPlanId } })
        : null;
      const project = existingProject || await this.videoFactory.createProject({
          platform: enumValue(projectInput.platform || task.platform, ["DOUYIN", "TIKTOK"] as const, "DOUYIN"),
          productModel: text(projectInput.productModel || task.productModel) || undefined,
          topic: text(projectInput.topic) || task.title,
          audience: text(projectInput.audience) || "目标用户",
          objective: text(projectInput.objective) || "内容测试",
          keywordIds: strings(projectInput.keywordIds),
          externalVideoIds: strings(projectInput.externalVideoIds),
          routingMode: text(projectInput.routingMode) || "AUTO",
          allowFallback: projectInput.allowFallback !== false,
        }, actor);
      await this.prisma.contentPlan.update({
        where: { id: project.id },
        data: {
          hook: text(selectedCandidate.hook) || project.hook,
          outline: json(Array.isArray(selectedCandidate.shots) ? selectedCandidate.shots : project.outline),
          sourceSignals: json([
            ...(Array.isArray(project.sourceSignals)
              ? project.sourceSignals.map((signal) => {
                const signalRow = object(signal);
                return signalRow.type === "VIDEO_FACTORY"
                  ? { ...signalRow, scriptCandidates: scriptCandidates.length ? scriptCandidates : signalRow.scriptCandidates }
                  : signalRow;
              })
              : []),
            { type: "AI_TASK", id: task.id, executionMode, provider: "CODEX" },
          ]),
          productionStage: "FACTORY_SCRIPT_READY",
        },
      });
      await this.prisma.aiTaskOutput.create({
        data: {
          aiTaskId: task.id,
          kind: "VIDEO_PROJECT",
          title: project.topic,
          contentPlanId: project.id,
          reviewStatus: executionMode === "SCRIPT_ONLY" ? "PENDING" : "APPROVED",
          metadata: json({ productionNo: project.productionNo, executionMode, scriptCandidates: scriptCandidates.length }),
        },
      });
      if (executionMode === "SCRIPT_ONLY") {
        return { status: "PENDING_REVIEW" as AiTaskStatus, message: "三套脚本和分镜已进入视频工厂，等待审核" };
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
              checkType: "FINAL_REVIEW",
              status: "REVIEW_REQUIRED",
              score: 0,
              findings: json([{ message: "Codex本地成片已上传，请核对产品外形、字幕、配音和CTA" }]),
            },
          }),
        ]);
        return { status: "PENDING_REVIEW" as AiTaskStatus, message: "Codex本地成片已上传，等待审核" };
      }

      const modelPolicy = object(task.modelPolicy);
      if (modelPolicy.allowExternalGeneration === true) {
        await this.videoFactory.generateProject(project.id, {
          candidateIndex: Math.max(0, scriptCandidates.findIndex((item) => item.selected === true)),
          routingMode: "AUTO",
          allowFallback: true,
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
            missingAssets: object(result.project).missingAssets || [],
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
    if (["VIDEO", "IMAGE", "ARTICLE"].includes(type)) {
      const [product, keywords, knowledge, assets] = await Promise.all([
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
      ]);
      return { payload: { ...baseInput, product, keywords, knowledge, assets }, missingFields: [] as string[] };
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
      where: { status: { in: ["CLAIMED", "RUNNING", "QUALITY_CHECK", "UPLOADING"] }, heartbeatAt: { lt: staleAt } },
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
          data: { status: "OFFLINE", currentTaskId: null, lastError: "任务心跳超时" },
        });
      }
    }
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

  private async notify(aiTaskId: string, employeeId: string, type: string, title: string, content: string) {
    await this.prisma.taskNotification.create({
      data: { aiTaskId, recipientEmployeeId: employeeId, channel: "IN_APP", type, title, content },
    });
    const result = await this.wecom.send(employeeId, title, content, "https://stest.saydian.cn/saidian-admin/");
    if (result.configured) {
      await this.prisma.taskNotification.create({
        data: {
          aiTaskId,
          recipientEmployeeId: employeeId,
          channel: "WECOM",
          type,
          title,
          content: result.sent ? content : `${content}｜${result.message || "发送失败"}`,
          sentAt: result.sent ? new Date() : null,
        },
      });
    }
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
