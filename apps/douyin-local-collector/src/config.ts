import { config as loadEnv } from "dotenv";
import { hostname } from "node:os";
import { join, resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), "../../.env") });
loadEnv();

const localAppData = process.env.LOCALAPPDATA || resolve(process.cwd(), ".local-data");

export const collectorConfig = {
  version: "1.0.0",
  apiBaseUrl: (process.env.DOUYIN_COLLECTOR_API_BASE_URL || "https://stest.saydian.cn/api/v1/brand-data").replace(/\/$/u, ""),
  token: process.env.DOUYIN_COLLECTOR_TOKEN || process.env.OPS_ADMIN_TOKEN || "",
  deviceId: process.env.DOUYIN_COLLECTOR_DEVICE_ID || hostname().toLowerCase().replace(/[^a-z0-9-]/gu, "-"),
  deviceName: process.env.DOUYIN_COLLECTOR_DEVICE_NAME || `${hostname()} · 抖音趋势采集`,
  chromeExecutable: process.env.DOUYIN_COLLECTOR_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  profileDir: process.env.DOUYIN_COLLECTOR_PROFILE_DIR || join(localAppData, "Saydian", "DouyinCollector", "ChromeProfile"),
  databasePath: process.env.DOUYIN_COLLECTOR_DB_PATH || join(localAppData, "Saydian", "DouyinCollector", "queue.sqlite"),
  loopMinutes: Math.max(2, Number(process.env.DOUYIN_COLLECTOR_LOOP_MINUTES || 5)),
  maxResultsPerKeyword: Math.min(30, Math.max(5, Number(process.env.DOUYIN_COLLECTOR_MAX_RESULTS || 30))),
};
