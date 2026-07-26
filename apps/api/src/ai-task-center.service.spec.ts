import { describe, expect, it, vi } from "vitest";
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
});
