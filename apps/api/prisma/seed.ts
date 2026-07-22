import "dotenv/config";
import { IntegrationKind, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const integrations: Array<{
  kind: IntegrationKind;
  displayName: string;
  capabilities: string[];
}> = [
  { kind: "DOUYIN", displayName: "抖音", capabilities: [] },
  { kind: "WECHAT_CHANNELS", displayName: "视频号", capabilities: [] },
  { kind: "XIAOHONGSHU", displayName: "小红书", capabilities: [] },
  { kind: "WECHAT_OFFICIAL", displayName: "微信公众号", capabilities: [] },
  { kind: "WECOM", displayName: "企业微信", capabilities: [] },
  { kind: "TMALL", displayName: "天猫", capabilities: [] },
  { kind: "JD", displayName: "京东", capabilities: [] },
  { kind: "PINDUODUO", displayName: "拼多多", capabilities: [] },
  { kind: "SAIDIAN_MALL", displayName: "赛电自有商城", capabilities: [] },
  { kind: "JUSHUITAN", displayName: "聚水潭", capabilities: [] },
  { kind: "FEIGUA", displayName: "飞瓜", capabilities: [] },
  { kind: "WEB_SEARCH", displayName: "全网搜索", capabilities: [] },
  { kind: "LOCAL_ASSET", displayName: "本地素材库", capabilities: ["assets"] },
  { kind: "WECOM_DRIVE", displayName: "企微网盘", capabilities: [] },
  { kind: "HELP_CENTER", displayName: "客服帮助网站", capabilities: ["search"] },
  { kind: "EVIDENCE_WORKBOOK", displayName: "宣传证据底表", capabilities: ["search"] },
  { kind: "ALIYUN_OSS", displayName: "阿里云 OSS 素材库", capabilities: ["assets"] },
];

async function main() {
  for (const integration of integrations) {
    await prisma.integration.upsert({
      where: { kind: integration.kind },
      create: {
        ...integration,
        state: "UNCONFIGURED",
        message: "未配置",
      },
      update: { displayName: integration.displayName },
    });
  }
  await prisma.sopVersion.upsert({
    where: { kind_version: { kind: "CONTENT_REVIEW", version: 1 } },
    create: {
      kind: "CONTENT_REVIEW",
      version: 1,
      status: "ACTIVE",
      proposedBy: "系统初始化",
      approvedBy: "系统初始化",
      approvedAt: new Date(),
      effectiveAt: new Date(),
      changeNote: "前两周所有发布与评论回复均需人工审核",
      rules: {
        approvalRequired: true,
        autoPublishWhitelist: [],
        autoReplyConfidence: 0.9,
        forceHumanCategories: ["健康边界", "售后", "订单物流", "价格权益"],
      },
    },
    update: {},
  });
}

main()
  .finally(async () => prisma.$disconnect());
