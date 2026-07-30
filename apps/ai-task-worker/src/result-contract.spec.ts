import { describe, expect, it, vi } from "vitest";
import {
  openAiStrictSchema,
  ResultSchemaError,
  runWithSchemaRetry,
  validateResult,
} from "./result-contract";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    outputFiles: { type: "array" },
  },
  required: ["summary", "outputFiles"],
};

describe("unified result contract", () => {
  it("converts every nested object to an OpenAI strict schema", () => {
    const strict = openAiStrictSchema({
      type: "object",
      properties: {
        outputFiles: {
          type: "array",
          items: {
            type: "object",
            properties: {
              metadata: {
                type: "object",
                additionalProperties: true,
                properties: { description: { type: "string" } },
              },
            },
          },
        },
      },
    }) as Record<string, any>;

    expect(strict.additionalProperties).toBe(false);
    expect(strict.properties.outputFiles.items.additionalProperties).toBe(false);
    expect(strict.properties.outputFiles.items.properties.metadata.additionalProperties).toBe(false);
  });

  it("retries a schema-invalid result and accepts the corrected result", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ summary: 1, outputFiles: [] })
      .mockResolvedValueOnce({ summary: "ok", outputFiles: [] });
    const completed = await runWithSchemaRetry(
      execute,
      (result) => validateResult(result, schema),
      2,
    );
    expect(completed.attempts).toBe(2);
    expect(completed.result.summary).toBe("ok");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not accept a final result without execution trace", () => {
    expect(() => validateResult({ summary: "ok", outputFiles: [] }, schema, true))
      .toThrow(ResultSchemaError);
  });

  it("accepts downstream Skill trace fields added by the dispatcher", () => {
    expect(() => validateResult({
      summary: "ok",
      outputFiles: [],
      execution: {
        skill: "saidian-ai-task-dispatcher",
        skillVersion: "sha256-test",
        skillDigest: "digest",
        strategy: "CODEX_SKILL",
        executionMode: "SCRIPT_ONLY",
        routeReason: "dispatcher route",
        fallbackOrder: ["SCRIPT_AND_STORYBOARD_ONLY"],
        downstreamSkill: "video-editing-from-media-library",
        downstreamSkillPath: "G:/CodexHome/skills/video-editing-from-media-library/SKILL.md",
        startedAt: "2026-07-30T06:30:00.000Z",
        finishedAt: "2026-07-30T06:40:00.000Z",
        durationMs: 600000,
        resumed: false,
        schemaAttempts: 1,
      },
    }, schema, true)).not.toThrow();
  });
});
