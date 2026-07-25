import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import {
  AssetAvailabilityStatus,
  AssetKind,
  AssetLevel,
  AssetReviewAction,
  AssetReviewStatus,
  AssetRightsStatus,
  IntegrationKind,
  Prisma,
  ProductScope,
  RecordStatus,
  UploadBatchStatus,
  VideoModuleType,
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import sharp from "sharp";
import { AiContentService } from "./ai-content.service";
import { AssetAiService } from "./asset-ai.service";
import { isIrregularAssetName } from "./asset-naming";
import { OssStorageService } from "./oss-storage.service";
import { PrismaService } from "./prisma.service";

type JsonRecord = Record<string, unknown>;
type DiskFile = { originalname: string; mimetype: string; size: number; path: string };
type MemoryFile = { originalname: string; mimetype: string; size: number; buffer: Buffer };

const knowledgeTypes = ["BRAND", "PRODUCT", "PARAMETER", "KNOWLEDGE", "WORDING", "FAQ", "FORBIDDEN", "AFTER_SALE", "TUTORIAL"];
const recordStatuses: RecordStatus[] = ["DRAFT", "PENDING", "READY", "BLOCKED", "ARCHIVED"];
const assetKinds: AssetKind[] = ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"];
const assetLevels: AssetLevel[] = ["ORIGINAL", "MODULE", "FINISHED", "REFERENCE", "AI_GENERATED"];
const productScopes: ProductScope[] = ["MODEL", "SERIES", "BRAND", "COMMON", "UNKNOWN"];
const rightsStatuses: AssetRightsStatus[] = ["COMMERCIAL", "INTERNAL", "EDIT_ONLY", "AUTH_REQUIRED", "EXPIRED", "PROHIBITED"];
const reviewStatuses: AssetReviewStatus[] = ["PENDING", "APPROVED", "RETURNED", "REJECTED"];
const availabilityStatuses: AssetAvailabilityStatus[] = ["INACTIVE", "ACTIVE", "SUSPENDED", "ARCHIVED"];
const reviewActions: AssetReviewAction[] = ["APPROVE", "RETURN", "INTERNAL_ONLY", "REJECT"];
const moduleTypes: VideoModuleType[] = ["HOOK", "PAIN", "SCENE", "FEATURE", "BENEFIT", "PROOF", "DEMO", "COMPARE", "UGC", "STORY", "TRANSITION", "TRAFFIC", "OFFER", "CTA", "ENDING"];
const integrationKinds: IntegrationKind[] = ["DOUYIN", "TIKTOK", "AMAZON", "SHOPIFY", "WECHAT_CHANNELS", "XIAOHONGSHU", "WECHAT_OFFICIAL", "WECOM", "TMALL", "JD", "PINDUODUO", "SAIDIAN_MALL", "JUSHUITAN", "FEIGUA", "WEB_SEARCH"];
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);
const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi"]);
const audioExtensions = new Set([".mp3", ".wav", ".m4a", ".aac"]);

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function textArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/[，,；;\n]/u).map((item) => item.trim()).filter(Boolean);
}

function jsonRecord(value: Prisma.JsonValue | null | undefined): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  const candidate = text(value).toUpperCase() as T;
  return values.includes(candidate) ? candidate : fallback;
}

const modelAliases: Record<string, { canonical: string; aliases: string[] }> = {
  W8U: { canonical: "W8Ultra", aliases: ["W8U", "W8ULTRA"] },
  W8ULTRA: { canonical: "W8Ultra", aliases: ["W8U", "W8ULTRA"] },
  W8R: { canonical: "W8Ultra-R", aliases: ["W8R", "W8ULTRA-R"] },
  "W8ULTRA-R": { canonical: "W8Ultra-R", aliases: ["W8R", "W8ULTRA-R"] },
  W7PRO: { canonical: "W7PRO", aliases: ["W7 PRO", "W7PRO"] },
  W8PRO: { canonical: "W8PRO", aliases: ["W8 PRO", "W8PRO"] },
  R7Y: { canonical: "R7Y", aliases: ["R7Y"] },
};

function normalizeModel(value: unknown): { canonical: string; aliases: string[] } {
  const original = text(value);
  const key = original.toUpperCase().replace(/[＿_\s]+/gu, "").replace(/–|—/gu, "-");
  return modelAliases[key] || { canonical: original.toUpperCase(), aliases: [original.toUpperCase()] };
}

