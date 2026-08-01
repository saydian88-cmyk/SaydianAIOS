import { Injectable } from "@nestjs/common";
import { opsConfig } from "./config";
import {
  BAILIAN_VIDEO_SCRIPT_SYSTEM_POLICY,
  validateBailianVideoScriptResult,
} from "./bailian-video-script-policy";

export type AiVideoCandidate = {
  topic: string;
  audience: string;
  objective: string;
  hook: string;
  outline: string[];
  score: number;
  scoreBreakdown: Record<string, number>;
  assetIds: string[];
  referenceIds: string[];
  missingAssets: string[];
  titleZh: string;
  titleEn: string;
  coverTextZh: string;
  coverTextEn: string;
  hashtags: string[];
  scripts: { zh15: string; en15: string; zh30: string; en30: string };
  scriptPackage: {
    basicInfo: {
      productModel: string;
      videoType: string;
      platform: string;
      accountType: string;
      targetAudience: string;
      estimatedDurationSeconds: number;
      healthContentAllowed: boolean;
    };
    positioning: { coreTheme: string; communicationGoal: string; userPainPoint: string; uniqueSellingPoint: string };
    goldenHook: { copy: string; type: string; visual: string; retentionReason: string; openingSound: string };
    voiceoverLines: Array<{ lineId?: string; text: string; tone: string; speed: string; emotion: string; durationSeconds: number }>;
    structure: Array<{ stage: string; purpose: string; content: string }>;
    shotRequirements: Array<{
      line: string;
      lineId?: string;
      visual: string;
      matchedVideoAssetIds?: string[];
      auxiliaryImageAssetIds?: string[];
      assetStatus: "COVERED" | "REWRITABLE" | "NEED_SHOOT" | "PROHIBITED";
      factualProof: string;
      audioVisualRequirement: string;
    }>;
    retentionDesign: string[];
    styleChecks?: {
      attitudeOpening: boolean;
      shortSentenceRhythm: boolean;
      lightContrast: boolean;
      concreteActions: boolean;
      memorablePhrase: boolean;
      manualToneCheck: boolean;
      templateQuestionCheck: boolean;
      notes: string[];
    };
    subtitles: string[];
    emphasisTexts: string[];
    soundDesign: { voiceProfile: string; tone: string; emotion: string; speed: string; openingSfx: string; keySfx: string[]; ambientSound: string };
    complianceChecks: Array<{ category: string; status: "PASS" | "REVIEW" | "BLOCK"; note: string }>;
    ending: { summary: string; interaction: string; visual: string; safeTailSeconds: number };
    materialGaps: Array<{ product: string; action: string; shotSize: string; processOrResult: string; shootingMethod: string }>;
  };
};

export type AiArticlePackage = {
  topic: string;
  audience: string;
  objective: string;
  hook: string;
  outline: string[];
  score: number;
  scoreBreakdown: Record<string, number>;
  assetIds: string[];
  title: string;
  summary: string;
  keywords: string[];
  cta: string;
  imageSuggestions: string[];
  citedKnowledgeIds: string[];
  variants: {
    wechatOfficial: string;
    xiaohongshu: string;
    shortPost: string;
    wecomMoments: string;
  };
};

export type AiPlatformPackaging = {
  title: string;
  body: string;
  hashtags: string[];
  coverText: string;
  coverSpec: Record<string, unknown>;
};

export type AiAssetCoverage = {
  shots: Array<{
    description: string;
    matchedAssetIds: string[];
    matchedVideoAssetIds: string[];
    auxiliaryImageAssetIds: string[];
    coverage: "EXISTING" | "MISSING";
    reason: string;
  }>;
};

export type AiViralKeyword = {
  keyword: string;
  type: "PRODUCT" | "AUDIENCE" | "PAIN" | "VALUE" | "SCENE" | "HOOK" | "CONVERSION" | "TREND" | "COMPETITOR";
  priority: "A" | "B" | "C";
  productModel?: string;
  reason: string;
  clusterKey?: string;
  clusterName?: string;
  audience?: string;
  pain?: string;
  scene?: string;
};

export type AiAssetGap = {
  category: string;
  assetKind: "IMAGE" | "VIDEO" | "AUDIO";
  description: string;
  reason: string;
  priority: "HIGH" | "NORMAL" | "LOW";
  suggestedTags: string[];
};

