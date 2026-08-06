import { createHash } from "node:crypto";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "asset";
}

export function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifySha256(value: Buffer, expected?: string) {
  return !expected || sha256(value).toLowerCase() === expected.toLowerCase();
}

export const videoRouteKeys = [
  "STANDARD_SMART_VIDEO",
  "REFERENCE_DIRECT_FULL_VIDEO",
  "CODEX_DIRECT_FULL_VIDEO",
] as const;

export function availableClaimRouteKeys(
  activeVideoCount: number,
  activeImageCount: number,
  maxVideoConcurrency: number,
  maxImageConcurrency: number,
) {
  const keys: string[] = [];
  if (activeVideoCount < maxVideoConcurrency) keys.push(...videoRouteKeys);
  if (activeImageCount < maxImageConcurrency) keys.push("IMAGE_POST");
  return keys;
}

export function hasHyperframesRenderEvidence(value: unknown) {
  const evidence = asRecord(value);
  if (String(evidence.engine || "").toUpperCase() === "HYPERFRAMES") return true;
  const project = asRecord(evidence.project);
  const commands = Array.isArray(evidence.commands) ? evidence.commands.map(asRecord) : [];
  const hasSuccessfulRender = commands.some((command) => String(command.name || "").toLowerCase() === "render"
    && (Number(command.exitCode) === 0 || command.success === true || command.passed === true));
  if (!hasSuccessfulRender) return false;
  const text = [
    String(evidence.project || ""),
    String(project.id || ""),
    String(project.path || ""),
    String(project.composition || ""),
    ...commands.flatMap((command) => [
      String(command.command || command.name || ""),
      String(command.logPath || command.log || ""),
    ]),
  ].join(" ");
  return /hyperframes/iu.test(text);
}

export function directSingleMasterFinalExemptions() {
  return [
    { id: "batch_sequence_consistent", applicable: false },
    { id: "cover_title_complete", applicable: false },
    { id: "final_folder_clean", applicable: false },
    { id: "final_delivery_validator_passed", applicable: false },
  ];
}

export function imagePostGroupsInstruction(groupCount: number) {
  return groupCount > 0
    ? "This is a batch image project. Return imagePost.groups with one complete result per groupKey in batchImageDirect.groups. Each group must contain at least five distinct real output pages: one cover and at least four inner pages. Every page must point to a different outputFiles file, and no file may be reused by another page or group. Write publishCopy as a Xiaohongshu-style note with 120-260 Chinese characters, several short natural paragraphs, 2-5 relevant common symbols or emoji, a scene-led hook, practical value and a natural interaction ending. Return real line-break characters in publishCopy; never return literal escape text such as \\n, \\r or \\t."
    : "This is a single image project. Return imagePost.groups as an empty array []. Put the complete result only in imagePost.title, publishCopy, tags and pages.";
}

export function imagePostMaterialSelectionInstruction() {
  return "The downstream image-post Skill must independently select suitable real source materials from the full approved SaiDian media library. The system supplies only the requested product boundary, creative requirement, compliance boundary and delivery contract; it must not prescribe asset folders, source priority, or a specific material type.";
}

export function directHyperframesLintInstruction() {
  return "Every timed <video> and <audio> element in the HyperFrames composition must have its own unique id. Run HyperFrames lint after writing the composition; it must finish with zero errors before recording lint as successful. Run the official `hyperframes check` command and record its successful output in render-evidence.json as the validate command.";
}
