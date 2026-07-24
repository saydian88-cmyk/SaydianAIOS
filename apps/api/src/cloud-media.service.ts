import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import {
  AssetLevel,
  AssetRightsStatus,
  CloudMediaJobStatus,
  CloudMediaJobType,
  CloudMediaProvider,
  IntegrationKind,
  Prisma,
} from "@prisma/client";
import IceClient, {
  GetMediaInfoJobRequest,
  GetSmartHandleJobRequest,
  GetSnapshotJobRequest,
  GetTranscodeJobRequest,
  SubmitMediaInfoJobRequest,
  SubmitMediaInfoJobRequestInput,
  SubmitMediaInfoJobRequestScheduleConfig,
  SubmitSegmentationJobRequest,
  SubmitSnapshotJobRequest,
  SubmitSnapshotJobRequestInput,
  SubmitSnapshotJobRequestOutput,
  SubmitSnapshotJobRequestScheduleConfig,
  SubmitSnapshotJobRequestTemplateConfig,
  SubmitTranscodeJobRequest,
  SubmitTranscodeJobRequestInputGroup,
  SubmitTranscodeJobRequestOutputGroup,
  SubmitTranscodeJobRequestOutputGroupOutput,
  SubmitTranscodeJobRequestOutputGroupProcessConfig,
  SubmitTranscodeJobRequestOutputGroupProcessConfigTranscode,
  SubmitTranscodeJobRequestOutputGroupProcessConfigTranscodeOverwriteParams,
  SubmitTranscodeJobRequestOutputGroupProcessConfigTranscodeOverwriteParamsAudio,
  SubmitTranscodeJobRequestOutputGroupProcessConfigTranscodeOverwriteParamsContainer,
  SubmitTranscodeJobRequestOutputGroupProcessConfigTranscodeOverwriteParamsVideo,
  SubmitTranscodeJobRequestScheduleConfig,
} from "@alicloud/ice20201109";
import { Config as OpenApiConfig } from "@alicloud/openapi-client";
import { createHash, randomUUID } from "node:crypto";
import { opsConfig } from "./config";
import { OssStorageService } from "./oss-storage.service";
import { PrismaService } from "./prisma.service";

type JsonMap = Record<string, unknown>;

