import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Res, StreamableFile } from "@nestjs/common";
import { createReadStream } from "node:fs";
import { PrismaService } from "./prisma.service";
import { AuthService } from "./auth.service";
import { AutomationService, jobKinds, type AutomationKind } from "./automation.service";
import { ContentService } from "./content.service";
import { LedgerService } from "./ledger.service";
import { MonitoringService } from "./monitoring.service";
import { OperationsService } from "./operations.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, service: "saidian-ops-center", database: "connected", time: new Date().toISOString() };
    } catch (error) {
      return { ok: false, service: "saidian-ops-center", database: "unavailable", message: error instanceof Error ? error.message : "数据库不可用", time: new Date().toISOString() };
    }
  }
}

@Controller("api/v1")
export class OpsController {
  constructor(
    private readonly auth: AuthService,
    private readonly operations: OperationsService,
    private readonly automation: AutomationService,
    private readonly contentService: ContentService,
    private readonly monitoring: MonitoringService,
    private readonly ledger: LedgerService,
  ) {}

  private actor(authorization?: string, requestedActor?: string) {
    return this.auth.requireAdmin(authorization, requestedActor);
  }

  @Get("auth/status")
  status(@Headers("authorization") authorization?: string) {
    return { ok: true, actor: this.actor(authorization) };
  }

  @Get("auth/me")
  me(@Headers("authorization") authorization?: string) {
    return this.auth.identity(authorization);
  }

  @Post("admin-auth/login")
  adminLogin(@Body() body: Record<string, unknown>) {
    return this.auth.loginAdmin(String(body.username || ""), String(body.password || ""));
  }

  @Get("admin-auth/me")
  adminMe(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.auth.identity(authorization);
  }

  @Get("auth/wecom/authorize-url")
  wecomAuthorizeUrl(@Query("redirectUri") redirectUri: string) {
    return this.auth.wecomAuthorizeUrl(String(redirectUri || ""));
  }

  @Get("auth/wecom/qr-authorize-url")
  wecomQrAuthorizeUrl(@Query("redirectUri") redirectUri: string) {
    return this.auth.wecomQrAuthorizeUrl(String(redirectUri || ""));
  }

  @Post("auth/wecom/login")
  wecomLogin(@Body() body: Record<string, unknown>) {
    return this.auth.loginWithWecomCode(String(body.code || ""));
  }

  @Post("auth/wecom/session")
  wecomSession(@Body() body: Record<string, unknown>) {
    return this.auth.loginWithMallSession(String(body.mallToken || ""));
  }