function assetGrade(score: number): "S" | "A" | "B" | "C" | "D" {
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

export function growthScore(input: {
  baselineQuality: number;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  orders?: number | null;
}) {
  const baselineQuality = Math.max(0, Math.min(100, Number(input.baselineQuality || 0)));
  const views = Math.max(0, Number(input.views || 0));
  const interactions = Math.max(0, Number(input.likes || 0) + Number(input.comments || 0) + Number(input.shares || 0) + Number(input.saves || 0));
  const orders = Math.max(0, Number(input.orders || 0));
  if (!views && !interactions && !orders) {
    return { score: baselineQuality, recommendationWeight: Number(Math.max(0.2, baselineQuality / 100).toFixed(2)), hasPerformanceData: false };
  }
  const viewScore = Math.min(100, Math.log10(views + 1) * 20);
  const engagementScore = views ? Math.min(100, interactions / views * 1000) : 0;
  const conversionScore = views ? Math.min(100, orders / views * 5000) : Math.min(100, orders * 10);
  const performanceScore = viewScore * 0.45 + engagementScore * 0.35 + conversionScore * 0.2;
  const score = Math.round(baselineQuality * 0.6 + performanceScore * 0.4);
  return { score, recommendationWeight: Number(Math.max(0.2, Math.min(1.5, score / 80)).toFixed(2)), hasPerformanceData: true };
}

function dayCode(): string {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function assetNo(kind: AssetKind): string {
  return `SD-${kind}-${dayCode()}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function batchNo(): string {
  return `UP-${dayCode()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function knowledgeNo(): string {
  return `KB-${dayCode()}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function fileKind(fileName: string, mimeType: string): AssetKind {
  const extension = extname(fileName).toLowerCase();
  if (mimeType.startsWith("image/") || imageExtensions.has(extension)) return "IMAGE";
  if (mimeType.startsWith("video/") || videoExtensions.has(extension)) return "VIDEO";
  if (mimeType.startsWith("audio/") || audioExtensions.has(extension)) return "AUDIO";
  return "DOCUMENT";
}

function parseDate(value: unknown): Date | undefined {
  if (!text(value)) return undefined;
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

@Injectable()
export class BrandDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oss: OssStorageService,
    private readonly assetAi: AssetAiService,
    private readonly aiContent: AiContentService,
  ) {}

  async overview() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [knowledgeTotal, knowledgeReady, knowledgePending, assetTotal, assetReady, assetPending, assetAiFailed, assetToday, highQuality, ossStored, gapCount, assetTrash, ossHealth] = await Promise.all([
      this.prisma.knowledgeEntry.count(),
      this.prisma.knowledgeEntry.count({ where: { status: "READY", externallyUsable: true } }),
      this.prisma.knowledgeEntry.count({ where: { status: { in: ["DRAFT", "PENDING"] } } }),
      this.prisma.asset.count({ where: { deletedAt: null } }),
      this.prisma.asset.count({ where: { deletedAt: null, reviewStatus: "APPROVED", availabilityStatus: "ACTIVE" } }),
      this.prisma.asset.count({ where: { deletedAt: null, reviewStatus: "PENDING" } }),
      this.prisma.asset.count({ where: { deletedAt: null, processingStatus: "FAILED" } }),
      this.prisma.asset.count({ where: { deletedAt: null, createdAt: { gte: today } } }),
      this.prisma.asset.count({ where: { deletedAt: null, qualityScore: { gte: 80 }, reviewStatus: "APPROVED" } }),
      this.prisma.asset.count({ where: { deletedAt: null, storageProvider: "ALIYUN_OSS", objectKey: { not: null } } }),
      this.prisma.assetGapSnapshot.count({ where: { snapshotDate: { gte: today }, gapCount: { gt: 0 } } }),
      this.prisma.asset.count({ where: { deletedAt: { not: null } } }),
      this.oss.healthCheck(),
    ]);
    return {
      knowledge: { total: knowledgeTotal, ready: knowledgeReady, pending: knowledgePending },
      assets: { total: assetTotal, ready: assetReady, pending: assetPending, aiFailed: assetAiFailed, today: assetToday, highQuality, ossStored, gapCount, trash: assetTrash },
      oss: ossHealth,
      ai: this.assetAi.capabilities(),
      generatedAt: new Date().toISOString(),
    };
  }

  async knowledge(query: Record<string, string | undefined>) {
    const keyword = text(query.query);
    const type = text(query.type).toUpperCase();
    const state = text(query.status).toUpperCase();
    const model = text(query.model);
    const entries = await this.prisma.knowledgeEntry.findMany({
      where: {
        ...(type && knowledgeTypes.includes(type) ? { type } : {}),
        ...(recordStatuses.includes(state as RecordStatus) ? { status: state as RecordStatus } : { status: { not: "ARCHIVED" as RecordStatus } }),
        ...(model ? { model: { contains: model, mode: "insensitive" } } : {}),
        ...(keyword ? { OR: [{ id: { contains: keyword, mode: "insensitive" } }, { title: { contains: keyword, mode: "insensitive" } }, { summary: { contains: keyword, mode: "insensitive" } }, { reply: { contains: keyword, mode: "insensitive" } }, { body: { contains: keyword, mode: "insensitive" } }] } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    return entries.map((entry) => ({ ...entry, metadata: jsonRecord(entry.raw), aiCallable: entry.status === "READY" && entry.externallyUsable && (!entry.validUntil || entry.validUntil > new Date()) }));
  }

  async knowledgeControls() {
    const [claims, mappings, phraseRules, brandProfiles, products, faqs, employees, categoryRows] = await Promise.all([
      this.prisma.evidenceClaim.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { updatedAt: "desc" } }),
      this.prisma.productMapping.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { commercialName: "asc" } }),
      this.prisma.phraseRule.findMany({ where: { active: true }, orderBy: [{ category: "asc" }, { blockedText: "asc" }] }),
      this.prisma.brandProfileVersion.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { version: "desc" } }),
      this.prisma.product.findMany({ where: { status: { not: "ARCHIVED" } }, include: { skus: true }, orderBy: { modelCode: "asc" } }),
      this.prisma.faqEntry.findMany({ where: { status: { not: "ARCHIVED" } }, include: { variants: true, product: true }, orderBy: [{ frequency: "desc" }, { updatedAt: "desc" }], take: 500 }),
      this.prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true, employeeNo: true, name: true, department: { select: { name: true } } }, orderBy: { name: "asc" } }),
      this.prisma.knowledgeEntry.findMany({ where: { status: { not: "ARCHIVED" }, category: { not: null } }, select: { category: true }, distinct: ["category"], orderBy: { category: "asc" } }),
    ]);
    return { claims, mappings, phraseRules, brandProfiles, products, faqs, employees, categories: categoryRows.map((row) => text(row.category)).filter(Boolean) };
  }

  async products(query: Record<string, string | undefined>) {
    const keyword = text(query.query);
    const status = text(query.status).toUpperCase();
    return this.prisma.product.findMany({
      where: {
        ...(recordStatuses.includes(status as RecordStatus) ? { status: status as RecordStatus } : { status: { not: "ARCHIVED" as RecordStatus } }),
        ...(keyword ? {
          OR: [
            { name: { contains: keyword, mode: "insensitive" } },
            { modelCode: { contains: keyword, mode: "insensitive" } },
            { category: { contains: keyword, mode: "insensitive" } },
          ],
        } : {}),
      },
      include: { skus: true, _count: { select: { assets: true, faqEntries: true } } },
      orderBy: [{ category: "asc" }, { modelCode: "asc" }],
      take: 500,
    });
  }

  async importProducts(body: JsonRecord, actor: string) {
    const rows = Array.isArray(body.rows) ? body.rows.map((item) => item && typeof item === "object" && !Array.isArray(item) ? item as JsonRecord : {}) : [];
    if (!rows.length) throw new BadRequestException("产品导入数据不能为空");
    let created = 0;
    let updated = 0;
    const skipped: Array<{ row: number; reason: string }> = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rawCode = text(row.modelCode ?? row.model ?? row["型号"] ?? row["产品型号"]);
      const businessCode = text(row.businessCode ?? row.skuCode ?? row.code ?? row["编码"] ?? row["产品编码"]);
      const name = text(row.name ?? row.productName ?? row["品名"] ?? row["产品名称"]);
      const category = text(row.category ?? row["品类"] ?? row["产品分类"]);
      if (!businessCode || !rawCode || !name) {
        skipped.push({ row: index + 1, reason: "缺少编码、型号或产品名称" });
        continue;
      }
      const normalized = normalizeModel(rawCode);
      const existing = await this.prisma.product.findUnique({ where: { modelCode: normalized.canonical } });
      const internal = {
        cost: row.cost ?? row["成本"] ?? row["成本价"] ?? null,
        minimumPrice: row.minimumPrice ?? row["最低售价"] ?? row["最低销售价"] ?? null,
      };
      const publicKnowledge = {
        facts: row.facts ?? {},
        functions: row.functions ?? [],
        customerValues: row.customerValues ?? [],
        audiences: row.audiences ?? [],
        scenes: row.scenes ?? [],
        contentDirections: row.contentDirections ?? [],
        evidenceIds: row.evidenceIds ?? [],
      };
      const product = await this.prisma.product.upsert({
        where: { modelCode: normalized.canonical },
        create: {
          name,
          modelCode: normalized.canonical,
          category: category || "待分类",
          evidenceIds: textArray(row.evidenceIds),
          status: "READY",
          metadata: json({
            source: text(body.source) || "赛电产品表20260626.xlsx",
            sourceRow: index + 2,
            aliases: Array.from(new Set([rawCode, ...normalized.aliases])),
            publicKnowledge,
            internal,
            importedBy: actor,
          }),
        },
        update: {
          name,
          category: category || existing?.category || "待分类",
          evidenceIds: textArray(row.evidenceIds),
          status: "READY",
          metadata: json({
            ...jsonRecord(existing?.metadata),
            source: text(body.source) || "赛电产品表20260626.xlsx",
            sourceRow: index + 2,
            aliases: Array.from(new Set([rawCode, ...normalized.aliases])),
            publicKnowledge,
            internal,
            importedBy: actor,
            importedAt: new Date().toISOString(),
          }),
        },
      });
      await this.prisma.productSku.upsert({
        where: { skuCode: businessCode },
        create: {
          productId: product.id,
          skuCode: businessCode,
          name,
          attributes: json({ model: normalized.canonical, aliases: normalized.aliases, internal }),
        },
        update: {
          productId: product.id,
          name,
          active: true,
          attributes: json({ model: normalized.canonical, aliases: normalized.aliases, internal }),
        },
      });
      await this.prisma.productMapping.upsert({
        where: { commercialName: normalized.canonical },
        create: {
          commercialName: normalized.canonical,
          pageFacts: `${name}；${category || "待分类"}`,
          nameplateModel: normalized.canonical,
          status: "READY",
          raw: json({ aliases: Array.from(new Set([rawCode, ...normalized.aliases])), source: text(body.source) || "赛电产品表20260626.xlsx" }),
        },
        update: {
          pageFacts: `${name}；${category || "待分类"}`,
          nameplateModel: normalized.canonical,
          status: "READY",
          requiredAction: null,
          raw: json({ aliases: Array.from(new Set([rawCode, ...normalized.aliases])), source: text(body.source) || "赛电产品表20260626.xlsx" }),
        },
      });
      if (existing) updated += 1;
      else created += 1;
    }
    await this.audit(actor, "PRODUCT_IMPORT", "Product", "batch", { created, updated, skipped, source: body.source });
    return { received: rows.length, created, updated, skipped, imported: created + updated };
  }

  async updateProduct(id: string, body: JsonRecord, actor: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("产品不存在");
    const name = body.name === undefined ? existing.name : text(body.name);
    const category = body.category === undefined ? existing.category : text(body.category);
    if (!name || !category) throw new BadRequestException("产品名称和系列不能为空");
    const existingMetadata = jsonRecord(existing.metadata);
    const existingPublicKnowledge = jsonRecord(existingMetadata.publicKnowledge as Prisma.JsonValue);
    const metadata = {
      ...existingMetadata,
      ...(body.aliases !== undefined ? { aliases: textArray(body.aliases) } : {}),
      publicKnowledge: {
        ...existingPublicKnowledge,
        ...(body.functions !== undefined ? { functions: textArray(body.functions) } : {}),
        ...(body.customerValues !== undefined ? { customerValues: textArray(body.customerValues) } : {}),
        ...(body.audiences !== undefined ? { audiences: textArray(body.audiences) } : {}),
        ...(body.scenes !== undefined ? { scenes: textArray(body.scenes) } : {}),
        ...(body.contentDirections !== undefined ? { contentDirections: textArray(body.contentDirections) } : {}),
      },
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    };
    const product = await this.prisma.product.update({
      where: { id },
      data: {
        name,
        category,
        ...(body.status !== undefined ? { status: enumValue(body.status, recordStatuses, existing.status) } : {}),
        metadata: json(metadata),
      },
      include: { skus: true },
    });
    await this.audit(actor, "PRODUCT_UPDATE", "Product", id, { name: product.name, category: product.category, status: product.status });
    return product;
  }

  async createKnowledge(body: JsonRecord, actor: string) {
    const title = text(body.title);
    const type = text(body.type).toUpperCase();
    const category = text(body.category);
    const direct = text(body.publishMode).toUpperCase() === "READY";
    if (!title) throw new BadRequestException("知识标题不能为空");
    if (!knowledgeTypes.includes(type)) throw new BadRequestException("请选择有效的知识类型");
    if (!category) throw new BadRequestException("请选择知识分类");
    if (!text(body.reply) && !text(body.body)) throw new BadRequestException("标准回复或完整正文至少填写一项");
    const id = text(body.id) || knowledgeNo();
    const metadata = { keywords: textArray(body.keywords), scenarios: textArray(body.scenarios), owner: text(body.owner) || actor, version: 1, createdBy: actor, publishMode: direct ? "READY" : "PENDING" };
    const entry = await this.prisma.knowledgeEntry.create({
      data: {
        id, type, title, category, model: text(body.model) || undefined,
        summary: text(body.summary) || undefined, reply: text(body.reply) || undefined, body: text(body.body) || undefined,
        source: text(body.source) || "运营后台录入", sourceRefs: text(body.sourceRefs) || undefined,
        status: direct ? "READY" : "PENDING", audience: text(body.audience) || "customer",
        sourceLevel: text(body.sourceLevel) || "B", validUntil: parseDate(body.validUntil), externallyUsable: direct,
        evidenceIds: textArray(body.evidenceIds), raw: metadata,
        reviewedBy: direct ? actor : undefined, reviewedAt: direct ? new Date() : undefined,
      },
    });
    await this.audit(actor, direct ? "KNOWLEDGE_CREATE_DIRECT" : "KNOWLEDGE_CREATE_PENDING", "KnowledgeEntry", entry.id, entry);
    return { ...entry, metadata };
  }

  async updateKnowledge(id: string, body: JsonRecord, actor: string) {
    const existing = await this.prisma.knowledgeEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("知识记录不存在");
    const nextTitle = body.title !== undefined ? text(body.title) : existing.title;
    const nextCategory = body.category !== undefined ? text(body.category) : text(existing.category);
    const nextReply = body.reply !== undefined ? text(body.reply) : text(existing.reply);
    const nextBody = body.body !== undefined ? text(body.body) : text(existing.body);
    const direct = text(body.publishMode).toUpperCase() === "READY";
    if (!nextTitle) throw new BadRequestException("知识标题不能为空");
    if (!nextCategory) throw new BadRequestException("请选择知识分类");
    if (!nextReply && !nextBody) throw new BadRequestException("标准回复或完整正文至少填写一项");
    const existingMetadata = jsonRecord(existing.raw);
    const metadata = { ...existingMetadata, ...(body.keywords !== undefined ? { keywords: textArray(body.keywords) } : {}), ...(body.scenarios !== undefined ? { scenarios: textArray(body.scenarios) } : {}), version: Number(existingMetadata.version || 1) + 1, updatedBy: actor, updatedAt: new Date().toISOString(), publishMode: direct ? "READY" : "PENDING" };
    const entry = await this.prisma.knowledgeEntry.update({
      where: { id },
      data: {
        ...(body.type !== undefined && knowledgeTypes.includes(text(body.type).toUpperCase()) ? { type: text(body.type).toUpperCase() } : {}),
        ...(body.title !== undefined ? { title: text(body.title) } : {}), ...(body.category !== undefined ? { category: text(body.category) || null } : {}),
        ...(body.model !== undefined ? { model: text(body.model) || null } : {}), ...(body.summary !== undefined ? { summary: text(body.summary) || null } : {}),
        ...(body.reply !== undefined ? { reply: text(body.reply) || null } : {}), ...(body.body !== undefined ? { body: text(body.body) || null } : {}),
        ...(body.source !== undefined ? { source: text(body.source) || "运营后台录入" } : {}), ...(body.sourceRefs !== undefined ? { sourceRefs: text(body.sourceRefs) || null } : {}),
        ...(body.audience !== undefined ? { audience: text(body.audience) || "customer" } : {}), ...(body.sourceLevel !== undefined ? { sourceLevel: text(body.sourceLevel) || "B" } : {}),
        ...(body.validUntil !== undefined ? { validUntil: parseDate(body.validUntil) || null } : {}), ...(body.evidenceIds !== undefined ? { evidenceIds: textArray(body.evidenceIds) } : {}),
        status: direct ? "READY" : "PENDING", raw: metadata,
        externallyUsable: direct,
        reviewedBy: direct ? actor : null,
        reviewedAt: direct ? new Date() : null,
      },
    });
    await this.audit(actor, direct ? "KNOWLEDGE_UPDATE_DIRECT" : "KNOWLEDGE_UPDATE_PENDING", "KnowledgeEntry", id, entry);
    return { ...entry, metadata };
  }

  async updateKnowledgeControl(resource: string, id: string, body: JsonRecord, actor: string) {
    const key = text(resource).toLowerCase();
    if (key === "products") return this.updateProduct(id, body, actor);
    if (key === "faqs") {
      const existing = await this.prisma.faqEntry.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException("FAQ不存在");
      const status = body.status === undefined ? existing.status : enumValue(body.status, recordStatuses, existing.status);
      const row = await this.prisma.faqEntry.update({ where: { id }, data: {
        ...(body.standardQuestion !== undefined ? { standardQuestion: text(body.standardQuestion) } : {}),
        ...(body.shortAnswer !== undefined ? { shortAnswer: text(body.shortAnswer) } : {}),
        ...(body.detailedAnswer !== undefined ? { detailedAnswer: text(body.detailedAnswer) || null } : {}),
        ...(body.category !== undefined ? { category: text(body.category) } : {}),
        ...(body.intent !== undefined ? { intent: text(body.intent) } : {}),
        ...(body.language !== undefined ? { language: text(body.language) || "zh-CN" } : {}),
        ...(body.market !== undefined ? { market: text(body.market) || "CN" } : {}),
        ...(body.frequency !== undefined ? { frequency: Math.max(0, Number(body.frequency) || 0) } : {}),
        ...(body.priority !== undefined ? { priority: text(body.priority) || "NORMAL" } : {}),
        ...(body.source !== undefined ? { source: text(body.source) } : {}),
        ...(body.sourceLevel !== undefined ? { sourceLevel: text(body.sourceLevel) || "B" } : {}),
        ...(body.productId !== undefined ? { productId: text(body.productId) || null } : {}),
        status, externallyUsable: status === "READY",
      } });
      await this.audit(actor, "FAQ_UPDATE", "FaqEntry", id, row);
      return row;
    }
    if (key === "claims") {
      const existing = await this.prisma.evidenceClaim.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException("资质证书不存在");
      const row = await this.prisma.evidenceClaim.update({ where: { id }, data: {
        ...(body.name !== undefined ? { name: text(body.name) } : {}),
        ...(body.evidenceType !== undefined ? { evidenceType: text(body.evidenceType) } : {}),
        ...(body.source !== undefined ? { source: text(body.source) } : {}),
        ...(body.entityIdentifier !== undefined ? { entityIdentifier: text(body.entityIdentifier) || null } : {}),
        ...(body.coveredObject !== undefined ? { coveredObject: text(body.coveredObject) || null } : {}),
        ...(body.validFrom !== undefined ? { validFrom: parseDate(body.validFrom) || null } : {}),
        ...(body.validUntil !== undefined ? { validUntil: parseDate(body.validUntil) || null } : {}),
        ...(body.confirmedFact !== undefined ? { confirmedFact: text(body.confirmedFact) || null } : {}),
        ...(body.publicWording !== undefined ? { publicWording: text(body.publicWording) || null } : {}),
        ...(body.internalRestriction !== undefined ? { internalRestriction: text(body.internalRestriction) || null } : {}),
        ...(body.status !== undefined ? { status: enumValue(body.status, recordStatuses, existing.status) } : {}),
      } });
      await this.audit(actor, "EVIDENCE_CLAIM_UPDATE", "EvidenceClaim", id, row);
      return row;
    }
    if (key === "mappings") {
      const existing = await this.prisma.productMapping.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException("型号映射不存在");
      const row = await this.prisma.productMapping.update({ where: { id }, data: {
        ...(body.commercialName !== undefined ? { commercialName: text(body.commercialName) } : {}),
        ...(body.pageFacts !== undefined ? { pageFacts: text(body.pageFacts) || null } : {}),
        ...(body.nameplateModel !== undefined ? { nameplateModel: text(body.nameplateModel) || null } : {}),
        ...(body.registeredModel !== undefined ? { registeredModel: text(body.registeredModel) || null } : {}),
        ...(body.registrationNumber !== undefined ? { registrationNumber: text(body.registrationNumber) || null } : {}),
        ...(body.productionRelation !== undefined ? { productionRelation: text(body.productionRelation) || null } : {}),
        ...(body.requiredAction !== undefined ? { requiredAction: text(body.requiredAction) || null } : {}),
        ...(body.status !== undefined ? { status: enumValue(body.status, recordStatuses, existing.status) } : {}),
      } });
      await this.audit(actor, "PRODUCT_MAPPING_UPDATE", "ProductMapping", id, row);
      return row;
    }
    if (key === "rules") {
      const existing = await this.prisma.phraseRule.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException("表述规则不存在");
      const row = await this.prisma.phraseRule.update({ where: { id }, data: {
        ...(body.category !== undefined ? { category: text(body.category) } : {}),
        ...(body.blockedText !== undefined ? { blockedText: text(body.blockedText) } : {}),
        ...(body.replacement !== undefined ? { replacement: text(body.replacement) || null } : {}),
        ...(body.condition !== undefined ? { condition: text(body.condition) || null } : {}),
        ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
      } });
      await this.audit(actor, "PHRASE_RULE_UPDATE", "PhraseRule", id, row);
      return row;
    }
    if (key === "brand-profiles") {
      const existing = await this.prisma.brandProfileVersion.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException("品牌版本不存在");
      const row = await this.prisma.brandProfileVersion.update({ where: { id }, data: {
        ...(body.title !== undefined ? { title: text(body.title) } : {}),
        ...(body.positioning !== undefined ? { positioning: text(body.positioning) || null } : {}),
        ...(body.story !== undefined ? { story: text(body.story) || null } : {}),
        ...(body.source !== undefined ? { source: text(body.source) } : {}),
        ...(body.status !== undefined ? { status: enumValue(body.status, recordStatuses, existing.status) } : {}),
        ...(body.effectiveAt !== undefined ? { effectiveAt: parseDate(body.effectiveAt) || null } : {}),
      } });
      await this.audit(actor, "BRAND_PROFILE_UPDATE", "BrandProfileVersion", id, row);
      return row;
    }
    throw new BadRequestException("不支持的知识库栏目");
  }

  async createRestrictedRules(body: JsonRecord, actor: string) {
    const category = text(body.category).toUpperCase();
    if (!["HEALTH_RESTRICTED_WORD", "HEALTH_RESTRICTED_VISUAL"].includes(category)) {
      throw new BadRequestException("规则类型必须是风险词或风险画面");
    }
    const values = Array.from(new Set(
      (Array.isArray(body.values) ? body.values : String(body.values || "").split(/\r?\n/gu))
        .map((item) => text(item).trim())
        .filter(Boolean),
    ));
    if (!values.length) throw new BadRequestException("请至少填写一条规则");
    if (values.length > 200) throw new BadRequestException("单次最多添加200条规则");
    let created = 0;
    for (const blockedText of values) {
      const existing = await this.prisma.phraseRule.findUnique({ where: { category_blockedText: { category, blockedText } } });
      await this.prisma.phraseRule.upsert({
        where: { category_blockedText: { category, blockedText } },
        create: { category, blockedText, condition: "仅用于健康内容受限模式", active: true },
        update: { active: true },
      });
      if (!existing) created += 1;
    }
    await this.audit(actor, "RESTRICTED_RULE_BULK_CREATE", "PhraseRule", category, { submitted: values.length, created });
    return { submitted: values.length, created, skipped: values.length - created };
  }

  async archiveKnowledgeControl(resource: string, id: string, actor: string) {
    const key = text(resource).toLowerCase();
    let row: unknown;
    if (key === "products") row = await this.prisma.product.update({ where: { id }, data: { status: "ARCHIVED" } });
    else if (key === "faqs") row = await this.prisma.faqEntry.update({ where: { id }, data: { status: "ARCHIVED", externallyUsable: false } });
    else if (key === "claims") row = await this.prisma.evidenceClaim.update({ where: { id }, data: { status: "ARCHIVED" } });
    else if (key === "mappings") row = await this.prisma.productMapping.update({ where: { id }, data: { status: "ARCHIVED" } });
    else if (key === "rules") row = await this.prisma.phraseRule.update({ where: { id }, data: { active: false } });
    else if (key === "brand-profiles") row = await this.prisma.brandProfileVersion.update({ where: { id }, data: { status: "ARCHIVED" } });
    else throw new BadRequestException("不支持的知识库栏目");
    await this.audit(actor, "KNOWLEDGE_CONTROL_ARCHIVE", key, id, row);
    return row;
  }

  async reviewKnowledge(id: string, approved: boolean, actor: string, note?: string) {
    const existing = await this.prisma.knowledgeEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("知识记录不存在");
    const evidenceValid = !existing.evidenceIds.length || await this.prisma.evidenceClaim.count({ where: { id: { in: existing.evidenceIds }, status: "READY", OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] } }) === existing.evidenceIds.length;
    const externallyUsable = approved && evidenceValid && (!existing.validUntil || existing.validUntil > new Date());
    const metadata = { ...jsonRecord(existing.raw), reviewedBy: actor, reviewedAt: new Date().toISOString(), reviewNote: text(note), evidenceValid };
    const entry = await this.prisma.knowledgeEntry.update({ where: { id }, data: { status: approved ? "READY" : "BLOCKED", externallyUsable, reviewedBy: actor, reviewedAt: new Date(), raw: metadata } });
    await this.audit(actor, approved ? "KNOWLEDGE_APPROVE" : "KNOWLEDGE_BLOCK", "KnowledgeEntry", id, { status: entry.status, externallyUsable, note: text(note) });
    return { ...entry, metadata };
  }

  async bulkKnowledge(body: JsonRecord, actor: string) {
    const ids = Array.from(new Set(textArray(body.ids))).slice(0, 200);
    const action = text(body.action).toUpperCase();
    if (!ids.length) throw new BadRequestException("请选择知识记录");
    if (!["APPROVE", "BLOCK", "ARCHIVE"].includes(action)) throw new BadRequestException("不支持的批量操作");
    if (action === "ARCHIVE") {
      const result = await this.prisma.knowledgeEntry.updateMany({ where: { id: { in: ids } }, data: { status: "ARCHIVED", externallyUsable: false } });
      await this.audit(actor, "KNOWLEDGE_BULK_ARCHIVE", "KnowledgeEntry", ids.join(","), { ids, count: result.count });
      return { action, count: result.count };
    }
    let count = 0;
    for (const id of ids) {
      await this.reviewKnowledge(id, action === "APPROVE", actor, text(body.note) || "批量处理");
      count += 1;
    }
    return { action, count };
  }

  async bulkProducts(body: JsonRecord, actor: string) {
    const ids = Array.from(new Set(textArray(body.ids))).slice(0, 200);
    const action = text(body.action).toUpperCase();
    if (!ids.length) throw new BadRequestException("请选择产品");
    const status = ({ ENABLE: "READY", DISABLE: "BLOCKED", ARCHIVE: "ARCHIVED" } as Record<string, RecordStatus>)[action];
    if (!status) throw new BadRequestException("不支持的批量操作");
    const result = await this.prisma.product.updateMany({ where: { id: { in: ids } }, data: { status } });
    await this.audit(actor, `PRODUCT_BULK_${action}`, "Product", ids.join(","), { ids, status, count: result.count });
    return { action, count: result.count };
  }

  async bulkFaqs(body: JsonRecord, actor: string) {
    const ids = Array.from(new Set(textArray(body.ids))).slice(0, 200);
    const action = text(body.action).toUpperCase();
    if (!ids.length) throw new BadRequestException("请选择FAQ");
    const status = ({ APPROVE: "READY", BLOCK: "BLOCKED", ARCHIVE: "ARCHIVED" } as Record<string, RecordStatus>)[action];
    if (!status) throw new BadRequestException("不支持的批量操作");
    const result = await this.prisma.faqEntry.updateMany({
      where: { id: { in: ids } },
      data: { status, externallyUsable: status === "READY" },
    });
    await this.audit(actor, `FAQ_BULK_${action}`, "FaqEntry", ids.join(","), { ids, status, count: result.count });
    return { action, count: result.count };
  }

  async createUploadBatch(body: JsonRecord, actor: string): Promise<JsonRecord & { id: string }> {
    const requestedEmployeeId = await this.validEmployeeId(body.employeeId);
    const employeeId = requestedEmployeeId || (await this.prisma.employee.findFirst({
      where: { name: actor, status: "ACTIVE" },
      select: { id: true },
    }))?.id;
    const productIds = await this.validProductIds(textArray(body.productIds));
    const contentPlanId = text(body.contentPlanId);
    const shootRequirementId = text(body.shootRequirementId);
    if (contentPlanId || shootRequirementId) {
      if (!contentPlanId || !shootRequirementId) throw new BadRequestException("生产单和补拍项必须同时选择");
      const plan = await this.prisma.contentPlan.findUnique({ where: { id: contentPlanId } });
      if (!plan || plan.kind !== "VIDEO" || plan.productionStage !== "AWAITING_ASSETS") throw new BadRequestException("所选生产单当前不在等待素材阶段");
      const requirements = Array.isArray(plan.shootRequirements) ? plan.shootRequirements as JsonRecord[] : [];
      if (!requirements.some((item) => text(item.id) === shootRequirementId)) throw new BadRequestException("所选补拍项不属于该生产单");
    }
    const batch = await this.prisma.uploadBatch.create({
      data: {
        batchNo: batchNo(), sourceType: text(body.sourceType) || "WEB_UPLOAD",
        productScope: enumValue(body.productScope, productScopes, productIds.length ? "MODEL" : "UNKNOWN"), productIds,
        assetKind: text(body.assetKind) ? enumValue(body.assetKind, assetKinds, "DOCUMENT") : undefined,
        contentDescription: text(body.contentDescription) || undefined, originalStatus: Boolean(body.originalStatus),
        rightsStatus: enumValue(body.rightsStatus, rightsStatuses, "AUTH_REQUIRED"), acquiredAt: parseDate(body.acquiredAt),
        contentPlanId: contentPlanId || undefined, shootRequirementId: shootRequirementId || undefined,
        uploadedByEmployeeId: employeeId, uploadedBy: actor,
      },
    });
    await this.audit(actor, "UPLOAD_BATCH_CREATE", "UploadBatch", batch.id, batch);
    return this.batchView(batch);
  }

  suggestUploadMetadata(body: JsonRecord) {
    return this.assetAi.suggestUploadMetadata(body);
  }

  async uploadBatchFiles(id: string, files: DiskFile[], actor: string, body: JsonRecord = {}) {
    const batch = await this.prisma.uploadBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException("上传批次不存在");
    if (!files?.length) throw new BadRequestException("请选择需要上传的素材文件");
    if (files.length > 20) throw new BadRequestException("每批最多上传20个文件");
    const directProductionRequested = ["true", "1"].includes(text(body.productionDirect).toLowerCase());
    const directProduction = directProductionRequested
      && Boolean(batch.contentPlanId)
      && Boolean(batch.shootRequirementId)
      && batch.sourceType === "EMPLOYEE_CAPTURE"
      && batch.originalStatus
      && batch.rightsStatus === "COMMERCIAL";
    if (directProductionRequested && !directProduction) {
      throw new BadRequestException("生产单快捷上传仅支持公司原创、可商用的员工拍摄素材");
    }
    await this.prisma.uploadBatch.update({ where: { id }, data: { status: "UPLOADING", receivedCount: { increment: files.length } } });
    let created = 0;
    let duplicates = 0;
    let failed = 0;
    const results: JsonRecord[] = [];
    let technicalInfo: JsonRecord[] = [];
    let classificationTags: string[] = [];
    const aiRename = !["false", "0"].includes(text(body.aiRename).toLowerCase());
    try {
      const parsed = typeof body.technicalInfo === "string" ? JSON.parse(body.technicalInfo) : body.technicalInfo;
      technicalInfo = Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") as JsonRecord[] : [];
    } catch { technicalInfo = []; }
    try {
      const parsed = typeof body.classificationTags === "string" ? JSON.parse(body.classificationTags) : body.classificationTags;
      classificationTags = textArray(parsed).slice(0, 20);
    } catch { classificationTags = []; }
    for (const file of files) {
      try {
        const result = await this.ingestDiskFile(batch, file, actor, technicalInfo.find((item) => text(item.name) === file.originalname), aiRename);
        results.push(result);
        const assetId = text((result.asset as JsonRecord | undefined)?.id);
        if (assetId && batch.contentPlanId && batch.shootRequirementId) {
          await this.linkAssetToShootRequirement(batch.contentPlanId, batch.shootRequirementId, assetId, actor);
        }
        if (result.duplicate) duplicates += 1;
        else {
          created += 1;
          if (assetId && classificationTags.length) {
            const labels: Record<string, string> = { HOOK: "HOOK", PAIN: "痛点", FEATURE: "功能", TUTORIAL: "教程", REVIEW: "测评", STORY: "故事", HARD_AD: "硬广", LIVE_PREVIEW: "直播预告", DEMO: "演示", TRAFFIC: "引流", CTA: "CTA" };
            await this.replaceHumanTags(assetId, classificationTags.map((code) => ({ namespace: "content_classification", code, label: labels[code] || code })), actor);
          }
        }
        if (assetId && directProduction) {
          await this.reviewAssetV2(assetId, { action: "APPROVE", note: "生产单内公司原创素材快捷上传，系统自动归档" }, actor);
        }
      } catch (error) {
        failed += 1;
        const reason = error instanceof Error ? error.message : "上传失败";
        await this.prisma.uploadEvent.create({ data: { uploadBatchId: batch.id, uploadedByEmployeeId: batch.uploadedByEmployeeId, originalFileName: file.originalname, sizeBytes: file.size, result: "FAILED", failureReason: reason } });
        results.push({ fileName: file.originalname, failed: true, reason });
      } finally {
        await rm(file.path, { force: true });
      }
    }
    const status: UploadBatchStatus = failed === files.length ? "FAILED" : failed ? "PARTIAL" : "COMPLETED";
    const updated = await this.prisma.uploadBatch.update({ where: { id }, data: { status, createdCount: { increment: created }, duplicateCount: { increment: duplicates }, failedCount: { increment: failed }, completedAt: new Date() } });
    await this.audit(actor, "UPLOAD_BATCH_COMPLETE", "UploadBatch", id, { status, created, duplicates, failed });
    return { ...this.batchView(updated), results };
  }

  async uploadBatch(id: string) {
    const batch = await this.prisma.uploadBatch.findUnique({ where: { id }, include: { events: { include: { asset: true }, orderBy: { occurredAt: "asc" } }, uploadedByEmployee: true } });
    if (!batch) throw new NotFoundException("上传批次不存在");
    return { ...this.batchView(batch), events: batch.events.map((event) => ({ ...event, sizeBytes: Number(event.sizeBytes), asset: event.asset ? this.assetView(event.asset) : null })) };
  }

  async uploadAsset(file: MemoryFile | undefined, body: JsonRecord, actor: string) {
    if (!file?.buffer?.length) throw new BadRequestException("请选择需要上传的素材文件");
    const workDir = await mkdtemp(join(tmpdir(), "saidian-upload-"));
    const path = join(workDir, `upload${extname(file.originalname) || ".bin"}`);
    try {
      await writeFile(path, file.buffer);
      const batch = await this.createUploadBatch({ sourceType: "WEB_UPLOAD_COMPAT", productScope: body.model ? "MODEL" : "UNKNOWN", rightsStatus: this.legacyRights(body.copyrightStatus), contentDescription: body.name || body.scene }, actor);
      const result = await this.uploadBatchFiles(batch.id, [{ originalname: file.originalname, mimetype: file.mimetype, size: file.size, path }], actor);
      const first = result.results[0] || {};
      return { duplicate: Boolean(first.duplicate), asset: first.asset };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async assets(query: Record<string, string | undefined>) {
    const take = Math.min(Math.max(Number(query.pageSize || 0) || 50, 1), 100);
    const cursor = text(query.cursor);
    const keyword = text(query.query);
    const kind = text(query.kind || query.mediaType).toUpperCase();
    const level = text(query.level).toUpperCase();
    const model = text(query.model);
    const moduleType = text(query.moduleType).toUpperCase();
    const employeeId = text(query.employeeId);
    const reviewStatus = text(query.reviewStatus || query.status).toUpperCase();
    const reviewScope = text(query.reviewScope).toUpperCase();
    const availabilityStatus = text(query.availabilityStatus).toUpperCase();
    const rightsStatus = text(query.rightsStatus).toUpperCase();
    const minimumScore = Number(query.minimumScore || 0);
    const where: Prisma.AssetWhereInput = {
      ...(reviewScope === "TRASH" ? { deletedAt: { not: null } } : { deletedAt: null, status: { not: "ARCHIVED" } }),
      ...(assetKinds.includes(kind as AssetKind) ? { kind: kind as AssetKind } : {}),
      ...(assetLevels.includes(level as AssetLevel) ? { level: level as AssetLevel } : {}),
      ...(reviewStatuses.includes(reviewStatus as AssetReviewStatus)
        ? { reviewStatus: reviewStatus as AssetReviewStatus }
        : reviewScope === "PENDING"
          ? { reviewStatus: "PENDING" }
          : reviewScope === "NORMAL"
            ? { reviewStatus: { not: "PENDING" } }
            : {}),
      ...(availabilityStatuses.includes(availabilityStatus as AssetAvailabilityStatus) ? { availabilityStatus: availabilityStatus as AssetAvailabilityStatus } : {}),
      ...(rightsStatuses.includes(rightsStatus as AssetRightsStatus) ? { rightsStatus: rightsStatus as AssetRightsStatus } : {}),
      ...(employeeId ? { createdByEmployeeId: employeeId } : {}),
      ...(minimumScore ? { qualityScore: { gte: minimumScore } } : {}),
      ...(model ? { OR: [{ model: { contains: model, mode: "insensitive" } }, { products: { some: { product: { modelCode: { contains: model, mode: "insensitive" } } } } }] } : {}),
      ...(moduleTypes.includes(moduleType as VideoModuleType) ? { segments: { some: { moduleType: moduleType as VideoModuleType } } } : {}),
      ...(keyword ? { AND: [{ OR: [{ assetNo: { contains: keyword, mode: "insensitive" } }, { displayName: { contains: keyword, mode: "insensitive" } }, { fileName: { contains: keyword, mode: "insensitive" } }, { contentDescription: { contains: keyword, mode: "insensitive" } }, { searchText: { contains: keyword, mode: "insensitive" } }, { discoveredBy: { contains: keyword, mode: "insensitive" } }] }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.asset.findMany({ where, include: { versions: { orderBy: { version: "desc" }, take: 1 }, products: { include: { product: true } }, tags: { include: { tag: true } }, createdByEmployee: true, _count: { select: { uploadEvents: true, analysisJobs: true, usages: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
      this.prisma.asset.count({ where }),
    ]);
    const nextCursor = rows.length > take ? rows[take - 1].id : null;
    const items = rows.slice(0, take).map((row) => {
      const view = this.assetView(row);
      const latest = row.versions[0];
      const thumbnailObjectKey = row.kind === "IMAGE" ? (latest?.previewObjectKey || latest?.objectKey || row.objectKey) : null;
      let thumbnailUrl: string | null = null;
      if (thumbnailObjectKey && this.oss.isConfigured()) {
        try { thumbnailUrl = this.oss.signedDownloadUrl(thumbnailObjectKey, 900); } catch { thumbnailUrl = null; }
      }
      return { ...view, thumbnailUrl };
    });
    if (!query.pageSize && !query.cursor) return items;
    return { items, total, nextCursor, pageSize: take };
  }

  async rankedAssets(query: Record<string, string | undefined>) {
    const keyword = text(query.query);
    const model = text(query.model);
    const kind = text(query.kind).toUpperCase();
    const moduleType = text(query.moduleType).toUpperCase();
    const minimumScore = Math.max(0, Math.min(100, Number(query.minimumScore || 0)));
    const limit = Math.min(Math.max(Number(query.limit || 30), 1), 100);
    const rows = await this.prisma.asset.findMany({
      where: {
        reviewStatus: "APPROVED",
        availabilityStatus: "ACTIVE",
        rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
        qualityScore: { gte: minimumScore },
        ...(assetKinds.includes(kind as AssetKind) ? { kind: kind as AssetKind } : {}),
        ...(model ? {
          OR: [
            { model: { contains: model, mode: "insensitive" } },
            { products: { some: { product: { modelCode: { contains: model, mode: "insensitive" } } } } },
          ],
        } : {}),
        ...(moduleTypes.includes(moduleType as VideoModuleType) ? { segments: { some: { moduleType: moduleType as VideoModuleType } } } : {}),
        ...(keyword ? {
          AND: [{
            OR: [
              { assetNo: { contains: keyword, mode: "insensitive" } },
              { displayName: { contains: keyword, mode: "insensitive" } },
              { contentDescription: { contains: keyword, mode: "insensitive" } },
              { searchText: { contains: keyword, mode: "insensitive" } },
              { scene: { contains: keyword, mode: "insensitive" } },
              { tags: { some: { tag: { label: { contains: keyword, mode: "insensitive" } } } } },
            ],
          }],
        } : {}),
      },
      include: {
        versions: { orderBy: { version: "desc" }, take: 1 },
        products: { include: { product: true } },
        tags: { include: { tag: true } },
        segments: { orderBy: { startSeconds: "asc" } },
        createdByEmployee: true,
        _count: { select: { usages: true } },
      },
      orderBy: [{ qualityScore: "desc" }, { useCount: "desc" }, { updatedAt: "desc" }],
      take: limit,
    });
    return rows.map((row) => ({
      ...this.assetView(row),
      grade: assetGrade(row.qualityScore),
      callable: true,
      moduleTypes: Array.from(new Set(row.segments.map((segment) => segment.moduleType).filter(Boolean))),
    }));
  }

  async asset(id: string) {
    const row = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { version: "desc" } }, products: { include: { product: true } }, tags: { include: { tag: true } },
        parentRelations: { include: { childAsset: { select: { id: true, assetNo: true, displayName: true } } } },
        childRelations: { include: { parentAsset: { select: { id: true, assetNo: true, displayName: true } } } },
        uploadEvents: { include: { batch: true, employee: true }, orderBy: { occurredAt: "desc" } },
        analysisJobs: { orderBy: { createdAt: "desc" } }, reviewDecisions: { include: { employee: true }, orderBy: { createdAt: "desc" } },
        usages: { include: { metrics: { orderBy: { capturedAt: "desc" }, take: 10 } }, orderBy: { createdAt: "desc" } },
        metricSnapshots: { orderBy: { capturedAt: "desc" }, take: 30 }, segments: { orderBy: { startSeconds: "asc" } },
        cloudMediaJobs: { include: { outputs: true }, orderBy: { createdAt: "desc" } },
        scoreSnapshots: { orderBy: { createdAt: "desc" }, take: 20 }, createdByEmployee: true,
      },
    });
    if (!row) throw new NotFoundException("素材不存在");
    return this.assetView(row);
  }

  async updateAsset(id: string, body: JsonRecord, actor: string) {
    const existing = await this.prisma.asset.findUnique({ where: { id }, include: { products: true } });
    if (!existing) throw new NotFoundException("素材不存在");
    const productIds = body.productIds !== undefined ? await this.validProductIds(textArray(body.productIds)) : undefined;
    const asset = await this.prisma.asset.update({
      where: { id },
      data: {
        ...(body.name !== undefined || body.displayName !== undefined ? { displayName: text(body.displayName ?? body.name) || null } : {}),
        ...(body.contentDescription !== undefined ? { contentDescription: text(body.contentDescription) || null } : {}),
        ...(body.level !== undefined ? { level: enumValue(body.level, assetLevels, existing.level) } : {}),
        ...(body.productScope !== undefined ? { productScope: enumValue(body.productScope, productScopes, existing.productScope) } : {}),
        ...(body.rightsStatus !== undefined ? { rightsStatus: enumValue(body.rightsStatus, rightsStatuses, existing.rightsStatus) } : {}),
        ...(body.acquiredAt !== undefined ? { acquiredAt: parseDate(body.acquiredAt) || null } : {}),
        ...(body.restriction !== undefined ? { restriction: text(body.restriction) || null } : {}),
        ...(body.evidenceIds !== undefined ? { evidenceIds: textArray(body.evidenceIds) } : {}),
        ...(body.scene !== undefined ? { scene: text(body.scene) || null } : {}),
        ...(productIds ? { products: { deleteMany: {}, create: productIds.map((productId) => ({ productId, scope: enumValue(body.productScope, productScopes, "MODEL"), confirmed: true, confidence: 1 })) } } : {}),
      },
      include: { versions: { orderBy: { version: "desc" }, take: 1 }, products: { include: { product: true } }, tags: { include: { tag: true } }, createdByEmployee: true },
    });
    if (body.tags !== undefined) await this.replaceHumanTags(id, body.tags, actor);
    await this.audit(actor, "ASSET_METADATA_UPDATE", "Asset", id, { displayName: asset.displayName, productIds, rightsStatus: asset.rightsStatus });
    const nameChanged = body.name !== undefined || body.displayName !== undefined;
    if (nameChanged && isIrregularAssetName(asset.displayName || asset.fileName)) {
      const renamed = await this.assetAi.renameIrregularAssetFromExistingAnalysis(id);
      if (renamed) {
        await this.audit(actor, "ASSET_AI_RENAME", "Asset", id, { before: asset.displayName, after: renamed, source: "EXISTING_ANALYSIS" });
      } else if (asset.kind && ["IMAGE", "VIDEO"].includes(asset.kind)) {
        await this.assetAi.enqueue(id, asset.kind, asset.analysisVersion + 1);
        await this.audit(actor, "ASSET_AI_RENAME_QUEUED", "Asset", id, { displayName: asset.displayName, analysisVersion: asset.analysisVersion + 1 });
      }
    }
    return this.asset(id);
  }

  async bulkAssets(body: JsonRecord, actor: string) {
    const action = text(body.action).toUpperCase();
    const ids = action === "TRASH_ALL"
      ? (await this.prisma.asset.findMany({ where: { deletedAt: null }, select: { id: true } })).map((item) => item.id)
      : Array.from(new Set(textArray(body.ids))).slice(0, 200);
    if (!ids.length) throw new BadRequestException(action === "TRASH_ALL" ? "素材库已经为空" : "请选择素材");
    if (!["UPDATE", "APPROVE", "RETURN", "REANALYZE", "ARCHIVE", "TRASH", "TRASH_ALL", "RESTORE"].includes(action)) throw new BadRequestException("不支持的批量操作");
    if (["TRASH", "TRASH_ALL"].includes(action)) {
      if (text(body.confirmation) !== "移入回收站") throw new BadRequestException("删除确认文字不正确");
      const deletedAt = new Date();
      const purgeAfter = new Date(deletedAt.getTime() + 3 * 24 * 60 * 60 * 1000);
      const result = await this.prisma.asset.updateMany({
        where: { id: { in: ids }, deletedAt: null },
        data: { deletedAt, purgeAfter, status: "ARCHIVED", availabilityStatus: "ARCHIVED" },
      });
      await this.audit(actor, `ASSET_BULK_${action}`, "Asset", ids.join(","), { ids, count: result.count, deletedAt, purgeAfter });
      return { action, count: result.count, purgeAfter };
    }
    if (action === "RESTORE") {
      const result = await this.prisma.asset.updateMany({
        where: { id: { in: ids }, deletedAt: { not: null } },
        data: { deletedAt: null, purgeAfter: null, status: "PENDING", availabilityStatus: "INACTIVE" },
      });
      await this.audit(actor, "ASSET_BULK_RESTORE", "Asset", ids.join(","), { ids, count: result.count });
      return { action, count: result.count };
    }
    let count = 0;
    for (const id of ids) {
      if (action === "UPDATE") {
        const patch = jsonRecord(body.patch as Prisma.JsonValue);
        await this.updateAsset(id, patch, actor);
        const tagMode = text(body.tagMode).toUpperCase() || "APPEND";
        if (patch.tags !== undefined) {
          if (tagMode === "REPLACE") {
            await this.prisma.assetTag.deleteMany({ where: { assetId: id, source: "HUMAN" } });
            await this.replaceHumanTags(id, patch.tags, actor);
          } else if (tagMode === "REMOVE") {
            const tags = Array.isArray(patch.tags) ? patch.tags as JsonRecord[] : [];
            for (const item of tags) {
              const tag = await this.prisma.tagDefinition.findUnique({ where: { namespace_code: { namespace: text(item.namespace) || "manual", code: text(item.code) || text(item.label).toLowerCase().replace(/\s+/gu, "-").slice(0, 80) } } });
              if (tag) await this.prisma.assetTag.deleteMany({ where: { assetId: id, tagId: tag.id } });
            }
          }
        }
      } else if (action === "APPROVE") await this.reviewAssetV2(id, { action: "APPROVE", note: text(body.note) || "批量通过" }, actor);
      else if (action === "RETURN") await this.reviewAssetV2(id, { action: "RETURN", note: text(body.note) || "批量退回" }, actor);
      else if (action === "REANALYZE") await this.reanalyzeAsset(id, actor);
      else {
        await this.prisma.asset.update({ where: { id }, data: { status: "ARCHIVED", availabilityStatus: "ARCHIVED" } });
        await this.audit(actor, "ASSET_ARCHIVE", "Asset", id, { status: "ARCHIVED" });
      }
      count += 1;
    }
    await this.audit(actor, `ASSET_BULK_${action}`, "Asset", ids.join(","), { ids, count, tagMode: body.tagMode });
    return { action, count };
  }

  private async permanentlyDeleteAssets(ids: string[], actor: string, action: string) {
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        objectKey: true,
        versions: { select: { objectKey: true } },
        cloudMediaJobs: { select: { outputs: { select: { objectKey: true } } } },
      },
    });
    if (!assets.length) throw new BadRequestException("所选素材不存在");
    const objectKeys = assets.flatMap((asset) => [
      asset.objectKey,
      ...asset.versions.map((version) => version.objectKey),
      ...asset.cloudMediaJobs.flatMap((job) => job.outputs.map((output) => output.objectKey)),
    ]).filter((key): key is string => Boolean(key));
    const ossResult = await this.oss.deleteAssetObjects(assets.map((asset) => asset.id), objectKeys);
    await this.prisma.$transaction(async (tx) => {
      await tx.contentAsset.deleteMany({ where: { assetId: { in: assets.map((asset) => asset.id) } } });
      await tx.asset.deleteMany({ where: { id: { in: assets.map((asset) => asset.id) } } });
    }, { timeout: 120_000 });
    await this.audit(actor, `ASSET_BULK_${action}`, "Asset", "permanent-delete", {
      requested: ids.length,
      deletedAssets: assets.length,
      deletedOssObjects: ossResult.deleted,
    });
    return { action, count: assets.length, deletedOssObjects: ossResult.deleted };
  }

  @Cron("0 20 3 * * *", { timeZone: "Asia/Shanghai" })
  async purgeExpiredTrash() {
    const expired = await this.prisma.asset.findMany({
      where: { deletedAt: { not: null }, purgeAfter: { lte: new Date() } },
      select: { id: true },
      take: 5000,
    });
    if (!expired.length) return { count: 0, deletedOssObjects: 0 };
    return this.permanentlyDeleteAssets(expired.map((item) => item.id), "系统素材回收站", "PURGE_EXPIRED");
  }

  async replaceAssetVersion(id: string, file: MemoryFile | undefined, actor: string) {
    if (!file?.buffer?.length) throw new BadRequestException("请选择替换文件");
    const existing = await this.prisma.asset.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    if (!existing) throw new NotFoundException("素材不存在");
    const nextKind = fileKind(file.originalname, file.mimetype);
    if (existing.kind && nextKind !== existing.kind) throw new BadRequestException(`替换文件必须保持为${existing.kind}类型`);
    const extension = extname(file.originalname).toLowerCase() || existing.extension;
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const upload = await this.oss.uploadBuffer({ buffer: file.buffer, originalName: file.originalname, sha256, extension, actor, sourceType: "ASSET_VERSION_REPLACEMENT" });
    const version = Number(existing.versions[0]?.version || 0) + 1;
    let width: number | null = null;
    let height: number | null = null;
    if (nextKind === "IMAGE") {
      const metadata = await sharp(file.buffer).metadata();
      width = metadata.width || null;
      height = metadata.height || null;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.assetVersion.create({ data: {
        assetId: id, version, sha256, sourcePath: `web-replacement://${file.originalname}`,
        objectKey: upload.objectKey, objectVersionId: upload.objectVersionId, etag: upload.etag, storageUrl: upload.storageUrl,
        createdBy: actor, originalFileName: file.originalname, mimeType: file.mimetype, extension, sizeBytes: BigInt(file.size),
        width, height, technicalMetadata: json({ replacedAt: new Date().toISOString(), replacedBy: actor }),
      } });
      await tx.asset.update({ where: { id }, data: {
        fileName: file.originalname, originalFileName: file.originalname, extension, mediaType: file.mimetype,
        sha256, sizeBytes: BigInt(file.size), modifiedAt: new Date(), width, height,
        objectKey: upload.objectKey, objectVersionId: upload.objectVersionId, etag: upload.etag, storageUrl: upload.storageUrl, storageSyncedAt: upload.uploadedAt,
        kind: nextKind, processingStatus: "STORED", reviewStatus: "PENDING", availabilityStatus: "INACTIVE", status: "PENDING",
        reviewedBy: null, reviewedAt: null,
      } });
    });
    await this.audit(actor, "ASSET_VERSION_REPLACE", "Asset", id, { version, fileName: file.originalname, sha256 });
    await this.assetAi.enqueue(id, nextKind, existing.analysisVersion + 1);
    return this.asset(id);
  }

  async documentContent(id: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException("素材不存在");
    if (![".txt", ".md"].includes(asset.extension.toLowerCase())) throw new BadRequestException("仅TXT和Markdown支持在线编辑");
    if (!asset.objectKey) throw new BadRequestException("素材尚未存储到OSS");
    if (Number(asset.sizeBytes) > 2 * 1024 * 1024) throw new BadRequestException("在线编辑仅支持2MB以内的文本");
    const buffer = await this.oss.downloadBuffer(asset.objectKey);
    return { content: buffer.toString("utf8"), extension: asset.extension, fileName: asset.originalFileName || asset.fileName };
  }

  async updateDocumentContent(id: string, body: JsonRecord, actor: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException("素材不存在");
    if (![".txt", ".md"].includes(asset.extension.toLowerCase())) throw new BadRequestException("仅TXT和Markdown支持在线编辑");
    const content = text(body.content);
    const buffer = Buffer.from(content, "utf8");
    if (buffer.length > 2 * 1024 * 1024) throw new BadRequestException("正文不能超过2MB");
    return this.replaceAssetVersion(id, {
      originalname: asset.originalFileName || asset.fileName,
      mimetype: asset.extension.toLowerCase() === ".md" ? "text/markdown" : "text/plain",
      size: buffer.length,
      buffer,
    }, actor);
  }

  async reviewAssetV2(id: string, body: JsonRecord, actor: string) {
    const existing = await this.prisma.asset.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("素材不存在");
    const action = enumValue(body.action, reviewActions, "RETURN");
    let reviewStatus: AssetReviewStatus = "RETURNED";
    let availabilityStatus: AssetAvailabilityStatus = "INACTIVE";
    let rightsStatus = existing.rightsStatus;
    if (action === "APPROVE") {
      reviewStatus = "APPROVED";
      availabilityStatus = ["COMMERCIAL", "EDIT_ONLY"].includes(existing.rightsStatus) ? "ACTIVE" : "INACTIVE";
    } else if (action === "INTERNAL_ONLY") {
      reviewStatus = "APPROVED";
      rightsStatus = "INTERNAL";
    } else if (action === "REJECT") {
      reviewStatus = "REJECTED";
      availabilityStatus = "SUSPENDED";
    }
    const employeeId = await this.validEmployeeId(body.employeeId);
    const asset = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.asset.update({ where: { id }, data: { reviewStatus, availabilityStatus, rightsStatus, status: reviewStatus === "APPROVED" ? "READY" : reviewStatus === "REJECTED" ? "BLOCKED" : "PENDING", reviewedBy: actor, reviewedAt: new Date() } });
      await tx.assetReviewDecision.create({ data: { assetId: id, action, note: text(body.note) || undefined, reviewerEmployeeId: employeeId, reviewer: actor, before: json({ reviewStatus: existing.reviewStatus, availabilityStatus: existing.availabilityStatus, rightsStatus: existing.rightsStatus }), after: json({ reviewStatus, availabilityStatus, rightsStatus }) } });
      return updated;
    });
    await this.audit(actor, `ASSET_REVIEW_${action}`, "Asset", id, { reviewStatus, availabilityStatus, rightsStatus, note: text(body.note) });
    const linkedPlans = await this.prisma.contentAsset.findMany({ where: { assetId: id, role: { startsWith: "SHOOT:" } }, select: { contentPlanId: true } });
    for (const contentPlanId of new Set(linkedPlans.map((item) => item.contentPlanId))) {
      await this.reconcileShootRequirements(contentPlanId, actor);
    }
    return this.assetView(asset);
  }

  private async linkAssetToShootRequirement(contentPlanId: string, requirementId: string, assetId: string, actor: string) {
    const plan = await this.prisma.contentPlan.findUnique({ where: { id: contentPlanId } });
    if (!plan) return;
    const requirements = Array.isArray(plan.shootRequirements) ? plan.shootRequirements as JsonRecord[] : [];
    const next = requirements.map((item) => {
      if (text(item.id) !== requirementId) return item;
      const assetIds = Array.from(new Set([...textArray(item.assetIds), assetId]));
      return { ...item, assetIds, status: "IN_PROGRESS" };
    });
    await this.prisma.$transaction([
      this.prisma.contentAsset.upsert({
        where: { contentPlanId_assetId_role: { contentPlanId, assetId, role: `SHOOT:${requirementId}` } },
        create: { contentPlanId, assetId, role: `SHOOT:${requirementId}` },
        update: {},
      }),
      this.prisma.contentPlan.update({ where: { id: contentPlanId }, data: { shootRequirements: json(next), productionStage: "AWAITING_ASSETS" } }),
    ]);
    await this.audit(actor, "SHOOT_ASSET_LINK", "ContentPlan", contentPlanId, { requirementId, assetId });
  }

  private async reconcileShootRequirements(contentPlanId: string, actor: string) {
    const plan = await this.prisma.contentPlan.findUnique({
      where: { id: contentPlanId },
      include: { contentAssets: { include: { asset: true } } },
    });
    if (!plan || plan.kind !== "VIDEO") return;
    const eligible = new Map(plan.contentAssets.filter(({ asset }) =>
      asset.reviewStatus === "APPROVED"
      && asset.availabilityStatus === "ACTIVE"
      && ["COMMERCIAL", "EDIT_ONLY"].includes(asset.rightsStatus),
    ).map(({ assetId, asset }) => [assetId, String(asset.kind || "").toUpperCase()]));
    const requirements = Array.isArray(plan.shootRequirements) ? plan.shootRequirements as JsonRecord[] : [];
    const next = requirements.map((item) => {
      const assetIds = textArray(item.assetIds);
      const videoAssetIds = Array.from(new Set([...textArray(item.videoAssetIds), ...assetIds])).filter((assetId) => eligible.get(assetId) === "VIDEO");
      const imageAssetIds = Array.from(new Set([...textArray(item.imageAssetIds), ...assetIds])).filter((assetId) => eligible.get(assetId) === "IMAGE");
      const covered = videoAssetIds.length > 0;
      return {
        ...item,
        assetIds: [...videoAssetIds, ...imageAssetIds],
        videoAssetIds,
        imageAssetIds,
        coverage: covered ? "EXISTING" : "MISSING",
        status: covered ? "DONE" : assetIds.length ? "IN_PROGRESS" : "OPEN",
        ...(!covered && imageAssetIds.length ? { reason: "当前只有静态图片，可作为辅助画面，仍需补拍视频主画面" } : {}),
      };
    });
    const productionStage = next.length === 0 || next.every((item) => text(item.status) === "DONE") ? "READY_TO_EDIT" : "AWAITING_ASSETS";
    await this.prisma.contentPlan.update({ where: { id: contentPlanId }, data: { shootRequirements: json(next), productionStage } });
    await this.audit(actor, "SHOOT_REQUIREMENTS_RECONCILE", "ContentPlan", contentPlanId, { productionStage, requirements: next });
  }

  async reviewAsset(id: string, approved: boolean, actor: string, note?: string) {
    return this.reviewAssetV2(id, { action: approved ? "APPROVE" : "REJECT", note }, actor);
  }

  async reanalyzeAsset(id: string, actor: string) {
    const existing = await this.prisma.asset.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("素材不存在");
    const version = existing.analysisVersion + 1;
    const kind = existing.kind || fileKind(existing.fileName, "");
    await this.assetAi.enqueue(id, kind, version);
    await this.audit(actor, "ASSET_REANALYZE", "Asset", id, { analysisVersion: version });
    return this.asset(id);
  }

  async rebuildAssetIndex(actor: string) {
    const assets = await this.prisma.asset.findMany({
      where: { status: { not: "ARCHIVED" }, kind: { in: ["IMAGE", "VIDEO"] } },
      select: { id: true, kind: true, analysisVersion: true },
      orderBy: { updatedAt: "desc" },
      take: 1000,
    });
    for (const asset of assets) {
      await this.assetAi.enqueue(asset.id, asset.kind || "IMAGE", asset.analysisVersion + 1);
    }
    await this.audit(actor, "ASSET_INDEX_REBUILD", "Asset", "ALL", { count: assets.length, indexVersion: 2 });
    return { queued: assets.length, indexVersion: 2 };
  }

  async analysisJobs(query: Record<string, string | undefined>) {
    const status = text(query.status).toUpperCase();
    return this.prisma.assetAnalysisJob.findMany({ where: { ...(status ? { status: status as never } : {}) }, include: { asset: { select: { id: true, assetNo: true, displayName: true, fileName: true } } }, orderBy: { updatedAt: "desc" }, take: 200 });
  }

  async segments(id: string) {
    await this.ensureAsset(id);
    return this.prisma.assetSegment.findMany({ where: { assetId: id }, orderBy: { startSeconds: "asc" } });
  }

  async updateSegment(assetId: string, segmentId: string, body: JsonRecord, actor: string) {
    const segment = await this.prisma.assetSegment.findFirst({ where: { id: segmentId, assetId } });
    if (!segment) throw new NotFoundException("视频片段不存在");
    const updated = await this.prisma.assetSegment.update({ where: { id: segmentId }, data: { ...(body.startSeconds !== undefined ? { startSeconds: Number(body.startSeconds) } : {}), ...(body.endSeconds !== undefined ? { endSeconds: Number(body.endSeconds) } : {}), ...(body.transcript !== undefined ? { transcript: text(body.transcript) || null } : {}), ...(body.moduleType !== undefined ? { moduleType: text(body.moduleType) ? enumValue(body.moduleType, moduleTypes, "SCENE") : null } : {}), ...(body.status !== undefined ? { status: text(body.status) || "SUGGESTED" } : {}), locked: true, createdBy: actor } });
    await this.audit(actor, "ASSET_SEGMENT_UPDATE", "AssetSegment", segmentId, updated);
    return updated;
  }

  async materializeSegment(assetId: string, segmentId: string, body: JsonRecord, actor: string) {
    const employeeId = await this.validEmployeeId(body.employeeId);
    const result = await this.assetAi.materializeSegment(assetId, segmentId, actor, employeeId);
    await this.audit(actor, "ASSET_SEGMENT_MATERIALIZE", "AssetSegment", segmentId, result);
    return result;
  }

  async assetGaps(refresh = false) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (refresh || !await this.prisma.assetGapSnapshot.count({ where: { snapshotDate: today } })) await this.calculateGaps(today);
    return this.prisma.assetGapSnapshot.findMany({ where: { snapshotDate: today }, orderBy: [{ severity: "desc" }, { productModel: "asc" }, { category: "asc" }] });
  }

  async analyzeProductAssetGaps(productModel: string, actor: string) {
    const model = text(productModel);
    if (!model) throw new BadRequestException("请选择产品型号");
    const product = await this.prisma.product.findFirst({
      where: { modelCode: { equals: model, mode: "insensitive" }, status: "READY" },
      select: { id: true, modelCode: true, name: true, category: true, metadata: true },
    });
    if (!product) throw new NotFoundException(`未找到已审核产品：${model}`);
    const assets = await this.prisma.asset.findMany({
      where: {
        reviewStatus: "APPROVED",
        availabilityStatus: "ACTIVE",
        rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
        OR: [{ products: { some: { productId: product.id } } }, { productScope: { in: ["BRAND", "COMMON"] } }],
      },
      select: { id: true, displayName: true, kind: true, contentDescription: true, aiIndex: true, searchText: true, indexConfidence: true, qualityScore: true },
      orderBy: [{ qualityScore: "desc" }, { useCount: "desc" }],
      take: 120,
    });
    const gaps = await this.aiContent.analyzeProductAssetGaps({
      product,
      availableAssetCount: assets.length,
      assets,
      rule: "只判断当前已审核、可用且有权限的素材；已有索引能够覆盖的画面不得重复列为缺口",
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await this.prisma.$transaction(async (tx) => {
      await tx.assetGapSnapshot.deleteMany({ where: { snapshotDate: today, productId: product.id, generatedBy: "AI素材缺口分析" } });
      if (gaps.length) {
        await tx.assetGapSnapshot.createMany({
          data: gaps.map((gap) => ({
            snapshotDate: today,
            productId: product.id,
            productModel: product.modelCode,
            assetKind: gap.assetKind,
            category: gap.category,
            requiredCount: 1,
            activeCount: 0,
            gapCount: 1,
            severity: gap.priority,
            recommendation: gap.description,
            generatedBy: "AI素材缺口分析",
          })),
        });
      }
      await tx.auditLog.create({ data: { actor, action: "AI_ASSET_GAP_ANALYZE", entityType: "Product", entityId: product.id, after: json({ model: product.modelCode, assetCount: assets.length, gaps }) } });
    });
    return this.prisma.assetGapSnapshot.findMany({ where: { snapshotDate: today, productId: product.id, generatedBy: "AI素材缺口分析" }, orderBy: [{ severity: "asc" }, { category: "asc" }] });
  }

  async createSelectedGapTasks(ids: string[], actor: string) {
    const gapIds = Array.from(new Set(ids.map(text).filter(Boolean)));
    if (!gapIds.length) throw new BadRequestException("请选择需要生成补拍任务的缺失素材");
    const gaps = await this.prisma.assetGapSnapshot.findMany({ where: { id: { in: gapIds }, gapCount: { gt: 0 } } });
    let created = 0;
    for (const gap of gaps) {
      const existing = await this.prisma.opsTask.findFirst({ where: { sourceType: "AI_ASSET_GAP", sourceId: gap.id, status: { not: "DONE" } }, select: { id: true } });
      if (existing) continue;
      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + (gap.severity === "HIGH" ? 1 : 3));
      await this.prisma.opsTask.create({
        data: {
          title: `${gap.productModel || "通用"}补拍：${gap.category}`,
          description: gap.recommendation,
          category: "素材补拍",
          priority: gap.severity,
          sourceType: "AI_ASSET_GAP",
          sourceId: gap.id,
          productId: gap.productId,
          evidence: json({ assetKind: gap.assetKind, productModel: gap.productModel, gapCategory: gap.category, gapId: gap.id }),
          dueAt,
          result: `由${actor}从AI缺失素材分析中确认生成`,
        },
      });
      created += 1;
    }
    await this.audit(actor, "AI_ASSET_GAP_TASK_CREATE", "AssetGapSnapshot", gapIds.join(","), { requested: gapIds.length, created });
    return { requested: gapIds.length, created };
  }

  async gapTasks(productModel?: string) {
    return this.prisma.opsTask.findMany({
      where: {
        sourceType: "AI_ASSET_GAP",
        ...(productModel ? { evidence: { path: ["productModel"], equals: productModel } } : {}),
      },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      take: 100,
    });
  }

  async uploadGapTaskFiles(taskId: string, files: DiskFile[], actor: string) {
    const task = await this.prisma.opsTask.findUnique({ where: { id: taskId } });
    if (!task || task.sourceType !== "AI_ASSET_GAP") throw new NotFoundException("补拍任务不存在");
    if (task.status === "DONE") throw new BadRequestException("该补拍任务已经完成");
    const evidence = jsonRecord(task.evidence);
    const productIds = task.productId ? [task.productId] : [];
    const batch = await this.createUploadBatch({
      sourceType: "EMPLOYEE_CAPTURE",
      productScope: productIds.length ? "MODEL" : "UNKNOWN",
      productIds,
      assetKind: text(evidence.assetKind) || "VIDEO",
      contentDescription: task.description || task.title,
      originalStatus: true,
      rightsStatus: "COMMERCIAL",
      acquiredAt: new Date().toISOString(),
    }, actor);
    const result = await this.uploadBatchFiles(batch.id, files, actor);
    const completed = result.results.some((item) => !item.failed) && result.results.every((item) => !item.failed);
    await this.prisma.opsTask.update({
      where: { id: taskId },
      data: {
        status: completed ? "DONE" : "IN_PROGRESS",
        completedAt: completed ? new Date() : null,
        completedBy: completed ? actor : null,
        result: completed ? "补拍素材已上传素材库，正在进行AI分类、索引和标签分析" : "部分素材上传失败，请补充上传",
      },
    });
    await this.audit(actor, "AI_ASSET_GAP_TASK_UPLOAD", "OpsTask", taskId, { batchId: batch.id, completed, result });
    return { taskId, completed, batchId: batch.id, ...result };
  }

  async growthLoop(refresh = false, actor = "系统增长闭环") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (refresh) await this.recalculateAssetScores();
    if (refresh || !await this.prisma.assetGapSnapshot.count({ where: { snapshotDate: today } })) await this.calculateGaps(today);
    const gaps = await this.prisma.assetGapSnapshot.findMany({ where: { snapshotDate: today, gapCount: { gt: 0 } }, orderBy: [{ severity: "desc" }, { productModel: "asc" }] });
    if (refresh) await this.generateGapTasks(gaps, actor);

    const [
      collected, stored, processing, readyForReview, approved, active, usedAssets,
      metricAssets, scoredAssets, openTasks, latestUsages, latestMetrics,
    ] = await Promise.all([
      this.prisma.asset.count(),
      this.prisma.asset.count({ where: { objectKey: { not: null } } }),
      this.prisma.asset.count({ where: { processingStatus: "ANALYZING" } }),
      this.prisma.asset.count({ where: { processingStatus: "READY_FOR_REVIEW", reviewStatus: "PENDING" } }),
      this.prisma.asset.count({ where: { reviewStatus: "APPROVED" } }),
      this.prisma.asset.count({ where: { reviewStatus: "APPROVED", availabilityStatus: "ACTIVE" } }),
      this.prisma.assetUsage.groupBy({ by: ["assetId"] }).then((rows) => rows.length),
      this.prisma.assetMetricSnapshot.groupBy({ by: ["assetId"] }).then((rows) => rows.length),
      this.prisma.asset.count({ where: { performance: { path: ["growthScore"], not: Prisma.AnyNull } } }),
      this.prisma.opsTask.count({ where: { sourceType: "ASSET_GAP", status: "OPEN" } }),
      this.prisma.assetUsage.findMany({ include: { asset: { select: { assetNo: true, displayName: true, fileName: true } }, metrics: { orderBy: { capturedAt: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" }, take: 12 }),
      this.prisma.assetMetricSnapshot.findMany({ include: { asset: { select: { assetNo: true, displayName: true, fileName: true, qualityScore: true, performance: true } } }, orderBy: { capturedAt: "desc" }, take: 12 }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      stages: [
        { key: "COLLECT", label: "员工拍摄或收集素材", count: collected, state: collected ? "ACTIVE" : "WAITING" },
        { key: "UPLOAD", label: "统一上传", count: stored, state: stored ? "ACTIVE" : "WAITING" },
        { key: "AI_PROCESS", label: "AI识别、分段、标签、去重", count: processing, secondaryCount: readyForReview, state: processing ? "RUNNING" : "READY" },
        { key: "REVIEW", label: "人工审核", count: approved, secondaryCount: readyForReview, state: readyForReview ? "ACTION_REQUIRED" : "READY" },
        { key: "ASSET_POOL", label: "进入可调用素材池", count: active, state: active ? "ACTIVE" : "WAITING" },
        { key: "CONTENT", label: "AI生成脚本和内容", count: usedAssets, state: usedAssets ? "ACTIVE" : "WAITING" },
        { key: "PUBLISH", label: "员工审核和发布", count: latestUsages.filter((item) => Boolean(item.platform)).length, state: "TRACKING" },
        { key: "METRICS", label: "获取播放、互动、销售数据", count: metricAssets, state: metricAssets ? "ACTIVE" : "WAITING" },
        { key: "SCORE", label: "调整素材评分和推荐权重", count: scoredAssets, state: scoredAssets ? "ACTIVE" : "WAITING" },
        { key: "GAP", label: "发现素材缺口", count: gaps.length, state: gaps.length ? "ACTION_REQUIRED" : "READY" },
        { key: "TASK", label: "生成下一轮拍摄和收集任务", count: openTasks, state: openTasks ? "ACTION_REQUIRED" : "READY" },
      ],
      summary: { collected, stored, processing, readyForReview, approved, active, usedAssets, metricAssets, scoredAssets, gaps: gaps.length, openTasks },
      gaps,
      tasks: await this.prisma.opsTask.findMany({ where: { sourceType: "ASSET_GAP", status: "OPEN" }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }], take: 30 }),
      latestUsages,
      latestMetrics,
    };
  }

  async recordAssetUsage(assetId: string, body: JsonRecord, actor: string) {
    const asset = await this.ensureAsset(assetId);
    if (asset.reviewStatus !== "APPROVED" || asset.availabilityStatus !== "ACTIVE") throw new BadRequestException("只有已审核且可调用的素材才能进入内容生产");
    const employeeId = await this.validEmployeeId(body.employeeId);
    const platformText = text(body.platform).toUpperCase();
    const usage = await this.prisma.assetUsage.create({
      data: {
        assetId,
        usageType: text(body.usageType) || "CONTENT_GENERATION",
        businessObjectType: text(body.businessObjectType) || "CONTENT",
        businessObjectId: text(body.businessObjectId) || randomUUID(),
        usedByEmployeeId: employeeId,
        usedBy: actor,
        actorType: text(body.actorType).toUpperCase() === "AI" ? "AI" : "HUMAN",
        purpose: text(body.purpose) || undefined,
        platform: integrationKinds.includes(platformText as IntegrationKind) ? platformText as IntegrationKind : undefined,
        accountId: text(body.accountId) || undefined,
      },
    });
    await this.prisma.asset.update({ where: { id: assetId }, data: { useCount: { increment: 1 }, lastUsedAt: new Date() } });
    await this.audit(actor, "ASSET_USAGE_CREATE", "Asset", assetId, { usageId: usage.id, businessObjectType: usage.businessObjectType, businessObjectId: usage.businessObjectId });
    return usage;
  }

  async recordAssetMetric(assetId: string, body: JsonRecord, actor: string) {
    await this.ensureAsset(assetId);
    const usageId = text(body.usageId) || undefined;
    if (usageId) {
      const usage = await this.prisma.assetUsage.findFirst({ where: { id: usageId, assetId }, select: { id: true } });
      if (!usage) throw new BadRequestException("素材调用记录不存在");
    }
    const platformText = text(body.platform).toUpperCase();
    const capturedAt = body.capturedAt ? new Date(text(body.capturedAt)) : new Date();
    if (Number.isNaN(capturedAt.getTime())) throw new BadRequestException("数据采集时间无效");
    const numberOrNull = (value: unknown) => value === null || value === undefined || value === "" ? null : Math.max(0, Number(value));
    const snapshot = await this.prisma.assetMetricSnapshot.create({
      data: {
        assetId, usageId,
        platform: integrationKinds.includes(platformText as IntegrationKind) ? platformText as IntegrationKind : undefined,
        accountId: text(body.accountId) || undefined, externalId: text(body.externalId) || undefined, capturedAt,
        views: numberOrNull(body.views), likes: numberOrNull(body.likes), comments: numberOrNull(body.comments),
        shares: numberOrNull(body.shares), saves: numberOrNull(body.saves), consultations: numberOrNull(body.consultations),
        orders: numberOrNull(body.orders), revenue: body.revenue === null || body.revenue === undefined || body.revenue === "" ? undefined : new Prisma.Decimal(Number(body.revenue)),
        unavailableFields: textArray(body.unavailableFields), raw: json(body.raw),
      },
    });
    await this.recalculateAssetScore(assetId);
    await this.audit(actor, "ASSET_METRIC_CREATE", "Asset", assetId, { metricId: snapshot.id, usageId, platform: snapshot.platform, capturedAt });
    return snapshot;
  }

  async dailyReport(dateValue?: string) {
    const from = dateValue ? new Date(`${dateValue}T00:00:00+08:00`) : new Date();
    if (Number.isNaN(from.getTime())) throw new BadRequestException("日期格式应为 YYYY-MM-DD");
    from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    const [events, reviews, jobs, usages, metrics, gaps, tasks] = await Promise.all([
      this.prisma.uploadEvent.findMany({ where: { occurredAt: { gte: from, lt: to } }, include: { employee: true, asset: { select: { assetNo: true, displayName: true, fileName: true, kind: true, objectKey: true } }, batch: true }, orderBy: { occurredAt: "asc" } }),
      this.prisma.assetReviewDecision.findMany({ where: { createdAt: { gte: from, lt: to } }, include: { employee: true, asset: { select: { assetNo: true, displayName: true, fileName: true } } }, orderBy: { createdAt: "asc" } }),
      this.prisma.assetAnalysisJob.findMany({ where: { updatedAt: { gte: from, lt: to } }, include: { asset: { select: { assetNo: true, displayName: true, fileName: true } } }, orderBy: { updatedAt: "asc" } }),
      this.prisma.assetUsage.findMany({ where: { createdAt: { gte: from, lt: to } }, include: { asset: { select: { assetNo: true, displayName: true, fileName: true } }, metrics: { orderBy: { capturedAt: "desc" }, take: 1 } }, orderBy: { createdAt: "asc" } }),
      this.prisma.assetMetricSnapshot.findMany({ where: { capturedAt: { gte: from, lt: to } }, include: { asset: { select: { assetNo: true, displayName: true, fileName: true } } }, orderBy: { capturedAt: "asc" } }),
      this.prisma.assetGapSnapshot.findMany({ where: { snapshotDate: from, gapCount: { gt: 0 } }, orderBy: { severity: "desc" } }),
      this.prisma.opsTask.findMany({ where: { sourceType: "ASSET_GAP", createdAt: { gte: from, lt: to } }, orderBy: { createdAt: "asc" } }),
    ]);
    const employeeMap = new Map<string, { employeeId: string | null; employee: string; uploaded: number; created: number; duplicates: number; failed: number }>();
    for (const event of events) {
      const key = event.uploadedByEmployeeId || event.batch.uploadedBy;
      const row = employeeMap.get(key) || { employeeId: event.uploadedByEmployeeId, employee: event.employee?.name || event.batch.uploadedBy, uploaded: 0, created: 0, duplicates: 0, failed: 0 };
      row.uploaded += 1;
      if (event.result === "CREATED") row.created += 1;
      if (event.result === "EXACT_DUPLICATE") row.duplicates += 1;
      if (event.result === "FAILED") row.failed += 1;
      employeeMap.set(key, row);
    }
    return {
      date: from.toISOString().slice(0, 10),
      summary: { uploaded: events.length, created: events.filter((item) => item.result === "CREATED").length, duplicates: events.filter((item) => item.result === "EXACT_DUPLICATE").length, failed: events.filter((item) => item.result === "FAILED").length, approved: reviews.filter((item) => item.action === "APPROVE").length, aiDerivedModules: events.filter((item) => item.asset?.kind === "VIDEO" && item.batch.sourceType === "AI_DERIVED").length, actualUsages: usages.length, metricSnapshots: metrics.length, generatedTasks: tasks.length, aiFailed: jobs.filter((item) => item.status === "FAILED").length, aiUnconfigured: jobs.filter((item) => item.status === "UNCONFIGURED").length, gaps: gaps.length },
      employees: Array.from(employeeMap.values()), uploads: events.map((event) => ({ ...event, sizeBytes: Number(event.sizeBytes) })), reviews, jobs, usages, metrics, gaps, tasks,
      generatedAt: new Date().toISOString(),
    };
  }

  aiCapabilities() {
    return this.assetAi.capabilities();
  }

  async assetDownloadUrl(id: string) {
    const asset = await this.ensureAsset(id);
    if (!asset.objectKey) throw new BadRequestException("该素材尚未同步到 OSS");
    return { url: this.oss.signedDownloadUrl(asset.objectKey), expiresIn: 1800 };
  }

  private async ingestDiskFile(batch: { id: string; sourceType: string; assetKind: AssetKind | null; productScope: ProductScope; productIds: string[]; contentDescription: string | null; originalStatus: boolean; rightsStatus: AssetRightsStatus; acquiredAt: Date | null; uploadedByEmployeeId: string | null }, file: DiskFile, actor: string, technicalInfo?: JsonRecord, aiRename = true) {
    const hash = await hashFile(file.path);
    const duplicate = await this.prisma.asset.findFirst({ where: { sha256: hash }, orderBy: { createdAt: "asc" } });
    if (duplicate) {
      await this.prisma.uploadEvent.create({ data: { uploadBatchId: batch.id, assetId: duplicate.id, uploadedByEmployeeId: batch.uploadedByEmployeeId, originalFileName: file.originalname, sha256: hash, sizeBytes: file.size, result: "EXACT_DUPLICATE" } });
      await this.audit(actor, "ASSET_EXACT_DUPLICATE", "Asset", duplicate.id, { uploadBatchId: batch.id, originalFileName: file.originalname, sha256: hash });
      return { fileName: file.originalname, duplicate: true, asset: this.assetView(duplicate) };
    }
    const kind = batch.assetKind || fileKind(file.originalname, file.mimetype || "");
    const extension = extname(file.originalname).toLowerCase();
    const stored = await this.oss.uploadOriginal({ path: file.path, sha256: hash, extension, actor, sourceType: batch.sourceType });
    let width = Number(technicalInfo?.width || 0) || undefined;
    let height = Number(technicalInfo?.height || 0) || undefined;
    const durationSeconds = Number(technicalInfo?.durationSeconds || 0) || undefined;
    if (kind === "IMAGE") {
      const metadata = await sharp(file.path, { animated: false }).metadata().catch(() => undefined);
      width = metadata?.width;
      height = metadata?.height;
    }
    const now = new Date();
    const asset = await this.prisma.asset.create({
      data: {
        sourceKey: `${batch.sourceType}:${hash}`, sourceType: batch.sourceType, sourcePath: `oss://${stored.objectKey}`,
        fileName: file.originalname, originalFileName: file.originalname, extension, mediaType: kind, kind,
        assetNo: assetNo(kind), displayName: basename(file.originalname, extension), level: "ORIGINAL", productScope: batch.productScope,
        processingStatus: "STORED", reviewStatus: "PENDING", availabilityStatus: "INACTIVE", rightsStatus: batch.rightsStatus,
        sha256: hash, sizeBytes: file.size, modifiedAt: now, width, height, durationSeconds, aspectRatio: width && height ? `${width}:${height}` : undefined,
        contentDescription: batch.contentDescription || undefined, acquiredAt: batch.acquiredAt || undefined, isOriginal: batch.originalStatus,
        status: "PENDING", qualityScore: kind === "IMAGE" && width && height ? (Math.min(width, height) >= 1080 ? 90 : 70) : 60,
        sourceSnapshot: json({ uploadBatchId: batch.id, originalFileName: file.originalname, technicalInfo: technicalInfo || {}, aiRename }), storageProvider: "ALIYUN_OSS",
        objectKey: stored.objectKey, objectVersionId: stored.objectVersionId, etag: stored.etag, storageUrl: stored.storageUrl, storageSyncedAt: stored.uploadedAt,
        discoveredBy: actor, createdByEmployeeId: batch.uploadedByEmployeeId,
        versions: { create: { version: 1, sha256: hash, sourcePath: `oss://${stored.objectKey}`, objectKey: stored.objectKey, objectVersionId: stored.objectVersionId, etag: stored.etag, storageUrl: stored.storageUrl, createdByEmployeeId: batch.uploadedByEmployeeId, createdBy: actor, originalFileName: file.originalname, mimeType: file.mimetype, extension, sizeBytes: file.size, width, height } },
        products: { create: batch.productIds.map((productId) => ({ productId, scope: batch.productScope === "UNKNOWN" ? "MODEL" : batch.productScope, confirmed: true, confidence: 1 })) },
        uploadEvents: { create: { uploadBatchId: batch.id, uploadedByEmployeeId: batch.uploadedByEmployeeId, originalFileName: file.originalname, sha256: hash, sizeBytes: file.size, result: "CREATED" } },
      },
    });
    await this.audit(actor, "ASSET_UPLOAD", "Asset", asset.id, { assetNo: asset.assetNo, fileName: file.originalname, objectKey: stored.objectKey, sha256: hash, uploadBatchId: batch.id, aiRename });
    await this.assetAi.enqueue(asset.id, kind, 1);
    return { fileName: file.originalname, duplicate: false, asset: this.assetView(asset) };
  }

  private async validEmployeeId(value: unknown): Promise<string | undefined> {
    const id = text(value);
    if (!id) return undefined;
    const employee = await this.prisma.employee.findFirst({ where: { id, status: "ACTIVE" }, select: { id: true } });
    if (!employee) throw new BadRequestException("所选员工不存在或已停用");
    return employee.id;
  }

  private async validProductIds(values: string[]): Promise<string[]> {
    const ids = Array.from(new Set(values));
    if (!ids.length) return [];
    const products = await this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (products.length !== ids.length) throw new BadRequestException("产品型号必须从产品库选择");
    return products.map((item) => item.id);
  }

  private legacyRights(value: unknown): AssetRightsStatus {
    const source = text(value);
    if (["自有可用", "已授权"].includes(source)) return "COMMERCIAL";
    if (source === "限制使用") return "INTERNAL";
    return "AUTH_REQUIRED";
  }

  private async replaceHumanTags(assetId: string, value: unknown, actor: string) {
    const tags = Array.isArray(value) ? value as JsonRecord[] : [];
    for (const item of tags) {
      const namespace = text(item.namespace) || "manual";
      const label = text(item.label);
      if (!label) continue;
      const code = text(item.code) || label.toLowerCase().replace(/\s+/gu, "-").slice(0, 80);
      const tag = await this.prisma.tagDefinition.upsert({ where: { namespace_code: { namespace, code } }, update: { label }, create: { namespace, code, label } });
      await this.prisma.assetTag.upsert({ where: { assetId_tagId: { assetId, tagId: tag.id } }, update: { source: "HUMAN", confidence: 1, confirmed: true, locked: true, createdBy: actor }, create: { assetId, tagId: tag.id, source: "HUMAN", confidence: 1, confirmed: true, locked: true, createdBy: actor } });
    }
  }

  private async recalculateAssetScores() {
    const assets = await this.prisma.asset.findMany({ select: { id: true } });
    for (const asset of assets) await this.recalculateAssetScore(asset.id);
  }

  private async recalculateAssetScore(assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: { metricSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
    });
    if (!asset) return;
    const previous = jsonRecord(asset.performance);
    const baselineQuality = Number(previous.baselineQualityScore ?? asset.qualityScore);
    const latest = asset.metricSnapshots[0];
    const calculated = growthScore({
      baselineQuality,
      views: latest?.views,
      likes: latest?.likes,
      comments: latest?.comments,
      shares: latest?.shares,
      saves: latest?.saves,
      orders: latest?.orders,
    });
    await this.prisma.asset.update({
      where: { id: assetId },
      data: {
        qualityScore: calculated.score,
        performance: json({
          ...previous,
          baselineQualityScore: baselineQuality,
          growthScore: calculated.score,
          recommendationWeight: calculated.recommendationWeight,
          hasPerformanceData: calculated.hasPerformanceData,
          latestMetricId: latest?.id ?? null,
          calculatedAt: new Date().toISOString(),
        }),
      },
    });
  }

  private async generateGapTasks(gaps: Array<{ id: string; productModel: string | null; assetKind: AssetKind; category: string; gapCount: number; recommendation: string; severity: string }>, actor: string) {
    for (const gap of gaps) {
      const sourceId = gap.id;
      const existing = await this.prisma.opsTask.findFirst({ where: { sourceType: "ASSET_GAP", sourceId, status: "OPEN" }, select: { id: true } });
      if (existing) continue;
      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + (gap.severity === "HIGH" ? 1 : 3));
      await this.prisma.opsTask.create({
        data: {
          title: gap.recommendation || `补充 ${gap.productModel || "通用"} ${gap.category} 素材`,
          category: "ASSET_COLLECTION",
          priority: gap.severity === "HIGH" ? "HIGH" : "NORMAL",
          sourceType: "ASSET_GAP",
          sourceId,
          dueAt,
          result: `系统根据素材缺口生成；创建主体：${actor}`,
        },
      });
    }
  }

  private async calculateGaps(today: Date) {
    const products = await this.prisma.product.findMany({ where: { status: { not: "ARCHIVED" } }, select: { id: true, modelCode: true } });
    const categories: Array<{ kind: AssetKind; category: string }> = [{ kind: "IMAGE", category: "产品白底图" }, { kind: "IMAGE", category: "场景图" }, { kind: "VIDEO", category: "HOOK" }, { kind: "VIDEO", category: "功能演示" }];
    for (const product of products) {
      for (const category of categories) {
        const activeCount = await this.prisma.asset.count({ where: { kind: category.kind, reviewStatus: "APPROVED", availabilityStatus: "ACTIVE", products: { some: { productId: product.id } }, OR: [{ scene: { contains: category.category, mode: "insensitive" } }, { tags: { some: { tag: { label: { contains: category.category, mode: "insensitive" } } } } }, ...(category.category === "HOOK" ? [{ segments: { some: { moduleType: "HOOK" as VideoModuleType } } }] : [])] } });
        const gapCount = Math.max(1 - activeCount, 0);
        await this.prisma.assetGapSnapshot.upsert({ where: { snapshotDate_productModel_assetKind_category: { snapshotDate: today, productModel: product.modelCode, assetKind: category.kind, category: category.category } }, update: { activeCount, gapCount, severity: gapCount ? "HIGH" : "OK", recommendation: gapCount ? `补充 ${product.modelCode} ${category.category} ${gapCount} 项` : "当前基础覆盖已满足" }, create: { snapshotDate: today, productId: product.id, productModel: product.modelCode, assetKind: category.kind, category: category.category, requiredCount: 1, activeCount, gapCount, severity: gapCount ? "HIGH" : "OK", recommendation: gapCount ? `补充 ${product.modelCode} ${category.category} ${gapCount} 项` : "当前基础覆盖已满足" } });
      }
    }
  }

  private async ensureAsset(id: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException("素材不存在");
    return asset;
  }

  private batchView(batch: { id: string; [key: string]: unknown }): JsonRecord & { id: string } {
    return { ...batch, occurredAt: batch.createdAt, employeeId: batch.uploadedByEmployeeId, actor: batch.uploadedBy, source: batch.sourceType };
  }

  private assetView(asset: { [key: string]: unknown; sizeBytes: bigint; sourceSnapshot: Prisma.JsonValue }) {
    const metadata = jsonRecord(asset.sourceSnapshot);
    const products = Array.isArray(asset.products) ? asset.products as Array<JsonRecord> : [];
    const tags = Array.isArray(asset.tags) ? asset.tags as Array<JsonRecord> : [];
    const jobs = Array.isArray(asset.analysisJobs) ? asset.analysisJobs as Array<JsonRecord> : [];
    const versions = Array.isArray(asset.versions) ? asset.versions as Array<JsonRecord> : [];
    const uploadEvents = Array.isArray(asset.uploadEvents) ? asset.uploadEvents as Array<JsonRecord> : [];
    return {
      ...asset, sizeBytes: Number(asset.sizeBytes), metadata,
      assetNo: text(asset.assetNo) || text(metadata.assetNo) || text(asset.sourceKey),
      displayName: text(asset.displayName) || text(metadata.name) || text(asset.fileName),
      category: text(metadata.category) || text(asset.scene) || text(asset.kind) || text(asset.mediaType),
      products: products.map((item) => item.product || item), tags: tags.map((item) => ({ ...(item.tag as JsonRecord || {}), source: item.source, confidence: item.confidence, confirmed: item.confirmed, locked: item.locked })),
      versions: versions.map((item) => ({ ...item, sizeBytes: item.sizeBytes === null || item.sizeBytes === undefined ? null : Number(item.sizeBytes) })),
      uploadEvents: uploadEvents.map((item) => ({ ...item, sizeBytes: item.sizeBytes === null || item.sizeBytes === undefined ? 0 : Number(item.sizeBytes) })),
      latestVersion: versions.length ? Number(versions[0]?.version || 1) : 1,
      failureReason: jobs.find((item) => item.status === "FAILED")?.failureReason || asset.storageError || null,
      occurredAt: asset.createdAt, employeeId: asset.createdByEmployeeId || null, actor: asset.discoveredBy,
      source: asset.sourceType, ossObject: asset.objectKey, auditNo: text(asset.assetNo) || text(asset.id),
    };
  }

  private audit(actor: string, action: string, entityType: string, entityId: string, after: unknown) {
    return this.prisma.auditLog.create({ data: { actor, action, entityType, entityId, after: json(after) } });
  }
}
