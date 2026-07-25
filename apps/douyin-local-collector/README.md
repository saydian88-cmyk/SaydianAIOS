# 赛电抖音爆款趋势本地采集器

采集器使用独立Chrome Profile搜索每日关键词，将12小时内视频和2/6/12小时指标快照同步到运营中台。

## 配置

根目录 `.env`：

```text
DOUYIN_COLLECTOR_API_BASE_URL=https://stest.saydian.cn/api/v1/brand-data
DOUYIN_COLLECTOR_TOKEN=<与OPS_ADMIN_TOKEN相同或独立配置>
DOUYIN_COLLECTOR_DEVICE_NAME=赛电内容电脑
```

未设置 `DOUYIN_COLLECTOR_TOKEN` 时自动使用根目录 `OPS_ADMIN_TOKEN`。

## 安装

```powershell
pnpm install
powershell -ExecutionPolicy Bypass -File .\apps\douyin-local-collector\scripts\install-windows-task.ps1
```

首次启动会打开独立Chrome窗口，扫码登录抖音后保持该Profile有效即可。
