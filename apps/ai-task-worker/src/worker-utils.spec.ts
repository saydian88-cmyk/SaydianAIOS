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

  it("marks batch-only final delivery checks as not applicable for a direct single-master task", () => {
    const exemptions = (workerUtils as Record<string, unknown>).directSingleMasterFinalExemptions;
    expect(exemptions).toBeTypeOf("function");
    expect((exemptions as () => Array<{ id: string; applicable: boolean }>)()).toEqual([
      { id: "batch_sequence_consistent", applicable: false },
      { id: "cover_title_complete", applicable: false },
      { id: "final_folder_clean", applicable: false },
      { id: "final_delivery_validator_passed", applicable: false },
    ]);
  });

  it("requires a single image post to return an empty groups array", () => {
    const instruction = (workerUtils as Record<string, unknown>).imagePostGroupsInstruction;
    expect(instruction).toBeTypeOf("function");
    expect((instruction as (groupCount: number) => string)(0)).toContain("empty array []");
    expect((instruction as (groupCount: number) => string)(2)).toContain("one complete result per groupKey");
  });

  it("leaves image material selection to the downstream skill", () => {
    const instruction = (workerUtils as Record<string, unknown>).imagePostMaterialSelectionInstruction;
    expect(instruction).toBeTypeOf("function");
    const value = (instruction as () => string)();
    expect(value).toContain("independently select");
    expect(value).toContain("internal group plan");
    expect(value).toContain("self-check and rebuild");
    expect(value).not.toContain("F:\\");
  });

  it("requires direct HyperFrames videos to pass lint without media identifier errors", () => {
    const instruction = (workerUtils as Record<string, unknown>).directHyperframesLintInstruction;
    expect(instruction).toBeTypeOf("function");
    expect((instruction as () => string)()).toContain("unique id");
    expect((instruction as () => string)()).toContain("zero errors");
  });
});
