import { Injectable } from "@nestjs/common";
import { IntegrationKind, Prisma, WorkItemType } from "@prisma/client";
import { PlatformRegistry } from "./platform/platform.adapters";
import { PrismaService } from "./prisma.service";
import { makeIdempotencyKey, safeJson } from "./utils";

const humanKeywords = [
  "投诉", "退货", "退款", "售后", "费用", "收费", "地址", "发货", "物流", "治疗", "诊断", "医院", "准确", "血压异常", "心电异常", "疾病",
];

function classifyComment(text: string): { category: string; riskReasons: string[] } {
  const risks = humanKeywords.filter((keyword) => text.includes(keyword));
  if (/退货|退款|售后/.test(text)) return { category: "售后", riskReasons: risks };
  if (/发货|物流|地址/.test(text)) return { category: "订单物流", riskReasons: risks };
  if (/治疗|诊断|医院|准确|异常|疾病/.test(text)) return { category: "健康边界", riskReasons: risks };
  if (/价格|多少钱|优惠|费用/.test(text)) return { category: "价格权益", riskReasons: risks };
  if (/怎么用|连接|充电|佩戴|设置/.test(text)) return { category: "使用指导", riskReasons: risks };
  return { category: "一般咨询", riskReasons: risks };
}

@Injectable()
export class MonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platforms: PlatformRegistry,
  ) {}

  async checkIntegrations() {
    const results = [];
    for (const [kind, adapter] of this.platforms.all()) {
      const startedAt = Date.now();
      const health = await adapter.healthCheck();
      const checkedAt = new Date();
      const integration = await this.prisma.integration.upsert({
        where: { kind: kind as IntegrationKind },
        create: {
          kind: kind as IntegrationKind,
          displayName: this.displayName(kind),
          state: health.state,
          capabilities: health.capabilities,
          capabilityStatus: health.capabilityStates,
          message: health.message,
          lastCheckedAt: checkedAt,
          lastSuccessAt: health.state === "HEALTHY" ? checkedAt : undefined,
        },
        update: {
          state: health.state,
          capabilities: health.capabilities,
          capabilityStatus: health.capabilityStates,
          message: health.message,
          lastCheckedAt: checkedAt,
          lastSuccessAt: health.state === "HEALTHY" ? checkedAt : undefined,
        },
      });
      await this.prisma.dataSourceHealth.create({
        data: {
          integrationId: integration.id,
          state: health.state,
          capabilities: health.capabilityStates,
          message: health.message,
          latencyMs: Date.now() - startedAt,
          unavailableFields: health.state === "UNCONFIGURED" ? ["账号、令牌或接口权限未配置"] : [],
          checkedAt,
        },
      });
      results.push(integration);
    }
    return results;
  }

  private displayName(kind: string): string {
    const names: Record<string, string> = {
      DOUYIN: "抖音", WECHAT_CHANNELS: "视频号", XIAOHONGSHU: "小红书", WECHAT_OFFICIAL: "微信公众号",
      TIKTOK: "TikTok", AMAZON: "Amazon", SHOPIFY: "Shopify",
      WECOM: "企业微信", TMALL: "天猫", JD: "京东", PINDUODUO: "拼多多", SAIDIAN_MALL: "赛电自有商城",
      JUSHUITAN: "聚水潭", FEIGUA: "飞瓜", WEB_SEARCH: "全网搜索", LOCAL_ASSET: "本地素材库",
      WECOM_DRIVE: "企微网盘", HELP_CENTER: "客服帮助网站", EVIDENCE_WORKBOOK: "宣传证据底表",
    };
    return names[kind] || kind;
  }

  async syncShopQueue(): Promise<{ fetched: number; overdue: number }> {
    let fetched = 0;
    let overdue = 0;
    for (const [kind, adapter] of this.platforms.all()) {
      if (!adapter.capabilities().includes("shop")) continue;
      const integration = await this.prisma.integration.findUnique({ where: { kind: kind as IntegrationKind } });
      if (!integration) continue;
      const items = await adapter.fetchShopQueue();
      for (const item of items) {
        const dueAt = item.dueAt ? new Date(item.dueAt) : undefined;
        const isOverdue = Boolean(dueAt && dueAt < new Date() && !/完成|关闭|CLOSED|DONE|SUCCEEDED/i.test(item.status));
        await this.prisma.shopWorkItem.upsert({
          where: { integrationId_remoteId_type: { integrationId: integration.id, remoteId: item.remoteId, type: item.type as WorkItemType } },
          create: {
            integrationId: integration.id, remoteId: item.remoteId, type: item.type as WorkItemType, status: item.status,
            summary: item.summary, createdAtRemote: new Date(item.createdAt), dueAt, overdue: isOverdue, sourceSnapshot: item as unknown as Prisma.InputJsonValue,
          },
          update: { status: item.status, summary: item.summary, dueAt, overdue: isOverdue, sourceSnapshot: item as unknown as Prisma.InputJsonValue },
        });
        fetched += 1;
        if (isOverdue) {
          overdue += 1;
          await this.ensureAlert({
            level: "WARNING", category: "SHOP_SLA", title: `${this.displayName(kind)}处理项目已超时`, message: item.summary,
            sourceType: "ShopWorkItem", sourceId: `${integration.id}:${item.remoteId}:${item.type}`,
          });
        }
      }
    }
    return { fetched, overdue };
  }

  async syncComments(): Promise<{ fetched: number; suggested: number; escalated: number }> {
    let fetched = 0;
    let suggested = 0;
    let escalated = 0;
    const knowledge = await this.prisma.knowledgeEntry.findMany({
      where: { status: "READY", audience: "customer", reply: { not: null } },
      take: 500,
    });
    for (const [kind, adapter] of this.platforms.all()) {
      if (!adapter.capabilities().includes("comments")) continue;
      const integration = await this.prisma.integration.findUnique({ where: { kind: kind as IntegrationKind } });
      if (!integration) continue;
      const comments = await adapter.fetchComments();
      for (const comment of comments) {
        const classification = classifyComment(comment.text);
        const normalized = comment.text.replace(/[？?！!，,。\s]/g, "");
        const match = knowledge.find((entry) => {
          const title = entry.title.replace(/[？?！!，,。\s]/g, "");
          return title.length >= 4 && (normalized.includes(title) || title.includes(normalized));
        });
        const confidence = match ? 0.92 : 0.45;
        const requiresHuman = classification.riskReasons.length > 0 || confidence < 0.9;
        const record = await this.prisma.commentRecord.upsert({
          where: { integrationId_remoteCommentId: { integrationId: integration.id, remoteCommentId: comment.commentId } },
          create: {
            integrationId: integration.id, remoteContentId: comment.remoteId, remoteCommentId: comment.commentId,
            authorName: comment.authorName, text: comment.text, category: classification.category, confidence,
            knowledgeRef: match?.id, suggestedReply: match?.reply, riskReasons: classification.riskReasons,
            requiresHuman, status: "PENDING", createdAtRemote: new Date(comment.createdAt),
          },
          update: {
            category: classification.category, confidence, knowledgeRef: match?.id, suggestedReply: match?.reply,
            riskReasons: classification.riskReasons, requiresHuman,
          },
        });
        if (match?.reply) {
          await this.prisma.replyJob.upsert({
            where: { idempotencyKey: makeIdempotencyKey("reply", integration.id, comment.commentId) },
            create: {
              commentId: record.id, idempotencyKey: makeIdempotencyKey("reply", integration.id, comment.commentId),
              replyText: match.reply, confidence, knowledgeRef: match.id, status: "PENDING",
            },
            update: {},
          });
          suggested += 1;
        }
        if (requiresHuman) escalated += 1;
        fetched += 1;
      }
    }
    return { fetched, suggested, escalated };
  }

  async approveReply(replyJobId: string, actor: string) {
    const job = await this.prisma.replyJob.findUnique({ where: { id: replyJobId }, include: { comment: { include: { integration: true } } } });
    if (!job) throw new Error("回复任务不存在");
    await this.prisma.replyJob.update({ where: { id: job.id }, data: { status: "RUNNING", approvedBy: actor, approvedAt: new Date(), attempts: { increment: 1 } } });
    const adapter = this.platforms.get(job.comment.integration.kind as never);
    const receipt = await adapter.replyComment(job.comment.remoteCommentId, job.replyText, job.idempotencyKey);
    await this.prisma.$transaction([
      this.prisma.replyJob.update({ where: { id: job.id }, data: { status: receipt.success ? "SUCCEEDED" : "FAILED", platformReceipt: receipt as unknown as Prisma.InputJsonValue, lastError: receipt.success ? null : receipt.message } }),
      this.prisma.commentRecord.update({ where: { id: job.commentId }, data: { status: receipt.success ? "REPLIED" : "REPLY_FAILED" } }),
      this.prisma.auditLog.create({ data: { actor, action: "COMMENT_REPLY", entityType: "ReplyJob", entityId: job.id, after: receipt as unknown as Prisma.InputJsonValue } }),
    ]);
    return receipt;
  }

  async syncLive(): Promise<{ rooms: number; issues: number }> {
    let rooms = 0;
    let issues = 0;
    for (const [kind, adapter] of this.platforms.all()) {
      if (!adapter.capabilities().includes("live")) continue;
      const integration = await this.prisma.integration.findUnique({ where: { kind: kind as IntegrationKind } });
      if (!integration) continue;
      const snapshots = await adapter.fetchLiveSessions();
      for (const snapshot of snapshots) {
        const issueSummary: string[] = [];
        if (snapshot.online !== undefined && snapshot.online < 5) issueSummary.push("在线人数低于5人");
        if (!snapshot.products.length) issueSummary.push("未获取到讲解商品");
        await this.prisma.liveSession.upsert({
          where: { integrationId_remoteRoomId: { integrationId: integration.id, remoteRoomId: snapshot.roomId } },
          create: {
            integrationId: integration.id, remoteRoomId: snapshot.roomId, title: snapshot.title, status: "LIVE",
            startedAt: new Date(), lastCapturedAt: new Date(snapshot.capturedAt), latestSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            issueSummary,
          },
          update: { title: snapshot.title, status: "LIVE", lastCapturedAt: new Date(snapshot.capturedAt), latestSnapshot: snapshot as unknown as Prisma.InputJsonValue, issueSummary },
        });
        if (issueSummary.length) issues += 1;
        rooms += 1;
      }
    }
    return { rooms, issues };
  }

  async syncMetrics(input: Record<string, unknown> = {}): Promise<{ snapshots: number }> {
    let snapshots = 0;
    const requestedPublishJobId = String(input.publishJobId || "").trim();
    const requestedCheckpointHours = Number(input.checkpointHours || 0);
    for (const [kind, adapter] of this.platforms.all()) {
      if (!adapter.capabilities().includes("metrics")) continue;
      const integration = await this.prisma.integration.findUnique({ where: { kind: kind as IntegrationKind } });
      if (!integration) continue;
      const jobs = await this.prisma.publishJob.findMany({
        where: {
          ...(requestedPublishJobId ? { id: requestedPublishJobId } : {}),
          integrationId: integration.id,
          status: "SUCCEEDED",
          remoteId: { not: null },
          publishedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        include: {
          contentPlan: {
            include: {
              keywordRelations: true,
              contentAssets: true,
            },
          },
        },
        orderBy: { publishedAt: "desc" },
        take: 500,
      });
      const points = await adapter.fetchMetrics(jobs.flatMap((job) => job.remoteId ? [job.remoteId] : []));
      for (const point of points) {
        const publishJob = jobs.find((job) => job.remoteId === point.remoteId);
        await this.prisma.metricSnapshot.upsert({
          where: { integrationId_remoteId_capturedAt: { integrationId: integration.id, remoteId: point.remoteId, capturedAt: new Date(point.capturedAt) } },
          create: {
            integrationId: integration.id, publishJobId: publishJob?.id, remoteId: point.remoteId, capturedAt: new Date(point.capturedAt),
            views: point.views, completionRate: point.completionRate, likes: point.likes, comments: point.comments,
            shares: point.shares, saves: point.saves, consultations: point.consultations, orders: point.orders,
            unavailableFields: point.unavailableFields, raw: point as unknown as Prisma.InputJsonValue,
          },
          update: {
            views: point.views, completionRate: point.completionRate, likes: point.likes, comments: point.comments,
            shares: point.shares, saves: point.saves, consultations: point.consultations, orders: point.orders,
            unavailableFields: point.unavailableFields, raw: point as unknown as Prisma.InputJsonValue,
          },
        });
        if (publishJob?.publishedAt && publishJob.contentPlan.kind === "VIDEO") {
          const capturedAt = new Date(point.capturedAt);
          const elapsedHours = Math.max(0, (capturedAt.getTime() - publishJob.publishedAt.getTime()) / 3_600_000);
          const checkpointHours = [1, 24, 72, 168].filter((checkpoint) => elapsedHours >= checkpoint).at(-1);
          if ([1, 24, 72, 168].includes(requestedCheckpointHours)) {
            const historyPoint = {
              checkpointHours: requestedCheckpointHours,
              capturedAt: capturedAt.toISOString(),
              views: point.views ?? null,
              likes: point.likes ?? null,
              comments: point.comments ?? null,
            };
            const entries = await this.prisma.contentLibraryEntry.findMany({
              where: { contentPlanId: publishJob.contentPlanId, category: "VIDEO", visibilityStatus: "ACTIVE" },
              select: { id: true, metricHistory: true },
            });
            for (const entry of entries) {
              const history = Array.isArray(entry.metricHistory) ? entry.metricHistory as Array<Record<string, unknown>> : [];
              await this.prisma.contentLibraryEntry.update({
                where: { id: entry.id },
                data: {
                  latestViews: point.views ?? null,
                  latestLikes: point.likes ?? null,
                  latestComments: point.comments ?? null,
                  latestMetricAt: capturedAt,
                  latestMetricCheckpointHours: requestedCheckpointHours,
                  metricHistory: [...history.filter((item) => Number(item.checkpointHours) !== requestedCheckpointHours), historyPoint]
                    .sort((left, right) => Number(left.checkpointHours) - Number(right.checkpointHours)) as unknown as Prisma.InputJsonValue,
                },
              });
            }
          }
          if (checkpointHours) {
            const checkpoint = {
              capturedAt: capturedAt.toISOString(),
              views: point.views ?? null,
              completionRate: point.completionRate ?? null,
              likes: point.likes ?? null,
              comments: point.comments ?? null,
              shares: point.shares ?? null,
              saves: point.saves ?? null,
              consultations: point.consultations ?? null,
              orders: point.orders ?? null,
            };
            for (const relation of publishJob.contentPlan.keywordRelations) {
              const metrics = relation.metrics && typeof relation.metrics === "object" && !Array.isArray(relation.metrics)
                ? relation.metrics as Record<string, unknown>
                : {};
              await this.prisma.smartKeywordContentRelation.update({
                where: { id: relation.id },
                data: { metrics: { ...metrics, [`h${checkpointHours}`]: checkpoint } as unknown as Prisma.InputJsonValue },
              });
            }
            for (const contentAsset of publishJob.contentPlan.contentAssets) {
              const usage = await this.prisma.assetUsage.findFirst({
                where: {
                  assetId: contentAsset.assetId,
                  businessObjectType: "CONTENT_PLAN",
                  businessObjectId: publishJob.contentPlanId,
                  usageType: "VIDEO_FACTORY_SOURCE",
                },
              });
              const existingAssetMetric = await this.prisma.assetMetricSnapshot.findFirst({
                where: {
                  assetId: contentAsset.assetId,
                  usageId: usage?.id || null,
                  externalId: point.remoteId,
                  capturedAt,
                },
              });
              if (!existingAssetMetric) {
                await this.prisma.assetMetricSnapshot.create({
                  data: {
                    assetId: contentAsset.assetId,
                    usageId: usage?.id,
                    platform: kind as IntegrationKind,
                    accountId: publishJob.platformAccountId,
                    externalId: point.remoteId,
                    capturedAt,
                    views: point.views,
                    likes: point.likes,
                    comments: point.comments,
                    shares: point.shares,
                    saves: point.saves,
                    consultations: point.consultations,
                    orders: point.orders,
                    unavailableFields: point.unavailableFields,
                    raw: point as unknown as Prisma.InputJsonValue,
                  },
                });
              }
            }
            const sourceSignals = Array.isArray(publishJob.contentPlan.sourceSignals)
              ? publishJob.contentPlan.sourceSignals
              : [];
            const feedback = {
              type: "VIDEO_FEEDBACK",
              checkpointHours,
              platform: kind,
              remoteId: point.remoteId,
              predictedScore: publishJob.contentPlan.score,
              actual: checkpoint,
            };
            await this.prisma.contentPlan.update({
              where: { id: publishJob.contentPlanId },
              data: {
                sourceSignals: [
                  ...sourceSignals.filter((value) => {
                    if (!value || typeof value !== "object" || Array.isArray(value)) return true;
                    const row = value as Record<string, unknown>;
                    return row.type !== "VIDEO_FEEDBACK" || row.checkpointHours !== checkpointHours;
                  }),
                  feedback,
                ] as unknown as Prisma.InputJsonValue,
              },
            });
            const interactionCount = Number(point.likes || 0) + Number(point.comments || 0) + Number(point.shares || 0) + Number(point.saves || 0);
            await this.prisma.contentOptimizationSuggestion.upsert({
              where: { contentPlanId_checkpointHours: { contentPlanId: publishJob.contentPlanId, checkpointHours } },
              create: {
                contentPlanId: publishJob.contentPlanId,
                checkpointHours,
                summary: `${checkpointHours}小时表现已回流，等待人工确认优化方向`,
                evidence: checkpoint,
                recommendations: [{
                  action: "REVIEW_TOPIC_PREDICTION",
                  message: `对比选题预测${publishJob.contentPlan.score}分与实际播放${point.views || 0}、互动${interactionCount}、订单${point.orders || 0}`,
                }],
                rulePatch: {},
              },
              update: {
                summary: `${checkpointHours}小时表现已更新，等待人工确认优化方向`,
                evidence: checkpoint,
                recommendations: [{
                  action: "REVIEW_TOPIC_PREDICTION",
                  message: `对比选题预测${publishJob.contentPlan.score}分与实际播放${point.views || 0}、互动${interactionCount}、订单${point.orders || 0}`,
                }],
              },
            });
          }
        }
        snapshots += 1;
      }
    }
    return { snapshots };
  }

  private async ensureAlert(input: { level: "INFO" | "WARNING" | "CRITICAL"; category: string; title: string; message: string; sourceType: string; sourceId?: string }) {
    const existing = await this.prisma.alert.findFirst({ where: { sourceType: input.sourceType, sourceId: input.sourceId, status: "OPEN", title: input.title } });
    if (!existing) await this.prisma.alert.create({ data: input });
  }
}
