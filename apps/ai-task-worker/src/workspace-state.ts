import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JsonRecord } from "./skill-router";

export type WorkspaceState = {
  packageFingerprint: string;
  skillDigest: string;
  stage: string;
  updatedAt: string;
  uploads: Record<string, { uploadedAt: string; path: string; sha256: string; kind: string }>;
};

export async function ensureTaskWorkspace(workspace: string) {
  await mkdir(workspace, { recursive: true });
  await Promise.all(["inputs", "outputs", "logs"].map((name) => mkdir(join(workspace, name), { recursive: true })));
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export async function writeJsonAtomic(path: string, value: unknown) {
  const temporary = `${path}.writing`;
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await rename(temporary, path);
}

export async function loadWorkspaceState(workspace: string): Promise<WorkspaceState | undefined> {
  return readJson<WorkspaceState>(join(workspace, "state.json"));
}

export async function saveWorkspaceState(workspace: string, state: WorkspaceState) {
  await writeJsonAtomic(join(workspace, "state.json"), state);
}

export function freshWorkspaceState(packageFingerprint: string, skillDigest: string): WorkspaceState {
  return {
    packageFingerprint,
    skillDigest,
    stage: "PACKAGE",
    updatedAt: new Date().toISOString(),
    uploads: {},
  };
}

export function canResume(
  state: WorkspaceState | undefined,
  packageFingerprint: string,
  skillDigest: string,
) {
  return Boolean(
    state
    && state.packageFingerprint === packageFingerprint
    && state.skillDigest === skillDigest,
  );
}

export function uploadLedgerKey(path: string, sha256: string, kind: string) {
  return `${kind}:${sha256}:${path.replaceAll("\\", "/")}`;
}

export function directVideoUploadLedgerKey(path: string, sha256: string, kind: string) {
  return `${uploadLedgerKey(path, sha256, kind)}:TECHNICAL_METADATA_V3`;
}

export async function appendExecutionLog(workspace: string, event: string, data: JsonRecord = {}) {
  await appendFile(
    join(workspace, "logs", "execution.ndjson"),
    `${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`,
    "utf8",
  );
}
