import { describe, expect, it } from "vitest";
import * as workerUtils from "./worker-utils";
import { availableClaimRouteKeys, safeName, sha256, verifySha256 } from "./worker-utils";

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

  it("keeps video and image claim pools independent", () => {
    expect(availableClaimRouteKeys(0, 0, 1, 2)).toEqual([
      "STANDARD_SMART_VIDEO",
      "REFERENCE_DIRECT_FULL_VIDEO",
      "CODEX_DIRECT_FULL_VIDEO",
      "IMAGE_POST",
    ]);
    expect(availableClaimRouteKeys(1, 1, 1, 2)).toEqual(["IMAGE_POST"]);
    expect(availableClaimRouteKeys(0, 2, 1, 2)).toEqual([
      "STANDARD_SMART_VIDEO",
      "REFERENCE_DIRECT_FULL_VIDEO",
      "CODEX_DIRECT_FULL_VIDEO",
    ]);
    expect(availableClaimRouteKeys(1, 2, 1, 2)).toEqual([]);
  });

  it("recognizes HyperFrames from successful render command logs when project metadata is generic", () => {
    const detector = (workerUtils as Record<string, unknown>).hasHyperframesRenderEvidence;
    expect(detector).toBeTypeOf("function");
    expect((detector as (value: unknown) => boolean)({
      project: "project",
      commands: [
        { name: "doctor", log: "logs/hyperframes-doctor.log", passed: true },
        { name: "render", log: "project/logs/render-qa-caption-001.log", passed: true },
      ],
    })).toBe(true);
  });
});
