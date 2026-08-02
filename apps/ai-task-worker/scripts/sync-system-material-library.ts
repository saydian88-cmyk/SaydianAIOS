import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

type Row = Record<string, any>;

const apiUrl = String(process.env.AI_TASK_API_URL || "https://stest.saydian.cn").replace(/\/+$/u, "");
const token = String(process.env.AI_TASK_RUNNER_TOKEN || "");
const nodeCode = String(process.env.AI_TASK_RUNNER_NODE_CODE || "windows-codex-video-01");
const libraryRoot = resolve(String(process.env.AI_TASK_LOCAL_MEDIA_LIBRARY || "F:\\赛电品牌素材库"));
const packagingRoot = resolve(String(process.env.AI_TASK_LOCAL_PACKAGING_LIBRARY || "F:\\包装资源包"));
const indexRoot = join(libraryRoot, ".saidian-system-index");
const mapPath = join(indexRoot, "system-asset-map.json");
const statePath = join(indexRoot, "sync-state.json");
const logPath = join(indexRoot, "sync-report.json");
const verifiedEditingManifestPath = join(indexRoot, "verified-editing-videos-by-product.json");

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

function productValidationOf(asset: Row): Row {
  const value = asset.aiIndex?.product_model_validation;
  const explicit = value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
  if (String(explicit.status || "").trim()) return explicit;
  const relatedModels = Array.from(new Set(
    (Array.isArray(asset.products) ? asset.products : [])
      .map((item: Row) => String(item?.product?.modelCode || "").trim())
      .filter(Boolean),
  ));
  return relatedModels.length === 1
    ? {
      status: "VERIFIED",
      matchedModelCode: relatedModels[0],
      detectedModels: relatedModels,
      evidenceSource: "SYSTEM_PRODUCT_RELATION",
    }
    : explicit;
}

function verifiedModelOf(asset: Row) {
  const validation = productValidationOf(asset);
  if (String(validation.status || "").toUpperCase() !== "VERIFIED") return "";
  return cleanName(String(validation.matchedModelCode || strings(asset.aiIndex?.product_model)[0] || ""));
}

function isPackagingAsset(asset: Row) {
  const purposes = strings(asset.aiIndex?.purpose).join(" ");
  const scenes = strings(asset.aiIndex?.scene).join(" ");
  const searchable = `${purposes} ${scenes} ${String(asset.searchText || "")} ${strings(asset.tags).join(" ")}`;
  return /包装|贴纸|花字|音效|转场|边框|角标|背景|BGM|字体|模板/u.test(searchable);
}

function isVerifiedEditingVideo(asset: Row) {
  return asset.kind === "VIDEO" && !isPackagingAsset(asset) && Boolean(verifiedModelOf(asset));
}

function modelOf(asset: Row) {
  const learned = verifiedModelOf(asset) || strings(asset.aiIndex?.product_model)[0];
  const related = Array.isArray(asset.products) ? asset.products.map((item: Row) => String(item.product?.modelCode || "")).find(Boolean) : "";
  return cleanName(learned || related || (asset.kind === "VIDEO" ? "未验证型号" : "通用"));
}

