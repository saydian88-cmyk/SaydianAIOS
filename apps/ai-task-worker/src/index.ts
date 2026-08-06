import "dotenv/config";
import { execFile, spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { hasHyperframesRenderEvidence, safeName, sha256, verifySha256 } from "./worker-utils";
import {
  detectSkill,
  routeTask,
  type DetectedSkill,
  type JsonRecord,
} from "./skill-router";
import {
  openAiStrictSchema,
  ResultSchemaError,
  runWithSchemaRetry,
  validateResult,
  validateVideoScriptMaterialIds,
} from "./result-contract";
import {
  appendExecutionLog,
  canResume,
  ensureTaskWorkspace,
  freshWorkspaceState,
  loadWorkspaceState,
  readJson,
  saveWorkspaceState,
  uploadLedgerKey,
  writeJsonAtomic,
  type WorkspaceState,
} from "./workspace-state";
import { availableClaimRouteKeys, videoRouteKeys } from "./worker-utils";
import {
  classifyExecutionFailure,
  repairHyperFramesRuntime,
  requiresRenderedEvidenceReview,
  shouldResumeValidatedResult,
  type RepairCategory,
} from "./execution-repair";
import { appendQualityWarning, classifyQualityGate, type QualityWarning } from "./quality-gates";

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

const apiUrl = String(process.env.AI_TASK_API_URL || "https://stest.saydian.cn").replace(/\/+$/, "");
const runnerToken = String(process.env.AI_TASK_RUNNER_TOKEN || "");
const nodeCode = String(process.env.AI_TASK_RUNNER_NODE_CODE || "windows-codex-01");
const runnerVersion = String(process.env.AI_TASK_RUNNER_VERSION || "3.0.0");
const workRoot = resolve(String(process.env.AI_TASK_WORKDIR || join(process.cwd(), ".ai-task-runner")));
const pollMs = Math.max(2_000, Number(process.env.AI_TASK_POLL_MS || 60_000));
const heartbeatMs = Math.max(10_000, Number(process.env.AI_TASK_HEARTBEAT_MS || 30_000));
const materialSyncMs = Math.max(60_000, Number(process.env.AI_TASK_MATERIAL_SYNC_MS || 5 * 60_000));
const configuredCodexExecutable = String(process.env.CODEX_EXECUTABLE || (process.platform === "win32" ? "codex.cmd" : "codex"));
const ffmpegExecutable = String(process.env.FFMPEG_EXECUTABLE || "ffmpeg");
const ffprobeExecutable = String(process.env.FFPROBE_EXECUTABLE || "ffprobe");
const pythonExecutable = String(process.env.AI_TASK_PYTHON_EXECUTABLE || process.env.PYTHON_EXECUTABLE || "python");
const codexIdleTimeoutSeconds = Math.max(120, Number(process.env.AI_TASK_CODEX_IDLE_TIMEOUT_SECONDS || 480));
const execFileAsync = promisify(execFile);
const systemMaterialRoot = join(workRoot, "system-material-library");
const systemMaterialAssetsRoot = join(systemMaterialRoot, "assets");
const systemMaterialIndexPath = join(systemMaterialRoot, "material-index.json");
const systemMaterialStatePath = join(systemMaterialRoot, "sync-state.json");
const localMediaLibraryRoot = resolve(String(process.env.AI_TASK_LOCAL_MEDIA_LIBRARY || "F:\\赛电品牌素材库"));
const localSystemMaterialMapPath = join(localMediaLibraryRoot, ".saidian-system-index", "system-asset-map.json");
const bundledGsapPath = require.resolve("gsap/dist/gsap.min.js");
const executionRepairSkillPath = resolve(String(
  process.env.AI_TASK_EXECUTION_REPAIR_SKILL_PATH
  || "G:\\codex\\xcodeplace\\CodexHome\\skills\\saidian-ai-task-execution-repair\\SKILL.md",
));
const maxInternalRepairs = Math.max(1, Number(process.env.AI_TASK_MAX_INTERNAL_REPAIRS || 3));
const maxVideoConcurrency = Math.max(1, Number(process.env.AI_TASK_MAX_VIDEO_CONCURRENCY || 1));
const maxImageConcurrency = Math.max(1, Number(process.env.AI_TASK_MAX_IMAGE_CONCURRENCY || 2));
let lastMaterialSyncAt = 0;
let materialSyncInFlight: Promise<void> | undefined;

function activeKindCount(activeTasks: Map<string, { kind: "VIDEO" | "IMAGE"; promise: Promise<void> }>, kind: "VIDEO" | "IMAGE") {
  let count = 0;
  for (const entry of activeTasks.values()) {
    if (entry.kind === kind) count += 1;
  }
  return count;
}

async function prepareHyperFramesRuntime(workspace: string) {
  const source = await stat(bundledGsapPath).catch(() => undefined);
  if (!source?.isFile() || source.size < 10_000) {
    throw new Error(`Bundled official GSAP runtime is unavailable: ${bundledGsapPath}`);
  }
  const runtimeDir = join(workspace, ".runtime", "hyperframes");
  const runtimePath = join(runtimeDir, "gsap-3.14.2.min.js");
  await mkdir(runtimeDir, { recursive: true });
  await copyFile(bundledGsapPath, runtimePath);
  return runtimePath;
}

interface ExecutionRepairState {
  attempts: Record<string, number>;
  lastCategory?: RepairCategory;
  lastReason?: string;
  lastAction?: string;
  updatedAt?: string;
}

async function loadExecutionRepairState(workspace: string) {
  return (await readJson<ExecutionRepairState>(join(workspace, "execution-repair.json"))) || { attempts: {} };
}

async function attemptExecutionRepair(workspace: string, message: string) {
  const decision = classifyExecutionFailure(message);
  if (!decision.recoverable) return { repaired: false, decision, exhausted: false };
  const repairState = await loadExecutionRepairState(workspace);
  const previousAttempts = Number(repairState.attempts[decision.fingerprint] || 0);
  if (previousAttempts >= maxInternalRepairs) return { repaired: false, decision, exhausted: true };

  const attempt = previousAttempts + 1;
  await appendExecutionLog(workspace, "REPAIR_START", {
    category: decision.category,
    fingerprint: decision.fingerprint,
    attempt,
    repairSkill: executionRepairSkillPath,
  });
  let action = "resume-from-existing-checkpoint";
  if (decision.category === "HYPERFRAMES_RUNTIME") {
    const runtimeRepair = await repairHyperFramesRuntime(workspace, bundledGsapPath);
    action = runtimeRepair.changed
      ? "localized-official-gsap-and-rewrote-project-reference"
      : "verified-local-official-gsap-runtime";
  }
  const nextState: ExecutionRepairState = {
    attempts: { ...repairState.attempts, [decision.fingerprint]: attempt },
    lastCategory: decision.category,
    lastReason: decision.reason,
    lastAction: action,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(join(workspace, "execution-repair.json"), nextState);
  await appendExecutionLog(workspace, "REPAIR_APPLIED", {
    category: decision.category,
    fingerprint: decision.fingerprint,
    attempt,
    action,
  });
  return { repaired: true, decision, exhausted: false, action, attempt };
}

/**
 * Codex Desktop updates replace the versioned executable beneath LocalAppData.
 * A runner.env written by a previous version can therefore point at a file that
 * disappeared between two task polls. Resolve the configured path at execution
 * time and, on Windows, recover to the newest installed Codex executable.
 */
async function resolveCodexExecutable() {
  const configured = configuredCodexExecutable.trim();
  if (!isAbsolute(configured)) return configured;

  try {
    const configuredStat = await stat(configured);
    if (configuredStat.isFile()) return configured;
  } catch {
    // Continue to the current Codex Desktop installation below.
  }

  if (process.platform !== "win32") {
    throw new Error(`Configured Codex executable is unavailable: ${configured}`);
  }

  const binRoot = join(String(process.env.LOCALAPPDATA || ""), "OpenAI", "Codex", "bin");
  if (!String(process.env.LOCALAPPDATA || "").trim()) {
    throw new Error(`Configured Codex executable is unavailable: ${configured}`);
  }

  const candidates: Array<{ path: string; modifiedAt: number }> = [];
  const visit = async (directory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!entry.isFile() || entry.name.toLowerCase() !== "codex.exe") continue;
      try {
        const entryStat = await stat(entryPath);
        candidates.push({ path: entryPath, modifiedAt: entryStat.mtimeMs });
      } catch {
        // A concurrent Desktop update can remove an entry while it is scanned.
      }
    }
  };
  await visit(binRoot);
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  const recovered = candidates[0]?.path;
  if (recovered) return recovered;

  throw new Error(`Configured Codex executable is unavailable and no current Codex Desktop executable was found: ${configured}`);
}

if (!runnerToken) {
  throw new Error("AI_TASK_RUNNER_TOKEN 未配置");
}

const headers = {
  authorization: `Runner ${runnerToken}`,
  "content-type": "application/json",
};

const baseProperties = {
  summary: { type: "string" },
  outputFiles: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        kind: { type: "string" },
        title: { type: "string" },
        metadata: {
          type: "object",
          additionalProperties: true,
          properties: {
            description: { type: "string" },
            source: { type: "string" },
          },
          required: ["description", "source"],
        },
      },
      required: ["path", "kind", "title", "metadata"],
    },
  },
};

function isCodexDirectFullVideoTask(taskPackage: JsonRecord) {
  const task = record(taskPackage.task);
  const execution = record(taskPackage.execution);
  const input = record(task.input);
  const localLibraryCodexTask = String(input.executionClass || "").toUpperCase() === "CODEX_SKILL"
    && String(input.skillName || "").toLowerCase() === "video-editing-from-media-library";
  return String(task.type || "") === "VIDEO"
    && String(execution.mode || "").toUpperCase() === "FULL_VIDEO"
    && (input.codexDirectFullVideo === true
      || input.referenceDirectFullVideo === true
      || localLibraryCodexTask);
}

function isImagePostProjectTask(taskPackage: JsonRecord) {
  const task = record(taskPackage.task);
  const execution = record(taskPackage.execution);
  const input = record(task.input);
  const sourceType = String(
    task.sourceType || taskPackage.sourceType || input.sourceType || input.projectSourceType || "",
  ).toUpperCase();
  const executionMode = String(execution.mode || input.executionMode || "").toUpperCase();
  const requiredSkill = String(execution.requiredSkill || "").trim();
  return String(task.type || "") === "IMAGE"
    && (
      sourceType === "IMAGE_PROJECT"
      || Boolean(input.imageProjectId)
      || executionMode === "IMAGE_POST"
      || requiredSkill === "saidian-ai-task-dispatcher"
      || requiredSkill === String(process.env.AI_TASK_IMAGE_POST_SKILL_NAME || "saidian-douyin-image-posts").trim()
      || requiredSkill === "saidian-douyin-image-posts"
    )
    && executionMode === "IMAGE_POST";
}

function assertCodexDirectMasterOutput(result: JsonRecord, taskPackage: JsonRecord) {
  if (!isCodexDirectFullVideoTask(taskPackage)) return;
  const masters = (Array.isArray(result.outputFiles) ? result.outputFiles : [])
    .map(record)
    .filter((item) => String(item.kind || "").toUpperCase() === "VIDEO_MASTER");
  if (masters.length !== 1) {
    const failure = String(result.summary || "").trim();
    if (!masters.length && /\bFAILED\b|MATERIAL_GAP_[A-Z_]+/iu.test(failure)) {
      throw new Error(failure);
    }
    throw new Error("Codex 直出任务未返回唯一的最终成片（VIDEO_MASTER），任务不能标记成功");
  }
  const masterPath = String(masters[0]?.path || "").toLowerCase();
  if (!masterPath.endsWith(".mp4")) {
    throw new Error("Codex 直出任务返回的最终成片不是 MP4，任务不能标记成功");
  }
}

