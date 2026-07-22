import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { opsConfig } from "./config";
import { PrismaService } from "./prisma.service";
import { startOfShanghaiDay } from "./utils";

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  async sendWecomMarkdown(title: string, markdown: string): Promise<Record<string, unknown>> {
    if (!opsConfig.wecomWebhookUrl) return { configured: false, message: "企微机器人未配置" };
    const response = await fetch(opsConfig.wecomWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msgtype: "markdown", markdown: { content: `### ${title}\n${markdown}` } }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`企微机器人返回${response.status}`);
    return result as Record<string, unknown>;
  }

  async sendReviewNotice(): Promise<Record<string, unknown>> {
    const count = await this.prisma.contentPlan.count({ where: { status: "PENDING_APPROVAL" } });
    return this.sendWecomMarkdown("赛电内容审核提醒", `今日有 **${count}** 条优选内容等待审核。\n> 请进入运营中台查看视频脚本、软文和平台版本。`);
  }

  async generateDaily(now = new Date()) {
    const from = startOfShanghaiDay(now);
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    const [assetTotal, assetOssSynced, assetOssPending, assetChanges, contentPlans, publishJobs, metricUpdates, approvals, completedTasks, alerts, overdue, replies, lives, integrations] = await Promise.all([
      this.prisma.asset.count(),
      this.prisma.asset.count({ where: { storageProvider: "ALIYUN_OSS", storageSyncedAt: { not: null } } }),
      this.prisma.asset.count({ where: { OR: [{ storageProvider: { not: "ALIYUN_OSS" } }, { storageSyncedAt: null }] } }),
      this.prisma.auditLog.findMany({
        where: { entityType: "Asset", action: { in: ["ASSET_ADDED", "ASSET_UPDATED", "ASSET_STORAGE_SYNCED"] }, createdAt: { gte: from, lt: to } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.contentPlan.findMany({
        where: { planDate: { gte: from, lt: to } },
        select: { id: true, kind: true, topic: true, status: true, createdBy: true, approvedBy: true, approvedAt: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.publishJob.findMany({
        where: { status: "SUCCEEDED", publishedAt: { gte: from, lt: to } },
        include: {
          contentPlan: { select: { kind: true, topic: true, createdBy: true, approvedBy: true } },
          variant: { select: { platform: true, title: true } },
          integration: { select: { displayName: true, kind: true } },
          metrics: { orderBy: { capturedAt: "desc" }, take: 1 },
        },
        orderBy: { publishedAt: "asc" },
      }),
      this.prisma.metricSnapshot.findMany({
        where: { capturedAt: { gte: from, lt: to } },
        include: {
          publishJob: {
            include: {
              contentPlan: { select: { topic: true } },
              variant: { select: { platform: true } },
              integration: { select: { displayName: true } },
            },
          },
        },
        orderBy: { capturedAt: "asc" },
      }),
      this.prisma.approval.findMany({
        where: { createdAt: { gte: from, lt: to } },
        include: { contentPlan: { select: { topic: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.opsTask.findMany({
        where: { completedAt: { gte: from, lt: to } },
        select: { title: true, category: true, completedBy: true, completedAt: true, result: true },
        orderBy: { completedAt: "asc" },
      }),
      this.prisma.alert.count({ where: { status: "OPEN" } }),
      this.prisma.shopWorkItem.count({ where: { overdue: true, completedAt: null } }),
      this.prisma.replyJob.count({ where: { status: "PENDING" } }),
      this.prisma.liveSession.count({ where: { status: "LIVE" } }),
      this.prisma.integration.groupBy({ by: ["state"], _count: { _all: true } }),
    ]);
    const materialRows = assetChanges.map((item) => {
      const after = item.after && typeof item.after === "object" && !Array.isArray(item.after) ? item.after as Record<string, unknown> : {};
      return {
        change: item.action === "ASSET_ADDED" ? "新增" : item.action === "ASSET_STORAGE_SYNCED" ? "同步OSS" : "更新",
        material: String(after.fileName ?? item.entityId ?? "未命名素材"),
        source: String(after.sourceType ?? "未获取"),
        model: after.model ? String(after.model) : "未识别",
        mediaType: String(after.mediaType ?? "未获取"),
        qualityScore: typeof after.qualityScore === "number" ? after.qualityScore : "未获取",
        storageProvider: String(after.storageProvider ?? "未同步"),
        objectKey: String(after.objectKey ?? "未同步"),
        storageSyncedAt: String(after.storageSyncedAt ?? "未同步"),
        storageError: after.storageError ? String(after.storageError) : "无",
        employee: item.actor,
        recordedAt: item.createdAt.toISOString(),
      };
    });
    const publishRows = publishJobs.map((job) => {
      const latest = job.metrics[0];
      return {
        content: job.contentPlan.topic,
        kind: job.contentPlan.kind,
        platform: job.variant.platform,
        account: job.integration.displayName,
        employee: job.operator,
        createdBy: job.contentPlan.createdBy,
        approvedBy: job.contentPlan.approvedBy ?? "未审核",
        publishedAt: job.publishedAt?.toISOString() ?? "未获取",
        remoteId: job.remoteId ?? "未获取",
        remoteUrl: job.remoteUrl ?? "未获取",
        views: latest?.views ?? "未获取",
        completionRate: latest?.completionRate ?? "未获取",
        likes: latest?.likes ?? "未获取",
        comments: latest?.comments ?? "未获取",
        shares: latest?.shares ?? "未获取",
        saves: latest?.saves ?? "未获取",
        consultations: latest?.consultations ?? "未获取",
        orders: latest?.orders ?? "未获取",
        metricCapturedAt: latest?.capturedAt.toISOString() ?? "未获取",
        unavailableFields: latest?.unavailableFields ?? ["播放、互动、咨询及成交数据尚未获取"],
      };
    });
    const employeeRows = [
      ...materialRows.map((item) => ({ employee: item.employee, action: `${item.change}素材`, object: item.material, occurredAt: item.recordedAt, result: `${item.storageProvider}｜${item.objectKey}` })),
      ...contentPlans.map((item) => ({ employee: item.createdBy, action: "生成内容", object: item.topic, occurredAt: item.createdAt.toISOString() })),
      ...approvals.map((item) => ({ employee: item.actor, action: item.action === "APPROVE" ? "审核通过" : "驳回内容", object: item.contentPlan.topic, occurredAt: item.createdAt.toISOString() })),
      ...completedTasks.map((item) => ({ employee: item.completedBy ?? "未记录", action: "完成任务", object: item.title, occurredAt: item.completedAt?.toISOString() ?? "未获取", result: item.result ?? "未填写" })),
    ];
    const performanceRows = metricUpdates.map((item) => ({
      content: item.publishJob?.contentPlan.topic ?? item.remoteId,
      platform: item.publishJob?.variant.platform ?? item.integrationId,
      account: item.publishJob?.integration.displayName ?? "未获取",
      views: item.views ?? "未获取",
      completionRate: item.completionRate ?? "未获取",
      likes: item.likes ?? "未获取",
      comments: item.comments ?? "未获取",
      shares: item.shares ?? "未获取",
      saves: item.saves ?? "未获取",
      consultations: item.consultations ?? "未获取",
      orders: item.orders ?? "未获取",
      employee: item.capturedBy,
      occurredAt: item.capturedAt.toISOString(),
      unavailableFields: item.unavailableFields,
    }));
    const collectedViews = publishJobs.flatMap((job) => job.metrics.slice(0, 1)).filter((item) => item.views !== null).reduce((sum, item) => sum + (item.views ?? 0), 0);
    const metricPending = publishRows.filter((item) => item.views === "未获取").length;
    const content = contentPlans.length;
    const published = publishJobs.length;
    const metrics = { assetTotal, assetOssSynced, assetOssPending, materialChanges: materialRows.length, content, published, collectedViews, metricSnapshots: performanceRows.length, metricPending, alerts, overdue, replies, lives, integrations };
    const actions: Array<Record<string, unknown>> = [];
    if (overdue) actions.push({ priority: "高", action: `处理${overdue}项超时店铺任务` });
    if (replies) actions.push({ priority: "中", action: `审核${replies}条评论建议回复` });
    if (!content) actions.push({ priority: "高", action: "补生成今日视频和软文候选" });
    if (metricPending) actions.push({ priority: "中", action: `补采${metricPending}条已发布内容的效果数据` });
    if (assetOssPending) actions.push({ priority: "高", action: `完成${assetOssPending}项素材的 OSS 同步` });
    const summary = `素材总计${assetTotal}项，已存入OSS ${assetOssSynced}项，待同步${assetOssPending}项，今日新增/更新/同步${materialRows.length}项；内容候选${content}条；发布${published}条；回收效果快照${performanceRows.length}份，今日发布已采集播放${collectedViews}次，${metricPending}条效果待获取；开放提醒${alerts}项。`;
    const sections = [
      { title: "今日素材台账", columns: ["change", "material", "source", "model", "mediaType", "qualityScore", "storageProvider", "objectKey", "storageSyncedAt", "storageError", "employee", "recordedAt"], rows: materialRows },
      { title: "今日发布与效果", columns: ["content", "kind", "platform", "account", "employee", "publishedAt", "views", "completionRate", "likes", "comments", "shares", "saves", "consultations", "orders"], rows: publishRows },
      { title: "今日效果回收", columns: ["content", "platform", "account", "views", "completionRate", "likes", "comments", "shares", "saves", "consultations", "orders", "employee", "occurredAt"], rows: performanceRows },
      { title: "员工操作记录", columns: ["employee", "action", "object", "occurredAt", "result"], rows: employeeRows },
      { title: "经营巡查", text: `超时事项${overdue}项，待审核回复${replies}条` },
      { title: "直播与提醒", text: `直播中${lives}场，开放提醒${alerts}项` },
    ];
    const report = await this.prisma.report.create({
      data: {
        kind: "DAILY",
        title: `赛电运营日报 ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium" }).format(now)}`,
        periodFrom: from,
        periodTo: to,
        summary,
        sections: sections as unknown as Prisma.InputJsonValue,
        metrics: metrics as unknown as Prisma.InputJsonValue,
        actions: actions as unknown as Prisma.InputJsonValue,
      },
    });
    const materialMarkdown = materialRows.slice(0, 10).map((item) => `- 素材：${item.change} ${item.material}｜${item.storageProvider}｜${item.employee}`).join("\n") || "- 素材：今日无新增、更新或同步";
    const publishMarkdown = publishRows.slice(0, 10).map((item) => `- 发布：${item.platform}｜${item.content}｜${item.employee}｜播放 ${item.views}`).join("\n") || "- 发布：今日无成功发布记录";
    const receipt = await this.sendWecomMarkdown(report.title, `${summary}\n\n**素材记录**\n${materialMarkdown}\n\n**发布与效果**\n${publishMarkdown}\n\n**待办**\n${actions.map((item) => `- ${item.priority}：${item.action}`).join("\n") || "- 今日暂无新增处置任务"}`);
    return this.prisma.report.update({ where: { id: report.id }, data: { sentAt: opsConfig.wecomWebhookUrl ? new Date() : null, sendReceipt: receipt as Prisma.InputJsonValue } });
  }

  async generateWeekly(now = new Date()) {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [published, metrics, competitorSnapshots, trends, alerts] = await Promise.all([
      this.prisma.contentPlan.count({ where: { publishedAt: { gte: from, lte: to } } }),
      this.prisma.metricSnapshot.findMany({ where: { capturedAt: { gte: from, lte: to } }, orderBy: { capturedAt: "asc" } }),
      this.prisma.competitorSnapshot.count({ where: { capturedAt: { gte: from, lte: to } } }),
      this.prisma.trendSignal.count({ where: { capturedAt: { gte: from, lte: to } } }),
      this.prisma.alert.count({ where: { createdAt: { gte: from, lte: to } } }),
    ]);
    const views = metrics.reduce((sum, item) => sum + (item.views ?? 0), 0);
    const summary = `近7天发布${published}条，已采集播放${views}次，竞品快照${competitorSnapshots}份，趋势信号${trends}条，新增提醒${alerts}项。`;
    const report = await this.prisma.report.create({
      data: {
        kind: "WEEKLY", title: "赛电运营周报", periodFrom: from, periodTo: to, summary,
        sections: [{ title: "内容表现", text: `发布${published}条，播放${views}次` }, { title: "市场观察", text: `竞品快照${competitorSnapshots}份，趋势信号${trends}条` }],
        metrics: { published, views, competitorSnapshots, trends, alerts },
        actions: [{ priority: "中", action: "复盘本周前20%内容并更新下周选题权重" }],
      },
    });
    const receipt = await this.sendWecomMarkdown(report.title, summary);
    return this.prisma.report.update({ where: { id: report.id }, data: { sentAt: opsConfig.wecomWebhookUrl ? new Date() : null, sendReceipt: receipt as Prisma.InputJsonValue } });
  }
}
