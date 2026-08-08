import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.videoRenderJob.findMany({
    where: { status: "SUCCEEDED", outputAsset: { is: { reviewStatus: "APPROVED", availabilityStatus: "ACTIVE" } } },
    include: { contentPlan: true },
    orderBy: { finishedAt: "desc" },
  });
  for (const row of rows) {
    if (!row.outputAssetId) continue;
    const signals = Array.isArray(row.contentPlan.sourceSignals) ? row.contentPlan.sourceSignals as Array<Record<string, unknown>> : [];
    const factory = signals.find((item) => item.type === "VIDEO_FACTORY") || {};
    const brief = factory.brief && typeof factory.brief === "object" ? factory.brief as Record<string, unknown> : {};
    const product = row.contentPlan.productModel
      ? await prisma.product.findUnique({ where: { modelCode: row.contentPlan.productModel }, select: { category: true } })
      : null;
    await prisma.contentLibraryEntry.upsert({
      where: { contentPlanId_outputAssetId: { contentPlanId: row.contentPlanId, outputAssetId: row.outputAssetId } },
      create: {
        contentPlanId: row.contentPlanId, outputAssetId: row.outputAssetId, renderJobId: row.id,
        title: row.contentPlan.topic, productModel: row.contentPlan.productModel, productCategory: product?.category || null,
        platform: String(row.contentPlan.targetPlatforms[0] || "DOUYIN"), createdBy: row.contentPlan.createdBy,
        snapshot: { prompt: String(brief.additionalPrompt || row.contentPlan.objective || ""), reference: String(brief.reference || ""), project: { topic: row.contentPlan.topic, productModel: row.contentPlan.productModel || "", audience: row.contentPlan.audience, objective: row.contentPlan.objective, hook: row.contentPlan.hook, platform: row.contentPlan.targetPlatforms[0] || "DOUYIN", voiceoverMode: String(factory.voiceoverMode || "AUTO"), videoType: String(brief.videoType || ""), keywords: String(brief.keywords || ""), scene: String(brief.scene || ""), painPoint: String(brief.painPoint || ""), additionalPrompt: String(brief.additionalPrompt || "") } },
      }, update: {},
    });
  }
  console.log(`Backfilled ${rows.length} approved video entries.`);
}

main().finally(() => prisma.$disconnect());