function outputSchema(
  type: string,
  executionMode = "",
  requestedCardCount = 10,
  codexDirectFullVideo = false,
  imagePostProject = false,
) {
  if (type === "VIDEO") {
    // Direct-output work does not return a project script or a material-binding payload.
    // It has an intentionally empty system task package and must only hand back its master.
    if (codexDirectFullVideo) {
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          ...baseProperties,
          delivery: {
            type: "object",
            additionalProperties: false,
            properties: {
              productModel: { type: "string" },
              taskMode: { type: "string", enum: ["CODEX_DIRECT_FULL_VIDEO", "REFERENCE_DIRECT_FULL_VIDEO"] },
              finalReviewOnly: { type: "boolean" },
            },
            required: ["productModel", "taskMode", "finalReviewOnly"],
          },
        },
        required: ["summary", "outputFiles", "delivery"],
      };
    }
    if (executionMode === "COVER_TITLE") {
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          ...baseProperties,
          packaging: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                platform: { type: "string" },
                title: { type: "string" },
                body: { type: "string" },
                coverText: { type: "string" },
                hashtags: { type: "array", items: { type: "string" } },
                coverFile: { type: "string" },
                contentFingerprint: { type: "string" },
                compliance: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    passed: { type: "boolean" },
                    findings: { type: "array", items: { type: "string" } },
                  },
                  required: ["passed", "findings"],
                },
              },
              required: ["platform", "title", "body", "coverText", "hashtags", "coverFile", "contentFingerprint", "compliance"],
            },
          },
        },
        required: ["summary", "outputFiles", "packaging"],
      };
    }
    if (executionMode === "TOPIC_CARD_BATCH") {
      const cardCount = Math.max(1, Math.min(30, Math.round(requestedCardCount || 10)));
      const scoreProperties = {
        relevance: { type: "number", minimum: 0, maximum: 20 },
        demand: { type: "number", minimum: 0, maximum: 15 },
        trendGrowth: { type: "number", minimum: 0, maximum: 10 },
        contentGap: { type: "number", minimum: 0, maximum: 10 },
        commercialIntent: { type: "number", minimum: 0, maximum: 10 },
        brandFit: { type: "number", minimum: 0, maximum: 10 },
        assetCoverage: { type: "number", minimum: 0, maximum: 15 },
        shootability: { type: "number", minimum: 0, maximum: 5 },
        novelty: { type: "number", minimum: 0, maximum: 5 },
      };
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          ...baseProperties,
          topicCards: {
            type: "array",
            minItems: cardCount,
            maxItems: cardCount,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                productModel: { type: "string" },
                market: { type: "string" },
                title: { type: "string" },
                topic: { type: "string" },
                audience: { type: "string" },
                pain: { type: "string" },
                scene: { type: "string" },
                objective: { type: "string" },
                mainKeyword: { type: "string" },
                auxiliaryKeywords: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
                keywordIds: { type: "array", minItems: 1, items: { type: "string" } },
                externalVideoIds: { type: "array", items: { type: "string" } },
                knowledgeIds: { type: "array", items: { type: "string" } },
                faqIds: { type: "array", items: { type: "string" } },
                evidenceIds: { type: "array", items: { type: "string" } },
                sourceTypes: { type: "array", items: { type: "string" } },
                rationale: { type: "string" },
                reusableViralStructure: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    hookPattern: { type: "string" },
                    pace: { type: "string" },
                    shotStructure: { type: "array", minItems: 3, items: { type: "string" } },
                    ctaPattern: { type: "string" },
                  },
                  required: ["hookPattern", "pace", "shotStructure", "ctaPattern"],
                },
                hookCandidates: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
                primaryRecipe: {
                  type: "string",
                  enum: ["PAIN_SOLVE", "GIFT_EMOTION", "CONTRARIAN", "FAQ", "REVIEW", "COMPARISON", "UGC", "VISUAL_AD"],
                },
                backupRecipe: {
                  type: "string",
                  enum: ["PAIN_SOLVE", "GIFT_EMOTION", "CONTRARIAN", "FAQ", "REVIEW", "COMPARISON", "UGC", "VISUAL_AD"],
                },
                durationSeconds: { type: "number", minimum: 10, maximum: 60 },
                voiceoverDirection: { type: "string" },
                subtitleDirection: { type: "string" },
                materialCoverage: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    totalShots: { type: "number", minimum: 1 },
                    coveredShots: { type: "number", minimum: 0 },
                    coveragePercent: { type: "number", minimum: 0, maximum: 100 },
                    matchedAssetIds: { type: "array", items: { type: "string" } },
                    missingShots: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          moduleType: { type: "string" },
                          description: { type: "string" },
                          reason: { type: "string" },
                          alternative: { type: "string" },
                        },
                        required: ["moduleType", "description", "reason", "alternative"],
                      },
                    },
                  },
                  required: ["totalShots", "coveredShots", "coveragePercent", "matchedAssetIds", "missingShots"],
                },
                scoreBreakdown: {
                  type: "object",
                  additionalProperties: false,
                  properties: scoreProperties,
                  required: Object.keys(scoreProperties),
                },
                estimatedCosts: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    local: { type: "number", minimum: 0 },
                    external: { type: "number", minimum: 0 },
                    currency: { type: "string" },
                  },
                  required: ["local", "external", "currency"],
                },
                missingFacts: { type: "array", items: { type: "string" } },
                riskReasons: { type: "array", items: { type: "string" } },
              },
              required: [
                "productModel", "market", "title", "topic", "audience", "pain", "scene", "objective",
                "mainKeyword", "auxiliaryKeywords", "keywordIds", "externalVideoIds", "knowledgeIds", "faqIds",
                "evidenceIds", "sourceTypes", "rationale", "reusableViralStructure", "hookCandidates",
                "primaryRecipe", "backupRecipe", "durationSeconds", "voiceoverDirection", "subtitleDirection",
                "materialCoverage", "scoreBreakdown", "estimatedCosts", "missingFacts", "riskReasons",
              ],
            },
          },
        },
        required: ["summary", "outputFiles", "topicCards"],
      };
    }
    const shotSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        moduleType: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        durationSeconds: { type: "number", minimum: 2, maximum: 12 },
        visual: { type: "string" },
        voiceover: { type: "string" },
        subtitle: { type: "string" },
        requiredAssetTags: { type: "array", items: { type: "string" } },
        selectedAssetIds: { type: "array", items: { type: "string" } },
        sourcePreference: { type: "string" },
        missingReason: { type: "string" },
        alternativePlan: { type: "string" },
      },
      required: [
        "moduleType", "title", "description", "durationSeconds", "visual", "voiceover", "subtitle",
        "requiredAssetTags", "selectedAssetIds", "sourcePreference", "missingReason", "alternativePlan",
      ],
    };
    const scriptCandidateCount = executionMode === "SCRIPT_ONLY" ? 1 : 3;
    const textArray = { type: "array", items: { type: "string" } };
    const scriptPackageSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        basicInfo: {
          type: "object", additionalProperties: false,
          properties: {
            productModel: { type: "string" }, videoType: { type: "string" }, platform: { type: "string" },
            accountType: { type: "string" }, targetAudience: { type: "string" },
            estimatedDurationSeconds: { type: "number", minimum: 10, maximum: 60 },
            healthContentAllowed: { type: "boolean" },
          },
          required: ["productModel", "videoType", "platform", "accountType", "targetAudience", "estimatedDurationSeconds", "healthContentAllowed"],
        },
        positioning: {
          type: "object", additionalProperties: false,
          properties: {
            coreTheme: { type: "string" }, communicationGoal: { type: "string" },
            userPainPoint: { type: "string" }, uniqueSellingPoint: { type: "string" },
          },
          required: ["coreTheme", "communicationGoal", "userPainPoint", "uniqueSellingPoint"],
        },
        goldenHook: {
          type: "object", additionalProperties: false,
          properties: {
            copy: { type: "string" }, type: { type: "string" }, visual: { type: "string" },
            retentionReason: { type: "string" }, openingSound: { type: "string" },
          },
          required: ["copy", "type", "visual", "retentionReason", "openingSound"],
        },
        voiceoverLines: {
          type: "array", minItems: 3,
          items: {
            type: "object", additionalProperties: false,
            properties: {
              lineId: { type: "string" }, text: { type: "string" }, tone: { type: "string" },
              speed: { type: "string" }, emotion: { type: "string" }, durationSeconds: { type: "number", minimum: 1 },
            },
            required: ["lineId", "text", "tone", "speed", "emotion", "durationSeconds"],
          },
        },
        structure: {
          type: "array",
          items: {
            type: "object", additionalProperties: false,
            properties: { stage: { type: "string" }, purpose: { type: "string" }, content: { type: "string" } },
            required: ["stage", "purpose", "content"],
          },
        },
        shotRequirements: {
          type: "array", minItems: 3,
          items: {
            type: "object", additionalProperties: false,
            properties: {
              lineId: { type: "string" }, line: { type: "string" }, visual: { type: "string" },
              matchedVideoAssetIds: textArray,
              auxiliaryImageAssetIds: textArray,
              assetStatus: { type: "string", enum: ["COVERED", "REWRITABLE", "NEED_SHOOT", "PROHIBITED"] },
              factualProof: { type: "string" }, audioVisualRequirement: { type: "string" },
            },
            required: [
              "lineId", "line", "visual", "matchedVideoAssetIds", "auxiliaryImageAssetIds",
              "assetStatus", "factualProof", "audioVisualRequirement",
            ],
          },
        },
        retentionDesign: textArray,
        subtitles: textArray,
        emphasisTexts: textArray,
        soundDesign: {
          type: "object", additionalProperties: false,
          properties: {
            voiceProfile: { type: "string" }, tone: { type: "string" }, emotion: { type: "string" },
            speed: { type: "string" }, openingSfx: { type: "string" }, keySfx: textArray, ambientSound: { type: "string" },
          },
          required: ["voiceProfile", "tone", "emotion", "speed", "openingSfx", "keySfx", "ambientSound"],
        },
        complianceChecks: {
          type: "array",
          items: {
            type: "object", additionalProperties: false,
            properties: { category: { type: "string" }, status: { type: "string", enum: ["PASS", "REVIEW", "BLOCK"] }, note: { type: "string" } },
            required: ["category", "status", "note"],
          },
        },
        ending: {
          type: "object", additionalProperties: false,
          properties: {
            summary: { type: "string" }, interaction: { type: "string" }, visual: { type: "string" },
            safeTailSeconds: { type: "number", minimum: 0.25 },
          },
          required: ["summary", "interaction", "visual", "safeTailSeconds"],
        },
        materialGaps: {
          type: "array",
          items: {
            type: "object", additionalProperties: false,
            properties: {
              product: { type: "string" }, action: { type: "string" }, shotSize: { type: "string" },
              processOrResult: { type: "string" }, shootingMethod: { type: "string" },
            },
            required: ["product", "action", "shotSize", "processOrResult", "shootingMethod"],
          },
        },
        overlayNotice: { type: "string" },
      },
      required: [
        "basicInfo", "positioning", "goldenHook", "voiceoverLines", "structure", "shotRequirements",
        "retentionDesign", "subtitles", "emphasisTexts", "soundDesign", "complianceChecks", "ending",
        "materialGaps", "overlayNotice",
      ],
    };
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        ...baseProperties,
        project: {
          type: "object",
          additionalProperties: false,
          properties: {
            platform: { type: "string", enum: ["DOUYIN", "TIKTOK"] },
            productModel: { type: "string" },
            topic: { type: "string" },
            audience: { type: "string" },
            objective: { type: "string" },
            keywordIds: { type: "array", items: { type: "string" } },
            externalVideoIds: { type: "array", items: { type: "string" } },
            routingMode: { type: "string", enum: ["AUTO", "SPECIFIED"] },
            allowFallback: { type: "boolean" },
            scriptCandidates: {
              type: "array",
              minItems: scriptCandidateCount,
              maxItems: scriptCandidateCount,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  hook: { type: "string" },
                  script: { type: "string" },
                  shots: { type: "array", minItems: 3, items: shotSchema },
                  cta: { type: "string" },
                  score: { type: "number", minimum: 0, maximum: 100 },
                  scoreBreakdown: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      productRelevance: { type: "number" },
                      hookStrength: { type: "number" },
                      brandFit: { type: "number" },
                      materialFit: { type: "number" },
                      conversionPotential: { type: "number" },
                    },
                    required: ["productRelevance", "hookStrength", "brandFit", "materialFit", "conversionPotential"],
                  },
                  templateCode: {
                    type: "string",
                    enum: ["PAIN_SOLVE", "GIFT_EMOTION", "CONTRARIAN", "FAQ", "REVIEW", "COMPARISON", "UGC", "VISUAL_AD"],
                  },
                  missingAssets: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        moduleType: { type: "string" },
                        description: { type: "string" },
                        reason: { type: "string" },
                        alternative: { type: "string" },
                      },
                      required: ["moduleType", "description", "reason", "alternative"],
                    },
                  },
                  selected: { type: "boolean" },
                  scriptPackage: scriptPackageSchema,
                },
                required: [
                  "title", "hook", "script", "shots", "cta", "score", "scoreBreakdown",
                  "templateCode", "missingAssets", "selected", "scriptPackage",
                ],
              },
            },
          },
          required: [
            "platform", "productModel", "topic", "audience", "objective", "keywordIds",
            "externalVideoIds", "routingMode", "allowFallback", "scriptCandidates",
          ],
        },
      },
      required: ["summary", "outputFiles", "project"],
    };
  }
  if (type === "ARTICLE") {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        ...baseProperties,
        article: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            topic: { type: "string" },
            audience: { type: "string" },
            objective: { type: "string" },
            hook: { type: "string" },
            body: { type: "string" },
            cta: { type: "string" },
            score: { type: "number" },
            scoreBreakdown: {
              type: "object",
              additionalProperties: false,
              properties: {
                productRelevance: { type: "number" },
                demandStrength: { type: "number" },
                contentValue: { type: "number" },
                complianceConfidence: { type: "number" },
              },
              required: ["productRelevance", "demandStrength", "contentValue", "complianceConfidence"],
            },
            outline: { type: "array", items: { type: "string" } },
            evidenceIds: { type: "array", items: { type: "string" } },
            riskReasons: { type: "array", items: { type: "string" } },
            keywords: { type: "array", items: { type: "string" } },
            variants: {
              type: "object",
              additionalProperties: false,
              properties: {
                WECHAT_OFFICIAL: { type: "string" },
                XIAOHONGSHU: { type: "string" },
                WECOM: { type: "string" },
              },
              required: ["WECHAT_OFFICIAL", "XIAOHONGSHU", "WECOM"],
            },
          },
          required: [
            "title", "topic", "audience", "objective", "hook", "body", "cta", "score",
            "scoreBreakdown", "outline", "evidenceIds", "riskReasons", "keywords", "variants",
          ],
        },
      },
      required: ["summary", "outputFiles", "article"],
    };
  }
  if (type === "IMAGE") {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        ...baseProperties,
        imageBrief: {
          type: "object",
          additionalProperties: false,
          properties: {
            prompt: { type: "string" },
            negativePrompt: { type: "string" },
            ratio: { type: "string" },
            modelRequirement: { type: "string" },
          },
          required: ["prompt", "negativePrompt", "ratio", "modelRequirement"],
        },
        ...(imagePostProject ? {
          imagePost: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              publishCopy: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              groups: { type: "array", items: { type: "object", additionalProperties: false, properties: { groupKey: { type: "string" }, title: { type: "string" }, publishCopy: { type: "string" }, tags: { type: "array", items: { type: "string" } }, pages: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, properties: { pageNo: { type: "number" }, title: { type: "string" }, copy: { type: "string" }, outputFile: { type: "string" } }, required: ["pageNo", "title", "copy", "outputFile"] } } }, required: ["groupKey", "title", "publishCopy", "tags", "pages"] } },
              pages: {
                type: "array",
                minItems: 1,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    pageNo: { type: "number" },
                    title: { type: "string" },
                    copy: { type: "string" },
                    outputFile: { type: "string" },
                  },
                  required: ["pageNo", "title", "copy", "outputFile"],
                },
              },
            },
            required: ["title", "publishCopy", "tags", "pages"],
          },
        } : {}),
      },
      required: imagePostProject
        ? ["summary", "outputFiles", "imageBrief", "imagePost"]
        : ["summary", "outputFiles", "imageBrief"],
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ...baseProperties,
      sections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            evidenceIds: { type: "array", items: { type: "string" } },
          },
          required: ["title", "summary", "evidenceIds"],
        },
      },
      metrics: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            value: { type: "string" },
            unit: { type: "string" },
            source: { type: "string" },
          },
          required: ["name", "value", "unit", "source"],
        },
      },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
            evidence: { type: "string" },
            reason: { type: "string" },
            impact: { type: "string" },
            inference: { type: "boolean" },
          },
          required: ["title", "severity", "evidence", "reason", "impact", "inference"],
        },
      },
      actions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
            ownerRole: { type: "string" },
            dueInHours: { type: "number" },
            evidenceRequired: { type: "string" },
          },
          required: ["title", "priority", "ownerRole", "dueInHours", "evidenceRequired"],
        },
      },
    },
    required: ["summary", "outputFiles", "sections", "metrics", "findings", "actions"],
  };
}

