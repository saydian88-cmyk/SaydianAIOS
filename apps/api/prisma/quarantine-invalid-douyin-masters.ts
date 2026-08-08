import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function invalidReasons(asset: any) {
  const snapshot = object(asset?.sourceSnapshot);
  const metadata = object(snapshot.metadata);
  const validation = object(metadata.outputValidation);
  const usage = Array.isArray(metadata.materialUsage) ? metadata.materialUsage : [];
  const reasons: string[] = [];
  if (Number(asset?.width || 0) <= 0 || Number(asset?.height || 0) <= 0) reasons.push("INVALID_RESOLUTION");
  if (Number(asset?.durationSeconds || 0) <= 1) reasons.push("INVALID_DURATION");
  if (!text(metadata.codec)) reasons.push("MISSING_CODEC");
  if (!text(metadata.frameRate)) reasons.push("MISSING_FRAME_RATE");
  if (!usage.length) reasons.push("MISSING_MATERIAL_TRACE");
  if (validation.valid !== true) reasons.push("MISSING_OUTPUT_VALIDATION");
  return [...new Set(reasons)];
}

function lineId(shot: any) {
  const metadata = object(shot.metadata);
  return text(metadata.lineId)
    || text(shot.requirementKey).replace(/^(shot-v3:|codex-v3:|system-v4:|factory:)/, "")
    || `line_${String(Number(shot.sequence || 0) + 1).padStart(2, "0")}`;
}

async function main() {
  const renders = await prisma.videoRenderJob.findMany({
    where: {
      outputAssetId: { not: null },
      contentPlan: { sourceSignals: { array_contains: [{ type: "VIDEO_FACTORY", factoryModule: "DOUYIN_VIRAL" }] } },
    },
    include: { outputAsset: true, contentPlan: { select: { id: true, topic: true } } },
    orderBy: { createdAt: "asc" },
  });
  const invalid = renders
    .map((render) => ({ render, reasons: invalidReasons(render.outputAsset) }))
    .filter((item) => item.reasons.length > 0);
  const planIds = Array.from(new Set(renders.map((item) => item.contentPlanId)));
  const shots = planIds.length ? await prisma.videoShot.findMany({
    where: { contentPlanId: { in: planIds } },
    include: { generationJobs: { select: { id: true } } },
    orderBy: [{ contentPlanId: "asc" }, { sequence: "asc" }, { updatedAt: "desc" }],
  }) : [];
  const shotGroups = new Map<string, typeof shots>();
  for (const shot of shots) {
    const key = `${shot.contentPlanId}:${lineId(shot)}`;
    shotGroups.set(key, [...(shotGroups.get(key) || []), shot]);
  }
  const duplicateGroups = [...shotGroups.entries()].filter(([, rows]) => rows.length > 1);

  const report = {
    mode: apply ? "APPLY" : "PREVIEW",
    scannedMasters: renders.length,
    invalidMasters: invalid.map(({ render, reasons }) => ({
      renderJobId: render.id,
      contentPlanId: render.contentPlanId,
      topic: render.contentPlan.topic,
      assetId: render.outputAssetId,
      reasons,
    })),
    duplicateShotGroups: duplicateGroups.map(([key, rows]) => ({
      key,
      shotIds: rows.map((row) => row.id),
      removableShotIds: rows.slice(1).filter((row) => row.generationJobs.length === 0).map((row) => row.id),
    })),
  };

  if (apply) {
    for (const { render, reasons } of invalid) {
      const asset = render.outputAsset!;
      const snapshot = object(asset.sourceSnapshot);
      const metadata = object(snapshot.metadata);
      await prisma.$transaction(async (tx) => {
        await tx.asset.update({
          where: { id: asset.id },
          data: {
            reviewStatus: "RETURNED",
            availabilityStatus: "INACTIVE",
            sourceSnapshot: {
              ...snapshot,
              metadata: {
                ...metadata,
                outputValidation: { valid: false, hardBlockers: reasons },
                legacyInvalidMedia: true,
              },
            } as Prisma.InputJsonValue,
          },
        });
        await tx.aiTaskOutput.updateMany({ where: { assetId: asset.id }, data: { reviewStatus: "RETURNED" } });
        await tx.contentLibraryEntry.updateMany({
          where: { outputAssetId: asset.id },
          data: { visibilityStatus: "HIDDEN", hiddenAt: new Date(), hiddenBy: "migration:douyin-v22" },
        });
        const existingQc = await tx.videoQualityCheck.findFirst({
          where: { contentPlanId: render.contentPlanId, assetId: asset.id, checkType: "LEGACY_INVALID_MEDIA" },
        });
        if (existingQc) {
          await tx.videoQualityCheck.update({
            where: { id: existingQc.id },
            data: { status: "FAILED", score: 0, findings: reasons as Prisma.InputJsonValue },
          });
        } else {
          await tx.videoQualityCheck.create({
            data: {
              contentPlanId: render.contentPlanId,
              assetId: asset.id,
              renderJobId: render.id,
              checkType: "LEGACY_INVALID_MEDIA",
              status: "FAILED",
              score: 0,
              findings: reasons as Prisma.InputJsonValue,
            },
          });
        }
        const audited = await tx.auditLog.findFirst({
          where: { action: "DOUYIN_LEGACY_INVALID_MEDIA_QUARANTINE", entityType: "Asset", entityId: asset.id },
        });
        if (!audited) {
          await tx.auditLog.create({
            data: {
              actor: "migration:douyin-v22",
              action: "DOUYIN_LEGACY_INVALID_MEDIA_QUARANTINE",
              entityType: "Asset",
              entityId: asset.id,
              before: { reviewStatus: asset.reviewStatus, availabilityStatus: asset.availabilityStatus } as Prisma.InputJsonValue,
              after: { reviewStatus: "RETURNED", availabilityStatus: "INACTIVE", reasons } as Prisma.InputJsonValue,
            },
          });
        }
      });
    }

    for (const [, rows] of duplicateGroups) {
      const keeper = rows.find((row) => row.requirementKey.startsWith("shot-v3:"))
        || rows.find((row) => row.generationJobs.length > 0)
        || rows[0];
      const removable = rows.filter((row) => row.id !== keeper.id && row.generationJobs.length === 0);
      if (removable.length) await prisma.videoShot.deleteMany({ where: { id: { in: removable.map((row) => row.id) } } });
      const canonicalKey = `shot-v3:${lineId(keeper)}`;
      if (keeper.requirementKey !== canonicalKey) {
        const conflict = await prisma.videoShot.findUnique({
          where: { contentPlanId_requirementKey: { contentPlanId: keeper.contentPlanId, requirementKey: canonicalKey } },
        });
        if (!conflict) await prisma.videoShot.update({ where: { id: keeper.id }, data: { requirementKey: canonicalKey } });
      }
    }
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