const RETRY_MINUTES = [1, 5, 30];
const IMS_TYPES: CloudMediaJobType[] = ["MEDIA_INFO", "PROXY_VIDEO", "SCREENSHOTS", "SEGMENTATION"];
const MODULES = ["HOOK", "PAIN", "SCENE", "FEATURE", "BENEFIT", "PROOF", "DEMO", "COMPARE", "UGC", "STORY", "TRANSITION", "TRAFFIC", "OFFER", "CTA", "ENDING"];

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function map(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stableKey(parts: Array<string | number | undefined>): string {
  return createHash("sha256").update(parts.map((item) => String(item ?? "")).join("|")).digest("hex");
}

function parseJsonText(value: unknown): JsonMap {
  if (value && typeof value === "object") return map(value);
  const raw = text(value).replace(/^```json\s*/iu, "").replace(/```$/u, "").trim();
  if (!raw) return {};
  try {
    return map(JSON.parse(raw));
  } catch {
    return { raw };
  }
}

export interface MediaProcessingProvider {
  capabilities(): Record<string, { state: "AVAILABLE" | "UNCONFIGURED"; message: string }>;
  submitVideoAnalysis(input: CloudSubmitInput): Promise<CloudSubmitResult>;
  submitScreenshots(input: CloudSubmitInput): Promise<CloudSubmitResult>;
  submitSegmentation(input: CloudSubmitInput): Promise<CloudSubmitResult>;
  submitProxyVideo(input: CloudSubmitInput): Promise<CloudSubmitResult>;
  getJobStatus(type: CloudMediaJobType, externalJobId: string): Promise<CloudPollResult>;
}

export interface VideoAiProvider {
  transcribe(input: CloudSubmitInput): Promise<CloudSubmitResult>;
  understandVideo(input: VideoUnderstandingInput): Promise<JsonMap>;
  analyzeSegment(input: VideoUnderstandingInput): Promise<JsonMap>;
  classifyModule(input: VideoUnderstandingInput): Promise<JsonMap>;
  scoreAsset(input: VideoUnderstandingInput): Promise<JsonMap>;
  generateRemakeBrief(input: VideoUnderstandingInput): Promise<JsonMap>;
}

interface CloudSubmitInput {
  objectKey: string;
  signedUrl: string;
  idempotencyKey: string;
  callbackToken: string;
  assetId?: string;
  externalVideoId?: string;
}

interface VideoUnderstandingInput {
  videoUrl?: string;
  frameUrls: string[];
  transcript?: string;
  title?: string;
  external: boolean;
}

interface CloudSubmitResult {
  externalJobId: string;
  raw: JsonMap;
}

interface CloudPollResult {
  status: "PROCESSING" | "SUCCEEDED" | "FAILED";
  raw: JsonMap;
  outputs?: Array<{ type: string; objectKey?: string; url?: string; startSecond?: number; endSecond?: number; metadata?: JsonMap }>;
  failureReason?: string;
  usage?: JsonMap;
}

@Injectable()
export class AliyunImsProvider implements MediaProcessingProvider {
  private clientInstance?: IceClient;

  capabilities() {
    const credentials = Boolean(opsConfig.ims.accessKeyId && opsConfig.ims.accessKeySecret);
    const state = credentials ? "AVAILABLE" as const : "UNCONFIGURED" as const;
    return {
      mediaInfo: { state, message: credentials ? `IMS ${opsConfig.ims.regionId}` : "缺少 IMS AccessKey" },
      segmentation: { state, message: credentials ? "深圳智能切分可提交" : "缺少 IMS AccessKey" },
      screenshots: {
        state: credentials && opsConfig.ims.snapshotTemplateId ? "AVAILABLE" as const : "UNCONFIGURED" as const,
        message: credentials && opsConfig.ims.snapshotTemplateId ? "截图模板已配置" : "缺少 IMS 截图模板",
      },
      proxyVideo: {
        state: credentials && opsConfig.ims.proxyTemplateId ? "AVAILABLE" as const : "UNCONFIGURED" as const,
        message: credentials && opsConfig.ims.proxyTemplateId ? "代理视频模板已配置" : "缺少 IMS 转码模板",
      },
    };
  }

  private client(): IceClient {
    if (!opsConfig.ims.accessKeyId || !opsConfig.ims.accessKeySecret) throw new Error("IMS AccessKey 未配置");
    if (!this.clientInstance) {
      this.clientInstance = new IceClient(new OpenApiConfig({
        accessKeyId: opsConfig.ims.accessKeyId,
        accessKeySecret: opsConfig.ims.accessKeySecret,
        regionId: opsConfig.ims.regionId,
        endpoint: opsConfig.ims.endpoint,
      }));
    }
    return this.clientInstance;
  }

  private ossUrl(objectKey: string) {
    return `oss://${opsConfig.oss.bucket}/${objectKey}`;
  }

  async submitVideoAnalysis(input: CloudSubmitInput): Promise<CloudSubmitResult> {
    const response = await this.client().submitMediaInfoJob(new SubmitMediaInfoJobRequest({
      name: `saidian-media-info-${input.assetId || input.externalVideoId}`,
      input: new SubmitMediaInfoJobRequestInput({ type: "OSS", media: this.ossUrl(input.objectKey) }),
      scheduleConfig: new SubmitMediaInfoJobRequestScheduleConfig({
        pipelineId: opsConfig.ims.pipelineId || undefined,
        priority: 5,
      }),
      userData: JSON.stringify({ callbackToken: input.callbackToken }),
    }));
    const body = map(response.body);
    const id = text(body.jobId);
    if (!id) throw new Error("IMS媒体信息任务未返回任务编号");
    return { externalJobId: id, raw: body };
  }

  async submitScreenshots(input: CloudSubmitInput): Promise<CloudSubmitResult> {
    if (!opsConfig.ims.snapshotTemplateId) throw new Error("IMS截图模板未配置");
    const object = `${opsConfig.oss.prefix}/analysis/${input.assetId || input.externalVideoId}/ims/screenshots/frame-{Count}.jpg`;
    const response = await this.client().submitSnapshotJob(new SubmitSnapshotJobRequest({
      name: `saidian-screenshots-${input.assetId || input.externalVideoId}`,
      input: new SubmitSnapshotJobRequestInput({ type: "OSS", media: this.ossUrl(input.objectKey) }),
      output: new SubmitSnapshotJobRequestOutput({ type: "OSS", media: this.ossUrl(object) }),
      templateConfig: new SubmitSnapshotJobRequestTemplateConfig({ templateId: opsConfig.ims.snapshotTemplateId }),
      scheduleConfig: new SubmitSnapshotJobRequestScheduleConfig({ pipelineId: opsConfig.ims.pipelineId || undefined }),
      userData: JSON.stringify({ callbackToken: input.callbackToken }),
    }));
    const body = map(response.body);
    const id = text(body.jobId);
    if (!id) throw new Error("IMS截图任务未返回任务编号");
    return { externalJobId: id, raw: body };
  }

  async submitSegmentation(input: CloudSubmitInput): Promise<CloudSubmitResult> {
    const object = `${opsConfig.oss.prefix}/derived/${input.assetId || input.externalVideoId}/ims-segments/{index}.mp4`;
    const response = await this.client().submitSegmentationJob(new SubmitSegmentationJobRequest({
      clientToken: input.idempotencyKey.slice(0, 64),
      inputConfig: JSON.stringify({ Type: "OSS", Media: this.ossUrl(input.objectKey) }),
      jobParams: JSON.stringify({ Mode: "Auto" }),
      outputConfig: JSON.stringify({
        OutputMediaTarget: "oss-object",
        Bucket: opsConfig.oss.bucket,
        ObjectKey: object,
        ExportAsNewMedia: false,
      }),
      userData: JSON.stringify({ callbackToken: input.callbackToken }),
    }));
    const body = map(response.body);
    const id = text(body.jobId);
    if (!id) throw new Error("IMS智能切分任务未返回任务编号");
    return { externalJobId: id, raw: body };
  }

  async submitProxyVideo(input: CloudSubmitInput): Promise<CloudSubmitResult> {
    if (!opsConfig.ims.proxyTemplateId) throw new Error("IMS代理视频模板未配置");
    const object = `${opsConfig.oss.prefix}/preview/${input.assetId || input.externalVideoId}/ims/proxy.mp4`;
    const output = new SubmitTranscodeJobRequestOutputGroup({
      output: new SubmitTranscodeJobRequestOutputGroupOutput({ type: "OSS", media: this.ossUrl(object) }),
      processConfig: new SubmitTranscodeJobRequestOutputGroupProcessConfig({
        transcode: new SubmitTranscodeJobRequestOutputGroupProcessConfigTranscode({
          templateId: opsConfig.ims.proxyTemplateId,
          overwriteParams: new SubmitTranscodeJobRequestOutputGroupProcessConfigTranscodeOverwriteParams({
            container: new SubmitTranscodeJobRequestOutputGroupProcessConfigTranscodeOverwriteParamsContainer({ format: "mp4" }),
            video: new SubmitTranscodeJobRequestOutputGroupProcessConfigTranscodeOverwriteParamsVideo({
              codec: "H.264",
              width: "720",
              bitrate: "800",
            }),
            audio: new SubmitTranscodeJobRequestOutputGroupProcessConfigTranscodeOverwriteParamsAudio({
              codec: "AAC",
              bitrate: "64",
            }),
          }),
        }),
      }),
    });
    const response = await this.client().submitTranscodeJob(new SubmitTranscodeJobRequest({
      clientToken: input.idempotencyKey.slice(0, 64),
      name: `saidian-proxy-${input.assetId || input.externalVideoId}`,
      inputGroup: [new SubmitTranscodeJobRequestInputGroup({ type: "OSS", media: this.ossUrl(input.objectKey) })],
      outputGroup: [output],
      scheduleConfig: new SubmitTranscodeJobRequestScheduleConfig({
        pipelineId: opsConfig.ims.pipelineId || undefined,
        priority: 5,
      }),
      userData: JSON.stringify({ callbackToken: input.callbackToken }),
    }));
    const body = map(response.body);
    const id = text(body.jobId);
    if (!id) throw new Error("IMS代理视频任务未返回任务编号");
    return { externalJobId: id, raw: body };
  }

  async getJobStatus(type: CloudMediaJobType, externalJobId: string): Promise<CloudPollResult> {
    let response: unknown;
    if (type === "MEDIA_INFO") response = await this.client().getMediaInfoJob(new GetMediaInfoJobRequest({ jobId: externalJobId }));
    else if (type === "SCREENSHOTS") response = await this.client().getSnapshotJob(new GetSnapshotJobRequest({ jobId: externalJobId }));
    else if (type === "PROXY_VIDEO") response = await this.client().getTranscodeJob(new GetTranscodeJobRequest({ jobId: externalJobId }));
    else response = await this.client().getSmartHandleJob(new GetSmartHandleJobRequest({ jobId: externalJobId }));
    const raw = map(map(response).body);
    const state = text(raw.state || map(raw.mediaInfoJob).status || map(raw.snapshotJob).status || map(raw.transcodeJob).status).toLowerCase();
    if (["failed", "fail", "error"].includes(state)) {
      return { status: "FAILED", raw, failureReason: text(raw.errorMessage || map(raw.mediaInfoJob).errorMessage) || "IMS任务失败" };
    }
    if (!["finished", "success", "succeeded", "completed"].includes(state)) return { status: "PROCESSING", raw };
    return {
      status: "SUCCEEDED",
      raw,
      outputs: this.outputs(type, raw),
      usage: parseJsonText(map(raw.jobResult).usage),
    };
  }

  private outputs(type: CloudMediaJobType, raw: JsonMap): CloudPollResult["outputs"] {
    if (type === "SEGMENTATION") {
      const result = parseJsonText(raw.output || map(raw.jobResult).aiResult);
      const candidates = Array.isArray(result.segments) ? result.segments : Array.isArray(result.Segments) ? result.Segments : [];
      return candidates.map((item, index) => {
        const value = map(item);
        return {
          type: "SEGMENT",
          objectKey: text(value.objectKey || value.ObjectKey),
          url: text(value.url || value.MediaUrl),
          startSecond: number(value.start || value.In || value.startTime),
          endSecond: number(value.end || value.Out || value.endTime),
          metadata: { index, ...value },
        };
      });
    }
    if (type === "SCREENSHOTS") {
      const job = map(raw.snapshotJob);
      const outputs = Array.isArray(job.output) ? job.output : [];
      return outputs.map((item) => {
        const value = map(item);
        return { type: "SCREENSHOT", objectKey: text(value.outputUrl || value.media), url: text(value.outputUrl || value.media), metadata: value };
      });
    }
    if (type === "PROXY_VIDEO") {
      const job = map(raw.transcodeJob);
      const outputs = Array.isArray(job.outputGroup) ? job.outputGroup : [];
      return outputs.map((item) => {
        const value = map(map(item).output);
        return { type: "PROXY_VIDEO", objectKey: text(value.outputUrl || value.media), url: text(value.outputUrl || value.media), metadata: value };
      });
    }
    return [{ type: "MEDIA_INFO", metadata: raw }];
  }
}

@Injectable()
export class BailianVideoAiProvider implements VideoAiProvider {
  constructor(private readonly oss: OssStorageService) {}

  capabilities() {
    const state = opsConfig.bailian.apiKey ? "AVAILABLE" as const : "UNCONFIGURED" as const;
    return {
      transcription: { state, message: state === "AVAILABLE" ? opsConfig.bailian.transcriptionModel : "缺少百炼 API Key" },
      videoUnderstanding: { state, message: state === "AVAILABLE" ? opsConfig.bailian.visionModel : "缺少百炼 API Key" },
    };
  }

  async transcribe(input: CloudSubmitInput): Promise<CloudSubmitResult> {
    if (!opsConfig.bailian.apiKey) throw new Error("百炼 API Key 未配置");
    const response = await fetch(opsConfig.bailian.transcriptionUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${opsConfig.bailian.apiKey}`,
        "content-type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model: opsConfig.bailian.transcriptionModel,
        input: { file_urls: [input.signedUrl] },
        parameters: { channel_id: [0], disfluency_removal_enabled: true },
      }),
    });
    const raw = map(await response.json().catch(() => ({})));
    if (!response.ok) throw new Error(`百炼转写提交失败：${response.status} ${text(raw.message)}`);
    const id = text(map(raw.output).task_id || raw.task_id);
    if (!id) throw new Error("百炼转写未返回任务编号");
    return { externalJobId: id, raw };
  }

  async pollTask(externalJobId: string): Promise<CloudPollResult> {
    const response = await fetch(`${opsConfig.bailian.taskUrl}/${encodeURIComponent(externalJobId)}`, {
      headers: { authorization: `Bearer ${opsConfig.bailian.apiKey}` },
    });
    const raw = map(await response.json().catch(() => ({})));
    if (!response.ok) return { status: "FAILED", raw, failureReason: `百炼任务查询失败：${response.status} ${text(raw.message)}` };
    const status = text(map(raw.output).task_status || raw.task_status).toUpperCase();
    if (["FAILED", "CANCELED", "UNKNOWN"].includes(status)) {
      return { status: "FAILED", raw, failureReason: text(map(raw.output).message || raw.message) || "百炼任务失败" };
    }
    if (!["SUCCEEDED", "SUCCESS"].includes(status)) return { status: "PROCESSING", raw };
    return { status: "SUCCEEDED", raw, usage: map(raw.usage) };
  }

  understandVideo(input: VideoUnderstandingInput) {
    return this.chat(input, "分析整条短视频，返回严格JSON");
  }

  analyzeSegment(input: VideoUnderstandingInput) {
    return this.chat(input, "分析候选片段的画面、字幕、节奏和可复用点，返回严格JSON");
  }

  classifyModule(input: VideoUnderstandingInput) {
    return this.chat(input, `从 ${MODULES.join(",")} 中分类，允许多个时间片段，返回严格JSON`);
  }

  scoreAsset(input: VideoUnderstandingInput) {
    return this.chat(
      input,
      input.external
        ? "按外部爆款参考评分：数据热度、前三秒、节奏、表达、可仿拍性和赛电产品匹配度，返回严格JSON"
        : "按自有素材初始评分：基础质量20%、内容价值50%、复用价值30%。基础质量含清晰度、完整性和技术问题；内容价值含前三秒、信息、情绪、产品展示和CTA；复用价值含模块独立性、平台适配和二次剪辑价值，返回严格JSON",
    );
  }

  generateRemakeBrief(input: VideoUnderstandingInput) {
    return this.chat(input, "生成赛电员工可执行的仿拍任务：目标、镜头表、口播、道具、产品适配、注意点，返回严格JSON");
  }

  private async chat(input: VideoUnderstandingInput, instruction: string): Promise<JsonMap> {
    if (!opsConfig.bailian.apiKey) throw new Error("百炼 API Key 未配置");
    const content: Array<Record<string, unknown>> = [];
    if (input.videoUrl) content.push({ type: "video_url", video_url: { url: input.videoUrl } });
    for (const url of input.frameUrls.slice(0, 12)) content.push({ type: "image_url", image_url: { url } });
    content.push({
      type: "text",
      text: `${instruction}。外部参考=${input.external}。标题=${input.title || ""}。转写=${(input.transcript || "").slice(0, 18000)}。
JSON结构：{"summary":"","modules":[{"type":"HOOK","startSecond":0,"endSecond":3,"confidence":0.9,"reason":""}],"products":[],"scenes":[],"audiences":[],"emotions":[],"features":[],"painPoints":[],"trafficMethods":[],"score":0,"grade":"S|A|B|C|D","dimensions":{"basicQuality":0,"contentValue":0,"reuseValue":0},"recommendation":"","remakeBrief":{}}。等级S=90-100、A=80-89、B=60-79、C=40-59、D<40。不得添加Markdown。`,
    });
    const response = await fetch(`${opsConfig.bailian.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${opsConfig.bailian.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: opsConfig.bailian.visionModel,
        temperature: 0.15,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content }],
      }),
    });
    const raw = map(await response.json().catch(() => ({})));
    if (!response.ok) throw new Error(`百炼视频理解失败：${response.status} ${text(raw.message || map(raw.error).message)}`);
    const choices = Array.isArray(raw.choices) ? raw.choices : [];
    const answer = map(map(choices[0]).message).content;
    const parsed = parseJsonText(answer);
    parsed._usage = map(raw.usage);
    parsed._model = text(raw.model) || opsConfig.bailian.visionModel;
    return parsed;
  }
}

