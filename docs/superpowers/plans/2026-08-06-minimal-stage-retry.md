# 最小失败阶段续跑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让视频、单条图文和批量图文在重试时复用有效工作区，只修复最小失败阶段或失败单元。

**Architecture:** 工作器先从工作区验证结果、产物和已上传账本；修复分类决定“复用结果”“补校验记录”“重做失败单元”或“完整重跑”。批量结果继续使用视频键或图文组作为最小单元。

**Tech Stack:** TypeScript、Vitest、Node.js 工作器、既有任务工作区状态。

## Global Constraints

- 不伪造校验、渲染或上传成功。
- 输入指纹或 Skill 摘要变化时不得复用旧产物。
- 轻微校验问题必须以 `qualityWarnings` 返回，而非失败。
- 保留用户已有未跟踪文件与无关改动。

---

### Task 1: 恢复决策模型

**Files:**
- Modify: `apps/ai-task-worker/src/execution-repair.ts`
- Test: `apps/ai-task-worker/src/execution-repair.spec.ts`

**Interfaces:**
- Produces: `recoveryMode(category): "RESUME_RESULT" | "REPAIR_EVIDENCE" | "REPAIR_UNIT" | "FULL_RERUN"`。
- Consumes: 现有 `RepairCategory`。

- [ ] **Step 1: Write the failing test**

```ts
expect(recoveryMode("RENDER_EVIDENCE")).toBe("REPAIR_EVIDENCE");
expect(recoveryMode("TRANSIENT_TRANSFER")).toBe("RESUME_RESULT");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saidian-ops/ai-task-worker test -- execution-repair.spec.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
export function recoveryMode(category?: RepairCategory | string) {
  if (category === "RENDER_EVIDENCE" || category === "RESULT_CONTRACT") return "REPAIR_EVIDENCE";
  if (category === "TRANSIENT_TRANSFER") return "RESUME_RESULT";
  return "FULL_RERUN";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @saidian-ops/ai-task-worker test -- execution-repair.spec.ts`

### Task 2: 复用有效结果并补校验

**Files:**
- Modify: `apps/ai-task-worker/src/index.ts`
- Test: `apps/ai-task-worker/src/execution-repair.spec.ts`

**Interfaces:**
- Consumes: `recoveryMode`、现有 `validateMandatoryVideoEvidence`、`validateOutputArtifacts`。
- Produces: `RESUME_EVIDENCE_REPAIRED` 日志，避免调用内容生成分支。

- [ ] **Step 1: Write the failing test**

```ts
expect(shouldResumeValidatedResult(true, "RENDER_EVIDENCE")).toBe(true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saidian-ops/ai-task-worker test -- execution-repair.spec.ts`

- [ ] **Step 3: Write minimal implementation**

让有可验证 `result.json` 与产物的 `RENDER_EVIDENCE` 和 `RESULT_CONTRACT` 重试进入质量校验路径；仅缺失记录时补齐，不调用 `runCodex` 或 `renderLocalVideo`。

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter @saidian-ops/ai-task-worker test -- execution-repair.spec.ts workspace-state.spec.ts`

### Task 3: 批量最小单元恢复

**Files:**
- Modify: `apps/ai-task-worker/src/index.ts`
- Test: `apps/ai-task-worker/src/result-contract.spec.ts`

**Interfaces:**
- Consumes: 已保存批量 `result.json`、批量视频键及图文 `groupKey`。
- Produces: 仅包含无效视频键或图文组的修复请求，已通过的输出保持原路径与上传账本。

- [ ] **Step 1: Write failing tests**

```ts
expect(repairTargets(savedBatch, invalidFiles)).toEqual(["group-b"]);
```

- [ ] **Step 2: Run tests to verify RED**

Run: `pnpm --filter @saidian-ops/ai-task-worker test -- result-contract.spec.ts`

- [ ] **Step 3: Implement minimal target selection**

依据已有输出契约，将不合格文件映射为其 `videoKey` 或 `groupKey`；没有有效映射时才返回完整重跑。

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter @saidian-ops/ai-task-worker test -- result-contract.spec.ts`

### Task 4: 全量验证与发布

**Files:**
- Modify: 本任务涉及的工作器和测试文件。

- [ ] **Step 1: Run full tests**

Run: `npm.cmd test`

- [ ] **Step 2: Check build and whitespace**

Run: `pnpm --filter @saidian-ops/api build; pnpm --filter @saidian-ops/admin build; git diff --check`

- [ ] **Step 3: Commit and deploy**

Commit only the feature files and push `main` to run the existing deployment pipeline. Restart the local Windows runner after the API route is live.
