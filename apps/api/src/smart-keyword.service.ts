import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { AiViralKeyword } from "./ai-content.service";
import { AiContentService } from "./ai-content.service";
import { opsConfig } from "./config";
import { PrismaService } from "./prisma.service";
import { allowedViralKeyword } from "./viral-keyword";

type JsonRecord = Record<string, unknown>;
type Platform = "DOUYIN" | "TIKTOK";
type Consumer = "VIRAL_RESEARCH" | "SMART_VIDEO";
type KeywordType = AiViralKeyword["type"];

const keywordTypes = new Set<KeywordType>([
  "PRODUCT", "AUDIENCE", "PAIN", "VALUE", "SCENE", "HOOK", "CONVERSION", "TREND", "COMPETITOR",
]);
const priorities = new Set(["A", "B", "C"]);

function text(value: unknown) {
  return String(value ?? "").trim();
}

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/[，,;；\n]/u).map((item) => item.trim()).filter(Boolean);
}

function bool(value: unknown, fallback: boolean) {
  return value === undefined ? fallback : Boolean(value);
}

function number(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function platform(value: unknown): Platform {
  const result = text(value).toUpperCase();
  if (result !== "DOUYIN" && result !== "TIKTOK") throw new BadRequestException("平台仅支持DOUYIN或TIKTOK");
  return result;
}

function keywordType(value: unknown): KeywordType {
  const result = text(value).toUpperCase() as KeywordType;
  return keywordTypes.has(result) ? result : "PRODUCT";
}

function priority(value: unknown) {
  const result = text(value).toUpperCase();
  return priorities.has(result) ? result : "C";
}

export function cleanKeywordDisplay(value: string) {
  return value
    .normalize("NFKC")
    .replaceAll("园型", "圆形")
    .replaceAll("气嚷", "气囊")
    .replaceAll("跌掉", "跌倒")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120);
}

