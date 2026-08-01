import "dotenv/config";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { safeName, sha256, verifySha256 } from "./worker-utils";
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
const codexExecutable = String(process.env.CODEX_EXECUTABLE || (process.platform === "win32" ? "codex.cmd" : "codex"));
const ffmpegExecutable = String(process.env.FFMPEG_EXECUTABLE || "ffmpeg");
const ffprobeExecutable = String(process.env.FFPROBE_EXECUTABLE || "ffprobe");
const execFileAsync = promisify(execFile);
const systemMaterialRoot = join(workRoot, "system-material-library");
const systemMaterialAssetsRoot = join(systemMaterialRoot, "assets");
const systemMaterialIndexPath = join(systemMaterialRoot, "material-index.json");
const systemMaterialStatePath = join(systemMaterialRoot, "sync-state.json");
const localMediaLibraryRoot = resolve(String(process.env.AI_TASK_LOCAL_MEDIA_LIBRARY || "F:\\赛电品牌素材库"));
const localSystemMaterialMapPath = join(localMediaLibraryRoot, ".saidian-system-index", "system-asset-map.json");
let lastMaterialSyncAt = 0;

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

function outputSchema(type: string, executionMode = "", requestedCardCount = 10) {
  if (type === "VIDEO") {
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
      },
      required: ["summary", "outputFiles", "imageBrief"],
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
        "任务包中的assets与materialBindings是本次任务的唯一素材白名单，禁止从本地素材库另选白名单外素材。",
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
        ? "单脚本必须保持亲切导购型口吻：有态度或生活处境开头，短句推进，先讲用户利益再讲功能，用具体动作代替“支持、具备、可以”等说明书句式；中段至少一次轻反差或价值发现，结尾使用与本条核心内容相关的自然选择建议。写脚本前必须先检索任务包assets中的已学习素材索引，优先围绕高置信度真实VIDEO素材反向设计口播和镜头；不得先写完脚本再泛化找素材。scriptPackage是系统编辑器的统一数据源，必须完整填写；voiceoverLines与shotRequirements使用相同稳定lineId。每条shotRequirement都必须返回matchedVideoAssetIds和auxiliaryImageAssetIds；有直接对应真实视频时assetStatus必须为COVERED且matchedVideoAssetIds至少包含一个任务包内真实素材ID。只有逐项检索后确实没有直接视频证据时才能返回空数组并标记REWRITABLE或NEED_SHOOT，materialGaps也只能包含这些真实缺口。candidate.script只能由voiceoverLines.text按换行拼接，只含干净口播，禁止混入lineId、预计时长、账号说明、素材缺口或健康提示。健康提示只写入scriptPackage.overlayNotice，不写入口播。"
        : "脚本、画面、配音、包装和质检均以视频 Skill 的硬性规则为准；系统提示只能在不冲突时补充方向。",
    ].join("\n")
    : "";
  return [
    "你是赛电总管理后台AI任务中心的Codex执行器。",
    skillInstruction,
    instructions[type] || "按输入快照完成任务。",
    requiredVideoSkill,
    videoInstructionPriority,
    "必须以提供的JSON快照为事实边界；缺失数据明确写未配置或缺失，不编造数据、认证、费用和执行结果。",
    "优先使用manifest中已审核真实素材。VIDEO脚本生成必须先按产品、功能、动作、场景和景别检索素材索引，再围绕命中的真实VIDEO素材写逐句脚本；每个已覆盖镜头必须通过matchedVideoAssetIds或selectedAssetIds回传任务包内的具体素材ID。不得把已存在但未回传ID的素材算作已覆盖，也不得为了写更宽泛的文案而忽略已有素材。只有检索后确实不存在直接对应视频时才写清missingReason、alternativePlan和missingAssets，不得拿文件顺序代替镜头匹配。",
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

async function verifyVideoSkillRuntime(taskPackageValue: JsonRecord, detectedSkill: DetectedSkill) {
  const task = record(taskPackageValue.task);
  const execution = record(taskPackageValue.execution);
  if (String(task.type || "") !== "VIDEO"
    || !["FULL_VIDEO", "SCRIPT_ONLY", "SIMILAR_VIDEO", "NO_VOICE_VIDEO", "COVER_TITLE"].includes(String(execution.mode || ""))
    || !["saidian-ai-task-dispatcher", "saydian-douyin-viral-video-generator"].includes(detectedSkill.key)) return;
  if (detectedSkill.key === "saydian-douyin-viral-video-generator") return;
  const downstreamPath = String(detectedSkill.downstreamSkillPath || "");
  if (!downstreamPath) throw new Error("调度Skill未配置下游视频剪辑Skill");
  const downstream = await stat(downstreamPath);
  if (!downstream.isFile()) throw new Error("本地视频剪辑Skill不可用");
}

async function downloadInputs(taskPackageValue: JsonRecord, workspace: string): Promise<JsonRecord> {
  const inputsDir = join(workspace, "inputs");
  await mkdir(inputsDir, { recursive: true });
  const assets = Array.isArray(taskPackageValue.assets) ? taskPackageValue.assets.map(record) : [];
  const localMaterialMap = (await readJson<JsonRecord>(localSystemMaterialMapPath).catch(() => undefined)) || {};
  const downloaded: JsonRecord[] = [];
  const prioritizedAssets = [...assets].sort((left, right) => {
    const priority = (asset: JsonRecord) => String(asset.kind || "").toUpperCase() === "VIDEO" ? 0 : 1;
    return priority(left) - priority(right);
  });
  for (const asset of prioritizedAssets.slice(0, 30)) {
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
          if (!expectedHash || verifySha256(local, expectedHash)) buffer = local;
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
    if (!verifySha256(buffer, expectedHash)) throw new Error(`素材校验失败：${id}`);
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
  if (["saidian-ai-task-dispatcher", "saydian-douyin-viral-video-generator"].includes(String(execution.requiredSkill || ""))) {
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
  )), null, 2), "utf8");
  await writeFile(join(workspace, "task.json"), JSON.stringify(task, null, 2), "utf8");
  const args = [
    "exec", "--ephemeral", "--skip-git-repo-check", "--output-schema", schemaPath, "--json",
    "--sandbox", "workspace-write", "-c", "approval_policy=\"never\"",
    "--cd", workspace, "--output-last-message", resultPath, "-",
  ];
  let stdout = "";
  let stderr = "";
  try {
    await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(codexExecutable, args, {
      cwd: workspace,
      env: process.env,
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(codexExecutable),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Codex执行超时（${timeoutSeconds}秒）`));
    }, timeoutSeconds * 1_000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error(stderr || stdout || `Codex退出码 ${code}`));
    });
    child.stdin.end(prompt(taskPackage, detectedSkill));
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
  form.set("metadata", JSON.stringify(item.metadata || {}));
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
  const timeoutSeconds = Math.max(60, Number((claimed.policy as JsonRecord)?.timeoutSeconds || 1200));
  const workspace = join(workRoot, taskNo.replace(/[^a-zA-Z0-9_-]/g, "-"));
  await ensureTaskWorkspace(workspace);
  let currentSkill = "";
  let state: WorkspaceState | undefined;
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
    await report("PACKAGE", 10, "正在下载任务快照和已审核素材");
    const packageValue = await taskPackage(taskId);
    const route = routeTask(packageValue);
    const detectedSkill = await detectSkill(route);
    currentSkill = detectedSkill.name;
    const packaged = await downloadInputs(packageValue, workspace);
    await writeJsonAtomic(join(workspace, "task.json"), record(packaged.task));
    const fingerprint = packageFingerprint(packaged);
    const previousState = await loadWorkspaceState(workspace);
    const resumeEligible = canResume(previousState, fingerprint, detectedSkill.digest);
    const taskState: WorkspaceState = resumeEligible && previousState
      ? previousState
      : freshWorkspaceState(fingerprint, detectedSkill.digest);
    state = taskState;
    await saveWorkspaceState(workspace, taskState);
    await appendExecutionLog(workspace, "SKILL_SELECTED", {
      skill: detectedSkill.name,
      version: detectedSkill.version,
      digest: detectedSkill.digest,
      strategy: detectedSkill.strategy,
      executionMode: detectedSkill.executionMode,
      resumed: resumeEligible,
    });
    await report("SKILL_DETECTED", 15, `已选择 ${detectedSkill.name}`, {
      skillVersion: detectedSkill.version,
      strategy: detectedSkill.strategy,
      executionMode: detectedSkill.executionMode,
    });
    await verifyVideoSkillRuntime(packaged, detectedSkill);

    const execution = record(packaged.execution);
    const snapshots = Array.isArray(packaged.snapshots) ? packaged.snapshots.map(record) : [];
    const snapshotPayload = record(snapshots[0]?.payload);
    const requirements = record(snapshotPayload.requirements);
    const schema = outputSchema(
      String(task.type || ""),
      String(execution.mode || ""),
      Number(requirements.exactCount || 10),
    );
    const startedAt = new Date();
    let result: JsonRecord | undefined;
    let schemaAttempts = 1;
    if (resumeEligible && ["QUALITY_CHECK", "UPLOADING", "COMPLETE"].includes(String(taskState.stage || ""))) {
      const savedResult = await readJson<JsonRecord>(join(workspace, "result.json"));
      if (savedResult) {
        try {
          validateResult(savedResult, schema, true);
          if (String(task.type || "") === "VIDEO" && String(execution.mode || "") === "SCRIPT_ONLY") {
            validateVideoScriptMaterialIds(savedResult, Array.isArray(packaged.assets) ? packaged.assets : []);
          }
          result = await validateOutputArtifacts(savedResult, workspace);
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
    }

    if (!result) {
      await report("CODEX", 25, `正在使用 ${detectedSkill.name} 生成结构化结果`, {
        skillVersion: detectedSkill.version,
        assetCount: Array.isArray(packaged.assets) ? packaged.assets.length : 0,
      });
      const generated = await runWithSchemaRetry(
        async (schemaAttempt) => {
          await appendExecutionLog(workspace, "CODEX_ATTEMPT", { schemaAttempt });
          return runCodex(packaged, detectedSkill, workspace, timeoutSeconds, schemaAttempt);
        },
        (candidate) => {
          validateResult(candidate, schema);
          if (String(task.type || "") === "VIDEO" && String(execution.mode || "") === "SCRIPT_ONLY") {
            validateVideoScriptMaterialIds(candidate, Array.isArray(packaged.assets) ? packaged.assets : []);
          }
          return candidate;
        },
        2,
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
      validateResult(result, schema, true);
      if (String(task.type || "") === "VIDEO" && String(execution.mode || "") === "SCRIPT_ONLY") {
        validateVideoScriptMaterialIds(result, Array.isArray(packaged.assets) ? packaged.assets : []);
      }
      await writeJsonAtomic(join(workspace, "result.json"), result);
    } else {
      schemaAttempts = Number(record(result.execution).schemaAttempts || 1);
      validateResult(result, schema, true);
      if (String(task.type || "") === "VIDEO" && String(execution.mode || "") === "SCRIPT_ONLY") {
        validateVideoScriptMaterialIds(result, Array.isArray(packaged.assets) ? packaged.assets : []);
      }
      await writeJsonAtomic(join(workspace, "result.json"), result);
    }

    await report("QUALITY_CHECK", 78, "result.json与产物哈希校验通过", {
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
    taskState.stage = "COMPLETE";
    taskState.updatedAt = new Date().toISOString();
    await saveWorkspaceState(workspace, taskState);
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
    await appendExecutionLog(workspace, "TASK_COMPLETE", { skill: currentSkill });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Codex执行失败";
    process.stderr.write(`${new Date().toISOString()} ${taskNo} ${message}\n`);
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
  } finally {
    clearInterval(heartbeat);
  }
}

async function main() {
  await mkdir(workRoot, { recursive: true });
  await syncSystemMaterialIndex(true).catch((error) => {
    process.stderr.write(`${new Date().toISOString()} system-material-index ${error instanceof Error ? error.message : String(error)}\n`);
  });
  for (;;) {
    try {
      await syncSystemMaterialIndex();
      const claimed = await api<JsonRecord>("/api/v1/ai-tasks/runner/claim", {
        method: "POST",
        body: JSON.stringify({ nodeCode, version: runnerVersion }),
      });
      if (claimed.task) await execute(claimed);
      else await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
    } catch (error) {
      process.stderr.write(`${new Date().toISOString()} ${error instanceof Error ? error.message : String(error)}\n`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
    }
  }
}

void main();
