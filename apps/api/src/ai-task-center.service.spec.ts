import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  AiTaskCenterService,
  aiTaskTargetNodeCode,
  videoScriptOutputMetadata,
} from "./ai-task-center.service";

function serviceWith(overrides: Record<string, unknown> = {}) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "ai-task-1",
    ...data,
    ownerEmployeeId: null,
  }));
  const prisma = {
    aiTask: {
      findUnique: vi.fn().mockResolvedValue(null),
      create,
      aggregate: vi.fn().mockResolvedValue({ _sum: { actualCost: 0 } }),
    },
    aiTaskPolicy: {
      upsert: vi.fn().mockResolvedValue({
        type: "ARTICLE",
        enabled: true,
        autoExecute: true,
        dailyBudget: 10,
        maxConcurrency: 1,
        maxAttempts: 3,
        timeoutSeconds: 1200,
      }),
    },
    contentPlan: { findUnique: vi.fn().mockResolvedValue(null) },
    smartKeyword: { findMany: vi.fn().mockResolvedValue([]) },
    knowledgeEntry: { findMany: vi.fn().mockResolvedValue([]) },
    asset: { findMany: vi.fn().mockResolvedValue([]) },
    operationAnalysisRun: { findFirst: vi.fn().mockResolvedValue(null) },
    storeMetricSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
    productMetricSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
    aiTaskOutput: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    opsTask: { findUnique: vi.fn().mockResolvedValue(null) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
  return {
    prisma,
    create,
    service: new AiTaskCenterService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never),
  };
}