export function normalizeKeyword(value: string) {
  return cleanKeywordDisplay(value)
    .replace(/[#"“”‘’]/gu, "")
    .toLowerCase()
    .trim();
}

function clusterKey(value: string) {
  const normalized = normalizeKeyword(value)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || "uncategorized";
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

export function grade(score: number) {
  if (score >= 85) return "S";
  if (score >= 75) return "A";
  if (score >= 60) return "B";
  return "C";
}

export function scoreFor(input: {
  type: KeywordType;
  source: string;
  productId?: string | null;
  hitCount?: number;
  faqFrequency?: number;
  directionMatched?: boolean;
  contentGap?: boolean;
}) {
  const typeIntent: Record<KeywordType, number> = {
    PRODUCT: 80,
    AUDIENCE: 65,
    PAIN: 78,
    VALUE: 78,
    SCENE: 62,
    HOOK: 55,
    CONVERSION: 95,
    TREND: 55,
    COMPETITOR: 72,
  };
  const typeShootability: Record<KeywordType, number> = {
    PRODUCT: 80,
    AUDIENCE: 72,
    PAIN: 88,
    VALUE: 82,
    SCENE: 92,
    HOOK: 90,
    CONVERSION: 80,
    TREND: 75,
    COMPETITOR: 68,
  };
  const hitCount = input.hitCount || 0;
  const sourceBoost = input.source === "MANUAL" ? 12 : input.directionMatched ? 15 : input.source === "AI" ? 7 : 0;
  const relevanceScore = Math.min(100, (input.productId ? 95 : input.type === "COMPETITOR" ? 70 : 82) + sourceBoost / 3);
  const demandScore = Math.min(100, 70 + sourceBoost + Math.min(20, (input.faqFrequency || 0) / 5) + Math.min(18, hitCount * 2));
  const trendScore = Math.min(100, 65 + (input.type === "TREND" ? 18 : 0) + Math.min(20, hitCount * 2));
  const contentGapScore = input.contentGap ? 85 : 70;
  const commercialIntentScore = typeIntent[input.type];
  const shootabilityScore = typeShootability[input.type];
  const historyScore = Math.min(100, 40 + hitCount * 6);
  const opportunityScore = Math.round((
    relevanceScore * 0.2
    + demandScore * 0.2
    + trendScore * 0.15
    + contentGapScore * 0.15
    + commercialIntentScore * 0.15
    + shootabilityScore * 0.1
    + historyScore * 0.05
  ) * 10) / 10;
  return {
    relevanceScore,
    demandScore,
    trendScore,
    contentGapScore,
    commercialIntentScore,
    shootabilityScore,
    historyScore,
    opportunityScore,
    grade: grade(opportunityScore),
  };
}

@Injectable()
export class SmartKeywordService {
  private readonly logger = new Logger(SmartKeywordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiContent: AiContentService,
  ) {}

  @Cron("0 30 6 * * *", { timeZone: "Asia/Shanghai" })
  async generateDailyPlans() {
    for (const target of ["DOUYIN", "TIKTOK"] as const) {
      await this.generatePlan(target, false, "系统每日关键词任务").catch((error) => {
        this.logger.error(`${target}关键词计划生成失败：${error instanceof Error ? error.message : "未知错误"}`);
      });
    }
  }

  async list(query: JsonRecord = {}) {
    const target = text(query.platform) ? platform(query.platform) : undefined;
    const take = Math.min(Math.max(number(query.take, 200), 1), 500);
    const where = {
      ...(target ? { platform: target } : {}),
      ...(text(query.status) ? { status: text(query.status).toUpperCase() } : {}),
      ...(text(query.type) ? { type: keywordType(query.type) } : {}),
      ...(text(query.grade) ? { grade: text(query.grade).toUpperCase() } : {}),
      ...(text(query.search) ? {
        keyword: { contains: text(query.search), mode: "insensitive" as const },
      } : {}),
    };
    const [items, total, groups] = await Promise.all([
      this.prisma.smartKeyword.findMany({
        where,
        include: {
          product: true,
          cluster: true,
          sources: { orderBy: { observedAt: "desc" }, take: 4 },
          snapshots: { orderBy: { snapshotDate: "desc" }, take: 7 },
        },
        orderBy: [{ pinned: "desc" }, { opportunityScore: "desc" }, { updatedAt: "desc" }],
        take,
      }),
      this.prisma.smartKeyword.count({ where }),
      this.prisma.smartKeyword.groupBy({
        by: ["platform", "grade"],
        where: target ? { platform: target } : undefined,
        _count: { _all: true },
      }),
    ]);
    return {
      total,
      items,
      summary: groups,
      limits: { dailyCollectionPerPlatform: 50, pinnedPerPlatform: 50 },
    };
  }

  async create(input: JsonRecord, actor: string) {
    const target = platform(input.platform);
    const keyword = cleanKeywordDisplay(text(input.keyword));
    if (!keyword) throw new BadRequestException("关键词不能为空");
    const products = await this.prisma.product.findMany({
      where: { status: "READY" },
      select: { id: true, name: true, modelCode: true },
    });
    if (!allowedViralKeyword(keyword, products.map((item) => item.name))) {
      throw new BadRequestException("关键词包含品牌名或完整产品名称，请改为自然搜索表达");
    }
    if (Boolean(input.pinned || input.addToDailyPlan)) await this.assertPinnedCapacity(target);
    const product = text(input.productId)
      ? products.find((item) => item.id === text(input.productId))
      : products.find((item) => item.modelCode.toLowerCase() === text(input.productModel).toLowerCase());
    const type = keywordType(input.type);
    const scores = scoreFor({ type, source: "MANUAL", productId: product?.id });
    const cluster = await this.upsertCluster({
      clusterKey: text(input.clusterKey) || clusterKey(keyword),
      clusterName: cleanKeywordDisplay(text(input.clusterName)) || keyword,
      audience: text(input.audience),
      pain: text(input.pain),
      scene: text(input.scene),
    });
    const created = await this.prisma.smartKeyword.create({
      data: {
        platform: target,
        productId: product?.id,
        clusterId: cluster.id,
        keyword,
        normalizedKeyword: normalizeKeyword(keyword),
        language: text(input.language) || (target === "TIKTOK" ? "en" : "zh-CN"),
        market: text(input.market) || (target === "TIKTOK" ? "US" : "CN"),
        type,
        source: "MANUAL",
        status: "ACTIVE",
        priority: priority(input.priority),
        reason: text(input.reason) || "人工新增关键词",
        audience: text(input.audience) || undefined,
        pain: text(input.pain) || undefined,
        scene: text(input.scene) || undefined,
        notes: text(input.notes || input.remark) || undefined,
        collectionEnabled: bool(input.collectionEnabled, true),
        contentEnabled: type === "COMPETITOR" ? bool(input.contentEnabled, false) : bool(input.contentEnabled, true),
        pinned: Boolean(input.pinned || input.addToDailyPlan),
        locked: Boolean(input.locked),
        opportunityScore: scores.opportunityScore,
        grade: scores.grade,
        createdBy: actor,
        updatedBy: actor,
        sources: {
          create: {
            sourceType: "MANUAL",
            sourceLabel: actor,
            raw: { notes: text(input.notes || input.remark) } as never,
          },
        },
        snapshots: {
          create: {
            snapshotDate: shanghaiDateStart(),
            ...scores,
            metrics: { source: "MANUAL" } as never,
          },
        },
      },
      include: { product: true, cluster: true, sources: true, snapshots: true },
    }).catch((error) => {
      if (text(object(error).code) === "P2002") throw new BadRequestException("该平台和市场已存在相同关键词");
      throw error;
    });
    if (created.pinned) await this.syncDailyPlan(target, actor);
    return created;
  }

  async batch(input: JsonRecord, actor: string) {
    const rows = Array.isArray(input.items) ? input.items.map(object) : this.parseBatchText(text(input.text), input);
    if (!rows.length) throw new BadRequestException("没有可导入的关键词");
    if (rows.length > 1000) throw new BadRequestException("单次最多导入1000个关键词");
    const result = { created: 0, skipped: 0, errors: [] as Array<{ row: number; message: string }> };
    for (let index = 0; index < rows.length; index += 1) {
      try {
        await this.create({ ...input, ...rows[index], source: "MANUAL", pinned: false, addToDailyPlan: false }, actor);
        result.created += 1;
      } catch (error) {
        result.skipped += 1;
        result.errors.push({ row: index + 1, message: error instanceof Error ? error.message : "导入失败" });
      }
    }
    return result;
  }

  async update(id: string, input: JsonRecord, actor: string) {
    const current = await this.prisma.smartKeyword.findUnique({ where: { id }, include: { product: true } });
    if (!current) throw new NotFoundException("关键词不存在");
    const target = input.platform === undefined ? current.platform as Platform : platform(input.platform);
    const nextPinned = input.pinned === undefined && input.addToDailyPlan === undefined
      ? current.pinned
      : Boolean(input.pinned || input.addToDailyPlan);
    if (nextPinned && (!current.pinned || target !== current.platform)) await this.assertPinnedCapacity(target, id);
    const nextKeyword = input.keyword === undefined ? current.keyword : cleanKeywordDisplay(text(input.keyword));
    if (!nextKeyword) throw new BadRequestException("关键词不能为空");
    const products = await this.prisma.product.findMany({ where: { status: "READY" }, select: { id: true, name: true } });
    if (!allowedViralKeyword(nextKeyword, products.map((item) => item.name))) {
      throw new BadRequestException("关键词包含品牌名或完整产品名称，请改为自然搜索表达");
    }
    const nextType = input.type === undefined ? current.type as KeywordType : keywordType(input.type);
    const scores = scoreFor({
      type: nextType,
      source: current.source,
      productId: input.productId === undefined ? current.productId : text(input.productId) || null,
      hitCount: current.hitCount,
    });
    const updated = await this.prisma.smartKeyword.update({
      where: { id },
      data: {
        platform: target,
        productId: input.productId === undefined ? current.productId : text(input.productId) || null,
        keyword: nextKeyword,
        normalizedKeyword: normalizeKeyword(nextKeyword),
        language: input.language === undefined ? current.language : text(input.language),
        market: input.market === undefined ? current.market : text(input.market),
        type: nextType,
        status: input.status === undefined ? current.status : text(input.status).toUpperCase(),
        priority: input.priority === undefined ? current.priority : priority(input.priority),
        reason: input.reason === undefined ? current.reason : text(input.reason) || null,
        audience: input.audience === undefined ? current.audience : text(input.audience) || null,
        pain: input.pain === undefined ? current.pain : text(input.pain) || null,
        scene: input.scene === undefined ? current.scene : text(input.scene) || null,
        notes: input.notes === undefined && input.remark === undefined ? current.notes : text(input.notes || input.remark) || null,
        collectionEnabled: bool(input.collectionEnabled, current.collectionEnabled),
        contentEnabled: bool(input.contentEnabled, current.contentEnabled),
        pinned: nextPinned,
        locked: bool(input.locked, current.locked),
        opportunityScore: scores.opportunityScore,
        grade: scores.grade,
        lastSeenAt: new Date(),
        updatedBy: actor,
        snapshots: {
          upsert: {
            where: { keywordId_snapshotDate: { keywordId: id, snapshotDate: shanghaiDateStart() } },
            update: { ...scores, metrics: { source: current.source, manualUpdate: true } as never },
            create: {
              snapshotDate: shanghaiDateStart(),
              ...scores,
              metrics: { source: current.source, manualUpdate: true } as never,
            },
          },
        },
      },
      include: { product: true, cluster: true, snapshots: { orderBy: { snapshotDate: "desc" }, take: 7 } },
    });
    await this.syncDailyPlan(current.platform as Platform, actor);
    if (target !== current.platform) await this.syncDailyPlan(target, actor);
    return updated;
  }

  async analysis(id: string) {
    const keyword = await this.prisma.smartKeyword.findUnique({
      where: { id },
      include: {
        product: true,
        cluster: { include: { keywords: { orderBy: { opportunityScore: "desc" } } } },
        snapshots: { orderBy: { snapshotDate: "desc" }, take: 30 },
        sources: { orderBy: { observedAt: "desc" }, take: 50 },
        contentRelations: {
          include: { contentPlan: { select: { id: true, topic: true, status: true, sourceSignals: true, createdAt: true } } },
          orderBy: { updatedAt: "desc" },
          take: 30,
        },
        planKeywords: {
          include: {
            plan: true,
            videoHits: {
              include: {
                externalVideo: {
                  include: { metrics: { orderBy: { capturedAt: "desc" }, take: 1 } },
                },
              },
              orderBy: { lastSeenAt: "desc" },
              take: 30,
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 30,
        },
      },
    });
    if (!keyword) throw new NotFoundException("关键词不存在");
    return keyword;
  }

  async active(platformValue: unknown, consumerValue: unknown) {
    const target = platform(platformValue);
    const consumer = text(consumerValue).toUpperCase() as Consumer;
    if (consumer !== "VIRAL_RESEARCH" && consumer !== "SMART_VIDEO") {
      throw new BadRequestException("consumer仅支持VIRAL_RESEARCH或SMART_VIDEO");
    }
    if (consumer === "VIRAL_RESEARCH") {
      const plan = await this.todayPlan(target);
      return plan.keywords.map((item) => item.smartKeyword).filter(Boolean);
    }
    let items = await this.prisma.smartKeyword.findMany({
      where: { platform: target, status: "ACTIVE", contentEnabled: true, grade: { in: ["S", "A"] } },
      include: { product: true, cluster: true },
      orderBy: [{ pinned: "desc" }, { opportunityScore: "desc" }],
      take: 50,
    });
    if (!items.length) {
      await this.generatePlan(target, false, "智能视频关键词补全");
      items = await this.prisma.smartKeyword.findMany({
        where: { platform: target, status: "ACTIVE", contentEnabled: true, grade: { in: ["S", "A"] } },
        include: { product: true, cluster: true },
        orderBy: [{ pinned: "desc" }, { opportunityScore: "desc" }],
        take: 50,
      });
    }
    return items;
  }

  async clusters(query: JsonRecord = {}) {
    const target = text(query.platform) ? platform(query.platform) : undefined;
    return this.prisma.smartKeywordCluster.findMany({
      where: target ? { keywords: { some: { platform: target } } } : undefined,
      include: {
        keywords: {
          where: target ? { platform: target } : undefined,
          include: { product: true },
          orderBy: [{ opportunityScore: "desc" }],
        },
      },
      orderBy: { updatedAt: "desc" },
      take: Math.min(Math.max(number(query.take, 100), 1), 300),
    });
  }

  async directions(query: JsonRecord = {}) {
    const target = text(query.platform) ? platform(query.platform) : undefined;
    const rows = await this.prisma.smartKeywordDirection.findMany({
      where: {
        ...(target ? { platform: target } : {}),
        ...(query.active === undefined ? {} : { active: text(query.active) === "true" || query.active === true }),
      },
      include: { versions: { orderBy: { version: "desc" }, take: 10 } },
      orderBy: [{ active: "desc" }, { priority: "asc" }, { updatedAt: "desc" }],
    });
    const sources = rows.length ? await this.prisma.smartKeywordSource.findMany({
      where: { sourceType: "DIRECTION", sourceId: { in: rows.map((item) => item.id) } },
      include: {
        keyword: {
          select: {
            id: true,
            opportunityScore: true,
            grade: true,
            hitCount: true,
            contentRelations: { select: { id: true, metrics: true } },
          },
        },
      },
    }) : [];
    return rows.map((row) => {
      const directionSources = sources.filter((item) => item.sourceId === row.id);
      const keywords = [...new Map(directionSources.map((item) => [item.keyword.id, item.keyword])).values()];
      return {
        ...row,
        performance: {
          keywordCount: keywords.length,
          highOpportunityCount: keywords.filter((item) => item.grade === "S" || item.grade === "A").length,
          hitCount: keywords.reduce((sum, item) => sum + item.hitCount, 0),
          averageScore: keywords.length
            ? Math.round(keywords.reduce((sum, item) => sum + item.opportunityScore, 0) / keywords.length * 10) / 10
            : 0,
          contentUsages: keywords.reduce((sum, item) => sum + item.contentRelations.length, 0),
        },
      };
    });
  }

  async createDirection(input: JsonRecord, actor: string) {
    const name = text(input.name);
    if (!name) throw new BadRequestException("方向名称不能为空");
    const data = this.directionData(input, actor);
    return this.prisma.smartKeywordDirection.create({
      data: {
        name,
        ...data,
        createdBy: actor,
        versions: {
          create: {
            version: 1,
            changedBy: actor,
            snapshot: { name, ...data, createdBy: actor } as never,
          },
        },
      },
      include: { versions: true },
    });
  }

  async updateDirection(id: string, input: JsonRecord, actor: string) {
    const current = await this.prisma.smartKeywordDirection.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("运营方向不存在");
    const merged = {
      name: input.name === undefined ? current.name : text(input.name),
      platform: input.platform === undefined ? current.platform : platform(input.platform),
      startAt: input.startAt === undefined ? current.startAt : this.validDate(input.startAt, "开始日期"),
      endAt: input.endAt === undefined ? current.endAt : text(input.endAt) ? this.validDate(input.endAt, "结束日期") : null,
      productIds: input.productIds === undefined ? current.productIds : strings(input.productIds),
      productSeries: input.productSeries === undefined ? current.productSeries : strings(input.productSeries),
      audienceTerms: input.audienceTerms === undefined ? current.audienceTerms : strings(input.audienceTerms),
      painTerms: input.painTerms === undefined ? current.painTerms : strings(input.painTerms),
      sceneTerms: input.sceneTerms === undefined ? current.sceneTerms : strings(input.sceneTerms),
      competitorTerms: input.competitorTerms === undefined ? current.competitorTerms : strings(input.competitorTerms),
      objective: input.objective === undefined ? current.objective : text(input.objective) || null,
      boostTerms: input.boostTerms === undefined ? current.boostTerms : strings(input.boostTerms),
      excludeTerms: input.excludeTerms === undefined ? current.excludeTerms : strings(input.excludeTerms),
      explorationRatio: input.explorationRatio === undefined
        ? current.explorationRatio
        : Math.min(1, Math.max(0, number(input.explorationRatio, 0.3))),
      priority: input.priority === undefined ? current.priority : priority(input.priority),
      active: bool(input.active, current.active),
      version: current.version + 1,
      updatedBy: actor,
    };
    return this.prisma.smartKeywordDirection.update({
      where: { id },
      data: {
        ...merged,
        versions: {
          create: {
            version: merged.version,
            changedBy: actor,
            snapshot: merged as never,
          },
        },
      },
      include: { versions: { orderBy: { version: "desc" }, take: 10 } },
    });
  }

  async sourceStatus() {
    const [integrations, devices] = await Promise.all([
      this.prisma.integration.findMany({ where: { kind: { in: ["DOUYIN", "TIKTOK"] } } }),
      this.prisma.viralCollectorDevice.findMany({ where: { platform: "DOUYIN" }, orderBy: { lastHeartbeatAt: "desc" } }),
    ]);
    const byKind = new Map(integrations.map((item) => [item.kind, item]));
    const douyin = byKind.get("DOUYIN");
    const tiktok = byKind.get("TIKTOK");
    return [
      {
        platform: "DOUYIN",
        state: douyin?.state || "UNCONFIGURED",
        message: douyin?.message || "未配置",
        localCollector: devices[0] || null,
        capabilities: { officialTrend: false, localChrome: Boolean(devices.length), firstParty: true },
      },
      {
        platform: "TIKTOK",
        state: tiktok?.state || "UNCONFIGURED",
        message: tiktok?.message || "未配置",
        localCollector: null,
        capabilities: { creatorSearchInsights: false, keywordInsights: false, topAds: false, firstParty: true },
      },
    ];
  }

  async generate(input: JsonRecord, actor: string) {
    const target = platform(input.platform || "DOUYIN");
    const plan = await this.generatePlan(target, Boolean(input.force), actor);
    return {
      platform: target,
      planDate: plan.planDate,
      generation: plan.generation,
      selectedCount: plan.keywords.length,
      keywords: plan.keywords.map((item) => item.smartKeyword).filter(Boolean),
    };
  }

  async generatePlan(target: Platform, force = false, actor = "系统关键词引擎") {
    const planDate = shanghaiDateStart();
    const existingPlan = await this.prisma.viralKeywordPlan.findUnique({
      where: { platform_planDate: { platform: target, planDate } },
      include: {
        keywords: {
          where: { active: true },
          include: { product: true, smartKeyword: { include: { product: true, cluster: true } } },
        },
      },
    });
    if (existingPlan?.keywords.length && !force) return existingPlan;

    const now = new Date();
    const [
      products,
      faqs,
      knowledge,
      directions,
      existingKeywords,
      integration,
      assetGaps,
    ] = await Promise.all([
      this.prisma.product.findMany({ where: { status: "READY" }, orderBy: { modelCode: "asc" } }),
      this.prisma.faqEntry.findMany({
        where: { status: "READY" },
        orderBy: [{ frequency: "desc" }, { updatedAt: "desc" }],
        take: 80,
        include: { product: true },
      }),
      this.prisma.knowledgeEntry.findMany({ where: { status: "READY" }, orderBy: { updatedAt: "desc" }, take: 60 }),
      this.prisma.smartKeywordDirection.findMany({
        where: {
          platform: target,
          active: true,
          startAt: { lte: now },
          OR: [{ endAt: null }, { endAt: { gte: now } }],
        },
        orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
      }),
      this.prisma.smartKeyword.findMany({
        where: { platform: target },
        include: { product: true },
        orderBy: [{ pinned: "desc" }, { opportunityScore: "desc" }],
        take: 500,
      }),
      this.prisma.integration.findUnique({ where: { kind: target } }),
      this.prisma.assetGapSnapshot.findMany({
        where: { snapshotDate: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, gapCount: { gt: 0 } },
        orderBy: [{ severity: "asc" }, { gapCount: "desc" }],
        take: 50,
      }),
    ]);
    const integrationConfig = object(integration?.publicConfig);
    const collector = object(integrationConfig.viralCollector);
    const configuredCompetitors = strings(collector.competitorAccounts);
    const context = {
      platform: target,
      market: target === "TIKTOK" ? "US" : "CN",
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
      assetGaps: assetGaps.map((item) => ({
        productModel: item.productModel,
        category: item.category,
        assetKind: item.assetKind,
        gapCount: item.gapCount,
      })),
      competitors: [...new Set([...configuredCompetitors, ...directions.flatMap((item) => item.competitorTerms)])],
      directions: directions.map((item) => ({
        name: item.name,
        productIds: item.productIds,
        productSeries: item.productSeries,
        audienceTerms: item.audienceTerms,
        painTerms: item.painTerms,
        sceneTerms: item.sceneTerms,
        objective: item.objective,
        boostTerms: item.boostTerms,
        excludeTerms: item.excludeTerms,
        explorationRatio: item.explorationRatio,
        priority: item.priority,
      })),
      recentEffectiveKeywords: existingKeywords.filter((item) => item.grade === "S" || item.grade === "A").slice(0, 60).map((item) => ({
        keyword: item.keyword,
        type: item.type,
        hits: item.hitCount,
        score: item.opportunityScore,
        productModel: item.product?.modelCode,
      })),
      dataSourceState: integration?.state || "UNCONFIGURED",
    };
    let generated: AiViralKeyword[] = [];
    try {
      generated = await this.aiContent.generateViralKeywords(context);
    } catch (error) {
      this.logger.warn(`${target} AI关键词生成失败，使用已审核资料兜底：${error instanceof Error ? error.message : "未知错误"}`);
    }
    const directionCandidates = this.directionCandidates(target, directions, products);
    const fallback = this.fallbackKeywords(target, products, faqs, configuredCompetitors);
    const excluded = directions.flatMap((item) => item.excludeTerms).map(normalizeKeyword).filter(Boolean);
    const productNames = products.map((item) => item.name);
    const productByModel = new Map(products.map((item) => [item.modelCode.toLowerCase(), item]));
    const seen = new Set<string>();
    let createdOrUpdated = 0;

    for (const candidate of [...directionCandidates, ...generated, ...fallback]) {
      const normalized = normalizeKeyword(candidate.keyword);
      if (
        !normalized
        || seen.has(normalized)
        || excluded.some((term) => normalized.includes(term) || term.includes(normalized))
        || !allowedViralKeyword(candidate.keyword, productNames)
      ) continue;
      seen.add(normalized);
      const type = keywordType(candidate.type);
      const product = candidate.productModel ? productByModel.get(candidate.productModel.toLowerCase()) : undefined;
      const directionMatched = directions.some((item) => this.directionMatches(item, candidate.keyword, product?.id));
      const source = directionMatched ? "DIRECTION" : generated.includes(candidate) ? "AI" : "KNOWLEDGE";
      const current = existingKeywords.find((item) => item.normalizedKeyword === normalized)
        || await this.prisma.smartKeyword.findUnique({
          where: {
            platform_market_normalizedKeyword: {
              platform: target,
              market: target === "TIKTOK" ? "US" : "CN",
              normalizedKeyword: normalized,
            },
          },
          include: { product: true },
        });
      const faqFrequency = faqs
        .filter((item) => normalizeKeyword(item.standardQuestion).includes(normalized) || normalized.includes(normalizeKeyword(item.standardQuestion)))
        .reduce((sum, item) => sum + item.frequency, 0);
      const contentGap = assetGaps.some((item) => !product || item.productId === product.id || item.productModel === product.modelCode);
      const scores = scoreFor({
        type,
        source,
        productId: product?.id,
        hitCount: current?.hitCount,
        faqFrequency,
        directionMatched,
        contentGap,
      });
      const cluster = await this.upsertCluster({
        clusterKey: candidate.clusterKey || clusterKey(candidate.clusterName || candidate.keyword),
        clusterName: cleanKeywordDisplay(candidate.clusterName || candidate.keyword),
        audience: candidate.audience,
        pain: candidate.pain,
        scene: candidate.scene,
      });
      const data = {
        productId: product?.id,
        clusterId: cluster.id,
        keyword: cleanKeywordDisplay(candidate.keyword),
        normalizedKeyword: normalized,
        language: target === "TIKTOK" ? "en" : "zh-CN",
        market: target === "TIKTOK" ? "US" : "CN",
        type,
        source,
        status: "ACTIVE",
        priority: priority(candidate.priority),
        reason: candidate.reason,
        audience: candidate.audience,
        pain: candidate.pain,
        scene: candidate.scene,
        collectionEnabled: true,
        contentEnabled: type !== "COMPETITOR",
        opportunityScore: scores.opportunityScore,
        grade: scores.grade,
        lastSeenAt: now,
        updatedBy: actor,
      };
      let row;
      if (current) {
        row = current.locked
          ? current
          : await this.prisma.smartKeyword.update({ where: { id: current.id }, data });
      } else {
        row = await this.prisma.smartKeyword.create({
          data: {
            platform: target,
            ...data,
            createdBy: actor,
          },
        });
      }
      await this.prisma.smartKeywordSnapshot.upsert({
        where: { keywordId_snapshotDate: { keywordId: row.id, snapshotDate: planDate } },
        update: { ...scores, metrics: { source, faqFrequency, directionMatched, contentGap } as never },
        create: {
          keywordId: row.id,
          snapshotDate: planDate,
          ...scores,
          metrics: { source, faqFrequency, directionMatched, contentGap } as never,
        },
      });
      await this.prisma.smartKeywordSource.create({
        data: {
          keywordId: row.id,
          sourceType: source,
          sourceId: directionMatched
            ? directions.find((item) => this.directionMatches(item, candidate.keyword, product?.id))?.id
            : undefined,
          sourceLabel: directionMatched ? directions.find((item) => this.directionMatches(item, candidate.keyword, product?.id))?.name : undefined,
          raw: { reason: candidate.reason, model: generated.includes(candidate) ? opsConfig.bailian.textModel : null } as never,
        },
      });
      createdOrUpdated += 1;
    }

    const plan = await this.syncDailyPlan(target, actor, {
      generation: generated.length ? "AI" : "FALLBACK",
      model: generated.length ? opsConfig.bailian.textModel : null,
      context: {
        generatedAt: now.toISOString(),
        productCount: products.length,
        faqCount: faqs.length,
        directionCount: directions.length,
        aiGeneratedCount: generated.length,
        createdOrUpdated,
        dataSourceState: integration?.state || "UNCONFIGURED",
      },
    });
    return plan;
  }

  async todayPlan(target: Platform) {
    const planDate = shanghaiDateStart();
    let plan = await this.prisma.viralKeywordPlan.findUnique({
      where: { platform_planDate: { platform: target, planDate } },
      include: {
        keywords: {
          where: { active: true },
          include: { product: true, smartKeyword: { include: { product: true, cluster: true } } },
          orderBy: [{ priority: "asc" }, { type: "asc" }],
        },
      },
    });
    if (!plan?.keywords.length) plan = await this.generatePlan(target, false);
    return plan;
  }

  async recordFeedback(keywordId: string, input: JsonRecord) {
    const keyword = await this.prisma.smartKeyword.findUnique({
      where: { id: keywordId },
      include: { snapshots: { orderBy: { snapshotDate: "desc" }, take: 1 } },
    });
    if (!keyword) throw new NotFoundException("关键词不存在");
    const views = number(input.views);
    const completionRate = number(input.completionRate);
    const engagementRate = number(input.engagementRate);
    const clickRate = number(input.clickRate);
    const orders = number(input.orders);
    const revenue = number(input.revenue);
    const historyScore = Math.min(100, Math.round((
      Math.min(100, Math.log10(Math.max(1, views)) * 20) * 0.25
      + completionRate * 100 * 0.25
      + engagementRate * 100 * 0.2
      + clickRate * 100 * 0.15
      + Math.min(100, orders * 5) * 0.1
      + Math.min(100, revenue / 100) * 0.05
    ) * 10) / 10);
    const last = keyword.snapshots[0];
    const components = {
      relevanceScore: last?.relevanceScore || 70,
      demandScore: last?.demandScore || 70,
      trendScore: last?.trendScore || 65,
      contentGapScore: last?.contentGapScore || 60,
      commercialIntentScore: last?.commercialIntentScore || 70,
      shootabilityScore: last?.shootabilityScore || 70,
      historyScore,
    };
    const opportunityScore = Math.round((
      components.relevanceScore * 0.2
      + components.demandScore * 0.2
      + components.trendScore * 0.15
      + components.contentGapScore * 0.15
      + components.commercialIntentScore * 0.15
      + components.shootabilityScore * 0.1
      + historyScore * 0.05
    ) * 10) / 10;
    const nextGrade = grade(opportunityScore);
    const snapshotDate = shanghaiDateStart();
    await this.prisma.$transaction([
      this.prisma.smartKeyword.update({
        where: { id: keywordId },
        data: { opportunityScore, grade: nextGrade, updatedBy: "效果回流" },
      }),
      this.prisma.smartKeywordSnapshot.upsert({
        where: { keywordId_snapshotDate: { keywordId, snapshotDate } },
        update: { ...components, opportunityScore, grade: nextGrade, metrics: input as never },
        create: {
          keywordId,
          snapshotDate,
          ...components,
          opportunityScore,
          grade: nextGrade,
          metrics: input as never,
        },
      }),
      ...(text(input.contentPlanId) ? [
        this.prisma.smartKeywordContentRelation.upsert({
          where: {
            keywordId_contentPlanId_usageType: {
              keywordId,
              contentPlanId: text(input.contentPlanId),
              usageType: text(input.usageType) || "PERFORMANCE",
            },
          },
          update: { metrics: input as never },
          create: {
            keywordId,
            contentPlanId: text(input.contentPlanId),
            usageType: text(input.usageType) || "PERFORMANCE",
            metrics: input as never,
          },
        }),
      ] : []),
    ]);
    return { keywordId, opportunityScore, grade: nextGrade, historyScore };
  }

  private async syncDailyPlan(
    target: Platform,
    actor: string,
    metadata?: { generation: string; model: string | null; context: JsonRecord },
  ) {
    const planDate = shanghaiDateStart();
    const now = new Date();
    const directions = await this.prisma.smartKeywordDirection.findMany({
      where: {
        platform: target,
        active: true,
        startAt: { lte: now },
        OR: [{ endAt: null }, { endAt: { gte: now } }],
      },
    });
    const library = await this.prisma.smartKeyword.findMany({
      where: { platform: target, status: "ACTIVE", collectionEnabled: true },
      include: { product: true },
      orderBy: [{ pinned: "desc" }, { opportunityScore: "desc" }, { updatedAt: "desc" }],
      take: 1000,
    });
    const selected = this.selectDaily(library, directions);
    const plan = await this.prisma.viralKeywordPlan.upsert({
      where: { platform_planDate: { platform: target, planDate } },
      update: {
        generation: metadata?.generation || "MIXED",
        model: metadata?.model,
        context: { ...(metadata?.context || {}), selectedCount: selected.length, updatedBy: actor } as never,
      },
      create: {
        platform: target,
        planDate,
        generation: metadata?.generation || "MIXED",
        model: metadata?.model,
        context: { ...(metadata?.context || {}), selectedCount: selected.length, updatedBy: actor } as never,
      },
    });
    await this.prisma.viralKeyword.updateMany({ where: { planId: plan.id }, data: { active: false } });
    for (const item of selected) {
      await this.prisma.viralKeyword.upsert({
        where: { planId_keyword: { planId: plan.id, keyword: item.keyword } },
        update: {
          productId: item.productId,
          smartKeywordId: item.id,
          type: item.type,
          priority: item.priority,
          reason: item.reason,
          locked: item.locked,
          active: true,
        },
        create: {
          planId: plan.id,
          productId: item.productId,
          smartKeywordId: item.id,
          keyword: item.keyword,
          type: item.type,
          priority: item.priority,
          reason: item.reason,
          locked: item.locked,
          active: true,
        },
      });
    }
    return this.prisma.viralKeywordPlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: {
        keywords: {
          where: { active: true },
          include: { product: true, smartKeyword: { include: { product: true, cluster: true } } },
          orderBy: [{ priority: "asc" }, { type: "asc" }],
        },
      },
    });
  }

  private selectDaily(
    library: Array<{
      id: string;
      keyword: string;
      type: string;
      priority: string;
      reason: string | null;
      pinned: boolean;
      locked: boolean;
      productId: string | null;
      opportunityScore: number;
      hitCount: number;
      source: string;
    }>,
    directions: Array<{
      productIds: string[];
      audienceTerms: string[];
      painTerms: string[];
      sceneTerms: string[];
      competitorTerms: string[];
      boostTerms: string[];
      explorationRatio: number;
    }>,
  ) {
    const picked: typeof library = [];
    const seen = new Set<string>();
    const add = (items: typeof library, limit: number) => {
      for (const item of items) {
        if (picked.length >= 50 || limit <= 0 || seen.has(item.id)) continue;
        picked.push(item);
        seen.add(item.id);
        limit -= 1;
      }
    };
    const pinned = library.filter((item) => item.pinned).slice(0, 50);
    add(pinned, 50);
    const remaining = 50 - picked.length;
    if (!remaining) return picked;
    const explorationRatio = directions.length
      ? directions.reduce((sum, item) => sum + item.explorationRatio, 0) / directions.length
      : 0.3;
    const explorationSlots = Math.round(remaining * explorationRatio);
    const effectiveSlots = remaining - explorationSlots;
    const directed = library.filter((item) => directions.some((direction) => this.directionMatches(direction, item.keyword, item.productId)));
    const historical = library.filter((item) => item.hitCount > 0 || item.opportunityScore >= 75);
    add([...directed, ...historical], effectiveSlots);
    add(library.filter((item) => !seen.has(item.id)), explorationSlots);
    add(library.filter((item) => !seen.has(item.id)), 50 - picked.length);
    return picked;
  }

  private directionMatches(
    direction: {
      productIds: string[];
      audienceTerms: string[];
      painTerms: string[];
      sceneTerms: string[];
      competitorTerms?: string[];
      boostTerms: string[];
    },
    keyword: string,
    productId?: string | null,
  ) {
    if (productId && direction.productIds.includes(productId)) return true;
    const normalized = normalizeKeyword(keyword);
    return [
      ...direction.audienceTerms,
      ...direction.painTerms,
      ...direction.sceneTerms,
      ...(direction.competitorTerms || []),
      ...direction.boostTerms,
    ].some((term) => normalized.includes(normalizeKeyword(term)) || normalizeKeyword(term).includes(normalized));
  }

  private directionCandidates(
    target: Platform,
    directions: Array<{
      name: string;
      productIds: string[];
      audienceTerms: string[];
      painTerms: string[];
      sceneTerms: string[];
      competitorTerms: string[];
      boostTerms: string[];
      priority: string;
    }>,
    products: Array<{ id: string; modelCode: string }>,
  ): AiViralKeyword[] {
    const productById = new Map(products.map((item) => [item.id, item.modelCode]));
    const rows: AiViralKeyword[] = [];
    for (const direction of directions) {
      const productModel = direction.productIds.map((id) => productById.get(id)).find(Boolean);
      const add = (values: string[], type: KeywordType) => values.forEach((keyword) => rows.push({
        keyword,
        type,
        priority: priority(direction.priority) as AiViralKeyword["priority"],
        productModel,
        reason: `人工运营方向：${direction.name}`,
        clusterKey: clusterKey(`${type}-${keyword}`),
        clusterName: direction.name,
      }));
      add(direction.boostTerms, "TREND");
      add(direction.audienceTerms, "AUDIENCE");
      add(direction.painTerms, "PAIN");
      add(direction.sceneTerms, "SCENE");
      add(direction.competitorTerms, "COMPETITOR");
    }
    return rows.filter((item) => target === "DOUYIN" || /[a-z]/iu.test(item.keyword));
  }

  private fallbackKeywords(
    target: Platform,
    products: Array<{ id: string; modelCode: string; category: string; metadata: unknown }>,
    faqs: Array<{ standardQuestion: string; frequency: number; product?: { modelCode: string } | null }>,
    competitors: string[],
  ): AiViralKeyword[] {
    const rows: AiViralKeyword[] = [];
    const add = (keyword: string, type: KeywordType, reason: string, productModel?: string, sharedClusterKey?: string) => rows.push({
      keyword,
      type,
      priority: type === "PRODUCT" || type === "PAIN" || type === "CONVERSION" ? "A" : "B",
      productModel,
      reason,
      clusterKey: sharedClusterKey || clusterKey(keyword),
      clusterName: keyword,
    });
    if (target === "DOUYIN") {
      for (const product of products) {
        add(product.category, "PRODUCT", "已审核产品通用品类", product.modelCode);
        for (const scene of strings(object(product.metadata).scenes).slice(0, 2)) {
          add(scene, "SCENE", "已审核产品场景", product.modelCode);
        }
      }
      for (const faq of faqs.slice(0, 25)) add(faq.standardQuestion.replace(/[？?]/gu, "").slice(0, 40), "PAIN", "高频FAQ", faq.product?.modelCode);
      const ring = products.find((item) => /ring|戒指/iu.test(`${item.category} ${item.modelCode}`));
      const watch = products.find((item) => /watch|手表/iu.test(`${item.category} ${item.modelCode}`));
      [
        ["老人智能手表", "PRODUCT", watch?.modelCode, "easy-smartwatch-for-seniors"],
        ["适合父母的智能手表", "VALUE", watch?.modelCode, "easy-smartwatch-for-seniors"],
        ["给父母的健康礼物", "SCENE", watch?.modelCode, "gift-for-aging-parents"],
        ["智能戒指", "PRODUCT", ring?.modelCode, "smart-ring"],
        ["睡眠监测戒指", "VALUE", ring?.modelCode, "sleep-tracking-ring"],
        ["智能戒指和智能手表哪个好", "CONVERSION", ring?.modelCode, "smart-ring-vs-smartwatch"],
      ].forEach(([keyword, type, model, sharedKey]) => add(keyword!, type as KeywordType, "跨语言基础词簇", model, sharedKey));
    } else {
      const ring = products.find((item) => /ring|戒指/iu.test(`${item.category} ${item.modelCode}`));
      const watch = products.find((item) => /watch|手表/iu.test(`${item.category} ${item.modelCode}`));
      [
        ["smartwatch for seniors", "PRODUCT", watch?.modelCode, "easy-smartwatch-for-seniors"],
        ["easy smartwatch for parents", "VALUE", watch?.modelCode, "easy-smartwatch-for-seniors"],
        ["gift for aging parents", "SCENE", watch?.modelCode, "gift-for-aging-parents"],
        ["health tracking watch", "PRODUCT", watch?.modelCode, "health-tracking-watch"],
        ["smartwatch review", "CONVERSION", watch?.modelCode, "smartwatch-review"],
        ["smart ring", "PRODUCT", ring?.modelCode, "smart-ring"],
        ["sleep tracking ring", "VALUE", ring?.modelCode, "sleep-tracking-ring"],
        ["smart ring vs smartwatch", "CONVERSION", ring?.modelCode, "smart-ring-vs-smartwatch"],
        ["no screen wearable", "PAIN", ring?.modelCode, "no-screen-wearable"],
        ["smart ring for women", "AUDIENCE", ring?.modelCode, "smart-ring-for-women"],
      ].forEach(([keyword, type, model, sharedKey]) => add(keyword!, type as KeywordType, "TikTok已审核品类兜底词", model, sharedKey));
    }
    competitors.slice(0, 10).forEach((item) => add(item, "COMPETITOR", "竞品观察名单"));
    return rows;
  }

  private async upsertCluster(input: {
    clusterKey: string;
    clusterName: string;
    audience?: string;
    pain?: string;
    scene?: string;
  }) {
    const key = clusterKey(input.clusterKey);
    const current = await this.prisma.smartKeywordCluster.findUnique({ where: { canonicalKey: key } });
    const audienceTerms = [...new Set([...(current?.audienceTerms || []), ...strings(input.audience)])];
    const painTerms = [...new Set([...(current?.painTerms || []), ...strings(input.pain)])];
    const sceneTerms = [...new Set([...(current?.sceneTerms || []), ...strings(input.scene)])];
    return this.prisma.smartKeywordCluster.upsert({
      where: { canonicalKey: key },
      update: {
        name: input.clusterName || current?.name,
        audienceTerms,
        painTerms,
        sceneTerms,
      },
      create: {
        canonicalKey: key,
        name: input.clusterName || input.clusterKey,
        audienceTerms,
        painTerms,
        sceneTerms,
      },
    });
  }

  private async assertPinnedCapacity(target: Platform, excludeId?: string) {
    const count = await this.prisma.smartKeyword.count({
      where: { platform: target, pinned: true, status: "ACTIVE", ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    if (count >= 50) throw new BadRequestException(`${target}已置顶50个关键词，请先取消其他置顶词`);
  }

  private parseBatchText(value: string, defaults: JsonRecord) {
    return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [keyword, type, productModel, audience, pain, scene, priorityValue] = line.split(/[\t,]/u).map((item) => item.trim());
      return {
        platform: defaults.platform,
        keyword,
        type: type || defaults.type,
        productModel: productModel || defaults.productModel,
        audience: audience || defaults.audience,
        pain: pain || defaults.pain,
        scene: scene || defaults.scene,
        priority: priorityValue || defaults.priority,
        collectionEnabled: defaults.collectionEnabled,
        contentEnabled: defaults.contentEnabled,
      };
    });
  }

  private directionData(input: JsonRecord, actor: string) {
    return {
      platform: platform(input.platform),
      startAt: text(input.startAt) ? this.validDate(input.startAt, "开始日期") : new Date(),
      endAt: text(input.endAt) ? this.validDate(input.endAt, "结束日期") : null,
      productIds: strings(input.productIds),
      productSeries: strings(input.productSeries),
      audienceTerms: strings(input.audienceTerms),
      painTerms: strings(input.painTerms),
      sceneTerms: strings(input.sceneTerms),
      competitorTerms: strings(input.competitorTerms),
      objective: text(input.objective) || null,
      boostTerms: strings(input.boostTerms),
      excludeTerms: strings(input.excludeTerms),
      explorationRatio: Math.min(1, Math.max(0, number(input.explorationRatio, 0.3))),
      priority: priority(input.priority),
      active: bool(input.active, true),
      version: 1,
      updatedBy: actor,
    };
  }

  private validDate(value: unknown, label: string) {
    const result = new Date(text(value));
    if (Number.isNaN(result.getTime())) throw new BadRequestException(`${label}格式不正确`);
    return result;
  }
}