function prompt(taskPackage: JsonRecord, detectedSkill: DetectedSkill) {
  const task = record(taskPackage.task);
  const execution = record(taskPackage.execution);
  const type = String(task.type || "");
  const executionMode = String(execution.mode || "");
  const taskInput = record(task.input);
  const isCodexDirectFullVideo = type === "VIDEO"
    && executionMode === "FULL_VIDEO"
    && taskInput.codexDirectFullVideo === true;
  const isReferenceDirectFullVideo = type === "VIDEO"
    && executionMode === "FULL_VIDEO"
    && taskInput.referenceDirectFullVideo === true;
  if (isImagePostProjectTask(taskPackage)) {
    const finalEmployeePrompt = String(
      taskInput.projectPrompt
      || taskInput.finalEmployeePrompt
      || taskInput.prompt
      || task.description
      || task.title
      || "",
    ).trim();
    if (!finalEmployeePrompt) {
      throw new Error("图文项目缺少员工确认后的制作要求，不能用默认内容替代提交给图文制作 Skill。");
    }
    return [
      "You are the SaiDian image-post project executor.",
      `Read and execute the dispatcher Skill first: ${detectedSkill.skillPath}`,
      `The dispatcher must automatically invoke the downstream image-post Skill: ${detectedSkill.downstreamSkillPath || "saidian-douyin-image-posts"}.`,
      "This is an IMAGE_PROJECT / IMAGE_POST task. Do not use the generic $imagegen-only route.",
      "Use the portable SaiDian library as the first source: F:\\赛电品牌素材库\\图片素材 for product images, F:\\赛电品牌素材库\\产品规格书 for product facts, and F:\\赛电品牌素材库\\图文制作资源\\竞品产品图 only when the employee explicitly requested a comparison.",
      "Never move, rename, overwrite, or delete source material. Do not show internal model codes unless the employee's final instruction explicitly requires them.",
      "The following is the final employee-edited requirement. It is the only creative requirement to execute. Do not append restrictions or empty default fields that the employee did not provide.",
      finalEmployeePrompt,
      "Create the requested image-post pages and return the real output files in outputFiles. Also return imageBrief as a concise execution summary so the current task center can register the result.",
      "Return imagePost with title, publishCopy, tags and pages. Every imagePost.pages entry must name its matching generated image in outputFile; use exactly the same relative file path as outputFiles. Do not return a page without its generated image file.",
      "For a batch image project, also return imagePost.groups: one complete result per groupKey in batchImageDirect.groups. Never put type, page number, group number, or task identifiers in any final image or public copy.",
      "The output must comply with the output schema. Every output file must exist inside the current task workspace.",
      `Task package JSON:\n${JSON.stringify(taskPackage, null, 2)}`,
    ].join("\n\n");
  }
  if (isReferenceDirectFullVideo) {
    const directInput = record(taskInput.referenceDirectInput);
    const revision = record(directInput.revision || taskInput.revision);
    const isRevision = Boolean(String(revision.reviewNote || "").trim());
    return [
      "REFERENCE_DIRECT_MODE_CONTRACT: This is a reference-video direct-render job using the complete local video-editing-from-media-library Skill.",
      `Read and execute the dispatcher Skill first: ${detectedSkill.skillPath}`,
      `Then read and execute the full local editing Skill: ${detectedSkill.downstreamSkillPath || "G:\\codex\\xcodeplace\\CodexHome\\skills\\video-editing-from-media-library\\SKILL.md"}. Never use the share edition on this machine.`,
      "The dispatcher only routes this job. The full editing Skill must independently inspect the reference, learn/search the complete local library, select footage, edit, package, validate and render.",
      "REFERENCE_AUDIO_AUTHORIZATION: Submission of the reference URL is the employee's confirmation that its complete original audio may be reused for this task. Download and preserve the original audio, including BGM, ambience and sound effects. Do not request a licence file, do not return an unknown-rights warning, do not replace it with local BGM, and do not re-voice it unless the employee prompt explicitly requests that change.",
      "Do not copy the reference video's pictures, people, brands or footage. Rebuild the visuals with exact-product real footage selected from the local media library while following the reference audio, beat map, section structure, pacing, transitions and packaging rhythm.",
      "Do not stop for employee approval of an internal script, shot plan, footage selection, production plan or packaging. Create and validate all mandatory Skill artifacts internally, repair correctable issues, render, and return only the final VIDEO_MASTER for employee review.",
      "The empty assets and snapshots arrays are intentional. Never request system materialBindings and never treat them as a whitelist.",
      "Create and validate the full evidence set required by the editing Skill, including production-plan, hard-requirements, shot-plan, composition, packaging, audio, transition and HyperFrames render evidence. A plain FFmpeg concat is not an acceptable finished video.",
      "OFFLINE_HYPERFRAMES_RUNTIME: The runner has preinstalled the official GSAP 3.14.2 file at .runtime/hyperframes/gsap-3.14.2.min.js in the task workspace. Copy that exact official file into the HyperFrames project or reference it with the correct project-relative path before validate/render. Do not use npm/CDN, and do not create a shim or substitute runtime.",
      ...(isRevision ? [
        "REFERENCE_REVISION_CONTRACT: Reuse the original reference video, its original audio, the previous finished video and the previous editing structure. Apply only the employee's return reason, then render a new version.",
      ] : []),
      JSON.stringify({
        taskId: String(task.id || ""),
        productModel: String(directInput.productModel || task.productModel || ""),
        referenceVideoUrl: String(directInput.referenceVideoUrl || ""),
        employeePrompt: String(directInput.prompt || ""),
        ...(isRevision ? { revision } : {}),
      }, null, 2),
      "If the reference URL or its audio cannot be accessed, return the exact technical cause without fabricating completion. Otherwise continue through final render.",
      "Return exactly one real 1080x1920 MP4 in outputFiles with kind=VIDEO_MASTER and delivery={taskMode:REFERENCE_DIRECT_FULL_VIDEO, finalReviewOnly:true}.",
      "Every output file must exist inside the current task workspace and the result must match the output schema.",
    ].join("\n\n");
  }
  if (isCodexDirectFullVideo) {
    const directInput = record(taskInput.codexDirectInput);
    const creativeMode = String(directInput.creativeMode || "FULL_VIDEO").toUpperCase();
    const revision = record(directInput.revision || taskInput.revision);
    const isRevision = Boolean(String(revision.reviewNote || "").trim());
    const directModeContract = [
      "DIRECT_MODE_CONTRACT: This is a local-library direct-render job.",
      "The empty assets, snapshots, and materialBindings arrays are intentional. They do not make this a system AI task and must never cause a system-material whitelist request.",
      "Use saidian-ai-task-dispatcher and then the full local video-editing-from-media-library Skill. Never use the share edition as a quality shortcut.",
      "MANDATORY_SKILL_PATH: G:\\codex\\xcodeplace\\CodexHome\\skills\\video-editing-from-media-library\\SKILL.md. Read and execute this exact full local Skill. The dispatcher only routes the task and the share edition is forbidden for this local direct render.",
      "Read the active local-library configuration and the verified-editing-videos-by-product manifest. Do not download, request, or return any system task assets.",
      "The full editing Skill must independently learn, search and select VIDEO footage from the complete local library. The dispatcher must not preselect footage, create a candidate whitelist, or require system materialBindings. Use exact-product verified local VIDEO entries and never use another product model, unverified media, images, audio, packaging, cover, sticker, transition or template resources as primary footage.",
      "DIRECT_CONTINUOUS_EXECUTION: Do not stop for user approval of the script, shot plan, material selection, production plan, packaging, or any other intermediate artifact. Create and validate those artifacts internally, repair any correctable issue, continue directly through rendering, and return only the final VIDEO_MASTER for user review.",
      "If the local library is not initialized or not ready, fail explicitly with the missing local configuration or index. Do not return a system-task WAITING_INPUT result.",
      "The employee UI only receives the final review node, but internal script, shot plan, material coverage, composition, packaging, audio and delivery QA steps remain mandatory.",
      "EXECUTION_FIRST_CONTRACT: Follow every editing requirement while producing the video; post-render validation is only the final safety net. Before creating or modifying the final HyperFrames composition or starting any render, write production-plan.json and pass the full Skill script validate_direct_production_plan.py. Save PRODUCTION_PLAN_OK to logs/production-plan-validator.log.",
      "Lock exact admitted footage for every spoken beat, a semantically justified transition per cut, clean one/two-line captions without a large dark rectangle, real packaging-library graphic nodes, actual voice identity, audio policy, and visual semantic/compliance checks. Fix the plan before editing if preflight blocks it.",
      "For a 15-30 second voice video use at least three real sticker/icon/motion-graphic/product-callout nodes; text callouts alone are insufficient. With at least three cuts, do not use one transition type everywhere. Base every cut on adjacent motion, composition, scale, direction and color.",
      "For the default first voice-video version, do not add BGM unless the user explicitly requested it. Record the actual voiceName or voiceId. Never use unrelated numeric health-result or comparison footage as generic product visuals.",
      "Packaging is mandatory. Use F:\\包装资源包 and its learned packaging index for BGM, SFX, stickers, typography and effects; packaging resources may never be used as primary footage.",
      "Create requirements-check.json, shot-plan.json, composition-qc.json, packaging-qc.json, audio-qc.json, transition-qc.json and render-evidence.json in the task workspace with real evidence. All three official Python validators must actually pass. Return exactly one real 1080x1920 MP4 VIDEO_MASTER and delivery={taskMode:CODEX_DIRECT_FULL_VIDEO, finalReviewOnly:true}.",
      `The configured real Python executable is ${pythonExecutable}. Use this exact executable for every Python validator; do not rely on the Windows Store python alias or conclude that Python is missing before testing this path.`,
      "Use the exact schemas required by the official validators: requirements-check.json must use a requirements array; shot-plan.json must use the full Skill shot-plan schema including a visual_reference object; composition-qc.json must use a non-empty videos array. Run the validators instead of inventing substitute schemas.",
      "render-evidence.json must identify the HyperFrames project and contain successful doctor, lint, validate, inspect and render command records with non-empty log files. A plain FFmpeg concat is not the full editing Skill and must not be delivered.",
      "RERENDER_GATE: After the first real MP4 is rendered, freeze the composition and run post-render QA. Start another render only when a QA record explicitly has passed=false and records the failed check ID, affected time range, corrective action, new version, and renderReason referencing that check. If QA passed, preserve the first master and proceed directly to evidence packaging and return; never rerender merely to improve logs, rename output, localize dependencies, or make an unrequested subjective refinement.",
      "Never create, inject, or substitute an incomplete GSAP shim, proxy timeline, or ad-hoc animation runtime. Use the installed validated HyperFrames animation dependency. Every render must record renderReason=INITIAL_RENDER or the exact failed QA ID; without it, a second render is forbidden.",
      "OFFLINE_HYPERFRAMES_RUNTIME: The runner has preinstalled the official GSAP 3.14.2 file at .runtime/hyperframes/gsap-3.14.2.min.js in the task workspace. Copy that exact official file into the HyperFrames project or reference it with the correct project-relative path before validate/render. Do not use npm/CDN, and do not create a shim or substitute runtime.",
      "transition-qc.json must contain cuts with one item for every non-first shot. Each cut requires beforeSeconds>=0.6, afterSeconds>=0.6, a non-empty observation, the actual transition name and passed=true only after viewing the rendered cut.",
      ...(creativeMode === "NO_VOICE_VIDEO" ? [
        "NO_VOICE_VIDEO_CONTRACT: Fully execute references/no-voice-beat-editing.md. Choose a real BGM from F:\\包装资源包 first, create a real beat map, and edit visuals against its sections and accent beats. The user has approved every BGM in this local library for system video tasks: license_unknown is metadata only and must never cause PACKAGING_BGM_LICENSE_GAP, WAITING_INPUT, or task failure.",
        "Do not synthesize sine waves, beeps or placeholder rhythm audio. For every cut, preview at least 0.6 seconds on both sides and record the observed motion, composition, scale, direction, color and chosen transition in transition-qc.json.",
        "audio-qc.json must contain bgm.sourcePath pointing to the real local BGM and beatMap.downbeats as a non-empty array.",
      ] : []),
      ...(isRevision ? [
        "REVISION_CONTRACT: This is a targeted revision, not a new creative job. Reuse the previous project structure, footage choices, pacing, audio, and output specification wherever they do not conflict with the return reason.",
        "Locate and reuse the previous task's local final MP4 when it is available. Make only the requested corrections. Do not silently replace the entire concept, product, or video structure.",
        "Return a new VIDEO_MASTER together with a short modification summary that explicitly maps the return reason to the completed changes.",
      ] : []),
    ];
    return [
      ...directModeContract,
      "你是赛电 Codex 直出视频执行器。",
      `必须先完整读取并严格执行 ${detectedSkill.skillPath}（saidian-ai-task-dispatcher），再完整读取并执行 ${detectedSkill.downstreamSkillPath || "video-editing-from-media-library"}（本机完整版剪辑 Skill）。`,
      "这是本地素材库直出模式：不要使用系统任务包中的 assets、snapshots、materialBindings，也不要下载或请求系统素材。",
      "只使用以下产品型号、用户 AI 提示词和严格素材准入规则，按 Skill 的本地素材库学习、检索、合规、剪辑、质检和交付规则完成任务。",
      JSON.stringify({
        taskId: String(task.id || ""),
        productModel: String(directInput.productModel || task.productModel || ""),
        aiPrompt: String(directInput.prompt || ""),
        creativeMode,
        ...(isRevision ? { revision } : {}),
      }, null, 2),
      "先依据当前型号真实可用 VIDEO 素材调整内部脚本和镜头方案。非核心句缺少直接画面时，自动改写为现有真实素材能够证明的表达，并重新运行素材覆盖、事实和合规检查；不得跨型号替代、不得使用包装资源充当主画面，也不得伪造功能或素材。只有核心功能确实没有真实画面、素材盘完全不可用或必要运行环境无法恢复时，才返回明确硬阻塞。校验、包装、转场、字幕、配音和工程问题必须内部返工，不能直接标记任务失败。",
      "从脚本、镜头、素材选择到剪辑成片都在本地完成；中间产物必须真实落盘并通过校验，但不回传为员工审核节点，员工只审核最终成片。",
      "成功时只输出一个真实存在的 1080x1920 MP4，并在 outputFiles 中登记为 VIDEO_MASTER。失败时返回 FAILED 与明确的阻塞原因，禁止伪造完成。",
      "输出必须符合任务 output schema，outputFiles 只能指向当前任务工作区内真实存在的文件。",
    ].join("\n\n");
  }
  if (type === "VIDEO" && executionMode === "TOPIC_CARD_BATCH") {
    const snapshots = Array.isArray(taskPackage.snapshots) ? taskPackage.snapshots.map(record) : [];
    const payload = record(snapshots[0]?.payload);
    const requirements = record(payload.requirements);
    const cardCount = Math.max(1, Math.min(30, Number(requirements.exactCount || 10)));
    return [
      "你是赛电视频工厂的视频选题分析执行器。",
      ...(detectedSkill.key === "saydian-douyin-viral-video-generator"
        ? [
          "本任务属于独立的抖音爆款生成模块，必须直接使用 $saydian-douyin-viral-video-generator。",
          `必须先完整读取并严格执行：${detectedSkill.skillPath}`,
          "不得调用 $saidian-ai-task-dispatcher 或 video-editing-from-media-library-share。",
        ]
        : []),
      `必须生成恰好${cardCount}张${String(payload.platform || task.platform || "")}视频选题卡，只生成卡片，不创建脚本、视频文件或付费模型任务。`,
      "每张卡必须使用输入快照中已审核产品，引用真实keywordIds；没有产品事实或关键词依据的内容不能进入结果。",
      "用户评论只用于提炼与当前产品和关键词明确相关的真实问题、顾虑和用语；不得引用用户名，不相关评论不得进入选题。",
      "外部爆款只允许提取Hook模式、节奏、镜头结构和CTA模式，不能复制竞品品牌名、价格、产品承诺、标题或商业素材。",
      "按平台、产品、关键词簇、人群、痛点和主配方主动去重；合并大小写、空格、连字符和明显错别字。",
      "机会分必须严格使用输入中的九项权重；素材覆盖率只计算manifest内已审核、启用且可商用素材。",
      "每张卡给出3个不同Hook、主配方和备用配方；不能确认的事实放入missingFacts，禁止补写。",
      "outputFiles必须为空数组。输出必须符合output schema。",
      `任务包JSON：\n${JSON.stringify(taskPackage, null, 2)}`,
    ].join("\n\n");
  }
  const videoInstruction = executionMode === "SCRIPT_ONLY"
    ? "只生成1套最终完整脚本，禁止先生成多套候选再筛选。该唯一脚本的selected必须为true；包含标题、Hook、逐句正文、CTA、结构化分镜和逐镜头素材建议。不得为了比较方案增加候选、占位稿或备用稿。只提取外部爆款的Hook、节奏和结构，不复用外部商业镜头。"
    : "生成恰好3套脚本候选并选择1套主方案。每套包含标题、Hook、正文、CTA、评分、评分依据、结构化分镜和逐镜头素材建议。只提取外部爆款的Hook、节奏和结构，不复用外部商业镜头。";
  const instructions: Record<string, string> = {
    VIDEO: videoInstruction,
    IMAGE: "本任务必须调用 $imagegen Skill，使用Codex内置图片生成能力完成图片成品并写入outputFiles。不得调用或要求配置第三方图片模型；生成前读取产品图片和任务快照，成品保存到当前任务工作区。",
    ARTICLE: "本任务必须调用 $build-health-brand-trust-content Skill，生成公众号、小红书和企业微信版本。每段简短，产品事实只能来自输入快照，不得调用或要求配置第三方文本模型。",
    STORE_ANALYSIS: "先依据确定性指标和异常数据，再解释原因、影响和可执行动作。证据不足的判断标记为推断。",
    COMPETITOR_ANALYSIS: "分析竞品商品、价格、内容和关键词变化，输出机会及待确认行动，禁止虚构竞品数据。",
    LIVE_ANALYSIS: "完成直播前方案或直播后复盘，输出切片建议、话术调整和下一场行动。",
  };
  const isDedicatedDouyinSkill = detectedSkill.key === "saydian-douyin-viral-video-generator";
  const skillInstruction = detectedSkill.key === "legacy-codex"
    ? ""
    : [
      `本任务由统一 Skill Registry 选择 $${detectedSkill.name}。`,
      `必须先完整读取并严格执行：${detectedSkill.skillPath}`,
      `Skill版本：${detectedSkill.version}。${isDedicatedDouyinSkill
        ? "不得改用其他 Skill；外部视觉模型只按任务包 execution.allowExternalGeneration 和 videoModelRouting 执行。"
        : "不得改用其他 Skill 或第三方模型。"}`,
    ].join("\n");
  const requiredVideoSkill = type === "VIDEO" && ["FULL_VIDEO", "SCRIPT_ONLY", "SIMILAR_VIDEO", "NO_VOICE_VIDEO", "COVER_TITLE"].includes(executionMode)
    ? isDedicatedDouyinSkill
      ? [
        "本任务直接使用 $saydian-douyin-viral-video-generator 完成，不得调用 $saidian-ai-task-dispatcher 或 video-editing-from-media-library-share。",
        `系统任务素材模式已启用；health_content_allowed=${execution.healthContentAllowed !== false ? "true" : "false"}。`,
        "任务包中的assets与materialBindings是本次任务的唯一素材白名单。",
        "模型选择以execution.videoModelRouting为准：真实素材和本地合成优先；需要外部补镜头时由Seedance 2.0主生成家庭叙事、产品氛围和多镜头，Kling增强人物、手势和运动动作；未配置时返回未配置。",
        executionMode === "FULL_VIDEO"
          ? "最终必须输出专用Skill质检通过的1080×1920、30fps MP4，并在outputFiles中登记为VIDEO_MASTER。"
          : "本次只执行脚本和分镜阶段，只允许返回1套selected=true的最终完整脚本；outputFiles不得包含VIDEO_MASTER。",
      ].join("\n")
      : [
        `本任务必须先使用 $saidian-ai-task-dispatcher 执行系统任务调度，再由其调用 $${detectedSkill.downstreamSkillName || "video-editing-from-media-library"} 完成当前视频阶段。`,
        `下游视频Skill路径：${detectedSkill.downstreamSkillPath || "未配置"}。必须完整读取并遵循其素材只读、镜头连续性、内容禁止库、质检和交付规则。`,
        `系统任务素材模式已启用；health_content_allowed=${execution.healthContentAllowed !== false ? "true" : "false"}。`,
        executionMode === "SCRIPT_ONLY"
          ? "SCRIPT_ONLY由下游剪辑 Skill 及其脚本子 Skill 检索完整本机素材索引，并通过system-asset-map.json把实际选中素材反查为系统ID；调度 Skill 不检索、不选材，不得把输入限制为任务包前30条。"
          : "标准 FULL_VIDEO 及其他绑定型成片阶段由调度 Skill 原样转交用户已确认的完整materialBindings，再由下游剪辑 Skill 执行；调度 Skill 禁止临时选材、换材或截断绑定列表。",
        "主时间线只能使用真实视频素材。图片、详情图和产品图只能作为绑定underlying_shot_id的短时辅助层，禁止图片轮播、静态图推拉或无关镜头补时长。",
        "每个功能镜头必须有直接对应画面；任何reshoot缺口都要停止受影响成片渲染，并输出明确补拍清单。",
        executionMode === "COVER_TITLE"
          ? "本次必须由视频剪辑 Skill 调用 $feng-mian-biao-ti 子 Skill；分析系统提供的已审核成片，为每个目标平台生成封面、标题和标题汇总表。每个封面文件须在outputFiles登记，kind=COVER_IMAGE，metadata.platform须对应平台。"
          : ["FULL_VIDEO", "SIMILAR_VIDEO", "NO_VOICE_VIDEO"].includes(executionMode)
            ? "最终必须输出该Skill质检通过的1080×1920、30fps MP4，并在outputFiles中登记为VIDEO_MASTER。"
            : "本次只执行脚本和分镜阶段，只允许返回1套selected=true的最终完整脚本；禁止生成三套候选、比较稿或占位稿。outputFiles不得包含VIDEO_MASTER，也不得调用付费成片能力。",
      ].join("\n")
    : "";
  const videoInstructionPriority = type === "VIDEO"
    ? [
      `视频任务的创作规则优先级固定为：${isDedicatedDouyinSkill ? "抖音爆款生成专用 Skill" : "下游视频 Skill"} 及其 references 的硬性规则 > 已审核产品事实与素材可见事实 > 系统任务包中的创作提示 > 通用默认值。`,
      "系统任务包是型号、功能、素材、审核状态和合规边界的事实来源，但任务要求、项目描述、方向、关键词、Hook 或推荐场景只作为辅助提示词；不得覆盖视频 Skill 的脚本结构、账号口吻、短句节奏、网感、素材证明和合规规则。",
      "禁止机械复述系统要求，禁止把任务包长句直接拼入口播，禁止为了逐项响应系统字段把脚本写成产品说明书或功能菜单。",
      executionMode === "SCRIPT_ONLY"
        ? "单脚本必须保持亲切导购型口吻：有态度或生活处境开头，短句推进，先讲用户利益再讲功能，用具体动作代替“支持、具备、可以”等说明书句式；中段至少一次轻反差或价值发现，结尾使用与本条核心内容相关的自然选择建议。写脚本前必须先检索任务包assets中的已学习素材索引，优先围绕高置信度真实VIDEO素材反向设计口播和镜头；不得先写完脚本再泛化找素材。scriptPackage是系统编辑器的统一数据源，必须完整填写；voiceoverLines与shotRequirements使用相同稳定lineId。每条shotRequirement都必须返回matchedVideoAssetIds和auxiliaryImageAssetIds；有直接对应真实视频时assetStatus必须为COVERED且matchedVideoAssetIds至少包含一个任务包内真实素材ID。默认一条VIDEO素材只能绑定一条口播行；当前任务结果不支持可核验的不同起止片段，严禁用同一assetId重复覆盖多句，缺少不同直接画面时必须标记REWRITABLE或NEED_SHOOT。只有逐项检索后确实没有直接视频证据时才能返回空数组并标记REWRITABLE或NEED_SHOOT，materialGaps也只能包含这些真实缺口。candidate.script只能由voiceoverLines.text按换行拼接，只含干净口播，禁止混入lineId、预计时长、账号说明、素材缺口或健康提示。健康提示只写入scriptPackage.overlayNotice，不写入口播。"
        : "脚本、画面、配音、包装和质检均以视频 Skill 的硬性规则为准；系统提示只能在不冲突时补充方向。",
    ].join("\n")
    : "";
  const videoDispatcherBoundary = type === "VIDEO"
    ? [
      "GLOBAL_DISPATCH_BOUNDARY：saidian-ai-task-dispatcher 在所有视频模式中只负责识别阶段、验证流程状态、原样转交输入、调用下游 Skill、上报进度、上传回传以及幂等恢复。",
      "调度 Skill 禁止写或修改脚本、设计 Hook/镜头/包装、检索或选择素材、决定素材入出点、生成创作候选，且不得把自己的创作结果混入下游输入。",
      "SCRIPT_ONLY 的脚本与逐句选材由下游剪辑 Skill 及其脚本子 Skill 完成；标准 FULL_VIDEO 只把用户已确认的脚本和素材绑定原样交给下游；Codex/参考视频直出由下游剪辑 Skill 自主构思与选材；相似复剪、无口播和封面标题也全部由对应下游 Skill 作创作决定。",
      "任务包中的素材、绑定、索引和成片只构成下游 Skill 的输入或事实边界，不授予调度 Skill 创作或选材权限；未来新增视频模式也继承本边界。",
    ].join("\n")
    : "";
  return [
    "你是赛电总管理后台AI任务中心的Codex执行器。",
    skillInstruction,
    instructions[type] || "按输入快照完成任务。",
    requiredVideoSkill,
    videoDispatcherBoundary,
    videoInstructionPriority,
    "必须以提供的JSON快照为事实边界；缺失数据明确写未配置或缺失，不编造数据、认证、费用和执行结果。",
    "下游视频 Skill 必须优先使用已审核真实素材。VIDEO脚本生成由下游 Skill 按产品、功能、动作、场景和景别检索完整本机素材索引，再围绕命中的真实VIDEO素材写逐句脚本；每个已覆盖镜头必须通过matchedVideoAssetIds或selectedAssetIds回传system-asset-map.json中的具体系统素材ID。调度 Skill 不执行这些创作与选材动作。不得把已存在但未回传ID的素材算作已覆盖，也不得为了写更宽泛的文案而忽略已有素材。只有下游 Skill 检索后确实不存在直接对应视频时才写清missingReason、alternativePlan和missingAssets，不得拿文件顺序代替镜头匹配。",
    `固定回退顺序：${detectedSkill.fallbackOrder.join(" -> ")}。`,
    "输出必须符合output schema。outputFiles只能引用当前任务工作区内真实存在的文件。",
    `任务包JSON：\n${JSON.stringify(taskPackage, null, 2)}`,
  ].join("\n\n");
}

