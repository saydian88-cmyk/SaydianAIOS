import { describe, expect, it } from "vitest";
import { assertCodexDirectMasterOutput, batchDirectOutputFilesSchema, batchVideoRequests } from "./direct-video-contract";

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
    expect(batchDirectOutputFilesSchema().items.properties.metadata.properties.durationSeconds).toEqual({ type: "number" });
  });

  it("keeps the required key together with its product and ordinal", () => {
    expect(batchVideoRequests(batchTask.task.input)).toEqual([
      { videoKey: "1-1", productModel: "W8Ultra-R", ordinal: 1 },
      { videoKey: "1-2", productModel: "W8Ultra-R", ordinal: 2 },
      { videoKey: "2-1", productModel: "W8Ultra", ordinal: 1 },
      { videoKey: "2-2", productModel: "W8Ultra", ordinal: 2 },
    ]);
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
        { videoKey: "1-1", status: "READY", outputFile: "out/1-1.mp4", coverFile: "out/1-1.jpg", title: "W8Ultra 腕上操作展示", tags: ["赛电W8Ultra", "腕上操作", "智能手表", "气囊表带", "产品展示"], failureReason: "" },
        { videoKey: "1-2", status: "FAILED", outputFile: "", coverFile: "", failureReason: "render failed" },
        { videoKey: "2-1", status: "READY", outputFile: "out/2-1.mp4", coverFile: "out/2-1.jpg", title: "W8Ultra-R 轻薄机身展示", tags: ["赛电W8Ultra-R", "轻薄机身", "智能手表", "腕上展示", "产品展示"], failureReason: "" },
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
        { videoKey: "1-1", status: "READY", outputFile: "out/1-1.mp4", coverFile: "out/1-1.jpg", title: "W8Ultra 腕上操作展示", tags: ["赛电W8Ultra", "腕上操作", "智能手表", "气囊表带", "产品展示"], failureReason: "" },
        { videoKey: "1-2", status: "FAILED", outputFile: "", coverFile: "", failureReason: "render failed" },
        { videoKey: "2-1", status: "FAILED", outputFile: "", coverFile: "", failureReason: "render failed" },
        { videoKey: "2-2", status: "FAILED", outputFile: "", coverFile: "", failureReason: "render failed" },
      ],
    }, batchTask)).toThrow("COVER_IMAGE");
  });

  it("rejects a READY result with missing title or fewer than five tags", () => {
    expect(() => assertCodexDirectMasterOutput({
      summary: "one completed",
      outputFiles: [
        { kind: "VIDEO_MASTER", path: "out/1-1.mp4" },
        { kind: "COVER_IMAGE", path: "out/1-1.jpg", metadata: { videoKey: "1-1" } },
      ],
      batchResults: [
        { videoKey: "1-1", status: "READY", outputFile: "out/1-1.mp4", coverFile: "out/1-1.jpg", title: "", tags: ["a", "b", "c"], failureReason: "" },
        { videoKey: "1-2", status: "FAILED", outputFile: "", coverFile: "", failureReason: "render failed" },
        { videoKey: "2-1", status: "FAILED", outputFile: "", coverFile: "", failureReason: "render failed" },
        { videoKey: "2-2", status: "FAILED", outputFile: "", coverFile: "", failureReason: "render failed" },
      ],
    }, batchTask)).toThrow("标题");
  });
});

describe("reference direct-video result contract", () => {
  const referenceTask = {
    task: { type: "VIDEO", input: { referenceDirectFullVideo: true } },
    execution: { mode: "FULL_VIDEO" },
  };
  const output = (referenceEvidence: Record<string, unknown>) => ({
    outputFiles: [{ kind: "VIDEO_MASTER", path: "out/master.mp4", metadata: { durationSeconds: 18 } }],
    referenceEvidence,
  });

  it("requires evidence that the reference and its complete ending were used", () => {
    expect(() => assertCodexDirectMasterOutput(output({
      referenceDurationSeconds: 16,
      audioMode: "REFERENCE_ORIGINAL",
      voiceProvider: "REFERENCE_ORIGINAL",
      audioEndSeconds: 17.5,
      endingAudited: true,
    }), referenceTask)).not.toThrow();
  });

  it("rejects Windows default speech and truncated audio", () => {
    expect(() => assertCodexDirectMasterOutput(output({
      referenceDurationSeconds: 16,
      audioMode: "DOUBAO",
      voiceProvider: "Windows SAPI",
      audioEndSeconds: 17.9,
      endingAudited: false,
    }), referenceTask)).toThrow("Windows TTS");
  });
});
