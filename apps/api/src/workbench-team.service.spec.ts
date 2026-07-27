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
  return new WorkbenchService(prisma as never, {} as never);
}

describe("WorkbenchService operation team", () => {
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
});