function fileMime(path: string) {
  const extension = path.toLowerCase().split(".").pop();
  return {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    json: "application/json",
    md: "text/markdown",
    txt: "text/plain",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }[extension || ""] || "application/octet-stream";
}

async function api<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${response.status} ${String(body.message || text)}`);
  return body as T;
}

async function checkpoint(taskId: string, stage: string, progress: number, message: string, data: JsonRecord = {}) {
  return api(`/api/v1/ai-tasks/runner/tasks/${taskId}/checkpoint`, {
    method: "POST",
    body: JSON.stringify({ nodeCode, stage, progress, message, data }),
  });
}

async function taskPackage(taskId: string) {
  return api<JsonRecord>(`/api/v1/ai-tasks/runner/tasks/${taskId}/package?nodeCode=${encodeURIComponent(nodeCode)}`);
}

async function syncSystemMaterialIndex(force = false) {
  const now = Date.now();
  if (!force && now - lastMaterialSyncAt < materialSyncMs) return;
  await mkdir(systemMaterialAssetsRoot, { recursive: true });
  const state = record(await readJson(systemMaterialStatePath));
  const storedIndex = record(await readJson(systemMaterialIndexPath));
  const indexedAssets = record(storedIndex.assets);
  let cursor = String(state.cursor || "");
  let revision = String(state.revision || "");
  let hasMore = true;
  let changed = 0;
  while (hasMore) {
    const query = new URLSearchParams({ nodeCode });
    if (cursor) query.set("cursor", cursor);
    const page = await api<JsonRecord>(`/api/v1/ai-tasks/runner/material-index?${query.toString()}`);
    const changes = Array.isArray(page.changes) ? page.changes.map(record) : [];
    for (const change of changes) {
      const id = String(change.id || "");
      if (!id) continue;
      const { downloadUrl: _downloadUrl, ...metadata } = change;
      indexedAssets[id] = metadata;
      changed += 1;
    }
    cursor = String(page.cursor || cursor);
    revision = String(page.revision || revision);
    hasMore = page.hasMore === true && changes.length > 0;
  }
  await writeJsonAtomic(systemMaterialIndexPath, {
    source: "SYSTEM_ASSET_LIBRARY",
    transport: "ALIYUN_OSS",
    revision,
    syncedAt: new Date().toISOString(),
    assets: indexedAssets,
  });
  await writeJsonAtomic(systemMaterialStatePath, {
    cursor,
    revision,
    changed,
    syncedAt: new Date().toISOString(),
  });
  lastMaterialSyncAt = now;
}

function syncSystemMaterialIndexInBackground(force = false) {
  if (materialSyncInFlight) return;
  materialSyncInFlight = syncSystemMaterialIndex(force)
    .catch((error) => {
      process.stderr.write(`${new Date().toISOString()} system-material-index ${error instanceof Error ? error.message : String(error)}\n`);
    })
    .finally(() => {
      materialSyncInFlight = undefined;
    });
}

async function verifyVideoSkillRuntime(taskPackageValue: JsonRecord, detectedSkill: DetectedSkill) {
  const task = record(taskPackageValue.task);
  const execution = record(taskPackageValue.execution);
  if (String(task.type || "") !== "VIDEO"
    || !["FULL_VIDEO", "SCRIPT_ONLY", "SIMILAR_VIDEO", "NO_VOICE_VIDEO", "COVER_TITLE"].includes(String(execution.mode || ""))
    || !["saidian-ai-task-dispatcher", "saydian-douyin-viral-video-generator", "video-editing-from-media-library-share"].includes(detectedSkill.key)) return;
  if (detectedSkill.key === "saydian-douyin-viral-video-generator") return;
  const skillPath = detectedSkill.key === "video-editing-from-media-library-share"
    ? String(detectedSkill.skillPath || "")
    : String(detectedSkill.downstreamSkillPath || "");
  if (!skillPath) throw new Error("视频剪辑 Skill 未配置");
  const downstream = await stat(skillPath);

  // A Codex direct-output task deliberately contains no system assets. It can only
  // run after the shared local media-library skill has completed its onboarding.
  if (detectedSkill.key === "video-editing-from-media-library-share" && isCodexDirectFullVideoTask(taskPackageValue)) {
    const localAppData = String(process.env.LOCALAPPDATA || process.env.APPDATA || "").trim();
    const activeConfigPath = join(
      localAppData || workRoot,
      localAppData ? "Codex" : ".codex",
      "video-editing-from-media-library-share",
      "active-config.json",
    );
    const activeConfig = await readJson<JsonRecord>(activeConfigPath);
    const runtimeConfigPath = String(activeConfig?.config_path || "").trim();
    if (!runtimeConfigPath) {
      throw new Error("Codex 直出任务未启动：本机素材库尚未完成初始化（缺少活动配置）。请先完成素材库、包装资源、临时工作区、成片输出目录和索引目录初始化，再重新提交任务。");
    }
    const runtimeConfig = await readJson<JsonRecord>(runtimeConfigPath);
    if (!runtimeConfig || String(runtimeConfig.initialization_status || "").toLowerCase() !== "ready") {
      throw new Error("Codex 直出任务未启动：本机素材库配置尚未就绪。请先完成本机剪辑 Skill 初始化，再重新提交任务。");
    }
    for (const key of ["library_root", "packaging_root", "workspace_root", "output_root", "config_root"]) {
      const path = String(runtimeConfig[key] || "").trim();
      if (!path) throw new Error(`Codex 直出任务未启动：本机素材库配置缺少 ${key}。`);
      try {
        await stat(path);
      } catch {
        throw new Error(`Codex 直出任务未启动：本机素材库路径不可访问（${key}）。`);
      }
    }
    for (const key of ["material_index", "packaging_index"]) {
      const path = String(runtimeConfig[key] || "").trim();
      if (!path) throw new Error(`Codex 直出任务未启动：本机素材库配置缺少 ${key}。`);
      try {
        const index = await stat(path);
        if (!index.isFile()) throw new Error("not-file");
      } catch {
        throw new Error(`Codex 直出任务未启动：本机素材库索引不可用（${key}）。`);
      }
    }
  }
  if (!downstream.isFile()) throw new Error("本地视频剪辑Skill不可用");
}

async function downloadInputs(taskPackageValue: JsonRecord, workspace: string): Promise<JsonRecord> {
  const inputsDir = join(workspace, "inputs");
  await mkdir(inputsDir, { recursive: true });
  if (isCodexDirectFullVideoTask(taskPackageValue)) {
    const packaged: JsonRecord = {
      ...taskPackageValue,
      assets: [],
      snapshots: [],
      localMaterialLibrary: {
        root: localMediaLibraryRoot,
        systemAssetMapPath: localSystemMaterialMapPath,
        primaryForEditing: true,
        directOutputOnly: true,
        identityRule: "local media library only; do not consume system task assets",
      },
    };
    await writeJsonAtomic(join(workspace, "snapshot.json"), []);
    await writeJsonAtomic(join(workspace, "manifest.json"), []);
    return packaged;
  }
  const assets = Array.isArray(taskPackageValue.assets) ? taskPackageValue.assets.map(record) : [];
  const localMaterialMap = (await readJson<JsonRecord>(localSystemMaterialMapPath).catch(() => undefined)) || {};
  const executionMode = String(record(taskPackageValue.execution).mode || "").toUpperCase();
  if (executionMode === "SCRIPT_ONLY") {
    const indexedAssets = assets.flatMap((asset) => {
      const id = String(asset.id || "");
      const mapped = record(localMaterialMap[id]);
      const localPath = String(mapped.localPath || "");
      if (!id || mapped.active !== true || !localPath) return [];
      return [{
        ...asset,
        downloadUrl: undefined,
        localPath,
        contentSha256: String(mapped.contentSha256 || mapped.sha256 || asset.sha256 || ""),
      }];
    });
    const packaged = {
      ...taskPackageValue,
      assets: indexedAssets,
      localMaterialLibrary: {
        root: localMediaLibraryRoot,
        systemAssetMapPath: localSystemMaterialMapPath,
        primaryForEditing: true,
        fullIndexSearchRequired: true,
        identityRule: "systemAssetId + contentSha256",
      },
    };
    await writeJsonAtomic(join(workspace, "snapshot.json"), taskPackageValue.snapshots || []);
    await writeJsonAtomic(join(workspace, "manifest.json"), indexedAssets);
    return packaged;
  }
  const downloaded: JsonRecord[] = [];
  const prioritizedAssets = [...assets].sort((left, right) => {
    const priority = (asset: JsonRecord) => String(asset.kind || "").toUpperCase() === "VIDEO" ? 0 : 1;
    return priority(left) - priority(right);
  });
  for (const asset of prioritizedAssets) {
    const id = String(asset.id || `asset-${downloaded.length + 1}`);
    const extension = String(asset.extension || extname(String(asset.displayName || "")) || (String(asset.kind) === "IMAGE" ? ".jpg" : ".mp4"));
    const target = join(inputsDir, `${safeName(id)}${extension.startsWith(".") ? extension : `.${extension}`}`);
    const expectedHash = String(asset.sha256 || "").toLowerCase();
    const cacheDir = join(systemMaterialAssetsRoot, safeName(id));
    const cacheTarget = join(cacheDir, `${safeName(expectedHash || "current")}${extension.startsWith(".") ? extension : `.${extension}`}`);
    let buffer: Buffer | undefined;
    const downloadUrl = String(asset.downloadUrl || "");
    const localPath = String(asset.localPath || "");
    const mapped = record(localMaterialMap[id]);
    const mappedLocalPath = mapped.active === true && String(mapped.sha256 || "").toLowerCase() === expectedHash
      ? String(mapped.localPath || "")
      : "";
    const mappedContentHash = String(mapped.contentSha256 || mapped.sha256 || "").toLowerCase();
    try {
      const existing = await readFile(target);
      if (expectedHash && verifySha256(existing, expectedHash)) buffer = existing;
    } catch {
      buffer = undefined;
    }
    if (!buffer) {
      if (mappedLocalPath) {
        try {
          const local = await readFile(mappedLocalPath);
          if (!mappedContentHash || verifySha256(local, mappedContentHash)) buffer = local;
        } catch {
          buffer = undefined;
        }
      }
    }
    if (!buffer) {
      try {
        const cached = await readFile(cacheTarget);
        if (!expectedHash || verifySha256(cached, expectedHash)) buffer = cached;
      } catch {
        buffer = undefined;
      }
    }
    if (!buffer && downloadUrl) {
      const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok) continue;
      buffer = Buffer.from(await response.arrayBuffer());
    } else if (!buffer && localPath) {
      try {
        buffer = await readFile(localPath);
      } catch {
        buffer = undefined;
      }
    }
    if (!buffer) continue;
    const actualHash = sha256(buffer);
    if (!verifySha256(buffer, mappedLocalPath ? mappedContentHash : expectedHash)) throw new Error(`素材校验失败：${id}`);
    await mkdir(cacheDir, { recursive: true });
    try {
      const cached = await readFile(cacheTarget);
      if (sha256(cached) !== actualHash) await writeFile(cacheTarget, buffer);
    } catch {
      await writeFile(cacheTarget, buffer);
    }
    try {
      const existing = await readFile(target);
      if (sha256(existing) !== actualHash) await writeFile(target, buffer);
    } catch {
      await writeFile(target, buffer);
    }
    downloaded.push({
      ...asset,
      downloadUrl: undefined,
      localPath: undefined,
      workspacePath: relative(workspace, target).replaceAll("\\", "/"),
      sha256: actualHash,
    });
  }
  const packaged: JsonRecord = {
    ...taskPackageValue,
    assets: downloaded,
    localMaterialLibrary: {
      root: localMediaLibraryRoot,
      systemAssetMapPath: localSystemMaterialMapPath,
      primaryForEditing: true,
      identityRule: "systemAssetId + sha256",
    },
  };
  await writeJsonAtomic(join(workspace, "snapshot.json"), taskPackageValue.snapshots || []);
  await writeJsonAtomic(join(workspace, "manifest.json"), downloaded);
  return packaged;
}

function srtTime(seconds: number) {
  const millis = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(millis / 3_600_000);
  const minutes = Math.floor((millis % 3_600_000) / 60_000);
  const secs = Math.floor((millis % 60_000) / 1000);
  const ms = millis % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function ffmpegFilterPath(path: string) {
  return path.replaceAll("\\", "/").replace(/^([A-Za-z]):/u, "$1\\:").replaceAll("'", "\\'");
}

async function renderLocalVideo(result: JsonRecord, taskPackageValue: JsonRecord, workspace: string) {
  const task = record(taskPackageValue.task);
  const execution = record(taskPackageValue.execution);
  if (String(task.type || "") !== "VIDEO" || String(execution.mode || "") !== "FULL_VIDEO") return result;
  // Direct-output jobs are completed by the designated local Skill. Never fall
  // back to the legacy renderer or manufacture a placeholder output for them.
  if (isCodexDirectFullVideoTask(taskPackageValue)) return result;
  const existingFiles = Array.isArray(result.outputFiles) ? result.outputFiles.map(record) : [];
  const existingMaster = existingFiles.find((item) => String(item.kind || "") === "VIDEO_MASTER");
  if (existingMaster) {
    const masterPath = resolve(workspace, String(existingMaster.path || ""));
    const masterRelativePath = relative(workspace, masterPath);
    if (existingMaster.path && !masterRelativePath.startsWith("..") && !isAbsolute(masterRelativePath)) {
      const project = record(result.project);
      const candidates = Array.isArray(project.scriptCandidates) ? project.scriptCandidates.map(record) : [];
      const selected = candidates.find((item) => item.selected === true) || candidates[0] || {};
      const shots = Array.isArray(selected.shots) ? selected.shots.map(record) : [];
      const usedAssetIds = new Set(
        shots.flatMap((shot) => Array.isArray(shot.selectedAssetIds) ? shot.selectedAssetIds.map(String) : []),
      );
      try {
        const probe = await execFileAsync(ffprobeExecutable, [
          "-v", "error",
          "-select_streams", "v:0",
          "-show_entries", "stream=width,height,codec_name,avg_frame_rate:format=duration",
          "-of", "json",
          masterPath,
        ], { timeout: 60_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
        const parsed = JSON.parse(probe.stdout) as JsonRecord;
        const stream = Array.isArray(parsed.streams) ? record(parsed.streams[0]) : {};
        const format = record(parsed.format);
        const metadata = record(existingMaster.metadata);
        existingMaster.metadata = {
          ...metadata,
          width: Number(stream.width || 0),
          height: Number(stream.height || 0),
          durationSeconds: Number(format.duration || 0),
          codec: String(stream.codec_name || ""),
          frameRate: String(stream.avg_frame_rate || ""),
          aspectRatio: Number(stream.width) && Number(stream.height) ? `${stream.width}:${stream.height}` : "9:16",
          usedAssetIds: Array.from(usedAssetIds),
        };
        result.outputFiles = existingFiles;
      } catch {
        // 保留Codex原始输出，上传端仍会记录已有元数据。
      }
    }
    return result;
  }
  const assets = (Array.isArray(taskPackageValue.assets) ? taskPackageValue.assets.map(record) : [])
    .filter((asset) => ["VIDEO", "IMAGE"].includes(String(asset.kind || "")) && asset.workspacePath);
  const project = record(result.project);
  const candidates = Array.isArray(project.scriptCandidates) ? project.scriptCandidates.map(record) : [];
  const selected = candidates.find((item) => item.selected === true) || candidates[0] || {};
  const shots = Array.isArray(selected.shots) ? selected.shots.map(record) : [];
  if (["saidian-ai-task-dispatcher", "saydian-douyin-viral-video-generator", "video-editing-from-media-library-share"].includes(String(execution.requiredSkill || ""))) {
    const missing = Array.isArray(selected.missingAssets) ? selected.missingAssets : [];
    selected.missingAssets = missing.length ? missing : [{
      moduleType: "VIDEO_MASTER",
      description: "指定视频剪辑Skill未产出可上传的主成片",
      reason: "result.outputFiles中缺少VIDEO_MASTER",
      alternative: "按Skill补齐真实视频镜头并通过质检后重试；素材不足时生成补拍清单",
    }];
    result.project = project;
    result.outputFiles = existingFiles;
    result.summary = `${String(result.summary || "")} 指定视频剪辑Skill未产出主成片，未启用旧版自动拼接。`.trim();
    return result;
  }
  if (!assets.length) {
    const missing = Array.isArray(selected.missingAssets) ? selected.missingAssets : [];
    selected.missingAssets = missing.length ? missing : [{
      moduleType: "PRODUCT",
      description: "缺少可用于本地合成的已审核产品图片或视频素材",
      reason: "任务包没有可用真实素材",
      alternative: "补充已审核产品素材后重试，或创建员工补拍任务",
    }];
    result.project = project;
    return result;
  }

  const outputsDir = join(workspace, "outputs");
  const renderDir = join(workspace, "render");
  await mkdir(outputsDir, { recursive: true });
  await mkdir(renderDir, { recursive: true });
  const clips: string[] = [];
  const renderedShots: Array<{ shot: JsonRecord; duration: number }> = [];
  const usedAssetIds = new Set<string>();
  const assetById = new Map(assets.map((asset) => [String(asset.id || ""), asset]));
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index]!;
    const requestedAssetIds = Array.isArray(shot.selectedAssetIds) ? shot.selectedAssetIds.map(String) : [];
    const asset = requestedAssetIds.map((id) => assetById.get(id)).find(Boolean);
    const outputPath = join(renderDir, `clip-${String(index + 1).padStart(2, "0")}.mp4`);
    const duration = Math.max(2, Math.min(12, Number(shot.durationSeconds || 4)));
    let args: string[];
    if (!asset) {
      args = [
        "-y", "-f", "lavfi", "-i", `color=c=0x13233f:s=1080x1920:r=30:d=${duration}`,
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", outputPath,
      ];
    } else {
      const inputPath = resolve(workspace, String(asset.workspacePath));
      const isImage = String(asset.kind) === "IMAGE";
      usedAssetIds.add(String(asset.id));
      args = isImage
        ? [
          "-y", "-loop", "1", "-i", inputPath, "-t", String(duration),
          "-vf", `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,zoompan=z='min(zoom+0.0015,1.08)':d=${Math.ceil(duration * 30)}:s=1080x1920:fps=30`,
          "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", outputPath,
        ]
        : [
          "-y", "-i", inputPath, "-t", String(duration),
          "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,fps=30",
          "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", outputPath,
        ];
    }
    await execFileAsync(ffmpegExecutable, args, { timeout: 300_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    clips.push(outputPath);
    renderedShots.push({ shot, duration });
  }
  if (!clips.length) {
    selected.missingAssets = [{
      moduleType: "STORYBOARD",
      description: "没有可渲染的结构化镜头",
      reason: "脚本候选未提供分镜",
      alternative: "重新生成脚本和分镜",
    }];
    return result;
  }

  const concatPath = join(renderDir, "concat.txt");
  await writeFile(
    concatPath,
    clips.map((path) => `file '${path.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`).join("\n"),
    "utf8",
  );
  const assembledPath = join(renderDir, "assembled.mp4");
  await execFileAsync(ffmpegExecutable, [
    "-y", "-f", "concat", "-safe", "0", "-i", concatPath,
    "-c", "copy", "-movflags", "+faststart", assembledPath,
  ], { timeout: 300_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });

  let elapsed = 0;
  const captions = renderedShots.map(({ shot, duration }, index) => {
    const start = elapsed;
    const end = start + duration;
    elapsed = end;
    const text = String(
      shot.subtitle
      || (index === 0 ? selected.hook : index === renderedShots.length - 1 ? selected.cta : shot.voiceover)
      || shot.description
      || selected.script
      || "",
    );
    return `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text.replaceAll("\n", " ")}\n`;
  });
  const subtitlePath = join(renderDir, "captions.srt");
  await writeFile(subtitlePath, captions.join("\n"), "utf8");
  const masterPath = join(outputsDir, `${safeName(String(task.taskNo || task.id || "video"))}-master.mp4`);
  try {
    await execFileAsync(ffmpegExecutable, [
      "-y", "-i", assembledPath,
      "-vf", `subtitles='${ffmpegFilterPath(subtitlePath)}':force_style='FontName=Noto Sans CJK SC,FontSize=14,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,MarginV=110,Alignment=2'`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-an", "-movflags", "+faststart", masterPath,
    ], { timeout: 600_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  } catch {
    await writeFile(masterPath, await readFile(assembledPath));
  }
  const info = await stat(masterPath);
  if (!info.isFile() || info.size < 1024) throw new Error("本地视频成片输出为空");
  let mediaMetadata: JsonRecord = {};
  try {
    const probe = await execFileAsync(ffprobeExecutable, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,codec_name,avg_frame_rate:format=duration",
      "-of", "json",
      masterPath,
    ], { timeout: 60_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    const parsed = JSON.parse(probe.stdout) as JsonRecord;
    const stream = Array.isArray(parsed.streams) ? record(parsed.streams[0]) : {};
    const format = record(parsed.format);
    mediaMetadata = {
      width: Number(stream.width || 0),
      height: Number(stream.height || 0),
      durationSeconds: Number(format.duration || elapsed),
      codec: String(stream.codec_name || ""),
      frameRate: String(stream.avg_frame_rate || ""),
      aspectRatio: Number(stream.width) && Number(stream.height) ? `${stream.width}:${stream.height}` : "9:16",
    };
  } catch {
    mediaMetadata = {
      width: 1080,
      height: 1920,
      durationSeconds: elapsed,
      codec: "h264",
      frameRate: "30/1",
      aspectRatio: "9:16",
    };
  }
  existingFiles.push({
    path: relative(workspace, masterPath).replaceAll("\\", "/"),
    kind: "VIDEO_MASTER",
    title: `${String(project.topic || task.title || "智能视频")} · 主成片`,
    metadata: {
      description: `Codex本地合成，按镜头绑定复用${usedAssetIds.size}个已审核素材`,
      source: "CODEX_LOCAL_FFMPEG",
      ...mediaMetadata,
      usedAssetIds: Array.from(usedAssetIds),
    },
  });
  result.outputFiles = existingFiles;
  result.summary = `${String(result.summary || "")} 已按镜头绑定使用${usedAssetIds.size}个已审核素材完成本地主成片。`.trim();
  return result;
}

async function runCodex(
  taskPackage: JsonRecord,
  detectedSkill: DetectedSkill,
  workspace: string,
  timeoutSeconds: number,
  schemaAttempt = 1,
  internalCorrection = "",
) {
  const task = record(taskPackage.task);
  const execution = record(taskPackage.execution);
  const snapshots = Array.isArray(taskPackage.snapshots) ? taskPackage.snapshots.map(record) : [];
  const snapshotPayload = record(snapshots[0]?.payload);
  const requirements = record(snapshotPayload.requirements);
  const schemaPath = join(workspace, "output-schema.json");
  const resultPath = join(workspace, "result.json");
  await writeFile(schemaPath, JSON.stringify(openAiStrictSchema(outputSchema(
    String(task.type || ""),
    String(execution.mode || ""),
    Number(requirements.exactCount || 10),
    isCodexDirectFullVideoTask(taskPackage),
    isImagePostProjectTask(taskPackage),
  )), null, 2), "utf8");
  await writeFile(join(workspace, "task.json"), JSON.stringify(task, null, 2), "utf8");
  const resolvedCodexExecutable = await resolveCodexExecutable();
  const args = [
    "exec", "--ephemeral", "--skip-git-repo-check", "--output-schema", schemaPath, "--json",
    // Codex's Windows workspace-write sandbox can fail before the first
    // command while applying deny-read ACLs. This dedicated node already
    // enforces task scope, target Skills and read-only source-material rules,
    // so use the non-ACL sandbox mode on Windows and keep workspace-write on
    // platforms where the native sandbox is reliable.
    "--sandbox", process.platform === "win32" ? "danger-full-access" : "workspace-write",
    "-c", "approval_policy=\"never\"",
    "--cd", workspace, "--output-last-message", resultPath, "-",
  ];
  let stdout = "";
  let stderr = "";
  try {
    await new Promise<void>((resolvePromise, reject) => {
    const childEnv = {
      ...process.env,
      AI_TASK_PYTHON_EXECUTABLE: pythonExecutable,
      PYTHON_EXECUTABLE: pythonExecutable,
      PATH: [
        dirname(pythonExecutable),
        dirname(ffmpegExecutable),
        dirname(ffprobeExecutable),
        String(process.env.PATH || ""),
      ].filter(Boolean).join(process.platform === "win32" ? ";" : ":"),
    };
    const child = spawn(resolvedCodexExecutable, args, {
      cwd: workspace,
      env: childEnv,
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(resolvedCodexExecutable),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    let idleTimer: NodeJS.Timeout;
    const terminateTree = async () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        // Do not use taskkill /T here. In the packaged Windows runtime the
        // Codex process can share a job/console with its worker parent, and /T
        // has terminated the worker as well. Resolve descendants explicitly
        // and stop leaves first, never walking through ParentProcessId.
        const processTreeScript = [
          `$rootPid=${child.pid}`,
          "$all=Get-CimInstance Win32_Process",
          "$ids=@($rootPid)",
          "do{$before=$ids.Count;$children=$all|Where-Object{$ids -contains $_.ParentProcessId}|Select-Object -ExpandProperty ProcessId;$ids=@($ids+$children|Select-Object -Unique)}while($ids.Count -gt $before)",
          "$ids|Sort-Object -Descending|ForEach-Object{Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue}",
        ].join(";");
        await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", processTreeScript], {
          windowsHide: true,
          timeout: 10_000,
        }).catch(() => undefined);
      } else {
        child.kill("SIGKILL");
      }
    };
    const failOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(idleTimer);
      void Promise.race([
        terminateTree(),
        new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 10_000)),
      ]).finally(() => reject(error));
    };
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        failOnce(new Error(`Codex长时间无输出（${codexIdleTimeoutSeconds}秒），已终止进程树并准备重试`));
      }, codexIdleTimeoutSeconds * 1_000);
    };
    const timer = setTimeout(() => {
      failOnce(new Error(`Codex执行超时（${timeoutSeconds}秒），已终止进程树`));
    }, timeoutSeconds * 1_000);
    resetIdleTimer();
    child.stderr.on("data", (chunk) => {
      resetIdleTimer();
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });
    child.stdout.on("data", (chunk) => {
      resetIdleTimer();
      stdout += chunk.toString();
      if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
    });
    child.on("error", (error) => {
      failOnce(error);
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(idleTimer);
      if (code === 0) resolvePromise();
      else reject(new Error(stderr || stdout || `Codex退出码 ${code}`));
    });
    const correctionInstruction = internalCorrection
      ? `\nINTERNAL_CORRECTION_REQUIRED: The previous draft was not submitted to the user. Rewrite it now and fix every issue below before returning. Do not merely change check flags; the actual script, hook, rhythm, material bindings and ending must comply.\n${internalCorrection}\n`
      : "";
    child.stdin.end(`${prompt(taskPackage, detectedSkill)}${correctionInstruction}`);
    });
  } finally {
    await writeFile(join(workspace, "logs", `codex-${schemaAttempt}.stdout.log`), stdout, "utf8");
    await writeFile(join(workspace, "logs", `codex-${schemaAttempt}.stderr.log`), stderr, "utf8");
  }
  const content = await readFile(resultPath, "utf8");
  try {
    return JSON.parse(content) as JsonRecord;
  } catch {
    throw new ResultSchemaError("result.json 不是合法JSON");
  }
}

