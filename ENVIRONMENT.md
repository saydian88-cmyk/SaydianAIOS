# 开发与部署环境

## 1. 本地要求

- Windows 10/11 或 Linux。
- Node.js 22。
- pnpm 11.9.0。
- Docker。
- Git。
- PostgreSQL 17，或使用 Docker Compose。

## 2. 首次启动

```powershell
git clone https://github.com/saydian88-cmyk/SaydianAIOS.git
Set-Location SaydianAIOS
Copy-Item .env.example .env
pnpm install --frozen-lockfile
docker compose up -d
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm dev:api
```

另开 PowerShell：

```powershell
pnpm dev:admin
```

默认地址：

```text
管理端：http://127.0.0.1:5173
API：http://127.0.0.1:3210
健康检查：http://127.0.0.1:3210/health
```

## 3. 配置分组

所有字段模板见 `.env.example`。实际值不提交到 Git。

### 中台基础

```text
DATABASE_URL
OPS_ADMIN_TOKEN
OPS_AUTH_SECRET
OPS_PUBLIC_BASE_URL
OPS_WEB_BASE_URL
```

### 现有系统

```text
HELP_CENTER_CONTENT_URL
MALL_BASE_URL
MALL_ADMIN_USERNAME
MALL_ADMIN_PASSWORD
JUSHUITAN_OPERATION_DATA_URL
JUSHUITAN_OPERATION_DATA_TOKEN
WECOM_WEBHOOK_URL
```

### OSS、IMS与百炼

```text
OSS_REGION
OSS_BUCKET
OSS_ENDPOINT
OSS_ACCESS_KEY_ID
OSS_ACCESS_KEY_SECRET
BAILIAN_API_KEY
BAILIAN_VISION_MODEL
BAILIAN_TEXT_MODEL
BAILIAN_TRANSCRIPTION_MODEL
ALIYUN_IMS_REGION_ID
ALIYUN_IMS_ACCESS_KEY_ID
ALIYUN_IMS_ACCESS_KEY_SECRET
ALIYUN_IMS_PIPELINE_ID
ALIYUN_IMS_PROXY_TEMPLATE_ID
ALIYUN_IMS_SNAPSHOT_TEMPLATE_ID
ALIYUN_IMS_CALLBACK_BASE_URL
```

地域固定：

```text
OSS：oss-cn-shenzhen
IMS：cn-shenzhen
Bucket：saidian-brand-assets-prod-sz
```

### 平台连接

```text
VIRAL_COLLECTOR_DOUYIN_URL
VIRAL_COLLECTOR_TIKTOK_URL
VIRAL_COLLECTOR_XIAOHONGSHU_URL
VIRAL_COLLECTOR_WECHAT_CHANNELS_URL
VIRAL_COLLECTOR_TOKEN
DOUYIN_CLIENT_KEY
DOUYIN_CLIENT_SECRET
```

抖音 OAuth 令牌由中台加密保存，不写入前端或仓库。

## 4. 本地素材代理

云服务器不直接访问员工电脑目录。本地代理只读扫描源文件，并将文件上传 OSS。

配置：

```text
ASSET_ROOTS
OPS_CENTER_URL
OPS_CENTER_TOKEN
```

执行：

```powershell
pnpm sync:assets-agent
```

原始素材只读，不移动、不重命名、不覆盖。

## 5. AI任务执行器

先在总管理后台“AI任务中心 → 执行节点”创建节点并复制一次性 Runner Token，再在现有 Windows 主机执行：

```powershell
pnpm ai-task-runner:install -- -RunnerToken "<一次性Token>"
```

执行器以当前 Windows 用户登录时自动运行，每 30 秒上报心跳，只通过 API 领取任务并上传结果。

## 6. 生产环境

```text
系统：Ubuntu Server 24.04 LTS
部署根目录：/opt/saydian
私有环境变量：/opt/saydian/env/production.env
生产配置：/opt/saydian/config
部署脚本：/opt/saydian/bin/deploy-ops.sh
域名：https://stest.saydian.cn/saidian-ops/
```

生产服务器不执行 Node 构建，也不执行批量视频转码。

GitHub Actions 构建 API 和管理端镜像，推送 GHCR，再由腾讯云拉取指定 Git SHA 镜像。

## 7. 自动部署

工作流：

```text
.github/workflows/deploy-production.yml
```

链路：

```text
push main
→ 生成 Prisma Client
→ TypeScript 检查
→ 单元测试
→ 生产构建
→ Docker 镜像
→ OSS 中转镜像包
→ 腾讯云部署
→ 数据库备份与迁移
→ 健康检查
→ 失败回退
```

查看最近任务：

```powershell
gh run list --limit 5
```

查看指定任务：

```powershell
gh run view <run-id>
```

## 8. 提交前检查

```powershell
git diff --check
pnpm typecheck
pnpm test
pnpm build
git status --short
```

## 9. 故障检查

### API

```powershell
Invoke-RestMethod https://stest.saydian.cn/health
```

### Webhook握手

```powershell
$body = @{
  event = "verify_webhook"
  content = @{ challenge = 12345 }
} | ConvertTo-Json -Depth 3

Invoke-RestMethod `
  -Uri "https://stest.saydian.cn/api/v1/integrations/douyin/webhooks" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

预期：

```json
{"challenge":12345}
```

### 部署失败

1. 查看 GitHub Actions 的失败步骤。
2. 不直接重跑数据库写操作。
3. 确认当前镜像 SHA 和健康检查。
4. 使用部署脚本保留的上一版本回退。
5. 将失败原因记录到 Pull Request。
