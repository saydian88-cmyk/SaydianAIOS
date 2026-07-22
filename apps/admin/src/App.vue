<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Bell, Connection, DataAnalysis, DocumentChecked, Files, House, Monitor, Promotion,
  Refresh, Search, Setting, Shop, VideoCamera,
} from "@element-plus/icons-vue";
import { api, getActor, getToken, patch, post, setActor, setToken } from "./api";
import type { Asset, ContentPlan, Dashboard, Integration } from "./types";

type AnyRow = Record<string, any>;
type Ledger = { departments: AnyRow[]; employees: AnyRow[]; products: AnyRow[]; accounts: AnyRow[]; stores: AnyRow[]; imports: AnyRow[]; snapshots: AnyRow[]; attributions: AnyRow[]; sourceHealth: AnyRow[] };

const navItems = [
  { key: "dashboard", label: "今日总览", icon: House },
  { key: "content", label: "内容审核", icon: DocumentChecked },
  { key: "assets", label: "素材与证据", icon: Files },
  { key: "ledger", label: "经营责任台账", icon: Monitor },
  { key: "operations", label: "店铺与竞品", icon: Shop },
  { key: "engagement", label: "评论与直播", icon: VideoCamera },
  { key: "reports", label: "报告与任务", icon: DataAnalysis },
  { key: "integrations", label: "连接设置", icon: Connection },
];

const active = ref("dashboard");
const loading = ref(false);
const error = ref("");
const dashboard = ref<Dashboard>();
const integrations = ref<Integration[]>([]);
const content = ref<ContentPlan[]>([]);
const assets = ref<Asset[]>([]);
const evidence = ref<{ claims: AnyRow[]; mappings: AnyRow[]; phraseRules: AnyRow[] }>({ claims: [], mappings: [], phraseRules: [] });
const comments = ref<AnyRow[]>([]);
const live = ref<AnyRow[]>([]);
const shopItems = ref<AnyRow[]>([]);
const competitors = ref<AnyRow[]>([]);
const trends = ref<AnyRow[]>([]);
const alerts = ref<AnyRow[]>([]);
const tasks = ref<AnyRow[]>([]);
const reports = ref<AnyRow[]>([]);
const jobs = ref<AnyRow[]>([]);
const sops = ref<AnyRow[]>([]);
const ledger = ref<Ledger>({ departments: [], employees: [], products: [], accounts: [], stores: [], imports: [], snapshots: [], attributions: [], sourceHealth: [] });
const tokenInput = ref(getToken());
const actorInput = ref(getActor());
const opsSubTab = ref("shop");
const assetSubTab = ref("assets");
const reportSubTab = ref("reports");
const ledgerSubTab = ref("employees");

const todayLabel = new Intl.DateTimeFormat("zh-CN", { dateStyle: "full" }).format(new Date());
const pageTitle = computed(() => navItems.find((item) => item.key === active.value)?.label || "运营中台");
const pendingContent = computed(() => content.value.filter((item) => item.status === "PENDING_APPROVAL"));
const configuredCount = computed(() => integrations.value.filter((item) => item.state !== "UNCONFIGURED").length);

function time(value?: string) {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未记录" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    UNCONFIGURED: "未配置", CONFIGURED: "待验证", HEALTHY: "正常", DEGRADED: "部分可用", ERROR: "异常",
    DRAFT: "候选", PENDING_APPROVAL: "待审核", APPROVED: "已审核", REJECTED: "已退回", SCHEDULED: "待发布",
    PUBLISHED: "已发布", FAILED: "失败", PENDING: "待处理", READY: "可用", BLOCKED: "禁用", ARCHIVED: "归档",
    RUNNING: "执行中", RETRY: "重试中", SUCCEEDED: "已完成", LIVE: "直播中", OPEN: "待处理", RESOLVED: "已解决",
    PARTIAL: "部分成功", ACTIVE: "在职",
  };
  return labels[value] || value || "未获取";
}

function statusType(value: string) {
  if (["HEALTHY", "READY", "APPROVED", "PUBLISHED", "SUCCEEDED", "RESOLVED"].includes(value)) return "success";
  if (["ERROR", "FAILED", "BLOCKED", "CRITICAL"].includes(value)) return "danger";
  if (["DEGRADED", "PENDING_APPROVAL", "RETRY", "WARNING", "OVERDUE"].includes(value)) return "warning";
  return "info";
}

function platformName(value: string) {
  const names: Record<string, string> = {
    DOUYIN: "抖音", TIKTOK: "TikTok", AMAZON: "Amazon", SHOPIFY: "Shopify", WECHAT_CHANNELS: "视频号", XIAOHONGSHU: "小红书", WECHAT_OFFICIAL: "公众号",
    WECOM: "企业微信", TMALL: "天猫", JD: "京东", PINDUODUO: "拼多多", SAIDIAN_MALL: "自有商城",
    JUSHUITAN: "聚水潭", FEIGUA: "飞瓜", WEB_SEARCH: "全网搜索", LOCAL_ASSET: "本地素材库",
    WECOM_DRIVE: "企微网盘", HELP_CENTER: "客服帮助网站", EVIDENCE_WORKBOOK: "证据底表", ALIYUN_OSS: "阿里云 OSS",
  };
  return names[value] || value;
}

function reportColumnLabel(value: string) {
  const labels: Record<string, string> = {
    change: "变更", material: "素材", source: "来源", model: "型号", mediaType: "类型", qualityScore: "质量分",
    employee: "员工/执行者", recordedAt: "记录时间", storageProvider: "统一存储", objectKey: "OSS对象", storageSyncedAt: "同步时间", storageError: "存储异常", content: "内容", kind: "形式", platform: "平台", account: "账号",
    publishedAt: "发布时间", views: "播放量", completionRate: "完播率", likes: "点赞", comments: "评论", shares: "分享",
    saves: "收藏", consultations: "咨询", orders: "订单", action: "动作", object: "对象", occurredAt: "操作时间", result: "结果",
    store: "店铺", type: "事项类型", sourceId: "外部编号", status: "状态", amount: "金额", currency: "币种", unavailableFields: "未获取字段",
    format: "格式", received: "收到", imported: "成功", rejected: "拒绝", attributionCode: "归因码", eventType: "归因事件",
    campaign: "活动", revenue: "成交金额", state: "连接状态", message: "检查结果", latencyMs: "耗时(ms)",
  };
  return labels[value] || value;
}

