import { describe, expect, it } from "vitest";
import { canonicalVideoShotKey, validateVideoMasterMetadata } from "./video-output-validation";

const validMetadata = {
  width: 1080,
  height: 1920,
  durationSeconds: 18,
  codec: "h264",
  frameRate: "30/1",
  materialUsage: [{
    lineId: "line_hook",
    sequence: 0,
    assetId: "asset-e8-front",
    sha256: "abc123",
    scriptLine: "E8健康界面很多，先分清数据入口",
    timelineStart: 0,
    timelineEnd: 3,
    sourceIn: 0,
    sourceOut: 3,
    moduleType: "HOOK",
  }],
  qualityChecks: [
    { checkType: "OUTPUT_VALIDITY", status: "PASSED", score: 100, findings: [] },
    { checkType: "MATERIAL_TRACE", status: "PASSED", score: 100, findings: [] },
    { checkType: "CONTENT_ALIGNMENT", status: "REVIEW_REQUIRED", score: 0, findings: [] },
  ],
  contentAlignment: { status: "REVIEW_REQUIRED", blockers: [] },
};

describe("douyin video master admission", () => {
  it("uses a stable line id as the canonical shot key", () => {
    expect(canonicalVideoShotKey("HOOK 01", 7)).toBe("shot-v3:hook-01");
    expect(canonicalVideoShotKey("", 1)).toBe("shot-v3:line_02");
  });

  it("accepts a real master with complete technical and material trace evidence", () => {
    const result = validateVideoMasterMetadata(validMetadata, {
      requireMaterialUsage: true,
      allowedAssetIds: new Set(["asset-e8-front"]),
      expectedShotLineIds: new Set(["line_hook"]),
    });
    expect(result.valid).toBe(true);
    expect(result.hardBlockers).toEqual([]);
  });

  it("blocks zero-duration, untraced and wrong-script masters", () => {
    const result = validateVideoMasterMetadata({
      ...validMetadata,
      durationSeconds: 0,
      materialUsage: [{ ...validMetadata.materialUsage[0], assetId: "wrong-product", lineId: "old-line" }],
    }, {
      requireMaterialUsage: true,
      allowedAssetIds: new Set(["asset-e8-front"]),
      expectedShotLineIds: new Set(["line_hook"]),
    });
    expect(result.valid).toBe(false);
    expect(result.hardBlockers).toEqual(expect.arrayContaining([
      "成片时长无效",
      "镜头1使用了任务白名单外素材",
      "镜头1未对应当前脚本行",
    ]));
  });

  it("treats failed content alignment as a hard blocker", () => {
    const result = validateVideoMasterMetadata({
      ...validMetadata,
      contentAlignment: { status: "FAILED", blockers: ["产品型号不一致"] },
    }, { requireMaterialUsage: true });
    expect(result.valid).toBe(false);
    expect(result.hardBlockers).toContain("成片内容与选题或脚本不一致");
  });
});
