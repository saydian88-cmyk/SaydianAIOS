import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RecordStatus } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import sharp from "sharp";
import { OssStorageService } from "./oss-storage.service";
import { PrismaService } from "./prisma.service";

type JsonRecord = Record<string, unknown>;

const knowledgeTypes = ["PRODUCT", "PARAMETER", "WORDING", "FAQ", "FORBIDDEN", "AFTER_SALE", "TUTORIAL"];
const recordStatuses: RecordStatus[] = ["DRAFT", "PENDING", "READY", "BLOCKED", "ARCHIVED"];
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

function status(value: unknown, fallback: RecordStatus = "PENDING"): RecordStatus {
  const candidate = text(value).toUpperCase() as RecordStatus;
  return recordStatuses.includes(candidate) ? candidate : fallback;
}

function mediaType(fileName: string, mimeType: string): string {
  const extension = extname(fileName).toLowerCase();
  if (mimeType.startsWith("image/") || imageExtensions.has(extension)) return "IMAGE";
  if (mimeType.startsWith("video/") || videoExtensions.has(extension)) return "VIDEO";
  if (mimeType.startsWith("audio/") || audioExtensions.has(extension)) return "AUDIO";
  return "DOCUMENT";
}

function knowledgeNo(): string {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `KB-${day}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function assetNo(): string {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `MT-${day}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

@Injectable()
export class BrandDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oss: OssStorageService,
  ) {}

  async overview() {
    const [knowledgeTotal, knowledgeReady, knowledgePending, assetTotal, assetReady, assetPending, ossStored, ossHealth] = await Promise.all([
      this.prisma.knowledgeEntry.count(),
      this.prisma.knowledgeEntry.count({ where: { status: "READY" } }),
      this.prisma.knowledgeEntry.count({ where: { status: { in: ["DRAFT", "PENDING"] } } }),
      this.prisma.asset.count(),
      this.prisma.asset.count({ where: { status: "READY" } }),
      this.prisma.asset.count({ where: { status: { in: ["DRAFT", "PENDING"] } } }),
      this.prisma.asset.count({ where: { storageProvider: "ALIYUN_OSS", objectKey: { not: null } } }),
      this.oss.healthCheck(),
    ]);
    return {
      knowledge: { total: knowledgeTotal, ready: knowledgeReady, pending: knowledgePending },
      assets: { total: assetTotal, ready: assetReady, pending: assetPending, ossStored },
      oss: ossHealth,
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
        ...(recordStatuses.includes(state as RecordStatus) ? { status: state as RecordStatus } : {}),
        ...(model ? { model: { contains: model, mode: "insensitive" } } : {}),
        ...(keyword ? {
          OR: [
            { id: { contains: keyword, mode: "insensitive" as const } },
            { title: { contains: keyword, mode: "insensitive" as const } },
            { summary: { contains: keyword, mode: "insensitive" as const } },
            { reply: { contains: keyword, mode: "insensitive" as const } },
            { body: { contains: keyword, mode: "insensitive" as const } },
          ],
        } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    return entries.map((entry) => ({ ...entry, metadata: jsonRecord(entry.raw) }));
  }

  async knowledgeControls() {
    const [claims, mappings, phraseRules] = await Promise.all([
      this.prisma.evidenceClaim.findMany({ orderBy: { updatedAt: "desc" } }),
      this.prisma.productMapping.findMany({ orderBy: { commercialName: "asc" } }),
      this.prisma.phraseRule.findMany({ where: { active: true }, orderBy: [{ category: "asc" }, { blockedText: "asc" }] }),
    ]);
    return { claims, mappings, phraseRules };
  }

  async createKnowledge(body: JsonRecord, actor: string) {
    const title = text(body.title);
    const type = text(body.type).toUpperCase();
    if (!title) throw new BadRequestException("知识标题不能为空");
    if (!knowledgeTypes.includes(type)) throw new BadRequestException("请选择有效的知识类型");
    const id = text(body.id) || knowledgeNo();
    const metadata = {
      keywords: textArray(body.keywords),
      scenarios: textArray(body.scenarios),
      owner: text(body.owner) || actor,
      version: 1,
      createdBy: actor,
    };
    const entry = await this.prisma.knowledgeEntry.create({
      data: {
        id,
        type,
        title,
        category: text(body.category) || undefined,
        model: text(body.model) || undefined,
        summary: text(body.summary) || undefined,
        reply: text(body.reply) || undefined,
        body: text(body.body) || undefined,
        source: text(body.source) || "运营后台录入",
        sourceRefs: text(body.sourceRefs) || undefined,
        status: status(body.status),
        audience: text(body.audience) || "customer",
        raw: metadata,
      },
    });
    await this.audit(actor, "KNOWLEDGE_CREATE", "KnowledgeEntry", entry.id, entry as unknown as Prisma.InputJsonValue);
    return { ...entry, metadata };
  }

  async updateKnowledge(id: string, body: JsonRecord, actor: string) {
    const existing = await this.prisma.knowledgeEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("知识记录不存在");
    const existingMetadata = jsonRecord(existing.raw);
    const metadata = {
      ...existingMetadata,
      ...(body.keywords !== undefined ? { keywords: textArray(body.keywords) } : {}),
      ...(body.scenarios !== undefined ? { scenarios: textArray(body.scenarios) } : {}),
      ...(body.owner !== undefined ? { owner: text(body.owner) } : {}),
      version: Number(existingMetadata.version || 1) + 1,
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    };
    const entry = await this.prisma.knowledgeEntry.update({
      where: { id },
      data: {
        ...(body.type !== undefined && knowledgeTypes.includes(text(body.type).toUpperCase()) ? { type: text(body.type).toUpperCase() } : {}),
        ...(body.title !== undefined ? { title: text(body.title) } : {}),
        ...(body.category !== undefined ? { category: text(body.category) || null } : {}),
        ...(body.model !== undefined ? { model: text(body.model) || null } : {}),
        ...(body.summary !== undefined ? { summary: text(body.summary) || null } : {}),
        ...(body.reply !== undefined ? { reply: text(body.reply) || null } : {}),
        ...(body.body !== undefined ? { body: text(body.body) || null } : {}),
        ...(body.source !== undefined ? { source: text(body.source) || "运营后台录入" } : {}),
        ...(body.sourceRefs !== undefined ? { sourceRefs: text(body.sourceRefs) || null } : {}),
        ...(body.audience !== undefined ? { audience: text(body.audience) || "customer" } : {}),
        ...(body.status !== undefined ? { status: status(body.status, existing.status) } : {}),
        raw: metadata,
      },
    });
    await this.audit(actor, "KNOWLEDGE_UPDATE", "KnowledgeEntry", id, entry as unknown as Prisma.InputJsonValue);
    return { ...entry, metadata };
  }

  async reviewKnowledge(id: string, approved: boolean, actor: string, note?: string) {
    const existing = await this.prisma.knowledgeEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("知识记录不存在");
    const metadata = {
      ...jsonRecord(existing.raw),
      reviewedBy: actor,
      reviewedAt: new Date().toISOString(),
      reviewNote: text(note),
    };
    const entry = await this.prisma.knowledgeEntry.update({ where: { id }, data: { status: approved ? "READY" : "BLOCKED", raw: metadata } });
    await this.audit(actor, approved ? "KNOWLEDGE_APPROVE" : "KNOWLEDGE_BLOCK", "KnowledgeEntry", id, { status: entry.status, note: text(note) });
    return { ...entry, metadata };
  }

  async assets(query: Record<string, string | undefined>) {
    const keyword = text(query.query).toLocaleLowerCase("zh-CN");
    const state = text(query.status).toUpperCase();
    const model = text(query.model);
    const category = text(query.category);
    const rows = await this.prisma.asset.findMany({
      where: {
        ...(recordStatuses.includes(state as RecordStatus) ? { status: state as RecordStatus } : {}),
        ...(model ? { model: { contains: model, mode: "insensitive" } } : {}),
      },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    return rows
      .map((row) => {
        const metadata = jsonRecord(row.sourceSnapshot);
        return {
          ...row,
          sizeBytes: Number(row.sizeBytes),
          metadata,
          assetNo: text(metadata.assetNo) || row.sourceKey,
          displayName: text(metadata.name) || row.fileName,
          category: text(metadata.category) || row.scene || row.mediaType,
          latestVersion: row.versions[0]?.version ?? 1,
          duplicateCount: 0,
        };
      })
      .filter((row) => !category || row.category === category)
      .filter((row) => !keyword || [row.assetNo, row.displayName, row.fileName, row.model, row.category, row.discoveredBy].some((value) => text(value).toLocaleLowerCase("zh-CN").includes(keyword)));
  }

  async uploadAsset(file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined, body: JsonRecord, actor: string) {
    if (!file?.buffer?.length) throw new BadRequestException("请选择需要上传的素材文件");
    const hash = createHash("sha256").update(file.buffer).digest("hex");
    const duplicate = await this.prisma.asset.findFirst({ where: { sha256: hash }, orderBy: { updatedAt: "desc" } });
    if (duplicate) return { duplicate: true, asset: this.assetView(duplicate) };
    const extension = extname(file.originalname).toLowerCase();
    const type = mediaType(file.originalname, file.mimetype || "");
    let width: number | undefined;
    let height: number | undefined;
    if (type === "IMAGE") {
      const metadata = await sharp(file.buffer, { animated: false }).metadata().catch(() => undefined);
      width = metadata?.width;
      height = metadata?.height;
    }
    const stored = await this.oss.uploadBuffer({
      buffer: file.buffer,
      originalName: file.originalname,
      sha256: hash,
      extension,
      actor,
      sourceType: "WEB_UPLOAD",
    });
    const now = new Date();
    const metadata = {
      assetNo: assetNo(),
      name: text(body.name) || file.originalname,
      category: text(body.category) || type,
      creator: text(body.creator) || actor,
      participants: textArray(body.participants),
      language: text(body.language) || "中文",
      targetPlatforms: textArray(body.targetPlatforms),
      hook: text(body.hook),
      sellingPoints: textArray(body.sellingPoints),
      scenarios: textArray(body.scenarios),
      audienceTags: textArray(body.audienceTags),
      copyrightStatus: text(body.copyrightStatus) || "待确认",
      aiTags: textArray(body.aiTags),
      uploadedBy: actor,
      uploadedAt: now.toISOString(),
    };
    const asset = await this.prisma.asset.create({
      data: {
        sourceKey: `WEB_UPLOAD:${hash}`,
        sourceType: "WEB_UPLOAD",
        sourcePath: `oss://${stored.objectKey}`,
        fileName: file.originalname,
        extension,
        mediaType: type,
        sha256: hash,
        sizeBytes: file.size,
        modifiedAt: now,
        width,
        height,
        aspectRatio: width && height ? `${width}:${height}` : undefined,
        model: text(body.model) || undefined,
        scene: text(body.scene) || undefined,
        evidenceIds: textArray(body.evidenceIds),
        restriction: text(body.restriction) || undefined,
        status: "PENDING",
        qualityScore: type === "IMAGE" && width && height ? (Math.min(width, height) >= 1080 ? 90 : 70) : 60,
        sourceSnapshot: metadata,
        storageProvider: "ALIYUN_OSS",
        objectKey: stored.objectKey,
        objectVersionId: stored.objectVersionId,
        etag: stored.etag,
        storageUrl: stored.storageUrl,
        storageSyncedAt: stored.uploadedAt,
        discoveredBy: actor,
        versions: {
          create: {
            version: 1,
            sha256: hash,
            sourcePath: `oss://${stored.objectKey}`,
            objectKey: stored.objectKey,
            objectVersionId: stored.objectVersionId,
            etag: stored.etag,
            storageUrl: stored.storageUrl,
            createdBy: actor,
          },
        },
      },
    });
    await this.audit(actor, "ASSET_UPLOAD", "Asset", asset.id, { assetNo: metadata.assetNo, fileName: file.originalname, objectKey: stored.objectKey, sha256: hash });
    return { duplicate: false, asset: this.assetView(asset) };
  }

  async updateAsset(id: string, body: JsonRecord, actor: string) {
    const existing = await this.prisma.asset.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("素材不存在");
    const metadata = {
      ...jsonRecord(existing.sourceSnapshot),
      ...(body.name !== undefined ? { name: text(body.name) } : {}),
      ...(body.category !== undefined ? { category: text(body.category) } : {}),
      ...(body.creator !== undefined ? { creator: text(body.creator) } : {}),
      ...(body.participants !== undefined ? { participants: textArray(body.participants) } : {}),
      ...(body.language !== undefined ? { language: text(body.language) } : {}),
      ...(body.targetPlatforms !== undefined ? { targetPlatforms: textArray(body.targetPlatforms) } : {}),
      ...(body.hook !== undefined ? { hook: text(body.hook) } : {}),
      ...(body.sellingPoints !== undefined ? { sellingPoints: textArray(body.sellingPoints) } : {}),
      ...(body.scenarios !== undefined ? { scenarios: textArray(body.scenarios) } : {}),
      ...(body.audienceTags !== undefined ? { audienceTags: textArray(body.audienceTags) } : {}),
      ...(body.copyrightStatus !== undefined ? { copyrightStatus: text(body.copyrightStatus) } : {}),
      ...(body.aiTags !== undefined ? { aiTags: textArray(body.aiTags) } : {}),
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    };
    const asset = await this.prisma.asset.update({
      where: { id },
      data: {
        ...(body.model !== undefined ? { model: text(body.model) || null } : {}),
        ...(body.scene !== undefined ? { scene: text(body.scene) || null } : {}),
        ...(body.evidenceIds !== undefined ? { evidenceIds: textArray(body.evidenceIds) } : {}),
        ...(body.restriction !== undefined ? { restriction: text(body.restriction) || null } : {}),
        ...(body.status !== undefined ? { status: status(body.status, existing.status) } : {}),
        sourceSnapshot: metadata,
      },
    });
    await this.audit(actor, "ASSET_UPDATE", "Asset", id, { metadata, model: asset.model, status: asset.status });
    return this.assetView(asset);
  }

  async reviewAsset(id: string, approved: boolean, actor: string, note?: string) {
    const existing = await this.prisma.asset.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("素材不存在");
    const metadata = { ...jsonRecord(existing.sourceSnapshot), reviewNote: text(note) };
    const asset = await this.prisma.asset.update({
      where: { id },
      data: { status: approved ? "READY" : "BLOCKED", reviewedBy: actor, reviewedAt: new Date(), sourceSnapshot: metadata },
    });
    await this.audit(actor, approved ? "ASSET_APPROVE" : "ASSET_BLOCK", "Asset", id, { status: asset.status, note: text(note) });
    return this.assetView(asset);
  }

  async assetDownloadUrl(id: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException("素材不存在");
    if (!asset.objectKey) throw new BadRequestException("该素材尚未同步到 OSS");
    return { url: this.oss.signedDownloadUrl(asset.objectKey), expiresIn: 1800 };
  }

  private assetView(asset: { [key: string]: unknown; sizeBytes: bigint; sourceSnapshot: Prisma.JsonValue }) {
    const metadata = jsonRecord(asset.sourceSnapshot);
    return {
      ...asset,
      sizeBytes: Number(asset.sizeBytes),
      metadata,
      assetNo: text(metadata.assetNo) || text(asset.sourceKey),
      displayName: text(metadata.name) || text(asset.fileName),
      category: text(metadata.category) || text(asset.scene) || text(asset.mediaType),
    };
  }

  private audit(actor: string, action: string, entityType: string, entityId: string, after: Prisma.InputJsonValue) {
    return this.prisma.auditLog.create({ data: { actor, action, entityType, entityId, after } });
  }
}
