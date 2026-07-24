import { Injectable } from "@nestjs/common";
import { ContentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard() {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const [integrationGroups, assetGroups, contentGroups, overdue, alerts, pendingReplies, activeLives, reports, jobs, employees, accounts, stores, unassignedSnapshots, openTasks, videoPlans, remakeTasks, assetGaps] = await Promise.all([
      this.prisma.integration.groupBy({ by: ["state"], _count: { _all: true } }),
      this.prisma.asset.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.contentPlan.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.shopWorkItem.count({ where: { overdue: true, completedAt: null } }),
      this.prisma.alert.count({ where: { status: "OPEN" } }),
      this.prisma.replyJob.count({ where: { status: "PENDING" } }),
      this.prisma.liveSession.count({ where: { status: "LIVE" } }),
      this.prisma.report.findMany({ orderBy: { createdAt: "desc" }, take: 6 }),
      this.prisma.automationJob.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
      this.prisma.employee.count({ where: { status: "ACTIVE" } }),
      this.prisma.platformAccount.count(),
      this.prisma.store.count(),
      this.prisma.businessSnapshot.count({ where: { ownerEmployeeId: null } }),
      this.prisma.opsTask.findMany({ where: { status: { not: "DONE" } }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 6 }),
      this.prisma.contentPlan.findMany({
        where: { kind: "VIDEO", planDate: { gte: dayStart, lt: dayEnd }, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED"] } },
        orderBy: [{ score: "desc" }, { createdAt: "desc" }],
        take: 6,
      }),
      this.prisma.remakeTask.findMany({
        where: { status: { in: ["PENDING_CONFIRMATION", "CONFIRMED", "ASSIGNED", "IN_PROGRESS"] } },
        orderBy: [{ score: "desc" }, { createdAt: "desc" }],
        take: 5,
      }),
      this.prisma.assetGapSnapshot.findMany({
        where: { gapCount: { gt: 0 } },
        orderBy: [{ snapshotDate: "desc" }, { gapCount: "desc" }],
        take: 5,
      }),
    ]);
    const integrationMap = Object.fromEntries(integrationGroups.map((item) => [item.state, item._count._all]));
    const assetMap = Object.fromEntries(assetGroups.map((item) => [item.status, item._count._all]));
    const contentMap = Object.fromEntries(contentGroups.map((item) => [item.status, item._count._all]));
    const todayTodos = [
      ...videoPlans.map((item) => ({
        id: `content:${item.id}`, type: "SHOOT", title: `今日拍摄：${item.topic}`,
        description: item.hook || item.objective, priority: item.score >= 85 ? "HIGH" : "MEDIUM",
        status: item.status, score: item.score, targetPage: "content", dueAt: item.planDate,
      })),
      ...remakeTasks.map((item) => ({
        id: `remake:${item.id}`, type: "VIRAL", title: `爆款仿拍：${item.title}`,
        description: item.reason, priority: item.score >= 90 ? "HIGH" : "MEDIUM",
        status: item.status, score: item.score, targetPage: "assets", dueAt: item.dueAt,
      })),
      ...assetGaps.map((item) => ({
        id: `gap:${item.id}`, type: "GAP", title: `补拍素材：${item.productModel || "通用"} · ${item.category}`,
        description: item.recommendation, priority: item.severity === "HIGH" ? "HIGH" : "MEDIUM",
        status: "OPEN", score: undefined, targetPage: "assets", dueAt: undefined,
      })),
      ...openTasks.map((item) => ({
        id: `task:${item.id}`, type: "TASK", title: item.title, description: item.category,
        priority: item.priority, status: item.status, score: undefined, targetPage: "reports", dueAt: item.dueAt,
      })),
    ].sort((left, right) => {
      const weight = (value: string) => value === "HIGH" || value === "高" ? 0 : value === "MEDIUM" || value === "中" ? 1 : 2;
      return weight(left.priority) - weight(right.priority);
    }).slice(0, 12);
    return {
      generatedAt: new Date().toISOString(),
      integrations: {
        healthy: integrationMap.HEALTHY ?? 0,
        configured: (integrationMap.CONFIGURED ?? 0) + (integrationMap.DEGRADED ?? 0),
        unconfigured: integrationMap.UNCONFIGURED ?? 0,
        error: integrationMap.ERROR ?? 0,
      },
      assets: {
        total: Object.values(assetMap).reduce((sum, value) => sum + Number(value), 0),
        ready: assetMap.READY ?? 0,
        pending: (assetMap.PENDING ?? 0) + (assetMap.DRAFT ?? 0),
        blocked: assetMap.BLOCKED ?? 0,
      },
      content: {
        draft: contentMap.DRAFT ?? 0,
        pendingApproval: contentMap.PENDING_APPROVAL ?? 0,
        approved: (contentMap.APPROVED ?? 0) + (contentMap.SCHEDULED ?? 0),
        published: contentMap.PUBLISHED ?? 0,
      },
      operations: { overdue, alerts, pendingReplies, activeLives },
      ledger: { employees, accounts, stores, unassignedSnapshots },
      latestReports: reports.map((report) => ({ id: report.id, kind: report.kind, title: report.title, summary: report.summary, createdAt: report.createdAt })),
      latestJobs: jobs,
      todayTodos,
    };
  }

  integrations() {
    return this.prisma.integration.findMany({ orderBy: [{ state: "asc" }, { displayName: "asc" }] });
  }

  assets(query: { status?: string; model?: string; mediaType?: string; take?: number }) {
    return this.prisma.asset.findMany({
      where: {
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.model ? { model: query.model } : {}),
        ...(query.mediaType ? { mediaType: query.mediaType } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: Math.min(Math.max(query.take ?? 100, 1), 500),
    });
  }

  evidence() {
    return Promise.all([
      this.prisma.evidenceClaim.findMany({ orderBy: { id: "asc" } }),
      this.prisma.productMapping.findMany({ orderBy: { commercialName: "asc" } }),
      this.prisma.phraseRule.findMany({ where: { active: true }, orderBy: [{ category: "asc" }, { blockedText: "asc" }] }),
    ]).then(([claims, mappings, phraseRules]) => ({ claims, mappings, phraseRules }));
  }

  comments() {
    return this.prisma.commentRecord.findMany({ include: { integration: true, replyJobs: true }, orderBy: { createdAtRemote: "desc" }, take: 200 });
  }

  live() {
    return this.prisma.liveSession.findMany({ include: { integration: true }, orderBy: { updatedAt: "desc" }, take: 100 });
  }

  shop() {
    return this.prisma.shopWorkItem.findMany({ include: { integration: true }, orderBy: [{ overdue: "desc" }, { updatedAt: "desc" }], take: 300 });
  }

  competitors() {
    return this.prisma.competitor.findMany({ include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 3 } }, orderBy: { name: "asc" } });
  }

  trends() {
    return this.prisma.trendSignal.findMany({ orderBy: { capturedAt: "desc" }, take: 200 });
  }

  alerts() {
    return this.prisma.alert.findMany({ orderBy: [{ status: "asc" }, { level: "desc" }, { createdAt: "desc" }], take: 300 });
  }

  tasks() {
    return this.prisma.opsTask.findMany({ orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }], take: 300 });
  }

  reports() {
    return this.prisma.report.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  }

  jobs() {
    return this.prisma.automationJob.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  }

  sops() {
    return this.prisma.sopVersion.findMany({ orderBy: [{ kind: "asc" }, { version: "desc" }] });
  }

  async resolveAlert(id: string, actor: string) {
    const result = await this.prisma.alert.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { actor, action: "ALERT_RESOLVE", entityType: "Alert", entityId: id, after: { status: "RESOLVED" } } });
    return result;
  }

  async createTask(body: Record<string, unknown>, actor: string) {
    const task = await this.prisma.opsTask.create({
      data: {
        title: String(body.title ?? "").trim(),
        category: String(body.category ?? "运营").trim(),
        priority: String(body.priority ?? "中").trim(),
        owner: body.owner ? String(body.owner) : undefined,
        dueAt: body.dueAt ? new Date(String(body.dueAt)) : undefined,
        sourceType: body.sourceType ? String(body.sourceType) : undefined,
        sourceId: body.sourceId ? String(body.sourceId) : undefined,
      },
    });
    await this.prisma.auditLog.create({ data: { actor, action: "TASK_CREATE", entityType: "OpsTask", entityId: task.id, after: task as unknown as Prisma.InputJsonValue } });
    return task;
  }

  async updateTask(id: string, body: Record<string, unknown>, actor: string) {
    const status = body.status ? String(body.status) : undefined;
    const task = await this.prisma.opsTask.update({
      where: { id },
      data: {
        ...(status ? { status, completedAt: status === "DONE" ? new Date() : null, completedBy: status === "DONE" ? actor : null } : {}),
        ...(body.owner !== undefined ? { owner: String(body.owner || "") || null } : {}),
        ...(body.result !== undefined ? { result: String(body.result || "") || null } : {}),
      },
    });
    await this.prisma.auditLog.create({ data: { actor, action: "TASK_UPDATE", entityType: "OpsTask", entityId: id, after: task as unknown as Prisma.InputJsonValue } });
    return task;
  }

  content(status?: string) {
    return this.prisma.contentPlan.findMany({
      where: status ? { status: status as ContentStatus } : {},
      include: { variants: true, approvals: { orderBy: { createdAt: "desc" }, take: 3 } },
      orderBy: [{ planDate: "desc" }, { score: "desc" }],
      take: 100,
    });
  }
}