function packageFingerprint(taskPackageValue: JsonRecord) {
  const task = record(taskPackageValue.task);
  const stableTask = {
    id: task.id,
    taskNo: task.taskNo,
    type: task.type,
    title: task.title,
    platform: task.platform,
    productId: task.productId,
    productModel: task.productModel,
    instructions: task.instructions,
    input: task.input,
    modelPolicy: task.modelPolicy,
    sourceType: task.sourceType,
    sourceId: task.sourceId,
  };
  const stableAssets = (Array.isArray(taskPackageValue.assets) ? taskPackageValue.assets.map(record) : []).map((asset) => ({
    id: asset.id,
    sha256: asset.sha256,
    kind: asset.kind,
    workspacePath: asset.workspacePath,
  }));
  return sha256(Buffer.from(JSON.stringify({
    task: stableTask,
    snapshots: taskPackageValue.snapshots,
    execution: taskPackageValue.execution,
    assets: stableAssets,
  })));
}

async function validateOutputArtifacts(result: JsonRecord, workspace: string) {
  const files = Array.isArray(result.outputFiles) ? result.outputFiles.map(record) : [];
  for (const item of files) {
    const requested = String(item.path || "");
    const path = resolve(workspace, requested);
    const rel = relative(workspace, path);
    if (!requested || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`输出文件越界：${requested}`);
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) throw new Error(`输出文件为空：${requested}`);
    const digest = sha256(await readFile(path));
    item.metadata = {
      ...record(item.metadata),
      sha256: digest,
      sizeBytes: info.size,
    };
  }
  result.outputFiles = files;
  return result;
}

