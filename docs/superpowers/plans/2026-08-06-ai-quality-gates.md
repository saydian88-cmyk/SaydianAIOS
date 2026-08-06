# AI Quality Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let AI tasks complete with employee-visible quality reminders when only non-delivery warnings occur, while retaining hard failures for unusable, non-compliant, or contract-invalid output.

**Architecture:** A worker-local classifier turns official validator output into `BLOCKING` or `WARNING`. Warning records are placed in the already-persisted `AiTask.output` result JSON and execution log; blocking results retain the current repair/failure flow. The workbench reads the existing task projection and shows stored warnings in its detail drawer.

**Tech Stack:** TypeScript, Vitest, NestJS/Prisma JSON result storage, Vue 3, Element Plus.

## Global Constraints

- Never suppress missing/corrupt master files, wrong-product output, compliance failures, result-contract failures, upload failures, or callback failures.
- Keep raw official validator output in the local execution log.
- Warning-only outcomes must not increment `retryCount` or call the runner failure endpoint.
- Each employee reminder contains validator, raw summary, and recommended action.

---

### Task 1: Add the quality-gate classifier

**Files:**
- Create: `apps/ai-task-worker/src/quality-gates.ts`
- Create: `apps/ai-task-worker/src/quality-gates.spec.ts`

**Interfaces:**
- Produces `QualityWarning` and `classifyQualityGate(script: string, detail: string)`.
- Returns `{ disposition: "WARNING", warning }` for evidence, contrast, timeline-density, and transition suggestions; returns `{ disposition: "BLOCKING" }` for all other failures.

- [ ] **Step 1: Write the failing test**

```ts
expect(classifyQualityGate(
  "validate_rendered_composition.py",
  "ERROR: video-1: reviewed_from_render 应为 true\nRESULT: 1 errors",
)).toMatchObject({ disposition: "WARNING", warning: { validator: "validate_rendered_composition.py" } });
expect(classifyQualityGate("validate_final_delivery.py", "ERROR: VIDEO_MASTER file is missing"))
  .toEqual({ disposition: "BLOCKING" });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @saidian-ops/ai-task-worker test -- quality-gates.spec.ts`

Expected: FAIL because the classifier module does not exist.

- [ ] **Step 3: Write the minimal implementation**

```ts
export type QualityWarning = { validator: string; summary: string; recommendation: string };
export function classifyQualityGate(script: string, detail: string) {
  return /validate_rendered_composition|contrast|timeline_track_too_dense|transition-qc/i.test(`${script}\n${detail}`)
    ? { disposition: "WARNING" as const, warning: { validator: script, summary: detail.slice(0, 800), recommendation: "成片可交付；如需优化，请在审核中退回并说明具体画面问题。" } }
    : { disposition: "BLOCKING" as const };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @saidian-ops/ai-task-worker test -- quality-gates.spec.ts`

Expected: PASS for both warning and hard-blocking fixtures.

- [ ] **Step 5: Commit**

```bash
git add apps/ai-task-worker/src/quality-gates.ts apps/ai-task-worker/src/quality-gates.spec.ts
git commit -m "feat: classify non-blocking AI quality warnings"
```

### Task 2: Continue completion after warning-only validators

**Files:**
- Modify: `apps/ai-task-worker/src/index.ts:1839-2010`
- Modify: `apps/ai-task-worker/src/quality-gates.spec.ts`

**Interfaces:**
- Consumes `classifyQualityGate`.
- Returns `QualityWarning[]` from `validateMandatoryVideoEvidence` and writes `result.qualityWarnings` plus `QUALITY_WARNING` entries in `logs/execution.ndjson`.

- [ ] **Step 1: Write the failing test**

```ts
expect(appendQualityWarning([], {
  validator: "validate_rendered_composition.py",
  summary: "reviewed_from_render 应为 true",
  recommendation: "成片可交付；如需优化，请在审核中退回并说明具体画面问题。",
})).toHaveLength(1);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @saidian-ops/ai-task-worker test -- quality-gates.spec.ts`

