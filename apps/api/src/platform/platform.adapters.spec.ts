import { describe, expect, it } from "vitest";
import { UnconfiguredAdapter } from "./platform.adapters";

describe("未配置平台适配器", () => {
  it("不虚构平台能力或发布成功", async () => {
    const adapter = new UnconfiguredAdapter("XIAOHONGSHU", "小红书");
    expect(adapter.capabilities()).toEqual([]);
    await expect(adapter.healthCheck()).resolves.toMatchObject({ state: "UNCONFIGURED", capabilities: [] });
    await expect(adapter.publishContent({ platform: "XIAOHONGSHU", contentId: "content-1", idempotencyKey: "once", title: "测试", body: "测试", mediaUrls: [] })).resolves.toMatchObject({ success: false });
  });
});
