import "dotenv/config";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { opsConfig } from "../src/config";
import { OssStorageService } from "../src/oss-storage.service";

const extensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".mp4", ".mov", ".mkv", ".webm", ".avi", ".mp3", ".wav", ".m4a", ".aac", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".md"]);
const images = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);
const videos = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi"]);

async function hash(path: string): Promise<string> {
  const digest = createHash("sha256");
  await new Promise<void>((done, failed) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", failed);
    stream.on("end", done);
  });
  return digest.digest("hex");
}

async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) files.push(child);
    }
  }
  await visit(root);
  return files;
}

async function manifestPaths(path: string): Promise<Array<{ path: string; sha256?: string }>> {
  const payload = JSON.parse(await readFile(resolve(path), "utf8")) as {
    items?: Array<{ final_path?: unknown; finalPath?: unknown; sha256?: unknown }>;
  };
  if (!Array.isArray(payload.items) || !payload.items.length) throw new Error("云端上传清单为空");
  const seen = new Set<string>();
  return payload.items.map((item, index) => {
    const finalPath = String(item.final_path || item.finalPath || "").trim();
    if (!finalPath) throw new Error(`云端上传清单第${index + 1}项缺少final_path`);
    const pathKey = resolve(finalPath).toLocaleLowerCase("zh-CN");
    if (seen.has(pathKey)) throw new Error(`云端上传清单存在重复最终路径：${finalPath}`);
    seen.add(pathKey);
    return { path: resolve(finalPath), sha256: String(item.sha256 || "").trim().toLowerCase() || undefined };
  });
}

function mediaType(extension: string) {
  if (images.has(extension)) return "IMAGE";
  if (videos.has(extension)) return "VIDEO";
  if ([".mp3", ".wav", ".m4a", ".aac"].includes(extension)) return "AUDIO";
  return "DOCUMENT";
}

function model(path: string): string | undefined {
  const matched = path.match(/W8\s*Ultra-?R|W8UltraR|W8Ultra|W8\s*Pro|W8PRO|W9S|W9|W8S|W8U|W8|W7\s*Pro|W7PRO|M7|S8Z|S8|S7Z|S7|S6|E8|E6|B8|W5|R8|R7Y|R7|C1|C2|DR07|FM1|M1|M2/iu)?.[0];
  if (!matched) return undefined;
  const key = matched.toUpperCase().replace(/\s+/gu, "");
  return ({ W8U: "W8Ultra", W8ULTRA: "W8Ultra", W8ULTRAR: "W8Ultra-R", "W8ULTRA-R": "W8Ultra-R", W7PRO: "W7PRO", W8PRO: "W8PRO" } as Record<string, string>)[key] || key;
}

async function send(records: Array<Record<string, unknown>>, actor: string) {
  const baseUrl = String(process.env.OPS_CENTER_URL || opsConfig.publicBaseUrl).replace(/\/$/, "");
  const token = String(process.env.OPS_CENTER_TOKEN || opsConfig.adminToken);
  const headers = { authorization: `Bearer ${token}`, "x-ops-actor": actor, "content-type": "application/json" };
  const response = await fetch(`${baseUrl}/api/v1/ledger/import-assets`, {
    method: "POST",
    headers,
    body: JSON.stringify({ records }),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`中台素材清单接口返回${response.status}：${JSON.stringify(result)}`);
  const assetIds = Array.isArray((result as { assetIds?: unknown }).assetIds)
    ? (result as { assetIds: unknown[] }).assetIds.map(String).filter(Boolean)
    : [];
  const analysis: Array<{ assetId: string; ok: boolean; status: number; result: unknown }> = [];
  for (const assetId of assetIds) {
    const analyzeResponse = await fetch(`${baseUrl}/api/v1/brand-data/assets/${encodeURIComponent(assetId)}/reanalyze`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(120_000),
    });
    const analyzeResult = await analyzeResponse.json().catch(() => ({}));
    analysis.push({ assetId, ok: analyzeResponse.ok, status: analyzeResponse.status, result: analyzeResult });
    if (!analyzeResponse.ok) throw new Error(`素材 ${assetId} 提交百炼分析失败（HTTP ${analyzeResponse.status}）`);
  }
  return { ...result, analysis };
}

