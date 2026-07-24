import { describe, expect, it } from "vitest";
import { readIntegrationSecret, writeIntegrationSecret } from "./integration-secret";

describe("integration secret bundle", () => {
  it("preserves collector and Douyin credentials in one encrypted value", () => {
    const encrypted = writeIntegrationSecret({
      viralCollectorToken: "collector-token",
      douyin: {
        clientSecret: "douyin-secret",
        accessToken: "access-token",
        openId: "open-id",
      },
    });

    expect(encrypted).not.toContain("douyin-secret");
    expect(readIntegrationSecret(encrypted)).toEqual({
      viralCollectorToken: "collector-token",
      douyin: {
        clientSecret: "douyin-secret",
        accessToken: "access-token",
        openId: "open-id",
      },
    });
  });

  it("reads the previous single-token format", () => {
    expect(readIntegrationSecret("legacy-token")).toEqual({
      viralCollectorToken: "legacy-token",
    });
  });
});
