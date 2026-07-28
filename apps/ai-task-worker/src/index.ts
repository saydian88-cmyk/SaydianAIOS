import "dotenv/config";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { safeName, sha256, verifySha256 } from "./worker-utils";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

const apiUrl = String(process.env.AI_TASK_API_URL || "https://stest.saydian.cn").replace(/\/+$/, "");
const runnerToken = String(process.env.AI_TASK_RUNNER_TOKEN || "");
const nodeCode = String(process.env.AI_TASK_RUNNER_NODE_CODE || "windows-codex-01");
const runnerVersion = String(process.env.AI_TASK_RUNNER_VERSION || "2.1.0");
const workRoot = resolve(String(process.env.AI_TASK_WORKDIR || join(process.cwd(), ".ai-task-runner")));
const pollMs = Math.max(2_000, Number(process.env.AI_TASK_POLL_MS || 10_000));
const codexExecutable = String(process.env.CODEX_EXECUTABLE || (process.platform === "win32" ? "codex.cmd" : "codex"));
const ffmpegExecutable = String(process.env.FFMPEG_EXECUTABLE || "ffmpeg");
const ffprobeExecutable = String(process.env.FFPROBE_EXECUTABLE || "ffprobe");
const execFileAsync = promisify(execFile);

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
          additionalProperties: false,
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
              minItems: 3,
              maxItems: 3,
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
                },
                required: [
                  "title", "hook", "script", "shots", "cta", "score", "scoreBreakdown",
                  "templateCode", "missingAssets", "selected",
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

function prompt(taskPackage: JsonRecord) {
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
      `必须生成恰好${cardCount}张${String(payload.platform || task.platform || "")}视频选题卡，只生成卡片，不创建脚本、视频文件或付费模型任务。`,
      "每张卡必须使用输入快照中已审核产品，引用真实keywordIds；没有产品事实或关键词依据的内容不能进入结果。",
      "外部爆款只允许提取Hook模式、节奏、镜头结构和CTA模式，不能复制竞品品牌名、价格、产品承诺、标题或商业素材。",
      "按平台、产品、关键词簇、人群、痛点和主配方主动去重；合并大小写、空格、连字符和明显错别字。",
      "机会分必须严格使用输入中的九项权重；素材覆盖率只计算manifest内已审核、启用且可商用素材。",
      "每张卡给出3个不同Hook、主配方和备用配方；不能确认的事实放入missingFacts，禁止补写。",
      "outputFiles必须为空数组。输出必须符合output schema。",
      `任务包JSON：\n${JSON.stringify(taskPackage, null, 2)}`,
    ].join("\n\n");
  }
  const instructions: Record<string, string> = {
    VIDEO: "生成恰好3套脚本候选并选择1套主方案。每套包含标题、Hook、正文、CTA、评分、评分依据、结构化分镜和逐镜头素材建议。只提取外部爆款的Hook、节奏和结构，不复用外部商业镜头。",
    IMAGE: "本任务必须调用 $imagegen Skill，使用Codex内置图片生成能力完成图片成品并写入outputFiles。不得调用或要求配置第三方图片模型；生成前读取产品图片和任务快照，成品保存到当前任务工作区。",
    ARTICLE: "本任务必须调用 $build-health-brand-trust-content Skill，生成公众号、小红书和企业微信版本。每段简短，产品事实只能来自输入快照，不得调用或要求配置第三方文本模型。",
    STORE_ANALYSIS: "先依据确定性指标和异常数据，再解释原因、影响和可执行动作。证据不足的判断标记为推断。",
    COMPETITOR_ANALYSIS: "分析竞品商品、价格、内容和关键词变化，输出机会及待确认行动，禁止虚构竞品数据。",
    LIVE_ANALYSIS: "完成直播前方案或直播后复盘，输出切片建议、话术调整和下一场行动。",
  };
  const requiredVideoSkill = type === "VIDEO" && executionMode === "FULL_VIDEO"
    ? [
      "本任务必须使用 $video-editing-from-media-library-share 完成正式剪辑，并完整遵循该Skill的初始化、素材只读、镜头连续性、内容禁止库、质检和交付规则。",
      `先验证本机active-config.json及全部根目录和索引均为ready和在线；health_content_allowed=${execution.healthContentAllowed !== false ? "true" : "false"}。`,
      "主时间线只能使用真实视频素材。图片、详情图和产品图只能作为绑定underlying_shot_id的短时辅助层，禁止图片轮播、静态图推拉或无关镜头补时长。",
      "每个功能镜头必须有直接对应画面；任何reshoot缺口都要停止受影响成片渲染，并输出明确补拍清单。",
      "最终必须输出该Skill质检通过的1080×1920、30fps MP4，并在outputFiles中登记为VIDEO_MASTER。",
    ].join("\n")
    : "";
  return [
    "你是赛电总管理后台AI任务中心的Codex执行器。",
    instructions[type] || "按输入快照完成任务。",
    requiredVideoSkill,
    "必须以提供的JSON快照为事实边界；缺失数据明确写未配置或缺失，不编造数据、认证、费用和执行结果。",
    "优先使用manifest中已审核真实素材。VIDEO任务的每个镜头必须通过selectedAssetIds绑定具体素材ID；缺少素材时写清missingReason、alternativePlan和missingAssets，不得拿文件顺序代替镜头匹配。",
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

async function verifyVideoSkillRuntime(taskPackageValue: JsonRecord) {
  const task = record(taskPackageValue.task);
  const execution = record(taskPackageValue.execution);
  if (String(task.type || "") !== "VIDEO" || String(execution.mode || "") !== "FULL_VIDEO") return;
  if (String(execution.requiredSkill || "") !== "video-editing-from-media-library-share") {
    throw new Error("完整视频任务未指定video-editing-from-media-library-share");
  }
  const localAppData = String(process.env.LOCALAPPDATA || "");
  if (!localAppData) throw new Error("本机LOCALAPPDATA不可用，无法验证视频剪辑Skill");
  const activePath = join(localAppData, "Codex", "video-editing-from-media-library-share", "active-config.json");
  const active = record(JSON.parse(await readFile(activePath, "utf8")));
  const configPath = String(active.config_path || "");
  if (!configPath) throw new Error("视频剪辑Skill未初始化");
  const config = record(JSON.parse(await readFile(configPath, "utf8")));
  if (String(config.skill_name || "") !== "video-editing-from-media-library-share"
    || String(config.initialization_status || "") !== "ready"
    || String(active.computer_id || "") !== String(config.computer_id || "")) {
    throw new Error("视频剪辑Skill本机配置未就绪");
  }
  for (const field of ["library_root", "packaging_root", "workspace_root", "output_root", "config_root", "material_index", "packaging_index"]) {
    const path = String(config[field] || "");
    if (!path) throw new Error(`视频剪辑Skill缺少${field}`);
    await stat(path);
  }
}

async function downloadInputs(taskPackageValue: JsonRecord, workspace: string) {
  const inputsDir = join(workspace, "inputs");
  await mkdir(inputsDir, { recursive: true });
  const assets = Array.isArray(taskPackageValue.assets) ? taskPackageValue.assets.map(record) : [];
  const downloaded: JsonRecord[] = [];
  for (const asset of assets.slice(0, 30)) {
    const id = String(asset.id || `asset-${downloaded.length + 1}`);
    const extension = String(asset.extension || extname(String(asset.displayName || "")) || (String(asset.kind) === "IMAGE" ? ".jpg" : ".mp4"));
    const target = join(inputsDir, `${safeName(id)}${extension.startsWith(".") ? extension : `.${extension}`}`);
    let buffer: Buffer | undefined;
    const downloadUrl = String(asset.downloadUrl || "");
    const localPath = String(asset.localPath || "");
    if (downloadUrl) {
      const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok) continue;
      buffer = Buffer.from(await response.arrayBuffer());
    } else if (localPath) {
      try {
        buffer = await readFile(localPath);
      } catch {
        buffer = undefined;
      }
    }
    if (!buffer) continue;
    const expectedHash = String(asset.sha256 || "").toLowerCase();
    const actualHash = sha256(buffer);
    if (!verifySha256(buffer, expectedHash)) throw new Error(`素材校验失败：${id}`);
    await writeFile(target, buffer);
    downloaded.push({
      ...asset,
      downloadUrl: undefined,
      localPath: undefined,
      workspacePath: relative(workspace, target).replaceAll("\\", "/"),
      sha256: actualHash,
    });
  }
  const packaged = {
    ...taskPackageValue,
    assets: downloaded,
  };
  await writeFile(join(workspace, "snapshot.json"), JSON.stringify(taskPackageValue.snapshots || [], null, 2), "utf8");
  await writeFile(join(workspace, "manifest.json"), JSON.stringify(downloaded, null, 2), "utf8");
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
  if (String(execution.requiredSkill || "") === "video-editing-from-media-library-share") {
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

async function runCodex(taskPackage: JsonRecord, workspace: string, timeoutSeconds: number) {
  const task = record(taskPackage.task);
  const execution = record(taskPackage.execution);
  const snapshots = Array.isArray(taskPackage.snapshots) ? taskPackage.snapshots.map(record) : [];
  const snapshotPayload = record(snapshots[0]?.payload);
  const requirements = record(snapshotPayload.requirements);
  const schemaPath = join(workspace, "output-schema.json");
  const resultPath = join(workspace, "result.json");
  await writeFile(schemaPath, JSON.stringify(outputSchema(
    String(task.type || ""),
    String(execution.mode || ""),
    Number(requirements.exactCount || 10),
  ), null, 2), "utf8");
  await writeFile(join(workspace, "task.json"), JSON.stringify(task, null, 2), "utf8");
  const args = [
    "exec", "--ephemeral", "--skip-git-repo-check", "--output-schema", schemaPath, "--json",
    "--sandbox", "workspace-write", "-c", "approval_policy=\"never\"",
    "--cd", workspace, "--output-last-message", resultPath, "-",
  ];
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(codexExecutable, args, {
      cwd: workspace,
      env: process.env,
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(codexExecutable),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Codex执行超时（${timeoutSeconds}秒）`));
    }, timeoutSeconds * 1_000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 20_000) stdout = stdout.slice(-20_000);
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
    child.stdin.end(prompt(taskPackage));
  });
  const content = await readFile(resultPath, "utf8");
  return JSON.parse(content) as JsonRecord;
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
}

async function execute(claimed: JsonRecord) {
  const task = claimed.task as JsonRecord;
  const taskId = String(task.id || "");
  const taskNo = String(task.taskNo || taskId);
  const timeoutSeconds = Math.max(60, Number((claimed.policy as JsonRecord)?.timeoutSeconds || 1200));
  const workspace = join(workRoot, taskNo.replace(/[^a-zA-Z0-9_-]/g, "-"));
  await rm(workspace, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });
  const heartbeat = setInterval(() => {
    void api(`/api/v1/ai-tasks/runner/tasks/${taskId}/heartbeat`, {
      method: "POST",
      body: JSON.stringify({ nodeCode }),
    }).catch(() => undefined);
  }, 30_000);
  try {
    await checkpoint(taskId, "PACKAGE", 10, "正在下载任务快照和已审核素材");
    const packaged = await downloadInputs(await taskPackage(taskId), workspace);
    await verifyVideoSkillRuntime(packaged);
    await checkpoint(taskId, "CODEX", 25, "Codex正在生成结构化结果", {
      assetCount: Array.isArray(packaged.assets) ? packaged.assets.length : 0,
    });
    let result = await runCodex(packaged, workspace, timeoutSeconds);
    await checkpoint(taskId, "LOCAL_RENDER", 65, "正在优先使用本地素材生成成片");
    result = await renderLocalVideo(result, packaged, workspace);
    await writeFile(join(workspace, "result.json"), JSON.stringify(result, null, 2), "utf8");
    await checkpoint(taskId, "QUALITY_CHECK", 78, "正在校验和上传结果");
    const execution = record(record(packaged).execution);
    const structuredOnlyKinds = new Set(["SCRIPT_CANDIDATES", "VIDEO_SCRIPT", "STORYBOARD_JSON", "STRUCTURED_RESULT"]);
    const generatedFiles = Array.isArray(result.outputFiles) ? result.outputFiles : [];
    const files = String(task.type || "") === "VIDEO"
      && ["SCRIPT_ONLY", "TOPIC_CARD_BATCH"].includes(String(execution.mode || ""))
      ? []
      : generatedFiles.filter((item) => !structuredOnlyKinds.has(String(record(item).kind || "").toUpperCase()));
    for (const raw of files) {
      await checkpoint(taskId, "UPLOADING", 85, `正在上传${String((raw as JsonRecord).title || "任务输出")}`);
      await uploadFile(taskId, workspace, raw as JsonRecord);
    }
    await api(`/api/v1/ai-tasks/runner/tasks/${taskId}/complete`, {
      method: "POST",
      body: JSON.stringify({ nodeCode, result }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Codex执行失败";
    process.stderr.write(`${new Date().toISOString()} ${taskNo} ${message}\n`);
    await api(`/api/v1/ai-tasks/runner/tasks/${taskId}/fail`, {
      method: "POST",
      body: JSON.stringify({
        nodeCode,
        message,
      }),
    }).catch(() => undefined);
  } finally {
    clearInterval(heartbeat);
  }
}

async function main() {
  await mkdir(workRoot, { recursive: true });
  for (;;) {
    try {
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
