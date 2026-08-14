import { resolve } from "node:path";

function list(value?: string): string[] {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const opsConfig = {
  port: Number(process.env.PORT || 3210),
  host: process.env.OPS_HOST || "127.0.0.1",
  timeZone: process.env.OPS_TIME_ZONE || "Asia/Shanghai",
  adminToken: process.env.OPS_ADMIN_TOKEN || "saidian-ops-local",
  authSecret: process.env.OPS_AUTH_SECRET || process.env.OPS_ADMIN_TOKEN || "saidian-ops-local",
  adminUsername: process.env.OPS_ADMIN_USERNAME || process.env.MALL_ADMIN_USERNAME || "admin",
  adminPassword: process.env.OPS_ADMIN_PASSWORD || process.env.MALL_ADMIN_PASSWORD || "",
  defaultActor: process.env.OPS_DEFAULT_ACTOR || "运营负责人",
  publicBaseUrl: process.env.OPS_PUBLIC_BASE_URL || "http://127.0.0.1:3210",
  webBaseUrl: process.env.OPS_WEB_BASE_URL || "http://127.0.0.1:5173/saidian-work/",
  adminWebBaseUrl: process.env.OPS_ADMIN_WEB_BASE_URL || "http://127.0.0.1:5173/saidian-admin/",
  aiVideo: {
    url: process.env.AI_VIDEO_URL || "",
    password: process.env.AI_VIDEO_PASSWORD || "",
  },
  assetRoots: list(process.env.ASSET_ROOTS || "F:\\xcodeplace\\视频创作\\赛电品牌素材库;F:\\xcodeplace\\.赛电产品图片整理_20260626"),
  wecomDriveRoot: process.env.WECOM_DRIVE_SYNC_ROOT?.trim() || "",
  derivedOutputDir: resolve(
    process.env.DERIVED_OUTPUT_DIR || resolve(process.cwd(), "data", "derived"),
  ),
  bootstrapDataDir: resolve(
    process.env.BOOTSTRAP_DATA_DIR || resolve(process.cwd(), "data", "bootstrap"),
  ),
  helpCenterContentUrl:
    process.env.HELP_CENTER_CONTENT_URL || "https://kf.saydian.cn/api/content",
  mall: {
    baseUrl:
      process.env.MALL_BASE_URL || "https://stest.saydian.cn/api/saidian-mall/v1",
    username: process.env.MALL_ADMIN_USERNAME || "",
    password: process.env.MALL_ADMIN_PASSWORD || "",
  },
  jushuitan: {
    operationDataUrl: process.env.JUSHUITAN_OPERATION_DATA_URL || "",
    operationDataToken: process.env.JUSHUITAN_OPERATION_DATA_TOKEN || "",
    operationDataMethod: (process.env.JUSHUITAN_OPERATION_DATA_METHOD || "POST").toUpperCase(),
  },
  wecomWebhookUrl: process.env.WECOM_WEBHOOK_URL || "",
  oss: {
    region: process.env.OSS_REGION || "oss-cn-shenzhen",
    bucket: process.env.OSS_BUCKET || "saidian-brand-assets-prod-sz",
    endpoint: process.env.OSS_ENDPOINT || "oss-cn-shenzhen.aliyuncs.com",
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || "",
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || "",
    prefix: (process.env.OSS_PREFIX || "brand-assets").replace(/^\/+|\/+$/g, ""),
  },
  bailian: {
    apiKey: process.env.BAILIAN_API_KEY || "",
    baseUrl: (process.env.BAILIAN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/u, ""),
    visionModel: process.env.BAILIAN_VISION_MODEL || "qwen-vl-max",
    textModel: process.env.BAILIAN_TEXT_MODEL || "qwen-plus",
    transcriptionUrl:
      process.env.BAILIAN_TRANSCRIPTION_URL ||
      "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription",
    transcriptionModel: process.env.BAILIAN_TRANSCRIPTION_MODEL || "paraformer-v2",
    taskUrl:
      process.env.BAILIAN_TASK_URL ||
      "https://dashscope.aliyuncs.com/api/v1/tasks",
    videoGenerationUrl:
      process.env.BAILIAN_VIDEO_GENERATION_URL ||
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
    textToVideoModel: process.env.BAILIAN_TEXT_TO_VIDEO_MODEL || "wan2.5-t2v-preview",
    imageToVideoModel: process.env.BAILIAN_IMAGE_TO_VIDEO_MODEL || "wan2.5-i2v-preview",
  },
  ims: {
    regionId: process.env.ALIYUN_IMS_REGION_ID || "cn-shenzhen",
    accessKeyId: process.env.ALIYUN_IMS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID || "",
    accessKeySecret:
      process.env.ALIYUN_IMS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET || "",
    endpoint: process.env.ALIYUN_IMS_ENDPOINT || "ice.cn-shenzhen.aliyuncs.com",
    pipelineId: process.env.ALIYUN_IMS_PIPELINE_ID || "",
    proxyTemplateId: process.env.ALIYUN_IMS_PROXY_TEMPLATE_ID || "",
    snapshotTemplateId: process.env.ALIYUN_IMS_SNAPSHOT_TEMPLATE_ID || "",
    callbackBaseUrl:
      process.env.ALIYUN_IMS_CALLBACK_BASE_URL ||
      `${process.env.OPS_PUBLIC_BASE_URL || "http://127.0.0.1:3210"}/api/v1/brand-data/cloud/callbacks`,
    mode: (process.env.MEDIA_PROCESSING_MODE || "cloud").toLowerCase(),
  },
  viralCollector: {
    douyinUrl: process.env.VIRAL_COLLECTOR_DOUYIN_URL || "",
    tiktokUrl: process.env.VIRAL_COLLECTOR_TIKTOK_URL || "",
    xiaohongshuUrl: process.env.VIRAL_COLLECTOR_XIAOHONGSHU_URL || "",
    wechatChannelsUrl: process.env.VIRAL_COLLECTOR_WECHAT_CHANNELS_URL || "",
    token: process.env.VIRAL_COLLECTOR_TOKEN || "",
    maxPerPlatform: Number(process.env.VIRAL_COLLECTOR_MAX_PER_PLATFORM || 20),
  },
  douyin: {
    clientKey: process.env.DOUYIN_CLIENT_KEY || "",
    clientSecret: process.env.DOUYIN_CLIENT_SECRET || "",
    openId: process.env.DOUYIN_OPEN_ID || "",
    accessToken: process.env.DOUYIN_ACCESS_TOKEN || "",
  },
  videoRenderCommand: process.env.VIDEO_RENDER_COMMAND || "",
};