@Injectable()
export class CloudMediaService {
  private readonly logger = new Logger(CloudMediaService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly oss: OssStorageService,
    private readonly ims: AliyunImsProvider,
    private readonly bailian: BailianVideoAiProvider,
  ) {}

  capabilities() {
    return {
      mode: opsConfig.ims.mode,
      region: opsConfig.ims.regionId,
      bucket: opsConfig.oss.bucket,
      ims: this.ims.capabilities(),
      bailian: this.bailian.capabilities(),
    };
  }

  async healthCapabilities() {
    const [oss, latestJobs, latestTextPlan] = await Promise.all([
      this.oss.healthCheck(),
      this.prisma.cloudMediaJob.findMany({
        orderBy: { updatedAt: "desc" },
        take: 200,
        select: {
          provider: true,
          type: true,
          status: true,
          completedAt: true,
          submittedAt: true,
          failureReason: true,
          updatedAt: true,
        },
      }),
      this.prisma.contentPlan.findFirst({
        where: { aiProvider: "ALIYUN_BAILIAN" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);
    const latest = (provider: CloudMediaProvider, types: CloudMediaJobType[]) => {
      const matching = latestJobs.filter((job) => job.provider === provider && types.includes(job.type));
      const success = matching.find((job) => job.status === "SUCCEEDED");
      const failed = matching.find((job) => job.status === "FAILED");
      return {
        lastSuccessAt: success?.completedAt?.toISOString() || null,
        recentError: failed?.failureReason || null,
      };
    };
    const imsConfigured = Boolean(opsConfig.ims.accessKeyId && opsConfig.ims.accessKeySecret);
    const bailianConfigured = Boolean(opsConfig.bailian.apiKey);
    const item = (configured: boolean, message: string, runtime?: { lastSuccessAt: string | null; recentError: string | null }) => ({
      state: configured ? "AVAILABLE" as const : "UNCONFIGURED" as const,
      message,
      lastSuccessAt: runtime?.lastSuccessAt || null,
      recentError: runtime?.recentError || null,
    });
    return {
      mode: opsConfig.ims.mode,
      region: opsConfig.ims.regionId,
      bucket: opsConfig.oss.bucket,
      items: {
        oss: {
          state: oss.ok ? "AVAILABLE" as const : "ERROR" as const,
          message: oss.message,
          lastSuccessAt: oss.ok ? new Date().toISOString() : null,
          recentError: oss.ok ? null : oss.message,
        },
        imsSubmit: item(imsConfigured, imsConfigured ? `IMS ${opsConfig.ims.regionId}` : "缺少IMS AccessKey", latest("ALIYUN_IMS", IMS_TYPES)),
        imsCallback: item(imsConfigured, imsConfigured ? "IMS回调接口已启用" : "缺少IMS AccessKey", latest("ALIYUN_IMS", IMS_TYPES)),
        bailianImage: item(bailianConfigured, bailianConfigured ? opsConfig.bailian.visionModel : "缺少百炼API Key", latest("ALIYUN_BAILIAN", ["VIDEO_UNDERSTANDING"])),
        bailianVideo: item(bailianConfigured, bailianConfigured ? opsConfig.bailian.visionModel : "缺少百炼API Key", latest("ALIYUN_BAILIAN", ["VIDEO_UNDERSTANDING"])),
        bailianTranscription: item(bailianConfigured, bailianConfigured ? opsConfig.bailian.transcriptionModel : "缺少百炼API Key", latest("ALIYUN_BAILIAN", ["TRANSCRIPTION"])),
        bailianText: {
          ...item(bailianConfigured, bailianConfigured ? opsConfig.bailian.textModel : "缺少百炼API Key"),
          lastSuccessAt: latestTextPlan?.createdAt.toISOString() || null,
        },
      },
      configured: this.capabilities(),
      checkedAt: new Date().toISOString(),
    };
  }

  async enqueueAssetVideo(assetId: string, analysisVersion: number) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset?.objectKey) throw new Error("视频尚未存入 OSS");
    await this.enqueueObject({
      assetId,
      objectKey: asset.objectKey,
      analysisVersion,
    });
    await this.prisma.asset.update({ where: { id: assetId }, data: { processingStatus: "ANALYZING" } });
    void this.process();
    return this.capabilities();
  }

  async enqueueExternalVideo(externalVideoId: string) {
    const video = await this.prisma.externalVideo.findUnique({ where: { id: externalVideoId } });
    if (!video?.sourceObjectKey) throw new Error("外部视频尚未导入深圳 OSS");
    await this.enqueueObject({ externalVideoId, objectKey: video.sourceObjectKey, analysisVersion: 1 });
    await this.prisma.externalVideo.update({ where: { id: externalVideoId }, data: { status: "ANALYZING" } });
    void this.process();
    return this.capabilities();
  }

  private async enqueueObject(input: { assetId?: string; externalVideoId?: string; objectKey: string; analysisVersion: number }) {
    const scope = input.assetId ? `asset:${input.assetId}` : `external:${input.externalVideoId}`;
    for (const type of [...IMS_TYPES, "TRANSCRIPTION"] as CloudMediaJobType[]) {
      const provider: CloudMediaProvider = type === "TRANSCRIPTION" ? "ALIYUN_BAILIAN" : "ALIYUN_IMS";
      const key = stableKey([scope, type, input.analysisVersion, input.objectKey]);
      const available = this.isAvailable(type);
      await this.prisma.cloudMediaJob.upsert({
        where: { idempotencyKey: key },
        update: available
          ? { status: "PENDING", attempts: 0, nextAttemptAt: null, failureReason: null }
          : { status: "UNCONFIGURED", failureReason: this.unconfiguredMessage(type) },
        create: {
          assetId: input.assetId,
          externalVideoId: input.externalVideoId,
          provider,
          type,
          status: available ? "PENDING" : "UNCONFIGURED",
          idempotencyKey: key,
          callbackToken: randomUUID(),
          inputObjectKey: input.objectKey,
          model: type === "TRANSCRIPTION" ? opsConfig.bailian.transcriptionModel : "IMS",
          modelVersion: String(input.analysisVersion),
          failureReason: available ? undefined : this.unconfiguredMessage(type),
        },
      });
    }
  }

  private isAvailable(type: CloudMediaJobType) {
    if (type === "TRANSCRIPTION" || type === "VIDEO_UNDERSTANDING") return Boolean(opsConfig.bailian.apiKey);
    const ims = this.ims.capabilities();
    if (type === "SCREENSHOTS") return ims.screenshots.state === "AVAILABLE";
    if (type === "PROXY_VIDEO") return ims.proxyVideo.state === "AVAILABLE";
    return ims.mediaInfo.state === "AVAILABLE";
  }

  private unconfiguredMessage(type: CloudMediaJobType) {
    if (type === "TRANSCRIPTION" || type === "VIDEO_UNDERSTANDING") return "百炼未配置";
    if (type === "SCREENSHOTS") return "IMS截图模板未配置";
    if (type === "PROXY_VIDEO") return "IMS代理视频模板未配置";
    return "IMS AccessKey 未配置";
  }

  @Cron("*/1 * * * *")
  async process() {
    if (this.running) return;
    this.running = true;
    try {
      const jobs = await this.prisma.cloudMediaJob.findMany({
        where: {
          status: { in: ["PENDING", "RETRY", "SUBMITTED", "PROCESSING"] },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
        },
        orderBy: { createdAt: "asc" },
        take: 4,
      });
      for (const job of jobs) {
        if (["SUBMITTED", "PROCESSING"].includes(job.status)) await this.poll(job.id);
        else await this.submit(job.id);
      }
    } finally {
      this.running = false;
    }
  }

  private async submit(id: string) {
    const job = await this.prisma.cloudMediaJob.findUnique({ where: { id } });
    if (!job?.inputObjectKey || !["PENDING", "RETRY"].includes(job.status)) return;
    const attempts = job.attempts + 1;
    await this.prisma.cloudMediaJob.update({
      where: { id },
      data: { status: "PROCESSING", attempts, startedAt: job.startedAt || new Date(), failureReason: null },
    });
    try {
      const input: CloudSubmitInput = {
        objectKey: job.inputObjectKey,
        signedUrl: this.oss.signedDownloadUrl(job.inputObjectKey, 7200),
        idempotencyKey: job.idempotencyKey,
        callbackToken: job.callbackToken,
        assetId: job.assetId || undefined,
        externalVideoId: job.externalVideoId || undefined,
      };
      let result: CloudSubmitResult;
      if (job.type === "MEDIA_INFO") result = await this.ims.submitVideoAnalysis(input);
      else if (job.type === "PROXY_VIDEO") result = await this.ims.submitProxyVideo(input);
      else if (job.type === "SCREENSHOTS") result = await this.ims.submitScreenshots(input);
      else if (job.type === "SEGMENTATION") result = await this.ims.submitSegmentation(input);
      else if (job.type === "TRANSCRIPTION") result = await this.bailian.transcribe(input);
      else throw new Error(`不支持提交任务 ${job.type}`);
      await this.prisma.cloudMediaJob.update({
        where: { id },
        data: {
          status: "SUBMITTED",
          externalJobId: result.externalJobId,
          requestPayload: json(result.raw),
          submittedAt: new Date(),
          nextAttemptAt: new Date(Date.now() + 30_000),
        },
      });
    } catch (error) {
      await this.retryOrFail(id, attempts, error);
    }
  }

  private async poll(id: string) {
    const job = await this.prisma.cloudMediaJob.findUnique({ where: { id } });
    if (!job?.externalJobId || !["SUBMITTED", "PROCESSING"].includes(job.status)) return;
    try {
      const result = job.provider === "ALIYUN_IMS"
        ? await this.ims.getJobStatus(job.type, job.externalJobId)
        : await this.bailian.pollTask(job.externalJobId);
      if (result.status === "PROCESSING") {
        await this.prisma.cloudMediaJob.update({
          where: { id },
          data: { status: "PROCESSING", resultPayload: json(result.raw), nextAttemptAt: new Date(Date.now() + 60_000) },
        });
        return;
      }
      if (result.status === "FAILED") throw new Error(result.failureReason || "云任务失败");
      await this.completeJob(id, result);
    } catch (error) {
      await this.retryOrFail(id, job.attempts, error);
    }
  }

  async handleCallback(callbackToken: string, payload: unknown) {
    const job = await this.prisma.cloudMediaJob.findUnique({ where: { callbackToken } });
    if (!job) throw new Error("回调任务不存在");
    const body = map(payload);
    const state = text(body.state || body.status).toLowerCase();
    if (["failed", "fail", "error"].includes(state)) {
      await this.retryOrFail(job.id, job.attempts, new Error(text(body.errorMessage || body.message) || "云端回调失败"));
      return { accepted: true, status: "FAILED" };
    }
    if (["finished", "success", "succeeded", "completed"].includes(state)) {
      await this.prisma.cloudMediaJob.update({
        where: { id: job.id },
        data: {
          status: "PROCESSING",
          resultPayload: json(body),
          nextAttemptAt: new Date(),
        },
      });
      return { accepted: true, status: "PROCESSING" };
    }
    await this.prisma.cloudMediaJob.update({ where: { id: job.id }, data: { status: "PROCESSING", resultPayload: json(body) } });
    return { accepted: true, status: "PROCESSING" };
  }

  private async completeJob(id: string, result: CloudPollResult) {
    const job = await this.prisma.cloudMediaJob.update({
      where: { id },
      data: {
        status: "SUCCEEDED",
        resultPayload: json(result.raw),
        usage: json(result.usage || {}),
        failureReason: null,
        nextAttemptAt: null,
        completedAt: new Date(),
      },
    });
    if (result.outputs?.length) {
      await this.prisma.cloudMediaOutput.deleteMany({ where: { jobId: id } });
      await this.prisma.cloudMediaOutput.createMany({
        data: result.outputs.map((output) => ({
          jobId: id,
          outputType: output.type,
          objectKey: output.objectKey || null,
          url: output.url || null,
          startSecond: output.startSecond,
          endSecond: output.endSecond,
          metadata: json(output.metadata || {}),
        })),
      });
    }
    if (job.type === "SEGMENTATION" && job.assetId) await this.persistSegments(job.assetId, result.outputs || []);
    await this.tryFinalize(job.assetId || undefined, job.externalVideoId || undefined);
  }

  private async persistSegments(assetId: string, outputs: NonNullable<CloudPollResult["outputs"]>) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId }, select: { analysisVersion: true } });
    if (!asset) return;
    for (const output of outputs.filter((item) => item.type === "SEGMENT")) {
      if (output.startSecond === undefined || output.endSecond === undefined || output.endSecond <= output.startSecond) continue;
      const existing = await this.prisma.assetSegment.findFirst({
        where: { assetId, analysisVersion: asset.analysisVersion, startSeconds: output.startSecond, endSeconds: output.endSecond },
      });
      if (!existing) {
        await this.prisma.assetSegment.create({
          data: {
            assetId,
            startSeconds: output.startSecond,
            endSeconds: output.endSecond,
            analysisVersion: asset.analysisVersion,
            previewObjectKey: output.objectKey,
            createdBy: "阿里云IMS",
          },
        });
      }
    }
  }

  private async tryFinalize(assetId?: string, externalVideoId?: string) {
    const where = assetId ? { assetId } : { externalVideoId };
    const jobs = await this.prisma.cloudMediaJob.findMany({ where });
    if (jobs.some((job) => ["PENDING", "SUBMITTED", "PROCESSING", "RETRY"].includes(job.status))) return;
    if (jobs.some((job) => job.status === "FAILED")) {
      if (assetId) await this.prisma.asset.update({ where: { id: assetId }, data: { processingStatus: "FAILED" } });
      if (externalVideoId) await this.prisma.externalVideo.update({ where: { id: externalVideoId }, data: { status: "FAILED", failureReason: "云端处理失败" } });
      return;
    }
    if (!jobs.some((job) => job.type === "VIDEO_UNDERSTANDING")) {
      await this.runUnderstanding(assetId, externalVideoId);
    }
  }

  private async runUnderstanding(assetId?: string, externalVideoId?: string) {
    if (!opsConfig.bailian.apiKey) return;
    const scope = assetId ? `asset:${assetId}` : `external:${externalVideoId}`;
    const parentJobs = await this.prisma.cloudMediaJob.findMany({
      where: assetId ? { assetId } : { externalVideoId },
      include: { outputs: true },
    });
    const source = assetId
      ? await this.prisma.asset.findUnique({ where: { id: assetId } })
      : await this.prisma.externalVideo.findUnique({ where: { id: externalVideoId! } });
    if (!source) return;
    const objectKey = assetId ? (source as { objectKey?: string | null }).objectKey : (source as { sourceObjectKey?: string | null }).sourceObjectKey;
    if (!objectKey) return;
    const key = stableKey([scope, "VIDEO_UNDERSTANDING", "v1", objectKey]);
    const cloud = await this.prisma.cloudMediaJob.upsert({
      where: { idempotencyKey: key },
      update: { status: "PROCESSING", startedAt: new Date(), failureReason: null },
      create: {
        assetId,
        externalVideoId,
        provider: "ALIYUN_BAILIAN",
        type: "VIDEO_UNDERSTANDING",
        status: "PROCESSING",
        idempotencyKey: key,
        callbackToken: randomUUID(),
        inputObjectKey: objectKey,
        model: opsConfig.bailian.visionModel,
        modelVersion: "v1",
        startedAt: new Date(),
      },
    });
    try {
      const transcriptJob = parentJobs.find((job) => job.type === "TRANSCRIPTION");
      const transcript = await this.extractTranscript(map(transcriptJob?.resultPayload));
      const frames = parentJobs
        .flatMap((job) => job.outputs)
        .filter((output) => output.outputType === "SCREENSHOT" && (output.objectKey || output.url))
        .map((output) => output.objectKey ? this.oss.signedDownloadUrl(output.objectKey, 3600) : output.url!)
        .slice(0, 12);
      const input: VideoUnderstandingInput = {
        videoUrl: this.oss.signedDownloadUrl(objectKey, 7200),
        frameUrls: frames,
        transcript,
        title: assetId ? (source as { displayName?: string | null; fileName?: string }).displayName || (source as { fileName?: string }).fileName : (source as { title?: string | null }).title || "",
        external: Boolean(externalVideoId),
      };
      const [understanding, classification, scoring] = await Promise.all([
        this.bailian.understandVideo(input),
        this.bailian.classifyModule(input),
        this.bailian.scoreAsset(input),
      ]);
      const merged = { ...understanding, ...classification, ...scoring };
      await this.prisma.cloudMediaJob.update({
        where: { id: cloud.id },
        data: { status: "SUCCEEDED", resultPayload: json(merged), usage: json(merged._usage || {}), completedAt: new Date() },
      });
      await this.applyUnderstanding(assetId, externalVideoId, merged, transcript, input);
    } catch (error) {
      await this.prisma.cloudMediaJob.update({
        where: { id: cloud.id },
        data: { status: "FAILED", failureReason: error instanceof Error ? error.message : "视频理解失败", completedAt: new Date() },
      });
      if (assetId) await this.prisma.asset.update({ where: { id: assetId }, data: { processingStatus: "FAILED" } });
      if (externalVideoId) await this.prisma.externalVideo.update({ where: { id: externalVideoId }, data: { status: "FAILED" } });
    }
  }

  private async extractTranscript(raw: JsonMap) {
    const results = Array.isArray(map(raw.output).results) ? map(raw.output).results as unknown[] : [];
    const direct: string[] = [];
    const urls: string[] = [];
    for (const result of results) {
      const value = map(result);
      const inline = text(value.text || value.transcript);
      if (inline) direct.push(inline);
      const urlValue = value.transcription_url || value.transcription_urls;
      if (Array.isArray(urlValue)) urls.push(...urlValue.map(text).filter(Boolean));
      else if (text(urlValue)) urls.push(text(urlValue));
    }
    for (const url of urls) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) continue;
        const payload = map(await response.json());
        const transcripts = Array.isArray(payload.transcripts) ? payload.transcripts : [];
        direct.push(
          ...transcripts
            .map((item) => text(map(item).text || map(item).transcript))
            .filter(Boolean),
        );
      } catch {
        // 转写结果地址短暂不可用时保留其他分析结果，后续可单独重试转写任务。
      }
    }
    return direct.join("\n");
  }

  private async applyUnderstanding(assetId: string | undefined, externalVideoId: string | undefined, result: JsonMap, transcript: string, input: VideoUnderstandingInput) {
    const score = Math.max(0, Math.min(100, Math.round(number(result.score) ?? 0)));
    const grade = text(result.grade) || (score >= 90 ? "S" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : "D");
    await this.prisma.assetScoreSnapshot.create({
      data: {
        assetId,
        externalVideoId,
        kind: externalVideoId ? "EXTERNAL_REFERENCE" : "OWNED_ASSET",
        score,
        grade,
        confidence: number(result.confidence),
        dimensions: json(result.dimensions || {}),
        explanation: text(result.recommendation || result.summary) || null,
        scoringVersion: "video-score-v1",
        model: opsConfig.bailian.visionModel,
      },
    });
    const modules = Array.isArray(result.modules) ? result.modules.map(map) : [];
    if (assetId) {
      for (const module of modules) {
        const moduleType = text(module.type).toUpperCase();
        const start = number(module.startSecond);
        const end = number(module.endSecond);
        if (!MODULES.includes(moduleType) || start === undefined || end === undefined || end <= start) continue;
        const existing = await this.prisma.assetSegment.findFirst({ where: { assetId, startSeconds: start, endSeconds: end } });
        if (existing && !existing.locked) {
          await this.prisma.assetSegment.update({
            where: { id: existing.id },
            data: { moduleType: moduleType as never, confidence: number(module.confidence), transcript: text(module.transcript) || undefined },
          });
        } else if (!existing) {
          const asset = await this.prisma.asset.findUnique({ where: { id: assetId }, select: { analysisVersion: true } });
          await this.prisma.assetSegment.create({
            data: {
              assetId,
              startSeconds: start,
              endSeconds: end,
              transcript: text(module.transcript) || null,
              moduleType: moduleType as never,
              confidence: number(module.confidence),
              analysisVersion: asset?.analysisVersion || 1,
              createdBy: "阿里云百炼",
            },
          });
        }
      }
      await this.prisma.asset.update({
        where: { id: assetId },
        data: {
          qualityScore: score,
          contentDescription: text(result.summary) || undefined,
          processingStatus: "READY_FOR_REVIEW",
          lastAnalysisAt: new Date(),
        },
      });
    }
    if (externalVideoId) {
      await this.prisma.externalVideo.update({
        where: { id: externalVideoId },
        data: {
          status: "READY",
          transcript,
          moduleSummary: json(modules),
          analysis: json(result),
          failureReason: null,
        },
      });
      const threshold = Number(process.env.VIRAL_REMAKE_SCORE_THRESHOLD || 80);
      if (score >= threshold) {
        const brief = await this.bailian.generateRemakeBrief(input);
        const existing = await this.prisma.remakeTask.findFirst({ where: { externalVideoId, status: { notIn: ["REJECTED", "CANCELLED"] } } });
        if (!existing) {
          await this.prisma.remakeTask.create({
            data: {
              taskNo: `RMT-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`,
              externalVideoId,
              title: text(brief.title) || `高分视频仿拍任务（${score}分）`,
              reason: text(result.recommendation || result.summary) || "外部参考视频达到仿拍阈值",
              brief: json(brief),
              score,
            },
          });
        }
      }
    }
  }

  private async retryOrFail(id: string, attempts: number, error: unknown) {
    const job = await this.prisma.cloudMediaJob.findUnique({ where: { id } });
    if (!job) return;
    const message = error instanceof Error ? error.message : "云任务失败";
    if (attempts >= job.maxAttempts) {
      await this.prisma.cloudMediaJob.update({ where: { id }, data: { status: "FAILED", failureReason: message, completedAt: new Date(), nextAttemptAt: null } });
    } else {
      const delay = RETRY_MINUTES[Math.min(Math.max(attempts - 1, 0), RETRY_MINUTES.length - 1)];
      await this.prisma.cloudMediaJob.update({
        where: { id },
        data: { status: "RETRY", failureReason: message, nextAttemptAt: new Date(Date.now() + delay * 60_000) },
      });
    }
    this.logger.warn(`${job.type} ${job.assetId || job.externalVideoId}: ${message}`);
  }

  async listJobs(params: { assetId?: string; externalVideoId?: string; status?: CloudMediaJobStatus; take?: number }) {
    return this.prisma.cloudMediaJob.findMany({
      where: {
        assetId: params.assetId,
        externalVideoId: params.externalVideoId,
        status: params.status,
      },
      include: { outputs: true },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(params.take || 50, 1), 200),
    });
  }

  async retryJob(id: string) {
    const job = await this.prisma.cloudMediaJob.update({
      where: { id },
      data: { status: "PENDING", attempts: 0, nextAttemptAt: null, failureReason: null, completedAt: null },
    });
    void this.process();
    return job;
  }

  async registerExternalVideo(input: {
    platform: IntegrationKind;
    externalContentId: string;
    sourceUrl: string;
    accountName?: string;
    title?: string;
    description?: string;
    publishedAt?: string;
    sourceObjectKey?: string;
    metrics?: JsonMap;
  }) {
    const video = await this.prisma.externalVideo.upsert({
      where: { platform_externalContentId: { platform: input.platform, externalContentId: input.externalContentId } },
      update: {
        sourceUrl: input.sourceUrl,
        accountName: input.accountName,
        title: input.title,
        description: input.description,
        publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
        sourceObjectKey: input.sourceObjectKey,
      },
      create: {
        platform: input.platform,
        externalContentId: input.externalContentId,
        sourceUrl: input.sourceUrl,
        accountName: input.accountName,
        title: input.title,
        description: input.description,
        publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
        sourceObjectKey: input.sourceObjectKey,
        level: AssetLevel.REFERENCE,
        rightsStatus: AssetRightsStatus.INTERNAL,
        availabilityStatus: "INACTIVE",
      },
    });
    if (input.metrics && Object.keys(input.metrics).length) {
      await this.prisma.externalMetricSnapshot.create({
        data: {
          externalVideoId: video.id,
          capturedAt: new Date(),
          views: number(input.metrics.views),
          likes: number(input.metrics.likes),
          comments: number(input.metrics.comments),
          shares: number(input.metrics.shares),
          saves: number(input.metrics.saves),
          unavailableFields: Array.isArray(input.metrics.unavailableFields) ? input.metrics.unavailableFields.map(text) : [],
          raw: json(input.metrics),
        },
      });
    }
    if (input.sourceObjectKey) await this.enqueueExternalVideo(video.id);
    return video;
  }

  async listExternalVideos(params: { platform?: IntegrationKind; status?: string; take?: number }) {
    return this.prisma.externalVideo.findMany({
      where: { platform: params.platform, status: params.status as never },
      include: {
        metrics: { orderBy: { capturedAt: "desc" }, take: 1 },
        scoreSnapshots: { orderBy: { createdAt: "desc" }, take: 1 },
        remakeTasks: { where: { status: { notIn: ["REJECTED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { discoveredAt: "desc" },
      take: Math.min(Math.max(params.take || 50, 1), 200),
    });
  }

  async listRemakeTasks(params: { status?: string; take?: number }) {
    return this.prisma.remakeTask.findMany({
      where: { status: params.status as never },
      include: { externalVideo: true, product: true, ownerEmployee: true },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take: Math.min(Math.max(params.take || 50, 1), 200),
    });
  }

  async updateRemakeTask(id: string, input: { status?: string; ownerEmployeeId?: string; productId?: string; dueAt?: string }) {
    return this.prisma.remakeTask.update({
      where: { id },
      data: {
        status: input.status as never,
        ownerEmployeeId: input.ownerEmployeeId,
        productId: input.productId,
        dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
        confirmedAt: input.status === "CONFIRMED" ? new Date() : undefined,
        completedAt: input.status === "COMPLETED" ? new Date() : undefined,
      },
    });
  }
}
