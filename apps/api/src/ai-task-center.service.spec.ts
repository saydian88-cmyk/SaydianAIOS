import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { AiTaskCenterService } from "./ai-task-center.service";

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
    smartKeyword: { findMany: vi.fn().mockResolvedValue([]) },
    knowledgeEntry: { findMany: vi.fn().mockResolvedValue([]) },
    asset: { findMany: vi.fn().mockResolvedValue([]) },
    operationAnalysisRun: { findFirst: vi.fn().mockResolvedValue(null) },
    storeMetricSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
    productMetricSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
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

  it("requires confirmation when the daily budget is not configured", async () => {
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

    expect(create.mock.calls[0][0].data.status).toBe("WAITING_CONFIRMATION");
    expect(create.mock.calls[0][0].data.progressMessage).toContain("每日预算未配置");
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
    const task = {
      id: "task-1",
      taskNo: "AIT-1",
      type: "VIDEO",
      title: "脚本任务",
      input: { executionMode: "SCRIPT_ONLY" },
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
      mode: "SCRIPT_ONLY",
      strategy: "CODEX_FIRST",
      allowExternalGeneration: false,
    });
    expect(result.assets[0]).toMatchObject({
      id: "asset-1",
      sizeBytes: "100",
      downloadUrl: null,
      localPath: null,
    });
    expect(result.assets[0]).not.toHaveProperty("sourcePath");
    expect(result.assets[0]).not.toHaveProperty("objectKey");
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
});
