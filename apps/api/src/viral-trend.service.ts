import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { createHash } from "node:crypto";
import { AiContentService, type AiViralKeyword } from "./ai-content.service";
import { opsConfig } from "./config";
import { PrismaService } from "./prisma.service";
import { ViralCollectorService } from "./viral-collector.service";
import {
  VIRAL_FORMULA_VERSION,
  calculateViralComponents,
  gradeFor,
  percentileScore,
} from "./viral-trend.math";

type JsonRecord = Record<string, unknown>;

type LocalVideoItem = {
  videoId?: unknown;
  sourceUrl?: unknown;
  title?: unknown;
  description?: unknown;
  publishedAt?: unknown;
  capturedAt?: unknown;
  author?: unknown;
  authorId?: unknown;
  authorUrl?: unknown;
  avatarUrl?: unknown;
  followers?: unknown;
  views?: unknown;
  likes?: unknown;
  comments?: unknown;
  saves?: unknown;
  shares?: unknown;
  matchedKeywords?: unknown;
  raw?: unknown;
};

const keywordQuotas: Record<AiViralKeyword["type"], number> = {
  PRODUCT: 15,
  PAIN: 15,
  COMPETITOR: 10,
  SCENE: 10,
};

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function integer(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : undefined;
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/[，,;；\n]/u).map((item) => item.trim()).filter(Boolean);
}

function date(value: unknown): Date | null {
  const result = new Date(text(value));
  return Number.isNaN(result.getTime()) ? null : result;
}

function shanghaiDateStart(reference = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(reference);
  return new Date(`${day}T00:00:00+08:00`);
}