async function main() {
  const storage = new OssStorageService();
  const health = await storage.healthCheck();
  if (!health.ok) throw new Error(health.message);
  const actor = process.env.OPS_ASSET_AGENT_ACTOR || opsConfig.defaultActor;
  const configuredSources = [
    ...opsConfig.assetRoots.map((root) => ({ root, type: "LOCAL_ASSET", category: "original" as const })),
    ...(opsConfig.wecomDriveRoot ? [{ root: opsConfig.wecomDriveRoot, type: "WECOM_DRIVE", category: "original" as const }] : []),
    { root: opsConfig.derivedOutputDir, type: "DERIVED_OUTPUT", category: "derived" as const },
  ];
  const requestedRoot = String(process.env.ASSET_AGENT_ROOT || "").trim();
  const uploadManifest = String(process.env.ASSET_UPLOAD_MANIFEST || "").trim();
  const sources = uploadManifest
    ? [{ root: "", type: "LOCAL_ASSET", category: "original" as const }]
    : requestedRoot
    ? [{ root: resolve(requestedRoot), type: "LOCAL_ASSET", category: "original" as const }]
    : configuredSources;
  const maxFiles = Math.max(0, Number(process.env.ASSET_AGENT_MAX_FILES || 0));
  const offset = Math.max(0, Number(process.env.ASSET_AGENT_OFFSET || 0));
  const results: unknown[] = [];
  let scanned = 0;
  for (const source of sources) {
    let paths: string[] = [];
    let declaredHashes = new Map<string, string>();
    try {
      if (uploadManifest) {
        const entries = await manifestPaths(uploadManifest);
        paths = entries.map((entry) => entry.path);
        declaredHashes = new Map(entries.filter((entry) => entry.sha256).map((entry) => [entry.path.toLocaleLowerCase("zh-CN"), entry.sha256!]));
      } else {
        paths = await walk(source.root);
      }
      paths.sort((left, right) => left.localeCompare(right, "zh-CN"));
      paths = maxFiles ? paths.slice(offset, offset + maxFiles) : paths.slice(offset);
    } catch (error) {
      results.push({ source: source.root, error: error instanceof Error ? error.message : "目录读取失败" });
      continue;
    }
    const manifest: Array<Record<string, unknown>> = [];
    for (const path of paths) {
      const before = await stat(path);
      const sha256 = await hash(path);
      const declaredHash = declaredHashes.get(path.toLocaleLowerCase("zh-CN"));
      if (declaredHash && declaredHash !== sha256) throw new Error(`云端上传清单哈希不一致：${path}`);
      const after = await stat(path);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) continue;
      const extension = extname(path).toLowerCase();
      const stored = await storage.uploadOriginal({ path, sha256, extension, actor, sourceType: source.type, category: source.category });
      const relativePath = uploadManifest ? relative(resolve(path, "..", "..", ".."), path) : relative(source.root, path);
      manifest.push({
        sourceKey: `${source.type}:${path.toLocaleLowerCase("zh-CN")}`,
        sourceType: source.type,
        sourcePath: path,
        fileName: path.split(sep).pop() || path,
        extension,
        mediaType: mediaType(extension),
        sha256,
        sizeBytes: before.size,
        modifiedAt: before.mtime.toISOString(),
        model: model(path),
        scene: relativePath.split(sep)[0],
        evidenceIds: [],
        qualityScore: mediaType(extension) === "DOCUMENT" ? 60 : 70,
        objectKey: stored.objectKey,
        objectVersionId: stored.objectVersionId,
        etag: stored.etag,
        storageUrl: stored.storageUrl,
        storageSyncedAt: stored.uploadedAt.toISOString(),
      });
      scanned += 1;
      if (manifest.length === 50) results.push(await send(manifest.splice(0), actor));
    }
    if (manifest.length) results.push(await send(manifest, actor));
  }
  process.stdout.write(`${JSON.stringify({ ok: true, scanned, results }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
