# 赛电全渠道智能运营中台

独立连接现有商城、客服帮助中心和素材目录的运营中台。本地及企微原始素材只读，原始素材和 `data/derived` 派生内容统一同步到私有阿里云 OSS。

## 已实现

- 素材增量扫描、哈希去重、图像/视频规格检查、型号识别、阿里云 OSS 统一存储、每日新增与更新台账。
- 证据底表、型号映射、表述规则、客服知识库和自有商城只读适配器。
- 每日视频/软文候选、发布前门禁、人工审核、幂等发布和 1/5/30 分钟重试。
- 平台指标、评论、直播、店铺事项、竞品、趋势、提醒和任务的数据模型及统一适配器。
- PostgreSQL 自动任务队列和计划中的每日/每周执行节奏。
- 运营日报逐条记录：新增/更新素材、来源、执行员工、发布平台、账号、发布时间、播放/完播/互动/咨询/订单及未获取字段。
- Vue 3 管理端：总览、内容审核、素材证据、店铺竞品、评论直播、报告任务、连接状态。

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

真实连接与幂等上传验证：

```powershell
pnpm verify:oss
```

验证文件已成功存入 `brand-assets/original/71/71311459589f59e10ac8ed0ee6fcfcba2cbd4a677d6fdf504f599ff603d1957b.xlsx`；连续重复执行返回同一版本编号，不会重复写入新版本。

## 接入状态原则

抖音、自有商城、企微机器人等只有在 `.env` 填入真实凭据并通过健康检查后才显示能力。未接入的平台保持“未配置”，指标缺失保存为“未获取”，不按零值计算。

`VIDEO_RENDER_COMMAND` 可接现有 HyperFrames/FFmpeg 渲染命令；系统已经为每日主视频生成标准 `BRIEF.md`，渲染成功后再进入发布队列。

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
```
