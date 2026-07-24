type AnalysisRecord = Record<string, unknown>;

const genericName = /^(?:\d+|(?:img|vid|dsc|pxl|dji|mvimg|screenshot|screenrecording)[-_ ]*\d*|微信(?:图片|视频)[-_ ]*\d*|未命名\d*|新建(?:文件|视频|图片)?\d*|素材\d*|视频\d*|图片\d*|[a-f0-9]{12,})$/iu;

const moduleNames: Record<string, string> = {
  HOOK: "钩子",
  PAIN: "痛点",
  SCENE: "场景",
  FEATURE: "功能",
  BENEFIT: "利益点",
  PROOF: "证明",
  DEMO: "演示",
  TRAFFIC: "引流",
  OFFER: "优惠",
  CTA: "行动引导",
  ENDING: "结尾",
};

function clean(value: unknown, max = 18): string {
  return String(value ?? "")
    .replace(/\.[a-z0-9]{2,5}$/iu, "")
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/[|｜/\\]+/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/^[\s\-·_]+|[\s\-·_，。；：、！!？?]+$/gu, "")
    .slice(0, max)
    .trim();
}

function firstValue(value: unknown): string {
  if (!Array.isArray(value)) return clean(value);
  for (const item of value) {
    if (typeof item === "string") {
      const result = clean(item);
      if (result) return result;
    }
    if (item && typeof item === "object") {
      const record = item as AnalysisRecord;
      const result = clean(record.modelCode || record.model || record.name || record.label || record.type);
      if (result) return result;
    }
  }
  return "";
}

export function isIrregularAssetName(value: unknown): boolean {
  const name = clean(value, 120);
  return !name || genericName.test(name.replace(/\s+/gu, ""));
}

export function buildAiAssetName(result: AnalysisRecord, productCodes: string[] = []): string | undefined {
  const suggested = clean(result.suggestedName, 40);
  if (suggested && !isIrregularAssetName(suggested)) return suggested;

  const model = clean(productCodes[0] || firstValue(result.products), 16);
  const rawModule = clean(result.moduleSuggestion || firstValue(result.modules), 20).toUpperCase();
  const moduleName = moduleNames[rawModule] || clean(rawModule, 12);
  const detail = firstValue(result.features)
    || firstValue(result.painPoints)
    || firstValue(result.scenes)
    || firstValue(result.tags)
    || clean(result.summary, 18);
  const parts = [model, moduleName, detail].filter((item, index, values) => item && values.indexOf(item) === index);
  const generated = clean(parts.join("-"), 40);
  return generated && !isIrregularAssetName(generated) ? generated : undefined;
}
