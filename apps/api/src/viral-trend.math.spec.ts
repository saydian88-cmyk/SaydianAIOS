import { describe, expect, it } from "vitest";
import { calculateViralComponents, gradeFor, percentileScore } from "./viral-trend.math";

describe("viral trend math", () => {
  it("uses a 15 minute floor for a newly published video", () => {
    const capturedAt = new Date("2026-07-25T08:10:00.000Z");
    const result = calculateViralComponents({
      capturedAt,
      publishedAt: new Date("2026-07-25T08:05:00.000Z"),
      views: 2_500,
      likes: 100,
      comments: 20,
      saves: 10,
      shares: 5,
      followers: 10_000,
    });
    expect(result.ageHours).toBe(0.25);
    expect(result.playVelocity).toBe(10_000);
  });

  it("does not divide by zero when views are missing", () => {
    const result = calculateViralComponents({
      capturedAt: new Date("2026-07-25T08:00:00.000Z"),
      publishedAt: new Date("2026-07-25T07:00:00.000Z"),
      views: 0,
    });
    expect(result.engagementRate).toBe(0);
    expect(result.saveShareRate).toBe(0);
    expect(Number.isFinite(result.viralIndex)).toBe(true);
  });

  it("calculates percentile and grades deterministically", () => {
    expect(percentileScore(3, [1, 2, 3, 4, 5])).toBe(50);
    expect(gradeFor(85)).toBe("S");
    expect(gradeFor(70)).toBe("A");
    expect(gradeFor(55)).toBe("B");
    expect(gradeFor(54.9)).toBe("C");
  });
});
