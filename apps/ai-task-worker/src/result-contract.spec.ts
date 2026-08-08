import { describe, expect, it, vi } from "vitest";
import {
  openAiStrictSchema,
  ResultSchemaError,
  runWithSchemaRetry,
  validateResult,
  validateVideoScriptMaterialIds,
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

  it("requires every declared property for OpenAI strict schemas", () => {
    const strict = openAiStrictSchema({
      type: "object",
      properties: {
        title: { type: "string" },
        groups: { type: "array", items: { type: "string" } },
      },
      required: ["title"],
    }) as Record<string, any>;

    expect(strict.required).toEqual(["title", "groups"]);
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

  it("accepts worker-added output hash metadata without weakening the Skill schema", () => {
    const strictOutputSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        outputFiles: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: { type: "string" },
              metadata: {
                type: "object",
                additionalProperties: false,
                properties: { videoKey: { type: "string" } },
                required: ["videoKey"],
              },
            },
            required: ["path", "metadata"],
          },
        },
      },
      required: ["summary", "outputFiles"],
    };
    expect(() => validateResult({
      summary: "ok",
      outputFiles: [{ path: "outputs/1-1.mp4", metadata: { videoKey: "1-1", sha256: "abc", sizeBytes: 10 } }],
    }, strictOutputSchema)).not.toThrow();
  });

  it("accepts resumable dispatcher fields and non-blocking quality warnings", () => {
    const schemaWithWarnings = {
      ...schema,
      properties: {
        ...schema.properties,
        qualityWarnings: { type: "array" },
      },
    };
    expect(() => validateResult({
      summary: "ok",
      outputFiles: [],
      qualityWarnings: [{ validator: "delivery", summary: "warning", recommendation: "review" }],
      execution: {
        skill: "saidian-ai-task-dispatcher",
        skillVersion: "sha256-test",
        skillDigest: "digest",
        strategy: "CODEX_SKILL",
        executionMode: "FULL_VIDEO",
        routeReason: "dispatcher route",
        fallbackOrder: ["APPROVED_REAL_VIDEO"],
        startedAt: "2026-08-08T04:00:00.000Z",
        finishedAt: "2026-08-08T04:01:00.000Z",
        durationMs: 60000,
        resumed: true,
        schemaAttempts: 1,
        projectMode: "CODEX_DIRECT_FULL_VIDEO",
        stage: "FULL_VIDEO",
      },
    }, schemaWithWarnings, true)).not.toThrow();
  });

  it("accepts covered script lines only when they bind real task VIDEO asset IDs", () => {
    expect(() => validateVideoScriptMaterialIds({
      candidates: [{
        scriptPackage: {
          shotRequirements: [{
            assetStatus: "COVERED",
            matchedVideoAssetIds: ["video-1"],
            auxiliaryImageAssetIds: ["image-1"],
          }],
        },
      }],
    }, [
      { id: "video-1", kind: "VIDEO" },
      { id: "image-1", kind: "IMAGE" },
    ])).not.toThrow();
  });

  it("rejects covered lines without a real task VIDEO asset ID", () => {
    expect(() => validateVideoScriptMaterialIds({
      candidates: [{
        scriptPackage: {
          shotRequirements: [{
            assetStatus: "COVERED",
            matchedVideoAssetIds: [],
            auxiliaryImageAssetIds: ["image-1"],
          }],
        },
      }],
    }, [{ id: "image-1", kind: "IMAGE" }])).toThrow("没有回传matchedVideoAssetIds");
  });

  it("rejects asset IDs outside the current task material library whitelist", () => {
    expect(() => validateVideoScriptMaterialIds({
      candidates: [{
        scriptPackage: {
          shotRequirements: [{
            assetStatus: "COVERED",
            matchedVideoAssetIds: ["other-task-video"],
            auxiliaryImageAssetIds: [],
          }],
        },
      }],
    }, [{ id: "video-1", kind: "VIDEO" }])).toThrow("非任务白名单VIDEO素材ID");
  });
});
