import { describe, expect, it } from "vitest";
import { parseDouyinPayload, withinTwelveHours } from "./extract";

describe("Douyin payload parser", () => {
  it("extracts a complete video from nested responses", () => {
    const capturedAt = new Date("2026-07-25T08:00:00.000Z");
    const rows = parseDouyinPayload({
      data: {
        aweme_list: [{
          aweme_id: "7531234567890123456",
          desc: "赛电智能手表",
          create_time: 1753426800,
          statistics: {
            play_count: 120000,
            digg_count: 8000,
            comment_count: 500,
            collect_count: 900,
            share_count: 600,
          },
          author: { uid: "author-1", nickname: "测试作者", follower_count: 120000 },
        }],
      },
    }, "智能手表", capturedAt);
    expect(rows).toHaveLength(1);
    expect(rows[0].videoId).toBe("7531234567890123456");
    expect(rows[0].views).toBe(120000);
    expect(rows[0].saves).toBe(900);
    expect(rows[0].matchedKeywords).toEqual(["智能手表"]);
  });

  it("filters records older than twelve hours", () => {
    expect(withinTwelveHours({
      videoId: "1",
      sourceUrl: "https://www.douyin.com/video/1",
      capturedAt: "2026-07-25T08:00:00.000Z",
      publishedAt: "2026-07-24T18:00:00.000Z",
      matchedKeywords: [],
    }, new Date("2026-07-25T08:00:00.000Z"))).toBe(false);
  });
});
