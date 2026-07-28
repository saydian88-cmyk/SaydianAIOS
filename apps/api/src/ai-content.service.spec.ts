import { describe, expect, it } from "vitest";
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
        { text: "真实体验到底怎么样", tone: "直接", speed: "稍快", emotion: "好奇", durationSeconds: 3 },
        { text: "先看完整操作过程", tone: "说明", speed: "正常", emotion: "可信", durationSeconds: 10 },
        { text: "最后再看结果", tone: "自然", speed: "稍慢", emotion: "友好", durationSeconds: 7 },
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
        { line: "真实体验到底怎么样", visual: "操作近景", assetStatus: "COVERED", factualProof: "证明真实操作", audioVisualRequirement: "口播匹配操作" },
        { line: "先看完整操作过程", visual: "连续过程", assetStatus: "COVERED", factualProof: "证明操作步骤", audioVisualRequirement: "过程对应口播" },
        { line: "最后再看结果", visual: "结果画面", assetStatus: "COVERED", factualProof: "证明画面结果", audioVisualRequirement: "结果口播配结果界面" },
      ],
      retentionDesign: ["延迟结果"],
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
