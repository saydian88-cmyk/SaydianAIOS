import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ContentKind, ContentStatus, IntegrationKind, Prisma } from "@prisma/client";
import { exec, execFile } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { opsConfig } from "./config";
import { AiArticlePackage, AiContentService, AiVideoCandidate } from "./ai-content.service";
import { ContentGuardService } from "./content-guard.service";
import { PlatformRegistry } from "./platform/platform.adapters";
import { PrismaService } from "./prisma.service";
import { localDateKey, makeIdempotencyKey, startOfShanghaiDay } from "./utils";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: ContentGuardService,
    private readonly aiContent: AiContentService,
    private readonly platforms: PlatformRegistry,
  ) {}

  async generateDaily(date = new Date(), actor = "系统内容引擎"): Promise<{ created: number; selected: string[] }> {
    const video = await this.generateDailyVideo(date, actor);
    const article = await this.generateDailyArticle(date, actor);
    return {
      created: video.created + article.created,
      selected: [...video.selected, ...article.selected],
    };
  }

  async generateDailyVideo(date = new Date(), actor = "系统内容引擎", productModel?: string): Promise<{ created: number; selected: string[] }> {
    const planDate = startOfShanghaiDay(date);
    const existing = await this.prisma.contentPlan.count({
      where: { kind: "VIDEO", planDate: { gte: planDate, lt: new Date(planDate.getTime() + 24 * 60 * 60 * 1000) } },
    });
    if (existing) return { created: 0, selected: [] };
    const context = await this.generationContext(productModel);
    const candidates = await this.aiContent.generateVideoCandidates(context);
    const allowedAssetIds = new Set((context.assets as Array<{ id: string }>).map((item) => item.id));
    const selected: string[] = [];
    let created = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const body = this.videoExecutionBody(candidate);
      const guard = await this.guard.evaluate({
        title: candidate.topic,
        body,
        productModel: String(context.productModel || ""),
        evidenceIds: (context.product as { evidenceIds?: string[] }).evidenceIds || [],
      });
      const assetIds = Array.from(new Set(candidate.assetIds.filter((id) => allowedAssetIds.has(id))));
      const plan = await this.prisma.contentPlan.create({
        data: {
          planDate,
          kind: "VIDEO",
          topic: candidate.topic,
          productModel: String(context.productModel || "") || null,
          audience: candidate.audience,
          objective: candidate.objective,
          score: candidate.score,
          scoreBreakdown: candidate.scoreBreakdown,
          hook: candidate.hook,
          outline: candidate.outline,
          sourceSignals: [{ externalVideoIds: candidate.referenceIds, missingAssets: candidate.missingAssets, capturedAt: new Date().toISOString() }],
          evidenceIds: guard.evidenceIds,
          riskReasons: guard.reasons,
          createdBy: actor,
          actorType: "AI",
          aiProvider: "ALIYUN_BAILIAN",
          aiModel: opsConfig.bailian.textModel,
          promptVersion: "brand-content-v2",
          status: index === 0 && guard.allowed ? "PENDING_APPROVAL" : "DRAFT",
          variants: { create: this.videoVariants(candidate) },
          contentAssets: { create: assetIds.map((assetId, assetIndex) => ({ assetId, role: assetIndex === 0 ? "PRIMARY" : "RECOMMENDED" })) },
        },
      });
      if (index === 0) {
        selected.push(plan.id);
        await this.writeVideoBrief(plan.id, candidate, body);
      }
      created += 1;
    }
    return { created, selected };
  }

  async generateDailyArticle(date = new Date(), actor = "系统内容引擎", productModel?: string): Promise<{ created: number; selected: string[] }> {
    const planDate = startOfShanghaiDay(date);
    const existing = await this.prisma.contentPlan.count({
      where: { kind: "ARTICLE", planDate: { gte: planDate, lt: new Date(planDate.getTime() + 24 * 60 * 60 * 1000) } },
    });
    if (existing) return { created: 0, selected: [] };
    const context = await this.generationContext(productModel);
    const article = await this.aiContent.generateArticle(context);
    const allowedAssetIds = new Set((context.assets as Array<{ id: string }>).map((item) => item.id));
    const knowledgeRows = context.knowledge as Array<{ id: string; evidenceIds: string[] }>;
    const allowedKnowledgeIds = new Set(knowledgeRows.map((item) => item.id));
    const assetIds = Array.from(new Set(article.assetIds.filter((id) => allowedAssetIds.has(id))));
    const citedKnowledgeIds = Array.from(new Set(article.citedKnowledgeIds.filter((id) => allowedKnowledgeIds.has(id))));
    const evidenceIds = Array.from(new Set([
      ...((context.product as { evidenceIds?: string[] }).evidenceIds || []),
      ...knowledgeRows.filter((item) => citedKnowledgeIds.includes(item.id)).flatMap((item) => item.evidenceIds || []),
    ]));
    const body = Object.values(article.variants).join("\n");
    const guard = await this.guard.evaluate({
      title: article.title || article.topic,
      body,
      productModel: String(context.productModel || ""),
      evidenceIds,
    });
    const missingEvidence = citedKnowledgeIds.length === 0;
    const plan = await this.prisma.contentPlan.create({
      data: {
        planDate,
        kind: "ARTICLE",
        topic: article.topic,
        productModel: String(context.productModel || "") || null,
        audience: article.audience,
        objective: article.objective,
        score: article.score,
        scoreBreakdown: article.scoreBreakdown,
        hook: article.hook,
        outline: article.outline,
        sourceSignals: [{ knowledgeIds: citedKnowledgeIds, keywords: article.keywords, imageSuggestions: article.imageSuggestions, capturedAt: new Date().toISOString() }],
        evidenceIds: guard.evidenceIds,
        riskReasons: [...guard.reasons, ...(missingEvidence ? ["未引用已审核知识，需人工核实"] : [])],
        createdBy: actor,
        actorType: "AI",
        aiProvider: "ALIYUN_BAILIAN",
        aiModel: opsConfig.bailian.textModel,
        promptVersion: "brand-content-v2",
        status: guard.allowed && !missingEvidence ? "PENDING_APPROVAL" : "DRAFT",
        variants: { create: this.articleVariants(article) },
        contentAssets: { create: assetIds.map((assetId, assetIndex) => ({ assetId, role: assetIndex === 0 ? "PRIMARY_IMAGE" : "SUPPORTING_IMAGE" })) },
      },
    });
    return { created: 1, selected: [plan.id] };
  }

  async dailyBrief(date = new Date()) {
    const planDate = startOfShanghaiDay(date);
    return this.prisma.contentPlan.findMany({
      where: { planDate: { gte: planDate, lt: new Date(planDate.getTime() + 24 * 60 * 60 * 1000) } },
      include: {
        variants: true,
        contentAssets: { include: { asset: { select: { id: true, assetNo: true, displayName: true, qualityScore: true, storageUrl: true } } } },
      },
      orderBy: [{ kind: "asc" }, { score: "desc" }],
    });
  }

  private videoVariants(candidate: AiVideoCandidate): Prisma.ContentVariantCreateWithoutContentPlanInput[] {
    const zhBody = `15秒脚本：\n${candidate.scripts.zh15}\n\n30秒脚本：\n${candidate.scripts.zh30}\n\n标签：${candidate.hashtags.join(" ")}`;
    const enBody = `15s Script:\n${candidate.scripts.en15}\n\n30s Script:\n${candidate.scripts.en30}\n\nTags: ${candidate.hashtags.join(" ")}`;
    return [
      { platform: "DOUYIN", title: candidate.titleZh || candidate.topic, body: zhBody, mediaType: "video/mp4", metadata: { coverText: candidate.coverTextZh, language: "zh-CN" } },
      { platform: "TIKTOK", title: candidate.titleEn || candidate.topic, body: enBody, mediaType: "video/mp4", metadata: { coverText: candidate.coverTextEn, language: "en-US" } },
      { platform: "WECHAT_CHANNELS", title: candidate.titleZh || candidate.topic, body: zhBody, mediaType: "video/mp4", metadata: { coverText: candidate.coverTextZh, language: "zh-CN" } },
    ];
  }

  private articleVariants(article: AiArticlePackage): Prisma.ContentVariantCreateWithoutContentPlanInput[] {
    return [
      { platform: "WECHAT_OFFICIAL", title: article.title || article.topic, body: article.variants.wechatOfficial, mediaType: "text/markdown", metadata: { summary: article.summary, keywords: article.keywords, cta: article.cta } },
      { platform: "XIAOHONGSHU", title: article.title || article.topic, body: article.variants.xiaohongshu, mediaType: "text/markdown", metadata: { summary: article.summary, keywords: article.keywords, cta: article.cta } },
      { platform: "WECOM", title: article.title || article.topic, body: article.variants.wecomMoments || article.variants.shortPost, mediaType: "text/plain", metadata: { summary: article.summary, keywords: article.keywords, cta: article.cta } },
    ];
  }

  private videoExecutionBody(candidate: AiVideoCandidate) {
    return [
      `Hook：${candidate.hook}`,
      `镜头：${candidate.outline.join("；")}`,
      `15秒中文：${candidate.scripts.zh15}`,
      `15秒英文：${candidate.scripts.en15}`,
      `30秒中文：${candidate.scripts.zh30}`,
      `30秒英文：${candidate.scripts.en30}`,
      `缺失素材：${candidate.missingAssets.join("；") || "无"}`,
    ].join("\n");
  }

  private async generationContext(productModel?: string): Promise<Record<string, unknown>> {
    const products = await this.prisma.product.findMany({
      where: { status: "READY" },
      include: { skus: { where: { active: true }, select: { skuCode: true, name: true } } },
      orderBy: { modelCode: "asc" },
    });
    if (!products.length) throw new BadRequestException("没有已审核产品，无法生成内容");
    const product = productModel
      ? products.find((item) => item.modelCode.toLowerCase() === productModel.toLowerCase())
      : products[new Date().getDate() % products.length];
    if (!product) throw new BadRequestException(`未找到已审核产品：${productModel}`);
    const metadata = product.metadata && typeof product.metadata === "object" && !Array.isArray(product.metadata)
      ? product.metadata as Record<string, unknown>
      : {};
    const [knowledge, faqs, assets, externalVideos] = await Promise.all([
      this.prisma.knowledgeEntry.findMany({
        where: {
          status: "READY",
          externallyUsable: true,
          OR: [{ model: null }, { model: "" }, { model: { contains: product.modelCode, mode: "insensitive" } }],
        },
        select: { id: true, type: true, title: true, summary: true, reply: true, body: true, evidenceIds: true, source: true },
        orderBy: { updatedAt: "desc" },
        take: 30,
      }),
      this.prisma.faqEntry.findMany({
        where: {
          status: "READY",
          externallyUsable: true,
          OR: [{ productId: product.id }, { productId: null }],
        },
        select: { id: true, standardQuestion: true, shortAnswer: true, detailedAnswer: true, category: true, frequency: true, source: true },
        orderBy: [{ frequency: "desc" }, { updatedAt: "desc" }],
        take: 20,
      }),
      this.prisma.asset.findMany({
        where: {
          reviewStatus: "APPROVED",
          availabilityStatus: "ACTIVE",
          rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
          qualityScore: { gte: 60 },
          OR: [
            { products: { some: { productId: product.id } } },
            { productScope: { in: ["BRAND", "COMMON"] } },
          ],
        },
        select: {
          id: true,
          assetNo: true,
          displayName: true,
          kind: true,
          level: true,
          qualityScore: true,
          contentDescription: true,
          scene: true,
          tags: { select: { tag: { select: { namespace: true, code: true, label: true } } } },
          segments: { select: { moduleType: true, startSeconds: true, endSeconds: true, transcript: true, confidence: true }, orderBy: { startSeconds: "asc" } },
        },
        orderBy: [{ qualityScore: "desc" }, { useCount: "desc" }],
        take: 20,
      }),
      this.prisma.externalVideo.findMany({
        where: { status: "READY", rightsStatus: "INTERNAL", level: "REFERENCE", availabilityStatus: "INACTIVE" },
        select: {
          id: true,
          platform: true,
          sourceUrl: true,
          title: true,
          description: true,
          moduleSummary: true,
          analysis: true,
          metrics: { orderBy: { capturedAt: "desc" }, take: 1, select: { views: true, likes: true, comments: true, shares: true, saves: true, capturedAt: true } },
          scoreSnapshots: { orderBy: { createdAt: "desc" }, take: 1, select: { score: true, grade: true, dimensions: true, explanation: true } },
        },
        orderBy: { discoveredAt: "desc" },
        take: 10,
      }),
    ]);
    return {
      productId: product.id,
      productModel: product.modelCode,
      product: {
        id: product.id,
        name: product.name,
        modelCode: product.modelCode,
        category: product.category,
        evidenceIds: product.evidenceIds,
        publicKnowledge: metadata.publicKnowledge || {},
        aliases: metadata.aliases || [],
        skus: product.skus,
      },
      knowledge,
      faqs,
      assets: assets.map((asset) => ({
        ...asset,
        tags: asset.tags.map((item) => item.tag),
        grade: asset.qualityScore >= 90 ? "S" : asset.qualityScore >= 80 ? "A" : "B",
      })),
      externalReferences: externalVideos,
      constraints: {
        ownedAssetsOnly: "仅APPROVED+ACTIVE+COMMERCIAL/EDIT_ONLY可作为商用素材",
        externalReferences: "仅供拆解和仿拍，不得直接商用",
        unsupportedFacts: "无法由已审核知识确认的型号或事实必须进入待审核",
      },
    };
  }

  private async writeVideoBrief(planId: string, topic: AiVideoCandidate, body: string): Promise<void> {
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
      `推荐素材：${topic.assetIds.join("、") || "待补充"}`,
      `参考视频：${topic.referenceIds.join("、") || "无"}`,
      `补拍缺口：${topic.missingAssets.join("；") || "无"}`,
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

  async assignVariantAccount(variantId: string, platformAccountId: string, actor: string) {
    const variant = await this.prisma.contentVariant.findUnique({ where: { id: variantId } });
    if (!variant) throw new NotFoundException("内容平台版本不存在");
    const account = await this.prisma.platformAccount.findUnique({ where: { id: platformAccountId }, include: { integration: true } });
    if (!account || account.integration.kind !== variant.platform) throw new BadRequestException("所选账号与内容平台不匹配");
    const updated = await this.prisma.contentVariant.update({ where: { id: variantId }, data: { targetAccountId: account.id } });
    await this.prisma.auditLog.create({ data: { actor, action: "CONTENT_ACCOUNT_ASSIGN", entityType: "ContentVariant", entityId: variantId, after: { platformAccountId: account.id, accountName: account.accountName } } });
    return updated;
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
        const [accounts, responsibleEmployee] = await Promise.all([
          this.prisma.platformAccount.findMany({ where: { integrationId: integration.id }, orderBy: { createdAt: "asc" } }),
          plan.approvedBy ? this.prisma.employee.findFirst({ where: { name: plan.approvedBy, status: "ACTIVE" } }) : null,
        ]);
        const platformAccount = variant.targetAccountId
          ? accounts.find((account) => account.id === variant.targetAccountId)
          : accounts.length === 1 ? accounts[0] : undefined;
        if (!platformAccount) {
          skipped.push({ platform: variant.platform, reason: accounts.length ? "存在多个账号，请指定发布账号" : "发布账号未建立责任台账" });
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
            platformAccountId: platformAccount?.id,
            operator: "系统发布",
            operatorType: "SYSTEM",
            operatorEmployeeId: responsibleEmployee?.id,
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
        const metricHours = [1, 3, 6, 24, 72, 168, 720];
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
