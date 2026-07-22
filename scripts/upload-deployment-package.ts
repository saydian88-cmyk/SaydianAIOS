import OSS from "ali-oss";
import dotenv from "dotenv";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

async function main() {
  dotenv.config({ path: resolve(process.cwd(), ".env") });
  const objectKey = process.argv[2];
  if (!objectKey?.startsWith("brand-assets/system-deploy/")) {
    throw new Error("OSS object key must use brand-assets/system-deploy/");
  }

  const packagePath = resolve(process.cwd(), process.argv[3] || "artifacts/saidian-ops-windows.zip");
  const packageStat = await stat(packagePath);
  const client = new OSS({
    region: process.env.OSS_REGION,
    bucket: process.env.OSS_BUCKET,
    endpoint: process.env.OSS_ENDPOINT,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID ?? "",
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET ?? "",
  });

  const uploaded = await client.multipartUpload(objectKey, packagePath, {
    partSize: 5 * 1024 * 1024,
  });
  const signedUrl = client.signatureUrl(objectKey, { expires: 3600 });
  console.log(JSON.stringify({
    objectKey,
    size: packageStat.size,
    etag: uploaded.res.headers.etag,
    signedUrl,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
