import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { opsConfig } from "./config";

export type DouyinSecret = {
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  openId?: string;
  scope?: string;
  expiresAt?: string;
  refreshExpiresAt?: string;
  oauthState?: string;
  oauthStateExpiresAt?: string;
};

export type IntegrationSecretBundle = {
  viralCollectorToken?: string;
  tikhubApiKey?: string;
  selfHostedCollectorToken?: string;
  douyin?: DouyinSecret;
};

function encryptionKey() {
  return createHash("sha256").update(opsConfig.authSecret).digest();
}

function decryptRaw(value: string) {
  if (!value.startsWith("enc:")) return value;
  try {
    const [, ivValue, tagValue, encryptedValue] = value.split(":");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivValue, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

export function readIntegrationSecret(value?: string | null): IntegrationSecretBundle {
  if (!value) return {};
  const raw = decryptRaw(value);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as IntegrationSecretBundle;
    }
  } catch {
    // Existing records stored the collector token directly.
  }
  return { viralCollectorToken: raw };
}

export function writeIntegrationSecret(bundle: IntegrationSecretBundle) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(bundle), "utf8"),
    cipher.final(),
  ]);
  return `enc:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}
