# Batch Image Real Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and review real per-group batch-image results while enforcing the approved public-content and creative-diversity requirements.

**Architecture:** The result contract returns one public post per `groupKey`. The API maps each returned post to the stored batch group and saves its pages, copy, tags, and asset bindings in variant metadata. The workbench reads only that persisted result and marks a group missing when no binding exists.

**Tech Stack:** NestJS, Prisma, TypeScript, Vue 3, Vitest.

## Global Constraints

- Internal type, page number, group number, and task identifiers must not appear in final images, titles, tags, or publish copy.
- Every group has different hooks, copy, page logic, and primary image sources; cropping, recoloring, or copy-only changes are not differences.
- Video frames are color-corrected and brightened before use; dark, gray, blurry, or low-contrast frames are rejected.
- A real-photo group with sufficient usable source material includes a 4–8 image real-photo collage.
- Missing output is explicit; no placeholder imagery or simulated copy is presented as generated output.

---

### Task 1: Define a per-group image-post result contract

**Files:**
- Modify: `apps/ai-task-worker/src/index.ts:760-805,895-905`
- Test: `apps/ai-task-worker/src/result-contract.spec.ts`

**Interfaces:**
- Consumes: `batchImageDirect.groups`.
- Produces: `imagePost.groups`, where each group contains `groupKey`, `title`, `publishCopy`, `tags`, and real-image `pages`.

- [ ] Write a failing test asserting `imagePost.groups` is required for a batch-image package.
- [ ] Run `pnpm --filter @saidian-ops/ai-task-worker test -- result-contract.spec.ts` and confirm the new assertion fails.
- [ ] Add the group array schema; each page requires `pageNo`, `title`, `copy`, and `outputFile`. Update the runner prompt with the approved public-content, differentiation, frame-quality, and collage rules.
- [ ] Re-run the focused worker test and confirm it passes.

### Task 2: Persist returned results by group

**Files:**
- Modify: `apps/api/src/ai-task-center.service.ts:2980-3100`
- Test: `apps/api/src/ai-task-center.service.spec.ts`

**Interfaces:**
- Consumes: `result.imagePost.groups` and `task.input.batchImageDirect.groups`.
- Produces: `ContentVariant.metadata.groups` keyed by `groupKey`, with title, publish copy, tags, pages, and image asset IDs.

- [ ] Write a failing registration test with one returned `groupKey` and a real output asset; assert that persisted metadata contains the same group key and image asset ID.
- [ ] Run `pnpm --filter @saidian-ops/api test -- ai-task-center.service.spec.ts` and confirm the test fails because only one project-wide pages list is stored.
- [ ] Map output files to their returned group pages, persist every group under metadata, and represent requested-but-absent groups as missing rather than manufacturing data.
- [ ] Re-run the API test and confirm it passes.

### Task 3: Generate the concise default task requirement

**Files:**
- Modify: `apps/workbench/src/App.vue:820-850`
- Modify: `apps/api/src/workbench.controller.ts:330-365`
- Test: `apps/api/src/workbench.controller.spec.ts`

**Interfaces:**
- Consumes: batch products, types, groups, and optional user prompt.
- Produces: one default requirement with public-content prohibition, group differentiation, frame-quality, and collage rules.

- [ ] Write a failing test that `compileBatchImagePostPrompt` contains the required internal-word prohibition and differentiation rule.
- [ ] Run `pnpm --filter @saidian-ops/api test -- workbench.controller.spec.ts` and confirm it fails.
- [ ] Add the four approved rules exactly once, without empty-field text or duplicated summaries.
- [ ] Re-run the controller test and confirm it passes.

### Task 4: Render real batch-image results in the review page

**Files:**
- Modify: `apps/workbench/src/App.vue:875-905,4765-4810`
- Test: `apps/workbench/src/App.spec.ts`

**Interfaces:**
- Consumes: `project.variants[0].metadata.groups` and internal `batch.groups`.
- Produces: `batchImageReviewGroup(project, group)` returning real result data or `MISSING`.

- [ ] Write a failing view-model test: a matching group returns its persisted title and a non-returned group has `MISSING` status.
- [ ] Run `pnpm --filter @saidian-ops/workbench test -- App.spec.ts` and confirm it fails because the UI uses `batchImageCopyMeta` and a static placeholder.
- [ ] Replace the placeholder and mock copy with real page image, title, tags, and publish copy. Show `未回传` for missing groups and disable whole-batch approval until all groups have real output.
- [ ] Re-run the workbench test and confirm it passes.

### Task 5: Verify and publish

**Files:**
- Modify: files from Tasks 1–4 only.

- [ ] Run the focused worker, API, and workbench tests from Tasks 1–4.
- [ ] Run `pnpm --filter @saidian-ops/ai-task-worker typecheck`, `pnpm --filter @saidian-ops/api typecheck`, and `pnpm --filter @saidian-ops/workbench build`.
- [ ] Commit only the planned implementation and tests with `feat: show real batch image results`.
- [ ] After user authorization, push `main` to trigger the existing OSS deployment pipeline.
