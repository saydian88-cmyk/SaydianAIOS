import { describe, expect, it, vi } from "vitest";
import { WorkbenchService } from "./workbench.service";

const operator = {
  audience: "EMPLOYEE_WORKBENCH" as const,
  employeeId: "operator-1",
  name: "主运营",
  isSuperAdmin: false,
  roles: ["CONTENT_OPERATOR"],
  permissions: ["TASK_EXECUTE"],
  dataScope: "SELF",
  exp: Date.now(),
};

function service(prisma: Record<string, unknown>) {
  return new WorkbenchService(prisma as never, {} as never, {} as never);
}

describe("WorkbenchService operation team", () => {
  it("uses the video project stage instead of a stale AI subtask status", () => {
    const target = service({});
    const projection = (target as any).taskProjection(
      { id: "task-1", taskNo: "TASK-1", status: "IN_PROGRESS", reviews: [] },
      { id: "ai-1", taskNo: "AI-1", status: "RUNNING", outputs: [], progress: 80 },
      {
        id: "project-1",
        productionNo: "VF-1",
        productionStage: "FACTORY_SCRIPT_READY",
        productModel: "W9S",
        targetPlatforms: ["DOUYIN"],
        createdAt: new Date("2026-07-29T08:00:00.000Z"),
        sourceSignals: [{ type: "VIDEO_FACTORY", brief: { videoType: "场景种草型", keywords: "父母关爱" } }],
      },
    );

    expect(projection.displayStatus).toBe("脚本待审核");
    expect(projection.nextAction).toBe("审核、修改或退回当前脚本");
    expect(projection.aiTask.status).toBe("RUNNING");
    expect(projection.project).toMatchObject({
      productionNo: "VF-1",
      productModel: "W9S",
      platform: "DOUYIN",
      videoType: "场景种草型",
      keywords: "父母关爱",
    });
  });

  it("rejects inviting self", async () => {
    const target = service({});
    await expect(target.inviteOperator(operator, { recipientEmployeeId: "operator-1" }))
      .rejects.toThrow("请选择其他运营员工");
  });

  it("only creates tasks for a current direct operator", async () => {
    const target = service({
      employee: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    await expect(target.createTeamTask(operator, {
      assigneeEmployeeId: "other-operator",
      title: "协作任务",
    })).rejects.toThrow("只能给当前协作成员安排任务");
  });

  it("creates a personal task assigned to the current employee", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "task-self",
      title: "整理素材",
      status: "ACCEPTED",
      assigneeEmployeeId: "operator-1",
    });
    const target = service({
      opsTask: { create },
      operationTaskHistory: { create: vi.fn().mockResolvedValue({}) },
      taskNotification: { upsert: vi.fn().mockResolvedValue({}) },
    });
    await target.createSelfTask(operator, { title: "整理素材", priority: "HIGH" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: "整理素材",
        priority: "HIGH",
        status: "ACCEPTED",
        assigneeEmployeeId: "operator-1",
        sourceType: "SELF_CREATED",
      }),
    }));
  });

  it("builds a grounded content suggestion from the selected product and keyword", async () => {
    const target = service({
      product: {
        findUnique: vi.fn().mockResolvedValue({ id: "p1", modelCode: "E8", name: "心电健康手表", metadata: {} }),
      },
      smartKeyword: {
        findUnique: vi.fn().mockResolvedValue({
          id: "k1",
          keyword: "健康数据入口",
          platform: "DOUYIN",
          market: "CN",
          audience: "首次使用E8的用户",
          pain: "分不清多个数据入口",
          scene: "开箱首次连接",
          opportunityScore: 92,
        }),
      },
    });
    const result = await target.contentTaskSuggestion({
      contentType: "SHORT_VIDEO",
      productId: "p1",
      keywordId: "k1",
      platform: "DOUYIN",
    });
    expect(result.title).toContain("E8");
    expect(result.description).toContain("健康数据入口");
    expect(result.expectedResult).toContain("3个Hook");
  });

  it("returns the latest previewable system outputs for the employee library", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: "output-1",
      kind: "VIDEO_MASTER",
      title: "E8主成片",
      reviewStatus: "APPROVED",
      metadata: { isFinal: true, version: 1 },
      asset: {
        reviewStatus: "APPROVED",
        availabilityStatus: "ACTIVE",
        objectKey: "videos/e8.mp4",
        width: 1080,
        height: 1920,
        durationSeconds: 18,
      },
      contentPlan: null,
    }]);
    const target = service({ aiTaskOutput: { findMany } });
    const result = await target.outputs({ type: "VIDEO", limit: "5" });
    expect(result.items).toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: "desc" },
      take: 20,
      where: {
        AND: expect.arrayContaining([
          { kind: { in: expect.arrayContaining(["VIDEO_MASTER", "IMAGE_OUTPUT", "ARTICLE_OUTPUT"]) } },
          { reviewStatus: "APPROVED" },
          { kind: "VIDEO_MASTER" },
        ]),
      },
    }));
  });

  it("resolves an AI approval notification to its employee task", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const target = service({
      taskNotification: {
        findFirst: vi.fn().mockResolvedValue({
          id: "notice-1",
          taskId: "task-ai-1",
          aiTaskId: "ai-1",
          recipientEmployeeId: "operator-1",
          channel: "IN_APP",
        }),
        updateMany,
      },
      opsTask: {
        findFirst: vi.fn().mockResolvedValue({ id: "task-ai-1", category: "CONTENT_VIDEO", evidence: {} }),
      },
      aiTask: {
        findUnique: vi.fn().mockResolvedValue({
          sourceType: "WORKBENCH_CONTENT_REQUEST",
          sourceId: "task-ai-1",
          input: { opsTaskId: "task-ai-1" },
        }),
      },
    });
    const result = await target.readNotification(operator, "notice-1");
    expect(result).toEqual({ ok: true, taskId: "task-ai-1" });
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it("redirects a historical AI delivery notification to the original employee task", async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: "delivery-1", category: "AI_DELIVERY", evidence: { aiTaskId: "ai-1" } })
      .mockResolvedValueOnce({ id: "source-task-1" });
    const target = service({
      taskNotification: {
        findFirst: vi.fn().mockResolvedValue({
          id: "notice-1",
          taskId: "delivery-1",
          aiTaskId: "ai-1",
          recipientEmployeeId: "operator-1",
          channel: "IN_APP",
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      opsTask: { findFirst },
      aiTask: {
        findUnique: vi.fn().mockResolvedValue({
          sourceType: "WORKBENCH_CONTENT_REQUEST",
          sourceId: "source-task-1",
          input: { opsTaskId: "source-task-1" },
        }),
      },
    });
    await expect(target.readNotification(operator, "notice-1"))
      .resolves.toEqual({ ok: true, taskId: "source-task-1" });
  });

  it("completes a personal task without waiting for a reviewer", async () => {
    const update = vi.fn().mockResolvedValue({ id: "task-self", status: "COMPLETED" });
    const transaction = vi.fn(async (callback: (tx: Record<string, any>) => Promise<unknown>) => callback({
      taskSubmission: {
        aggregate: vi.fn().mockResolvedValue({ _max: { version: null } }),
        create: vi.fn().mockResolvedValue({ id: "submission-1", version: 1 }),
      },
      opsTask: { update },
      operationTaskHistory: { create: vi.fn().mockResolvedValue({}) },
      taskNotification: { create: vi.fn().mockResolvedValue({}) },
    }));
    const target = service({
      opsTask: {
        findFirst: vi.fn().mockResolvedValue({
          id: "task-self",
          title: "整理素材",
          category: "GENERAL",
          sourceType: "SELF_CREATED",
          status: "IN_PROGRESS",
          assigneeEmployeeId: "operator-1",
          assignedByEmployeeId: null,
        }),
      },
      $transaction: transaction,
    });
    await target.submit(operator, "task-self", { summary: "已完成" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "COMPLETED" }),
    }));
  });

  it("only reviews tasks assigned by the current operator", async () => {
    const target = service({
      opsTask: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    await expect(target.reviewTeamTask(operator, "task-1", { action: "APPROVE" }))
      .rejects.toThrow("只能审核自己安排的运营协作任务");
  });

  it("does not mark a completed collaboration task as urgent", async () => {
    const target = service({
      opsTask: {
        findFirst: vi.fn().mockResolvedValue({
          id: "task-1",
          status: "COMPLETED",
          assignedByEmployeeId: "operator-1",
          sourceType: "OPERATOR_COLLAB",
        }),
      },
    });
    await expect(target.setTeamTaskUrgency(operator, "task-1", true))
      .rejects.toThrow("已完成或已取消的任务不能调整紧急状态");
  });

  it("lists received collaboration tasks for the current employee", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const target = service({
      opsTask: {
        findMany,
        count: vi.fn().mockResolvedValue(0),
      },
    });
    await target.teamTasks(operator, { scope: "RECEIVED" });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        assigneeEmployeeId: "operator-1",
        sourceType: "OPERATOR_COLLAB",
      }),
    }));
  });

  it("rejects a reporting relationship cycle", async () => {
    const target = service({
      employee: {
        findFirst: vi.fn().mockResolvedValue({ id: "operator-2", status: "ACTIVE" }),
        findUnique: vi.fn()
          .mockResolvedValueOnce({ supervisorEmployeeId: "operator-1" }),
      },
      employeeReportingInvite: {
        findFirst: vi.fn().mockResolvedValue({
          id: "invite-1",
          senderEmployeeId: "operator-2",
          recipientEmployeeId: "operator-1",
          status: "PENDING",
          sender: { id: "operator-2" },
          recipient: { id: "operator-1" },
        }),
      },
    });
    await expect(target.respondOperatorInvite(operator, "invite-1", { action: "ACCEPT" }))
      .rejects.toThrow("协作关系不能形成循环");
  });
  it("moves only an owned cancelled task into the three-day recycle bin", async () => {
    const update = vi.fn().mockResolvedValue({ id: "task-self", status: "CANCELLED" });
    const target = service({
      opsTask: {
        findFirst: vi.fn().mockResolvedValue({
          id: "task-self",
          title: "cancelled task",
          status: "CANCELLED",
          sourceType: "SELF_CREATED",
          assigneeEmployeeId: "operator-1",
        }),
        update,
      },
      operationTaskHistory: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    });
    await target.trashCancelledTask(operator, "task-self");
    const data = update.mock.calls[0][0].data;
    expect(data.deletedByEmployeeId).toBe("operator-1");
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.purgeAfter.getTime() - data.deletedAt.getTime()).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it("rejects deleting a task that has not been cancelled", async () => {
    const target = service({
      opsTask: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    await expect(target.trashCancelledTask(operator, "task-active")).rejects.toThrow();
  });

  it("restores only a task deleted by the current employee", async () => {
    const update = vi.fn().mockResolvedValue({ id: "task-self", status: "CANCELLED" });
    const target = service({
      opsTask: {
        findFirst: vi.fn().mockResolvedValue({
          id: "task-self",
          title: "cancelled task",
          status: "CANCELLED",
          sourceType: "SELF_CREATED",
          assigneeEmployeeId: "operator-1",
        }),
        update,
      },
      operationTaskHistory: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    });
    await target.restoreTask(operator, "task-self");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: { deletedAt: null, purgeAfter: null, deletedByEmployeeId: null },
    }));
  });
});
