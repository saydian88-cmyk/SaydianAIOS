# Batch Partial Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让批量视频与批量图文在部分失败时保留并审核已成功结果。

**Architecture:** Worker 返回带稳定键的逐项结果。API 分别持久化 READY 与 FAILED 项，页面按项展示并只重试 FAILED 键。任务要求由服务端统一补全，空补充提示词不输出。

**Tech Stack:** Vue 3、NestJS、Prisma、Vitest。

## Global Constraints

- 不强制回传发布文案。
- 不伪造成功结果。
- 已成功项不得在失败项重试时重新生成。

---

### Task 1: 批量任务要求

**Files:**
- Modify: `apps/workbench/src/App.vue`
- Modify: `apps/api/src/workbench.controller.ts`
- Test: `apps/api/src/workbench.controller.spec.ts`

- [ ] 编写空补充提示词不进入任务指令、视频强制规则均进入指令的失败测试。
- [ ] 运行该测试，确认当前实现未覆盖空提示词与强制规则。
- [ ] 服务端统一组装批量视频、图文规则；只在补充提示词非空时追加该段。
- [ ] 运行 API 测试并提交 `feat: strengthen batch task requirements`。

### Task 2: 逐项结果协议与存储

**Files:**
- Modify: `apps/ai-task-worker/src/index.ts`
- Modify: `apps/api/src/ai-task-center.service.ts`
- Test: `apps/ai-task-worker/src/result-contract.spec.ts`
- Test: `apps/api/src/ai-task-center.service.spec.ts`

- [ ] 编写 3 条 READY、2 条 FAILED 仍可登记 READY 的失败测试。
- [ ] 运行测试，确认当前整体结果协议不能表达部分成功。
- [ ] 增加视频 `videoKey` 和图文 `groupKey` 的 READY/FAILED 结果及失败原因。
- [ ] 持久化成功资源与失败记录，禁止用占位内容补齐失败项。
- [ ] 运行 worker/API 测试并提交 `feat: retain partial batch results`。

### Task 3: 员工端原型与正式界面

**Files:**
- Create: `apps/workbench/public/batch-partial-results-prototype.html`
- Modify: `apps/workbench/src/App.vue`
- Test: `apps/workbench/src/*.spec.ts`

- [ ] 创建展示“部分完成 3/5”、成功审核卡与失败重试卡的原型。
- [ ] 本地打开原型，确认成功项不被失败项遮蔽。
- [ ] 将正式页面接入逐项状态与失败原因。
- [ ] 运行工作台构建和测试并提交 `feat: review partial batch results`。

### Task 4: 单项重试与部署验证

**Files:**
- Modify: `apps/api/src/workbench.controller.ts`
- Test: `apps/api/src/workbench.controller.spec.ts`

- [ ] 编写重试仅携带 FAILED 键、READY 键不进入新任务的失败测试。
- [ ] 实现视频和图文失败项重试。
- [ ] 运行 API、worker、workbench 完整验证。
- [ ] 推送 main 触发部署并提供 GitHub Actions 链接。
