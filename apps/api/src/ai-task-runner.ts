import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const apiUrl = String(process.env.AI_TASK_API_URL || "https://stest.saydian.cn").replace(/\/+$/, "");
const runnerToken = String(process.env.AI_TASK_RUNNER_TOKEN || "");
const nodeCode = String(process.env.AI_TASK_RUNNER_NODE_CODE || "windows-codex-01");
const runnerVersion = String(process.env.AI_TASK_RUNNER_VERSION || "1.0.0");
const workRoot = resolve(String(process.env.AI_TASK_WORKDIR || join(process.cwd(), ".ai-task-runner")));
const pollMs = Math.max(2_000, Number(process.env.AI_TASK_POLL_MS || 10_000));
const codexExecutable = String(process.env.CODEX_EXECUTABLE || (process.platform === "win32" ? "codex.cmd" : "codex"));

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
        metadata: { type: "object", additionalProperties: true },
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
            scriptCandidates: { type: "array", items: { type: "object", additionalProperties: true } },
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
            scoreBreakdown: { type: "object", additionalProperties: true },
            outline: { type: "array", items: { type: "string" } },
            evidenceIds: { type: "array", items: { type: "string" } },
            riskReasons: { type: "array", items: { type: "string" } },
            keywords: { type: "array", items: { type: "string" } },
            variants: {
              type: "object",
              additionalProperties: { type: "string" },
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
          additionalProperties: true,
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
      sections: { type: "array", items: { type: "object", additionalProperties: true } },
      metrics: { type: "object", additionalProperties: true },
      findings: { type: "array", items: { type: "object", additionalProperties: true } },
      actions: { type: "array", items: { type: "object", additionalProperties: true } },
    },
    required: ["summary", "outputFiles", "sections", "metrics", "findings", "actions"],
  };
}

function prompt(task: JsonRecord) {
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
    "输出必须符合output schema。outputFiles只能引用当前任务工作区内真实存在的文件。",
    `任务JSON：\n${JSON.stringify(task, null, 2)}`,
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

async function runCodex(task: JsonRecord, workspace: string, timeoutSeconds: number) {
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
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Codex执行超时（${timeoutSeconds}秒）`));
    }, timeoutSeconds * 1_000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    child.stdout.on("data", () => undefined);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error(stderr || `Codex退出码 ${code}`));
    });
    child.stdin.end(prompt(task));
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
    await api(`/api/v1/ai-tasks/runner/tasks/${taskId}/progress`, {
      method: "POST",
      body: JSON.stringify({ nodeCode, status: "RUNNING", progress: 15, message: "Codex正在生成结构化结果" }),
    });
    const result = await runCodex(task, workspace, timeoutSeconds);
    await api(`/api/v1/ai-tasks/runner/tasks/${taskId}/progress`, {
      method: "POST",
      body: JSON.stringify({ nodeCode, status: "QUALITY_CHECK", progress: 75, message: "正在校验和上传结果" }),
    });
    const files = Array.isArray(result.outputFiles) ? result.outputFiles : [];
    for (const raw of files) await uploadFile(taskId, workspace, raw as JsonRecord);
    await api(`/api/v1/ai-tasks/runner/tasks/${taskId}/complete`, {
      method: "POST",
      body: JSON.stringify({ nodeCode, result }),
    });
  } catch (error) {
    await api(`/api/v1/ai-tasks/runner/tasks/${taskId}/fail`, {
      method: "POST",
      body: JSON.stringify({
        nodeCode,
        message: error instanceof Error ? error.message : "Codex执行失败",
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
