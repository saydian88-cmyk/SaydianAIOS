import { Injectable } from "@nestjs/common";
import { opsConfig } from "./config";

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

@Injectable()
export class AiContentService {
  capabilities() {
    return {
      state: opsConfig.bailian.apiKey ? "AVAILABLE" as const : "UNCONFIGURED" as const,
      model: opsConfig.bailian.textModel,
    };
  }

  async generateVideoCandidates(context: JsonRecord): Promise<AiVideoCandidate[]> {
    const result = await this.callJson(
      `根据已审核的赛电产品知识、FAQ、高分自有素材和外部参考，生成3个短视频候选方向。第1个为今日主执行包。
只使用输入中的assetId、referenceId、产品事实和证据；缺素材写入missingAssets，不得虚构。
每个候选必须含15秒和30秒中英文脚本、Hook、节奏化镜头大纲、字幕/CTA思路、标题、封面文案和标签。
返回JSON：{"candidates":[{"topic":"","audience":"","objective":"","hook":"","outline":[],"score":0,"scoreBreakdown":{},"assetIds":[],"referenceIds":[],"missingAssets":[],"titleZh":"","titleEn":"","coverTextZh":"","coverTextEn":"","hashtags":[],"scripts":{"zh15":"","en15":"","zh30":"","en30":""}}]}。
输入：${JSON.stringify(context)}`,
    );
    const rows = Array.isArray(result.candidates) ? result.candidates.slice(0, 3).map(object) : [];
    if (rows.length !== 3) throw new Error("百炼未返回3个视频候选");
    return rows.map((row) => {
      const scripts = object(row.scripts);
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
      };
    });
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

  private async callJson(prompt: string): Promise<JsonRecord> {
    if (!opsConfig.bailian.apiKey) throw new Error("百炼文本生成未配置");
    const response = await fetch(`${opsConfig.bailian.baseUrl}/chat/completions`, {
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
            content: "你是赛电品牌内容生产引擎。只输出严格JSON。健康内容使用监测、提醒、参考、健康管理等已审核表达，不虚构产品参数、资质、效果或来源。",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const payload = object(await response.json().catch(() => ({})));
    if (!response.ok) throw new Error(`百炼文本生成失败：${response.status} ${text(object(payload.error).message || payload.message)}`);
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const content = object(object(choices[0]).message).content;
    return parseJson(content);
  }
}
