import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Redirect,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { opsConfig } from "./config";
import { DouyinIntegrationService } from "./douyin-integration.service";

@Controller("api/v1/integrations/douyin")
export class DouyinIntegrationController {
  constructor(
    private readonly auth: AuthService,
    private readonly douyin: DouyinIntegrationService,
  ) {}

  @Get("status")
  status(@Headers("authorization") authorization?: string) {
    this.auth.requireAdmin(authorization);
    return this.douyin.status();
  }

  @Post("config")
  configure(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    this.auth.requireAdmin(authorization);
    return this.douyin.configure(body);
  }

  @Get("authorize-url")
  authorizeUrl(@Headers("authorization") authorization?: string) {
    this.auth.requireAdmin(authorization);
    return this.douyin.authorizeUrl();
  }

  @Get("oauth/callback")
  @Redirect(undefined, 302)
  async oauthCallback(@Query("code") code: string, @Query("state") state: string) {
    await this.douyin.oauthCallback(code, state);
    const base = opsConfig.webBaseUrl.replace(/\/?$/u, "/");
    return { url: `${base}?douyin=authorized`, statusCode: 302 };
  }

  @Post("webhooks")
  webhook(@Body() body: Record<string, unknown>) {
    return this.douyin.webhook(body);
  }
}
