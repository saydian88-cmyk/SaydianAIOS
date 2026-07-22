import { Injectable, Logger } from "@nestjs/common";
import { Cron, Interval } from "@nestjs/schedule";
import { JobStatus, Prisma } from "@prisma/client";
import { hostname } from "node:os";
import { ContentService } from "./content.service";
import { MonitoringService } from "./monitoring.service";
import { PrismaService } from "./prisma.service";
import { ReportService } from "./report.service";
import { SourceSyncService } from "./source-sync.service";
import { localDateKey, makeIdempotencyKey } from "./utils";

export const jobKinds = [
  "IMPORT_BOOTSTRAP", "SYNC_ASSETS", "SYNC_KNOWLEDGE", "CHECK_INTEGRATIONS", "SYNC_SHOP", "GENERATE_CONTENT",
  "SEND_REVIEW_NOTICE", "QUEUE_PUBLISH", "PROCESS_PUBLISH", "SYNC_COMMENTS", "SYNC_LIVE", "SYNC_METRICS",
  "DAILY_REPORT", "WEEKLY_REPORT",
] as const;
export type AutomationKind = (typeof jobKinds)[number];

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);
  private readonly workerId = `${hostname()}:${process.pid}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourceSyncService,
    private readonly content: ContentService,
    private readonly monitoring: MonitoringService,
    private readonly reports: ReportService,
  ) {}

  async enqueue(kind: AutomationKind, scheduledAt = new Date(), bucket?: string, payload: Prisma.InputJsonObject = {}) {
    const key = makeIdempotencyKey("automation", kind, bucket || scheduledAt.toISOString());
    return this.prisma.automationJob.upsert({
      where: { idempotencyKey: key },
      create: { kind, idempotencyKey: key, scheduledAt, payload },
      update: {},
    });
  }

  async enqueueDailySuite(now = new Date(), triggeredBy = "系统自动化") {
    const key = localDateKey(now);
    const kinds: AutomationKind[] = [
      "IMPORT_BOOTSTRAP", "SYNC_ASSETS", "SYNC_KNOWLEDGE", "CHECK_INTEGRATIONS", "SYNC_SHOP",
      "GENERATE_CONTENT", "SEND_REVIEW_NOTICE", "SYNC_COMMENTS", "SYNC_LIVE", "SYNC_METRICS", "DAILY_REPORT",
    ];
    for (const kind of kinds) await this.enqueue(kind, now, `${key}:${kind}`, { triggeredBy });
    return { queued: kinds.length };
  }

  @Cron("0 30 0 * * *", { timeZone: "Asia/Shanghai" })
  async scheduleSourceSync() {
    const key = localDateKey();
    for (const kind of ["IMPORT_BOOTSTRAP", "SYNC_ASSETS", "SYNC_KNOWLEDGE"] as AutomationKind[]) await this.enqueue(kind, new Date(), `${key}:${kind}`);
  }

  @Cron("0 30 5 * * *", { timeZone: "Asia/Shanghai" })
  async scheduleMorningChecks() {
    const key = localDateKey();
    for (const kind of ["CHECK_INTEGRATIONS", "SYNC_SHOP", "SYNC_METRICS"] as AutomationKind[]) await this.enqueue(kind, new Date(), `${key}:${kind}`);
  }

  @Cron("0 0 7 * * *", { timeZone: "Asia/Shanghai" })
  async scheduleContent() {
    await this.enqueue("GENERATE_CONTENT", new Date(), localDateKey());
  }

  @Cron("0 30 8 * * *", { timeZone: "Asia/Shanghai" })
  async scheduleReviewNotice() {
    await this.enqueue("SEND_REVIEW_NOTICE", new Date(), localDateKey());
  }

  @Cron("0 0 10 * * *", { timeZone: "Asia/Shanghai" })
  async schedulePublishing() {
    const key = localDateKey();
    await this.enqueue("QUEUE_PUBLISH", new Date(), `${key}:queue`);
    await this.enqueue("PROCESS_PUBLISH", new Date(Date.now() + 5_000), `${key}:publish`);
  }

  @Cron("0 */10 * * * *", { timeZone: "Asia/Shanghai" })
  async scheduleTenMinuteChecks() {
    const now = new Date();
    const bucket = `${localDateKey(now)}:${now.getUTCHours()}:${Math.floor(now.getUTCMinutes() / 10)}`;
    for (const kind of ["SYNC_COMMENTS", "SYNC_SHOP", "PROCESS_PUBLISH"] as AutomationKind[]) await this.enqueue(kind, now, `${bucket}:${kind}`);
  }

  @Cron("0 */5 * * * *", { timeZone: "Asia/Shanghai" })
  async scheduleFiveMinuteLiveChecks() {
    const now = new Date();
    const bucket = `${localDateKey(now)}:${now.getUTCHours()}:${Math.floor(now.getUTCMinutes() / 5)}`;
    await this.enqueue("SYNC_LIVE", now, `${bucket}:SYNC_LIVE`);
  }

  @Cron("0 30 23 * * *", { timeZone: "Asia/Shanghai" })
  async scheduleDailyReport() {
    await this.enqueue("DAILY_REPORT", new Date(), localDateKey());
  }

  @Cron("0 0 9 * * 1", { timeZone: "Asia/Shanghai" })
  async scheduleWeeklyReport() {
    await this.enqueue("WEEKLY_REPORT", new Date(), localDateKey());
  }

  @Interval(5_000)
  async processDueJobs() {
    const job = await this.prisma.automationJob.findFirst({
      where: {
        status: { in: ["PENDING", "RETRY"] },
        scheduledAt: { lte: new Date() },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { scheduledAt: "asc" },
    });
    if (!job) return;
    const claimed = await this.prisma.automationJob.updateMany({
      where: { id: job.id, status: job.status },
      data: { status: "RUNNING", lockedAt: new Date(), lockedBy: this.workerId, startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (!claimed.count) return;
    try {
      const payload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload as Record<string, unknown> : {};
      const result = await this.run(job.kind as AutomationKind, payload);
      await this.prisma.automationJob.update({
        where: { id: job.id },
        data: { status: "SUCCEEDED", finishedAt: new Date(), result: result as Prisma.InputJsonValue, lockedAt: null, lockedBy: null },
      });
    } catch (error) {
      const attempts = job.attempts + 1;
      const message = error instanceof Error ? error.message : "任务执行失败";
      const minutes = [1, 5, 30][Math.min(attempts - 1, 2)];
      const terminal = attempts >= job.maxAttempts;
      await this.prisma.automationJob.update({
        where: { id: job.id },
        data: terminal
          ? { status: "FAILED", finishedAt: new Date(), lastError: message, lockedAt: null, lockedBy: null }
          : { status: "RETRY", nextAttemptAt: new Date(Date.now() + minutes * 60_000), lastError: message, lockedAt: null, lockedBy: null },
      });
      if (terminal) {
        await this.prisma.alert.create({ data: { level: "WARNING", category: "AUTOMATION", title: `${job.kind}执行失败`, message, sourceType: "AutomationJob", sourceId: job.id } });
      }
      this.logger.error(`${job.kind}: ${message}`);
    }
  }

  async run(kind: AutomationKind, payload: Record<string, unknown> = {}): Promise<unknown> {
    const actor = typeof payload.triggeredBy === "string" && payload.triggeredBy.trim() ? payload.triggeredBy : "系统自动化";
    switch (kind) {
      case "IMPORT_BOOTSTRAP": return this.sources.importBootstrap();
      case "SYNC_ASSETS": return this.sources.syncAssets(actor);
      case "SYNC_KNOWLEDGE": return this.sources.syncKnowledge();
      case "CHECK_INTEGRATIONS": return this.monitoring.checkIntegrations();
      case "SYNC_SHOP": return this.monitoring.syncShopQueue();
      case "GENERATE_CONTENT": {
        const content = await this.content.generateDaily(new Date(), actor === "系统自动化" ? "系统内容引擎" : actor);
        const assets = await this.sources.syncAssets(actor);
        return { content, assets };
      }
      case "SEND_REVIEW_NOTICE": return this.reports.sendReviewNotice();
      case "QUEUE_PUBLISH": return this.content.queueApproved();
      case "PROCESS_PUBLISH": return this.content.processPublishJobs();
      case "SYNC_COMMENTS": return this.monitoring.syncComments();
      case "SYNC_LIVE": return this.monitoring.syncLive();
      case "SYNC_METRICS": return this.monitoring.syncMetrics();
      case "DAILY_REPORT": return this.reports.generateDaily();
      case "WEEKLY_REPORT": return this.reports.generateWeekly();
    }
  }
}
