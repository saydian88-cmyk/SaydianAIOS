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

describe("permanent asset deletion", () => {
  it("deletes only selected OSS objects before removing related database rows", async () => {
    const contentAssetDeleteMany = vi.fn();
    const assetDeleteMany = vi.fn();
    const prisma = {
      asset: {
        findMany: vi.fn().mockResolvedValue([{
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

    const result = await service.bulkAssets({ ids: ["asset-1"], action: "PURGE", confirmation: "永久删除" }, "测试员工");

    expect(oss.deleteAssetObjects).toHaveBeenCalledWith(["asset-1"], [
      "brand-assets/original/a1/file.mp4",
      "brand-assets/original/a1/file.mp4",
      "brand-assets/derived/asset-1/proxy.mp4",
    ]);
    expect(contentAssetDeleteMany).toHaveBeenCalledWith({ where: { assetId: { in: ["asset-1"] } } });
    expect(assetDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ["asset-1"] } } });
    expect(result).toEqual({ action: "PURGE", count: 1, deletedOssObjects: 2 });
  });
});
