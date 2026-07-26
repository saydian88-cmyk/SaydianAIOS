import "dotenv/config";
import { IntegrationKind, PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

const roles = [
  { code: "SUPER_ADMIN", name: "超级管理员", portal: "ADMIN", permissions: ["*"], dataScope: "ALL" },
  { code: "SYSTEM_ADMIN", name: "系统管理员", portal: "ADMIN", permissions: ["SYSTEM_VIEW", "SYSTEM_CONFIG", "ROLE_MANAGE", "MODEL_CONFIG", "SCHEDULE_MANAGE"], dataScope: "ALL" },
  { code: "CONTENT_MANAGER", name: "内容负责人", portal: "ADMIN", permissions: ["SYSTEM_VIEW", "TASK_MANAGE", "TASK_REVIEW", "KNOWLEDGE_REVIEW", "ASSET_REVIEW", "CONTENT_REVIEW"], dataScope: "ALL" },
  { code: "OPERATIONS_MANAGER", name: "运营负责人", portal: "ADMIN", permissions: ["SYSTEM_VIEW", "TASK_MANAGE", "TASK_REVIEW", "LEDGER_VIEW", "ANALYTICS_VIEW", "MALL_MANAGE"], dataScope: "ALL" },
  { code: "CONTENT_OPERATOR", name: "运营", portal: "WORKBENCH", permissions: ["TASK_EXECUTE", "CONTENT_SUBMIT", "ASSET_UPLOAD", "KNOWLEDGE_SUBMIT", "MALL_EMPLOYEE"], dataScope: "SELF" },
  { code: "VIDEO_SPECIALIST", name: "视频专员", portal: "WORKBENCH", permissions: ["TASK_EXECUTE", "VIDEO_EXECUTE", "ASSET_UPLOAD", "CONTENT_SUBMIT"], dataScope: "SELF" },
  { code: "ASSET_CURATOR", name: "知识素材整理员", portal: "WORKBENCH", permissions: ["TASK_EXECUTE", "ASSET_UPLOAD", "ASSET_CURATE", "KNOWLEDGE_SUBMIT"], dataScope: "SELF" },
  { code: "DESIGNER", name: "设计", portal: "WORKBENCH", permissions: ["TASK_EXECUTE", "DESIGN_EXECUTE", "ASSET_UPLOAD", "CONTENT_SUBMIT"], dataScope: "SELF" },
  { code: "CUSTOMER_SERVICE", name: "客服", portal: "WORKBENCH", permissions: ["TASK_EXECUTE", "KNOWLEDGE_SUBMIT", "FAQ_SUBMIT", "MALL_EMPLOYEE"], dataScope: "SELF" },
  { code: "LIVE_HOST", name: "主播", portal: "WORKBENCH", permissions: ["TASK_EXECUTE", "LIVE_LEARN", "LIVE_EXECUTE", "LIVE_REVIEW_SUBMIT", "KNOWLEDGE_VIEW"], dataScope: "SELF" },
] as const;

const taskTemplates = [
  { code: "DAILY_VIDEO", name: "每日视频制作", category: "VIDEO", requiredRoleCode: "VIDEO_SPECIALIST", description: "按执行包完成拍摄、剪辑并提交审核", checklist: ["查看参考视频", "确认Hook和镜头", "完成拍摄剪辑", "上传成片", "提交审核"], submissionSchema: { fields: ["assetId", "summary"] }, defaultDueHours: 10 },
  { code: "VIRAL_REMAKE", name: "爆款仿拍", category: "VIDEO", requiredRoleCode: "VIDEO_SPECIALIST", description: "根据爆款拆解完成赛电版本仿拍", checklist: ["查看拆解", "确认产品和人群", "完成补拍", "提交成片"], submissionSchema: { fields: ["assetId", "changes", "summary"] }, defaultDueHours: 24 },
  { code: "KNOWLEDGE_CURATE", name: "知识素材整理", category: "KNOWLEDGE", requiredRoleCode: "ASSET_CURATOR", description: "补齐分类、证据和适用型号后提交审核", checklist: ["核对来源", "补齐分类", "关联产品", "提交审核"], submissionSchema: { fields: ["knowledgeId", "summary"] }, defaultDueHours: 24 },
  { code: "DESIGN_ASSET", name: "设计素材制作", category: "DESIGN", requiredRoleCode: "DESIGNER", description: "按内容任务制作封面、主图或配图", checklist: ["确认尺寸", "调用品牌规范", "完成设计", "上传源文件与导出图"], submissionSchema: { fields: ["assetIds", "summary"] }, defaultDueHours: 24 },
  { code: "FAQ_IMPROVE", name: "客服FAQ完善", category: "CUSTOMER_SERVICE", requiredRoleCode: "CUSTOMER_SERVICE", description: "将高频问题整理为可审核FAQ", checklist: ["核对真实问题", "关联产品", "整理标准回复", "提交审核"], submissionSchema: { fields: ["knowledgeId", "frequency", "summary"] }, defaultDueHours: 24 },
  { code: "LIVE_LEARNING", name: "直播知识学习", category: "LIVE_LEARNING", requiredRoleCode: "LIVE_HOST", description: "学习产品、话术和直播SOP并完成确认", checklist: ["学习产品知识", "学习合规话术", "学习本场脚本", "完成确认"], submissionSchema: { fields: ["knowledgeIds", "summary"] }, defaultDueHours: 24 },
  { code: "LIVE_PRECHECK", name: "开播前检查", category: "LIVE", requiredRoleCode: "LIVE_HOST", description: "完成商品、话术、设备和优惠节奏检查", checklist: ["确认商品和库存", "确认直播脚本", "检查设备", "确认优惠节奏", "确认风险词"], submissionSchema: { fields: ["sessionId", "checklist", "summary"] }, defaultDueHours: 4 },
  { code: "LIVE_REVIEW", name: "直播复盘", category: "LIVE_REVIEW", requiredRoleCode: "LIVE_HOST", description: "提交直播数据、问题和下一场改进计划", checklist: ["录入直播数据", "标记流失节点", "总结有效话术", "填写优化动作"], submissionSchema: { fields: ["sessionId", "metrics", "problems", "improvements", "summary"] }, defaultDueHours: 12 },
] as const;

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

const integrations: Array<{
  kind: IntegrationKind;
  displayName: string;
  capabilities: string[];
  region?: string;
}> = [
  { kind: "DOUYIN", displayName: "抖音", capabilities: [] },
  { kind: "TIKTOK", displayName: "TikTok", capabilities: [], region: "GLOBAL" },
  { kind: "AMAZON", displayName: "Amazon", capabilities: [], region: "US" },
  { kind: "SHOPIFY", displayName: "Shopify", capabilities: [], region: "US" },
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
      update: { displayName: integration.displayName, region: integration.region ?? "CN" },
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

  for (const item of roles) {
    await prisma.role.upsert({
      where: { code: item.code },
      create: { ...item, permissions: [...item.permissions] },
      update: {
        name: item.name,
        portal: item.portal,
        permissions: [...item.permissions],
        dataScope: item.dataScope,
        active: true,
      },
    });
  }

  for (const template of taskTemplates) {
    const role = await prisma.role.findUnique({ where: { code: template.requiredRoleCode } });
    await prisma.taskTemplate.upsert({
      where: { code: template.code },
      create: {
        ...template,
        checklist: [...template.checklist],
        submissionSchema: template.submissionSchema,
        roleId: role?.id,
      },
      update: {
        name: template.name,
        category: template.category,
        requiredRoleCode: template.requiredRoleCode,
        description: template.description,
        checklist: [...template.checklist],
        submissionSchema: template.submissionSchema,
        defaultDueHours: template.defaultDueHours,
        roleId: role?.id,
        active: true,
      },
    });
  }

  const employees = await prisma.employee.findMany({ select: { id: true, role: true } });
  const roleMap: Array<[RegExp, string]> = [
    [/主播|直播/u, "LIVE_HOST"],
    [/视频|剪辑|拍摄/u, "VIDEO_SPECIALIST"],
    [/设计|美工/u, "DESIGNER"],
    [/客服/u, "CUSTOMER_SERVICE"],
    [/知识|素材|整理/u, "ASSET_CURATOR"],
    [/运营/u, "CONTENT_OPERATOR"],
  ];
  for (const employee of employees) {
    const code = roleMap.find(([pattern]) => pattern.test(employee.role))?.[1] || "CONTENT_OPERATOR";
    const role = await prisma.role.findUniqueOrThrow({ where: { code } });
    await prisma.employeeRole.upsert({
      where: { employeeId_roleId: { employeeId: employee.id, roleId: role.id } },
      create: { employeeId: employee.id, roleId: role.id },
      update: {},
    });
  }

  const username = process.env.OPS_ADMIN_USERNAME || process.env.MALL_ADMIN_USERNAME || "admin";
  const password = process.env.OPS_ADMIN_PASSWORD || process.env.MALL_ADMIN_PASSWORD || "";
  if (password) {
    const admin = await prisma.adminUser.upsert({
      where: { username },
      create: {
        username,
        passwordHash: hashPassword(password),
        displayName: process.env.OPS_DEFAULT_ACTOR || "运营负责人",
      },
      update: { status: "ACTIVE" },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" } });
    await prisma.adminUserRole.upsert({
      where: { adminUserId_roleId: { adminUserId: admin.id, roleId: role.id } },
      create: { adminUserId: admin.id, roleId: role.id },
      update: {},
    });
  }
}

main()
  .finally(async () => prisma.$disconnect());
