export const platformKinds = [
  "DOUYIN",
  "WECHAT_CHANNELS",
  "XIAOHONGSHU",
  "WECHAT_OFFICIAL",
  "WECOM",
  "TMALL",
  "JD",
  "PINDUODUO",
  "SAIDIAN_MALL",
  "JUSHUITAN",
  "FEIGUA",
  "WEB_SEARCH",
  "LOCAL_ASSET",
  "WECOM_DRIVE",
  "HELP_CENTER",
  "EVIDENCE_WORKBOOK",
  "ALIYUN_OSS",
] as const;

export type PlatformKind = (typeof platformKinds)[number];

export type PlatformCapability =
  | "publish"
  | "metrics"
  | "comments"
  | "reply"
  | "live"
  | "shop"
  | "search"
  | "assets";

export type IntegrationState =
  | "UNCONFIGURED"
  | "CONFIGURED"
  | "HEALTHY"
  | "DEGRADED"
  | "ERROR";

export interface PlatformHealth {
  kind: PlatformKind;
  state: IntegrationState;
  capabilities: PlatformCapability[];
  checkedAt?: string;
  message: string;
}

export interface PublishInput {
  idempotencyKey: string;
  platform: PlatformKind;
  contentId: string;
  title: string;
  body: string;
  mediaUrls: string[];
  scheduledAt?: string;
}

export interface PublishReceipt {
  success: boolean;
  remoteId?: string;
  remoteUrl?: string;
  publishedAt?: string;
  message: string;
  raw?: Record<string, unknown>;
}

export interface MetricPoint {
  remoteId: string;
  capturedAt: string;
  views?: number;
  completionRate?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  consultations?: number;
  orders?: number;
  unavailableFields: string[];
}

export interface CommentInput {
  remoteId: string;
  commentId: string;
  authorName?: string;
  text: string;
  createdAt: string;
}

export interface LiveSnapshot {
  roomId: string;
  title?: string;
  capturedAt: string;
  online?: number;
  likes?: number;
  commentCount?: number;
  products: Array<{ id?: string; title: string; price?: number }>;
  unavailableFields: string[];
}

export interface ShopQueueItem {
  platform: PlatformKind;
  remoteId: string;
  type: "CUSTOMER_SERVICE" | "SHIPMENT" | "AFTER_SALE" | "REFUND" | "WORK_ORDER";
  status: string;
  createdAt: string;
  dueAt?: string;
  summary: string;
}

export interface PlatformAdapter {
  capabilities(): PlatformCapability[];
  healthCheck(): Promise<PlatformHealth>;
  publishContent(input: PublishInput): Promise<PublishReceipt>;
  fetchMetrics(remoteIds: string[]): Promise<MetricPoint[]>;
  fetchComments(since?: string): Promise<CommentInput[]>;
  replyComment(commentId: string, text: string, idempotencyKey: string): Promise<PublishReceipt>;
  fetchLiveSessions(): Promise<LiveSnapshot[]>;
  fetchShopQueue(): Promise<ShopQueueItem[]>;
}

export interface DashboardSummary {
  generatedAt: string;
  integrations: { healthy: number; configured: number; unconfigured: number; error: number };
  assets: { total: number; ready: number; pending: number; blocked: number };
  content: { draft: number; pendingApproval: number; approved: number; published: number };
  operations: { overdue: number; alerts: number; pendingReplies: number; activeLives: number };
  latestReports: Array<{ id: string; kind: string; title: string; createdAt: string }>;
}
