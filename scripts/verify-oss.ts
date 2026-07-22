import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

async function main() {
  const envPath = /[\\/]apps[\\/]api$/i.test(process.cwd())
    ? resolve(process.cwd(), "..", "..", ".env")
    : resolve(process.cwd(), ".env");
  dotenv.config({ path: envPath });
  const { OssStorageService } = await import("../apps/api/src/oss-storage.service");
  const sourcePath = "F:\\xcodeplace\\视频创作\\赛电品牌素材库\\赛电品牌素材库.xlsx";
  const bytes = await readFile(sourcePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storage = new OssStorageService();
  const health = await storage.healthCheck();
  if (!health.ok) throw new Error(health.message);

  const uploaded = await storage.uploadOriginal({
    path: sourcePath,
    sha256,
    extension: extname(sourcePath),
    actor: "系统接入验证",
    sourceType: "LOCAL_ASSET",
  });

  console.log(JSON.stringify({
    health: health.message,
    objectKey: uploaded.objectKey,
    versionId: uploaded.objectVersionId ?? "未返回",
    etag: uploaded.etag ?? "未返回",
    storageUrl: uploaded.storageUrl,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
