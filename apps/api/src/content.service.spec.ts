import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ContentService, resolveVideoShotAssets } from "./content.service";

describe("ContentService production workflow", () => {
  it("does not treat an image-only match as a covered timed video shot", () => {
    const resolved = resolveVideoShotAssets(
      { matchedAssetIds: ["image-1"], matchedVideoAssetIds: [], auxiliaryImageAssetIds: ["image-1"] },
      new Set(["image-1"]),
      new Map([["image-1", "IMAGE"]]),
    );
    expect(resolved.videoAssetIds).toEqual([]);
    expect(resolved.imageAssetIds).toEqual(["image-1"]);
  });

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

  it("moves an asset-covered script directly to ready to edit after approval", async () => {
    const update = vi.fn().mockResolvedValue({ id: "plan-1", productionStage: "READY_TO_EDIT" });
    const tx = {
      contentPlan: { update },
      contentVariant: { updateMany: vi.fn() },
      approval: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      contentPlan: { findUnique: vi.fn().mockResolvedValue({
        id: "plan-1",
        kind: "VIDEO",
        topic: "素材复用脚本",
        productModel: "W9S",
        evidenceIds: [],
        variants: [{ platform: "DOUYIN", title: "标题", body: "正文" }],
        shootRequirements: [{ id: "shot-1", description: "心电图测量", status: "DONE", coverage: "EXISTING", assetIds: ["asset-1"] }],
      }) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const guard = { evaluate: vi.fn().mockResolvedValue({ allowed: true, reasons: [], evidenceIds: [] }) };
    const service = new ContentService(prisma as never, guard as never, {} as never, {} as never);

    await service.approve("plan-1", "审核员");

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ productionStage: "READY_TO_EDIT" }),
    }));
  });
});
