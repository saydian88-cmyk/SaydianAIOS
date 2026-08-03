import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export type JsonRecord = Record<string, unknown>;

export type SkillKey =
  | "imagegen"
  | "build-health-brand-trust-content"
  | "saydian-douyin-viral-video-generator"
  | "saidian-ai-task-dispatcher"
  | "saidian-douyin-image-posts"
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
  downstreamSkillName?: string;
  downstreamSkillPath?: string;
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
    "saydian-douyin-viral-video-generator": resolve(String(
      env.AI_TASK_DOUYIN_VIRAL_VIDEO_SKILL_PATH
      || join(home, "skills", "saydian-douyin-viral-video-generator", "SKILL.md"),
    )),
    "saidian-ai-task-dispatcher": resolve(String(
      env.AI_TASK_DISPATCHER_SKILL_PATH
      || join(home, "skills", "saidian-ai-task-dispatcher", "SKILL.md"),
    )),
    "saidian-douyin-image-posts": resolve(String(
      env.AI_TASK_IMAGE_POST_SKILL_PATH
      || join(home, "skills", "saidian-douyin-image-posts", "SKILL.md"),
    )),
    "video-editing-from-media-library-share": resolve(String(
      env.AI_TASK_DIRECT_VIDEO_SKILL_PATH
      || join(home, "skills", "video-editing-from-media-library-share", "SKILL.md"),
    )),
  };
}

function videoSkillPath(env: NodeJS.ProcessEnv) {
  const home = codexHome(env);
  return resolve(String(
    env.AI_TASK_VIDEO_SKILL_PATH
    || join(home, "skills", "video-editing-from-media-library", "SKILL.md"),
  ));
}

function videoSkillName(env: NodeJS.ProcessEnv) {
  return String(env.AI_TASK_VIDEO_SKILL_NAME || "video-editing-from-media-library").trim();
}

function imagePostSkillName(env: NodeJS.ProcessEnv) {
  return String(env.AI_TASK_IMAGE_POST_SKILL_NAME || "saidian-douyin-image-posts").trim();
}