function reportCell(column: string, value: unknown) {
  if (["recordedAt", "publishedAt", "occurredAt", "storageSyncedAt"].includes(column) && typeof value === "string" && value !== "未同步") return time(value);
  if (column === "unavailableFields" && Array.isArray(value)) return value.length ? value.join("、") : "无";
  if (column === "state" && typeof value === "string") return statusLabel(value);
  if (column === "platform" && typeof value === "string") return platformName(value);
  if (column === "kind") return value === "VIDEO" ? "视频" : value === "ARTICLE" ? "软文" : value;
  if (column === "completionRate" && typeof value === "number") return `${Math.round(value * 10000) / 100}%`;
  return value ?? "未获取";
}

async function withLoading(task: () => Promise<void>, success?: string) {
  loading.value = true;
  error.value = "";
  try {
    await task();
    if (success) ElMessage.success(success);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "请求失败";
    ElMessage.error(error.value);
  } finally {
    loading.value = false;
  }
}

async function loadDashboard() {
  [dashboard.value, integrations.value] = await Promise.all([
    api<Dashboard>("/api/v1/dashboard"),
    api<Integration[]>("/api/v1/integrations"),
  ]);
}

async function loadActive() {
  if (active.value === "dashboard") return loadDashboard();
  if (active.value === "content") [content.value, ledger.value] = await Promise.all([api<ContentPlan[]>("/api/v1/content"), api<Ledger>("/api/v1/ledger")]);
  if (active.value === "assets") {
    [assets.value, evidence.value] = await Promise.all([
      api<Asset[]>("/api/v1/assets?take=200"),
      api<{ claims: AnyRow[]; mappings: AnyRow[]; phraseRules: AnyRow[] }>("/api/v1/evidence"),
    ]);
  }
  if (active.value === "ledger") ledger.value = await api("/api/v1/ledger");
  if (active.value === "operations") {
    [shopItems.value, competitors.value, trends.value, alerts.value] = await Promise.all([
      api<AnyRow[]>("/api/v1/shop"), api<AnyRow[]>("/api/v1/competitors"), api<AnyRow[]>("/api/v1/trends"), api<AnyRow[]>("/api/v1/alerts"),
    ]);
  }
  if (active.value === "engagement") [comments.value, live.value] = await Promise.all([api<AnyRow[]>("/api/v1/comments"), api<AnyRow[]>("/api/v1/live")]);
  if (active.value === "reports") [reports.value, jobs.value, tasks.value, sops.value] = await Promise.all([api<AnyRow[]>("/api/v1/reports"), api<AnyRow[]>("/api/v1/jobs"), api<AnyRow[]>("/api/v1/tasks"), api<AnyRow[]>("/api/v1/sops")]);
  if (active.value === "integrations") integrations.value = await api<Integration[]>("/api/v1/integrations");
}

async function switchPage(key: string) {
  active.value = key;
  await withLoading(loadActive);
}

async function runDaily() {
  await withLoading(async () => {
    await post("/api/v1/jobs/run-daily");
    await loadDashboard();
  }, "今日流程已加入任务队列");
}

async function generateContent() {
  await withLoading(async () => {
    await post("/api/v1/content/generate");
    active.value = "content";
    await loadActive();
  }, "今日选题已生成");
}

async function checkIntegrations() {
  await withLoading(async () => {
    await post("/api/v1/integrations/check");
    integrations.value = await api("/api/v1/integrations");
    if (active.value === "dashboard") await loadDashboard();
  }, "连接状态已刷新");
}

async function approve(item: ContentPlan) {
  await withLoading(async () => {
    await post(`/api/v1/content/${item.id}/approve`, { note: "运营中台审核通过" });
    content.value = await api("/api/v1/content");
  }, "内容已通过审核");
}

async function reject(item: ContentPlan) {
  const { value } = await ElMessageBox.prompt("填写退回原因", "退回内容", { inputPlaceholder: "例如：素材型号与脚本不一致", confirmButtonText: "确认退回", cancelButtonText: "取消" });
  await withLoading(async () => {
    await post(`/api/v1/content/${item.id}/reject`, { reason: value });
    content.value = await api("/api/v1/content");
  }, "内容已退回");
}

async function assignVariantAccount(variantId: string, value: unknown) {
  const platformAccountId = String(value || "");
  if (!platformAccountId) return;
  await withLoading(async () => {
    await patch(`/api/v1/content/variants/${variantId}/target-account`, { platformAccountId });
    content.value = await api("/api/v1/content");
  }, "发布账号已指定");
}

async function resolveAlert(id: string) {
  await withLoading(async () => {
    await post(`/api/v1/alerts/${id}/resolve`);
    alerts.value = await api("/api/v1/alerts");
  }, "提醒已关闭");
}

async function approveReply(id: string) {
  await withLoading(async () => {
    await post(`/api/v1/comments/replies/${id}/approve`);
    comments.value = await api("/api/v1/comments");
  }, "回复任务已执行");
}

async function runJob(kind: string) {
  await withLoading(async () => {
    await post(`/api/v1/jobs/run/${kind}`);
    jobs.value = await api("/api/v1/jobs");
  }, "任务已加入队列");
}

async function saveToken() {
  setToken(tokenInput.value);
  await withLoading(loadDashboard, "访问凭据已保存");
}