describe("AiTaskCenterService", () => {
  it("builds a previewable result from the selected video script", () => {
    expect(videoScriptOutputMetadata([
      { title: "候选一", selected: false },
      { title: "最终脚本", selected: true, script: "完整口播" },
    ])).toEqual({
      script: { title: "最终脚本", selected: true, script: "完整口播" },
      scriptCount: 2,
      selectedCandidate: 1,
    });
  });

  it("routes legacy smart-video project tasks to the primary video computer", () => {
    expect(aiTaskTargetNodeCode({
      sourceType: "VIDEO_FACTORY_PROJECT",
      input: { executionMode: "SCRIPT_ONLY" },
    })).toBe("windows-codex-video-01");
  });

  it("honors an explicit target node without routing unrelated content tasks", () => {
    expect(aiTaskTargetNodeCode({
      sourceType: "VIDEO_FACTORY_PROJECT",
      input: { preferredNodeCode: "WINDOWS-CODEX-VIDEO-02" },
    })).toBe("windows-codex-video-02");
    expect(aiTaskTargetNodeCode({
      sourceType: "WORKBENCH_CONTENT_REQUEST",
      input: { executionMode: "ARTICLE" },
    })).toBe("");
  });

  it("closes obsolete reshoot tasks after local masters are registered", async () => {
    const prisma = {
      aiTaskPolicy: { upsert: vi.fn().mockResolvedValue({}) },
      aiTaskOutput: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ aiTaskId: "task-with-master" }])
          .mockResolvedValueOnce([]),
      },
      opsTask: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const videoFactory = { backfillLocalMasterRenderJobs: vi.fn().mockResolvedValue(1) };
    const service = new AiTaskCenterService(
      prisma as never,
      {} as never,
      videoFactory as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.onModuleInit();

    expect(videoFactory.backfillLocalMasterRenderJobs).toHaveBeenCalledOnce();
    expect(prisma.opsTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sourceId: { in: ["task-with-master"] },
        category: "CONTENT_PRODUCTION",
      }),
      data: expect.objectContaining({ status: "COMPLETED" }),
    }));
  });

  it("creates a budget-approved article task for the Codex runner", async () => {
    const { service, create } = serviceWith();
    const result = await service.createTask({
      type: "ARTICLE",
      title: "今日软文",
      idempotencyKey: "article:2026-07-27",
      estimatedCost: 1,
    }, "测试管理员");

    expect(result.duplicate).toBe(false);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].data.status).toBe("PENDING");
    expect(create.mock.calls[0][0].data.type).toBe("ARTICLE");
  });

  it("records the primary computer on newly created smart-video tasks", async () => {
    const { service, create } = serviceWith();

    await service.createTask({
      type: "VIDEO",
      sourceType: "VIDEO_FACTORY_PROJECT",
      sourceId: "video-project-1",
      input: { executionMode: "SCRIPT_ONLY" },
      estimatedCost: 0,
    }, "测试管理员");

    expect(create.mock.calls[0][0].data.input).toMatchObject({
      executionMode: "SCRIPT_ONLY",
      preferredNodeCode: "windows-codex-video-01",
    });
  });

  it("does not require a daily budget for zero-cost local Codex tasks", async () => {
    const { service, create, prisma } = serviceWith();
    prisma.aiTaskPolicy.upsert.mockResolvedValueOnce({
      type: "IMAGE",
      enabled: true,
      autoExecute: true,
      dailyBudget: null,
      maxConcurrency: 1,
      maxAttempts: 3,
      timeoutSeconds: 1200,
    });

    await service.createTask({
      type: "IMAGE",
      title: "本地图片任务",
      estimatedCost: 0,
      modelPolicy: { strategy: "CODEX_FIRST", allowExternalGeneration: false },
    }, "测试管理员");

    expect(create.mock.calls[0][0].data.status).toBe("PENDING");
    expect(create.mock.calls[0][0].data.progressMessage).toBe("等待Codex执行器领取");
  });

  it("creates only two zero-cost daily topic-card batches with ten cards per platform", async () => {
    const prisma = {
      aiTaskPolicy: {
        upsert: vi.fn().mockResolvedValue({
          type: "VIDEO",
          config: {
            topicCardPolicyVersion: "v2.1",
            dailyTopicCards: { DOUYIN: 10, TIKTOK: 10 },
          },
        }),
      },
    };
    const service = new AiTaskCenterService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const createTask = vi.spyOn(service, "createTask").mockImplementation(async (body) => body as never);

    await service.createDailyTopicCardTasks(new Date("2026-07-28T00:00:00.000Z"), "系统自动化");

    expect(createTask).toHaveBeenCalledTimes(2);
    expect(createTask.mock.calls.map(([body]) => ({
      platform: body.platform,
      mode: (body.input as Record<string, unknown>).executionMode,
      count: (body.input as Record<string, unknown>).cardCount,
      estimatedCost: body.estimatedCost,
    }))).toEqual([
      { platform: "DOUYIN", mode: "TOPIC_CARD_BATCH", count: 10, estimatedCost: 0 },
      { platform: "TIKTOK", mode: "TOPIC_CARD_BATCH", count: 10, estimatedCost: 0 },
    ]);
  });

  it("keeps store analysis in WAITING_INPUT when no operating snapshot exists", async () => {
    const { service, create } = serviceWith({
      aiTaskPolicy: {
        upsert: vi.fn().mockResolvedValue({
          type: "STORE_ANALYSIS",
          enabled: true,
          autoExecute: true,
          dailyBudget: 10,
          maxConcurrency: 1,
          maxAttempts: 3,
          timeoutSeconds: 1200,
        }),
      },
    });

    await service.createTask({
      type: "STORE_ANALYSIS",
      idempotencyKey: "store:2026-07-27",
    }, "系统自动化");

    expect(create.mock.calls[0][0].data.status).toBe("WAITING_INPUT");
    expect(create.mock.calls[0][0].data.progressMessage).toContain("店铺经营快照");
  });

  it("runs a local article task without a configured daily budget", async () => {
    const { service, create } = serviceWith({
      aiTaskPolicy: {
        upsert: vi.fn().mockResolvedValue({
          type: "ARTICLE",
          enabled: true,
          autoExecute: true,
          dailyBudget: null,
          maxConcurrency: 1,
          maxAttempts: 3,
          timeoutSeconds: 1200,
        }),
      },
    });

    await service.createTask({
      type: "ARTICLE",
      idempotencyKey: "article:no-budget",
    }, "系统自动化");

    expect(create.mock.calls[0][0].data.status).toBe("PENDING");
    expect(create.mock.calls[0][0].data.progressMessage).toContain("Codex");
  });

  it("returns the existing task for the same idempotency key", async () => {
    const existing = { id: "existing", taskNo: "AIT-EXISTING", status: "PENDING" };
    const { service, create, prisma } = serviceWith();
    prisma.aiTask.findUnique.mockResolvedValueOnce(existing);

    const result = await service.createTask({
      type: "VIDEO",
      idempotencyKey: "video:2026-07-27",
    }, "系统自动化");

    expect(result).toEqual({ ...existing, duplicate: true });
    expect(create).not.toHaveBeenCalled();
  });

  it("returns a task package when an OSS signed URL cannot be created", async () => {
    const token = "runner-token";
    const task: Record<string, any> = {
      id: "task-1",
      taskNo: "AIT-1",
      type: "VIDEO",
      title: "完整视频任务",
      input: { executionMode: "FULL_VIDEO" },
      modelPolicy: { strategy: "CODEX_FIRST", allowExternalGeneration: false },
      inputSnapshots: [{
        id: "snapshot-1",
        kind: "TASK_CONTEXT",
        sourceType: "SMART_KEYWORD",
        sourceId: "keyword-1",
        checksum: "checksum",
        payload: { assets: [{ id: "asset-1" }] },
        missingFields: [],
        capturedAt: new Date(),
      }],
      attempts: [],
      outputs: [],
      notifications: [],
    };
    const prisma = {
      aiWorkerNode: {
        findUnique: vi.fn().mockResolvedValue({
          id: "node-1",
          nodeCode: "windows-codex-01",
          tokenHash: createHash("sha256").update(token).digest("hex"),
        }),
      },
      aiTask: {
        findFirst: vi.fn().mockResolvedValue(task),
        findUnique: vi.fn().mockResolvedValue(task),
      },
      asset: {
        findFirst: vi.fn().mockResolvedValue({
          id: "asset-1",
          updatedAt: new Date("2026-07-31T00:00:00.000Z"),
        }),
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([{
          id: "asset-1",
          assetNo: "AST-1",
          displayName: "W9产品图",
          kind: "IMAGE",
          mediaType: "image/jpeg",
          extension: "jpg",
          sha256: "hash",
          sizeBytes: 100n,
          objectKey: "assets/w9.jpg",
          storageUrl: "oss://bucket/assets/w9.jpg",
          sourcePath: "D:\\素材\\w9.jpg",
          reviewStatus: "APPROVED",
          availabilityStatus: "ACTIVE",
          rightsStatus: "COMMERCIAL",
        }]),
      },
    };
    const oss = { signedDownloadUrl: vi.fn(() => { throw new Error("OSS unavailable"); }) };
    const service = new AiTaskCenterService(
      prisma as never,
      oss as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.runnerPackage(token, task.id, { nodeCode: "windows-codex-01" });

    expect(result.execution).toMatchObject({
      mode: "FULL_VIDEO",
      strategy: "CODEX_FIRST",
      allowExternalGeneration: false,
      requiredSkill: "saidian-ai-task-dispatcher",
      healthContentAllowed: true,
    });
    expect(result.assets[0]).toMatchObject({
      id: "asset-1",
      sizeBytes: "100",
      downloadUrl: null,
      localPath: null,
    });
    expect(result.assets[0]).not.toHaveProperty("sourcePath");
    expect(result.assets[0]).not.toHaveProperty("objectKey");

    task.type = "IMAGE";
    task.input = {};
    task.modelPolicy = { strategy: "AUTO", allowExternalGeneration: true };
    const imageResult = await service.runnerPackage(token, task.id, { nodeCode: "windows-codex-01" });
    expect(imageResult.execution).toMatchObject({
      strategy: "CODEX_SKILL",
      allowExternalGeneration: false,
      requiredSkill: "imagegen",
    });

    task.type = "ARTICLE";
    const articleResult = await service.runnerPackage(token, task.id, { nodeCode: "windows-codex-01" });
    expect(articleResult.execution).toMatchObject({
      strategy: "CODEX_SKILL",
      allowExternalGeneration: false,
      requiredSkill: "build-health-brand-trust-content",
    });
  });

  it("serializes uploaded output asset sizes for task APIs", async () => {
    const task = {
      id: "task-with-video",
      outputs: [{
        id: "output-1",
        asset: { id: "asset-1", sizeBytes: 1_495_435n },
      }],
    };
    const prisma = {
      aiTask: {
        findMany: vi.fn().mockResolvedValue([task]),
        findUnique: vi.fn().mockResolvedValue(task),
      },
    };
    const service = new AiTaskCenterService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const [listed] = await service.tasks({});
    const detailed = await service.task(task.id);

    expect(listed.outputs[0].asset?.sizeBytes).toBe("1495435");
    expect(detailed.outputs[0].asset?.sizeBytes).toBe("1495435");
  });

  it("repairs legacy video metadata without changing review state", async () => {
    const token = "runner-secret";
    const outputUpdate = vi.fn().mockResolvedValue({ id: "output-1", reviewStatus: "APPROVED" });
    const assetUpdate = vi.fn().mockResolvedValue({ id: "asset-1", reviewStatus: "APPROVED" });
    const prisma = {
      aiWorkerNode: {
        findUnique: vi.fn().mockResolvedValue({
          id: "node-1",
          nodeCode: "windows-codex-01",
          tokenHash: createHash("sha256").update(token).digest("hex"),
        }),
      },
      aiTask: {
        findUnique: vi.fn().mockResolvedValue({ id: "task-1", taskNo: "AIT-1" }),
      },
      aiTaskOutput: {
        findFirst: vi.fn().mockResolvedValue({
          id: "output-1",
          aiTaskId: "task-1",
          assetId: "asset-1",
          reviewStatus: "APPROVED",
          metadata: { source: "CODEX_LOCAL_FFMPEG" },
          asset: { id: "asset-1", reviewStatus: "APPROVED", sourceSnapshot: {} },
        }),
        update: outputUpdate,
      },
      asset: { update: assetUpdate },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const service = new AiTaskCenterService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.runnerOutputMetadata(token, "AIT-1", {
      nodeCode: "windows-codex-01",
      kind: "VIDEO_MASTER",
      metadata: {
        width: 1080,
        height: 1920,
        durationSeconds: 24,
        codec: "h264",
        frameRate: "30/1",
        usedAssetIds: ["asset-source-1"],
      },
    });

    expect(result).toMatchObject({ ok: true, outputId: "output-1", assetId: "asset-1" });
    expect(outputUpdate.mock.calls[0]?.[0].data).not.toHaveProperty("reviewStatus");
    expect(assetUpdate.mock.calls[0]?.[0].data).not.toHaveProperty("reviewStatus");
    expect(assetUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ width: 1080, height: 1920, durationSeconds: 24 }),
    }));
  });

  it("routes task-linked AI notifications to the employee workbench detail", async () => {
    const notificationUpsert = vi.fn().mockResolvedValue({});
    const send = vi.fn().mockResolvedValue({ configured: false });
    const service = new AiTaskCenterService(
      { taskNotification: { upsert: notificationUpsert } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { send } as never,
    );

    await service["notify"](
      "ai-task-1",
      "employee-1",
      "AI_TASK_WAITING_INPUT",
      "AI任务需要补充资料",
      "已创建补拍任务",
      "ops-task-1",
    );

    const targetUrl = new URL(send.mock.calls[0]?.[3] as string);
    expect(targetUrl.pathname).toBe("/saidian-work/");
    expect(targetUrl.searchParams.get("taskId")).toBe("ops-task-1");
    expect(notificationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ aiTaskId: "ai-task-1", taskId: "ops-task-1", channel: "IN_APP" }),
    }));
  });
});
