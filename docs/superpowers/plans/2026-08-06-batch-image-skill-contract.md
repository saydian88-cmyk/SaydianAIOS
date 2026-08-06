# 批量图文 Skill 前置执行合同 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让批量图文 Skill 在生成前拿到完整、不可稀释的执行合同，并在 Skill 内部完成创作规划和自检后才回传成品。

**Architecture:** 后端在用户提交项目时自动把产品、组数、类型、可选补充要求和默认质量要求编译为执行合同；Worker 原样传给图文 Skill。合同可在项目详情中只读展示，但不占流程步骤，用户不编辑、不确认。Skill 自主选材、先逐组规划再制作和内部重做；系统不做事后创作拦截。

**Tech Stack:** NestJS、TypeScript、Vue 3、Vitest、SaiDian 图文制作 Skill。

## Global Constraints

- 用户只填写产品、数量、类型和可选补充要求；执行合同由系统自动生成、只读展示。
- 单组和批量图文均由 Skill 自主选择对应产品的真实素材。
- 每组至少 5 页：1 封面 + 至少 4 内容页，文件不可复用。
- 每组钩子、文案、页面逻辑和主图片源必须不同。
- 原始详情图、未经处理的截帧不能直接交付；截帧先调色提亮。
- 实拍类有可用素材时必须有 4–8 张真实照片/截帧构成的拼图页。
- 发布文案为 120–260 字小红书笔记风格。

### Task 1: 编译唯一执行合同

**Files:** `apps/api/src/workbench.controller.ts`, `apps/api/src/workbench.controller.spec.ts`

- [ ] 写失败测试：批量、单组、退回重做均自动生成同一类合同，包含“先逐组完成内部创作方案”“原始详情图不能直接交付”和全部默认质量规则；合同不出现在用户创建表单或流程步骤中，但可在项目详情只读查看。
- [ ] 运行：`pnpm --filter @saidian-ops/api exec vitest run src/workbench.controller.spec.ts`，确认失败。
- [ ] 提取 `compileImagePostExecutionContract()`；它由系统自动运行，只输出产品边界、组别、用户补充要求和默认质量合同，不输出素材目录或来源优先级；将合同保存为项目只读详情数据。
- [ ] 运行 API 测试与 `pnpm --filter @saidian-ops/api typecheck`。
- [ ] 提交：`git commit -m "feat: compile image post execution contract"`。

### Task 2: Worker 原样交接并要求 Skill 内部自检

**Files:** `apps/ai-task-worker/src/index.ts`, `apps/ai-task-worker/src/worker-utils.ts`, `apps/ai-task-worker/src/worker-utils.spec.ts`

- [ ] 写失败测试：Worker 提示词含“Skill 自主选材、先逐组规划、内部自检重做”，且没有 `materialRoots` 或目录路径。
- [ ] 运行：`pnpm --filter @saidian-ops/ai-task-worker exec vitest run src/worker-utils.spec.ts`，确认失败。
- [ ] 让 Worker 原样传递合同，明确“详情图只能作为原料，不能作为最终页；不合格页面在 Skill 内重做后才回传”。
- [ ] 运行 Worker 测试与 `pnpm --filter @saidian-ops/ai-task-worker typecheck`。
- [ ] 提交：`git commit -m "feat: enforce image post skill execution contract"`。

### Task 3: 回传 Skill 自检摘要并在员工端展示

**Files:** `apps/ai-task-worker/src/index.ts`, `apps/api/src/ai-task-center.service.ts`, `apps/workbench/src/batch-image-review.ts`, `apps/workbench/src/App.vue`, `apps/workbench/src/styles.css`

- [ ] 写失败测试：每组回传 `executionSummary`，含页数、拼图、截帧调色、主图源差异确认和 `selfCheckPassed`。
- [ ] 运行 API/Workbench 测试，确认失败。
- [ ] 扩展回传结构与员工端卡片；员工只看最终成品和摘要，不看素材路径、内部方案或组号。
- [ ] 运行 API、Worker、Workbench 类型检查和图文审核单测。
- [ ] 提交：`git commit -m "feat: show image post skill self check summary"`。

### Task 4: 原型确认、全链路验证与部署

**Files:** `apps/workbench/public/batch-image-skill-contract-prototype.html`

- [ ] 打开原型，确认流程是“用户提交 → 系统自动生成合同 → Skill 内部规划/自检 → 成品审核”；合同可展开查看但不是用户操作步骤，没有系统选材或事后质量拦截。
- [ ] 运行全部类型检查和相关测试。
- [ ] 推送 `main`，只提供 GitHub Actions 部署进度链接。
