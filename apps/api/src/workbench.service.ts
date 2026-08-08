import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import type { SessionPayload } from "./auth.service";
import { BailianVideoAiProvider } from "./cloud-media.service";
import { OssStorageService } from "./oss-storage.service";
import { PrismaService } from "./prisma.service";
import { taskDocumentFields } from "./task-document";

const openStatuses = ["OPEN", "ACCEPTED", "IN_PROGRESS", "RETURNED", "REVIEW"];
const doneStatuses = ["COMPLETED", "CANCELLED", "VERIFIED"];
const collaborationRoleCodes = ["CONTENT_OPERATOR", "VIDEO_SPECIALIST", "DESIGNER"];
const deliverableOutputKinds = [
  "VIDEO_MASTER",
  "IMAGE", "IMAGE_ASSET", "IMAGE_OUTPUT", "IMAGE_GENERATED", "IMAGE_MASTER",
  "ARTICLE", "ARTICLE_OUTPUT", "ARTICLE_PLAN",
];

function value(input: unknown) {
  return String(input ?? "").trim();
}

function object(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function date(input: unknown) {
  const text = value(input);
  if (!text) return undefined;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException("时间格式不正确");
  return parsed;
}

function endOfToday() {
  const result = new Date();
  result.setHours(23, 59, 59, 999);
  return result;
}

function taskDueAt(input: unknown) {
  return date(input) || endOfToday();
}

function recurrenceWeekdays(input: unknown) {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))).sort();
}

