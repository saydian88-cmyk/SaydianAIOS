import { UnauthorizedException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptIntegrationValue } from "./integration-secret";
import { VideoFactoryWorkerService } from "./video-factory-worker.service";

afterEach(() => vi.unstubAllGlobals());

describe("VideoFactoryWorkerService webhook", () => {
  function setup() {
    const prisma = {
      videoModelProvider: {
        findUnique: vi.fn().mockResolvedValue({
          id: "provider-1",
          code: "RUNWAY",
          secretRef: encryptIntegrationValue(JSON.stringify({ apiKey: "api-key", webhookSecret: "hook-secret" })),
        }),
      },
      videoGenerationAttempt: {
        findFirst: vi.fn().mockResolvedValue({
          id: "attempt-1",
          jobId: "job-1",
          providerId: "provider-1",
          externalJobId: "task-1",
          status: "RUNNING",
        }),
      },
    };
    const worker = new VideoFactoryWorkerService(prisma as never, {} as never, {} as never);
    const consume = vi.spyOn(worker as unknown as {
      consumeProviderResult: (...args: unknown[]) => Promise<void>;
    }, "consumeProviderResult").mockResolvedValue();
    return { worker, consume };
  }

  it("rejects an invalid webhook secret", async () => {
    const { worker } = setup();
    await expect(worker.handleWebhook("RUNWAY", { id: "task-1", status: "SUCCEEDED" }, "wrong"))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("accepts an idempotent provider completion callback", async () => {
    const { worker, consume } = setup();
    const result = await worker.handleWebhook("RUNWAY", {
      id: "task-1",
      status: "SUCCEEDED",
      output: ["https://example.test/video.mp4"],
    }, "hook-secret");

    expect(result).toEqual({ accepted: true, state: "SUCCEEDED" });
    expect(consume).toHaveBeenCalledWith("job-1", "attempt-1", expect.objectContaining({
      state: "SUCCEEDED",
      outputUrl: "https://example.test/video.mp4",
    }));
  });
});

describe("VideoFactoryWorkerService Seedance adapter", () => {
  function worker() {
    return new VideoFactoryWorkerService({
      contentPlan: { findUnique: vi.fn().mockResolvedValue({ productModel: null }) },
    } as never, {} as never, {} as never);
  }

  it("submits the official Seedance task format", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ id: "seedance-task-1", status: "queued" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await (worker() as any).submitProvider(
      {
        code: "VOLCENGINE_SEEDANCE",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        publicConfig: { generateAudio: true, watermark: false },
      },
      { code: "doubao-seedance-2-0-260128", modelConfig: {} },
      { apiKey: "ark-key" },
      { id: "job-1", prompt: "真实家庭场景", input: { duration: 15, ratio: "9:16" }, contentPlanId: "plan-1" },
    );

    expect(result).toMatchObject({ state: "RUNNING", externalJobId: "seedance-task-1" });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks");
    expect(JSON.parse(options.body)).toMatchObject({
      model: "doubao-seedance-2-0-260128",
      content: [{ type: "text", text: "真实家庭场景" }],
      resolution: "720p",
      ratio: "9:16",
      duration: 15,
      generate_audio: true,
      watermark: false,
    });
  });

  it("reads the finished video from content.video_url", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ status: "succeeded", content: { video_url: "https://example.test/seedance.mp4" } }),
    }));

    const result = await (worker() as any).pollProvider(
      { code: "VOLCENGINE_SEEDANCE", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", publicConfig: {} },
      { modelConfig: {} },
      { apiKey: "ark-key" },
      "seedance-task-1",
    );

    expect(result).toMatchObject({
      state: "SUCCEEDED",
      externalJobId: "seedance-task-1",
      outputUrl: "https://example.test/seedance.mp4",
    });
  });
});
