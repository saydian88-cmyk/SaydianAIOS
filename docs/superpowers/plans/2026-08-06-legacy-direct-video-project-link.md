# Legacy Direct Video Project Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let completed legacy direct-video tasks attach already uploaded masters to their video project when an old project link or batch result manifest is absent.

**Architecture:** The video finalization path resolves the project identifier once. It keeps `existingContentPlanId` as the preferred explicit link and falls back to `sourceId` only for `VIDEO_FACTORY_PROJECT` tasks. When an older batch worker has uploaded a video but omitted `batchResults`, the uploaded master is registered with a warning status instead of being discarded. The 15-second video reconciliation loop replays only waiting direct-video tasks that already have an uploaded master, so the existing registration path returns `PENDING_REVIEW` without rendering again.

**Tech Stack:** NestJS, Prisma, Vitest, TypeScript.

## Global Constraints

- Do not render, regenerate, or upload a second master for an existing uploaded output.
- Do not change task routing or unrelated finalization modes.
- Use the task's `sourceId` only when `sourceType` is `VIDEO_FACTORY_PROJECT`.

---

### Task 1: Resolve legacy project links during direct-video completion

**Files:**
- Modify: `apps/api/src/ai-task-center.service.ts`
- Modify: `apps/api/src/ai-task-center.service.spec.ts`

**Interfaces:**
- Consumes: task `input.existingContentPlanId`, task `sourceType`, task `sourceId`.
- Produces: the resolved content-plan id used by the existing direct-video master registration path.

- [x] **Step 1: Write the failing test**

```ts
expect(resolveDirectVideoProjectId({
  input: {},
  sourceType: "VIDEO_FACTORY_PROJECT",
  sourceId: "project-1",
})).toBe("project-1");
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saidian-ops/api test -- ai-task-center.service.spec.ts`

Expected: FAIL because `resolveDirectVideoProjectId` does not exist.

- [x] **Step 3: Write minimal implementation**

```ts
export function resolveDirectVideoProjectId(task: { input: unknown; sourceType?: string | null; sourceId?: string | null }) {
  const explicit = text(object(task.input).existingContentPlanId);
  if (explicit) return explicit;
  return text(task.sourceType).toUpperCase() === "VIDEO_FACTORY_PROJECT" ? text(task.sourceId) : "";
}
```

Use this helper in the direct-video finalization branch and its waiting-task reconciliation guard.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @saidian-ops/api test -- ai-task-center.service.spec.ts`

Expected: PASS.

- [x] **Step 5: Verify and deploy**

Run: `pnpm test`, `pnpm --filter @saidian-ops/api build`, `pnpm --filter @saidian-ops/admin build`, and `git diff --check`; commit only the two source/test files and this plan, push `main`, then wait for the production deployment workflow to succeed.
