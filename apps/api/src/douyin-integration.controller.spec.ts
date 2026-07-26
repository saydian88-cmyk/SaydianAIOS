import { describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth.service";
import { DouyinIntegrationController } from "./douyin-integration.controller";
import { DouyinIntegrationService } from "./douyin-integration.service";

describe("DouyinIntegrationController", () => {
  it("redirects a failed OAuth callback back to the admin page with a readable error", async () => {
    const oauthCallback = vi.fn().mockRejectedValue(new Error("Client Secret 不匹配"));
    const controller = new DouyinIntegrationController(
      {} as AuthService,
      { oauthCallback } as unknown as DouyinIntegrationService,
    );

    const result = await controller.oauthCallback("code", "state");
    const redirect = new URL(result.url);

    expect(result.statusCode).toBe(302);
    expect(redirect.searchParams.get("douyin")).toBe("failed");
    expect(redirect.searchParams.get("douyin_error")).toBe("Client Secret 不匹配");
  });
});
