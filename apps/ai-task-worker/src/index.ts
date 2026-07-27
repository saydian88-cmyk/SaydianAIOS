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
const runnerVersion = String(process.env.AI_TASK_RUNNER_VERSION || "1.1.0");
const workRoot = resolve(String(process.env.AI_TASK_WORKDIR || join(process.cwd(), ".ai-task-runner")));
const pollMs = Math.max(2_000, Number(process.env.AI_TASK_POLL_MS || 10_000));
const codexExecutable = String(process.env.CODEX_EXECUTABLE || (process.platform === "win32" ? "codex.cmd" : "codex"));
const ffmpegExecutable = String(process.env.FFMPEG_EXECUTABLE || "ffmpeg");
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

function outputSchema(type: string) {
  if (type === "VIDEO") {
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
            missingAssets: { type: "array", items: { type: "string" } },
            scriptCandidates: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  hook: { type: "string" },
                  script: { type: "string" },
                  shots: { type: "array", items: { type: "string" } },
                  cta: { type: "string" },
                  selected: { type: "boolean" },
                },
                required: ["title", "hook", "script", "shots", "cta", "selected"],
              },
            },
          },
          required: [
            "platform", "productModel", "topic", "audience", "objective", "keywordIds",
            "externalVideoIds", "routingMode", "allowFallback", "missingAssets", "scriptCandidates",
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
  const type = String(task.type || "");
  const instructions: Record<string, string> = {
    VIDEO: "生成3套脚本候选并选择主方案。只提取外部爆款的Hook、节奏和结构，不复用外部商业镜头。",
    IMAGE: "生成可执行的图片生成任务书。若本机已有可用图片生成能力，可生成文件并写入outputFiles；否则保持outputFiles为空。",
    ARTICLE: "生成公众号、小红书和企业微信版本。每段简短，产品事实只能来自输入快照。",
    STORE_ANALYSIS: "先依据确定性指标和异常数据，再解释原因、影响和可执行动作。证据不足的判断标记为推断。",
    COMPETITOR_ANALYSIS: "分析竞品商品、价格、内容和关键词变化，输出机会及待确认行动，禁止虚构竞品数据。",
    LIVE_ANALYSIS: "完成直播前方案或直播后复盘，输出切片建议、话术调整和下一场行动。",
  };
  return [
    "你是赛电总管理后台AI任务中心的Codex执行器。",
    instructions[type] || "按输入快照完成任务。",
    "必须以提供的JSON快照为事实边界；缺失数据明确写未配置或缺失，不编造数据、认证、费用和执行结果。",
    "优先使用manifest中已审核真实素材。VIDEO任务只设计和使用本地inputs目录内的素材；缺少的镜头写入project.missingAssets。",
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
  if (existingFiles.some((item) => String(item.kind || "") === "VIDEO_MASTER")) return result;
  const assets = (Array.isArray(taskPackageValue.assets) ? taskPackageValue.assets.map(record) : [])
    .filter((asset) => ["VIDEO", "IMAGE"].includes(String(asset.kind || "")) && asset.workspacePath);
  const project = record(result.project);
  if (!assets.length) {
    const missing = Array.isArray(project.missingAssets) ? project.missingAssets.map(String) : [];
    project.missingAssets = missing.length ? missing : ["缺少可用于本地合成的已审核图片或视频素材"];
    result.project = project;
    return result;
  }

  const outputsDir = join(workspace, "outputs");
  const renderDir = join(workspace, "render");
  await mkdir(outputsDir, { recursive: true });
  await mkdir(renderDir, { recursive: true });
  const candidates = Array.isArray(project.scriptCandidates) ? project.scriptCandidates.map(record) : [];
  const selected = candidates.find((item) => item.selected === true) || candidates[0] || {};
  const shotTexts = Array.isArray(selected.shots) ? selected.shots.map(String).filter(Boolean) : [];
  const clips: string[] = [];
  const clipCount = Math.min(Math.max(shotTexts.length, 3), Math.min(assets.length, 6));
  for (let index = 0; index < clipCount; index += 1) {
    const asset = assets[index % assets.length]!;
    const inputPath = resolve(workspace, String(asset.workspacePath));
    const outputPath = join(renderDir, `clip-${String(index + 1).padStart(2, "0")}.mp4`);
    const duration = 4;
    const isImage = String(asset.kind) === "IMAGE";
    const args = isImage
      ? [
        "-y", "-loop", "1", "-i", inputPath, "-t", String(duration),
        "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,zoompan=z='min(zoom+0.0015,1.08)':d=120:s=1080x1920:fps=30",
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", outputPath,
      ]
      : [
        "-y", "-i", inputPath, "-t", String(duration),
        "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,fps=30",
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", outputPath,
      ];
    await execFileAsync(ffmpegExecutable, args, { timeout: 300_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    clips.push(outputPath);
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

  const captions = clips.map((_, index) => {
    const start = index * 4;
    const end = start + 4;
    const text = index === 0
      ? String(selected.hook || project.topic || task.title || "")
      : index === clips.length - 1
        ? String(selected.cta || project.objective || "")
        : shotTexts[index] || String(selected.script || "");
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
  existingFiles.push({
    path: relative(workspace, masterPath).replaceAll("\\", "/"),
    kind: "VIDEO_MASTER",
    title: `${String(project.topic || task.title || "智能视频")} · 主成片`,
    metadata: {
      description: `Codex本地合成，复用${clips.length}个已审核素材`,
      source: "CODEX_LOCAL_FFMPEG",
    },
  });
  result.outputFiles = existingFiles;
  result.summary = `${String(result.summary || "")} 已使用${clips.length}个已审核素材完成本地主成片。`.trim();
  return result;
}

async function runCodex(taskPackage: JsonRecord, workspace: string, timeoutSeconds: number) {
  const task = record(taskPackage.task);
  const schemaPath = join(workspace, "output-schema.json");
  const resultPath = join(workspace, "result.json");
  await writeFile(schemaPath, JSON.stringify(outputSchema(String(task.type || "")), null, 2), "utf8");
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
    const files = String(task.type || "") === "VIDEO" && String(execution.mode || "") === "SCRIPT_ONLY"
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
