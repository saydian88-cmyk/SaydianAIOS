import { AssetKind, AssetRightsStatus, PrismaClient, ProductScope } from "@prisma/client";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function values(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function kind(value: string): AssetKind {
  return ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"].includes(value.toUpperCase()) ? value.toUpperCase() as AssetKind : "DOCUMENT";
}

function rights(value: unknown): AssetRightsStatus {
  const source = text(value);
  if (["自有可用", "已授权", "COMMERCIAL"].includes(source)) return "COMMERCIAL";
  if (["限制使用", "INTERNAL"].includes(source)) return "INTERNAL";
  if (source === "EDIT_ONLY") return "EDIT_ONLY";
  if (source === "PROHIBITED") return "PROHIBITED";
  return "AUTH_REQUIRED";
}

function publicNo(assetKind: AssetKind, createdAt: Date): string {
  return `SD-${assetKind}-${createdAt.toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

async function run() {
  const assets = await prisma.asset.findMany({ include: { versions: true, products: true } });
  let assetsUpdated = 0;
  let relationsAdded = 0;
  let tagsAdded = 0;
  for (const asset of assets) {
    const metadata = object(asset.sourceSnapshot);
    const assetKind = kind(asset.mediaType);
    const reviewStatus = asset.status === "READY" ? "APPROVED" : asset.status === "BLOCKED" ? "REJECTED" : "PENDING";
    const availabilityStatus = asset.status === "READY" ? "ACTIVE" : asset.status === "BLOCKED" ? "SUSPENDED" : "INACTIVE";
    const rightsStatus = rights(metadata.copyrightStatus);
    const product = asset.model ? await prisma.product.findFirst({ where: { modelCode: { equals: asset.model, mode: "insensitive" } } }) : null;
    const productScope: ProductScope = product ? "MODEL" : asset.model ? "UNKNOWN" : "COMMON";
    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        assetNo: asset.assetNo || publicNo(assetKind, asset.createdAt), displayName: asset.displayName || text(metadata.name) || asset.fileName,
        kind: asset.kind || assetKind, level: asset.level || "ORIGINAL", productScope,
        processingStatus: asset.storageError ? "FAILED" : asset.objectKey ? "STORED" : "RECEIVED",
        reviewStatus, availabilityStatus, rightsStatus, originalFileName: asset.originalFileName || asset.fileName,
        contentDescription: asset.contentDescription || text(metadata.description) || text(metadata.hook) || undefined,
        isOriginal: asset.sourceType !== "AI_GENERATED" && asset.sourceType !== "AI_DERIVED",
        ...(product && !asset.products.length ? { products: { create: { productId: product.id, scope: "MODEL", confirmed: true, confidence: 1 } } } : {}),
      },
    });
    assetsUpdated += 1;
    for (const version of asset.versions) {
      await prisma.assetVersion.update({ where: { id: version.id }, data: { originalFileName: version.originalFileName || asset.fileName, extension: version.extension || asset.extension, sizeBytes: version.sizeBytes || asset.sizeBytes, width: version.width || asset.width, height: version.height || asset.height, durationSeconds: version.durationSeconds || asset.durationSeconds } });
    }
    const legacyTags = [
      ...values(metadata.aiTags).map((label) => ({ namespace: "legacy-ai", label, source: "AI" as const })),
      ...values(metadata.scenarios).map((label) => ({ namespace: "scene", label, source: "IMPORT" as const })),
      ...values(metadata.sellingPoints).map((label) => ({ namespace: "feature", label, source: "IMPORT" as const })),
      ...values(metadata.audienceTags).map((label) => ({ namespace: "audience", label, source: "IMPORT" as const })),
      ...values(metadata.targetPlatforms).map((label) => ({ namespace: "platform", label, source: "IMPORT" as const })),
    ];
    for (const item of legacyTags) {
      const code = item.label.toLowerCase().replace(/\s+/gu, "-").slice(0, 80);
      const tag = await prisma.tagDefinition.upsert({ where: { namespace_code: { namespace: item.namespace, code } }, update: { label: item.label }, create: { namespace: item.namespace, code, label: item.label } });
      await prisma.assetTag.upsert({ where: { assetId_tagId: { assetId: asset.id, tagId: tag.id } }, update: {}, create: { assetId: asset.id, tagId: tag.id, source: item.source, confirmed: false, locked: false, createdBy: "V2回填" } });
      tagsAdded += 1;
    }
    if (product) relationsAdded += 1;
  }

  const knowledge = await prisma.knowledgeEntry.findMany();
  let knowledgeUpdated = 0;
  let faqsAdded = 0;
  for (const entry of knowledge) {
    const validClaims = entry.evidenceIds.length ? await prisma.evidenceClaim.count({ where: { id: { in: entry.evidenceIds }, status: "READY", OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] } }) : 0;
    const externallyUsable = entry.status === "READY" && (!entry.evidenceIds.length || validClaims === entry.evidenceIds.length) && (!entry.validUntil || entry.validUntil > new Date());
    await prisma.knowledgeEntry.update({ where: { id: entry.id }, data: { externallyUsable } });
    knowledgeUpdated += 1;
    if (entry.type === "FAQ") {
      const metadata = object(entry.raw);
      const faqNo = `FAQ-${entry.id}`.slice(0, 120);
      const faq = await prisma.faqEntry.upsert({
        where: { faqNo },
        update: { standardQuestion: entry.title, shortAnswer: entry.reply || entry.summary || "待完善", detailedAnswer: entry.body, category: entry.category || "未分类", source: entry.source, status: entry.status, externallyUsable },
        create: { faqNo, standardQuestion: entry.title, shortAnswer: entry.reply || entry.summary || "待完善", detailedAnswer: entry.body, category: entry.category || "未分类", intent: text(metadata.intent) || "未分类", source: entry.source, status: entry.status, externallyUsable },
      });
      for (const question of values(metadata.questionVariants)) await prisma.faqVariant.upsert({ where: { faqId_question: { faqId: faq.id, question } }, update: {}, create: { faqId: faq.id, question, source: "V1知识库回填" } });
      faqsAdded += 1;
    }
  }

  process.stdout.write(JSON.stringify({ assetsUpdated, relationsAdded, tagsAdded, knowledgeUpdated, faqsAdded }, null, 2));
}

run().finally(() => prisma.$disconnect());
