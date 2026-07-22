import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ContentKind, ContentStatus, IntegrationKind, Prisma } from "@prisma/client";
import { exec, execFile } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { opsConfig } from "./config";
import { ContentGuardService } from "./content-guard.service";
import { PlatformRegistry } from "./platform/platform.adapters";
import { PrismaService } from "./prisma.service";
import { localDateKey, makeIdempotencyKey, startOfShanghaiDay } from "./utils";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

type TopicCandidate = {
  topic: string;
  audience: string;
  objective: string;
  hook: string;
  outline: string[];
  score: number;
  scoreBreakdown: Record<string, number>;
};

const videoTopics: TopicCandidate[] = [
  {
    topic: "给父母选智能手表，先看三个使用细节",
    audience: "关注父母日常健康管理的子女",
    objective: "建立长辈友好与持续服务认知",
    hook: "给父母选表，功能多不是第一位。",
    outline: ["屏幕是否看得清", "操作是否容易学会", "遇到问题能否找到持续服务"],
    score: 92,
    scoreBreakdown: { familyScene: 30, usefulness: 25, materialFit: 22, serviceClosure: 15 },
  },
  {
    topic: "第一次帮父母连接手表，记住这四步",
    audience: "首次购买智能手表的家庭",
    objective: "降低首次使用门槛",
    hook: "别急着讲功能，先让爸妈顺利用起来。",
    outline: ["确认型号和说明书", "完成充电与开机", "按指引连接手机", "保存官方服务入口"],
    score: 88,
    scoreBreakdown: { familyScene: 28, usefulness: 28, materialFit: 18, serviceClosure: 14 },
  },
  {
    topic: "异地关心父母，可以从一份日常记录开始",
    audience: "异地工作、关注父母生活的子女",
    objective: "连接家庭关爱场景",
    hook: "关心父母，不必只停留在一句多注意身体。",
    outline: ["建立固定佩戴习惯", "按说明书完成日常记录", "异常情况及时咨询专业人员", "需要时联系官方客服"],
    score: 84,
    scoreBreakdown: { familyScene: 32, usefulness: 22, materialFit: 16, serviceClosure: 14 },
  },
];

const articleTopics: TopicCandidate[] = [
  {
    topic: "科技可以复杂，留给父母的体验应该简单",
    audience: "为父母选购智能穿戴产品的家庭",
    objective: "形成赛电家庭信任叙事",
    hook: "真正适合父母的产品，要从愿意戴、看得清、会操作开始。",
    outline: ["一个熟悉的家庭场景", "看得见的产品细节", "正确使用与日常记录", "从产品到服务品牌一直在场"],
    score: 94,
    scoreBreakdown: { searchIntent: 22, trust: 30, usefulness: 24, channelFit: 18 },
  },
  {
    topic: "收到智能手表后的第一天，先完成这份安心清单",
    audience: "智能手表新用户及家属",
    objective: "承接售前咨询与售后服务",
    hook: "先别急着研究全部功能，四件事做好就够了。",
    outline: ["核对商品与配件", "完成充电和连接", "按说明书设置", "保存客服和售后入口"],
    score: 89,
    scoreBreakdown: { searchIntent: 24, trust: 22, usefulness: 28, channelFit: 15 },
  },
  {
    topic: "给父母选一块愿意长期佩戴的智能手表",
    audience: "关注长辈使用体验的子女",
    objective: "提供选购方法并引导咨询",
    hook: "参数表很长，父母真正每天用到的往往只有几个细节。",
    outline: ["屏幕与字体", "佩戴舒适度", "操作路径", "充电续航", "售后指导"],
    score: 86,
    scoreBreakdown: { searchIntent: 27, trust: 20, usefulness: 24, channelFit: 15 },
  },
];

function articleBody(topic: TopicCandidate): string {
  return [
    topic.hook,
    "",
    "给父母选择智能穿戴产品时，真正影响长期使用的，往往不是功能数量，而是屏幕是否看得清、佩戴是否舒适、操作是否容易记住。",
    "",
    "第一次使用，可以先完成充电、开机、手机连接和常用入口设置。健康相关数据用于日常记录、提醒和健康管理参考，出现异常情况应及时咨询专业人员。",
    "",
    "从收到产品到日常使用，赛电持续提供说明、教程和客服支持。科技可以复杂，留给家庭的体验应该简单。",
  ].join("\n");
}

