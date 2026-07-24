import { Injectable } from "@nestjs/common";
import OSS from "ali-oss";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { opsConfig } from "./config";

export interface OssUploadResult {
  objectKey: string;
  objectVersionId?: string;
  etag?: string;
  storageUrl: string;
  uploadedAt: Date;
}

function headerValue(value: string): string {
  return encodeURIComponent(value).slice(0, 512);
}

@Injectable()
export class OssStorageService {
  isConfigured(): boolean {
    return Boolean(
      opsConfig.oss.region &&
      opsConfig.oss.bucket &&
      opsConfig.oss.accessKeyId &&
      opsConfig.oss.accessKeySecret,
    );
  }

  configurationMessage(): string {
    if (this.isConfigured()) return `Bucket ${opsConfig.oss.bucket} 已配置`;
    return "Bucket 已创建，待配置 OSS_ACCESS_KEY_ID 和 OSS_ACCESS_KEY_SECRET";
  }

  private client(): OSS {
    if (!this.isConfigured()) throw new Error(this.configurationMessage());
    return new OSS({
      region: opsConfig.oss.region,
      bucket: opsConfig.oss.bucket,
      endpoint: opsConfig.oss.endpoint,
      accessKeyId: opsConfig.oss.accessKeyId,
      accessKeySecret: opsConfig.oss.accessKeySecret,
      secure: true,
      timeout: 120_000,
    });
  }

  objectKeyForFile(sha256: string, extension: string, category: "original" | "derived"): string {
    const normalizedExtension = extension.toLowerCase().replace(/[^a-z0-9.]/g, "");
    if (category === "original") return `${opsConfig.oss.prefix}/original/${sha256.slice(0, 2)}/${sha256}${normalizedExtension}`;
    return `${opsConfig.oss.prefix}/derived/legacy/${sha256.slice(0, 2)}/${sha256}${normalizedExtension}`;
  }

  derivedObjectKey(assetId: string, derivedType: string, version: number, sha256: string, extension: string): string {
    const safeType = derivedType.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const safeExtension = extension.toLowerCase().replace(/[^a-z0-9.]/g, "");
    return `${opsConfig.oss.prefix}/derived/${assetId}/${safeType}/${version}/${sha256}${safeExtension}`;
  }

  previewObjectKey(assetId: string, version: number, fileName: string): string {
    const safeName = fileName.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
    return `${opsConfig.oss.prefix}/preview/${assetId}/${version}/${safeName}`;
  }

