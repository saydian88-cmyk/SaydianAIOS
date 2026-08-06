import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectSkill, routeTask, SkillRouteError } from "./skill-router";

const routeOnlyCodexHome = join(tmpdir(), "route-only-codex-home");

describe("skill task router", () => {
  it.each([
    ["IMAGE", "DEFAULT", "imagegen"],
    ["ARTICLE", "DEFAULT", "build-health-brand-trust-content"],
    ["VIDEO", "FULL_VIDEO", "saidian-ai-task-dispatcher"],
    ["VIDEO", "SCRIPT_ONLY", "saidian-ai-task-dispatcher"],
    ["VIDEO", "SIMILAR_VIDEO", "saidian-ai-task-dispatcher"],
    ["VIDEO", "NO_VOICE_VIDEO", "saidian-ai-task-dispatcher"],
    ["VIDEO", "COVER_TITLE", "saidian-ai-task-dispatcher"],
  ])("routes %s/%s to %s", (type, mode, skill) => {
    expect(routeTask({
      task: { type, ...(type === "VIDEO" ? { sourceType: "VIDEO_FACTORY_PROJECT" } : {}) },
      execution: { mode, strategy: "CODEX_SKILL", requiredSkill: skill },
    }, { ...process.env, CODEX_HOME: routeOnlyCodexHome }).key).toBe(skill);
  });

  it("keeps topic-card generation on the existing zero-output route", () => {
    expect(routeTask({
      task: { type: "VIDEO" },
      execution: { mode: "TOPIC_CARD_BATCH" },
    }, { ...process.env, CODEX_HOME: routeOnlyCodexHome })).toMatchObject({
      key: "legacy-codex",
      strategy: "CODEX_TOPIC_CARD",
    });
  });

  it.each(["TOPIC_CARD_BATCH", "SCRIPT_ONLY", "FULL_VIDEO"])(
    "routes the dedicated Douyin viral module %s task to its own Skill",
    (mode) => {
      const route = routeTask({
        task: {
          type: "VIDEO",
          input: { executionMode: mode, factoryModule: "DOUYIN_VIRAL" },
        },
        execution: {
          mode,
          strategy: "CODEX_SKILL",
          requiredSkill: "saydian-douyin-viral-video-generator",
        },
      }, { ...process.env, CODEX_HOME: routeOnlyCodexHome });
      expect(route).toMatchObject({
        key: "saydian-douyin-viral-video-generator",
      });
      expect(route).not.toHaveProperty("downstreamSkillName");
      expect(route).not.toHaveProperty("downstreamSkillPath");
    },
  );

  it("does not allow an environment override to downgrade the full video Skill", () => {
    const fullSkillPath = join(routeOnlyCodexHome, "skills", "video-editing-from-media-library", "SKILL.md");
    expect(routeTask({
      task: { type: "VIDEO", sourceType: "VIDEO_FACTORY_PROJECT" },
      execution: { mode: "FULL_VIDEO", strategy: "CODEX_SKILL", requiredSkill: "saidian-ai-task-dispatcher" },
    }, {
      ...process.env,
      CODEX_HOME: routeOnlyCodexHome,
      AI_TASK_VIDEO_SKILL_NAME: "video-editing-from-media-library-share",
      AI_TASK_VIDEO_SKILL_PATH: join(routeOnlyCodexHome, "skills", "video-editing-from-media-library-share", "SKILL.md"),
    })).toMatchObject({
      downstreamSkillName: "video-editing-from-media-library",
      downstreamSkillPath: fullSkillPath,
    });
  });

  it("routes an image-project task through the dispatcher to the 图文制作 Skill", () => {
    expect(routeTask({
      task: { type: "IMAGE", sourceType: "IMAGE_PROJECT", input: { executionMode: "IMAGE_POST" } },
      execution: {
        mode: "IMAGE_POST",
        strategy: "CODEX_SKILL",
        requiredSkill: "saidian-ai-task-dispatcher",
      },
    }, { ...process.env, CODEX_HOME: routeOnlyCodexHome })).toMatchObject({
      key: "saidian-ai-task-dispatcher",
      executionMode: "IMAGE_POST",
      downstreamSkillName: "saidian-douyin-image-posts",
    });
  });

  it("normalizes batch image projects to the shared IMAGE_POST dispatcher route", () => {
    expect(routeTask({
      task: { type: "IMAGE", sourceType: "IMAGE_PROJECT", input: { executionMode: "BATCH_IMAGE_POST", imageProjectId: "image-project-1" } },
      execution: { mode: "BATCH_IMAGE_POST", strategy: "CODEX_SKILL", requiredSkill: "saidian-ai-task-dispatcher" },
    }, { ...process.env, CODEX_HOME: routeOnlyCodexHome })).toMatchObject({
      key: "saidian-ai-task-dispatcher",
      executionMode: "IMAGE_POST",
      downstreamSkillName: "saidian-douyin-image-posts",
    });
  });

  it("accepts legacy batch-image task routes after normalizing their creation mode", () => {
    expect(routeTask({
      task: {
        type: "IMAGE",
        sourceType: "IMAGE_PROJECT",
        input: {
          executionMode: "BATCH_IMAGE_POST",
          imageProjectId: "image-project-1",
          taskRoute: {
            version: 1,
            domain: "IMAGE_PROJECT",
            projectMode: "IMAGE_POST",
            stage: "IMAGE_POST",
            executionMode: "BATCH_IMAGE_POST",
            requiredSkill: "saidian-douyin-image-posts",
          },
        },
      },
      execution: { mode: "IMAGE_POST", strategy: "CODEX_SKILL", requiredSkill: "saidian-douyin-image-posts" },
    }, { ...process.env, CODEX_HOME: routeOnlyCodexHome })).toMatchObject({
      key: "saidian-ai-task-dispatcher",
      executionMode: "IMAGE_POST",
      downstreamSkillName: "saidian-douyin-image-posts",
    });
  });

  it("routes an image project when legacy rows only retain the project signal in input", () => {
    expect(routeTask({
      task: { type: "IMAGE", input: { imageProjectId: "image-project-1", executionMode: "IMAGE_POST" } },
      execution: {
        mode: "IMAGE_POST",
        strategy: "CODEX_SKILL",
        requiredSkill: "saidian-ai-task-dispatcher",
      },
    }, { ...process.env, CODEX_HOME: routeOnlyCodexHome })).toMatchObject({
      key: "saidian-ai-task-dispatcher",
      downstreamSkillName: "saidian-douyin-image-posts",
    });
  });

  it("routes a legacy image-post package that only retains execution mode and required Skill", () => {
    expect(routeTask({
      task: { type: "IMAGE", input: {} },
      execution: {
        mode: "IMAGE_POST",
        strategy: "CODEX_SKILL",
        requiredSkill: "saidian-ai-task-dispatcher",
      },
    }, { ...process.env, CODEX_HOME: routeOnlyCodexHome })).toMatchObject({
      key: "saidian-ai-task-dispatcher",
      executionMode: "IMAGE_POST",
      downstreamSkillName: "saidian-douyin-image-posts",
    });
  });

  it("routes Codex direct full-video tasks through the dispatcher to the full local editing Skill", () => {
    expect(routeTask({
      task: { type: "VIDEO", sourceType: "VIDEO_FACTORY_PROJECT", input: { executionMode: "FULL_VIDEO", codexDirectFullVideo: true } },
      execution: {
        mode: "FULL_VIDEO",
        strategy: "CODEX_FIRST",
        requiredSkill: "saidian-ai-task-dispatcher",
      },
    }, { ...process.env, CODEX_HOME: routeOnlyCodexHome })).toMatchObject({
      key: "saidian-ai-task-dispatcher",
      strategy: "CODEX_SKILL",
      downstreamSkillName: "video-editing-from-media-library",
    });
  });

  it("accepts legacy task packages that name the share video Skill directly", () => {
    expect(routeTask({
      task: { type: "VIDEO", sourceType: "VIDEO_FACTORY_PROJECT", input: { executionMode: "SCRIPT_ONLY" } },
      execution: {
        mode: "SCRIPT_ONLY",
        strategy: "CODEX_SKILL",
        requiredSkill: "video-editing-from-media-library-share",
      },
    }, {
      ...process.env,
      CODEX_HOME: routeOnlyCodexHome,
    })).toMatchObject({
      key: "saidian-ai-task-dispatcher",
      downstreamSkillName: "video-editing-from-media-library",
    });
  });

  it("validates and routes the versioned project contract", () => {
    expect(routeTask({
      task: {
        type: "VIDEO",
        sourceType: "VIDEO_FACTORY_PROJECT",
        input: {
          executionMode: "FULL_VIDEO",
          taskRoute: {
            version: 1,
            domain: "VIDEO_PROJECT",
            projectMode: "CODEX_DIRECT_FULL_VIDEO",
            stage: "FULL_VIDEO",
            executionMode: "FULL_VIDEO",
            requiredSkill: "video-editing-from-media-library",
          },
        },
      },
      execution: {
        mode: "FULL_VIDEO",
        strategy: "CODEX_SKILL",
        requiredSkill: "video-editing-from-media-library",
      },
    }, { ...process.env, CODEX_HOME: routeOnlyCodexHome })).toMatchObject({
      key: "saidian-ai-task-dispatcher",
      downstreamSkillName: "video-editing-from-media-library",
    });
  });

  it("rejects a conflicting versioned project contract", () => {
    expect(() => routeTask({
      task: {
        type: "IMAGE",
        sourceType: "IMAGE_PROJECT",
        input: {
          executionMode: "IMAGE_POST",
          taskRoute: {
            version: 1,
            domain: "IMAGE_PROJECT",
            projectMode: "IMAGE_POST",
            stage: "IMAGE_POST",
            executionMode: "IMAGE_POST",
            requiredSkill: "saidian-douyin-image-posts",
          },
        },
      },
      execution: { mode: "IMAGE_POST", strategy: "CODEX_SKILL", requiredSkill: "imagegen" },
    }, { ...process.env, CODEX_HOME: routeOnlyCodexHome })).toThrowError(
      expect.objectContaining<Partial<SkillRouteError>>({ code: "TASK_ROUTE_CONFLICT" }),
    );
  });

  it("does not route unrelated VIDEO tasks through the editing dispatcher", () => {
    expect(() => routeTask({
      task: { type: "VIDEO", sourceType: "DAILY_VIDEO_TOPIC_CARDS", input: { executionMode: "FULL_VIDEO" } },
      execution: { mode: "FULL_VIDEO", strategy: "CODEX_SKILL", requiredSkill: "video-editing-from-media-library" },
    }, { ...process.env, CODEX_HOME: routeOnlyCodexHome })).toThrowError(
      expect.objectContaining<Partial<SkillRouteError>>({ code: "UNSUPPORTED_TASK_TYPE" }),
    );
  });

  it("rejects unknown task types without silent fallback", () => {
    expect(() => routeTask({
      task: { type: "UNKNOWN" },
      execution: {},
    }, { ...process.env, CODEX_HOME: routeOnlyCodexHome })).toThrowError(
      expect.objectContaining<Partial<SkillRouteError>>({
        code: "UNSUPPORTED_TASK_TYPE",
        disposition: "WAITING_INPUT",
      }),
    );
  });

  it("rejects a mismatched requiredSkill", () => {
    expect(() => routeTask({
      task: { type: "IMAGE" },
      execution: { strategy: "CODEX_SKILL", requiredSkill: "some-other-skill" },
    }, { ...process.env, CODEX_HOME: routeOnlyCodexHome })).toThrowError(
      expect.objectContaining<Partial<SkillRouteError>>({ code: "REQUIRED_SKILL_MISMATCH" }),
    );
  });

  it("reports a missing fixed Skill", async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), "missing-codex-home-"));
    const route = routeTask({
      task: { type: "IMAGE" },
      execution: { strategy: "CODEX_SKILL", requiredSkill: "imagegen" },
    }, { ...process.env, CODEX_HOME: fakeHome });
    await expect(detectSkill(route)).rejects.toMatchObject({ code: "SKILL_MISSING" });
  });

  it("detects the declared Skill and content digest", async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), "detected-codex-home-"));
    const skillPath = join(fakeHome, "skills", ".system", "imagegen", "SKILL.md");
    await mkdir(join(fakeHome, "skills", ".system", "imagegen"), { recursive: true });
    await writeFile(skillPath, "---\nname: imagegen\n---\n# test\n", "utf8");
    const route = routeTask({
      task: { type: "IMAGE" },
      execution: { strategy: "CODEX_SKILL", requiredSkill: "imagegen" },
    }, { ...process.env, CODEX_HOME: fakeHome });
    await expect(detectSkill(route)).resolves.toMatchObject({
      name: "imagegen",
      version: expect.stringMatching(/^sha256-/),
    });
  });
});
