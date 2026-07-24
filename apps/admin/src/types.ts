export type Dashboard = {
  generatedAt: string;
  integrations: { healthy: number; configured: number; unconfigured: number; error: number };
  assets: { total: number; ready: number; pending: number; blocked: number };
  content: { draft: number; pendingApproval: number; approved: number; published: number };
  operations: { overdue: number; alerts: number; pendingReplies: number; activeLives: number };
  ledger: { employees: number; accounts: number; stores: number; unassignedSnapshots: number };
  latestReports: Array<{ id: string; kind: string; title: string; summary: string; createdAt: string }>;
  latestJobs: Array<Record<string, unknown>>;
  todayTodos: Array<{ id: string; type: "SHOOT" | "VIRAL" | "GAP" | "TASK"; title: string; description: string; priority: string; status: string; score?: number; targetPage: string; dueAt?: string }>;
};

export type Integration = {
  id: string;
  kind: string;
  displayName: string;
  state: string;
  capabilities: string[];
  capabilityStatus: Record<string, string>;
  region: string;
  message: string;
  lastCheckedAt?: string;
};

export type ContentPlan = {
  id: string;
  kind: "VIDEO" | "ARTICLE" | "SHORT_POST" | "WECHAT_MOMENT";
  topic: string;
  audience: string;
  objective: string;
  score: number;
  hook: string;
  outline: string[];
  status: string;
  riskReasons: string[];
  planDate: string;
  createdBy: string;
  approvedBy?: string;
  variants: Array<{ id: string; platform: string; title: string; body: string; mediaPath?: string; targetAccountId?: string; metadata: Record<string, unknown>; status: string }>;
};

export type Asset = {
  id: string;
  fileName: string;
  sourcePath: string;
  sourceType: string;
  mediaType: string;
  model?: string;
  scene?: string;
  status: string;
  qualityScore: number;
  discoveredBy: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  storageProvider: string;
  objectKey?: string;
  storageSyncedAt?: string;
  storageError?: string;
  updatedAt: string;
};
