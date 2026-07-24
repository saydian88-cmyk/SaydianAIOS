import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { IntegrationKind, Prisma } from "@prisma/client";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { extname } from "node:path";
import { CloudMediaService } from "./cloud-media.service";
import { opsConfig } from "./config";
import { OssStorageService } from "./oss-storage.service";
import { PrismaService } from "./prisma.service";

const collectorPlatforms = [
  "DOUYIN",
  "TIKTOK",
  "XIAOHONGSHU",
  "WECHAT_CHANNELS",
] as const satisfies readonly IntegrationKind[];

type CollectorPlatform = (typeof collectorPlatforms)[number];
type FeedItem = {
  externalContentId: string;
  sourceUrl: string;
  downloadUrl?: string;
  accountName?: string;
  title?: string;
  description?: string;
  publishedAt?: string;
  metrics?: Record<string, unknown>;
};
type CollectorPublicConfig = {
  providerName: string;
  mode: "API" | "CSV" | "URL";
  endpoint: string;
  keywords: string[];
  competitorAccounts: string[];
  dailyLimit: number;
  enabled: boolean;
};
type FeedConfig = CollectorPublicConfig & {
  platform: CollectorPlatform;
  token?: string;
  lastSuccessAt?: Date | null;
  message?: string;
};

const defaultProviders: Record<CollectorPlatform, string> = {
  DOUYIN: "飞瓜数据 / 抖音开放平台",
  TIKTOK: "FastMoss / TikTok Display API",
  XIAOHONGSHU: "第三方企业数据 / Marketing API",
  WECHAT_CHANNELS: "友望数据 / 视频号助手",
};

const defaultEndpoints: Record<CollectorPlatform, string> = {
  DOUYIN: opsConfig.viralCollector.douyinUrl,
  TIKTOK: opsConfig.viralCollector.tiktokUrl,
  XIAOHONGSHU: opsConfig.viralCollector.xiaohongshuUrl,
  WECHAT_CHANNELS: opsConfig.viralCollector.wechatChannelsUrl,
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function optionalText(value: unknown) {
  const result = text(value);
  return result || undefined;
}

function dateText(value: unknown) {
  const raw = optionalText(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function integer(value: unknown) {
  const result = Number(String(value ?? "").replace(/[,\s]/gu, ""));
  return Number.isFinite(result) ? Math.max(0, Math.round(result)) : undefined;
}

function field(row: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    if (row[alias] !== undefined && text(row[alias])) return row[alias];
  }
  return undefined;
}

function splitList(value: unknown) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/[,，;；\n]/u).map((item) => item.trim()).filter(Boolean);
}

function csvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\"") {
      if (quoted && source[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function parseCollectorCsv(source: string): Array<Record<string, string>> {
  const rows = csvRows(source.replace(/^\uFEFF/u, ""));
  if (rows.length < 2) return [];
  const headers = rows[0].map((item) => item.trim());
  return rows.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? ""]),
  ));
}

function normalizeFeedItem(row: Record<string, unknown>): FeedItem | null {
  const sourceUrl = optionalText(field(row, ["sourceUrl", "url", "视频链接", "内容链接", "作品链接", "笔记链接", "链接"]));
  if (!sourceUrl) return null;
  const suppliedId = optionalText(field(row, ["externalContentId", "contentId", "videoId", "视频ID", "内容ID", "作品ID", "笔记ID"]));
  const externalContentId = suppliedId || createHash("sha256").update(sourceUrl).digest("hex").slice(0, 24);
  const metricAliases: Record<string, string[]> = {
    views: ["views", "playCount", "播放量", "观看量", "浏览量"],
    likes: ["likes", "likeCount", "点赞量", "点赞数"],
    comments: ["comments", "commentCount", "评论量", "评论数"],
    shares: ["shares", "shareCount", "分享量", "转发量"],
    saves: ["saves", "collectCount", "收藏量", "收藏数"],
    followers: ["followers", "followerCount", "粉丝数"],
  };
  const nestedMetrics = row.metrics && typeof row.metrics === "object" && !Array.isArray(row.metrics)
    ? row.metrics as Record<string, unknown>
    : {};
  const metrics = Object.fromEntries(Object.entries(metricAliases)
    .map(([key, aliases]) => [key, integer(field(row, aliases))])
    .filter(([, value]) => value !== undefined));
  return {
    externalContentId,
    sourceUrl,
    downloadUrl: optionalText(field(row, ["downloadUrl", "下载地址", "视频下载地址"])),
    accountName: optionalText(field(row, ["accountName", "author", "账号", "作者", "博主"])),
    title: optionalText(field(row, ["title", "标题", "作品标题", "笔记标题"])),
    description: optionalText(field(row, ["description", "desc", "内容说明", "正文"])),
    publishedAt: dateText(field(row, ["publishedAt", "publishTime", "发布时间", "发布日期"])),
    metrics: { ...nestedMetrics, ...metrics },
  };
}