async function verifyImagePostSkillRuntime(taskPackageValue: JsonRecord, detectedSkill: DetectedSkill) {
  if (!isImagePostProjectTask(taskPackageValue)) return;
  if (detectedSkill.key !== "saidian-ai-task-dispatcher") {
    throw new Error("图文项目必须通过赛电调度 Skill 调用图文制作 Skill。");
  }
  const downstreamSkillPath = String(detectedSkill.downstreamSkillPath || "").trim();
  if (!downstreamSkillPath) throw new Error("图文制作 Skill 未配置。");
  try {
    const downstream = await stat(downstreamSkillPath);
    if (!downstream.isFile()) throw new Error("not-file");
  } catch {
    throw new Error(`图文制作 Skill 不可用：${downstreamSkillPath}`);
  }
  const portableLibrary = resolve(String(process.env.AI_TASK_IMAGE_MEDIA_LIBRARY || "F:\\赛电品牌素材库"));
  for (const requiredDirectory of ["图片素材", "产品规格书"]) {
    try {
      const directory = await stat(join(portableLibrary, requiredDirectory));
      if (!directory.isDirectory()) throw new Error("not-directory");
    } catch {
      throw new Error(`图文项目未启动：移动硬盘素材库缺少 ${requiredDirectory}（${portableLibrary}）。`);
    }
  }
}

