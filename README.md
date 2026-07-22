# 赛电全渠道智能运营中台

独立连接现有商城、客服帮助中心和素材目录的运营中台。本地及企微原始素材只读，原始素材和 `data/derived` 派生内容统一同步到私有阿里云 OSS。

## 已实现

- 素材增量扫描、哈希去重、图像/视频规格检查、型号识别、阿里云 OSS 统一存储、每日新增与更新台账。
- 证据底表、型号映射、表述规则、客服知识库和自有商城只读适配器。
- 每日视频/软文候选、发布前门禁、人工审核、幂等发布和 1/5/30 分钟重试。
- 平台指标、评论、直播、店铺事项、竞品、趋势、提醒和任务的数据模型及统一适配器。
- PostgreSQL 自动任务队列和计划中的每日/每周执行节奏。
- 运营日报逐条记录：新增/更新素材、来源、执行员工、发布平台、账号、发布时间、播放/完播/互动/咨询/订单及未获取字段。
- 员工/部门、产品/SKU、平台账号/店铺、素材版本、经营快照、导入批次、内容归因和数据源健康历史。
- 国内平台与 TikTok、Amazon、Shopify 共用主数据；每个账号独立显示“未配置/待验证/正常/部分可用/异常”。
- JSON/CSV 经营快照导入，支持订单、发货、售后、退款、客服、库存和工单；缺失字段保存为“未获取”。
- 1/3/6/24/72 小时及 7/30 日效果采集任务、发布与回复幂等控制、1/5/30 分钟重试。
- Vue 3 管理端新增经营责任台账，可维护员工、产品、账号、店铺并查看导入、归因和数据源状态。

## 首次启动

```powershell
Copy-Item .env.example .env
pnpm install
docker compose up -d
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm dev:api
```

另开一个 PowerShell：

```powershell
pnpm dev:admin
```

管理端默认 `http://127.0.0.1:5173`，API 默认 `http://127.0.0.1:3210`。首次使用先在右上角填写当前员工姓名；之后审核、扫描、发布和任务处理均带入日报台账。

## 阿里云 OSS

已配置 Bucket：`saidian-brand-assets-prod`，地域 `oss-cn-hangzhou`。Bucket 为私有，已启用阻止公共访问、版本控制、AES256 服务端加密，并设置历史版本保留 180 天。

已创建专用 RAM 用户 `saidian-ops-oss`，并绑定自定义策略 `SaidianOpsOssBucketAccess`。该策略仅允许查询目标 Bucket、列举对象，以及读写 `brand-assets/`；没有删除权限。凭据已写入本机且被 Git 忽略的 `.env`：

```powershell
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
```

系统按 SHA-256 对象键去重，原始素材存入 `brand-assets/original/`，系统派生素材存入 `brand-assets/derived/`。日报逐项展示 OSS 对象键、同步员工、同步时间和异常。

每次素材内容或 OSS 版本发生变化时，系统同时新增 `AssetVersion` 记录。源目录始终只读，历史版本不会被台账覆盖。

中台部署到腾讯云后，本地素材目录无需共享给云服务器。本地电脑配置 `OPS_CENTER_URL` 和 `OPS_CENTER_TOKEN` 后执行：

```powershell
pnpm sync:assets-agent
```

本地代理只读扫描素材，直接上传阿里云 OSS，再把哈希、OSS版本、扫描员工和素材清单写入云端中台。

真实连接与幂等上传验证：

```powershell
pnpm verify:oss
```

验证文件已成功存入 `brand-assets/original/71/71311459589f59e10ac8ed0ee6fcfcba2cbd4a677d6fdf504f599ff603d1957b.xlsx`；连续重复执行返回同一版本编号，不会重复写入新版本。

## 接入状态原则

抖音、自有商城、企微机器人等只有在 `.env` 填入真实凭据并通过健康检查后才显示能力。未接入的平台保持“未配置”，指标缺失保存为“未获取”，不按零值计算。

`VIDEO_RENDER_COMMAND` 可接现有 HyperFrames/FFmpeg 渲染命令；系统已经为每日主视频生成标准 `BRIEF.md`，渲染成功后再进入发布队列。

## 经营快照导入

管理端进入“经营责任台账”，可直接导入 CSV。标准列名支持：

```text
类型,外部编号,状态,发生时间,截止时间,金额,币种,未获取字段
ORDER,A-1001,PAID,2026-07-22T08:00:00+08:00,,399,CNY,物流单号;发货时间
```

也兼容 `订单号`、`创建时间` 等中文列名。重复的平台、类型、外部编号和数据版本会更新原快照，不会重复计数。导入员工、文件名、成功数、拒绝数和错误行都会进入日报。

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
```