function videoBody(topic: TopicCandidate): string {
  return [topic.hook, ...topic.outline.map((item, index) => `${index + 1}. ${item}`), "从产品到服务，赛电一直在场。"].join("\n");
}

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: ContentGuardService,
    private readonly platforms: PlatformRegistry,
  ) {}

  async generateDaily(date = new Date(), actor = "系统内容引擎"): Promise<{ created: number; selected: string[] }> {
    const planDate = startOfShanghaiDay(date);
    const existing = await this.prisma.contentPlan.count({
      where: { planDate: { gte: planDate, lt: new Date(planDate.getTime() + 24 * 60 * 60 * 1000) } },
    });
    if (existing) return { created: 0, selected: [] };

    const selected: string[] = [];
    let created = 0;
    for (const [kind, topics] of [["VIDEO", videoTopics], ["ARTICLE", articleTopics]] as const) {
      for (let index = 0; index < topics.length; index += 1) {
        const topic = topics[index];
        const body = kind === "VIDEO" ? videoBody(topic) : articleBody(topic);
        const guard = await this.guard.evaluate({ title: topic.topic, body });
        const plan = await this.prisma.contentPlan.create({
          data: {
            planDate,
            kind,
            topic: topic.topic,
            audience: topic.audience,
            objective: topic.objective,
            score: topic.score,
            scoreBreakdown: topic.scoreBreakdown,
            hook: topic.hook,
            outline: topic.outline,
            sourceSignals: [{ source: "内容SOP", capturedAt: new Date().toISOString() }],
            evidenceIds: guard.evidenceIds,
            riskReasons: guard.reasons,
            createdBy: actor,
            status: index === 0 && guard.allowed ? "PENDING_APPROVAL" : "DRAFT",
            variants: {
              create: this.variants(kind, topic, body),
            },
          },
        });
        if (index === 0) {
          selected.push(plan.id);
          if (kind === "VIDEO") await this.writeVideoBrief(plan.id, topic, body);
        }
        created += 1;
      }
    }
    return { created, selected };
  }

  private variants(kind: ContentKind, topic: TopicCandidate, body: string): Prisma.ContentVariantCreateWithoutContentPlanInput[] {
    if (kind === "VIDEO") {
      return [
        { platform: "DOUYIN", title: topic.topic, body, mediaType: "video/mp4" },
        { platform: "WECHAT_CHANNELS", title: topic.topic, body, mediaType: "video/mp4" },
        { platform: "XIAOHONGSHU", title: `${topic.topic}｜家庭使用清单`, body, mediaType: "video/mp4" },
      ];
    }
    return [
      { platform: "WECHAT_OFFICIAL", title: topic.topic, body, mediaType: "text/markdown" },
      { platform: "XIAOHONGSHU", title: `${topic.topic}｜给父母选表`, body, mediaType: "text/markdown" },
      { platform: "WECOM", title: topic.topic, body: `${topic.hook}\n${topic.outline.slice(0, 3).join("；")}。`, mediaType: "text/plain" },
    ];
  }

  private async writeVideoBrief(planId: string, topic: TopicCandidate, body: string): Promise<void> {
    const output = resolve(opsConfig.derivedOutputDir, localDateKey(), planId);
    await mkdir(output, { recursive: true });
    const brief = [
      "---",
      "workflow: general-video",
      "flow: automation",
      "storyboard: no",
      "aspect: 9:16",
      "duration: 45s",
      "language: zh-CN",
      "---",
      "",
      `# ${topic.topic}`,
      "",
      "## Intent",
      topic.objective,
      "",
      "## Script",
      body,
      "",
      "## Assets",
      "优先从赛电品牌素材库选择与主题、型号和场景一致的已审核素材。",
      "",
      "## Verification",
      "1080x1920；MP4；音视频可解码；字幕无截断；不得出现素材来源角标。",
    ].join("\n");
    const briefPath = resolve(output, "BRIEF.md");
    await writeFile(briefPath, brief, "utf8");
    const variant = await this.prisma.contentVariant.findFirst({ where: { contentPlanId: planId, platform: "DOUYIN" } });
    if (variant) {
      await this.prisma.contentVariant.update({
        where: { id: variant.id },
        data: { metadata: { briefPath, renderState: opsConfig.videoRenderCommand ? "QUEUED" : "WAITING_RENDER_PROVIDER" } },
      });
    }
    if (opsConfig.videoRenderCommand) await this.renderVideo(planId, briefPath, output);
  }

  private async renderVideo(planId: string, briefPath: string, outputDir: string): Promise<void> {
    const outputPath = resolve(outputDir, "main.mp4");
    const quote = (value: string) => `"${value.replaceAll('"', '\\"')}"`;
    const command = opsConfig.videoRenderCommand
      .replaceAll("{brief}", quote(briefPath))
      .replaceAll("{output}", quote(outputPath))
      .replaceAll("{outputDir}", quote(outputDir))
      .replaceAll("{planId}", planId);
    try {
      await execAsync(command, { cwd: outputDir, timeout: 30 * 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
      const outputStat = await stat(outputPath);
      if (!outputStat.isFile() || outputStat.size < 1024) throw new Error("渲染结果为空或过小");
      await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", outputPath], { timeout: 30_000, windowsHide: true });
      await this.prisma.contentVariant.updateMany({
        where: { contentPlanId: planId, mediaType: "video/mp4" },
        data: { mediaPath: outputPath, metadata: { briefPath, outputPath, renderState: "READY", verifiedAt: new Date().toISOString() } },
      });
      await this.prisma.auditLog.create({ data: { actor: "系统视频渲染", action: "VIDEO_RENDERED", entityType: "ContentPlan", entityId: planId, after: { outputPath } } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "视频渲染失败";
      await this.prisma.contentVariant.updateMany({
        where: { contentPlanId: planId, mediaType: "video/mp4" },
        data: { metadata: { briefPath, renderState: "FAILED", error: message } },
      });
      await this.prisma.alert.create({ data: { level: "WARNING", category: "CONTENT", title: "每日主视频渲染失败", message, sourceType: "ContentPlan", sourceId: planId } });
    }
  }

  async approve(id: string, actor: string, note?: string) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id }, include: { variants: true } });
    if (!plan) throw new NotFoundException("内容不存在");
    const body = plan.variants.map((variant) => `${variant.title}\n${variant.body}`).join("\n");
    const guard = await this.guard.evaluate({ title: plan.topic, body, productModel: plan.productModel ?? undefined, evidenceIds: plan.evidenceIds });
    if (!guard.allowed) throw new BadRequestException(guard.reasons.join("；"));
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contentPlan.update({
        where: { id },
        data: { status: "APPROVED", approvedBy: actor, approvedAt: new Date(), riskReasons: [] },
      });
      await tx.contentVariant.updateMany({ where: { contentPlanId: id }, data: { status: "APPROVED" } });
      await tx.approval.create({ data: { contentPlanId: id, action: "APPROVE", actor, note } });
      await tx.auditLog.create({ data: { actor, action: "CONTENT_APPROVE", entityType: "ContentPlan", entityId: id, after: { status: "APPROVED" } } });
      return updated;
    });
  }

  async reject(id: string, actor: string, reason: string) {
    if (!reason.trim()) throw new BadRequestException("请填写退回原因");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contentPlan.update({ where: { id }, data: { status: "REJECTED", rejectedReason: reason } });
      await tx.contentVariant.updateMany({ where: { contentPlanId: id }, data: { status: "REJECTED" } });
      await tx.approval.create({ data: { contentPlanId: id, action: "REJECT", actor, note: reason } });
      await tx.auditLog.create({ data: { actor, action: "CONTENT_REJECT", entityType: "ContentPlan", entityId: id, after: { status: "REJECTED", reason } } });
      return updated;
    });
  }

  async queueApproved(now = new Date()): Promise<{ queued: number; skipped: Array<{ platform: string; reason: string }> }> {
    const plans = await this.prisma.contentPlan.findMany({
      where: { status: "APPROVED" },
      include: { variants: true },
    });
    let queued = 0;
    const skipped: Array<{ platform: string; reason: string }> = [];
    for (const plan of plans) {
      for (const variant of plan.variants) {
        const adapter = this.platforms.get(variant.platform as IntegrationKind);
        if (!adapter.capabilities().includes("publish")) {
          skipped.push({ platform: variant.platform, reason: "发布能力未配置" });
          continue;
        }
        if (plan.kind === "VIDEO" && !variant.mediaPath) {
          skipped.push({ platform: variant.platform, reason: "视频尚未渲染" });
          continue;
        }
        const integration = await this.prisma.integration.findUnique({ where: { kind: variant.platform } });
        if (!integration) {
          skipped.push({ platform: variant.platform, reason: "集成记录不存在" });
          continue;
        }
        const key = makeIdempotencyKey("publish", plan.id, variant.platform, localDateKey(plan.planDate));
        await this.prisma.publishJob.upsert({
          where: { idempotencyKey: key },
          create: {
            idempotencyKey: key,
            contentPlanId: plan.id,
            variantId: variant.id,
            integrationId: integration.id,
            operator: plan.approvedBy || "系统发布",
            scheduledAt: plan.scheduledAt ?? now,
          },
          update: {},
        });
        queued += 1;
      }
      if (queued) await this.prisma.contentPlan.update({ where: { id: plan.id }, data: { status: "SCHEDULED", scheduledAt: now } });
    }
    return { queued, skipped };
  }

  async processPublishJobs(limit = 10): Promise<{ processed: number; succeeded: number; failed: number }> {
    const jobs = await this.prisma.publishJob.findMany({
      where: {
        status: { in: ["PENDING", "RETRY"] },
        scheduledAt: { lte: new Date() },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      include: { variant: true, integration: true, contentPlan: true },
      take: limit,
      orderBy: { scheduledAt: "asc" },
    });
    let succeeded = 0;
    let failed = 0;
    for (const job of jobs) {
      const claimed = await this.prisma.publishJob.updateMany({ where: { id: job.id, status: job.status }, data: { status: "RUNNING", attempts: { increment: 1 } } });
      if (!claimed.count) continue;
      const adapter = this.platforms.get(job.integration.kind);
      const receipt = await adapter.publishContent({
        idempotencyKey: job.idempotencyKey,
        platform: job.integration.kind,
        contentId: job.contentPlanId,
        title: job.variant.title,
        body: job.variant.body,
        mediaUrls: job.variant.mediaPath ? [job.variant.mediaPath] : [],
        scheduledAt: job.scheduledAt.toISOString(),
      });
      if (receipt.success) {
        succeeded += 1;
        const publishedAt = new Date();
        const metricHours = [1, 3, 6, 24, 72];
        await this.prisma.$transaction([
          this.prisma.publishJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", remoteId: receipt.remoteId, remoteUrl: receipt.remoteUrl, receipt: receipt as unknown as Prisma.InputJsonValue, publishedAt } }),
          this.prisma.contentVariant.update({ where: { id: job.variantId }, data: { status: "PUBLISHED" } }),
          this.prisma.contentPlan.update({ where: { id: job.contentPlanId }, data: { status: "PUBLISHED", publishedAt } }),
          this.prisma.automationJob.createMany({
            data: metricHours.map((hours) => ({
              kind: "SYNC_METRICS",
              idempotencyKey: makeIdempotencyKey("metrics", job.id, `${hours}h`),
              payload: { publishJobId: job.id, checkpointHours: hours },
              scheduledAt: new Date(publishedAt.getTime() + hours * 60 * 60 * 1000),
            })),
            skipDuplicates: true,
          }),
        ]);
      } else {
        failed += 1;
        const attempts = job.attempts + 1;
        const minutes = [1, 5, 30][Math.min(attempts - 1, 2)];
        await this.prisma.publishJob.update({
          where: { id: job.id },
          data: attempts >= 4
            ? { status: "FAILED", lastError: receipt.message, receipt: receipt as unknown as Prisma.InputJsonValue }
            : { status: "RETRY", nextAttemptAt: new Date(Date.now() + minutes * 60_000), lastError: receipt.message, receipt: receipt as unknown as Prisma.InputJsonValue },
        });
      }
    }
    return { processed: jobs.length, succeeded, failed };
  }

  async list(status?: ContentStatus) {
    return this.prisma.contentPlan.findMany({
      where: status ? { status } : {},
      include: { variants: true, approvals: { orderBy: { createdAt: "desc" }, take: 3 } },
      orderBy: [{ planDate: "desc" }, { score: "desc" }],
      take: 100,
    });
  }
}
