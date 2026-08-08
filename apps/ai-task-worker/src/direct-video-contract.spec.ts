import { describe, expect, it } from "vitest";
import { assertCodexDirectMasterOutput, batchDirectOutputFilesSchema } from "./direct-video-contract";

const batchTask = {
  task: {
    type: "VIDEO",
    input: {
      batchCodexDirectFullVideo: true,
      batchDirectInput: {
        products: [{ model: "W8Ultra-R", count: 2 }, { model: "W8Ultra", count: 2 }],
      },
    },
  },
  execution: { mode: "FULL_VIDEO" },
};

describe("batch Codex direct-video result contract", () => {
  it("declares videoKey in the batch output metadata schema", () => {
    expect(batchDirectOutputFilesSchema().items.properties.metadata.properties.videoKey).toEqual({ type: "string" });
  });

  it("accepts several masters and preserves a partial batch result", () => {
    expect(() => assertCodexDirectMasterOutput({
      summary: "2 completed, 2 failed",
      outputFiles: [
        { kind: "VIDEO_MASTER", path: "out/1-1.mp4" },
        { kind: "COVER_IMAGE", path: "out/1-1.jpg", metadata: { videoKey: "1-1" } },
        { kind: "VIDEO_MASTER", path: "out/2-1.mp4" },
        { kind: "COVER_IMAGE", path: "out/2-1.jpg", metadata: { videoKey: "2-1" } },
      ],
      batchResults: [
        { videoKey: "1-1", status: "READY", outputFile: "out/1-1.mp4", coverFile: "out/1-1.jpg", failureReason: "" },
        { videoKey: "1-2", status: "FAILED", outputFile: "", coverFile: "", failureReason: "render failed" },
        { videoKey: "2-1", status: "READY", outputFile: "out/2-1.mp4", coverFile: "out/2-1.jpg", failureReason: "" },
        { videoKey: "2-2", status: "FAILED", outputFile: "", coverFile: "", failureReason: "render failed" },
      ],
    }, batchTask)).not.toThrow();
  });

  it("rejects a batch result that omits a requested video key", () => {
    expect(() => assertCodexDirectMasterOutput({
      summary: "only one result",
      outputFiles: [{ kind: "VIDEO_MASTER", path: "out/1-1.mp4" }],
      batchResults: [
        { videoKey: "1-1", status: "READY", outputFile: "out/1-1.mp4", failureReason: "" },
      ],
    }, batchTask)).toThrow("batchResults");
  });

  it("rejects a READY result whose cover was not uploaded", () => {
    expect(() => assertCodexDirectMasterOutput({
      summary: "one completed",
      outputFiles: [{ kind: "VIDEO_MASTER", path: "out/1-1.mp4" }],
      batchResults: [
        { videoKey: "1-1", status: "READY", outputFile: "out/1-1.mp4", coverFile: "out/1-1.jpg", failureReason: "" },
        { videoKey: "1-2", status: "FAILED", outputFile: "", coverFile: "", failureReason: "render failed" },
        { videoKey: "2-1", status: "FAILED", outputFile: "", coverFile: "", failureReason: "render failed" },
        { videoKey: "2-2", status: "FAILED", outputFile: "", coverFile: "", failureReason: "render failed" },
      ],
    }, batchTask)).toThrow("COVER_IMAGE");
  });
});
