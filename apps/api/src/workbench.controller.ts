import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, mkdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import { diskStorage } from "multer";
import { AuthService } from "./auth.service";
import { AiTaskCenterService } from "./ai-task-center.service";
import { BrandDataService } from "./brand-data.service";
import { ContentService } from "./content.service";
import { OssStorageService } from "./oss-storage.service";
import { PrismaService } from "./prisma.service";
import { SmartKeywordService } from "./smart-keyword.service";
import { VideoFactoryService } from "./video-factory.service";
import { ViralTrendService } from "./viral-trend.service";
import { WorkbenchService } from "./workbench.service";

type UploadFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

type DiskFile = {
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
};

const workbenchUploadInbox = resolve(process.cwd(), "data", "upload-inbox");
mkdirSync(workbenchUploadInbox, { recursive: true });

const workbenchBatchUploadStorage = diskStorage({
  destination: workbenchUploadInbox,
  filename: (_request, file, callback) => callback(null, `${Date.now()}-${randomUUID()}${extname(file.originalname).toLowerCase()}`),
});

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function compileVideoScriptTaskPrompt(project: Record<string, any>, brief: Record<string, unknown>) {
  const value = (key: string, fallback = "未填写") => String(brief[key] ?? fallback).trim() || fallback;
  const optionalLines = [
    brief.platform ? `发布平台：${brief.platform}` : "",
    brief.accountType ? `账号类型：${brief.accountType}` : "",
    brief.estimatedDurationSeconds ? `预计时长：${brief.estimatedDurationSeconds}秒` : "",
    brief.voiceoverMode ? `口播模式：${brief.voiceoverMode}` : "",
    typeof brief.healthContentAllowed === "boolean"
      ? `健康内容规则：${brief.healthContentAllowed
        ? "允许健康相关内容；仍须读取系统风险词与风险画面库进行合规检查"
        : "禁止健康相关内容；必须读取系统风险词与风险画面库，并过滤相关文案、字幕、配音和画面"}`
      : "",
    brief.materialPolicy ? `素材策略：${brief.materialPolicy}` : "",
  ].filter(Boolean);

  return [
    "【任务类型】当前视频项目候选脚本生成（本引擎返回一份完整候选脚本，不生成成片）",
    "",
    "【项目基础信息】",
    `项目编号：${project.productionNo || project.id}`,
    `产品型号：${project.productModel || "未填写"}`,
    `视频类型：${value("videoType")}`,
    ...optionalLines,
    "",
    "【内容需求】",
    `核心关键词：${value("keywords", project.topic || "未填写")}`,
    `模仿参考：${value("reference")}`,
    `指定钩子：${value("hook")}`,
    `使用场景：${value("scene")}`,
    `目标用户：${value("audience", project.audience || "未填写")}`,
    `用户痛点：${value("painPoint")}`,
    `传播目标：${project.objective || "未填写"}`,
    `声音要求：${value("soundPrompt")}`,
    `必须展示的事实或动作：${value("mustShowFacts")}`,
    `补充AI提示词：${value("additionalPrompt")}`,
    "",
    "【必须执行】",
    "由 saidian-ai-task-dispatcher 调用 video-editing-from-media-library Skill，并遵循其素材学习、索引与路径规则。",
    "读取素材库索引、包装资源索引、系统风险词库和风险画面库；不得仅凭文件名推断素材内容。",
    "具体功能口播必须绑定能够直接证明该功能的操作、过程或结果视频；外观、包装、佩戴空镜和静态图片不能替代。",
    "已有素材需返回素材ID、远程可访问路径、有效入点/出点、画面事实和匹配分。",
    "缺失素材逐项标明真人补拍或AI生成方案，并保留脚本行ID，供系统后续回传补充素材路径。",
    "",
    "【完整脚本输出结构】",
    "1. 基础任务信息：产品型号、视频类型、发布平台、账号类型、目标受众、预计时长、健康内容规则。",
    "2. 内容定位：核心主题、传播目标、用户痛点、唯一核心卖点。",
    "3. 黄金三秒钩子：文案、类型、对应画面、留人理由、开头声音设计。",
    "4. 完整口播：逐句文案、语气、语速、情绪、预计时长。",
    "5. 脚本结构：钩子、承接、卖点展开、证据展示、转折或留人节点、结尾。",
    "6. 逐句镜头需求与素材覆盖状态：已有素材覆盖、可以改写、需要补拍、禁止制作。",
    "7. 每个镜头的画面事实、音画匹配要求和留人设计。",
    "8. 无标点字幕稿、自然语义断句、重点文字。",
    "9. 配音人群、音色、情绪、语速、音效、环境声。",
    "10. 合规检查、结尾安全尾帧、素材缺口清单及明确补充方法。",
    "",
    "返回结构化结果时，每句必须具有稳定 lineId，素材绑定必须能被系统直接保存和再次提供给远程剪辑节点。",
  ].join("\n");
}

/**
 * Only include the three required values and fields the employee explicitly supplied.
 * Defaults such as "unrestricted" must not become fake instructions for an AI task.
 */
function compileScopedVideoScriptTaskPrompt(project: Record<string, any>, brief: Record<string, unknown>) {
  const text = (value: unknown) => String(value ?? "").trim();
  const isUnrestricted = (value: unknown) => {
    const normalized = text(value).toUpperCase();
    return !normalized || ["AUTO", "DEFAULT", "UNLIMITED", "NONE", "不限", "无限制", "不限制", "默认"].includes(normalized);
  };
  const optional = (label: string, value: unknown) => isUnrestricted(value) ? "" : `${label}：${text(value)}`;
  const projectLines = [
    `项目编号：${text(project.productionNo) || text(project.id)}`,
    `产品型号：${text(project.productModel)}`,
    `视频类型：${text(brief.videoType)}`,
    optional("发布平台", brief.platform),
    optional("账号类型", brief.accountType),
    optional("预计时长", brief.estimatedDurationSeconds ? `${brief.estimatedDurationSeconds}秒` : ""),
    optional("口播模式", brief.voiceoverMode),
    brief.healthContentAllowed === false ? "健康内容限制：禁止健康相关内容，必须避开风险词、风险画面及相关素材。" : "",
    optional("素材策略", brief.materialPolicy),
  ].filter(Boolean);
  const contentLines = [
    `核心关键词：${text(brief.keywords) || text(project.topic)}`,
    optional("模仿参考", brief.reference),
    optional("指定钩子", brief.hook),
    optional("使用场景", brief.scene),
    optional("目标用户", brief.audience),
    optional("用户痛点", brief.painPoint),
    optional("声音要求", brief.soundPrompt),
    optional("必须展示的事实或动作", brief.mustShowFacts),
    optional("补充 AI 提示词", brief.additionalPrompt),
  ].filter(Boolean);

  return [
    "【任务类型】当前视频项目候选脚本生成（只生成一份完整候选脚本，不生成成片）",
    "",
    "【项目基础信息】",
    ...projectLines,
    "",
    "【内容需求】",
    ...contentLines,
    "",
    "【素材约束】",
    "先读取系统中已审核、可用、用途为剪辑主画面的 VIDEO 素材索引和风险规则；包装资源、图片、音频及其他非剪辑主画面素材不参与脚本素材匹配。",
    "具体功能口播必须绑定能够直接证明该功能的操作、过程或结果视频；外观、包装、佩戴空镜和静态图片不能替代。",
    "每个已有素材必须返回素材 ID、远程可访问路径、有效入点/出点、画面事实和匹配原因；缺失素材逐项标明真人补拍或 AI 生成方案，并保留脚本行 ID。",
    "",
    "【完整脚本输出】",
    "返回基础任务信息、内容定位、黄金三秒钩子、完整口播/无口播文案、脚本结构、逐句镜头需求、素材覆盖状态、画面事实、音画匹配、留人设计、字幕稿、重点文字、声音设计、合规检查、结尾设计和素材缺口清单。",
    "返回结构化结果时，每句必须具有稳定 lineId，素材绑定必须可被系统直接保存并再次提供给远程剪辑节点。",
  ].join("\n");
}

function imageProjectRequirement(body: Record<string, unknown>) {
  const model = String(body.productModel || "").trim();
  const imageType = String(body.imageType || "").trim();
  const audience = String(body.audience || "").trim();
  const hook = String(body.hook || "").trim();
  const extras = [
    body.competitor ? `对比对象为${String(body.competitor).trim()}` : "",
    body.creativeIntent ? `补充创意为${String(body.creativeIntent).trim()}` : "",
    body.additionalPrompt ? `补充要求：${String(body.additionalPrompt).trim()}` : "",
  ].filter(Boolean);
  return String(body.requirement || "").trim()
    || `用图文制作 skill，做一组赛电${model}${imageType}图文，面向${audience}，主钩子是“${hook}”，可以放注册证，但不要露内部型号。${extras.length ? ` ${extras.join("；")}。` : ""}`;
}

function scopedVideoScriptBrief(project: Record<string, any>, brief: Record<string, unknown>) {
  const text = (value: unknown) => String(value ?? "").trim();
  const isUnrestricted = (value: unknown) => {
    const normalized = text(value).toUpperCase();
    return !normalized || ["AUTO", "DEFAULT", "UNLIMITED", "NONE", "不限", "无限制", "不限制", "默认"].includes(normalized);
  };
  const result: Record<string, unknown> = {
    productModel: text(project.productModel),
    videoType: text(brief.videoType),
    keywords: text(brief.keywords) || text(project.topic),
  };
  for (const key of ["platform", "accountType", "estimatedDurationSeconds", "voiceoverMode", "materialPolicy", "reference", "hook", "scene", "audience", "painPoint", "soundPrompt", "mustShowFacts", "additionalPrompt"]) {
    if (!isUnrestricted(brief[key])) result[key] = brief[key];
  }
  if (brief.healthContentAllowed === false) result.healthContentAllowed = false;
  return result;
}

function compileReferenceDirectFullVideoPrompt(project: Record<string, any>, brief: Record<string, unknown>) {
  const employeeRequirement = String(brief.referenceDirectTaskRequirement || "").trim();
  if (employeeRequirement) return employeeRequirement;
  const referenceVideoUrl = String(brief.reference || "").trim();
  return [
    "【任务类型】参考视频直出（完整视频）",
    `项目编号：${project.productionNo || project.id}`,
    `产品型号：${project.productModel || "未提供"}`,
    `参考视频链接：${referenceVideoUrl}`,
    "请直接完成：参考分析 → 脚本 → 素材匹配 → 剪辑 → 9:16 成片。不要提交脚本审核，员工只审核最终成片。",
    "提交参考视频链接即代表员工确认该视频完整原声可用于本次制作。必须直接提取并复用其中的 BGM、环境声、音效、口播和节拍；不得要求授权文件，不得因授权字段缺失暂停或失败，不得擅自换成本地 BGM 或重新配音。员工提示明确要求改变声音时除外。",
    "画面沿用参考原声的段落、重音、节奏、镜头结构和氛围，但必须由完整版剪辑 Skill 从本机素材库自主选择当前型号真实 VIDEO 素材重建；不得复制参考视频原画面、人物或品牌素材。包装资源只能作包装，不能作为主画面。",
    "若参考链接、音频或关键素材无法访问，返回 WAITING_INPUT 及具体原因，禁止伪造完成。",
    "输出 1080×1920、30fps 主成片，并回传成片路径、使用素材绑定、参考访问结果和审核说明。",
  ].join("\n");
}

function compileCodexDirectFullVideoPrompt(project: Record<string, any>, brief: Record<string, unknown>, revision: Record<string, unknown> = {}) {
  const prompt = String(brief.additionalPrompt || "").trim();
  const directCreativeMode = /无口播|纯音乐|卡点/u.test(prompt) ? "NO_VOICE_VIDEO" : "FULL_VIDEO";
  const revisionNote = String(revision.reviewNote || "").trim();
  const revisionLines = revisionNote ? [
    "【定向成片修改】本任务不是从零重新创作。必须基于指定的原成片和原任务进行定向修改。",
    `原 AI 任务：${String(revision.sourceTaskId || "")}`,
    `原成片素材：${String(revision.sourceMasterName || revision.sourceMasterAssetId || "")}`,
    `原成片路径：${String(revision.sourceMasterSourcePath || revision.sourceMasterStorageUrl || revision.sourceMasterObjectKey || "")}`,
    `退回原因：${revisionNote}`,
    "保持未被退回的脚本结构、画面节奏、可用素材和成片规格；只修复退回原因涉及的画面、文案、配音、节奏或合规问题。完成时必须回传新成片及简短修改说明。",
  ] : [];
  return [
    "【任务类型】Codex 直出视频（只回传最终成片）",
    `项目编号：${project.productionNo || project.id}`,
    `产品型号：${project.productModel || "未提供"}`,
    `用户 AI 提示词：${prompt}`,
    `内部创作模式：${directCreativeMode}`,
    "请直接完成：脚本 → 素材匹配 → 剪辑 → 9:16 成片。中间脚本、镜头、素材匹配、剪辑进度均不回传系统；仅在最终成片完成或任务失败时回传。",
    "无需脚本审核、无需素材补全确认，员工只审核最终成片。",
    "这是本地素材库直出模式：系统不会提供主画面 assets、素材快照或素材绑定。主画面只能读取本地已同步的“当前产品型号 + 视觉校验通过 + 可剪辑 VIDEO”清单；禁止使用其他型号、未校验素材、图片、音频或包装资源作为主镜头。包装阶段必须按完整版 Skill 使用本机包装资源库，包装资源只能用于 BGM、音效、贴纸、花字、字体和特效层。",
    ...(directCreativeMode === "NO_VOICE_VIDEO" ? [
      "这是无口播卡点视频，必须完整执行 no-voice-beat-editing.md：先选择真实 BGM 并生成节拍表，再按动作、构图和重拍设计逐切点转场；不得用程序生成的正弦音、蜂鸣或占位节拍代替 BGM。",
    ] : []),
    "不得向系统回传中间脚本、镜头、素材匹配或素材绑定；完成时仅回传真实主成片路径、成片元数据和简短审核说明。",
    "先依据当前型号真实可用视频素材调整内部脚本和镜头方案：非核心句缺少直接画面时自动改写为现有素材能够真实证明的表达，并重新完成覆盖与合规检查；不得跨型号替代或伪造产品功能、医疗效果和素材事实。只有核心功能确实没有真实画面、素材盘完全不可用或必要运行环境无法恢复时，才返回明确硬阻塞。校验、包装、转场、字幕、配音和工程问题必须内部返工，不得直接作为任务失败回传。",
    ...revisionLines,
  ].join("\n");
}

function batchBriefValue(brief: Record<string, unknown>) {
  return brief.batchDirect && typeof brief.batchDirect === "object" && !Array.isArray(brief.batchDirect)
    ? brief.batchDirect as Record<string, unknown>
    : {};
}