function destinationOf(asset: Row) {
  const model = modelOf(asset);
  const purposes = strings(asset.aiIndex?.purpose).join(" ");
  const scenes = strings(asset.aiIndex?.scene).join(" ");
  if (isPackagingAsset(asset)) {
    const category = cleanName(strings(asset.aiIndex?.purpose)[0] || String(asset.kind || "通用"));
    return join(packagingRoot, "系统同步", category);
  }
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

async function localHashes(existingMap: Row, changes: Row[]) {
  const byHash = new Map<string, string>();
  const desiredHashes = new Set(changes.filter((asset) => asset.usable === true && asset.sha256).map((asset) => String(asset.sha256)));
  if (!desiredHashes.size) return byHash;
  for (const entry of Object.values(existingMap) as Row[]) {
    const path = String(entry.localPath || "");
    const sha256 = String(entry.sha256 || "");
    if (path && desiredHashes.has(sha256)) {
      try {
        if ((await stat(path)).isFile()) {
          byHash.set(sha256, path);
        }
      } catch { /* missing mapped file will be restored below */ }
    }
  }
  return byHash;
}

async function existingSourcePath(asset: Row) {
  const candidates: string[] = [];
  const sourcePath = String(asset.sourcePath || "");
  if (/^[a-z]:[\\/]/iu.test(sourcePath)) candidates.push(resolve(sourcePath));
  const metadata = asset.packagingMetadata && typeof asset.packagingMetadata === "object" ? asset.packagingMetadata : {};
  const relativePath = String(metadata.originalRelativePath || "");
  if (relativePath) candidates.push(resolve(packagingRoot, relativePath));
  for (const path of candidates) {
    try {
      const file = await stat(path);
      if (file.isFile() && (!Number(asset.sizeBytes || 0) || file.size === Number(asset.sizeBytes))) return path;
    } catch { /* try next candidate */ }
  }
  return "";
}

async function download(asset: Row, url: string, target: string, byHash: Map<string, string>) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`下载失败 ${asset.id}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentSha256 = hash(buffer);
  const expectedSize = Number(asset.sizeBytes || 0);
  if (expectedSize > 0 && buffer.length !== expectedSize) throw new Error(`下载大小校验失败：${asset.id}`);
  const existingPath = byHash.get(contentSha256);
  if (existingPath) return { localPath: existingPath, contentSha256, reused: true };
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
  byHash.set(contentSha256, target);
  return { localPath: target, contentSha256, reused: false };
}

async function main() {
  const syncStartedAt = Date.now();
  await mkdir(indexRoot, { recursive: true });
  const oldState = await readJson(statePath);
  const mapping = await readJson(mapPath);
  const changes: Row[] = [];
  let cursor = String(oldState.cursor || "");
  let hasMore = true;
  while (hasMore) {
    const query = new URLSearchParams({ nodeCode });
    if (cursor) query.set("cursor", cursor);
    const page = await api(`/api/v1/ai-tasks/runner/material-mirror-index?${query.toString()}`);
    changes.push(...(Array.isArray(page.changes) ? page.changes : []));
    cursor = String(page.cursor || cursor);
    hasMore = page.hasMore === true;
  }

  const byHash = await localHashes(mapping, changes);
  const pending = changes.filter((asset) => asset.usable === true && asset.sha256 && !byHash.has(String(asset.sha256)));
  const urls = new Map<string, string>();
  for (let start = 0; start < pending.length; start += 1_000) {
    const batch = pending.slice(start, start + 1_000);
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
      let contentSha256 = sha;
      if (!localPath) {
        localPath = await existingSourcePath(asset);
        if (localPath) {
          contentSha256 = hash(await readFile(localPath));
          byHash.set(contentSha256, localPath);
        }
      }
      if (!localPath) {
        const extension = String(asset.extension || extname(String(asset.displayName || "")) || ".bin");
        const folder = destinationOf(asset);
        const filename = `${cleanName(String(asset.displayName || asset.assetNo || id))}__${cleanName(String(asset.assetNo || id))}${extension.startsWith(".") ? extension : `.${extension}`}`;
        localPath = join(folder, filename);
        try {
          const url = urls.get(id);
          if (!url) throw new Error("系统未返回下载地址");
          const result = await download(asset, url, localPath, byHash);
          localPath = result.localPath;
          contentSha256 = result.contentSha256;
          if (result.reused) linked += group.length;
          else downloaded += 1;
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
          contentSha256,
          localPath,
          relativePath: relative(libraryRoot, localPath).replaceAll("\\", "/"),
          sourceRoot: localPath.toLowerCase().startsWith(packagingRoot.toLowerCase()) ? packagingRoot : libraryRoot,
          displayName: item.displayName,
          kind: item.kind,
          model: modelOf(item),
          visualProductValidation: productValidationOf(item),
          editingEligible: isVerifiedEditingVideo(item),
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
  const report = { syncedAt: new Date().toISOString(), mode: "INCREMENTAL_CURSOR", fullLocalScan: false, libraryRoot, packagingRoot, changed: changes.length, linked, downloaded, disabled, failed: failures.length, failures };
  // Preserve mappings created by a local upload while this long-running scan was in progress.
  const latestMapping = await readJson(mapPath);
  for (const [id, entry] of Object.entries(latestMapping)) {
    const syncedAt = Date.parse(String((entry as Row).syncedAt || ""));
    if (Number.isFinite(syncedAt) && syncedAt >= syncStartedAt) mapping[id] = entry;
  }
  const verifiedEditingVideosByProduct = Object.values(mapping)
    .filter((entry): entry is Row => Boolean(entry) && typeof entry === "object")
    // Older mirrored rows predate product_model_validation, but already carry the
    // exact model resolved from the system AssetProduct relation. Rebuild the
    // admission manifest from that durable mapping so an incremental sync cannot
    // accidentally erase every locally available clip.
    .filter((entry) => entry.active === true && entry.kind === "VIDEO")
    .reduce<Record<string, Row[]>>((products, entry) => {
      const model = cleanName(String(entry.visualProductValidation?.matchedModelCode || entry.model || ""));
      if (!model || model === "未验证型号" || model === "通用") return products;
      const rows = products[model] || [];
      rows.push({
        systemAssetId: entry.systemAssetId,
        assetNo: entry.assetNo,
        displayName: entry.displayName,
        localPath: entry.localPath,
        relativePath: entry.relativePath,
        sha256: entry.sha256,
        productModel: model,
        contentDescription: entry.aiIndex?.summary || entry.searchText || "",
        purpose: entry.aiIndex?.purpose || [],
        feature: entry.aiIndex?.feature || [],
        scene: entry.aiIndex?.scene || [],
        action: entry.aiIndex?.action || [],
        shotType: entry.aiIndex?.shot_type || [],
      });
      products[model] = rows;
      return products;
    }, {});
  await writeJsonAtomic(mapPath, mapping);
  await writeJsonAtomic(verifiedEditingManifestPath, {
    policyVersion: 1,
    generatedAt: report.syncedAt,
    source: "SYSTEM_ASSET_LIBRARY",
    rule: "Only visually verified, exact-product, active VIDEO editing footage. Packaging, image, audio, unverified and cross-product assets are excluded.",
    products: verifiedEditingVideosByProduct,
  });
  await writeJsonAtomic(statePath, { cursor: failures.length ? String(oldState.cursor || "") : cursor, syncedAt: report.syncedAt });
  await writeJsonAtomic(logPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void main();
