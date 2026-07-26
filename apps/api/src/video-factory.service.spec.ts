import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoFactoryService } from "./video-factory.service";

describe("VideoFactoryService model routing", () => {
  let prisma: Record<string, any>;
  let service: VideoFactoryService;

  beforeEach(() => {
    prisma = {
      videoModelConfig: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      videoRoutingPolicy: {
        findFirst: vi.fn(),
      },
      videoModelProvider: {
        findMany: vi.fn(),
      },
      contentPlan: {
        findMany: vi.fn(),
      },
    };
    service = new VideoFactoryService(prisma as never, {} as never, {} as never, {} as never);
    vi.spyOn(service, "ensureCatalog").mockResolvedValue();
  });

  it("rejects an unavailable fixed model without silently replacing it", async () => {
    prisma.videoModelConfig.findFirst.mockResolvedValue(null);

    await expect(service.resolveModel({
      requestedModelId: "disabled-model",
      platform: "TIKTOK",
      capability: "IMAGE_TO_VIDEO",
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.videoModelConfig.findMany).not.toHaveBeenCalled();
  });

  it("keeps configured policy order for AUTO primary and fallbacks", async () => {
    prisma.videoRoutingPolicy.findFirst.mockResolvedValue({
      primaryModelId: "runway",
      fallbackModelIds: ["wan"],
    });
    prisma.videoModelConfig.findMany.mockResolvedValue([
      { id: "wan", priority: 10, provider: { code: "BAILIAN_WAN" } },
      { id: "runway", priority: 20, provider: { code: "RUNWAY" } },
    ]);

    const result = await service.resolveModel({
      platform: "TIKTOK",
      capability: "IMAGE_TO_VIDEO",
    });

    expect(result.primary.id).toBe("runway");
    expect(result.fallbacks.map((item) => item.id)).toEqual(["wan"]);
  });

  it("never returns encrypted provider credentials", async () => {
    prisma.videoModelProvider.findMany.mockResolvedValue([{
      id: "provider-1",
      code: "RUNWAY",
      displayName: "Runway",
      secretRef: "encrypted-secret",
      models: [],
    }]);

    const result = await service.providers();

    expect(result[0]).toMatchObject({ code: "RUNWAY", secretConfigured: true });
    expect(result[0]).not.toHaveProperty("secretRef");
  });

  it("serializes nested asset BigInt fields in project lists", async () => {
    prisma.contentPlan.findMany.mockResolvedValue([{
      id: "project-1",
      videoShots: [{ selectedAsset: { id: "asset-1", sizeBytes: 1024n } }],
    }]);

    const result = await service.projects({});

    expect(result[0].videoShots[0].selectedAsset?.sizeBytes).toBe("1024");
  });

  it("does not mix the default keyword pool into a viral-reference project", async () => {
    prisma.product = { findUnique: vi.fn().mockResolvedValue({ id: "product-c1", modelCode: "C1" }) };
    prisma.smartKeyword = { findMany: vi.fn().mockResolvedValue([{ id: "keyword-bp", keyword: "爸妈不愿意测血压" }]) };
    prisma.knowledgeEntry = { findMany: vi.fn().mockResolvedValue([]) };
    prisma.asset = { findMany: vi.fn().mockResolvedValue([]) };
    prisma.externalVideo = {
      findMany: vi.fn().mockResolvedValue([{
        id: "viral-1",
        platform: "DOUYIN",
        title: "固态电芯加持，告别充电宝安全焦虑 自用一段时间，和普通充电宝差距很明显。",
        transcript: "",
        moduleSummary: null,
        analysis: null,
      }]),
    };
    prisma.opsTask = { findFirst: vi.fn() };

    const context = await (service as any).buildContext({
      platform: "DOUYIN",
      productModel: "C1",
      topic: "参考结构：不应覆盖外部爆款标题",
      externalVideoIds: ["viral-1"],
    });

    expect(context.keywords).toEqual([]);
    expect(context.topic).toBe("固态电芯加持，告别充电宝安全焦虑");
    expect(prisma.smartKeyword.findMany).not.toHaveBeenCalled();
  });
});