function compileBatchCodexDirectFullVideoPrompt(project: Record<string, any>, brief: Record<string, unknown>, revision: Record<string, unknown> = {}) {
  const batch = batchBriefValue(brief);
  const products = Array.isArray(batch.products) ? batch.products as Array<Record<string, unknown>> : [];
  const productLines = products.length
    ? products.map((item, index) => `${index + 1}. ${String(item.model || "")}（${Number(item.count || 0)} 条）`).join("\n")
    : "产品清单：待补充";
  const total = products.reduce((sum, item) => sum + Number(item.count || 0), 0);
  const voiceoverSplit = String(batch.voiceoverSplit || "HALF").toUpperCase();
  const voiceoverText = voiceoverSplit === "ALL"
    ? "全部口播"
    : voiceoverSplit === "NONE"
      ? "全部无口播"
      : "一半口播、一半无口播（按每个产品各半分配，奇数条时无口播多一条）";
  const generateCoverTitle = batch.generateCoverTitle !== false;
  const revisionNote = String(revision.reviewNote || "").trim();
  const revisionLines = revisionNote ? [
    "【定向成片修改】本任务不是从零重新创作。必须基于指定的原成片和原任务进行定向修改。",
    `原 AI 任务：${String(revision.sourceTaskId || "")}`,
    `原成片素材：${String(revision.sourceMasterName || revision.sourceMasterAssetId || "")}`,
    `原成片路径：${String(revision.sourceMasterSourcePath || revision.sourceMasterStorageUrl || revision.sourceMasterObjectKey || "")}`,
    `退回原因：${revisionNote}`,
    "保持未被退回的批量清单、脚本结构、画面节奏、可用素材和成片规格；只修复退回原因涉及的视频画面、文案、配音、节奏或合规问题。完成时必须回传修改后的成片及简短修改说明。",
  ] : [];
  const requirement = String(batch.taskRequirement || "").trim();
  const base = requirement
    ? requirement
    : [
      "【任务类型】批量 Codex 直出视频（只回传最终成片）",
      `项目编号：${project.productionNo || project.id}`,
      `视频总数：${total} 条`,
      `产品与视频分配：\n${productLines}`,
      `口播分配：${voiceoverText}`,
      `每条视频使用不同 BGM：${batch.bgmVariety !== false ? "是（默认）" : "否"}`,
      `多使用几种音色、尽量不重复：${batch.voiceVariety !== false ? "是（默认）" : "否"}`,
      `同时生成封面和标题：${generateCoverTitle ? "是（每条视频标签至少 5 个）" : "否（封面标题在后续单独步骤生成）"}`,
      `用户补充提示词：${String(batch.additionalPrompt || "").trim() || "（无，尽量给 AI 更多自由发挥空间）"}`,
      "请在同一个任务内完成全部视频的脚本、素材匹配、剪辑和最终成片。内部脚本、素材匹配和剪辑由 Codex 自动完成，不回传系统；只回传总体进度和最终成品。无需脚本审核、无需素材补全确认，员工只审核最终成片。",
      "这是本地素材库直出模式：主画面只能读取本地已同步的“对应产品型号 + 视觉校验通过 + 可剪辑 VIDEO”清单；禁止使用其他型号、未校验素材、图片、音频或包装资源作为主镜头。各视频在脚本方向、开场、画面节奏上尽量错开，避免整批重复。包装资源只能用于 BGM、音效、贴纸、花字、字体和特效层。",
      "不得向系统回传中间脚本、镜头、素材匹配或素材绑定；完成时按批量清单回传每条视频的真实主成片路径、成片元数据、简短审核说明，以及任务整体批量清单。",
    ].join("\n");
  return [base, ...revisionLines].join("\n");
}

@Controller("api/v1/workbench")
export class WorkbenchController {
  constructor(
    private readonly auth: AuthService,
    private readonly workbench: WorkbenchService,
    private readonly aiTasks: AiTaskCenterService,
    private readonly brandData: BrandDataService,
    private readonly content: ContentService,
    private readonly ossStorage: OssStorageService,
    private readonly prisma: PrismaService,
    private readonly smartKeywords: SmartKeywordService,
    private readonly viralTrend: ViralTrendService,
    private readonly videoFactory: VideoFactoryService,
  ) {}

  private employee(authorization?: string) {
    return this.auth.requireEmployee(authorization);
  }

  private requirePermission(authorization: string | undefined, permission: string) {
    const employee = this.employee(authorization);
    if (!employee.permissions.includes("*") && !employee.permissions.includes(permission)) {
      throw new ForbiddenException("当前岗位没有此数据中心权限");
    }
    return employee;
  }

  private async imageProjectVariantsWithDownloadUrls(variants: Record<string, any>[]) {
    const pages = variants.flatMap((variant) => {
      const metadata = object(variant.metadata);
      return Array.isArray(metadata.pages) ? metadata.pages.map(object) : [];
    });
    const assetIds = [...new Set(pages.map((page) => String(page.imageAssetId || "").trim()).filter(Boolean))];
    const assets = assetIds.length
      ? await this.prisma.asset.findMany({
        where: { id: { in: assetIds } },
        select: { id: true, objectKey: true },
      })
      : [];
    const objectKeyByAssetId = new Map(assets.map((asset) => [asset.id, asset.objectKey || ""]));

    return variants.map((variant) => {
      const metadata = object(variant.metadata);
      if (!Array.isArray(metadata.pages)) return variant;
      return {
        ...variant,
        metadata: {
          ...metadata,
          pages: metadata.pages.map((rawPage: unknown) => {
            const page = object(rawPage);
            const storedUrl = String(page.imageUrl || page.storageUrl || page.fileUrl || page.url || "").trim();
            const objectKeyFromUrl = /^oss:\/\/[^/]+\/(.+)$/u.exec(storedUrl)?.[1] || "";
            const objectKey = objectKeyByAssetId.get(String(page.imageAssetId || "").trim()) || objectKeyFromUrl;
            if (!objectKey) return page;
            try {
              return { ...page, downloadUrl: this.ossStorage.signedDownloadUrl(objectKey) };
            } catch {
              return page;
            }
          }),
        },
      };
    });
  }

  private async submitCoverTitleTask(id: string, outputAssetId: string, employee: { employeeId?: string | null; name: string }) {
    const project = await this.prisma.contentPlan.findUnique({
      where: { id },
      include: { variants: true },
    });
    if (!project || project.kind !== "VIDEO") throw new ForbiddenException("智能视频项目不存在");
    const existingTasks = await this.prisma.aiTask.findMany({
      where: {
        type: "VIDEO",
        sourceType: "VIDEO_FACTORY_PROJECT",
        sourceId: id,
        status: { in: ["PENDING", "CLAIMED", "RUNNING", "QUALITY_CHECK", "UPLOADING", "PENDING_REVIEW"] },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const active = existingTasks.find((item) => String((item.input as Record<string, unknown>)?.executionMode || "") === "COVER_TITLE");
    if (active) return { project: await this.videoFactory.project(id), task: active, duplicate: true };
    const historical = await this.prisma.aiTask.findMany({
      where: { type: "VIDEO", sourceType: "VIDEO_FACTORY_PROJECT", sourceId: id },
      select: { input: true },
    });
    const revision = historical.filter((item) => String((item.input as Record<string, unknown>)?.executionMode || "") === "COVER_TITLE").length + 1;
    const returned = project.variants
      .filter((variant) => variant.packagingStatus === "RETURNED")
      .map((variant) => ({ platform: variant.platform, reason: variant.packagingRejectedReason || "请按审核意见重做" }));
    const task = await this.aiTasks.createTask({
      type: "VIDEO",
      title: `${project.topic} · 封面标题`,
      platform: project.targetPlatforms[0] || "DOUYIN",
      productModel: project.productModel,
      ownerEmployeeId: employee.employeeId,
      reviewerEmployeeId: employee.employeeId,
      sourceType: "VIDEO_FACTORY_PROJECT",
      sourceId: id,
      idempotencyKey: `ai-task:video-project:${id}:cover-title:v${revision}`,
      instructions: "先由视频剪辑素材库 Skill 交接，再调用封面标题子 Skill。必须分析已审核成片，为各目标平台生成一张真实成片关键帧封面和标题；退回原因必须逐条落实。",
      input: {
        executionMode: "COVER_TITLE",
        existingContentPlanId: id,
        masterAssetId: outputAssetId,
        skillName: "video-editing-from-media-library-share",
        childSkillName: "feng-mian-biao-ti",
        targetPlatforms: project.targetPlatforms,
        existingVariants: project.variants.map((variant) => ({
          platform: variant.platform,
          title: variant.title,
          body: variant.body,
          rejectedReason: variant.packagingRejectedReason,
        })),
        revisionFeedback: returned,
        requiredOutputs: ["platform_titles", "cover_images", "title_workbook", "content_fingerprint", "compliance_report"],
        resultContract: {
          packaging: "每个目标平台一条，包含 platform、title、body、coverText、hashtags、contentFingerprint、compliance",
          outputFiles: "每个平台上传一张 JPG 封面，kind=COVER_IMAGE，metadata.platform 必须等于目标平台枚举值",
          platformEnum: project.targetPlatforms,
        },
      },
      modelPolicy: { strategy: "CODEX_FIRST", allowExternalGeneration: false, allowFallback: false },
      estimatedCost: 0,
      skipPaidBudget: true,
    }, employee.name) as Record<string, any>;
    await this.videoFactory.attachRemoteTask(id, task.id, "COVER_TITLE", employee.name);
    return { project: await this.videoFactory.project(id), task, duplicate: false };
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return this.auth.identity(authorization);
  }

  @Get("dashboard")
  dashboard(@Headers("authorization") authorization?: string) {
    return this.workbench.dashboard(this.employee(authorization));
  }

  @Get("outputs")
  outputs(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    this.employee(authorization);
    return this.workbench.outputs(query);
  }

  @Get("outputs/:outputId/url")
  outputUrl(
    @Headers("authorization") authorization: string | undefined,
    @Param("outputId") outputId: string,
  ) {
    this.employee(authorization);
    return this.workbench.outputUrl(outputId);
  }

  @Get("tasks")
  tasks(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.workbench.tasks(this.employee(authorization), query);
  }

  @Get("task-creation/options")
  async contentTaskOptions(@Headers("authorization") authorization?: string) {
    this.employee(authorization);
    const [options, viralKeywords] = await Promise.all([
      this.workbench.contentTaskOptions(),
      this.viralTrend.todayKeywords("DOUYIN").catch(() => ({ keywords: [] })),
    ]);
    return { ...options, viralKeywords: viralKeywords.keywords || [] };
  }

  @Post("task-creation/suggest")
  contentTaskSuggestion(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    this.employee(authorization);
    return this.workbench.contentTaskSuggestion(body);
  }

  @Post("task-creation/submit-ai")
  async submitAiContentTask(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.employee(authorization);
    const contentType = String(body.contentType || "").toUpperCase();
    if (!String(body.productId || "").trim()) {
      throw new BadRequestException("请选择产品");
    }
    if (!String(body.keywordId || "").trim()) {
      throw new BadRequestException("请选择智能关键词");
    }
    const type = contentType === "IMAGE" ? "IMAGE" : contentType === "ARTICLE" ? "ARTICLE" : "VIDEO";
    const category = type === "IMAGE" ? "CONTENT_IMAGE" : type === "ARTICLE" ? "CONTENT_ARTICLE" : "CONTENT_VIDEO";
    const opsTask = await this.workbench.createSelfTask(employee, {
      ...body,
      recurrenceWeekdays: [],
      category,
      sourceType: "SELF_CREATED",
      evidence: {
        ...(body.evidence && typeof body.evidence === "object" ? body.evidence as object : {}),
        contentType,
        keywordId: body.keywordId || null,
        targetAudience: body.targetAudience || null,
        corePain: body.corePain || null,
        recommendedScene: body.recommendedScene || null,
        hook: body.hook || null,
        materialStrategy: body.materialStrategy || null,
        executionMode: body.executionMode || null,
      },
    }) as Record<string, any>;
    const aiTask = await this.aiTasks.createTask({
      type,
      title: opsTask.title,
      instructions: [opsTask.description, opsTask.expectedResult].filter(Boolean).join("\n\n"),
      platform: opsTask.platform,
      productId: opsTask.productId,
      ownerEmployeeId: employee.employeeId,
      reviewerEmployeeId: body.reviewerId || null,
      sourceType: "WORKBENCH_CONTENT_REQUEST",
      sourceId: opsTask.id,
      idempotencyKey: `workbench-content:${opsTask.id}`,
      estimatedCost: 0,
      executionPolicy: "MANUAL",
      input: {
        opsTaskId: opsTask.id,
        keywordId: body.keywordId || null,
        contentType,
        targetAudience: body.targetAudience || null,
        corePain: body.corePain || null,
        keyword: body.keyword || null,
        recommendedScene: body.recommendedScene || null,
        hook: body.hook || null,
        materialStrategy: body.materialStrategy || "REAL_ASSET_FIRST",
        executionMode: type === "VIDEO" ? String(body.executionMode || "FULL_VIDEO") : undefined,
      },
      modelPolicy: {
        strategy: "CODEX_FIRST",
        allowExternalGeneration: false,
      },
    }, employee.name);
    await this.workbench.linkAiRequest(employee, opsTask.id, aiTask);
    return { task: opsTask, aiTask };
  }

  @Get("tasks/:id")
  task(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    return this.workbench.task(this.employee(authorization), id);
  }

  @Post("tasks/:id/ai-feedback")
  async requestAiRevision(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.employee(authorization);
    const request = await this.workbench.requestAiRevision(employee, id, String(body.note || ""));
    return this.aiTasks.requestRevision(request.aiTaskId, request.note, employee.name);
  }

  @Get("tasks/:id/outputs/:outputId/url")
  taskOutputUrl(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Param("outputId") outputId: string,
  ) {
    return this.workbench.taskOutputUrl(this.employee(authorization), id, outputId);
  }

  @Post("tasks")
  createSelfTask(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.createSelfTask(this.employee(authorization), body);
  }

  @Patch("tasks/:id")
  async updateOwnedTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.employee(authorization);
    const updated = await this.workbench.updateOwnedTask(employee, id, body) as Record<string, any>;
    const evidence = updated.evidence && typeof updated.evidence === "object" ? updated.evidence as Record<string, unknown> : {};
    const aiTaskId = String(evidence.aiTaskId || "");
    if (aiTaskId && ["CONTENT_VIDEO", "CONTENT_IMAGE", "CONTENT_ARTICLE"].includes(String(updated.category))) {
      await this.aiTasks.updateTask(aiTaskId, {
        title: updated.title,
        instructions: [updated.description, updated.expectedResult].filter(Boolean).join("\n\n"),
        platform: updated.platform,
        productId: updated.productId,
        input: {
          keywordId: evidence.keywordId || null,
          targetAudience: evidence.targetAudience || null,
          corePain: evidence.corePain || null,
          recommendedScene: evidence.recommendedScene || null,
          hook: evidence.hook || null,
          executionMode: evidence.executionMode || null,
          materialStrategy: evidence.materialStrategy || null,
        },
      }, employee.name);
    }
    return this.workbench.task(employee, id);
  }

  @Post("tasks/:id/cancel")
  async cancelOwnedTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.employee(authorization);
    const updated = await this.workbench.cancelOwnedTask(employee, id) as Record<string, any>;
    const evidence = updated.evidence && typeof updated.evidence === "object" ? updated.evidence as Record<string, unknown> : {};
    if (evidence.aiTaskId) await this.aiTasks.cancel(String(evidence.aiTaskId), employee.name);
    return updated;
  }

  @Post("tasks/:id/trash")
  trashCancelledTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    return this.workbench.trashCancelledTask(this.employee(authorization), id);
  }

