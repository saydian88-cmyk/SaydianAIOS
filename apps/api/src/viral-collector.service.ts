import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { IntegrationKind, Prisma } from "@prisma/client";
import {
  createHash,
} from "node:crypto";
import { extname } from "node:path";
import { CloudMediaService } from "./cloud-media.service";
import { opsConfig } from "./config";
import { OssStorageService } from "./oss-storage.service";
import { PrismaService } from "./prisma.service";
import { readIntegrationSecret, writeIntegrationSecret } from "./integration-secret";

const collectorPlatforms = [
  "DOUYIN",
  "TIKTOK",
  "XIAOHONGSHU",
  "WECHAT_CHANNELS",
] as const satisfies readonly IntegrationKind[];

const douyinSearchEndpoint = "https://open.douyin.com/dy_open_api/v2/search/video/";
const tikHubSearchEndpoint = "https://api.tikhub.io/api/v1/douyin/search/fetch_video_search_v2";
const tikHubDetailEndpoint = "https://api.tikhub.io/api/v1/douyin/app/v3/fetch_one_video";
const defaultSelfHostedBaseUrl = text(process.env.DOUYIN_SELF_HOSTED_BASE_URL);
const douyinDefaultKeywords = ["智能手表", "血压手表", "健康手表", "智能戒指", "老人手表"];
const resolverRetryMinutes = [1, 5, 30];

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
  officialEnabled: boolean;
  tikHubEnabled: boolean;
  selfHostedEnabled: boolean;
  selfHostedBaseUrl: string;
  selfHostedSearchUrl: string;
  resolveLimit: number;
  analysisLimit: number;
};
type FeedConfig = CollectorPublicConfig & {
  platform: CollectorPlatform;
  token?: string;
  tikHubApiKey?: string;
  selfHostedToken?: string;
  officialConfigured?: boolean;
  lastSuccessAt?: Date | null;
  message?: string;
  capabilityStatus?: Record<string, unknown>;
};

const defaultProviders: Record<CollectorPlatform, string> = {
  DOUYIN: "抖音开放平台视频搜索",
  TIKTOK: "FastMoss / TikTok Display API",
  XIAOHONGSHU: "第三方企业数据 / Marketing API",
  WECHAT_CHANNELS: "友望数据 / 视频号助手",
};

