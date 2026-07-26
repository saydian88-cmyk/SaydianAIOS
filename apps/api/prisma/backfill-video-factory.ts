import { JobStatus, PrismaClient } from "@prisma/client";
import { opsConfig } from "../src/config";
import { encryptIntegrationValue } from "../src/integration-secret";

const prisma = new PrismaClient();

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function jobStatus(value: unknown): JobStatus {
  const status = String(value || "").toUpperCase();
  if (status === "RUNNING") return "RUNNING";
  if (status === "SUCCEEDED") return "SUCCEEDED";
  if (status === "FAILED") return "FAILED";
  return "PENDING";
}

async function main() {
  const provider = await prisma.videoModelProvider.upsert({
    where: { code: "BAILIAN_WAN" },
    create: {
      code: "BAILIAN_WAN",
      displayName: "阿里百炼 · Wan",
      region: "CN",
      baseUrl: "https://dashscope.aliyuncs.com",
      capabilities: ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO", "REFERENCE_TO_VIDEO"],
      priority: 10,
      enabled: Boolean(opsConfig.bailian.apiKey),
      state: opsConfig.bailian.apiKey ? "CONFIGURED" : "UNCONFIGURED",
      message: opsConfig.bailian.apiKey ? "已从现有百炼配置迁移" : "未配置",
      secretRef: opsConfig.bailian.apiKey
        ? encryptIntegrationValue(JSON.stringify({ apiKey: opsConfig.bailian.apiKey }))
        : undefined,
    },
    update: {},
  });
  const plans = await prisma.contentPlan.findMany({
    where: { kind: "VIDEO" },
    select: { id: true, shootRequirements: true, productModel: true, targetPlatforms: true },
  });
  let shotCount = 0;
  let jobCount = 0;
  for (const plan of plans) {
    const requirements = Array.isArray(plan.shootRequirements) ? plan.shootRequirements.map(object) : [];
    for (let index = 0; index < requirements.length; index += 1) {
      const requirement = requirements[index];
      const requirementKey = String(requirement.id || `legacy-shot-${index + 1}`);
      const generation = object(requirement.aiGeneration);
      const videoAssetIds = strings(requirement.videoAssetIds);
      const assetIds = strings(requirement.assetIds);
      const selectedAssetId = videoAssetIds[0] || String(generation.assetId || "") || null;
      const shot = await prisma.videoShot.upsert({
        where: { contentPlanId_requirementKey: { contentPlanId: plan.id, requirementKey } },
        create: {
          contentPlanId: plan.id,
          requirementKey,
          sequence: index,
          title: `镜头${index + 1}`,
          description: String(requirement.description || ""),
          status: selectedAssetId && String(requirement.status) === "DONE" ? "DONE" : generation.taskId ? "GENERATING" : "OPEN",
          sourcePreference: generation.taskId ? "AI_GENERATED" : "REAL_ASSET",
          durationSeconds: Number(generation.duration || 5),
          prompt: String(generation.prompt || requirement.description || ""),
          assetIds,
          selectedAssetId,
          metadata: { imageAssetIds: strings(requirement.imageAssetIds), migratedFrom: "shootRequirements" },
        },
        update: {},
      });
      shotCount += 1;
      if (!generation.taskId) continue;
      const modelCode = String(generation.model || opsConfig.bailian.imageToVideoModel);
      const model = await prisma.videoModelConfig.upsert({
        where: { providerId_code: { providerId: provider.id, code: modelCode } },
        create: {
          providerId: provider.id,
          code: modelCode,
          displayName: `百炼 ${modelCode}`,
          capabilities: [generation.referenceAssetId ? "IMAGE_TO_VIDEO" : "TEXT_TO_VIDEO"],
          enabled: Boolean(opsConfig.bailian.apiKey),
          priority: 10,
        },
        update: {},
      });
      const status = jobStatus(generation.status);
      const job = await prisma.videoGenerationJob.upsert({
        where: { idempotencyKey: `legacy-ai:${plan.id}:${requirementKey}:${String(generation.taskId)}` },
        create: {
          idempotencyKey: `legacy-ai:${plan.id}:${requirementKey}:${String(generation.taskId)}`,
          contentPlanId: plan.id,
          shotId: shot.id,
          status,
          routingMode: "FIXED",
          requestedModelId: model.id,
          resolvedModelId: model.id,
          allowFallback: false,
          prompt: String(generation.prompt || requirement.description || ""),
          input: {
            platform: plan.targetPlatforms[0],
            productModel: plan.productModel,
            duration: Number(generation.duration || 5),
            referenceAssetId: generation.referenceAssetId,
          },
          outputAssetId: String(generation.assetId || "") || null,
          attemptCount: 1,
          failureReason: String(generation.failureReason || "") || null,
          startedAt: generation.requestedAt ? new Date(String(generation.requestedAt)) : null,
          finishedAt: generation.completedAt ? new Date(String(generation.completedAt)) : null,
          createdBy: "历史百炼任务迁移",
          attempts: {
            create: {
              providerId: provider.id,
              modelId: model.id,
              attemptNo: 1,
              status,
              externalJobId: String(generation.taskId),
              request: { migrated: true, prompt: generation.prompt },
              response: { migrated: true },
              startedAt: generation.requestedAt ? new Date(String(generation.requestedAt)) : null,
              finishedAt: generation.completedAt ? new Date(String(generation.completedAt)) : null,
              failureReason: String(generation.failureReason || "") || null,
            },
          },
        },
        update: {},
      });
      if (job) jobCount += 1;
    }
  }
  console.log(JSON.stringify({ plans: plans.length, shots: shotCount, generationJobs: jobCount }));
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
