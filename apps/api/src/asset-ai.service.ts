import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { AssetJobStatus, AssetJobType, AssetKind, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import sharp from "sharp";
import { CloudMediaService } from "./cloud-media.service";
import { opsConfig } from "./config";
import { OssStorageService } from "./oss-storage.service";
import { PrismaService } from "./prisma.service";

const execFileAsync = promisify(execFile);
const localJobs: AssetJobType[] = ["TECHNICAL_METADATA", "THUMBNAIL", "NEAR_DUPLICATE"];
const imageAiJobs: AssetJobType[] = ["OCR", "CONTENT_UNDERSTANDING", "TAGGING"];
const videoJobs: AssetJobType[] = ["PROXY_VIDEO", "KEYFRAMES", "SCENE_SEGMENTATION", "TRANSCRIPTION", "CONTENT_UNDERSTANDING", "TAGGING"];
const retryMinutes = [1, 5, 30];

type JsonRecord = Record<string, unknown>;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function hamming(left: string, right: string): number {
  if (!left || left.length !== right.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) distance += 1;
  return distance;
}

@Injectable()
export class AssetAiService {
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly oss: OssStorageService,
    private readonly cloudMedia: CloudMediaService,
  ) {}

  capabilities() {
    const bailianConfigured = Boolean(opsConfig.bailian.apiKey && opsConfig.bailian.baseUrl && opsConfig.bailian.visionModel);
    const transcriptionConfigured = Boolean(opsConfig.bailian.apiKey && opsConfig.bailian.transcriptionUrl && opsConfig.bailian.transcriptionModel);
    return {
      provider: "阿里云百炼",
      state: bailianConfigured ? "CONFIGURED" : "UNCONFIGURED",
      message: bailianConfigured ? "百炼多模态能力已配置，等待任务实测" : "未配置 BAILIAN_API_KEY，多模态识别保持未配置",
      capabilities: {
        technicalMetadata: { state: "AVAILABLE", provider: "Sharp/FFprobe" },
        thumbnail: { state: "AVAILABLE", provider: "Sharp/FFmpeg" },
        nearDuplicate: { state: "AVAILABLE", provider: "感知哈希" },
        imageUnderstanding: { state: bailianConfigured ? "CONFIGURED" : "UNCONFIGURED", model: opsConfig.bailian.visionModel },
        ocr: { state: bailianConfigured ? "CONFIGURED" : "UNCONFIGURED", model: opsConfig.bailian.visionModel },
        transcription: { state: transcriptionConfigured ? "CONFIGURED" : "UNCONFIGURED", model: opsConfig.bailian.transcriptionModel || "未配置" },
        sceneSegmentation: opsConfig.ims.mode === "cloud"
          ? this.cloudMedia.capabilities().ims.segmentation
          : { state: "AVAILABLE", provider: "FFmpeg" },
      },
      cloudMedia: this.cloudMedia.capabilities(),
      checkedAt: new Date().toISOString(),
    };
  }

  async suggestUploadMetadata(input: JsonRecord) {
    const files = (Array.isArray(input.files) ? input.files : [])
      .map((item) => item && typeof item === "object" ? item as JsonRecord : {})
      .map((item) => ({ name: text(item.name), type: text(item.type), size: Number(item.size || 0) }))
      .filter((item) => item.name)
      .slice(0, 20);
    const products = await this.prisma.product.findMany({
      where: { status: "READY" },
      select: { id: true, modelCode: true, name: true },
      orderBy: { modelCode: "asc" },
    });
    const fileText = files.map((item) => `${item.name} ${item.type}`).join(" ");
    const matchedProducts = products.filter((product) => {
      const terms = [product.modelCode, product.name].map((value) => text(value).toLowerCase()).filter((value) => value.length >= 2);
      return terms.some((term) => fileText.toLowerCase().includes(term));
    });
    const inferredKinds = new Set(files.map((file) => {
      const value = `${file.type} ${file.name}`.toLowerCase();
      if (value.includes("image/") || /\.(jpe?g|png|webp|gif|bmp)$/u.test(value)) return "IMAGE";
      if (value.includes("video/") || /\.(mp4|mov|mkv|webm|avi)$/u.test(value)) return "VIDEO";
      if (value.includes("audio/") || /\.(mp3|wav|m4a|aac)$/u.test(value)) return "AUDIO";
      return "DOCUMENT";
    }));
    const localSuggestion: JsonRecord = {
      assetKind: inferredKinds.size === 1 ? [...inferredKinds][0] : undefined,
      productScope: matchedProducts.length ? "MODEL" : "UNKNOWN",
      productIds: matchedProducts.map((product) => product.id),
      contentDescription: files.length === 1
        ? files[0].name.replace(/\.[^.]+$/u, "").replaceAll(/[_-]+/gu, " ").trim()
        : `${files.length}个素材文件`,
      sourceType: "EMPLOYEE_CAPTURE",
      originalStatus: true,
      rightsStatus: "COMMERCIAL",
    };
    if (!opsConfig.bailian.apiKey || !opsConfig.bailian.baseUrl || !opsConfig.bailian.visionModel || !files.length) {
      return {
        provider: "LOCAL_RULES",
        state: "UNCONFIGURED",
        message: "已按文件名和格式辅助填写；百炼未配置，未执行AI内容识别",
        suggestions: localSuggestion,
      };
    }
    const response = await fetch(`${opsConfig.bailian.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${opsConfig.bailian.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: opsConfig.bailian.visionModel,
        messages: [{
          role: "user",
          content: `根据文件名为赛电员工上传素材预填元数据。只返回JSON：{"assetKind":"IMAGE|VIDEO|AUDIO|DOCUMENT","productIds":[],"contentDescription":"简短中文说明"}。产品只能从清单选择，不要编造。文件：${JSON.stringify(files)}。产品清单：${JSON.stringify(products)}`,
        }],
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) {
      return {
        provider: "LOCAL_RULES",
        state: "FAILED",
        message: `AI辅助填写失败（${response.status}），已使用本地规则预填`,
        suggestions: localSuggestion,
      };
    }
    const payload = await response.json() as JsonRecord;
    const rawContent = text(((payload.choices as Array<JsonRecord> | undefined)?.[0]?.message as JsonRecord | undefined)?.content);
    let aiSuggestion: JsonRecord = {};
    try {
      aiSuggestion = rawContent ? JSON.parse(rawContent) as JsonRecord : {};
    } catch {
      aiSuggestion = {};
    }
    const validProductIds = new Set(products.map((product) => product.id));
    const productIds = (Array.isArray(aiSuggestion.productIds) ? aiSuggestion.productIds : [])
      .map(text)
      .filter((id) => validProductIds.has(id));
    const assetKind = ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"].includes(text(aiSuggestion.assetKind).toUpperCase())
      ? text(aiSuggestion.assetKind).toUpperCase()
      : localSuggestion.assetKind;
    return {
      provider: "ALIYUN_BAILIAN",
      state: "AVAILABLE",
      message: "AI已完成上传信息预填，请确认后上传",
      suggestions: {
        ...localSuggestion,
        assetKind,
        productIds: productIds.length ? productIds : localSuggestion.productIds,
        productScope: (productIds.length || matchedProducts.length) ? "MODEL" : "UNKNOWN",
        contentDescription: text(aiSuggestion.contentDescription) || localSuggestion.contentDescription,
      },
    };
  }

  async materializeSegment(assetId: string, segmentId: string, actor: string, employeeId?: string) {
    const segment = await this.prisma.assetSegment.findFirst({
      where: { id: segmentId, assetId },
      include: { asset: { include: { products: true } } },
    });
    if (!segment) throw new Error("视频片段不存在");
    if (segment.materializedAssetId) return this.prisma.asset.findUnique({ where: { id: segment.materializedAssetId } });
    if (segment.endSeconds <= segment.startSeconds) throw new Error("视频片段时间范围无效");
    return this.withLocalCopy(segment.asset as unknown as JsonRecord, async (path) => {
      const target = `${path}.segment.mp4`;
      await execFileAsync("ffmpeg", ["-y", "-ss", String(segment.startSeconds), "-i", path, "-t", String(segment.endSeconds - segment.startSeconds), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "128k", target], { maxBuffer: 16 * 1024 * 1024 });
      const buffer = await readFile(target);
      const hash = createHash("sha256").update(buffer).digest("hex");
      const existing = await this.prisma.asset.findFirst({ where: { sha256: hash }, orderBy: { createdAt: "asc" } });
      if (existing) {
        await this.prisma.assetSegment.update({ where: { id: segment.id }, data: { materializedAssetId: existing.id, status: "MATERIALIZED", locked: true } });
        return existing;
      }
      const publicNo = `SD-VIDEO-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const objectKey = this.oss.derivedObjectKey(segment.asset.id, text(segment.moduleType || "module"), 1, hash, ".mp4");
      const stored = await this.oss.uploadGeneratedBuffer({ objectKey, buffer, actor, sourceType: "AI_DERIVED", sha256: hash, originalName: `${publicNo}.mp4` });
      const batch = await this.prisma.uploadBatch.create({ data: { batchNo: `UP-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`, status: "COMPLETED", sourceType: "AI_DERIVED", productScope: segment.asset.productScope, productIds: segment.asset.products.map((item) => item.productId), assetKind: "VIDEO", contentDescription: `由 ${segment.asset.assetNo || segment.asset.id} ${segment.startSeconds}-${segment.endSeconds} 秒生成`, originalStatus: false, rightsStatus: segment.asset.rightsStatus, uploadedByEmployeeId: employeeId, uploadedBy: actor, receivedCount: 1, createdCount: 1, completedAt: new Date() } });
      const created = await this.prisma.asset.create({
        data: {
          sourceKey: `AI_DERIVED:${hash}`, sourceType: "AI_DERIVED", sourcePath: `oss://${objectKey}`,
          fileName: `${publicNo}.mp4`, originalFileName: segment.asset.originalFileName || segment.asset.fileName, extension: ".mp4", mediaType: "VIDEO", kind: "VIDEO",
          assetNo: publicNo, displayName: `${segment.asset.displayName || segment.asset.fileName}-${segment.moduleType || "片段"}`,
          level: "MODULE", productScope: segment.asset.productScope, processingStatus: "READY_FOR_REVIEW", reviewStatus: "PENDING", availabilityStatus: "INACTIVE", rightsStatus: segment.asset.rightsStatus,
          sha256: hash, sizeBytes: buffer.length, modifiedAt: new Date(), durationSeconds: segment.endSeconds - segment.startSeconds,
          status: "PENDING", qualityScore: segment.asset.qualityScore, contentDescription: segment.transcript || undefined, isOriginal: false,
          sourceSnapshot: { sourceAssetId: segment.asset.id, sourceSegmentId: segment.id, startSeconds: segment.startSeconds, endSeconds: segment.endSeconds, analysisVersion: segment.analysisVersion },
          storageProvider: "ALIYUN_OSS", objectKey, objectVersionId: stored.objectVersionId, etag: stored.etag, storageUrl: stored.storageUrl, storageSyncedAt: stored.uploadedAt,
          discoveredBy: actor, createdByEmployeeId: employeeId,
          versions: { create: { version: 1, sha256: hash, sourcePath: `oss://${objectKey}`, objectKey, objectVersionId: stored.objectVersionId, etag: stored.etag, storageUrl: stored.storageUrl, createdByEmployeeId: employeeId, createdBy: actor, originalFileName: segment.asset.originalFileName || segment.asset.fileName, mimeType: "video/mp4", extension: ".mp4", sizeBytes: buffer.length, durationSeconds: segment.endSeconds - segment.startSeconds } },
          products: { create: segment.asset.products.map((item) => ({ productId: item.productId, scope: item.scope, confidence: item.confidence, confirmed: item.confirmed })) },
          uploadEvents: { create: { uploadBatchId: batch.id, uploadedByEmployeeId: employeeId, originalFileName: `${publicNo}.mp4`, sha256: hash, sizeBytes: buffer.length, result: "CREATED" } },
        },
      });
      await this.prisma.$transaction([
        this.prisma.assetRelation.create({ data: { parentAssetId: segment.asset.id, childAssetId: created.id, type: "SEGMENT_OF", metadata: { startSeconds: segment.startSeconds, endSeconds: segment.endSeconds, analysisVersion: segment.analysisVersion }, createdBy: actor } }),
        this.prisma.assetSegment.update({ where: { id: segment.id }, data: { materializedAssetId: created.id, status: "MATERIALIZED", locked: true } }),
      ]);
      return created;
    });
  }

  async enqueue(assetId: string, kind: AssetKind, analysisVersion: number) {
    if (kind === "VIDEO" && opsConfig.ims.mode === "cloud") {
      return this.cloudMedia.enqueueAssetVideo(assetId, analysisVersion);
    }
    const types = [...localJobs, ...(kind === "IMAGE" ? imageAiJobs : []), ...(kind === "VIDEO" ? videoJobs : [])];
    const capabilities = this.capabilities();
    for (const type of types) {
      const provider = this.providerFor(type);
      const modelVersion = `${provider}:${analysisVersion}`;
      await this.prisma.assetAnalysisJob.upsert({
        where: { assetId_type_modelVersion: { assetId, type, modelVersion } },
        update: { status: "PENDING", attempts: 0, nextAttemptAt: null, failureReason: null, result: {}, model: this.modelFor(type) },
        create: { assetId, type, provider, model: this.modelFor(type), modelVersion, status: "PENDING" },
      });
    }
    await this.prisma.asset.update({ where: { id: assetId }, data: { processingStatus: "ANALYZING", analysisVersion } });
    void this.processPending();
    return capabilities;
  }

  @Cron("*/1 * * * *")
  async processPending() {
    if (this.processing) return;
    this.processing = true;
    try {
      const now = new Date();
      const jobs = await this.prisma.assetAnalysisJob.findMany({
        where: { status: { in: ["PENDING", "RETRY"] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        orderBy: { createdAt: "asc" },
        take: 4,
      });
      for (const job of jobs) await this.runJob(job.id);
    } finally {
      this.processing = false;
    }
  }

  private async runJob(jobId: string) {
    const job = await this.prisma.assetAnalysisJob.findUnique({ where: { id: jobId }, include: { asset: true } });
    if (!job || !["PENDING", "RETRY"].includes(job.status)) return;
    const attempts = job.attempts + 1;
    await this.prisma.assetAnalysisJob.update({ where: { id: job.id }, data: { status: "RUNNING", attempts, startedAt: new Date(), failureReason: null } });
    try {
      if (this.requiresBailian(job.type) && !opsConfig.bailian.apiKey) {
        await this.finish(job.id, "UNCONFIGURED", {}, "百炼接口未配置");
      } else if (job.type === "TRANSCRIPTION" && (!opsConfig.bailian.transcriptionUrl || !opsConfig.bailian.transcriptionModel)) {
        await this.finish(job.id, "UNCONFIGURED", {}, "百炼语音转写地址或模型未配置");
      } else {
        const result = await this.execute(job.type, job.asset as unknown as JsonRecord);
        await this.finish(job.id, "SUCCEEDED", result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI处理失败";
      if (attempts >= job.maxAttempts) await this.finish(job.id, "FAILED", {}, message);
      else {
        const delay = retryMinutes[Math.min(attempts - 1, retryMinutes.length - 1)];
        await this.prisma.assetAnalysisJob.update({
          where: { id: job.id },
          data: { status: "RETRY", failureReason: message, nextAttemptAt: new Date(Date.now() + delay * 60_000), finishedAt: new Date() },
        });
      }
    }
    await this.refreshAssetProcessing(job.assetId);
  }

  private async finish(id: string, status: AssetJobStatus, result: unknown, failureReason?: string) {
    await this.prisma.assetAnalysisJob.update({
      where: { id },
      data: { status, result: json(result), failureReason, nextAttemptAt: null, finishedAt: new Date() },
    });
  }

  private async refreshAssetProcessing(assetId: string) {
    const jobs = await this.prisma.assetAnalysisJob.findMany({ where: { assetId }, select: { status: true } });
    if (jobs.some((item) => ["PENDING", "RUNNING", "RETRY"].includes(item.status))) return;
    const failed = jobs.some((item) => item.status === "FAILED");
    await this.prisma.asset.update({
      where: { id: assetId },
      data: { processingStatus: failed ? "FAILED" : "READY_FOR_REVIEW", lastAnalysisAt: new Date() },
    });
  }

  private providerFor(type: AssetJobType): string {
    if (["TECHNICAL_METADATA", "THUMBNAIL"].includes(type)) return "LOCAL_MEDIA";
    if (["PROXY_VIDEO", "KEYFRAMES", "SCENE_SEGMENTATION"].includes(type)) return "FFMPEG";
    if (type === "NEAR_DUPLICATE") return "PERCEPTUAL_HASH";
    return "ALIYUN_BAILIAN";
  }

  private modelFor(type: AssetJobType): string | undefined {
    if (type === "TRANSCRIPTION") return opsConfig.bailian.transcriptionModel || undefined;
    if (this.requiresBailian(type)) return opsConfig.bailian.visionModel;
    return undefined;
  }

  private requiresBailian(type: AssetJobType): boolean {
    return ["OCR", "TRANSCRIPTION", "CONTENT_UNDERSTANDING", "TAGGING"].includes(type);
  }

  private async execute(type: AssetJobType, asset: JsonRecord): Promise<JsonRecord> {
    if (type === "TECHNICAL_METADATA") return this.technicalMetadata(asset);
    if (type === "THUMBNAIL") return this.thumbnail(asset);
    if (type === "PROXY_VIDEO") return this.proxyVideo(asset);
    if (type === "KEYFRAMES") return this.keyframes(asset);
    if (type === "SCENE_SEGMENTATION") return this.sceneSegmentation(asset);
    if (type === "NEAR_DUPLICATE") return this.nearDuplicate(asset);
    if (type === "TRANSCRIPTION") return this.transcription(asset);
    return this.bailianVision(type, asset);
  }

  private async withLocalCopy<T>(asset: JsonRecord, task: (path: string) => Promise<T>): Promise<T> {
    const objectKey = text(asset.objectKey);
    if (!objectKey) throw new Error("素材尚未存入 OSS");
    const workDir = await mkdtemp(join(tmpdir(), "saidian-asset-"));
    const target = join(workDir, `source${text(asset.extension) || ".bin"}`);
    try {
      const response = await fetch(this.oss.signedDownloadUrl(objectKey));
      if (!response.ok || !response.body) throw new Error(`OSS文件读取失败：${response.status}`);
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(target));
      return await task(target);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async technicalMetadata(asset: JsonRecord) {
    const kind = text(asset.kind || asset.mediaType) as AssetKind;
    if (kind === "IMAGE") {
      return this.withLocalCopy(asset, async (path) => {
        const metadata = await sharp(path).metadata();
        const hash = await this.imageHash(path);
        const width = metadata.width ?? null;
        const height = metadata.height ?? null;
        await this.prisma.asset.update({
          where: { id: text(asset.id) },
          data: { width, height, aspectRatio: width && height ? `${width}:${height}` : null, perceptualHash: hash, qualityScore: width && height && Math.min(width, height) >= 1080 ? 90 : 70 },
        });
        await this.prisma.assetVersion.updateMany({ where: { assetId: text(asset.id), version: 1 }, data: { width, height, technicalMetadata: json(metadata) } });
        return { width, height, format: metadata.format, perceptualHash: hash };
      });
    }
    if (kind === "VIDEO" || kind === "AUDIO") {
      return this.withLocalCopy(asset, async (path) => {
        const { stdout } = await execFileAsync("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", path], { maxBuffer: 8 * 1024 * 1024 });
        const data = JSON.parse(stdout) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
        const video = data.streams?.find((stream) => stream.codec_type === "video");
        const width = Number(video?.width || 0) || null;
        const height = Number(video?.height || 0) || null;
        const duration = Number(data.format?.duration || video?.duration || 0) || null;
        await this.prisma.asset.update({ where: { id: text(asset.id) }, data: { width, height, durationSeconds: duration, aspectRatio: width && height ? `${width}:${height}` : null } });
        await this.prisma.assetVersion.updateMany({ where: { assetId: text(asset.id), version: 1 }, data: { width, height, durationSeconds: duration, codec: text(video?.codec_name) || null, technicalMetadata: json(data) } });
        return { width, height, durationSeconds: duration, codec: video?.codec_name ?? null };
      });
    }
    return { fileType: "DOCUMENT", message: "文档保留原始技术信息" };
  }

  private async imageHash(path: string | Buffer): Promise<string> {
    const pixels = await sharp(path).resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer();
    let bits = "";
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) bits += pixels[row * 9 + column] > pixels[row * 9 + column + 1] ? "1" : "0";
    }
    return bits;
  }

  private async thumbnail(asset: JsonRecord) {
    const kind = text(asset.kind || asset.mediaType);
    if (!this.oss.isConfigured()) throw new Error("OSS未配置，无法保存预览文件");
    return this.withLocalCopy(asset, async (path) => {
      let buffer: Buffer;
      if (kind === "IMAGE") buffer = await sharp(path).rotate().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      else if (kind === "VIDEO") {
        const target = `${path}.jpg`;
        await execFileAsync("ffmpeg", ["-y", "-ss", "0.5", "-i", path, "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", target], { maxBuffer: 8 * 1024 * 1024 });
        buffer = await readFile(target);
      } else return { skipped: true, reason: "该文件类型不生成缩略图" };
      const hash = createHash("sha256").update(buffer).digest("hex");
      const objectKey = this.oss.previewObjectKey(text(asset.id), 1, "thumbnail.jpg");
      const stored = await this.oss.uploadGeneratedBuffer({ objectKey, buffer, actor: "系统素材处理", sourceType: "ASSET_PREVIEW", sha256: hash, originalName: "thumbnail.jpg" });
      await this.prisma.assetVersion.updateMany({ where: { assetId: text(asset.id), version: 1 }, data: { previewObjectKey: objectKey, previewUrl: stored.storageUrl } });
      if (kind === "VIDEO") {
        const perceptualHash = await this.imageHash(buffer).catch(() => "");
        if (perceptualHash) await this.prisma.asset.update({ where: { id: text(asset.id) }, data: { perceptualHash } });
      }
      return { objectKey, storageUrl: stored.storageUrl, sha256: hash };
    });
  }

  private async proxyVideo(asset: JsonRecord) {
    if (text(asset.kind || asset.mediaType) !== "VIDEO") return { skipped: true };
    return this.withLocalCopy(asset, async (path) => {
      const target = `${path}.proxy.mp4`;
      await execFileAsync("ffmpeg", ["-y", "-i", path, "-vf", "scale='min(720,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k", target], { maxBuffer: 16 * 1024 * 1024 });
      const buffer = await readFile(target);
      const hash = createHash("sha256").update(buffer).digest("hex");
      const objectKey = this.oss.previewObjectKey(text(asset.id), 1, "proxy.mp4");
      const stored = await this.oss.uploadGeneratedBuffer({ objectKey, buffer, actor: "系统素材处理", sourceType: "ASSET_PROXY", sha256: hash, originalName: "proxy.mp4" });
      return { objectKey, storageUrl: stored.storageUrl, sizeBytes: buffer.length };
    });
  }

  private async keyframes(asset: JsonRecord) {
    if (text(asset.kind || asset.mediaType) !== "VIDEO") return { skipped: true };
    return this.withLocalCopy(asset, async (path) => {
      const target = `${path}.keyframe.jpg`;
      await execFileAsync("ffmpeg", ["-y", "-ss", "1", "-i", path, "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", target], { maxBuffer: 8 * 1024 * 1024 });
      const buffer = await readFile(target);
      const hash = createHash("sha256").update(buffer).digest("hex");
      const objectKey = this.oss.analysisObjectKey(text(asset.id), Number(asset.analysisVersion || 1), "keyframe-0001.jpg");
      await this.oss.uploadGeneratedBuffer({ objectKey, buffer, actor: "系统素材处理", sourceType: "KEYFRAME", sha256: hash, originalName: "keyframe-0001.jpg" });
      return { keyframes: [{ second: 1, objectKey }] };
    });
  }

  private async sceneSegmentation(asset: JsonRecord) {
    if (text(asset.kind || asset.mediaType) !== "VIDEO") return { skipped: true };
    return this.withLocalCopy(asset, async (path) => {
      let duration = Number(asset.durationSeconds || 0);
      if (!duration) {
        const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path]);
        duration = Number(stdout.trim()) || 0;
      }
      const { stderr } = await execFileAsync("ffmpeg", ["-i", path, "-vf", "select=gt(scene\\,0.35),showinfo", "-f", "null", "-"], { maxBuffer: 32 * 1024 * 1024 }).catch((error: { stderr?: string }) => ({ stdout: "", stderr: error.stderr || "" }));
      const times = Array.from(String(stderr).matchAll(/pts_time:([0-9.]+)/gu)).map((match) => Number(match[1])).filter((value) => value > 0 && value < duration);
      const boundaries = [0, ...Array.from(new Set(times.map((value) => Number(value.toFixed(3))))), duration].sort((a, b) => a - b);
      const segments = boundaries.slice(0, -1).map((start, index) => ({ start, end: boundaries[index + 1] })).filter((item) => item.end - item.start >= 0.4).slice(0, 80);
      await this.prisma.assetSegment.deleteMany({ where: { assetId: text(asset.id), locked: false } });
      if (segments.length) await this.prisma.assetSegment.createMany({ data: segments.map((segment) => ({ assetId: text(asset.id), startSeconds: segment.start, endSeconds: segment.end, analysisVersion: Number(asset.analysisVersion || 1), createdBy: "FFmpeg场景切分" })) });
      return { durationSeconds: duration, segments };
    });
  }

  private async nearDuplicate(asset: JsonRecord) {
    const current = await this.prisma.asset.findUnique({ where: { id: text(asset.id) } });
    if (!current?.perceptualHash) return { candidates: [], reason: "感知哈希尚未生成" };
    const candidates = await this.prisma.asset.findMany({ where: { id: { not: current.id }, kind: current.kind, perceptualHash: { not: null } }, select: { id: true, assetNo: true, perceptualHash: true }, take: 500 });
    const matches = candidates.map((candidate) => ({ ...candidate, distance: hamming(current.perceptualHash!, candidate.perceptualHash!) })).filter((candidate) => candidate.distance <= 8).sort((a, b) => a.distance - b.distance).slice(0, 20);
    for (const candidate of matches) {
      await this.prisma.assetRelation.upsert({
        where: { parentAssetId_childAssetId_type: { parentAssetId: candidate.id, childAssetId: current.id, type: "NEAR_DUPLICATE" } },
        update: { score: 1 - candidate.distance / current.perceptualHash.length },
        create: { parentAssetId: candidate.id, childAssetId: current.id, type: "NEAR_DUPLICATE", score: 1 - candidate.distance / current.perceptualHash.length, createdBy: "感知哈希检测" },
      });
    }
    return { candidates: matches.map((item) => ({ assetId: item.id, assetNo: item.assetNo, distance: item.distance })) };
  }

  private async bailianVision(type: AssetJobType, asset: JsonRecord) {
    const objectKey = text(asset.objectKey);
    if (!objectKey) throw new Error("素材缺少OSS对象");
    const prompt = type === "OCR"
      ? "识别图片中的全部文字。返回JSON：{text,language,blocks:[{text,position}]}. 不要添加解释。"
      : "分析赛电品牌素材。返回JSON：{summary,products,people,scenes,features,painPoints,audiences,platforms,moduleSuggestion,tags,riskWords}. 只返回JSON。";
    const response = await fetch(`${opsConfig.bailian.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${opsConfig.bailian.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: opsConfig.bailian.visionModel, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: this.oss.signedDownloadUrl(objectKey, 3600) } }, { type: "text", text: prompt }] }], response_format: { type: "json_object" } }),
    });
    if (!response.ok) throw new Error(`百炼调用失败：${response.status} ${await response.text()}`);
    const payload = await response.json() as JsonRecord;
    const rawContent = text(((payload.choices as Array<JsonRecord> | undefined)?.[0]?.message as JsonRecord | undefined)?.content);
    const result = rawContent ? JSON.parse(rawContent) as JsonRecord : payload;
    if (type === "CONTENT_UNDERSTANDING" || type === "TAGGING") await this.applyAiResult(text(asset.id), result);
    return result;
  }

  private async applyAiResult(assetId: string, result: JsonRecord) {
    const tags = ["scenes", "features", "painPoints", "audiences", "platforms", "tags"].flatMap((namespace) => {
      const values = Array.isArray(result[namespace]) ? result[namespace] as unknown[] : [];
      return values.map((value) => ({ namespace, label: text(value) })).filter((item) => item.label);
    });
    for (const item of tags) {
      const code = item.label.toLowerCase().replace(/\s+/gu, "-").slice(0, 80);
      const tag = await this.prisma.tagDefinition.upsert({ where: { namespace_code: { namespace: item.namespace, code } }, update: { label: item.label }, create: { namespace: item.namespace, code, label: item.label } });
      const existing = await this.prisma.assetTag.findUnique({ where: { assetId_tagId: { assetId, tagId: tag.id } } });
      if (!existing?.locked) await this.prisma.assetTag.upsert({ where: { assetId_tagId: { assetId, tagId: tag.id } }, update: { source: "AI", confidence: 0.8, modelVersion: opsConfig.bailian.visionModel }, create: { assetId, tagId: tag.id, source: "AI", confidence: 0.8, modelVersion: opsConfig.bailian.visionModel, createdBy: "阿里云百炼" } });
    }
    await this.prisma.asset.update({ where: { id: assetId }, data: { contentDescription: text(result.summary) || undefined } });
  }

  private async transcription(asset: JsonRecord) {
    const response = await fetch(opsConfig.bailian.transcriptionUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${opsConfig.bailian.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: opsConfig.bailian.transcriptionModel, audio_url: this.oss.signedDownloadUrl(text(asset.objectKey), 3600), timestamps: true }),
    });
    if (!response.ok) throw new Error(`语音转写调用失败：${response.status} ${await response.text()}`);
    return await response.json() as JsonRecord;
  }
}
