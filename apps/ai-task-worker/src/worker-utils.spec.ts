import { describe, expect, it } from "vitest";
import { safeName, sha256, verifySha256 } from "./worker-utils";

describe("worker utils", () => {
  it("creates a safe task filename", () => {
    expect(safeName("AIT 2026/07/28 中文")).toBe("AIT-2026-07-28");
  });

  it("verifies downloaded asset hashes", () => {
    const content = Buffer.from("approved-asset");
    const digest = sha256(content);
    expect(verifySha256(content, digest)).toBe(true);
    expect(verifySha256(Buffer.from("changed"), digest)).toBe(false);
  });
});
