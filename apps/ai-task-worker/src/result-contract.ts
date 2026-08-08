import Ajv, { type ErrorObject } from "ajv";
import type { JsonRecord } from "./skill-router";

export class ResultSchemaError extends Error {
  constructor(
    message: string,
    public readonly errors: ErrorObject[] = [],
  ) {
    super(message);
    this.name = "ResultSchemaError";
  }
}

const executionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    skill: { type: "string" },
    skillVersion: { type: "string" },
    skillDigest: { type: "string" },
    skillPath: { type: "string" },
    strategy: { type: "string" },
    executionMode: { type: "string" },
    routeReason: { type: "string" },
    fallbackOrder: { type: "array", items: { type: "string" } },
    downstreamSkill: { type: "string" },
    downstreamSkillPath: { type: "string" },
    startedAt: { type: "string" },
    finishedAt: { type: "string" },
    durationMs: { type: "number", minimum: 0 },
    resumed: { type: "boolean" },
    schemaAttempts: { type: "number", minimum: 1 },
    projectMode: { type: "string" },
    stage: { type: "string" },
  },
  required: [
    "skill",
    "skillVersion",
    "skillDigest",
    "strategy",
    "executionMode",
    "routeReason",
    "fallbackOrder",
    "startedAt",
    "finishedAt",
    "durationMs",
    "resumed",
    "schemaAttempts",
  ],
} as const;

export function openAiStrictSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(openAiStrictSchema);
  if (!value || typeof value !== "object") return value;
  const schema = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, openAiStrictSchema(item)]),
  );
  if (schema.type === "object") {
    schema.additionalProperties = false;
    // OpenAI strict JSON Schema requires every declared object property to
    // appear in `required`; optional values must instead be represented with
    // a nullable schema. Keeping a subset here makes the request fail before
    // Codex can start the downstream Skill.
    if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
      schema.required = Object.keys(schema.properties);
    }
  }
  return schema;
}

export function finalResultSchema(contentSchema: JsonRecord): JsonRecord {
  const properties = {
    ...(contentSchema.properties as JsonRecord || {}),
    execution: executionSchema,
    qualityWarnings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          validator: { type: "string" },
          summary: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["validator", "summary", "recommendation"],
      },
    },
  };
  const required = Array.from(new Set([
    ...(Array.isArray(contentSchema.required) ? contentSchema.required.map(String) : []),
    "execution",
  ]));
  return {
    ...contentSchema,
    properties,
    required,
  };
}

export function validateResult(result: JsonRecord, schema: JsonRecord, final = false) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(final ? finalResultSchema(schema) : schema);
  // File hashes and byte sizes are added by the worker after the downstream
  // Skill's result has passed its contract. They are transport evidence, not
  // Skill-authored fields, so strict output schemas must validate the original
  // contract without discarding those derived values before upload.
  const validationResult = structuredClone(result);
  for (const output of Array.isArray(validationResult.outputFiles) ? validationResult.outputFiles : []) {
    if (!output || typeof output !== "object" || Array.isArray(output)) continue;
    const metadata = (output as JsonRecord).metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
    delete (metadata as JsonRecord).sha256;
    delete (metadata as JsonRecord).sizeBytes;
  }
  if (validate(validationResult)) return result;
  const message = (validate.errors || [])
    .map((error) => `${error.instancePath || "/"} ${error.message || "不符合Schema"}`)
    .join("；");
  throw new ResultSchemaError(`result.json Schema校验失败：${message}`, validate.errors || []);
}

export function validateVideoScriptMaterialIds(
  result: JsonRecord,
  assets: Array<{ id?: unknown; kind?: unknown }>,
) {
  const assetKinds = new Map(
    assets
      .map((asset) => [String(asset.id || ""), String(asset.kind || "").toUpperCase()] as const)
      .filter(([id]) => id),
  );
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  for (const [candidateIndex, rawCandidate] of candidates.entries()) {
    const candidate = rawCandidate && typeof rawCandidate === "object" ? rawCandidate as JsonRecord : {};
    const scriptPackage = candidate.scriptPackage && typeof candidate.scriptPackage === "object"
      ? candidate.scriptPackage as JsonRecord
      : {};
    const requirements = Array.isArray(scriptPackage.shotRequirements) ? scriptPackage.shotRequirements : [];
    for (const [requirementIndex, rawRequirement] of requirements.entries()) {
      const requirement = rawRequirement && typeof rawRequirement === "object" ? rawRequirement as JsonRecord : {};
      const videoIds = Array.isArray(requirement.matchedVideoAssetIds)
        ? requirement.matchedVideoAssetIds.map(String).filter(Boolean)
        : [];
      const imageIds = Array.isArray(requirement.auxiliaryImageAssetIds)
        ? requirement.auxiliaryImageAssetIds.map(String).filter(Boolean)
        : [];
      const invalidVideoIds = videoIds.filter((id) => assetKinds.get(id) !== "VIDEO");
      const invalidImageIds = imageIds.filter((id) => assetKinds.get(id) !== "IMAGE");
      const location = `候选${candidateIndex + 1}第${requirementIndex + 1}句`;
      if (invalidVideoIds.length) {
        throw new ResultSchemaError(`${location}回传了非任务白名单VIDEO素材ID：${invalidVideoIds.join("、")}`);
      }
      if (invalidImageIds.length) {
        throw new ResultSchemaError(`${location}回传了非任务白名单IMAGE辅助素材ID：${invalidImageIds.join("、")}`);
      }
      const status = String(requirement.assetStatus || "").toUpperCase();
      if (status === "COVERED" && !videoIds.length) {
        throw new ResultSchemaError(`${location}标记为COVERED但没有回传matchedVideoAssetIds`);
      }
      if (videoIds.length && status !== "COVERED") {
        throw new ResultSchemaError(`${location}已绑定真实视频素材ID但assetStatus不是COVERED`);
      }
    }
  }
  return result;
}

export async function runWithSchemaRetry<T extends JsonRecord>(
  execute: (schemaAttempt: number) => Promise<T>,
  validate: (result: T) => T,
  maxAttempts = 2,
): Promise<{ result: T; attempts: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
    try {
      return { result: validate(await execute(attempt)), attempts: attempt };
    } catch (error) {
      lastError = error;
      if (!(error instanceof ResultSchemaError) || attempt >= maxAttempts) throw error;
    }
  }
  throw lastError;
}
