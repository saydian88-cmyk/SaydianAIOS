import { Injectable } from "@nestjs/common";
import { ContentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard() {
    const [integrationGroups, assetGroups, contentGroups, overdue, alerts, pendingReplies, activeLives, reports, jobs] = await Promise.all([
      this.prisma.integration.groupBy({ by: ["state"], _count: { _all: true } }),
      this.prisma.asset.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.contentPlan.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.shopWorkItem.count({ where: { overdue: true, completedAt: null } }),
      this.prisma.alert.count({ where: { status: "OPEN" } }),
      this.prisma.replyJob.count({ where: { status: "PENDING" } }),
      this.prisma.liveSession.count({ where: { status: "LIVE" } }),
      this.prisma.report.findMany({ orderBy: { createdAt: "desc" }, take: 6 }),
      this.prisma.automationJob.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    ]);
    const integrationMap = Object.fromEntries(integrationGroups.map((item) => [item.state, item._count._all]));
    const assetMap = Object.fromEntries(assetGroups.map((item) => [item.status, item._count._all]));
    const contentMap = Object.fromEntries(contentGroups.map((item) => [item.status, item._count._all]));
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
      latestReports: reports.map((report) => ({ id: report.id, kind: report.kind, title: report.title, summary: report.summary, createdAt: report.createdAt })),
      latestJobs: jobs,
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
