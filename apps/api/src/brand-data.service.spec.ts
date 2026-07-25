import { describe, expect, it, vi } from "vitest";
import { BrandDataService, growthScore } from "./brand-data.service";

describe("growthScore", () => {
  it("keeps the baseline score when no performance data is available", () => {
    expect(growthScore({ baselineQuality: 80 })).toEqual({
      score: 80,
      recommendationWeight: 0.8,
      hasPerformanceData: false,
    });
  });

  it("raises recommendation weight for an asset with strong performance", () => {
    const result = growthScore({
      baselineQuality: 80,
      views: 100_000,
      likes: 8_000,
      comments: 500,
      shares: 300,
      saves: 1_200,
      orders: 200,
    });

    expect(result.hasPerformanceData).toBe(true);
    expect(result.score).toBeGreaterThan(80);
    expect(result.recommendationWeight).toBeGreaterThan(1);
  });
});

describe("asset trash retention", () => {
  it("moves selected assets to the three-day recycle bin without deleting OSS", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      asset: { updateMany },
      auditLog: { create: vi.fn() },
    };
    const oss = { deleteAssetObjects: vi.fn() };
    const service = new BrandDataService(prisma as never, oss as never, {} as never, {} as never);

    const result = await service.bulkAssets({ ids: ["asset-1"], action: "TRASH", confirmation: "移入回收站" }, "测试员工");

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["asset-1"] }, deletedAt: null },
      data: expect.objectContaining({ status: "ARCHIVED", availabilityStatus: "ARCHIVED" }),
    }));
    expect(oss.deleteAssetObjects).not.toHaveBeenCalled();
    expect(result.count).toBe(1);
  });

  it("permanently deletes expired trash from OSS before database rows", async () => {
    const contentAssetDeleteMany = vi.fn();
    const assetDeleteMany = vi.fn();
    const prisma = {
      asset: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: "asset-1" }])
          .mockResolvedValueOnce([{
          id: "asset-1",
          objectKey: "brand-assets/original/a1/file.mp4",
          versions: [{ objectKey: "brand-assets/original/a1/file.mp4" }],
          cloudMediaJobs: [{ outputs: [{ objectKey: "brand-assets/derived/asset-1/proxy.mp4" }] }],
          }]),
        deleteMany: assetDeleteMany,
      },
      contentAsset: { deleteMany: contentAssetDeleteMany },
      auditLog: { create: vi.fn() },
      $transaction: vi.fn(async (callback) => callback({ contentAsset: { deleteMany: contentAssetDeleteMany }, asset: { deleteMany: assetDeleteMany } })),
    };
    const oss = { deleteAssetObjects: vi.fn().mockResolvedValue({ deleted: 2 }) };
    const service = new BrandDataService(prisma as never, oss as never, {} as never, {} as never);

    const result = await service.purgeExpiredTrash();

    expect(oss.deleteAssetObjects).toHaveBeenCalledWith(["asset-1"], [
      "brand-assets/original/a1/file.mp4",
      "brand-assets/original/a1/file.mp4",
      "brand-assets/derived/asset-1/proxy.mp4",
    ]);
    expect(contentAssetDeleteMany).toHaveBeenCalledWith({ where: { assetId: { in: ["asset-1"] } } });
    expect(assetDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ["asset-1"] } } });
    expect(result).toEqual({ action: "PURGE_EXPIRED", count: 1, deletedOssObjects: 2 });
  });
});
