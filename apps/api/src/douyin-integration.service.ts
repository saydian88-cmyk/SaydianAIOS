import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { IntegrationState, Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { opsConfig } from "./config";
import {
  readIntegrationSecret,
  writeIntegrationSecret,
  type DouyinSecret,
} from "./integration-secret";
import { PrismaService } from "./prisma.service";

type DouyinPublicConfig = {
  clientKey: string;
  redirectUri: string;
  webhookUrl: string;
};

type TokenPayload = {
  accessToken: string;
  refreshToken: string;
  openId: string;
  scope: string;
  expiresIn: number;
  refreshExpiresIn: number;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

@Injectable()
export class DouyinIntegrationService {
  private readonly logger = new Logger(DouyinIntegrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async status() {
    const integration = await this.ensureIntegration();
    const config = this.publicConfig(integration.publicConfig);
    const secrets = readIntegrationSecret(integration.secretRef);
    const douyin = secrets.douyin ?? {};
    return {
      state: integration.state,
      message: integration.message,
      clientKey: config.clientKey,
      clientSecretConfigured: Boolean(douyin.clientSecret || opsConfig.douyin.clientSecret),
      authorized: Boolean(douyin.accessToken && douyin.openId),
      openIdMasked: douyin.openId ? `${douyin.openId.slice(0, 6)}…${douyin.openId.slice(-4)}` : "",
      scope: douyin.scope || "",
      expiresAt: douyin.expiresAt || null,
      refreshExpiresAt: douyin.refreshExpiresAt || null,
      redirectUri: config.redirectUri,
      webhookUrl: config.webhookUrl,
      lastSuccessAt: integration.lastSuccessAt,
    };
  }

  async configure(input: Record<string, unknown>) {
    const integration = await this.ensureIntegration();
    const current = this.publicConfig(integration.publicConfig);
    const secrets = readIntegrationSecret(integration.secretRef);
    const clientKey = text(input.clientKey) || current.clientKey || opsConfig.douyin.clientKey;
    const clientSecret = text(input.clientSecret);
    const redirectUri = text(input.redirectUri) || current.redirectUri;
    const webhookUrl = text(input.webhookUrl) || current.webhookUrl;
    if (!clientKey) throw new BadRequestException("请填写抖音 Client Key");

    const nextDouyin: DouyinSecret = {
      ...(secrets.douyin ?? {}),
      clientSecret: clientSecret || secrets.douyin?.clientSecret || opsConfig.douyin.clientSecret,
    };
    const configured = Boolean(clientKey && nextDouyin.clientSecret);
    const publicConfig = {
      ...(integration.publicConfig as Record<string, Prisma.JsonValue>),
      douyinOAuth: { clientKey, redirectUri, webhookUrl },
    } as Prisma.InputJsonValue;

    await this.prisma.integration.update({
      where: { id: integration.id },
      data: {
        publicConfig,
        secretRef: writeIntegrationSecret({ ...secrets, douyin: nextDouyin }),
        state: configured ? "CONFIGURED" : "UNCONFIGURED",
        message: configured ? "抖音应用已配置，等待账号授权" : "抖音应用密钥未配置",
        capabilities: ["OAUTH_LOGIN", "AUTHORIZED_ACCOUNT", "WEBHOOK", "MANUAL_IMPORT"],
        lastCheckedAt: new Date(),
      },
    });
    return this.status();
  }

  async authorizeUrl() {
    const integration = await this.ensureIntegration();
    const config = this.publicConfig(integration.publicConfig);
    const secrets = readIntegrationSecret(integration.secretRef);
    const clientKey = config.clientKey || opsConfig.douyin.clientKey;
    const clientSecret = secrets.douyin?.clientSecret || opsConfig.douyin.clientSecret;
    if (!clientKey || !clientSecret) throw new BadRequestException("请先保存抖音 Client Key 和 Client Secret");

    const state = randomBytes(24).toString("hex");
    const nextDouyin: DouyinSecret = {
      ...(secrets.douyin ?? {}),
      clientSecret,
      oauthState: state,
      oauthStateExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    await this.prisma.integration.update({
      where: { id: integration.id },
      data: { secretRef: writeIntegrationSecret({ ...secrets, douyin: nextDouyin }) },
    });

    const url = new URL("https://open.douyin.com/platform/oauth/connect/");
    url.searchParams.set("client_key", clientKey);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "user_info");
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("state", state);
    return { url: url.toString(), expiresAt: nextDouyin.oauthStateExpiresAt };
  }

  async oauthCallback(codeValue: string, stateValue: string) {
    const code = text(codeValue);
    const state = text(stateValue);
    if (!code || !state) throw new BadRequestException("抖音授权回调缺少 code 或 state");

    const integration = await this.ensureIntegration();
    const config = this.publicConfig(integration.publicConfig);
    const secrets = readIntegrationSecret(integration.secretRef);
    const douyin = secrets.douyin ?? {};
    if (
      !douyin.oauthState ||
      state !== douyin.oauthState ||
      !douyin.oauthStateExpiresAt ||
      new Date(douyin.oauthStateExpiresAt).getTime() < Date.now()
    ) {
      throw new BadRequestException("抖音授权状态已失效，请重新发起授权");
    }
    if (!config.clientKey || !douyin.clientSecret) throw new BadRequestException("抖音应用密钥未配置");

    const token = await this.exchangeCode(config.clientKey, douyin.clientSecret, code);
    const now = Date.now();
    const nextDouyin: DouyinSecret = {
      clientSecret: douyin.clientSecret,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      openId: token.openId,
      scope: token.scope,
      expiresAt: new Date(now + token.expiresIn * 1000).toISOString(),
      refreshExpiresAt: new Date(now + token.refreshExpiresIn * 1000).toISOString(),
    };

    await this.prisma.$transaction([
      this.prisma.integration.update({
        where: { id: integration.id },
        data: {
          secretRef: writeIntegrationSecret({ ...secrets, douyin: nextDouyin }),
          state: "HEALTHY",
          message: "抖音账号授权成功",
          lastCheckedAt: new Date(),
          lastSuccessAt: new Date(),
        },
      }),
      this.prisma.platformAccount.upsert({
        where: {
          integrationId_externalAccountId: {
            integrationId: integration.id,
            externalAccountId: token.openId,
          },
        },
        create: {
          integrationId: integration.id,
          accountName: "抖音授权账号",
          externalAccountId: token.openId,
          state: "HEALTHY",
          capabilityStatus: { userInfo: true },
          message: "OAuth授权成功",
          lastCheckedAt: new Date(),
          lastSuccessAt: new Date(),
        },
        update: {
          state: "HEALTHY",
          capabilityStatus: { userInfo: true },
          message: "OAuth授权有效",
          lastCheckedAt: new Date(),
          lastSuccessAt: new Date(),
        },
      }),
    ]);
    return { authorized: true, openId: token.openId };
  }

  async webhook(body: Record<string, unknown>) {
    const content = body.content && typeof body.content === "object" && !Array.isArray(body.content)
      ? body.content as Record<string, unknown>
      : {};
    if (body.event === "verify_webhook" && content.challenge !== undefined) {
      return { challenge: content.challenge };
    }
    await this.prisma.auditLog.create({
      data: {
        actor: "抖音开放平台",
        action: `DOUYIN_WEBHOOK_${text(body.event) || "UNKNOWN"}`,
        entityType: "Integration",
        before: {},
        after: body as Prisma.InputJsonValue,
      },
    });
    return { ok: true };
  }

  @Cron("0 20 */6 * * *", { timeZone: "Asia/Shanghai" })
  async refreshWhenNeeded() {
    const integration = await this.prisma.integration.findUnique({ where: { kind: "DOUYIN" } });
    if (!integration) return;
    const config = this.publicConfig(integration.publicConfig);
    const secrets = readIntegrationSecret(integration.secretRef);
    const douyin = secrets.douyin;
    if (!douyin?.refreshToken || !douyin.expiresAt || !config.clientKey) return;
    if (new Date(douyin.expiresAt).getTime() > Date.now() + 48 * 60 * 60 * 1000) return;
    try {
      const token = await this.refreshToken(config.clientKey, douyin.refreshToken);
      const now = Date.now();
      await this.prisma.integration.update({
        where: { id: integration.id },
        data: {
          secretRef: writeIntegrationSecret({
            ...secrets,
            douyin: {
              ...douyin,
              accessToken: token.accessToken,
              refreshToken: token.refreshToken || douyin.refreshToken,
              openId: token.openId || douyin.openId,
              scope: token.scope || douyin.scope,
              expiresAt: new Date(now + token.expiresIn * 1000).toISOString(),
              refreshExpiresAt: token.refreshExpiresIn
                ? new Date(now + token.refreshExpiresIn * 1000).toISOString()
                : douyin.refreshExpiresAt,
            },
          }),
          state: "HEALTHY",
          message: "抖音授权已自动续期",
          lastCheckedAt: new Date(),
          lastSuccessAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "抖音授权续期失败";
      this.logger.warn(message);
      await this.prisma.integration.update({
        where: { id: integration.id },
        data: { state: "DEGRADED", message, lastCheckedAt: new Date() },
      });
    }
  }

  private async exchangeCode(clientKey: string, clientSecret: string, code: string) {
    return this.tokenRequest("https://open.douyin.com/oauth/access_token/", {
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    });
  }

  private async refreshToken(clientKey: string, refreshToken: string) {
    return this.tokenRequest("https://open.douyin.com/oauth/refresh_token/", {
      client_key: clientKey,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
  }

  private async tokenRequest(url: string, form: Record<string, string>): Promise<TokenPayload> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
    });
    const result = await response.json() as Record<string, unknown>;
    const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? result.data as Record<string, unknown>
      : result;
    const errorCode = number(data.error_code);
    if (!response.ok || errorCode) {
      throw new Error(text(data.description) || text(result.message) || `抖音接口返回 ${response.status}`);
    }
    const token: TokenPayload = {
      accessToken: text(data.access_token),
      refreshToken: text(data.refresh_token),
      openId: text(data.open_id),
      scope: text(data.scope),
      expiresIn: number(data.expires_in),
      refreshExpiresIn: number(data.refresh_expires_in),
    };
    if (!token.accessToken || !token.openId) throw new Error("抖音授权返回缺少访问令牌");
    return token;
  }

  private publicConfig(value?: Prisma.JsonValue): DouyinPublicConfig {
    const root = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const raw = root.douyinOAuth && typeof root.douyinOAuth === "object" && !Array.isArray(root.douyinOAuth)
      ? root.douyinOAuth as Record<string, unknown>
      : {};
    const base = opsConfig.publicBaseUrl.replace(/\/$/u, "");
    return {
      clientKey: text(raw.clientKey) || opsConfig.douyin.clientKey,
      redirectUri: text(raw.redirectUri) || `${base}/api/v1/integrations/douyin/oauth/callback`,
      webhookUrl: text(raw.webhookUrl) || `${base}/api/v1/integrations/douyin/webhooks`,
    };
  }

  private async ensureIntegration() {
    return this.prisma.integration.upsert({
      where: { kind: "DOUYIN" },
      update: {},
      create: {
        kind: "DOUYIN",
        displayName: "抖音",
        state: "UNCONFIGURED",
        capabilities: ["OAUTH_LOGIN", "AUTHORIZED_ACCOUNT", "WEBHOOK", "MANUAL_IMPORT"],
        message: "抖音开放平台未配置",
      },
    });
  }
}
