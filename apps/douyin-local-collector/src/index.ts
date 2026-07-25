import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { chromium, type Page, type Response } from "playwright-core";
import { collectorConfig } from "./config";
import { parseDouyinPayload, parseRelativePublishedAt, withinTwelveHours } from "./extract";
import { CollectorStore } from "./store";
import type { CollectorBatch, CollectedVideo, KeywordRow } from "./types";

const store = new CollectorStore(collectorConfig.databasePath);
const logPath = collectorConfig.databasePath.replace(/queue\.sqlite$/u, "collector.log");
mkdirSync(dirname(logPath), { recursive: true });

class RiskGateError extends Error {}

function log(message: string) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  appendFileSync(logPath, `${line}\n`, "utf8");
}

function randomBetween(left: number, right: number) {
  const min = Math.min(left, right);
  const max = Math.max(left, right);
  return Math.floor(min + Math.random() * (max - min + 1));
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function shanghaiHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now));
}

function withinActiveHours() {
  const hour = shanghaiHour();
  return hour >= collectorConfig.activeHourStart && hour < collectorConfig.activeHourEnd;
}

function headers() {
  if (!collectorConfig.token) throw new Error("未配置DOUYIN_COLLECTOR_TOKEN或OPS_ADMIN_TOKEN");
  return {
    authorization: `Bearer ${collectorConfig.token}`,
    "content-type": "application/json",
    "x-ops-actor": encodeURIComponent(collectorConfig.deviceName),
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${collectorConfig.apiBaseUrl}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers || {}) },
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.message || `中台接口返回${response.status}`));
  return payload as T;
}

async function heartbeat(
  chromeLoginState: "LOGGED_IN" | "NEEDS_LOGIN" | "CAPTCHA" | "ERROR",
  state = "ONLINE",
  extra: Record<string, unknown> = {},
) {
  return api("/viral-collector/local/heartbeat", {
    method: "POST",
    body: JSON.stringify({
      deviceId: collectorConfig.deviceId,
      name: collectorConfig.deviceName,
      state,
      chromeLoginState,
      agentVersion: collectorConfig.version,
      ...extra,
    }),
  });
}

async function responseVideos(response: Response, keyword: string, capturedAt: Date) {
  const contentType = response.headers()["content-type"] || "";
  const url = response.url();
  if (!contentType.includes("json") || !/(search|aweme|video|detail)/iu.test(url)) return [];
  const payload = await response.json().catch(() => null) as unknown;
  return payload ? parseDouyinPayload(payload, keyword, capturedAt) : [];
}

async function collectFromPage(
  page: Page,
  targetUrl: string,
  keyword: string,
  maxResults: number,
): Promise<CollectedVideo[]> {
  const capturedAt = new Date();
  const collected = new Map<string, CollectedVideo>();
  const pending = new Set<Promise<void>>();
  const listener = (response: Response) => {
    const task = responseVideos(response, keyword, capturedAt)
      .then((rows) => rows.forEach((row) => collected.set(row.videoId, {
        ...collected.get(row.videoId),
        ...row,
        matchedKeywords: [...new Set([...(collected.get(row.videoId)?.matchedKeywords || []), keyword].filter(Boolean))],
      })))
      .catch(() => undefined)
      .finally(() => pending.delete(task));
    pending.add(task);
  };
  page.on("response", listener);
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(randomBetween(
      collectorConfig.pageDwellMinMs,
      collectorConfig.pageDwellMaxMs,
    ));
    if (await riskGateVisible(page)) throw new RiskGateError("抖音出现安全验证或访问频繁提示");
    const scrollCount = randomBetween(1, 2);
    for (let index = 0; index < scrollCount && collected.size < maxResults; index += 1) {
      await page.mouse.move(randomBetween(350, 1_050), randomBetween(260, 720), {
        steps: randomBetween(8, 18),
      });
      await page.mouse.wheel(0, randomBetween(650, 1_250));
      await page.waitForTimeout(randomBetween(2_500, 5_500));
      if (await riskGateVisible(page)) throw new RiskGateError("抖音出现安全验证或访问频繁提示");
    }
    await Promise.allSettled([...pending]);
    if (collected.size < maxResults) {
      const links = page.locator('a[href*="/video/"]');
      const count = Math.min(await links.count(), maxResults);
      for (let index = 0; index < count; index += 1) {
        const link = links.nth(index);
        const href = await link.getAttribute("href").catch(() => null);
        const videoId = href?.match(/\/video\/(\d+)/u)?.[1];
        if (!videoId || collected.has(videoId)) continue;
        const title = (await link.innerText().catch(() => "")).trim();
        const contextText = await link.evaluate((element) => {
          let current: Element | null = element;
          const candidates: string[] = [];
          for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
            const value = (current as HTMLElement).innerText?.trim();
            if (value && /(刚刚|\d+\s*(?:分钟|小时)前)/u.test(value)) candidates.push(value);
          }
          return candidates.sort((left, right) => left.length - right.length)[0] || "";
        }).catch(() => "");
        const publishedAt = parseRelativePublishedAt(contextText, capturedAt);
        if (!publishedAt) continue;
        collected.set(videoId, {
          videoId,
          sourceUrl: href!.startsWith("http") ? href! : `https://www.douyin.com${href}`,
          title: title || videoId,
          publishedAt,
          capturedAt: capturedAt.toISOString(),
          matchedKeywords: [keyword],
          raw: { discovery: "DOM_FALLBACK" },
        });
      }
    }
  } finally {
    page.off("response", listener);
  }
  return [...collected.values()]
    .filter((item) => withinTwelveHours(item, capturedAt))
    .slice(0, maxResults);
}

