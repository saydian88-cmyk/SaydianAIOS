import { BadRequestException } from "@nestjs/common";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { opsConfig } from "./config";
import type {
  VideoMasterMetadataV2,
  VideoMaterialUsageItem,
  VideoOutputValidation,
} from "./video-topic-card";

type JsonRow = Record<string, unknown>;

const execFileAsync = promisify(execFile);

function row(value: unknown): JsonRow {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRow : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(row) : [];
}

export function canonicalVideoShotKey(lineId: unknown, sequence: number) {
  const normalized = text(lineId)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return `shot-v3:${normalized || `line_${String(sequence + 1).padStart(2, "0")}`}`;
}

export function normalizeMaterialUsage(value: unknown): VideoMaterialUsageItem[] {
  return rows(value).map((item, index) => ({
    lineId: text(item.lineId || item.line_id) || `line_${String(index + 1).padStart(2, "0")}`,
    sequence: Math.max(0, Math.round(Number(item.sequence ?? index) || 0)),
    assetId: text(item.assetId || item.asset_id),
    sha256: text(item.sha256),
    scriptLine: text(item.scriptLine || item.script_line),
    timelineStart: Math.max(0, Number(item.timelineStart ?? item.timelineStartSeconds ?? item.timeline_start) || 0),
    timelineEnd: Math.max(0, Number(item.timelineEnd ?? item.timelineEndSeconds ?? item.timeline_end) || 0),
    sourceIn: Math.max(0, Number(item.sourceIn ?? item.source_in) || 0),
    sourceOut: Math.max(0, Number(item.sourceOut ?? item.source_out) || 0),
    moduleType: text(item.moduleType || item.module_type).toUpperCase() || "SCENE",
  }));
}

export function validateVideoMasterMetadata(
  raw: unknown,
  options: { requireMaterialUsage?: boolean; allowedAssetIds?: Set<string>; expectedShotLineIds?: Set<string> } = {},
): VideoOutputValidation {
  const metadata = row(raw);
  const materialUsage = normalizeMaterialUsage(metadata.materialUsage);
  const qualityChecks = rows(metadata.qualityChecks).map((check) => ({
    checkType: text(check.checkType).toUpperCase(),
    status: (text(check.status).toUpperCase() || "REVIEW_REQUIRED") as "PASSED" | "REVIEW_REQUIRED" | "FAILED",
    score: Math.max(0, Math.min(100, Math.round(Number(check.score) || 0))),
    findings: Array.isArray(check.findings) ? check.findings : [],
  }));
  const hardBlockers: string[] = [];
  const width = positive(metadata.width);
  const height = positive(metadata.height);
  const durationSeconds = positive(metadata.durationSeconds);
  const codec = text(metadata.codec).toLowerCase();
  const frameRate = text(metadata.frameRate);
  if (!width || !height) hardBlockers.push("成片缺少有效分辨率");
  if (durationSeconds <= 1) hardBlockers.push("成片时长无效");
  if (!codec) hardBlockers.push("成片缺少编码信息");
  if (!frameRate) hardBlockers.push("成片缺少帧率信息");
  if (options.requireMaterialUsage && !materialUsage.length) hardBlockers.push("成片缺少逐镜头素材使用记录");
  for (const usage of materialUsage) {
    if (!usage.assetId || !usage.sha256) hardBlockers.push(`镜头${usage.sequence + 1}缺少素材ID或哈希`);
    if (!usage.scriptLine) hardBlockers.push(`镜头${usage.sequence + 1}缺少对应脚本行`);
    if (usage.timelineEnd <= usage.timelineStart) hardBlockers.push(`镜头${usage.sequence + 1}成片使用区间无效`);
    if (usage.sourceOut <= usage.sourceIn) hardBlockers.push(`镜头${usage.sequence + 1}素材使用区间无效`);
    if (options.allowedAssetIds && !options.allowedAssetIds.has(usage.assetId)) hardBlockers.push(`镜头${usage.sequence + 1}使用了任务白名单外素材`);
    if (options.expectedShotLineIds && !options.expectedShotLineIds.has(usage.lineId)) hardBlockers.push(`镜头${usage.sequence + 1}未对应当前脚本行`);
  }
  const failedCheck = qualityChecks.find((check) => check.status === "FAILED");
  if (failedCheck) hardBlockers.push(`${failedCheck.checkType || "自动质检"}未通过`);
  const contentAlignment = row(metadata.contentAlignment);
  if (text(contentAlignment.status).toUpperCase() === "FAILED") hardBlockers.push("成片内容与选题或脚本不一致");
  return {
    valid: hardBlockers.length === 0,
    hardBlockers: [...new Set(hardBlockers)],
    metadata: {
      width: Math.round(width),
      height: Math.round(height),
      durationSeconds,
      codec,
      frameRate,
      materialUsage,
      qualityChecks,
      ...(Object.keys(contentAlignment).length ? { contentAlignment: contentAlignment as VideoMasterMetadataV2["contentAlignment"] } : {}),
    },
  };
}

export async function inspectVideoBuffer(file: { originalname: string; buffer: Buffer } | undefined) {
  if (!file?.buffer?.length) throw new BadRequestException("请选择需要上传的MP4成片");
  const tempDir = join(opsConfig.derivedOutputDir, "video-factory", "upload-inspection");
  await mkdir(tempDir, { recursive: true });
  const tempPath = join(tempDir, `${randomUUID()}${extname(file.originalname) || ".mp4"}`);
  try {
    await writeFile(tempPath, file.buffer);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,codec_name,avg_frame_rate,r_frame_rate",
      "-show_entries", "format=duration",
      "-of", "json",
      tempPath,
    ], { timeout: 60_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    const parsed = row(JSON.parse(stdout));
    const stream = rows(parsed.streams)[0] || {};
    const format = row(parsed.format);
    const technical = {
      width: positive(stream.width),
      height: positive(stream.height),
      durationSeconds: positive(format.duration),
      codec: text(stream.codec_name).toLowerCase(),
      frameRate: text(stream.avg_frame_rate || stream.r_frame_rate),
    };
    const validation = validateVideoMasterMetadata(technical);
    if (!validation.valid) throw new BadRequestException(`成片技术检查失败：${validation.hardBlockers.join("；")}`);
    return technical;
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(`成片技术检查失败：${error instanceof Error ? error.message : "无法读取视频流"}`);
  } finally {
    await rm(tempPath, { force: true });
  }
}
