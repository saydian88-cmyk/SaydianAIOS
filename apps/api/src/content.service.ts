import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { ContentKind, ContentStatus, IntegrationKind, Prisma } from "@prisma/client";
import { exec, execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { opsConfig } from "./config";
import { AiArticlePackage, AiContentService, AiVideoCandidate } from "./ai-content.service";
import { ContentGuardService } from "./content-guard.service";
import { PlatformRegistry } from "./platform/platform.adapters";
import { PrismaService } from "./prisma.service";
import { OssStorageService } from "./oss-storage.service";
import { SmartKeywordService } from "./smart-keyword.service";
import { localDateKey, makeIdempotencyKey, startOfShanghaiDay } from "./utils";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export function resolveVideoShotAssets(
  shot: { matchedAssetIds: string[]; matchedVideoAssetIds: string[]; auxiliaryImageAssetIds: string[] },
  allowedAssetIds: Set<string>,
  assetKindById: Map<string, string>,
) {
  const videoAssetIds = Array.from(new Set([...shot.matchedVideoAssetIds, ...shot.matchedAssetIds]))
    .filter((assetId) => allowedAssetIds.has(assetId) && assetKindById.get(assetId) === "VIDEO");
  const imageAssetIds = Array.from(new Set([...shot.auxiliaryImageAssetIds, ...shot.matchedAssetIds]))
    .filter((assetId) => allowedAssetIds.has(assetId) && assetKindById.get(assetId) === "IMAGE");
  return { videoAssetIds, imageAssetIds, assetIds: [...videoAssetIds, ...imageAssetIds] };
}

export function matchesRestrictedTerms(content: unknown, terms: string[]): boolean {
  const normalized = (typeof content === "string" ? content : JSON.stringify(content ?? "")).toLowerCase();
  return terms.some((term) => {
    const blocked = term.trim().toLowerCase();
    return blocked.length > 0 && normalized.includes(blocked);
  });
}

type AiShotGeneration = {
  taskId: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  prompt: string;
  duration: number;
  model: string;
  referenceAssetId?: string;
  productId?: string;
  assetId?: string;
  failureReason?: string;
  requestedAt?: string;
  completedAt?: string;
};

export function buildAiShotPrompt(input: { topic: string; productModel?: string | null; description: string }) {
  return [
    `为短视频“${input.topic}”生成一个真实自然的竖屏补拍镜头。`,
    input.productModel ? `产品型号：${input.productModel}，保持产品外观、结构和佩戴方式一致。` : "",
    `镜头内容：${input.description}。`,
    "电商UGC实拍质感，动作清楚，主体完整，光线自然，镜头稳定，不添加字幕、Logo或水印。",
  ].filter(Boolean).join("");
}

export function completeAiShotRequirement(requirement: Record<string, unknown>, generation: AiShotGeneration, assetId: string) {
  const assetIds = Array.from(new Set([
    ...(Array.isArray(requirement.assetIds) ? requirement.assetIds.map(String) : []),
    assetId,
  ]));
  const videoAssetIds = Array.from(new Set([
    ...(Array.isArray(requirement.videoAssetIds) ? requirement.videoAssetIds.map(String) : []),
    assetId,
  ]));
  return {
    ...requirement,
    status: "DONE",
    coverage: "EXISTING",
    assetIds,
    videoAssetIds,
    note: "AI智能生成的视频已自动关联",
    aiGeneration: { ...generation, status: "SUCCEEDED", assetId, completedAt: new Date().toISOString(), failureReason: undefined },
  };
}

const shotSemanticAnchors = [
  "手腕", "佩戴", "抬臂", "静坐", "走路", "跑步", "老人", "父母", "家庭", "户外",
  "表盘", "弹窗", "提示", "心脏", "心率", "心电", "血压", "血氧", "气囊", "充气",
  "测量", "数值", "高压", "低压", "脉搏", "暂停", "故障", "蜂鸣", "声音",
  "特写", "近景", "中景", "全景", "俯拍", "侧拍", "屏幕", "字幕", "logo",
] as const;

type MatchableAsset = {
  id: string; displayName?: string | null; contentDescription?: string | null; searchText?: string | null;
  scene?: string | null; aiIndex?: unknown; productScope?: string | null;
  products?: Array<{ product?: { modelCode?: string | null } | null }>;
  tags?: Array<{ code?: string | null; label?: string | null }>;
  segments?: Array<{ moduleType?: string | null; transcript?: string | null }>;
};

export function scoreShotAssetRelevance(description: string, productModel: string | undefined, asset: MatchableAsset) {
  const shot = description.toLowerCase();
  const text = [
    asset.displayName, asset.contentDescription, asset.searchText, asset.scene, JSON.stringify(asset.aiIndex ?? {}),
    ...(asset.tags || []).flatMap((tag) => [tag.code, tag.label]),
    ...(asset.segments || []).flatMap((segment) => [segment.moduleType, segment.transcript]),
  ].filter(Boolean).join(" ").toLowerCase();
  const required = shotSemanticAnchors.filter((term) => shot.includes(term));
  const matched = required.filter((term) => text.includes(term));
  const model = (productModel || "").trim().toLowerCase();
  const linkedModels = (asset.products || []).map((item) => item.product?.modelCode?.toLowerCase()).filter(Boolean);
  const modelMatched = !model || text.includes(model) || linkedModels.includes(model);
  const score = required.length ? matched.length / required.length : 0;
  return {
    accepted: modelMatched && required.length > 0 && score >= 0.6 && (matched.length >= 2 || required.length === 1),
    score: Math.round(score * 100), required, matched, modelMatched,
  };
}

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: ContentGuardService,
    private readonly aiContent: AiContentService,
    private readonly platforms: PlatformRegistry,
    @Optional() private readonly smartKeywords?: SmartKeywordService,
    @Optional() private readonly oss?: OssStorageService,
  ) {}

  private productionNo(date = new Date()) {
    return `VP-${localDateKey(date).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
  }

  private normalizeVideoAssetCoverage<T extends {
    kind: string;
    status: string;
    productionStage: string;
    shootRequirements: unknown;
    contentAssets?: Array<{ asset: { id: string; kind?: string | null } }>;
  }>(plan: T): T {
    if (plan.kind !== "VIDEO" || !["SCRIPT_REVIEW", "AWAITING_ASSETS", "READY_TO_EDIT"].includes(plan.productionStage)) return plan;
    const kindById = new Map((plan.contentAssets || []).map(({ asset }) => [asset.id, String(asset.kind || "").toUpperCase()]));
    const requirements = Array.isArray(plan.shootRequirements) ? plan.shootRequirements as Array<Record<string, unknown>> : [];
    const normalized = requirements.map((item) => {
      const assetIds = Array.isArray(item.assetIds) ? item.assetIds.map(String).filter(Boolean) : [];
      const videoAssetIds = Array.from(new Set([
        ...(Array.isArray(item.videoAssetIds) ? item.videoAssetIds.map(String) : []),
        ...assetIds,
      ])).filter((assetId) => kindById.get(assetId) === "VIDEO");
      const imageAssetIds = Array.from(new Set([
        ...(Array.isArray(item.imageAssetIds) ? item.imageAssetIds.map(String) : []),
        ...assetIds,
      ])).filter((assetId) => kindById.get(assetId) === "IMAGE");
      const covered = videoAssetIds.length > 0;
      return {
        ...item,
        assetIds: [...videoAssetIds, ...imageAssetIds],
        videoAssetIds,
        imageAssetIds,
        coverage: covered ? "EXISTING" : "MISSING",
        status: covered ? "DONE" : imageAssetIds.length ? "IN_PROGRESS" : "OPEN",
        ...(!covered && imageAssetIds.length ? { reason: "当前只有静态图片，可作为辅助画面，仍需补拍视频主画面" } : {}),
      };
    });
    const productionStage = plan.status === "APPROVED" && normalized.length > 0 && normalized.every((item) => item.status === "DONE")
      ? "READY_TO_EDIT"
      : plan.status === "APPROVED" ? "AWAITING_ASSETS" : plan.productionStage;
    return { ...plan, shootRequirements: normalized, productionStage };
  }

  async generateDaily(date = new Date(), actor = "系统内容引擎", options: { restricted?: boolean } = {}): Promise<{ created: number; selected: string[] }> {
    const video = await this.generateDailyVideo(date, actor, undefined, options);
    const article = await this.generateDailyArticle(date, actor);
    return {
      created: video.created + article.created,
      selected: [...video.selected, ...article.selected],
    };
  }

  async generateDailyVideo(
    date = new Date(),
    actor = "系统内容引擎",
    productModel?: string,
    options: { assetOnly?: boolean; restricted?: boolean; platform?: IntegrationKind; keywordIds?: string[]; force?: boolean } = {},
  ): Promise<{ created: number; selected: string[] }> {
    const planDate = startOfShanghaiDay(date);
    if (!options.assetOnly && !options.restricted && !options.force) {
      const existing = await this.prisma.contentPlan.count({
        where: { kind: "VIDEO", planDate: { gte: planDate, lt: new Date(planDate.getTime() + 24 * 60 * 60 * 1000) } },
      });
      if (existing) return { created: 0, selected: [] };
    }
    const keywordPlatform = options.platform === "TIKTOK" ? "TIKTOK" : "DOUYIN";
    const baseContext = await this.generationContext(productModel, options.restricted, keywordPlatform, options.keywordIds);
    const restrictionRules = options.restricted
      ? await this.prisma.phraseRule.findMany({
        where: { active: true, category: { in: ["HEALTH_RESTRICTED_WORD", "HEALTH_RESTRICTED_VISUAL"] } },
        select: { category: true, blockedText: true, condition: true },
        orderBy: [{ category: "asc" }, { blockedText: "asc" }],
      })
      : [];
    const context: Record<string, unknown> = {
      ...baseContext,
      generationMode: options.assetOnly ? "ASSET_ONLY" : "ASSET_FIRST",
      contentRestrictionMode: options.restricted ? "HEALTH_RESTRICTED" : "NORMAL",
      restrictedWords: restrictionRules.filter((item) => item.category === "HEALTH_RESTRICTED_WORD").map((item) => item.blockedText),
      restrictedVisuals: restrictionRules.filter((item) => item.category === "HEALTH_RESTRICTED_VISUAL").map((item) => item.blockedText),
      generationGoal: options.assetOnly
        ? "只使用素材库已有素材，审核通过后直接进入AI剪辑"
        : "优先复用素材库已有素材，尽量减少补拍",
    };
    const generatedCandidates = await this.aiContent.generateVideoCandidates(context);
    const restrictedTerms = restrictionRules.map((item) => item.blockedText.trim().toLowerCase()).filter(Boolean);
    const candidates = options.restricted
      ? generatedCandidates.filter((candidate) => {
        const candidateText = this.videoExecutionBody(candidate).toLowerCase();
        return !matchesRestrictedTerms(candidateText, restrictedTerms);
      })
      : generatedCandidates;
    if (options.restricted && !candidates.length) {
      throw new BadRequestException("AI生成结果仍包含受限词，请调整限制规则或稍后重试");
    }
    const assetRows = context.assets as Array<{ id: string; kind?: string }>;
    const allowedAssetIds = new Set(assetRows.map((item) => item.id));
    const assetKindById = new Map(assetRows.map((item) => [item.id, String(item.kind || "").toUpperCase()]));
    const assetById = new Map(assetRows.map((item) => [item.id, item as MatchableAsset]));
    const coverages = await Promise.all(candidates.map((candidate) => this.aiContent.analyzeVideoAssetCoverage({
      productModel: context.productModel,
      script: { topic: candidate.topic, hook: candidate.hook, outline: candidate.outline, scripts: candidate.scripts },
      assets: context.assets,
    })));
    const ranked = candidates.map((candidate, index) => {
      const coverage = coverages[index];
      const missingCount = coverage.shots.filter((shot) => {
        const resolved = resolveVideoShotAssets(shot, allowedAssetIds, assetKindById);
        const relevantVideos = resolved.videoAssetIds.filter((id) =>
          scoreShotAssetRelevance(shot.description, String(context.productModel || ""), assetById.get(id)!).accepted);
        return shot.coverage !== "EXISTING" || relevantVideos.length === 0;
      }).length;
      return { candidate, coverage, missingCount };
    }).sort((left, right) => left.missingCount - right.missingCount || right.candidate.score - left.candidate.score);
    const generationRows = options.assetOnly
      ? ranked.filter((item) => item.coverage.shots.length > 0 && item.missingCount === 0).slice(0, 1)
      : ranked;
    if (options.assetOnly && !generationRows.length) {
      throw new BadRequestException(`当前${String(context.productModel || "产品")}素材不足，未找到可完全由已有素材覆盖的脚本`);
    }
    const selected: string[] = [];
    let created = 0;
    for (let index = 0; index < generationRows.length; index += 1) {
      const { candidate, coverage, missingCount } = generationRows[index];
      const body = this.videoExecutionBody(candidate);
      const guard = await this.guard.evaluate({
        title: candidate.topic,
        body,
        productModel: String(context.productModel || ""),
        evidenceIds: (context.product as { evidenceIds?: string[] }).evidenceIds || [],
      });
      const coverageAssetIds = coverage.shots.flatMap((shot) => [...shot.matchedVideoAssetIds, ...shot.auxiliaryImageAssetIds, ...shot.matchedAssetIds]);
      const assetIds = Array.from(new Set([...candidate.assetIds, ...coverageAssetIds].filter((id) => allowedAssetIds.has(id))));
      const shootRequirements = coverage.shots.map((shot, shotIndex) => {
        const resolved = resolveVideoShotAssets(shot, allowedAssetIds, assetKindById);
        const videoAssetIds = resolved.videoAssetIds.filter((id) =>
          scoreShotAssetRelevance(shot.description, String(context.productModel || ""), assetById.get(id)!).accepted);
        const imageAssetIds = resolved.imageAssetIds.filter((id) =>
          scoreShotAssetRelevance(shot.description, String(context.productModel || ""), assetById.get(id)!).accepted);
        const matchedAssetIds = [...videoAssetIds, ...imageAssetIds];
        const existing = shot.coverage === "EXISTING" && videoAssetIds.length > 0;
        const relevanceReason = !existing && resolved.videoAssetIds.length
          ? "候选视频与镜头的型号、功能、动作或场景匹配度不足，已改为需要补拍"
          : shot.reason;
        return {
          id: `shot-${shotIndex + 1}`,
          description: shot.description,
          status: existing ? "DONE" : "OPEN",
          coverage: existing ? "EXISTING" : "MISSING",
          assetIds: matchedAssetIds,
          videoAssetIds,
          imageAssetIds,
          reason: !existing && imageAssetIds.length && !videoAssetIds.length ? `${relevanceReason ? `${relevanceReason}；` : ""}当前只有静态图片，可作为辅助画面，仍需补拍视频主画面` : relevanceReason,
        };
      });
      const plan = await this.prisma.contentPlan.create({
        data: {
          productionNo: this.productionNo(date),
          productionStage: "SCRIPT_REVIEW",
          shootRequirements,
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
          sourceSignals: [{
            externalVideoIds: candidate.referenceIds,
            mainKeyword: (context.keywordPlan as { main?: { keyword?: string } }).main?.keyword || null,
            mainKeywordId: (context.keywordPlan as { main?: { id?: string } }).main?.id || null,
            auxiliaryKeywords: ((context.keywordPlan as { auxiliary?: Array<{ keyword?: string }> }).auxiliary || []).map((item) => String(item.keyword || "")).filter(Boolean),
            auxiliaryKeywordIds: ((context.keywordPlan as { auxiliary?: Array<{ id?: string }> }).auxiliary || []).map((item) => String(item.id || "")).filter(Boolean),
            keywordCluster: JSON.parse(JSON.stringify((context.keywordPlan as { cluster?: unknown }).cluster ?? null)),
            keywordDirection: JSON.parse(JSON.stringify((context.keywordPlan as { direction?: unknown }).direction ?? null)),
            keywordPlatform,
            missingAssets: shootRequirements.filter((item) => item.coverage === "MISSING").map((item) => item.description),
            generationMode: options.assetOnly ? "ASSET_ONLY" : "ASSET_FIRST",
            contentRestrictionMode: options.restricted ? "HEALTH_RESTRICTED" : "NORMAL",
            existingAssetCount: assetIds.length,
            missingShotCount: missingCount,
            capturedAt: new Date().toISOString(),
          }],
          evidenceIds: guard.evidenceIds,
          riskReasons: guard.reasons,
          createdBy: actor,
          actorType: "AI",
          aiProvider: "ALIYUN_BAILIAN",
          aiModel: opsConfig.bailian.textModel,
          promptVersion: `${options.assetOnly ? "brand-content-asset-only-v1" : "brand-content-asset-first-v3"}${options.restricted ? "-health-restricted-v1" : ""}`,
          status: index === 0 && guard.allowed ? "PENDING_APPROVAL" : "DRAFT",
          variants: { create: this.videoVariants(candidate) },
          contentAssets: { create: assetIds.map((assetId) => ({ assetId, role: "SCRIPT_MATCH" })) },
          keywordRelations: {
            create: [
              ...((context.keywordPlan as { main?: { id?: string } }).main?.id
                ? [{
                  keywordId: (context.keywordPlan as { main: { id: string } }).main.id,
                  usageType: "SMART_VIDEO",
                  position: "PRIMARY",
                }]
                : []),
              ...((context.keywordPlan as { auxiliary?: Array<{ id?: string }> }).auxiliary || [])
                .filter((item): item is { id: string } => Boolean(item.id))
                .map((item) => ({ keywordId: item.id, usageType: "SMART_VIDEO", position: "AUXILIARY" })),
            ],
          },
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
      { platform: "DOUYIN", title: candidate.titleZh || candidate.topic, body: zhBody, mediaType: "video/mp4", packagingStatus: "PENDING", metadata: { scriptTitle: candidate.titleZh, coverText: candidate.coverTextZh, language: "zh-CN" } },
      { platform: "TIKTOK", title: candidate.titleEn || candidate.topic, body: enBody, mediaType: "video/mp4", packagingStatus: "PENDING", metadata: { scriptTitle: candidate.titleEn, coverText: candidate.coverTextEn, language: "en-US" } },
      { platform: "WECHAT_CHANNELS", title: candidate.titleZh || candidate.topic, body: zhBody, mediaType: "video/mp4", packagingStatus: "PENDING", metadata: { scriptTitle: candidate.titleZh, coverText: candidate.coverTextZh, language: "zh-CN" } },
      { platform: "XIAOHONGSHU", title: candidate.titleZh || candidate.topic, body: zhBody, mediaType: "video/mp4", packagingStatus: "PENDING", metadata: { scriptTitle: candidate.titleZh, coverText: candidate.coverTextZh, language: "zh-CN" } },
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

  private async generationContext(
    productModel?: string,
    restricted = false,
    keywordPlatform: "DOUYIN" | "TIKTOK" = "DOUYIN",
    requestedKeywordIds: string[] = [],
  ): Promise<Record<string, unknown>> {
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
    const [knowledge, faqs, assetRows, externalVideos, restrictedRules, keywordRows, activeDirections, requestedKeywordRows] = await Promise.all([
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
          aiIndex: true,
          searchText: true,
          indexVersion: true,
          scene: true,
          productScope: true,
          products: { select: { product: { select: { modelCode: true } } } },
          tags: { select: { tag: { select: { namespace: true, code: true, label: true } } } },
          segments: { select: { moduleType: true, startSeconds: true, endSeconds: true, transcript: true, confidence: true }, orderBy: { startSeconds: "asc" }, take: 12 },
        },
        orderBy: [{ qualityScore: "desc" }, { useCount: "desc" }],
        take: 60,
      }),
      this.prisma.externalVideo.findMany({
        where: { platform: keywordPlatform, status: "READY", rightsStatus: "INTERNAL", level: "REFERENCE", availabilityStatus: "INACTIVE" },
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
      restricted
        ? this.prisma.phraseRule.findMany({
          where: { active: true, category: { in: ["HEALTH_RESTRICTED_WORD", "HEALTH_RESTRICTED_VISUAL"] } },
          select: { blockedText: true },
        })
        : Promise.resolve([]),
      this.smartKeywords ? this.smartKeywords.active(keywordPlatform, "SMART_VIDEO") : Promise.resolve([]),
      this.prisma.smartKeywordDirection.findMany({
        where: {
          platform: keywordPlatform,
          active: true,
          startAt: { lte: new Date() },
          OR: [{ endAt: null }, { endAt: { gte: new Date() } }],
        },
        orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
        take: 10,
      }),
      requestedKeywordIds.length
        ? this.prisma.smartKeyword.findMany({
          where: { id: { in: requestedKeywordIds }, platform: keywordPlatform, status: "ACTIVE", contentEnabled: true, grade: { in: ["S", "A"] } },
          include: { product: true, cluster: true },
        })
        : Promise.resolve([]),
    ]);
    const requested = new Set(requestedKeywordIds);
    const eligibleKeywords = ([...requestedKeywordRows, ...keywordRows] as Array<{
      id: string;
      keyword: string;
      productId: string | null;
      opportunityScore: number;
      grade: string;
      cluster: unknown;
      type: string;
    }>)
      .filter((item, index, rows) => rows.findIndex((candidate) => candidate.id === item.id) === index)
      .filter((item) => !item.productId || item.productId === product.id);
    const productKeywords = [
      ...eligibleKeywords.filter((item) => requested.has(item.id)),
      ...eligibleKeywords.filter((item) => !requested.has(item.id)),
    ].slice(0, 5);
    const keywordPlan = {
      main: productKeywords[0] || null,
      auxiliary: productKeywords.slice(1, 5),
      cluster: productKeywords[0]?.cluster || null,
      direction: activeDirections.find((item) => item.productIds.includes(product.id))
        || activeDirections.find((item) => {
          const keywordText = productKeywords.map((keyword) => keyword.keyword.toLowerCase()).join(" ");
          return [...item.boostTerms, ...item.audienceTerms, ...item.painTerms, ...item.sceneTerms]
            .some((term) => keywordText.includes(term.toLowerCase()));
        })
        || null,
      rule: "1个主关键词＋2—4个辅助关键词；不得机械堆词",
    };
    const restrictedTerms = restrictedRules.map((item) => item.blockedText.trim().toLowerCase()).filter(Boolean);
    const assets = restricted ? assetRows.filter((asset) => {
      const indexText = [
        asset.displayName,
        asset.contentDescription,
        asset.searchText,
        JSON.stringify(asset.aiIndex),
        ...asset.tags.flatMap((item) => [item.tag.code, item.tag.label]),
        ...asset.segments.flatMap((item) => [item.moduleType, item.transcript]),
      ].filter(Boolean).join(" ").toLowerCase();
      return !matchesRestrictedTerms(indexText, restrictedTerms);
    }) : assetRows;
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
      keywordPlan,
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
    await this.prisma.contentPlan.update({
      where: { id: planId },
      data: { masterVideoStatus: opsConfig.videoRenderCommand ? "WAITING_ASSETS" : "WAITING_RENDER_PROVIDER" },
    });
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
      await this.prisma.contentPlan.update({
        where: { id: planId },
        data: { masterVideoPath: outputPath, masterVideoStatus: "READY_FOR_REVIEW", productionStage: "VIDEO_REVIEW" },
      });
      await this.prisma.auditLog.create({ data: { actor: "系统视频渲染", action: "VIDEO_RENDERED", entityType: "ContentPlan", entityId: planId, after: { outputPath } } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "视频渲染失败";
      await this.prisma.contentVariant.updateMany({
        where: { contentPlanId: planId, mediaType: "video/mp4" },
        data: { metadata: { briefPath, renderState: "FAILED", error: message } },
      });
      await this.prisma.contentPlan.update({ where: { id: planId }, data: { masterVideoStatus: "FAILED", productionStage: "EDITING" } });
      await this.prisma.alert.create({ data: { level: "WARNING", category: "CONTENT", title: "每日主视频渲染失败", message, sourceType: "ContentPlan", sourceId: planId } });
    }
  }

  async approve(id: string, actor: string, note?: string, options: { owner?: string; targetPlatforms?: IntegrationKind[] } = {}) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id }, include: { variants: true } });
    if (!plan) throw new NotFoundException("内容不存在");
    const body = plan.variants.map((variant) => `${variant.title}\n${variant.body}`).join("\n");
    const existingRequirements = Array.isArray(plan.shootRequirements) ? plan.shootRequirements : [];
    const shootRequirements = plan.kind === "VIDEO" && existingRequirements.length === 0
      ? [{ id: "shot-main", description: "本脚本所需拍摄素材", status: "OPEN", assetIds: [] }]
      : existingRequirements;
    const assetsReady = plan.kind === "VIDEO"
      && shootRequirements.length > 0
      && shootRequirements.every((item) => item && typeof item === "object" && !Array.isArray(item) && String((item as Record<string, unknown>).status) === "DONE");
    const guard = await this.guard.evaluate({ title: plan.topic, body, productModel: plan.productModel ?? undefined, evidenceIds: plan.evidenceIds });
    if (!guard.allowed) throw new BadRequestException(guard.reasons.join("；"));
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contentPlan.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvedBy: actor,
          approvedAt: new Date(),
          riskReasons: [],
          shootRequirements,
          owner: options.owner || actor,
          targetPlatforms: options.targetPlatforms?.length ? options.targetPlatforms : plan.variants.map((variant) => variant.platform),
          productionStage: plan.kind === "VIDEO" ? (assetsReady ? "READY_TO_EDIT" : "AWAITING_ASSETS") : "PACKAGING_REVIEW",
        },
      });
      if (plan.kind !== "VIDEO") await tx.contentVariant.updateMany({ where: { contentPlanId: id }, data: { status: "APPROVED" } });
      await tx.approval.create({ data: { contentPlanId: id, action: "SCRIPT_APPROVE", actor, note } });
      await tx.auditLog.create({ data: { actor, action: "CONTENT_APPROVE", entityType: "ContentPlan", entityId: id, after: { status: "APPROVED" } } });
      return updated;
    });
  }

  async reject(id: string, actor: string, reason: string) {
    if (!reason.trim()) throw new BadRequestException("请填写退回原因");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contentPlan.update({ where: { id }, data: { status: "REJECTED", rejectedReason: reason } });
      await tx.contentVariant.updateMany({ where: { contentPlanId: id }, data: { status: "REJECTED" } });
      await tx.approval.create({ data: { contentPlanId: id, action: "SCRIPT_REJECT", actor, note: reason } });
      await tx.auditLog.create({ data: { actor, action: "CONTENT_REJECT", entityType: "ContentPlan", entityId: id, after: { status: "REJECTED", reason } } });
      return updated;
    });
  }

  async updateShootRequirements(id: string, requirements: unknown[], actor: string) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id } });
    if (!plan || plan.kind !== "VIDEO") throw new NotFoundException("视频生产单不存在");
    const rows = requirements.map((value, index) => {
      const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      const description = String(row.description || "").trim();
      if (!description) throw new BadRequestException(`第${index + 1}项补拍要求缺少说明`);
      return {
        id: String(row.id || `shot-${index + 1}`),
        description,
        status: ["OPEN", "IN_PROGRESS", "DONE"].includes(String(row.status)) ? String(row.status) : "OPEN",
        coverage: String(row.coverage) === "EXISTING" ? "EXISTING" : "MISSING",
        assetIds: Array.isArray(row.assetIds) ? row.assetIds.map(String).filter(Boolean) : [],
        videoAssetIds: Array.isArray(row.videoAssetIds) ? row.videoAssetIds.map(String).filter(Boolean) : [],
        imageAssetIds: Array.isArray(row.imageAssetIds) ? row.imageAssetIds.map(String).filter(Boolean) : [],
        reason: String(row.reason || ""),
        note: String(row.note || ""),
      };
    });
    const updated = await this.prisma.contentPlan.update({
      where: { id },
      data: {
        shootRequirements: rows,
        productionStage: rows.every((row) => row.status === "DONE") ? "READY_TO_EDIT" : "AWAITING_ASSETS",
      },
    });
    await this.prisma.auditLog.create({ data: { actor, action: "SHOOT_REQUIREMENTS_UPDATE", entityType: "ContentPlan", entityId: id, after: { requirements: rows } } });
    return updated;
  }

  async refreshAssetCoverage(id: string, actor: string) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id }, include: { variants: true } });
    if (!plan || plan.kind !== "VIDEO") throw new NotFoundException("视频生产单不存在");
    if (!["APPROVED", "SCHEDULED"].includes(plan.status)) throw new BadRequestException("请先通过脚本审核，再分析素材覆盖");
    const signals = Array.isArray(plan.sourceSignals) ? plan.sourceSignals as Array<Record<string, unknown>> : [];
    const restricted = signals.some((item) => item.contentRestrictionMode === "HEALTH_RESTRICTED");
    const context = await this.generationContext(plan.productModel || undefined, restricted);
    const assetRows = context.assets as Array<{ id: string; kind?: string }>;
    const allowedAssetIds = new Set(assetRows.map((item) => item.id));
    const assetKindById = new Map(assetRows.map((item) => [item.id, String(item.kind || "").toUpperCase()]));
    const refreshAssetById = new Map(assetRows.map((item) => [item.id, item as MatchableAsset]));
    const coverage = await this.aiContent.analyzeVideoAssetCoverage({
      productModel: plan.productModel,
      script: {
        topic: plan.topic,
        hook: plan.hook,
        outline: plan.outline,
        variants: plan.variants.map((variant) => ({ platform: variant.platform, title: variant.title, body: variant.body })),
      },
      assets: context.assets,
    });
    if (!coverage.shots.length) throw new BadRequestException("AI未能形成逐镜头素材清单，请重试");
    const requirements = coverage.shots.map((shot, index) => {
      const resolved = resolveVideoShotAssets(shot, allowedAssetIds, assetKindById);
      const videoAssetIds = resolved.videoAssetIds.filter((assetId) =>
        scoreShotAssetRelevance(shot.description, plan.productModel || undefined, refreshAssetById.get(assetId)!).accepted);
      const imageAssetIds = resolved.imageAssetIds.filter((assetId) =>
        scoreShotAssetRelevance(shot.description, plan.productModel || undefined, refreshAssetById.get(assetId)!).accepted);
      const assetIds = [...videoAssetIds, ...imageAssetIds];
      const existing = shot.coverage === "EXISTING" && videoAssetIds.length > 0;
      const relevanceReason = !existing && resolved.videoAssetIds.length
        ? "候选视频与镜头的型号、功能、动作或场景匹配度不足，已改为需要补拍"
        : shot.reason;
      return {
        id: `shot-${index + 1}`,
        description: shot.description,
        status: existing ? "DONE" : "OPEN",
        coverage: existing ? "EXISTING" : "MISSING",
        assetIds,
        videoAssetIds,
        imageAssetIds,
        reason: !existing && imageAssetIds.length && !videoAssetIds.length ? `${relevanceReason ? `${relevanceReason}；` : ""}当前只有静态图片，可作为辅助画面，仍需补拍视频主画面` : relevanceReason,
      };
    });
    const matchedAssetIds = Array.from(new Set(requirements.flatMap((item) => item.assetIds)));
    const productionStage = requirements.every((item) => item.status === "DONE") ? "READY_TO_EDIT" : "AWAITING_ASSETS";
    await this.prisma.$transaction(async (tx) => {
      if (matchedAssetIds.length) {
        await tx.contentAsset.createMany({
          data: matchedAssetIds.map((assetId) => ({ contentPlanId: id, assetId, role: "SCRIPT_MATCH" })),
          skipDuplicates: true,
        });
      }
      await tx.contentPlan.update({ where: { id }, data: { shootRequirements: requirements, productionStage } });
      await tx.auditLog.create({ data: { actor, action: "SCRIPT_ASSET_COVERAGE_REFRESH", entityType: "ContentPlan", entityId: id, after: { requirements, productionStage } } });
    });
    return this.workflow(id);
  }

  async startAiShotGeneration(
    id: string,
    requirementId: string,
    input: { prompt?: string; duration?: number },
    actor: string,
  ) {
    if (!opsConfig.bailian.apiKey) throw new BadRequestException("AI视频生成服务未配置");
    if (!this.oss?.isConfigured()) throw new BadRequestException("素材存储未配置，暂时无法保存AI生成视频");
    const plan = await this.prisma.contentPlan.findUnique({ where: { id } });
    if (!plan || plan.kind !== "VIDEO") throw new NotFoundException("视频生产单不存在");
    const requirements = Array.isArray(plan.shootRequirements) ? plan.shootRequirements as Array<Record<string, unknown>> : [];
    const target = requirements.find((item) => String(item.id) === requirementId);
    if (!target) throw new NotFoundException("镜头素材项不存在");
    const current = target.aiGeneration && typeof target.aiGeneration === "object" && !Array.isArray(target.aiGeneration)
      ? target.aiGeneration as AiShotGeneration
      : undefined;
    if (current && ["PENDING", "RUNNING"].includes(current.status)) return current;

    const duration = input.duration === 10 ? 10 : 5;
    const prompt = String(input.prompt || "").trim() || buildAiShotPrompt({
      topic: plan.topic,
      productModel: plan.productModel,
      description: String(target.description || ""),
    });
    const product = plan.productModel
      ? await this.prisma.product.findUnique({ where: { modelCode: plan.productModel } })
      : null;
    const referenceAsset = product
      ? await this.prisma.asset.findFirst({
        where: {
          kind: "IMAGE",
          objectKey: { not: null },
          reviewStatus: "APPROVED",
          availabilityStatus: "ACTIVE",
          rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
          products: { some: { productId: product.id } },
        },
        orderBy: [{ qualityScore: "desc" }, { createdAt: "desc" }],
      })
      : null;
    const model = referenceAsset ? opsConfig.bailian.imageToVideoModel : opsConfig.bailian.textToVideoModel;
    const requestInput: Record<string, unknown> = { prompt };
    if (referenceAsset?.objectKey) requestInput.img_url = this.oss.signedDownloadUrl(referenceAsset.objectKey, 3_600);
    const response = await fetch(opsConfig.bailian.videoGenerationUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opsConfig.bailian.apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model,
        input: requestInput,
        parameters: referenceAsset
          ? { resolution: "480P", prompt_extend: true, duration, watermark: false }
          : { size: "480*832", prompt_extend: true, duration, watermark: false },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({})) as {
      output?: { task_id?: string; task_status?: string };
      code?: string;
      message?: string;
    };
    const taskId = String(payload.output?.task_id || "");
    if (!response.ok || !taskId) {
      throw new BadRequestException(payload.message || payload.code || `AI视频生成任务创建失败（${response.status}）`);
    }
    const generation: AiShotGeneration = {
      taskId,
      status: payload.output?.task_status === "RUNNING" ? "RUNNING" : "PENDING",
      prompt,
      duration,
      model,
      referenceAssetId: referenceAsset?.id,
      productId: product?.id,
      requestedAt: new Date().toISOString(),
    };
    const next = requirements.map((item) => String(item.id) === requirementId
      ? { ...item, status: "IN_PROGRESS", note: "AI智能生成中", aiGeneration: generation }
      : item);
    await this.prisma.$transaction([
      this.prisma.contentPlan.update({
        where: { id },
        data: { shootRequirements: JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue, productionStage: "AWAITING_ASSETS" },
      }),
      this.prisma.auditLog.create({
        data: {
          actor,
          action: "SHOT_AI_GENERATION_START",
          entityType: "ContentPlan",
          entityId: id,
          after: { requirementId, taskId, model, duration, referenceAssetId: referenceAsset?.id },
        },
      }),
    ]);
    return generation;
  }

  async getAiShotGeneration(id: string, requirementId: string, actor: string) {
    if (!opsConfig.bailian.apiKey) throw new BadRequestException("AI视频生成服务未配置");
    if (!this.oss?.isConfigured()) throw new BadRequestException("素材存储未配置，暂时无法保存AI生成视频");
    const plan = await this.prisma.contentPlan.findUnique({ where: { id } });
    if (!plan || plan.kind !== "VIDEO") throw new NotFoundException("视频生产单不存在");
    const requirements = Array.isArray(plan.shootRequirements) ? plan.shootRequirements as Array<Record<string, unknown>> : [];
    const target = requirements.find((item) => String(item.id) === requirementId);
    if (!target) throw new NotFoundException("镜头素材项不存在");
    const generation = target.aiGeneration && typeof target.aiGeneration === "object" && !Array.isArray(target.aiGeneration)
      ? target.aiGeneration as AiShotGeneration
      : undefined;
    if (!generation?.taskId) throw new NotFoundException("该镜头尚未创建AI生成任务");
    if (generation.status === "SUCCEEDED" && generation.assetId) return generation;

    const response = await fetch(`${opsConfig.bailian.taskUrl.replace(/\/$/u, "")}/${encodeURIComponent(generation.taskId)}`, {
      headers: { Authorization: `Bearer ${opsConfig.bailian.apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as {
      output?: { task_status?: string; video_url?: string; message?: string };
      code?: string;
      message?: string;
    };
    if (!response.ok) throw new BadRequestException(payload.message || payload.code || `AI视频生成进度查询失败（${response.status}）`);
    const remoteStatus = String(payload.output?.task_status || "UNKNOWN");
    if (remoteStatus !== "SUCCEEDED") {
      const status: AiShotGeneration["status"] = remoteStatus === "FAILED" || remoteStatus === "CANCELED" || remoteStatus === "UNKNOWN"
        ? "FAILED"
        : remoteStatus === "RUNNING" ? "RUNNING" : "PENDING";
      const updatedGeneration: AiShotGeneration = {
        ...generation,
        status,
        failureReason: status === "FAILED" ? String(payload.output?.message || payload.message || "AI视频生成失败") : undefined,
      };
      const next = requirements.map((item) => String(item.id) === requirementId
        ? {
          ...item,
          status: status === "FAILED" ? "OPEN" : "IN_PROGRESS",
          note: status === "FAILED" ? updatedGeneration.failureReason : "AI智能生成中",
          aiGeneration: updatedGeneration,
        }
        : item);
      await this.prisma.contentPlan.update({
        where: { id },
        data: { shootRequirements: JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue },
      });
      return updatedGeneration;
    }

    const videoUrl = String(payload.output?.video_url || "");
    if (!videoUrl) throw new BadRequestException("AI视频已生成，但未返回成品地址");
    let asset = await this.prisma.asset.findUnique({ where: { sourceKey: `AI_GENERATED:${generation.taskId}` } });
    if (!asset) {
      const videoResponse = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
      if (!videoResponse.ok) throw new BadRequestException(`AI视频下载失败（${videoResponse.status}）`);
      const buffer = Buffer.from(await videoResponse.arrayBuffer());
      const hash = createHash("sha256").update(buffer).digest("hex");
      const publicNo = `SD-VIDEO-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const objectKey = this.oss.derivedObjectKey(generation.taskId, "ai-shot", 1, hash, ".mp4");
      const stored = await this.oss.uploadGeneratedBuffer({
        objectKey,
        buffer,
        actor,
        sourceType: "AI_GENERATED",
        sha256: hash,
        originalName: `${publicNo}.mp4`,
      });
      asset = await this.prisma.asset.create({
        data: {
          sourceKey: `AI_GENERATED:${generation.taskId}`,
          sourceType: "AI_GENERATED",
          sourcePath: `oss://${objectKey}`,
          fileName: `${publicNo}.mp4`,
          originalFileName: `${publicNo}.mp4`,
          extension: ".mp4",
          mediaType: "VIDEO",
          kind: "VIDEO",
          assetNo: publicNo,
          displayName: `AI补拍-${String(target.description || "").slice(0, 36)}`,
          level: "AI_GENERATED",
          productScope: generation.productId ? "MODEL" : "UNKNOWN",
          processingStatus: "READY_FOR_REVIEW",
          reviewStatus: "APPROVED",
          availabilityStatus: "ACTIVE",
          rightsStatus: "COMMERCIAL",
          sha256: hash,
          sizeBytes: buffer.length,
          modifiedAt: new Date(),
          width: 480,
          height: 832,
          durationSeconds: generation.duration,
          aspectRatio: "9:16",
          model: plan.productModel,
          status: "READY",
          qualityScore: 80,
          contentDescription: String(target.description || ""),
          isOriginal: false,
          sourceSnapshot: {
            provider: "BAILIAN_WAN",
            taskId: generation.taskId,
            model: generation.model,
            prompt: generation.prompt,
            referenceAssetId: generation.referenceAssetId,
          },
          aiIndex: {
            source: "AI_GENERATED",
            prompt: generation.prompt,
            shotRequirementId: requirementId,
            contentPlanId: id,
          },
          searchText: `${plan.productModel || ""} ${target.description || ""} AI生成补拍视频`,
          indexNeedsReview: false,
          storageProvider: "ALIYUN_OSS",
          objectKey,
          objectVersionId: stored.objectVersionId,
          etag: stored.etag,
          storageUrl: stored.storageUrl,
          storageSyncedAt: stored.uploadedAt,
          discoveredBy: actor,
          versions: {
            create: {
              version: 1,
              sha256: hash,
              sourcePath: `oss://${objectKey}`,
              objectKey,
              objectVersionId: stored.objectVersionId,
              etag: stored.etag,
              storageUrl: stored.storageUrl,
              createdBy: actor,
              originalFileName: `${publicNo}.mp4`,
              mimeType: "video/mp4",
              extension: ".mp4",
              sizeBytes: buffer.length,
              width: 480,
              height: 832,
              durationSeconds: generation.duration,
              technicalMetadata: { provider: "BAILIAN_WAN", taskId: generation.taskId, model: generation.model },
            },
          },
          products: generation.productId
            ? { create: [{ productId: generation.productId, scope: "MODEL", confidence: 1, confirmed: true }] }
            : undefined,
        },
      });
    }
    const completedGeneration: AiShotGeneration = { ...generation, status: "SUCCEEDED", assetId: asset.id };
    const next = requirements.map((item) => String(item.id) === requirementId
      ? completeAiShotRequirement(item, completedGeneration, asset!.id)
      : item);
    const productionStage = next.every((item) => String(item.status) === "DONE") ? "READY_TO_EDIT" : "AWAITING_ASSETS";
    await this.prisma.$transaction(async (tx) => {
      await tx.contentAsset.createMany({
        data: [{ contentPlanId: id, assetId: asset!.id, role: "AI_GENERATED_SHOT" }],
        skipDuplicates: true,
      });
      await tx.contentPlan.update({
        where: { id },
        data: { shootRequirements: JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue, productionStage },
      });
      await tx.auditLog.create({
        data: {
          actor,
          action: "SHOT_AI_GENERATION_COMPLETE",
          entityType: "ContentPlan",
          entityId: id,
          after: { requirementId, taskId: generation.taskId, assetId: asset!.id, productionStage },
        },
      });
    });
    return { ...completedGeneration, completedAt: new Date().toISOString() };
  }

  async replaceShotAsset(id: string, requirementId: string, actor: string) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id } });
    if (!plan || plan.kind !== "VIDEO") throw new NotFoundException("视频生产单不存在");
    const requirements = Array.isArray(plan.shootRequirements) ? plan.shootRequirements as Array<Record<string, unknown>> : [];
    const target = requirements.find((item) => String(item.id) === requirementId);
    if (!target) throw new NotFoundException("镜头素材项不存在");
    const removedAssetIds = Array.isArray(target.assetIds) ? target.assetIds.map(String) : [];
    const next = requirements.map((item) => String(item.id) === requirementId
      ? { ...item, status: "OPEN", coverage: "MISSING", assetIds: [], videoAssetIds: [], imageAssetIds: [], note: "用户选择重新拍摄替换已有素材" }
      : item);
    const stillUsed = new Set(next.flatMap((item) => Array.isArray(item.assetIds) ? item.assetIds.map(String) : []));
    const removableAssetIds = removedAssetIds.filter((assetId) => !stillUsed.has(assetId));
    await this.prisma.$transaction(async (tx) => {
      if (removableAssetIds.length) await tx.contentAsset.deleteMany({ where: { contentPlanId: id, assetId: { in: removableAssetIds } } });
      await tx.contentPlan.update({ where: { id }, data: { shootRequirements: JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue, productionStage: "AWAITING_ASSETS" } });
      await tx.auditLog.create({ data: { actor, action: "SHOT_ASSET_REPLACE_REQUEST", entityType: "ContentPlan", entityId: id, after: { requirementId, removedAssetIds } } });
    });
    return this.workflow(id);
  }

  async startEditing(id: string, actor: string) {
    const plan = await this.prisma.contentPlan.findUnique({
      where: { id },
      include: { variants: true, contentAssets: { include: { asset: true } } },
    });
    if (!plan || plan.kind !== "VIDEO") throw new NotFoundException("视频生产单不存在");
    if (!["APPROVED", "SCHEDULED"].includes(plan.status)) throw new BadRequestException("脚本尚未审核通过");
    const normalizedPlan = this.normalizeVideoAssetCoverage(plan);
    const requirements = Array.isArray(normalizedPlan.shootRequirements) ? normalizedPlan.shootRequirements as Array<Record<string, unknown>> : [];
    if (requirements.some((item) => String(item.status) !== "DONE")) throw new BadRequestException("补拍素材尚未全部完成");
    const unavailable = plan.contentAssets.filter(({ asset }) =>
      asset.reviewStatus !== "APPROVED"
      || asset.availabilityStatus !== "ACTIVE"
      || !["COMMERCIAL", "EDIT_ONLY"].includes(asset.rightsStatus),
    );
    if (unavailable.length) throw new BadRequestException(`有${unavailable.length}项素材未满足审核、可用或权限要求`);
    if (!opsConfig.videoRenderCommand) throw new BadRequestException("视频剪辑执行器未配置");
    const variant = plan.variants.find((item) => item.platform === "DOUYIN") || plan.variants[0];
    const metadata = variant?.metadata && typeof variant.metadata === "object" && !Array.isArray(variant.metadata)
      ? variant.metadata as Record<string, unknown>
      : {};
    const briefPath = String(metadata.briefPath || "");
    if (!briefPath) throw new BadRequestException("生产单缺少剪辑任务书");
    await this.prisma.contentPlan.update({ where: { id }, data: { productionStage: "EDITING", masterVideoStatus: "RUNNING" } });
    await this.prisma.auditLog.create({ data: { actor, action: "VIDEO_EDIT_START", entityType: "ContentPlan", entityId: id, after: { briefPath } } });
    await this.renderVideo(id, briefPath, dirname(briefPath));
    return this.workflow(id);
  }

  async reviewMasterVideo(id: string, approved: boolean, actor: string, note = "") {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id } });
    if (!plan || plan.kind !== "VIDEO") throw new NotFoundException("视频生产单不存在");
    if (!plan.masterVideoPath || plan.masterVideoStatus !== "READY_FOR_REVIEW") throw new BadRequestException("主成片尚未进入审核");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contentPlan.update({
        where: { id },
        data: approved
          ? { masterVideoStatus: "APPROVED", productionStage: "PLATFORM_PACKAGING" }
          : { masterVideoStatus: "RETURNED", productionStage: "EDITING" },
      });
      await tx.approval.create({ data: { contentPlanId: id, action: approved ? "VIDEO_APPROVE" : "VIDEO_REJECT", actor, note } });
      await tx.auditLog.create({ data: { actor, action: approved ? "VIDEO_APPROVE" : "VIDEO_REJECT", entityType: "ContentPlan", entityId: id, after: { note } } });
      return updated;
    });
  }

  async generatePackaging(id: string, actor: string) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id }, include: { variants: true } });
    if (!plan || plan.kind !== "VIDEO") throw new NotFoundException("视频生产单不存在");
    if (plan.masterVideoStatus !== "APPROVED") throw new BadRequestException("主成片尚未审核通过");
    const signals = Array.isArray(plan.sourceSignals) ? plan.sourceSignals as Array<Record<string, unknown>> : [];
    const restricted = signals.some((item) => item.contentRestrictionMode === "HEALTH_RESTRICTED");
    const restrictionRules = restricted ? await this.prisma.phraseRule.findMany({
      where: { active: true, category: { in: ["HEALTH_RESTRICTED_WORD", "HEALTH_RESTRICTED_VISUAL"] } },
      select: { category: true, blockedText: true },
    }) : [];
    const restrictedWords = restrictionRules.filter((item) => item.category === "HEALTH_RESTRICTED_WORD").map((item) => item.blockedText);
    const restrictedVisuals = restrictionRules.filter((item) => item.category === "HEALTH_RESTRICTED_VISUAL").map((item) => item.blockedText);
    const restrictedTerms = [...restrictedWords, ...restrictedVisuals];
    const selected = plan.variants.filter((variant) => plan.targetPlatforms.includes(variant.platform));
    for (const variant of selected) {
      const packaging = await this.aiContent.generatePlatformPackaging({
        productionNo: plan.productionNo,
        platform: variant.platform,
        topic: plan.topic,
        hook: plan.hook,
        outline: plan.outline,
        masterVideoPath: plan.masterVideoPath,
        existingTitle: variant.title,
        existingBody: variant.body,
        contentRestrictionMode: restricted ? "HEALTH_RESTRICTED" : "NORMAL",
        restrictedWords,
        restrictedVisuals,
      });
      if (restricted && matchesRestrictedTerms(packaging, restrictedTerms)) {
        throw new BadRequestException(`${variant.platform}平台包装仍包含受限内容，请重新生成`);
      }
      await this.prisma.contentVariant.update({
        where: { id: variant.id },
        data: {
          title: packaging.title || variant.title,
          body: packaging.body || variant.body,
          coverSpec: { ...packaging.coverSpec, coverText: packaging.coverText, hashtags: packaging.hashtags },
          packagingStatus: "WAITING_COVER_PROVIDER",
          packagedAt: new Date(),
          packagingRejectedReason: null,
        },
      });
    }
    await this.prisma.contentPlan.update({ where: { id }, data: { productionStage: "PACKAGING_REVIEW" } });
    await this.prisma.auditLog.create({ data: { actor, action: "PLATFORM_PACKAGING_GENERATE", entityType: "ContentPlan", entityId: id, after: { platforms: selected.map((item) => item.platform) } } });
    return this.workflow(id);
  }

  async reviewPackaging(variantId: string, approved: boolean, actor: string, input: { note?: string; coverPath?: string } = {}) {
    const variant = await this.prisma.contentVariant.findUnique({ where: { id: variantId }, include: { contentPlan: true } });
    if (!variant) throw new NotFoundException("平台包装不存在");
    const coverPath = String(input.coverPath || variant.coverPath || "").trim();
    if (approved && !coverPath) throw new BadRequestException("封面成品尚未生成或上传");
    await this.prisma.$transaction(async (tx) => {
      await tx.contentVariant.update({
        where: { id: variantId },
        data: approved
          ? { coverPath, packagingStatus: "APPROVED", packagingReviewedBy: actor, packagingReviewedAt: new Date(), packagingRejectedReason: null, status: "APPROVED" }
          : { packagingStatus: "RETURNED", packagingReviewedBy: actor, packagingReviewedAt: new Date(), packagingRejectedReason: input.note || "平台包装退回", status: "REJECTED" },
      });
      await tx.approval.create({ data: { contentPlanId: variant.contentPlanId, action: approved ? `PACKAGING_APPROVE:${variant.platform}` : `PACKAGING_REJECT:${variant.platform}`, actor, note: input.note } });
      const remaining = await tx.contentVariant.count({
        where: { contentPlanId: variant.contentPlanId, platform: { in: variant.contentPlan.targetPlatforms }, packagingStatus: { not: "APPROVED" } },
      });
      if (approved && remaining === 0) await tx.contentPlan.update({ where: { id: variant.contentPlanId }, data: { productionStage: "READY_TO_PUBLISH", status: "APPROVED" } });
    });
    return this.workflow(variant.contentPlanId);
  }

  async recordManualPublish(variantId: string, actor: string, input: { remoteUrl?: string; remoteId?: string; publishedAt?: string }) {
    const variant = await this.prisma.contentVariant.findUnique({ where: { id: variantId }, include: { contentPlan: true } });
    if (!variant) throw new NotFoundException("平台版本不存在");
    if (variant.packagingStatus !== "APPROVED") throw new BadRequestException("平台包装尚未审核通过");
    const remoteUrl = String(input.remoteUrl || "").trim();
    const remoteId = String(input.remoteId || "").trim();
    if (!remoteUrl && !remoteId) throw new BadRequestException("请回填作品链接或作品ID");
    const integration = await this.prisma.integration.findUnique({ where: { kind: variant.platform } });
    if (!integration) throw new BadRequestException("平台集成记录不存在");
    const publishedAt = input.publishedAt ? new Date(input.publishedAt) : new Date();
    const idempotencyKey = makeIdempotencyKey("manual-publish", variant.id, remoteId || remoteUrl);
    const job = await this.prisma.publishJob.upsert({
      where: { idempotencyKey },
      create: {
        idempotencyKey,
        contentPlanId: variant.contentPlanId,
        variantId,
        integrationId: integration.id,
        platformAccountId: variant.targetAccountId,
        operator: actor,
        operatorType: "HUMAN",
        status: "SUCCEEDED",
        scheduledAt: publishedAt,
        publishedAt,
        remoteId: remoteId || null,
        remoteUrl: remoteUrl || null,
        receipt: { mode: "MANUAL", recordedBy: actor },
      },
      update: {},
    });
    const metricHours = [1, 3, 6, 24, 72, 168, 720];
    await this.prisma.$transaction([
      this.prisma.contentVariant.update({ where: { id: variantId }, data: { status: "PUBLISHED", manualPublishUrl: remoteUrl || null, manualExternalId: remoteId || null, manualPublishedAt: publishedAt } }),
      this.prisma.contentPlan.update({ where: { id: variant.contentPlanId }, data: { status: "PUBLISHED", productionStage: "TRACKING", publishedAt } }),
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
    return this.workflow(variant.contentPlanId);
  }

  async deliveryManifest(variantId: string) {
    const variant = await this.prisma.contentVariant.findUnique({ where: { id: variantId }, include: { contentPlan: true } });
    if (!variant) throw new NotFoundException("平台版本不存在");
    if (variant.packagingStatus !== "APPROVED") throw new BadRequestException("平台包装尚未审核通过");
    return {
      productionNo: variant.contentPlan.productionNo,
      platform: variant.platform,
      title: variant.title,
      body: variant.body,
      coverSpec: variant.coverSpec,
      files: {
        video: variant.mediaPath ? `/api/v1/content/variants/${variant.id}/delivery/video` : null,
        cover: variant.coverPath ? `/api/v1/content/variants/${variant.id}/delivery/cover` : null,
      },
    };
  }

  async deliveryFile(variantId: string, type: "video" | "cover") {
    const variant = await this.prisma.contentVariant.findUnique({ where: { id: variantId }, include: { contentPlan: true } });
    if (!variant) throw new NotFoundException("平台版本不存在");
    if (variant.packagingStatus !== "APPROVED") throw new BadRequestException("平台包装尚未审核通过");
    const path = type === "video" ? variant.mediaPath : variant.coverPath;
    if (!path) throw new NotFoundException(type === "video" ? "成片文件不存在" : "封面文件不存在");
    const file = await stat(path).catch(() => null);
    if (!file?.isFile()) throw new NotFoundException("交付文件不可用");
    const suffix = type === "video" ? ".mp4" : path.slice(path.lastIndexOf(".")) || ".jpg";
    return { path, fileName: `${variant.contentPlan.productionNo || variant.contentPlan.id}-${variant.platform}-${type}${suffix}` };
  }

  async generateOptimization(id: string, checkpointHours: 168 | 720) {
    const plan = await this.prisma.contentPlan.findUnique({
      where: { id },
      include: { publishJobs: { include: { metrics: true, variant: true } } },
    });
    if (!plan) throw new NotFoundException("内容生产单不存在");
    const snapshots = plan.publishJobs.flatMap((job) => job.metrics.map((metric) => ({ ...metric, platform: job.variant.platform })));
    if (!snapshots.length) throw new BadRequestException("尚无可用于复盘的发布数据");
    const latestByPlatform = Array.from(new Map(snapshots.sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime()).map((item) => [item.platform, item])).values());
    const evidence = latestByPlatform.map((item) => ({
      platform: item.platform,
      views: item.views,
      completionRate: item.completionRate,
      likes: item.likes,
      comments: item.comments,
      shares: item.shares,
      unavailableFields: item.unavailableFields,
    }));
    const recommendations = [
      ...latestByPlatform.filter((item) => item.completionRate != null && item.completionRate < 0.25).map((item) => `${item.platform}完播偏低，下一轮缩短开场并提前核心卖点`),
      ...latestByPlatform.filter((item) => item.comments != null && item.views && item.comments / item.views > 0.01).map((item) => `${item.platform}评论反馈较强，保留当前问题式Hook`),
    ];
    const summary = `${checkpointHours === 168 ? "7日初评" : "30日终评"}：已汇总${latestByPlatform.length}个平台的最新有效快照`;
    return this.prisma.contentOptimizationSuggestion.upsert({
      where: { contentPlanId_checkpointHours: { contentPlanId: id, checkpointHours } },
      create: { contentPlanId: id, checkpointHours, summary, evidence, recommendations, rulePatch: { recommendations } },
      update: { summary, evidence, recommendations, rulePatch: { recommendations }, status: "PENDING_CONFIRMATION" },
    });
  }

  async decideOptimization(suggestionId: string, confirmed: boolean, actor: string, note = "") {
    const suggestion = await this.prisma.contentOptimizationSuggestion.findUnique({ where: { id: suggestionId } });
    if (!suggestion) throw new NotFoundException("优化建议不存在");
    const updated = await this.prisma.contentOptimizationSuggestion.update({
      where: { id: suggestionId },
      data: confirmed
        ? { status: "CONFIRMED", confirmedBy: actor, confirmedAt: new Date(), rejectedBy: null, rejectedAt: null, note }
        : { status: "REJECTED", rejectedBy: actor, rejectedAt: new Date(), confirmedBy: null, confirmedAt: null, note },
    });
    await this.prisma.auditLog.create({ data: { actor, action: confirmed ? "OPTIMIZATION_CONFIRM" : "OPTIMIZATION_REJECT", entityType: "ContentOptimizationSuggestion", entityId: suggestionId, after: { contentPlanId: suggestion.contentPlanId, note } } });
    return updated;
  }

  async workflow(id: string) {
    const plan = await this.prisma.contentPlan.findUnique({
      where: { id },
      include: {
        variants: { include: { publishJobs: { include: { metrics: { orderBy: { capturedAt: "desc" } } } } } },
        approvals: { orderBy: { createdAt: "desc" } },
        contentAssets: { include: { asset: true } },
        optimizations: { orderBy: { checkpointHours: "asc" } },
      },
    });
    return plan ? this.normalizeVideoAssetCoverage(plan) : plan;
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
      const queuedBeforePlan = queued;
      const selectedVariants = plan.kind === "VIDEO"
        ? plan.variants.filter((variant) => plan.targetPlatforms.includes(variant.platform))
        : plan.variants;
      for (const variant of selectedVariants) {
        if (plan.kind === "VIDEO" && variant.packagingStatus !== "APPROVED") {
          skipped.push({ platform: variant.platform, reason: "平台标题和封面尚未审核通过" });
          continue;
        }
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
      if (queued > queuedBeforePlan) await this.prisma.contentPlan.update({ where: { id: plan.id }, data: { status: "SCHEDULED", productionStage: "PUBLISHING", scheduledAt: now } });
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
    const plans = await this.prisma.contentPlan.findMany({
      where: status ? { status } : {},
      include: {
        variants: { include: { publishJobs: { orderBy: { createdAt: "desc" }, take: 1 } } },
        approvals: { orderBy: { createdAt: "desc" }, take: 10 },
        contentAssets: { include: { asset: { select: { id: true, assetNo: true, displayName: true, fileName: true, kind: true } } } },
        optimizations: { orderBy: { checkpointHours: "asc" } },
      },
      orderBy: [{ planDate: "desc" }, { score: "desc" }],
      take: 100,
    });
    return plans.map((plan) => this.normalizeVideoAssetCoverage(plan));
  }
}