function assertPackageRoute(
  execution: JsonRecord,
  key: SkillKey,
  allowedStrategies: string[],
  compatibleRequiredSkills: string[] = [],
) {
  const requiredSkill = String(execution.requiredSkill || "").trim();
  const allowedRequiredSkills = new Set([key, ...compatibleRequiredSkills].filter(Boolean));
  if (requiredSkill && !allowedRequiredSkills.has(requiredSkill)) {
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
  const sourceType = String(
    task.sourceType || taskPackage.sourceType || taskInput.sourceType || taskInput.projectSourceType || "",
  ).trim().toUpperCase();
  const isImagePostProject = type === "IMAGE"
    && (sourceType === "IMAGE_PROJECT" || Boolean(taskInput.imageProjectId));
  const executionMode = String(
    execution.mode || taskInput.executionMode || (type === "VIDEO" ? "FULL_VIDEO" : isImagePostProject ? "IMAGE_POST" : "DEFAULT"),
  ).trim().toUpperCase();
  const isDouyinViralModule = String(taskInput.factoryModule || "").trim().toUpperCase() === "DOUYIN_VIRAL";
  const isCodexDirectFullVideo = type === "VIDEO"
    && executionMode === "FULL_VIDEO"
    && taskInput.codexDirectFullVideo === true;
  const registry = () => skillRegistry(env);

  if (isImagePostProject && executionMode === "IMAGE_POST") {
    assertPackageRoute(
      execution,
      "saidian-ai-task-dispatcher",
      ["CODEX_SKILL", "CODEX_FIRST"],
      [imagePostSkillName(env), "saidian-douyin-image-posts"],
    );
    return {
      key: "saidian-ai-task-dispatcher",
      taskType: type,
      executionMode,
      strategy: "CODEX_SKILL",
      reason: "IMAGE/IMAGE_PROJECT 由赛电调度 Skill 自动调用图文制作 Skill，生成整组图文、标题、标签与发布文案",
      fallbackOrder: ["SAIDIAN_DOUYIN_IMAGE_POSTS", "WAITING_INPUT"],
      skillPath: registry()["saidian-ai-task-dispatcher"],
      downstreamSkillName: imagePostSkillName(env),
      downstreamSkillPath: registry()["saidian-douyin-image-posts"],
    };
  }

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

  if (type === "VIDEO"
    && isDouyinViralModule
    && ["TOPIC_CARD_BATCH", "FULL_VIDEO", "SCRIPT_ONLY"].includes(executionMode)) {
    assertPackageRoute(
      execution,
      "saydian-douyin-viral-video-generator",
      ["CODEX_SKILL", "CODEX_FIRST", "CODEX_TOPIC_CARD"],
    );
    return {
      key: "saydian-douyin-viral-video-generator",
      taskType: type,
      executionMode,
      strategy: "CODEX_SKILL",
      reason: `抖音爆款生成模块 ${executionMode} 使用独立专用 Skill`,
      fallbackOrder: executionMode === "TOPIC_CARD_BATCH"
        ? ["STRUCTURED_TOPIC_CARD_ONLY"]
        : executionMode === "SCRIPT_ONLY"
          ? ["SCRIPT_AND_STORYBOARD_ONLY"]
          : [
            "APPROVED_REAL_VIDEO",
            "PRODUCT_IMAGE_AUXILIARY_OVERLAY",
            "LOCAL_MEDIA_TOOLS",
            "EXTERNAL_VISUAL_IF_EXPLICITLY_ALLOWED",
            "RESHOOT_OPS_TASK",
          ],
      skillPath: registry()["saydian-douyin-viral-video-generator"],
    };
  }

  if (type === "VIDEO" && ["FULL_VIDEO", "SCRIPT_ONLY", "SIMILAR_VIDEO", "NO_VOICE_VIDEO", "COVER_TITLE"].includes(executionMode)) {
    assertPackageRoute(
      execution,
      "saidian-ai-task-dispatcher",
      ["CODEX_SKILL", "CODEX_FIRST"],
      [
        videoSkillName(env),
        "video-editing-from-media-library",
        "video-editing-from-media-library-share",
      ],
    );
    return {
      key: "saidian-ai-task-dispatcher",
      taskType: type,
      executionMode,
      strategy: "CODEX_SKILL",
      reason: isCodexDirectFullVideo
        ? "Codex直出成片由赛电调度 Skill 调用本机完整版素材库剪辑 Skill，内部完整制作质检，仅隐藏中间审核界面"
        : executionMode === "COVER_TITLE"
        ? "VIDEO/COVER_TITLE 由赛电调度 Skill 调用本地素材库剪辑 Skill，再交接封面标题子 Skill"
        : executionMode === "SCRIPT_ONLY"
          ? "VIDEO/SCRIPT_ONLY 由赛电调度 Skill 调用本地素材库剪辑 Skill 的脚本阶段"
          : `VIDEO/${executionMode} 由赛电调度 Skill 调用本地素材库剪辑 Skill`,
      fallbackOrder: ["FULL_VIDEO", "SIMILAR_VIDEO", "NO_VOICE_VIDEO"].includes(executionMode)
        ? [
          "APPROVED_REAL_VIDEO",
          "PRODUCT_IMAGE_AUXILIARY_OVERLAY",
          "LOCAL_MEDIA_TOOLS",
          "EXTERNAL_VISUAL_IF_EXPLICITLY_ALLOWED",
          "RESHOOT_OPS_TASK",
        ]
        : executionMode === "COVER_TITLE"
          ? ["FENG_MIAN_BIAO_TI_CHILD_SKILL"]
          : ["SCRIPT_AND_STORYBOARD_ONLY"],
      skillPath: registry()["saidian-ai-task-dispatcher"],
      downstreamSkillName: videoSkillName(env),
      downstreamSkillPath: videoSkillPath(env),
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