@Injectable()
export class ViralCollectorService {
  private readonly logger = new Logger(ViralCollectorService.name);
  private collecting = false;

  constructor(
    private readonly cloudMedia: CloudMediaService,
    private readonly oss: OssStorageService,
    private readonly prisma: PrismaService,
  ) {}

  async capabilities() {
    const feeds = await this.feeds();
    return feeds.map((feed) => {
      const configured = Boolean(feed.endpoint || feed.mode === "CSV" || feed.mode === "URL");
      const state = !feed.enabled ? "UNCONFIGURED" : configured ? "CONFIGURED" : "UNCONFIGURED";
      return {
        platform: feed.platform,
        state,
        message: !feed.enabled
          ? "采集已停用"
          : feed.endpoint
            ? `${feed.providerName}已配置，按日串行采集`
            : "支持表格导入和链接补录，API采集源未配置",
        providerName: feed.providerName,
        mode: feed.mode,
        endpoint: feed.endpoint,
        keywords: feed.keywords,
        competitorAccounts: feed.competitorAccounts,
        dailyLimit: feed.dailyLimit,
        enabled: feed.enabled,
        tokenConfigured: Boolean(feed.token),
        lastSuccessAt: feed.lastSuccessAt,
      };
    });
  }

  async updateConfig(platformValue: string, input: Record<string, unknown>) {
    const platform = this.platform(platformValue);
    const integration = await this.ensureIntegration(platform);
    const current = this.publicConfig(integration.publicConfig);
    const next: CollectorPublicConfig = {
      providerName: text(input.providerName) || current.providerName,
      mode: ["API", "CSV", "URL"].includes(text(input.mode))
        ? text(input.mode) as CollectorPublicConfig["mode"]
        : current.mode,
      endpoint: text(input.endpoint),
      keywords: splitList(input.keywords),
      competitorAccounts: splitList(input.competitorAccounts),
      dailyLimit: Math.min(Math.max(integer(input.dailyLimit) || current.dailyLimit, 1), 200),
      enabled: input.enabled === undefined ? current.enabled : Boolean(input.enabled),
    };
    const token = text(input.token);
    await this.prisma.integration.update({
      where: { id: integration.id },
      data: {
        publicConfig: {
          ...(integration.publicConfig as Record<string, Prisma.JsonValue>),
          viralCollector: next,
        } as Prisma.InputJsonValue,
        secretRef: token ? this.encrypt(token) : integration.secretRef,
        state: next.enabled && (next.endpoint || next.mode !== "API") ? "CONFIGURED" : "UNCONFIGURED",
        message: next.endpoint ? `${next.providerName}采集源已配置` : "API采集源未配置，可使用导入和补录",
      },
    });
    return (await this.capabilities()).find((item) => item.platform === platform);
  }

  @Cron("0 30 5 * * *", { timeZone: "Asia/Shanghai" })
  async collectDaily() {
    return this.collect();
  }

  async collect(platformValue?: IntegrationKind) {
    if (this.collecting) return { running: true, results: [] };
    this.collecting = true;
    const results: Array<Record<string, unknown>> = [];
    try {
      const feeds = await this.feeds();
      for (const feed of feeds.filter((item) => !platformValue || item.platform === platformValue)) {
        if (!feed.enabled || !feed.endpoint) {
          results.push({ platform: feed.platform, state: "UNCONFIGURED", collected: 0 });
          continue;
        }
        try {
          const items = await this.fetchFeed(feed);
          const result = await this.importItems(feed.platform, items.slice(0, feed.dailyLimit), {
            sourceName: feed.providerName,
            actor: "每日爆款采集",
            provider: feed.providerName,
            mode: "API",
          });
          await this.markSuccess(feed.platform, result.imported);
          results.push({ platform: feed.platform, state: "SUCCEEDED", ...result });
        } catch (error) {
          const message = error instanceof Error ? error.message : "采集失败";
          this.logger.warn(`${feed.platform}: ${message}`);
          await this.markFailure(feed.platform, message);
          results.push({ platform: feed.platform, state: "FAILED", collected: 0, failureReason: message });
        }
      }
      return { running: false, results };
    } finally {
      this.collecting = false;
    }
  }

