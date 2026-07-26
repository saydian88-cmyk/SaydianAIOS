import { describe, expect, it } from "vitest";
import { grade, normalizeKeyword, scoreFor, SmartKeywordService } from "./smart-keyword.service";

describe("smart keyword logic", () => {
  it("normalizes Chinese and English independently", () => {
    expect(normalizeKeyword("  老人  智能手表  ")).toBe("老人 智能手表");
    expect(normalizeKeyword("SmartWatch For Seniors")).toBe("smartwatch for seniors");
    expect(normalizeKeyword("老人智能手表")).not.toBe(normalizeKeyword("smartwatch for seniors"));
  });

  it("uses the V1.1 grade boundaries", () => {
    expect(grade(85)).toBe("S");
    expect(grade(75)).toBe("A");
    expect(grade(60)).toBe("B");
    expect(grade(59.9)).toBe("C");
  });

  it("raises direction-led and historical opportunities without bypassing the formula", () => {
    const baseline = scoreFor({ type: "PRODUCT", source: "KNOWLEDGE" });
    const directed = scoreFor({
      type: "PRODUCT",
      source: "DIRECTION",
      productId: "product-1",
      hitCount: 12,
      faqFrequency: 80,
      directionMatched: true,
      contentGap: true,
    });
    expect(directed.opportunityScore).toBeGreaterThan(baseline.opportunityScore);
    expect(["S", "A"]).toContain(directed.grade);
  });

  it("caps one platform daily selection at 50 and keeps pinned keywords first", () => {
    const service = new SmartKeywordService({} as never, {} as never);
    const library = Array.from({ length: 80 }, (_, index) => ({
      id: `keyword-${index}`,
      keyword: index < 5 ? `重点词${index}` : `探索词${index}`,
      type: "PRODUCT",
      priority: "B",
      reason: null,
      pinned: index < 5,
      locked: index < 5,
      productId: null,
      opportunityScore: 100 - index,
      hitCount: index % 3,
      source: index < 5 ? "MANUAL" : "AI",
    }));
    const selected = (service as unknown as {
      selectDaily: (items: typeof library, directions: unknown[]) => typeof library;
    }).selectDaily(library, []);
    expect(selected).toHaveLength(50);
    expect(selected.slice(0, 5).every((item) => item.pinned)).toBe(true);
  });
});
