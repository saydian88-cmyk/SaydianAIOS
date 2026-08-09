import type { JsonRecord } from "./skill-router";

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

export function batchDirectOutputFilesSchema() {
  return {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        kind: { type: "string" },
        title: { type: "string" },
        metadata: {
          type: "object",
          additionalProperties: false,
          properties: {
            description: { type: "string" },
            source: { type: "string" },
            videoKey: { type: "string" },
          },
          required: ["description", "source", "videoKey"],
        },
      },
      required: ["path", "kind", "title", "metadata"],
    },
  };
}

export type BatchVideoRequest = {
  videoKey: string;
  productModel: string;
  ordinal: number;
};

export function batchVideoRequests(input: JsonRecord): BatchVideoRequest[] {
  const retryKeys = Array.isArray(input.retryVideoKeys)
    ? input.retryVideoKeys.map(String).filter(Boolean)
    : [];
  if (retryKeys.length) return retryKeys.map((videoKey) => ({ videoKey, productModel: "", ordinal: 0 }));
  const batchInput = record(input.batchDirectInput);
  const products = Array.isArray(batchInput.products) ? batchInput.products.map(record) : [];
  return products.flatMap((product, index) => Array.from(
    { length: Math.max(0, Math.round(Number(product.count || 0))) },
    (_, itemIndex) => ({
      videoKey: `${index + 1}-${itemIndex + 1}`,
      productModel: String(product.model || "").trim(),
      ordinal: itemIndex + 1,
    }),
  ));
}

export function expectedBatchVideoKeys(input: JsonRecord) {
  return batchVideoRequests(input).map((item) => item.videoKey);
}

export function isCodexDirectFullVideoTask(taskPackage: JsonRecord) {
  const task = record(taskPackage.task);
  const execution = record(taskPackage.execution);
  const input = record(task.input);
  const taskRoute = record(input.taskRoute);
  const localLibraryCodexTask = String(input.executionClass || "").toUpperCase() === "CODEX_SKILL"
    && String(input.skillName || "").toLowerCase() === "video-editing-from-media-library";
  const directRoute = ["CODEX_DIRECT_FULL_VIDEO", "REFERENCE_DIRECT_FULL_VIDEO"]
    .includes(String(taskRoute.projectMode || "").toUpperCase());
  return String(task.type || "") === "VIDEO"
    && String(execution.mode || "").toUpperCase() === "FULL_VIDEO"
    && (input.codexDirectFullVideo === true
      || input.referenceDirectFullVideo === true
      || input.batchCodexDirectFullVideo === true
      || directRoute
      || localLibraryCodexTask);
}

export function assertCodexDirectMasterOutput(result: JsonRecord, taskPackage: JsonRecord) {
  if (!isCodexDirectFullVideoTask(taskPackage)) return;
  const task = record(taskPackage.task);
  const input = record(task.input);
  const masters = (Array.isArray(result.outputFiles) ? result.outputFiles : [])
    .map(record)
    .filter((item) => String(item.kind || "").toUpperCase() === "VIDEO_MASTER");

  if (input.batchCodexDirectFullVideo === true) {
    const expectedKeys = expectedBatchVideoKeys(input);
    const covers = (Array.isArray(result.outputFiles) ? result.outputFiles : [])
      .map(record)
      .filter((item) => String(item.kind || "").toUpperCase() === "COVER_IMAGE");
    const coversRequired = record(input.batchDirectInput).generateCoverTitle !== false;
    const batchResults = Array.isArray(result.batchResults) ? result.batchResults.map(record) : [];
    const byKey = new Map(batchResults.map((item) => [String(item.videoKey || ""), item]));
    const missingKeys = expectedKeys.filter((key) => !byKey.has(key));
    if (missingKeys.length) throw new Error(`batchResults 缺少视频键：${missingKeys.join(", ")}`);
    for (const key of expectedKeys) {
      const item = byKey.get(key)!;
      const status = String(item.status || "").toUpperCase();
      if (status !== "READY" && status !== "FAILED") throw new Error(`batchResults ${key} 状态无效`);
      if (status === "FAILED" && !String(item.failureReason || "").trim()) {
        throw new Error(`batchResults ${key} 失败时必须填写 failureReason`);
      }
      if (status === "READY") {
        const outputFile = String(item.outputFile || "").trim();
        if (!outputFile || !masters.some((master) => String(master.path || "").trim() === outputFile)) {
          throw new Error(`batchResults ${key} 未匹配真实 VIDEO_MASTER`);
        }
        const coverFile = String(item.coverFile || "").trim();
        if (coversRequired && (!coverFile || !covers.some((cover) => (
          String(cover.path || "").trim() === coverFile
          && String(record(cover.metadata).videoKey || "") === key
        )))) {
          throw new Error(`batchResults ${key} 未匹配真实 COVER_IMAGE`);
        }
      }
    }
    return;
  }

  if (masters.length !== 1) {
    const failure = String(result.summary || "").trim();
    if (!masters.length && /\bFAILED\b|MATERIAL_GAP_[A-Z_]+/iu.test(failure)) throw new Error(failure);
    throw new Error("Codex 直出任务未返回唯一的最终成片（VIDEO_MASTER），任务不能标记成功");
  }
  const masterPath = String(masters[0]?.path || "").toLowerCase();
  if (input.referenceDirectFullVideo === true) {
    const evidence = record(result.referenceEvidence);
    const audioMode = String(evidence.audioMode || "").toUpperCase();
    const voiceProvider = String(evidence.voiceProvider || "").toUpperCase();
    const audioEndSeconds = Number(evidence.audioEndSeconds || 0);
    const finalDurationSeconds = Number(record(masters[0]?.metadata).durationSeconds || 0);
    if (Number(evidence.referenceDurationSeconds || 0) <= 0) throw new Error("Reference direct output is missing reference analysis evidence");
    if (!["REFERENCE_ORIGINAL", "DOUBAO"].includes(audioMode) || voiceProvider.includes("WINDOWS") || voiceProvider.includes("SAPI")) {
      throw new Error("Reference direct output must retain reference audio or use configured Doubao voice, never Windows TTS");
    }
    if (audioMode === "DOUBAO" && !voiceProvider.includes("DOUBAO")) throw new Error("Reference direct output must name its actual Doubao voice");
    if (audioEndSeconds <= 0 || finalDurationSeconds < audioEndSeconds + 0.25 || evidence.endingAudited !== true) {
      throw new Error("Reference direct output has not proven that its ending audio is complete");
    }
  }
  if (!masterPath.endsWith(".mp4")) throw new Error("Codex 直出任务返回的最终成片不是 MP4，任务不能标记成功");
}