function saveActor() {
  setActor(actorInput.value);
  actorInput.value = getActor();
  ElMessage.success("当前员工已记录");
}

async function promptValue(title: string, placeholder: string, value = "") {
  const result = await ElMessageBox.prompt(placeholder, title, { inputValue: value, confirmButtonText: "确认", cancelButtonText: "取消" });
  return String(result.value || "").trim();
}

async function createEmployee() {
  const name = await promptValue("新增员工", "员工姓名");
  const role = await promptValue("新增员工", "岗位/角色", "运营");
  await withLoading(async () => {
    await post("/api/v1/ledger/employees", { name, role });
    ledger.value = await api("/api/v1/ledger");
  }, "员工已加入责任台账");
}

async function createAccount() {
  const integrationKind = (await promptValue("新增平台账号", "平台代码，例如 DOUYIN、TIKTOK、AMAZON、SHOPIFY")).toUpperCase();
  const accountName = await promptValue("新增平台账号", "账号名称");
  const externalAccountId = await promptValue("新增平台账号", "平台账号编号；未知时填写内部唯一编号");
  const region = await promptValue("新增平台账号", "区域：CN、US或GLOBAL", ["TIKTOK", "AMAZON", "SHOPIFY"].includes(integrationKind) ? "US" : "CN");
  await withLoading(async () => {
    await post("/api/v1/ledger/accounts", { integrationKind, accountName, externalAccountId, region });
    ledger.value = await api("/api/v1/ledger");
  }, "平台账号已记录，能力默认未配置");
}

async function createProduct() {
  const name = await promptValue("新增产品", "产品名称");
  const modelCode = await promptValue("新增产品", "型号代码，例如 W9S");
  const category = await promptValue("新增产品", "产品分类", "智能健康穿戴");
  await withLoading(async () => {
    await post("/api/v1/ledger/products", { name, modelCode, category, evidenceIds: [] });
    ledger.value = await api("/api/v1/ledger");
  }, "产品主数据已保存");
}

async function createStore() {
  const accountOptions = ledger.value.accounts.map((item) => `${item.accountName}=${item.id}`).join("；");
  const platformAccountId = await promptValue("新增店铺", `平台账号ID：${accountOptions || "请先新增平台账号"}`);
  const name = await promptValue("新增店铺", "店铺名称");
  const externalStoreId = await promptValue("新增店铺", "平台店铺编号；未知时填写内部唯一编号");
  await withLoading(async () => {
    await post("/api/v1/ledger/stores", { platformAccountId, name, externalStoreId });
    ledger.value = await api("/api/v1/ledger");
  }, "店铺已加入责任台账");
}

async function createAttribution() {
  const attributionCode = await promptValue("记录归因", "归因码，例如 DY-W9S-20260722-01");
  const eventType = (await promptValue("记录归因", "事件类型：CONSULTATION、ORDER、PAYMENT", "ORDER")).toUpperCase();
  const orders = eventType === "ORDER" || eventType === "PAYMENT" ? 1 : 0;
  const consultations = eventType === "CONSULTATION" ? 1 : 0;
  await withLoading(async () => {
    await post("/api/v1/ledger/attributions", { attributionCode, eventType, source: "运营后台人工记录", orders, consultations, occurredAt: new Date().toISOString() });
    ledger.value = await api("/api/v1/ledger");
    ledgerSubTab.value = "attributions";
  }, "归因事件已记录");
}

async function importCsv() {
  const integrationKind = (await promptValue("导入经营快照", "平台代码，例如 AMAZON、SHOPIFY、DOUYIN")).toUpperCase();
  const snapshotType = (await promptValue("导入经营快照", "数据类型：ORDER、SHIPMENT、AFTER_SALE、REFUND、INVENTORY", "ORDER")).toUpperCase();
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,text/csv";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    await withLoading(async () => {
      await post("/api/v1/ledger/import-snapshots", { integrationKind, snapshotType, format: "CSV", sourceName: file.name, csv: await file.text() });
      ledger.value = await api("/api/v1/ledger");
      ledgerSubTab.value = "imports";
    }, "经营数据已导入");
  };
  input.click();
}

