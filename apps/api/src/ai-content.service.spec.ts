import { describe, expect, it } from "vitest";
import { buildBailianEditingVideoContext, validateBailianVideoScriptResult } from "./bailian-video-script-policy";
import { isCompleteVideoCandidate, type AiVideoCandidate } from "./ai-content.service";

function candidate(overrides: Partial<AiVideoCandidate> = {}): AiVideoCandidate {
  return {
    topic: "W9真实体验",
    audience: "目标用户",
    objective: "产品展示",
    hook: "真实体验到底怎么样",
    outline: ["开场", "操作展示", "结果与引导"],
    score: 80,
    scoreBreakdown: {},
    assetIds: [],
    referenceIds: [],
    missingAssets: [],
    titleZh: "W9真实体验",
    titleEn: "W9 review",
    coverTextZh: "真实体验",
    coverTextEn: "Review",
    hashtags: ["W9"],
    scripts: {
      zh15: "开场提出真实使用问题，随后展示产品进入功能、完成操作和查看结果的过程，最后用产品定格画面引导用户查看详情。",
      en15: "Open with the question, show the product flow, then close with a clear next step.",
      zh30: "开场提出用户在真实使用场景中的问题，随后展示产品进入功能页面、完成关键操作并查看结果的全过程，再结合已审核的产品信息说明核心价值与适用场景，最后用产品定格和清晰行动提示收尾，引导用户继续查看详情。",
      en30: "Open with a real use case, show the full operation, explain approved value, and close with a CTA.",
    },
    scriptPackage: {
      basicInfo: { productModel: "W9", videoType: "VOICEOVER", platform: "DOUYIN", accountType: "BRAND", targetAudience: "目标用户", estimatedDurationSeconds: 30, healthContentAllowed: true },
      positioning: { coreTheme: "真实体验", communicationGoal: "产品展示", userPainPoint: "不会操作", uniqueSellingPoint: "真实操作过程" },
      goldenHook: { copy: "真实体验到底怎么样", type: "问题", visual: "真实操作近景", retentionReason: "延迟结果", openingSound: "操作音效" },
      voiceoverLines: [
        { lineId: "line_01", text: "真实体验到底怎么样", tone: "直接", speed: "稍快", emotion: "好奇", durationSeconds: 3 },
        { lineId: "line_02", text: "先看完整操作过程", tone: "说明", speed: "正常", emotion: "可信", durationSeconds: 10 },
        { lineId: "line_03", text: "最后再看结果", tone: "自然", speed: "稍慢", emotion: "友好", durationSeconds: 7 },
      ],
      structure: [
        { stage: "HOOK", purpose: "留人", content: "提出问题" },
        { stage: "BRIDGE", purpose: "承接", content: "进入场景" },
        { stage: "SELLING_POINT", purpose: "展开卖点", content: "展示操作" },
        { stage: "PROOF", purpose: "提供证据", content: "展示结果" },
        { stage: "RETENTION", purpose: "保持期待", content: "延迟结论" },
        { stage: "ENDING", purpose: "收束", content: "自然结尾" },
      ],
      shotRequirements: [
        { lineId: "line_01", line: "真实体验到底怎么样", visual: "操作近景", matchedVideoAssetIds: ["video-1"], auxiliaryImageAssetIds: [], assetStatus: "COVERED", factualProof: "证明真实操作", audioVisualRequirement: "口播匹配操作" },
        { lineId: "line_02", line: "先看完整操作过程", visual: "连续过程", matchedVideoAssetIds: ["video-1"], auxiliaryImageAssetIds: [], assetStatus: "COVERED", factualProof: "证明操作步骤", audioVisualRequirement: "过程对应口播" },
        { lineId: "line_03", line: "最后再看结果", visual: "结果画面", matchedVideoAssetIds: ["video-1"], auxiliaryImageAssetIds: [], assetStatus: "COVERED", factualProof: "证明画面结果", audioVisualRequirement: "结果口播配结果界面" },
      ],
      retentionDesign: ["延迟结果"],
      styleChecks: {
        attitudeOpening: true,
        shortSentenceRhythm: true,
        lightContrast: true,
        concreteActions: true,
        memorablePhrase: true,
        manualToneCheck: true,
        templateQuestionCheck: true,
        notes: ["问题开头", "动作短句", "中段轻反差"],
      },
      subtitles: ["真实体验到底怎么样", "先看完整操作过程", "最后再看结果"],
      emphasisTexts: ["真实操作", "完整过程"],
      soundDesign: { voiceProfile: "成年配音", tone: "自然", emotion: "可信", speed: "正常", openingSfx: "操作音", keySfx: ["提示音"], ambientSound: "轻环境声" },
      complianceChecks: [{ category: "健康表达", status: "PASS", note: "使用审核表达" }],
      ending: { summary: "总结过程", interaction: "你还想看什么", visual: "产品定格", safeTailSeconds: 1.5 },
      materialGaps: [],
    },
    ...overrides,
  };
}

