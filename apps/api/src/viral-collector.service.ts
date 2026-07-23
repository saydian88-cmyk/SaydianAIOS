import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { IntegrationKind } from "@prisma/client";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import { CloudMediaService } from "./cloud-media.service";
import { opsConfig } from "./config";
import { OssStorageService } from "./oss-storage.service";

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

type FeedConfig = { platform: IntegrationKind; url: string };

@Injectable()
export class ViralCollectorService {
  private readonly logger = new Logger(ViralCollectorService.name);
  private collecting = false;

  constructor(
    private readonly cloudMedia: CloudMediaService,
    private readonly oss: OssStorageService,
  ) {}

  capabilities() {
    return this.feeds().map((feed) => ({
      platform: feed.platform,
      state: feed.url ? "CONFIGURED" : "UNCONFIGURED",
      message: feed.url ? "采集源已配置，按日串行采集" : "未配置采集源",
    }));
  }

  @Cron("0 30 5 * * *", { timeZone: "Asia/Shanghai" })
  async collectDaily() {
    return this.collect();
  }

  async collect(platform?: IntegrationKind) {
    if (this.collecting) return { running: true, results: [] };
    this.collecting = true;
    const results: Array<Record<string, unknown>> = [];
    try {
      for (const feed of this.feeds().filter((item) => !platform || item.platform === platform)) {
        if (!feed.url) {
          results.push({ platform: feed.platform, state: "UNCONFIGURED", collected: 0 });
          continue;
        }
        try {
          const items = await this.fetchFeed(feed);
          let analyzed = 0;
          for (const item of items.slice(0, opsConfig.viralCollector.maxPerPlatform)) {
            const sourceObjectKey = item.downloadUrl ? await this.importVideo(feed.platform, item) : undefined;
            await this.cloudMedia.registerExternalVideo({
              platform: feed.platform,
              externalContentId: item.externalContentId,
              sourceUrl: item.sourceUrl,
              accountName: item.accountName,
              title: item.title,
              description: item.description,
              publishedAt: item.publishedAt,
              sourceObjectKey,
              metrics: item.metrics,
            });
            if (sourceObjectKey) analyzed += 1;
          }
          results.push({ platform: feed.platform, state: "SUCCEEDED", collected: items.length, submittedForAnalysis: analyzed });
        } catch (error) {
          const message = error instanceof Error ? error.message : "采集失败";
          this.logger.warn(`${feed.platform}: ${message}`);
          results.push({ platform: feed.platform, state: "FAILED", collected: 0, failureReason: message });
        }
      }
      return { running: false, results };
    } finally {
      this.collecting = false;
    }
  }

  private feeds(): FeedConfig[] {
    return [
      { platform: "DOUYIN", url: opsConfig.viralCollector.douyinUrl },
      { platform: "TIKTOK", url: opsConfig.viralCollector.tiktokUrl },
      { platform: "XIAOHONGSHU", url: opsConfig.viralCollector.xiaohongshuUrl },
      { platform: "WECHAT_CHANNELS", url: opsConfig.viralCollector.wechatChannelsUrl },
    ];
  }

  private async fetchFeed(feed: FeedConfig): Promise<FeedItem[]> {
    const response = await fetch(feed.url, {
      headers: opsConfig.viralCollector.token ? { authorization: `Bearer ${opsConfig.viralCollector.token}` } : {},
    });
    if (!response.ok) throw new Error(`采集源返回 ${response.status}`);
    const body = await response.json() as unknown;
    const source = Array.isArray(body)
      ? body
      : body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)
        ? (body as { items: unknown[] }).items
        : [];
    return source
      .map((item) => item as Partial<FeedItem>)
      .filter((item): item is FeedItem => Boolean(item.externalContentId && item.sourceUrl));
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
}
