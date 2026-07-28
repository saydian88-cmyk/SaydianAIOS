export type VideoExecutionMode = "TOPIC_CARD_BATCH" | "SCRIPT_ONLY" | "FULL_VIDEO";

export type VideoRecipeCode =
  | "PAIN_SOLVE"
  | "GIFT_EMOTION"
  | "CONTRARIAN"
  | "FAQ"
  | "REVIEW"
  | "COMPARISON"
  | "UGC"
  | "VISUAL_AD";

export type VideoOpportunityScore = {
  relevance: number;
  demand: number;
  trendGrowth: number;
  contentGap: number;
  commercialIntent: number;
  brandFit: number;
  assetCoverage: number;
  shootability: number;
  novelty: number;
  total: number;
};

export type VideoMaterialCoverage = {
  totalShots: number;
  coveredShots: number;
  coveragePercent: number;
  matchedAssetIds: string[];
  missingShots: Array<{
    moduleType: string;
    description: string;
    reason: string;
    alternative: string;
  }>;
};

export type VideoTopicCardPayload = {
  cardNo?: string;
  platform: "DOUYIN" | "TIKTOK";
  market: string;
  productModel?: string;
  title: string;
  topic: string;
  audience: string;
  pain: string;
  scene: string;
  objective: string;
  mainKeyword: string;
  auxiliaryKeywords: string[];
  keywordIds: string[];
  externalVideoIds: string[];
  knowledgeIds: string[];
  faqIds: string[];
  evidenceIds: string[];
  sourceTypes: string[];
  rationale: string;
  reusableViralStructure: {
    hookPattern: string;
    pace: string;
    shotStructure: string[];
    ctaPattern: string;
  };
  hookCandidates: string[];
  primaryRecipe: VideoRecipeCode;
  backupRecipe: VideoRecipeCode;
  durationSeconds: number;
  aspectRatio: "9:16";
  voiceoverDirection: string;
  subtitleDirection: string;
  materialCoverage: VideoMaterialCoverage;
  scoreBreakdown: VideoOpportunityScore;
  estimatedCosts: {
    local: number;
    external: number;
    currency: string;
  };
  missingFacts: string[];
  riskReasons: string[];
  dedupeKey?: string;
  ownerEmployeeId?: string;
  reviewerEmployeeId?: string;
  approvedAiTaskId?: string;
  approvedExecutionMode?: "SCRIPT_ONLY" | "FULL_VIDEO";
};

export type VideoShotPlanV3 = {
  sequence: number;
  moduleType: string;
  title: string;
  description: string;
  durationSeconds: number;
  visual: string;
  voiceover: string;
  subtitle: string;
  requiredAssetTags: string[];
  selectedAssetIds: string[];
  sourcePreference: string;
  missingReason: string;
  alternativePlan: string;
};

export type VideoScriptCandidateV3 = {
  title: string;
  hook: string;
  script: string;
  cta: string;
  score: number;
  scoreBreakdown: Record<string, number>;
  templateCode: VideoRecipeCode;
  shots: VideoShotPlanV3[];
  missingAssets: Array<{
    moduleType: string;
    description: string;
    reason: string;
    alternative: string;
  }>;
  selected: boolean;
};

export const VIDEO_OPPORTUNITY_SCORE_MAX = {
  relevance: 20,
  demand: 15,
  trendGrowth: 10,
  contentGap: 10,
  commercialIntent: 10,
  brandFit: 10,
  assetCoverage: 15,
  shootability: 5,
  novelty: 5,
} as const;

export const VIDEO_RECIPES = [
  { code: "PAIN_SOLVE", name: "痛点解决型", version: 1, structure: ["HOOK", "PAIN", "SOLUTION", "DEMO", "CTA"] },
  { code: "GIFT_EMOTION", name: "送礼情感型", version: 1, structure: ["GIFT", "REACTION", "USE", "EMOTION", "CTA"] },
  { code: "CONTRARIAN", name: "反常识型", version: 1, structure: ["CONTRARIAN_HOOK", "QUESTION", "DEMO", "RESULT", "CTA"] },
  { code: "FAQ", name: "问答型", version: 1, structure: ["QUESTION", "ANSWER", "DEMO", "NOTE", "CTA"] },
  { code: "REVIEW", name: "测评型", version: 1, structure: ["REAL_USE", "FEATURE", "PRO_CON", "AUDIENCE", "CTA"] },
  { code: "COMPARISON", name: "对比型", version: 1, structure: ["OLD_WAY", "PAIN", "NEW_WAY", "VALUE", "CTA"] },
  { code: "UGC", name: "真人口播型", version: 1, structure: ["TALKING_HOOK", "REASON", "PRODUCT", "EXPERIENCE", "CTA"] },
  { code: "VISUAL_AD", name: "纯视觉广告型", version: 1, structure: ["VISUAL_HOOK", "PRODUCT", "SCENE", "VALUE_TEXT", "BRAND_CTA"] },
] as const;

export const DEFAULT_VIDEO_POLICY_CONFIG = {
  dailyMainOutput: 1,
  topicCardPolicyVersion: "v2.0",
  dailyTopicCards: {
    DOUYIN: 10,
    TIKTOK: 10,
  },
  manualTopicCardApproval: true,
  videoRecipes: VIDEO_RECIPES,
};

export function normalizeTopicText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("园型", "圆形")
    .replace(/[\s\-_—–·•，。！？、；：,.!?;:()[\]{}'"“”‘’]+/gu, "");
}