Expected: FAIL because `appendQualityWarning` is not exported.

- [ ] **Step 3: Write the minimal implementation**

```ts
// Catch every official validator failure in validateMandatoryVideoEvidence.
// Rethrow BLOCKING failures. Append WARNING failures and continue.
result.qualityWarnings = appendQualityWarning(
  Array.isArray(result.qualityWarnings) ? result.qualityWarnings : [], warning,
);
await appendExecutionLog(workspace, "QUALITY_WARNING", warning);
```

Merge returned warnings into `result` before the existing completion callback. Do not alter `validateOutputArtifacts`, `assertCodexDirectMasterOutput`, upload, or completion behavior.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @saidian-ops/ai-task-worker test -- quality-gates.spec.ts`

Expected: PASS; warning-only validators preserve completion while a missing master remains blocking.

- [ ] **Step 5: Commit**

```bash
git add apps/ai-task-worker/src/index.ts apps/ai-task-worker/src/quality-gates.spec.ts
git commit -m "feat: complete tasks with non-blocking quality warnings"
```

### Task 3: Render employee quality reminders

**Files:**
- Modify: `apps/workbench/src/App.vue:6118-6205`
- Test: `apps/workbench/src/App.spec.ts` (or the established workbench test location)

**Interfaces:**
- Consumes `taskDetail.projection.aiTask.output.qualityWarnings`.
- Produces a warning-only “质量提醒” section that does not modify status or deliverables.

- [ ] **Step 1: Write the failing test**

```ts
expect(wrapper.text()).toContain("质量提醒");
expect(wrapper.text()).toContain("reviewed_from_render 应为 true");
expect(wrapper.text()).toContain("成片可交付");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @saidian-ops/workbench test -- App.spec.ts`

Expected: FAIL because task details do not render `qualityWarnings`.

- [ ] **Step 3: Write the minimal implementation**

```vue
<section v-if="taskQualityWarnings(taskDetail).length" class="task-detail-section">
  <h3>质量提醒</h3>
  <el-alert v-for="warning in taskQualityWarnings(taskDetail)" :key="`${warning.validator}:${warning.summary}`"
    type="warning" :title="warning.summary"
    :description="`${warning.validator} · ${warning.recommendation}`" :closable="false" />
</section>
```

Add `taskQualityWarnings(task)` near existing task-detail helpers. It returns only object records from `projection.aiTask.output.qualityWarnings`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @saidian-ops/workbench test -- App.spec.ts`

Expected: PASS and the section remains absent for tasks with no warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/workbench/src/App.vue apps/workbench/src/App.spec.ts
git commit -m "feat: show AI quality reminders to employees"
```

### Task 4: Verify and deploy

**Files:**
- Verify: `apps/ai-task-worker/src/quality-gates.spec.ts`
- Verify: `apps/ai-task-worker/src/execution-repair.spec.ts`
- Verify: `apps/workbench/src/App.spec.ts`

- [ ] **Step 1: Verify worker**

Run: `pnpm --filter @saidian-ops/ai-task-worker test && pnpm --filter @saidian-ops/ai-task-worker typecheck`

Expected: all tests pass and TypeScript exits 0.

- [ ] **Step 2: Verify workbench**

Run: `pnpm --filter @saidian-ops/workbench test && pnpm --filter @saidian-ops/workbench typecheck`

Expected: all tests pass and TypeScript exits 0.

- [ ] **Step 3: Check and publish**

Run: `git diff --check && git push origin main`

Expected: no whitespace errors; GitHub Actions verify, images, and deploy jobs succeed.

- [ ] **Step 4: Verify production behavior**

Run: create a test task whose only failure is missing rendered-composition evidence, then inspect the employee task detail.

Expected: task reaches review/completion, shows “质量提醒”, has no failure notification, and preserves the raw validator output in the execution log.
