import { createHash } from "node:crypto";

export function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "asset";
}

export function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifySha256(value: Buffer, expected?: string) {
  return !expected || sha256(value).toLowerCase() === expected.toLowerCase();
}

export const videoRouteKeys = [
  "STANDARD_SMART_VIDEO",
  "REFERENCE_DIRECT_FULL_VIDEO",
  "CODEX_DIRECT_FULL_VIDEO",
] as const;

export function availableClaimRouteKeys(
  activeVideoCount: number,
  activeImageCount: number,
  maxVideoConcurrency: number,
  maxImageConcurrency: number,
) {
  const keys: string[] = [];
  if (activeVideoCount < maxVideoConcurrency) keys.push(...videoRouteKeys);
  if (activeImageCount < maxImageConcurrency) keys.push("IMAGE_POST");
  return keys;
}