describe("video candidate completeness", () => {
  it("accepts a direction containing a complete script", () => {
    expect(isCompleteVideoCandidate(candidate())).toBe(true);
  });

  it("rejects a direction containing only a hook", () => {
    expect(isCompleteVideoCandidate(candidate({
      outline: ["开场"],
      scripts: { zh15: "只有一句Hook", en15: "", zh30: "只有一句Hook", en30: "" },
    }))).toBe(false);
  });
});

describe("Bailian video-script material gate", () => {
  it("sends only editing-footage videos to Bailian", () => {
    const context = buildBailianEditingVideoContext({
      assets: [
        { id: "video-1", kind: "VIDEO", purpose: "EDITING_FOOTAGE", indexConfidence: 0.92, indexNeedsReview: false },
        { id: "image-1", kind: "IMAGE", purpose: "EDITING_FOOTAGE" },
        { id: "audio-1", kind: "AUDIO", purpose: "EDITING_FOOTAGE" },
        { id: "packaging-video-1", kind: "VIDEO", purpose: "PACKAGING_RESOURCE" },
        { id: "cover-video-1", kind: "VIDEO", resourceType: "COVER_TEMPLATE" },
        { id: "zero-confidence-video", kind: "VIDEO", purpose: "EDITING_FOOTAGE", indexConfidence: 0, indexNeedsReview: false },
        { id: "needs-review-video", kind: "VIDEO", purpose: "EDITING_FOOTAGE", indexConfidence: 0.95, indexNeedsReview: true },
      ],
      packagingResources: [{ id: "pack-1", kind: "VIDEO" }],
      imageAssets: [{ id: "image-2", kind: "IMAGE" }],
      audioAssets: [{ id: "audio-2", kind: "AUDIO" }],
    }) as Record<string, any>;

    expect(context.assets).toEqual([
      { id: "video-1", kind: "VIDEO", purpose: "EDITING_FOOTAGE", indexConfidence: 0.92, indexNeedsReview: false },
      { id: "zero-confidence-video", kind: "VIDEO", purpose: "EDITING_FOOTAGE", indexConfidence: 0, indexNeedsReview: false },
    ]);
    expect(context.availableVideoAssetIds).toEqual(["video-1", "zero-confidence-video"]);
    expect(context.assetInputPolicy.mode).toBe("EDITING_VIDEO_ONLY");
    expect(context.packagingResources).toBeUndefined();
    expect(context.imageAssets).toBeUndefined();
    expect(context.audioAssets).toBeUndefined();
  });

  it("accepts covered lines only when they bind real video assets", () => {
    const value = candidate({ assetIds: ["video-1"] }) as unknown as Record<string, unknown>;
    expect(validateBailianVideoScriptResult(value, {
      assets: [{ id: "video-1", kind: "VIDEO" }, { id: "image-1", kind: "IMAGE" }],
    })).toEqual([]);
  });

  it("rejects images used as primary timeline material", () => {
    const value = candidate({ assetIds: ["image-1"] }) as unknown as Record<string, unknown>;
    expect(validateBailianVideoScriptResult(value, {
      assets: [{ id: "video-1", kind: "VIDEO" }, { id: "image-1", kind: "IMAGE" }],
    })).toContain("主体素材assetIds只能引用VIDEO：image-1");
  });

  it("rejects covered lines without bound video evidence", () => {
    const value = candidate() as unknown as Record<string, any>;
    value.scriptPackage.shotRequirements[0].matchedVideoAssetIds = [];
    expect(validateBailianVideoScriptResult(value, {
      assets: [{ id: "video-1", kind: "VIDEO" }],
    })).toContain("line_01标记COVERED但没有绑定真实VIDEO素材");
  });

  it("rejects any auxiliary image returned by Bailian", () => {
    const value = candidate({ assetIds: ["video-1"] }) as unknown as Record<string, any>;
    value.scriptPackage.shotRequirements[0].auxiliaryImageAssetIds = ["image-1"];
    const errors = validateBailianVideoScriptResult(value, {
      assets: [{ id: "video-1", kind: "VIDEO" }],
    });
    expect(errors).toContain("line_01百炼脚本请求未提供图片或包装资源，auxiliaryImageAssetIds必须为空");
  });

  it("requires top-level assetIds to equal the videos used by script lines", () => {
    const value = candidate({ assetIds: [] }) as unknown as Record<string, any>;
    const errors = validateBailianVideoScriptResult(value, {
      assets: [{ id: "video-1", kind: "VIDEO" }],
    });
    expect(errors).toContain("assetIds缺少逐句已绑定的视频素材：video-1");
  });

  it("rejects weak hooks and missing internet-style checks", () => {
    const value = candidate() as unknown as Record<string, any>;
    value.scriptPackage.voiceoverLines[0].text = "今天介绍一款手表";
    value.scriptPackage.shotRequirements[0].line = "今天介绍一款手表";
    value.scriptPackage.styleChecks.lightContrast = false;
    const errors = validateBailianVideoScriptResult(value, {
      assets: [{ id: "video-1", kind: "VIDEO" }],
    });
    expect(errors).toContain("开头仍是介绍式或泛化弱钩子");
    expect(errors).toContain("网感检查未通过：lightContrast");
  });
});