async function needsLogin(page: Page) {
  const loginButton = page.locator('button:has-text("登录")').first();
  return loginButton.isVisible().catch(() => false);
}

async function riskGateVisible(page: Page) {
  const riskText = page.getByText(/验证码|安全验证|访问频繁|操作频繁|请完成下列验证|拖动滑块/iu).first();
  return riskText.isVisible().catch(() => false);
}

async function syncQueue() {
  for (const queued of store.dueQueue()) {
    try {
      await api("/viral-collector/local/batches", {
        method: "POST",
        body: JSON.stringify(queued.batch),
      });
      store.markSynced(queued.batch.batchId);
      log(`批次同步成功 ${queued.batch.batchId} ${queued.batch.items.length}条`);
    } catch (error) {
      store.markFailed(queued.batch.batchId, queued.attempts);
      log(`批次同步失败 ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }
}

function createBatch(keyword: string, startedAt: Date, items: CollectedVideo[]): CollectorBatch {
  return {
    batchId: randomUUID(),
    deviceId: collectorConfig.deviceId,
    deviceName: collectorConfig.deviceName,
    agentVersion: collectorConfig.version,
    keyword,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    items,
  };
}

async function collectDueTracked(page: Page) {
  for (const tracked of store.dueTracked(1)) {
    await wait(randomBetween(
      collectorConfig.actionDelayMinMs,
      collectorConfig.actionDelayMaxMs,
    ));
    const rows = await collectFromPage(page, tracked.sourceUrl, "", 1);
    const exact = rows.find((item) => item.videoId === tracked.videoId);
    if (exact) {
      exact.publishedAt ||= tracked.publishedAt;
      const batch = createBatch(`复采${tracked.nextStage}小时`, new Date(), [exact]);
      store.enqueue(batch);
    }
    store.advanceTracked(tracked.videoId, tracked.nextStage, tracked.publishedAt);
  }
}

async function runCycle(page: Page) {
  await syncQueue();
  const plan = await api<{ keywords: KeywordRow[] }>("/viral-keywords/today?platform=DOUYIN");
  const intervals = { A: 90, B: 240, C: 720 };
  const remaining = store.remainingDailySearches(collectorConfig.dailySearchLimit);
  const due = plan.keywords
    .filter((keyword) => store.keywordDue(keyword.id, intervals[keyword.priority]))
    .slice(0, Math.min(collectorConfig.maxKeywordsPerCycle, remaining));
  log(`本轮计划采集${due.length}个关键词，今日剩余额度${remaining}`);
  for (const [index, keyword] of due.entries()) {
    const startedAt = new Date();
    const target = `https://www.douyin.com/search/${encodeURIComponent(keyword.keyword)}?type=video&publish_time=1&sort_type=2`;
    const items = await collectFromPage(page, target, keyword.keyword, collectorConfig.maxResultsPerKeyword);
    store.recordSearch();
    store.markKeywordRun(keyword.id);
    if (!items.length) {
      log(`关键词无12小时内结果 ${keyword.keyword}`);
    } else {
      store.enqueue(createBatch(keyword.keyword, startedAt, items));
      store.trackVideos(items);
      log(`关键词采集完成 ${keyword.keyword} ${items.length}条`);
      await syncQueue();
    }
    if (index < due.length - 1) {
      const delay = randomBetween(
        collectorConfig.actionDelayMinMs,
        collectorConfig.actionDelayMaxMs,
      );
      log(`自然停留${Math.ceil(delay / 1_000)}秒后继续`);
      await wait(delay);
    }
  }
  if (due.length && store.remainingDailySearches(collectorConfig.dailySearchLimit) > 0) {
    await collectDueTracked(page);
  }
  await syncQueue();
  await heartbeat("LOGGED_IN", "ONLINE", {
    lastCollectionAt: new Date().toISOString(),
    lastSyncAt: new Date().toISOString(),
    metadata: {
      dueKeywordCount: due.length,
      dailySearchesRemaining: store.remainingDailySearches(collectorConfig.dailySearchLimit),
      pacingMode: "CONSERVATIVE",
    },
  });
}

async function main() {
  if (!collectorConfig.token) throw new Error("本地采集器没有中台Token");
  if (!existsSync(collectorConfig.chromeExecutable)) {
    throw new Error(`未找到Chrome：${collectorConfig.chromeExecutable}`);
  }
  log(`采集器启动 ${collectorConfig.deviceId}`);
  const context = await chromium.launchPersistentContext(collectorConfig.profileDir, {
    executablePath: collectorConfig.chromeExecutable,
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ["--no-default-browser-check"],
  });
  const page = context.pages()[0] || await context.newPage();
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await heartbeat("ERROR", "OFFLINE").catch(() => undefined);
    store.close();
    await context.close().catch(() => undefined);
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  while (!stopping) {
    let restMinutes = randomBetween(
      collectorConfig.cycleRestMinMinutes,
      collectorConfig.cycleRestMaxMinutes,
    );
    try {
      if (!withinActiveHours()) {
        await heartbeat("LOGGED_IN", "PAUSED", {
          metadata: { reason: "OUTSIDE_ACTIVE_HOURS", pacingMode: "CONSERVATIVE" },
        });
        log(`当前为休息时段，${collectorConfig.activeHourStart}:00后恢复`);
        restMinutes = 60;
        await wait(restMinutes * 60_000);
        continue;
      }
      await page.goto("https://www.douyin.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(randomBetween(3_000, 6_000));
      if (await needsLogin(page)) {
        await heartbeat("NEEDS_LOGIN", "ONLINE");
        log("抖音需要扫码登录，已保留登录窗口");
      } else if (await riskGateVisible(page)) {
        throw new RiskGateError("抖音出现安全验证或访问频繁提示");
      } else {
        await runCycle(page);
      }
    } catch (error) {
      const riskPaused = error instanceof RiskGateError;
      if (riskPaused) restMinutes = collectorConfig.riskPauseMinutes;
      await heartbeat(riskPaused ? "CAPTCHA" : "ERROR", riskPaused ? "PAUSED" : "DEGRADED", {
        metadata: { error: error instanceof Error ? error.message : "未知错误" },
      }).catch(() => undefined);
      log(riskPaused
        ? `触发风控提示，自动暂停${restMinutes}分钟`
        : `采集循环失败 ${error instanceof Error ? error.message : "未知错误"}`);
    }
    log(`本轮结束，休息${restMinutes}分钟`);
    await wait(restMinutes * 60_000);
  }
}

main().catch((error) => {
  log(`采集器退出 ${error instanceof Error ? error.message : "未知错误"}`);
  store.close();
  process.exitCode = 1;
});
