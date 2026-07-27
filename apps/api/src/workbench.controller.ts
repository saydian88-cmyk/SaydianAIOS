import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import { diskStorage } from "multer";
import { AuthService } from "./auth.service";
import { BrandDataService } from "./brand-data.service";
import { PrismaService } from "./prisma.service";
import { SmartKeywordService } from "./smart-keyword.service";
import { VideoFactoryService } from "./video-factory.service";
import { ViralTrendService } from "./viral-trend.service";
import { WorkbenchService } from "./workbench.service";

type UploadFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

type DiskFile = {
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
};

const workbenchUploadInbox = resolve(process.cwd(), "data", "upload-inbox");
mkdirSync(workbenchUploadInbox, { recursive: true });

const workbenchBatchUploadStorage = diskStorage({
  destination: workbenchUploadInbox,
  filename: (_request, file, callback) => callback(null, `${Date.now()}-${randomUUID()}${extname(file.originalname).toLowerCase()}`),
});

@Controller("api/v1/workbench")
export class WorkbenchController {
  constructor(
    private readonly auth: AuthService,
    private readonly workbench: WorkbenchService,
    private readonly brandData: BrandDataService,
    private readonly prisma: PrismaService,
    private readonly smartKeywords: SmartKeywordService,
    private readonly viralTrend: ViralTrendService,
    private readonly videoFactory: VideoFactoryService,
  ) {}

  private employee(authorization?: string) {
    return this.auth.requireEmployee(authorization);
  }

  private requirePermission(authorization: string | undefined, permission: string) {
    const employee = this.employee(authorization);
    if (!employee.permissions.includes("*") && !employee.permissions.includes(permission)) {
      throw new ForbiddenException("当前岗位没有此数据中心权限");
    }
    return employee;
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

  @Post("upload-batches")
  createUploadBatch(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "ASSET_UPLOAD");
    return this.brandData.createUploadBatch({ ...body, employeeId: employee.employeeId }, employee.name);
  }

  @Post("upload-batches/assist")
  assistUploadBatch(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    this.requirePermission(authorization, "ASSET_UPLOAD");
    return this.brandData.suggestUploadMetadata(body);
  }

  @Post("upload-batches/:id/files")
  @UseInterceptors(FilesInterceptor("files", 20, {
    storage: workbenchBatchUploadStorage,
    limits: { fileSize: 200 * 1024 * 1024, files: 20 },
  }))
  uploadBatchFiles(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @UploadedFiles() files: DiskFile[],
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "ASSET_UPLOAD");
    return this.brandData.uploadBatchFiles(id, files, employee.name, body);
  }

  @Get("assets/:id")
  asset(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    this.requirePermission(authorization, "DATA_CENTER_VIEW");
    return this.brandData.asset(id);
  }

  @Get("assets/:id/download-url")
  assetDownloadUrl(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    this.requirePermission(authorization, "DATA_CENTER_VIEW");
    return this.brandData.assetDownloadUrl(id);
  }

  @Patch("assets/:id/metadata")
  updateAssetMetadata(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "DATA_CENTER_VIEW");
    return this.brandData.updateAsset(id, {
      displayName: body.displayName,
      contentDescription: body.contentDescription,
      productScope: body.productScope,
      productIds: body.productIds,
      scene: body.scene,
      tags: body.tags,
    }, employee.name);
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

  @Get("data-center")
  async dataCenter(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    const employee = this.requirePermission(authorization, "DATA_CENTER_VIEW");
    const canCurateAssets = employee.permissions.includes("*") || employee.permissions.includes("ASSET_CURATE");
    const [assets, knowledge, pendingAssets, assetTotal, knowledgeTotal, keywords, viralKeywords, viralTrend, videoProjects, products, productionPlans] = await Promise.all([
      this.brandData.rankedAssets({
        query: query.query,
        model: query.model,
        kind: query.kind,
        moduleType: query.moduleType,
        minimumScore: query.minimumScore || "0",
        limit: query.limit || "100",
      }),
      this.brandData.knowledge({
        query: query.query,
        model: query.model,
        type: query.type,
        status: "READY",
      }),
      canCurateAssets
        ? this.brandData.assets({ reviewScope: "PENDING", pageSize: "12" })
        : Promise.resolve({ items: [], total: 0 }),
      this.prisma.asset.count({
        where: {
          reviewStatus: "APPROVED",
          availabilityStatus: "ACTIVE",
          rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
        },
      }),
      this.prisma.knowledgeEntry.count({ where: { status: "READY" } }),
      this.smartKeywords.list({
        search: query.query,
        platform: query.platform,
        take: query.keywordLimit || "200",
      }).catch(() => ({
        total: 0,
        items: [],
        summary: [],
        limits: { dailyCollectionPerPlatform: 50, pinnedPerPlatform: 50 },
      })),
      this.viralTrend.todayKeywords(query.platform || "DOUYIN").catch(() => ({ keywords: [] })),
      this.viralTrend.trends({ take: query.viralLimit || "60" }).catch(() => ({
        items: [],
        summary: { total: 0 },
      })),
      this.videoFactory.projects({
        platform: query.platform,
        productModel: query.model,
      }).catch(() => []),
      this.prisma.product.findMany({
        where: { status: { not: "ARCHIVED" } },
        select: { id: true, modelCode: true, name: true, category: true },
        orderBy: [{ category: "asc" }, { modelCode: "asc" }],
        take: 500,
      }),
      this.prisma.contentPlan.findMany({
        where: { kind: "VIDEO", productionStage: "AWAITING_ASSETS" },
        select: { id: true, productionNo: true, topic: true, shootRequirements: true },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
    ]);
    const pending = Array.isArray(pendingAssets) ? pendingAssets : pendingAssets.items;
    return {
      permissions: employee.permissions,
      summary: {
        assets: assetTotal,
        assetResults: assets.length,
        priorityAssets: assets.filter((item) => ["S", "A"].includes(String(item.grade))).length,
        knowledge: knowledgeTotal,
        pending: Array.isArray(pending) ? pending.length : 0,
        keywords: keywords.total,
        viralVideos: viralTrend.summary?.total || 0,
        videoProjects: videoProjects.length,
      },
      assets,
      knowledge,
      pendingAssets: pending,
      keywords,
      viralKeywords,
      viralTrend,
      videoProjects,
      uploadOptions: { products, productionPlans },
    };
  }

  @Post("data-center/video-projects")
  createVideoProject(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "DATA_CENTER_VIEW");
    return this.videoFactory.createProject({
      platform: String(body.platform || "DOUYIN"),
      productModel: body.productModel ? String(body.productModel) : undefined,
      topic: body.topic ? String(body.topic) : undefined,
      audience: body.audience ? String(body.audience) : undefined,
      objective: body.objective ? String(body.objective) : undefined,
      keywordIds: Array.isArray(body.keywordIds) ? body.keywordIds.map(String) : [],
      externalVideoIds: Array.isArray(body.externalVideoIds) ? body.externalVideoIds.map(String) : [],
      routingMode: "AUTO",
      allowFallback: true,
    }, employee.name);
  }

  @Post("data-center/video-projects/:id/generate")
  generateVideoProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "DATA_CENTER_VIEW");
    return this.videoFactory.generateProject(id, {
      candidateIndex: Number(body.candidateIndex || 0),
      routingMode: "AUTO",
      allowFallback: true,
    }, employee.name);
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