async function validateMandatoryVideoEvidence(
  taskPackageValue: JsonRecord,
  workspace: string,
  detectedSkill: DetectedSkill,
) : Promise<QualityWarning[]> {
  const task = record(taskPackageValue.task);
  const execution = record(taskPackageValue.execution);
  if (String(task.type || "") !== "VIDEO" || !["FULL_VIDEO", "SIMILAR_VIDEO", "NO_VOICE_VIDEO"].includes(String(execution.mode || ""))) return [];
  let qualityWarnings: QualityWarning[] = [];
  const warn = async (validator: string, summary: string) => {
    const warning: QualityWarning = {
      validator,
      summary: summary.slice(0, 800),
      recommendation: "成片可交付；如需优化，请在审核中退回并说明具体画面问题。",
    };
    qualityWarnings = appendQualityWarning(qualityWarnings, warning);
    await appendExecutionLog(workspace, "QUALITY_WARNING", warning);
  };
  const direct = isCodexDirectFullVideoTask(taskPackageValue);
  const directInput = record(record(task.input).codexDirectInput);
  const creativeMode = String(directInput.creativeMode || "FULL_VIDEO").toUpperCase();
  const requiredFiles = [
    ...(direct ? ["production-plan.json"] : []),
    "requirements-check.json",
    "shot-plan.json",
    "composition-qc.json",
    "packaging-qc.json",
    "audio-qc.json",
    ...(direct ? ["transition-qc.json", "render-evidence.json"] : []),
  ];
  for (const file of requiredFiles) {
    const path = join(workspace, file);
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size < 10) throw new Error("empty");
      JSON.parse(await readFile(path, "utf8"));
    } catch {
      throw new Error(`完整版剪辑Skill证据缺失或无效：${file}`);
    }
  }
  const checklist = await readJson<JsonRecord>(join(workspace, "requirements-check.json"));
  const rows = Array.isArray(checklist?.items)
    ? checklist.items.map(record)
    : Array.isArray(checklist?.requirements) ? checklist.requirements.map(record) : [];
  if (!rows.length) throw new Error("requirements-check.json 没有逐项验收记录");
  const failed = rows.filter((item) => item.applicable !== false && item.passed !== true);
  if (failed.length) throw new Error(`完整版剪辑Skill仍有未通过要求：${failed.map((item) => String(item.id || "unknown")).join("、")}`);

  if (!direct) return qualityWarnings;
  const downstreamSkillPath = String(detectedSkill.downstreamSkillPath || "").trim();
  if (basename(dirname(downstreamSkillPath)).toLowerCase() !== "video-editing-from-media-library") {
    throw new Error(`Local direct render requires the full video-editing-from-media-library Skill, got: ${downstreamSkillPath}`);
  }
  if (!downstreamSkillPath) throw new Error("完整版剪辑Skill路径缺失，无法执行官方质检器");
  const skillRoot = dirname(downstreamSkillPath);
  const runValidator = async (script: string, args: string[]) => {
    try {
      await execFileAsync(pythonExecutable, [join(skillRoot, "scripts", script), ...args], {
        cwd: workspace,
        timeout: 120_000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (error) {
      const detail = error && typeof error === "object"
        ? String((error as { stderr?: unknown; stdout?: unknown; message?: unknown }).stderr
          || (error as { stdout?: unknown }).stdout
          || (error as { message?: unknown }).message
          || "")
        : String(error);
      const gate = classifyQualityGate(script, detail);
      if (gate.disposition === "WARNING") {
        await warn(gate.warning.validator, gate.warning.summary);
        return;
      }
      throw new Error(`完整版剪辑Skill官方质检失败（${script}）：${detail.slice(0, 800)}`);
    }
  };
  await runValidator("validate_direct_production_plan.py", [
    join(workspace, "production-plan.json"),
    "--video-type", creativeMode === "NO_VOICE_VIDEO" ? "no_voice" : "voice",
  ]);
  const preflightLog = join(workspace, "logs", "production-plan-validator.log");
  // The worker just ran the authoritative validator successfully. Normalize
  // the evidence itself so PowerShell/Codex UTF-16 logs cannot be misread as a
  // failed gate. A validator error above still blocks and enters repair flow.
  await mkdir(dirname(preflightLog), { recursive: true });
  await writeFile(preflightLog, "PRODUCTION_PLAN_OK\n", "utf8");
  await runValidator("validate_hard_requirements.py", [
    "--check", join(workspace, "requirements-check.json"),
    "--stage", "final",
    "--video-type", creativeMode === "NO_VOICE_VIDEO" ? "no_voice" : "voice",
  ]);
  await runValidator("validate_shot_plan.py", [join(workspace, "shot-plan.json")]);
  await runValidator("validate_rendered_composition.py", [join(workspace, "composition-qc.json")]);

  const shotPlan = record(await readJson<JsonRecord>(join(workspace, "shot-plan.json")));
  const videos = Array.isArray(shotPlan.videos) ? shotPlan.videos.map(record) : [];
  const shots = videos.flatMap((video) => Array.isArray(video.shots) ? video.shots.map(record) : []);
  const productModel = String(task.productModel || directInput.productModel || "").trim();
  if (/^W8Ultra$/iu.test(productModel)) {
    const conflicts = shots.filter((shot) => /(?:W8U|W8Ultra)[-_ ]?R(?:\b|[-_ ])/iu.test(String(shot.source || "")));
    if (conflicts.length) throw new Error("精确型号校验失败：W8Ultra 成片混入 W8Ultra-R/W8U-R 素材");
  }

  const transitions = record(await readJson<JsonRecord>(join(workspace, "transition-qc.json")));
  const cuts = Array.isArray(transitions.cuts) ? transitions.cuts.map(record) : [];
  if (cuts.length !== Math.max(0, shots.length - videos.length)) {
    await warn("transition-qc.json", "转场复核记录未逐一覆盖全部剪辑点");
  }
  const invalidCuts = cuts.filter((cut) => Number(cut.beforeSeconds || 0) < 0.6
    || Number(cut.afterSeconds || 0) < 0.6
    || cut.passed !== true
    || !String(cut.observation || "").trim()
    || !String(cut.transition || "").trim());
  if (invalidCuts.length) await warn("transition-qc.json", "部分转场缺少完整复核记录或可优化观察");

  if (cuts.length >= 3 && new Set(cuts.map((cut) => String(cut.transition || "").trim().toLowerCase())).size === 1) {
    await warn("transition-qc.json", "多个剪辑点使用同一转场，建议在下次版本优化节奏");
  }

  const renderEvidence = record(await readJson<JsonRecord>(join(workspace, "render-evidence.json")));
  const planInfo = await stat(join(workspace, "production-plan.json"));
  const renderEvidenceInfo = await stat(join(workspace, "render-evidence.json"));
  // The validator log is normalized to canonical UTF-8 during final validation,
  // so its timestamp can legitimately be newer than the render evidence. The
  // production plan itself is the artifact that must predate rendering.
  if (planInfo.mtimeMs > renderEvidenceInfo.mtimeMs) {
    throw new Error("Production-plan gate must complete before render evidence is created");
  }
  const commands = Array.isArray(renderEvidence.commands) ? renderEvidence.commands.map(record) : [];
  // Some downstream Skill versions use a generic project label while their
  // successful command-log paths retain the HyperFrames provenance.
  if (!hasHyperframesRenderEvidence(renderEvidence)) {
    throw new Error("直出成片未使用完整版Skill规定的 HyperFrames 渲染链");
  }
  for (const name of ["doctor", "lint", "validate", "inspect", "render"]) {
    const command = commands.find((item) => String(item.name || "").toLowerCase() === name);
    // Downstream Skills historically emit `passed`, while some producers use
    // `success` or the raw process `exitCode`. They are equivalent evidence
    // fields in the render contract; rejecting `passed: true` causes a fully
    // rendered and validated master to be reported as failed at callback time.
    const commandPassed = command && (
      Number(command.exitCode) === 0
      || command.success === true
      || command.passed === true
    );
    if (!commandPassed) throw new Error(`HyperFrames ${name} 未真实通过`);
    const commandLogPath = String(command.logPath || command.log || "");
    const logPath = resolve(workspace, commandLogPath);
    const logRelative = relative(workspace, logPath);
    if (!commandLogPath || logRelative.startsWith("..") || isAbsolute(logRelative)) {
      throw new Error(`HyperFrames ${name} 日志路径无效`);
    }
    const info = await stat(logPath).catch(() => undefined);
    if (!info?.isFile() || info.size < 10) throw new Error(`HyperFrames ${name} 缺少非空执行日志`);
  }

  if (creativeMode === "NO_VOICE_VIDEO") {
    const audioQc = record(await readJson<JsonRecord>(join(workspace, "audio-qc.json")));
    const bgm = record(audioQc.bgm);
    const beatMap = record(audioQc.beatMap);
    if (!String(bgm.sourcePath || "").trim() || !Array.isArray(beatMap.downbeats) || !beatMap.downbeats.length) {
      throw new Error("无口播成片缺少本地真实BGM路径或有效节拍表");
    }
    if (/sine|beep|placeholder|程序化|占位/iu.test(`${String(bgm.sourcePath || "")} ${String(bgm.description || "")}`)) {
      throw new Error("无口播成片禁止使用正弦音、蜂鸣或程序化占位音轨代替BGM");
    }
  }
  return qualityWarnings;
}

// A completed Codex direct-output task may fail only while registering its MP4
// with the API. Keep that already-rendered master reusable: the next retry must
// upload/register it instead of invoking Codex and rendering a second time.
async function recoverDirectOutputResult(
  workspace: string,
  taskPackageValue: JsonRecord,
  execution: JsonRecord,
) {
  if (!isCodexDirectFullVideoTask(taskPackageValue)) return undefined;
  const preflightPlan = await stat(join(workspace, "production-plan.json")).catch(() => undefined);
  const preflightLog = await readFile(join(workspace, "logs", "production-plan-validator.log"), "utf8").catch(() => "");
  if (!preflightPlan?.isFile() || !preflightLog.includes("PRODUCTION_PLAN_OK")) return undefined;
  const outputsRoot = join(workspace, "outputs");
  const savedResult = await readJson<JsonRecord>(join(workspace, "result.json"));
  const savedOutputs = Array.isArray(savedResult?.outputFiles) ? savedResult.outputFiles.map(record) : [];
  const savedMaster = savedOutputs.find((item) => String(item.kind || "").toUpperCase() === "VIDEO_MASTER");
  if (savedMaster) {
    const requested = String(savedMaster.path || "");
    const absolute = resolve(workspace, requested);
    const relativePath = relative(workspace, absolute);
    const info = await stat(absolute).catch(() => undefined);
    if (requested && !relativePath.startsWith("..") && !isAbsolute(relativePath) && info?.isFile() && info.size > 0) {
      const recovered = {
        ...savedResult,
        outputFiles: [{ ...savedMaster, path: relativePath }],
        execution: {
          ...record(savedResult?.execution),
          ...execution,
          resumed: true,
          finishedAt: new Date().toISOString(),
        },
      };
      return validateOutputArtifacts(recovered, workspace);
    }
  }
  let names: string[];
  try {
    names = await readdir(outputsRoot);
  } catch {
    return undefined;
  }
  const masters: Array<{ name: string; size: number }> = [];
  for (const name of names) {
    if (extname(name).toLowerCase() !== ".mp4") continue;
    const info = await stat(join(outputsRoot, name)).catch(() => undefined);
    if (info?.isFile() && info.size > 0) masters.push({ name, size: info.size });
  }
  if (!masters.length) return undefined;
  const task = record(taskPackageValue.task);
  const taskInput = record(task.input);
  const referenceDirect = taskInput.referenceDirectFullVideo === true;
  const master = masters.find((item) => /video[_-]?master/iu.test(item.name))
    || [...masters].sort((left, right) => right.size - left.size)[0];
  const result: JsonRecord = {
    summary: "恢复已生成的 Codex 直出成片，仅重新登记上传结果。",
    outputFiles: [{
      path: join("outputs", master.name),
      kind: "VIDEO_MASTER",
      title: `${String(task.productModel || "产品")} Codex 直出成片`,
      metadata: {
        description: "本地已完成渲染的最终成片，重试时不重新剪辑。",
        source: "CODEX_DIRECT_OUTPUT_RECOVERY",
      },
    }],
    delivery: {
      productModel: String(task.productModel || ""),
      taskMode: referenceDirect ? "REFERENCE_DIRECT_FULL_VIDEO" : "CODEX_DIRECT_FULL_VIDEO",
      finalReviewOnly: true,
    },
    // Result-contract validates execution strictly. A registration-only recovery
    // still needs the same immutable execution envelope as a normal completion.
    execution: {
      skill: String(execution.skill || "video-editing-from-media-library-share"),
      skillVersion: String(execution.skillVersion || "unknown"),
      skillDigest: String(execution.skillDigest || ""),
      strategy: String(execution.strategy || "DIRECT_OUTPUT_RECOVERY"),
      executionMode: String(execution.executionMode || "FULL_VIDEO"),
      routeReason: String(execution.routeReason || "reuse-existing-direct-output"),
      fallbackOrder: Array.isArray(execution.fallbackOrder)
        ? execution.fallbackOrder.map(String)
        : [],
      startedAt: String(execution.startedAt || new Date().toISOString()),
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, Number(execution.durationMs || 0)),
      resumed: true,
      schemaAttempts: Math.max(1, Number(execution.schemaAttempts || 1)),
    },
  };
  return validateOutputArtifacts(result, workspace);
}

async function uploadFile(taskId: string, workspace: string, item: JsonRecord) {
  const requested = String(item.path || "");
  const path = resolve(workspace, requested);
  const rel = relative(workspace, path);
  if (!requested || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`输出文件越界：${requested}`);
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`输出文件不存在：${requested}`);
  const buffer = await readFile(path);
  const form = new FormData();
  form.set("nodeCode", nodeCode);
  form.set("kind", String(item.kind || "FILE_OUTPUT"));
  form.set("title", String(item.title || basename(path)));
  // Preserve the task-relative source path. IMAGE_PROJECT pages bind this
  // returned path back to the corresponding page record after OSS upload.
  form.set("metadata", JSON.stringify({
    ...record(item.metadata),
    workspaceOutputPath: requested,
  }));
  form.set("file", new Blob([buffer], { type: fileMime(path) }), basename(path));
  const response = await fetch(`${apiUrl}/api/v1/ai-tasks/runner/tasks/${taskId}/output`, {
    method: "POST",
    headers: { authorization: `Runner ${runnerToken}` },
    body: form,
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!response.ok) throw new Error(`上传失败 ${response.status}: ${await response.text()}`);
  return response.text();
}

async function execute(claimed: JsonRecord) {
  const task = claimed.task as JsonRecord;
  const taskId = String(task.id || "");
  const taskNo = String(task.taskNo || taskId);
  const initialTaskInput = record(task.input);
  const directOutputTask = String(task.type || "") === "VIDEO"
    && String(initialTaskInput.executionMode || "").toUpperCase() === "FULL_VIDEO"
    && (initialTaskInput.codexDirectFullVideo === true || initialTaskInput.referenceDirectFullVideo === true);
  const timeoutSeconds = Math.max(60, Number((claimed.policy as JsonRecord)?.timeoutSeconds || 1200));
  const workspace = join(workRoot, taskNo.replace(/[^a-zA-Z0-9_-]/g, "-"));
  await ensureTaskWorkspace(workspace);
  const videoRenderTask = String(task.type || "") === "VIDEO"
    && ["FULL_VIDEO", "SIMILAR_VIDEO", "NO_VOICE_VIDEO"].includes(String(initialTaskInput.executionMode || "").toUpperCase());
  if (videoRenderTask) await prepareHyperFramesRuntime(workspace);
  let currentSkill = "";
  let state: WorkspaceState | undefined;
  let retryInternally = false;
  const heartbeat = setInterval(() => {
    void api(`/api/v1/ai-tasks/runner/tasks/${taskId}/heartbeat`, {
      method: "POST",
      body: JSON.stringify({ nodeCode, currentSkill }),
    }).catch(() => undefined);
  }, heartbeatMs);
  const report = async (stage: string, progress: number, message: string, data: JsonRecord = {}) => {
    if (state) {
      state.stage = stage;
      state.updatedAt = new Date().toISOString();
      await saveWorkspaceState(workspace, state);
    }
    await appendExecutionLog(workspace, "CHECKPOINT", { stage, progress, message, currentSkill, ...data });
    await checkpoint(taskId, stage, progress, message, { currentSkill, ...data });
  };
  try {
    await appendExecutionLog(workspace, "TASK_START", { taskId, taskNo, runnerVersion });
    await report("PACKAGE", 10, directOutputTask
      ? "正在准备直出任务包和本机剪辑环境"
      : "正在准备任务快照和已审核输入");
    const packageValue = await taskPackage(taskId);
    const route = routeTask(packageValue);
    const detectedSkill = await detectSkill(route);
    currentSkill = detectedSkill.downstreamSkillName || detectedSkill.name;
    const packaged = await downloadInputs(packageValue, workspace);
    await writeJsonAtomic(join(workspace, "task.json"), record(packaged.task));
    const fingerprint = packageFingerprint(packaged);
    const previousState = await loadWorkspaceState(workspace);
    const resumeEligible = canResume(previousState, fingerprint, detectedSkill.digest);
    // A manual/API recovery retry adds bookkeeping fields to the task input and
    // therefore changes its package fingerprint. Detect the already-rendered
    // master from authoritative local evidence before consulting the saved
    // stage, otherwise a prior failed retry can reset the stage to CODEX and
    // accidentally trigger a second edit.
    const directRecoveryResult = await recoverDirectOutputResult(workspace, packaged, {
      skill: detectedSkill.name,
      skillVersion: detectedSkill.version,
      skillDigest: detectedSkill.digest,
      strategy: detectedSkill.strategy,
      executionMode: detectedSkill.executionMode,
      projectMode: detectedSkill.projectMode || "",
      stage: detectedSkill.stage || detectedSkill.executionMode,
      routeReason: detectedSkill.reason,
      fallbackOrder: detectedSkill.fallbackOrder,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      schemaAttempts: 1,
    });
    // Runtime snapshots can change after an upload failure even when the task
    // itself and its rendered master have not. Direct-output retries are safe to
    // resume from the local output stages, provided their saved result/artifact
    // still validates below.
    const resumeDirectOutputUpload = isCodexDirectFullVideoTask(packaged)
      && (Boolean(directRecoveryResult) || (
        Boolean(previousState)
        && ["LOCAL_RENDER", "QUALITY_CHECK", "UPLOADING", "FINALIZING", "COMPLETE"].includes(String(previousState?.stage || ""))
      ));
    const taskState: WorkspaceState = (resumeEligible || resumeDirectOutputUpload) && previousState
      ? {
        ...previousState,
        packageFingerprint: fingerprint,
        skillDigest: detectedSkill.digest,
      }
      : freshWorkspaceState(fingerprint, detectedSkill.digest);
    // Preserve the resume decision before progress reporting changes the saved stage.
    // A previous attempt may already have a validated result and only need to retry
    // its upload; rerunning Codex in that case would create a duplicate video.
    const repairState = await loadExecutionRepairState(workspace);
    const resumeWithValidatedResult = shouldResumeValidatedResult(Boolean(directRecoveryResult) || (
      (resumeEligible || resumeDirectOutputUpload)
      && ["LOCAL_RENDER", "QUALITY_CHECK", "UPLOADING", "FINALIZING", "COMPLETE"].includes(String(taskState.stage || ""))
    ), repairState.lastCategory);
    state = taskState;
    await saveWorkspaceState(workspace, taskState);
    await appendExecutionLog(workspace, "SKILL_SELECTED", {
      skill: detectedSkill.name,
      downstreamSkill: detectedSkill.downstreamSkillName || "",
      version: detectedSkill.version,
      digest: detectedSkill.digest,
      strategy: detectedSkill.strategy,
      executionMode: detectedSkill.executionMode,
      projectMode: detectedSkill.projectMode || "",
      routeStage: detectedSkill.stage || detectedSkill.executionMode,
      routeReason: detectedSkill.reason,
      resumed: resumeEligible || resumeDirectOutputUpload,
    });
    await report("SKILL_DETECTED", 15, detectedSkill.downstreamSkillName
      ? `调度完成，已转交 ${detectedSkill.downstreamSkillName}`
      : `已选择 ${detectedSkill.name}`, {
      skillVersion: detectedSkill.version,
      strategy: detectedSkill.strategy,
      executionMode: detectedSkill.executionMode,
      projectMode: detectedSkill.projectMode || "",
      routeStage: detectedSkill.stage || detectedSkill.executionMode,
      routeReason: detectedSkill.reason,
    });
    await verifyVideoSkillRuntime(packaged, detectedSkill);
    await verifyImagePostSkillRuntime(packaged, detectedSkill);

    const packagedTask = record(packaged.task);
    const execution = record(packaged.execution);
    const snapshots = Array.isArray(packaged.snapshots) ? packaged.snapshots.map(record) : [];
    const snapshotPayload = record(snapshots[0]?.payload);
    const requirements = record(snapshotPayload.requirements);
    const schema = outputSchema(
      String(packagedTask.type || ""),
      String(execution.mode || ""),
      Number(requirements.exactCount || 10),
      isCodexDirectFullVideoTask(packaged),
      isImagePostProjectTask(packaged),
    );
    const startedAt = new Date();
    let result: JsonRecord | undefined;
    let schemaAttempts = 1;
    if (resumeWithValidatedResult) {
      const savedResult = await readJson<JsonRecord>(join(workspace, "result.json"));
      if (savedResult) {
        try {
          validateResult(savedResult, schema, true);
          if (String(packagedTask.type || "") === "VIDEO" && String(execution.mode || "") === "SCRIPT_ONLY") {
            validateVideoScriptMaterialIds(savedResult, Array.isArray(packaged.assets) ? packaged.assets : []);
          }
          result = await validateOutputArtifacts(savedResult, workspace);
          assertCodexDirectMasterOutput(result, packaged);
          result.execution = {
            ...record(result.execution),
            resumed: true,
          };
          await appendExecutionLog(workspace, "RESUME_RESULT", { stage: taskState.stage });
        } catch (error) {
          await appendExecutionLog(workspace, "RESUME_REJECTED", {
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (!result && resumeDirectOutputUpload) {
        const recovered = directRecoveryResult || await recoverDirectOutputResult(workspace, packaged, {
          skill: detectedSkill.name,
          skillVersion: detectedSkill.version,
          skillDigest: detectedSkill.digest,
          strategy: detectedSkill.strategy,
          executionMode: detectedSkill.executionMode,
          routeReason: detectedSkill.reason,
          fallbackOrder: detectedSkill.fallbackOrder,
          startedAt: startedAt.toISOString(),
          durationMs: 0,
          schemaAttempts: 1,
        });
        if (recovered) {
          result = recovered;
          await writeJsonAtomic(join(workspace, "result.json"), result);
          await appendExecutionLog(workspace, "RESUME_OUTPUT_RECOVERED", { stage: taskState.stage });
        }
      }
    }

    if (!result) {
      await report("CODEX", 25, directOutputTask
        ? `正在由 ${detectedSkill.downstreamSkillName || "video-editing-from-media-library"} 自主创作并制作成片`
        : `正在由 ${detectedSkill.downstreamSkillName || detectedSkill.name} 执行当前任务阶段`, {
        skillVersion: detectedSkill.version,
        assetCount: Array.isArray(packaged.assets) ? packaged.assets.length : 0,
      });
      let internalCorrection = repairState.lastReason
        ? [
          `Execution recovery is active under ${executionRepairSkillPath}.`,
          `The previous internal run was not submitted. Repair category: ${repairState.lastCategory || "UNKNOWN"}.`,
          `Failure: ${repairState.lastReason}`,
          `Applied action: ${repairState.lastAction || "resume-from-existing-checkpoint"}.`,
          "Continue the original downstream Skill from valid artifacts. Do not weaken validation or fabricate success.",
          ...(requiresRenderedEvidenceReview(repairState.lastCategory || "NONE") ? [
            "RENDERED_EVIDENCE_RECOVERY: A real VIDEO_MASTER already exists. Preserve the composition and do not re-render unless an actual review finds a visual defect.",
            "Inspect the existing rendered master, then rebuild composition-qc.json from that inspection with reviewed_from_render=true and a start/mid/end sample for every shot. Run validate_rendered_composition.py and return only after it passes.",
          ] : []),
        ].join("\n")
        : "";
      const generated = await runWithSchemaRetry(
        async (schemaAttempt) => {
          await appendExecutionLog(workspace, "CODEX_ATTEMPT", { schemaAttempt });
          return runCodex(packaged, detectedSkill, workspace, timeoutSeconds, schemaAttempt, internalCorrection);
        },
        (candidate) => {
          try {
            validateResult(candidate, schema);
            if (String(packagedTask.type || "") === "VIDEO" && String(execution.mode || "") === "SCRIPT_ONLY") {
              validateVideoScriptMaterialIds(candidate, Array.isArray(packaged.assets) ? packaged.assets : []);
            }
          } catch (error) {
            internalCorrection = error instanceof Error ? error.message : String(error);
            throw error;
          }
          return candidate;
        },
        3,
      );
      result = generated.result;
      schemaAttempts = generated.attempts;
      await report("LOCAL_RENDER", 65, "正在按固定回退顺序处理本地产物");
      result = await renderLocalVideo(result, packaged, workspace);
      const finishedAt = new Date();
      result.execution = {
        skill: detectedSkill.name,
        skillVersion: detectedSkill.version,
        skillDigest: detectedSkill.digest,
        ...(detectedSkill.skillPath ? { skillPath: detectedSkill.skillPath } : {}),
        strategy: detectedSkill.strategy,
        executionMode: detectedSkill.executionMode,
        routeReason: detectedSkill.reason,
        fallbackOrder: detectedSkill.fallbackOrder,
        downstreamSkill: detectedSkill.downstreamSkillName,
        downstreamSkillPath: detectedSkill.downstreamSkillPath,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        resumed: false,
        schemaAttempts,
      };
      result = await validateOutputArtifacts(result, workspace);
      assertCodexDirectMasterOutput(result, packaged);
      validateResult(result, schema, true);
      if (String(packagedTask.type || "") === "VIDEO" && String(execution.mode || "") === "SCRIPT_ONLY") {
        validateVideoScriptMaterialIds(result, Array.isArray(packaged.assets) ? packaged.assets : []);
      }
      await writeJsonAtomic(join(workspace, "result.json"), result);
    } else {
      schemaAttempts = Number(record(result.execution).schemaAttempts || 1);
      validateResult(result, schema, true);
      assertCodexDirectMasterOutput(result, packaged);
      if (String(packagedTask.type || "") === "VIDEO" && String(execution.mode || "") === "SCRIPT_ONLY") {
        validateVideoScriptMaterialIds(result, Array.isArray(packaged.assets) ? packaged.assets : []);
      }
      await writeJsonAtomic(join(workspace, "result.json"), result);
    }

    const qualityWarnings = await validateMandatoryVideoEvidence(packaged, workspace, detectedSkill);
    if (qualityWarnings.length) {
      result.qualityWarnings = appendQualityWarning(
        Array.isArray(result.qualityWarnings) ? result.qualityWarnings as QualityWarning[] : [],
        qualityWarnings[0],
      );
      for (const warning of qualityWarnings.slice(1)) {
        result.qualityWarnings = appendQualityWarning(result.qualityWarnings as QualityWarning[], warning);
      }
      await writeJsonAtomic(join(workspace, "result.json"), result);
    }
    await report("QUALITY_CHECK", 78, "result.json、产物哈希与完整版剪辑证据校验通过", {
      schemaAttempts,
      outputCount: Array.isArray(result.outputFiles) ? result.outputFiles.length : 0,
    });
    const structuredOnlyKinds = new Set(["SCRIPT_CANDIDATES", "VIDEO_SCRIPT", "STORYBOARD_JSON", "STRUCTURED_RESULT"]);
    const generatedFiles = Array.isArray(result.outputFiles) ? result.outputFiles : [];
    const files = String(task.type || "") === "VIDEO"
      && ["SCRIPT_ONLY", "TOPIC_CARD_BATCH"].includes(String(execution.mode || ""))
      ? []
      : generatedFiles.filter((item) => !structuredOnlyKinds.has(String(record(item).kind || "").toUpperCase()));
    for (const raw of files) {
      const item = record(raw);
      const metadata = record(item.metadata);
      const ledgerKey = uploadLedgerKey(
        String(item.path || ""),
        String(metadata.sha256 || ""),
        String(item.kind || "FILE_OUTPUT"),
      );
      if (taskState.uploads[ledgerKey]) {
        await appendExecutionLog(workspace, "UPLOAD_SKIPPED_IDEMPOTENT", {
          path: item.path,
          kind: item.kind,
        });
        continue;
      }
      await report("UPLOADING", 85, `正在上传${String(item.title || "任务输出")}`);
      await uploadFile(taskId, workspace, item);
      taskState.uploads[ledgerKey] = {
        uploadedAt: new Date().toISOString(),
        path: String(item.path || ""),
        sha256: String(metadata.sha256 || ""),
        kind: String(item.kind || "FILE_OUTPUT"),
      };
      await saveWorkspaceState(workspace, taskState);
    }
    await report("FINALIZING", 95, "正在提交最终成片和任务完成状态");
    await api(`/api/v1/ai-tasks/runner/tasks/${taskId}/complete`, {
      method: "POST",
      body: JSON.stringify({
        nodeCode,
        result,
        logs: {
          skill: currentSkill,
          skillVersion: record(result.execution).skillVersion,
          workspace,
          executionLog: "logs/execution.ndjson",
        },
      }),
    });
    taskState.stage = "COMPLETE";
    taskState.updatedAt = new Date().toISOString();
    await saveWorkspaceState(workspace, taskState);
    await appendExecutionLog(workspace, "TASK_COMPLETE", { skill: currentSkill });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Codex执行失败";
    process.stderr.write(`${new Date().toISOString()} ${taskNo} ${message}\n`);
    const recovery = await attemptExecutionRepair(workspace, message).catch((repairError) => ({
      repaired: false,
      exhausted: false,
      action: undefined,
      attempt: undefined,
      decision: classifyExecutionFailure(
        `${message}\nRepair failed: ${repairError instanceof Error ? repairError.message : String(repairError)}`,
      ),
    }));
    if (recovery.repaired) {
      retryInternally = true;
      await appendExecutionLog(workspace, "REPAIR_RESUME", {
        category: recovery.decision.category,
        action: recovery.action,
        internalAttempt: recovery.attempt,
      }).catch(() => undefined);
      await checkpoint(taskId, "RECOVERING", state?.stage === "UPLOADING" ? 85 : 25, "正在自动恢复执行环境并继续制作", {
        currentSkill,
        internalRecovery: true,
      }).catch(() => undefined);
    } else {
    await appendExecutionLog(workspace, "TASK_FAILED", {
      skill: currentSkill || "未探测",
      error: message,
      errorType: error instanceof Error ? error.name : "UnknownError",
    }).catch(() => undefined);
    await api(`/api/v1/ai-tasks/runner/tasks/${taskId}/fail`, {
      method: "POST",
      body: JSON.stringify({
        nodeCode,
        message,
        logs: {
          skill: currentSkill || "未探测",
          workspace,
          executionLog: "logs/execution.ndjson",
        },
      }),
    }).catch(() => undefined);
    }
  } finally {
    clearInterval(heartbeat);
  }
  if (retryInternally) await execute(claimed);
}

async function main() {
  await mkdir(workRoot, { recursive: true });
  // Material indexing must never delay task claiming. This is especially
  // important for Codex direct-output jobs, which do not consume assets.
  syncSystemMaterialIndexInBackground(true);
  const activeTasks = new Map<string, { kind: "VIDEO" | "IMAGE"; promise: Promise<void> }>();
  for (;;) {
    try {
      const activeVideo = activeKindCount(activeTasks, "VIDEO");
      const activeImage = activeKindCount(activeTasks, "IMAGE");
      const supportedRouteKeys = availableClaimRouteKeys(
        activeVideo,
        activeImage,
        maxVideoConcurrency,
        maxImageConcurrency,
      );
      // Video and image projects keep separate local concurrency pools so a
      // long video render never blocks image posts (and vice versa). When a
      // pool is full the API is told not to hand this node a task of that kind.
      if (!supportedRouteKeys.length) {
        await Promise.race([...activeTasks.values()].map((entry) => entry.promise));
        continue;
      }
      const claimed = await api<JsonRecord>("/api/v1/ai-tasks/runner/claim", {
        method: "POST",
        body: JSON.stringify({
          nodeCode,
          version: runnerVersion,
          // IMAGE_POST is intentionally opt-in. The API uses this declaration
          // to keep image-project jobs away from legacy generic imagegen nodes.
          supportedExecutionModes: ["IMAGE_POST"],
          // Route keys are business capabilities, not broad AiTask enums. When
          // present, the API will not let this unified node claim articles,
          // topic cards, analyses, generic images, or ambiguous legacy jobs.
          supportedRouteKeys,
        }),
      });
      if (claimed.task) {
        const claimedTask = record(claimed.task);
        const taskId = String(claimedTask.id || claimedTask.taskNo || `task-${Date.now()}`);
        const kind = String(claimedTask.type || "").toUpperCase() === "VIDEO" ? "VIDEO" : "IMAGE";
        const execution = execute(claimed)
          .catch((error) => {
            process.stderr.write(`${new Date().toISOString()} ${taskId} ${error instanceof Error ? error.message : String(error)}\n`);
          })
          .finally(() => activeTasks.delete(taskId));
        activeTasks.set(taskId, { kind, promise: execution });
        // Give the API a brief moment to persist the lock before looking for a
        // different task type. Server-side per-type concurrency remains the
        // authority; this only removes the worker's accidental global lock.
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
      } else {
        syncSystemMaterialIndexInBackground();
        await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
      }
    } catch (error) {
      process.stderr.write(`${new Date().toISOString()} ${error instanceof Error ? error.message : String(error)}\n`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
    }
  }
}

void main();
