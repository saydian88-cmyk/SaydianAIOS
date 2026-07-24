import { describe, expect, it } from "vitest";
import { buildAiAssetName, isIrregularAssetName } from "./asset-naming";
import { AssetAiService } from "./asset-ai.service";

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
  it("recognizes numeric and camera-generated names as irregular", () => {
    expect(isIrregularAssetName("18")).toBe(true);
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
});
