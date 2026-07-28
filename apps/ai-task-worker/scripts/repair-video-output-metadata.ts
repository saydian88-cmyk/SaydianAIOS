import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import dotenv from "dotenv";

type JsonRecord = Record<string, unknown>;

const execFileAsync = promisify(execFile);
const configPath = join(String(process.env.LOCALAPPDATA || ""), "SaydianAiTaskRunner", "runner.env");
dotenv.config({ path: configPath });

const apiUrl = String(process.env.AI_TASK_API_URL || "https://stest.saydian.cn").replace(/\/+$/, "");
const runnerToken = String(process.env.AI_TASK_RUNNER_TOKEN || "");
const nodeCode = String(process.env.AI_TASK_RUNNER_NODE_CODE || "windows-codex-01");
const workRoot = resolve(String(
  process.env.AI_TASK_WORKDIR
  || join(String(process.env.LOCALAPPDATA || ""), "SaydianAiTaskRunner", "work"),
));
const ffprobeExecutable = String(process.env.FFPROBE_EXECUTABLE || "ffprobe");

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function selectedAssetIds(result: JsonRecord) {
  const ids = new Set<string>();
  const outputFiles = Array.isArray(result.outputFiles) ? result.outputFiles.map(record) : [];
  const master = outputFiles.find((item) => String(item.kind || "") === "VIDEO_MASTER");
  const metadata = record(master?.metadata);
  if (Array.isArray(metadata.usedAssetIds)) metadata.usedAssetIds.forEach((id) => ids.add(String(id)));
  const project = record(result.project);
  const candidates = Array.isArray(project.scriptCandidates) ? project.scriptCandidates.map(record) : [];
  const selected = candidates.find((candidate) => candidate.selected === true) || candidates[0];
  const shots = Array.isArray(selected?.shots) ? selected.shots.map(record) : [];
  shots.forEach((shot) => {
    if (Array.isArray(shot.selectedAssetIds)) shot.selectedAssetIds.forEach((id) => ids.add(String(id)));
  });
  return ids;
}

async function idsFromLocalEvidence(workspace: string, ids: Set<string>) {
  const validationPath = join(workspace, "validation-report.json");
  if (existsSync(validationPath)) {
    const validation = JSON.parse(await readFile(validationPath, "utf8")) as JsonRecord;
    const usedInput = String(record(validation.assetChecks).usedApprovedInput || "");
    const match = usedInput.match(/inputs\/([a-zA-Z0-9_-]+)\./u);
    if (match?.[1]) ids.add(match[1]);
  }
  const compositionsDir = join(workspace, "video-project", "compositions");
  if (existsSync(compositionsDir)) {
    for (const name of await readdir(compositionsDir)) {
      if (!name.endsWith(".html")) continue;
      const content = await readFile(join(compositionsDir, name), "utf8");
      for (const match of content.matchAll(/assets\/([a-zA-Z0-9_-]+)\.(?:jpg|jpeg|png|webp|mp4)/gu)) {
        ids.add(match[1]);
      }
    }
  }
}

async function repair(taskNo: string) {
  const workspace = join(workRoot, taskNo);
  const result = JSON.parse(await readFile(join(workspace, "result.json"), "utf8")) as JsonRecord;
  const outputFiles = Array.isArray(result.outputFiles) ? result.outputFiles.map(record) : [];
  const master = outputFiles.find((item) => String(item.kind || "") === "VIDEO_MASTER");
  if (!master?.path) throw new Error(`${taskNo} 未找到VIDEO_MASTER`);
  const masterPath = resolve(workspace, String(master.path));
  const probe = await execFileAsync(ffprobeExecutable, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,codec_name,avg_frame_rate:format=duration",
    "-of", "json",
    masterPath,
  ], { timeout: 60_000, windowsHide: true });
  const parsed = JSON.parse(probe.stdout) as JsonRecord;
  const stream = Array.isArray(parsed.streams) ? record(parsed.streams[0]) : {};
  const format = record(parsed.format);
  const usedAssetIds = selectedAssetIds(result);
  await idsFromLocalEvidence(workspace, usedAssetIds);
  const metadata = {
    ...record(master.metadata),
    width: Number(stream.width || 0),
    height: Number(stream.height || 0),
    durationSeconds: Number(format.duration || 0),
    codec: String(stream.codec_name || ""),
    frameRate: String(stream.avg_frame_rate || ""),
    aspectRatio: Number(stream.width) && Number(stream.height) ? `${stream.width}:${stream.height}` : "9:16",
    source: "CODEX_LOCAL_FFMPEG",
    usedAssetIds: Array.from(usedAssetIds),
  };
  const response = await fetch(`${apiUrl}/api/v1/ai-tasks/runner/output-metadata/${encodeURIComponent(taskNo)}`, {
    method: "POST",
    headers: {
      authorization: `Runner ${runnerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ nodeCode, kind: "VIDEO_MASTER", metadata }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${taskNo} 补录失败 ${response.status}: ${await response.text()}`);
  process.stdout.write(`${taskNo} ${metadata.width}x${metadata.height} ${metadata.durationSeconds}s ${usedAssetIds.size}项素材\n`);
}

async function main() {
  if (!runnerToken) throw new Error("AI_TASK_RUNNER_TOKEN 未配置");
  const taskNos = process.argv.slice(2).filter(Boolean);
  if (!taskNos.length) throw new Error("请传入至少一个AI任务编号");
  for (const taskNo of taskNos) await repair(taskNo);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
