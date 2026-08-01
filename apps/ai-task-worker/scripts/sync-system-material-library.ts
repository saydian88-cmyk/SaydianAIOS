import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

type Row = Record<string, any>;

const apiUrl = String(process.env.AI_TASK_API_URL || "https://stest.saydian.cn").replace(/\/+$/u, "");
const token = String(process.env.AI_TASK_RUNNER_TOKEN || "");
const nodeCode = String(process.env.AI_TASK_RUNNER_NODE_CODE || "windows-codex-video-01");
const libraryRoot = resolve(String(process.env.AI_TASK_LOCAL_MEDIA_LIBRARY || "F:\\赛电品牌素材库"));
const indexRoot = join(libraryRoot, ".saidian-system-index");
const mapPath = join(indexRoot, "system-asset-map.json");
const statePath = join(indexRoot, "sync-state.json");
const logPath = join(indexRoot, "sync-report.json");

if (!token) throw new Error("AI_TASK_RUNNER_TOKEN 未配置");

const headers = { authorization: `Runner ${token}`, "content-type": "application/json" };

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: AbortSignal.timeout(120_000) });
  const body = await response.json() as Row;
  if (!response.ok) throw new Error(`${response.status} ${String(body.message || "请求失败")}`);
  return body;
}

async function readJson(path: string): Promise<Row> {
  try { return JSON.parse(await readFile(path, "utf8")) as Row; } catch { return {}; }
}

async function writeJsonAtomic(path: string, value: unknown) {
  const temporary = `${path}.writing`;
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await rename(temporary, path);
}

function hash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function cleanName(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, "-").replace(/[. ]+$/gu, "").trim().slice(0, 100) || "系统素材";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function modelOf(asset: Row) {
  const learned = strings(asset.aiIndex?.product_model)[0];
  const related = Array.isArray(asset.products) ? asset.products.map((item: Row) => String(item.product?.modelCode || "")).find(Boolean) : "";
  return cleanName(learned || related || "通用");
}

function destinationOf(asset: Row) {
  const model = modelOf(asset);
  const purposes = strings(asset.aiIndex?.purpose).join(" ");
  const scenes = strings(asset.aiIndex?.scene).join(" ");
  if (asset.kind === "VIDEO") {
    const module = /黄金|钩子|开头/u.test(`${purposes} ${scenes}`) ? "黄金3秒兴趣吸引画面"
      : /结尾|收尾/u.test(`${purposes} ${scenes}`) ? "结尾"
        : /功能|演示|测量|监测/u.test(`${purposes} ${scenes}`) ? "功能"
          : /场景|佩戴|家庭|运动|户外/u.test(`${purposes} ${scenes}`) ? "使用场景"
            : "基础视觉库";
    return join(libraryRoot, "视频素材", module, model);
  }
  if (asset.kind === "IMAGE") return join(libraryRoot, "图片素材", "系统同步", model);
  if (asset.kind === "DOCUMENT") return join(libraryRoot, "产品规格书", model);
  if (asset.kind === "AUDIO") return join(libraryRoot, "音频素材", model);
  return join(libraryRoot, "其它素材", model);
}

async function walk(root: string, output: string[] = []) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === ".saidian-system-index") continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) await walk(path, output);
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

async function localHashes(existingMap: Row) {
  const byHash = new Map<string, string>();
  const knownPaths = new Set<string>();
  for (const entry of Object.values(existingMap) as Row[]) {
    const path = String(entry.localPath || "");
    if (path && String(entry.sha256 || "")) {
      try {
        if ((await stat(path)).isFile()) {
          byHash.set(String(entry.sha256), path);
          knownPaths.add(path);
        }
      } catch { /* rescan below */ }
    }
  }
  for (const path of await walk(libraryRoot)) {
    if (knownPaths.has(path)) continue;
    const buffer = await readFile(path);
    byHash.set(hash(buffer), path);
    knownPaths.add(path);
  }
  return byHash;
}

async function download(asset: Row, url: string, target: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`下载失败 ${asset.id}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (hash(buffer) !== String(asset.sha256).toLowerCase()) throw new Error(`哈希校验失败：${asset.id}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
}

