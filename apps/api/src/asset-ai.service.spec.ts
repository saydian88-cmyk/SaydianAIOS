import { describe, expect, it } from "vitest";
import { buildAiAssetName, isIrregularAssetName } from "./asset-naming";
import { AssetAiService, isAssetKnowledgeCurrent, shouldApplyAiRename } from "./asset-ai.service";

describe("AssetAiService capabilities", () => {
  it("separates local media capabilities from external AI configuration", () => {
    const service = new AssetAiService(
      {} as never,
      {} as never,
      { capabilities: () => ({ ims: { segmentation: { state: "UNCONFIGURED" } } }) } as never,
    );
    const result = service.capabilities();
    expect(result.provider).toBe("阿里云百炼");
    expect(result.capabilities.technicalMetadata.state).toBe("AVAILABLE");
    expect(result.capabilities.nearDuplicate.state).toBe("AVAILABLE");
    expect(["CONFIGURED", "UNCONFIGURED"]).toContain(result.capabilities.imageUnderstanding.state);
  });
});

describe("AI asset naming", () => {
  it("recognizes numeric, meaningless Latin and camera-generated names as irregular", () => {
    expect(isIrregularAssetName("18")).toBe(true);
    expect(isIrregularAssetName("abc")).toBe(true);
    expect(isIrregularAssetName("a8b7c6")).toBe(true);
    expect(isIrregularAssetName("aa-bb-cc")).toBe(true);
    expect(isIrregularAssetName("IMG_0018.jpg")).toBe(true);
    expect(isIrregularAssetName("W9父母健康场景")).toBe(false);
  });

  it("builds a searchable name from verified product and AI analysis", () => {
    expect(buildAiAssetName({
      modules: [{ type: "FEATURE" }],
      features: ["气囊血压测量"],
      summary: "展示手表测量过程",
    }, ["W9"])).toBe("W9-功能-气囊血压测量");
  });

  it("honors the upload rename option while preserving legacy naming behavior", () => {
    expect(shouldApplyAiRename({ aiRename: true }, "客户已经命名的素材")).toBe(true);
    expect(shouldApplyAiRename({ aiRename: false }, "18")).toBe(false);
    expect(shouldApplyAiRename({}, "IMG_0018.jpg")).toBe(true);
    expect(shouldApplyAiRename({}, "W9父母健康场景")).toBe(false);
  });
});

describe("persistent asset knowledge", () => {
  it("does not relearn an unchanged asset whose current hash is already indexed", () => {
    expect(isAssetKnowledgeCurrent({
      sha256: "same-content",
      indexVersion: 4,
      sourceSnapshot: { learnedSha256: "same-content" },
    })).toBe(true);
  });

  it("relearns changed files and legacy indexes", () => {
    expect(isAssetKnowledgeCurrent({
      sha256: "new-content",
      indexVersion: 4,
      sourceSnapshot: { learnedSha256: "old-content" },
    })).toBe(false);
    expect(isAssetKnowledgeCurrent({
      sha256: "same-content",
      indexVersion: 3,
      sourceSnapshot: { learnedSha256: "same-content" },
    })).toBe(false);
  });
});
