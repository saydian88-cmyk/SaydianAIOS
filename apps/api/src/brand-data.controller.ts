import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Query, UploadedFile, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import { diskStorage } from "multer";
import { AuthService } from "./auth.service";
import { BrandDataService } from "./brand-data.service";
import { CloudMediaService } from "./cloud-media.service";
import { SourceSyncService } from "./source-sync.service";
import { ViralCollectorService } from "./viral-collector.service";

const uploadInbox = resolve(process.cwd(), "data", "upload-inbox");
mkdirSync(uploadInbox, { recursive: true });

const batchUploadStorage = diskStorage({
  destination: uploadInbox,
  filename: (_request, file, callback) => callback(null, `${Date.now()}-${randomUUID()}${extname(file.originalname).toLowerCase()}`),
});

type DiskFile = { originalname: string; mimetype: string; size: number; path: string };

@Controller("api/v1/brand-data")
export class BrandDataController {
  constructor(
    private readonly auth: AuthService,
    private readonly brandData: BrandDataService,
    private readonly cloudMedia: CloudMediaService,
    private readonly sourceSync: SourceSyncService,
    private readonly viralCollector: ViralCollectorService,
  ) {}

  private actor(authorization?: string, requestedActor?: string) {
    return this.auth.requireAdmin(authorization, requestedActor);
  }

  @Get("overview")
  overview(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.brandData.overview();
  }

  @Get("knowledge")
  knowledge(@Headers("authorization") authorization: string | undefined, @Query() query: Record<string, string | undefined>) {
    this.actor(authorization);
    return this.brandData.knowledge(query);
  }

  @Get("knowledge-controls")
  knowledgeControls(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.brandData.knowledgeControls();
  }

  @Post("knowledge/sync")
  syncKnowledge(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.sourceSync.syncKnowledge();
  }

  @Get("products")
  products(@Headers("authorization") authorization: string | undefined, @Query() query: Record<string, string | undefined>) {
    this.actor(authorization);
    return this.brandData.products(query);
  }

  @Post("products/import")
  importProducts(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    return this.brandData.importProducts(body, this.actor(authorization, requestedActor));
  }

  @Post("knowledge")
  createKnowledge(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    return this.brandData.createKnowledge(body, this.actor(authorization, requestedActor));
  }

  @Patch("knowledge/:id")
  updateKnowledge(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.brandData.updateKnowledge(id, body, this.actor(authorization, requestedActor));
  }

  @Post("knowledge/:id/review")
  reviewKnowledge(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.brandData.reviewKnowledge(id, Boolean(body.approved), this.actor(authorization, requestedActor), String(body.note ?? ""));
  }

  @Post("knowledge/bulk")
  bulkKnowledge(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    return this.brandData.bulkKnowledge(body, this.actor(authorization, requestedActor));
  }

  @Post("products/bulk")
  bulkProducts(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    return this.brandData.bulkProducts(body, this.actor(authorization, requestedActor));
  }

  @Post("faqs/bulk")
  bulkFaqs(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    return this.brandData.bulkFaqs(body, this.actor(authorization, requestedActor));
  }

  @Post("upload-batches")
  createUploadBatch(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Body() body: Record<string, unknown>) {
    return this.brandData.createUploadBatch(body, this.actor(authorization, requestedActor));
  }

  @Post("upload-batches/assist")
  assistUploadBatch(@Headers("authorization") authorization: string | undefined, @Body() body: Record<string, unknown>) {
    this.actor(authorization);
    return this.brandData.suggestUploadMetadata(body);
  }

  @Post("upload-batches/:id/files")
  @UseInterceptors(FilesInterceptor("files", 20, { storage: batchUploadStorage, limits: { fileSize: 200 * 1024 * 1024, files: 20 } }))
  uploadBatchFiles(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
    @UploadedFiles() files: DiskFile[],
    @Body() body: Record<string, unknown>,
  ) {
    return this.brandData.uploadBatchFiles(id, files, this.actor(authorization, requestedActor), body);
  }

  @Get("upload-batches/:id")
  uploadBatch(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    this.actor(authorization);
    return this.brandData.uploadBatch(id);
  }

  @Get("assets")
  assets(@Headers("authorization") authorization: string | undefined, @Query() query: Record<string, string | undefined>) {
    this.actor(authorization);
    return this.brandData.assets(query);
  }

  @Get("assets/ranked-search")
  rankedAssets(@Headers("authorization") authorization: string | undefined, @Query() query: Record<string, string | undefined>) {
    this.actor(authorization);
    return this.brandData.rankedAssets(query);
  }

  @Get("analysis-jobs")
  analysisJobs(@Headers("authorization") authorization: string | undefined, @Query() query: Record<string, string | undefined>) {
    this.actor(authorization);
    return this.brandData.analysisJobs(query);
  }

  @Get("asset-gaps")
  assetGaps(@Headers("authorization") authorization: string | undefined, @Query("refresh") refresh?: string) {
    this.actor(authorization);
    return this.brandData.assetGaps(refresh === "1" || refresh === "true");
  }

  @Get("growth-loop")
  growthLoop(@Headers("authorization") authorization: string | undefined) {
    this.actor(authorization);
    return this.brandData.growthLoop();
  }

  @Post("growth-loop/refresh")
  refreshGrowthLoop(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined) {
    const actor = this.actor(authorization, requestedActor);
    return this.brandData.growthLoop(true, actor);
  }

  @Get("reports/daily")
  dailyReport(@Headers("authorization") authorization: string | undefined, @Query("date") date?: string) {
    this.actor(authorization);
    return this.brandData.dailyReport(date);
  }

