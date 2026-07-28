import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectSkill, routeTask, SkillRouteError } from "./skill-router";

const codexHome = String(process.env.CODEX_HOME || "");

describe("skill task router", () => {
  it.each([
    ["IMAGE", "DEFAULT", "imagegen"],
    ["ARTICLE", "DEFAULT", "build-health-brand-trust-content"],
    ["VIDEO", "FULL_VIDEO", "video-editing-from-media-library-share"],
    ["VIDEO", "SCRIPT_ONLY", "video-editing-from-media-library-share"],
  ])("routes %s/%s to %s", (type, mode, skill) => {
    expect(routeTask({
      task: { type },
      execution: { mode, strategy: "CODEX_SKILL", requiredSkill: skill },
    }, { ...process.env, CODEX_HOME: codexHome }).key).toBe(skill);
  });

  it("keeps topic-card generation on the existing zero-output route", () => {
    expect(routeTask({
      task: { type: "VIDEO" },
      execution: { mode: "TOPIC_CARD_BATCH" },
    }, { ...process.env, CODEX_HOME: codexHome })).toMatchObject({
      key: "legacy-codex",
      strategy: "CODEX_TOPIC_CARD",
    });
  });

  it("rejects unknown task types without silent fallback", () => {
    expect(() => routeTask({
      task: { type: "UNKNOWN" },
      execution: {},
    }, { ...process.env, CODEX_HOME: codexHome })).toThrowError(
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
    }, { ...process.env, CODEX_HOME: codexHome })).toThrowError(
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
