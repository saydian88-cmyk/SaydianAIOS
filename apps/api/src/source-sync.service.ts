import { Injectable } from "@nestjs/common";
import { IntegrationKind, IntegrationState, Prisma, RecordStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { opsConfig } from "./config";
import { OssStorageService } from "./oss-storage.service";
import { PrismaService } from "./prisma.service";
import { safeJson, stringValue, toDate } from "./utils";

const execFileAsync = promisify(execFile);
const mediaExtensions = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp",
  ".mp4", ".mov", ".mkv", ".webm", ".avi", ".mp3", ".wav", ".m4a", ".aac",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".md",
]);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);
const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi"]);

type BootstrapRow = Record<string, unknown>;

function recordStatus(value: unknown): RecordStatus {
  const text = stringValue(value);
  if (/停用|禁止|隔离|不可用/.test(text)) return "BLOCKED";
  if (/过期|归档/.test(text)) return "ARCHIVED";
  if (/可用|确认|发布/.test(text) && !/有条件|待|限制/.test(text)) return "READY";
  return "PENDING";
}

function detectModel(path: string): string | undefined {
  const match = path.match(/W8\s*Ultra-?R|W8UltraR|W8Ultra|W8PRO|W9S|W9|W8S|W8U|W8|W7PRO|M7|S8|S7|S6|E8|E6|B8|W5|R7Y|R7/iu);
  if (!match) return undefined;
  return match[0].replace(/\s+/g, "").replace(/^W8UltraR$/i, "W8 Ultra-R").toUpperCase();
}

function mediaType(extension: string): string {
  if (imageExtensions.has(extension)) return "IMAGE";
  if (videoExtensions.has(extension)) return "VIDEO";
  if ([".mp3", ".wav", ".m4a", ".aac"].includes(extension)) return "AUDIO";
  return "DOCUMENT";
}

async function fileHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise());
  });
  return hash.digest("hex");
}

async function walk(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && mediaExtensions.has(extname(entry.name).toLowerCase())) result.push(path);
    }
  }
  await visit(root);
  return result;
}

async function mediaMetadata(path: string, extension: string): Promise<{
  width?: number;
  height?: number;
  durationSeconds?: number;
}> {
  if (imageExtensions.has(extension)) {
    const metadata = await sharp(path, { animated: false }).metadata();
    return { width: metadata.width, height: metadata.height };
  }
  if (videoExtensions.has(extension)) {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path,
    ], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    const json = safeJson(JSON.parse(stdout));
    const streams = Array.isArray(json.streams) ? json.streams : [];
    const video = streams.map(safeJson).find((stream) => stream.codec_type === "video");
    const format = safeJson(json.format);
    return {
      width: Number(video?.width) || undefined,
      height: Number(video?.height) || undefined,
      durationSeconds: Number(format.duration) || undefined,
    };
  }
  return {};
}

function qualityScore(input: { mediaType: string; width?: number; height?: number; durationSeconds?: number; size: number }): number {
  let score = 35;
  if (input.size > 20_000) score += 15;
  if (input.mediaType === "IMAGE") {
    if ((input.width ?? 0) >= 1080) score += 25;
    if ((input.height ?? 0) >= 1080) score += 25;
  } else if (input.mediaType === "VIDEO") {
    if ((input.width ?? 0) >= 1080 && (input.height ?? 0) >= 1080) score += 25;
    if ((input.durationSeconds ?? 0) >= 3) score += 25;
  } else {
    score += 25;
  }
  return Math.min(100, score);
}

