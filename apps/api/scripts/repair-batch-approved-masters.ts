import { PrismaClient } from "@prisma/client";
import { validateVideoMasterMetadata } from "../src/video-output-validation";

const prisma = new PrismaClient();

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function main() {
  const renders = await prisma.videoRenderJob.findMany({
    where: {
      status: "SUCCEEDED",
      outputAsset: { is: { reviewStatus: "RETURNED", availabilityStatus: "INACTIVE" } },
      contentPlan: { productionStage: { in: ["READY_TO_PUBLISH", "PUBLISHING", "TRACKING"] } },
    },
    include: { contentPlan: true, outputAsset: true, qualityChecks: true },
  });
  let repaired = 0;
  for (const render of renders) {
    const factory = Array.isArray(render.contentPlan.sourceSignals)
      ? render.contentPlan.sourceSignals.find((signal: any) => signal?.type === "VIDEO_FACTORY")
      : undefined;
    if (factory?.projectMode !== "BATCH_CODEX_DIRECT_FULL_VIDEO" || !render.outputAsset) continue;
    const metadata = object(object(render.outputAsset.sourceSnapshot).metadata);
    const validation = validateVideoMasterMetadata({
      ...metadata,
      width: render.outputAsset.width || metadata.width,
      height: render.outputAsset.height || metadata.height,
      durationSeconds: render.outputAsset.durationSeconds || metadata.durationSeconds,
    });
    const failedChecks = render.qualityChecks.filter((check) => check.status === "FAILED");
    const technicalOnly = failedChecks.length > 0 && failedChecks.every((check) => check.checkType === "OUTPUT_VALIDITY");
    if (!technicalOnly || !validation.valid || !String(render.outputAsset.reviewedBy || "").startsWith("Codex:")) continue;
    await prisma.$transaction([
      prisma.asset.update({
        where: { id: render.outputAsset.id },
        data: { reviewStatus: "APPROVED", availabilityStatus: "ACTIVE", rightsStatus: "COMMERCIAL", status: "READY", reviewedBy: "SYSTEM_BATCH_APPROVAL_RECOVERY", reviewedAt: new Date() },
      }),
      prisma.videoQualityCheck.updateMany({
        where: { renderJobId: render.id, checkType: "OUTPUT_VALIDITY", status: "FAILED" },
        data: { status: "PASSED", score: 95, reviewedBy: "SYSTEM_BATCH_APPROVAL_RECOVERY", reviewedAt: new Date(), findings: [{ recovered: true, reason: "technical_metadata_available" }] },
      }),
      prisma.videoQualityCheck.updateMany({
        where: { renderJobId: render.id, checkType: "FINAL_REVIEW" },
        data: { status: "PASSED", reviewedBy: "SYSTEM_BATCH_APPROVAL_RECOVERY", reviewedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: { actor: "SYSTEM_BATCH_APPROVAL_RECOVERY", action: "BATCH_MASTER_RECOVERED_AFTER_METADATA_SYNC", entityType: "Asset", entityId: render.outputAsset.id, after: { contentPlanId: render.contentPlanId, renderJobId: render.id } },
      }),
    ]);
    repaired += 1;
  }
  console.log(`Repaired ${repaired} batch masters after metadata recovery.`);
}

main().finally(() => prisma.$disconnect());