function normalizeKeyword(value: string) {
  return value.replace(/[#"“”‘’]/gu, "").replace(/\s+/gu, " ").trim().slice(0, 40);
}

function keywordType(value: unknown): AiViralKeyword["type"] {
  const result = text(value).toUpperCase();
  return ["PRODUCT", "PAIN", "COMPETITOR", "SCENE"].includes(result)
    ? result as AiViralKeyword["type"]
    : "PRODUCT";
}

function keywordPriority(value: unknown): AiViralKeyword["priority"] {
  const result = text(value).toUpperCase();
  return ["A", "B", "C"].includes(result) ? result as AiViralKeyword["priority"] : "C";
}

@Injectable()
export class ViralTrendService {
  private readonly logger = new Logger(ViralTrendService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiContent: AiContentService,
    private readonly viralCollector: ViralCollectorService,
  ) {}

  @Cron("0 30 6 * * *", { timeZone: "Asia/Shanghai" })
  async generateDailyKeywords() {
    try {
      await this.generateKeywords(false);
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : "每日爆款关键词生成失败");
    }
  }

  async todayKeywords(platform = "DOUYIN") {
    if (platform !== "DOUYIN") throw new BadRequestException("本地Chrome采集当前只支持抖音");
    const planDate = shanghaiDateStart();
    let plan = await this.prisma.viralKeywordPlan.findUnique({
      where: { platform_planDate: { platform: "DOUYIN", planDate } },
      include: { keywords: { include: { product: true }, orderBy: [{ priority: "asc" }, { type: "asc" }] } },
    });
    if (!plan) plan = await this.generateKeywords(false);
    return plan;
  }

  async generateKeywords(force = false) {
    const planDate = shanghaiDateStart();
    const existing = await this.prisma.viralKeywordPlan.findUnique({
      where: { platform_planDate: { platform: "DOUYIN", planDate } },
      include: { keywords: { include: { product: true } } },
    });
    if (existing && !force) return existing;

    const [products, faqs, knowledge, previousKeywords, integration] = await Promise.all([
      this.prisma.product.findMany({ where: { status: "READY" }, orderBy: { modelCode: "asc" } }),
      this.prisma.faqEntry.findMany({
        where: { status: "READY" },
        orderBy: [{ frequency: "desc" }, { updatedAt: "desc" }],
        take: 40,
        include: { product: true },
      }),
      this.prisma.knowledgeEntry.findMany({
        where: { status: "READY" },
        orderBy: { updatedAt: "desc" },
        take: 40,
      }),
      this.prisma.viralKeyword.findMany({
        where: { plan: { platform: "DOUYIN", planDate: { lt: planDate } } },
        orderBy: [{ hitCount: "desc" }, { updatedAt: "desc" }],
        take: 30,
        include: { product: true },
      }),
      this.prisma.integration.findUnique({ where: { kind: "DOUYIN" } }),
    ]);
    const collector = object(object(integration?.publicConfig).viralCollector);
    const competitors = strings(collector.competitorAccounts);
    const context = {
      products: products.map((product) => ({
        model: product.modelCode,
        name: product.name,
        category: product.category,
        metadata: product.metadata,
      })),
      faq: faqs.map((item) => ({
        question: item.standardQuestion,
        category: item.category,
        frequency: item.frequency,
        productModel: item.product?.modelCode,
      })),
      knowledge: knowledge.map((item) => ({
        title: item.title,
        category: item.category,
        model: item.model,
        summary: item.summary,
      })),
      competitors,
      recentEffectiveKeywords: previousKeywords.map((item) => ({
        keyword: item.keyword,
        type: item.type,
        hits: item.hitCount,
        productModel: item.product?.modelCode,
      })),
    };

    let generated: AiViralKeyword[] = [];
    try {
      generated = await this.aiContent.generateViralKeywords(context);
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : "百炼关键词生成失败，使用产品知识兜底");
    }
    const fallback = this.fallbackKeywords(products, faqs, competitors);
    const locked = previousKeywords.filter((item) => item.locked).map((item) => ({
      keyword: item.keyword,
      type: keywordType(item.type),
      priority: keywordPriority(item.priority),
      productModel: item.product?.modelCode,
      reason: item.reason || "人工锁定关键词",
      locked: true,
    }));
    const selected = this.selectKeywords([
      ...locked,
      ...generated.map((item) => ({ ...item, locked: false })),
      ...fallback.map((item) => ({ ...item, locked: false })),
    ]);
    const productByModel = new Map(products.map((product) => [product.modelCode.toUpperCase(), product]));

    const plan = await this.prisma.$transaction(async (tx) => {
      if (existing) await tx.viralKeywordPlan.delete({ where: { id: existing.id } });
      return tx.viralKeywordPlan.create({
        data: {
          platform: "DOUYIN",
          planDate,
          model: opsConfig.bailian.apiKey ? opsConfig.bailian.textModel : null,
          generation: generated.length ? "AI" : "FALLBACK",
          context: {
            productCount: products.length,
            faqCount: faqs.length,
            competitorCount: competitors.length,
            aiGeneratedCount: generated.length,
          },
          keywords: {
            create: selected.map((item) => ({
              keyword: item.keyword,
              type: item.type,
              priority: item.priority,
              reason: item.reason,
              locked: item.locked,
              productId: item.productModel
                ? productByModel.get(item.productModel.toUpperCase())?.id
                : undefined,
            })),
          },
        },
        include: { keywords: { include: { product: true }, orderBy: [{ priority: "asc" }, { type: "asc" }] } },
      });
    });
    return plan;
  }

  async updateKeyword(id: string, input: JsonRecord) {
    const keyword = await this.prisma.viralKeyword.findUnique({ where: { id } });
    if (!keyword) throw new NotFoundException("关键词不存在");
    return this.prisma.viralKeyword.update({
      where: { id },
      data: {
        locked: input.locked === undefined ? keyword.locked : Boolean(input.locked),
        priority: input.priority === undefined ? keyword.priority : keywordPriority(input.priority),
      },
    });
  }

  async heartbeat(input: JsonRecord) {
    const id = text(input.deviceId);
    if (!id) throw new BadRequestException("deviceId不能为空");
    const now = new Date();
    return this.prisma.viralCollectorDevice.upsert({
      where: { id },
      update: {
        name: text(input.name) || id,
        state: text(input.state) || "ONLINE",
        chromeLoginState: text(input.chromeLoginState) || "UNKNOWN",
        agentVersion: text(input.agentVersion) || undefined,
        lastHeartbeatAt: now,
        lastCollectionAt: date(input.lastCollectionAt) || undefined,
        lastSyncAt: date(input.lastSyncAt) || undefined,
        metadata: object(input.metadata) as never,
      },
      create: {
        id,
        name: text(input.name) || id,
        platform: "DOUYIN",
        state: text(input.state) || "ONLINE",
        chromeLoginState: text(input.chromeLoginState) || "UNKNOWN",
        agentVersion: text(input.agentVersion) || undefined,
        lastHeartbeatAt: now,
        lastCollectionAt: date(input.lastCollectionAt) || undefined,
        lastSyncAt: date(input.lastSyncAt) || undefined,
        metadata: object(input.metadata) as never,
      },
    });
  }

  async ingestBatch(input: JsonRecord, actor: string) {
    const batchId = text(input.batchId);
    const deviceId = text(input.deviceId);
    const items = Array.isArray(input.items) ? input.items.slice(0, 1000) as LocalVideoItem[] : [];
    if (!batchId || !deviceId) throw new BadRequestException("batchId和deviceId不能为空");
    if (!items.length) throw new BadRequestException("采集批次没有视频");
    const duplicate = await this.prisma.viralCollectionBatch.findUnique({ where: { batchId } });
    if (duplicate?.status === "IMPORTED") {
      return { batchId, duplicate: true, imported: duplicate.importedCount, rejected: duplicate.rejectedCount };
    }
    await this.heartbeat({
      deviceId,
      name: input.deviceName,
      state: "ONLINE",
      chromeLoginState: "LOGGED_IN",
      agentVersion: input.agentVersion,
      lastCollectionAt: input.completedAt,
      metadata: { actor },
    });
    const batch = await this.prisma.viralCollectionBatch.upsert({
      where: { batchId },
      update: { status: "PROCESSING", itemCount: items.length, errorMessage: null },
      create: {
        batchId,
        deviceId,
        platform: "DOUYIN",
        keyword: text(input.keyword) || undefined,
        status: "PROCESSING",
        startedAt: date(input.startedAt) || new Date(),
        completedAt: date(input.completedAt) || undefined,
        itemCount: items.length,
        raw: { agentVersion: text(input.agentVersion) } as never,
      },
    });
    const plan = await this.todayKeywords("DOUYIN");
    const keywordMap = new Map(plan.keywords.map((item) => [item.keyword.toLowerCase(), item]));
    let imported = 0;
    let rejected = 0;
    const importedVideoIds = new Set<string>();

    for (const item of items) {
      try {
        const result = await this.ingestItem(item, keywordMap);
        if (!result) {
          rejected += 1;
          continue;
        }
        imported += 1;
        importedVideoIds.add(result.externalVideoId);
      } catch (error) {
        rejected += 1;
        this.logger.warn(error instanceof Error ? error.message : "抖音视频入库失败");
      }
    }
    await this.recalculateCohorts();
    const sVideos = await this.prisma.externalVideo.findMany({
      where: {
        id: { in: [...importedVideoIds] },
        metrics: { some: { viralGrade: "S" } },
      },
      include: { resolveJob: true },
    });
    for (const video of sVideos) {
      if (!video.sourceObjectKey && !video.resolveJob) {
        await this.viralCollector.resolveReference(video.id, true).catch((error) => {
          this.logger.warn(error instanceof Error ? error.message : "S级视频媒体解析提交失败");
        });
      }
    }
    await this.prisma.viralCollectionBatch.update({
      where: { id: batch.id },
      data: {
        status: "IMPORTED",
        completedAt: date(input.completedAt) || new Date(),
        importedCount: imported,
        rejectedCount: rejected,
      },
    });
    await this.prisma.viralCollectorDevice.update({
      where: { id: deviceId },
      data: { lastSyncAt: new Date(), lastCollectionAt: date(input.completedAt) || new Date() },
    });
    return { batchId, duplicate: false, imported, rejected };
  }

  async trends(query: JsonRecord = {}) {
    const take = Math.min(Math.max(integer(query.take) || 100, 1), 300);
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const videos = await this.prisma.externalVideo.findMany({
      where: {
        platform: "DOUYIN",
        publishedAt: { gte: since },
        ...(text(query.grade) ? { metrics: { some: { viralGrade: text(query.grade) } } } : {}),
      },
      include: {
        author: true,
        metrics: { orderBy: { capturedAt: "desc" }, take: 12 },
        keywordHits: { include: { keyword: { include: { product: true } } } },
        scoreSnapshots: { orderBy: { createdAt: "desc" }, take: 1 },
        resolveJob: true,
      },
      take,
    });
    const items = videos
      .map((video) => ({ ...video, latestMetric: video.metrics[0] || null }))
      .sort((left, right) => Number(right.latestMetric?.viralIndex || 0) - Number(left.latestMetric?.viralIndex || 0));
    const devices = await this.prisma.viralCollectorDevice.findMany({
      where: { platform: "DOUYIN" },
      orderBy: { lastHeartbeatAt: "desc" },
    });
    const candidateCount = items.filter((item) => Number(item.latestMetric?.playVelocity || 0) > 10_000).length;
    return {
      summary: {
        total: items.length,
        candidates: candidateCount,
        sGrade: items.filter((item) => item.latestMetric?.viralGrade === "S").length,
        aGrade: items.filter((item) => item.latestMetric?.viralGrade === "A").length,
        lastSyncAt: devices[0]?.lastSyncAt || null,
      },
      devices: devices.map((device) => ({
        ...device,
        state: device.lastHeartbeatAt && Date.now() - device.lastHeartbeatAt.getTime() < 10 * 60 * 1000
          ? device.state
          : "OFFLINE",
      })),
      items,
    };
  }

  async timeline(id: string) {
    const video = await this.prisma.externalVideo.findUnique({
      where: { id },
      include: {
        author: { include: { snapshots: { orderBy: { capturedAt: "asc" } } } },
        metrics: { orderBy: { capturedAt: "asc" } },
        keywordHits: { include: { keyword: true } },
      },
    });
    if (!video) throw new NotFoundException("视频不存在");
    return video;
  }

  analyze(id: string) {
    return this.viralCollector.resolveReference(id, true);
  }

  private fallbackKeywords(
    products: Array<{ modelCode: string; name: string; category: string; metadata: unknown }>,
    faqs: Array<{ standardQuestion: string; product?: { modelCode: string } | null }>,
    competitors: string[],
  ): AiViralKeyword[] {
    const result: AiViralKeyword[] = [];
    for (const product of products) {
      result.push({
        keyword: `${product.modelCode} ${product.category}`.trim(),
        type: "PRODUCT",
        priority: result.length < 10 ? "A" : "B",
        productModel: product.modelCode,
        reason: "已审核产品型号与品类",
      });
      const metadata = object(product.metadata);
      for (const scene of strings(metadata.scenes).slice(0, 2)) {
        result.push({
          keyword: scene,
          type: "SCENE",
          priority: "C",
          productModel: product.modelCode,
          reason: `${product.modelCode}适用场景`,
        });
      }
    }
    for (const faq of faqs.slice(0, 20)) {
      result.push({
        keyword: faq.standardQuestion.replace(/[？?]/gu, "").slice(0, 30),
        type: "PAIN",
        priority: "B",
        productModel: faq.product?.modelCode,
        reason: "高频用户问题",
      });
    }
    for (const competitor of competitors.slice(0, 10)) {
      result.push({ keyword: competitor, type: "COMPETITOR", priority: "B", reason: "竞品观察名单" });
    }
    return result;
  }

  private selectKeywords(
    source: Array<AiViralKeyword & { locked: boolean }>,
  ) {
    const counts: Record<AiViralKeyword["type"], number> = { PRODUCT: 0, PAIN: 0, COMPETITOR: 0, SCENE: 0 };
    const priorities: Record<AiViralKeyword["priority"], number> = { A: 0, B: 0, C: 0 };
    const seen = new Set<string>();
    const result: Array<AiViralKeyword & { locked: boolean }> = [];
    for (const entry of source) {
      const keyword = normalizeKeyword(entry.keyword);
      const type = keywordType(entry.type);
      let priority = keywordPriority(entry.priority);
      const key = keyword.toLowerCase();
      if (!keyword || seen.has(key) || counts[type] >= keywordQuotas[type] || result.length >= 50) continue;
      if (priority === "A" && priorities.A >= 10) priority = "B";
      if (priority === "B" && priorities.B >= 20) priority = "C";
      seen.add(key);
      counts[type] += 1;
      priorities[priority] += 1;
      result.push({ ...entry, keyword, type, priority });
    }
    return result;
  }

  private async ingestItem(
    item: LocalVideoItem,
    keywordMap: Map<string, Awaited<ReturnType<ViralTrendService["todayKeywords"]>>["keywords"][number]>,
  ) {
    const videoId = text(item.videoId);
    const sourceUrl = text(item.sourceUrl) || (videoId ? `https://www.douyin.com/video/${videoId}` : "");
    const publishedAt = date(item.publishedAt);
    const capturedAt = date(item.capturedAt) || new Date();
    if (!videoId || !sourceUrl || !publishedAt) return null;
    const age = (capturedAt.getTime() - publishedAt.getTime()) / 3_600_000;
    if (age < -0.25 || age > 12) return null;
    const followers = integer(item.followers);
    const authorName = text(item.author) || "未识别作者";
    const externalAuthorId = text(item.authorId)
      || createHash("sha256").update(authorName).digest("hex").slice(0, 24);
    const previousAuthorSnapshot = await this.prisma.viralAuthorMetricSnapshot.findFirst({
      where: { author: { platform: "DOUYIN", externalAuthorId }, capturedAt: { lt: capturedAt } },
      orderBy: { capturedAt: "desc" },
    });
    const followerDelta = followers !== undefined && previousAuthorSnapshot?.followers !== null
      && previousAuthorSnapshot?.followers !== undefined
      ? followers - previousAuthorSnapshot.followers
      : undefined;
    const author = await this.prisma.viralAuthor.upsert({
      where: { platform_externalAuthorId: { platform: "DOUYIN", externalAuthorId } },
      update: {
        nickname: authorName,
        profileUrl: text(item.authorUrl) || undefined,
        avatarUrl: text(item.avatarUrl) || undefined,
        latestFollowers: followers,
        lastSeenAt: capturedAt,
      },
      create: {
        platform: "DOUYIN",
        externalAuthorId,
        nickname: authorName,
        profileUrl: text(item.authorUrl) || undefined,
        avatarUrl: text(item.avatarUrl) || undefined,
        latestFollowers: followers,
        firstSeenAt: capturedAt,
        lastSeenAt: capturedAt,
      },
    });
    await this.prisma.viralAuthorMetricSnapshot.upsert({
      where: { authorId_capturedAt: { authorId: author.id, capturedAt } },
      update: { followers, followerDelta, raw: object(item.raw) as never },
      create: { authorId: author.id, capturedAt, followers, followerDelta, raw: object(item.raw) as never },
    });
    const video = await this.prisma.externalVideo.upsert({
      where: { platform_externalContentId: { platform: "DOUYIN", externalContentId: videoId } },
      update: {
        sourceUrl,
        authorId: author.id,
        accountName: authorName,
        title: text(item.title) || undefined,
        description: text(item.description) || undefined,
        publishedAt,
      },
      create: {
        platform: "DOUYIN",
        externalContentId: videoId,
        sourceUrl,
        authorId: author.id,
        accountName: authorName,
        title: text(item.title) || videoId,
        description: text(item.description) || undefined,
        publishedAt,
        level: "REFERENCE",
        rightsStatus: "INTERNAL",
        availabilityStatus: "INACTIVE",
      },
    });
    const matched = strings(item.matchedKeywords);
    const keywordRows = matched.map((entry) => keywordMap.get(entry.toLowerCase())).filter(Boolean);
    for (const keyword of keywordRows) {
      await this.prisma.viralVideoKeywordHit.upsert({
        where: { externalVideoId_keywordId: { externalVideoId: video.id, keywordId: keyword!.id } },
        update: { lastSeenAt: capturedAt, hitCount: { increment: 1 } },
        create: { externalVideoId: video.id, keywordId: keyword!.id, firstSeenAt: capturedAt, lastSeenAt: capturedAt },
      });
      await this.prisma.viralKeyword.update({
        where: { id: keyword!.id },
        data: { hitCount: { increment: 1 }, lastCollectedAt: capturedAt },
      });
    }
    const authorVideoCount = await this.prisma.externalVideo.count({
      where: { authorId: author.id, publishedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    });
    const authorHitCount = await this.prisma.externalVideo.count({
      where: {
        authorId: author.id,
        publishedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        metrics: { some: { viralGrade: { in: ["S", "A"] } } },
      },
    });
    const recentHitRate = authorVideoCount ? authorHitCount / authorVideoCount : 0;
    const metrics = calculateViralComponents({
      capturedAt,
      publishedAt,
      views: integer(item.views),
      likes: integer(item.likes),
      comments: integer(item.comments),
      saves: integer(item.saves),
      shares: integer(item.shares),
      followers,
      recentHitRate,
    });
    const productCategory = keywordRows.find((entry) => entry?.product)?.product?.category || "通用";
    await this.prisma.externalMetricSnapshot.upsert({
      where: { externalVideoId_capturedAt: { externalVideoId: video.id, capturedAt } },
      update: {},
      create: {
        externalVideoId: video.id,
        capturedAt,
        views: integer(item.views),
        likes: integer(item.likes),
        comments: integer(item.comments),
        shares: integer(item.shares),
        saves: integer(item.saves),
        followers,
        authorFollowerDelta: followerDelta,
        ...metrics,
        formulaVersion: VIRAL_FORMULA_VERSION,
        unavailableFields: ["views", "likes", "comments", "shares", "saves", "followers"]
          .filter((key) => integer(item[key as keyof LocalVideoItem]) === undefined),
        raw: {
          source: "LOCAL_CHROME",
          productCategory,
          matchedKeywords: matched,
          collectorRaw: object(item.raw),
        } as never,
      },
    });
    return { externalVideoId: video.id };
  }

  private async recalculateCohorts() {
    const start = shanghaiDateStart();
    const rows = await this.prisma.externalMetricSnapshot.findMany({
      where: { capturedAt: { gte: start }, externalVideo: { platform: "DOUYIN" } },
    });
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const category = text(object(row.raw).productCategory) || "通用";
      const group = groups.get(category) || [];
      group.push(row);
      groups.set(category, group);
    }
    for (const group of groups.values()) {
      if (group.length < 30) continue;
      const velocities = group.map((item) => Number(item.playVelocity || 0));
      const engagements = group.map((item) => Number(item.engagementRate || 0));
      const saveShares = group.map((item) => Number(item.saveShareRate || 0));
      const accounts = group.map((item) => Number(item.accountQualityScore || 0));
      await Promise.all(group.map((item) => {
        const velocityScore = percentileScore(Number(item.playVelocity || 0), velocities);
        const engagementScore = percentileScore(Number(item.engagementRate || 0), engagements);
        const saveShareScore = percentileScore(Number(item.saveShareRate || 0), saveShares);
        const accountQualityScore = percentileScore(Number(item.accountQualityScore || 0), accounts);
        const viralIndex = Math.round((
          velocityScore * 0.4
          + engagementScore * 0.3
          + saveShareScore * 0.2
          + accountQualityScore * 0.1
        ) * 10) / 10;
        return this.prisma.externalMetricSnapshot.update({
          where: { id: item.id },
          data: {
            velocityScore,
            engagementScore,
            saveShareScore,
            accountQualityScore,
            viralIndex,
            viralGrade: gradeFor(viralIndex),
          },
        });
      }));
    }
  }
}
