import "dotenv/config";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import { opsConfig } from "../src/config";
import { OssStorageService } from "../src/oss-storage.service";

type Category =
  | "BGM"
  | "BRAND_ELEMENT"
  | "FONT"
  | "LICENSE_DOCUMENT"
  | "TEXT_EFFECT"
  | "VIDEO_EFFECT"
  | "STICKER"
  | "SOUND_EFFECT"
  | "OTHER";

const rootCategories: Record<string, Category> = {
  BGM: "BGM",
  品牌元素: "BRAND_ELEMENT",
  字体: "FONT",
  授权资料: "LICENSE_DOCUMENT",
  文字特效: "TEXT_EFFECT",
  视频特效: "VIDEO_EFFECT",
  贴纸素材: "STICKER",
  音效: "SOUND_EFFECT",
};
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg"]);
const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi"]);
const audioExtensions = new Set([".mp3", ".wav", ".wma", ".m4a", ".aac", ".aif", ".aiff", ".ogg", ".mid"]);
const fontExtensions = new Set([".ttf", ".otf", ".ttc", ".woff", ".woff2"]);

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
      else if (entry.isFile()) files.push(child);
    }
  }
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function mediaType(extension: string): "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT" {
  if (imageExtensions.has(extension)) return "IMAGE";
  if (videoExtensions.has(extension)) return "VIDEO";
  if (audioExtensions.has(extension)) return "AUDIO";
  return "DOCUMENT";
}

function terms(relativePath: string): string[] {
  return Array.from(new Set(relativePath
    .replace(/\.[^.]+$/u, "")
    .split(/[\\/ _\-—–()[\]【】（）]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 1 && !/^\d+$/u.test(item))));
}

async function send(records: Array<Record<string, unknown>>, actor: string) {
  const baseUrl = String(process.env.OPS_CENTER_URL || opsConfig.publicBaseUrl).replace(/\/$/, "");
  const token = String(process.env.OPS_CENTER_TOKEN || opsConfig.adminToken);
  const response = await fetch(`${baseUrl}/api/v1/ledger/import-assets`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-ops-actor": actor, "content-type": "application/json" },
    body: JSON.stringify({ records }),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`包装资源清单接口返回 ${response.status}: ${JSON.stringify(result)}`);
  return result;
}

async function main() {
  const sourceRoot = resolve(String(process.env.PACKAGING_RESOURCE_ROOT || "F:\\包装资源包"));
  const storage = new OssStorageService();
  const health = await storage.healthCheck();
  if (!health.ok) throw new Error(health.message);
  const actor = process.env.PACKAGING_AGENT_ACTOR || "包装资源批量导入";
  const maxFiles = Math.max(0, Number(process.env.PACKAGING_AGENT_MAX_FILES || 0));
  const offset = Math.max(0, Number(process.env.PACKAGING_AGENT_OFFSET || 0));
  const allPaths = await walk(sourceRoot);
  const paths = maxFiles ? allPaths.slice(offset, offset + maxFiles) : allPaths.slice(offset);
  const manifest: Array<Record<string, unknown>> = [];
  let imported = 0;

  for (const path of paths) {
    const before = await stat(path);
    const relativePath = relative(sourceRoot, path);
    const rootFolder = relativePath.split(sep)[0];
    const category = rootCategories[rootFolder] || "OTHER";
    const extension = extname(path).toLowerCase();
    const sha256 = await hash(path);
    const after = await stat(path);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) continue;
    const stored = await storage.uploadOriginal({
      path,
      sha256,
      extension,
      actor,
      sourceType: "PACKAGING_RESOURCE_LIBRARY",
    });
    const keywords = terms(relativePath);
    const fileType = fontExtensions.has(extension) ? "DOCUMENT" : mediaType(extension);
    manifest.push({
      sourceKey: `PACKAGING_RESOURCE_LIBRARY:${sha256}`,
      sourceType: "PACKAGING_RESOURCE_LIBRARY",
      sourcePath: path,
      fileName: basename(path),
      extension,
      mediaType: fileType,
      purpose: "PACKAGING_RESOURCE",
      packagingCategory: category,
      sha256,
      sizeBytes: before.size,
      modifiedAt: before.mtime.toISOString(),
      scene: rootFolder,
      evidenceIds: [],
      qualityScore: 60,
      objectKey: stored.objectKey,
      objectVersionId: stored.objectVersionId,
      etag: stored.etag,
      storageUrl: stored.storageUrl,
      storageSyncedAt: stored.uploadedAt.toISOString(),
      searchText: [rootFolder, category, ...keywords].join(" "),
      packagingMetadata: {
        logicalName: `${rootFolder}_${keywords.slice(-3).join("_") || basename(path, extension)}`,
        originalRelativePath: relativePath,
        sourceFolder: rootFolder,
        keywords,
        indexStatus: "PATH_INDEXED_PENDING_AI",
        licenseStatus: "license_unknown",
        formalUseAllowed: false,
      },
    });
    imported += 1;
    if (manifest.length === 25) await send(manifest.splice(0), actor);
  }
  if (manifest.length) await send(manifest, actor);
  process.stdout.write(`${JSON.stringify({ ok: true, sourceRoot, discovered: allPaths.length, imported, offset, maxFiles }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
