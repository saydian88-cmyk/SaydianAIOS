import { Injectable } from "@nestjs/common";
import type {
  CommentInput,
  LiveSnapshot,
  MetricPoint,
  PlatformAdapter,
  PlatformCapability,
  PlatformHealth,
  PlatformKind,
  PublishInput,
  PublishReceipt,
  ShopQueueItem,
} from "@saidian-ops/contracts";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { opsConfig } from "../config";
import { OssStorageService } from "../oss-storage.service";
import { safeJson, stringValue } from "../utils";

abstract class EmptyAdapter implements PlatformAdapter {
  constructor(
    protected readonly kind: PlatformKind,
    protected readonly displayName: string,
  ) {}

  capabilities(): PlatformCapability[] {
    return [];
  }

  async healthCheck(): Promise<PlatformHealth> {
    return {
      kind: this.kind,
      state: "UNCONFIGURED",
      capabilities: [],
      message: `${this.displayName}未配置`,
    };
  }

  async publishContent(_input: PublishInput): Promise<PublishReceipt> {
    return { success: false, message: `${this.displayName}未配置` };
  }

  async fetchMetrics(_remoteIds: string[]): Promise<MetricPoint[]> {
    return [];
  }

  async fetchComments(_since?: string): Promise<CommentInput[]> {
    return [];
  }

  async replyComment(_commentId: string, _text: string, _idempotencyKey: string): Promise<PublishReceipt> {
    return { success: false, message: `${this.displayName}未配置` };
  }

  async fetchLiveSessions(): Promise<LiveSnapshot[]> {
    return [];
  }

  async fetchShopQueue(): Promise<ShopQueueItem[]> {
    return [];
  }
}

export class UnconfiguredAdapter extends EmptyAdapter {
  constructor(kind: PlatformKind, displayName: string) {
    super(kind, displayName);
  }
}

export class DouyinAdapter extends EmptyAdapter {
  constructor() {
    super("DOUYIN", "抖音");
  }

  private configured(): boolean {
    return Boolean(opsConfig.douyin.openId && opsConfig.douyin.accessToken);
  }

  override capabilities(): PlatformCapability[] {
    return this.configured() ? ["publish"] : [];
  }

  override async healthCheck(): Promise<PlatformHealth> {
    if (!this.configured()) return super.healthCheck();
    return {
      kind: "DOUYIN",
      state: "CONFIGURED",
      capabilities: this.capabilities(),
      checkedAt: new Date().toISOString(),
      message: "发布凭据已配置，等待账号实发验证",
    };
  }

