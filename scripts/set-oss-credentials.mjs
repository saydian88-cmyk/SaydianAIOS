import { readFile, rename, writeFile } from "node:fs/promises";

function clean(value, name) {
  const text = String(value ?? "").trim();
  if (!text || /[\r\n]/.test(text)) throw new Error(`${name} 无效`);
  return text;
}

export async function setOssCredentials(envPath, accessKeyId, accessKeySecret) {
  const id = clean(accessKeyId, "OSS_ACCESS_KEY_ID");
  const secret = clean(accessKeySecret, "OSS_ACCESS_KEY_SECRET");
  const current = await readFile(envPath, "utf8");
  const next = current
    .replace(/^OSS_ACCESS_KEY_ID=.*$/m, `OSS_ACCESS_KEY_ID=${id}`)
    .replace(/^OSS_ACCESS_KEY_SECRET=.*$/m, `OSS_ACCESS_KEY_SECRET=${secret}`);
  if (next === current || !next.includes(`OSS_ACCESS_KEY_ID=${id}`) || !next.includes(`OSS_ACCESS_KEY_SECRET=${secret}`)) {
    throw new Error("未找到 OSS 凭据配置项");
  }
  const temporaryPath = `${envPath}.tmp`;
  await writeFile(temporaryPath, next, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, envPath);
}