type JsonRecord = Record<string, unknown>;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function parseJson(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
  const cleaned = text(value).replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  return object(JSON.parse(cleaned));
}

function score(value: unknown): number {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

export function isCompleteVideoCandidate(candidate: AiVideoCandidate): boolean {
  return candidate.hook.length >= 4
    && candidate.outline.length >= 3
    && candidate.scripts.zh15.length >= 40
    && candidate.scripts.zh30.length >= 70
    && Boolean(candidate.scriptPackage?.basicInfo?.productModel)
    && Boolean(candidate.scriptPackage?.positioning?.coreTheme)
    && Boolean(candidate.scriptPackage?.goldenHook?.visual)
    && candidate.scriptPackage.voiceoverLines.length >= 3
    && candidate.scriptPackage.structure.length >= 5
    && candidate.scriptPackage.shotRequirements.length >= 3
    && candidate.scriptPackage.complianceChecks.length >= 1;
}

@Injectable()
export class AiContentService {
  capabilities() {
    return {
      state: opsConfig.bailian.apiKey ? "AVAILABLE" as const : "UNCONFIGURED" as const,
      model: opsConfig.bailian.textModel,
    };
  }

  async generateVideoCandidates(context: JsonRecord): Promise<AiVideoCandidate[]> {
    const exactCount = Math.max(1, Math.min(3, Math.round(Number(context.exactCount) || 3)));
    const hasGenerationMode = Object.prototype.hasOwnProperty.call(context, "generationMode");
    const hasContentRestrictionMode = Object.prototype.hasOwnProperty.call(context, "contentRestrictionMode");
    const hasVoiceoverMode = Object.prototype.hasOwnProperty.call(context, "voiceoverMode");
    const assetOnly = context.generationMode === "ASSET_ONLY";
    const restricted = context.contentRestrictionMode === "HEALTH_RESTRICTED";
    const noVoiceover = context.voiceoverMode === "NO_VOICEOVER";
    const assetPolicy = !hasGenerationMode ? "" : assetOnly
      ? "本次为快速成片模式：每一个镜头都必须能由输入中的已有素材覆盖，只能引用真实assetId；严禁设计任何需要补拍的新镜头，missingAssets必须为空。"
      : "必须先学习并检索输入assets中的持久化结构化素材索引，再确定选题、卖点和逐句镜头。优先围绕已有视频素材能直接证明的事实设计脚本，在内容质量相近时选择素材覆盖率更高、需要补拍更少的方案；只有索引中确实没有合格视频画面时才列出缺失素材。";
    const restrictionPolicy = !hasContentRestrictionMode ? "" : restricted
      ? `本次为健康内容受限模式。脚本、标题、字幕、封面、标签、镜头描述和画面规划均不得出现restrictedWords中的词及其谐音、拆字、缩写、暗示或变体；不得设计restrictedVisuals描述的画面。只能引用输入assets中的素材，输入素材已经过风险过滤，严禁引用其他素材。`
      : "本次为普通模式，不额外应用健康内容受限规则。";
    const voiceoverPolicy = !hasVoiceoverMode ? "" : noVoiceover
      ? "本次必须生成无口播视频：不得设计人物口播、旁白、配音或对话；用连续视频画面、动作、音乐节奏、音效和屏幕字幕完整表达内容。scripts字段填写分段屏幕字幕与画面节奏，不得写成朗读稿。"
      : "本次生成有口播视频：提供自然简洁的中文/英文口播，并让口播与镜头动作逐段对应。";
    const userScriptPolicy = context.scriptSource === "USER"
      ? `userProvidedDirections是用户提供的${exactCount}个脚本要求。必须保留核心主题、表达顺序和关键文案，并补齐完整scriptPackage。`
      : `由AI生成${exactCount}个完整脚本候选，每个候选都必须输出完整scriptPackage，不能只返回Hook或一句概述。`;
    const result = await this.callJson(
      `根据已审核的赛电产品知识、FAQ、高分自有素材和外部参考，生成${exactCount}个完整短视频脚本候选。
只使用输入中的assetId、referenceId、产品事实和证据；缺素材写入missingAssets，不得虚构。
assets是系统已经学习并持久化的素材知识，不需要也不得仅凭文件名重新猜测。必须综合aiIndex、tags、contentDescription、segments、indexConfidence和indexNeedsReview判断素材能证明什么；优先使用indexNeedsReview=false且indexConfidence较高的VIDEO。
先在内部完成“产品型号→核心功能/场景→动作→景别→有效片段”的素材检索，再写内容定位、口播和逐句镜头。每个COVERED镜头必须返回真实assetId并与口播事实直接对应；外观、包装、佩戴空镜不能替代具体功能操作、过程或结果。
IMAGE只能作为仍在播放的视频上的辅助层，不能单独构成带时长的主镜头。若只有图片没有视频，该镜头必须标记NEED_SHOOT。
${assetPolicy}
${restrictionPolicy}
${voiceoverPolicy}
${userScriptPolicy}
每个候选必须含15秒和30秒中英文完整脚本、Hook、节奏化镜头大纲、字幕/CTA思路、标题、封面文案和标签，并生成scriptPackage结构化执行脚本。
严禁只返回一句Hook或把Hook重复当作正文。outline至少3段；zh15至少40个汉字并包含开场、核心内容和结尾引导；zh30至少70个汉字并包含开场、场景或痛点、产品或功能展示、结果或价值、结尾引导。无口播模式也必须给出逐段画面字幕和动作节奏。
scriptPackage必须包含：
1.basicInfo：productModel、videoType、platform、accountType、targetAudience、estimatedDurationSeconds、healthContentAllowed。
2.positioning：coreTheme、communicationGoal、userPainPoint、uniqueSellingPoint，且一条视频只能有一个uniqueSellingPoint。
3.goldenHook：copy、type、visual、retentionReason、openingSound。
4.voiceoverLines：逐句lineId、text、tone、speed、emotion、durationSeconds；lineId必须稳定且唯一，无口播时text填写对应屏幕字幕。
5.structure：至少含HOOK、BRIDGE、SELLING_POINT、PROOF、RETENTION、ENDING六段，每段提供purpose和content。
6.shotRequirements：与voiceoverLines逐项一一对应并使用相同lineId；提供line、具体visual、matchedVideoAssetIds、auxiliaryImageAssetIds、assetStatus（COVERED|REWRITABLE|NEED_SHOOT|PROHIBITED）、factualProof、audioVisualRequirement。COVERED必须至少绑定一个真实VIDEO素材；图片只能放入auxiliaryImageAssetIds。不得只凭文件名推断功能；功能口播必须匹配对应操作、过程或结果画面。
7.retentionDesign、subtitles（无标点、自然语义断句，避免孤字）、emphasisTexts（只列关键词，不重复整句）。
8.styleChecks：attitudeOpening、shortSentenceRhythm、lightContrast、concreteActions、memorablePhrase、manualToneCheck、templateQuestionCheck必须逐项如实返回布尔值，notes记录具体网感依据。
9.soundDesign：voiceProfile、tone、emotion、speed、openingSfx、keySfx、ambientSound。
10.complianceChecks：检查禁止词、极限词、健康表达、资质画面和临时禁用内容，status只能PASS|REVIEW|BLOCK。
11.ending：summary、interaction、visual、safeTailSeconds；结尾必须保留安全尾帧。
12.materialGaps：product、action、shotSize、processOrResult、shootingMethod，只列真实缺口。
返回JSON：{"candidates":[{"topic":"","audience":"","objective":"","hook":"","outline":[],"score":0,"scoreBreakdown":{},"assetIds":[],"referenceIds":[],"missingAssets":[],"titleZh":"","titleEn":"","coverTextZh":"","coverTextEn":"","hashtags":[],"scripts":{"zh15":"","en15":"","zh30":"","en30":""},"scriptPackage":{"basicInfo":{"productModel":"","videoType":"","platform":"","accountType":"","targetAudience":"","estimatedDurationSeconds":30,"healthContentAllowed":true},"positioning":{"coreTheme":"","communicationGoal":"","userPainPoint":"","uniqueSellingPoint":""},"goldenHook":{"copy":"","type":"","visual":"","retentionReason":"","openingSound":""},"voiceoverLines":[{"lineId":"line_01","text":"","tone":"","speed":"","emotion":"","durationSeconds":0}],"structure":[{"stage":"HOOK|BRIDGE|SELLING_POINT|PROOF|RETENTION|ENDING","purpose":"","content":""}],"shotRequirements":[{"lineId":"line_01","line":"","visual":"","matchedVideoAssetIds":[],"auxiliaryImageAssetIds":[],"assetStatus":"COVERED|REWRITABLE|NEED_SHOOT|PROHIBITED","factualProof":"","audioVisualRequirement":""}],"retentionDesign":[],"subtitles":[],"emphasisTexts":[],"styleChecks":{"attitudeOpening":true,"shortSentenceRhythm":true,"lightContrast":true,"concreteActions":true,"memorablePhrase":true,"manualToneCheck":true,"templateQuestionCheck":true,"notes":[]},"soundDesign":{"voiceProfile":"","tone":"","emotion":"","speed":"","openingSfx":"","keySfx":[],"ambientSound":""},"complianceChecks":[{"category":"","status":"PASS|REVIEW|BLOCK","note":""}],"ending":{"summary":"","interaction":"","visual":"","safeTailSeconds":1},"materialGaps":[{"product":"","action":"","shotSize":"","processOrResult":"","shootingMethod":""}]}}]}。
输入：${JSON.stringify(context)}`,
    );
    const rows = Array.isArray(result.candidates) ? result.candidates.slice(0, exactCount).map(object) : [];
    if (rows.length !== exactCount) throw new Error(`AI未返回${exactCount}个完整视频脚本候选`);
    const candidates = rows.map((row) => {
      const scripts = object(row.scripts);
      const scriptPackage = object(row.scriptPackage);
      const basicInfo = object(scriptPackage.basicInfo);
      const positioning = object(scriptPackage.positioning);
      const goldenHook = object(scriptPackage.goldenHook);
      const soundDesign = object(scriptPackage.soundDesign);
      const ending = object(scriptPackage.ending);
      return {
        topic: text(row.topic),
        audience: text(row.audience),
        objective: text(row.objective),
        hook: text(row.hook),
        outline: strings(row.outline),
        score: score(row.score),
        scoreBreakdown: Object.fromEntries(Object.entries(object(row.scoreBreakdown)).map(([key, value]) => [key, Number(value) || 0])),
        assetIds: strings(row.assetIds),
        referenceIds: strings(row.referenceIds),
        missingAssets: strings(row.missingAssets),
        titleZh: text(row.titleZh),
        titleEn: text(row.titleEn),
        coverTextZh: text(row.coverTextZh),
        coverTextEn: text(row.coverTextEn),
        hashtags: strings(row.hashtags),
        scripts: {
          zh15: text(scripts.zh15),
          en15: text(scripts.en15),
          zh30: text(scripts.zh30),
          en30: text(scripts.en30),
        },
        scriptPackage: {
          basicInfo: {
            productModel: text(basicInfo.productModel),
            videoType: text(basicInfo.videoType),
            platform: text(basicInfo.platform),
            accountType: text(basicInfo.accountType),
            targetAudience: text(basicInfo.targetAudience),
            estimatedDurationSeconds: Math.max(1, Number(basicInfo.estimatedDurationSeconds) || 30),
            healthContentAllowed: basicInfo.healthContentAllowed !== false,
          },
          positioning: {
            coreTheme: text(positioning.coreTheme),
            communicationGoal: text(positioning.communicationGoal),
            userPainPoint: text(positioning.userPainPoint),
            uniqueSellingPoint: text(positioning.uniqueSellingPoint),
          },
          goldenHook: {
            copy: text(goldenHook.copy),
            type: text(goldenHook.type),
            visual: text(goldenHook.visual),
            retentionReason: text(goldenHook.retentionReason),
            openingSound: text(goldenHook.openingSound),
          },
          voiceoverLines: (Array.isArray(scriptPackage.voiceoverLines) ? scriptPackage.voiceoverLines : []).map(object).map((item, index) => ({
            lineId: text(item.lineId) || `line_${String(index + 1).padStart(2, "0")}`,
            text: text(item.text),
            tone: text(item.tone),
            speed: text(item.speed),
            emotion: text(item.emotion),
            durationSeconds: Math.max(0, Number(item.durationSeconds) || 0),
          })),
          structure: (Array.isArray(scriptPackage.structure) ? scriptPackage.structure : []).map(object).map((item) => ({
            stage: text(item.stage),
            purpose: text(item.purpose),
            content: text(item.content),
          })),
          shotRequirements: (Array.isArray(scriptPackage.shotRequirements) ? scriptPackage.shotRequirements : []).map(object).map((item, index) => ({
            lineId: text(item.lineId) || `line_${String(index + 1).padStart(2, "0")}`,
            line: text(item.line),
            visual: text(item.visual),
            matchedVideoAssetIds: strings(item.matchedVideoAssetIds),
            auxiliaryImageAssetIds: strings(item.auxiliaryImageAssetIds),
            assetStatus: (["COVERED", "REWRITABLE", "NEED_SHOOT", "PROHIBITED"].includes(text(item.assetStatus))
              ? text(item.assetStatus)
              : "NEED_SHOOT") as "COVERED" | "REWRITABLE" | "NEED_SHOOT" | "PROHIBITED",
            factualProof: text(item.factualProof),
            audioVisualRequirement: text(item.audioVisualRequirement),
          })),
          retentionDesign: strings(scriptPackage.retentionDesign),
          styleChecks: {
            attitudeOpening: object(scriptPackage.styleChecks).attitudeOpening === true,
            shortSentenceRhythm: object(scriptPackage.styleChecks).shortSentenceRhythm === true,
            lightContrast: object(scriptPackage.styleChecks).lightContrast === true,
            concreteActions: object(scriptPackage.styleChecks).concreteActions === true,
            memorablePhrase: object(scriptPackage.styleChecks).memorablePhrase === true,
            manualToneCheck: object(scriptPackage.styleChecks).manualToneCheck === true,
            templateQuestionCheck: object(scriptPackage.styleChecks).templateQuestionCheck === true,
            notes: strings(object(scriptPackage.styleChecks).notes),
          },
          subtitles: strings(scriptPackage.subtitles),
          emphasisTexts: strings(scriptPackage.emphasisTexts),
          soundDesign: {
            voiceProfile: text(soundDesign.voiceProfile),
            tone: text(soundDesign.tone),
            emotion: text(soundDesign.emotion),
            speed: text(soundDesign.speed),
            openingSfx: text(soundDesign.openingSfx),
            keySfx: strings(soundDesign.keySfx),
            ambientSound: text(soundDesign.ambientSound),
          },
          complianceChecks: (Array.isArray(scriptPackage.complianceChecks) ? scriptPackage.complianceChecks : []).map(object).map((item) => ({
            category: text(item.category),
            status: (["PASS", "REVIEW", "BLOCK"].includes(text(item.status)) ? text(item.status) : "REVIEW") as "PASS" | "REVIEW" | "BLOCK",
            note: text(item.note),
          })),
          ending: {
            summary: text(ending.summary),
            interaction: text(ending.interaction),
            visual: text(ending.visual),
            safeTailSeconds: Math.max(0.5, Number(ending.safeTailSeconds) || 1),
          },
          materialGaps: (Array.isArray(scriptPackage.materialGaps) ? scriptPackage.materialGaps : []).map(object).map((item) => ({
            product: text(item.product),
            action: text(item.action),
            shotSize: text(item.shotSize),
            processOrResult: text(item.processOrResult),
            shootingMethod: text(item.shootingMethod),
          })),
        },
      };
    });
    if (candidates.some((candidate) => !isCompleteVideoCandidate(candidate))) {
      throw new Error("AI返回的视频方向缺少完整脚本");
    }
    const policyErrors = rows.flatMap((row, index) =>
      validateBailianVideoScriptResult(row, context).map((error) => `候选${index + 1}：${error}`),
    );
    if (policyErrors.length) {
      throw new Error(`AI返回的视频脚本未通过素材门禁：${policyErrors.join("；")}`);
    }
    return candidates;
  }

  async analyzeVideoAssetCoverage(context: JsonRecord): Promise<AiAssetCoverage> {
    const result = await this.callJson(
      `你是短视频素材统筹。请把脚本拆成逐镜头素材清单，并逐项检查公司现有素材库。
只能引用输入中真实存在的assetId。每个带时长的镜头都必须至少有一条VIDEO素材作为连续主画面，填写matchedVideoAssetIds。
IMAGE只能填写到auxiliaryImageAssetIds，作为同屏叠加、字幕底图或辅助说明；只有图片而没有视频的镜头必须标记MISSING，不能用静态图片单独占据整个时间段。
matchedAssetIds为视频主画面和图片辅助的合并列表。无法由视频主画面覆盖的镜头标记MISSING。
不得因为某个镜头缺失就要求重拍整条脚本。镜头描述必须具体到主体、动作、景别或场景，禁止写“本脚本所需素材”“全部素材”等笼统内容。
返回JSON：{"shots":[{"description":"","matchedVideoAssetIds":[],"auxiliaryImageAssetIds":[],"matchedAssetIds":[],"coverage":"EXISTING|MISSING","reason":""}]}
输入：${JSON.stringify(context)}`,
    );
    return {
      shots: (Array.isArray(result.shots) ? result.shots : []).map(object).map((item) => ({
        description: text(item.description),
        matchedAssetIds: strings(item.matchedAssetIds),
        matchedVideoAssetIds: strings(item.matchedVideoAssetIds),
        auxiliaryImageAssetIds: strings(item.auxiliaryImageAssetIds),
        coverage: text(item.coverage).toUpperCase() === "EXISTING" ? "EXISTING" as const : "MISSING" as const,
        reason: text(item.reason),
      })).filter((item) => item.description),
    };
  }

  async analyzeProductAssetGaps(context: JsonRecord): Promise<AiAssetGap[]> {
    const result = await this.callJson(
      `你是短视频素材库规划师。根据产品资料和当前真实可用素材的结构化索引，分析为了持续生成产品短视频还缺少哪些可复用素材。
只列当前素材无法覆盖的具体画面，不得把已有素材重复列为缺口。描述必须具体到主体、动作、功能、场景或景别，禁止使用“补充更多素材”等笼统表达。
优先分析功能演示、使用场景、人物动作、痛点、证据/结果、转场、HOOK和CTA等剪辑模块。最多返回12项。
返回JSON：{"gaps":[{"category":"","assetKind":"IMAGE|VIDEO|AUDIO","description":"","reason":"","priority":"HIGH|NORMAL|LOW","suggestedTags":[]}]}。
输入：${JSON.stringify(context)}`,
    );
    return (Array.isArray(result.gaps) ? result.gaps : []).map(object).map((item) => ({
      category: text(item.category),
      assetKind: ["IMAGE", "VIDEO", "AUDIO"].includes(text(item.assetKind).toUpperCase()) ? text(item.assetKind).toUpperCase() as AiAssetGap["assetKind"] : "VIDEO",
      description: text(item.description),
      reason: text(item.reason),
      priority: ["HIGH", "NORMAL", "LOW"].includes(text(item.priority).toUpperCase()) ? text(item.priority).toUpperCase() as AiAssetGap["priority"] : "NORMAL",
      suggestedTags: strings(item.suggestedTags),
    })).filter((item) => item.category && item.description);
  }

  async generateArticle(context: JsonRecord): Promise<AiArticlePackage> {
    const result = await this.callJson(
      `根据已审核的赛电产品知识、FAQ、用户痛点、黄金素材和热点，生成1个软文母题及多平台版本。
必须返回引用的知识ID和配图素材ID；型号、事实或证据无法确认时，不写成确定事实。
返回JSON：{"topic":"","audience":"","objective":"","hook":"","outline":[],"score":0,"scoreBreakdown":{},"assetIds":[],"title":"","summary":"","keywords":[],"cta":"","imageSuggestions":[],"citedKnowledgeIds":[],"variants":{"wechatOfficial":"","xiaohongshu":"","shortPost":"","wecomMoments":""}}。
输入：${JSON.stringify(context)}`,
    );
    const variants = object(result.variants);
    return {
      topic: text(result.topic),
      audience: text(result.audience),
      objective: text(result.objective),
      hook: text(result.hook),
      outline: strings(result.outline),
      score: score(result.score),
      scoreBreakdown: Object.fromEntries(Object.entries(object(result.scoreBreakdown)).map(([key, value]) => [key, Number(value) || 0])),
      assetIds: strings(result.assetIds),
      title: text(result.title),
      summary: text(result.summary),
      keywords: strings(result.keywords),
      cta: text(result.cta),
      imageSuggestions: strings(result.imageSuggestions),
      citedKnowledgeIds: strings(result.citedKnowledgeIds),
      variants: {
        wechatOfficial: text(variants.wechatOfficial),
        xiaohongshu: text(variants.xiaohongshu),
        shortPost: text(variants.shortPost),
        wecomMoments: text(variants.wecomMoments),
      },
    };
  }

  async generatePlatformPackaging(context: JsonRecord): Promise<AiPlatformPackaging> {
    const result = await this.callJson(
      `根据已审核脚本、主成片信息和目标平台规则，生成一个平台发布包装。
不得新增未经输入确认的产品事实。封面文案应简短，coverSpec必须包含layout、background、headline、productPlacement和style。
当contentRestrictionMode为HEALTH_RESTRICTED时，标题、正文、标签、封面文字和封面画面描述均不得出现restrictedWords及其谐音、拆字或变体，也不得包含restrictedVisuals描述的画面。
返回JSON：{"title":"","body":"","hashtags":[],"coverText":"","coverSpec":{"layout":"","background":"","headline":"","productPlacement":"","style":""}}。
输入：${JSON.stringify(context)}`,
    );
    return {
      title: text(result.title),
      body: text(result.body),
      hashtags: strings(result.hashtags),
      coverText: text(result.coverText),
      coverSpec: object(result.coverSpec),
    };
  }

  async generateViralKeywords(context: JsonRecord): Promise<AiViralKeyword[]> {
    const result = await this.callJson(
      `根据赛电已审核产品、FAQ、用户痛点、竞品观察、最近7天关键词表现、素材缺口和人工运营方向，生成${text(context.platform) === "TIKTOK" ? "美国TikTok英文" : "抖音中文"}关键词。
最多50个。类型可选：PRODUCT、AUDIENCE、PAIN、VALUE、SCENE、HOOK、CONVERSION、TREND、COMPETITOR。
优先级A最多10个、B最多20个，其余为C；关键词适合直接在目标平台搜索，避免重复和过长句子。
人工运营方向优先；必须排除方向中的excludeTerms。自然搜索词不得出现“赛电”或“SAYDIAN”，不得使用完整赛电产品名称；竞品词仅用于研究。
同义表达必须返回同一个英文短横线clusterKey，跨中英文也使用相同clusterKey，例如easy-smartwatch-for-seniors。
返回JSON：{"keywords":[{"keyword":"","type":"PRODUCT|AUDIENCE|PAIN|VALUE|SCENE|HOOK|CONVERSION|TREND|COMPETITOR","priority":"A|B|C","productModel":"","reason":"","clusterKey":"","clusterName":"","audience":"","pain":"","scene":""}]}。
输入：${JSON.stringify(context)}`,
    );
    const allowedTypes = new Set(["PRODUCT", "AUDIENCE", "PAIN", "VALUE", "SCENE", "HOOK", "CONVERSION", "TREND", "COMPETITOR"]);
    const allowedPriorities = new Set(["A", "B", "C"]);
    const rows = Array.isArray(result.keywords) ? result.keywords.map(object) : [];
    return rows.map((row) => ({
      keyword: text(row.keyword),
      type: (allowedTypes.has(text(row.type)) ? text(row.type) : "PRODUCT") as AiViralKeyword["type"],
      priority: (allowedPriorities.has(text(row.priority)) ? text(row.priority) : "C") as AiViralKeyword["priority"],
      productModel: text(row.productModel) || undefined,
      reason: text(row.reason),
      clusterKey: text(row.clusterKey) || undefined,
      clusterName: text(row.clusterName) || undefined,
      audience: text(row.audience) || undefined,
      pain: text(row.pain) || undefined,
      scene: text(row.scene) || undefined,
    })).filter((row) => row.keyword);
  }

  private async callJson(prompt: string): Promise<JsonRecord> {
    if (!opsConfig.bailian.apiKey) throw new Error("百炼文本生成未配置");
    let response: Response;
    try {
      response = await fetch(`${opsConfig.bailian.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opsConfig.bailian.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: opsConfig.bailian.textModel,
          temperature: 0.35,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `${BAILIAN_VIDEO_SCRIPT_SYSTEM_POLICY}\n只输出严格JSON。`,
            },
            { role: "user", content: prompt },
          ],
        }),
        // 完整脚本还包含逐句素材绑定，90 秒不足以覆盖百炼在素材较多时的响应时间。
        signal: AbortSignal.timeout(240_000),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
        throw new Error("百炼生成超过240秒，任务已超时；请重新生成或转交Codex");
      }
      throw error;
    }
    const payload = object(await response.json().catch(() => ({})));
    if (!response.ok) throw new Error(`百炼文本生成失败：${response.status} ${text(object(payload.error).message || payload.message)}`);
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const content = object(object(choices[0]).message).content;
    return parseJson(content);
  }
}
