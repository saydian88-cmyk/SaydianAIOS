import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AiTaskCenterService } from "./ai-task-center.service";
import { AuthService } from "./auth.service";
import { WecomNotificationService } from "./wecom-notification.service";

type UploadFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@Controller("api/v1/ai-tasks")
export class AiTaskCenterController {
  constructor(
    private readonly auth: AuthService,
    private readonly tasks: AiTaskCenterService,
    private readonly wecom: WecomNotificationService,
  ) {}

  private actor(authorization: string | undefined, permission: string, requestedActor?: string) {
    this.auth.requirePermission(authorization, permission);
    return this.auth.requireAdmin(authorization, requestedActor);
  }

  private runnerToken(authorization?: string) {
    return authorization?.replace(/^Runner\s+/i, "").trim() || "";
  }

  @Get("overview")
  overview(@Headers("authorization") authorization?: string) {
    this.actor(authorization, "AI_TASK_VIEW");
    return this.tasks.overview();
  }

  @Get("policies")
  policies(@Headers("authorization") authorization?: string) {
    this.actor(authorization, "AI_TASK_VIEW");
    return this.tasks.policies();
  }

  @Put("policies")
  updatePolicies(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Body() body: { policies?: unknown[] },
  ) {
    return this.tasks.updatePolicies(
      body.policies || [],
      this.actor(authorization, "AI_TASK_POLICY", requestedActor),
    );
  }

  @Get("runners")
  runners(@Headers("authorization") authorization?: string) {
    this.actor(authorization, "AI_TASK_VIEW");
    return this.tasks.runners();
  }

  @Post("runners")
  createRunner(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tasks.createRunner(
      body,
      this.actor(authorization, "AI_TASK_RUNNER", requestedActor),
    );
  }

  @Post("runners/:id/rotate-token")
  rotateRunnerToken(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
  ) {
    return this.tasks.rotateRunnerToken(
      id,
      this.actor(authorization, "AI_TASK_RUNNER", requestedActor),
    );
  }

  @Delete("runners/:id")
  removeRunner(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
  ) {
    return this.tasks.removeRunner(
      id,
      this.actor(authorization, "AI_TASK_RUNNER", requestedActor),
    );
  }

  @Get("notifications/wecom")
  wecomStatus(@Headers("authorization") authorization?: string) {
    this.actor(authorization, "AI_TASK_VIEW");
    return this.wecom.status();
  }

  @Put("notifications/wecom")
  updateWecom(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    this.actor(authorization, "AI_TASK_POLICY", requestedActor);
    return this.wecom.configure(body);
  }

  @Get("outputs/:id/url")
  outputUrl(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    this.actor(authorization, "AI_TASK_VIEW");
    return this.tasks.outputUrl(id);
  }

  @Post("runner/claim")
  claim(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tasks.claimRunner(this.runnerToken(authorization), body);
  }

  @Get("runner/material-index")
  materialIndex(
    @Headers("authorization") authorization: string | undefined,
    @Query("nodeCode") nodeCode: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.tasks.runnerMaterialIndex(this.runnerToken(authorization), { nodeCode, cursor });
  }

  @Get("runner/terminal-cleanup")
  terminalCleanupCandidates(
    @Headers("authorization") authorization: string | undefined,
    @Query("nodeCode") nodeCode: string,
  ) {
    return this.tasks.runnerTerminalCleanupCandidates(this.runnerToken(authorization), { nodeCode });
  }

  @Post("runner/tasks/:id/purge")
  purgeTerminalTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tasks.runnerPurgeTerminalTask(this.runnerToken(authorization), id, body);
  }

  @Get("runner/material-mirror-index")
  materialMirrorIndex(
    @Headers("authorization") authorization: string | undefined,
    @Query("nodeCode") nodeCode: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.tasks.runnerMaterialMirrorIndex(this.runnerToken(authorization), { nodeCode, cursor });
  }

  @Post("runner/material-downloads")
  materialDownloads(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tasks.runnerMaterialDownloads(this.runnerToken(authorization), body);
  }

  @Get("runner/tasks/:id/package")
  taskPackage(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Query("nodeCode") nodeCode: string,
  ) {
    return this.tasks.runnerPackage(this.runnerToken(authorization), id, { nodeCode });
  }

  @Post("runner/tasks/:id/checkpoint")
  checkpoint(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tasks.runnerCheckpoint(this.runnerToken(authorization), id, body);
  }

  @Post("runner/tasks/:id/heartbeat")
  heartbeat(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tasks.runnerHeartbeat(this.runnerToken(authorization), id, body);
  }

  @Post("runner/tasks/:id/progress")
  progress(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tasks.runnerProgress(this.runnerToken(authorization), id, body);
  }

  @Post("runner/tasks/:id/output")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 500 * 1024 * 1024 } }))
  output(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: UploadFile | undefined,
  ) {
    const normalized = { ...body };
    if (typeof normalized.metadata === "string") {
      try {
        normalized.metadata = JSON.parse(normalized.metadata);
      } catch {
        normalized.metadata = {};
      }
    }
    return this.tasks.runnerOutput(this.runnerToken(authorization), id, normalized, file);
  }

  @Post("runner/output-metadata/:taskNo")
  outputMetadata(
    @Headers("authorization") authorization: string | undefined,
    @Param("taskNo") taskNo: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tasks.runnerOutputMetadata(this.runnerToken(authorization), taskNo, body);
  }

  @Post("runner/tasks/:id/complete")
  complete(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tasks.runnerComplete(this.runnerToken(authorization), id, body);
  }

  @Post("runner/tasks/:id/fail")
  fail(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tasks.runnerFail(this.runnerToken(authorization), id, body);
  }

  @Get()
  list(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    this.actor(authorization, "AI_TASK_VIEW");
    return this.tasks.tasks(query);
  }

  @Post()
  create(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tasks.createTask(
      body,
      this.actor(authorization, "AI_TASK_MANAGE", requestedActor),
    );
  }

  @Get(":id")
  detail(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    this.actor(authorization, "AI_TASK_VIEW");
    return this.tasks.task(id);
  }

  @Patch(":id")
  update(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tasks.updateTask(
      id,
      body,
      this.actor(authorization, "AI_TASK_MANAGE", requestedActor),
    );
  }

  @Post(":id/start")
  start(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
  ) {
    return this.tasks.start(id, this.actor(authorization, "AI_TASK_MANAGE", requestedActor));
  }

  @Post(":id/revise")
  revise(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tasks.revise(
      id,
      body,
      this.actor(authorization, "AI_TASK_MANAGE", requestedActor),
    );
  }

  @Post(":id/cancel")
  cancel(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
  ) {
    return this.tasks.cancel(id, this.actor(authorization, "AI_TASK_MANAGE", requestedActor));
  }

  @Post(":id/retry")
  retry(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
  ) {
    return this.tasks.retry(id, this.actor(authorization, "AI_TASK_MANAGE", requestedActor));
  }

  @Post(":id/review")
  review(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tasks.review(
      id,
      body,
      this.actor(authorization, "AI_TASK_REVIEW", requestedActor),
    );
  }

  @Post(":id/convert-to-ops-task")
  convert(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tasks.convertToOpsTask(
      id,
      body,
      this.actor(authorization, "AI_TASK_MANAGE", requestedActor),
    );
  }
}
