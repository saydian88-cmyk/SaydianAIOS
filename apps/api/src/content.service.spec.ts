import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ContentService } from "./content.service";

describe("ContentService production workflow", () => {
  function serviceWithFindUnique(result: unknown) {
    const prisma = {
      contentPlan: { findUnique: vi.fn().mockResolvedValue(result) },
      contentVariant: { findUnique: vi.fn().mockResolvedValue(result) },
    };
    return new ContentService(prisma as never, {} as never, {} as never, {} as never);
  }

  it("does not start editing while a shoot requirement is open", async () => {
    const service = serviceWithFindUnique({
      id: "plan-1",
      kind: "VIDEO",
      status: "APPROVED",
      shootRequirements: [{ id: "shot-1", description: "补拍佩戴镜头", status: "OPEN" }],
      variants: [],
      contentAssets: [],
    });

    await expect(service.startEditing("plan-1", "测试员工")).rejects.toThrow(
      new BadRequestException("补拍素材尚未全部完成"),
    );
  });

  it("does not approve platform packaging without a finished cover", async () => {
    const service = serviceWithFindUnique({
      id: "variant-1",
      contentPlanId: "plan-1",
      packagingStatus: "WAITING_COVER_PROVIDER",
      coverPath: null,
      contentPlan: { targetPlatforms: ["DOUYIN"] },
    });

    await expect(service.reviewPackaging("variant-1", true, "审核员")).rejects.toThrow(
      new BadRequestException("封面成品尚未生成或上传"),
    );
  });

  it("requires a link or work id for manual publishing", async () => {
    const service = serviceWithFindUnique({
      id: "variant-1",
      contentPlanId: "plan-1",
      packagingStatus: "APPROVED",
      platform: "DOUYIN",
      contentPlan: {},
    });

    await expect(service.recordManualPublish("variant-1", "发布员", {})).rejects.toThrow(
      new BadRequestException("请回填作品链接或作品ID"),
    );
  });
});
