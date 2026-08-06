import { describe, expect, it } from "vitest";
import { classifyQualityGate } from "./quality-gates";

describe("classifyQualityGate", () => {
  it("keeps rendered-composition evidence gaps as employee reminders", () => {
    expect(classifyQualityGate(
      "validate_rendered_composition.py",
      "ERROR: video-1: reviewed_from_render 应为 true\nRESULT: 1 errors",
    )).toMatchObject({
      disposition: "WARNING",
      warning: { validator: "validate_rendered_composition.py" },
    });
  });

  it("blocks missing final video masters", () => {
    expect(classifyQualityGate(
      "validate_final_delivery.py",
      "ERROR: VIDEO_MASTER file is missing",
    )).toEqual({ disposition: "BLOCKING" });
  });
});
