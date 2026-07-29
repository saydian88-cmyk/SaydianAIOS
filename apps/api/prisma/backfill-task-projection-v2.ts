import { AiTaskStatus, Prisma, PrismaClient } from "@prisma/client";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), "../../.env") });

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

function object(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function text(input: unknown) {
  return String(input ?? "").trim();
}

function opsStatus(status: AiTaskStatus, current: string) {
  if (status === "WAITING_CONFIRMATION") return "ACCEPTED";
  if (["PENDING", "CLAIMED", "RUNNING", "QUALITY_CHECK", "UPLOADING", "RETRY"].includes(status)) return "IN_PROGRESS";
  if (status === "PENDING_REVIEW") return "REVIEW";
  if (["WAITING_INPUT", "RETURNED", "FAILED"].includes(status)) return "RETURNED";
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "CANCELLED") return "CANCELLED";
  return current;
}

function skillFor(type: string) {
  if (type === "VIDEO") return "video-editing-from-media-library-share";
  if (type === "IMAGE") return "imagegen";
  if (type === "ARTICLE") return "build-health-brand-trust-content";
  return "Codex本地分析";
}

async function main() {
  const summary = {
    duplicateDeliveries: 0,
    relinkedNotifications: 0,
    relinkedOutputs: 0,
    correctedCategories: 0,
    projectedTasks: 0,
    executionMetadata: 0,
  };
  const duplicateDeliveries = await prisma.opsTask.findMany({
    where: { category: "AI_DELIVERY", deletedAt: null },
    select: { id: true, status: true, evidence: true, sourceId: true },
  });
  for (const duplicate of duplicateDeliveries) {
    const evidence = object(duplicate.evidence);
    const aiTaskId = text(evidence.aiTaskId || duplicate.sourceId);
    if (!aiTaskId) continue;
    const aiTask = await prisma.aiTask.findUnique({
      where: { id: aiTaskId },
      select: { id: true, taskNo: true, sourceType: true, sourceId: true, input: true, status: true, progressMessage: true },
    });
    if (!aiTask) continue;
    const sourceTaskId = text(object(aiTask.input).opsTaskId)
      || (aiTask.sourceType === "WORKBENCH_CONTENT_REQUEST" ? text(aiTask.sourceId) : "");
    if (!sourceTaskId || sourceTaskId === duplicate.id) continue;
    const sourceTask = await prisma.opsTask.findUnique({ where: { id: sourceTaskId }, select: { id: true, status: true, evidence: true } });
    if (!sourceTask) continue;
    summary.duplicateDeliveries += 1;
    const notifications = await prisma.taskNotification.findMany({ where: { taskId: duplicate.id } });
    for (const notification of notifications) {
      const duplicateNotice = notification.eventKey
        ? await prisma.taskNotification.findFirst({
            where: {
              id: { not: notification.id },
              recipientEmployeeId: notification.recipientEmployeeId,
              channel: notification.channel,
              eventKey: notification.eventKey,
            },
            select: { id: true },
          })
        : null;
      if (apply) {
        if (duplicateNotice) {
          await prisma.taskNotification.delete({ where: { id: notification.id } });
        } else {
          await prisma.taskNotification.update({
            where: { id: notification.id },
            data: { taskId: sourceTaskId, targetType: "OPS_TASK", targetId: sourceTaskId },
          });
        }
      }
      summary.relinkedNotifications += 1;
    }
    const outputCount = await prisma.aiTaskOutput.count({ where: { aiTaskId: aiTask.id, kind: { not: "OPS_TASK" } } });
    if (apply) {
      const nextStatus = opsStatus(aiTask.status, sourceTask.status);
      const now = new Date();
      await prisma.$transaction([
        prisma.aiTaskOutput.updateMany({
          where: { aiTaskId: aiTask.id, kind: { not: "OPS_TASK" } },
          data: { opsTaskId: sourceTaskId },
        }),
        prisma.opsTask.update({
          where: { id: sourceTaskId },
          data: {
            status: nextStatus,
            result: aiTask.progressMessage || undefined,
            evidence: {
              ...object(sourceTask.evidence),
              aiTaskId: aiTask.id,
              aiTaskNo: aiTask.taskNo,
              aiStatus: aiTask.status,
              aiUpdatedAt: now.toISOString(),
            } as Prisma.InputJsonValue,
            ...(nextStatus === "COMPLETED" ? { completedAt: now, completedBy: "AI任务中心", returnReason: null } : {}),
          },
        }),
        prisma.opsTask.update({
          where: { id: duplicate.id },
          data: {
            status: "CANCELLED",
            deletedAt: now,
            purgeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            returnReason: "历史AI交付任务已归并至原任务",
          },
        }),
      ]);
    }
    summary.relinkedOutputs += outputCount;
    summary.projectedTasks += 1;
  }

  const contentTasks = await prisma.opsTask.findMany({
    where: { sourceType: "SELF_CREATED", deletedAt: null },
    select: { id: true, category: true, evidence: true },
  });
  for (const task of contentTasks) {
    const contentType = text(object(task.evidence).contentType).toUpperCase();
    const expected = contentType === "IMAGE" ? "CONTENT_IMAGE"
      : contentType === "ARTICLE" ? "CONTENT_ARTICLE"
        : contentType === "SHORT_VIDEO" ? "CONTENT_VIDEO" : "";
    if (!expected || expected === task.category) continue;
    if (apply) await prisma.opsTask.update({ where: { id: task.id }, data: { category: expected } });
    summary.correctedCategories += 1;
  }

  const executedTasks = await prisma.aiTask.findMany({
    where: { attempts: { some: { status: "SUCCEEDED" } } },
    select: { id: true, type: true, output: true },
  });
  for (const task of executedTasks) {
    const output = object(task.output);
    if (object(output.execution).skill) continue;
    if (apply) {
      await prisma.aiTask.update({
        where: { id: task.id },
        data: {
          output: {
            ...output,
            execution: {
              ...object(output.execution),
              skill: skillFor(task.type),
              skillVersion: "historical",
              strategy: ["VIDEO", "IMAGE", "ARTICLE"].includes(task.type) ? "CODEX_SKILL" : "ANALYSIS",
              migratedAt: new Date().toISOString(),
            },
          } as Prisma.InputJsonValue,
        },
      });
    }
    summary.executionMetadata += 1;
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...summary }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