  @Get("dashboard") dashboard(@Headers("authorization") authorization?: string) {
    this.actor(authorization); return this.operations.dashboard();
  }
  @Get("integrations") integrations(@Headers("authorization") authorization?: string) {
    this.actor(authorization); return this.operations.integrations();
  }
  @Get("ledger") ledgerOverview(@Headers("authorization") authorization?: string) {
    this.actor(authorization); return this.ledger.overview();
  }
  @Post("ledger/departments") createDepartment(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    return this.ledger.createDepartment(body, this.actor(authorization, requestedActor));
  }
  @Post("ledger/employees") createEmployee(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    return this.ledger.createEmployee(body, this.actor(authorization, requestedActor));
  }
  @Post("ledger/products") createProduct(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    return this.ledger.createProduct(body, this.actor(authorization, requestedActor));
  }
  @Post("ledger/accounts") createAccount(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    return this.ledger.createAccount(body, this.actor(authorization, requestedActor));
  }
  @Post("ledger/stores") createStore(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    return this.ledger.createStore(body, this.actor(authorization, requestedActor));
  }
  @Patch("ledger/employees/:id") updateEmployee(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.ledger.updateEmployee(id, body, this.actor(authorization, requestedActor));
  }
  @Delete("ledger/employees/:id") archiveEmployee(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string) {
    return this.ledger.archiveEmployee(id, this.actor(authorization, requestedActor));
  }
  @Patch("ledger/products/:id") updateLedgerProduct(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.ledger.updateProduct(id, body, this.actor(authorization, requestedActor));
  }
  @Delete("ledger/products/:id") archiveLedgerProduct(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string) {
    return this.ledger.archiveProduct(id, this.actor(authorization, requestedActor));
  }
  @Patch("ledger/accounts/:id") updateAccount(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.ledger.updateAccount(id, body, this.actor(authorization, requestedActor));
  }
  @Delete("ledger/accounts/:id") archiveAccount(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string) {
    return this.ledger.archiveAccount(id, this.actor(authorization, requestedActor));
  }
  @Patch("ledger/stores/:id") updateStore(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.ledger.updateStore(id, body, this.actor(authorization, requestedActor));
  }
  @Delete("ledger/stores/:id") archiveStore(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string) {
    return this.ledger.archiveStore(id, this.actor(authorization, requestedActor));
  }
  @Post("ledger/import-snapshots") importSnapshots(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    return this.ledger.importSnapshots(body, this.actor(authorization, requestedActor));
  }
  @Post("ledger/attributions") createAttribution(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    return this.ledger.createAttribution(body, this.actor(authorization, requestedActor));
  }
  @Post("ledger/import-assets") importAssetManifest(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    return this.ledger.importAssetManifest(body, this.actor(authorization, requestedActor));
  }
  @Post("integrations/check") async checkIntegrations(@Headers("authorization") authorization?: string, @Headers("x-ops-actor") requestedActor?: string) {
    this.actor(authorization, requestedActor); return this.monitoring.checkIntegrations();
  }
  @Get("assets") assets(@Headers("authorization") authorization: string | undefined, @Query() query: Record<string, string>) {
    this.actor(authorization); return this.operations.assets({ status: query.status, model: query.model, mediaType: query.mediaType, take: Number(query.take) || undefined });
  }
  @Get("evidence") evidence(@Headers("authorization") authorization?: string) {
    this.actor(authorization); return this.operations.evidence();
  }
  @Get("content") content(@Headers("authorization") authorization?: string, @Query("status") status?: string) {
    this.actor(authorization); return this.contentService.list(status as never);
  }
  @Post("content/generate") generateContent(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    const actor = this.actor(authorization, requestedActor);
    return this.contentService.generateDaily(new Date(), actor, { restricted: body.contentRestrictionMode === "HEALTH_RESTRICTED" });
  }
  @Post("content/daily-video/generate") generateDailyVideo(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    const actor = this.actor(authorization, requestedActor);
    const requestedDate = body.date ? new Date(`${String(body.date)}T00:00:00+08:00`) : new Date();
    if (Number.isNaN(requestedDate.getTime())) throw new BadRequestException("日期格式必须为 YYYY-MM-DD");
    return this.contentService.generateDailyVideo(
      requestedDate,
      actor,
      body.productModel ? String(body.productModel) : undefined,
      {
        platform: body.platform === "TIKTOK" ? "TIKTOK" : "DOUYIN",
        keywordIds: Array.isArray(body.keywordIds) ? body.keywordIds.map(String) : [],
        force: Boolean(body.force),
      },
    );
  }
  @Post("content/asset-only-video/generate") generateAssetOnlyVideo(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    const actor = this.actor(authorization, requestedActor);
    return this.contentService.generateDailyVideo(new Date(), actor, body.productModel ? String(body.productModel) : undefined, {
      assetOnly: true,
      restricted: body.contentRestrictionMode === "HEALTH_RESTRICTED",
      platform: body.platform === "TIKTOK" ? "TIKTOK" : "DOUYIN",
      keywordIds: Array.isArray(body.keywordIds) ? body.keywordIds.map(String) : [],
    });
  }
  @Post("content/daily-article/generate") generateDailyArticle(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    const actor = this.actor(authorization, requestedActor);
    const requestedDate = body.date ? new Date(`${String(body.date)}T00:00:00+08:00`) : new Date();
    if (Number.isNaN(requestedDate.getTime())) throw new BadRequestException("日期格式必须为 YYYY-MM-DD");
    return this.contentService.generateDailyArticle(requestedDate, actor, body.productModel ? String(body.productModel) : undefined);
  }
  @Get("content/daily-brief") dailyBrief(@Headers("authorization") authorization: string | undefined, @Query("date") date?: string) {
    this.actor(authorization);
    const requestedDate = date ? new Date(`${date}T00:00:00+08:00`) : new Date();
    return this.contentService.dailyBrief(requestedDate);
  }
  @Post("content/:id/approve") approveContent(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.contentService.approve(id, this.actor(authorization, requestedActor), body.note ? String(body.note) : undefined, {
      owner: body.owner ? String(body.owner) : undefined,
      targetPlatforms: Array.isArray(body.targetPlatforms) ? body.targetPlatforms.map(String) as never : undefined,
    });
  }
  @Post("content/:id/reject") rejectContent(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.contentService.reject(id, this.actor(authorization, requestedActor), String(body.reason ?? ""));
  }
  @Patch("content/variants/:id/target-account") assignVariantAccount(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const accountId = String(body.platformAccountId ?? "").trim();
    if (!accountId) throw new BadRequestException("请选择发布账号");
    return this.contentService.assignVariantAccount(id, accountId, this.actor(authorization, requestedActor));
  }
  @Get("content/:id/workflow") contentWorkflow(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    this.actor(authorization); return this.contentService.workflow(id);
  }
  @Patch("content/:id/shoot-requirements") updateShootRequirements(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.contentService.updateShootRequirements(id, Array.isArray(body.requirements) ? body.requirements : [], this.actor(authorization, requestedActor));
  }
  @Post("content/:id/asset-coverage") refreshContentAssetCoverage(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string) {
    return this.contentService.refreshAssetCoverage(id, this.actor(authorization, requestedActor));
  }
  @Post("content/:id/shoot-requirements/:requirementId/replace") replaceShotAsset(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Param("requirementId") requirementId: string) {
    return this.contentService.replaceShotAsset(id, requirementId, this.actor(authorization, requestedActor));
  }
  @Post("content/:id/shoot-requirements/:requirementId/ai-generate") generateShotAsset(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Param("requirementId") requirementId: string, @Body() body: Record<string, unknown>) {
    return this.contentService.startAiShotGeneration(id, requirementId, {
      prompt: body.prompt ? String(body.prompt) : undefined,
      duration: Number(body.duration || 5),
      requestedModelId: body.requestedModelId ? String(body.requestedModelId) : undefined,
      routingMode: body.routingMode ? String(body.routingMode) : undefined,
      allowFallback: body.allowFallback === undefined ? undefined : Boolean(body.allowFallback),
    }, this.actor(authorization, requestedActor));
  }
  @Get("content/:id/shoot-requirements/:requirementId/ai-generation") getGeneratedShotAsset(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Param("requirementId") requirementId: string) {
    return this.contentService.getAiShotGeneration(id, requirementId, this.actor(authorization, requestedActor));
  }
  @Post("content/:id/edit") startContentEditing(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string) {
    return this.contentService.startEditing(id, this.actor(authorization, requestedActor));
  }
  @Post("content/:id/video-review") reviewMasterVideo(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.contentService.reviewMasterVideo(id, Boolean(body.approved), this.actor(authorization, requestedActor), String(body.note ?? ""));
  }
  @Post("content/:id/platform-packaging") generatePlatformPackaging(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string) {
    return this.contentService.generatePackaging(id, this.actor(authorization, requestedActor));
  }
  @Post("content/variants/:id/packaging-review") reviewPlatformPackaging(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.contentService.reviewPackaging(id, Boolean(body.approved), this.actor(authorization, requestedActor), { note: String(body.note ?? ""), coverPath: body.coverPath ? String(body.coverPath) : undefined });
  }
  @Post("content/variants/:id/manual-publish") recordManualPublish(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.contentService.recordManualPublish(id, this.actor(authorization, requestedActor), { remoteUrl: body.remoteUrl ? String(body.remoteUrl) : undefined, remoteId: body.remoteId ? String(body.remoteId) : undefined, publishedAt: body.publishedAt ? String(body.publishedAt) : undefined });
  }
  @Get("content/variants/:id/delivery") deliveryManifest(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    this.actor(authorization); return this.contentService.deliveryManifest(id);
  }
  @Get("content/variants/:id/delivery/:type") async deliveryFile(@Headers("authorization") authorization: string | undefined, @Param("id") id: string, @Param("type") type: string, @Res({ passthrough: true }) response: { setHeader: (name: string, value: string) => void }) {
    this.actor(authorization);
    if (type !== "video" && type !== "cover") throw new BadRequestException("仅支持下载成片或封面");
    const file = await this.contentService.deliveryFile(id, type);
    response.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    return new StreamableFile(createReadStream(file.path));
  }
  @Post("content/:id/optimizations/:checkpointHours") generateContentOptimization(@Headers("authorization") authorization: string | undefined, @Param("id") id: string, @Param("checkpointHours") checkpointHours: string) {
    this.actor(authorization);
    const checkpoint = Number(checkpointHours);
    if (checkpoint !== 168 && checkpoint !== 720) throw new BadRequestException("仅支持7日或30日复盘");
    return this.contentService.generateOptimization(id, checkpoint);
  }
  @Post("content/optimizations/:id/decision") decideContentOptimization(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.contentService.decideOptimization(id, Boolean(body.confirmed), this.actor(authorization, requestedActor), String(body.note ?? ""));
  }
  @Post("content/queue-publish") queuePublish(@Headers("authorization") authorization?: string) {
    this.actor(authorization); return this.contentService.queueApproved();
  }
  @Get("comments") comments(@Headers("authorization") authorization?: string) {
    this.actor(authorization); return this.operations.comments();
  }
  @Post("comments/replies/:id/approve") approveReply(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string) {
    return this.monitoring.approveReply(id, this.actor(authorization, requestedActor));
  }
  @Get("live") live(@Headers("authorization") authorization?: string) {
    this.actor(authorization); return this.operations.live();
  }
  @Get("shop") shop(@Headers("authorization") authorization?: string) {
    this.actor(authorization); return this.operations.shop();
  }
  @Get("competitors") competitors(@Headers("authorization") authorization?: string) {
    this.actor(authorization); return this.operations.competitors();
  }
  @Get("trends") trends(@Headers("authorization") authorization?: string) {
    this.actor(authorization); return this.operations.trends();
  }
  @Get("alerts") alerts(@Headers("authorization") authorization?: string) {
    this.actor(authorization); return this.operations.alerts();
  }
  @Post("alerts/:id/resolve") resolveAlert(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string) {
    return this.operations.resolveAlert(id, this.actor(authorization, requestedActor));
  }
  @Get("tasks") tasks(@Headers("authorization") authorization?: string) {
    this.actor(authorization); return this.operations.tasks();
  }
  @Post("tasks") createTask(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    if (!String(body.title ?? "").trim()) throw new BadRequestException("任务标题不能为空");
    return this.operations.createTask(body, this.actor(authorization, requestedActor));
  }
  @Patch("tasks/:id") updateTask(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.operations.updateTask(id, body, this.actor(authorization, requestedActor));
  }
  @Get("reports") reports(@Headers("authorization") authorization?: string) {
    this.actor(authorization); return this.operations.reports();
  }
  @Get("jobs") jobs(@Headers("authorization") authorization?: string) {
    this.actor(authorization); return this.operations.jobs();
  }
  @Post("jobs/run-daily") runDaily(@Headers("authorization") authorization?: string, @Headers("x-ops-actor") requestedActor?: string) {
    const actor = this.actor(authorization, requestedActor); return this.automation.enqueueDailySuite(new Date(), actor);
  }
  @Post("jobs/run/:kind") runJob(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("kind") kind: string) {
    const actor = this.actor(authorization, requestedActor);
    if (!jobKinds.includes(kind as AutomationKind)) throw new BadRequestException("不支持的任务类型");
    return this.automation.enqueue(kind as AutomationKind, new Date(), undefined, { triggeredBy: actor });
  }
  @Get("sops") sops(@Headers("authorization") authorization?: string) {
    this.actor(authorization); return this.operations.sops();
  }
}
