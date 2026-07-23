import { describe, expect, it } from "vitest";
import { growthScore } from "./brand-data.service";

describe("growthScore", () => {
  it("keeps the baseline score when no performance data is available", () => {
    expect(growthScore({ baselineQuality: 80 })).toEqual({
      score: 80,
      recommendationWeight: 0.8,
      hasPerformanceData: false,
    });
  });

  it("raises recommendation weight for an asset with strong performance", () => {
    const result = growthScore({
      baselineQuality: 80,
      views: 100_000,
      likes: 8_000,
      comments: 500,
      shares: 300,
      saves: 1_200,
      orders: 200,
    });

    expect(result.hasPerformanceData).toBe(true);
    expect(result.score).toBeGreaterThan(80);
    expect(result.recommendationWeight).toBeGreaterThan(1);
  });
});