@Injectable()
export class WorkbenchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bailian: BailianVideoAiProvider,
    private readonly oss: OssStorageService,
  ) {}

  async dashboard(session: SessionPayload) {
    const employeeId = session.employeeId!;
    const access = this.taskAccess(session);
    const [employee, tasks, unread, recentNotices] = await Promise.all([
      this.prisma.employee.findUnique({
        where: { id: employeeId },
        include: { department: true, roles: { include: { role: true } } },
      }),
      this.prisma.opsTask.findMany({
        where: { AND: [access, { status: { in: openStatuses } }, { category: { not: "AI_DELIVERY" } }] },
        include: this.taskInclude(),
        orderBy: [{ priority: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
        take: 40,
      }),
      this.prisma.taskNotification.count({
        where: { recipientEmployeeId: employeeId, channel: "IN_APP", readAt: null, taskId: { not: null } },
      }),
      this.prisma.taskNotification.findMany({
        where: { recipientEmployeeId: employeeId, channel: "IN_APP", taskId: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    ]);
    const now = Date.now();
    const sortedTasks = await this.attachTaskProjections(this.sortTasks(tasks));
    const mine = sortedTasks.filter((task) => task.assigneeEmployeeId === employeeId);
    const available = sortedTasks.filter((task) => !task.assigneeEmployeeId && task.status === "OPEN");
    return {
      employee,
      summary: {
        today: mine.filter((task) => task.dueAt && this.sameDay(task.dueAt, new Date())).length,
        inProgress: mine.filter((task) => ["ACCEPTED", "IN_PROGRESS", "RETURNED"].includes(task.status)).length,
        awaitingReview: mine.filter((task) => task.status === "REVIEW").length,
        overdue: mine.filter((task) => task.dueAt && task.dueAt.getTime() < now && !doneStatuses.includes(task.status)).length,
        available: available.length,
        unread,
      },
      todayTasks: mine.slice(0, 12),
      availableTasks: available.slice(0, 8),
      notices: recentNotices,
      quickActions: this.quickActions(session.roles),
      mall: {
        employee: "/saidian-mall/#/pages/employee/index",
        storefront: "/saidian-mall/",
      },
    };
  }

  async outputs(query: Record<string, string | undefined>) {
    const type = value(query.type).toUpperCase();
    const limit = Math.min(Math.max(Number(query.limit) || 30, 1), 60);
    const typeWhere = type === "VIDEO"
      ? {
          kind: "VIDEO_MASTER",
        }
      : type === "IMAGE"
        ? {
            OR: [
              { mimeType: { startsWith: "image/" } },
              { kind: { in: ["IMAGE", "IMAGE_ASSET", "IMAGE_OUTPUT", "IMAGE_GENERATED", "IMAGE_MASTER"] } },
            ],
          }
        : type === "ARTICLE"
          ? {
              kind: { in: ["ARTICLE", "ARTICLE_OUTPUT", "ARTICLE_PLAN"] },
            }
          : {};
    const items = await this.prisma.aiTaskOutput.findMany({
      where: {
        AND: [
          { kind: { in: deliverableOutputKinds } },
          { reviewStatus: "APPROVED" },
          typeWhere,
        ],
      },
      include: {
        aiTask: {
          select: {
            id: true,
            taskNo: true,
            title: true,
            type: true,
            platform: true,
            status: true,
            productId: true,
            input: true,
            instructions: true,
            product: { select: { id: true, modelCode: true, name: true } },
          },
        },
        asset: {
          select: {
            id: true,
            displayName: true,
            fileName: true,
            extension: true,
            mediaType: true,
            width: true,
            height: true,
            durationSeconds: true,
            reviewStatus: true,
            availabilityStatus: true,
            objectKey: true,
          },
        },
        contentPlan: {
          select: {
            id: true,
            topic: true,
            variants: {
              select: {
                title: true,
                body: true,
                platform: true,
                manualPublishUrl: true,
                manualPublishedAt: true,
              },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit * 4,
    });
    const finalItems = items
      .filter((item) => {
        const metadata = object(item.metadata);
        if (metadata.isFinal === false) return false;
        if (item.kind === "VIDEO_MASTER") {
          return item.asset?.reviewStatus === "APPROVED"
            && item.asset.availabilityStatus === "ACTIVE"
            && Boolean(item.asset.objectKey || item.url);
        }
        if (["IMAGE", "IMAGE_ASSET", "IMAGE_OUTPUT", "IMAGE_GENERATED", "IMAGE_MASTER"].includes(item.kind)) {
          return item.asset?.reviewStatus === "APPROVED"
            && item.asset.availabilityStatus === "ACTIVE"
            && Boolean(item.asset.objectKey || item.url);
        }
        return Boolean(item.contentPlan?.variants.some((variant) => value(variant.body)) || item.url);
      })
      .slice(0, limit)
      .map((item) => {
        const metadata = object(item.metadata);
        const previewKind = item.kind === "VIDEO_MASTER" ? "VIDEO"
          : ["IMAGE", "IMAGE_ASSET", "IMAGE_OUTPUT", "IMAGE_GENERATED", "IMAGE_MASTER"].includes(item.kind) ? "IMAGE" : "ARTICLE";
        return {
          ...item,
          isFinal: true,
          previewKind,
          version: Number(metadata.version) || 1,
          thumbnailUrl: value(metadata.thumbnailUrl) || null,
          downloadUrl: `/api/v1/workbench/outputs/${item.id}/url`,
          metadata: {
            ...metadata,
            width: item.asset?.width ?? metadata.width ?? null,
            height: item.asset?.height ?? metadata.height ?? null,
            durationSeconds: item.asset?.durationSeconds ?? metadata.durationSeconds ?? null,
          },
        };
      });
    return { items: finalItems };
  }

  async outputUrl(outputId: string) {
    const output = await this.prisma.aiTaskOutput.findFirst({
      where: {
        id: outputId,
        kind: { in: deliverableOutputKinds },
        reviewStatus: "APPROVED",
      },
      include: { asset: true },
    });
    if (!output) throw new NotFoundException("成品不存在");
    if (output.asset && (output.asset.reviewStatus !== "APPROVED" || output.asset.availabilityStatus !== "ACTIVE")) {
      throw new NotFoundException("成品尚未审核通过");
    }
    if (output.asset?.objectKey) return { url: this.oss.signedDownloadUrl(output.asset.objectKey, 1_800) };
    if (output.url) return { url: output.url };
    throw new NotFoundException("成品暂无可预览文件");
  }

  private async backfillVideoLibrary() {
    const rows = await this.prisma.videoRenderJob.findMany({
      where: { status: "SUCCEEDED", outputAsset: { is: { reviewStatus: "APPROVED", availabilityStatus: "ACTIVE" } } },
      include: { outputAsset: true, contentPlan: true }, orderBy: { finishedAt: "desc" }, take: 500,
    });
    await Promise.all(rows.map((row) => {
      const signals = Array.isArray(row.contentPlan.sourceSignals) ? row.contentPlan.sourceSignals as Array<Record<string, unknown>> : [];
      const factory = signals.find((item) => item.type === "VIDEO_FACTORY") || {};
      const brief = object(factory.brief);
      return this.prisma.contentLibraryEntry.upsert({
        where: { contentPlanId_outputAssetId: { contentPlanId: row.contentPlanId, outputAssetId: row.outputAssetId! } },
        create: {
          contentPlanId: row.contentPlanId, outputAssetId: row.outputAssetId!, renderJobId: row.id,
          title: row.contentPlan.topic, productModel: row.contentPlan.productModel,
          platform: String(row.contentPlan.targetPlatforms[0] || "DOUYIN"), createdBy: row.contentPlan.createdBy,
          snapshot: { prompt: String(brief.additionalPrompt || row.contentPlan.objective || ""), reference: String(brief.reference || ""), project: { topic: row.contentPlan.topic, productModel: row.contentPlan.productModel || "", audience: row.contentPlan.audience, objective: row.contentPlan.objective, hook: row.contentPlan.hook, platform: row.contentPlan.targetPlatforms[0] || "DOUYIN", voiceoverMode: String(factory.voiceoverMode || "AUTO"), videoType: String(brief.videoType || ""), keywords: String(brief.keywords || ""), scene: String(brief.scene || ""), painPoint: String(brief.painPoint || ""), additionalPrompt: String(brief.additionalPrompt || "") } } as Prisma.InputJsonValue,
        }, update: {},
      });
    }));
  }

  async videoLibrary(query: Record<string, string | undefined>) {
    const search = value(query.search);
    const productModel = value(query.productModel);
    const productCategory = value(query.productCategory);
    const platform = value(query.platform);
    const createdBy = value(query.createdBy);
    const dateFrom = date(query.dateFrom);
    const dateTo = date(query.dateTo);
    if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(value(query.dateTo))) dateTo.setHours(23, 59, 59, 999);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 10, 1), 30);
    const page = Math.max(Number(query.page) || 1, 1);
    const where: Prisma.ContentLibraryEntryWhereInput = {
        category: "VIDEO", visibilityStatus: "ACTIVE",
        outputAsset: { is: { reviewStatus: "APPROVED", availabilityStatus: "ACTIVE", deletedAt: null, objectKey: { not: null } } },
        ...(productModel ? { productModel } : {}),
        ...(productCategory ? { productCategory } : {}),
        ...(platform ? { platform } : {}),
        ...(createdBy ? { createdBy } : {}),
        ...(dateFrom || dateTo ? { createdAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
        ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { productModel: { contains: search, mode: "insensitive" } }, { createdBy: { contains: search, mode: "insensitive" } }] } : {}),
    };
    const [items, total, categoryRows] = await Promise.all([
      this.prisma.contentLibraryEntry.findMany({
      where,
      include: {
        outputAsset: { select: { id: true, displayName: true, fileName: true, durationSeconds: true, width: true, height: true, objectKey: true, sourceSnapshot: true, reviewStatus: true, availabilityStatus: true, deletedAt: true } },
        contentPlan: { select: { id: true, productionNo: true, topic: true, variants: { select: { id: true, platform: true, title: true, manualPublishUrl: true, manualPublishedAt: true } } } },
      }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.contentLibraryEntry.count({ where }),
      this.prisma.contentLibraryEntry.findMany({ where: { category: "VIDEO", visibilityStatus: "ACTIVE", productCategory: { not: null } }, select: { productCategory: true }, distinct: ["productCategory"], orderBy: { productCategory: "asc" } }),
    ]);
    const available = await Promise.all(items.map(async (item) => {
      if (!item.outputAsset.objectKey || await this.oss.objectExists(item.outputAsset.objectKey)) return item;
      await this.prisma.contentLibraryEntry.update({ where: { id: item.id }, data: { visibilityStatus: "HIDDEN", hiddenAt: new Date(), hiddenBy: "SYSTEM_STORAGE_CHECK" } });
      return null;
    }));
    return { items: available.filter(Boolean).map((item) => ({ ...item!, previewUrl: `/api/v1/workbench/video-library/${item!.id}/url` })), total, page, pageSize, categories: categoryRows.map((item) => item.productCategory).filter(Boolean) };
  }

  async videoLibraryEntry(id: string) {
    const item = await this.prisma.contentLibraryEntry.findFirst({
      where: { id, category: "VIDEO", visibilityStatus: "ACTIVE", outputAsset: { is: { reviewStatus: "APPROVED", availabilityStatus: "ACTIVE", deletedAt: null, objectKey: { not: null } } } },
      include: {
        outputAsset: { select: { id: true, displayName: true, fileName: true, durationSeconds: true, width: true, height: true, objectKey: true, sourceSnapshot: true, reviewStatus: true, availabilityStatus: true, deletedAt: true } },
        contentPlan: { select: { id: true, productionNo: true, topic: true, productModel: true, audience: true, objective: true, hook: true, variants: { select: { id: true, platform: true, title: true, body: true, manualPublishUrl: true, manualPublishedAt: true } } } },
      },
    });
    if (!item) throw new NotFoundException("Video library entry not found");
    if (!item.outputAsset.objectKey || !await this.oss.objectExists(item.outputAsset.objectKey)) {
      await this.prisma.contentLibraryEntry.update({ where: { id }, data: { visibilityStatus: "HIDDEN", hiddenAt: new Date(), hiddenBy: "SYSTEM_STORAGE_CHECK" } });
      throw new NotFoundException("Video asset is unavailable");
    }
    return { ...item, previewUrl: `/api/v1/workbench/video-library/${item.id}/url` };
  }

  async videoLibraryUrl(id: string) {
    const item = await this.prisma.contentLibraryEntry.findFirst({ where: { id, category: "VIDEO", visibilityStatus: "ACTIVE", outputAsset: { is: { reviewStatus: "APPROVED", availabilityStatus: "ACTIVE", deletedAt: null, objectKey: { not: null } } } }, include: { outputAsset: true } });
    if (!item?.outputAsset?.objectKey || !await this.oss.objectExists(item.outputAsset.objectKey)) {
      if (item) await this.prisma.contentLibraryEntry.update({ where: { id }, data: { visibilityStatus: "HIDDEN", hiddenAt: new Date(), hiddenBy: "SYSTEM_STORAGE_CHECK" } });
      throw new NotFoundException("Video preview is unavailable");
    }
    return { url: this.oss.signedDownloadUrl(item.outputAsset.objectKey, 1_800) };
  }

  async tasks(session: SessionPayload, query: Record<string, string | undefined>) {
    const status = value(query.status).toUpperCase();
    const statusGroups: Record<string, string[]> = {
      TODO: ["OPEN", "ACCEPTED", "IN_PROGRESS", "RETURNED"],
      PENDING_REVIEW: ["SUBMITTED", "REVIEW"],
      DONE: ["COMPLETED", "VERIFIED"],
    };
    const statusFilter = status
      ? { status: statusGroups[status] ? { in: statusGroups[status] } : status }
      : {};
    const scope = value(query.scope).toUpperCase();
    const taskType = value(query.taskType).toUpperCase();
    const paginated = value(query.paginated) === "1";
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 5, 1), 50);
    const requestedPage = Math.max(Number(query.page) || 1, 1);
    // The employee task page opens as a work queue, not as an archive.  Only
    // apply this view when the user has not explicitly selected a status,
    // task type, or another scope.
    const defaultWorkQueue = value(query.defaultWorkQueue) === "1" && !status && !taskType && scope === "MINE";
    const typeFilter = taskType === "VIDEO_PROJECT"
      ? { OR: [{ sourceType: "VIDEO_PROJECT" }, { category: "VIDEO_PROJECT" }] }
      : taskType === "IMAGE_PROJECT"
        ? { category: "IMAGE_PROJECT" }
        : taskType === "ARTICLE_PROJECT"
          ? { category: "ARTICLE_PROJECT" }
          : taskType === "OTHER"
            ? {
                sourceType: { not: "VIDEO_PROJECT" },
                category: { notIn: ["VIDEO_PROJECT", "IMAGE_PROJECT", "ARTICLE_PROJECT"] },
              }
            : {};
    const employeeId = session.employeeId!;
    const access = this.taskAccess(session);
    const where = scope === "AVAILABLE"
      ? {
          AND: [
            access,
            { category: { not: "AI_DELIVERY" } },
            { assigneeEmployeeId: null, status: "OPEN" },
          ],
        }
      : {
          AND: [
            access,
            { category: { not: "AI_DELIVERY" } },
            scope === "MINE" ? { assigneeEmployeeId: employeeId } : {},
            statusFilter,
            typeFilter,
          ],
        };
    const rows = await this.prisma.opsTask.findMany({
      where,
      include: this.taskInclude(),
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 200,
    });
    const projected = await this.attachTaskProjections(this.sortTasks(rows));
    const visible = defaultWorkQueue
      ? projected.filter((task: any) => {
          const isProject = ["VIDEO_PROJECT", "IMAGE_PROJECT"].includes(String(task.sourceType))
            || ["VIDEO_PROJECT", "IMAGE_PROJECT"].includes(String(task.category));
          if (isProject) return !task.projection?.project?.hasReturnedPublishLink;
          return !["COMPLETED", "VERIFIED", "CANCELLED"].includes(value(task.status).toUpperCase());
        })
      : projected;
    if (!paginated) return visible;
    const total = visible.length;
    const page = Math.min(requestedPage, Math.max(Math.ceil(total / pageSize), 1));
    const offset = (page - 1) * pageSize;
    return {
      items: visible.slice(offset, offset + pageSize),
      total,
      page,
      pageSize,
    };
  }

  async createSelfTask(session: SessionPayload, body: Record<string, unknown>) {
    if (!session.employeeId) throw new BadRequestException("当前员工身份不可用");
    const weekdays = recurrenceWeekdays(body.recurrenceWeekdays);
    if (weekdays.length) {
      return this.createRecurringTask(session, {
        ...body,
        assigneeEmployeeId: session.employeeId,
        assignedByEmployeeId: session.employeeId,
        owner: session.name,
        sourceType: "SELF_CREATED",
        requiredRoleCode: null,
      }, weekdays);
    }
    return this.createTask({
      ...body,
      assigneeEmployeeId: session.employeeId,
      assignedByEmployeeId: session.employeeId,
      owner: session.name,
      sourceType: "SELF_CREATED",
      sourceId: null,
      requiredRoleCode: null,
    }, session.name);
  }

  async ensureVideoProjectTask(
    employee: { employeeId: string; name: string },
    project: { id: string; productionNo?: string | null; topic?: string | null; productionStage?: string | null },
  ) {
    const existing = await this.prisma.opsTask.findFirst({
      where: {
        sourceType: "VIDEO_PROJECT",
        sourceId: project.id,
        assigneeEmployeeId: employee.employeeId,
        deletedAt: null,
      },
      include: this.taskInclude(),
    });
    if (existing) {
      // The employee task is the stable entry point for a video project.  Keep
      // it in sync when a returned master creates a new revision task, instead
      // of leaving the card to describe the prior render attempt.
      const existingEvidence = object(existing.evidence);
      return this.prisma.opsTask.update({
        where: { id: existing.id },
        data: {
          title: project.topic || existing.title,
          evidence: {
            ...existingEvidence,
            taskType: "VIDEO_PROJECT",
            contentPlanId: project.id,
            productionNo: project.productionNo || value(existingEvidence.productionNo) || null,
            projectStage: project.productionStage || value(existingEvidence.projectStage) || "PROJECT_BRIEF",
            projectPath: `/data-center/video-projects/${project.id}`,
          } as Prisma.InputJsonValue,
        },
        include: this.taskInclude(),
      });
    }
    return this.createTask({
      title: project.topic || "视频项目",
      description: `员工新建视频项目后自动形成。项目编号：${project.productionNo || project.id}。脚本生成任务已自动提交，请进入项目查看当前阶段并处理待办事项。`,
      expectedResult: "完成脚本审核、素材补全、成片审核、封面标题与发布链接回传。",
      category: "VIDEO_PROJECT",
      priority: "MEDIUM",
      owner: employee.name,
      assigneeEmployeeId: employee.employeeId,
      assignedByEmployeeId: employee.employeeId,
      sourceType: "VIDEO_PROJECT",
      sourceId: project.id,
      evidence: {
        taskType: "VIDEO_PROJECT",
        contentPlanId: project.id,
        productionNo: project.productionNo || null,
        projectStage: project.productionStage || "PROJECT_BRIEF",
        projectPath: `/data-center/video-projects/${project.id}`,
      },
    }, employee.name);
  }

  async ensureImageProjectTask(
    employee: { employeeId: string; name: string },
    project: { id: string; productionNo?: string | null; topic?: string | null; productionStage?: string | null },
  ) {
    const existing = await this.prisma.opsTask.findFirst({
      where: { sourceType: "IMAGE_PROJECT", sourceId: project.id, assigneeEmployeeId: employee.employeeId, deletedAt: null },
      include: this.taskInclude(),
    });
    const evidence = {
      taskType: "IMAGE_PROJECT",
      contentPlanId: project.id,
      productionNo: project.productionNo || null,
      projectStage: project.productionStage || "IMAGE_GENERATING",
      projectPath: `/image-projects/${project.id}`,
    } as Prisma.InputJsonValue;
    if (existing) return this.prisma.opsTask.update({
      where: { id: existing.id },
      data: { title: project.topic || existing.title, evidence },
      include: this.taskInclude(),
    });
    return this.createTask({
      title: project.topic || "图文项目",
      description: "员工新建图文项目后自动生成。进入项目查看图文、标题、发布文案和标签。",
      expectedResult: "完成图文与文案审核，并回传发布链接。",
      category: "IMAGE_PROJECT",
      priority: "MEDIUM",
      owner: employee.name,
      assigneeEmployeeId: employee.employeeId,
      assignedByEmployeeId: employee.employeeId,
      sourceType: "IMAGE_PROJECT",
      sourceId: project.id,
      evidence,
    }, employee.name);
  }

  private async createRecurringTask(session: SessionPayload, body: Record<string, unknown>, weekdays: number[]) {
    const title = value(body.title);
    if (!title) throw new BadRequestException("任务标题不能为空");
    const description = taskDocumentFields(body.descriptionDocument, body.description);
    const expectedResult = taskDocumentFields(body.expectedResultDocument, body.expectedResult);
    const recurrence = await this.prisma.taskRecurrence.create({
      data: {
        title,
        description: description.text || null,
        descriptionDocument: description.document ? description.document as Prisma.InputJsonValue : undefined,
        expectedResult: expectedResult.text || null,
        expectedResultDocument: expectedResult.document ? expectedResult.document as Prisma.InputJsonValue : undefined,
        category: value(body.category) || "GENERAL",
        priority: value(body.priority).toUpperCase() || "MEDIUM",
        creatorEmployeeId: session.employeeId!,
        assigneeEmployeeId: value(body.assigneeEmployeeId) || session.employeeId!,
        assignedByEmployeeId: value(body.assignedByEmployeeId) || session.employeeId!,
        assignedBy: session.name,
        sourceType: value(body.sourceType) || "SELF_CREATED",
        requiredRoleCode: value(body.requiredRoleCode) || null,
        weekdays,
        dueTime: /^\d{2}:\d{2}$/.test(value(body.recurrenceDueTime)) ? value(body.recurrenceDueTime) : "23:59",
        evidence: (body.evidence && typeof body.evidence === "object" ? body.evidence : {}) as object,
      },
    });
    await this.generateRecurringTask(recurrence, new Date());
    if (recurrence.assignedByEmployeeId !== recurrence.assigneeEmployeeId) {
      await this.prisma.taskNotification.create({
        data: {
          recipientEmployeeId: recurrence.assigneeEmployeeId,
          type: "RECURRING_TASK_ASSIGNED",
          title: "收到每周固定任务安排",
          content: `${title} · 每周 ${weekdays.join("、")}`,
        },
      });
    }
    await this.audit(session.name, "TASK_RECURRENCE_CREATE", "TaskRecurrence", recurrence.id, { weekdays });
    return { recurrence, recurring: true };
  }

  private async generateRecurringTask(recurrence: {
    id: string; title: string; description: string | null; descriptionDocument: Prisma.JsonValue | null;
    expectedResult: string | null; expectedResultDocument: Prisma.JsonValue | null; category: string; priority: string;
    creatorEmployeeId: string; assigneeEmployeeId: string; assignedByEmployeeId: string | null; assignedBy: string | null;
    sourceType: string; requiredRoleCode: string | null; weekdays: number[]; dueTime: string; evidence: Prisma.JsonValue;
    lastGeneratedDate: string | null;
  }, now: Date) {
    const weekday = now.getDay() === 0 ? 7 : now.getDay();
    if (!recurrence.weekdays.includes(weekday)) return null;
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (recurrence.lastGeneratedDate === dateKey) return null;
    const [hour, minute] = recurrence.dueTime.split(":").map(Number);
    const dueAt = new Date(now);
    dueAt.setHours(Number.isFinite(hour) ? hour : 23, Number.isFinite(minute) ? minute : 59, 59, 999);
    const task = await this.prisma.opsTask.create({
      data: {
        taskNo: `WEEKLY-${dateKey.replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        title: recurrence.title,
        description: recurrence.description,
        descriptionDocument: recurrence.descriptionDocument ? recurrence.descriptionDocument as Prisma.InputJsonValue : undefined,
        expectedResult: recurrence.expectedResult,
        expectedResultDocument: recurrence.expectedResultDocument ? recurrence.expectedResultDocument as Prisma.InputJsonValue : undefined,
        category: recurrence.category,
        priority: recurrence.priority,
        status: "ACCEPTED",
        assigneeEmployeeId: recurrence.assigneeEmployeeId,
        assignedByEmployeeId: recurrence.assignedByEmployeeId,
        assignedBy: recurrence.assignedBy,
        sourceType: recurrence.sourceType,
        sourceId: `${recurrence.id}:${dateKey}`,
        requiredRoleCode: recurrence.requiredRoleCode,
        dueAt,
        acceptedAt: new Date(),
        evidence: recurrence.evidence as Prisma.InputJsonValue,
      },
    });
    await this.prisma.taskRecurrence.update({ where: { id: recurrence.id }, data: { lastGeneratedDate: dateKey } });
    if (recurrence.assignedByEmployeeId !== recurrence.assigneeEmployeeId) {
      await this.notify(task.id, recurrence.assigneeEmployeeId, "RECURRING_TASK_CREATED", "每周固定任务已生成", task.title);
    }
    return task;
  }

  @Cron("0 5 0 * * *", { timeZone: "Asia/Shanghai" })
  async generateWeeklyTasks() {
    const recurrences = await this.prisma.taskRecurrence.findMany({ where: { active: true } });
    for (const recurrence of recurrences) await this.generateRecurringTask(recurrence, new Date());
  }

  async task(session: SessionPayload, id: string) {
    const task = await this.prisma.opsTask.findFirst({
      where: { AND: [{ id }, this.taskAccess(session)] },
      include: this.taskInclude(true),
    });
    if (!task) throw new NotFoundException("任务不存在或无权查看");
    const evidenceAiTaskId = value(object(task.evidence).aiTaskId);
    const aiRequest = await this.prisma.aiTask.findFirst({
      where: {
        OR: [
          { sourceType: "WORKBENCH_CONTENT_REQUEST", sourceId: id },
          ...(evidenceAiTaskId ? [{ id: evidenceAiTaskId }] : []),
          { outputs: { some: { opsTaskId: id } } },
        ],
      },
      include: {
        product: { select: { id: true, modelCode: true, name: true } },
        owner: { select: { id: true, name: true } },
        reviewer: { select: { id: true, name: true } },
        attempts: {
          orderBy: { attemptNo: "desc" },
          select: {
            id: true,
            attemptNo: true,
            status: true,
            failureReason: true,
            startedAt: true,
            finishedAt: true,
            workerNode: { select: { displayName: true, nodeCode: true } },
          },
        },
        outputs: {
          where: { kind: { not: "OPS_TASK" } },
          orderBy: { createdAt: "desc" },
          include: {
            asset: {
              select: {
                id: true,
                assetNo: true,
                displayName: true,
                fileName: true,
                extension: true,
                mediaType: true,
                kind: true,
                width: true,
                height: true,
                durationSeconds: true,
                objectKey: true,
                storageUrl: true,
                reviewStatus: true,
                availabilityStatus: true,
              },
            },
            contentPlan: { include: { variants: true } },
          },
        },
      },
    });
    const localCodexWaiting = aiRequest?.status === "WAITING_CONFIRMATION"
      && value(object(aiRequest.input).executionClass) !== "EXTERNAL_PAID";
    const projection = this.taskProjection(task, aiRequest);
    return {
      ...task,
      projection,
      aiRequest: aiRequest
        ? {
            ...aiRequest,
            progressMessage: localCodexWaiting ? "等待管理员确认后由Codex执行" : aiRequest.progressMessage,
          }
        : null,
    };
  }

  async linkAiRequest(session: SessionPayload, taskId: string, aiTask: { id: string; taskNo: string }) {
    const task = await this.prisma.opsTask.findFirst({
      where: { id: taskId, sourceType: "SELF_CREATED", assigneeEmployeeId: session.employeeId },
    });
    if (!task) throw new NotFoundException("员工任务不存在");
    return this.prisma.opsTask.update({
      where: { id: taskId },
      data: {
        evidence: {
          ...object(task.evidence),
          aiTaskId: aiTask.id,
          aiTaskNo: aiTask.taskNo,
          requestedAt: new Date().toISOString(),
        },
        result: "已提交AI任务中心，等待Codex处理。",
      },
    });
  }

  async requestAiRevision(session: SessionPayload, taskId: string, note: string) {
    const feedback = value(note);
    if (!feedback) throw new BadRequestException("请填写需要修改的内容");
    const task = await this.prisma.opsTask.findFirst({
      where: {
        id: taskId,
        sourceType: "SELF_CREATED",
        assigneeEmployeeId: session.employeeId,
        category: { in: ["CONTENT_VIDEO", "CONTENT_IMAGE", "CONTENT_ARTICLE"] },
      },
      select: { id: true, evidence: true, status: true },
    });
    if (!task) throw new NotFoundException("AI内容任务不存在或无权反馈");
    const evidence = object(task.evidence);
    const aiTaskId = value(evidence.aiTaskId)
      || (await this.prisma.aiTask.findFirst({
        where: { sourceType: "WORKBENCH_CONTENT_REQUEST", sourceId: taskId },
        select: { id: true },
      }))?.id;
    if (!aiTaskId) throw new NotFoundException("未找到关联的AI任务");
    const previous = Array.isArray(evidence.feedback) ? evidence.feedback : [];
    await this.prisma.$transaction([
      this.prisma.taskReview.create({
        data: { taskId, action: "AI_REVISION_REQUEST", reviewer: session.name, note: feedback },
      }),
      this.prisma.operationTaskHistory.create({
        data: { taskId, fromStatus: task.status, toStatus: "ACCEPTED", action: "AI_REVISION_REQUEST", actor: session.name, note: feedback },
      }),
      this.prisma.opsTask.update({
        where: { id: taskId },
        data: {
          status: "ACCEPTED",
          result: "修改反馈已提交，等待管理员确认。",
          evidence: {
            ...evidence,
            feedback: [...previous, { note: feedback, actor: session.name, createdAt: new Date().toISOString() }],
          },
        },
      }),
    ]);
    return { aiTaskId, note: feedback };
  }

  async contentTaskOptions() {
    const [products, keywords] = await Promise.all([
      this.prisma.product.findMany({
        select: { id: true, modelCode: true, name: true, category: true, status: true },
        orderBy: [{ category: "asc" }, { modelCode: "asc" }],
        take: 120,
      }),
      this.prisma.smartKeyword.findMany({
        where: { status: "ACTIVE", contentEnabled: true },
        select: {
          id: true,
          keyword: true,
          platform: true,
          market: true,
          audience: true,
          pain: true,
          scene: true,
          opportunityScore: true,
          grade: true,
          productId: true,
        },
        orderBy: [{ pinned: "desc" }, { opportunityScore: "desc" }],
        take: 160,
      }),
    ]);
    return { products, keywords };
  }

  async contentTaskSuggestion(body: Record<string, unknown>) {
    const contentType = value(body.contentType).toUpperCase();
    if (!["SHORT_VIDEO", "IMAGE", "ARTICLE"].includes(contentType)) {
      throw new BadRequestException("请选择短视频、图片或软文");
    }
    const [product, keyword] = await Promise.all([
      value(body.productId)
        ? this.prisma.product.findUnique({ where: { id: value(body.productId) }, select: { id: true, modelCode: true, name: true, metadata: true } })
        : null,
      value(body.keywordId)
        ? this.prisma.smartKeyword.findUnique({
          where: { id: value(body.keywordId) },
          select: { id: true, keyword: true, platform: true, market: true, audience: true, pain: true, scene: true, reason: true, opportunityScore: true },
        })
        : null,
    ]);
    const productName = product ? `${product.modelCode} ${product.name}` : "赛电产品";
    const keywordText = keyword?.keyword || value(body.keyword) || "目标用户核心需求";
    const audience = keyword?.audience || "目标用户";
    const pain = keyword?.pain || "用户最关心的问题";
    const scene = keyword?.scene || "真实使用场景";
    const platform = value(body.platform) || String(keyword?.platform || "DOUYIN");
    const labels: Record<string, string> = {
      SHORT_VIDEO: "短视频",
      IMAGE: "图片",
      ARTICLE: "软文",
    };
    const deliverables: Record<string, string> = {
      SHORT_VIDEO: "输出1套选题说明、3个Hook、完整脚本、分镜、素材建议和补拍缺口。",
      IMAGE: "输出1套图片创意、画面构图、主文案、尺寸要求、现有素材建议和生成提示。",
      ARTICLE: "输出1个选题、标题候选、内容提纲、平台正文、配图建议和审核提示。",
    };
    const title = `${productName}｜${keywordText}｜${labels[contentType]}`;
    const description = [
      `围绕“${keywordText}”为${productName}制作${labels[contentType]}。`,
      `目标人群：${audience}；核心问题：${pain}；建议场景：${scene}；平台：${platform}。`,
      contentType === "SHORT_VIDEO"
        ? "优先使用素材库已审核真实素材，先做Hook、痛点、产品证明和CTA；不足再生成，仍不足再反馈补拍。"
        : contentType === "IMAGE"
          ? "优先使用产品白底图、场景图和品牌视觉资产，明确主次信息与平台尺寸。"
          : "必须引用已审核品牌知识、产品事实、FAQ和用户真实问题，分别适配平台语气。",
    ].join("\n");
    return {
      title,
      description,
      expectedResult: deliverables[contentType],
      recommendation: {
        topic: `${audience}在${scene}下如何解决“${pain}”`,
        keyword: keywordText,
        product: productName,
        platform,
        opportunityScore: Number(keyword?.opportunityScore || 0),
      },
      targetAudience: audience,
      corePain: pain,
      recommendedScene: scene,
      hook: contentType === "SHORT_VIDEO" ? `${audience}最容易忽略的“${keywordText}”问题` : "",
      promptHints: [
        `主关键词：${keywordText}`,
        `目标人群：${audience}`,
        `痛点：${pain}`,
        `场景：${scene}`,
        `产品：${productName}`,
      ],
    };
  }

  async taskOutputUrl(session: SessionPayload, taskId: string, outputId: string) {
    await this.task(session, taskId);
    const output = await this.prisma.aiTaskOutput.findFirst({
      where: { id: outputId, opsTaskId: taskId, reviewStatus: "APPROVED" },
      include: { asset: true },
    });
    if (!output) throw new NotFoundException("任务成果不存在或无权查看");
    if (output.asset && (output.asset.reviewStatus !== "APPROVED" || output.asset.availabilityStatus !== "ACTIVE")) {
      throw new NotFoundException("任务成果尚未审核通过");
    }
    if (output.asset?.objectKey) return { url: this.oss.signedDownloadUrl(output.asset.objectKey, 1_800) };
    if (output.url) return { url: output.url };
    throw new NotFoundException("任务成果暂无可预览文件");
  }

  async accept(session: SessionPayload, id: string) {
    const task = await this.prisma.opsTask.findFirst({
      where: { AND: [{ id }, this.taskAccess(session), { assigneeEmployeeId: null, status: "OPEN" }] },
    });
    if (!task) throw new BadRequestException("任务已被领取或不可领取");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.opsTask.update({
        where: { id },
        data: {
          assigneeEmployeeId: session.employeeId,
          owner: session.name,
          status: "ACCEPTED",
          acceptedAt: new Date(),
        },
      });
      await tx.operationTaskHistory.create({
        data: {
          taskId: id,
          fromStatus: "OPEN",
          toStatus: "ACCEPTED",
          action: "ACCEPT",
          actor: session.name,
        },
      });
      return updated;
    });
  }

  async start(session: SessionPayload, id: string) {
    const task = await this.ownedTask(session, id, ["ACCEPTED", "RETURNED", "OPEN"]);
    return this.transition(task, "IN_PROGRESS", "START", session.name, {
      startedAt: task.startedAt || new Date(),
      returnReason: null,
    });
  }

  async submit(session: SessionPayload, id: string, body: Record<string, unknown>) {
    const summary = value(body.summary);
    if (!summary) throw new BadRequestException("请填写任务成果说明");
    const task = await this.ownedTask(session, id, ["ACCEPTED", "IN_PROGRESS", "RETURNED"]);
    const rawPayload = body.payload && typeof body.payload === "object"
      ? body.payload as Record<string, unknown>
      : {};
    let aiOptimization: Record<string, unknown> | undefined;
    if (task.category === "LIVE_REVIEW") {
      try {
        aiOptimization = await this.bailian.generateStructuredText(
          "你是赛电直播复盘教练。根据主播提交的本场数据和复盘，给出简明、可执行的下一场优化建议。返回结构："
          + '{"summary":"","strengths":[],"problems":[],"nextActions":[{"action":"","priority":"HIGH|MEDIUM|LOW","deadline":""}],"scriptAdjustments":[],"learningTopics":[]}',
          { task: { title: task.title, description: task.description }, submission: { summary, ...rawPayload } },
        );
      } catch (error) {
        aiOptimization = {
          state: "UNAVAILABLE",
          message: error instanceof Error ? error.message : "AI直播复盘暂不可用",
        };
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const submittedStatus = task.sourceType === "SELF_CREATED" ? "COMPLETED" : "REVIEW";
      const latest = await tx.taskSubmission.aggregate({
        where: { taskId: id },
        _max: { version: true },
      });
      const submission = await tx.taskSubmission.create({
        data: {
          taskId: id,
          employeeId: session.employeeId!,
          version: (latest._max.version || 0) + 1,
          summary,
          payload: JSON.parse(JSON.stringify({
            ...rawPayload,
            ...(aiOptimization ? { aiOptimization } : {}),
          })) as Prisma.InputJsonValue,
        },
      });
      const updated = await tx.opsTask.update({
        where: { id },
        data: {
          status: submittedStatus,
          submittedAt: new Date(),
          completedAt: submittedStatus === "COMPLETED" ? new Date() : null,
          result: summary,
          returnReason: null,
        },
      });
      await tx.operationTaskHistory.create({
        data: {
          taskId: id,
          fromStatus: task.status,
          toStatus: submittedStatus,
          action: submittedStatus === "COMPLETED" ? "SELF_COMPLETE" : "SUBMIT",
          actor: session.name,
          note: summary,
          data: { submissionId: submission.id, version: submission.version },
        },
      });
      if (task.assignedByEmployeeId) {
        await tx.taskNotification.create({
          data: {
            taskId: id,
            recipientEmployeeId: task.assignedByEmployeeId,
            type: "TEAM_TASK_SUBMITTED",
            title: "协作成员已提交任务",
            content: task.title,
          },
        });
      }
      return { task: updated, submission };
    });
  }

  async operationTeam(session: SessionPayload, query: Record<string, string | undefined>) {
    this.requireCollaborator(session);
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)));
    const employeeId = session.employeeId!;
    const [employee, directReports, incoming, outgoing, operators] = await Promise.all([
      this.prisma.employee.findUnique({
        where: { id: employeeId },
        include: { supervisor: { select: { id: true, name: true, employeeNo: true } } },
      }),
      this.prisma.employee.findMany({
        where: { supervisorEmployeeId: employeeId, status: "ACTIVE" },
        select: { id: true, name: true, employeeNo: true, role: true, collaborationNote: true, roles: { select: { role: { select: { code: true, name: true } } } } },
        orderBy: { name: "asc" },
      }),
      this.prisma.employeeReportingInvite.findMany({
        where: { recipientEmployeeId: employeeId, status: "PENDING" },
        include: { sender: { select: { id: true, name: true, employeeNo: true } } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.employeeReportingInvite.findMany({
        where: { senderEmployeeId: employeeId, status: "PENDING" },
        include: { recipient: { select: { id: true, name: true, employeeNo: true } } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.employee.findMany({
        where: {
          id: { not: employeeId },
          status: "ACTIVE",
          roles: { some: { role: { code: { in: collaborationRoleCodes }, active: true } } },
        },
        select: { id: true, name: true, employeeNo: true, supervisorEmployeeId: true, roles: { select: { role: { select: { code: true, name: true } } } } },
        orderBy: { name: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      supervisor: employee?.supervisor ? { ...employee.supervisor, collaborationNote: employee.collaborationNote } : null,
      directReports,
      invitations: { incoming, outgoing },
      operators,
      pagination: { page, pageSize },
    };
  }

  async inviteOperator(session: SessionPayload, body: Record<string, unknown>) {
    this.requireOperator(session);
    const senderEmployeeId = session.employeeId!;
    const recipientEmployeeId = value(body.recipientEmployeeId);
    if (!recipientEmployeeId || recipientEmployeeId === senderEmployeeId) {
      throw new BadRequestException("请选择其他运营员工");
    }
    await this.assertActiveCollaborator(recipientEmployeeId);
    const duplicate = await this.prisma.employeeReportingInvite.findFirst({
      where: { senderEmployeeId, recipientEmployeeId, status: "PENDING" },
    });
    if (duplicate) throw new BadRequestException("已向该运营发出邀请");
    const relationshipNote = value(body.relationshipNote);
    const invite = await this.prisma.employeeReportingInvite.create({
      data: { senderEmployeeId, recipientEmployeeId, relationshipNote: relationshipNote || null },
    });
    await Promise.all([
      this.prisma.taskNotification.create({
        data: {
          recipientEmployeeId,
          type: "REPORTING_INVITE",
          title: "收到协作关系邀请",
          content: relationshipNote ? `${session.name}：${relationshipNote}` : `${session.name} 邀请你成为协作成员`,
        },
      }),
      this.audit(session.name, "REPORTING_INVITE_CREATE", "EmployeeReportingInvite", invite.id, {
        senderEmployeeId,
        recipientEmployeeId,
      }),
    ]);
    return invite;
  }

  async respondOperatorInvite(session: SessionPayload, id: string, body: Record<string, unknown>) {
    this.requireCollaborator(session);
    const action = value(body.action).toUpperCase();
    if (!["ACCEPT", "REJECT"].includes(action)) throw new BadRequestException("邀请处理动作不正确");
    const invite = await this.prisma.employeeReportingInvite.findFirst({
      where: { id, recipientEmployeeId: session.employeeId, status: "PENDING" },
      include: { sender: true, recipient: true },
    });
    if (!invite) throw new NotFoundException("邀请不存在或已处理");
    await this.assertActiveOperator(invite.senderEmployeeId);
    if (action === "ACCEPT") await this.assertNoReportingCycle(invite.senderEmployeeId, invite.recipientEmployeeId);
    return this.prisma.$transaction(async (tx) => {
      if (action === "ACCEPT") {
        await tx.employee.update({
          where: { id: invite.recipientEmployeeId },
          data: { supervisorEmployeeId: invite.senderEmployeeId, collaborationNote: invite.relationshipNote },
        });
        await tx.employeeReportingInvite.updateMany({
          where: { recipientEmployeeId: invite.recipientEmployeeId, status: "PENDING", id: { not: id } },
          data: { status: "REJECTED", respondedAt: new Date() },
        });
      }
      const updated = await tx.employeeReportingInvite.update({
        where: { id },
        data: { status: action === "ACCEPT" ? "ACCEPTED" : "REJECTED", respondedAt: new Date() },
      });
      await tx.taskNotification.create({
        data: {
          recipientEmployeeId: invite.senderEmployeeId,
          type: action === "ACCEPT" ? "REPORTING_INVITE_ACCEPTED" : "REPORTING_INVITE_REJECTED",
          title: action === "ACCEPT" ? "协作关系邀请已接受" : "协作关系邀请被拒绝",
          content: invite.recipient.name,
        },
      });
      await tx.auditLog.create({
        data: {
          actor: session.name,
          action: `REPORTING_INVITE_${action}`,
          entityType: "EmployeeReportingInvite",
          entityId: id,
          after: { senderEmployeeId: invite.senderEmployeeId, recipientEmployeeId: invite.recipientEmployeeId },
        },
      });
      return updated;
    });
  }

  async cancelOperatorInvite(session: SessionPayload, id: string) {
    this.requireOperator(session);
    const invite = await this.prisma.employeeReportingInvite.findFirst({
      where: { id, senderEmployeeId: session.employeeId, status: "PENDING" },
    });
    if (!invite) throw new NotFoundException("邀请不存在或已处理");
    const result = await this.prisma.employeeReportingInvite.updateMany({
      where: { id, senderEmployeeId: session.employeeId, status: "PENDING" },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    if (!result.count) throw new NotFoundException("邀请不存在或已处理");
    await Promise.all([
      this.prisma.taskNotification.create({
        data: { recipientEmployeeId: invite.recipientEmployeeId, type: "REPORTING_INVITE_CANCELLED", title: "协作关系邀请已撤回", content: session.name },
      }),
      this.audit(session.name, "REPORTING_INVITE_CANCEL", "EmployeeReportingInvite", id, {}),
    ]);
    return { ok: true };
  }

  async removeDirectReport(session: SessionPayload, employeeId: string) {
    this.requireOperator(session);
    const result = await this.prisma.employee.updateMany({
      where: { id: employeeId, supervisorEmployeeId: session.employeeId },
      data: { supervisorEmployeeId: null, collaborationNote: null },
    });
    if (!result.count) throw new NotFoundException("该员工不是你的协作成员");
    await Promise.all([
      this.prisma.taskNotification.create({
        data: { recipientEmployeeId: employeeId, type: "REPORTING_RELATION_REMOVED", title: "协作关系已解除", content: session.name },
      }),
      this.audit(session.name, "REPORTING_RELATION_REMOVE", "Employee", employeeId, {}),
    ]);
    return { ok: true };
  }

  async teamTasks(session: SessionPayload, query: Record<string, string | undefined>) {
    this.requireCollaborator(session);
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)));
    const received = value(query.scope).toUpperCase() === "RECEIVED";
    const where = {
      deletedAt: null,
      ...(received
        ? { assigneeEmployeeId: session.employeeId! }
        : { assignedByEmployeeId: session.employeeId! }),
      sourceType: "OPERATOR_COLLAB",
      ...(value(query.status) ? { status: value(query.status).toUpperCase() } : {}),
      ...(!received && value(query.assigneeEmployeeId) ? { assigneeEmployeeId: value(query.assigneeEmployeeId) } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.opsTask.findMany({
        where,
        include: this.taskInclude(true),
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opsTask.count({ where }),
    ]);
    return { items: this.sortTasks(items), total, page, pageSize };
  }

  async createTeamTask(session: SessionPayload, body: Record<string, unknown>) {
    this.requireOperator(session);
    const assigneeEmployeeId = value(body.assigneeEmployeeId);
    const title = value(body.title);
    if (!title || !assigneeEmployeeId) throw new BadRequestException("请选择协作运营并填写任务标题");
    const assignee = await this.prisma.employee.findFirst({
      where: {
        id: assigneeEmployeeId,
        supervisorEmployeeId: session.employeeId,
        status: "ACTIVE",
        roles: { some: { role: { code: { in: collaborationRoleCodes }, active: true } } },
      },
      include: { roles: { include: { role: true } } },
    });
    if (!assignee) throw new BadRequestException("只能给当前协作成员安排任务");
    const requiredRoleCode = collaborationRoleCodes.find((code) => assignee.roles.some((item) => item.role.active && item.role.code === code))!;
    const description = taskDocumentFields(body.descriptionDocument, body.description);
    const expectedResult = taskDocumentFields(body.expectedResultDocument, body.expectedResult);
    const weekdays = recurrenceWeekdays(body.recurrenceWeekdays);
    if (weekdays.length) {
      return this.createRecurringTask(session, {
        ...body,
        assigneeEmployeeId,
        assignedByEmployeeId: session.employeeId,
        owner: assignee.name,
        sourceType: "OPERATOR_COLLAB",
        requiredRoleCode,
        evidence: body.attachments && typeof body.attachments === "object" ? { attachments: body.attachments } : {},
      }, weekdays);
    }
    const created = await this.prisma.opsTask.create({
      data: {
        taskNo: `TEAM-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        title,
        description: description.text || null,
        descriptionDocument: description.document ? (description.document as Prisma.InputJsonValue) : undefined,
        category: "OPERATOR_COLLAB",
        priority: value(body.priority).toUpperCase() || "MEDIUM",
        status: "ACCEPTED",
        owner: assignee.name,
        assigneeEmployeeId,
        requiredRoleCode,
        assignedBy: session.name,
        assignedByEmployeeId: session.employeeId,
        sourceType: "OPERATOR_COLLAB",
        expectedResult: expectedResult.text || null,
        expectedResultDocument: expectedResult.document ? (expectedResult.document as Prisma.InputJsonValue) : undefined,
        dueAt: taskDueAt(body.dueAt),
        acceptedAt: new Date(),
        evidence: (body.attachments && typeof body.attachments === "object" ? { attachments: body.attachments } : {}) as object,
      },
      include: this.taskInclude(),
    });
    await Promise.all([
      this.prisma.operationTaskHistory.create({
        data: { taskId: created.id, toStatus: "ACCEPTED", action: "TEAM_ASSIGN", actor: session.name },
      }),
      this.notify(created.id, assigneeEmployeeId, "TEAM_TASK_ASSIGNED", "收到运营协作任务", created.title),
      this.audit(session.name, "TEAM_TASK_CREATE", "OpsTask", created.id, { assigneeEmployeeId }),
    ]);
    return created;
  }

  async reviewTeamTask(session: SessionPayload, id: string, body: Record<string, unknown>) {
    this.requireOperator(session);
    const task = await this.prisma.opsTask.findFirst({
      where: { id, deletedAt: null, assignedByEmployeeId: session.employeeId, sourceType: "OPERATOR_COLLAB" },
    });
    if (!task) throw new NotFoundException("只能审核自己安排的运营协作任务");
    return this.reviewTask(id, body, session.name);
  }

  async setTeamTaskUrgency(session: SessionPayload, id: string, urgent: boolean) {
    this.requireOperator(session);
    const task = await this.prisma.opsTask.findFirst({
      where: { id, deletedAt: null, assignedByEmployeeId: session.employeeId, sourceType: "OPERATOR_COLLAB" },
    });
    if (!task) throw new NotFoundException("只能调整自己安排的协作任务");
    if (doneStatuses.includes(task.status)) throw new BadRequestException("已完成或已取消的任务不能调整紧急状态");
    const priority = urgent ? "URGENT" : "MEDIUM";
    const updated = await this.prisma.opsTask.update({ where: { id }, data: { priority } });
    await Promise.all([
      this.prisma.operationTaskHistory.create({
        data: {
          taskId: id,
          fromStatus: task.status,
          toStatus: task.status,
          action: urgent ? "MARK_URGENT" : "CLEAR_URGENT",
          actor: session.name,
        },
      }),
      task.assigneeEmployeeId
        ? this.notify(
            id,
            task.assigneeEmployeeId,
            urgent ? "TEAM_TASK_URGENT" : "TEAM_TASK_URGENCY_CLEARED",
            urgent ? "协作任务已标记为紧急" : "协作任务已取消紧急",
            task.title,
          )
        : Promise.resolve(),
      this.audit(session.name, urgent ? "TEAM_TASK_MARK_URGENT" : "TEAM_TASK_CLEAR_URGENT", "OpsTask", id, { priority }),
    ]);
    return updated;
  }

  async updateOwnedTask(session: SessionPayload, id: string, body: Record<string, unknown>) {
    const task = await this.prisma.opsTask.findFirst({
      where: {
        id,
        deletedAt: null,
        OR: [
          { sourceType: "SELF_CREATED", assigneeEmployeeId: session.employeeId },
          { sourceType: "OPERATOR_COLLAB", assignedByEmployeeId: session.employeeId },
        ],
      },
    });
    if (!task) throw new NotFoundException("只能修改自己的自建任务或自己安排的协作任务");
    if (doneStatuses.includes(task.status)) throw new BadRequestException("已完成或已取消的任务不能修改");
    const description = body.descriptionDocument !== undefined || body.description !== undefined
      ? taskDocumentFields(body.descriptionDocument, body.description)
      : null;
    const expectedResult = body.expectedResultDocument !== undefined || body.expectedResult !== undefined
      ? taskDocumentFields(body.expectedResultDocument, body.expectedResult)
      : null;
    let reassignment: {
      assigneeEmployeeId: string;
      owner: string;
      requiredRoleCode: string;
    } | null = null;
    if (task.sourceType === "OPERATOR_COLLAB" && body.assigneeEmployeeId !== undefined) {
      const assigneeEmployeeId = value(body.assigneeEmployeeId);
      const assignee = await this.prisma.employee.findFirst({
        where: {
          id: assigneeEmployeeId,
          supervisorEmployeeId: session.employeeId,
          status: "ACTIVE",
          roles: { some: { role: { code: { in: collaborationRoleCodes }, active: true } } },
        },
        include: { roles: { include: { role: true } } },
      });
      if (!assignee) throw new BadRequestException("只能把任务调整给当前协作成员");
      reassignment = {
        assigneeEmployeeId,
        owner: assignee.name,
        requiredRoleCode: collaborationRoleCodes.find(
          (code) => assignee.roles.some((item) => item.role.active && item.role.code === code),
        )!,
      };
    }
    let evidenceUpdate: Prisma.InputJsonValue | undefined;
    if (body.evidence !== undefined && body.evidence && typeof body.evidence === "object") {
      evidenceUpdate = JSON.parse(JSON.stringify({ ...object(task.evidence), ...object(body.evidence) })) as Prisma.InputJsonValue;
    }
    if (body.attachments !== undefined && Array.isArray(body.attachments)) {
      evidenceUpdate = JSON.parse(JSON.stringify({
        ...object(task.evidence),
        ...object(body.evidence),
        attachments: body.attachments.map(value).filter(Boolean),
      })) as Prisma.InputJsonValue;
    }
    const updateData: Prisma.OpsTaskUncheckedUpdateInput = {
      ...(reassignment || {}),
      ...(body.title !== undefined ? { title: value(body.title) || task.title } : {}),
      ...(description ? {
        description: description.text || null,
        descriptionDocument: description.document ? description.document as Prisma.InputJsonValue : Prisma.JsonNull,
      } : {}),
      ...(expectedResult ? {
        expectedResult: expectedResult.text || null,
        expectedResultDocument: expectedResult.document ? expectedResult.document as Prisma.InputJsonValue : Prisma.JsonNull,
      } : {}),
      ...(body.priority !== undefined ? { priority: value(body.priority).toUpperCase() || task.priority } : {}),
      ...(body.dueAt !== undefined ? { dueAt: taskDueAt(body.dueAt) } : {}),
      ...(body.category !== undefined ? { category: value(body.category) || task.category } : {}),
      ...(body.platform !== undefined ? { platform: value(body.platform) || null } : {}),
      ...(body.productId !== undefined ? { productId: value(body.productId) || null } : {}),
      ...(evidenceUpdate ? { evidence: evidenceUpdate } : {}),
    };
    const updated = await this.prisma.opsTask.update({
      where: { id },
      data: updateData,
      include: this.taskInclude(),
    });
    await Promise.all([
      this.prisma.operationTaskHistory.create({
        data: { taskId: id, fromStatus: task.status, toStatus: task.status, action: "UPDATE", actor: session.name },
      }),
      task.sourceType === "OPERATOR_COLLAB" && task.assigneeEmployeeId
        ? this.notify(id, task.assigneeEmployeeId, "TEAM_TASK_UPDATED", "协作任务已修改", updated.title)
        : Promise.resolve(),
      task.sourceType === "OPERATOR_COLLAB"
        && reassignment
        && reassignment.assigneeEmployeeId !== task.assigneeEmployeeId
        ? this.notify(id, reassignment.assigneeEmployeeId, "TEAM_TASK_ASSIGNED", "收到调整后的协作任务", updated.title)
        : Promise.resolve(),
      this.audit(session.name, "TASK_UPDATE", "OpsTask", id, { dueAt: updated.dueAt, priority: updated.priority }),
    ]);
    return updated;
  }

  async cancelOwnedTask(session: SessionPayload, id: string) {
    const task = await this.prisma.opsTask.findFirst({
      where: {
        id,
        deletedAt: null,
        OR: [
          { sourceType: "SELF_CREATED", assigneeEmployeeId: session.employeeId },
          { sourceType: "OPERATOR_COLLAB", assignedByEmployeeId: session.employeeId },
        ],
      },
    });
    if (!task) throw new NotFoundException("只能取消自己的自建任务或自己安排的协作任务");
    if (doneStatuses.includes(task.status)) throw new BadRequestException("任务已经结束");
    const updated = await this.prisma.opsTask.update({
      where: { id },
      data: { status: "CANCELLED", completedAt: new Date(), completedBy: session.name },
    });
    await Promise.all([
      this.prisma.operationTaskHistory.create({
        data: { taskId: id, fromStatus: task.status, toStatus: "CANCELLED", action: "CANCEL", actor: session.name },
      }),
      task.sourceType === "OPERATOR_COLLAB" && task.assigneeEmployeeId
        ? this.notify(id, task.assigneeEmployeeId, "TEAM_TASK_CANCELLED", "协作任务已取消", task.title)
        : Promise.resolve(),
      this.audit(session.name, "TASK_CANCEL", "OpsTask", id, {}),
    ]);
    return updated;
  }

  async trashCancelledTask(session: SessionPayload, id: string) {
    const task = await this.prisma.opsTask.findFirst({
      where: {
        id,
        deletedAt: null,
        status: "CANCELLED",
        OR: [
          { sourceType: "SELF_CREATED", assigneeEmployeeId: session.employeeId },
          { sourceType: "OPERATOR_COLLAB", assignedByEmployeeId: session.employeeId },
        ],
      },
    });
    if (!task) throw new NotFoundException("只能删除自己已取消的自建任务或协作任务");
    const deletedAt = new Date();
    const purgeAfter = new Date(deletedAt.getTime() + 3 * 24 * 60 * 60 * 1000);
    const updated = await this.prisma.opsTask.update({
      where: { id },
      data: { deletedAt, purgeAfter, deletedByEmployeeId: session.employeeId },
      include: this.taskInclude(),
    });
    await Promise.all([
      this.prisma.operationTaskHistory.create({
        data: { taskId: id, fromStatus: task.status, toStatus: task.status, action: "TRASH", actor: session.name },
      }),
      task.sourceType === "OPERATOR_COLLAB" && task.assigneeEmployeeId
        ? this.notify(id, task.assigneeEmployeeId, "TEAM_TASK_DELETED", "协作任务已移入回收站", task.title)
        : Promise.resolve(),
      this.audit(session.name, "TASK_TRASH", "OpsTask", id, { deletedAt, purgeAfter }),
    ]);
    return updated;
  }

  async taskRecycleBin(session: SessionPayload) {
    await this.purgeExpiredTasks();
    const now = new Date();
    return this.prisma.opsTask.findMany({
      where: {
        deletedByEmployeeId: session.employeeId,
        deletedAt: { not: null },
        purgeAfter: { gt: now },
        OR: [
          { assigneeEmployeeId: session.employeeId },
          { assignedByEmployeeId: session.employeeId },
        ],
      },
      include: this.taskInclude(),
      orderBy: { deletedAt: "desc" },
      take: 200,
    });
  }

  async restoreTask(session: SessionPayload, id: string) {
    const task = await this.prisma.opsTask.findFirst({
      where: {
        id,
        deletedByEmployeeId: session.employeeId,
        deletedAt: { not: null },
        purgeAfter: { gt: new Date() },
      },
    });
    if (!task) throw new NotFoundException("回收站中未找到该任务，或任务已超过恢复期限");
    const restored = await this.prisma.opsTask.update({
      where: { id },
      data: { deletedAt: null, purgeAfter: null, deletedByEmployeeId: null },
      include: this.taskInclude(),
    });
    await Promise.all([
      this.prisma.operationTaskHistory.create({
        data: { taskId: id, fromStatus: task.status, toStatus: task.status, action: "RESTORE", actor: session.name },
      }),
      task.sourceType === "OPERATOR_COLLAB" && task.assigneeEmployeeId
        ? this.notify(id, task.assigneeEmployeeId, "TEAM_TASK_RESTORED", "协作任务已从回收站恢复", task.title)
        : Promise.resolve(),
      this.audit(session.name, "TASK_RESTORE", "OpsTask", id, {}),
    ]);
    return restored;
  }

  @Cron("0 20 0 * * *")
  async purgeExpiredTasks() {
    return this.prisma.opsTask.deleteMany({
      where: { deletedAt: { not: null }, purgeAfter: { lte: new Date() } },
    });
  }

  async notifications(session: SessionPayload) {
    const notifications = await this.prisma.taskNotification.findMany({
      where: { recipientEmployeeId: session.employeeId, channel: "IN_APP", taskId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const taskCreated = new Set(
      notifications
        .filter((item) => item.title === "AI任务已创建")
        .map((item) => `${item.content.trim()}|${item.createdAt.toISOString().slice(0, 16)}`),
    );
    return notifications
      .filter((item) => item.title !== "收到新任务"
        || !taskCreated.has(`${item.content.trim()}|${item.createdAt.toISOString().slice(0, 16)}`))
      .map((item) => ({
      ...item,
      content: this.employeeProgressMessage(item.content),
      }));
  }

  async readNotification(session: SessionPayload, id: string) {
    const notification = await this.prisma.taskNotification.findFirst({
      where: { id, recipientEmployeeId: session.employeeId, channel: "IN_APP" },
    });
    if (!notification) throw new NotFoundException("消息不存在");
    const markRead = async () => {
      const result = await this.prisma.taskNotification.updateMany({
        where: { id, recipientEmployeeId: session.employeeId, channel: "IN_APP" },
        data: { readAt: new Date() },
      });
      if (!result.count) throw new NotFoundException("消息不存在");
    };
    if (notification.taskId && notification.targetType === "OPS_TASK") {
      await markRead();
      return { ok: true, taskId: notification.taskId };
    }
    const notifiedTask = notification.taskId
      ? await this.prisma.opsTask.findFirst({
          where: { AND: [{ id: notification.taskId }, this.taskAccess(session)] },
          select: { id: true, category: true, evidence: true },
        })
      : null;
    let taskId = notifiedTask?.category === "AI_DELIVERY" ? undefined : notifiedTask?.id;
    if (!taskId && notifiedTask?.category === "AI_DELIVERY") {
      const linkedAiTaskId = notification.aiTaskId || value(object(notifiedTask.evidence).aiTaskId);
      const aiTask = linkedAiTaskId
        ? await this.prisma.aiTask.findUnique({
            where: { id: linkedAiTaskId },
            select: { sourceType: true, sourceId: true, input: true },
          })
        : null;
      const requestedTaskId = value(object(aiTask?.input).opsTaskId)
        || (aiTask?.sourceType === "WORKBENCH_CONTENT_REQUEST" ? value(aiTask.sourceId) : "");
      if (requestedTaskId) {
        taskId = (await this.prisma.opsTask.findFirst({
          where: { AND: [{ id: requestedTaskId }, this.taskAccess(session)] },
          select: { id: true },
        }))?.id;
      }
    }
    if (!taskId) throw new NotFoundException("关联任务不存在或当前不可查看");
    await markRead();
    return { ok: true, taskId };
  }

  async readAllNotifications(session: SessionPayload, ids?: unknown) {
    const selectedIds = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
    const result = await this.prisma.taskNotification.updateMany({
      where: {
        recipientEmployeeId: session.employeeId,
        channel: "IN_APP",
        readAt: null,
        ...(selectedIds.length ? { id: { in: selectedIds } } : {}),
      },
      data: { readAt: new Date() },
    });
    return { ok: true, count: result.count };
  }

  async adminOverview() {
    const [roles, employees, adminUsers, templates, taskCounts] = await Promise.all([
      this.prisma.role.findMany({ orderBy: [{ portal: "asc" }, { name: "asc" }] }),
      this.prisma.employee.findMany({
        where: { status: "ACTIVE" },
        include: { department: true, roles: { include: { role: true } } },
        orderBy: { name: "asc" },
      }),
      this.prisma.adminUser.findMany({
        include: { roles: { include: { role: true } } },
        orderBy: { username: "asc" },
      }),
      this.prisma.taskTemplate.findMany({ include: { role: true }, orderBy: { name: "asc" } }),
      this.prisma.opsTask.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
    ]);
    return { roles, employees, adminUsers, templates, taskCounts };
  }

  async adminTasks(query: Record<string, string | undefined>) {
    const status = value(query.status).toUpperCase();
    const assigneeEmployeeId = value(query.assigneeEmployeeId);
    return this.prisma.opsTask.findMany({
      where: {
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(assigneeEmployeeId ? { assigneeEmployeeId } : {}),
      },
      include: this.taskInclude(true),
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 500,
    });
  }

  async createTask(body: Record<string, unknown>, actor: string) {
    const title = value(body.title);
    const category = value(body.category) || "GENERAL";
    if (!title) throw new BadRequestException("任务标题不能为空");
    const description = taskDocumentFields(body.descriptionDocument, body.description);
    const expectedResult = taskDocumentFields(body.expectedResultDocument, body.expectedResult);
    const created = await this.prisma.opsTask.create({
      data: {
        taskNo: `TASK-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        title,
        description: description.text || null,
        descriptionDocument: description.document ? (description.document as Prisma.InputJsonValue) : undefined,
        category,
        priority: value(body.priority).toUpperCase() || "MEDIUM",
        status: value(body.assigneeEmployeeId) ? "ACCEPTED" : "OPEN",
        owner: value(body.owner) || null,
        assigneeEmployeeId: value(body.assigneeEmployeeId) || null,
        requiredRoleCode: value(body.requiredRoleCode) || null,
        assignedBy: actor,
        assignedByEmployeeId: value(body.assignedByEmployeeId) || null,
        sourceType: value(body.sourceType) || "MANUAL",
        sourceId: value(body.sourceId) || null,
        platform: value(body.platform) || null,
        productId: value(body.productId) || null,
        expectedResult: expectedResult.text || null,
        expectedResultDocument: expectedResult.document ? (expectedResult.document as Prisma.InputJsonValue) : undefined,
        dueAt: taskDueAt(body.dueAt),
        taskTemplateId: value(body.taskTemplateId) || null,
        collaborators: Array.isArray(body.collaborators) ? body.collaborators : [],
        evidence: (body.evidence && typeof body.evidence === "object" ? body.evidence : {}) as object,
      },
      include: this.taskInclude(),
    });
    await this.prisma.operationTaskHistory.create({
      data: {
        taskId: created.id,
        toStatus: created.status,
        action: "CREATE",
        actor,
      },
    });
    if (created.assigneeEmployeeId) {
      await this.notify(created.id, created.assigneeEmployeeId, "ASSIGNED", "收到新任务", created.title);
    }
    return created;
  }

  async assignTask(id: string, body: Record<string, unknown>, actor: string) {
    const employeeId = value(body.employeeId);
    if (!employeeId) throw new BadRequestException("请选择执行员工");
    const [task, employee] = await Promise.all([
      this.prisma.opsTask.findUnique({ where: { id } }),
      this.prisma.employee.findUnique({ where: { id: employeeId } }),
    ]);
    if (!task) throw new NotFoundException("任务不存在");
    if (!employee || employee.status !== "ACTIVE") throw new BadRequestException("执行员工不可用");
    const updated = await this.prisma.opsTask.update({
      where: { id },
      data: {
        assigneeEmployeeId: employeeId,
        owner: employee.name,
        assignedBy: actor,
        status: ["OPEN", "RETURNED"].includes(task.status) ? "ACCEPTED" : task.status,
        acceptedAt: new Date(),
        dueAt: date(body.dueAt) || task.dueAt,
      },
      include: this.taskInclude(),
    });
    await this.prisma.operationTaskHistory.create({
      data: {
        taskId: id,
        fromStatus: task.status,
        toStatus: updated.status,
        action: "ASSIGN",
        actor,
        note: `分配给 ${employee.name}`,
      },
    });
    await this.notify(id, employeeId, "ASSIGNED", "收到新任务", task.title);
    return updated;
  }

  async reviewTask(id: string, body: Record<string, unknown>, actor: string) {
    const action = value(body.action).toUpperCase();
    if (!["APPROVE", "RETURN"].includes(action)) throw new BadRequestException("审核动作不正确");
    const task = await this.prisma.opsTask.findUnique({
      where: { id },
      include: { submissions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!task || task.status !== "REVIEW") throw new BadRequestException("任务当前不在待审核状态");
    const note = value(body.note);
    if (action === "RETURN" && !note) throw new BadRequestException("退回时必须填写修改要求");
    const status = action === "APPROVE" ? "COMPLETED" : "RETURNED";
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.opsTask.update({
        where: { id },
        data: {
          status,
          reviewedAt: new Date(),
          reviewedBy: actor,
          reviewNote: note || null,
          returnedAt: action === "RETURN" ? new Date() : null,
          returnReason: action === "RETURN" ? note : null,
          completedAt: action === "APPROVE" ? new Date() : null,
          completedBy: action === "APPROVE" ? task.owner : null,
        },
      });
      await tx.taskReview.create({
        data: {
          taskId: id,
          submissionId: task.submissions[0]?.id,
          action,
          reviewer: actor,
          note: note || null,
        },
      });
      await tx.operationTaskHistory.create({
        data: {
          taskId: id,
          fromStatus: "REVIEW",
          toStatus: status,
          action,
          actor,
          note: note || null,
        },
      });
      if (task.assigneeEmployeeId) {
        await tx.taskNotification.create({
          data: {
            taskId: id,
            recipientEmployeeId: task.assigneeEmployeeId,
            type: action === "APPROVE" ? "APPROVED" : "RETURNED",
            title: action === "APPROVE" ? "任务审核通过" : "任务被退回",
            content: note || task.title,
          },
        });
      }
      return updated;
    });
  }

  async saveRole(body: Record<string, unknown>) {
    const code = value(body.code).toUpperCase();
    const name = value(body.name);
    if (!code || !name) throw new BadRequestException("角色编码和名称不能为空");
    return this.prisma.role.upsert({
      where: { code },
      update: {
        name,
        portal: value(body.portal).toUpperCase() || "WORKBENCH",
        permissions: Array.isArray(body.permissions) ? body.permissions.map(value).filter(Boolean) : [],
        dataScope: value(body.dataScope).toUpperCase() || "SELF",
        active: body.active !== false,
      },
      create: {
        code,
        name,
        portal: value(body.portal).toUpperCase() || "WORKBENCH",
        permissions: Array.isArray(body.permissions) ? body.permissions.map(value).filter(Boolean) : [],
        dataScope: value(body.dataScope).toUpperCase() || "SELF",
        active: body.active !== false,
      },
    });
  }

  async setEmployeeRoles(employeeId: string, roleCodes: string[]) {
    const roles = await this.prisma.role.findMany({
      where: { code: { in: roleCodes.map((item) => item.toUpperCase()) }, portal: "WORKBENCH", active: true },
    });
    return this.prisma.$transaction(async (tx) => {
      await tx.employeeRole.deleteMany({ where: { employeeId } });
      if (roles.length) {
        await tx.employeeRole.createMany({
          data: roles.map((role) => ({ employeeId, roleId: role.id })),
          skipDuplicates: true,
        });
      }
      return tx.employee.findUnique({
        where: { id: employeeId },
        include: { roles: { include: { role: true } } },
      });
    });
  }

  private taskAccess(session: SessionPayload) {
    const roleFilters = session.roles.length ? [{ requiredRoleCode: { in: session.roles } }] : [];
    return {
      AND: [
        { deletedAt: null },
        {
          OR: [
            { assigneeEmployeeId: session.employeeId },
            { owner: session.name },
            {
              AND: [
                { assigneeEmployeeId: null },
                { status: "OPEN" },
                { OR: [...roleFilters, { requiredRoleCode: null }] },
              ],
            },
          ],
        },
      ],
    };
  }

  private requireOperator(session: SessionPayload) {
    if (!session.roles.includes("CONTENT_OPERATOR")) {
      throw new BadRequestException("只有运营岗位可以使用团队协作");
    }
  }

  private requireCollaborator(session: SessionPayload) {
    if (!session.roles.some((role) => collaborationRoleCodes.includes(role))) {
      throw new BadRequestException("当前岗位不能使用运营协作");
    }
  }

  private async assertActiveOperator(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        status: "ACTIVE",
        roles: { some: { role: { code: "CONTENT_OPERATOR", active: true } } },
      },
    });
    if (!employee) throw new BadRequestException("邀请方当前不是可用的运营员工");
    return employee;
  }

  private async assertActiveCollaborator(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        status: "ACTIVE",
        roles: { some: { role: { code: { in: collaborationRoleCodes }, active: true } } },
      },
    });
    if (!employee) throw new BadRequestException("对方不是可用的运营、视频专员或设计人员");
    return employee;
  }

  private async assertNoReportingCycle(supervisorEmployeeId: string, employeeId: string) {
    let current: string | null = supervisorEmployeeId;
    const visited = new Set<string>();
    for (let depth = 0; current && depth < 50; depth += 1) {
      if (current === employeeId || visited.has(current)) throw new BadRequestException("协作关系不能形成循环");
      visited.add(current);
      const row: { supervisorEmployeeId: string | null } | null = await this.prisma.employee.findUnique({
        where: { id: current },
        select: { supervisorEmployeeId: true },
      });
      current = row?.supervisorEmployeeId || null;
    }
    if (current) throw new BadRequestException("运营层级超过系统允许的最大深度");
  }

  private audit(actor: string, action: string, entityType: string, entityId: string, after: unknown) {
    return this.prisma.auditLog.create({
      data: { actor, action, entityType, entityId, after: after as Prisma.InputJsonValue },
    });
  }

  private async ownedTask(session: SessionPayload, id: string, statuses: string[]) {
    const task = await this.prisma.opsTask.findFirst({
      where: { id, deletedAt: null, assigneeEmployeeId: session.employeeId, status: { in: statuses } },
    });
    if (!task) throw new BadRequestException("任务当前不可执行");
    return task;
  }

  private async transition(
    task: Awaited<ReturnType<WorkbenchService["ownedTask"]>>,
    toStatus: string,
    action: string,
    actor: string,
    data: Record<string, unknown>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.opsTask.update({ where: { id: task.id }, data });
      await tx.opsTask.update({ where: { id: task.id }, data: { status: toStatus } });
      await tx.operationTaskHistory.create({
        data: { taskId: task.id, fromStatus: task.status, toStatus, action, actor },
      });
      return { ...updated, status: toStatus };
    });
  }

  private async notify(taskId: string, employeeId: string, type: string, title: string, content: string) {
    const eventKey = `${taskId}:${type}`;
    await this.prisma.taskNotification.upsert({
      where: { recipientEmployeeId_channel_eventKey: { recipientEmployeeId: employeeId, channel: "IN_APP", eventKey } },
      create: {
        taskId,
        recipientEmployeeId: employeeId,
        channel: "IN_APP",
        eventKey,
        targetType: "OPS_TASK",
        targetId: taskId,
        type,
        title,
        content,
      },
      update: { title, content, taskId, targetType: "OPS_TASK", targetId: taskId },
    });
  }

  private taskInclude(full = false) {
    return {
      assignee: { select: { id: true, name: true, role: true, department: { select: { name: true } } } },
      assignedByEmployee: { select: { id: true, name: true } },
      template: true,
      attachments: { orderBy: { createdAt: "desc" as const } },
      submissions: full
        ? { include: { employee: { select: { id: true, name: true } } }, orderBy: { version: "desc" as const } }
        : { orderBy: { version: "desc" as const }, take: 1 },
      reviews: full ? { orderBy: { createdAt: "desc" as const } } : false,
      history: full ? { orderBy: { createdAt: "desc" as const } } : false,
      aiTaskOutputs: full ? {
        orderBy: { createdAt: "desc" as const },
        include: {
          asset: {
            select: {
              id: true,
              assetNo: true,
              displayName: true,
              fileName: true,
              extension: true,
              mediaType: true,
              kind: true,
              width: true,
              height: true,
              durationSeconds: true,
              objectKey: true,
              storageUrl: true,
              reviewStatus: true,
              availabilityStatus: true,
            },
          },
          contentPlan: {
            select: {
              id: true,
              topic: true,
              kind: true,
              status: true,
              variants: { select: { id: true, platform: true, title: true, body: true } },
            },
          },
          report: { select: { id: true, title: true, kind: true, summary: true, sections: true, actions: true } },
          aiTask: { select: { id: true, taskNo: true, type: true, status: true } },
        },
      } : false,
    };
  }

  private taskProjection(task: any, aiRequest: any, videoProject?: any, imageProject?: any) {
    const aiStatus = value(aiRequest?.status).toUpperCase();
    const state = {
      WAITING_CONFIRMATION: ["待后台确认", "等待管理员审核", "管理员确认后由Codex执行"],
      PENDING: ["AI处理中", "等待Codex领取", "查看AI进度"],
      CLAIMED: ["AI处理中", "Codex已领取", "查看AI进度"],
      RUNNING: ["AI处理中", "Codex正在处理", "查看AI进度"],
      QUALITY_CHECK: ["AI处理中", "正在检查成果", "查看AI进度"],
      UPLOADING: ["AI处理中", "正在上传成果", "查看AI进度"],
      PENDING_REVIEW: ["成果待审核", "等待管理员审核成果", "等待审核"],
      WAITING_INPUT: ["需补充资料", "AI缺少必要输入", "补充资料"],
      RETRY: ["正在重试", "系统正在重新执行", "查看AI进度"],
      COMPLETED: ["已完成", "成果已审核通过", "查看成果"],
      FAILED: ["执行失败", "AI执行未完成", "查看处理建议"],
      RETURNED: ["需修改", "管理员已退回", "反馈修改"],
      CANCELLED: ["已取消", "任务已取消", "无"],
    }[aiStatus] || [
      task.status === "COMPLETED" ? "已完成" : task.status === "CANCELLED" ? "已取消" : "处理中",
      "员工任务处理中",
      task.status === "COMPLETED" ? "查看成果" : "查看任务",
    ];
    const outputs = Array.isArray(aiRequest?.outputs) ? aiRequest.outputs : [];
    const deliverables = outputs
      .filter((item: any) => item.kind !== "OPS_TASK" && item.reviewStatus === "APPROVED")
      .map((item: any) => {
        const metadata = object(item.metadata);
        const previewKind = item.kind === "VIDEO_MASTER" || value(item.mimeType).startsWith("video/") ? "VIDEO"
          : value(item.mimeType).startsWith("image/") || ["IMAGE", "IMAGE_ASSET", "IMAGE_OUTPUT", "IMAGE_GENERATED", "IMAGE_MASTER"].includes(item.kind) ? "IMAGE"
            : ["ARTICLE", "ARTICLE_OUTPUT", "ARTICLE_PLAN"].includes(item.kind) ? "ARTICLE" : "DOCUMENT";
        return {
          id: item.id,
          type: item.kind,
          kind: item.kind,
          mimeType: item.mimeType,
          isFinal: deliverableOutputKinds.includes(item.kind) && metadata.isFinal !== false,
          reviewStatus: item.reviewStatus,
          previewKind,
          title: item.title,
          thumbnailUrl: value(metadata.thumbnailUrl) || null,
          downloadUrl: `/api/v1/workbench/tasks/${task.id}/outputs/${item.id}/url`,
          metadata: {
            ...metadata,
            width: item.asset?.width ?? metadata.width ?? null,
            height: item.asset?.height ?? metadata.height ?? null,
            durationSeconds: item.asset?.durationSeconds ?? metadata.durationSeconds ?? null,
          },
          version: Number(metadata.version) || 1,
          asset: item.asset || null,
          contentPlan: item.contentPlan || null,
        };
      });
    const projectProjection = videoProject ? this.videoProjectTaskProjection(videoProject)
      : imageProject ? this.imageProjectTaskProjection(imageProject) : null;
    return {
      // 视频项目任务必须与视频工厂共用项目主阶段；AI 子任务只提供进度明细，
      // 不能把已经进入脚本审核的项目继续显示成“脚本生成中”。
      displayStatus: projectProjection?.displayStatus || state[0],
      currentPhase: projectProjection?.displayStatus || state[1],
      nextAction: projectProjection?.nextAction || state[2],
      isAiManaged: Boolean(aiRequest),
      opsTask: { id: task.id, taskNo: task.taskNo, status: task.status },
      aiTask: aiRequest ? {
        id: aiRequest.id,
        taskNo: aiRequest.taskNo,
        status: aiStatus,
        progress: aiStatus === "WAITING_INPUT"
          ? Math.min(Number(aiRequest.progress) || 0, 90)
          : aiRequest.progress,
        progressMessage: this.employeeProgressMessage(aiRequest.progressMessage),
      } : null,
      deliverables,
      feedback: task.reviews || [],
      sourceLinks: { opsTaskId: task.id, aiTaskId: aiRequest?.id || null },
      project: projectProjection,
    };
  }

  private videoProjectTaskProjection(project: any) {
    const stage = value(project.productionStage).toUpperCase();
    const factory = Array.isArray(project.sourceSignals)
      ? project.sourceSignals.map(object).find((signal: Record<string, unknown>) => signal.type === "VIDEO_FACTORY") || {}
      : {};
    const brief = object(factory.brief);
    const codexDirectFullVideo = value(factory.projectMode) === "CODEX_DIRECT_FULL_VIDEO";
    const batchDirectFullVideo = value(factory.projectMode) === "BATCH_CODEX_DIRECT_FULL_VIDEO";
    const batchConfig = object(brief.batchDirect);
    const batchGenerateCoverTitle = batchDirectFullVideo && batchConfig.generateCoverTitle !== false;
    const batchStep = batchDirectFullVideo ? (batchGenerateCoverTitle ? 3 : 4) : 3;
    const batchCoverTaskId = value(factory.coverAiTaskId) || null;
    const hasReturnedPublishLink = Array.isArray(project.variants)
      && project.variants.some((variant: Record<string, unknown>) => Boolean(value(variant.manualPublishUrl)));
    const state: Record<string, [number, string, string]> = {
      PROJECT_BRIEF: [2, "脚本与素材准备中", "等待系统 AI 生成脚本并完成逐句素材匹配"],
      SCRIPT_GENERATING: [2, "脚本与素材准备中", "等待脚本和逐句素材匹配完成"],
      FACTORY_SCRIPT_READY: [2, "脚本与素材待确认", "修改脚本、处理缺失素材并确认"],
      SCRIPT_RETURNED: [2, "脚本重写与素材重匹配中", "等待系统按修改要求重新生成并匹配素材"],
      SCRIPT_APPROVED: [2, "缺失素材待处理", "上传真人补拍素材或调用 AI 生成"],
      FACTORY_GENERATING: [2, "缺失素材处理中", "等待补拍上传或 AI 生成素材完成"],
      MATERIAL_REVIEW: [2, "素材准备完成", "确认后直接进入视频生成"],
      MATERIAL_RETURNED: [2, "素材需调整", "替换不合格素材"],
      READY_TO_EDIT: [3, "可以生成视频", "提交视频生成任务"],
      EDITING: [3, "视频生成中", "查看视频生成 AI 任务进度"],
      VIDEO_REVIEW: [3, "成片待审核", "预览成片并审核或填写原因退回"],
      PLATFORM_PACKAGING: [4, "封面标题生成中", "等待平台包装生成"],
      PACKAGING_REVIEW: [4, "封面标题待审核", "审核封面与标题"],
      READY_TO_PUBLISH: [4, "待发布", "下载发布或选择自动发布"],
      PUBLISHING: [4, "发布中", "等待平台发布结果"],
      TRACKING: [4, "发布与数据跟踪", "回传或查看发布链接和数据"],
    };
    const directRevision = factory.directVideoRevision && typeof factory.directVideoRevision === "object"
      ? factory.directVideoRevision as Record<string, unknown>
      : undefined;
    // A newly returned master is authoritative.  The revision marker is only
    // workflow context for the in-flight Codex task and must never hide a
    // reviewable replacement video behind the old “修改中” message.
    const reviewableMaster = Array.isArray(project.videoRenderJobs)
      && project.videoRenderJobs.some((job: Record<string, unknown>) => {
        const asset = object(job.outputAsset);
        const reviewStatus = value(asset.reviewStatus).toUpperCase();
        return value(job.status).toUpperCase() === "SUCCEEDED"
          && Object.keys(asset).length > 0
          && !["APPROVED", "RETURNED"].includes(reviewStatus);
      });
    const directVideoReturned = codexDirectFullVideo
      && (value(project.masterVideoStatus).toUpperCase() === "RETURNED" || stage === "READY_TO_EDIT");
    const current = batchDirectFullVideo
      ? batchGenerateCoverTitle
        ? reviewableMaster
          ? [3, "成片与封面标题待审核", "审核整批成片和封面标题，或填写原因退回"]
          : ["EDITING", "FACTORY_GENERATING", "PROJECT_BRIEF"].includes(stage)
            ? [2, "批量生成中（视频+封面标题）", "查看唯一 AI 任务进度，无需员工操作"]
            : ["READY_TO_PUBLISH", "PUBLISHING", "TRACKING"].includes(stage)
              ? [3, "待回传发布链接", "逐条回传各平台发布链接"]
              : state[stage] || [2, "批量生成中", "查看唯一 AI 任务进度"]
        : ["EDITING", "FACTORY_GENERATING", "PROJECT_BRIEF"].includes(stage)
          ? [2, "批量生成视频中", "查看唯一 AI 任务进度，无需员工操作"]
          : stage === "VIDEO_REVIEW" && !batchCoverTaskId
            ? [3, "封面标题待生成", "视频已生成，提交封面标题任务"]
            : stage === "PLATFORM_PACKAGING"
              ? [3, "封面标题生成中", "等待批量封面标题任务完成"]
              : ["VIDEO_REVIEW", "PACKAGING_REVIEW"].includes(stage)
                ? [4, "成片与封面标题待审核", "审核整批成片和封面标题，或填写原因退回"]
                : ["READY_TO_PUBLISH", "PUBLISHING", "TRACKING"].includes(stage)
                  ? [4, "待回传发布链接", "逐条回传各平台发布链接"]
                  : state[stage] || [2, "批量生成中", "查看唯一 AI 任务进度"]
      : reviewableMaster
        ? [3, "成片待审核", "预览成片并审核或填写原因退回"]
        : codexDirectFullVideo && directRevision && ["EDITING", "FACTORY_GENERATING"].includes(stage)
          ? [3, "Codex 正在按退回说明修改成片", "等待 Codex 回传修改后的新成片，再次审核"]
          : directVideoReturned
            ? [3, "成片已退回", "正在准备按退回说明生成修改版本"]
            : codexDirectFullVideo && ["EDITING", "FACTORY_GENERATING"].includes(stage)
              ? [3, "Codex 直出成片中", "等待 Codex 回传最终成片，完成后审核"]
              : state[stage] || [2, "脚本处理中", "进入项目查看处理进度"];
    return {
      id: project.id,
      productionNo: project.productionNo,
      productModel: project.productModel || null,
      projectMode: value(factory.projectMode) || "SINGLE_SCRIPT_SYSTEM_FIRST",
      topic: project.topic || null,
      platform: Array.isArray(project.targetPlatforms) ? project.targetPlatforms[0] || null : null,
      videoType: value(brief.videoType) || null,
      keywords: value(brief.keywords) || null,
      batch: batchDirectFullVideo ? {
        products: Array.isArray(batchConfig.products) ? batchConfig.products : [],
        generateCoverTitle: batchGenerateCoverTitle,
        voiceoverSplit: value(batchConfig.voiceoverSplit) || "HALF",
        bgmVariety: batchConfig.bgmVariety !== false,
        voiceVariety: batchConfig.voiceVariety !== false,
        taskRequirement: value(batchConfig.taskRequirement) || null,
        publishRecords: Array.isArray(batchConfig.publishRecords) ? batchConfig.publishRecords : [],
      } : null,
      createdAt: project.createdAt || null,
      updatedAt: project.updatedAt || null,
      hasReturnedPublishLink,
      stage,
      step: current[0],
      displayStatus: current[1],
      nextAction: current[2],
    };
  }

  private imageProjectTaskProjection(project: any) {
    const stage = value(project.productionStage).toUpperCase();
    const signal = Array.isArray(project.sourceSignals)
      ? project.sourceSignals.map(object).find((item: Record<string, unknown>) => item.type === "IMAGE_PROJECT") || {}
      : {};
    const brief = object(signal.brief);
    const batchImageMode = value(brief.projectMode) === "BATCH_IMAGE_POST_PROJECT";
    const batchImageConfig = object(brief.batchDirect);
    const hasReturnedPublishLink = Array.isArray(project.variants)
      && project.variants.some((variant: Record<string, unknown>) => Boolean(value(variant.manualPublishUrl)));
    const state: Record<string, [number, string, string]> = {
      IMAGE_GENERATING: [2, "图文与文案生成中", "等待图文制作 Skill 返回图文、标题、发布文案和标签"],
      IMAGE_REVIEW: [2, "图文与文案待审核", "查看图文、标题、发布文案和标签并审核"],
      IMAGE_RETURNED: [2, "图文正在按意见修改", "等待图文制作 Skill 返回修改版本"],
      IMAGE_PUBLISHING: [3, "待发布与回传", "下载图文并回传一个或多个发布链接"],
      IMAGE_PUBLISHED: [3, "已完成", "查看已发布图文"],
    };
    const current = batchImageMode
      ? stage === "IMAGE_REVIEW"
        ? [2, "批量图文待审核", "审核整批图文、标题、标签和发布文案"]
        : ["IMAGE_PUBLISHING", "IMAGE_PUBLISHED"].includes(stage)
          ? [3, "待发布与回传", "逐组回传各平台发布链接"]
          : [2, "批量图文生成中", "等待唯一 AI 任务完成"]
      : state[stage] || [2, "图文项目处理中", "进入项目查看进度"];
    return {
      id: project.id,
      productionNo: project.productionNo,
      productModel: project.productModel || null,
      projectMode: batchImageMode ? "BATCH_IMAGE_POST_PROJECT" : "IMAGE_POST",
      topic: project.topic || null,
      platform: Array.isArray(project.targetPlatforms) ? project.targetPlatforms[0] || null : null,
      videoType: value(brief.imageType) || null,
      batch: batchImageMode ? {
        products: Array.isArray(batchImageConfig.products) ? batchImageConfig.products : [],
        typeDistribution: Array.isArray(batchImageConfig.typeDistribution) ? batchImageConfig.typeDistribution : [],
        groups: Array.isArray(batchImageConfig.groups) ? batchImageConfig.groups : [],
        taskRequirement: value(batchImageConfig.taskRequirement) || null,
        publishRecords: Array.isArray(batchImageConfig.publishRecords) ? batchImageConfig.publishRecords : [],
      } : null,
      createdAt: project.createdAt || null,
      updatedAt: project.updatedAt || null,
      hasReturnedPublishLink,
      stage,
      step: current[0],
      displayStatus: current[1],
      nextAction: current[2],
    };
  }

  private async attachTaskProjections<T extends { id: string; evidence?: Prisma.JsonValue }>(tasks: T[]) {
    if (!tasks.length) return tasks;
    const taskIds = tasks.map((task) => task.id);
    const evidenceAiTaskIds = tasks
      .map((task) => value(object(task.evidence).aiTaskId))
      .filter(Boolean);
    const aiTasks = await this.prisma.aiTask.findMany({
      where: {
        OR: [
          { sourceType: "WORKBENCH_CONTENT_REQUEST", sourceId: { in: taskIds } },
          ...(evidenceAiTaskIds.length ? [{ id: { in: evidenceAiTaskIds } }] : []),
          { outputs: { some: { opsTaskId: { in: taskIds } } } },
        ],
      },
      select: {
        id: true,
        taskNo: true,
        status: true,
        progress: true,
        progressMessage: true,
        sourceType: true,
        sourceId: true,
        input: true,
        createdAt: true,
        outputs: {
          where: { opsTaskId: { in: taskIds }, kind: { not: "OPS_TASK" } },
          select: { opsTaskId: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const videoProjectIds = tasks
      .filter((task: any) => task.sourceType === "VIDEO_PROJECT")
      .map((task: any) => task.sourceId)
      .filter(Boolean);
    const videoProjects = videoProjectIds.length
      ? await this.prisma.contentPlan.findMany({
          where: { id: { in: videoProjectIds } },
          select: {
            id: true,
            productionNo: true,
            productionStage: true,
            masterVideoStatus: true,
            productModel: true,
            targetPlatforms: true,
            sourceSignals: true,
            createdAt: true,
            variants: { select: { manualPublishUrl: true } },
            videoRenderJobs: {
              orderBy: { createdAt: "desc" },
              take: 4,
              select: { status: true, outputAsset: { select: { reviewStatus: true } } },
            },
          },
        })
      : [];
    const imageProjectIds = tasks
      .filter((task: any) => task.sourceType === "IMAGE_PROJECT")
      .map((task: any) => task.sourceId)
      .filter(Boolean);
    const imageProjects = imageProjectIds.length
      ? await this.prisma.contentPlan.findMany({
          where: { id: { in: imageProjectIds } },
          select: { id: true, productionNo: true, productionStage: true, productModel: true, targetPlatforms: true, sourceSignals: true, createdAt: true, updatedAt: true, variants: { select: { manualPublishUrl: true } } },
        })
      : [];
    const videoProjectById = new Map(videoProjects.map((project) => [project.id, project]));
    const imageProjectById = new Map(imageProjects.map((project) => [project.id, project]));
    const byTaskId = new Map<string, (typeof aiTasks)[number]>();
    for (const aiTask of aiTasks) {
      const linkedIds = new Set<string>([
        ...(aiTask.sourceType === "WORKBENCH_CONTENT_REQUEST" && aiTask.sourceId ? [aiTask.sourceId] : []),
        value(object(aiTask.input).opsTaskId),
        ...aiTask.outputs.map((output) => output.opsTaskId || ""),
      ].filter(Boolean));
      for (const taskId of linkedIds) {
        if (!byTaskId.has(taskId)) byTaskId.set(taskId, aiTask);
      }
    }
    for (const task of tasks) {
      const evidenceAiTaskId = value(object(task.evidence).aiTaskId);
      if (evidenceAiTaskId) {
        const linked = aiTasks.find((item) => item.id === evidenceAiTaskId);
        if (linked) byTaskId.set(task.id, linked);
      }
    }
    return tasks
      .filter((task) => {
        if ((task as any).sourceType === "VIDEO_PROJECT") {
          const project = videoProjectById.get((task as any).sourceId);
          return project != null && !["VIDEO_FACTORY_ARCHIVED", "VIDEO_FACTORY_PURGED"].includes(String(project.productionStage || ""));
        }
        if ((task as any).sourceType === "IMAGE_PROJECT") {
          const project = imageProjectById.get((task as any).sourceId);
          return project != null && String(project.productionStage || "") !== "IMAGE_ARCHIVED";
        }
        return true;
      })
      .map((task) => ({
      ...task,
      projection: this.taskProjection(
        task,
        byTaskId.get(task.id) || null,
        videoProjectById.get((task as any).sourceId) || null,
        imageProjectById.get((task as any).sourceId) || null,
      ),
      }));
  }

  private employeeProgressMessage(input: unknown) {
    const message = value(input);
    if (!message) return "";
    if (/(\n\s+at\s|stack|traceback|schema|jsonl|timeout|manager|exception|error:)/i.test(message)) {
      return "AI处理暂未完成，请等待系统重试或查看处理建议。";
    }
    return message.length > 240 ? `${message.slice(0, 240)}…` : message;
  }

  private quickActions(roles: string[]) {
    const actions = [{ key: "TASKS", label: "处理任务", path: "/tasks" }];
    if (roles.some((role) => ["VIDEO_SPECIALIST", "DESIGNER", "ASSET_CURATOR", "CONTENT_OPERATOR"].includes(role))) {
      actions.push({ key: "UPLOAD_ASSET", label: "上传素材", path: "/assets" });
    }
    if (roles.some((role) => ["ASSET_CURATOR", "CUSTOMER_SERVICE", "CONTENT_OPERATOR"].includes(role))) {
      actions.push({ key: "ADD_KNOWLEDGE", label: "补充知识", path: "/knowledge" });
    }
    if (roles.includes("LIVE_HOST")) {
      actions.push({ key: "LIVE_GUIDE", label: "直播学习与复盘", path: "/live" });
    }
    actions.push({ key: "MALL", label: "进入商城员工端", path: "/mall" });
    return actions;
  }

  private sortTasks<T extends {
    priority: string;
    dueAt: Date | null;
    createdAt: Date;
    updatedAt?: Date;
    sourceType?: string | null;
    category?: string | null;
  }>(tasks: T[]): T[] {
    const weight: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return [...tasks].sort((left, right) => {
      const leftProject = ["VIDEO_PROJECT", "IMAGE_PROJECT"].includes(String(left.sourceType)) || ["VIDEO_PROJECT", "IMAGE_PROJECT"].includes(String(left.category));
      const rightProject = ["VIDEO_PROJECT", "IMAGE_PROJECT"].includes(String(right.sourceType)) || ["VIDEO_PROJECT", "IMAGE_PROJECT"].includes(String(right.category));
      if (leftProject !== rightProject) return leftProject ? -1 : 1;
      if (leftProject && rightProject) {
        // Project cards are the employee's work queue. Keep newly created
        // projects above ordinary tasks and never sort them by a stale due date.
        return right.createdAt.getTime() - left.createdAt.getTime();
      }
      const priority = (weight[left.priority] ?? 9) - (weight[right.priority] ?? 9);
      if (priority) return priority;
      const due = (left.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
      return due || right.createdAt.getTime() - left.createdAt.getTime();
    });
  }

  private sameDay(left: Date, right: Date) {
    return left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate();
  }
}
