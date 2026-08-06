import { describe, expect, it } from "vitest";
import * as repair from "./execution-repair";
import {
  classifyExecutionFailure,
  recoveryMode,
  requiresRenderedEvidenceReview,
  shouldResumeValidatedResult,
} from "./execution-repair";

describe("classifyExecutionFailure", () => {
  it("keeps a GSAP runtime failure inside the runner", () => {
    const result = classifyExecutionFailure("HyperFrames validate cannot load official GSAP runtime from CDN");
    expect(result.recoverable).toBe(true);
    expect(result.category).toBe("HYPERFRAMES_RUNTIME");
  });

  it("recognizes localized HyperFrames failures", () => {
    const result = classifyExecutionFailure("必要的 HyperFrames 动画运行环境无法恢复，GSAP 3.14.2 加载失败");
    expect(result.recoverable).toBe(true);
    expect(result.category).toBe("HYPERFRAMES_RUNTIME");
  });

  it("keeps Codex model-manager shutdown timeouts inside the runner", () => {
    const result = classifyExecutionFailure(
      "ERROR codex_models_manager::manager: failed to refresh available models: timeout waiting for child process to exit",
    );
    expect(result.recoverable).toBe(true);
    expect(result.category).toBe("CODEX_RUNTIME");
  });

  it("does not hide a missing business input", () => {
    const result = classifyExecutionFailure("Required reference video was not supplied by the user");
    expect(result.recoverable).toBe(false);
    expect(result.category).toBe("NONE");
  });

  it("recovers an upload 500 even when the localized prefix is garbled", () => {
    const result = classifyExecutionFailure('涓婁紶澶辫触 500: {"statusCode":500,"message":"Internal server error"}');
    expect(result.recoverable).toBe(true);
    expect(result.category).toBe("TRANSIENT_TRANSFER");
  });

  it("restarts the downstream review when rendered-composition evidence is invalid", () => {
    const result = classifyExecutionFailure(
      "完整视频剪辑Skill官方质检失败（validate_rendered_composition.py）：reviewed_from_render 应为 true",
    );

    expect(result.category).toBe("RENDER_EVIDENCE");
    expect(requiresRenderedEvidenceReview(result.category)).toBe(true);
  });

  it("reuses a saved result while repairing evidence only", () => {
    expect(shouldResumeValidatedResult(true, "RENDER_EVIDENCE")).toBe(true);
    expect(shouldResumeValidatedResult(true, "TRANSIENT_TRANSFER")).toBe(true);
  });

  it("chooses the smallest recoverable stage for each repair category", () => {
    expect(recoveryMode("TRANSIENT_TRANSFER")).toBe("RESUME_RESULT");
    expect(recoveryMode("RENDER_EVIDENCE")).toBe("REPAIR_EVIDENCE");
    expect(recoveryMode("RESULT_CONTRACT")).toBe("REPAIR_EVIDENCE");
    expect(recoveryMode("NONE")).toBe("FULL_RERUN");
  });

  it("caps internal recovery across changing failure fingerprints", () => {
    const exhausted = (repair as Record<string, unknown>).hasExhaustedInternalRepairs;
    expect(exhausted).toBeTypeOf("function");
    expect((exhausted as (attempts: Record<string, number>, maximum: number) => boolean)({
      first: 1,
      second: 1,
      third: 1,
    }, 3)).toBe(true);
  });
});
