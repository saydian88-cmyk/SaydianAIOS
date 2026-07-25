import { config as loadEnv } from "dotenv";
import { hostname } from "node:os";
import { join, resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), "../../.env") });
loadEnv();

const localAppData = process.env.LOCALAPPDATA || resolve(process.cwd(), ".local-data");

export const collectorConfig = {
  version: "1.1.0",
  apiBaseUrl: (process.env.DOUYIN_COLLECTOR_API_BASE_URL || "https://stest.saydian.cn/api/v1/brand-data").replace(/\/$/u, ""),
  token: process.env.DOUYIN_COLLECTOR_TOKEN || process.env.OPS_ADMIN_TOKEN || "",
  deviceId: process.env.DOUYIN_COLLECTOR_DEVICE_ID || hostname().toLowerCase().replace(/[^a-z0-9-]/gu, "-"),
  deviceName: process.env.DOUYIN_COLLECTOR_DEVICE_NAME || `${hostname()} · 抖音趋势采集`,
  chromeExecutable: process.env.DOUYIN_COLLECTOR_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  profileDir: process.env.DOUYIN_COLLECTOR_PROFILE_DIR || join(localAppData, "Saydian", "DouyinCollector", "ChromeProfile"),
  databasePath: process.env.DOUYIN_COLLECTOR_DB_PATH || join(localAppData, "Saydian", "DouyinCollector", "queue.sqlite"),
  maxResultsPerKeyword: Math.min(20, Math.max(5, Number(process.env.DOUYIN_COLLECTOR_MAX_RESULTS || 20))),
  maxKeywordsPerCycle: Math.min(8, Math.max(1, Number(process.env.DOUYIN_COLLECTOR_MAX_KEYWORDS_PER_CYCLE || 5))),
  dailySearchLimit: Math.min(60, Math.max(5, Number(process.env.DOUYIN_COLLECTOR_DAILY_SEARCH_LIMIT || 50))),
  actionDelayMinMs: Math.max(8_000, Number(process.env.DOUYIN_COLLECTOR_ACTION_DELAY_MIN_MS || 9_000)),
  actionDelayMaxMs: Math.max(12_000, Number(process.env.DOUYIN_COLLECTOR_ACTION_DELAY_MAX_MS || 18_000)),
  pageDwellMinMs: Math.max(3_000, Number(process.env.DOUYIN_COLLECTOR_PAGE_DWELL_MIN_MS || 5_000)),
  pageDwellMaxMs: Math.max(5_000, Number(process.env.DOUYIN_COLLECTOR_PAGE_DWELL_MAX_MS || 9_000)),
  cycleRestMinMinutes: Math.max(5, Number(process.env.DOUYIN_COLLECTOR_CYCLE_REST_MIN_MINUTES || 6)),
  cycleRestMaxMinutes: Math.max(8, Number(process.env.DOUYIN_COLLECTOR_CYCLE_REST_MAX_MINUTES || 10)),
  riskPauseMinutes: Math.max(30, Number(process.env.DOUYIN_COLLECTOR_RISK_PAUSE_MINUTES || 60)),
  activeHourStart: Math.min(23, Math.max(0, Number(process.env.DOUYIN_COLLECTOR_ACTIVE_HOUR_START || 8))),
  activeHourEnd: Math.min(24, Math.max(1, Number(process.env.DOUYIN_COLLECTOR_ACTIVE_HOUR_END || 23))),
};
