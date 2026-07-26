import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthService } from "./auth.service";
import { BrandDataService } from "./brand-data.service";
import { PrismaService } from "./prisma.service";
import { WorkbenchService } from "./workbench.service";

type UploadFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@Controller("api/v1/workbench")
export class WorkbenchController {
  constructor(
    private readonly auth: AuthService,
    private readonly workbench: WorkbenchService,
    private readonly brandData: BrandDataService,
    private readonly prisma: PrismaService,
  ) {}

  private employee(authorization?: string) {
    return this.auth.requireEmployee(authorization);
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return this.auth.identity(authorization);
  }

  @Get("dashboard")
  dashboard(@Headers("authorization") authorization?: string) {
    return this.workbench.dashboard(this.employee(authorization));
  }

  @Get("tasks")
  tasks(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.workbench.tasks(this.employee(authorization), query);
  }

  @Get("tasks/:id")
  task(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    return this.workbench.task(this.employee(authorization), id);
  }

  @Post("tasks/:id/accept")
  accept(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    return this.workbench.accept(this.employee(authorization), id);
  }

  @Post("tasks/:id/start")
  start(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    return this.workbench.start(this.employee(authorization), id);
  }

  @Post("tasks/:id/submit")
  submit(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.submit(this.employee(authorization), id, body);
  }

  @Get("notifications")
  notifications(@Headers("authorization") authorization?: string) {
    return this.workbench.notifications(this.employee(authorization));
  }

  @Post("notifications/:id/read")
  readNotification(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    return this.workbench.readNotification(this.employee(authorization), id);
  }

  @Post("assets/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 500 * 1024 * 1024 } }))
  uploadAsset(
    @Headers("authorization") authorization: string | undefined,
    @UploadedFile() file: UploadFile | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.employee(authorization);
    return this.brandData.uploadAsset(file, { ...body, employeeId: employee.employeeId }, employee.name);
  }

  @Post("knowledge")
  createKnowledge(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.employee(authorization);
    return this.brandData.createKnowledge({ ...body, publishMode: "PENDING", owner: employee.name }, employee.name);
  }

  @Get("knowledge")
  knowledge(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    this.employee(authorization);
    return this.brandData.knowledge({ ...query, status: "READY" });
  }

  @Get("live/learning")
  async liveLearning(@Headers("authorization") authorization?: string) {
    const employee = this.employee(authorization);
    if (!employee.roles.includes("LIVE_HOST")) return { roleEnabled: false, courses: [], reviews: [] };
    const [knowledge, tasks] = await Promise.all([
      this.prisma.knowledgeEntry.findMany({
        where: {
          status: "READY",
          OR: [
            { category: { contains: "直播", mode: "insensitive" } },
            { title: { contains: "直播", mode: "insensitive" } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 30,
      }),
      this.prisma.opsTask.findMany({
        where: {
          assigneeEmployeeId: employee.employeeId,
          category: { in: ["LIVE", "LIVE_REVIEW", "LIVE_LEARNING"] },
        },
        include: { submissions: { orderBy: { version: "desc" }, take: 1 } },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);
    return { roleEnabled: true, courses: knowledge, reviews: tasks };
  }
}

@Controller("api/v1/admin")
export class AdminV2Controller {
  constructor(
    private readonly auth: AuthService,
    private readonly workbench: WorkbenchService,
  ) {}

  private actor(authorization?: string) {
    return this.auth.requireAdmin(authorization);
  }

  @Get("workspace")
  workspace(@Headers("authorization") authorization?: string) {
    this.auth.requirePermission(authorization, "SYSTEM_VIEW");
    return this.workbench.adminOverview();
  }

  @Get("tasks")
  tasks(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    this.auth.requirePermission(authorization, "TASK_MANAGE");
    return this.workbench.adminTasks(query);
  }

  @Post("tasks")
  createTask(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    this.auth.requirePermission(authorization, "TASK_MANAGE");
    return this.workbench.createTask(body, this.actor(authorization));
  }

  @Patch("tasks/:id/assign")
  assignTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.auth.requirePermission(authorization, "TASK_MANAGE");
    return this.workbench.assignTask(id, body, this.actor(authorization));
  }

  @Post("tasks/:id/review")
  reviewTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.auth.requirePermission(authorization, "TASK_REVIEW");
    return this.workbench.reviewTask(id, body, this.actor(authorization));
  }

  @Post("roles")
  saveRole(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    this.auth.requirePermission(authorization, "ROLE_MANAGE");
    return this.workbench.saveRole(body);
  }

  @Patch("employees/:id/roles")
  setEmployeeRoles(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.auth.requirePermission(authorization, "ROLE_MANAGE");
    return this.workbench.setEmployeeRoles(
      id,
      Array.isArray(body.roleCodes) ? body.roleCodes.map((item) => String(item)) : [],
    );
  }
}