const defaultEndpoints: Record<CollectorPlatform, string> = {
  DOUYIN: opsConfig.viralCollector.douyinUrl || douyinSearchEndpoint,
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

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function parseDouyinSearchItems(body: unknown, keyword: string): FeedItem[] {
  const root = object(body);
  const payload = object(object(root.data).data);
  const videos = Array.isArray(payload.video_list) ? payload.video_list : [];
  return videos.flatMap((value): FeedItem[] => {
    const video = object(value);
    const statistics = object(video.statistics);
    const itemId = text(video.item_id);
    const sourceUrl = text(video.link) || (itemId ? `https://www.douyin.com/video/${itemId}` : "");
    const createdAt = integer(video.create_time);
    if (!itemId || !sourceUrl) return [];
    return [{
      externalContentId: itemId,
      sourceUrl,
      accountName: optionalText(video.nickname),
      title: optionalText(video.title),
      description: optionalText(video.title),
      publishedAt: createdAt ? new Date(createdAt * 1000).toISOString() : undefined,
      metrics: {
        likes: integer(statistics.digg_count),
        cover: optionalText(video.cover),
        avatar: optionalText(video.avatar),
        keyword,
        searchId: optionalText(payload.search_id),
      },
    }];
  });
}

function urlFrom(value: unknown): string | undefined {
  if (typeof value === "string" && /^https?:\/\//iu.test(value)) return value;
  if (Array.isArray(value)) {
    return value.map(urlFrom).find(Boolean);
  }
  if (!value || typeof value !== "object") return undefined;
  const source = object(value);
  return [
    source.url_list,
    source.urlList,
    source.url,
    source.play_url,
    source.playUrl,
    source.uri,
  ].map(urlFrom).find(Boolean);
}

export function parseDouyinProviderItems(body: unknown, keyword = ""): FeedItem[] {
  const collected = new Map<string, FeedItem>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 7 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const raw = object(value);
    const video = Object.keys(object(raw.aweme_info)).length ? object(raw.aweme_info) : raw;
    const itemId = text(video.aweme_id || video.item_id || video.itemId);
    if (itemId) {
      const author = object(video.author);
      const statistics = object(video.statistics);
      const videoInfo = object(video.video);
      const downloadUrl = [
        videoInfo.play_addr,
        videoInfo.play_addr_h264,
        videoInfo.download_addr,
        video.play_addr,
        video.download_addr,
        video.play_url,
      ].map(urlFrom).find(Boolean);
      const sourceUrl = text(
        video.share_url
        || object(video.share_info).share_url
        || raw.share_url,
      ) || `https://www.douyin.com/video/${itemId}`;
      const createdAt = integer(video.create_time);
      const previous = collected.get(itemId);
      collected.set(itemId, {
        externalContentId: itemId,
        sourceUrl,
        downloadUrl: downloadUrl || previous?.downloadUrl,
        accountName: optionalText(author.nickname || video.nickname || previous?.accountName),
        title: optionalText(video.desc || video.title || previous?.title),
        description: optionalText(video.desc || video.title || previous?.description),
        publishedAt: createdAt
          ? new Date(createdAt * 1000).toISOString()
          : previous?.publishedAt,
        metrics: {
          ...previous?.metrics,
          views: integer(statistics.play_count || statistics.playCount),
          likes: integer(statistics.digg_count || statistics.diggCount),
          comments: integer(statistics.comment_count || statistics.commentCount),
          shares: integer(statistics.share_count || statistics.shareCount),
          saves: integer(statistics.collect_count || statistics.collectCount),
          cover: urlFrom(object(videoInfo.cover).url_list || videoInfo.cover),
          keyword,
        },
      });
    }
    for (const nested of Object.values(raw)) visit(nested, depth + 1);
  };
  visit(body, 0);
  return [...collected.values()];
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
      const configured = feed.platform === "DOUYIN"
        ? Boolean(
          (feed.officialEnabled && feed.officialConfigured)
          || (feed.tikHubEnabled && feed.tikHubApiKey)
          || (feed.selfHostedEnabled && (feed.selfHostedSearchUrl || feed.selfHostedBaseUrl)),
        )
        : Boolean(feed.endpoint || feed.mode === "CSV" || feed.mode === "URL");
      const state = !feed.enabled ? "UNCONFIGURED" : configured ? "CONFIGURED" : "UNCONFIGURED";
      const recorded = object(feed.capabilityStatus?.viralCollectorProviders);
      const providerStatus = (key: string, available: boolean, configuredMessage: string, missingMessage: string) => {
        const status = object(recorded[key]);
        return {
          state: text(status.state) || (available ? "CONFIGURED" : "UNCONFIGURED"),
          message: text(status.message) || (available ? configuredMessage : missingMessage),
          lastSuccessAt: optionalText(status.lastSuccessAt),
          lastError: optionalText(status.lastError),
        };
      };
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
        resolveLimit: feed.resolveLimit,
        analysisLimit: feed.analysisLimit,
        enabled: feed.enabled,
        tokenConfigured: Boolean(feed.token),
        lastSuccessAt: feed.lastSuccessAt,
        ...(feed.platform === "DOUYIN" ? {
          officialEnabled: feed.officialEnabled,
          tikHubEnabled: feed.tikHubEnabled,
          selfHostedEnabled: feed.selfHostedEnabled,
          selfHostedBaseUrl: feed.selfHostedBaseUrl,
          selfHostedSearchUrl: feed.selfHostedSearchUrl,
          tikHubKeyConfigured: Boolean(feed.tikHubApiKey),
          selfHostedTokenConfigured: Boolean(feed.selfHostedToken),
          providers: {
            officialSearch: providerStatus(
              "officialSearch",
              Boolean(feed.officialEnabled && feed.officialConfigured),
              "抖音开放平台应用已配置",
              "抖音开放平台应用密钥未配置",
            ),
            selfHosted: providerStatus(
              "selfHosted",
              Boolean(feed.selfHostedEnabled && (feed.selfHostedSearchUrl || feed.selfHostedBaseUrl)),
              "自建采集渠道已配置",
              "自建采集地址未配置",
            ),
            tikHub: providerStatus(
              "tikHub",
              Boolean(feed.tikHubEnabled && feed.tikHubApiKey),
              "TikHub密钥已配置",
              "TikHub Key未配置",
            ),
            mediaResolution: providerStatus(
              "mediaResolution",
              Boolean(
                (feed.selfHostedEnabled && feed.selfHostedBaseUrl)
                || (feed.tikHubEnabled && feed.tikHubApiKey),
              ),
              "媒体解析渠道可用",
              "自建解析地址和TikHub Key均未配置",
            ),
          },
        } : {}),
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
      endpoint: input.endpoint === undefined ? current.endpoint : text(input.endpoint),
      keywords: input.keywords === undefined ? current.keywords : splitList(input.keywords),
      competitorAccounts: input.competitorAccounts === undefined
        ? current.competitorAccounts
        : splitList(input.competitorAccounts),
      dailyLimit: Math.min(Math.max(integer(input.dailyLimit) || current.dailyLimit, 1), 200),
      enabled: input.enabled === undefined ? current.enabled : Boolean(input.enabled),
      officialEnabled: input.officialEnabled === undefined
        ? current.officialEnabled
        : Boolean(input.officialEnabled),
      tikHubEnabled: input.tikHubEnabled === undefined
        ? current.tikHubEnabled
        : Boolean(input.tikHubEnabled),
      selfHostedEnabled: input.selfHostedEnabled === undefined
        ? current.selfHostedEnabled
        : Boolean(input.selfHostedEnabled),
      selfHostedBaseUrl: input.selfHostedBaseUrl === undefined
        ? current.selfHostedBaseUrl
        : text(input.selfHostedBaseUrl).replace(/\/+$/u, ""),
      selfHostedSearchUrl: input.selfHostedSearchUrl === undefined
        ? current.selfHostedSearchUrl
        : text(input.selfHostedSearchUrl),
      resolveLimit: Math.min(Math.max(integer(input.resolveLimit) || current.resolveLimit, 1), 50),
      analysisLimit: Math.min(Math.max(integer(input.analysisLimit) || current.analysisLimit, 1), 20),
    };
    next.analysisLimit = Math.min(next.analysisLimit, next.resolveLimit);
    const token = optionalText(input.token);
    const tikHubApiKey = optionalText(input.tikHubApiKey);
    const selfHostedCollectorToken = optionalText(input.selfHostedToken);
    const secrets = readIntegrationSecret(integration.secretRef);
    const nextSecrets = {
      ...secrets,
      ...(token ? { viralCollectorToken: token } : {}),
      ...(tikHubApiKey ? { tikhubApiKey: tikHubApiKey } : {}),
      ...(selfHostedCollectorToken ? { selfHostedCollectorToken } : {}),
    };
    const douyinConfigured = platform !== "DOUYIN" || Boolean(
      (next.officialEnabled && (object(object(integration.publicConfig).douyinOAuth).clientKey || opsConfig.douyin.clientKey))
      || (next.tikHubEnabled && (nextSecrets.tikhubApiKey))
      || (next.selfHostedEnabled && (next.selfHostedSearchUrl || next.selfHostedBaseUrl)),
    );
    await this.prisma.integration.update({
      where: { id: integration.id },
      data: {
        publicConfig: {
          ...(integration.publicConfig as Record<string, Prisma.JsonValue>),
          viralCollector: next,
        } as Prisma.InputJsonValue,
        secretRef: writeIntegrationSecret(nextSecrets),
        state: next.enabled && douyinConfigured && (platform === "DOUYIN" || next.endpoint || next.mode !== "API")
          ? "CONFIGURED"
          : "UNCONFIGURED",
        message: platform === "DOUYIN"
          ? douyinConfigured ? "抖音多渠道采集已配置" : "抖音采集渠道未配置"
          : next.endpoint ? `${next.providerName}采集源已配置` : "API采集源未配置，可使用导入和补录",
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
        const hasDouyinChannel = feed.platform === "DOUYIN" && Boolean(
          (feed.officialEnabled && feed.officialConfigured)
          || (feed.tikHubEnabled && feed.tikHubApiKey)
          || (feed.selfHostedEnabled && (feed.selfHostedSearchUrl || feed.selfHostedBaseUrl)),
        );
        if (!feed.enabled || (!feed.endpoint && !hasDouyinChannel)) {
          results.push({ platform: feed.platform, state: "UNCONFIGURED", collected: 0 });
          continue;
        }
        try {
          const items = await this.fetchFeed(feed);
          const result = await this.importItems(feed.platform, items.slice(0, feed.dailyLimit), {
            sourceName: feed.providerName,
            actor: "每日爆款采集",
            provider: feed.platform === "DOUYIN" ? "抖音多渠道采集" : feed.providerName,
            mode: "API",
            resolveLimit: feed.resolveLimit,
            analysisLimit: feed.analysisLimit,
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
    const feed = platform === "DOUYIN"
      ? (await this.feeds()).find((item) => item.platform === platform)
      : undefined;
    return this.importItems(platform, rows, {
      sourceName: sourceName || `${platform}-CSV`,
      actor,
      provider: "人工表格导入",
      mode: "CSV",
      resolveLimit: feed?.resolveLimit,
      analysisLimit: feed?.analysisLimit,
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
      resolveLimit: platform === "DOUYIN" ? 1 : undefined,
      analysisLimit: platform === "DOUYIN" ? 1 : undefined,
    });
  }

  async testProvider(platformValue: string, providerValue: string) {
    const platform = this.platform(platformValue);
    if (platform !== "DOUYIN") throw new Error("本次仅支持测试抖音采集渠道");
    const feed = (await this.feeds()).find((item) => item.platform === platform)!;
    const provider = text(providerValue).toUpperCase();
    if (provider === "OFFICIAL") {
      const items = await this.fetchDouyinSearch({ ...feed, dailyLimit: 1 });
      await this.updateProviderCapability("officialSearch", "HEALTHY", `官方搜索连接成功，返回${items.length}条`);
      return { provider, state: "HEALTHY", count: items.length };
    }
    if (provider === "SELF_HOSTED") {
      if (feed.selfHostedSearchUrl) {
        const items = await this.fetchSelfHostedSearch({ ...feed, dailyLimit: 1 });
        await this.updateProviderCapability("selfHosted", "HEALTHY", `自建搜索连接成功，返回${items.length}条`);
        return { provider, state: "HEALTHY", count: items.length };
      }
      const video = await this.prisma.externalVideo.findFirst({
        where: { platform: "DOUYIN" },
        orderBy: { discoveredAt: "desc" },
      });
      if (!video) {
        if (!feed.selfHostedBaseUrl) throw new Error("自建解析地址未配置");
        await this.fetchProviderJson(
          new URL(`${feed.selfHostedBaseUrl}/openapi.json`),
          feed.selfHostedToken,
          "自建解析服务",
        );
        await this.updateProviderCapability("selfHosted", "HEALTHY", "自建解析服务连接成功，等待视频链接验证");
        return { provider, state: "HEALTHY", count: 0 };
      }
      const item = await this.resolveViaSelfHosted(feed, video.externalContentId);
      await this.updateProviderCapability("selfHosted", "HEALTHY", "自建媒体解析连接成功");
      return { provider, state: "HEALTHY", count: item.downloadUrl ? 1 : 0 };
    }
    if (provider === "TIKHUB") {
      const items = await this.fetchTikHubSearch({ ...feed, dailyLimit: 1 });
      await this.updateProviderCapability("tikHub", "HEALTHY", `TikHub连接成功，返回${items.length}条`);
      return { provider, state: "HEALTHY", count: items.length };
    }
    throw new Error("不支持的抖音采集渠道");
  }

  async resolveReference(externalVideoId: string, analyze = true) {
    const video = await this.prisma.externalVideo.findUnique({ where: { id: externalVideoId } });
    if (!video || video.platform !== "DOUYIN") throw new Error("抖音参考视频不存在");
    if (video.sourceObjectKey) {
      if (analyze) await this.cloudMedia.enqueueExternalVideo(video.id);
      return { alreadyResolved: true, externalVideoId: video.id };
    }
    const job = await this.enqueueResolveJob(video.id, analyze);
    void this.processResolveJobs();
    return job;
  }

  async listResolveJobs(take = 50) {
    return this.prisma.viralMediaResolveJob.findMany({
      include: { externalVideo: true },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(take, 1), 200),
    });
  }

  async retryResolveJob(jobId: string) {
    const job = await this.prisma.viralMediaResolveJob.update({
      where: { id: jobId },
      data: {
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: null,
        failureReason: null,
        completedAt: null,
      },
    });
    await this.prisma.externalVideo.update({
      where: { id: job.externalVideoId },
      data: { status: "DISCOVERED", failureReason: null },
    });
    void this.processResolveJobs();
    return job;
  }

  private async importItems(
    platform: CollectorPlatform,
    sourceRows: Array<FeedItem | Record<string, unknown>>,
    metadata: {
      sourceName: string;
      actor: string;
      provider: string;
      mode: string;
      resolveLimit?: number;
      analysisLimit?: number;
    },
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
        const sourceObjectKey = item.downloadUrl && (platform !== "DOUYIN" || metadata.mode !== "API")
          ? await this.importVideo(platform, item)
          : undefined;
        const video = await this.cloudMedia.registerExternalVideo({
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
        if (platform === "DOUYIN" && !video.sourceObjectKey && index < (metadata.resolveLimit || 0)) {
          const analyze = index < (metadata.analysisLimit || 0);
          await this.enqueueResolveJob(video.id, analyze);
          if (analyze) submittedForAnalysis += 1;
        } else if (sourceObjectKey) {
          submittedForAnalysis += 1;
        }
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
      const secrets = readIntegrationSecret(integration?.secretRef);
      const oauth = object(object(integration?.publicConfig).douyinOAuth);
      return {
        platform,
        ...config,
        token: secrets.viralCollectorToken || opsConfig.viralCollector.token,
        tikHubApiKey: secrets.tikhubApiKey,
        selfHostedToken: secrets.selfHostedCollectorToken,
        officialConfigured: Boolean(
          (text(oauth.clientKey) || opsConfig.douyin.clientKey)
          && (text(secrets.douyin?.clientSecret) || opsConfig.douyin.clientSecret),
        ),
        lastSuccessAt: integration?.lastSuccessAt,
        message: integration?.message,
        capabilityStatus: object(integration?.capabilityStatus),
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
      officialEnabled: raw.officialEnabled === undefined ? true : Boolean(raw.officialEnabled),
      tikHubEnabled: raw.tikHubEnabled === undefined ? true : Boolean(raw.tikHubEnabled),
      selfHostedEnabled: raw.selfHostedEnabled === undefined ? true : Boolean(raw.selfHostedEnabled),
      selfHostedBaseUrl: text(raw.selfHostedBaseUrl) || (platform === "DOUYIN" ? defaultSelfHostedBaseUrl : ""),
      selfHostedSearchUrl: text(raw.selfHostedSearchUrl),
      resolveLimit: Math.min(Math.max(integer(raw.resolveLimit) || 5, 1), 50),
      analysisLimit: Math.min(Math.max(integer(raw.analysisLimit) || 3, 1), 20),
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
    if (feed.platform === "DOUYIN") return this.fetchDouyinCascade(feed);
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

  private async fetchDouyinCascade(feed: FeedConfig) {
    const errors: string[] = [];
    if (feed.officialEnabled && feed.officialConfigured) {
      try {
        const items = await this.fetchDouyinSearch(feed);
        await this.updateProviderCapability("officialSearch", "HEALTHY", `官方搜索成功，发现${items.length}条`);
        if (items.length) return items.map((item) => ({
          ...item,
          metrics: { ...item.metrics, discoveryProvider: "DOUYIN_OFFICIAL" },
        }));
        errors.push("官方搜索未返回视频");
      } catch (error) {
        const message = error instanceof Error ? error.message : "官方搜索失败";
        const permission = /权限|scope|permission|不存在|not exist/iu.test(message);
        await this.updateProviderCapability(
          "officialSearch",
          permission ? "WAITING_PERMISSION" : "ERROR",
          permission ? "等待抖音视频搜索权限审批" : "官方搜索失败",
          message,
        );
        errors.push(message);
      }
    }

    if (feed.selfHostedEnabled && feed.selfHostedSearchUrl) {
      try {
        const items = await this.fetchSelfHostedSearch(feed);
        await this.updateProviderCapability("selfHosted", "HEALTHY", `自建搜索成功，发现${items.length}条`);
        if (items.length) return items.map((item) => ({
          ...item,
          metrics: { ...item.metrics, discoveryProvider: "SELF_HOSTED" },
        }));
        errors.push("自建搜索未返回视频");
      } catch (error) {
        const message = error instanceof Error ? error.message : "自建搜索失败";
        await this.updateProviderCapability("selfHosted", "ERROR", "自建搜索失败", message);
        errors.push(message);
      }
    }

    if (feed.tikHubEnabled && feed.tikHubApiKey) {
      try {
        const items = await this.fetchTikHubSearch(feed);
        await this.updateProviderCapability("tikHub", "HEALTHY", `TikHub搜索成功，发现${items.length}条`);
        if (items.length) return items.map((item) => ({
          ...item,
          metrics: { ...item.metrics, discoveryProvider: "TIKHUB" },
        }));
        errors.push("TikHub搜索未返回视频");
      } catch (error) {
        const message = error instanceof Error ? error.message : "TikHub搜索失败";
        await this.updateProviderCapability("tikHub", "ERROR", "TikHub搜索失败", message);
        errors.push(message);
      }
    }

    throw new Error(errors.length
      ? errors.join("；")
      : "抖音搜索渠道未配置：请配置官方权限、自建搜索地址或TikHub Key");
  }

  private async fetchSelfHostedSearch(feed: FeedConfig) {
    const keywords = feed.keywords.length ? feed.keywords : douyinDefaultKeywords;
    const count = Math.min(20, Math.max(5, Math.ceil(feed.dailyLimit / keywords.length) + 2));
    const collected = new Map<string, FeedItem>();
    for (const keyword of keywords) {
      const hasKeywordTemplate = feed.selfHostedSearchUrl.includes("{keyword}");
      const configuredUrl = feed.selfHostedSearchUrl.replaceAll("{keyword}", encodeURIComponent(keyword));
      const url = new URL(configuredUrl);
      if (!hasKeywordTemplate && !url.searchParams.has("keyword")) {
        url.searchParams.set("keyword", keyword);
      }
      if (!url.searchParams.has("count") && !url.searchParams.has("limit")) {
        url.searchParams.set("limit", String(count));
      }
      const body = await this.fetchProviderJson(url, feed.selfHostedToken, "自建搜索");
      for (const item of parseDouyinProviderItems(body, keyword)) {
        if (!collected.has(item.externalContentId)) collected.set(item.externalContentId, item);
      }
    }
    return this.rankDouyinItems([...collected.values()], feed.dailyLimit);
  }

  private async fetchTikHubSearch(feed: FeedConfig) {
    const keywords = feed.keywords.length ? feed.keywords : douyinDefaultKeywords;
    const count = Math.min(20, Math.max(5, Math.ceil(feed.dailyLimit / keywords.length) + 2));
    const collected = new Map<string, FeedItem>();
    for (const keyword of keywords) {
      const url = new URL(tikHubSearchEndpoint);
      url.searchParams.set("keyword", keyword);
      url.searchParams.set("count", String(count));
      url.searchParams.set("offset", "0");
      const body = await this.fetchProviderJson(url, feed.tikHubApiKey, "TikHub搜索");
      for (const item of parseDouyinProviderItems(body, keyword)) {
        if (!collected.has(item.externalContentId)) collected.set(item.externalContentId, item);
      }
    }
    return this.rankDouyinItems([...collected.values()], feed.dailyLimit);
  }

  private async fetchDouyinSearch(feed: FeedConfig): Promise<FeedItem[]> {
    const integration = await this.prisma.integration.findUnique({ where: { kind: "DOUYIN" } });
    const publicConfig = object(integration?.publicConfig);
    const oauth = object(publicConfig.douyinOAuth);
    const secrets = readIntegrationSecret(integration?.secretRef);
    const clientKey = text(oauth.clientKey) || opsConfig.douyin.clientKey;
    const clientSecret = text(secrets.douyin?.clientSecret) || opsConfig.douyin.clientSecret;
    if (!clientKey || !clientSecret) throw new Error("抖音开放平台应用密钥未配置");

    const tokenResponse = await fetch("https://open.douyin.com/oauth/client_token/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credential",
        client_key: clientKey,
        client_secret: clientSecret,
      }),
    });
    const tokenBody = await tokenResponse.json() as unknown;
    const tokenData = object(object(tokenBody).data);
    const tokenErrorCode = integer(tokenData.error_code) || 0;
    const clientToken = text(tokenData.access_token);
    if (!tokenResponse.ok || tokenErrorCode || !clientToken) {
      throw new Error(text(tokenData.description) || `抖音应用凭证获取失败 ${tokenResponse.status}`);
    }

    const keywords = feed.keywords.length ? feed.keywords : douyinDefaultKeywords;
    const count = Math.min(20, Math.max(5, Math.ceil(feed.dailyLimit / keywords.length) + 2));
    const deviceId = (BigInt(`0x${createHash("sha256").update(clientKey).digest("hex").slice(0, 15)}`)
      % 900_000_000_000_000n + 100_000_000_000_000n).toString();
    const collected = new Map<string, FeedItem>();
    for (const keyword of keywords) {
      const url = new URL(douyinSearchEndpoint);
      url.searchParams.set("keyword", keyword);
      url.searchParams.set("count", String(count));
      url.searchParams.set("cursor", "0");
      url.searchParams.set("device_id", deviceId);
      url.searchParams.set("publish_time", "7");
      url.searchParams.set("sort_type", "1");
      const response = await fetch(url, {
        headers: {
          "access-token": clientToken,
          "content-type": "application/json",
        },
      });
      const body = await response.json() as unknown;
      const root = object(body);
      const responseData = object(root.data);
      const errorCode = integer(root.err_no) || integer(responseData.error_code) || 0;
      if (!response.ok || errorCode) {
        throw new Error(
          text(root.err_msg || responseData.description || responseData.message)
          || `抖音视频搜索返回 ${response.status}`,
        );
      }
      for (const item of parseDouyinSearchItems(body, keyword)) {
        if (!collected.has(item.externalContentId)) collected.set(item.externalContentId, item);
      }
    }
    return this.rankDouyinItems([...collected.values()], feed.dailyLimit);
  }

  private rankDouyinItems(items: FeedItem[], limit: number) {
    return items
      .sort((left, right) => {
        const rightScore = (integer(right.metrics?.views) || 0)
          + (integer(right.metrics?.likes) || 0) * 20
          + (integer(right.metrics?.comments) || 0) * 50
          + (integer(right.metrics?.shares) || 0) * 80;
        const leftScore = (integer(left.metrics?.views) || 0)
          + (integer(left.metrics?.likes) || 0) * 20
          + (integer(left.metrics?.comments) || 0) * 50
          + (integer(left.metrics?.shares) || 0) * 80;
        return rightScore - leftScore;
      })
      .slice(0, limit);
  }

  private async fetchProviderJson(url: URL, token: string | undefined, label: string) {
    const response = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const raw = await response.text();
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) as unknown : {};
    } catch {
      throw new Error(`${label}返回的不是有效JSON`);
    }
    if (!response.ok) {
      const message = text(object(body).message || object(body).detail || object(body).error);
      throw new Error(message || `${label}返回 ${response.status}`);
    }
    return body;
  }

  private async enqueueResolveJob(externalVideoId: string, analyze: boolean) {
    const current = await this.prisma.viralMediaResolveJob.findUnique({
      where: { externalVideoId },
    });
    if (current) {
      if (analyze && !current.analyze) {
        return this.prisma.viralMediaResolveJob.update({
          where: { id: current.id },
          data: { analyze: true },
        });
      }
      return current;
    }
    return this.prisma.viralMediaResolveJob.create({
      data: {
        externalVideoId,
        analyze,
        idempotencyKey: createHash("sha256")
          .update(`douyin-resolve:${externalVideoId}`)
          .digest("hex"),
      },
    });
  }

  @Cron("15 * * * * *")
  async processResolveJobs() {
    const job = await this.prisma.viralMediaResolveJob.findFirst({
      where: {
        status: { in: ["PENDING", "RETRY"] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: "asc" },
      include: { externalVideo: true },
    });
    if (!job) return { processed: 0 };
    const attempts = job.attempts + 1;
    const claimed = await this.prisma.viralMediaResolveJob.updateMany({
      where: { id: job.id, status: { in: ["PENDING", "RETRY"] } },
      data: {
        status: "PROCESSING",
        attempts,
        nextAttemptAt: null,
        failureReason: null,
      },
    });
    if (!claimed.count) return { processed: 0 };
    try {
      const feed = (await this.feeds()).find((item) => item.platform === "DOUYIN")!;
      const resolved = await this.resolveDouyinMedia(feed, job.externalVideo.externalContentId);
      if (!resolved.item.downloadUrl) throw new Error("解析结果未包含可下载视频地址");
      const sourceObjectKey = await this.importVideo("DOUYIN", resolved.item);
      await this.prisma.externalVideo.update({
        where: { id: job.externalVideoId },
        data: {
          sourceUrl: resolved.item.sourceUrl || job.externalVideo.sourceUrl,
          accountName: resolved.item.accountName || job.externalVideo.accountName,
          title: resolved.item.title || job.externalVideo.title,
          description: resolved.item.description || job.externalVideo.description,
          publishedAt: resolved.item.publishedAt ? new Date(resolved.item.publishedAt) : job.externalVideo.publishedAt,
          sourceObjectKey,
          status: "READY",
          failureReason: null,
        },
      });
      await this.prisma.viralMediaResolveJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          provider: resolved.provider,
          completedAt: new Date(),
          failureReason: null,
        },
      });
      await this.updateProviderCapability("mediaResolution", "HEALTHY", `${resolved.provider}媒体解析成功`);
      if (job.analyze) await this.cloudMedia.enqueueExternalVideo(job.externalVideoId);
      return { processed: 1, state: "SUCCEEDED", provider: resolved.provider };
    } catch (error) {
      const message = error instanceof Error ? error.message : "抖音媒体解析失败";
      const failed = attempts >= job.maxAttempts;
      const delayMinutes = resolverRetryMinutes[Math.min(attempts - 1, resolverRetryMinutes.length - 1)];
      await this.prisma.viralMediaResolveJob.update({
        where: { id: job.id },
        data: {
          status: failed ? "FAILED" : "RETRY",
          nextAttemptAt: failed ? null : new Date(Date.now() + delayMinutes * 60_000),
          completedAt: failed ? new Date() : null,
          failureReason: message,
        },
      });
      await this.prisma.externalVideo.update({
        where: { id: job.externalVideoId },
        data: {
          status: failed ? "FAILED" : "DISCOVERED",
          failureReason: message,
        },
      });
      await this.updateProviderCapability("mediaResolution", "ERROR", "媒体解析失败", message);
      return { processed: 1, state: failed ? "FAILED" : "RETRY", failureReason: message };
    }
  }

  private async resolveDouyinMedia(feed: FeedConfig, externalContentId: string) {
    const errors: string[] = [];
    if (feed.selfHostedEnabled && feed.selfHostedBaseUrl) {
      try {
        const item = await this.resolveViaSelfHosted(feed, externalContentId);
        await this.updateProviderCapability("selfHosted", "HEALTHY", "自建媒体解析成功");
        return { provider: "SELF_HOSTED", item };
      } catch (error) {
        const message = error instanceof Error ? error.message : "自建媒体解析失败";
        await this.updateProviderCapability("selfHosted", "ERROR", "自建媒体解析失败", message);
        errors.push(message);
      }
    }
    if (feed.tikHubEnabled && feed.tikHubApiKey) {
      try {
        const url = new URL(tikHubDetailEndpoint);
        url.searchParams.set("aweme_id", externalContentId);
        const body = await this.fetchProviderJson(url, feed.tikHubApiKey, "TikHub媒体解析");
        const item = parseDouyinProviderItems(body).find((entry) => entry.externalContentId === externalContentId);
        if (!item?.downloadUrl) throw new Error("TikHub未返回可下载视频地址");
        await this.updateProviderCapability("tikHub", "HEALTHY", "TikHub媒体解析成功");
        return { provider: "TIKHUB", item };
      } catch (error) {
        const message = error instanceof Error ? error.message : "TikHub媒体解析失败";
        await this.updateProviderCapability("tikHub", "ERROR", "TikHub媒体解析失败", message);
        errors.push(message);
      }
    }
    throw new Error(errors.length
      ? errors.join("；")
      : "媒体解析渠道未配置：请配置自建解析地址或TikHub Key");
  }

  private async resolveViaSelfHosted(feed: FeedConfig, externalContentId: string) {
    if (!feed.selfHostedBaseUrl) throw new Error("自建解析地址未配置");
    const url = new URL(`${feed.selfHostedBaseUrl}/api/douyin/web/fetch_one_video`);
    url.searchParams.set("aweme_id", externalContentId);
    const body = await this.fetchProviderJson(url, feed.selfHostedToken, "自建媒体解析");
    const item = parseDouyinProviderItems(body).find((entry) => entry.externalContentId === externalContentId);
    if (!item?.downloadUrl) throw new Error("自建解析未返回可下载视频地址");
    return item;
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

  private async updateProviderCapability(
    provider: string,
    state: string,
    message: string,
    lastError?: string,
  ) {
    const integration = await this.ensureIntegration("DOUYIN");
    const current = object(integration.capabilityStatus);
    const providers = object(current.viralCollectorProviders);
    const now = new Date().toISOString();
    await this.prisma.integration.update({
      where: { id: integration.id },
      data: {
        capabilityStatus: {
          ...current,
          viralCollectorProviders: {
            ...providers,
            [provider]: {
              state,
              message,
              lastSuccessAt: state === "HEALTHY"
                ? now
                : optionalText(object(providers[provider]).lastSuccessAt),
              lastError: lastError || null,
              checkedAt: now,
            },
          },
        } as Prisma.InputJsonValue,
        lastCheckedAt: new Date(),
      },
    });
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

}
