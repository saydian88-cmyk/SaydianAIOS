# AI Task Recovery and Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair direct-video HyperFrames validation, show every filtered AI task, and purge stale terminal tasks with their local workspaces.

**Architecture:** The worker enforces real HyperFrames lint evidence and asks the API for terminal cleanup candidates. The API rechecks the candidate's terminal state and age before deletion. The admin overview renders its full filtered result rather than truncating it.

**Tech Stack:** TypeScript, NestJS, Prisma, Vue 3, Vitest, HyperFrames.

## Global Constraints

- Keep HyperFrames errors as blocking failures.
- Delete only `FAILED` and `CANCELLED` tasks unchanged for at least 72 hours.
- Delete only task workspaces explicitly returned by the authenticated API cleanup route.

---

### Task 1: Enforce valid HyperFrames media identifiers

**Files:**
- Modify: `apps/ai-task-worker/src/index.ts`
- Test: `apps/ai-task-worker/src/worker-utils.spec.ts`

- [ ] Write a failing test for the direct-video validation instruction.
- [ ] Run the focused worker test and confirm failure.
- [ ] Add the smallest prompt requirement that timed audio/video elements have unique ids and lint has zero errors.
- [ ] Run the focused worker test and confirm success.

### Task 2: Show all filtered tasks in the admin overview

**Files:**
- Modify: `apps/admin/src/components/AiTaskCenter.vue`
- Test: `apps/admin/src/components/AiTaskCenter.spec.ts`

- [ ] Write a failing test that a filtered overview is not limited to twelve tasks.
- [ ] Run the focused admin test and confirm failure.
- [ ] Remove only the overview truncation.
- [ ] Run the focused admin test and confirm success.

### Task 3: Purge terminal tasks and matching local workspaces

**Files:**
- Modify: `apps/api/src/ai-task-center.service.ts`, `apps/api/src/ai-task-center.controller.ts`, `apps/ai-task-worker/src/index.ts`
- Test: `apps/api/src/ai-task-center.service.spec.ts`, `apps/ai-task-worker/src/worker-utils.spec.ts`

- [ ] Write failing tests for a 72-hour terminal cleanup candidate and rejection of a recent or nonterminal task.
- [ ] Run focused tests and confirm failure.
- [ ] Implement authenticated candidate lookup, post-workspace-delete confirmation, and safe workspace removal.
- [ ] Run focused tests and confirm success.

### Task 4: Verify and deploy

- [ ] Run `npm.cmd test` from the repository root and `git diff --check`.
- [ ] Repair the existing W9 workspace only with the required unique media ids, then run actual lint and render.
- [ ] Commit only task-recovery, task-list, and retention files; push `main`.
- [ ] Restart the local runner and confirm two fresh worker processes plus a healthy test endpoint.
