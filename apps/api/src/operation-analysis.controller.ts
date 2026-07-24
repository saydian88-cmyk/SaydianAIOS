import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { OperationAnalysisService } from "./operation-analysis.service";

@Controller("api/v1/operation-analysis")
export class OperationAnalysisController {
  constructor(
    private readonly auth: AuthService,
    private readonly service: OperationAnalysisService,
  ) {}

  private actor(authorization?: string, requestedActor?: string) {
    return this.auth.requireAdmin(authorization, requestedActor);
  }

  @Post("imports")
  imports(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.importData(body, this.actor(authorization, requestedActor));
  }

  @Get("overview")
  overview(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.service.overview();
  }

  @Get("products")
  products(@Headers("authorization") authorization: string | undefined, @Query() query: Record<string, string>) {
    this.actor(authorization);
    return this.service.products(query);
  }

  @Get("stores")
  stores(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.service.stores();
  }

  @Get("competitors")
  competitors(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.service.competitors();
  }

  @Post("runs")
  runs(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.runAnalysis(body, this.actor(authorization, requestedActor));
  }

  @Get("runs")
  analysisRuns(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.service.analysisRuns();
  }

  @Get("findings")
  findings(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.service.findings();
  }

  @Post("findings/:id/confirm")
  confirmFinding(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.confirmFinding(id, body, this.actor(authorization, requestedActor));
  }

  @Get("tasks")
  tasks(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.service.tasks();
  }

  @Patch("tasks/:id")
  updateTask(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.updateTask(id, body, this.actor(authorization, requestedActor));
  }

  @Post("tasks/:id/submit")
  submitTask(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.submitTask(id, body, this.actor(authorization, requestedActor));
  }

  @Post("tasks/:id/verify")
  verifyTask(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.verifyTask(id, body, this.actor(authorization, requestedActor));
  }
}
