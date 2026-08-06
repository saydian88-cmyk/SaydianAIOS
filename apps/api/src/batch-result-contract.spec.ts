import { describe, expect, it } from "vitest";
import { normalizeBatchResult } from "./batch-result-contract";

describe("batch result contract", () => {
  it("retains ready items when other batch items fail", () => {
    expect(normalizeBatchResult(["1-1", "1-2", "2-1"], [
      { key: "1-1", status: "READY", assets: ["one.mp4"] },
      { key: "1-2", status: "FAILED", failureReason: "素材不足" },
      { key: "2-1", status: "READY", assets: ["three.mp4"] },
    ])).toEqual([
      { key: "1-1", status: "READY", assets: ["one.mp4"], failureReason: "" },
      { key: "1-2", status: "FAILED", assets: [], failureReason: "素材不足" },
      { key: "2-1", status: "READY", assets: ["three.mp4"], failureReason: "" },
    ]);
  });
});
