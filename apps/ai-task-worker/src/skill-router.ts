import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export type JsonRecord = Record<string, unknown>;

export type SkillKey =
  | "imagegen"
  | "build-health-brand-trust-content"
  | "video-editing-from-media-library-share"
  | "legacy-codex";

export type SkillRoute = {
  key: SkillKey;
  taskType: string;
  executionMode: string;
  strategy: string;
  reason: string;
  fallbackOrder: string[];
  skillPath?: string;
};

export type DetectedSkill = SkillRoute & {
  name: SkillKey;
  version: string;
  digest: string;
};

const legacyTaskTypes = new Set(["STORE_ANALYSIS", "COMPETITOR_ANALYSIS", "LIVE_ANALYSIS"]);

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function codexHome(env: NodeJS.ProcessEnv) {
  const configured = String(env.CODEX_HOME || "").trim();
  if (!configured) throw new SkillRouteError("CODEX_HOME 未配置，无法探测固定 Skill", "SKILL_HOME_MISSING");
  return resolve(configured);
}

export class SkillRouteError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly disposition: "FAILED" | "WAITING_INPUT" = "FAILED",
  ) {
    super(message);
    this.name = "SkillRouteError";
  }
}

export function skillRegistry(env: NodeJS.ProcessEnv = process.env): Record<Exclude<SkillKey, "legacy-codex">, string> {
  const home = codexHome(env);
  return {
    imagegen: resolve(String(env.AI_TASK_IMAGE_SKILL_PATH || join(home, "skills", ".system", "imagegen", "SKILL.md"))),
    "build-health-brand-trust-content": resolve(String(
      env.AI_TASK_ARTICLE_SKILL_PATH
      || join(home, "skills", "build-health-brand-trust-content", "SKILL.md"),
    )),
    "video-editing-from-media-library-share": resolve(String(
      env.AI_TASK_VIDEO_SKILL_PATH
      || join(
        home,
        "plugins",
        "cache",
        "personal",
        "video-editing-from-media-library-share",
        "0.1.0",
        "skills",
        "video-editing-from-media-library-share",
        "SKILL.md",
      ),
    )),
  };
}

function assertPackageRoute(execution: JsonRecord, key: SkillKey, allowedStrategies: string[]) {
  const requiredSkill = String(execution.requiredSkill || "").trim();
  if (requiredSkill && requiredSkill !== key) {
    throw new SkillRouteError(
      `任务包 requiredSkill=${requiredSkill} 与固定路由 ${key} 不一致`,
      "REQUIRED_SKILL_MISMATCH",
    );
  }
  const strategy = String(execution.strategy || "").trim().toUpperCase();
  if (strategy && !allowedStrategies.includes(strategy)) {
    throw new SkillRouteError(
      `任务包 strategy=${strategy} 不允许执行固定 Skill ${key}`,
      "STRATEGY_MISMATCH",
    );
  }
}