  analysisObjectKey(assetId: string, analysisVersion: number, fileName: string): string {
    const safeName = fileName.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
    return `${opsConfig.oss.prefix}/analysis/${assetId}/${analysisVersion}/${safeName}`;
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this.isConfigured()) return { ok: false, message: this.configurationMessage() };
    try {
      await this.client().list({ prefix: `${opsConfig.oss.prefix}/`, "max-keys": 1 }, {});
      return { ok: true, message: `Bucket ${opsConfig.oss.bucket} 连接正常` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "OSS 连接失败" };
    }
  }

  async uploadOriginal(input: {
    path: string;
    sha256: string;
    extension: string;
    actor: string;
    sourceType: string;
    category?: "original" | "derived";
  }): Promise<OssUploadResult> {
    const objectKey = this.objectKeyForFile(input.sha256, input.extension, input.category ?? "original");
    const client = this.client();
    try {
      const existing = await client.head(objectKey);
      const existingHeaders = existing.res.headers as Record<string, string | undefined>;
      return {
        objectKey,
        objectVersionId: existingHeaders["x-oss-version-id"],
        etag: existingHeaders.etag?.replace(/^\"|\"$/g, ""),
        storageUrl: `oss://${opsConfig.oss.bucket}/${objectKey}`,
        uploadedAt: new Date(),
      };
    } catch (error) {
      const status = typeof error === "object" && error ? Number((error as { status?: unknown }).status ?? 0) : 0;
      const code = typeof error === "object" && error ? String((error as { code?: unknown }).code ?? "") : "";
      if (status !== 404 && code !== "NoSuchKey" && code !== "NoSuchObject") throw error;
    }

    const headers = {
      "x-oss-forbid-overwrite": "true",
      "x-oss-server-side-encryption": "AES256",
      "x-oss-meta-sha256": input.sha256,
      "x-oss-meta-originalname": headerValue(basename(input.path)),
      "x-oss-meta-uploadedby": headerValue(input.actor),
      "x-oss-meta-sourcetype": headerValue(input.sourceType),
    };
    const file = await stat(input.path);
    const upload = file.size >= 16 * 1024 * 1024
      ? client.multipartUpload(objectKey, input.path, {
          parallel: 4,
          partSize: 8 * 1024 * 1024,
          timeout: 600_000,
          headers,
        })
      : client.put(objectKey, input.path, { headers });
    const result = await upload.catch(async (error: unknown) => {
      const code = typeof error === "object" && error ? String((error as { code?: unknown }).code ?? "") : "";
      if (code === "FileAlreadyExists" || code === "ObjectAlreadyExists") {
        const head = await client.head(objectKey);
        return {
          name: objectKey,
          url: `oss://${opsConfig.oss.bucket}/${objectKey}`,
          data: {},
          res: head.res,
        };
      }
      throw error;
    });
    const resultHeaders = result.res.headers as Record<string, string | undefined>;
    return {
      objectKey,
      objectVersionId: resultHeaders["x-oss-version-id"],
      etag: resultHeaders.etag?.replace(/^\"|\"$/g, ""),
      storageUrl: `oss://${opsConfig.oss.bucket}/${objectKey}`,
      uploadedAt: new Date(),
    };
  }

  async uploadBuffer(input: {
    buffer: Buffer;
    originalName: string;
    sha256: string;
    extension: string;
    actor: string;
    sourceType: string;
    category?: "original" | "derived";
  }): Promise<OssUploadResult> {
    const objectKey = this.objectKeyForFile(input.sha256, input.extension, input.category ?? "original");
    const client = this.client();
    try {
      const existing = await client.head(objectKey);
      const existingHeaders = existing.res.headers as Record<string, string | undefined>;
      return {
        objectKey,
        objectVersionId: existingHeaders["x-oss-version-id"],
        etag: existingHeaders.etag?.replace(/^\"|\"$/g, ""),
        storageUrl: `oss://${opsConfig.oss.bucket}/${objectKey}`,
        uploadedAt: new Date(),
      };
    } catch (error) {
      const uploadStatus = typeof error === "object" && error ? Number((error as { status?: unknown }).status ?? 0) : 0;
      const code = typeof error === "object" && error ? String((error as { code?: unknown }).code ?? "") : "";
      if (uploadStatus !== 404 && code !== "NoSuchKey" && code !== "NoSuchObject") throw error;
    }
    const result = await client.put(objectKey, input.buffer, {
      headers: {
        "x-oss-forbid-overwrite": "true",
        "x-oss-server-side-encryption": "AES256",
        "x-oss-meta-sha256": input.sha256,
        "x-oss-meta-originalname": headerValue(input.originalName),
        "x-oss-meta-uploadedby": headerValue(input.actor),
        "x-oss-meta-sourcetype": headerValue(input.sourceType),
      },
    });
    const headers = result.res.headers as Record<string, string | undefined>;
    return {
      objectKey,
      objectVersionId: headers["x-oss-version-id"],
      etag: headers.etag?.replace(/^\"|\"$/g, ""),
      storageUrl: `oss://${opsConfig.oss.bucket}/${objectKey}`,
      uploadedAt: new Date(),
    };
  }

  async uploadGeneratedBuffer(input: {
    objectKey: string;
    buffer: Buffer;
    actor: string;
    sourceType: string;
    sha256: string;
    originalName: string;
  }): Promise<OssUploadResult> {
    const client = this.client();
    const result = await client.put(input.objectKey, input.buffer, {
      headers: {
        "x-oss-server-side-encryption": "AES256",
        "x-oss-meta-sha256": input.sha256,
        "x-oss-meta-originalname": headerValue(input.originalName),
        "x-oss-meta-uploadedby": headerValue(input.actor),
        "x-oss-meta-sourcetype": headerValue(input.sourceType),
      },
    });
    const headers = result.res.headers as Record<string, string | undefined>;
    return {
      objectKey: input.objectKey,
      objectVersionId: headers["x-oss-version-id"],
      etag: headers.etag?.replace(/^"|"$/g, ""),
      storageUrl: `oss://${opsConfig.oss.bucket}/${input.objectKey}`,
      uploadedAt: new Date(),
    };
  }

  signedDownloadUrl(objectKey: string, expiresSeconds = 1_800): string {
    return this.client().signatureUrl(objectKey, { expires: expiresSeconds, method: "GET" });
  }
}