async function main() {
  await mkdir(indexRoot, { recursive: true });
  const oldState = await readJson(statePath);
  const mapping = await readJson(mapPath);
  const changes: Row[] = [];
  let cursor = String(oldState.cursor || "");
  let hasMore = true;
  while (hasMore) {
    const query = new URLSearchParams({ nodeCode });
    if (cursor) query.set("cursor", cursor);
    const page = await api(`/api/v1/ai-tasks/runner/material-index?${query.toString()}`);
    changes.push(...(Array.isArray(page.changes) ? page.changes : []));
    cursor = String(page.cursor || cursor);
    hasMore = page.hasMore === true;
  }

  const byHash = await localHashes(mapping);
  const pending = changes.filter((asset) => asset.usable === true && asset.sha256 && !byHash.has(String(asset.sha256)));
  const urls = new Map<string, string>();
  for (let start = 0; start < pending.length; start += 100) {
    const batch = pending.slice(start, start + 100);
    const result = await api("/api/v1/ai-tasks/runner/material-downloads", {
      method: "POST",
      body: JSON.stringify({ nodeCode, assetIds: batch.map((asset) => asset.id) }),
    });
    for (const item of Array.isArray(result.downloads) ? result.downloads : []) if (item.downloadUrl) urls.set(String(item.id), String(item.downloadUrl));
  }

  let linked = 0;
  let downloaded = 0;
  let disabled = 0;
  const failures: Row[] = [];
  const activeGroups = new Map<string, Row[]>();
  for (const asset of changes) {
    const id = String(asset.id || "");
    if (!id) continue;
    if (asset.usable !== true) {
      mapping[id] = { ...mapping[id], systemAssetId: id, sha256: asset.sha256, active: false, updatedAt: asset.updatedAt };
      disabled += 1;
      continue;
    }
    const sha = String(asset.sha256 || "");
    activeGroups.set(sha, [...(activeGroups.get(sha) || []), asset]);
  }

  const groups = [...activeGroups.values()];
  for (let start = 0; start < groups.length; start += 8) {
    await Promise.all(groups.slice(start, start + 8).map(async (group) => {
      const asset = group[0];
      const id = String(asset.id || "");
      const sha = String(asset.sha256 || "");
      let localPath = byHash.get(sha);
      if (!localPath) {
        const extension = String(asset.extension || extname(String(asset.displayName || "")) || ".bin");
        const folder = destinationOf(asset);
        const filename = `${cleanName(String(asset.displayName || asset.assetNo || id))}__${cleanName(String(asset.assetNo || id))}${extension.startsWith(".") ? extension : `.${extension}`}`;
        localPath = join(folder, filename);
        try {
          const url = urls.get(id);
          if (!url) throw new Error("系统未返回下载地址");
          await download(asset, url, localPath);
          byHash.set(sha, localPath);
          downloaded += 1;
        } catch (error) {
          failures.push({ id, message: error instanceof Error ? error.message : String(error) });
          return;
        }
      } else linked += group.length;
      for (const item of group) {
        const itemId = String(item.id || "");
        mapping[itemId] = {
          systemAssetId: itemId,
          assetNo: item.assetNo,
          sha256: item.sha256,
          localPath,
          relativePath: relative(libraryRoot, localPath).replaceAll("\\", "/"),
          displayName: item.displayName,
          kind: item.kind,
          model: modelOf(item),
          aiIndex: item.aiIndex || {},
          searchText: item.searchText || "",
          indexVersion: item.indexVersion || 0,
          indexConfidence: item.indexConfidence || 0,
          active: true,
          syncedAt: new Date().toISOString(),
        };
      }
    }));
  }
  const report = { syncedAt: new Date().toISOString(), libraryRoot, changed: changes.length, linked, downloaded, disabled, failed: failures.length, failures };
  await writeJsonAtomic(mapPath, mapping);
  await writeJsonAtomic(statePath, { cursor, syncedAt: report.syncedAt });
  await writeJsonAtomic(logPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void main();
