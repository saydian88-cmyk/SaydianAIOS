import { describe, expect, it } from "vitest";
import { localDateKey, makeIdempotencyKey, startOfShanghaiDay } from "./utils";

describe("运营日期与幂等键", () => {
  it("按上海时区计算日报边界", () => {
    const instant = new Date("2026-07-22T16:30:00.000Z");
    expect(localDateKey(instant)).toBe("2026-07-23");
    expect(startOfShanghaiDay(instant).toISOString()).toBe("2026-07-22T16:00:00.000Z");
  });

  it("同一业务输入生成相同幂等键", () => {
    expect(makeIdempotencyKey("publish", "plan-1", "DOUYIN")).toBe(makeIdempotencyKey("publish", "plan-1", "DOUYIN"));
    expect(makeIdempotencyKey("publish", "plan-1", "DOUYIN")).not.toBe(makeIdempotencyKey("publish", "plan-2", "DOUYIN"));
  });
});
