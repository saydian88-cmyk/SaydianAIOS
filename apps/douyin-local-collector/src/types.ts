export type KeywordRow = {
  id: string;
  keyword: string;
  type: "PRODUCT" | "PAIN" | "COMPETITOR" | "SCENE";
  priority: "A" | "B" | "C";
};

export type CollectedVideo = {
  videoId: string;
  sourceUrl: string;
  title?: string;
  description?: string;
  publishedAt?: string;
  capturedAt: string;
  author?: string;
  authorId?: string;
  authorUrl?: string;
  avatarUrl?: string;
  followers?: number;
  views?: number;
  likes?: number;
  comments?: number;
  saves?: number;
  shares?: number;
  matchedKeywords: string[];
  raw?: Record<string, unknown>;
};

export type CollectorBatch = {
  batchId: string;
  deviceId: string;
  deviceName: string;
  agentVersion: string;
  keyword?: string;
  startedAt: string;
  completedAt: string;
  items: CollectedVideo[];
};