  @Get("ai-capabilities")
  aiCapabilities(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.cloudMedia.healthCapabilities();
  }

  @Get("cloud/jobs")
  cloudJobs(@Headers("authorization") authorization: string | undefined, @Query() query: Record<string, string | undefined>) {
    this.actor(authorization);
    return this.cloudMedia.listJobs({
      assetId: query.assetId,
      externalVideoId: query.externalVideoId,
      status: query.status as never,
      take: Number(query.take || 50),
    });
  }

  @Post("cloud/jobs/:id/retry")
  retryCloudJob(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    this.actor(authorization);
    return this.cloudMedia.retryJob(id);
  }

  @Post("cloud/callbacks/:token")
  cloudCallback(@Param("token") token: string, @Body() body: Record<string, unknown>) {
    return this.cloudMedia.handleCallback(token, body);
  }

  @Post("external-videos")
  registerExternalVideo(@Headers("authorization") authorization: string | undefined, @Body() body: Record<string, unknown>) {
    this.actor(authorization);
    return this.cloudMedia.registerExternalVideo(body as never);
  }

  @Get("external-videos")
  externalVideos(@Headers("authorization") authorization: string | undefined, @Query() query: Record<string, string | undefined>) {
    this.actor(authorization);
    return this.cloudMedia.listExternalVideos({
      platform: query.platform as never,
      status: query.status,
      take: Number(query.take || 50),
    });
  }

  @Post("external-videos/:id/analyze")
  analyzeExternalVideo(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    this.actor(authorization);
    return this.cloudMedia.enqueueExternalVideo(id);
  }

  @Get("remake-tasks")
  remakeTasks(@Headers("authorization") authorization: string | undefined, @Query() query: Record<string, string | undefined>) {
    this.actor(authorization);
    return this.cloudMedia.listRemakeTasks({ status: query.status, take: Number(query.take || 50) });
  }

  @Patch("remake-tasks/:id")
  updateRemakeTask(@Headers("authorization") authorization: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    this.actor(authorization);
    return this.cloudMedia.updateRemakeTask(id, body as never);
  }

  @Get("viral-collector/capabilities")
  viralCollectorCapabilities(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.viralCollector.capabilities();
  }

  @Patch("viral-collector/config/:platform")
  updateViralCollectorConfig(
    @Headers("authorization") authorization: string | undefined,
    @Param("platform") platform: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.actor(authorization);
    return this.viralCollector.updateConfig(platform, body);
  }

  @Post("viral-collector/import")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  importViralCollectorCsv(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @UploadedFile() file: { originalname: string; size: number; buffer: Buffer } | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    if (!file) throw new BadRequestException("请选择CSV文件");
    return this.viralCollector.importCsv(
      String(body.platform || ""),
      file.buffer,
      file.originalname,
      this.actor(authorization, requestedActor),
    );
  }

  @Post("viral-collector/links")
  registerViralCollectorLink(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.viralCollector.registerLink(body, this.actor(authorization, requestedActor));
  }

  @Post("viral-collector/run")
  runViralCollector(@Headers("authorization") authorization: string | undefined, @Body() body: Record<string, unknown>) {
    this.actor(authorization);
    return this.viralCollector.collect(body.platform as never);
  }

  @Post("assets/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 200 * 1024 * 1024, files: 1 } }))
  uploadAsset(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.brandData.uploadAsset(file, body, this.actor(authorization, requestedActor));
  }

  @Get("assets/:id")
  asset(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    this.actor(authorization);
    return this.brandData.asset(id);
  }

  @Patch("assets/:id/metadata")
  updateAssetV2(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.brandData.updateAsset(id, body, this.actor(authorization, requestedActor));
  }

  @Patch("assets/:id")
  updateAsset(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.brandData.updateAsset(id, body, this.actor(authorization, requestedActor));
  }

  @Post("assets/:id/review")
  reviewAsset(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const actor = this.actor(authorization, requestedActor);
    return body.action ? this.brandData.reviewAssetV2(id, body, actor) : this.brandData.reviewAsset(id, Boolean(body.approved), actor, String(body.note ?? ""));
  }

  @Post("assets/:id/reanalyze")
  reanalyzeAsset(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string) {
    return this.brandData.reanalyzeAsset(id, this.actor(authorization, requestedActor));
  }

  @Post("assets/:id/usages")
  recordAssetUsage(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.brandData.recordAssetUsage(id, body, this.actor(authorization, requestedActor));
  }

  @Post("assets/:id/metrics")
  recordAssetMetric(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.brandData.recordAssetMetric(id, body, this.actor(authorization, requestedActor));
  }

  @Get("assets/:id/segments")
  segments(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    this.actor(authorization);
    return this.brandData.segments(id);
  }

  @Patch("assets/:id/segments/:segmentId")
  updateSegment(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Param("segmentId") segmentId: string, @Body() body: Record<string, unknown>) {
    return this.brandData.updateSegment(id, segmentId, body, this.actor(authorization, requestedActor));
  }

  @Post("assets/:id/segments/:segmentId/materialize")
  materializeSegment(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Param("segmentId") segmentId: string, @Body() body: Record<string, unknown>) {
    return this.brandData.materializeSegment(id, segmentId, body, this.actor(authorization, requestedActor));
  }

  @Get("assets/:id/download-url")
  assetDownloadUrl(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    this.actor(authorization);
    return this.brandData.assetDownloadUrl(id);
  }
}
