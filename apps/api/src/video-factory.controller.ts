import { Body, Controller, Get, Headers, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { VideoFactoryWorkerService } from "./video-factory-worker.service";
import { VideoFactoryService } from "./video-factory.service";

@Controller("api/v1/video-factory")
export class VideoFactoryController {
  constructor(
    private readonly auth: AuthService,
    private readonly factory: VideoFactoryService,
    private readonly worker: VideoFactoryWorkerService,
  ) {}

  private actor(authorization?: string, requestedActor?: string) {
    return this.auth.requireAdmin(authorization, requestedActor);
  }

  @Get("providers")
  providers(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.factory.providers();
  }

  @Post("providers")
  createProvider(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const actor = this.actor(authorization, requestedActor);
    return this.factory.upsertProvider(body, actor);
  }

  @Patch("providers/:id")
  updateProvider(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const actor = this.actor(authorization, requestedActor);
    return this.factory.upsertProvider(body, actor, id);
  }

  @Post("providers/:id/check")
  checkProvider(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
  ) {
    return this.factory.checkProvider(id, this.actor(authorization, requestedActor));
  }

  @Post("webhooks/:providerCode")
  webhook(
    @Param("providerCode") providerCode: string,
    @Headers("x-video-webhook-secret") webhookSecret: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.worker.handleWebhook(providerCode, body, webhookSecret || "");
  }

  @Get("models")
  models(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.factory.models();
  }

  @Post("models")
  createModel(@Headers("authorization") authorization: string | undefined, @Body() body: Record<string, unknown>) {
    this.actor(authorization);
    return this.factory.upsertModel(body);
  }

  @Patch("models/:id")
  updateModel(@Headers("authorization") authorization: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    this.actor(authorization);
    return this.factory.upsertModel(body, id);
  }

  @Get("routing")
  routing(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.factory.routing();
  }

  @Post("routing")
  saveRouting(@Headers("authorization") authorization: string | undefined, @Body() body: Record<string, unknown>) {
    this.actor(authorization);
    return this.factory.saveRouting(body);
  }

  @Put("routing")
  replaceRouting(@Headers("authorization") authorization: string | undefined, @Body() body: Record<string, unknown>) {
    this.actor(authorization);
    return this.factory.saveRouting(body);
  }

  @Post("projects")
  createProject(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const actor = this.actor(authorization, requestedActor);
    return this.factory.createProject({
      platform: String(body.platform || "DOUYIN"),
      productModel: body.productModel ? String(body.productModel) : undefined,
      topic: body.topic ? String(body.topic) : undefined,
      audience: body.audience ? String(body.audience) : undefined,
      objective: body.objective ? String(body.objective) : undefined,
      keywordIds: Array.isArray(body.keywordIds) ? body.keywordIds.map(String) : [],
      externalVideoIds: Array.isArray(body.externalVideoIds) ? body.externalVideoIds.map(String) : [],
      assetGapTaskId: body.assetGapTaskId ? String(body.assetGapTaskId) : undefined,
      requestedModelId: body.requestedModelId ? String(body.requestedModelId) : undefined,
      routingMode: body.routingMode ? String(body.routingMode) : "AUTO",
      allowFallback: body.allowFallback !== false,
    }, actor);
  }

  @Get("projects")
  projects(
    @Headers("authorization") authorization: string | undefined,
    @Query("status") status?: string,
    @Query("platform") platform?: string,
    @Query("productModel") productModel?: string,
  ) {
    this.actor(authorization);
    return this.factory.projects({ status, platform, productModel });
  }

  @Get("projects/:id")
  project(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    this.actor(authorization);
    return this.factory.project(id);
  }

  @Post("projects/:id/generate")
  generateProject(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.factory.generateProject(id, {
      candidateIndex: Number(body.candidateIndex || 0),
      requestedModelId: body.requestedModelId ? String(body.requestedModelId) : undefined,
      routingMode: body.routingMode ? String(body.routingMode) : "AUTO",
      allowFallback: body.allowFallback !== false,
    }, this.actor(authorization, requestedActor));
  }

  @Post("shots/:id/generate")
  generateShot(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.factory.enqueueShot(id, {
      prompt: body.prompt ? String(body.prompt) : undefined,
      duration: Number(body.duration || 5),
      requestedModelId: body.requestedModelId ? String(body.requestedModelId) : undefined,
      routingMode: body.routingMode ? String(body.routingMode) : undefined,
      allowFallback: body.allowFallback === undefined ? undefined : Boolean(body.allowFallback),
    }, this.actor(authorization, requestedActor));
  }

  @Post("projects/:id/render")
  render(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
  ) {
    return this.factory.enqueueRender(id, this.actor(authorization, requestedActor));
  }

  @Get("jobs/:id")
  job(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    this.actor(authorization);
    return this.factory.job(id);
  }

  @Get("outputs/:id/url")
  outputUrl(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    this.actor(authorization);
    return this.factory.outputUrl(id);
  }

  @Post("outputs/:id/review")
  reviewOutput(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.factory.reviewOutput(id, Boolean(body.approved), this.actor(authorization, requestedActor), String(body.note || ""));
  }
}
