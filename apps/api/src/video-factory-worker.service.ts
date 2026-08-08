import { BadRequestException, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JobStatus, Prisma } from "@prisma/client";
import { exec, execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { opsConfig } from "./config";
import { decryptIntegrationValue } from "./integration-secret";
import { OssStorageService } from "./oss-storage.service";
import { PrismaService } from "./prisma.service";
import { videoFactoryModule, VideoFactoryService } from "./video-factory.service";
import { inspectVideoBuffer, validateVideoMasterMetadata } from "./video-output-validation";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

type JsonRow = Record<string, unknown>;

function object(value: unknown): JsonRow {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRow : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function statusValue(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function srtTime(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1_000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1_000);
  const ms = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function ffmpegFilterPath(path: string) {
  return path.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'");
}

function providerFailureMessage(message: string) {
  if (/account balance not enough/i.test(message)) return "视频模型账户余额不足，请充值或切换备用模型";
  if (/quota|rate limit/i.test(message)) return "视频模型额度或调用频率已达上限，请稍后重试或切换备用模型";
  return message;
}

export function usesConfiguredVideoRenderer(plan: { sourceSignals: unknown }) {
  return videoFactoryModule(plan) !== "DOUYIN_VIRAL";
}

export function wrapVideoSubtitle(value: unknown, maxCharsPerLine = 14) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (!text) return "";
  const maximum = Math.max(8, maxCharsPerLine) * 2;
  const characters = Array.from(text);
  const limited = characters.length > maximum
    ? [...characters.slice(0, maximum - 1), "…"]
    : characters;
  if (limited.length <= maxCharsPerLine) return limited.join("");
  const splitAt = Math.min(maxCharsPerLine, Math.ceil(limited.length / 2));
  return `${limited.slice(0, splitAt).join("")}\n${limited.slice(splitAt).join("")}`;
}

export function videoRenderCaptionTexts(plan: {
  sourceSignals: unknown;
  hook: unknown;
  objective: unknown;
  outline: unknown;
  videoShots: Array<{ description: unknown }>;
}) {
  const signals = Array.isArray(plan.sourceSignals) ? plan.sourceSignals.map(object) : [];
  const factory = signals.find((item) => item.type === "VIDEO_FACTORY") || {};
  const candidates = Array.isArray(factory.scriptCandidates) ? factory.scriptCandidates.map(object) : [];
  const selectedIndex = Math.max(0, Math.min(candidates.length - 1, Number(factory.selectedCandidateIndex || 0)));
  const selected = candidates[selectedIndex] || {};
  const candidateShots = Array.isArray(selected.shots) ? selected.shots.map(object) : [];
  const packageSubtitles = strings(object(selected.scriptPackage).subtitles);
  const outline = Array.isArray(plan.outline) ? plan.outline.map(String) : [];

  return plan.videoShots.map((shot, index) => {
    const candidateShot = candidateShots[index] || {};
    const concise = String(candidateShot.subtitle || packageSubtitles[index] || candidateShot.voiceover || "").trim();
    const fallback = index === 0
      ? plan.hook
      : index === plan.videoShots.length - 1
        ? plan.objective
        : outline[index] || shot.description;
    return wrapVideoSubtitle(concise || fallback || shot.description);
  });
}

export type VideoTechnicalMetadata = {
  ok: boolean;
  width: number;
  height: number;
  duration: number;
  codec: string;
  frameRate: string;
  error?: string;
};

export function parseVideoTechnicalMetadata(stdout: string): VideoTechnicalMetadata {
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{
      width?: number;
      height?: number;
      duration?: string;
      codec_name?: string;
      avg_frame_rate?: string;
      r_frame_rate?: string;
    }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0] || {};
  return {
    ok: Boolean(stream.width && stream.height),
    width: Number(stream.width || 0),
    height: Number(stream.height || 0),
    duration: Number(stream.duration || parsed.format?.duration || 0),
    codec: String(stream.codec_name || "").trim(),
    frameRate: String(stream.avg_frame_rate || stream.r_frame_rate || "").trim(),
  };
}

type ProviderResult =
  | { state: "RUNNING"; externalJobId: string; response: JsonRow }
  | { state: "SUCCEEDED"; externalJobId?: string; outputUrl?: string; contentUrl?: string; response: JsonRow; cost?: number }
  | { state: "FAILED"; externalJobId?: string; error: string; response: JsonRow };

@Injectable()
export class VideoFactoryWorkerService {
  private readonly logger = new Logger(VideoFactoryWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly factory: VideoFactoryService,
    private readonly oss: OssStorageService,
  ) {}

  async runOnce() {
    await this.factory.ensureCatalog();
    const generation = await this.claimGenerationJob();
    if (generation) {
      await this.processGeneration(generation.id).catch((error) => this.failGeneration(generation.id, error));
      return { kind: "GENERATION", id: generation.id };
    }
    const render = await this.claimRenderJob();
    if (render) {
      await this.processRender(render.id).catch((error) => this.failRender(render.id, error));
      return { kind: "RENDER", id: render.id };
    }
    const running = await this.prisma.videoGenerationJob.findFirst({
      where: { status: "RUNNING", attempts: { some: { status: "RUNNING", externalJobId: { not: null } } } },
      orderBy: { updatedAt: "asc" },
    });
    if (running) {
      await this.pollGeneration(running.id).catch((error) => this.failGeneration(running.id, error));
      return { kind: "GENERATION_POLL", id: running.id };
    }
    return null;
  }

  async handleWebhook(providerCode: string, payload: JsonRow, suppliedSecret: string) {
    const provider = await this.prisma.videoModelProvider.findUnique({ where: { code: providerCode.toUpperCase() } });
    if (!provider?.secretRef) throw new BadRequestException("视频服务商未配置");
    const secret = object(JSON.parse(decryptIntegrationValue(provider.secretRef) || "{}"));
    const expectedSecret = String(secret.webhookSecret || "");
    if (!expectedSecret) throw new BadRequestException("视频服务商未配置Webhook密钥");
    const expectedHash = createHash("sha256").update(expectedSecret).digest("hex");
    const suppliedHash = createHash("sha256").update(suppliedSecret || "").digest("hex");
    if (expectedHash !== suppliedHash) throw new UnauthorizedException("Webhook签名无效");

    const output = object(payload.output);
    const data = object(payload.data);
    const externalJobId = String(
      output.task_id
      || payload.id
      || data.video_id
      || data.task_id
      || payload.task_id
      || "",
    );
    if (!externalJobId) throw new BadRequestException("Webhook缺少任务编号");
    const attempt = await this.prisma.videoGenerationAttempt.findFirst({
      where: { providerId: provider.id, externalJobId },
      orderBy: { attemptNo: "desc" },
    });
    if (!attempt || attempt.status !== "RUNNING") return { accepted: true, ignored: true, reason: "任务已处理或不存在" };

    const status = statusValue(output.task_status || payload.status || data.status || payload.state || payload.event_type);
    const outputUrl = String(
      output.video_url
      || data.video_url
      || data.video_url_caption
      || payload.video_url
      || (Array.isArray(payload.output) ? payload.output[0] : "")
      || "",
    );
    const result: ProviderResult = ["FAILED", "FAILURE", "CANCELED", "CANCELLED", "ERROR"].includes(status)
      ? { state: "FAILED", externalJobId, error: String(output.message || data.error || payload.error || payload.message || "视频生成失败"), response: payload }
      : ["SUCCEEDED", "SUCCESS", "COMPLETED", "DONE"].includes(status) && outputUrl
        ? { state: "SUCCEEDED", externalJobId, outputUrl, response: payload }
        : { state: "RUNNING", externalJobId, response: payload };
    await this.consumeProviderResult(attempt.jobId, attempt.id, result);
    return { accepted: true, state: result.state };
  }

  private async claimGenerationJob() {
    const candidate = await this.prisma.videoGenerationJob.findFirst({
      where: {
        status: { in: ["PENDING", "RETRY"] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return null;
    const claimed = await this.prisma.videoGenerationJob.updateMany({
      where: { id: candidate.id, status: candidate.status },
      data: { status: "RUNNING", startedAt: candidate.startedAt || new Date(), failureReason: null },
    });
    return claimed.count ? candidate : null;
  }

  private async claimRenderJob() {
    const candidate = await this.prisma.videoRenderJob.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) return null;
    const claimed = await this.prisma.videoRenderJob.updateMany({
      where: { id: candidate.id, status: "PENDING" },
      data: { status: "RUNNING", startedAt: new Date(), failureReason: null },
    });
    return claimed.count ? candidate : null;
  }

  private async selectModel(job: Awaited<ReturnType<PrismaService["videoGenerationJob"]["findUnique"]>>) {
    if (!job) throw new Error("生成任务不存在");
    const input = object(job.input);
    const capability = strings(input.auxiliaryImageAssetIds).length ? "IMAGE_TO_VIDEO" : "TEXT_TO_VIDEO";
    const fixed = job.routingMode === "FIXED";
    const scenario = String(
      input.modelScenario
      || (String(input.factoryModule || "").toUpperCase() === "DOUYIN_VIRAL" ? "DOUYIN_VIRAL" : "SCENE"),
    ).toUpperCase();
    const resolved = await this.factory.resolveModel({
      requestedModelId: fixed ? job.requestedModelId : undefined,
      platform: String(input.platform || ""),
      scenario,
      capability,
    });
    let models = [resolved.primary, ...resolved.fallbacks];
    if (fixed && job.allowFallback) {
      const automatic = await this.factory.resolveModel({
        platform: String(input.platform || ""),
        scenario,
        capability,
      });
      models = [
        resolved.primary,
        automatic.primary,
        ...automatic.fallbacks,
      ].filter((model, index, rows) => rows.findIndex((item) => item.id === model.id) === index);
    }
    const next = models[Math.min(job.attemptCount, models.length - 1)];
    if (!next || (job.attemptCount > 0 && (!job.allowFallback || models.length <= job.attemptCount))) {
      throw new Error("可用模型均已尝试，且没有可继续使用的备用模型");
    }
    return next;
  }

  private async processGeneration(id: string) {
    const job = await this.prisma.videoGenerationJob.findUnique({
      where: { id },
      include: { contentPlan: true, shot: true, attempts: true },
    });
    if (!job) throw new Error("生成任务不存在");
    if (job.attemptCount >= job.maxAttempts) throw new Error("生成任务已达到最大重试次数");
    const model = await this.selectModel(job);
    const provider = await this.prisma.videoModelProvider.findUnique({ where: { id: model.providerId } });
    if (!provider || !provider.enabled || !provider.secretRef) throw new Error("视频服务商未配置或已停用");
    const activeAttempts = await this.prisma.videoGenerationAttempt.count({
      where: { providerId: provider.id, status: "RUNNING" },
    });
    if (activeAttempts >= provider.maxConcurrency) {
      await this.prisma.videoGenerationJob.update({
        where: { id: job.id },
        data: { status: "PENDING", nextAttemptAt: new Date(Date.now() + 15_000) },
      });
      return;
    }
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const spent = await this.prisma.videoGenerationAttempt.aggregate({
      where: { providerId: provider.id, status: "SUCCEEDED", startedAt: { gte: dayStart } },
      _sum: { cost: true },
    });
    if (provider.dailyBudget !== null && Number(spent._sum.cost || 0) >= Number(provider.dailyBudget)) {
      const tomorrow = new Date(dayStart);
      tomorrow.setDate(tomorrow.getDate() + 1);
      await this.prisma.videoGenerationJob.update({
        where: { id: job.id },
        data: { status: "PENDING", nextAttemptAt: tomorrow, failureReason: "今日视频模型预算已用完" },
      });
      return;
    }
    const secret = object(JSON.parse(decryptIntegrationValue(provider.secretRef) || "{}"));
    const attemptNo = job.attemptCount + 1;
    const attempt = await this.prisma.videoGenerationAttempt.create({
      data: {
        jobId: job.id,
        providerId: provider.id,
        modelId: model.id,
        attemptNo,
        status: "RUNNING",
        request: { prompt: job.prompt, input: job.input, model: model.code },
        startedAt: new Date(),
      },
    });
    await this.prisma.videoGenerationJob.update({
      where: { id: job.id },
      data: { resolvedModelId: model.id, attemptCount: attemptNo },
    });
    const result = await this.submitProvider(provider, model, secret, job);
    await this.consumeProviderResult(job.id, attempt.id, result);
  }

  private async pollGeneration(id: string) {
    const job = await this.prisma.videoGenerationJob.findUnique({
      where: { id },
      include: {
        contentPlan: true,
        shot: true,
        attempts: { where: { status: "RUNNING", externalJobId: { not: null } }, orderBy: { attemptNo: "desc" }, take: 1, include: { provider: true, model: true } },
      },
    });
    if (!job) throw new Error("生成任务不存在");
    const attempt = job.attempts[0];
    if (!attempt?.externalJobId) throw new Error("生成任务缺少外部任务编号");
    if (!attempt.provider.secretRef) throw new Error("视频服务商密钥不存在");
    const secret = object(JSON.parse(decryptIntegrationValue(attempt.provider.secretRef) || "{}"));
    const result = await this.pollProvider(attempt.provider, attempt.model, secret, attempt.externalJobId);
    await this.consumeProviderResult(job.id, attempt.id, result);
  }

  private authHeaders(providerCode: string, secret: JsonRow): Record<string, string> {
    const apiKey = String(secret.apiKey || "");
    if (providerCode === "HEYGEN") return { "X-Api-Key": apiKey, "Content-Type": "application/json" } satisfies Record<string, string>;
    if (providerCode === "RUNWAY") return { Authorization: `Bearer ${apiKey}`, "X-Runway-Version": "2024-11-06", "Content-Type": "application/json" } satisfies Record<string, string>;
    return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } satisfies Record<string, string>;
  }

  private async referenceUrl(job: { input: unknown; contentPlanId: string }) {
    const input = object(job.input);
    const explicitIds = strings(input.auxiliaryImageAssetIds);
    const asset = explicitIds.length
      ? await this.prisma.asset.findFirst({ where: { id: { in: explicitIds }, kind: "IMAGE", objectKey: { not: null }, reviewStatus: "APPROVED", availabilityStatus: "ACTIVE", rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] } } })
      : await this.prisma.contentPlan.findUnique({ where: { id: job.contentPlanId } }).then(async (plan) => {
        if (!plan?.productModel) return null;
        const product = await this.prisma.product.findUnique({ where: { modelCode: plan.productModel } });
        if (!product) return null;
        return this.prisma.asset.findFirst({
          where: {
            kind: "IMAGE", objectKey: { not: null }, reviewStatus: "APPROVED", availabilityStatus: "ACTIVE",
            rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] }, products: { some: { productId: product.id } },
          },
          orderBy: [{ qualityScore: "desc" }, { updatedAt: "desc" }],
        });
      });
    return asset?.objectKey ? { asset, url: this.oss.signedDownloadUrl(asset.objectKey, 3_600) } : null;
  }

  private async submitProvider(
    provider: { code: string; baseUrl: string | null; publicConfig: unknown },
    model: { code: string; modelConfig: unknown },
    secret: JsonRow,
    job: { id: string; prompt: string; input: unknown; contentPlanId: string },
  ): Promise<ProviderResult> {
    const apiKey = String(secret.apiKey || "");
    if (!apiKey) return { state: "FAILED", error: "API密钥为空", response: {} };
    const input = object(job.input);
    const duration = Number(input.duration || 5);
    const reference = await this.referenceUrl(job);
    const baseUrl = String(provider.baseUrl || "").replace(/\/$/u, "");
    let url = "";
    let body: JsonRow = {};

    if (provider.code === "VOLCENGINE_SEEDANCE") {
      const config = { ...object(provider.publicConfig), ...object(model.modelConfig) };
      url = `${baseUrl}/contents/generations/tasks`;
      body = {
        model: model.code,
        content: [
          { type: "text", text: job.prompt },
          ...(reference ? [{
            type: "image_url",
            image_url: { url: reference.url },
            role: String(config.imageRole || "reference_image"),
          }] : []),
        ],
        resolution: String(input.resolution || config.resolution || "720p").toLowerCase(),
        ratio: String(input.ratio || config.ratio || "9:16"),
        duration: Math.max(4, Math.min(15, duration)),
        generate_audio: config.generateAudio !== false,
        watermark: config.watermark === true,
      };
    } else if (provider.code === "KLING") {
      const config = { ...object(provider.publicConfig), ...object(model.modelConfig) };
      const endpointModel = String(config.endpointModel || "kling-3.0-turbo");
      const settings: JsonRow = {
        resolution: String(input.resolution || config.resolution || "720p").toLowerCase(),
        duration: Math.max(3, Math.min(15, Math.round(duration))),
      };
      if (!reference) settings.aspect_ratio = String(input.ratio || config.ratio || "9:16");
      url = `${baseUrl}/${reference ? "image-to-video" : "text-to-video"}/${encodeURIComponent(endpointModel)}`;
      body = reference
        ? {
          contents: [
            { type: "prompt", text: job.prompt },
            { type: "first_frame", url: reference.url },
          ],
          settings,
          options: { external_task_id: job.id, watermark_info: { enabled: config.watermark === true } },
        }
        : {
          prompt: job.prompt,
          settings,
          options: { external_task_id: job.id, watermark_info: { enabled: config.watermark === true } },
        };
    } else if (provider.code === "BAILIAN_WAN") {
      url = opsConfig.bailian.videoGenerationUrl;
      body = {
        model: model.code,
        input: reference ? { prompt: job.prompt, img_url: reference.url } : { prompt: job.prompt },
        parameters: reference
          ? { resolution: "480P", prompt_extend: true, duration, watermark: false }
          : { size: "480*832", prompt_extend: true, duration, watermark: false },
      };
    } else if (provider.code === "RUNWAY") {
      url = `${baseUrl}/v1/${reference ? "image_to_video" : "text_to_video"}`;
      body = {
        model: model.code,
        promptText: job.prompt,
        ...(reference ? { promptImage: reference.url } : {}),
        ratio: "720:1280",
        duration,
      };
    } else if (provider.code === "HEYGEN") {
      const config = { ...object(provider.publicConfig), ...object(model.modelConfig) };
      if (!config.avatarId || !config.voiceId) return { state: "FAILED", error: "HeyGen需要在模型设置中配置avatarId和voiceId", response: {} };
      url = `${baseUrl}/v2/video/generate`;
      body = {
        video_inputs: [{
          character: { type: "avatar", avatar_id: config.avatarId, avatar_style: "normal" },
          voice: { type: "text", input_text: job.prompt, voice_id: config.voiceId },
          background: { type: "color", value: "#FFFFFF" },
        }],
        dimension: { width: 1080, height: 1920 },
      };
    } else if (provider.code === "OPENAI_VIDEOS") {
      url = `${baseUrl}/videos`;
      body = { model: model.code, prompt: job.prompt, seconds: duration, size: "720x1280" };
    } else if (provider.code === "CUSTOM_HTTP") {
      const config = { ...object(provider.publicConfig), ...object(model.modelConfig) };
      const submitPath = String(config.submitPath || "");
      if (!submitPath) return { state: "FAILED", error: "自定义模型未配置submitPath", response: {} };
      url = submitPath.startsWith("http") ? submitPath : `${baseUrl}/${submitPath.replace(/^\//u, "")}`;
      body = { model: model.code, prompt: job.prompt, input, referenceUrl: reference?.url };
    } else {
      return { state: "FAILED", error: `${provider.code}适配器尚未启用，请使用自定义HTTP配置`, response: {} };
    }

    const headers = this.authHeaders(provider.code, secret);
    if (provider.code === "BAILIAN_WAN") headers["X-DashScope-Async"] = "enable";
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(() => ({})) as JsonRow;
    if (!response.ok) return {
      state: "FAILED",
      error: String(payload.message || object(payload.error).message || payload.error || `模型请求失败（${response.status}）`),
      response: payload,
    };
    if (provider.code === "KLING" && Number(payload.code ?? 0) !== 0) return {
      state: "FAILED",
      error: String(payload.message || "可灵任务创建失败"),
      response: payload,
    };
    const externalJobId = String(
      object(payload.output).task_id
      || payload.id
      || object(payload.data).video_id
      || object(payload.data).task_id
      || object(payload.data).id
      || "",
    );
    const immediateUrl = String(
      object(payload.output).video_url
      || object(payload.data).video_url
      || payload.video_url
      || "",
    );
    if (immediateUrl) return { state: "SUCCEEDED", externalJobId, outputUrl: immediateUrl, response: payload };
    if (!externalJobId) return { state: "FAILED", error: "模型未返回任务编号", response: payload };
    return { state: "RUNNING", externalJobId, response: payload };
  }

  private async pollProvider(
    provider: { code: string; baseUrl: string | null; publicConfig: unknown },
    model: { modelConfig: unknown },
    secret: JsonRow,
    externalJobId: string,
  ): Promise<ProviderResult> {
    const baseUrl = String(provider.baseUrl || "").replace(/\/$/u, "");
    let url = "";
    if (provider.code === "VOLCENGINE_SEEDANCE") url = `${baseUrl}/contents/generations/tasks/${encodeURIComponent(externalJobId)}`;
    else if (provider.code === "KLING") url = `${baseUrl}/tasks?task_ids=${encodeURIComponent(externalJobId)}`;
    else if (provider.code === "BAILIAN_WAN") url = `${opsConfig.bailian.taskUrl.replace(/\/$/u, "")}/${encodeURIComponent(externalJobId)}`;
    else if (provider.code === "RUNWAY") url = `${baseUrl}/v1/tasks/${encodeURIComponent(externalJobId)}`;
    else if (provider.code === "HEYGEN") url = `${baseUrl}/v1/video_status.get?video_id=${encodeURIComponent(externalJobId)}`;
    else if (provider.code === "OPENAI_VIDEOS") url = `${baseUrl}/videos/${encodeURIComponent(externalJobId)}`;
    else if (provider.code === "CUSTOM_HTTP") {
      const config = { ...object(provider.publicConfig), ...object(model.modelConfig) };
      const statusPath = String(config.statusPath || "").replace("{id}", encodeURIComponent(externalJobId));
      if (!statusPath) return { state: "FAILED", externalJobId, error: "自定义模型未配置statusPath", response: {} };
      url = statusPath.startsWith("http") ? statusPath : `${baseUrl}/${statusPath.replace(/^\//u, "")}`;
    } else return { state: "FAILED", externalJobId, error: `${provider.code}不支持任务轮询`, response: {} };

    const response = await fetch(url, {
      headers: this.authHeaders(provider.code, secret),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({})) as JsonRow;
    if (!response.ok) return {
      state: "FAILED",
      externalJobId,
      error: String(payload.message || object(payload.error).message || payload.error || `进度查询失败（${response.status}）`),
      response: payload,
    };
    if (provider.code === "KLING" && Number(payload.code ?? 0) !== 0) return {
      state: "FAILED",
      externalJobId,
      error: String(payload.message || "可灵进度查询失败"),
      response: payload,
    };
    const output = object(payload.output);
    const klingData = provider.code === "KLING" && Array.isArray(payload.data) ? object(payload.data[0]) : {};
    const data = provider.code === "KLING" ? klingData : object(payload.data);
    const content = object(payload.content);
    const status = statusValue(output.task_status || payload.status || data.status || payload.state);
    const outputArray = Array.isArray(payload.output) ? payload.output : [];
    const klingOutputs = Array.isArray(data.outputs) ? data.outputs.map(object) : [];
    const klingVideo = klingOutputs.find((item) => String(item.type || "") === "video") || {};
    const outputUrl = String(
      output.video_url
      || data.video_url
      || data.video_url_caption
      || klingVideo.url
      || content.video_url
      || payload.video_url
      || outputArray[0]
      || "",
    );
    if (["SUCCEEDED", "SUCCESS", "COMPLETED", "DONE"].includes(status)) {
      if (provider.code === "OPENAI_VIDEOS" && !outputUrl) {
        return { state: "SUCCEEDED", externalJobId, contentUrl: `${baseUrl}/videos/${encodeURIComponent(externalJobId)}/content`, response: payload };
      }
      if (!outputUrl) return { state: "FAILED", externalJobId, error: "任务完成但未返回视频地址", response: payload };
      const klingBilling = Array.isArray(data.billing) ? data.billing.map(object) : [];
      const cashCharge = klingBilling.find((item) => String(item.charge_type || "") === "cash");
      return {
        state: "SUCCEEDED",
        externalJobId,
        outputUrl,
        response: payload,
        ...(cashCharge ? { cost: Number(cashCharge.amount || 0) } : {}),
      };
    }
    if (["FAILED", "FAILURE", "CANCELED", "CANCELLED", "ERROR"].includes(status)) {
      return { state: "FAILED", externalJobId, error: String(output.message || data.error || payload.error || payload.message || "视频生成失败"), response: payload };
    }
    return { state: "RUNNING", externalJobId, response: payload };
  }

  private async consumeProviderResult(jobId: string, attemptId: string, result: ProviderResult) {
    if (result.state === "RUNNING") {
      await this.prisma.videoGenerationAttempt.update({
        where: { id: attemptId },
        data: { externalJobId: result.externalJobId, response: result.response as Prisma.InputJsonValue },
      });
      await this.prisma.videoGenerationJob.update({ where: { id: jobId }, data: { status: "RUNNING", nextAttemptAt: new Date(Date.now() + 10_000) } });
      return;
    }
    if (result.state === "FAILED") {
      const failureReason = providerFailureMessage(result.error);
      const job = await this.prisma.videoGenerationJob.findUnique({ where: { id: jobId } });
      await this.prisma.videoGenerationAttempt.update({
        where: { id: attemptId },
        data: { status: "FAILED", externalJobId: result.externalJobId, response: result.response as Prisma.InputJsonValue, failureReason, finishedAt: new Date() },
      });
      if (job && job.allowFallback && job.attemptCount < job.maxAttempts) {
        await this.prisma.videoGenerationJob.update({
          where: { id: jobId },
          data: { status: "RETRY", failureReason, nextAttemptAt: new Date(Date.now() + 5_000) },
        });
      } else {
        await this.prisma.videoGenerationJob.update({ where: { id: jobId }, data: { status: "FAILED", failureReason, finishedAt: new Date() } });
      }
      if (job?.shotId) await this.prisma.videoShot.update({ where: { id: job.shotId }, data: { status: "OPEN" } });
      if (job?.contentPlanId) await this.factory.syncCompatibility(job.contentPlanId);
      return;
    }
    await this.completeGeneration(jobId, attemptId, result);
  }

  private async downloadResult(result: Extract<ProviderResult, { state: "SUCCEEDED" }>, providerCode: string, secretRef?: string | null) {
    const headers: Record<string, string> = {};
    if (result.contentUrl && secretRef) {
      const secret = object(JSON.parse(decryptIntegrationValue(secretRef) || "{}"));
      headers.Authorization = `Bearer ${String(secret.apiKey || "")}`;
    }
    const url = result.outputUrl || result.contentUrl;
    if (!url) throw new Error("视频生成成功但缺少下载地址");
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`${providerCode}视频下载失败（${response.status}）`);
    return Buffer.from(await response.arrayBuffer());
  }

  private async inspectVideo(path: string): Promise<VideoTechnicalMetadata> {
    try {
      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,duration,codec_name,avg_frame_rate,r_frame_rate",
        "-show_entries", "format=duration",
        "-of", "json",
        path,
      ], { timeout: 60_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
      return parseVideoTechnicalMetadata(stdout);
    } catch (error) {
      return { ok: false, width: 0, height: 0, duration: 0, codec: "", frameRate: "", error: error instanceof Error ? error.message : "ffprobe失败" };
    }
  }

  async inspectUploadedVideo(file: { originalname: string; buffer: Buffer } | undefined) {
    const technical = await inspectVideoBuffer(file);
    return { ok: true, ...technical, duration: technical.durationSeconds };
  }

  private async hasAudio(path: string) {
    try {
      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", path,
      ], { timeout: 30_000, windowsHide: true, maxBuffer: 256 * 1024 });
      return Boolean(stdout.trim());
    } catch {
      return false;
    }
  }

  private estimateCost(model: { costConfig: unknown }, input: unknown) {
    const cost = object(model.costConfig);
    const duration = Number(object(input).duration || 5);
    const fixed = Math.max(0, Number(cost.fixed || 0));
    const perSecond = Math.max(0, Number(cost.perSecond || 0));
    return Math.round((fixed + perSecond * duration) * 1_000_000) / 1_000_000;
  }

  private async completeGeneration(jobId: string, attemptId: string, result: Extract<ProviderResult, { state: "SUCCEEDED" }>) {
    const job = await this.prisma.videoGenerationJob.findUnique({
      where: { id: jobId },
      include: { contentPlan: true, shot: true, resolvedModel: { include: { provider: true } } },
    });
    if (!job?.resolvedModel) throw new Error("生成任务缺少已解析模型");
    const buffer = await this.downloadResult(result, job.resolvedModel.provider.code, job.resolvedModel.provider.secretRef);
    const tempDir = join(opsConfig.derivedOutputDir, "video-factory", "temp");
    await mkdir(tempDir, { recursive: true });
    const tempPath = join(tempDir, `${job.id}.mp4`);
    await writeFile(tempPath, buffer);
    const technical = await this.inspectVideo(tempPath);
    await rm(tempPath, { force: true });
    if (!technical.ok) throw new Error(`生成视频技术质检失败：${technical.error || "无法读取视频流"}`);
    const hash = createHash("sha256").update(buffer).digest("hex");
    const publicNo = `SD-AIV-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const objectKey = this.oss.derivedObjectKey(job.id, "ai-video-shot", 1, hash, ".mp4");
    const stored = await this.oss.uploadGeneratedBuffer({
      objectKey,
      buffer,
      actor: job.createdBy,
      sourceType: "AI_GENERATED",
      sha256: hash,
      originalName: `${publicNo}.mp4`,
    });
    const asset = await this.prisma.asset.create({
      data: {
        sourceKey: `VIDEO_FACTORY_GENERATION:${job.id}`,
        sourceType: "AI_GENERATED",
        sourcePath: `oss://${objectKey}`,
        fileName: `${publicNo}.mp4`,
        originalFileName: `${publicNo}.mp4`,
        extension: ".mp4",
        mediaType: "VIDEO",
        kind: "VIDEO",
        assetNo: publicNo,
        displayName: `AI镜头-${job.shot?.title || job.contentPlan.topic}`,
        level: "AI_GENERATED",
        productScope: job.contentPlan.productModel ? "MODEL" : "UNKNOWN",
        processingStatus: "READY_FOR_REVIEW",
        reviewStatus: "PENDING",
        availabilityStatus: "INACTIVE",
        rightsStatus: "AUTH_REQUIRED",
        sha256: hash,
        sizeBytes: buffer.length,
        modifiedAt: new Date(),
        width: technical.width,
        height: technical.height,
        durationSeconds: technical.duration,
        aspectRatio: "9:16",
        model: job.contentPlan.productModel,
        status: "PENDING",
        qualityScore: 70,
        contentDescription: job.shot?.description || job.prompt,
        isOriginal: false,
        sourceSnapshot: {
          provider: job.resolvedModel.provider.code,
          model: job.resolvedModel.code,
          jobId: job.id,
          externalJobId: result.externalJobId,
          prompt: job.prompt,
        },
        aiIndex: { source: "VIDEO_FACTORY", contentPlanId: job.contentPlanId, shotId: job.shotId, prompt: job.prompt },
        searchText: `${job.contentPlan.productModel || ""} ${job.shot?.description || ""} AI生成视频`,
        indexNeedsReview: true,
        storageProvider: "ALIYUN_OSS",
        objectKey,
        objectVersionId: stored.objectVersionId,
        etag: stored.etag,
        storageUrl: stored.storageUrl,
        storageSyncedAt: stored.uploadedAt,
        discoveredBy: job.createdBy,
        versions: {
          create: {
            version: 1,
            sha256: hash,
            sourcePath: `oss://${objectKey}`,
            objectKey,
            objectVersionId: stored.objectVersionId,
            etag: stored.etag,
            storageUrl: stored.storageUrl,
            createdBy: job.createdBy,
            originalFileName: `${publicNo}.mp4`,
            mimeType: "video/mp4",
            extension: ".mp4",
            sizeBytes: buffer.length,
            width: technical.width,
            height: technical.height,
            durationSeconds: technical.duration,
            technicalMetadata: { provider: job.resolvedModel.provider.code, model: job.resolvedModel.code, jobId: job.id },
          },
        },
      },
    });
    const actualCost = Number(result.cost ?? this.estimateCost(job.resolvedModel, job.input));
    await this.prisma.$transaction([
      this.prisma.videoGenerationAttempt.update({
        where: { id: attemptId },
        data: { status: "SUCCEEDED", externalJobId: result.externalJobId, response: result.response as Prisma.InputJsonValue, cost: actualCost, finishedAt: new Date() },
      }),
      this.prisma.videoGenerationJob.update({
        where: { id: job.id },
        data: { status: "SUCCEEDED", outputAssetId: asset.id, output: { objectKey, assetId: asset.id }, actualCost, finishedAt: new Date(), nextAttemptAt: null },
      }),
      this.prisma.videoShot.update({ where: { id: job.shotId! }, data: { status: "PENDING_REVIEW", assetIds: { push: asset.id } } }),
      this.prisma.videoQualityCheck.create({
        data: { contentPlanId: job.contentPlanId, assetId: asset.id, generationJobId: job.id, checkType: "TECHNICAL", status: "PASSED", score: 90, findings: [{ width: technical.width, height: technical.height, duration: technical.duration }] },
      }),
      this.prisma.videoQualityCheck.create({
        data: { contentPlanId: job.contentPlanId, assetId: asset.id, generationJobId: job.id, checkType: "PRODUCT_CONSISTENCY", status: "REVIEW_REQUIRED", score: 0, findings: [{ message: "请核对产品外形、型号、Logo、屏幕和功能画面" }] },
      }),
      this.prisma.videoModelProvider.update({
        where: { id: job.resolvedModel.providerId },
        data: { state: "HEALTHY", message: "最近生成任务成功", lastSuccessAt: new Date(), lastCheckedAt: new Date() },
      }),
    ]);
    await this.factory.syncCompatibility(job.contentPlanId);
  }

  private async failGeneration(id: string, error: unknown) {
    const message = providerFailureMessage(error instanceof Error ? error.message : "视频生成失败");
    this.logger.error(`Generation ${id}: ${message}`);
    const job = await this.prisma.videoGenerationJob.findUnique({ where: { id } });
    if (!job) return;
    await this.prisma.videoGenerationJob.update({ where: { id }, data: { status: "FAILED", failureReason: message, finishedAt: new Date() } });
    if (job.shotId) await this.prisma.videoShot.update({ where: { id: job.shotId }, data: { status: "OPEN" } });
    await this.factory.syncCompatibility(job.contentPlanId);
  }

  private async localAssetPath(asset: { id: string; sourcePath: string; objectKey: string | null; extension: string }, tempDir: string) {
    if (asset.objectKey && this.oss.isConfigured()) {
      const response = await fetch(this.oss.signedDownloadUrl(asset.objectKey, 3_600), { signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error(`素材${asset.id}下载失败（${response.status}）`);
      const path = join(tempDir, `${asset.id}${asset.extension || ".mp4"}`);
      await writeFile(path, Buffer.from(await response.arrayBuffer()));
      return path;
    }
    return asset.sourcePath;
  }

  private async processRender(id: string) {
    const job = await this.prisma.videoRenderJob.findUnique({
      where: { id },
      include: { contentPlan: { include: { videoShots: { orderBy: { sequence: "asc" }, include: { selectedAsset: true } } } } },
    });
    if (!job) throw new Error("渲染任务不存在");
    const renderInput = object(job.input);
    const revisionFeedback = String(renderInput.revisionFeedback || "").trim();
    const renderShots = job.contentPlan.videoShots.map((shot) => {
      if (!shot.selectedAsset) throw new Error(`分镜${shot.sequence + 1}缺少已确认素材`);
      return { shot, asset: shot.selectedAsset };
    });
    if (!renderShots.length) throw new Error("渲染任务缺少标准分镜");
    const workDir = join(opsConfig.derivedOutputDir, "video-factory", job.id);
    await mkdir(workDir, { recursive: true });
    const normalized: string[] = [];
    const materialUsage: Array<Record<string, unknown>> = [];
    let timelineCursor = 0;
    for (let index = 0; index < renderShots.length; index += 1) {
      const { shot, asset } = renderShots[index]!;
      const shotMetadata = object(shot.metadata);
      const lineId = String(shotMetadata.lineId || "").trim();
      if (videoFactoryModule(job.contentPlan) === "DOUYIN_VIRAL" && !lineId) throw new Error(`分镜${index + 1}缺少稳定lineId`);
      if (!asset.sha256) throw new Error(`分镜${index + 1}素材缺少哈希，不能形成可追溯成片`);
      const sourcePath = await this.localAssetPath(asset, workDir);
      const normalizedPath = join(workDir, `shot-${String(index + 1).padStart(2, "0")}.mp4`);
      const sourceIn = Math.max(0, Number(shotMetadata.sourceIn) || 0);
      const duration = Math.max(1, Number(shot.durationSeconds || 5));
      const sourceOut = Math.max(sourceIn + duration, Number(shotMetadata.sourceOut) || 0);
      const sourceHasAudio = await this.hasAudio(sourcePath);
      const primaryInput = asset.kind === "IMAGE"
        ? ["-y", "-loop", "1", "-i", sourcePath]
        : ["-y", "-ss", String(sourceIn), "-i", sourcePath];
      const inputs = sourceHasAudio
        ? primaryInput
        : [...primaryInput, "-f", "lavfi", "-t", String(duration), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"];
      await execFileAsync("ffmpeg", [
        ...inputs,
        "-map", "0:v:0", "-map", sourceHasAudio ? "0:a:0" : "1:a:0",
        "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,fps=30",
        "-t", String(duration),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        normalizedPath,
      ], { timeout: 300_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
      normalized.push(normalizedPath);
      materialUsage.push({
        lineId: lineId || `line_${String(index + 1).padStart(2, "0")}`,
        sequence: shot.sequence,
        assetId: asset.id,
        sha256: asset.sha256,
        scriptLine: shot.description,
        timelineStart: timelineCursor,
        timelineEnd: timelineCursor + duration,
        sourceIn,
        sourceOut,
        moduleType: shot.moduleType,
      });
      timelineCursor += duration;
    }
    let elapsed = 0;
    const captionTexts = videoRenderCaptionTexts(job.contentPlan);
    const captions = job.contentPlan.videoShots.map((shot, index) => {
      const duration = Math.max(1, Number(shot.durationSeconds || 5));
      const start = elapsed;
      elapsed += duration;
      return `${index + 1}\n${srtTime(start)} --> ${srtTime(elapsed)}\n${captionTexts[index]}\n`;
    });
    const subtitlePath = join(workDir, "captions.srt");
    await writeFile(subtitlePath, captions.join("\n"), "utf8");
    const concatList = join(workDir, "concat.txt");
    await writeFile(concatList, normalized.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join("\n"), "utf8");
    const outputPath = join(workDir, `${job.contentPlan.productionNo || job.contentPlan.id}-master.mp4`);
    let actualRenderer = "FFMPEG_TEMPLATE";
    if (opsConfig.videoRenderCommand && usesConfiguredVideoRenderer(job.contentPlan)) {
      const briefPath = join(workDir, "BRIEF.md");
      await writeFile(briefPath, [
        "---", "workflow: general-video", "flow: automation", "aspect: 9:16", "resolution: 1080x1920", "---",
        `# ${job.contentPlan.topic}`, "", `Hook: ${job.contentPlan.hook || ""}`, `CTA: ${job.contentPlan.objective || ""}`,
        ...(revisionFeedback ? ["", "## 上一版退回说明（本次必须针对性优化）", revisionFeedback] : []),
        "", "## Approved shot files", ...normalized.map((path, index) => `${index + 1}. ${path}`),
        "", `Subtitle: ${subtitlePath}`, `Output: ${outputPath}`,
      ].join("\n"), "utf8");
      const quote = (value: string) => `"${value.replaceAll('"', '\\"')}"`;
      const command = opsConfig.videoRenderCommand
        .replaceAll("{brief}", quote(briefPath))
        .replaceAll("{output}", quote(outputPath))
        .replaceAll("{outputDir}", quote(workDir))
        .replaceAll("{planId}", job.contentPlanId);
      try {
        await execAsync(command, { cwd: workDir, timeout: 30 * 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
        const outputStat = await stat(outputPath);
        if (!outputStat.isFile() || outputStat.size < 1_024) throw new Error("HyperFrames输出为空");
        actualRenderer = "HYPERFRAMES";
      } catch (error) {
        this.logger.warn(`HyperFrames ${job.id} failed, fallback to FFmpeg: ${error instanceof Error ? error.message : "unknown"}`);
      }
    }
    if (actualRenderer !== "HYPERFRAMES") {
      await execFileAsync("ffmpeg", [
        "-y", "-f", "concat", "-safe", "0", "-i", concatList,
        "-vf", `subtitles='${ffmpegFilterPath(subtitlePath)}':force_style='FontName=Noto Sans CJK SC,FontSize=14,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginL=80,MarginR=80,MarginV=110,Alignment=2'`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
        outputPath,
      ], { timeout: 600_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    }
    const technical = await this.inspectVideo(outputPath);
    if (!technical.ok) throw new Error(`主成片技术质检失败：${technical.error || "无法读取视频流"}`);
    const qualityChecks = [
      { checkType: "OUTPUT_VALIDITY", status: "PASSED", score: 100, findings: [{ width: technical.width, height: technical.height, duration: technical.duration, codec: technical.codec, frameRate: technical.frameRate }] },
      { checkType: "MATERIAL_TRACE", status: "PASSED", score: 100, findings: materialUsage.map((item) => ({ lineId: item.lineId, assetId: item.assetId, sha256: item.sha256 })) },
      { checkType: "CONTENT_ALIGNMENT", status: "REVIEW_REQUIRED", score: 0, findings: [{ message: "请独立核对Hook、中段产品卖点与CTA画面" }] },
    ];
    const contentAlignment = {
      status: "REVIEW_REQUIRED",
      hook: { expected: job.contentPlan.hook || "", timestamp: 1 },
      body: { expected: job.contentPlan.topic || "", timestamp: Math.max(1, Math.round(technical.duration / 2)) },
      cta: { expected: job.contentPlan.objective || "", timestamp: Math.max(1, Math.floor(technical.duration - 1)) },
      blockers: [],
    };
    const admission = validateVideoMasterMetadata({
      width: technical.width,
      height: technical.height,
      durationSeconds: technical.duration,
      codec: technical.codec,
      frameRate: technical.frameRate,
      materialUsage,
      qualityChecks,
      contentAlignment,
    }, {
      requireMaterialUsage: videoFactoryModule(job.contentPlan) === "DOUYIN_VIRAL",
      allowedAssetIds: new Set(renderShots.map((item) => item.asset.id)),
      expectedShotLineIds: new Set(renderShots.map((item, index) => String(object(item.shot.metadata).lineId || `line_${String(index + 1).padStart(2, "0")}`))),
    });
    if (!admission.valid) throw new Error(`主成片准入失败：${admission.hardBlockers.join("；")}`);
    const buffer = await readFile(outputPath);
    const hash = createHash("sha256").update(buffer).digest("hex");
    const publicNo = `SD-FINAL-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const objectKey = this.oss.derivedObjectKey(job.id, "video-master", 1, hash, ".mp4");
    const stored = await this.oss.uploadGeneratedBuffer({
      objectKey,
      buffer,
      actor: job.createdBy,
      sourceType: "AI_GENERATED",
      sha256: hash,
      originalName: `${publicNo}.mp4`,
    });
    const asset = await this.prisma.asset.create({
      data: {
        sourceKey: `VIDEO_FACTORY_RENDER:${job.id}`,
        sourceType: "AI_GENERATED",
        sourcePath: outputPath,
        fileName: basename(outputPath),
        originalFileName: `${publicNo}.mp4`,
        extension: extname(outputPath),
        mediaType: "VIDEO",
        kind: "VIDEO",
        assetNo: publicNo,
        displayName: `智能视频成片-${job.contentPlan.topic}`,
        level: "FINISHED",
        productScope: job.contentPlan.productModel ? "MODEL" : "UNKNOWN",
        processingStatus: "READY_FOR_REVIEW",
        reviewStatus: "PENDING",
        availabilityStatus: "INACTIVE",
        rightsStatus: "AUTH_REQUIRED",
        sha256: hash,
        sizeBytes: buffer.length,
        modifiedAt: new Date(),
        width: technical.width,
        height: technical.height,
        durationSeconds: technical.duration,
        aspectRatio: "9:16",
        model: job.contentPlan.productModel,
        status: "PENDING",
        qualityScore: 80,
        contentDescription: job.contentPlan.topic,
        sourceSnapshot: {
          renderer: actualRenderer,
          renderJobId: job.id,
          shotAssetIds: renderShots.map((item) => item.asset.id),
          metadata: {
            source: actualRenderer,
            codec: technical.codec,
            frameRate: technical.frameRate,
            usedAssetIds: renderShots.map((item) => item.asset.id),
            materialUsage: materialUsage as unknown as Prisma.InputJsonValue,
            qualityChecks: qualityChecks as unknown as Prisma.InputJsonValue,
            contentAlignment: contentAlignment as unknown as Prisma.InputJsonValue,
            outputValidation: { valid: true, hardBlockers: [] },
          },
        },
        aiIndex: { source: "VIDEO_FACTORY_RENDER", contentPlanId: job.contentPlanId },
        searchText: `${job.contentPlan.productModel || ""} ${job.contentPlan.topic} 智能视频成片`,
        indexNeedsReview: true,
        storageProvider: "ALIYUN_OSS",
        objectKey,
        objectVersionId: stored.objectVersionId,
        etag: stored.etag,
        storageUrl: stored.storageUrl,
        storageSyncedAt: stored.uploadedAt,
        discoveredBy: job.createdBy,
        versions: {
          create: {
            version: 1,
            sha256: hash,
            sourcePath: outputPath,
            objectKey,
            objectVersionId: stored.objectVersionId,
            etag: stored.etag,
            storageUrl: stored.storageUrl,
            createdBy: job.createdBy,
            originalFileName: `${publicNo}.mp4`,
            mimeType: "video/mp4",
            extension: ".mp4",
            sizeBytes: buffer.length,
            width: technical.width,
            height: technical.height,
            durationSeconds: technical.duration,
            technicalMetadata: {
              renderer: actualRenderer,
              renderJobId: job.id,
              codec: technical.codec,
              frameRate: technical.frameRate,
              usedAssetIds: renderShots.map((item) => item.asset.id),
              materialUsage: materialUsage as unknown as Prisma.InputJsonValue,
              qualityChecks: qualityChecks as unknown as Prisma.InputJsonValue,
              contentAlignment: contentAlignment as unknown as Prisma.InputJsonValue,
              outputValidation: { valid: true, hardBlockers: [] },
            },
          },
        },
      },
    });
    await this.prisma.$transaction([
      this.prisma.videoRenderJob.update({
        where: { id: job.id },
        data: { status: "SUCCEEDED", outputAssetId: asset.id, outputPath, output: { objectKey, assetId: asset.id, renderer: actualRenderer }, finishedAt: new Date() },
      }),
      this.prisma.contentPlan.update({
        where: { id: job.contentPlanId },
        data: { masterVideoPath: outputPath, masterVideoStatus: "READY_FOR_REVIEW", productionStage: "VIDEO_REVIEW" },
      }),
      this.prisma.contentAsset.create({
        data: { contentPlanId: job.contentPlanId, assetId: asset.id, role: "VIDEO_FACTORY_MASTER" },
      }),
      ...qualityChecks.map((check) => this.prisma.videoQualityCheck.create({
        data: {
          contentPlanId: job.contentPlanId,
          assetId: asset.id,
          renderJobId: job.id,
          checkType: check.checkType,
          status: check.status,
          score: check.score,
          findings: check.findings as Prisma.InputJsonValue,
        },
      })),
      this.prisma.videoQualityCheck.create({
        data: { contentPlanId: job.contentPlanId, assetId: asset.id, renderJobId: job.id, checkType: "FINAL_REVIEW", status: "REVIEW_REQUIRED", score: 0, findings: [{ message: "请核对字幕、配音、产品外形、功能画面和CTA" }] },
      }),
    ]);
  }

  private async failRender(id: string, error: unknown) {
    const message = error instanceof Error ? error.message : "视频渲染失败";
    this.logger.error(`Render ${id}: ${message}`);
    const job = await this.prisma.videoRenderJob.findUnique({ where: { id } });
    if (!job) return;
    await this.prisma.$transaction([
      this.prisma.videoRenderJob.update({ where: { id }, data: { status: "FAILED", failureReason: message, finishedAt: new Date() } }),
      this.prisma.contentPlan.update({ where: { id: job.contentPlanId }, data: { masterVideoStatus: "FAILED", productionStage: "READY_TO_EDIT" } }),
    ]);
  }
}
