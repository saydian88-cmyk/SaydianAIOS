import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

export type RepairCategory =
  | "HYPERFRAMES_RUNTIME"
  | "CODEX_RUNTIME"
  | "RESULT_CONTRACT"
  | "RENDER_EVIDENCE"
  | "TRANSIENT_TRANSFER"
  | "NONE";

export interface RepairDecision {
  recoverable: boolean;
  category: RepairCategory;
  fingerprint: string;
  reason: string;
}

const patterns: Array<[RepairCategory, RegExp]> = [
  ["RENDER_EVIDENCE", /validate_rendered_composition|reviewed_from_render|composition-qc|render evidence|production-plan|shot-plan|validator|ffmpeg|ffprobe/i],
  ["HYPERFRAMES_RUNTIME", /gsap|hyperframes/i],
  ["CODEX_RUNTIME", /codex.*(?:idle timeout|executable|spawn|interrupted)|(?:idle timeout|executable|spawn).*codex/i],
  ["RESULT_CONTRACT", /result\.json|schema|must have required property|additional properties|video_master/i],
  ["TRANSIENT_TRANSFER", /upload|oss|callback|heartbeat|fetch failed|econnreset|etimedout|http 5\d\d|statuscode["':\s]*5\d\d|5\d\d[^\n]{0,120}internal server error/i],
];

export function requiresRenderedEvidenceReview(category?: RepairCategory | string) {
  return category === "RENDER_EVIDENCE";
}

export function shouldResumeValidatedResult(resumeCandidate: boolean, category?: RepairCategory | string) {
  return resumeCandidate && !requiresRenderedEvidenceReview(category);
}

export function classifyExecutionFailure(message: string): RepairDecision {
  const normalized = message.trim().replace(/\s+/g, " ").slice(0, 4_000);
  const matched = patterns.find(([, pattern]) => pattern.test(normalized));
  const category = matched?.[0] || "NONE";
  return {
    recoverable: category !== "NONE",
    category,
    fingerprint: createHash("sha256").update(`${category}\n${normalized.toLowerCase()}`).digest("hex"),
    reason: normalized || "Unknown execution failure",
  };
}

export async function repairHyperFramesRuntime(
  workspace: string,
  bundledGsapPath: string,
): Promise<{ changed: boolean; files: string[] }> {
  const source = await stat(bundledGsapPath).catch(() => undefined);
  if (!source?.isFile() || source.size < 10_000) {
    throw new Error(`Bundled official GSAP runtime is unavailable: ${bundledGsapPath}`);
  }

  const runtimePath = join(workspace, ".runtime", "hyperframes", "gsap-3.14.2.min.js");
  await mkdir(dirname(runtimePath), { recursive: true });
  await copyFile(bundledGsapPath, runtimePath);

  const indexPath = join(workspace, "project", "index.html");
  const html = await readFile(indexPath, "utf8").catch(() => "");
  if (!html) return { changed: false, files: [runtimePath] };

  const projectRuntimePath = join(workspace, "project", "vendor", "gsap-3.14.2.min.js");
  await mkdir(dirname(projectRuntimePath), { recursive: true });
  await copyFile(bundledGsapPath, projectRuntimePath);
  const next = html.replace(
    /https?:\/\/[^"']*(?:gsap(?:\.min)?\.js|gsap@3\.14\.2[^"']*)/gi,
    "vendor/gsap-3.14.2.min.js",
  );
  if (next !== html) await writeFile(indexPath, next, "utf8");
  return { changed: next !== html, files: [runtimePath, projectRuntimePath, indexPath] };
}
