import { Body, Controller, Get, Headers, Param, Patch, Post, Put } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { SystemConfigService } from "./system-config.service";

type JsonRow = Record<string, unknown>;

@Controller("api/v1/system-config")
export class SystemConfigController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: SystemConfigService,
  ) {}

  private actor(authorization?: string, requestedActor?: string) {
    return this.auth.requireAdmin(authorization, requestedActor);
  }

  @Get("overview")
  overview(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.config.overview();
  }

  @Get("groups")
  groups(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.config.groups();
  }

  @Get("integrations/:kind")
  integration(
    @Headers("authorization") authorization: string | undefined,
    @Param("kind") kind: string,
  ) {
    this.actor(authorization);
    return this.config.integration(kind);
  }

  @Patch("integrations/:kind")
  updateIntegration(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("kind") kind: string,
    @Body() body: JsonRow,
  ) {
    return this.config.updateIntegration(kind, body, this.actor(authorization, requestedActor));
  }

  @Post("integrations/:kind/check")
  checkIntegration(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Param("kind") kind: string,
  ) {
    return this.config.checkIntegration(kind, this.actor(authorization, requestedActor));
  }

  @Get("ai-policy")
  policies(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.config.policies();
  }

  @Put("ai-policy")
  updatePolicies(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Body() body: { policies?: unknown[] },
  ) {
    return this.config.updatePolicies(body.policies || [], this.actor(authorization, requestedActor));
  }

  @Get("notifications/wecom")
  notification(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.config.notification();
  }

  @Put("notifications/wecom")
  updateNotification(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: JsonRow,
  ) {
    this.actor(authorization);
    return this.config.configureNotification(body);
  }

  @Get("runners")
  runners(@Headers("authorization") authorization?: string) {
    this.actor(authorization);
    return this.config.runners();
  }

  @Post("import/preview")
  previewImport(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Body() body: { text?: string },
  ) {
    return this.config.previewImport(String(body.text || ""), this.actor(authorization, requestedActor));
  }

  @Post("import/apply")
  applyImport(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-actor") requestedActor: string | undefined,
    @Body() body: { importToken?: string; overwrite?: boolean },
  ) {
    return this.config.applyImport(
      String(body.importToken || ""),
      Boolean(body.overwrite),
      this.actor(authorization, requestedActor),
    );
  }
}
