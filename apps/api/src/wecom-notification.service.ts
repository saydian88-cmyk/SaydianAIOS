import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { readIntegrationSecret, writeIntegrationSecret } from "./integration-secret";
import { PrismaService } from "./prisma.service";

type WecomPublicConfig = {
  corpId?: string;
  agentId?: string;
};

@Injectable()
export class WecomNotificationService {
  private cachedToken?: { value: string; expiresAt: number };

  constructor(private readonly prisma: PrismaService) {}

  async status() {
    const integration = await this.prisma.integration.findUnique({ where: { kind: "WECOM" } });
    const config = this.publicConfig(integration?.publicConfig);
    const secret = readIntegrationSecret(integration?.secretRef).wecomAppSecret;
    const configured = Boolean(config.corpId && config.agentId && secret);
    return {
      configured,
      state: integration?.state || "UNCONFIGURED",
      corpId: config.corpId || "",
      agentId: config.agentId || "",
      secretConfigured: Boolean(secret),
      message: configured ? integration?.message || "企微个人通知已配置" : "企微个人通知未配置",
      lastSuccessAt: integration?.lastSuccessAt,
    };
  }

  async configure(body: Record<string, unknown>) {
    const corpId = String(body.corpId || "").trim();
    const agentId = String(body.agentId || "").trim();
    const appSecret = String(body.appSecret || "").trim();
    const existing = await this.prisma.integration.findUnique({ where: { kind: "WECOM" } });
    const secrets = readIntegrationSecret(existing?.secretRef);
    if (appSecret) secrets.wecomAppSecret = appSecret;
    const configured = Boolean(corpId && agentId && secrets.wecomAppSecret);
    this.cachedToken = undefined;
    await this.prisma.integration.upsert({
      where: { kind: "WECOM" },
      create: {
        kind: "WECOM",
        displayName: "企业微信",
        state: configured ? "CONFIGURED" : "UNCONFIGURED",
        capabilities: ["TASK_NOTIFICATION", "REPORT_PUSH"],
        publicConfig: { corpId, agentId },
        secretRef: writeIntegrationSecret(secrets),
        message: configured ? "企微个人通知待验证" : "企微个人通知未配置",
      },
      update: {
        state: configured ? "CONFIGURED" : "UNCONFIGURED",
        capabilities: ["TASK_NOTIFICATION", "REPORT_PUSH"],
        publicConfig: { ...this.publicConfig(existing?.publicConfig), corpId, agentId },
        secretRef: writeIntegrationSecret(secrets),
        message: configured ? "企微个人通知待验证" : "企微个人通知未配置",
      },
    });
    return this.status();
  }

  async send(employeeId: string, title: string, content: string, url?: string) {
    const [employee, integration] = await Promise.all([
      this.prisma.employee.findUnique({ where: { id: employeeId } }),
      this.prisma.integration.findUnique({ where: { kind: "WECOM" } }),
    ]);
    if (!employee?.wecomUserId) return { configured: false, message: "负责人未配置企业微信身份" };
    const config = this.publicConfig(integration?.publicConfig);
    const appSecret = readIntegrationSecret(integration?.secretRef).wecomAppSecret;
    if (!config.corpId || !config.agentId || !appSecret) return { configured: false, message: "企微个人通知未配置" };
    try {
      const accessToken = await this.accessToken(config.corpId, appSecret);
      const body = [
        `<div class="gray">${title}</div>`,
        `<div class="normal">${content}</div>`,
        url ? `<div class="highlight"><a href="${url}">进入员工工作台处理</a></div>` : "",
      ].filter(Boolean).join("");
      const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(accessToken)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          touser: employee.wecomUserId,
          msgtype: "textcard",
          agentid: Number(config.agentId),
          textcard: { title, description: body, url: url || "https://stest.saydian.cn/saidian-work/", btntxt: "查看任务" },
          safe: 0,
          enable_id_trans: 0,
          enable_duplicate_check: 1,
          duplicate_check_interval: 1800,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json() as Record<string, unknown>;
      if (!response.ok || Number(result.errcode || 0) !== 0) throw new Error(String(result.errmsg || `HTTP ${response.status}`));
      await this.prisma.integration.update({
        where: { kind: "WECOM" },
        data: { state: "HEALTHY", message: "企微个人通知正常", lastCheckedAt: new Date(), lastSuccessAt: new Date() },
      });
      return { configured: true, sent: true, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "企微个人通知失败";
      await this.prisma.integration.update({
        where: { kind: "WECOM" },
        data: { state: "ERROR", message, lastCheckedAt: new Date() },
      });
      return { configured: true, sent: false, message };
    }
  }

  private async accessToken(corpId: string, appSecret: string) {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) return this.cachedToken.value;
    const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(appSecret)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok || Number(result.errcode || 0) !== 0 || !result.access_token) {
      throw new BadRequestException(String(result.errmsg || "获取企微访问令牌失败"));
    }
    const expiresIn = Math.max(300, Number(result.expires_in || 7200));
    this.cachedToken = { value: String(result.access_token), expiresAt: Date.now() + expiresIn * 1000 };
    return this.cachedToken.value;
  }

  private publicConfig(input: Prisma.JsonValue | null | undefined): WecomPublicConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    return input as WecomPublicConfig;
  }
}
