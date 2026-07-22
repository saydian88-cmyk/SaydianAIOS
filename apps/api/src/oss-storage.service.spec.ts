import { describe, expect, it } from "vitest";
import { OssStorageService } from "./oss-storage.service";

describe("OssStorageService", () => {
  it("uses a hash-based object key for original material deduplication", () => {
    const storage = new OssStorageService();
    const sha256 = "ab".repeat(32);
    expect(storage.objectKeyForFile(sha256, ".MP4", "original"))
      .toBe(`brand-assets/original/ab/${sha256}.mp4`);
  });

  it("separates derived material from original material", () => {
    const storage = new OssStorageService();
    const sha256 = "cd".repeat(32);
    expect(storage.objectKeyForFile(sha256, ".md", "derived"))
      .toBe(`brand-assets/derived/cd/${sha256}.md`);
  });
});
