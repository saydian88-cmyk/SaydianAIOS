import { UnauthorizedException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptIntegrationValue } from "./integration-secret";
import {
  usesConfiguredVideoRenderer,
  videoRenderCaptionTexts,
  VideoFactoryWorkerService,
  wrapVideoSubtitle,
} from "./video-factory-worker.service";

afterEach(() => vi.unstubAllGlobals());

describe("Douyin viral render isolation", () => {
  it("uses deterministic local rendering instead of the shared renderer command", () => {
    expect(usesConfiguredVideoRenderer({
      sourceSignals: [{ type: "VIDEO_FACTORY", factoryModule: "DOUYIN_VIRAL" }],
    })).toBe(false);
    expect(usesConfiguredVideoRenderer({
      sourceSignals: [{ type: "VIDEO_FACTORY", factoryModule: "GENERAL_VIDEO_FACTORY" }],
    })).toBe(true);
  });

  it("uses concise script subtitles and wraps them inside the safe area", () => {
    expect(wrapVideoSubtitle("这是一条明显超过单行安全区域的抖音成片字幕，需要自动换行显示"))
      .toBe("这是一条明显超过单行安全区域\n的抖音成片字幕，需要自动换…");
    expect(videoRenderCaptionTexts({
      sourceSignals: [{
        type: "VIDEO_FACTORY",
        selectedCandidateIndex: 0,
        scriptCandidates: [{
          shots: [
            { subtitle: "一块圆表｜三种风格", voiceover: "一段更长的口播" },
            { subtitle: "通勤｜黑色更利落" },
          ],
        }],
      }],
      hook: "不应使用的长Hook",
      objective: "不应使用的长目标",
      outline: ["不应使用的画面说明"],
      videoShots: [{ description: "镜头一" }, { description: "镜头二" }],
    })).toEqual(["一块圆表｜三种风格", "通勤｜黑色更利落"]);
  });
});

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

describe("VideoFactoryWorkerService Kling adapter", () => {
  function worker() {
    return new VideoFactoryWorkerService({
      contentPlan: { findUnique: vi.fn().mockResolvedValue({ productModel: null }) },
    } as never, {} as never, {} as never);
  }

  it("submits the official Kling 3.0 Turbo task format", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ code: 0, data: { id: "kling-task-1", status: "submitted" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await (worker() as any).submitProvider(
      {
        code: "KLING",
        baseUrl: "https://api-beijing.klingai.com",
        publicConfig: { endpointModel: "kling-3.0-turbo", watermark: false },
      },
      { code: "kling-video", modelConfig: {} },
      { apiKey: "kling-key" },
      { id: "job-1", prompt: "真实人物佩戴智能手表", input: { duration: 5, ratio: "9:16" }, contentPlanId: "plan-1" },
    );

    expect(result).toMatchObject({ state: "RUNNING", externalJobId: "kling-task-1" });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api-beijing.klingai.com/text-to-video/kling-3.0-turbo");
    expect(JSON.parse(options.body)).toMatchObject({
      prompt: "真实人物佩戴智能手表",
      settings: { resolution: "720p", aspect_ratio: "9:16", duration: 5 },
      options: { external_task_id: "job-1", watermark_info: { enabled: false } },
    });
  });

  it("reads a finished Kling video from the unified tasks response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        code: 0,
        data: [{
          id: "kling-task-1",
          status: "succeeded",
          outputs: [{ type: "video", url: "https://example.test/kling.mp4" }],
          billing: [{ charge_type: "cash", amount: "1.25" }],
        }],
      }),
    }));

    const result = await (worker() as any).pollProvider(
      { code: "KLING", baseUrl: "https://api-beijing.klingai.com", publicConfig: {} },
      { modelConfig: {} },
      { apiKey: "kling-key" },
      "kling-task-1",
    );

    expect(result).toMatchObject({
      state: "SUCCEEDED",
      externalJobId: "kling-task-1",
      outputUrl: "https://example.test/kling.mp4",
      cost: 1.25,
    });
  });
});

describe("VideoFactoryWorkerService model routing", () => {
  it("uses the dedicated Douyin action route for action shots", async () => {
    const resolveModel = vi.fn().mockResolvedValue({
      primary: { id: "kling-model" },
      fallbacks: [{ id: "seedance-model" }],
    });
    const worker = new VideoFactoryWorkerService({} as never, { resolveModel } as never, {} as never);

    const selected = await (worker as any).selectModel({
      input: {
        platform: "DOUYIN",
        factoryModule: "DOUYIN_VIRAL",
        modelScenario: "DOUYIN_VIRAL_ACTION",
        auxiliaryImageAssetIds: [],
      },
      routingMode: "AUTO",
      requestedModelId: null,
      allowFallback: true,
      attemptCount: 0,
    });

    expect(selected).toMatchObject({ id: "kling-model" });
    expect(resolveModel).toHaveBeenCalledWith(expect.objectContaining({
      platform: "DOUYIN",
      scenario: "DOUYIN_VIRAL_ACTION",
      capability: "TEXT_TO_VIDEO",
    }));
  });
});
