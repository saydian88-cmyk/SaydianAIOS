import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIDEO_POLICY_CONFIG,
  VIDEO_OPPORTUNITY_SCORE_MAX,
  VIDEO_RECIPES,
  normalizeTopicText,
} from "./video-topic-card";

describe("video topic card contract", () => {
  it("normalizes spacing, punctuation, casing and known obvious typos for deduplication", () => {
    expect(normalizeTopicText(" Smart-Watch  For Seniors ")).toBe("smartwatchforseniors");
    expect(normalizeTopicText("园型 智能手表！")).toBe(normalizeTopicText("圆形-智能手表"));
    expect(normalizeTopicText("气嚷表带 跌掉提醒")).toBe(normalizeTopicText("气囊表带 跌倒提醒"));
  });

  it("keeps the opportunity score at exactly 100 points", () => {
    expect(Object.values(VIDEO_OPPORTUNITY_SCORE_MAX).reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it("seeds ten cards per platform and the eight approved video recipes", () => {
    expect(DEFAULT_VIDEO_POLICY_CONFIG.dailyTopicCards).toEqual({ DOUYIN: 10, TIKTOK: 10 });
    expect(VIDEO_RECIPES).toHaveLength(8);
    expect(DEFAULT_VIDEO_POLICY_CONFIG.manualTopicCardApproval).toBe(true);
  });
});
