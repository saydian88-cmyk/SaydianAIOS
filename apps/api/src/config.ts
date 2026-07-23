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
  defaultActor: process.env.OPS_DEFAULT_ACTOR || "运营负责人",
  publicBaseUrl: process.env.OPS_PUBLIC_BASE_URL || "http://127.0.0.1:3210",
  webBaseUrl: process.env.OPS_WEB_BASE_URL || "http://127.0.0.1:5173/",
  assetRoots: list(process.env.ASSET_ROOTS || "F:\\xcodeplace\\视频创作\\赛电品牌素材库"),
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
    transcriptionUrl: process.env.BAILIAN_TRANSCRIPTION_URL || "",
    transcriptionModel: process.env.BAILIAN_TRANSCRIPTION_MODEL || "",
  },
  douyin: {
    clientKey: process.env.DOUYIN_CLIENT_KEY || "",
    clientSecret: process.env.DOUYIN_CLIENT_SECRET || "",
    openId: process.env.DOUYIN_OPEN_ID || "",
    accessToken: process.env.DOUYIN_ACCESS_TOKEN || "",
  },
  videoRenderCommand: process.env.VIDEO_RENDER_COMMAND || "",
};
