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
  if (schema.type === "object") schema.additionalProperties = false;
  return schema;
}

export function finalResultSchema(contentSchema: JsonRecord): JsonRecord {
  const properties = {
    ...(contentSchema.properties as JsonRecord || {}),
    execution: executionSchema,
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
  if (validate(result)) return result;
  const message = (validate.errors || [])
    .map((error) => `${error.instancePath || "/"} ${error.message || "不符合Schema"}`)
    .join("；");
  throw new ResultSchemaError(`result.json Schema校验失败：${message}`, validate.errors || []);
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
