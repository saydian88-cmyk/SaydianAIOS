import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { encryptIntegrationValue } from "./integration-secret";
import { VideoFactoryWorkerService } from "./video-factory-worker.service";

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