onMounted(() => withLoading(loadDashboard));
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">S</div>
        <div><span>SAYDIAN</span><small>全渠道运营中台</small></div>
      </div>
      <nav>
        <button v-for="item in navItems" :key="item.key" :class="['nav-item', { active: active === item.key }]" @click="switchPage(item.key)">
          <el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span>
          <b v-if="item.key === 'content' && dashboard?.content.pendingApproval">{{ dashboard.content.pendingApproval }}</b>
          <b v-if="item.key === 'operations' && dashboard?.operations.alerts">{{ dashboard.operations.alerts }}</b>
        </button>
      </nav>
      <div class="schedule-card">
        <span class="pulse-dot"></span>
        <strong>自动化已启用</strong>
        <small>下一轮巡查按任务计划执行</small>
        <div><span>评论/店铺</span><b>每10分钟</b></div>
        <div><span>运营日报</span><b>23:30</b></div>
      </div>
    </aside>

    <main class="main" v-loading="loading">
      <header class="topbar">
        <div><small>{{ todayLabel }}</small><h1>{{ pageTitle }}</h1></div>
        <div class="top-actions">
          <el-input v-model="actorInput" class="actor-input" size="small" maxlength="30" placeholder="当前员工" @change="saveActor" />
          <span class="connection-state"><i :class="error ? 'bad' : 'good'"></i>{{ error ? '连接异常' : '数据已连接' }}</span>
          <el-button :icon="Refresh" circle @click="withLoading(loadActive)" aria-label="刷新当前页面" />
          <div class="avatar">{{ actorInput.slice(0, 2) }}</div>
        </div>
      </header>

      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="page-alert" />

      <section v-if="active === 'dashboard'" class="page dashboard-page">
        <div class="hero-panel">
          <div class="hero-copy">
            <span class="eyebrow">TODAY'S OPERATIONS</span>
            <h2>从素材到发布，再到数据复盘</h2>
            <p>今日内容、店铺、直播与评论在同一条任务链路中运行。未接入账号保持“未配置”，不会进入自动发布。</p>
            <div class="hero-actions">
              <el-button type="primary" size="large" :icon="Promotion" @click="runDaily">执行今日流程</el-button>
              <el-button size="large" :icon="DocumentChecked" @click="generateContent">生成今日内容</el-button>
            </div>
          </div>
          <div class="orbit-card">
            <div class="orbit-core"><strong>{{ dashboard?.content.pendingApproval ?? 0 }}</strong><span>待审核</span></div>
            <div class="orbit-node node-a">素材</div><div class="orbit-node node-b">内容</div><div class="orbit-node node-c">发布</div><div class="orbit-node node-d">复盘</div>
          </div>
        </div>

        <div class="metric-grid">
          <article class="metric-card red"><span>今日内容</span><strong>{{ (dashboard?.content.pendingApproval ?? 0) + (dashboard?.content.approved ?? 0) }}</strong><small>待审核 {{ dashboard?.content.pendingApproval ?? 0 }} · 已发布 {{ dashboard?.content.published ?? 0 }}</small></article>
          <article class="metric-card orange"><span>素材资产</span><strong>{{ dashboard?.assets.total ?? 0 }}</strong><small>可用 {{ dashboard?.assets.ready ?? 0 }} · 待整理 {{ dashboard?.assets.pending ?? 0 }}</small></article>
          <article class="metric-card blue"><span>经营责任台账</span><strong>{{ dashboard?.ledger.accounts ?? 0 }}</strong><small>员工 {{ dashboard?.ledger.employees ?? 0 }} · 店铺 {{ dashboard?.ledger.stores ?? 0 }} · 待分配 {{ dashboard?.ledger.unassignedSnapshots ?? 0 }}</small></article>
          <article class="metric-card green"><span>已接入能力</span><strong>{{ dashboard?.integrations.healthy ?? 0 }}</strong><small>未配置 {{ dashboard?.integrations.unconfigured ?? 0 }} · 异常 {{ dashboard?.integrations.error ?? 0 }}</small></article>
        </div>

        <div class="two-column">
          <section class="panel">
            <div class="panel-title"><div><span>今日工作流</span><small>Asia/Shanghai</small></div><el-button link type="primary" @click="switchPage('reports')">查看任务</el-button></div>
            <div class="timeline">
              <div v-for="item in [['00:30','素材、知识库和商城数据同步'],['05:30','店铺、竞品及集成巡查'],['07:00','生成视频与软文候选'],['08:30','企微发送审核提醒'],['10:00','发布已审核内容'],['23:30','生成并推送运营日报']]" :key="item[0]">
                <time>{{ item[0] }}</time><i></i><span>{{ item[1] }}</span>
              </div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-title"><div><span>最新运营报告</span><small>数据缺失时明确显示未获取</small></div></div>
            <div v-if="dashboard?.latestReports.length" class="report-list">
              <article v-for="report in dashboard.latestReports" :key="report.id"><div class="report-icon"><DataAnalysis /></div><div><strong>{{ report.title }}</strong><p>{{ report.summary }}</p><small>{{ time(report.createdAt) }}</small></div></article>
            </div>
            <el-empty v-else description="尚未生成运营报告" :image-size="70" />
          </section>
        </div>
      </section>

      <section v-else-if="active === 'content'" class="page">
        <div class="section-heading"><div><span class="eyebrow">CONTENT COMMAND</span><h2>今日内容审核台</h2><p>系统保留3个候选，自动选出最高分内容进入审核。</p></div><el-button type="primary" :icon="DocumentChecked" @click="generateContent">生成今日候选</el-button></div>
        <div class="summary-strip"><span>全部 <b>{{ content.length }}</b></span><span>待审核 <b>{{ pendingContent.length }}</b></span><span>已审核 <b>{{ content.filter(i => i.status === 'APPROVED').length }}</b></span><span>已发布 <b>{{ content.filter(i => i.status === 'PUBLISHED').length }}</b></span></div>
        <div class="content-grid">
          <article v-for="item in content" :key="item.id" class="content-card">
            <div class="content-card-head"><div><el-tag :type="item.kind === 'VIDEO' ? 'danger' : 'warning'" effect="dark">{{ item.kind === 'VIDEO' ? '视频' : '软文' }}</el-tag><el-tag :type="statusType(item.status)" effect="plain">{{ statusLabel(item.status) }}</el-tag></div><div class="score"><b>{{ item.score }}</b><span>选题分</span></div></div>
            <h3>{{ item.topic }}</h3><p class="hook">“{{ item.hook }}”</p>
            <dl><div><dt>目标人群</dt><dd>{{ item.audience }}</dd></div><div><dt>传播目标</dt><dd>{{ item.objective }}</dd></div></dl>
            <ol><li v-for="line in item.outline" :key="line">{{ line }}</li></ol>
            <el-alert v-if="item.riskReasons.length" :title="item.riskReasons.join('；')" type="warning" :closable="false" show-icon />
            <div class="platform-tags"><span v-for="variant in item.variants" :key="variant.id">{{ platformName(variant.platform) }}</span></div>
            <div class="variant-account-list"><div v-for="variant in item.variants" :key="`${variant.id}-account`"><small>{{ platformName(variant.platform) }}发布账号</small><el-select :model-value="variant.targetAccountId" placeholder="未指定，不会进入发布队列" clearable @change="assignVariantAccount(variant.id, $event)"><el-option v-for="account in ledger.accounts.filter(account => account.integration?.kind === variant.platform)" :key="account.id" :label="`${account.accountName}（${account.region}）`" :value="account.id" /></el-select></div></div>
            <div class="card-actions" v-if="item.status === 'PENDING_APPROVAL'"><el-button @click="reject(item)">退回修改</el-button><el-button type="primary" @click="approve(item)">审核通过</el-button></div>
          </article>
        </div>
        <el-empty v-if="!content.length" description="今日内容尚未生成" />
      </section>

      <section v-else-if="active === 'assets'" class="page">
        <div class="section-heading"><div><span class="eyebrow">BRAND LIBRARY</span><h2>素材与证据主数据</h2><p>本地与企微源文件只读扫描，原始和派生素材统一存入私有阿里云 OSS。</p></div><el-button :icon="Refresh" @click="runJob('SYNC_ASSETS')">扫描并同步OSS</el-button></div>
        <el-segmented v-model="assetSubTab" :options="[{ label: `素材 ${assets.length}`, value: 'assets' }, { label: `证据 ${evidence.claims.length}`, value: 'evidence' }, { label: `型号 ${evidence.mappings.length}`, value: 'mappings' }, { label: `表述规则 ${evidence.phraseRules.length}`, value: 'rules' }]" />
        <div class="table-panel" v-if="assetSubTab === 'assets'">
          <el-table :data="assets" stripe height="560"><el-table-column prop="fileName" label="素材" min-width="240" show-overflow-tooltip /><el-table-column prop="mediaType" label="类型" width="90" /><el-table-column prop="model" label="型号" width="110"><template #default="scope">{{ scope.row.model || '待识别' }}</template></el-table-column><el-table-column prop="scene" label="场景" min-width="150" show-overflow-tooltip /><el-table-column label="规格" width="140"><template #default="scope">{{ scope.row.width && scope.row.height ? `${scope.row.width}×${scope.row.height}` : '未获取' }}</template></el-table-column><el-table-column prop="discoveredBy" label="增加/扫描人" width="130" /><el-table-column label="OSS存储" min-width="230" show-overflow-tooltip><template #default="scope"><span v-if="scope.row.objectKey">已同步 · {{ scope.row.objectKey }}</span><span v-else>{{ scope.row.storageError || '待同步' }}</span></template></el-table-column><el-table-column label="质量" width="120"><template #default="scope"><el-progress :percentage="scope.row.qualityScore" :stroke-width="8" :show-text="false" /><small>{{ scope.row.qualityScore }}</small></template></el-table-column><el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column></el-table>
        </div>
        <div class="table-panel" v-else-if="assetSubTab === 'evidence'"><el-table :data="evidence.claims" stripe height="560"><el-table-column prop="id" label="编号" width="80" /><el-table-column prop="name" label="证据" min-width="220" /><el-table-column prop="coveredObject" label="适用范围" min-width="260" show-overflow-tooltip /><el-table-column prop="publicWording" label="允许表述" min-width="300" show-overflow-tooltip /><el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column></el-table></div>
        <div class="table-panel" v-else-if="assetSubTab === 'mappings'"><el-table :data="evidence.mappings" stripe height="560"><el-table-column prop="commercialName" label="商品名称" width="180" /><el-table-column prop="nameplateModel" label="包装/铭牌" min-width="220" /><el-table-column prop="registeredModel" label="注册型号" min-width="220" /><el-table-column prop="requiredAction" label="发布前动作" min-width="320" show-overflow-tooltip /><el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column></el-table></div>
        <div class="table-panel" v-else><el-table :data="evidence.phraseRules" stripe height="560"><el-table-column prop="category" label="类别" width="140" /><el-table-column prop="blockedText" label="拦截表述" min-width="280" /><el-table-column prop="replacement" label="建议替代" min-width="320" /><el-table-column prop="condition" label="使用条件" min-width="260" /></el-table></div>
      </section>

      <section v-else-if="active === 'ledger'" class="page">
        <div class="section-heading">
          <div><span class="eyebrow">ACCOUNTABILITY LEDGER</span><h2>经营主数据与责任台账</h2><p>员工、产品、账号、店铺、经营快照和归因记录使用同一条审计链路。</p></div>
          <div class="hero-actions"><el-button @click="createEmployee">新增员工</el-button><el-button @click="createProduct">新增产品</el-button><el-button @click="createAccount">新增账号</el-button><el-button @click="createStore">新增店铺</el-button><el-button type="primary" @click="importCsv">导入CSV</el-button></div>
        </div>
        <el-segmented v-model="ledgerSubTab" :options="[
          { label: `员工 ${ledger.employees.length}`, value: 'employees' },
          { label: `产品 ${ledger.products.length}`, value: 'products' },
          { label: `账号 ${ledger.accounts.length}`, value: 'accounts' },
          { label: `店铺 ${ledger.stores.length}`, value: 'stores' },
          { label: `经营快照 ${ledger.snapshots.length}`, value: 'snapshots' },
          { label: `导入批次 ${ledger.imports.length}`, value: 'imports' },
          { label: `归因 ${ledger.attributions.length}`, value: 'attributions' },
          { label: `数据源 ${ledger.sourceHealth.length}`, value: 'sources' },
        ]" />
        <div class="table-panel" v-if="ledgerSubTab === 'employees'"><el-table :data="ledger.employees" stripe height="560"><el-table-column prop="name" label="员工" width="140" /><el-table-column prop="employeeNo" label="员工编号" width="130"><template #default="scope">{{ scope.row.employeeNo || '未配置' }}</template></el-table-column><el-table-column label="部门" width="150"><template #default="scope">{{ scope.row.department?.name || '未分配' }}</template></el-table-column><el-table-column prop="role" label="岗位/角色" min-width="180" /><el-table-column prop="wecomUserId" label="企微身份" min-width="180"><template #default="scope">{{ scope.row.wecomUserId || '未配置' }}</template></el-table-column><el-table-column label="权限" width="120"><template #default="scope">{{ scope.row.isSuperAdmin ? '超级管理员' : '普通员工' }}</template></el-table-column><el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="scope.row.status === 'ACTIVE' ? 'success' : 'info'">{{ scope.row.status }}</el-tag></template></el-table-column></el-table></div>
        <div class="table-panel" v-else-if="ledgerSubTab === 'products'"><el-table :data="ledger.products" stripe height="560"><el-table-column prop="modelCode" label="型号" width="130" /><el-table-column prop="name" label="产品" min-width="220" /><el-table-column prop="category" label="分类" min-width="180" /><el-table-column label="SKU" min-width="240"><template #default="scope">{{ scope.row.skus?.length ? scope.row.skus.map((i: AnyRow) => i.skuCode).join('、') : '未配置' }}</template></el-table-column><el-table-column label="证据" width="100"><template #default="scope">{{ scope.row.evidenceIds?.length || 0 }}项</template></el-table-column><el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column></el-table></div>
        <div class="table-panel" v-else-if="ledgerSubTab === 'accounts'"><el-table :data="ledger.accounts" stripe height="560"><el-table-column label="平台" width="120"><template #default="scope">{{ scope.row.integration?.displayName || '未获取' }}</template></el-table-column><el-table-column prop="accountName" label="账号" min-width="180" /><el-table-column prop="externalAccountId" label="平台账号编号" min-width="180" /><el-table-column prop="region" label="区域" width="90" /><el-table-column label="负责人" width="130"><template #default="scope">{{ scope.row.ownerEmployee?.name || '待分配' }}</template></el-table-column><el-table-column label="能力状态" min-width="260"><template #default="scope"><span v-if="Object.keys(scope.row.capabilityStatus || {}).length">{{ Object.entries(scope.row.capabilityStatus).map(([k,v]) => `${k}:${statusLabel(String(v))}`).join('；') }}</span><span v-else>未配置</span></template></el-table-column><el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="statusType(scope.row.state)">{{ statusLabel(scope.row.state) }}</el-tag></template></el-table-column></el-table></div>
        <div class="table-panel" v-else-if="ledgerSubTab === 'stores'"><el-table :data="ledger.stores" stripe height="560"><el-table-column label="平台" width="120"><template #default="scope">{{ scope.row.platformAccount?.integration?.displayName || '未获取' }}</template></el-table-column><el-table-column label="账号" width="160"><template #default="scope">{{ scope.row.platformAccount?.accountName || '未获取' }}</template></el-table-column><el-table-column prop="name" label="店铺" min-width="200" /><el-table-column prop="externalStoreId" label="平台店铺编号" min-width="180" /><el-table-column prop="region" label="区域" width="90" /><el-table-column label="负责人" width="130"><template #default="scope">{{ scope.row.ownerEmployee?.name || '待分配' }}</template></el-table-column><el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="statusType(scope.row.state)">{{ statusLabel(scope.row.state) }}</el-tag></template></el-table-column></el-table></div>
        <div class="table-panel" v-else-if="ledgerSubTab === 'snapshots'"><el-table :data="ledger.snapshots" stripe height="560"><el-table-column label="平台" width="120"><template #default="scope">{{ scope.row.integration?.displayName || '未获取' }}</template></el-table-column><el-table-column label="账号/店铺" min-width="180"><template #default="scope">{{ scope.row.platformAccount?.accountName || '未绑定账号' }} / {{ scope.row.store?.name || '未绑定店铺' }}</template></el-table-column><el-table-column prop="type" label="类型" width="130" /><el-table-column prop="sourceId" label="外部编号" min-width="170" /><el-table-column prop="status" label="状态" width="120" /><el-table-column prop="amount" label="金额" width="120"><template #default="scope">{{ scope.row.amount ?? '未获取' }} {{ scope.row.currency || '' }}</template></el-table-column><el-table-column label="负责人" width="130"><template #default="scope">{{ scope.row.ownerEmployee?.name || '待分配' }}</template></el-table-column><el-table-column label="发生时间" width="160"><template #default="scope">{{ time(scope.row.occurredAt) }}</template></el-table-column><el-table-column label="未获取字段" min-width="200"><template #default="scope">{{ scope.row.unavailableFields?.length ? scope.row.unavailableFields.join('、') : '无' }}</template></el-table-column></el-table></div>
        <div class="table-panel" v-else-if="ledgerSubTab === 'imports'"><el-table :data="ledger.imports" stripe height="560"><el-table-column label="平台" width="120"><template #default="scope">{{ scope.row.integration?.displayName || '未获取' }}</template></el-table-column><el-table-column prop="sourceName" label="数据文件/来源" min-width="220" /><el-table-column prop="format" label="格式" width="90" /><el-table-column prop="importedBy" label="导入员工" width="130" /><el-table-column prop="recordsReceived" label="收到" width="80" /><el-table-column prop="recordsImported" label="成功" width="80" /><el-table-column prop="recordsRejected" label="拒绝" width="80" /><el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column><el-table-column label="导入时间" width="160"><template #default="scope">{{ time(scope.row.createdAt) }}</template></el-table-column></el-table></div>
        <div class="table-panel" v-else-if="ledgerSubTab === 'attributions'"><div class="table-toolbar"><el-button type="primary" @click="createAttribution">记录归因事件</el-button></div><el-table :data="ledger.attributions" stripe height="520"><el-table-column prop="attributionCode" label="归因码" min-width="200" /><el-table-column prop="eventType" label="事件" width="130" /><el-table-column label="平台/账号" min-width="180"><template #default="scope">{{ scope.row.integration?.displayName || '未获取' }} / {{ scope.row.platformAccount?.accountName || '未获取' }}</template></el-table-column><el-table-column prop="source" label="来源" min-width="180" /><el-table-column prop="consultations" label="咨询" width="80" /><el-table-column prop="orders" label="订单" width="80" /><el-table-column prop="revenue" label="成交金额" width="120"><template #default="scope">{{ scope.row.revenue ?? '未获取' }}</template></el-table-column><el-table-column label="员工" width="120"><template #default="scope">{{ scope.row.employee?.name || '未绑定' }}</template></el-table-column><el-table-column label="时间" width="160"><template #default="scope">{{ time(scope.row.occurredAt) }}</template></el-table-column></el-table></div>
        <div class="table-panel" v-else><el-table :data="ledger.sourceHealth" stripe height="560"><el-table-column label="数据源" width="150"><template #default="scope">{{ scope.row.integration?.displayName || '未获取' }}</template></el-table-column><el-table-column label="账号" width="160"><template #default="scope">{{ scope.row.platformAccount?.accountName || '连接级' }}</template></el-table-column><el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="statusType(scope.row.state)">{{ statusLabel(scope.row.state) }}</el-tag></template></el-table-column><el-table-column prop="message" label="检查结果" min-width="300" /><el-table-column prop="latencyMs" label="耗时(ms)" width="100"><template #default="scope">{{ scope.row.latencyMs ?? '未获取' }}</template></el-table-column><el-table-column label="未获取原因" min-width="220"><template #default="scope">{{ scope.row.unavailableFields?.length ? scope.row.unavailableFields.join('、') : '无' }}</template></el-table-column><el-table-column label="检查时间" width="160"><template #default="scope">{{ time(scope.row.checkedAt) }}</template></el-table-column></el-table></div>
      </section>

      <section v-else-if="active === 'operations'" class="page">
        <div class="section-heading"><div><span class="eyebrow">OPERATIONS WATCH</span><h2>店铺、竞品与全网趋势</h2><p>不可获得的数据记为“未获取”，不按零值参与判断。</p></div><el-button :icon="Search" @click="runJob('SYNC_SHOP')">执行巡查</el-button></div>
        <el-segmented v-model="opsSubTab" :options="[{ label: `店铺事项 ${shopItems.length}`, value: 'shop' }, { label: `竞品 ${competitors.length}`, value: 'competitors' }, { label: `趋势 ${trends.length}`, value: 'trends' }, { label: `提醒 ${alerts.filter(i => i.status === 'OPEN').length}`, value: 'alerts' }]" />
        <div class="table-panel" v-if="opsSubTab === 'shop'"><el-table :data="shopItems" stripe height="560"><el-table-column label="平台" width="120"><template #default="scope">{{ scope.row.integration?.displayName || '未获取' }}</template></el-table-column><el-table-column prop="type" label="事项" width="130" /><el-table-column prop="summary" label="摘要" min-width="360" /><el-table-column prop="owner" label="负责人" width="120"><template #default="scope">{{ scope.row.owner || '待分配' }}</template></el-table-column><el-table-column label="状态" width="120"><template #default="scope"><el-tag :type="scope.row.overdue ? 'danger' : 'info'">{{ scope.row.overdue ? '已超时' : statusLabel(scope.row.status) }}</el-tag></template></el-table-column></el-table></div>
        <div class="card-list" v-else-if="opsSubTab === 'competitors'"><article v-for="item in competitors" :key="item.id"><div><el-tag>{{ platformName(item.platform) }}</el-tag><h3>{{ item.name }}</h3><p>{{ item.snapshots?.[0]?.changes?.length ? item.snapshots[0].changes.join('；') : '最新变化未获取' }}</p></div><small>{{ item.snapshots?.[0] ? time(item.snapshots[0].capturedAt) : '尚无快照' }}</small></article><el-empty v-if="!competitors.length" description="竞品观察名单尚未导入" /></div>
        <div class="table-panel" v-else-if="opsSubTab === 'trends'"><el-table :data="trends" stripe height="560"><el-table-column prop="keyword" label="关键词" width="180" /><el-table-column prop="source" label="来源" width="140" /><el-table-column prop="category" label="分类" width="130" /><el-table-column prop="changeRate" label="变化" width="100"><template #default="scope">{{ scope.row.changeRate == null ? '未获取' : `${Math.round(scope.row.changeRate * 100)}%` }}</template></el-table-column><el-table-column prop="opportunity" label="机会" min-width="280" /><el-table-column prop="action" label="建议动作" min-width="280" /></el-table></div>
        <div class="alert-list" v-else><article v-for="item in alerts" :key="item.id" :class="item.level.toLowerCase()"><div><el-tag :type="statusType(item.level)">{{ item.level }}</el-tag><h3>{{ item.title }}</h3><p>{{ item.message }}</p><small>{{ time(item.createdAt) }}</small></div><el-button v-if="item.status === 'OPEN'" @click="resolveAlert(item.id)">标记解决</el-button></article><el-empty v-if="!alerts.length" description="当前没有运营提醒" /></div>
      </section>

      <section v-else-if="active === 'engagement'" class="page">
        <div class="section-heading"><div><span class="eyebrow">AUDIENCE CARE</span><h2>评论与直播巡查</h2><p>标准回复先匹配客服知识库；健康、投诉和售后问题自动转人工。</p></div><el-button :icon="Refresh" @click="runJob('SYNC_COMMENTS')">巡查评论</el-button></div>
        <div class="two-column engagement-grid">
          <section class="panel"><div class="panel-title"><div><span>评论处理队列</span><small>待处理 {{ comments.filter(i => i.status === 'PENDING').length }}</small></div></div><div class="comment-list"><article v-for="item in comments" :key="item.id"><div class="comment-meta"><span>{{ item.integration?.displayName }}</span><el-tag :type="item.requiresHuman ? 'warning' : 'success'">{{ item.requiresHuman ? '人工处理' : '标准问题' }}</el-tag></div><p class="comment-text">{{ item.text }}</p><div v-if="item.suggestedReply" class="reply-box"><small>建议回复 · {{ Math.round((item.confidence || 0) * 100) }}%</small><p>{{ item.suggestedReply }}</p></div><el-button v-if="item.replyJobs?.[0]?.status === 'PENDING'" type="primary" plain @click="approveReply(item.replyJobs[0].id)">审核并回复</el-button></article><el-empty v-if="!comments.length" description="暂无评论数据，平台能力未配置时不会生成模拟数据" /></div></section>
          <section class="panel"><div class="panel-title"><div><span>直播间状态</span><small>每5分钟快照</small></div></div><div class="live-list"><article v-for="item in live" :key="item.id"><div class="live-badge"><span></span>LIVE</div><h3>{{ item.title || item.remoteRoomId }}</h3><p>{{ item.issueSummary?.length ? item.issueSummary.join('；') : '当前未发现异常' }}</p><small>最近采集 {{ time(item.lastCapturedAt) }}</small></article><el-empty v-if="!live.length" description="当前未获取到直播间" /></div></section>
        </div>
      </section>

      <section v-else-if="active === 'reports'" class="page">
        <div class="section-heading"><div><span class="eyebrow">REPORTING & TASKS</span><h2>运营报告与自动化任务</h2><p>每一项自动动作均保存状态、重试次数和执行结果。</p></div><el-button type="primary" :icon="Promotion" @click="runDaily">执行今日流程</el-button></div>
        <el-segmented v-model="reportSubTab" :options="[{ label: `报告 ${reports.length}`, value: 'reports' }, { label: `自动任务 ${jobs.length}`, value: 'jobs' }, { label: `执行待办 ${tasks.length}`, value: 'tasks' }, { label: `SOP版本 ${sops.length}`, value: 'sops' }]" />
        <div class="report-cards" v-if="reportSubTab === 'reports'"><article v-for="item in reports" :key="item.id"><div class="report-card-top"><el-tag type="danger" effect="dark">{{ item.kind }}</el-tag><small>{{ time(item.createdAt) }}</small></div><h3>{{ item.title }}</h3><p>{{ item.summary }}</p><div class="action-chips"><span v-for="action in (item.actions || [])" :key="action.action">{{ action.priority }} · {{ action.action }}</span></div><el-collapse class="report-detail"><el-collapse-item title="查看素材、平台、员工和效果明细" name="detail"><section v-for="section in (item.sections || [])" :key="section.title" class="report-section"><h4>{{ section.title }}</h4><p v-if="section.text">{{ section.text }}</p><el-table v-if="section.rows?.length" :data="section.rows" size="small" border><el-table-column v-for="column in section.columns" :key="column" :label="reportColumnLabel(column)" min-width="125" show-overflow-tooltip><template #default="scope">{{ reportCell(column, scope.row[column]) }}</template></el-table-column></el-table><el-empty v-else-if="section.rows" description="今日无记录" :image-size="45" /></section></el-collapse-item></el-collapse></article><el-empty v-if="!reports.length" description="运行今日流程后生成报告" /></div>
        <div class="table-panel" v-else-if="reportSubTab === 'jobs'"><el-table :data="jobs" stripe height="560"><el-table-column prop="kind" label="任务" min-width="180" /><el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column><el-table-column prop="attempts" label="次数" width="80" /><el-table-column prop="lastError" label="最近错误" min-width="280"><template #default="scope">{{ scope.row.lastError || '—' }}</template></el-table-column><el-table-column label="计划时间" width="160"><template #default="scope">{{ time(scope.row.scheduledAt) }}</template></el-table-column></el-table></div>
        <div class="table-panel" v-else-if="reportSubTab === 'tasks'"><el-table :data="tasks" stripe height="560"><el-table-column prop="priority" label="优先级" width="100" /><el-table-column prop="title" label="任务" min-width="280" /><el-table-column prop="category" label="分类" width="130" /><el-table-column prop="owner" label="负责人" width="120"><template #default="scope">{{ scope.row.owner || '待分配' }}</template></el-table-column><el-table-column label="截止" width="160"><template #default="scope">{{ time(scope.row.dueAt) }}</template></el-table-column><el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column></el-table></div>
        <div class="sop-list" v-else><article v-for="item in sops" :key="item.id"><div><strong>{{ item.kind }} · V{{ item.version }}</strong><el-tag :type="item.status === 'ACTIVE' ? 'success' : 'info'">{{ item.status }}</el-tag></div><p>{{ item.changeNote }}</p><small>生效时间 {{ time(item.effectiveAt) }}</small></article></div>
      </section>

      <section v-else class="page">
        <div class="section-heading"><div><span class="eyebrow">INTEGRATION STATUS</span><h2>平台连接与能力状态</h2><p>每个账号分别显示能力；未验证的接口不会显示为已打通。</p></div><el-button :icon="Refresh" @click="checkIntegrations">检查全部连接</el-button></div>
        <div class="integration-grid"><article v-for="item in integrations" :key="item.id"><div class="integration-icon">{{ item.displayName.slice(0, 1) }}</div><div class="integration-copy"><div><h3>{{ item.displayName }}</h3><el-tag :type="statusType(item.state)">{{ statusLabel(item.state) }}</el-tag></div><p>{{ item.message }}</p><div class="capability-tags"><span v-for="capability in item.capabilities" :key="capability">{{ capability }}</span><span v-if="!item.capabilities.length">暂无已验证能力</span></div><small>检查时间：{{ time(item.lastCheckedAt) }}</small></div></article></div>
        <section class="token-panel"><div><el-icon><Setting /></el-icon><div><strong>运营中台访问凭据</strong><p>本地开发默认使用本地凭据；部署时请改为环境变量中的长随机值。</p></div></div><el-input v-model="tokenInput" type="password" show-password placeholder="输入访问凭据" /><el-button type="primary" @click="saveToken">保存并验证</el-button></section>
      </section>
    </main>
  </div>
</template>
