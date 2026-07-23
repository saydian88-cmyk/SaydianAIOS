import { describe, expect, it } from "vitest";
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