  async importCsv(platformValue: string, buffer: Buffer, sourceName: string, actor: string) {
    const platform = this.platform(platformValue);
    const rows = parseCollectorCsv(buffer.toString("utf8"));
    if (!rows.length) throw new Error("表格没有可导入的数据，请使用CSV模板");
    return this.importItems(platform, rows, {
      sourceName: sourceName || `${platform}-CSV`,
      actor,
      provider: "人工表格导入",
      mode: "CSV",
    });
  }

  async registerLink(input: Record<string, unknown>, actor: string) {
    const platform = this.platform(text(input.platform));
    const item = normalizeFeedItem(input);
    if (!item) throw new Error("请填写有效的内容链接");
    return this.importItems(platform, [item], {
      sourceName: `${platform}-链接补录`,
      actor,
      provider: "人工链接补录",
      mode: "URL",
    });
  }

  private async importItems(
    platform: CollectorPlatform,
    sourceRows: Array<FeedItem | Record<string, unknown>>,
    metadata: { sourceName: string; actor: string; provider: string; mode: string },
  ) {
    const integration = await this.ensureIntegration(platform);
    const batch = await this.prisma.importBatch.create({
      data: {
        integrationId: integration.id,
        kind: "VIRAL_VIDEO",
        format: metadata.mode,
        sourceName: metadata.sourceName,
        status: "RUNNING",
        importedBy: metadata.actor,
        unavailableFields: [],
        metadata: { provider: metadata.provider, acquisitionMethod: metadata.mode },
      },
    });
    let imported = 0;
    let rejected = 0;
    let submittedForAnalysis = 0;
    const errors: Array<{ row: number; message: string }> = [];
    for (const [index, sourceRow] of sourceRows.entries()) {
      const item = normalizeFeedItem(sourceRow as Record<string, unknown>);
      if (!item) {
        rejected += 1;
        errors.push({ row: index + 1, message: "缺少内容链接" });
        continue;
      }
      try {
        const sourceObjectKey = item.downloadUrl ? await this.importVideo(platform, item) : undefined;
        await this.cloudMedia.registerExternalVideo({
          platform,
          externalContentId: item.externalContentId,
          sourceUrl: item.sourceUrl,
          accountName: item.accountName,
          title: item.title,
          description: item.description,
          publishedAt: item.publishedAt,
          sourceObjectKey,
          metrics: {
            ...item.metrics,
            acquisitionMethod: metadata.mode,
            provider: metadata.provider,
            importBatchId: batch.id,
            unavailableFields: ["views", "likes", "comments", "shares", "saves"]
              .filter((key) => item.metrics?.[key] === undefined),
          },
        });
        imported += 1;
        if (sourceObjectKey) submittedForAnalysis += 1;
      } catch (error) {
        rejected += 1;
        errors.push({ row: index + 1, message: error instanceof Error ? error.message : "导入失败" });
      }
    }
    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: rejected ? imported ? "PARTIAL" : "FAILED" : "SUCCEEDED",
        recordsReceived: sourceRows.length,
        recordsImported: imported,
        recordsRejected: rejected,
        errors,
        completedAt: new Date(),
      },
    });
    return {
      batchId: batch.id,
      collected: sourceRows.length,
      imported,
      rejected,
      submittedForAnalysis,
      errors,
    };
  }

  private async feeds(): Promise<FeedConfig[]> {
    const integrations = await this.prisma.integration.findMany({
      where: { kind: { in: [...collectorPlatforms] } },
    });
    return collectorPlatforms.map((platform) => {
      const integration = integrations.find((item) => item.kind === platform);
      const config = this.publicConfig(integration?.publicConfig, platform);
      return {
        platform,
        ...config,
        token: integration?.secretRef ? this.decrypt(integration.secretRef) : opsConfig.viralCollector.token,
        lastSuccessAt: integration?.lastSuccessAt,
        message: integration?.message,
      };
    });
  }

  private publicConfig(value?: Prisma.JsonValue, platform: CollectorPlatform = "DOUYIN"): CollectorPublicConfig {
    const root = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const raw = root.viralCollector && typeof root.viralCollector === "object" && !Array.isArray(root.viralCollector)
      ? root.viralCollector as Record<string, unknown>
      : {};
    return {
      providerName: text(raw.providerName) || defaultProviders[platform],
      mode: ["API", "CSV", "URL"].includes(text(raw.mode))
        ? text(raw.mode) as CollectorPublicConfig["mode"]
        : "API",
      endpoint: text(raw.endpoint) || defaultEndpoints[platform],
      keywords: splitList(raw.keywords),
      competitorAccounts: splitList(raw.competitorAccounts),
      dailyLimit: Math.min(Math.max(integer(raw.dailyLimit) || opsConfig.viralCollector.maxPerPlatform, 1), 200),
      enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
    };
  }

  private async ensureIntegration(platform: CollectorPlatform) {
    return this.prisma.integration.upsert({
      where: { kind: platform },
      update: {},
      create: {
        kind: platform,
        displayName: platform,
        state: "UNCONFIGURED",
        capabilities: ["VIRAL_DISCOVERY", "METRIC_SNAPSHOT", "MANUAL_IMPORT"],
        message: "API采集源未配置，可使用导入和补录",
      },
    });
  }

  private async fetchFeed(feed: FeedConfig): Promise<FeedItem[]> {
    const url = new URL(feed.endpoint);
    if (feed.keywords.length && !url.searchParams.has("keywords")) url.searchParams.set("keywords", feed.keywords.join(","));
    if (feed.competitorAccounts.length && !url.searchParams.has("accounts")) url.searchParams.set("accounts", feed.competitorAccounts.join(","));
    if (!url.searchParams.has("limit")) url.searchParams.set("limit", String(feed.dailyLimit));
    const response = await fetch(url, {
      headers: feed.token ? { authorization: `Bearer ${feed.token}` } : {},
    });
    if (!response.ok) throw new Error(`采集源返回 ${response.status}`);
    const body = await response.json() as unknown;
    const source = Array.isArray(body)
      ? body
      : body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)
        ? (body as { items: unknown[] }).items
        : [];
    return source
      .map((item) => normalizeFeedItem(item as Record<string, unknown>))
      .filter((item): item is FeedItem => Boolean(item));
  }

  private async importVideo(platform: IntegrationKind, item: FeedItem): Promise<string> {
    const response = await fetch(item.downloadUrl!);
    if (!response.ok) throw new Error(`视频下载失败 ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > 200 * 1024 * 1024) throw new Error("外部视频超过200MB");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 200 * 1024 * 1024) throw new Error("外部视频超过200MB");
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const extension = extname(new URL(item.downloadUrl!).pathname) || ".mp4";
    const result = await this.oss.uploadBuffer({
      buffer,
      originalName: `${platform}-${item.externalContentId}${extension}`,
      sha256,
      extension,
      actor: "每日爆款采集",
      sourceType: `${platform}_REFERENCE`,
    });
    return result.objectKey;
  }

  private platform(value: string): CollectorPlatform {
    if (!collectorPlatforms.includes(value as CollectorPlatform)) throw new Error("不支持的平台");
    return value as CollectorPlatform;
  }

  private async markSuccess(platform: CollectorPlatform, count: number) {
    await this.prisma.integration.update({
      where: { kind: platform },
      data: {
        state: "HEALTHY",
        lastCheckedAt: new Date(),
        lastSuccessAt: new Date(),
        message: `最近采集成功，导入${count}条`,
      },
    });
  }

  private async markFailure(platform: CollectorPlatform, message: string) {
    await this.prisma.integration.update({
      where: { kind: platform },
      data: { state: "ERROR", lastCheckedAt: new Date(), message },
    });
  }

  private encryptionKey() {
    return createHash("sha256").update(opsConfig.authSecret).digest();
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return `enc:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
  }

  private decrypt(value: string) {
    if (!value.startsWith("enc:")) return value;
    try {
      const [, ivValue, tagValue, encryptedValue] = value.split(":");
      const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey(), Buffer.from(ivValue, "base64"));
      decipher.setAuthTag(Buffer.from(tagValue, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      return "";
    }
  }
}