@Injectable()
export class SourceSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oss: OssStorageService,
  ) {}

  private async updateIntegration(kind: IntegrationKind, data: { state: IntegrationState; message: string; capabilities: string[] }) {
    await this.prisma.integration.upsert({
      where: { kind },
      create: {
        kind,
        displayName: kind === "LOCAL_ASSET" ? "本地素材库" : kind === "WECOM_DRIVE" ? "企微网盘" : kind === "HELP_CENTER" ? "客服帮助网站" : kind === "ALIYUN_OSS" ? "阿里云 OSS 素材库" : "宣传证据底表",
        state: data.state,
        message: data.message,
        capabilities: data.capabilities,
        lastCheckedAt: new Date(),
        lastSuccessAt: data.state === "HEALTHY" ? new Date() : undefined,
      },
      update: {
        state: data.state,
        message: data.message,
        capabilities: data.capabilities,
        lastCheckedAt: new Date(),
        lastSuccessAt: data.state === "HEALTHY" ? new Date() : undefined,
      },
    });
  }

  async syncAssets(actor = "系统素材扫描"): Promise<{ scanned: number; created: number; updated: number; unchanged: number; ossSynced: number; errors: string[] }> {
    await mkdir(opsConfig.derivedOutputDir, { recursive: true });
    const roots = Array.from(new Set([...opsConfig.assetRoots, opsConfig.derivedOutputDir]));
    if (opsConfig.wecomDriveRoot) roots.push(opsConfig.wecomDriveRoot);
    let scanned = 0;
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let ossSynced = 0;
    const errors: string[] = [];
    const ossConfigured = this.oss.isConfigured();

    for (const root of roots) {
      try {
        const files = await walk(root);
        for (const path of files) {
          scanned += 1;
          try {
            const before = await stat(path);
            const sourceType = root === opsConfig.wecomDriveRoot ? "WECOM_DRIVE" : root === opsConfig.derivedOutputDir ? "DERIVED_OUTPUT" : "LOCAL_ASSET";
            const sourceKey = `${sourceType}:${path.toLocaleLowerCase("zh-CN")}`;
            const existing = await this.prisma.asset.findUnique({ where: { sourceKey } });
            const sourceUnchanged = Boolean(existing && existing.sizeBytes === BigInt(before.size) && existing.modifiedAt.getTime() === before.mtime.getTime());
            if (sourceUnchanged && existing?.storageProvider === "ALIYUN_OSS" && existing.objectKey && existing.storageSyncedAt) {
              unchanged += 1;
              continue;
            }
            if (sourceUnchanged && !ossConfigured) {
              if (existing?.storageError !== this.oss.configurationMessage()) {
                await this.prisma.asset.update({
                  where: { sourceKey },
                  data: { storageError: this.oss.configurationMessage() },
                });
              }
              unchanged += 1;
              continue;
            }
            const hash = sourceUnchanged && existing ? existing.sha256 : await fileHash(path);
            const after = await stat(path);
            if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
              errors.push(`${path}：扫描期间文件发生变化，已跳过`);
              continue;
            }
            const extension = extname(path).toLowerCase();
            const type = mediaType(extension);
            const metadata: { width?: number; height?: number; durationSeconds?: number } = await mediaMetadata(path, extension).catch(() => ({}));
            const relativePath = relative(root, path);
            const firstSegment = relativePath.split(sep)[0];
            const score = qualityScore({
              mediaType: type,
              width: metadata.width,
              height: metadata.height,
              durationSeconds: metadata.durationSeconds,
              size: before.size,
            });
            let storageData: {
              storageProvider: string;
              objectKey?: string;
              objectVersionId?: string;
              etag?: string;
              storageUrl?: string;
              storageSyncedAt?: Date;
              storageError?: string | null;
            } = {
              storageProvider: existing?.storageProvider ?? "LOCAL_SOURCE",
              objectKey: existing?.objectKey ?? undefined,
              objectVersionId: existing?.objectVersionId ?? undefined,
              etag: existing?.etag ?? undefined,
              storageUrl: existing?.storageUrl ?? undefined,
              storageSyncedAt: existing?.storageSyncedAt ?? undefined,
              storageError: this.oss.configurationMessage(),
            };
            if (ossConfigured) {
              try {
                const stored = await this.oss.uploadOriginal({
                  path,
                  sha256: hash,
                  extension,
                  actor,
                  sourceType,
                  category: sourceType === "DERIVED_OUTPUT" ? "derived" : "original",
                });
                storageData = {
                  storageProvider: "ALIYUN_OSS",
                  objectKey: stored.objectKey,
                  objectVersionId: stored.objectVersionId,
                  etag: stored.etag,
                  storageUrl: stored.storageUrl,
                  storageSyncedAt: stored.uploadedAt,
                  storageError: null,
                };
                ossSynced += 1;
              } catch (error) {
                const message = error instanceof Error ? error.message : "OSS 上传失败";
                storageData.storageError = message;
                errors.push(`${path}：OSS 上传失败：${message}`);
              }
            }
            const asset = await this.prisma.asset.upsert({
              where: { sourceKey },
              create: {
                sourceKey,
                sourceType,
                sourcePath: path,
                fileName: path.split(sep).pop() || path,
                extension,
                mediaType: type,
                sha256: hash,
                sizeBytes: before.size,
                modifiedAt: before.mtime,
                width: metadata.width,
                height: metadata.height,
                durationSeconds: metadata.durationSeconds,
                aspectRatio: metadata.width && metadata.height ? `${metadata.width}:${metadata.height}` : undefined,
                model: detectModel(path),
                scene: firstSegment,
                evidenceIds: [],
                status: "PENDING",
                qualityScore: score,
                discoveredBy: actor,
                sourceSnapshot: { root, relativePath, scannedAt: new Date().toISOString() },
                ...storageData,
              },
              update: {
                sha256: hash,
                sizeBytes: before.size,
                modifiedAt: before.mtime,
                width: metadata.width,
                height: metadata.height,
                durationSeconds: metadata.durationSeconds,
                aspectRatio: metadata.width && metadata.height ? `${metadata.width}:${metadata.height}` : undefined,
                model: detectModel(path),
                scene: firstSegment,
                qualityScore: score,
                sourceSnapshot: { root, relativePath, scannedAt: new Date().toISOString() },
                ...storageData,
              },
            });
            await this.prisma.auditLog.create({
              data: {
                actor,
                action: !existing ? "ASSET_ADDED" : sourceUnchanged ? "ASSET_STORAGE_SYNCED" : "ASSET_UPDATED",
                entityType: "Asset",
                entityId: asset.id,
                before: existing ? { sha256: existing.sha256, modifiedAt: existing.modifiedAt.toISOString() } : {},
                after: {
                  fileName: asset.fileName,
                  sourceType: asset.sourceType,
                  sourcePath: asset.sourcePath,
                  model: asset.model,
                  mediaType: asset.mediaType,
                  sha256: asset.sha256,
                  qualityScore: asset.qualityScore,
                  storageProvider: asset.storageProvider,
                  objectKey: asset.objectKey,
                  storageSyncedAt: asset.storageSyncedAt?.toISOString(),
                  storageError: asset.storageError,
                },
              },
            });
            if (existing) updated += 1;
            else created += 1;
          } catch (error) {
            errors.push(`${path}：${error instanceof Error ? error.message : "扫描失败"}`);
          }
        }
      } catch (error) {
        errors.push(`${root}：${error instanceof Error ? error.message : "目录读取失败"}`);
      }
    }

    await this.updateIntegration("LOCAL_ASSET", {
      state: errors.length ? "DEGRADED" : "HEALTHY",
      message: `已扫描${scanned}个文件，新增${created}，更新${updated}，异常${errors.length}`,
      capabilities: ["assets"],
    });
    if (opsConfig.wecomDriveRoot) {
      await this.updateIntegration("WECOM_DRIVE", {
        state: errors.some((message) => message.startsWith(opsConfig.wecomDriveRoot)) ? "DEGRADED" : "HEALTHY",
        message: "企微网盘同步目录已纳入只读扫描",
        capabilities: ["assets"],
      });
    }
    const ossHealth = await this.oss.healthCheck();
    await this.updateIntegration("ALIYUN_OSS", {
      state: !ossConfigured ? "UNCONFIGURED" : !ossHealth.ok ? "ERROR" : errors.some((message) => message.includes("OSS 上传失败")) ? "DEGRADED" : "HEALTHY",
      message: !ossConfigured ? this.oss.configurationMessage() : `${ossHealth.message}；本次同步${ossSynced}个对象`,
      capabilities: ["assets"],
    });
    return { scanned, created, updated, unchanged, ossSynced, errors };
  }

  async syncKnowledge(): Promise<{ faqs: number; tutorials: number; resources: number }> {
    const response = await fetch(opsConfig.helpCenterContentUrl, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      await this.updateIntegration("HELP_CENTER", { state: "ERROR", message: `客服网站返回${response.status}`, capabilities: [] });
      throw new Error(`客服帮助网站返回${response.status}`);
    }
    const content = safeJson(await response.json());
    const groups = [
      ["faq", Array.isArray(content.faqs) ? content.faqs : []],
      ["tutorial", Array.isArray(content.tutorials) ? content.tutorials : []],
      ["resource", Array.isArray(content.resources) ? content.resources : []],
    ] as const;
    for (const [type, rows] of groups) {
      for (const raw of rows) {
        const row = safeJson(raw);
        const id = `${type}:${stringValue(row.id)}`;
        if (!stringValue(row.id)) continue;
        await this.prisma.knowledgeEntry.upsert({
          where: { id },
          create: {
            id,
            type,
            title: stringValue(row.title),
            category: stringValue(row.category) || undefined,
            model: stringValue(row.model || row.models) || undefined,
            summary: stringValue(row.summary || row.description) || undefined,
            reply: stringValue(row.reply) || undefined,
            body: stringValue(row.steps || row.url || row.tags) || undefined,
            source: stringValue(row.source) || "赛电客服帮助网站",
            sourceRefs: stringValue(row.sourceRefs || row.originalUrl) || undefined,
            status: recordStatus(row.status),
            audience: stringValue(row.audience) || "customer",
            updatedAtSource: toDate(row.updatedAt),
            raw: row as Prisma.InputJsonValue,
          },
          update: {
            title: stringValue(row.title),
            category: stringValue(row.category) || undefined,
            model: stringValue(row.model || row.models) || undefined,
            summary: stringValue(row.summary || row.description) || undefined,
            reply: stringValue(row.reply) || undefined,
            body: stringValue(row.steps || row.url || row.tags) || undefined,
            source: stringValue(row.source) || "赛电客服帮助网站",
            sourceRefs: stringValue(row.sourceRefs || row.originalUrl) || undefined,
            status: recordStatus(row.status),
            audience: stringValue(row.audience) || "customer",
            updatedAtSource: toDate(row.updatedAt),
            raw: row as Prisma.InputJsonValue,
          },
        });
      }
    }
    await this.updateIntegration("HELP_CENTER", {
      state: "HEALTHY",
      message: `已同步FAQ ${groups[0][1].length}、教程 ${groups[1][1].length}、资料 ${groups[2][1].length}`,
      capabilities: ["search"],
    });
    return { faqs: groups[0][1].length, tutorials: groups[1][1].length, resources: groups[2][1].length };
  }

  async importBootstrap(): Promise<{ evidence: number; mappings: number; phraseRules: number; assetSeeds: number; sopTasks: number }> {
    const load = async (name: string): Promise<BootstrapRow[]> => {
      const path = resolve(opsConfig.bootstrapDataDir, name);
      try {
        const parsed = JSON.parse(await readFile(path, "utf8"));
        return Array.isArray(parsed) ? parsed.map(safeJson) : [];
      } catch {
        return [];
      }
    };
    const [evidence, mappings, phraseRules, assetSeeds, sopTasks] = await Promise.all([
      load("evidence.json"),
      load("product-mappings.json"),
      load("phrase-rules.json"),
      load("asset-seeds.json"),
      load("asset-sop-tasks.json"),
    ]);
    for (const row of evidence) {
      const id = stringValue(row.id);
      if (!id) continue;
      await this.prisma.evidenceClaim.upsert({
        where: { id },
        create: {
          id,
          name: stringValue(row.name),
          evidenceType: stringValue(row.evidenceType) || "资料",
          source: stringValue(row.source),
          entityIdentifier: stringValue(row.entityIdentifier) || undefined,
          coveredObject: stringValue(row.coveredObject) || undefined,
          validFrom: toDate(row.validFrom),
          validUntil: toDate(row.validUntil),
          confirmedFact: stringValue(row.confirmedFact) || undefined,
          publicWording: stringValue(row.publicWording) || undefined,
          internalRestriction: stringValue(row.internalRestriction) || undefined,
          status: recordStatus(row.status),
          raw: row as Prisma.InputJsonValue,
        },
        update: {
          name: stringValue(row.name), source: stringValue(row.source), entityIdentifier: stringValue(row.entityIdentifier) || undefined,
          coveredObject: stringValue(row.coveredObject) || undefined, validFrom: toDate(row.validFrom), validUntil: toDate(row.validUntil),
          confirmedFact: stringValue(row.confirmedFact) || undefined, publicWording: stringValue(row.publicWording) || undefined,
          internalRestriction: stringValue(row.internalRestriction) || undefined, status: recordStatus(row.status), raw: row as Prisma.InputJsonValue,
        },
      });
    }
    for (const row of mappings) {
      const name = stringValue(row.commercialName);
      if (!name) continue;
      await this.prisma.productMapping.upsert({
        where: { commercialName: name },
        create: {
          commercialName: name, pageFacts: stringValue(row.pageFacts) || undefined, nameplateModel: stringValue(row.nameplateModel) || undefined,
          registeredModel: stringValue(row.registeredModel) || undefined, registrationNumber: stringValue(row.registrationNumber) || undefined,
          productionRelation: stringValue(row.productionRelation) || undefined, status: recordStatus(row.status),
          requiredAction: stringValue(row.requiredAction) || undefined, raw: row as Prisma.InputJsonValue,
        },
        update: {
          pageFacts: stringValue(row.pageFacts) || undefined, nameplateModel: stringValue(row.nameplateModel) || undefined,
          registeredModel: stringValue(row.registeredModel) || undefined, registrationNumber: stringValue(row.registrationNumber) || undefined,
          productionRelation: stringValue(row.productionRelation) || undefined, status: recordStatus(row.status),
          requiredAction: stringValue(row.requiredAction) || undefined, raw: row as Prisma.InputJsonValue,
        },
      });
    }
    for (const row of phraseRules) {
      const category = stringValue(row.category);
      const blockedText = stringValue(row.blockedText);
      if (!category || !blockedText) continue;
      await this.prisma.phraseRule.upsert({
        where: { category_blockedText: { category, blockedText } },
        create: { category, blockedText, replacement: stringValue(row.replacement) || undefined, condition: stringValue(row.condition) || undefined },
        update: { replacement: stringValue(row.replacement) || undefined, condition: stringValue(row.condition) || undefined, active: true },
      });
    }
    for (const row of sopTasks) {
      const title = stringValue(row.task || row.category);
      if (!title || title === "……") continue;
      const existing = await this.prisma.opsTask.findFirst({ where: { category: "素材库SOP", title } });
      if (!existing) {
        await this.prisma.opsTask.create({
          data: {
            title,
            category: "素材库SOP",
            priority: "中",
            owner: stringValue(row.owner) || undefined,
            result: stringValue(row.standard) || undefined,
            sourceType: "EVIDENCE_WORKBOOK",
          },
        });
      }
    }
    await this.updateIntegration("EVIDENCE_WORKBOOK", {
      state: evidence.length ? "HEALTHY" : "DEGRADED",
      message: evidence.length ? `已导入证据${evidence.length}条、型号${mappings.length}条、词库${phraseRules.length}条` : "引导数据尚未生成",
      capabilities: ["search"],
    });
    return { evidence: evidence.length, mappings: mappings.length, phraseRules: phraseRules.length, assetSeeds: assetSeeds.length, sopTasks: sopTasks.length };
  }
}
