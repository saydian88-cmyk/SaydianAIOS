import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  AiTaskCenterService,
  aiTaskFastLane,
  aiTaskQueueRank,
  aiTaskExecutionMode,
  aiTaskRoute,
  aiTaskTargetNodeCode,
  runnerCanClaimTask,
  runnerTaskTypeCapabilities,
  videoScriptOutputMetadata,
} from "./ai-task-center.service";

function serviceWith(overrides: Record<string, unknown> = {}) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "ai-task-1",
    ...data,
    ownerEmployeeId: null,
  }));
  const prisma: Record<string, any> = {
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
    commentRecord: { findMany: vi.fn().mockResolvedValue([]) },
    asset: { findMany: vi.fn().mockResolvedValue([]) },
    operationAnalysisRun: { findFirst: vi.fn().mockResolvedValue(null) },
    storeMetricSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
    productMetricSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
    aiTaskOutput: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    opsTask: { findUnique: vi.fn().mockResolvedValue(null) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
  prisma.$executeRaw = vi.fn().mockResolvedValue(0);
  prisma.$transaction = vi.fn(async (callback: (tx: Record<string, any>) => unknown) => callback(prisma));
  return {
    prisma,
    create,
    service: new AiTaskCenterService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never),
  };
}

describe("AiTaskCenterService", () => {
  it("selects only terminal tasks unchanged for at least three days for cleanup", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const { service } = serviceWith({ aiTask: { findMany } });
    const cutoff = new Date("2026-08-03T00:00:00.000Z");

    await (service as any).terminalCleanupCandidates(cutoff, "node-1");

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ["FAILED", "CANCELLED"] },
        updatedAt: { lte: cutoff },
        attempts: { some: { workerNodeId: "node-1" } },
      }),
    }));
  });

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

  it("classifies image projects as IMAGE_POST business tasks", () => {
    expect(aiTaskExecutionMode({
      type: "IMAGE",
      sourceType: "IMAGE_PROJECT",
      input: {},
    })).toBe("IMAGE_POST");
    expect(aiTaskExecutionMode({
      type: "IMAGE",
      sourceType: "WORKBENCH_CONTENT_REQUEST",
      input: { executionMode: "DEFAULT" },
    })).toBe("DEFAULT");
  });

  it("replays a completed batch image result that an older worker left outside the project", async () => {
    const task = {
      id: "batch-image-task-1", type: "IMAGE", status: "PENDING_REVIEW", taskNo: "AIT-BATCH-1",
      progress: 100, sourceType: "IMAGE_PROJECT", sourceId: "image-project-1", reviewerEmployeeId: null,
      input: { executionMode: "BATCH_IMAGE_POST", batchImageDirect: { groups: [{ groupKey: "1-1" }] } },
      output: { imagePost: { groups: [{ groupKey: "1-1", status: "READY", title: "已回传标题", pages: [{ title: "第一页" }] }] } },
    };
    const update = vi.fn().mockResolvedValue({});
    const { service } = serviceWith({ aiTask: { findUnique: vi.fn().mockResolvedValue(task), update } });
    (service as any).finalizeDomain = vi.fn().mockResolvedValue({ status: "PENDING_REVIEW", message: "图文已写入项目" });
    (service as any).syncSourceOpsTask = vi.fn().mockResolvedValue(undefined);
    (service as any).task = vi.fn().mockResolvedValue({ id: task.id, status: "PENDING_REVIEW" });

    await (service as any).reconcileBatchImageTask(task.id);

    expect((service as any).finalizeDomain).toHaveBeenCalledWith(task, task.output, "system-batch-image-reconcile");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ progress: 100, progressMessage: "图文已写入项目" }) }));
  });

  it("lets an employee mark at most three unfinished owned AI tasks urgent", async () => {
    const task = {
      id: "ai-task-urgent",
      taskNo: "AIT-URGENT",
      ownerEmployeeId: "employee-1",
      status: "PENDING",
      priority: "MEDIUM",
      input: {},
    };
    const count = vi.fn().mockResolvedValue(2);
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...task, ...data }));
    const { service } = serviceWith({
      aiTask: {
        findUnique: vi.fn().mockResolvedValue(task),
        count,
        update,
      },
    });

    const result = await service.markEmployeeUrgent(task.id, "employee-1", "测试员工");
    expect(result.priority).toBe("URGENT");
    expect(count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerEmployeeId: "employee-1", priority: "URGENT" }),
    }));
  });

  it("rejects a fourth unfinished urgent AI task for the same employee", async () => {
    const task = {
      id: "ai-task-fourth",
      taskNo: "AIT-FOURTH",
      ownerEmployeeId: "employee-1",
      status: "FAILED",
      priority: "MEDIUM",
      input: {},
    };
    const { service } = serviceWith({
      aiTask: {
        findUnique: vi.fn().mockResolvedValue(task),
        count: vi.fn().mockResolvedValue(3),
        update: vi.fn(),
      },
    });

    await expect(service.markEmployeeUrgent(task.id, "employee-1", "测试员工"))
      .rejects.toThrow("你已有3个未完成的紧急AI任务");
  });

  it("prevents legacy imagegen runners from claiming image-project tasks", () => {
    const imageProject = {
      type: "IMAGE",
      sourceType: "IMAGE_PROJECT",
      input: { executionMode: "IMAGE_POST", imageProjectId: "image-project-1" },
    };
    expect(runnerCanClaimTask(imageProject, undefined)).toBe(false);
    expect(runnerCanClaimTask(imageProject, ["DEFAULT"])).toBe(false);
    expect(runnerCanClaimTask(imageProject, ["IMAGE_POST"])).toBe(true);
    expect(runnerCanClaimTask({ type: "IMAGE", input: { executionMode: "DEFAULT" } }, undefined)).toBe(true);
  });

  it("builds deterministic routes without reading the task title", () => {
    expect(aiTaskRoute({
      type: "VIDEO",
      sourceType: "VIDEO_FACTORY_PROJECT",
      input: { executionMode: "FULL_VIDEO", codexDirectFullVideo: true, workflowGuard: { stage: "FULL_VIDEO" } },
    })).toEqual({
      version: 1,
      domain: "VIDEO_PROJECT",
      projectMode: "CODEX_DIRECT_FULL_VIDEO",
      stage: "FULL_VIDEO",
      executionMode: "FULL_VIDEO",
      requiredSkill: "video-editing-from-media-library",
    });
    expect(aiTaskRoute({
      type: "IMAGE",
      sourceType: "IMAGE_PROJECT",
      input: { executionMode: "IMAGE_POST", imageProjectId: "image-project-1" },
    })?.requiredSkill).toBe("saidian-douyin-image-posts");
    expect(aiTaskRoute({
      type: "IMAGE",
      sourceType: "IMAGE_PROJECT",
      input: { executionMode: "BATCH_IMAGE_POST", imageProjectId: "image-project-1" },
    })).toMatchObject({
      projectMode: "IMAGE_POST",
      executionMode: "IMAGE_POST",
      requiredSkill: "saidian-douyin-image-posts",
    });
    expect(aiTaskRoute({
      type: "VIDEO",
      sourceType: "DAILY_VIDEO_TOPIC_CARDS",
      input: { executionMode: "TOPIC_CARD_BATCH" },
    })).toBeNull();
  });

  it("claims only route keys explicitly supported by the unified node", () => {
    const codexDirect = {
      type: "VIDEO",
      sourceType: "VIDEO_FACTORY_PROJECT",
      input: { executionMode: "FULL_VIDEO", codexDirectFullVideo: true },
    };
    expect(runnerCanClaimTask(codexDirect, [], ["CODEX_DIRECT_FULL_VIDEO"])).toBe(true);
    expect(runnerCanClaimTask(codexDirect, [], ["IMAGE_POST"])).toBe(false);
    expect(runnerCanClaimTask({
      type: "ARTICLE",
      sourceType: "DAILY_AI_PLAN",
      input: { executionMode: "DEFAULT" },
    }, [], ["STANDARD_SMART_VIDEO", "IMAGE_POST"])).toBe(false);
  });

  it("derives VIDEO and IMAGE query capabilities from unified route keys", () => {
    expect(runnerTaskTypeCapabilities(["VIDEO"], [
      "STANDARD_SMART_VIDEO",
      "REFERENCE_DIRECT_FULL_VIDEO",
      "CODEX_DIRECT_FULL_VIDEO",
      "IMAGE_POST",
    ])).toEqual(["IMAGE", "VIDEO"]);
    expect(runnerTaskTypeCapabilities(["VIDEO"], undefined)).toEqual(["VIDEO"]);
  });

  it("prioritizes quick structured stages without reading task titles", () => {
    expect(aiTaskFastLane({ input: { executionMode: "COVER_TITLE" } })).toBe(true);
    expect(aiTaskFastLane({ input: { executionMode: "SCRIPT_ONLY" } })).toBe(true);
    expect(aiTaskFastLane({ input: { executionMode: "FULL_VIDEO" } })).toBe(false);
    expect(aiTaskQueueRank({ priority: "MEDIUM", input: { executionMode: "COVER_TITLE" } }))
      .toBeLessThan(aiTaskQueueRank({ priority: "HIGH", input: { executionMode: "FULL_VIDEO" } }));
    expect(aiTaskQueueRank({ priority: "URGENT", input: { executionMode: "FULL_VIDEO" } }))
      .toBeLessThan(aiTaskQueueRank({ priority: "MEDIUM", input: { executionMode: "COVER_TITLE" } }));
  });

  it("recovers shutdown-interrupted tasks without consuming business retries", async () => {
    const taskUpdate = vi.fn().mockResolvedValue({});
    const attemptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const nodeUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new AiTaskCenterService(
      {
        aiTask: {
          findMany: vi.fn().mockResolvedValue([{
            id: "shutdown-task-1",
            lockedBy: "windows-codex-video-01",
          }]),
          update: taskUpdate,
        },
        aiTaskAttempt: { updateMany: attemptUpdateMany },
        aiWorkerNode: { updateMany: nodeUpdateMany },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await (service as unknown as { releaseStaleTasks(): Promise<void> }).releaseStaleTasks();

    expect(taskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "RETRY",
        progressMessage: "执行节点中断，正在从已有结果自动恢复",
        failureReason: null,
        lockedBy: null,
        finishedAt: null,
      }),
    }));
    expect(taskUpdate.mock.calls[0]?.[0].data).not.toHaveProperty("retryCount");
    expect(attemptUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { aiTaskId: "shutdown-task-1", status: "RUNNING" },
      data: expect.objectContaining({ status: "RETRY" }),
    }));
    expect(nodeUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "OFFLINE", currentTaskId: null }),
    }));
  });

  it("repairs the execution envelope during exhausted legacy image-project routing recovery", async () => {
    const task = {
      id: "ai-image-1",
      taskNo: "AIT-IMAGE-1",
      status: "FAILED",
      type: "IMAGE",
      sourceType: "IMAGE_PROJECT",
      sourceId: "image-project-1",
      input: {},
      retryCount: 3,
      maxRetries: 3,
      failureReason: "requiredSkill=saidian-ai-task-dispatcher 与固定路由 imagegen 不一致",
    };
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...task,
      ...data,
    }));
    const auditCreate = vi.fn().mockResolvedValue({});
    const service = new AiTaskCenterService(
      {
        aiTask: { findUnique: vi.fn().mockResolvedValue(task), update },
        aiTaskOutput: { findFirst: vi.fn().mockResolvedValue(null) },
        opsTask: { findUnique: vi.fn().mockResolvedValue(null) },
        auditLog: { create: auditCreate },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.retry(task.id, "employee-1");

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "RETRY",
        progressMessage: "正在使用修复后的图文制作路由重新执行",
        input: expect.objectContaining({
          executionMode: "IMAGE_POST",
          sourceType: "IMAGE_PROJECT",
          imageProjectId: "image-project-1",
          imageProjectRoutingRecoveryAttempts: 1,
        }),
      }),
    }));
    expect(update.mock.calls[0]?.[0].data).not.toHaveProperty("retryCount");
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "AI_TASK_IMAGE_ROUTING_RECOVERY" }),
    }));
  });

  it("allows a final bounded image-project routing recovery after two stale-worker attempts", async () => {
    const task = {
      id: "ai-image-final-recovery",
      taskNo: "AIT-IMAGE-FINAL-RECOVERY",
      status: "FAILED",
      type: "IMAGE",
      sourceType: "IMAGE_PROJECT",
      sourceId: "image-project-final-recovery",
      input: {
        imageProjectRoutingRecoveryAttempts: 2,
        imageProjectRoutingRecoveryAttemptedAt: "2026-08-03T07:30:00.000Z",
      },
      retryCount: 3,
      maxRetries: 3,
      failureReason: "requiredSkill=saidian-ai-task-dispatcher 与固定路由 imagegen 不一致",
    };
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...task,
      ...data,
    }));
    const service = new AiTaskCenterService(
      {
        aiTask: { findUnique: vi.fn().mockResolvedValue(task), update },
        aiTaskOutput: { findFirst: vi.fn().mockResolvedValue(null) },
        opsTask: { findUnique: vi.fn().mockResolvedValue(null) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.retry(task.id, "employee-1");

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "RETRY",
        input: expect.objectContaining({
          executionMode: "IMAGE_POST",
          sourceType: "IMAGE_PROJECT",
          imageProjectId: "image-project-final-recovery",
          imageProjectRoutingRecoveryAttempts: 3,
        }),
      }),
    }));
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
      taskRoute: {
        version: 1,
        domain: "VIDEO_PROJECT",
        projectMode: "STANDARD_SMART_VIDEO",
        stage: "SCRIPT_ONLY",
        executionMode: "SCRIPT_ONLY",
        requiredSkill: "video-editing-from-media-library",
      },
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
      factoryModule: (body.input as Record<string, unknown>).factoryModule,
      count: (body.input as Record<string, unknown>).cardCount,
      estimatedCost: body.estimatedCost,
    }))).toEqual([
      { platform: "DOUYIN", mode: "TOPIC_CARD_BATCH", factoryModule: "DOUYIN_VIRAL", count: 10, estimatedCost: 0 },
      { platform: "TIKTOK", mode: "TOPIC_CARD_BATCH", factoryModule: "GENERAL_VIDEO_FACTORY", count: 10, estimatedCost: 0 },
    ]);
  });

  it("can create only the requested Douyin topic-card batch", async () => {
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

    await service.createDailyTopicCardTasks(
      new Date("2026-07-28T00:00:00.000Z"),
      "测试管理员",
      ["DOUYIN"],
    );

    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0][0].platform).toBe("DOUYIN");
    expect((createTask.mock.calls[0][0].input as Record<string, unknown>).executionMode).toBe("TOPIC_CARD_BATCH");
  });

  it("marks Douyin viral topic-card batches for the dedicated Skill route", async () => {
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

    await service.createDailyTopicCardTasks(
      new Date("2026-07-28T00:00:00.000Z"),
      "测试管理员",
      ["DOUYIN"],
      "DOUYIN_VIRAL",
    );

    expect(createTask.mock.calls[0][0].idempotencyKey).toContain("douyin-viral");
    expect(createTask.mock.calls[0][0].input).toMatchObject({
      executionMode: "TOPIC_CARD_BATCH",
      factoryModule: "DOUYIN_VIRAL",
    });
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

    task.input = {
      executionMode: "FULL_VIDEO",
      referenceDirectFullVideo: true,
      skillName: "video-editing-from-media-library",
      referenceVideoUrl: "https://example.com/reference.mp4",
      referenceDirectInput: { productModel: "W9" },
      projectBrief: { reference: "https://example.com/reference.mp4", additionalPrompt: "保留原声节奏" },
      materialBindings: [{ lineId: "L1", assetId: "asset-1" }],
    };
    task.instructions = "legacy reference prompt";
    const referenceDirectResult = await service.runnerPackage(token, task.id, { nodeCode: "windows-codex-01" });
    expect(referenceDirectResult.task.instructions).toBe("");
    expect(referenceDirectResult.task.input).toEqual({
      executionMode: "FULL_VIDEO",
      executionClass: "CODEX_SKILL",
      skillName: "video-editing-from-media-library",
      referenceDirectFullVideo: true,
      referenceDirectInput: {
        productModel: "W9",
        referenceVideoUrl: "https://example.com/reference.mp4",
        prompt: "保留原声节奏",
      },
    });
    expect(referenceDirectResult.assets).toEqual([]);
    expect(referenceDirectResult.snapshots).toEqual([]);
    expect(referenceDirectResult.execution).toMatchObject({
      requiredSkill: "video-editing-from-media-library",
      downstreamSkill: undefined,
    });

    task.input = {
      executionMode: "FULL_VIDEO",
      codexDirectFullVideo: true,
      executionClass: "CODEX_SKILL",
      skillName: "video-editing-from-media-library-share",
      codexDirectInput: {
        productModel: "W9",
        prompt: "突出气囊测量",
        creativeMode: "FULL_VIDEO",
        materialPolicy: { legacy: true },
      },
      materialBindings: [{ lineId: "L1", assetId: "asset-1" }],
    };
    task.instructions = "legacy codex direct prompt";
    const codexDirectResult = await service.runnerPackage(token, task.id, { nodeCode: "windows-codex-01" });
    expect(codexDirectResult.task.instructions).toBe("");
    expect(codexDirectResult.task.input).toEqual({
      executionMode: "FULL_VIDEO",
      executionClass: "CODEX_SKILL",
      skillName: "video-editing-from-media-library",
      codexDirectFullVideo: true,
      codexDirectInput: {
        productModel: "W9",
        prompt: "突出气囊测量",
        creativeMode: "FULL_VIDEO",
      },
    });
    expect(codexDirectResult.assets).toEqual([]);
    expect(codexDirectResult.snapshots).toEqual([]);

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

    task.type = "VIDEO";
    task.input = { executionMode: "FULL_VIDEO", factoryModule: "DOUYIN_VIRAL" };
    task.modelPolicy = { strategy: "CODEX_FIRST", allowExternalGeneration: false };
    const douyinResult = await service.runnerPackage(token, task.id, { nodeCode: "windows-codex-01" });
    expect(douyinResult.execution).toMatchObject({
      strategy: "CODEX_SKILL",
      requiredSkill: "saydian-douyin-viral-video-generator",
      videoModelRouting: {
        localFirst: true,
        externalShotAllocation: {
          SEEDANCE_2: 70,
          KLING: 30,
        },
        recipeRoutes: {
          GIFT_EMOTION: "SEEDANCE_2",
          UGC: "KLING",
          FAQ: "APPROVED_REAL_ASSET",
        },
        shotRoutes: {
          FAMILY_STORY: "SEEDANCE_2",
          HUMAN_ACTION: "KLING",
          PRODUCT_CLOSEUP: "APPROVED_REAL_ASSET",
        },
      },
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