  override async publishContent(input: PublishInput): Promise<PublishReceipt> {
    if (!this.configured()) return super.publishContent(input);
    const mediaPath = input.mediaUrls.find((value) => !/^https?:\/\//i.test(value));
    if (!mediaPath) return { success: false, message: "抖音发布缺少本地视频文件" };

    try {
      const bytes = await readFile(mediaPath);
      const form = new FormData();
      form.append("video", new Blob([bytes]), basename(mediaPath));
      const upload = await fetch(
        `https://open.douyin.com/api/douyin/v1/video/upload_video/?open_id=${encodeURIComponent(opsConfig.douyin.openId)}`,
        {
          method: "POST",
          headers: { "access-token": opsConfig.douyin.accessToken },
          body: form,
          signal: AbortSignal.timeout(120_000),
        },
      );
      const uploadJson = safeJson(await upload.json());
      const uploadData = safeJson(uploadJson.data);
      const uploadVideo = safeJson(uploadData.video);
      const videoId = stringValue(uploadVideo.video_id);
      if (!upload.ok || !videoId) {
        return {
          success: false,
          message: `抖音上传失败：${stringValue(uploadData.description) || upload.status}`,
          raw: uploadJson,
        };
      }

      const created = await fetch(
        `https://open.douyin.com/api/douyin/v1/video/create_video/?open_id=${encodeURIComponent(opsConfig.douyin.openId)}`,
        {
          method: "POST",
          headers: {
            "access-token": opsConfig.douyin.accessToken,
            "content-type": "application/json",
          },
          body: JSON.stringify({ video_id: videoId, text: `${input.title}\n${input.body}`.slice(0, 2200) }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      const createdJson = safeJson(await created.json());
      const data = safeJson(createdJson.data);
      const itemId = stringValue(data.item_id);
      return {
        success: created.ok && Boolean(itemId),
        remoteId: itemId || undefined,
        publishedAt: itemId ? new Date().toISOString() : undefined,
        message: itemId
          ? "抖音视频已提交审核"
          : `抖音创建失败：${stringValue(data.description) || created.status}`,
        raw: createdJson,
      };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "抖音发布失败" };
    }
  }
}

export class MallAdapter extends EmptyAdapter {
  private cachedToken = "";
  private tokenExpiresAt = 0;

  constructor() {
    super("SAIDIAN_MALL", "赛电自有商城");
  }

  private configured(): boolean {
    return Boolean(opsConfig.mall.baseUrl && opsConfig.mall.username && opsConfig.mall.password);
  }

  override capabilities(): PlatformCapability[] {
    return this.configured() ? ["shop"] : [];
  }

  private async login(): Promise<string> {
    if (this.cachedToken && this.tokenExpiresAt > Date.now() + 60_000) return this.cachedToken;
    const response = await fetch(`${opsConfig.mall.baseUrl.replace(/\/$/, "")}/admin/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: opsConfig.mall.username, password: opsConfig.mall.password }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = safeJson(await response.json());
    if (!response.ok || !stringValue(json.token)) throw new Error("商城后台登录失败");
    this.cachedToken = stringValue(json.token);
    this.tokenExpiresAt = new Date(stringValue(json.expiresAt) || Date.now() + 10 * 60 * 60 * 1000).getTime();
    return this.cachedToken;
  }

  private async get(path: string): Promise<unknown> {
    const token = await this.login();
    const response = await fetch(`${opsConfig.mall.baseUrl.replace(/\/$/, "")}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`商城接口${path}返回${response.status}`);
    return response.json();
  }

  override async healthCheck(): Promise<PlatformHealth> {
    if (!this.configured()) return super.healthCheck();
    try {
      await this.get("/admin/dashboard");
      return {
        kind: "SAIDIAN_MALL",
        state: "HEALTHY",
        capabilities: this.capabilities(),
        checkedAt: new Date().toISOString(),
        message: "商城后台只读连接正常",
      };
    } catch (error) {
      return {
        kind: "SAIDIAN_MALL",
        state: "ERROR",
        capabilities: this.capabilities(),
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : "商城连接失败",
      };
    }
  }

  override async fetchShopQueue(): Promise<ShopQueueItem[]> {
    if (!this.configured()) return [];
    const [ordersRaw, afterSalesRaw, jobsRaw] = await Promise.all([
      this.get("/admin/orders?page=1&pageSize=100"),
      this.get("/admin/after-sales"),
      this.get("/admin/jobs"),
    ]);
    const rows: ShopQueueItem[] = [];
    const orders = Array.isArray(ordersRaw) ? ordersRaw : (safeJson(ordersRaw).items as unknown[]) || [];
    for (const value of Array.isArray(orders) ? orders : []) {
      const row = safeJson(value);
      rows.push({
        platform: "SAIDIAN_MALL",
        remoteId: stringValue(row.id || row.orderNo),
        type: "SHIPMENT",
        status: stringValue(row.status) || "UNKNOWN",
        createdAt: stringValue(row.createdAt) || new Date().toISOString(),
        summary: `订单${stringValue(row.orderNo || row.id)}：${stringValue(row.status) || "状态未获取"}`,
      });
    }
    for (const value of Array.isArray(afterSalesRaw) ? afterSalesRaw : []) {
      const row = safeJson(value);
      rows.push({
        platform: "SAIDIAN_MALL",
        remoteId: stringValue(row.id),
        type: "AFTER_SALE",
        status: stringValue(row.status) || "UNKNOWN",
        createdAt: stringValue(row.createdAt) || new Date().toISOString(),
        summary: `售后${stringValue(row.id)}：${stringValue(row.status) || "状态未获取"}`,
      });
    }
    for (const value of Array.isArray(jobsRaw) ? jobsRaw : []) {
      const row = safeJson(value);
      if (stringValue(row.status) === "SUCCEEDED") continue;
      rows.push({
        platform: "SAIDIAN_MALL",
        remoteId: stringValue(row.id),
        type: "WORK_ORDER",
        status: stringValue(row.status) || "UNKNOWN",
        createdAt: stringValue(row.createdAt) || new Date().toISOString(),
        summary: `商城同步任务${stringValue(row.type || row.id)}：${stringValue(row.status)}`,
      });
    }
    return rows.filter((row) => row.remoteId);
  }
}

export class OssAdapter extends EmptyAdapter {
  constructor(private readonly storage: OssStorageService) {
    super("ALIYUN_OSS", "阿里云 OSS 素材库");
  }

  override capabilities(): PlatformCapability[] {
    return this.storage.isConfigured() ? ["assets"] : [];
  }

  override async healthCheck(): Promise<PlatformHealth> {
    const health = await this.storage.healthCheck();
    return {
      kind: "ALIYUN_OSS",
      state: !this.storage.isConfigured() ? "UNCONFIGURED" : health.ok ? "HEALTHY" : "ERROR",
      capabilities: this.capabilities(),
      checkedAt: new Date().toISOString(),
      message: health.message,
    };
  }
}

@Injectable()
export class PlatformRegistry {
  private readonly adapters = new Map<PlatformKind, PlatformAdapter>();

  constructor(ossStorage: OssStorageService) {
    const configured: Array<[PlatformKind, PlatformAdapter]> = [
      ["DOUYIN", new DouyinAdapter()],
      ["SAIDIAN_MALL", new MallAdapter()],
      ["ALIYUN_OSS", new OssAdapter(ossStorage)],
    ];
    for (const [kind, adapter] of configured) this.adapters.set(kind, adapter);
    const unconfigured: Array<[PlatformKind, string]> = [
      ["WECHAT_CHANNELS", "视频号"],
      ["XIAOHONGSHU", "小红书"],
      ["WECHAT_OFFICIAL", "微信公众号"],
      ["WECOM", "企业微信"],
      ["TMALL", "天猫"],
      ["JD", "京东"],
      ["PINDUODUO", "拼多多"],
      ["JUSHUITAN", "聚水潭"],
      ["FEIGUA", "飞瓜"],
      ["WEB_SEARCH", "全网搜索"],
      ["LOCAL_ASSET", "本地素材库"],
      ["WECOM_DRIVE", "企微网盘"],
      ["HELP_CENTER", "客服帮助网站"],
      ["EVIDENCE_WORKBOOK", "宣传证据底表"],
    ];
    for (const [kind, name] of unconfigured) {
      if (!this.adapters.has(kind)) this.adapters.set(kind, new UnconfiguredAdapter(kind, name));
    }
  }

  get(kind: PlatformKind): PlatformAdapter {
    const adapter = this.adapters.get(kind);
    if (!adapter) throw new Error(`平台适配器不存在：${kind}`);
    return adapter;
  }

  all(): Array<[PlatformKind, PlatformAdapter]> {
    return Array.from(this.adapters.entries());
  }
}
