import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthService } from "./auth.service";
import { BrandDataService } from "./brand-data.service";

@Controller("api/v1/brand-data")
export class BrandDataController {
  constructor(
    private readonly auth: AuthService,
    private readonly brandData: BrandDataService,
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

  @Get("assets")
  assets(@Headers("authorization") authorization: string | undefined, @Query() query: Record<string, string | undefined>) {
    this.actor(authorization);
    return this.brandData.assets(query);
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

  @Patch("assets/:id")
  updateAsset(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.brandData.updateAsset(id, body, this.actor(authorization, requestedActor));
  }

  @Post("assets/:id/review")
  reviewAsset(@Headers("authorization") authorization: string | undefined, @Headers("x-ops-actor") requestedActor: string | undefined, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.brandData.reviewAsset(id, Boolean(body.approved), this.actor(authorization, requestedActor), String(body.note ?? ""));
  }

  @Get("assets/:id/download-url")
  assetDownloadUrl(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    this.actor(authorization);
    return this.brandData.assetDownloadUrl(id);
  }
}