  @Get("task-recycle-bin")
  async taskRecycleBin(@Headers("authorization") authorization: string | undefined) {
    const rows = await this.workbench.taskRecycleBin(this.employee(authorization));
    const imageProjectIds = rows
      .filter((row) => row.sourceType === "IMAGE_PROJECT" && row.sourceId)
      .map((row) => row.sourceId as string);
    if (!imageProjectIds.length) return rows;
    const projects = await this.prisma.contentPlan.findMany({
      where: { id: { in: imageProjectIds }, kind: "SHORT_POST" },
      select: { id: true, sourceSignals: true },
    });
    const previousStages = new Map(projects.map((project) => {
      const signals = Array.isArray(project.sourceSignals) ? project.sourceSignals as Array<Record<string, unknown>> : [];
      const archive = signals.find((item) => item?.type === "IMAGE_PROJECT_ARCHIVE");
      return [project.id, String(archive?.previousProductionStage || "IMAGE_REVIEW")];
    }));
    return rows.map((row) => ({
      ...row,
      recyclePreviousStage: row.sourceType === "IMAGE_PROJECT" ? previousStages.get(String(row.sourceId || "")) : undefined,
    }));
  }

  @Post("tasks/:id/restore")
  restoreTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    return this.workbench.restoreTask(this.employee(authorization), id);
  }

  @Post("tasks/:id/accept")
  accept(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    return this.workbench.accept(this.employee(authorization), id);
  }

  @Post("tasks/:id/start")
  start(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    return this.workbench.start(this.employee(authorization), id);
  }

  @Post("tasks/:id/submit")
  submit(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.submit(this.employee(authorization), id, body);
  }

  @Get("operation-team")
  operationTeam(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.workbench.operationTeam(this.employee(authorization), query);
  }

  @Post("operation-team/invitations")
  inviteOperator(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.inviteOperator(this.employee(authorization), body);
  }

  @Post("operation-team/invitations/:id/respond")
  respondOperatorInvite(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.respondOperatorInvite(this.employee(authorization), id, body);
  }

  @Post("operation-team/invitations/:id/cancel")
  cancelOperatorInvite(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    return this.workbench.cancelOperatorInvite(this.employee(authorization), id);
  }

  @Post("operation-team/direct-reports/:employeeId/remove")
  removeDirectReport(
    @Headers("authorization") authorization: string | undefined,
    @Param("employeeId") employeeId: string,
  ) {
    return this.workbench.removeDirectReport(this.employee(authorization), employeeId);
  }

  @Get("operation-team/tasks")
  teamTasks(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.workbench.teamTasks(this.employee(authorization), query);
  }

  @Post("operation-team/tasks")
  createTeamTask(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.createTeamTask(this.employee(authorization), body);
  }

  @Post("operation-team/tasks/:id/review")
  reviewTeamTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.reviewTeamTask(this.employee(authorization), id, body);
  }

  @Post("operation-team/tasks/:id/urgency")
  setTeamTaskUrgency(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.setTeamTaskUrgency(this.employee(authorization), id, body.urgent === true);
  }

  @Patch("operation-team/tasks/:id")
  updateTeamTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.updateOwnedTask(this.employee(authorization), id, body);
  }

  @Post("operation-team/tasks/:id/cancel")
  cancelTeamTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    return this.workbench.cancelOwnedTask(this.employee(authorization), id);
  }

  @Get("notifications")
  notifications(@Headers("authorization") authorization?: string) {
    return this.workbench.notifications(this.employee(authorization));
  }

  @Post("notifications/:id/read")
  readNotification(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    return this.workbench.readNotification(this.employee(authorization), id);
  }

  @Post("notifications/read-all")
  readAllNotifications(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.workbench.readAllNotifications(this.employee(authorization), body.ids);
  }

  @Post("assets/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 500 * 1024 * 1024 } }))
  uploadAsset(
    @Headers("authorization") authorization: string | undefined,
    @UploadedFile() file: UploadFile | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.employee(authorization);
    return this.brandData.uploadAsset(file, { ...body, employeeId: employee.employeeId }, employee.name);
  }

  @Post("upload-batches")
  createUploadBatch(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "ASSET_UPLOAD");
    return this.brandData.createUploadBatch({ ...body, employeeId: employee.employeeId }, employee.name);
  }

  @Post("upload-batches/assist")
  assistUploadBatch(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    this.requirePermission(authorization, "ASSET_UPLOAD");
    return this.brandData.suggestUploadMetadata(body);
  }

  @Post("upload-batches/:id/files")
  @UseInterceptors(FilesInterceptor("files", 20, {
    storage: workbenchBatchUploadStorage,
    limits: { fileSize: 200 * 1024 * 1024, files: 20 },
  }))
  uploadBatchFiles(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @UploadedFiles() files: DiskFile[],
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "ASSET_UPLOAD");
    return this.brandData.uploadBatchFiles(id, files, employee.name, body);
  }

  @Get("assets/:id")
  asset(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    this.requirePermission(authorization, "DATA_CENTER_VIEW");
    return this.brandData.asset(id);
  }

  @Get("assets/:id/download-url")
  assetDownloadUrl(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    this.requirePermission(authorization, "DATA_CENTER_VIEW");
    return this.brandData.assetDownloadUrl(id);
  }

  @Patch("assets/:id/metadata")
  updateAssetMetadata(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "ASSET_CURATE");
    return this.brandData.updateAsset(id, {
      displayName: body.displayName,
      contentDescription: body.contentDescription,
      productScope: body.productScope,
      productIds: body.productIds,
      scene: body.scene,
      tags: body.tags,
    }, employee.name);
  }

  @Post("knowledge")
  createKnowledge(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.employee(authorization);
    return this.brandData.createKnowledge({ ...body, publishMode: "PENDING", owner: employee.name }, employee.name);
  }

  @Get("knowledge")
  knowledge(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    this.employee(authorization);
    return this.brandData.knowledge({ ...query, status: "READY" });
  }

  @Get("data-center")
  async dataCenter(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    const employee = this.requirePermission(authorization, "DATA_CENTER_VIEW");
    const canCurateAssets = employee.permissions.includes("*") || employee.permissions.includes("ASSET_CURATE");
    const section = String(query.section || "knowledge");
    const keyword = String(query.query || "").trim();
    const model = String(query.model || "").trim();
    const knowledgeType = String(query.type || "").toUpperCase();
    const summaryPromise = Promise.all([
      this.prisma.asset.count({
        where: {
          reviewStatus: "APPROVED",
          availabilityStatus: "ACTIVE",
          rightsStatus: { in: ["COMMERCIAL", "EDIT_ONLY"] },
        },
      }),
      this.prisma.knowledgeEntry.count({ where: { status: "READY" } }),
      this.prisma.smartKeyword.count(),
      this.prisma.externalVideo.count(),
      this.prisma.contentPlan.count({
        where: {
          kind: "VIDEO",
          createdBy: employee.name,
          sourceSignals: { array_contains: [{ type: "VIDEO_FACTORY" }] },
          productionStage: { notIn: ["VIDEO_FACTORY_ARCHIVED", "VIDEO_FACTORY_PURGED"] },
        },
      }),
      canCurateAssets ? this.prisma.asset.count({ where: { reviewStatus: "PENDING", deletedAt: null } }) : Promise.resolve(0),
    ]);
    const sectionPromise = section === "assets"
      ? this.brandData.rankedAssets({
        query: query.query,
        model: query.model,
        kind: query.kind,
        purpose: query.purpose,
        packagingCategory: query.packagingCategory,
        moduleType: query.moduleType,
        minimumScore: query.minimumScore || "0",
        page: query.page || "1",
        pageSize: query.pageSize || "30",
      })
      : section === "knowledge"
        ? knowledgeType === "PRODUCT"
          ? this.prisma.product.findMany({
            where: {
              status: "READY",
              ...(model ? { modelCode: { contains: model, mode: "insensitive" as const } } : {}),
              ...(keyword ? {
                OR: [
                  { name: { contains: keyword, mode: "insensitive" as const } },
                  { modelCode: { contains: keyword, mode: "insensitive" as const } },
                  { category: { contains: keyword, mode: "insensitive" as const } },
                ],
              } : {}),
            },
            select: { id: true, modelCode: true, name: true, category: true, updatedAt: true },
            orderBy: [{ category: "asc" as const }, { modelCode: "asc" as const }],
            take: 500,
          }).then((items) => items.map((item) => ({
            id: item.id,
            type: "产品",
            title: `${item.modelCode} · ${item.name}`,
            category: item.category,
            model: item.modelCode,
            summary: "已审核产品资料",
            updatedAt: item.updatedAt,
          })))
          : knowledgeType === "QUALIFICATION"
            ? this.prisma.evidenceClaim.findMany({
              where: {
                status: "READY",
                ...(keyword ? {
                  OR: [
                    { name: { contains: keyword, mode: "insensitive" as const } },
                    { confirmedFact: { contains: keyword, mode: "insensitive" as const } },
                    { publicWording: { contains: keyword, mode: "insensitive" as const } },
                  ],
                } : {}),
              },
              orderBy: { updatedAt: "desc" as const },
              take: 500,
            }).then((items) => items.map((item) => ({
              id: item.id,
              type: "资质",
              title: item.name,
              category: item.evidenceType,
              model: item.coveredObject || "品牌通用",
              summary: item.confirmedFact || item.publicWording || "已审核资质证据",
              updatedAt: item.updatedAt,
            })))
            : knowledgeType === "KNOWLEDGE_GROUP"
              ? this.prisma.knowledgeEntry.findMany({
                where: {
                  status: "READY",
                  type: { in: ["BRAND", "PARAMETER", "KNOWLEDGE", "WORDING", "FORBIDDEN", "AFTER_SALE", "TUTORIAL"] },
                  ...(model ? { model: { contains: model, mode: "insensitive" as const } } : {}),
                  ...(keyword ? {
                    OR: [
                      { title: { contains: keyword, mode: "insensitive" as const } },
                      { summary: { contains: keyword, mode: "insensitive" as const } },
                      { body: { contains: keyword, mode: "insensitive" as const } },
                    ],
                  } : {}),
                },
                orderBy: { updatedAt: "desc" as const },
                take: 500,
              })
              : this.brandData.knowledge({
                query: query.query,
                model: query.model,
                type: knowledgeType === "FAQ" ? "FAQ" : undefined,
                status: "READY",
              })
        : section === "keywords"
          ? this.smartKeywords.list({
            search: query.query,
            platform: query.platform,
            take: query.keywordLimit || "200",
          }).catch(() => ({ total: 0, items: [], summary: [], limits: { dailyCollectionPerPlatform: 50, pinnedPerPlatform: 50 } }))
          : section === "viral"
            ? Promise.all([
              this.viralTrend.todayKeywords(query.platform || "DOUYIN").catch(() => ({ keywords: [] })),
              this.viralTrend.trends({ take: query.viralLimit || "60" }).catch(() => ({ items: [], summary: { total: 0 } })),
            ])
            : Promise.all([
              this.videoFactory.projects({
                status: query.status,
                platform: query.platform,
                productModel: query.model,
                createdBy: employee.name,
                page: Number(query.page || 1),
                pageSize: Number(query.pageSize || 12),
              }).catch(() => ({ items: [], total: 0, page: 1, pageSize: 12 })),
              this.prisma.contentPlan.findMany({
                where: {
                  kind: "VIDEO",
                  createdBy: employee.name,
                  ...(query.model ? { productModel: { contains: query.model, mode: "insensitive" } } : {}),
                },
                select: {
                  id: true,
                  productionNo: true,
                  topic: true,
                  productModel: true,
                  status: true,
                  productionStage: true,
                  sourceSignals: true,
                  createdAt: true,
                },
                orderBy: { createdAt: "desc" },
                take: 30,
              }),
            ]);
    const optionsPromise = query.includeOptions === "1"
      ? Promise.all([
        this.prisma.product.findMany({
          where: { status: { not: "ARCHIVED" } },
          select: { id: true, modelCode: true, name: true, category: true },
          orderBy: [{ category: "asc" }, { modelCode: "asc" }],
          take: 500,
        }),
        this.prisma.contentPlan.findMany({
          where: { kind: "VIDEO", productionStage: "AWAITING_ASSETS" },
          select: { id: true, productionNo: true, topic: true, shootRequirements: true },
          orderBy: { updatedAt: "desc" },
          take: 100,
        }),
      ])
      : Promise.resolve(undefined);
    const materialIndexPromise = section === "assets"
      ? this.aiTasks.systemMaterialIndexStatus()
      : Promise.resolve(undefined);
    const [[assetTotal, knowledgeTotal, keywordTotal, viralTotal, videoProjectTotal, pendingTotal], sectionData, options, materialIndex] = await Promise.all([
      summaryPromise,
      sectionPromise,
      optionsPromise,
      materialIndexPromise,
    ]);
    const assetPage = section === "assets"
      ? sectionData as { items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }
      : { items: [], total: 0, page: 1, pageSize: 30 };
    const assets = assetPage.items || [];
    const knowledge = section === "knowledge" ? sectionData as Array<Record<string, unknown>> : [];
    const keywords = section === "keywords" ? sectionData : undefined;
    const viralData = section === "viral" ? sectionData as [Record<string, unknown>, Record<string, unknown>] : undefined;
    const videoData = section === "videoFactory"
      ? sectionData as [{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }, Array<Record<string, unknown>>]
      : undefined;
    const videoProjectPage = videoData?.[0] || { items: [], total: 0, page: 1, pageSize: 12 };
    const videoProjects = videoProjectPage.items || [];
    const videoScripts = videoData?.[1] || [];
    return {
      permissions: employee.permissions,
      summary: {
        assets: assetTotal,
        assetResults: assetPage.total,
        priorityAssets: assets.filter((item) => ["S", "A"].includes(String(item.grade))).length,
        knowledge: knowledgeTotal,
        pending: pendingTotal,
        keywords: keywordTotal,
        viralVideos: viralTotal,
        videoProjects: videoProjectTotal,
      },
      ...(section === "assets" ? { assets, pagination: assetPage, materialIndex } : {}),
      ...(section === "knowledge" ? { knowledge } : {}),
      ...(section === "keywords" ? { keywords } : {}),
      ...(section === "viral" ? { viralKeywords: viralData?.[0], viralTrend: viralData?.[1] } : {}),
      ...(section === "videoFactory" ? { videoProjects, pagination: videoProjectPage, videoScripts } : {}),
      ...(options ? { products: options[0], uploadOptions: { products: options[0], productionPlans: options[1] } } : {}),
    };
  }

  @Post("image-projects")
  async createImageProject(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    const productModel = String(body.productModel || "").trim();
    const imageType = String(body.imageType || "").trim();
    const audience = String(body.audience || "").trim();
    const hook = String(body.hook || "").trim();
    if (!productModel || !imageType || !audience || !hook) {
      throw new BadRequestException("产品型号、图文类型、目标人群/场景和主钩子方向为必填项");
    }
    const requirement = imageProjectRequirement(body);
    const brief = { productModel, imageType, audience, hook, competitor: String(body.competitor || "").trim() || null, creativeIntent: String(body.creativeIntent || "").trim() || null, additionalPrompt: String(body.additionalPrompt || "").trim() || null, requirement };
    const plan = await this.prisma.contentPlan.create({
      data: {
        productionNo: `IP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 6).toUpperCase()}`,
        productionStage: "IMAGE_GENERATING",
        planDate: new Date(), kind: "SHORT_POST", topic: `${productModel} · ${imageType} · ${hook}`,
        productModel, audience, objective: hook, hook, outline: [], evidenceIds: [], riskReasons: [],
        scoreBreakdown: {}, sourceSignals: [{ type: "IMAGE_PROJECT", brief }],
        status: "DRAFT", createdBy: employee.name, owner: employee.name, assignedTo: employee.name,
        assignedEmployeeId: employee.employeeId, targetPlatforms: ["DOUYIN"],
      },
    });
    const materialRoots = ["F:\\赛电品牌素材库\\图片素材", "F:\\赛电品牌素材库\\产品规格书"];
    if (imageType === "对比类" || brief.competitor) materialRoots.push("F:\\赛电品牌素材库\\图文制作资源\\竞品产品图");
    const task = await this.aiTasks.createTask({
      type: "IMAGE", title: `${plan.topic} 图文制作`, platform: "DOUYIN", productModel,
      ownerEmployeeId: employee.employeeId, reviewerEmployeeId: employee.employeeId,
      sourceType: "IMAGE_PROJECT", sourceId: plan.id,
      idempotencyKey: `ai-task:image-project:${plan.id}:v1`, instructions: requirement,
      input: {
        sourceType: "IMAGE_PROJECT",
        executionMode: "IMAGE_POST",
        skillName: "saidian-douyin-image-posts",
        imageProjectId: plan.id,
        // The worker receives only the employee-confirmed final instruction.
        // Keep the aliases so both the current dispatcher and portable worker
        // pick up the same canonical prompt without inventing empty defaults.
        requirement,
        projectPrompt: requirement,
        finalEmployeePrompt: requirement,
        prompt: requirement,
        brief,
        materialRoots,
      },
      modelPolicy: { strategy: "CODEX_FIRST", allowExternalGeneration: false, allowFallback: false }, estimatedCost: 0, skipPaidBudget: true,
    }, employee.name) as Record<string, any>;
    const linkedTask = await this.workbench.ensureImageProjectTask({ employeeId: employee.employeeId!, name: employee.name }, plan);
    await this.prisma.opsTask.update({ where: { id: linkedTask.id }, data: { evidence: { ...(linkedTask.evidence as object), aiTaskId: task.id } } });
    return { project: plan, task, linkedTask, requirement };
  }

  @Get("image-projects/:id")
  async imageProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "DATA_CENTER_VIEW");
    const project = await this.prisma.contentPlan.findFirst({
      where: { id, kind: "SHORT_POST", assignedEmployeeId: employee.employeeId, productionStage: { not: "IMAGE_ARCHIVED" } },
      include: { variants: true, aiTaskOutputs: { orderBy: { createdAt: "desc" } } },
    });
    if (!project) throw new ForbiddenException("图文项目不存在或无权查看");
    const aiTask = await this.prisma.aiTask.findFirst({ where: { sourceType: "IMAGE_PROJECT", sourceId: id }, orderBy: { createdAt: "desc" }, include: { outputs: { orderBy: { createdAt: "desc" } } } });
    const variants = await this.imageProjectVariantsWithDownloadUrls(project.variants as Record<string, any>[]);
    return { ...project, variants, aiTask, requirement: object((Array.isArray(project.sourceSignals) ? project.sourceSignals[0] : {}) as object).brief ? object(object((project.sourceSignals as any)[0]).brief).requirement : "" };
  }

  @Post("image-projects/:id/retry")
  async retryImageProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    const project = await this.prisma.contentPlan.findFirst({
      where: { id, kind: "SHORT_POST", assignedEmployeeId: employee.employeeId, productionStage: { not: "IMAGE_ARCHIVED" } },
      select: { id: true },
    });
    if (!project) throw new ForbiddenException("图文项目不存在、已删除或无权处理");

    const task = await this.prisma.aiTask.findFirst({
      where: { sourceType: "IMAGE_PROJECT", sourceId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (!task) throw new BadRequestException("该图文项目尚未登记 AI 任务");
    if (!["FAILED", "RETURNED", "RETRY"].includes(task.status)) {
      throw new BadRequestException("当前图文任务不是可重试状态");
    }
    await this.aiTasks.retry(task.id, employee.name);
    return this.imageProject(authorization, id);
  }

  @Delete("image-projects/:id")
  async deleteImageProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    const project = await this.prisma.contentPlan.findFirst({
      where: { id, kind: "SHORT_POST", assignedEmployeeId: employee.employeeId, productionStage: { not: "IMAGE_ARCHIVED" } },
      select: { id: true },
    });
    if (!project) throw new ForbiddenException("图文项目不存在、已删除或无权处理");

    const linkedAiTasks = await this.prisma.aiTask.findMany({
      where: {
        sourceType: "IMAGE_PROJECT",
        sourceId: id,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      select: { id: true },
    });
    let cancelledAiTasks = 0;
    for (const task of linkedAiTasks) {
      try {
        await this.aiTasks.cancel(task.id, employee.name);
        cancelledAiTasks += 1;
      } catch (error) {
        // A worker may finish between the lookup and cancellation. Continue
        // archiving the project when the task has already reached a terminal state.
        const latest = await this.prisma.aiTask.findUnique({ where: { id: task.id }, select: { status: true } });
        if (!latest || !["COMPLETED", "CANCELLED"].includes(latest.status)) throw error;
      }
    }

    const currentProject = await this.prisma.contentPlan.findUnique({ where: { id }, select: { sourceSignals: true, productionStage: true } });
    const previousSignals = Array.isArray(currentProject?.sourceSignals) ? currentProject.sourceSignals as Array<Record<string, unknown>> : [];
    const archiveSignal = {
      type: "IMAGE_PROJECT_ARCHIVE",
      archivedAt: new Date().toISOString(),
      previousProductionStage: currentProject?.productionStage || "IMAGE_REVIEW",
    };
    const nextSignals = [...previousSignals.filter((item) => item?.type !== "IMAGE_PROJECT_ARCHIVE"), archiveSignal];
    const now = new Date();
    const purgeAfter = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const [employeeTasks] = await this.prisma.$transaction([
      this.prisma.opsTask.updateMany({
        where: { sourceType: "IMAGE_PROJECT", sourceId: id, deletedAt: null },
        data: {
          status: "CANCELLED",
          deletedAt: now,
          purgeAfter,
          deletedByEmployeeId: employee.employeeId,
          completedAt: now,
        },
      }),
      this.prisma.contentPlan.update({
        where: { id },
        data: { productionStage: "IMAGE_ARCHIVED", sourceSignals: nextSignals as any },
      }),
    ]);
    return { deleted: true, cancelledAiTasks, deletedEmployeeTasks: employeeTasks.count };
  }

  @Post("image-projects/:id/restore")
  async restoreImageProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    const project = await this.prisma.contentPlan.findFirst({
      where: { id, kind: "SHORT_POST", assignedEmployeeId: employee.employeeId, productionStage: "IMAGE_ARCHIVED" },
    });
    if (!project) throw new ForbiddenException("回收站中的图文项目不存在、已过期或无权恢复");
    const deletedTask = await this.prisma.opsTask.findFirst({
      where: { sourceType: "IMAGE_PROJECT", sourceId: id, deletedByEmployeeId: employee.employeeId, deletedAt: { not: null }, purgeAfter: { gt: new Date() } },
      orderBy: { deletedAt: "desc" },
    });
    if (!deletedTask) throw new ForbiddenException("图文项目已超过恢复期限");
    const signals = Array.isArray(project.sourceSignals) ? project.sourceSignals as Array<Record<string, unknown>> : [];
    const archive = signals.find((item) => item?.type === "IMAGE_PROJECT_ARCHIVE");
    const previousStage = String(archive?.previousProductionStage || "IMAGE_REVIEW");
    const restoredSignals = signals.filter((item) => item?.type !== "IMAGE_PROJECT_ARCHIVE");
    await this.prisma.$transaction([
      this.prisma.contentPlan.update({
        where: { id },
        data: { productionStage: previousStage, sourceSignals: restoredSignals as any },
      }),
      this.prisma.opsTask.updateMany({
        where: { sourceType: "IMAGE_PROJECT", sourceId: id, deletedAt: { not: null } },
        data: { deletedAt: null, purgeAfter: null, deletedByEmployeeId: null },
      }),
    ]);
    return { restored: true, id };
  }

  @Post("image-projects/:id/review")
  async reviewImageProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    const action = String(body.action || "").trim().toUpperCase();
    if (!["APPROVE", "RETURN"].includes(action)) throw new BadRequestException("图文审核动作不正确");
    const approve = action === "APPROVE";
    // `reason` was used by an older workbench client. Keep accepting it so a
    // cached page can still return an image project after a deployment.
    const note = String(body.note || body.reason || "").trim();
    if (!approve && !note) throw new BadRequestException("退回图文时必须填写原因");
    const project = await this.prisma.contentPlan.findFirst({ where: { id, assignedEmployeeId: employee.employeeId } });
    if (!project) throw new ForbiddenException("图文项目不存在或无权处理");
    await this.prisma.contentPlan.update({ where: { id }, data: { productionStage: approve ? "IMAGE_PUBLISHING" : "IMAGE_RETURNED", status: approve ? "APPROVED" : "REJECTED", approvedBy: approve ? employee.name : null, approvedAt: approve ? new Date() : null } });
    if (!approve) {
      const projectBrief = object(object((project.sourceSignals as any)?.[0]).brief);
      const requirement = String(projectBrief.requirement || imageProjectRequirement({
        productModel: project.productModel,
        imageType: projectBrief.imageType,
        audience: projectBrief.audience,
        hook: projectBrief.hook,
        competitor: projectBrief.competitor,
        creativeIntent: projectBrief.creativeIntent,
        additionalPrompt: projectBrief.additionalPrompt,
      })).trim();
      const materialRoots = ["F:\\赛电品牌素材库\\图片素材", "F:\\赛电品牌素材库\\产品规格书"];
      if (projectBrief.imageType === "对比类" || projectBrief.competitor) materialRoots.push("F:\\赛电品牌素材库\\图文制作资源\\竞品产品图");
      await this.aiTasks.createTask({ type: "IMAGE", title: `${project.topic} 图文修改`, platform: "DOUYIN", productModel: project.productModel, ownerEmployeeId: employee.employeeId, reviewerEmployeeId: employee.employeeId, sourceType: "IMAGE_PROJECT", sourceId: id, idempotencyKey: `ai-task:image-project:${id}:return:${project.workflowVersion + 1}`, instructions: `${requirement}\n\n请仅根据以下审核意见修改现有图文：${note}`, input: { sourceType: "IMAGE_PROJECT", executionMode: "IMAGE_POST", skillName: "saidian-douyin-image-posts", imageProjectId: id, requirement, projectPrompt: requirement, finalEmployeePrompt: requirement, prompt: requirement, brief: projectBrief, materialRoots, revisionOf: id, revisionFeedback: note }, modelPolicy: { strategy: "CODEX_FIRST", allowExternalGeneration: false, allowFallback: false }, estimatedCost: 0, skipPaidBudget: true }, employee.name);
    }
    return this.imageProject(authorization, id);
  }

  @Post("image-projects/:id/publish-links")
  async saveImageProjectPublishLinks(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    const project = await this.prisma.contentPlan.findFirst({ where: { id, assignedEmployeeId: employee.employeeId }, include: { variants: true } });
    if (!project) throw new ForbiddenException("图文项目不存在或无权处理");
    const rows = Array.isArray(body.records) ? body.records as Record<string, unknown>[] : [];
    for (const row of rows) {
      const url = String(row.remoteUrl || "").trim(); if (!url) continue;
      const platform = String(row.platform || "DOUYIN") as any;
      await this.prisma.contentVariant.upsert({ where: { contentPlanId_platform: { contentPlanId: id, platform } }, create: { contentPlanId: id, platform, title: project.topic, body: "", manualPublishUrl: url, manualPublishedAt: new Date(), status: "PUBLISHED" }, update: { manualPublishUrl: url, manualPublishedAt: new Date(), status: "PUBLISHED" } });
    }
    await this.prisma.contentPlan.update({ where: { id }, data: { productionStage: "IMAGE_PUBLISHED", status: "PUBLISHED" } });
    return this.imageProject(authorization, id);
  }

  @Post("data-center/video-projects")
  async createVideoProject(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以创建视频项目");
    }
    const project = await this.videoFactory.createProject({
      projectMode: body.projectMode === "REFERENCE_DIRECT_FULL_VIDEO"
        ? "REFERENCE_DIRECT_FULL_VIDEO"
        : body.projectMode === "CODEX_DIRECT_FULL_VIDEO"
          ? "CODEX_DIRECT_FULL_VIDEO"
          : body.projectMode === "BATCH_CODEX_DIRECT_FULL_VIDEO"
            ? "BATCH_CODEX_DIRECT_FULL_VIDEO"
          : "STANDARD",
      referenceVideoUrl: body.referenceVideoUrl ? String(body.referenceVideoUrl) : undefined,
      referenceDirectTaskRequirement: body.referenceDirectTaskRequirement ? String(body.referenceDirectTaskRequirement) : undefined,
      platform: body.platform && body.platform !== "AUTO" ? String(body.platform) : undefined,
      voiceoverMode: body.voiceoverMode && body.voiceoverMode !== "AUTO" ? String(body.voiceoverMode) : undefined,
      accountType: body.accountType && body.accountType !== "AUTO" ? String(body.accountType) : undefined,
      estimatedDurationSeconds: Number(body.estimatedDurationSeconds) > 0 ? Number(body.estimatedDurationSeconds) : undefined,
      contentRestrictionMode: body.contentRestrictionMode && body.contentRestrictionMode !== "AUTO" ? String(body.contentRestrictionMode) : undefined,
      generationMode: body.generationMode && body.generationMode !== "AUTO" ? String(body.generationMode) : undefined,
      scriptSource: String(body.scriptSource || "AI"),
      userProvidedDirections: Array.isArray(body.userProvidedDirections)
        ? body.userProvidedDirections.map((item, index) => {
          const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
          return { index: Number(row.index ?? index), title: String(row.title || ""), content: String(row.content || "") };
        })
        : [],
      productModel: body.productModel ? String(body.productModel) : undefined,
      topic: body.topic ? String(body.topic) : undefined,
      audience: body.audience ? String(body.audience) : undefined,
      objective: body.objective ? String(body.objective) : undefined,
      keywordIds: Array.isArray(body.keywordIds) ? body.keywordIds.map(String) : [],
      externalVideoIds: Array.isArray(body.externalVideoIds) ? body.externalVideoIds.map(String) : [],
      routingMode: "AUTO",
      allowFallback: true,
      deferScriptGeneration: true,
      healthContentAllowed: typeof body.healthContentAllowed === "boolean" ? body.healthContentAllowed : undefined,
      soundPrompt: body.soundPrompt ? String(body.soundPrompt) : undefined,
      mustShowFacts: body.mustShowFacts ? String(body.mustShowFacts) : undefined,
      additionalPrompt: body.additionalPrompt ? String(body.additionalPrompt) : undefined,
      videoType: body.videoType ? String(body.videoType) : undefined,
      keywords: body.keywords ? String(body.keywords) : undefined,
      reference: body.reference ? String(body.reference) : undefined,
      hook: body.hook ? String(body.hook) : undefined,
      scene: body.scene ? String(body.scene) : undefined,
      painPoint: body.painPoint ? String(body.painPoint) : undefined,
      scriptEngines: Array.isArray(body.scriptEngines) ? body.scriptEngines.map(String) : undefined,
      batchProducts: Array.isArray(body.batchProducts)
        ? body.batchProducts.map((item) => {
          const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
          return { model: String(row.model || "").trim(), count: Math.round(Number(row.count || 0)) };
        })
        : undefined,
      batchVoiceoverSplit: body.batchVoiceoverSplit === "ALL" || body.batchVoiceoverSplit === "NONE"
        ? body.batchVoiceoverSplit
        : undefined,
      batchBgmVariety: typeof body.batchBgmVariety === "boolean" ? body.batchBgmVariety : undefined,
      batchVoiceVariety: typeof body.batchVoiceVariety === "boolean" ? body.batchVoiceVariety : undefined,
      batchGenerateCoverTitle: typeof body.batchGenerateCoverTitle === "boolean" ? body.batchGenerateCoverTitle : undefined,
      batchTaskRequirement: body.batchTaskRequirement ? String(body.batchTaskRequirement) : undefined,
    }, employee.name) as Record<string, any>;
    if (["REFERENCE_DIRECT_FULL_VIDEO", "CODEX_DIRECT_FULL_VIDEO", "BATCH_CODEX_DIRECT_FULL_VIDEO"].includes(String(body.projectMode || ""))) {
      const directSubmission = body.projectMode === "CODEX_DIRECT_FULL_VIDEO"
        ? await this.submitCodexDirectFullVideoTask(authorization, String(project.id))
        : body.projectMode === "BATCH_CODEX_DIRECT_FULL_VIDEO"
          ? await this.submitBatchCodexDirectFullVideoTask(authorization, String(project.id))
        : await this.submitReferenceDirectFullVideoTask(authorization, String(project.id));
      const submittedProject = directSubmission.project as Record<string, any>;
      const task = await this.workbench.ensureVideoProjectTask({ employeeId: employee.employeeId!, name: employee.name }, {
        id: String(submittedProject.id),
        productionNo: submittedProject.productionNo ? String(submittedProject.productionNo) : null,
        topic: submittedProject.topic ? String(submittedProject.topic) : null,
        productionStage: submittedProject.productionStage ? String(submittedProject.productionStage) : null,
      });
      return { ...submittedProject, linkedTask: task, videoTask: directSubmission.task, scriptEngines: ["REMOTE_CODEX"] };
    }
    const scriptSubmission = await this.submitVideoScriptTask(authorization, String(project.id));
    const submittedProject = scriptSubmission.project as Record<string, any>;
    const task = await this.workbench.ensureVideoProjectTask({
      employeeId: employee.employeeId!,
      name: employee.name,
    }, {
      id: String(submittedProject.id),
      productionNo: submittedProject.productionNo ? String(submittedProject.productionNo) : null,
      topic: submittedProject.topic ? String(submittedProject.topic) : null,
      productionStage: submittedProject.productionStage ? String(submittedProject.productionStage) : null,
    });
    return {
      ...submittedProject,
      linkedTask: task,
      scriptTask: scriptSubmission.task,
      scriptEngines: scriptSubmission.scriptEngines,
    };
  }

  @Post("data-center/video-projects/:id/script-task")
  async submitVideoScriptTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以提交脚本生成任务");
    }
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) throw new ForbiddenException("只能提交自己创建的视频项目");
    if (!["PROJECT_BRIEF", "SCRIPT_RETURNED"].includes(String(project.productionStage))) {
      throw new ForbiddenException("当前项目状态不能提交脚本生成任务");
    }
    const factory = Array.isArray(project.sourceSignals)
      ? project.sourceSignals.find((item: Record<string, unknown>) => item?.type === "VIDEO_FACTORY") || {}
      : {};
    const brief = factory.brief && typeof factory.brief === "object" ? factory.brief : {};
    const scriptEngines = Array.isArray((brief as Record<string, unknown>).scriptEngines)
      ? ((brief as Record<string, unknown>).scriptEngines as unknown[]).map(String)
      : ["SYSTEM_AI"];
    const compiledPrompt = compileScopedVideoScriptTaskPrompt(project, brief as Record<string, unknown>);
    const taskBrief = scopedVideoScriptBrief(project, brief as Record<string, unknown>);
    let task: Record<string, any> | null = null;
    if (scriptEngines.includes("REMOTE_CODEX")) task = await this.aiTasks.createTask({
      type: "VIDEO",
      title: `${project.topic} · 单脚本生成`,
      platform: project.targetPlatforms?.[0] || "DOUYIN",
      productModel: project.productModel,
      ownerEmployeeId: employee.employeeId,
      reviewerEmployeeId: employee.employeeId,
      sourceType: "VIDEO_FACTORY_PROJECT",
      sourceId: project.id,
      idempotencyKey: `ai-task:video-project:${project.id}:script:v${project.workflowVersion}`,
      instructions: compiledPrompt,
      input: {
        executionMode: "SCRIPT_ONLY",
        existingContentPlanId: project.id,
        workflowVersion: project.workflowVersion,
        workflowGuard: {
          projectId: project.id,
          workflowVersion: project.workflowVersion,
          stage: "SCRIPT_ONLY",
          allowedProjectStages: ["PROJECT_BRIEF", "SCRIPT_RETURNED", "SCRIPT_GENERATING"],
        },
        singleScript: true,
        skillName: "video-editing-from-media-library-share",
        compiledPrompt,
        projectBrief: taskBrief,
        ...(taskBrief.healthContentAllowed === false ? { healthContentAllowed: false } : {}),
        requiredOutputs: [
          "complete_script",
          "line_material_coverage",
          "material_paths",
          "source_time_ranges",
          "visible_facts",
          "semantic_scores",
          "shot_plan",
          "material_gap_list",
          "compliance_report",
        ],
      },
      modelPolicy: { strategy: "CODEX_FIRST", allowExternalGeneration: false, allowFallback: false },
      estimatedCost: 0,
      skipPaidBudget: true,
    }, employee.name) as Record<string, any>;
    if (task) await this.videoFactory.attachRemoteTask(id, task.id, "SCRIPT_ONLY", employee.name);
    if (scriptEngines.includes("SYSTEM_AI")) {
      await this.videoFactory.enqueueSystemScriptCandidate(id, employee.name);
    }
    return { project: await this.videoFactory.project(id), task, scriptEngines };
  }

  @Post("data-center/video-projects/:id/system-script-regenerate")
  async regenerateSystemVideoScript(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以重新生成视频脚本");
    }
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) {
      throw new ForbiddenException("只能重新生成自己创建的视频项目脚本");
    }
    if (!["FACTORY_SCRIPT_READY", "SCRIPT_GENERATING"].includes(String(project.productionStage))) {
      throw new ForbiddenException("当前项目阶段不能重新生成系统 AI 脚本");
    }
    return this.videoFactory.enqueueSystemScriptCandidate(id, employee.name, String(body.prompt || "").trim());
  }

  @Post("data-center/video-projects/:id/system-script-transfer-to-codex")
  async transferFailedSystemScriptToCodex(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以转交 Codex 生成脚本");
    }
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) {
      throw new ForbiddenException("只能转交自己创建的视频项目");
    }
    await this.videoFactory.requestRemoteScriptAfterSystemFailure(id, employee.name, String(body.note || "").trim());
    const scriptSubmission = await this.submitVideoScriptTask(authorization, id);
    return { ...scriptSubmission.project, scriptTask: scriptSubmission.task };
  }

  @Get("data-center/video-projects/:id")
  async videoProjectDetail(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "DATA_CENTER_VIEW");
    let project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name && project.owner !== employee.name && project.assignedTo !== employee.name) {
      throw new ForbiddenException("只能查看自己负责的视频项目");
    }
    // A few direct-output projects were returned before the revision task link
    // existed. Recover only this exact legacy state when the owner refreshes it.
    const factory = Array.isArray(project.sourceSignals)
      ? project.sourceSignals.find((signal: Record<string, unknown>) => signal?.type === "VIDEO_FACTORY") as Record<string, unknown> | undefined
      : undefined;
    const hasReturnedMaster = Array.isArray(project.videoRenderJobs)
      && project.videoRenderJobs.some((job: Record<string, any>) => job?.status === "SUCCEEDED" && job?.outputAsset?.reviewStatus === "RETURNED");
    const isLegacyDirectReturn = String(factory?.projectMode || "") === "CODEX_DIRECT_FULL_VIDEO"
      && hasReturnedMaster
      && !String((factory?.directVideoRevision as Record<string, unknown> | undefined)?.requestedAt || "");
    if (isLegacyDirectReturn) {
      await this.videoFactory.prepareCodexDirectVideoRevision(id, employee.name);
      const revisionSubmission = await this.submitCodexDirectFullVideoTask(authorization, id);
      project = revisionSubmission.project as Record<string, any>;
    }
    // Cover-title tasks created before platform metadata was normalized may have
    // already returned a valid result but remained stuck in WAITING_INPUT. Replay
    // that saved result while the owner refreshes this exact project.
    const currentFactory = Array.isArray(project.sourceSignals)
      ? project.sourceSignals.find((signal: Record<string, unknown>) => signal?.type === "VIDEO_FACTORY") as Record<string, unknown> | undefined
      : undefined;
    const coverTaskId = String(currentFactory?.coverAiTaskId || "");
    const coverTask = (Array.isArray(project.activeAiTasks) ? project.activeAiTasks : [])
      .find((candidate: Record<string, unknown>) => String(candidate.id || "") === coverTaskId);
    if (coverTask?.status === "WAITING_INPUT") {
      await this.aiTasks.reconcileCoverTitleTask(coverTaskId);
      project = await this.videoFactory.project(id) as Record<string, any>;
    }
    return project;
  }

  @Post("data-center/video-projects/:id/script-review")
  async reviewVideoScript(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以审核视频脚本");
    }
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) throw new ForbiddenException("只能审核自己创建的视频项目");
    const action = String(body.action || "").trim().toUpperCase();
    const note = String(body.note || "").trim();
    if (!["APPROVE", "RETURN"].includes(action)) throw new ForbiddenException("审核动作不正确");
    const candidateIndex = body.candidateIndex === undefined ? 0 : Number(body.candidateIndex);
    const factory = Array.isArray(project.sourceSignals)
      ? project.sourceSignals.find((item: Record<string, unknown>) => item?.type === "VIDEO_FACTORY") || {}
      : {};
    const candidates = Array.isArray(project.candidates) && project.candidates.length
      ? project.candidates
      : Array.isArray(project.scriptCandidates) && project.scriptCandidates.length
        ? project.scriptCandidates
        : Array.isArray(factory.scriptCandidates)
          ? factory.scriptCandidates
          : [];
    const selectedCandidate = candidates[Math.max(0, Math.min(candidates.length - 1, Number.isFinite(candidateIndex) ? candidateIndex : 0))] || {};
    if (action === "RETURN" && !note) {
      throw new ForbiddenException("退回 Codex 脚本时必须填写修改原因");
    }
    if (action === "RETURN" && selectedCandidate.generationSource !== "REMOTE_CODEX") {
      throw new ForbiddenException("系统 AI 脚本请使用“转交 Codex”，不能按退回脚本处理");
    }
    if (factory.aiTaskId) {
      await this.aiTasks.review(String(factory.aiTaskId), { action, note }, employee.name);
    }
    const reviewed = await this.videoFactory.reviewScript(
      id,
      action === "APPROVE",
      note,
      employee.name,
      body.candidateIndex === undefined ? undefined : Number.isFinite(candidateIndex) ? candidateIndex : undefined,
    );
    if (action === "RETURN") {
      const scriptSubmission = await this.submitVideoScriptTask(authorization, id);
      return { ...scriptSubmission.project, scriptTask: scriptSubmission.task };
    }
    const preparedProject = await this.videoFactory.generateProject(id, {
      candidateIndex: Number.isFinite(candidateIndex) ? candidateIndex : 0,
      routingMode: "AUTO",
      allowFallback: false,
      prepareOnly: true,
    }, employee.name);
    // The script was approved and every sentence already has an approved
    // material binding.  There is no employee action left between script
    // approval and video generation, so submit the render task immediately.
    // Keeping this on the server also makes the flow reliable when the user
    // closes or refreshes the page at exactly this point.
    if (String((preparedProject as Record<string, unknown>).productionStage || "") === "READY_TO_EDIT") {
      const videoSubmission = await this.submitRemoteVideoTask(authorization, id);
      return {
        ...videoSubmission.project,
        autoSubmittedVideoTask: videoSubmission.task,
      };
    }
    return preparedProject;
  }

  private async submitReferenceDirectFullVideoTask(authorization: string | undefined, id: string) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.employeeId) throw new ForbiddenException("当前账号未关联员工档案");
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) throw new ForbiddenException("只能提交自己创建的视频项目");
    const factory = Array.isArray(project.sourceSignals)
      ? project.sourceSignals.find((item: Record<string, unknown>) => item?.type === "VIDEO_FACTORY") || {}
      : {};
    const brief = factory.brief && typeof factory.brief === "object" ? factory.brief as Record<string, unknown> : {};
    if (String(factory.projectMode || "") !== "REFERENCE_DIRECT_FULL_VIDEO") {
      throw new ForbiddenException("当前项目不是参考视频直出模式");
    }
    const referenceVideoUrl = String(brief.reference || "").trim();
    const revision = factory.directVideoRevision && typeof factory.directVideoRevision === "object"
      ? factory.directVideoRevision as Record<string, unknown>
      : {};
    if (!referenceVideoUrl) throw new ForbiddenException("请填写参考视频链接");
    const task = await this.aiTasks.createTask({
      type: "VIDEO",
      title: `${project.topic} · 参考视频直出`,
      platform: project.targetPlatforms?.[0] || "DOUYIN",
      productModel: project.productModel,
      ownerEmployeeId: employee.employeeId,
      reviewerEmployeeId: employee.employeeId,
      sourceType: "VIDEO_FACTORY_PROJECT",
      sourceId: project.id,
      idempotencyKey: `ai-task:video-project:${project.id}:reference-direct:v${project.workflowVersion}`,
      instructions: compileReferenceDirectFullVideoPrompt(project, brief),
      input: {
        executionMode: "FULL_VIDEO",
        referenceDirectFullVideo: true,
        skipScriptReview: true,
        suppressIntermediateProjectUpdates: true,
        finalReviewOnly: true,
        existingContentPlanId: project.id,
        workflowVersion: project.workflowVersion,
        executionClass: "CODEX_SKILL",
        skillName: "video-editing-from-media-library",
        referenceVideoUrl,
        referenceDirectInput: {
          productModel: project.productModel,
          referenceVideoUrl,
          prompt: String(brief.additionalPrompt || "").trim(),
          ...(Object.keys(revision).length ? { revision } : {}),
        },
        workflowGuard: { projectId: project.id, workflowVersion: project.workflowVersion, stage: "FULL_VIDEO", allowedProjectStages: ["PROJECT_BRIEF", "EDITING"] },
        projectBrief: brief,
        ...(Object.keys(revision).length ? { revision } : {}),
        requiredOutputs: ["master_video", "master_video_path", "source_asset_bindings", "reference_access_report", "review_summary"],
      },
      modelPolicy: { strategy: "CODEX_FIRST", allowExternalGeneration: false, allowFallback: false },
      estimatedCost: 0,
      skipPaidBudget: true,
    }, employee.name) as Record<string, any>;
    await this.videoFactory.attachRemoteTask(id, task.id, "FULL_VIDEO", employee.name);
    const submittedProject = await this.videoFactory.project(id) as Record<string, any>;
    await this.workbench.ensureVideoProjectTask(
      { employeeId: employee.employeeId, name: employee.name },
      {
        id: submittedProject.id,
        productionNo: submittedProject.productionNo,
        topic: submittedProject.topic,
        productionStage: submittedProject.productionStage,
      },
    );
    return { project: submittedProject, task };
  }

  private async submitCodexDirectFullVideoTask(authorization: string | undefined, id: string) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.employeeId) throw new ForbiddenException("当前账号未关联员工档案");
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) throw new ForbiddenException("只能提交自己创建的视频项目");
    const factory = Array.isArray(project.sourceSignals)
      ? project.sourceSignals.find((item: Record<string, unknown>) => item?.type === "VIDEO_FACTORY") || {}
      : {};
    const brief = factory.brief && typeof factory.brief === "object" ? factory.brief as Record<string, unknown> : {};
    if (String(factory.projectMode || "") !== "CODEX_DIRECT_FULL_VIDEO") {
      throw new ForbiddenException("当前项目不是 Codex 直出视频模式");
    }
    if (!String(project.productModel || "").trim()) throw new ForbiddenException("请选择产品型号");
    if (!String(brief.additionalPrompt || "").trim()) throw new ForbiddenException("请填写 AI 提示词");
    const revision = factory.directVideoRevision && typeof factory.directVideoRevision === "object"
      ? factory.directVideoRevision as Record<string, unknown>
      : {};
    const directPrompt = String(brief.additionalPrompt || "").trim();
    const directCreativeMode = /无口播|纯音乐|卡点/u.test(directPrompt) ? "NO_VOICE_VIDEO" : "FULL_VIDEO";
    const task = await this.aiTasks.createTask({
      type: "VIDEO",
      title: `${project.topic} · Codex 直出成片`,
      platform: project.targetPlatforms?.[0] || "DOUYIN",
      productModel: project.productModel,
      ownerEmployeeId: employee.employeeId,
      reviewerEmployeeId: employee.employeeId,
      sourceType: "VIDEO_FACTORY_PROJECT",
      sourceId: project.id,
      idempotencyKey: `ai-task:video-project:${project.id}:codex-direct:v${project.workflowVersion}`,
      instructions: compileCodexDirectFullVideoPrompt(project, brief, revision),
      input: {
        executionMode: "FULL_VIDEO",
        codexDirectFullVideo: true,
        skipScriptReview: true,
        suppressIntermediateProjectUpdates: true,
        finalReviewOnly: true,
        existingContentPlanId: project.id,
        workflowVersion: project.workflowVersion,
        executionClass: "CODEX_SKILL",
        skillName: "video-editing-from-media-library",
        codexDirectInput: {
          productModel: project.productModel,
          prompt: directPrompt,
          creativeMode: directCreativeMode,
          ...(Object.keys(revision).length ? { revision } : {}),
        },
        workflowGuard: { projectId: project.id, workflowVersion: project.workflowVersion, stage: "FULL_VIDEO", allowedProjectStages: ["PROJECT_BRIEF", "EDITING"] },
        ...(Object.keys(revision).length ? { revision } : {}),
        requiredOutputs: ["master_video", "master_video_path", "review_summary"],
      },
      modelPolicy: { strategy: "CODEX_FIRST", allowExternalGeneration: false, allowFallback: false },
      estimatedCost: 0,
      skipPaidBudget: true,
    }, employee.name) as Record<string, any>;
    await this.videoFactory.attachRemoteTask(id, task.id, "FULL_VIDEO", employee.name);
    const submittedProject = await this.videoFactory.project(id) as Record<string, any>;
    await this.workbench.ensureVideoProjectTask(
      { employeeId: employee.employeeId, name: employee.name },
      {
        id: submittedProject.id,
        productionNo: submittedProject.productionNo,
        topic: submittedProject.topic,
        productionStage: submittedProject.productionStage,
      },
    );
    return { project: submittedProject, task };
  }

  private async submitBatchCodexDirectFullVideoTask(authorization: string | undefined, id: string) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.employeeId) throw new ForbiddenException("当前账号未关联员工档案");
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) throw new ForbiddenException("只能提交自己创建的视频项目");
    const factory = Array.isArray(project.sourceSignals)
      ? project.sourceSignals.find((item: Record<string, unknown>) => item?.type === "VIDEO_FACTORY") || {}
      : {};
    const brief = factory.brief && typeof factory.brief === "object" ? factory.brief as Record<string, unknown> : {};
    if (String(factory.projectMode || "") !== "BATCH_CODEX_DIRECT_FULL_VIDEO") {
      throw new ForbiddenException("当前项目不是批量 Codex 直出视频模式");
    }
    const batch = batchBriefValue(brief);
    const products = Array.isArray(batch.products)
      ? (batch.products as Array<Record<string, unknown>>)
        .map((item) => ({ model: String(item.model || "").trim(), count: Math.round(Number(item.count || 0)) }))
        .filter((item) => item.model && item.count > 0)
      : [];
    if (!products.length) throw new ForbiddenException("批量产品清单缺失，请重新创建项目");
    const revision = factory.directVideoRevision && typeof factory.directVideoRevision === "object"
      ? factory.directVideoRevision as Record<string, unknown>
      : {};
    const revisionNote = String(revision.reviewNote || "").trim();
    const idempotencyKey = `ai-task:video-project:${project.id}:batch-codex-direct:v${project.workflowVersion}${revisionNote ? `:r${String(revision.revisionNo || 1)}` : ""}`;
    const task = await this.aiTasks.createTask({
      type: "VIDEO",
      title: `${project.topic} · 批量Codex直出`,
      platform: project.targetPlatforms?.[0] || "DOUYIN",
      productModel: project.productModel,
      ownerEmployeeId: employee.employeeId,
      reviewerEmployeeId: employee.employeeId,
      sourceType: "VIDEO_FACTORY_PROJECT",
      sourceId: project.id,
      idempotencyKey,
      instructions: compileBatchCodexDirectFullVideoPrompt(project, brief, revision),
      input: {
        executionMode: "FULL_VIDEO",
        batchCodexDirectFullVideo: true,
        skipScriptReview: true,
        suppressIntermediateProjectUpdates: true,
        finalReviewOnly: true,
        existingContentPlanId: project.id,
        workflowVersion: project.workflowVersion,
        executionClass: "CODEX_SKILL",
        skillName: "video-editing-from-media-library",
        batchDirectInput: {
          products,
          voiceoverSplit: String(batch.voiceoverSplit || "HALF").toUpperCase(),
          bgmVariety: batch.bgmVariety !== false,
          voiceVariety: batch.voiceVariety !== false,
          generateCoverTitle: batch.generateCoverTitle !== false,
          prompt: String(batch.additionalPrompt || "").trim(),
          ...(Object.keys(revision).length ? { revision } : {}),
        },
        workflowGuard: { projectId: project.id, workflowVersion: project.workflowVersion, stage: "FULL_VIDEO", allowedProjectStages: ["PROJECT_BRIEF", "EDITING"] },
        ...(Object.keys(revision).length ? { revision } : {}),
        requiredOutputs: [
          "batch_manifest",
          "master_videos",
          ...(batch.generateCoverTitle !== false ? ["cover_titles"] : []),
          "review_summary",
        ],
      },
      modelPolicy: { strategy: "CODEX_FIRST", allowExternalGeneration: false, allowFallback: false },
      estimatedCost: 0,
      skipPaidBudget: true,
    }, employee.name) as Record<string, any>;
    await this.videoFactory.attachRemoteTask(id, task.id, "FULL_VIDEO", employee.name);
    const submittedProject = await this.videoFactory.project(id) as Record<string, any>;
    await this.workbench.ensureVideoProjectTask(
      { employeeId: employee.employeeId, name: employee.name },
      {
        id: submittedProject.id,
        productionNo: submittedProject.productionNo,
        topic: submittedProject.topic,
        productionStage: submittedProject.productionStage,
      },
    );
    return { project: submittedProject, task };
  }

  @Post("data-center/video-projects/:id/script-transfer-to-codex")
  async transferVideoScriptToCodex(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以转交 Codex 生成脚本");
    }
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) throw new ForbiddenException("只能转交自己创建的视频项目");
    await this.videoFactory.transferScriptToCodex(
      id,
      employee.name,
      body.candidateIndex === undefined ? undefined : Number(body.candidateIndex),
    );
    const scriptSubmission = await this.submitVideoScriptTask(authorization, id);
    return { ...scriptSubmission.project, scriptTask: scriptSubmission.task };
  }

  @Post("data-center/video-projects/:id/script")
  async updateVideoProjectScript(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以修改视频脚本");
    }
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) throw new ForbiddenException("只能修改自己创建的视频项目");
    if (String(project.productionStage) !== "FACTORY_SCRIPT_READY") {
      throw new ForbiddenException("只有待审核脚本可以直接修改");
    }
    return this.videoFactory.updateDraftScript(id, {
      candidateIndex: body.candidateIndex === undefined ? undefined : Number(body.candidateIndex),
      title: String(body.title || ""),
      hook: String(body.hook || ""),
      script: String(body.script || ""),
      coreTheme: String(body.coreTheme || ""),
      communicationGoal: String(body.communicationGoal || ""),
      userPainPoint: String(body.userPainPoint || ""),
      uniqueSellingPoint: String(body.uniqueSellingPoint || ""),
      voiceoverLines: Array.isArray(body.voiceoverLines) ? body.voiceoverLines.map(String) : [],
      retentionDesign: Array.isArray(body.retentionDesign) ? body.retentionDesign.map(String) : [],
      subtitles: Array.isArray(body.subtitles) ? body.subtitles.map(String) : [],
      emphasisTexts: Array.isArray(body.emphasisTexts) ? body.emphasisTexts.map(String) : [],
      endingSummary: String(body.endingSummary || ""),
      endingInteraction: String(body.endingInteraction || ""),
      endingVisual: String(body.endingVisual || ""),
      changedLineIds: Array.isArray(body.changedLineIds) ? body.changedLineIds.map(String) : [],
    }, employee.name);
  }

  @Post("data-center/video-projects/:id/material-review")
  async reviewVideoProjectMaterials(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以确认镜头素材");
    }
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) throw new ForbiddenException("只能确认自己创建的视频项目素材");
    const action = String(body.action || "").trim().toUpperCase();
    const note = String(body.note || "").trim();
    if (!["APPROVE", "RETURN"].includes(action)) throw new ForbiddenException("素材审核动作不正确");
    if (action === "RETURN" && !note) throw new ForbiddenException("退回素材时必须填写具体原因");
    return this.videoFactory.reviewMaterials(id, action === "APPROVE", note, employee.name);
  }

  @Post("data-center/video-projects/:id/video-task")
  async submitRemoteVideoTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以提交视频生成任务");
    }
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) throw new ForbiddenException("只能提交自己创建的视频项目");
    if (String(project.productionStage) !== "READY_TO_EDIT") {
      throw new ForbiddenException("素材尚未由用户确认");
    }
    await this.videoFactory.assertMaterialsApproved(id);
    const missingShots = (project.videoShots || []).filter((shot: Record<string, unknown>) => !shot.selectedAssetId);
    if (missingShots.length) throw new ForbiddenException(`仍有${missingShots.length}个镜头缺少已确认素材`);
    const materialBindings = (project.videoShots || []).map((shot: Record<string, any>) => ({
      lineId: String(shot.metadata?.lineId || shot.requirementKey),
      sequence: shot.sequence,
      scriptLine: shot.voiceover || shot.subtitle || shot.description,
      assetId: shot.selectedAssetId,
      path: shot.selectedAsset?.sourcePath || shot.selectedAsset?.storageUrl,
      sourceIn: shot.metadata?.sourceIn,
      sourceOut: shot.metadata?.sourceOut,
      usage: "PRIMARY_SHOT",
      visibleFacts: shot.metadata?.visibleFacts || [],
      restrictions: shot.metadata?.restrictions || [],
      userApproved: true,
    }));
    const factory = Array.isArray(project.sourceSignals)
      ? project.sourceSignals.find((item: Record<string, unknown>) => item?.type === "VIDEO_FACTORY") || {}
      : {};
    const candidates = Array.isArray(project.scriptCandidates) ? project.scriptCandidates : [];
    const selectedCandidateIndex = Math.max(0, Math.min(
      candidates.length - 1,
      Number(factory.selectedCandidateIndex || 0),
    ));
    const selectedCandidate = candidates[selectedCandidateIndex];
    if (!selectedCandidate) throw new ForbiddenException("当前项目没有已审核通过的最终脚本");
    const candidateShots = Array.isArray(selectedCandidate.shots) ? selectedCandidate.shots : [];
    const finalMaterialBindings = materialBindings.map((binding: Record<string, unknown>, index: number) => ({
      ...binding,
      // Older scripts did not persist a lineId for every sentence.  The
      // prepared material bindings do have a stable line id, so preserve it
      // instead of rejecting an otherwise complete project at auto-submit.
      lineId: String((candidateShots[index] as Record<string, unknown> | undefined)?.lineId
        || binding.lineId
        || `line_${String(index + 1).padStart(2, "0")}`),
    }));
    const candidateLineIds = new Set(candidateShots.map((shot: Record<string, unknown>, index: number) => String(
      shot.lineId || `line_${String(index + 1).padStart(2, "0")}`,
    )));
    const bindingLineIds = new Set(finalMaterialBindings.map((binding: Record<string, unknown>) => String(binding.lineId || "")));
    if (candidateLineIds.size !== bindingLineIds.size
      || [...candidateLineIds].some((lineId) => !lineId || !bindingLineIds.has(lineId))) {
      throw new ForbiddenException("最终脚本与素材绑定版本不一致，请刷新项目并重新确认脚本素材");
    }
    const scriptRevisionHistory = Array.isArray(factory.scriptRevisionHistory)
      ? factory.scriptRevisionHistory
      : [];
    const finalScriptSnapshot = {
      contentPlanId: project.id,
      projectNo: project.productionNo || project.id,
      workflowVersion: project.workflowVersion,
      candidateIndex: selectedCandidateIndex,
      generationSource: selectedCandidate.generationSource || "UNKNOWN",
      candidateGeneratedAt: selectedCandidate.generatedAt || null,
      scriptEditedAt: factory.scriptEditedAt || null,
      scriptEditedBy: factory.scriptEditedBy || null,
      approvedAt: project.approvedAt || null,
      title: selectedCandidate.title || selectedCandidate.titleZh || project.topic,
      hook: selectedCandidate.hook || "",
      script: selectedCandidate.script || selectedCandidate.scripts?.zh30 || "",
      scriptPackage: selectedCandidate.scriptPackage || {},
      shots: candidateShots,
    };
    const scriptFingerprint = createHash("sha256")
      .update(JSON.stringify(finalScriptSnapshot))
      .digest("hex");
    const task = await this.aiTasks.createTask({
      type: "VIDEO",
      title: `${project.topic} · 远程剪辑成片`,
      platform: project.targetPlatforms?.[0] || "DOUYIN",
      productModel: project.productModel,
      ownerEmployeeId: employee.employeeId,
      reviewerEmployeeId: employee.employeeId,
      sourceType: "VIDEO_FACTORY_PROJECT",
      sourceId: project.id,
      idempotencyKey: `ai-task:video-project:${project.id}:full-video:v${project.workflowVersion}:${scriptFingerprint.slice(0, 16)}`,
      instructions: "使用已审核单脚本和系统提供的素材—脚本绑定执行剪辑。补拍或AI生成素材必须按指定lineId和路径使用，不得重新错配。",
      input: {
        executionMode: "FULL_VIDEO",
        existingContentPlanId: project.id,
        skillName: "video-editing-from-media-library",
        approvedScriptOnly: true,
        scriptIdentity: {
          contentPlanId: project.id,
          projectNo: project.productionNo || project.id,
          workflowVersion: project.workflowVersion,
          candidateIndex: selectedCandidateIndex,
          generationSource: selectedCandidate.generationSource || "UNKNOWN",
          candidateGeneratedAt: selectedCandidate.generatedAt || null,
          scriptFingerprint,
        },
        workflowGuard: {
          projectId: project.id,
          workflowVersion: project.workflowVersion,
          stage: "FULL_VIDEO",
          allowedProjectStages: ["READY_TO_EDIT", "EDITING"],
          scriptFingerprint,
          materialBindingFingerprint: factory.materialReview?.bindingFingerprint || null,
        },
        finalScriptSnapshot,
        scriptRevisionHistory,
        projectBrief: factory.brief || {},
        materialBindings: finalMaterialBindings,
        materialBindingPolicy: {
          bindBy: "lineId",
          rejectUnknownLineId: true,
          rejectMissingAssetId: true,
          changedLinesUseFinalBindingOnly: true,
        },
        coverTitleTiming: "AFTER_VIDEO_APPROVAL",
      },
      modelPolicy: { strategy: "CODEX_FIRST", allowExternalGeneration: false, allowFallback: false },
      estimatedCost: 0,
      skipPaidBudget: true,
    }, employee.name) as Record<string, any>;
    await this.videoFactory.attachRemoteTask(id, task.id, "FULL_VIDEO", employee.name);
    return { project: await this.videoFactory.project(id), task };
  }

  @Post("data-center/video-projects/:id/reshoot-task")
  async createVideoProjectReshootTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以生成补拍任务");
    }
    const project = await this.videoFactory.project(id) as Record<string, any>;
    if (project.createdBy !== employee.name) throw new ForbiddenException("只能处理自己创建的视频项目");
    if (!employee.employeeId) throw new ForbiddenException("当前账号未关联员工档案");
    return this.videoFactory.createGroupedReshootTask(id, employee.employeeId, employee.name);
  }

  @Post("data-center/video-projects/:id/generate")
  generateVideoProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "DATA_CENTER_VIEW");
    return this.videoFactory.generateProject(id, {
      candidateIndex: Number(body.candidateIndex || 0),
      routingMode: "AUTO",
      allowFallback: true,
    }, employee.name);
  }

  @Post("data-center/video-shots/:id/generate")
  generateVideoShot(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以生成视频镜头");
    }
    return this.videoFactory.enqueueShot(id, {
      duration: Number(body.duration || 5),
      routingMode: "AUTO",
      allowFallback: true,
    }, employee.name);
  }

  @Post("ai-tasks/:id/urgent")
  markAiTaskUrgent(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.employeeId) throw new ForbiddenException("当前账号未关联员工档案");
    return this.aiTasks.markEmployeeUrgent(id, employee.employeeId, employee.name);
  }

  @Post("data-center/video-projects/:id/ensure-script-line-shot")
  ensureScriptLineShot(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.requirePermission(authorization, "CONTENT_SUBMIT");
    return this.videoFactory.ensureScriptLineShot(id, Number(body.candidateIndex || 0), Number(body.lineIndex || 0));
  }

  @Post("data-center/video-projects/:id/render")
  renderVideoProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以发起视频剪辑");
    }
    return this.videoFactory.enqueueRender(id, employee.name);
  }

  @Post("data-center/video-projects/:id/archive")
  archiveVideoProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以删除视频项目");
    }
    return this.videoFactory.archiveProject(id, employee.name);
  }

  @Get("data-center/video-projects-recycle-bin")
  videoProjectRecycleBin(
    @Headers("authorization") authorization: string | undefined,
  ) {
    const employee = this.requirePermission(authorization, "DATA_CENTER_VIEW");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以查看视频项目回收站");
    }
    return this.videoFactory.recycledProjects(employee.name);
  }

  @Post("data-center/video-projects/:id/restore")
  restoreVideoProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以恢复视频项目");
    }
    return this.videoFactory.restoreProject(id, employee.name);
  }

  @Post("data-center/video-projects/:id/review")
  async reviewVideoProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以审核成片");
    }
    const action = String(body.action || "").trim().toUpperCase();
    const note = String(body.note || "").trim();
    const outputAssetId = String(body.outputAssetId || "").trim();
    if (!["APPROVE", "RETURN"].includes(action)) throw new ForbiddenException("审核动作不正确");
    if (action === "RETURN" && !note) throw new ForbiddenException("退回时必须填写具体修改说明");
    const render = outputAssetId
      ? await this.prisma.videoRenderJob.findFirst({
        where: { contentPlanId: id, outputAssetId, status: "SUCCEEDED" },
        include: { outputAsset: true },
      })
      : null;
    if (!render?.outputAsset) throw new ForbiddenException("成片与当前视频项目不匹配");
    if (render.outputAsset.reviewStatus !== "PENDING") {
      throw new ForbiddenException("该成片已经完成审核，不能重复提交");
    }
    const currentProject = await this.prisma.contentPlan.findUnique({
      where: { id },
      select: { sourceSignals: true },
    });
    const factory = Array.isArray(currentProject?.sourceSignals)
      ? currentProject.sourceSignals.find((signal: any) => signal?.type === "VIDEO_FACTORY") as Record<string, unknown> | undefined
      : undefined;
    const directProjectMode = String(factory?.projectMode || "");
    const codexDirectFullVideo = directProjectMode === "CODEX_DIRECT_FULL_VIDEO";
    const referenceDirectFullVideo = directProjectMode === "REFERENCE_DIRECT_FULL_VIDEO";
    // A final-video return must also return the AI task that produced it.  Without
    // this, the asset was marked RETURNED while the task remained PENDING_REVIEW,
    // leaving the employee project stuck at 100% / "waiting for review".
    if (action === "RETURN") {
      const videoAiTaskId = String(factory?.videoAiTaskId || "").trim();
      if (videoAiTaskId) {
        await this.aiTasks.review(videoAiTaskId, { action: "RETURN", note }, employee.name);
      }
    }
    const reviewed = await this.videoFactory.reviewOutput(outputAssetId, action === "APPROVE", employee.name, note);
    if (action === "RETURN" && codexDirectFullVideo) {
      await this.videoFactory.prepareCodexDirectVideoRevision(id, employee.name);
      const revisionSubmission = await this.submitCodexDirectFullVideoTask(authorization, id);
      return { ...revisionSubmission.project, revisionTask: revisionSubmission.task, previousReview: reviewed };
    }
    if (action === "RETURN" && referenceDirectFullVideo) {
      await this.videoFactory.prepareCodexDirectVideoRevision(id, employee.name);
      const revisionSubmission = await this.submitReferenceDirectFullVideoTask(authorization, id);
      return { ...revisionSubmission.project, revisionTask: revisionSubmission.task, previousReview: reviewed };
    }
    return reviewed;
  }

  @Post("data-center/video-projects/:id/batch-review")
  async reviewBatchVideoProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以审核批量成片");
    }
    const action = String(body.action || "").trim().toUpperCase();
    const note = String(body.note || "").trim();
    if (!["APPROVE", "RETURN"].includes(action)) throw new ForbiddenException("审核动作不正确");
    if (action === "RETURN" && !note) throw new ForbiddenException("退回时必须填写具体修改说明");
    const project = await this.videoFactory.project(id) as Record<string, any>;
    const factory = Array.isArray(project.sourceSignals)
      ? project.sourceSignals.find((item: Record<string, unknown>) => item?.type === "VIDEO_FACTORY") || {}
      : {};
    if (String(factory.projectMode || "") !== "BATCH_CODEX_DIRECT_FULL_VIDEO") {
      throw new ForbiddenException("当前项目不是批量 Codex 直出模式");
    }
    const brief = factory.brief && typeof factory.brief === "object" ? factory.brief as Record<string, unknown> : {};
    const batch = batchBriefValue(brief);
    if (action === "RETURN") {
      const videoAiTaskId = String(factory.videoAiTaskId || "").trim();
      if (videoAiTaskId) {
        await this.aiTasks.review(videoAiTaskId, { action: "RETURN", note }, employee.name);
      }
      const pendingRender = await this.prisma.videoRenderJob.findFirst({
        where: { contentPlanId: id, status: "SUCCEEDED", outputAsset: { reviewStatus: "PENDING" } },
        orderBy: { createdAt: "asc" },
        select: { outputAssetId: true },
      });
      if (pendingRender?.outputAssetId) {
        await this.videoFactory.reviewOutput(pendingRender.outputAssetId, false, employee.name, note);
      }
      await this.videoFactory.prepareCodexDirectVideoRevision(id, employee.name);
      const revisionSubmission = await this.submitBatchCodexDirectFullVideoTask(authorization, id);
      return { ...revisionSubmission.project, revisionTask: revisionSubmission.task };
    }
    const renders = await this.prisma.videoRenderJob.findMany({
      where: { contentPlanId: id, status: "SUCCEEDED", outputAsset: { reviewStatus: "PENDING" } },
      select: { outputAssetId: true },
    });
    for (const render of renders) {
      if (render.outputAssetId) {
        await this.videoFactory.reviewOutput(render.outputAssetId, true, employee.name, "批量成片审核通过");
      }
    }
    const coverAiTaskId = String(factory.coverAiTaskId || "").trim();
    if (coverAiTaskId) {
      await this.prisma.aiTask.updateMany({
        where: { id: coverAiTaskId, status: "PENDING_REVIEW" },
        data: { status: "COMPLETED", finishedAt: new Date(), reviewedAt: new Date(), reviewedBy: employee.name },
      });
    }
    await this.prisma.contentPlan.update({
      where: { id },
      data: { productionStage: "READY_TO_PUBLISH", masterVideoStatus: "APPROVED" },
    });
    return this.videoFactory.project(id);
  }

  @Post("data-center/video-projects/:id/batch-cover-title")
  async submitBatchCoverTitleTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.employeeId) throw new ForbiddenException("当前账号未关联员工档案");
    const project = await this.videoFactory.project(id) as Record<string, any>;
    const factory = Array.isArray(project.sourceSignals)
      ? project.sourceSignals.find((item: Record<string, unknown>) => item?.type === "VIDEO_FACTORY") || {}
      : {};
    if (String(factory.projectMode || "") !== "BATCH_CODEX_DIRECT_FULL_VIDEO") {
      throw new ForbiddenException("当前项目不是批量 Codex 直出模式");
    }
    const brief = factory.brief && typeof factory.brief === "object" ? factory.brief as Record<string, unknown> : {};
    const batch = batchBriefValue(brief);
    if (batch.generateCoverTitle !== false) {
      throw new ForbiddenException("该项目已在视频任务中同时生成封面标题，不需要单独提交");
    }
    const products = Array.isArray(batch.products)
      ? (batch.products as Array<Record<string, unknown>>)
        .map((item) => ({ model: String(item.model || "").trim(), count: Math.round(Number(item.count || 0)) }))
        .filter((item) => item.model && item.count > 0)
      : [];
    if (!products.length) throw new ForbiddenException("批量产品清单缺失");
    const existingTasks = await this.prisma.aiTask.findMany({
      where: {
        type: "VIDEO",
        sourceType: "VIDEO_FACTORY_PROJECT",
        sourceId: id,
        status: { in: ["PENDING", "CLAIMED", "RUNNING", "QUALITY_CHECK", "UPLOADING", "PENDING_REVIEW"] },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const active = existingTasks.find((item) => String((item.input as Record<string, unknown>)?.executionMode || "") === "COVER_TITLE");
    if (active) return { project: await this.videoFactory.project(id), task: active, duplicate: true };
    const historical = await this.prisma.aiTask.findMany({
      where: { type: "VIDEO", sourceType: "VIDEO_FACTORY_PROJECT", sourceId: id },
      select: { input: true },
    });
    const revision = historical.filter((item) => String((item.input as Record<string, unknown>)?.executionMode || "") === "COVER_TITLE").length + 1;
    const productLines = products.map((item, index) => `${index + 1}. ${item.model}（${item.count} 条）`).join("\n");
    const task = await this.aiTasks.createTask({
      type: "VIDEO",
      title: `${project.topic} · 批量封面标题`,
      platform: project.targetPlatforms?.[0] || "DOUYIN",
      productModel: project.productModel,
      ownerEmployeeId: employee.employeeId,
      reviewerEmployeeId: employee.employeeId,
      sourceType: "VIDEO_FACTORY_PROJECT",
      sourceId: id,
      idempotencyKey: `ai-task:video-project:${id}:batch-cover-title:v${revision}`,
      instructions: `【任务类型】批量封面标题生成\n项目编号：${project.productionNo || id}\n批量产品分配：\n${productLines}\n请为已生成的全部视频逐一生成封面、标题和标签；每条视频的标签至少 5 个。先分析已审核成片，再按各视频内容和产品型号生成，避免整批标题和标签重复。`,
      input: {
        executionMode: "COVER_TITLE",
        batchCodexDirectFullVideo: true,
        existingContentPlanId: id,
        skillName: "video-editing-from-media-library",
        childSkillName: "feng-mian-biao-ti",
        batchDirectInput: {
          products,
          generateCoverTitle: true,
          voiceoverSplit: String(batch.voiceoverSplit || "HALF").toUpperCase(),
          bgmVariety: batch.bgmVariety !== false,
          voiceVariety: batch.voiceVariety !== false,
        },
        requiredOutputs: ["batch_manifest", "cover_titles", "title_workbook"],
        resultContract: {
          packaging: "每条视频一条，包含 videoKey、platform、title、body、coverText、hashtags（至少 5 个）、contentFingerprint、compliance",
          outputFiles: "每条视频上传一张 JPG 封面，kind=COVER_IMAGE，metadata.videoKey 必须等于对应视频键",
        },
      },
      modelPolicy: { strategy: "CODEX_FIRST", allowExternalGeneration: false, allowFallback: false },
      estimatedCost: 0,
      skipPaidBudget: true,
    }, employee.name) as Record<string, any>;
    await this.videoFactory.attachRemoteTask(id, task.id, "COVER_TITLE", employee.name);
    return { project: await this.videoFactory.project(id), task, duplicate: false };
  }

  @Post("data-center/video-projects/:id/batch-publish")
  async recordBatchPublish(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以回传批量发布链接");
    }
    const records = Array.isArray(body.records) ? body.records as Array<Record<string, unknown>> : [];
    if (!records.length) throw new ForbiddenException("请至少填写一条发布链接");
    const allowedPlatforms = ["DOUYIN", "TIKTOK", "XIAOHONGSHU", "BILIBILI", "WECHAT_CHANNELS", "KUAISHOU"];
    const normalized = records.map((record) => ({
      videoKey: String(record.videoKey || "").trim(),
      platform: String(record.platform || "").trim().toUpperCase(),
      remoteUrl: String(record.remoteUrl || "").trim(),
    }));
    if (normalized.some((record) => !record.videoKey)) throw new ForbiddenException("每条发布记录必须对应一条视频");
    if (normalized.some((record) => !allowedPlatforms.includes(record.platform))) {
      throw new ForbiddenException("发布平台不在支持范围内");
    }
    if (normalized.some((record) => !/^https?:\/\/\S+$/i.test(record.remoteUrl))) {
      throw new ForbiddenException("请填写以 http:// 或 https:// 开头的完整作品链接");
    }
    const project = await this.videoFactory.project(id) as Record<string, any>;
    const factory = Array.isArray(project.sourceSignals)
      ? project.sourceSignals.find((item: Record<string, unknown>) => item?.type === "VIDEO_FACTORY") || {}
      : {};
    if (String(factory.projectMode || "") !== "BATCH_CODEX_DIRECT_FULL_VIDEO") {
      throw new ForbiddenException("当前项目不是批量 Codex 直出模式");
    }
    const brief = factory.brief && typeof factory.brief === "object" ? factory.brief as Record<string, unknown> : {};
    const batch = batchBriefValue(brief);
    if (!["READY_TO_PUBLISH", "PUBLISHING", "TRACKING"].includes(String(project.productionStage || ""))) {
      throw new ForbiddenException("请先审核通过成片，再回传发布链接");
    }
    const previous = Array.isArray(batch.publishRecords) ? batch.publishRecords as Array<Record<string, unknown>> : [];
    const merged = [
      ...previous.filter((item) => !normalized.some((record) => record.videoKey === String(item.videoKey || ""))),
      ...normalized,
    ];
    const nextSignals = (project.sourceSignals as Array<Record<string, unknown>>).map((signal) => {
      if (String(signal.type || "") !== "VIDEO_FACTORY") return signal;
      return {
        ...signal,
        brief: {
          ...(brief as Record<string, unknown>),
          batchDirect: { ...batch, publishRecords: merged },
        },
      };
    });
    await this.prisma.contentPlan.update({
      where: { id },
      data: {
        productionStage: "TRACKING",
        masterVideoStatus: "APPROVED",
        sourceSignals: nextSignals as never,
        targetPlatforms: Array.from(new Set([...(project.targetPlatforms || []), ...normalized.map((record) => record.platform)])) as never,
      },
    });
    await this.prisma.opsTask.updateMany({
      where: {
        sourceType: "VIDEO_PROJECT",
        sourceId: id,
        deletedAt: null,
        status: { notIn: ["CANCELLED", "COMPLETED"] },
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        completedBy: employee.name,
        result: `已回传 ${normalized.length} 条批量视频发布链接，项目进入数据跟踪`,
      },
    });
    return this.videoFactory.project(id);
  }

  @Post("data-center/video-projects/:id/similar")
  createSimilarVideoProject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以生成类似视频");
    }
    return this.videoFactory.createSimilarProject(id, {
      outputAssetId: String(body.outputAssetId || "").trim(),
      replaceHook: Boolean(body.replaceHook),
      hook: body.hook ? String(body.hook) : undefined,
      replaceProduct: Boolean(body.replaceProduct),
      productModel: body.productModel ? String(body.productModel) : undefined,
      replaceFeature: Boolean(body.replaceFeature),
      feature: body.feature ? String(body.feature) : undefined,
    }, employee.name);
  }

  @Post("data-center/video-projects/:id/packaging")
  async generateVideoPackaging(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以确认成片并生成封面标题");
    }
    const outputAssetId = String(body.outputAssetId || "").trim();
    const render = outputAssetId
      ? await this.prisma.videoRenderJob.findFirst({
        where: { contentPlanId: id, outputAssetId },
        include: { outputAsset: true },
      })
      : null;
    if (!render?.outputAsset) throw new ForbiddenException("成片与当前视频项目不匹配");
    if (render.outputAsset.reviewStatus !== "APPROVED") {
      await this.videoFactory.reviewOutput(outputAssetId, true, employee.name, "成片预览确认满意并生成平台包装");
    }
    return this.submitCoverTitleTask(id, outputAssetId, employee);
  }

  @Post("data-center/video-projects/:id/packaging/:variantId/review")
  async reviewVideoPackaging(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Param("variantId") variantId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以审核封面和标题");
    }
    const approved = Boolean(body.approved);
    const note = String(body.note || "").trim();
    if (!approved && !note) throw new ForbiddenException("退回封面和标题时必须填写具体修改说明");
    const variant = await this.prisma.contentVariant.findFirst({
      where: { id: variantId, contentPlanId: id },
      select: { id: true, packagingStatus: true, metadata: true },
    });
    if (!variant) throw new ForbiddenException("平台包装与当前视频项目不匹配");
    if (!["PENDING_REVIEW", "RETURNED"].includes(variant.packagingStatus)) {
      throw new ForbiddenException("该平台包装当前不能重复审核");
    }
    const reviewed = await this.content.reviewPackaging(variantId, approved, employee.name, { note });
    const variantMetadata = variant.metadata && typeof variant.metadata === "object" && !Array.isArray(variant.metadata)
      ? variant.metadata as Record<string, unknown>
      : {};
    const coverAiTaskId = String(variantMetadata.coverAiTaskId || "").trim();
    if (approved) {
      const remaining = await this.prisma.contentVariant.count({
        where: { contentPlanId: id, platform: { in: (reviewed as Record<string, any>).targetPlatforms || [] }, packagingStatus: { not: "APPROVED" } },
      });
      if (coverAiTaskId && remaining === 0) {
        await this.prisma.aiTask.updateMany({
          where: { id: coverAiTaskId, status: "PENDING_REVIEW" },
          data: { status: "COMPLETED", finishedAt: new Date(), reviewedAt: new Date(), reviewedBy: employee.name },
        });
      }
      return reviewed;
    }
    if (coverAiTaskId) {
      await this.prisma.aiTask.updateMany({
        where: { id: coverAiTaskId, status: "PENDING_REVIEW" },
        data: { status: "RETURNED", reviewNote: note, reviewedAt: new Date(), reviewedBy: employee.name },
      });
    }
    const master = await this.prisma.videoRenderJob.findFirst({
      where: { contentPlanId: id, status: "SUCCEEDED", outputAsset: { reviewStatus: "APPROVED" } },
      orderBy: { createdAt: "desc" },
      select: { outputAssetId: true },
    });
    if (!master?.outputAssetId) throw new ForbiddenException("没有可用于重做封面标题的已审核成片");
    return this.submitCoverTitleTask(id, master.outputAssetId, employee);
  }

  @Post("data-center/video-projects/:id/manual-publish")
  async recordWorkbenchManualPublish(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以回传发布链接");
    }
    const outputAssetId = String(body.outputAssetId || "").trim();
    const allowedPlatforms = ["DOUYIN", "TIKTOK", "XIAOHONGSHU", "BILIBILI", "WECHAT_CHANNELS", "KUAISHOU"];
    const records = Array.isArray(body.records) ? body.records as Array<Record<string, unknown>> : [];
    if (!records.length) throw new ForbiddenException("请至少填写一个平台的发布链接");
    const normalized = records.map((record) => ({
      platform: String(record.platform || "").trim().toUpperCase(),
      remoteUrl: String(record.remoteUrl || "").trim(),
      publishedAt: record.publishedAt ? String(record.publishedAt) : undefined,
    }));
    if (normalized.some((record) => !allowedPlatforms.includes(record.platform))) {
      throw new ForbiddenException("发布平台不在支持范围内");
    }
    if (new Set(normalized.map((record) => record.platform)).size !== normalized.length) {
      throw new ForbiddenException("同一平台请只填写一条发布记录");
    }
    if (normalized.some((record) => !/^https?:\/\/\S+$/i.test(record.remoteUrl))) {
      throw new ForbiddenException("请填写以 http:// 或 https:// 开头的完整作品链接");
    }
    const [render, plan] = await Promise.all([
      this.prisma.videoRenderJob.findFirst({
        where: { contentPlanId: id, outputAssetId, status: "SUCCEEDED" },
        include: { outputAsset: true },
      }),
      this.prisma.contentPlan.findUnique({ where: { id }, include: { variants: true } }),
    ]);
    if (!render?.outputAsset || render.outputAsset.reviewStatus !== "APPROVED") {
      throw new ForbiddenException("只有审核通过的成片可以回传发布链接");
    }
    if (!plan) throw new ForbiddenException("视频项目不存在");
    if (!["READY_TO_PUBLISH", "PUBLISHING", "TRACKING"].includes(String(plan.productionStage))) {
      throw new ForbiddenException("请先生成并审核通过封面和标题，再回传发布链接");
    }
    const approvedVariantByPlatform = new Map(
      plan.variants
        .filter((variant) => variant.packagingStatus === "APPROVED")
        .map((variant) => [String(variant.platform), variant]),
    );
    if (normalized.some((record) => !approvedVariantByPlatform.has(record.platform))) {
      throw new ForbiddenException("所选平台的封面和标题尚未审核通过");
    }
    const platformNames: Record<string, string> = {
      DOUYIN: "抖音", TIKTOK: "TikTok", XIAOHONGSHU: "小红书",
      BILIBILI: "B站", WECHAT_CHANNELS: "视频号", KUAISHOU: "快手",
    };
    const results = [];
    for (const record of normalized) {
      const integration = await this.prisma.integration.upsert({
        where: { kind: record.platform as never },
        create: {
          kind: record.platform as never,
          displayName: platformNames[record.platform] || record.platform,
          capabilities: ["manual_publish"],
          message: "已支持手动回传发布链接；自动发布与数据采集需单独配置",
        },
        update: {},
      });
      const variant = approvedVariantByPlatform.get(record.platform)!;
      void integration;
      results.push(await this.content.recordManualPublish(variant.id, employee.name, {
        remoteUrl: record.remoteUrl,
        publishedAt: record.publishedAt,
      }));
    }
    await this.prisma.contentPlan.update({
      where: { id },
      data: {
        targetPlatforms: Array.from(new Set([...plan.targetPlatforms, ...normalized.map((record) => record.platform)])) as never,
      },
    });
    await this.prisma.opsTask.updateMany({
      where: {
        sourceType: "VIDEO_PROJECT",
        sourceId: id,
        deletedAt: null,
        status: { notIn: ["CANCELLED", "COMPLETED"] },
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        completedBy: employee.name,
        result: `已回传${results.length}个平台的发布链接，视频项目进入数据跟踪`,
      },
    });
    return { saved: results.length, platforms: normalized.map((record) => record.platform) };
  }

  @Get("data-center/video-projects/:id/packaging/:variantId/cover")
  async videoPackagingCover(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Param("variantId") variantId: string,
  ) {
    this.requirePermission(authorization, "DATA_CENTER_VIEW");
    const file = await this.content.packagingCoverFile(id, variantId);
    return new StreamableFile(createReadStream(file.path), {
      type: "image/jpeg",
      disposition: `inline; filename="${file.fileName}"`,
    });
  }

  @Get("data-center/video-projects/:id/packaging/:variantId/cover-url")
  videoPackagingCoverUrl(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Param("variantId") variantId: string,
  ) {
    this.requirePermission(authorization, "DATA_CENTER_VIEW");
    return this.content.packagingCoverUrl(id, variantId);
  }

  @Post("data-center/video-scripts/generate")
  generateVideoScript(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以生成视频脚本");
    }
    const generationMode = String(body.generationMode || "ASSET_FIRST").toUpperCase();
    if (!["ASSET_FIRST", "ASSET_ONLY"].includes(generationMode)) {
      throw new ForbiddenException("脚本生成模式不正确");
    }
    const productModel = String(body.productModel || "").trim();
    if (generationMode === "ASSET_ONLY" && !productModel) {
      throw new ForbiddenException("无需补拍模式必须选择产品型号");
    }
    return this.content.generateDailyVideo(new Date(), employee.name, productModel || undefined, {
      assetOnly: generationMode === "ASSET_ONLY",
      restricted: String(body.contentRestrictionMode || "NORMAL") === "HEALTH_RESTRICTED",
      platform: body.platform === "TIKTOK" ? "TIKTOK" : "DOUYIN",
      keywordIds: Array.isArray(body.keywordIds) ? body.keywordIds.map(String) : [],
      topic: String(body.topic || "").trim(),
      audience: String(body.audience || "").trim(),
      objective: String(body.objective || "").trim(),
      voiceoverMode: String(body.voiceoverMode || "VOICEOVER"),
      force: true,
    });
  }

  @Post("data-center/asset-gaps/analyze")
  analyzeAssetGaps(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "ASSET_VIEW");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以分析缺失素材");
    }
    return this.brandData.analyzeProductAssetGaps(String(body.productModel || ""), employee.name);
  }

  @Post("data-center/asset-gaps/tasks")
  createAssetGapTasks(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const employee = this.requirePermission(authorization, "CONTENT_SUBMIT");
    if (!employee.roles.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role))) {
      throw new ForbiddenException("只有运营和视频专员可以生成补拍任务");
    }
    return this.brandData.createSelectedGapTasks(
      Array.isArray(body.ids) ? body.ids.map(String) : [],
      employee.name,
    );
  }

  @Get("live/learning")
  async liveLearning(@Headers("authorization") authorization?: string) {
    const employee = this.employee(authorization);
    if (!employee.roles.includes("LIVE_HOST")) return { roleEnabled: false, courses: [], reviews: [] };
    const [knowledge, tasks] = await Promise.all([
      this.prisma.knowledgeEntry.findMany({
        where: {
          status: "READY",
          OR: [
            { category: { contains: "直播", mode: "insensitive" } },
            { title: { contains: "直播", mode: "insensitive" } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 30,
      }),
      this.prisma.opsTask.findMany({
        where: {
          assigneeEmployeeId: employee.employeeId,
          category: { in: ["LIVE", "LIVE_REVIEW", "LIVE_LEARNING"] },
        },
        include: { submissions: { orderBy: { version: "desc" }, take: 1 } },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);
    return { roleEnabled: true, courses: knowledge, reviews: tasks };
  }
}

@Controller("api/v1/admin")
export class AdminV2Controller {
  constructor(
    private readonly auth: AuthService,
    private readonly workbench: WorkbenchService,
  ) {}

  private actor(authorization?: string) {
    return this.auth.requireAdmin(authorization);
  }

  @Get("workspace")
  workspace(@Headers("authorization") authorization?: string) {
    this.auth.requirePermission(authorization, "SYSTEM_VIEW");
    return this.workbench.adminOverview();
  }

  @Get("tasks")
  tasks(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    this.auth.requirePermission(authorization, "TASK_MANAGE");
    return this.workbench.adminTasks(query);
  }

  @Post("tasks")
  createTask(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    this.auth.requirePermission(authorization, "TASK_MANAGE");
    return this.workbench.createTask(body, this.actor(authorization));
  }

  @Patch("tasks/:id/assign")
  assignTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.auth.requirePermission(authorization, "TASK_MANAGE");
    return this.workbench.assignTask(id, body, this.actor(authorization));
  }

  @Post("tasks/:id/review")
  reviewTask(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.auth.requirePermission(authorization, "TASK_REVIEW");
    return this.workbench.reviewTask(id, body, this.actor(authorization));
  }

  @Post("roles")
  saveRole(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    this.auth.requirePermission(authorization, "ROLE_MANAGE");
    return this.workbench.saveRole(body);
  }

  @Patch("employees/:id/roles")
  setEmployeeRoles(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.auth.requirePermission(authorization, "ROLE_MANAGE");
    return this.workbench.setEmployeeRoles(
      id,
      Array.isArray(body.roleCodes) ? body.roleCodes.map((item) => String(item)) : [],
    );
  }
}
