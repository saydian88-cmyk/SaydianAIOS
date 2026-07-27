import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IntegrationKind, Prisma } from "@prisma/client";
import { AiTaskCenterService } from "./ai-task-center.service";
import { opsConfig } from "./config";
import { DouyinIntegrationService } from "./douyin-integration.service";
import {
  decryptIntegrationValue,
  encryptIntegrationValue,
  readIntegrationSecret,
  writeIntegrationSecret,
  type IntegrationSecretBundle,
} from "./integration-secret";
import { MonitoringService } from "./monitoring.service";
import { PrismaService } from "./prisma.service";
import { VideoFactoryService } from "./video-factory.service";
import { WecomNotificationService } from "./wecom-notification.service";

type JsonRow = Record<string, unknown>;
type ImportTarget = {
  id: string;
  section: string;
  label: string;
  value: string;
  integrationKind?: IntegrationKind;
  targetType: "PUBLIC" | "SECRET" | "UNSUPPORTED";
  targetKey?: string;
};

const integrationKinds = new Set<string>(Object.values(IntegrationKind));

function row(value: unknown): JsonRow {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRow : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function configuredObject(value: JsonRow): boolean {
  return Object.values(value).some((item) => {
    if (Array.isArray(item)) return item.length > 0;
    if (item && typeof item === "object") return configuredObject(item as JsonRow);
    return String(item || "").trim().length > 0;
  });
}

function deepValue(input: JsonRow, path: string) {
  const parts = path.split(".");
  let current: unknown = input;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as JsonRow)[part];
  }
  return current;
}

function assignDeep(input: JsonRow, path: string, value: string) {
  const parts = path.split(".");
  let current = input;
  for (const part of parts.slice(0, -1)) {
    const next = row(current[part]);
    current[part] = next;
    current = next;
  }
  current[parts.at(-1)!] = value;
}

