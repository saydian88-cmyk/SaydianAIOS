import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import { createReadStream, mkdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import { diskStorage } from "multer";
import { AuthService } from "./auth.service";
import { AiTaskCenterService } from "./ai-task-center.service";
import { BrandDataService } from "./brand-data.service";
import { ContentService } from "./content.service";
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

function compileVideoScriptTaskPrompt(project: Record<string, any>, brief: Record<string, unknown>) {
  const value = (key: string, fallback = "未填写") => String(brief[key] ?? fallback).trim() || fallback;
  const platform = String(project.targetPlatforms?.[0] || brief.platform || "DOUYIN");
  const healthPolicy = brief.healthContentAllowed !== false
    ? "允许健康相关内容；仍须读取系统风险词与风险画面库进行合规检查"
    : "禁止健康相关内容；必须读取系统风险词与风险画面库，并过滤相关文案、字幕、配音和画面";

  return [
    "【任务类型】单视频项目完整脚本生成（只生成一套脚本，不生成三个方向，不生成成片）",
    "",
    "【项目基础信息】",
    `项目编号：${project.productionNo || project.id}`,
    `产品型号：${project.productModel || "未填写"}`,
    `视频类型：${value("videoType")}`,
    `发布平台：${platform}`,
    `账号类型：${value("accountType", "BRAND")}`,
    `预计时长：${value("estimatedDurationSeconds", "30")}秒`,
    `口播模式：${value("voiceoverMode", "VOICEOVER")}`,
    `健康内容规则：${healthPolicy}`,
    `素材策略：${value("materialPolicy", "REAL_ASSET_FIRST")}`,
    "",
    "【内容需求】",
    `核心关键词：${value("keywords", project.topic || "未填写")}`,
    `模仿参考：${value("reference")}`,
    `指定钩子：${value("hook")}`,
    `使用场景：${value("scene")}`,
    `目标用户：${value("audience", project.audience || "未填写")}`,
    `用户痛点：${value("painPoint")}`,
    `传播目标：${project.objective || "未填写"}`,
    `声音要求：${value("soundPrompt")}`,
    `必须展示的事实或动作：${value("mustShowFacts")}`,
    `补充AI提示词：${value("additionalPrompt")}`,
    "",
    "【必须执行】",
    "使用 video-editing-from-media-library-share Skill 的素材学习、索引与路径规则。",
    "读取素材库索引、包装资源索引、系统风险词库和风险画面库；不得仅凭文件名推断素材内容。",
    "具体功能口播必须绑定能够直接证明该功能的操作、过程或结果视频；外观、包装、佩戴空镜和静态图片不能替代。",
    "已有素材需返回素材ID、远程可访问路径、有效入点/出点、画面事实和匹配分。",
    "缺失素材逐项标明真人补拍或AI生成方案，并保留脚本行ID，供系统后续回传补充素材路径。",
    "",
    "【完整脚本输出结构】",
    "1. 基础任务信息：产品型号、视频类型、发布平台、账号类型、目标受众、预计时长、健康内容规则。",
    "2. 内容定位：核心主题、传播目标、用户痛点、唯一核心卖点。",
    "3. 黄金三秒钩子：文案、类型、对应画面、留人理由、开头声音设计。",
    "4. 完整口播：逐句文案、语气、语速、情绪、预计时长。",
    "5. 脚本结构：钩子、承接、卖点展开、证据展示、转折或留人节点、结尾。",
    "6. 逐句镜头需求与素材覆盖状态：已有素材覆盖、可以改写、需要补拍、禁止制作。",
    "7. 每个镜头的画面事实、音画匹配要求和留人设计。",
    "8. 无标点字幕稿、自然语义断句、重点文字。",
    "9. 配音人群、音色、情绪、语速、音效、环境声。",
    "10. 合规检查、结尾安全尾帧、素材缺口清单及明确补充方法。",
    "",
    "返回结构化结果时，每句必须具有稳定 lineId，素材绑定必须能被系统直接保存和再次提供给远程剪辑节点。",
  ].join("\n");
}

@Controller("api/v1/workbench")
export class WorkbenchController {
  constructor(
    private readonly auth: AuthService,
    private readonly workbench: WorkbenchService,
    private readonly aiTasks: AiTaskCenterService,
    private readonly brandData: BrandDataService,
    private readonly content: ContentService,
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

  @Get("outputs")
  outputs(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    this.employee(authorization);
    return this.workbench.outputs(query);
  }

  @Get("outputs/:outputId/url")
  outputUrl(
    @Headers("authorization") authorization: string | undefined,
    @Param("outputId") outputId: string,
  ) {
    this.employee(authorization);
    return this.workbench.outputUrl(outputId);
  }

  @Get("tasks")
  tasks(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.workbench.tasks(this.employee(authorization), query);
  }

  @Get("task-creation/options")
  async contentTaskOptions(@Headers("authorization") authorization?: string) {
    this.employee(authorization);
    const [options, viralKeywords] = await Promise.all([
      this.workbench.contentTaskOptions(),
      this.viralTrend.todayKeywords("DOUYIN").catch(() => ({ keywords: [] })),
    ]);
    return { ...options, viralKeywords: viralKeywords.keywords || [] };
  }

  @Post("task-creation/suggest")
  contentTaskSuggestion(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    this.employee(authorization);
    return this.workbench.contentTaskSuggestion(body);
  }

  @Post("task-creation/submit-ai")
  async submitAiContentTask(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.employee(authorization);
    const contentType = String(body.contentType || "").toUpperCase();
    if (!String(body.productId || "").trim()) {
      throw new BadRequestException("请选择产品");
    }
    if (!String(body.keywordId || "").trim()) {
      throw new BadRequestException("请选择智能关键词");
    }
    const type = contentType === "IMAGE" ? "IMAGE" : contentType === "ARTICLE" ? "ARTICLE" : "VIDEO";
    const category = type === "IMAGE" ? "CONTENT_IMAGE" : type === "ARTICLE" ? "CONTENT_ARTICLE" : "CONTENT_VIDEO";
    const opsTask = await this.workbench.createSelfTask(employee, {
      ...body,
      recurrenceWeekdays: [],
      category,
      sourceType: "SELF_CREATED",
      evidence: {
        ...(body.evidence && typeof body.evidence === "object" ? body.evidence as object : {}),
        contentType,
        keywordId: body.keywordId || null,
        targetAudience: body.targetAudience || null,
        corePain: body.corePain || null,
        recommendedScene: body.recommendedScene || null,
        hook: body.hook || null,
        materialStrategy: body.materialStrategy || null,
        executionMode: body.executionMode || null,
      },
    }) as Record<string, any>;
    const aiTask = await this.aiTasks.createTask({
      type,
      title: opsTask.title,
      instructions: [opsTask.description, opsTask.expectedResult].filter(Boolean).join("\n\n"),
      platform: opsTask.platform,
      productId: opsTask.productId,
      ownerEmployeeId: employee.employeeId,
      reviewerEmployeeId: body.reviewerId || null,
      sourceType: "WORKBENCH_CONTENT_REQUEST",
      sourceId: opsTask.id,
      idempotencyKey: `workbench-content:${opsTask.id}`,
      estimatedCost: 0,
      executionPolicy: "MANUAL",
      input: {
        opsTaskId: opsTask.id,
        keywordId: body.keywordId || null,
        contentType,
        targetAudience: body.targetAudience || null,
        corePain: body.corePain || null,
        keyword: body.keyword || null,
        recommendedScene: body.recommendedScene || null,
        hook: body.hook || null,
        materialStrategy: body.materialStrategy || "REAL_ASSET_FIRST",
        executionMode: type === "VIDEO" ? String(body.executionMode || "FULL_VIDEO") : undefined,
      },
      modelPolicy: {
        strategy: "CODEX_FIRST",
        allowExternalGeneration: false,
      },
    }, employee.name);
    await this.workbench.linkAiRequest(employee, opsTask.id, aiTask);
    return { task: opsTask, aiTask };
  }

  @Get("tasks/:id")
  task(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    return this.workbench.task(this.employee(authorization), id);
  }

  @Post("tasks/:id/ai-feedback")
  async requestAiRevision(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.employee(authorization);
    const request = await this.workbench.requestAiRevision(employee, id, String(body.note || ""));
    return this.aiTasks.requestRevision(request.aiTaskId, request.note, employee.name);
  }

  @Get("tasks/:id/outputs/:outputId/url")
  taskOutputUrl(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Param("outputId") outputId: string,
  ) {
    return this.workbench.taskOutputUrl(this.employee(authorization), id, outputId);
  }

  @Post("tasks")
  createSelfTask(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.createSelfTask(this.employee(authorization), body);
  }

  @Patch("tasks/:id")
  async updateOwnedTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.employee(authorization);
    const updated = await this.workbench.updateOwnedTask(employee, id, body) as Record<string, any>;
    const evidence = updated.evidence && typeof updated.evidence === "object" ? updated.evidence as Record<string, unknown> : {};
    const aiTaskId = String(evidence.aiTaskId || "");
    if (aiTaskId && ["CONTENT_VIDEO", "CONTENT_IMAGE", "CONTENT_ARTICLE"].includes(String(updated.category))) {
      await this.aiTasks.updateTask(aiTaskId, {
        title: updated.title,
        instructions: [updated.description, updated.expectedResult].filter(Boolean).join("\n\n"),
        platform: updated.platform,
        productId: updated.productId,
        input: {
          keywordId: evidence.keywordId || null,
          targetAudience: evidence.targetAudience || null,
          corePain: evidence.corePain || null,
          recommendedScene: evidence.recommendedScene || null,
          hook: evidence.hook || null,
          executionMode: evidence.executionMode || null,
          materialStrategy: evidence.materialStrategy || null,
        },
      }, employee.name);
    }
    return this.workbench.task(employee, id);
  }

  @Post("tasks/:id/cancel")
  async cancelOwnedTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.employee(authorization);
    const updated = await this.workbench.cancelOwnedTask(employee, id) as Record<string, any>;
    const evidence = updated.evidence && typeof updated.evidence === "object" ? updated.evidence as Record<string, unknown> : {};
    if (evidence.aiTaskId) await this.aiTasks.cancel(String(evidence.aiTaskId), employee.name);
    return updated;
  }

  @Post("tasks/:id/trash")
  trashCancelledTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    return this.workbench.trashCancelledTask(this.employee(authorization), id);
  }

  @Get("task-recycle-bin")
  taskRecycleBin(@Headers("authorization") authorization: string | undefined) {
    return this.workbench.taskRecycleBin(this.employee(authorization));
  }

  @Post("tasks/:id/restore")
  restoreTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    return this.workbench.restoreTask(this.employee(authorization), id);
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

  @Get("operation-team")
  operationTeam(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.workbench.operationTeam(this.employee(authorization), query);
  }

  @Post("operation-team/invitations")
  inviteOperator(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.inviteOperator(this.employee(authorization), body);
  }

  @Post("operation-team/invitations/:id/respond")
  respondOperatorInvite(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.respondOperatorInvite(this.employee(authorization), id, body);
  }

  @Post("operation-team/invitations/:id/cancel")
  cancelOperatorInvite(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    return this.workbench.cancelOperatorInvite(this.employee(authorization), id);
  }

  @Post("operation-team/direct-reports/:employeeId/remove")
  removeDirectReport(
    @Headers("authorization") authorization: string | undefined,
    @Param("employeeId") employeeId: string,
  ) {
    return this.workbench.removeDirectReport(this.employee(authorization), employeeId);
  }

  @Get("operation-team/tasks")
  teamTasks(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.workbench.teamTasks(this.employee(authorization), query);
  }

  @Post("operation-team/tasks")
  createTeamTask(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.createTeamTask(this.employee(authorization), body);
  }

  @Post("operation-team/tasks/:id/review")
  reviewTeamTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.reviewTeamTask(this.employee(authorization), id, body);
  }

  @Post("operation-team/tasks/:id/urgency")
  setTeamTaskUrgency(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.setTeamTaskUrgency(this.employee(authorization), id, body.urgent === true);
  }

  @Patch("operation-team/tasks/:id")
  updateTeamTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.updateOwnedTask(this.employee(authorization), id, body);
  }

  @Post("operation-team/tasks/:id/cancel")
  cancelTeamTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    return this.workbench.cancelOwnedTask(this.employee(authorization), id);
  }

  @Get("notifications")
  notifications(@Headers("authorization") authorization?: string) {
    return this.workbench.notifications(this.employee(authorization));
  }

  @Post("notifications/:id/read")
  readNotification(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    return this.workbench.readNotification(this.employee(authorization), id);
  }

  @Post("notifications/read-all")
  readAllNotifications(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.readAllNotifications(this.employee(authorization), body.ids);
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
    const employee = this.requirePermission(authorization, "ASSET_CURATE");
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
    const section = String(query.section || "knowledge");
    const keyword = String(query.query || "").trim();
    const model = String(query.model || "").trim();
    const knowledgeType = String(query.type || "").toUpperCase();
    const summaryPromise = Promise.all([
      this.prisma.asset.count({
        where: {
          reviewStatus: "APPROVED",
          availabilityStatus: "ACTIVE",
          rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
        },
      }),
      this.prisma.knowledgeEntry.count({ where: { status: "READY" } }),
      this.prisma.smartKeyword.count(),
      this.prisma.externalVideo.count(),
      this.prisma.contentPlan.count({
        where: {
          kind: "VIDEO",
          createdBy: employee.name,
          sourceSignals: { array_contains: [{ type: "VIDEO_FACTORY" }] },
          productionStage: { notIn: ["VIDEO_FACTORY_ARCHIVED", "VIDEO_FACTORY_PURGED"] },
        },
      }),
      canCurateAssets ? this.prisma.asset.count({ where: { reviewStatus: "PENDING", deletedAt: null } }) : Promise.resolve(0),
    ]);
    const sectionPromise = section === "assets"
      ? this.brandData.rankedAssets({
        query: query.query,
        model: query.model,
        kind: query.kind,
        purpose: query.purpose,
        packagingCategory: query.packagingCategory,
        moduleType: query.moduleType,
        minimumScore: query.minimumScore || "0",
        page: query.page || "1",
        pageSize: query.pageSize || "30",
      })
      : section === "knowledge"
        ? knowledgeType === "PRODUCT"
          ? this.prisma.product.findMany({
            where: {
              status: "READY",
              ...(model ? { modelCode: { contains: model, mode: "insensitive" as const } } : {}),
              ...(keyword ? {
                OR: [
                  { name: { contains: keyword, mode: "insensitive" as const } },
                  { modelCode: { contains: keyword, mode: "insensitive" as const } },
                  { category: { contains: keyword, mode: "insensitive" as const } },
                ],
              } : {}),
            },
            select: { id: true, modelCode: true, name: true, category: true, updatedAt: true },
            orderBy: [{ category: "asc" as const }, { modelCode: "asc" as const }],
            take: 500,
          }).then((items) => items.map((item) => ({
            id: item.id,
            type: "产品",
            title: `${item.modelCode} · ${item.name}`,
            category: item.category,
            model: item.modelCode,
            summary: "已审核产品资料",
            updatedAt: item.updatedAt,
          })))
          : knowledgeType === "QUALIFICATION"
            ? this.prisma.evidenceClaim.findMany({
              where: {
                status: "READY",
                ...(keyword ? {
                  OR: [
                    { name: { contains: keyword, mode: "insensitive" as const } },
                    { confirmedFact: { contains: keyword, mode: "insensitive" as const } },
                    { publicWording: { contains: keyword, mode: "insensitive" as const } },
                  ],
                } : {}),
              },
              orderBy: { updatedAt: "desc" as const },
              take: 500,
            }).then((items) => items.map((item) => ({
              id: item.id,
              type: "资质",
              title: item.name,
              category: item.evidenceType,
              model: item.coveredObject || "品牌通用",
              summary: item.confirmedFact || item.publicWording || "已审核资质证据",
              updatedAt: item.updatedAt,
            })))
            : knowledgeType === "KNOWLEDGE_GROUP"
              ? this.prisma.knowledgeEntry.findMany({
                where: {
                  status: "READY",
                  type: { in: ["BRAND", "PARAMETER", "KNOWLEDGE", "WORDING", "FORBIDDEN", "AFTER_SALE", "TUTORIAL"] },
                  ...(model ? { model: { contains: model, mode: "insensitive" as const } } : {}),
                  ...(keyword ? {
                    OR: [
                      { title: { contains: keyword, mode: "insensitive" as const } },
                      { summary: { contains: keyword, mode: "insensitive" as const } },
                      { body: { contains: keyword, mode: "insensitive" as const } },
                    ],
                  } : {}),
                },
                orderBy: { updatedAt: "desc" as const },
                take: 500,
              })
              : this.brandData.knowledge({
                query: query.query,
                model: query.model,
                type: knowledgeType === "FAQ" ? "FAQ" : undefined,
                status: "READY",
              })
        : section === "keywords"
          ? this.smartKeywords.list({
            search: query.query,
            platform: query.platform,
            take: query.keywordLimit || "200",
          }).catch(() => ({ total: 0, items: [], summary: [], limits: { dailyCollectionPerPlatform: 50, pinnedPerPlatform: 50 } }))
          : section === "viral"
            ? Promise.all([
              this.viralTrend.todayKeywords(query.platform || "DOUYIN").catch(() => ({ keywords: [] })),
              this.viralTrend.trends({ take: query.viralLimit || "60" }).catch(() => ({ items: [], summary: { total: 0 } })),
            ])
            : Promise.all([
              this.videoFactory.projects({
                status: query.status,
                platform: query.platform,
                productModel: query.model,
                createdBy: employee.name,
                page: Number(query.page || 1),
                pageSize: Number(query.pageSize || 12),
              }).catch(() => ({ items: [], total: 0, page: 1, pageSize: 12 })),
              this.prisma.contentPlan.findMany({
                where: {
                  kind: "VIDEO",
                  createdBy: employee.name,
                  ...(query.model ? { productModel: { contains: query.model, mode: "insensitive" } } : {}),
                },
                select: {
                  id: true,
                  productionNo: true,
                  topic: true,
                  productModel: true,
                  status: true,
                  productionStage: true,
                  sourceSignals: true,
                  createdAt: true,
                },
                orderBy: { createdAt: "desc" },
                take: 30,
              }),
            ]);
    const optionsPromise = query.includeOptions === "1"
      ? Promise.all([
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
      ])
      : Promise.resolve(undefined);
    const [[assetTotal, knowledgeTotal, keywordTotal, viralTotal, videoProjectTotal, pendingTotal], sectionData, options] = await Promise.all([
      summaryPromise,
      sectionPromise,
      optionsPromise,
    ]);
    const assetPage = section === "assets"
      ? sectionData as { items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }
      : { items: [], total: 0, page: 1, pageSize: 30 };
    const assets = assetPage.items || [];
    const knowledge = section === "knowledge" ? sectionData as Array<Record<string, unknown>> : [];
    const keywords = section === "keywords" ? sectionData : undefined;
    const viralData = section === "viral" ? sectionData as [Record<string, unknown>, Record<string, unknown>] : undefined;
    const videoData = section === "videoFactory"
      ? sectionData as [{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }, Array<Record<string, unknown>>]
      : undefined;
    const videoProjectPage = videoData?.[0] || { items: [], total: 0, page: 1, pageSize: 12 };
    const videoProjects = videoProjectPage.items || [];
    const videoScripts = videoData?.[1] || [];
    return {
      permissions: employee.permissions,
      summary: {
        assets: assetTotal,
        assetResults: assetPage.total,
        priorityAssets: assets.filter((item) => ["S", "A"].includes(String(item.grade))).length,
        knowledge: knowledgeTotal,
        pending: pendingTotal,
        keywords: keywordTotal,
        viralVideos: viralTotal,
        videoProjects: videoProjectTotal,
      },
      ...(section === "assets" ? { assets, pagination: assetPage } : {}),
      ...(section === "knowledge" ? { knowledge } : {}),
      ...(section === "keywords" ? { keywords } : {}),
      ...(section === "viral" ? { viralKeywords: viralData?.[0], viralTrend: viralData?.[1] } : {}),
      ...(section === "videoFactory" ? { videoProjects, pagination: videoProjectPage, videoScripts } : {}),
      ...(options ? { products: options[0], uploadOptions: { products: options[0], productionPlans: options[1] } } : {}),
    };
  }

  @Post("data-center/video-projects")
  async createVideoProject(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以创建视频项目");
    }
    const project = await this.videoFactory.createProject({
      platform: String(body.platform || "DOUYIN"),
      voiceoverMode: String(body.voiceoverMode || "VOICEOVER"),
      accountType: String(body.accountType || "BRAND"),
      estimatedDurationSeconds: Number(body.estimatedDurationSeconds || 30),
      contentRestrictionMode: String(body.contentRestrictionMode || "NORMAL"),
      generationMode: String(body.generationMode || "NORMAL"),
      scriptSource: String(body.scriptSource || "AI"),
      userProvidedDirections: Array.isArray(body.userProvidedDirections)
        ? body.userProvidedDirections.map((item, index) => {
          const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
          return { index: Number(row.index ?? index), title: String(row.title || ""), content: String(row.content || "") };
        })
        : [],
      productModel: body.productModel ? String(body.productModel) : undefined,
      topic: body.topic ? String(body.topic) : undefined,
      audience: body.audience ? String(body.audience) : undefined,
      objective: body.objective ? String(body.objective) : undefined,
      keywordIds: Array.isArray(body.keywordIds) ? body.keywordIds.map(String) : [],
      externalVideoIds: Array.isArray(body.externalVideoIds) ? body.externalVideoIds.map(String) : [],
      routingMode: "AUTO",
      allowFallback: true,
      deferScriptGeneration: true,
      healthContentAllowed: body.healthContentAllowed !== false,
      soundPrompt: body.soundPrompt ? String(body.soundPrompt) : undefined,
      mustShowFacts: body.mustShowFacts ? String(body.mustShowFacts) : undefined,
      additionalPrompt: body.additionalPrompt ? String(body.additionalPrompt) : undefined,
      videoType: body.videoType ? String(body.videoType) : undefined,
      keywords: body.keywords ? String(body.keywords) : undefined,
      reference: body.reference ? String(body.reference) : undefined,
      hook: body.hook ? String(body.hook) : undefined,
      scene: body.scene ? String(body.scene) : undefined,
      painPoint: body.painPoint ? String(body.painPoint) : undefined,
      scriptEngines: Array.isArray(body.scriptEngines) ? body.scriptEngines.map(String) : undefined,
    }, employee.name) as Record<string, any>;
    const scriptSubmission = await this.submitVideoScriptTask(authorization, String(project.id));
    const submittedProject = scriptSubmission.project as Record<string, any>;
    const task = await this.workbench.ensureVideoProjectTask({
      employeeId: employee.employeeId!,
      name: employee.name,
    }, {
      id: String(submittedProject.id),
      productionNo: submittedProject.productionNo ? String(submittedProject.productionNo) : null,
      topic: submittedProject.topic ? String(submittedProject.topic) : null,
      productionStage: submittedProject.productionStage ? String(submittedProject.productionStage) : null,
    });
    return {
      ...submittedProject,
      linkedTask: task,
      scriptTask: scriptSubmission.task,
      scriptEngines: scriptSubmission.scriptEngines,
    };
  }

  @Post("data-center/video-projects/:id/script-task")
  async submitVideoScriptTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以提交脚本生成任务");
    }
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) throw new ForbiddenException("只能提交自己创建的视频项目");
    if (!["PROJECT_BRIEF", "SCRIPT_RETURNED"].includes(String(project.productionStage))) {
      throw new ForbiddenException("当前项目状态不能提交脚本生成任务");
    }
    const factory = Array.isArray(project.sourceSignals)
      ? project.sourceSignals.find((item: Record<string, unknown>) => item?.type === "VIDEO_FACTORY") || {}
      : {};
    const brief = factory.brief && typeof factory.brief === "object" ? factory.brief : {};
    const scriptEngines = Array.isArray((brief as Record<string, unknown>).scriptEngines)
      ? ((brief as Record<string, unknown>).scriptEngines as unknown[]).map(String)
      : ["REMOTE_CODEX", "SYSTEM_AI"];
    const compiledPrompt = compileVideoScriptTaskPrompt(project, brief as Record<string, unknown>);
    let task: Record<string, any> | null = null;
    if (scriptEngines.includes("REMOTE_CODEX")) task = await this.aiTasks.createTask({
      type: "VIDEO",
      title: `${project.topic} · 单脚本生成`,
      platform: project.targetPlatforms?.[0] || "DOUYIN",
      productModel: project.productModel,
      ownerEmployeeId: employee.employeeId,
      reviewerEmployeeId: employee.employeeId,
      sourceType: "VIDEO_FACTORY_PROJECT",
      sourceId: project.id,
      idempotencyKey: `ai-task:video-project:${project.id}:script:v${project.workflowVersion}`,
      instructions: compiledPrompt,
      input: {
        executionMode: "SCRIPT_ONLY",
        existingContentPlanId: project.id,
        singleScript: true,
        skillName: "video-editing-from-media-library-share",
        compiledPrompt,
        projectBrief: brief,
        healthContentAllowed: brief.healthContentAllowed !== false,
        requiredOutputs: [
          "complete_script",
          "line_material_coverage",
          "material_paths",
          "source_time_ranges",
          "visible_facts",
          "semantic_scores",
          "shot_plan",
          "material_gap_list",
          "compliance_report",
        ],
      },
      modelPolicy: { strategy: "CODEX_FIRST", allowExternalGeneration: false, allowFallback: false },
      estimatedCost: 0,
      skipPaidBudget: true,
    }, employee.name) as Record<string, any>;
    if (task) await this.videoFactory.attachRemoteTask(id, task.id, "SCRIPT_ONLY", employee.name);
    if (scriptEngines.includes("SYSTEM_AI")) {
      await this.videoFactory.generateSystemScriptCandidate(id, employee.name);
    }
    return { project: await this.videoFactory.project(id), task, scriptEngines };
  }

  @Post("data-center/video-projects/:id/brief")
  async updateVideoProjectBrief(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以修改视频项目要求");
    }
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) throw new ForbiddenException("只能修改自己创建的视频项目");
    return this.videoFactory.updateDraftBrief(id, {
      platform: body.platform ? String(body.platform) : undefined,
      voiceoverMode: body.voiceoverMode ? String(body.voiceoverMode) : undefined,
      accountType: body.accountType ? String(body.accountType) : undefined,
      estimatedDurationSeconds: Number(body.estimatedDurationSeconds || 30),
      healthContentAllowed: body.healthContentAllowed !== false,
      generationMode: body.generationMode ? String(body.generationMode) : undefined,
      productModel: body.productModel ? String(body.productModel) : undefined,
      topic: body.topic ? String(body.topic) : undefined,
      audience: body.audience ? String(body.audience) : undefined,
      objective: body.objective ? String(body.objective) : undefined,
      soundPrompt: body.soundPrompt ? String(body.soundPrompt) : undefined,
      mustShowFacts: body.mustShowFacts ? String(body.mustShowFacts) : undefined,
      additionalPrompt: body.additionalPrompt ? String(body.additionalPrompt) : undefined,
      videoType: body.videoType ? String(body.videoType) : undefined,
      keywords: body.keywords ? String(body.keywords) : undefined,
      reference: body.reference ? String(body.reference) : undefined,
      hook: body.hook ? String(body.hook) : undefined,
      scene: body.scene ? String(body.scene) : undefined,
      painPoint: body.painPoint ? String(body.painPoint) : undefined,
      scriptEngines: Array.isArray(body.scriptEngines) ? body.scriptEngines.map(String) : undefined,
    }, employee.name);
  }

  @Post("data-center/video-projects/:id/script-review")
  async reviewVideoScript(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以审核视频脚本");
    }
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) throw new ForbiddenException("只能审核自己创建的视频项目");
    const action = String(body.action || "").trim().toUpperCase();
    const note = String(body.note || "").trim();
    if (!["APPROVE", "RETURN"].includes(action)) throw new ForbiddenException("审核动作不正确");
    if (action === "RETURN" && !note) throw new ForbiddenException("退回脚本时必须填写修改原因");
    const factory = Array.isArray(project.sourceSignals)
      ? project.sourceSignals.find((item: Record<string, unknown>) => item?.type === "VIDEO_FACTORY") || {}
      : {};
    if (factory.aiTaskId) {
      await this.aiTasks.review(String(factory.aiTaskId), { action, note }, employee.name);
    }
    const candidateIndex = body.candidateIndex === undefined ? undefined : Number(body.candidateIndex);
    const reviewed = await this.videoFactory.reviewScript(
      id,
      action === "APPROVE",
      note,
      employee.name,
      Number.isFinite(candidateIndex) ? candidateIndex : undefined,
    );
    if (action === "RETURN") {
      const scriptSubmission = await this.submitVideoScriptTask(authorization, id);
      return { ...scriptSubmission.project, scriptTask: scriptSubmission.task };
    }
    const approvedProject = reviewed as Record<string, any>;
    if (employee.employeeId && Array.isArray(approvedProject.videoShots)
      && approvedProject.videoShots.some((shot: Record<string, unknown>) => !shot.selectedAssetId)) {
      await this.videoFactory.createGroupedReshootTask(id, employee.employeeId, employee.name);
    }
    return reviewed;
  }

  @Post("data-center/video-projects/:id/script")
  async updateVideoProjectScript(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以修改视频脚本");
    }
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) throw new ForbiddenException("只能修改自己创建的视频项目");
    if (String(project.productionStage) !== "FACTORY_SCRIPT_READY") {
      throw new ForbiddenException("只有待审核脚本可以直接修改");
    }
    return this.videoFactory.updateDraftScript(id, {
      title: String(body.title || ""),
      hook: String(body.hook || ""),
      script: String(body.script || ""),
      coreTheme: String(body.coreTheme || ""),
      communicationGoal: String(body.communicationGoal || ""),
      userPainPoint: String(body.userPainPoint || ""),
      uniqueSellingPoint: String(body.uniqueSellingPoint || ""),
      voiceoverLines: Array.isArray(body.voiceoverLines) ? body.voiceoverLines.map(String) : [],
      retentionDesign: Array.isArray(body.retentionDesign) ? body.retentionDesign.map(String) : [],
      subtitles: Array.isArray(body.subtitles) ? body.subtitles.map(String) : [],
      emphasisTexts: Array.isArray(body.emphasisTexts) ? body.emphasisTexts.map(String) : [],
      endingSummary: String(body.endingSummary || ""),
      endingInteraction: String(body.endingInteraction || ""),
      endingVisual: String(body.endingVisual || ""),
    }, employee.name);
  }

  @Post("data-center/video-projects/:id/video-task")
  async submitRemoteVideoTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以提交视频生成任务");
    }
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) throw new ForbiddenException("只能提交自己创建的视频项目");
    if (!["SCRIPT_APPROVED", "READY_TO_EDIT", "EDITING"].includes(String(project.productionStage))) {
      throw new ForbiddenException("脚本尚未审核通过");
    }
    const missingShots = (project.videoShots || []).filter((shot: Record<string, unknown>) => !shot.selectedAssetId);
    if (missingShots.length) throw new ForbiddenException(`仍有${missingShots.length}个镜头缺少已确认素材`);
    const materialBindings = (project.videoShots || []).map((shot: Record<string, any>) => ({
      lineId: shot.requirementKey,
      sequence: shot.sequence,
      scriptLine: shot.voiceover || shot.subtitle || shot.description,
      assetId: shot.selectedAssetId,
      path: shot.selectedAsset?.sourcePath || shot.selectedAsset?.storageUrl,
      sourceIn: shot.metadata?.sourceIn,
      sourceOut: shot.metadata?.sourceOut,
      usage: "PRIMARY_SHOT",
      visibleFacts: shot.metadata?.visibleFacts || [],
      restrictions: shot.metadata?.restrictions || [],
      userApproved: true,
    }));
    const factory = Array.isArray(project.sourceSignals)
      ? project.sourceSignals.find((item: Record<string, unknown>) => item?.type === "VIDEO_FACTORY") || {}
      : {};
    const task = await this.aiTasks.createTask({
      type: "VIDEO",
      title: `${project.topic} · 远程剪辑成片`,
      platform: project.targetPlatforms?.[0] || "DOUYIN",
      productModel: project.productModel,
      ownerEmployeeId: employee.employeeId,
      reviewerEmployeeId: employee.employeeId,
      sourceType: "VIDEO_FACTORY_PROJECT",
      sourceId: project.id,
      idempotencyKey: `ai-task:video-project:${project.id}:full-video:v${project.workflowVersion}`,
      instructions: "使用已审核单脚本和系统提供的素材—脚本绑定执行剪辑。补拍或AI生成素材必须按指定lineId和路径使用，不得重新错配。",
      input: {
        executionMode: "FULL_VIDEO",
        existingContentPlanId: project.id,
        skillName: "video-editing-from-media-library-share",
        approvedScriptOnly: true,
        projectBrief: factory.brief || {},
        materialBindings,
        coverTitleTiming: "AFTER_VIDEO_APPROVAL",
      },
      modelPolicy: { strategy: "CODEX_FIRST", allowExternalGeneration: false, allowFallback: false },
      estimatedCost: 0,
      skipPaidBudget: true,
    }, employee.name) as Record<string, any>;
    await this.videoFactory.attachRemoteTask(id, task.id, "FULL_VIDEO", employee.name);
    return { project: await this.videoFactory.project(id), task };
  }

  @Post("data-center/video-projects/:id/reshoot-task")
  async createVideoProjectReshootTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以生成补拍任务");
    }
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) throw new ForbiddenException("只能处理自己创建的视频项目");
    if (!employee.employeeId) throw new ForbiddenException("当前账号未关联员工档案");
    return this.videoFactory.createGroupedReshootTask(id, employee.employeeId, employee.name);
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

  @Post("data-center/video-shots/:id/generate")
  generateVideoShot(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以生成视频镜头");
    }
    return this.videoFactory.enqueueShot(id, {
      duration: Number(body.duration || 5),
      routingMode: "AUTO",
      allowFallback: true,
    }, employee.name);
  }

  @Post("data-center/video-projects/:id/render")
  renderVideoProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以发起视频剪辑");
    }
    return this.videoFactory.enqueueRender(id, employee.name);
  }

  @Post("data-center/video-projects/:id/archive")
  archiveVideoProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以删除视频项目");
    }
    return this.videoFactory.archiveProject(id, employee.name);
  }

  @Get("data-center/video-projects-recycle-bin")
  videoProjectRecycleBin(
    @Headers("authorization") authorization: string | undefined,
  ) {
    const employee = this.requirePermission(authorization, "DATA_CENTER_VIEW");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以查看视频项目回收站");
    }
    return this.videoFactory.recycledProjects(employee.name);
  }

  @Post("data-center/video-projects/:id/restore")
  restoreVideoProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以恢复视频项目");
    }
    return this.videoFactory.restoreProject(id, employee.name);
  }

  @Post("data-center/video-projects/:id/review")
  async reviewVideoProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以审核成片");
    }
    const action = String(body.action || "").trim().toUpperCase();
    const note = String(body.note || "").trim();
    const outputAssetId = String(body.outputAssetId || "").trim();
    if (!["APPROVE", "RETURN"].includes(action)) throw new ForbiddenException("审核动作不正确");
    if (action === "RETURN" && !note) throw new ForbiddenException("退回时必须填写具体修改说明");
    const render = outputAssetId
      ? await this.prisma.videoRenderJob.findFirst({
        where: { contentPlanId: id, outputAssetId, status: "SUCCEEDED" },
        include: { outputAsset: true },
      })
      : null;
    if (!render?.outputAsset) throw new ForbiddenException("成片与当前视频项目不匹配");
    if (render.outputAsset.reviewStatus !== "PENDING") {
      throw new ForbiddenException("该成片已经完成审核，不能重复提交");
    }
    return this.videoFactory.reviewOutput(outputAssetId, action === "APPROVE", employee.name, note);
  }

  @Post("data-center/video-projects/:id/similar")
  createSimilarVideoProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以生成类似视频");
    }
    return this.videoFactory.createSimilarProject(id, {
      outputAssetId: String(body.outputAssetId || "").trim(),
      replaceHook: Boolean(body.replaceHook),
      hook: body.hook ? String(body.hook) : undefined,
      replaceProduct: Boolean(body.replaceProduct),
      productModel: body.productModel ? String(body.productModel) : undefined,
      replaceFeature: Boolean(body.replaceFeature),
      feature: body.feature ? String(body.feature) : undefined,
    }, employee.name);
  }

  @Post("data-center/video-projects/:id/packaging")
  async generateVideoPackaging(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以确认成片并生成封面标题");
    }
    const outputAssetId = String(body.outputAssetId || "").trim();
    const render = outputAssetId
      ? await this.prisma.videoRenderJob.findFirst({
        where: { contentPlanId: id, outputAssetId },
        include: { outputAsset: true },
      })
      : null;
    if (!render?.outputAsset) throw new ForbiddenException("成片与当前视频项目不匹配");
    if (render.outputAsset.reviewStatus !== "APPROVED") {
      await this.videoFactory.reviewOutput(outputAssetId, true, employee.name, "成片预览确认满意并生成平台包装");
    }
    return this.content.generatePackaging(id, employee.name);
  }

  @Post("data-center/video-projects/:id/packaging/:variantId/review")
  async reviewVideoPackaging(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Param("variantId") variantId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以审核封面和标题");
    }
    const approved = Boolean(body.approved);
    const note = String(body.note || "").trim();
    if (!approved && !note) throw new ForbiddenException("退回封面和标题时必须填写具体修改说明");
    const variant = await this.prisma.contentVariant.findFirst({
      where: { id: variantId, contentPlanId: id },
      select: { id: true, packagingStatus: true },
    });
    if (!variant) throw new ForbiddenException("平台包装与当前视频项目不匹配");
    if (!["PENDING_REVIEW", "RETURNED"].includes(variant.packagingStatus)) {
      throw new ForbiddenException("该平台包装当前不能重复审核");
    }
    return this.content.reviewPackaging(variantId, approved, employee.name, { note });
  }

  @Post("data-center/video-projects/:id/manual-publish")
  async recordWorkbenchManualPublish(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以回传发布链接");
    }
    const outputAssetId = String(body.outputAssetId || "").trim();
    const allowedPlatforms = ["DOUYIN", "TIKTOK", "XIAOHONGSHU", "BILIBILI", "WECHAT_CHANNELS", "KUAISHOU"];
    const records = Array.isArray(body.records) ? body.records as Array<Record<string, unknown>> : [];
    if (!records.length) throw new ForbiddenException("请至少填写一个平台的发布链接");
    const normalized = records.map((record) => ({
      platform: String(record.platform || "").trim().toUpperCase(),
      remoteUrl: String(record.remoteUrl || "").trim(),
      publishedAt: record.publishedAt ? String(record.publishedAt) : undefined,
    }));
    if (normalized.some((record) => !allowedPlatforms.includes(record.platform))) {
      throw new ForbiddenException("发布平台不在支持范围内");
    }
    if (new Set(normalized.map((record) => record.platform)).size !== normalized.length) {
      throw new ForbiddenException("同一平台请只填写一条发布记录");
    }
    if (normalized.some((record) => !/^https?:\/\/\S+$/i.test(record.remoteUrl))) {
      throw new ForbiddenException("请填写以 http:// 或 https:// 开头的完整作品链接");
    }
    const [render, plan] = await Promise.all([
      this.prisma.videoRenderJob.findFirst({
        where: { contentPlanId: id, outputAssetId, status: "SUCCEEDED" },
        include: { outputAsset: true },
      }),
      this.prisma.contentPlan.findUnique({ where: { id }, include: { variants: true } }),
    ]);
    if (!render?.outputAsset || render.outputAsset.reviewStatus !== "APPROVED") {
      throw new ForbiddenException("只有审核通过的成片可以回传发布链接");
    }
    if (!plan) throw new ForbiddenException("视频项目不存在");
    const platformNames: Record<string, string> = {
      DOUYIN: "抖音", TIKTOK: "TikTok", XIAOHONGSHU: "小红书",
      BILIBILI: "B站", WECHAT_CHANNELS: "视频号", KUAISHOU: "快手",
    };
    const results = [];
    for (const record of normalized) {
      const integration = await this.prisma.integration.upsert({
        where: { kind: record.platform as never },
        create: {
          kind: record.platform as never,
          displayName: platformNames[record.platform] || record.platform,
          capabilities: ["manual_publish"],
          message: "已支持手动回传发布链接；自动发布与数据采集需单独配置",
        },
        update: {},
      });
      const variant = await this.prisma.contentVariant.upsert({
        where: { contentPlanId_platform: { contentPlanId: id, platform: record.platform as never } },
        create: {
          contentPlanId: id,
          platform: record.platform as never,
          title: plan.topic,
          body: plan.hook,
          mediaType: "VIDEO",
          packagingStatus: "APPROVED",
          packagingReviewedBy: employee.name,
          packagingReviewedAt: new Date(),
          status: "APPROVED",
        },
        update: {
          packagingStatus: "APPROVED",
          packagingReviewedBy: employee.name,
          packagingReviewedAt: new Date(),
        },
      });
      void integration;
      results.push(await this.content.recordManualPublish(variant.id, employee.name, {
        remoteUrl: record.remoteUrl,
        publishedAt: record.publishedAt,
      }));
    }
    await this.prisma.contentPlan.update({
      where: { id },
      data: {
        targetPlatforms: Array.from(new Set([...plan.targetPlatforms, ...normalized.map((record) => record.platform)])) as never,
      },
    });
    await this.prisma.opsTask.updateMany({
      where: {
        sourceType: "VIDEO_PROJECT",
        sourceId: id,
        deletedAt: null,
        status: { notIn: ["CANCELLED", "COMPLETED"] },
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        completedBy: employee.name,
        result: `已回传${results.length}个平台的发布链接，视频项目进入数据跟踪`,
      },
    });
    return { saved: results.length, platforms: normalized.map((record) => record.platform) };
  }

  @Get("data-center/video-projects/:id/packaging/:variantId/cover")
  async videoPackagingCover(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Param("variantId") variantId: string,
  ) {
    this.requirePermission(authorization, "DATA_CENTER_VIEW");
    const file = await this.content.packagingCoverFile(id, variantId);
    return new StreamableFile(createReadStream(file.path), {
      type: "image/jpeg",
      disposition: `inline; filename="${file.fileName}"`,
    });
  }

  @Post("data-center/video-scripts/generate")
  generateVideoScript(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以生成视频脚本");
    }
    const generationMode = String(body.generationMode || "ASSET_FIRST").toUpperCase();
    if (!["ASSET_FIRST", "ASSET_ONLY"].includes(generationMode)) {
      throw new ForbiddenException("脚本生成模式不正确");
    }
    const productModel = String(body.productModel || "").trim();
    if (generationMode === "ASSET_ONLY" && !productModel) {
      throw new ForbiddenException("无需补拍模式必须选择产品型号");
    }
    return this.content.generateDailyVideo(new Date(), employee.name, productModel || undefined, {
      assetOnly: generationMode === "ASSET_ONLY",
      restricted: String(body.contentRestrictionMode || "NORMAL") === "HEALTH_RESTRICTED",
      platform: body.platform === "TIKTOK" ? "TIKTOK" : "DOUYIN",
      keywordIds: Array.isArray(body.keywordIds) ? body.keywordIds.map(String) : [],
      topic: String(body.topic || "").trim(),
      audience: String(body.audience || "").trim(),
      objective: String(body.objective || "").trim(),
      voiceoverMode: String(body.voiceoverMode || "VOICEOVER"),
      force: true,
    });
  }

  @Post("data-center/asset-gaps/analyze")
  analyzeAssetGaps(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "ASSET_VIEW");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以分析缺失素材");
    }
    return this.brandData.analyzeProductAssetGaps(String(body.productModel || ""), employee.name);
  }

  @Post("data-center/asset-gaps/tasks")
  createAssetGapTasks(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以生成补拍任务");
    }
    return this.brandData.createSelectedGapTasks(
      Array.isArray(body.ids) ? body.ids.map(String) : [],
      employee.name,
    );
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
