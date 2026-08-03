import { describe, expect, it } from "vitest";
import { classifyExecutionFailure } from "./execution-repair";

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

  it("does not hide a missing business input", () => {
    const result = classifyExecutionFailure("Required reference video was not supplied by the user");
    expect(result.recoverable).toBe(false);
    expect(result.category).toBe("NONE");
  });
});