@Injectable()
export class SystemConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly monitoring: MonitoringService,
    private readonly aiTasks: AiTaskCenterService,
    private readonly videoFactory: VideoFactoryService,
    private readonly wecom: WecomNotificationService,
    private readonly douyin: DouyinIntegrationService,
  ) {}

  async overview() {
    const [integrations, providers, policies, runners, notification] = await Promise.all([
      this.prisma.integration.findMany({ orderBy: [{ state: "asc" }, { displayName: "asc" }] }),
      this.videoFactory.providers(),
      this.aiTasks.policies(),
      this.aiTasks.runners(),
      this.wecom.status(),
    ]);
    return {
      integrations: this.stateSummary(integrations),
      aiProviders: this.stateSummary(providers),
      policies: {
        total: policies.length,
        enabled: policies.filter((item) => item.enabled).length,
        autoExecute: policies.filter((item) => item.enabled && item.autoExecute).length,
      },
      runners: {
        total: runners.length,
        online: runners.filter((item) => item.online).length,
      },
      notification,
      bootstrap: this.bootstrapStatus(),
    };
  }

  async groups() {
    const [integrations, providers, models, routing, policies, runners, notification, logs] = await Promise.all([
      this.prisma.integration.findMany({ orderBy: [{ displayName: "asc" }] }),
      this.videoFactory.providers(),
      this.videoFactory.models(),
      this.videoFactory.routing(),
      this.aiTasks.policies(),
      this.aiTasks.runners(),
      this.wecom.status(),
      this.logs(),
    ]);
    return {
      integrations: integrations.map((item) => this.integrationView(item)),
      providers,
      models,
      routing,
      policies,
      runners,
      notification,
      bootstrap: this.bootstrapStatus(),
      logs,
    };
  }

  async integration(kindValue: string) {
    const kind = this.kind(kindValue);
    const integration = await this.prisma.integration.findUnique({ where: { kind } });
    if (!integration) throw new NotFoundException("接口配置不存在");
    return this.integrationView(integration);
  }

  async updateIntegration(kindValue: string, input: JsonRow, actor: string) {
    const kind = this.kind(kindValue);
    const existing = await this.prisma.integration.findUnique({ where: { kind } });
    const publicConfig = {
      ...row(existing?.publicConfig),
      ...row(input.publicConfig),
    };
    const secrets = readIntegrationSecret(existing?.secretRef);
    const incoming = row(input.secrets);
    this.mergeSecrets(secrets, incoming);
    const configured = configuredObject(publicConfig) || configuredObject(row(secrets));
    const displayName = String(input.displayName || existing?.displayName || kind);
    const integration = await this.prisma.integration.upsert({
      where: { kind },
      create: {
        kind,
        displayName,
        state: configured ? "CONFIGURED" : "UNCONFIGURED",
        capabilities: strings(input.capabilities),
        region: String(input.region || "CN"),
        publicConfig: publicConfig as Prisma.InputJsonValue,
        secretRef: configuredObject(row(secrets)) ? writeIntegrationSecret(secrets) : null,
        message: configured ? "配置已保存，待健康检查" : "未配置",
      },
      update: {
        displayName,
        state: configured ? "CONFIGURED" : "UNCONFIGURED",
        capabilities: input.capabilities === undefined ? existing?.capabilities : strings(input.capabilities),
        region: String(input.region || existing?.region || "CN"),
        publicConfig: publicConfig as Prisma.InputJsonValue,
        secretRef: configuredObject(row(secrets)) ? writeIntegrationSecret(secrets) : existing?.secretRef,
        message: configured ? "配置已保存，待健康检查" : "未配置",
      },
    });
    await this.audit(actor, "SYSTEM_CONFIG_INTEGRATION_UPDATE", "Integration", integration.id, {
      kind,
      publicKeys: Object.keys(row(input.publicConfig)),
      secretKeys: Object.keys(incoming),
    });
    return this.integrationView(integration);
  }

  async checkIntegration(kindValue: string, actor: string) {
    const kind = this.kind(kindValue);
    if (kind === "DOUYIN") {
      const result = await this.douyin.status();
      await this.audit(actor, "SYSTEM_CONFIG_INTEGRATION_CHECK", "Integration", kind, { state: result.state });
      return result;
    }
    if (kind === "WECOM") {
      const result = await this.wecom.status();
      await this.audit(actor, "SYSTEM_CONFIG_INTEGRATION_CHECK", "Integration", kind, { state: result.state });
      return result;
    }
    const rows = await this.monitoring.checkIntegrations();
    const result = rows.find((item) => item.kind === kind);
    if (!result) throw new NotFoundException("该接口没有健康检查适配器");
    await this.audit(actor, "SYSTEM_CONFIG_INTEGRATION_CHECK", "Integration", result.id, { state: result.state });
    return this.integrationView(result);
  }

  policies() {
    return this.aiTasks.policies();
  }

  updatePolicies(rows: unknown[], actor: string) {
    return this.aiTasks.updatePolicies(rows, actor);
  }

  notification() {
    return this.wecom.status();
  }

  configureNotification(input: JsonRow) {
    return this.wecom.configure(input);
  }

  runners() {
    return this.aiTasks.runners();
  }

  async previewImport(text: string, actor: string) {
    if (!text.trim()) throw new BadRequestException("配置文件内容为空");
    if (Buffer.byteLength(text, "utf8") > 256 * 1024) throw new BadRequestException("配置文件不能超过256KB");
    const entries = this.parseImport(text);
    if (!entries.length) throw new BadRequestException("未识别到可导入配置项");
    const token = encryptIntegrationValue(JSON.stringify({
      expiresAt: Date.now() + 15 * 60_000,
      entries,
    }));
    await this.audit(actor, "SYSTEM_CONFIG_IMPORT_PREVIEW", "SystemConfig", "IMPORT", {
      count: entries.length,
      supported: entries.filter((item) => item.targetType !== "UNSUPPORTED").length,
    });
    return {
      importToken: token,
      entries: entries.map(({ value: _value, ...item }) => ({
        ...item,
        configured: Boolean(_value),
      })),
      expiresInSeconds: 900,
    };
  }

  async applyImport(importToken: string, overwrite: boolean, actor: string) {
    const raw = decryptIntegrationValue(importToken);
    let payload: { expiresAt?: number; entries?: ImportTarget[] } = {};
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      throw new BadRequestException("配置导入令牌无效");
    }
    if (!payload.expiresAt || payload.expiresAt < Date.now()) throw new BadRequestException("配置导入令牌已过期");
    const supported = (payload.entries || []).filter((item) =>
      item.integrationKind && item.targetKey && item.targetType !== "UNSUPPORTED" && item.value,
    );
    const grouped = new Map<IntegrationKind, ImportTarget[]>();
    for (const item of supported) {
      const list = grouped.get(item.integrationKind!) || [];
      list.push(item);
      grouped.set(item.integrationKind!, list);
    }
    let applied = 0;
    let skipped = 0;
    for (const [kind, items] of grouped) {
      const existing = await this.prisma.integration.findUnique({ where: { kind } });
      const publicConfig = row(existing?.publicConfig);
      const secrets = readIntegrationSecret(existing?.secretRef);
      for (const item of items) {
        if (item.targetType === "PUBLIC") {
          const current = deepValue(publicConfig, item.targetKey!);
          if (!overwrite && String(current || "").trim()) {
            skipped += 1;
            continue;
          }
          assignDeep(publicConfig, item.targetKey!, item.value);
        } else {
          const secretRow = row(secrets);
          const current = deepValue(secretRow, item.targetKey!);
          if (!overwrite && String(current || "").trim()) {
            skipped += 1;
            continue;
          }
          assignDeep(secretRow, item.targetKey!, item.value);
        }
        applied += 1;
      }
      await this.prisma.integration.upsert({
        where: { kind },
        create: {
          kind,
          displayName: this.displayName(kind),
          state: "CONFIGURED",
          capabilities: [],
          publicConfig: publicConfig as Prisma.InputJsonValue,
          secretRef: writeIntegrationSecret(secrets),
          message: "配置文件已导入，待健康检查",
        },
        update: {
          state: "CONFIGURED",
          publicConfig: publicConfig as Prisma.InputJsonValue,
          secretRef: writeIntegrationSecret(secrets),
          message: "配置文件已导入，待健康检查",
        },
      });
    }
    await this.audit(actor, "SYSTEM_CONFIG_IMPORT_APPLY", "SystemConfig", "IMPORT", {
      applied,
      skipped,
      groups: Array.from(grouped.keys()),
      overwrite,
    });
    return { applied, skipped, unsupported: (payload.entries || []).length - supported.length };
  }

  logs() {
    return this.prisma.auditLog.findMany({
      where: {
        action: {
          in: [
            "SYSTEM_CONFIG_INTEGRATION_UPDATE",
            "SYSTEM_CONFIG_INTEGRATION_CHECK",
            "SYSTEM_CONFIG_IMPORT_PREVIEW",
            "SYSTEM_CONFIG_IMPORT_APPLY",
            "AI_TASK_POLICY_UPDATE",
            "VIDEO_PROVIDER_UPDATE",
            "VIDEO_PROVIDER_CREATE",
            "VIDEO_PROVIDER_CHECK",
            "AI_RUNNER_CREATE",
            "AI_RUNNER_TOKEN_ROTATE",
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  private stateSummary(items: Array<{ state: string }>) {
    return {
      total: items.length,
      healthy: items.filter((item) => item.state === "HEALTHY").length,
      configured: items.filter((item) => item.state === "CONFIGURED").length,
      error: items.filter((item) => ["ERROR", "DEGRADED"].includes(item.state)).length,
      unconfigured: items.filter((item) => item.state === "UNCONFIGURED").length,
    };
  }

  private bootstrapStatus() {
    return [
      { key: "DATABASE", name: "业务数据库", configured: Boolean(process.env.DATABASE_URL), editable: false },
      { key: "AUTH_SECRET", name: "后台加密根密钥", configured: Boolean(process.env.OPS_AUTH_SECRET || process.env.OPS_ADMIN_TOKEN), editable: false },
      { key: "PUBLIC_BASE_URL", name: "API公开地址", configured: Boolean(opsConfig.publicBaseUrl), editable: false, value: opsConfig.publicBaseUrl },
      { key: "ADMIN_WEB_BASE_URL", name: "总管理后台地址", configured: Boolean(opsConfig.adminWebBaseUrl), editable: false, value: opsConfig.adminWebBaseUrl },
      { key: "WORKDIR", name: "本地派生文件目录", configured: Boolean(opsConfig.derivedOutputDir), editable: false, value: opsConfig.derivedOutputDir },
    ];
  }

  private integrationView<T extends { secretRef: string | null; publicConfig: Prisma.JsonValue }>(integration: T) {
    const { secretRef: _secretRef, ...visible } = integration;
    const secrets = readIntegrationSecret(_secretRef);
    return {
      ...visible,
      publicConfig: row(visible.publicConfig),
      secretConfigured: configuredObject(row(secrets)),
      secretKeys: this.secretKeys(row(secrets)),
    };
  }

  private secretKeys(input: JsonRow, prefix = ""): string[] {
    const keys: string[] = [];
    for (const [key, value] of Object.entries(input)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) keys.push(...this.secretKeys(value as JsonRow, path));
      else if (String(value || "").trim()) keys.push(path);
    }
    return keys;
  }

  private mergeSecrets(target: IntegrationSecretBundle, input: JsonRow) {
    const targetRow = target as JsonRow;
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || value === null || String(value).trim() === "") continue;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        targetRow[key] = { ...row(targetRow[key]), ...row(value) };
      } else {
        targetRow[key] = String(value);
      }
    }
  }

  private parseImport(text: string): ImportTarget[] {
    const entries: ImportTarget[] = [];
    let section = "未分类";
    for (const rawLine of text.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || /^[-=#]{3,}$/u.test(line)) continue;
      const match = line.match(/^([^:=：]{1,80})\s*[:=：]\s*(.+)$/u);
      if (!match) {
        if (line.length <= 40 && !/^https?:\/\//iu.test(line)) section = line.replace(/[：:]$/u, "").trim();
        continue;
      }
      const label = match[1].trim();
      const value = match[2].trim();
      const mapped = this.importMapping(section, label);
      entries.push({
        id: `config-${entries.length + 1}`,
        section,
        label,
        value,
        ...mapped,
      });
    }
    return entries;
  }

  private importMapping(section: string, label: string): Omit<ImportTarget, "id" | "section" | "label" | "value"> {
    const context = `${section} ${label}`.toLowerCase();
    if (/企业id|corp.?id/u.test(context)) return { integrationKind: "WECOM", targetType: "PUBLIC", targetKey: "corpId" };
    if (/agent.?id/u.test(context)) return { integrationKind: "WECOM", targetType: "PUBLIC", targetKey: "agentId" };
    if (/企业微信|企微/u.test(section) && /secret/u.test(label.toLowerCase())) return { integrationKind: "WECOM", targetType: "SECRET", targetKey: "wecomAppSecret" };
    if (/抖音/u.test(section) && /client.?key/u.test(context)) return { integrationKind: "DOUYIN", targetType: "PUBLIC", targetKey: "clientKey" };
    if (/抖音/u.test(section) && /client.?secret/u.test(context)) return { integrationKind: "DOUYIN", targetType: "SECRET", targetKey: "douyin.clientSecret" };
    if (/微信支付/u.test(context) && /商户号|merchant/u.test(context)) return { integrationKind: "SAIDIAN_MALL", targetType: "PUBLIC", targetKey: "wechatPay.merchantId" };
    if (/微信支付/u.test(context) && /密钥|secret|key/u.test(label.toLowerCase())) return { integrationKind: "SAIDIAN_MALL", targetType: "SECRET", targetKey: "credentials.wechatPayKey" };
    if (/公众号/u.test(section) && /app.?id|app.?key/u.test(context)) return { integrationKind: "WECHAT_OFFICIAL", targetType: "PUBLIC", targetKey: "appId" };
    if (/公众号/u.test(section) && /secret/u.test(label.toLowerCase())) return { integrationKind: "WECHAT_OFFICIAL", targetType: "SECRET", targetKey: "credentials.appSecret" };
    if (/回调|callback/u.test(context)) return { integrationKind: "WECOM", targetType: "PUBLIC", targetKey: "oauthCallbackUrl" };
    if (/后台|管理/u.test(section) && /url|地址/u.test(context)) return { integrationKind: "SAIDIAN_MALL", targetType: "PUBLIC", targetKey: "adminUrl" };
    if (/后台|管理/u.test(section) && /账号|用户名|username/u.test(context)) return { integrationKind: "SAIDIAN_MALL", targetType: "SECRET", targetKey: "credentials.adminUsername" };
    if (/后台|管理/u.test(section) && /密码|password/u.test(context)) return { integrationKind: "SAIDIAN_MALL", targetType: "SECRET", targetKey: "credentials.adminPassword" };
    return { targetType: "UNSUPPORTED" };
  }

  private kind(value: string): IntegrationKind {
    const normalized = String(value || "").trim().toUpperCase();
    if (!integrationKinds.has(normalized)) throw new BadRequestException("接口类型无效");
    return normalized as IntegrationKind;
  }

  private displayName(kind: IntegrationKind) {
    const names: Partial<Record<IntegrationKind, string>> = {
      DOUYIN: "抖音",
      TIKTOK: "TikTok",
      AMAZON: "Amazon",
      SHOPIFY: "Shopify",
      WECHAT_CHANNELS: "视频号",
      XIAOHONGSHU: "小红书",
      WECHAT_OFFICIAL: "微信公众号",
      WECOM: "企业微信",
      TMALL: "天猫",
      JD: "京东",
      PINDUODUO: "拼多多",
      SAIDIAN_MALL: "赛电自有商城",
      JUSHUITAN: "聚水潭",
      FEIGUA: "飞瓜",
      WEB_SEARCH: "全网搜索",
      LOCAL_ASSET: "本地素材库",
      WECOM_DRIVE: "企微网盘",
      HELP_CENTER: "客服帮助网站",
      EVIDENCE_WORKBOOK: "宣传证据底表",
      ALIYUN_OSS: "阿里云OSS",
    };
    return names[kind] || kind;
  }

  private audit(actor: string, action: string, entityType: string, entityId: string, after: JsonRow) {
    return this.prisma.auditLog.create({
      data: {
        actor,
        action,
        entityType,
        entityId,
        after: after as Prisma.InputJsonValue,
      },
    });
  }
}
