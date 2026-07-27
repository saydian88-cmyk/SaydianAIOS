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