export function routeTask(taskPackage: JsonRecord, env: NodeJS.ProcessEnv = process.env): SkillRoute {
  const task = object(taskPackage.task);
  const execution = {
    ...object(taskPackage.execution),
    ...object(taskPackage.skillExecution),
  };
  const type = String(task.type || taskPackage.type || "").trim().toUpperCase();
  const taskInput = object(task.input);
  const executionMode = String(
    execution.mode || taskInput.executionMode || (type === "VIDEO" ? "FULL_VIDEO" : "DEFAULT"),
  ).trim().toUpperCase();
  const registry = () => skillRegistry(env);

  if (type === "IMAGE") {
    assertPackageRoute(execution, "imagegen", ["CODEX_SKILL"]);
    return {
      key: "imagegen",
      taskType: type,
      executionMode,
      strategy: "CODEX_SKILL",
      reason: "AiTask.type=IMAGE 固定使用 Codex 内置图片 Skill",
      fallbackOrder: ["CODEX_BUILTIN_IMAGEGEN"],
      skillPath: registry().imagegen,
    };
  }

  if (type === "ARTICLE") {
    assertPackageRoute(execution, "build-health-brand-trust-content", ["CODEX_SKILL"]);
    return {
      key: "build-health-brand-trust-content",
      taskType: type,
      executionMode,
      strategy: "CODEX_SKILL",
      reason: "AiTask.type=ARTICLE 固定使用健康品牌信任内容 Skill",
      fallbackOrder: ["CODEX_TRUST_CONTENT"],
      skillPath: registry()["build-health-brand-trust-content"],
    };
  }

  if (type === "VIDEO" && ["FULL_VIDEO", "SCRIPT_ONLY"].includes(executionMode)) {
    assertPackageRoute(
      execution,
      "video-editing-from-media-library-share",
      ["CODEX_SKILL", "CODEX_FIRST"],
    );
    return {
      key: "video-editing-from-media-library-share",
      taskType: type,
      executionMode,
      strategy: "CODEX_SKILL",
      reason: executionMode === "FULL_VIDEO"
        ? "VIDEO/FULL_VIDEO 固定使用素材库分享版剪辑 Skill"
        : "VIDEO/SCRIPT_ONLY 使用同一 Skill 的脚本与分镜阶段",
      fallbackOrder: executionMode === "FULL_VIDEO"
        ? [
          "APPROVED_REAL_VIDEO",
          "PRODUCT_IMAGE_AUXILIARY_OVERLAY",
          "LOCAL_MEDIA_TOOLS",
          "EXTERNAL_VISUAL_IF_EXPLICITLY_ALLOWED",
          "RESHOOT_OPS_TASK",
        ]
        : ["SCRIPT_AND_STORYBOARD_ONLY"],
      skillPath: registry()["video-editing-from-media-library-share"],
    };
  }

  if (type === "VIDEO" && executionMode === "TOPIC_CARD_BATCH") {
    return {
      key: "legacy-codex",
      taskType: type,
      executionMode,
      strategy: "CODEX_TOPIC_CARD",
      reason: "TOPIC_CARD_BATCH 保持现有选题卡流程，不产生脚本或成片费用",
      fallbackOrder: ["STRUCTURED_TOPIC_CARD_ONLY"],
    };
  }

  if (legacyTaskTypes.has(type)) {
    return {
      key: "legacy-codex",
      taskType: type,
      executionMode,
      strategy: "LEGACY_CODEX",
      reason: "保持既有经营分析任务兼容",
      fallbackOrder: ["LEGACY_STRUCTURED_ANALYSIS"],
    };
  }

  throw new SkillRouteError(
    type ? `未知 AI 任务类型：${type}` : "AI 任务类型缺失",
    "UNSUPPORTED_TASK_TYPE",
    "WAITING_INPUT",
  );
}

export async function detectSkill(route: SkillRoute): Promise<DetectedSkill> {
  if (route.key === "legacy-codex") {
    return {
      ...route,
      name: "legacy-codex",
      version: "compatible-v1",
      digest: "legacy-codex",
    };
  }
  const path = String(route.skillPath || "");
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("not a file");
    const content = await readFile(path);
    const digest = createHash("sha256").update(content).digest("hex");
    const frontmatterName = content.toString("utf8").match(/^---[\s\S]*?\bname:\s*["']?([^"'\r\n]+)["']?/u)?.[1]?.trim();
    if (frontmatterName && frontmatterName !== route.key) {
      throw new SkillRouteError(
        `Skill 文件声明 ${frontmatterName}，与固定路由 ${route.key} 不一致`,
        "SKILL_NAME_MISMATCH",
      );
    }
    return {
      ...route,
      name: route.key,
      version: `sha256-${digest.slice(0, 12)}`,
      digest,
    };
  } catch (error) {
    if (error instanceof SkillRouteError) throw error;
    throw new SkillRouteError(`固定 Skill 缺失或不可读：${route.key}（${path}）`, "SKILL_MISSING");
  }
}
