import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { SessionPayload } from "./auth.service";
import { BailianVideoAiProvider } from "./cloud-media.service";
import { PrismaService } from "./prisma.service";

const openStatuses = ["OPEN", "ACCEPTED", "IN_PROGRESS", "RETURNED", "REVIEW"];
const doneStatuses = ["COMPLETED", "CANCELLED", "VERIFIED"];

function value(input: unknown) {
  return String(input ?? "").trim();
}

function date(input: unknown) {
  const text = value(input);
  if (!text) return undefined;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException("时间格式不正确");
  return parsed;
}

@Injectable()
export class WorkbenchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bailian: BailianVideoAiProvider,
  ) {}

  async dashboard(session: SessionPayload) {
    const employeeId = session.employeeId!;
    const access = this.taskAccess(session);
    const [employee, tasks, unread, recentNotices] = await Promise.all([
      this.prisma.employee.findUnique({
        where: { id: employeeId },
        include: { department: true, roles: { include: { role: true } } },
      }),
      this.prisma.opsTask.findMany({
        where: { AND: [access, { status: { in: openStatuses } }] },
        include: this.taskInclude(),
        orderBy: [{ priority: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
        take: 40,
      }),
      this.prisma.taskNotification.count({
        where: { recipientEmployeeId: employeeId, readAt: null },
      }),
      this.prisma.taskNotification.findMany({
        where: { recipientEmployeeId: employeeId },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    ]);
    const now = Date.now();
    const mine = tasks.filter((task) => task.assigneeEmployeeId === employeeId);
    const available = tasks.filter((task) => !task.assigneeEmployeeId && task.status === "OPEN");
    return {
      employee,
      summary: {
        today: mine.filter((task) => task.dueAt && this.sameDay(task.dueAt, new Date())).length,
        inProgress: mine.filter((task) => ["ACCEPTED", "IN_PROGRESS", "RETURNED"].includes(task.status)).length,
        awaitingReview: mine.filter((task) => task.status === "REVIEW").length,
        overdue: mine.filter((task) => task.dueAt && task.dueAt.getTime() < now && !doneStatuses.includes(task.status)).length,
        available: available.length,
        unread,
      },
      todayTasks: mine.slice(0, 12),
      availableTasks: available.slice(0, 8),
      notices: recentNotices,
      quickActions: this.quickActions(session.roles),
      mall: {
        employee: "/saidian-mall/#/pages/employee/index",
        storefront: "/saidian-mall/",
      },
    };
  }

  async tasks(session: SessionPayload, query: Record<string, string | undefined>) {
    const status = value(query.status).toUpperCase();
    const scope = value(query.scope).toUpperCase();
    const employeeId = session.employeeId!;
    const access = this.taskAccess(session);
    const where = scope === "AVAILABLE"
      ? {
          AND: [
            access,
            { assigneeEmployeeId: null, status: "OPEN" },
          ],
        }
      : {
          AND: [
            access,
            scope === "MINE" ? { assigneeEmployeeId: employeeId } : {},
            status ? { status } : {},
          ],
        };
    return this.prisma.opsTask.findMany({
      where,
      include: this.taskInclude(),
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 200,
    });
  }

  async task(session: SessionPayload, id: string) {
    const task = await this.prisma.opsTask.findFirst({
      where: { AND: [{ id }, this.taskAccess(session)] },
      include: this.taskInclude(true),
    });
    if (!task) throw new NotFoundException("任务不存在或无权查看");
    return task;
  }

  async accept(session: SessionPayload, id: string) {
    const task = await this.prisma.opsTask.findFirst({
      where: { AND: [{ id }, this.taskAccess(session), { assigneeEmployeeId: null, status: "OPEN" }] },
    });
    if (!task) throw new BadRequestException("任务已被领取或不可领取");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.opsTask.update({
        where: { id },
        data: {
          assigneeEmployeeId: session.employeeId,
          owner: session.name,
          status: "ACCEPTED",
          acceptedAt: new Date(),
        },
      });
      await tx.operationTaskHistory.create({
        data: {
          taskId: id,
          fromStatus: "OPEN",
          toStatus: "ACCEPTED",
          action: "ACCEPT",
          actor: session.name,
        },
      });
      return updated;
    });
  }

  async start(session: SessionPayload, id: string) {
    const task = await this.ownedTask(session, id, ["ACCEPTED", "RETURNED", "OPEN"]);
    return this.transition(task, "IN_PROGRESS", "START", session.name, {
      startedAt: task.startedAt || new Date(),
      returnReason: null,
    });
  }

  async submit(session: SessionPayload, id: string, body: Record<string, unknown>) {
    const summary = value(body.summary);
    if (!summary) throw new BadRequestException("请填写任务成果说明");
    const task = await this.ownedTask(session, id, ["ACCEPTED", "IN_PROGRESS", "RETURNED"]);
    const rawPayload = body.payload && typeof body.payload === "object"
      ? body.payload as Record<string, unknown>
      : {};
    let aiOptimization: Record<string, unknown> | undefined;
    if (task.category === "LIVE_REVIEW") {
      try {
        aiOptimization = await this.bailian.generateStructuredText(
          "你是赛电直播复盘教练。根据主播提交的本场数据和复盘，给出简明、可执行的下一场优化建议。返回结构："
          + '{"summary":"","strengths":[],"problems":[],"nextActions":[{"action":"","priority":"HIGH|MEDIUM|LOW","deadline":""}],"scriptAdjustments":[],"learningTopics":[]}',
          { task: { title: task.title, description: task.description }, submission: { summary, ...rawPayload } },
        );
      } catch (error) {
        aiOptimization = {
          state: "UNAVAILABLE",
          message: error instanceof Error ? error.message : "AI直播复盘暂不可用",
        };
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.taskSubmission.aggregate({
        where: { taskId: id },
        _max: { version: true },
      });
      const submission = await tx.taskSubmission.create({
        data: {
          taskId: id,
          employeeId: session.employeeId!,
          version: (latest._max.version || 0) + 1,
          summary,
          payload: JSON.parse(JSON.stringify({
            ...rawPayload,
            ...(aiOptimization ? { aiOptimization } : {}),
          })) as Prisma.InputJsonValue,
        },
      });
      const updated = await tx.opsTask.update({
        where: { id },
        data: {
          status: "REVIEW",
          submittedAt: new Date(),
          result: summary,
          returnReason: null,
        },
      });
      await tx.operationTaskHistory.create({
        data: {
          taskId: id,
          fromStatus: task.status,
          toStatus: "REVIEW",
          action: "SUBMIT",
          actor: session.name,
          note: summary,
          data: { submissionId: submission.id, version: submission.version },
        },
      });
      return { task: updated, submission };
    });
  }

  async notifications(session: SessionPayload) {
    return this.prisma.taskNotification.findMany({
      where: { recipientEmployeeId: session.employeeId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async readNotification(session: SessionPayload, id: string) {
    const result = await this.prisma.taskNotification.updateMany({
      where: { id, recipientEmployeeId: session.employeeId },
      data: { readAt: new Date() },
    });
    if (!result.count) throw new NotFoundException("消息不存在");
    return { ok: true };
  }

  async adminOverview() {
    const [roles, employees, adminUsers, templates, taskCounts] = await Promise.all([
      this.prisma.role.findMany({ orderBy: [{ portal: "asc" }, { name: "asc" }] }),
      this.prisma.employee.findMany({
        where: { status: "ACTIVE" },
        include: { department: true, roles: { include: { role: true } } },
        orderBy: { name: "asc" },
      }),
      this.prisma.adminUser.findMany({
        include: { roles: { include: { role: true } } },
        orderBy: { username: "asc" },
      }),
      this.prisma.taskTemplate.findMany({ include: { role: true }, orderBy: { name: "asc" } }),
      this.prisma.opsTask.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    return { roles, employees, adminUsers, templates, taskCounts };
  }

  async adminTasks(query: Record<string, string | undefined>) {
    const status = value(query.status).toUpperCase();
    const assigneeEmployeeId = value(query.assigneeEmployeeId);
    return this.prisma.opsTask.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(assigneeEmployeeId ? { assigneeEmployeeId } : {}),
      },
      include: this.taskInclude(true),
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 500,
    });
  }

  async createTask(body: Record<string, unknown>, actor: string) {
    const title = value(body.title);
    const category = value(body.category) || "GENERAL";
    if (!title) throw new BadRequestException("任务标题不能为空");
    const created = await this.prisma.opsTask.create({
      data: {
        taskNo: `TASK-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        title,
        description: value(body.description) || null,
        category,
        priority: value(body.priority).toUpperCase() || "MEDIUM",
        status: value(body.assigneeEmployeeId) ? "ACCEPTED" : "OPEN",
        owner: value(body.owner) || null,
        assigneeEmployeeId: value(body.assigneeEmployeeId) || null,
        requiredRoleCode: value(body.requiredRoleCode) || null,
        assignedBy: actor,
        sourceType: value(body.sourceType) || "MANUAL",
        sourceId: value(body.sourceId) || null,
        platform: value(body.platform) || null,
        productId: value(body.productId) || null,
        expectedResult: value(body.expectedResult) || null,
        dueAt: date(body.dueAt),
        taskTemplateId: value(body.taskTemplateId) || null,
        collaborators: Array.isArray(body.collaborators) ? body.collaborators : [],
        evidence: (body.evidence && typeof body.evidence === "object" ? body.evidence : {}) as object,
      },
      include: this.taskInclude(),
    });
    await this.prisma.operationTaskHistory.create({
      data: {
        taskId: created.id,
        toStatus: created.status,
        action: "CREATE",
        actor,
      },
    });
    if (created.assigneeEmployeeId) {
      await this.notify(created.id, created.assigneeEmployeeId, "ASSIGNED", "收到新任务", created.title);
    }
    return created;
  }

  async assignTask(id: string, body: Record<string, unknown>, actor: string) {
    const employeeId = value(body.employeeId);
    if (!employeeId) throw new BadRequestException("请选择执行员工");
    const [task, employee] = await Promise.all([
      this.prisma.opsTask.findUnique({ where: { id } }),
      this.prisma.employee.findUnique({ where: { id: employeeId } }),
    ]);
    if (!task) throw new NotFoundException("任务不存在");
    if (!employee || employee.status !== "ACTIVE") throw new BadRequestException("执行员工不可用");
    const updated = await this.prisma.opsTask.update({
      where: { id },
      data: {
        assigneeEmployeeId: employeeId,
        owner: employee.name,
        assignedBy: actor,
        status: ["OPEN", "RETURNED"].includes(task.status) ? "ACCEPTED" : task.status,
        acceptedAt: new Date(),
        dueAt: date(body.dueAt) || task.dueAt,
      },
      include: this.taskInclude(),
    });
    await this.prisma.operationTaskHistory.create({
      data: {
        taskId: id,
        fromStatus: task.status,
        toStatus: updated.status,
        action: "ASSIGN",
        actor,
        note: `分配给 ${employee.name}`,
      },
    });
    await this.notify(id, employeeId, "ASSIGNED", "收到新任务", task.title);
    return updated;
  }

  async reviewTask(id: string, body: Record<string, unknown>, actor: string) {
    const action = value(body.action).toUpperCase();
    if (!["APPROVE", "RETURN"].includes(action)) throw new BadRequestException("审核动作不正确");
    const task = await this.prisma.opsTask.findUnique({
      where: { id },
      include: { submissions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!task || task.status !== "REVIEW") throw new BadRequestException("任务当前不在待审核状态");
    const note = value(body.note);
    if (action === "RETURN" && !note) throw new BadRequestException("退回时必须填写修改要求");
    const status = action === "APPROVE" ? "COMPLETED" : "RETURNED";
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.opsTask.update({
        where: { id },
        data: {
          status,
          reviewedAt: new Date(),
          reviewedBy: actor,
          reviewNote: note || null,
          returnedAt: action === "RETURN" ? new Date() : null,
          returnReason: action === "RETURN" ? note : null,
          completedAt: action === "APPROVE" ? new Date() : null,
          completedBy: action === "APPROVE" ? task.owner : null,
        },
      });
      await tx.taskReview.create({
        data: {
          taskId: id,
          submissionId: task.submissions[0]?.id,
          action,
          reviewer: actor,
          note: note || null,
        },
      });
      await tx.operationTaskHistory.create({
        data: {
          taskId: id,
          fromStatus: "REVIEW",
          toStatus: status,
          action,
          actor,
          note: note || null,
        },
      });
      if (task.assigneeEmployeeId) {
        await tx.taskNotification.create({
          data: {
            taskId: id,
            recipientEmployeeId: task.assigneeEmployeeId,
            type: action === "APPROVE" ? "APPROVED" : "RETURNED",
            title: action === "APPROVE" ? "任务审核通过" : "任务被退回",
            content: note || task.title,
          },
        });
      }
      return updated;
    });
  }

  async saveRole(body: Record<string, unknown>) {
    const code = value(body.code).toUpperCase();
    const name = value(body.name);
    if (!code || !name) throw new BadRequestException("角色编码和名称不能为空");
    return this.prisma.role.upsert({
      where: { code },
      update: {
        name,
        portal: value(body.portal).toUpperCase() || "WORKBENCH",
        permissions: Array.isArray(body.permissions) ? body.permissions.map(value).filter(Boolean) : [],
        dataScope: value(body.dataScope).toUpperCase() || "SELF",
        active: body.active !== false,
      },
      create: {
        code,
        name,
        portal: value(body.portal).toUpperCase() || "WORKBENCH",
        permissions: Array.isArray(body.permissions) ? body.permissions.map(value).filter(Boolean) : [],
        dataScope: value(body.dataScope).toUpperCase() || "SELF",
        active: body.active !== false,
      },
    });
  }

  async setEmployeeRoles(employeeId: string, roleCodes: string[]) {
    const roles = await this.prisma.role.findMany({
      where: { code: { in: roleCodes.map((item) => item.toUpperCase()) }, portal: "WORKBENCH", active: true },
    });
    return this.prisma.$transaction(async (tx) => {
      await tx.employeeRole.deleteMany({ where: { employeeId } });
      if (roles.length) {
        await tx.employeeRole.createMany({
          data: roles.map((role) => ({ employeeId, roleId: role.id })),
          skipDuplicates: true,
        });
      }
      return tx.employee.findUnique({
        where: { id: employeeId },
        include: { roles: { include: { role: true } } },
      });
    });
  }

  private taskAccess(session: SessionPayload) {
    const roleFilters = session.roles.length ? [{ requiredRoleCode: { in: session.roles } }] : [];
    return {
      OR: [
        { assigneeEmployeeId: session.employeeId },
        { owner: session.name },
        {
          AND: [
            { assigneeEmployeeId: null },
            { status: "OPEN" },
            { OR: [...roleFilters, { requiredRoleCode: null }] },
          ],
        },
      ],
    };
  }

  private async ownedTask(session: SessionPayload, id: string, statuses: string[]) {
    const task = await this.prisma.opsTask.findFirst({
      where: { id, assigneeEmployeeId: session.employeeId, status: { in: statuses } },
    });
    if (!task) throw new BadRequestException("任务当前不可执行");
    return task;
  }

  private async transition(
    task: Awaited<ReturnType<WorkbenchService["ownedTask"]>>,
    toStatus: string,
    action: string,
    actor: string,
    data: Record<string, unknown>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.opsTask.update({ where: { id: task.id }, data });
      await tx.opsTask.update({ where: { id: task.id }, data: { status: toStatus } });
      await tx.operationTaskHistory.create({
        data: { taskId: task.id, fromStatus: task.status, toStatus, action, actor },
      });
      return { ...updated, status: toStatus };
    });
  }

  private async notify(taskId: string, employeeId: string, type: string, title: string, content: string) {
    await this.prisma.taskNotification.create({
      data: { taskId, recipientEmployeeId: employeeId, type, title, content },
    });
  }

  private taskInclude(full = false) {
    return {
      assignee: { select: { id: true, name: true, role: true, department: { select: { name: true } } } },
      template: true,
      attachments: { orderBy: { createdAt: "desc" as const } },
      submissions: full
        ? { include: { employee: { select: { id: true, name: true } } }, orderBy: { version: "desc" as const } }
        : { orderBy: { version: "desc" as const }, take: 1 },
      reviews: full ? { orderBy: { createdAt: "desc" as const } } : false,
      history: full ? { orderBy: { createdAt: "desc" as const } } : false,
    };
  }

  private quickActions(roles: string[]) {
    const actions = [{ key: "TASKS", label: "处理任务", path: "/tasks" }];
    if (roles.some((role) => ["VIDEO_SPECIALIST", "DESIGNER", "ASSET_CURATOR", "CONTENT_OPERATOR"].includes(role))) {
      actions.push({ key: "UPLOAD_ASSET", label: "上传素材", path: "/assets" });
    }
    if (roles.some((role) => ["ASSET_CURATOR", "CUSTOMER_SERVICE", "CONTENT_OPERATOR"].includes(role))) {
      actions.push({ key: "ADD_KNOWLEDGE", label: "补充知识", path: "/knowledge" });
    }
    if (roles.includes("LIVE_HOST")) {
      actions.push({ key: "LIVE_GUIDE", label: "直播学习与复盘", path: "/live" });
    }
    actions.push({ key: "MALL", label: "进入商城员工端", path: "/mall" });
    return actions;
  }

  private sameDay(left: Date, right: Date) {
    return left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate();
  }
}
