<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox, type UploadUserFile } from "element-plus";
import { Collection, Download, Plus, Refresh, Search, UploadFilled, View } from "@element-plus/icons-vue";
import { api, patch, post, upload } from "../api";

type Row = Record<string, any>;
type Overview = {
  knowledge: { total: number; ready: number; pending: number };
  assets: { total: number; ready: number; pending: number; aiFailed: number; today: number; highQuality: number; ossStored: number; gapCount: number };
  oss: { ok: boolean; message: string };
  ai: { state: string; message: string };
};

const activeTab = ref("knowledge");
const knowledgeView = ref("entries");
const assetView = ref("list");
const loading = ref(false);
const overview = ref<Overview>();
const knowledge = ref<Row[]>([]);
const assets = ref<Row[]>([]);
const jobs = ref<Row[]>([]);
const gaps = ref<Row[]>([]);
const dailyReport = ref<Row>();
const growthLoop = ref<Row>();
const controls = ref<{ claims: Row[]; mappings: Row[]; phraseRules: Row[]; brandProfiles: Row[]; products: Row[]; faqs: Row[]; employees: Row[] }>({ claims: [], mappings: [], phraseRules: [], brandProfiles: [], products: [], faqs: [], employees: [] });
const knowledgeDialog = ref(false);
const uploadDialog = ref(false);
const metadataDialog = ref(false);
const detailDrawer = ref(false);
const editingKnowledgeId = ref("");
const editingAssetId = ref("");
const assetDetail = ref<Row>();
const batchFiles = ref<UploadUserFile[]>([]);
const nextCursor = ref<string | null>(null);
const assetTotal = ref(0);
const selectedVideoId = ref("");
const segments = ref<Row[]>([]);
const assistState = ref("");
const assistMessage = ref("");

const knowledgeFilter = reactive({ query: "", type: "", status: "", model: "" });
const assetFilter = reactive({ query: "", kind: "", level: "", model: "", moduleType: "", employeeId: "", reviewStatus: "", availabilityStatus: "", rightsStatus: "", minimumScore: "" });
const knowledgeForm = reactive({ type: "FAQ", title: "", category: "", model: "", summary: "", reply: "", body: "", source: "运营后台录入", sourceRefs: "", sourceLevel: "B", validUntil: "", evidenceIds: "", keywords: "", scenarios: "", audience: "customer" });
const batchForm = reactive({ sourceType: "EMPLOYEE_CAPTURE", productScope: "UNKNOWN", productIds: [] as string[], assetKind: "", contentDescription: "", originalStatus: true, rightsStatus: "COMMERCIAL", acquiredAt: "" });
const metadataForm = reactive({ displayName: "", level: "ORIGINAL", productScope: "UNKNOWN", productIds: [] as string[], rightsStatus: "AUTH_REQUIRED", contentDescription: "", acquiredAt: "", restriction: "", evidenceIds: "" });

const knowledgeTypes = [
  { label: "品牌信息", value: "BRAND" }, { label: "产品卖点", value: "PRODUCT" }, { label: "产品参数", value: "PARAMETER" },
  { label: "知识条目", value: "KNOWLEDGE" }, { label: "标准话术", value: "WORDING" }, { label: "常见问答", value: "FAQ" },
  { label: "禁用词", value: "FORBIDDEN" }, { label: "售后规则", value: "AFTER_SALE" }, { label: "使用教程", value: "TUTORIAL" },
];
const kindOptions = ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"];
const levelOptions = ["ORIGINAL", "MODULE", "FINISHED", "REFERENCE", "AI_GENERATED"];
const moduleOptions = ["HOOK", "PAIN", "SCENE", "FEATURE", "BENEFIT", "PROOF", "DEMO", "COMPARE", "UGC", "STORY", "TRANSITION", "TRAFFIC", "OFFER", "CTA", "ENDING"];
const rightsOptions = ["COMMERCIAL", "INTERNAL", "EDIT_ONLY", "AUTH_REQUIRED", "EXPIRED", "PROHIBITED"];
const videoAssets = computed(() => assets.value.filter((item) => item.kind === "VIDEO"));

function typeLabel(value: string) { return knowledgeTypes.find((item) => item.value === value)?.label || value; }
function dateTime(value?: string) { if (!value) return "未记录"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "未记录" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date); }
function list(value: unknown) { return Array.isArray(value) && value.length ? value.join("、") : "—"; }
function fileSize(value: unknown) { const size = Number(value || 0); if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(2)} GB`; if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`; if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`; return `${size} B`; }
function statusType(value: string) { if (["READY", "APPROVED", "ACTIVE", "SUCCEEDED", "AVAILABLE", "CONFIGURED", "HEALTHY", "COMMERCIAL"].includes(value)) return "success"; if (["FAILED", "REJECTED", "SUSPENDED", "PROHIBITED", "ERROR"].includes(value)) return "danger"; if (["PENDING", "RETURNED", "RETRY", "UNCONFIGURED", "AUTH_REQUIRED", "ANALYZING"].includes(value)) return "warning"; return "info"; }
function statusLabel(value: string) { return ({ DRAFT: "草稿", PENDING: "待审核", READY: "可用", BLOCKED: "禁用", ARCHIVED: "归档", APPROVED: "已通过", RETURNED: "已退回", REJECTED: "已拒绝", ACTIVE: "可调用", INACTIVE: "未启用", SUSPENDED: "暂停", RECEIVED: "已接收", HASHED: "已计算哈希", STORED: "已存OSS", ANALYZING: "AI处理中", READY_FOR_REVIEW: "待人工审核", FAILED: "失败", SUCCEEDED: "已完成", RETRY: "待重试", UNCONFIGURED: "未配置", COMMERCIAL: "可商用", INTERNAL: "仅内部", EDIT_ONLY: "修改后可用", AUTH_REQUIRED: "待授权", EXPIRED: "已过期", PROHIBITED: "禁止使用" } as Record<string, string>)[value] || value; }
function kindLabel(value: string) { return ({ IMAGE: "图片", VIDEO: "视频", AUDIO: "音频", DOCUMENT: "文档" } as Record<string, string>)[value] || value; }
function queryString(values: Record<string, string>) { const params = new URLSearchParams(); Object.entries(values).forEach(([key, value]) => { if (String(value).trim()) params.set(key, String(value).trim()); }); return params.toString(); }

async function run(task: () => Promise<void>, success?: string) {
  loading.value = true;
  try { await task(); if (success) ElMessage.success(success); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : "操作失败"); }
  finally { loading.value = false; }
}

async function loadKnowledge() { knowledge.value = await api<Row[]>(`/api/v1/brand-data/knowledge?${queryString(knowledgeFilter)}`); }
async function loadAssets(reset = true) {
  const params = new URLSearchParams(queryString(assetFilter)); params.set("pageSize", "50");
  if (!reset && nextCursor.value) params.set("cursor", nextCursor.value);
  const result = await api<{ items: Row[]; total: number; nextCursor: string | null }>(`/api/v1/brand-data/assets?${params.toString()}`);
  assets.value = reset ? result.items : [...assets.value, ...result.items]; assetTotal.value = result.total; nextCursor.value = result.nextCursor;
}
async function loadJobs() { jobs.value = await api<Row[]>("/api/v1/brand-data/analysis-jobs"); }
async function loadGaps(refresh = false) { gaps.value = await api<Row[]>(`/api/v1/brand-data/asset-gaps${refresh ? "?refresh=1" : ""}`); }
async function loadReport() { dailyReport.value = await api<Row>("/api/v1/brand-data/reports/daily"); }
async function loadGrowthLoop() { growthLoop.value = await api<Row>("/api/v1/brand-data/growth-loop"); }
async function refreshGrowthLoop() { await run(async () => { growthLoop.value = await post<Row>("/api/v1/brand-data/growth-loop/refresh"); await Promise.all([loadAssets(), loadGaps(), loadReport(), refreshOverview()]); }, "评分、缺口和下一轮任务已更新"); }
async function refreshOverview() { overview.value = await api<Overview>("/api/v1/brand-data/overview"); }
async function reload() {
  await run(async () => {
    const [summary, knowledgeRows, controlsRows] = await Promise.all([api<Overview>("/api/v1/brand-data/overview"), api<Row[]>("/api/v1/brand-data/knowledge"), api<typeof controls.value>("/api/v1/brand-data/knowledge-controls")]);
    overview.value = summary; knowledge.value = knowledgeRows; controls.value = controlsRows;
    await Promise.all([loadAssets(), loadJobs(), loadGaps(), loadReport(), loadGrowthLoop()]);
  });
}

function clearObject(target: Record<string, any>, values: Record<string, any>) { Object.keys(target).forEach((key) => { target[key] = values[key] ?? (Array.isArray(target[key]) ? [] : ""); }); }
function openKnowledge(row?: Row) {
  editingKnowledgeId.value = row?.id || "";
  clearObject(knowledgeForm, { type: row?.type || "FAQ", title: row?.title || "", category: row?.category || "", model: row?.model || "", summary: row?.summary || "", reply: row?.reply || "", body: row?.body || "", source: row?.source || "运营后台录入", sourceRefs: row?.sourceRefs || "", sourceLevel: row?.sourceLevel || "B", validUntil: row?.validUntil?.slice(0, 10) || "", evidenceIds: list(row?.evidenceIds) === "—" ? "" : list(row?.evidenceIds), keywords: list(row?.metadata?.keywords) === "—" ? "" : list(row?.metadata?.keywords), scenarios: list(row?.metadata?.scenarios) === "—" ? "" : list(row?.metadata?.scenarios), audience: row?.audience || "customer" });
  knowledgeDialog.value = true;
}
async function saveKnowledge() { if (!knowledgeForm.title.trim()) return ElMessage.warning("请填写知识标题"); await run(async () => { if (editingKnowledgeId.value) await patch(`/api/v1/brand-data/knowledge/${editingKnowledgeId.value}`, knowledgeForm); else await post("/api/v1/brand-data/knowledge", knowledgeForm); knowledgeDialog.value = false; await Promise.all([loadKnowledge(), refreshOverview()]); }, editingKnowledgeId.value ? "知识已更新，需重新审核" : "知识已加入待审核库"); }
async function reviewKnowledge(row: Row, approved: boolean) { let note = ""; if (!approved) { const result = await ElMessageBox.prompt("填写退回原因", "知识审核", { confirmButtonText: "确认", cancelButtonText: "取消" }); note = String(result.value || ""); } await run(async () => { await post(`/api/v1/brand-data/knowledge/${row.id}/review`, { approved, note }); await Promise.all([loadKnowledge(), refreshOverview()]); }, approved ? "知识已审核" : "知识已禁用"); }

function openBatchUpload() {
  batchFiles.value = [];
  assistState.value = "";
  assistMessage.value = "";
  clearObject(batchForm, { sourceType: "EMPLOYEE_CAPTURE", productScope: "UNKNOWN", productIds: [], assetKind: "", contentDescription: "", originalStatus: true, rightsStatus: "COMMERCIAL", acquiredAt: "" });
  uploadDialog.value = true;
}
async function assistUpload() {
  const files = batchFiles.value.map((item) => item.raw).filter(Boolean) as File[];
  if (!files.length) return ElMessage.warning("请先选择素材文件");
  assistState.value = "RUNNING";
  assistMessage.value = "正在识别文件类型、型号和内容说明…";
  try {
    const result = await post<Row>("/api/v1/brand-data/upload-batches/assist", { files: files.map((file) => ({ name: file.name, type: file.type, size: file.size })) });
    const suggestions = result.suggestions || {};
    if (suggestions.assetKind) batchForm.assetKind = suggestions.assetKind;
    if (Array.isArray(suggestions.productIds)) batchForm.productIds = suggestions.productIds;
    batchForm.productScope = batchForm.productIds.length ? "MODEL" : (suggestions.productScope || "UNKNOWN");
    if (!batchForm.contentDescription && suggestions.contentDescription) batchForm.contentDescription = suggestions.contentDescription;
    assistState.value = result.state || "AVAILABLE";
    assistMessage.value = result.message || "辅助填写完成，请确认";
  } catch (error) {
    assistState.value = "FAILED";
    assistMessage.value = error instanceof Error ? error.message : "辅助填写失败";
  }
}
async function submitBatch() {
  const files = batchFiles.value.map((item) => item.raw).filter(Boolean) as File[];
  if (!files.length) return ElMessage.warning("请选择素材文件");
  if (files.length > 20) return ElMessage.warning("每批最多20个文件");
  await run(async () => {
    batchForm.productScope = batchForm.productIds.length ? "MODEL" : "UNKNOWN";
    const batch = await post<Row>("/api/v1/brand-data/upload-batches", { ...batchForm });
    const form = new FormData(); files.forEach((file) => form.append("files", file));
    const result = await upload<Row>(`/api/v1/brand-data/upload-batches/${batch.id}/files`, form);
    uploadDialog.value = false;
    const duplicates = Number(result.duplicateCount || 0); const failed = Number(result.failedCount || 0);
    if (duplicates || failed) ElMessage.warning(`批次完成：新增${result.createdCount || 0}，重复${duplicates}，失败${failed}`);
    await Promise.all([loadAssets(), loadJobs(), refreshOverview(), loadReport()]);
  }, "素材批次已进入处理流水线");
}

async function openDetail(row: Row) { await run(async () => { assetDetail.value = await api<Row>(`/api/v1/brand-data/assets/${row.id}`); detailDrawer.value = true; }); }
function openMetadata(row: Row) { editingAssetId.value = row.id; clearObject(metadataForm, { displayName: row.displayName || row.fileName, level: row.level || "ORIGINAL", productScope: row.productScope || "UNKNOWN", productIds: (row.products || []).map((item: Row) => item.id), rightsStatus: row.rightsStatus || "AUTH_REQUIRED", contentDescription: row.contentDescription || "", acquiredAt: row.acquiredAt?.slice(0, 10) || "", restriction: row.restriction || "", evidenceIds: list(row.evidenceIds) === "—" ? "" : list(row.evidenceIds) }); metadataDialog.value = true; }
async function saveMetadata() { await run(async () => { await patch(`/api/v1/brand-data/assets/${editingAssetId.value}/metadata`, metadataForm); metadataDialog.value = false; await Promise.all([loadAssets(), refreshOverview()]); }, "素材元数据已更新"); }
async function reviewAsset(row: Row, action: string) { let note = ""; if (action !== "APPROVE") { const result = await ElMessageBox.prompt("填写处理原因", "素材审核", { confirmButtonText: "确认", cancelButtonText: "取消" }); note = String(result.value || ""); } await run(async () => { await post(`/api/v1/brand-data/assets/${row.id}/review`, { action, note }); await Promise.all([loadAssets(), refreshOverview(), loadReport()]); }, "审核结果已保存"); }
async function reanalyze(row: Row) { await run(async () => { await post(`/api/v1/brand-data/assets/${row.id}/reanalyze`); await Promise.all([loadAssets(), loadJobs()]); }, "已生成新分析版本"); }
async function downloadAsset(row: Row) { await run(async () => { const result = await api<{ url: string }>(`/api/v1/brand-data/assets/${row.id}/download-url`); window.open(result.url, "_blank", "noopener,noreferrer"); }); }
async function syncAssets() { await run(async () => { await post("/api/v1/jobs/run/SYNC_ASSETS"); await reload(); }, "只读扫描与OSS同步任务已加入队列"); }
async function quickFilter(kind = "", reviewStatus = "") {
  assetView.value = "list";
  assetFilter.kind = kind;
  assetFilter.reviewStatus = reviewStatus;
  await run(() => loadAssets());
}

async function loadSegments() { if (!selectedVideoId.value) { segments.value = []; return; } segments.value = await api<Row[]>(`/api/v1/brand-data/assets/${selectedVideoId.value}/segments`); }
async function saveSegment(row: Row) { await run(async () => { await patch(`/api/v1/brand-data/assets/${selectedVideoId.value}/segments/${row.id}`, { startSeconds: row.startSeconds, endSeconds: row.endSeconds, transcript: row.transcript, moduleType: row.moduleType, status: "CONFIRMED" }); await loadSegments(); }, "切段与模块分类已锁定"); }
async function materializeSegment(row: Row) { await run(async () => { await post(`/api/v1/brand-data/assets/${selectedVideoId.value}/segments/${row.id}/materialize`, {}); await Promise.all([loadSegments(), loadAssets(), loadReport()]); }, "高质量模块文件已生成"); }

defineExpose({ reload });
onMounted(reload);
</script>

<template>
  <section class="brand-data-page" v-loading="loading">
    <div class="brand-hero">
      <div><span class="brand-eyebrow">BRAND DATA CENTER · V2.0</span><h2>品牌数据中心</h2><p>品牌知识、逻辑素材、OSS文件、AI处理、审核与使用效果统一追溯。</p></div>
      <div class="hero-actions"><el-tag :type="overview?.oss.ok ? 'success' : 'warning'" effect="dark">{{ overview?.oss.message || 'OSS状态读取中' }}</el-tag><el-tag :type="statusType(overview?.ai.state || '')" effect="plain">AI：{{ statusLabel(overview?.ai.state || 'UNCONFIGURED') }}</el-tag><el-button :icon="Refresh" @click="reload">刷新</el-button></div>
    </div>

    <div class="brand-metrics">
      <article><span>知识总量</span><strong>{{ overview?.knowledge.total ?? 0 }}</strong><small>AI可调用 {{ overview?.knowledge.ready ?? 0 }} · 待审核 {{ overview?.knowledge.pending ?? 0 }}</small></article>
      <article><span>今日新增素材</span><strong>{{ overview?.assets.today ?? 0 }}</strong><small>总量 {{ overview?.assets.total ?? 0 }} · OSS {{ overview?.assets.ossStored ?? 0 }}</small></article>
      <article><span>待人工处理</span><strong>{{ overview?.assets.pending ?? 0 }}</strong><small>AI失败 {{ overview?.assets.aiFailed ?? 0 }} · 缺口 {{ overview?.assets.gapCount ?? 0 }}</small></article>
      <article><span>可调用素材</span><strong>{{ overview?.assets.ready ?? 0 }}</strong><small>80分以上已审核 {{ overview?.assets.highQuality ?? 0 }}</small></article>
    </div>

    <div class="main-tabs">
      <button :class="{ active: activeTab === 'knowledge' }" @click="activeTab = 'knowledge'"><el-icon><Collection /></el-icon><span>品牌知识库</span><b>{{ overview?.knowledge.total ?? 0 }}</b></button>
      <button :class="{ active: activeTab === 'assets' }" @click="activeTab = 'assets'"><el-icon><UploadFilled /></el-icon><span>素材库</span><b>{{ overview?.assets.total ?? 0 }}</b></button>
    </div>

    <template v-if="activeTab === 'knowledge'">
      <div class="workspace-heading"><div><h3>品牌知识库</h3><p>品牌版本、产品、知识、FAQ、证据、型号映射与表述规则使用同一审核口径。</p></div><el-button type="primary" :icon="Plus" @click="openKnowledge()">新建知识</el-button></div>
      <el-segmented v-model="knowledgeView" :options="[
        { label: `知识 ${knowledge.length}`, value: 'entries' }, { label: `品牌版本 ${controls.brandProfiles.length}`, value: 'brand' },
        { label: `产品 ${controls.products.length}`, value: 'products' }, { label: `FAQ ${controls.faqs.length}`, value: 'faqs' },
        { label: `证据 ${controls.claims.length}`, value: 'claims' }, { label: `型号映射 ${controls.mappings.length}`, value: 'mappings' }, { label: `表述规则 ${controls.phraseRules.length}`, value: 'rules' },
      ]" />
      <template v-if="knowledgeView === 'entries'">
        <div class="filter-bar knowledge-filter"><el-input v-model="knowledgeFilter.query" clearable placeholder="搜索编号、标题、正文或回复" :prefix-icon="Search" @keyup.enter="run(loadKnowledge)" /><el-select v-model="knowledgeFilter.type" clearable placeholder="知识类型"><el-option v-for="item in knowledgeTypes" :key="item.value" :label="item.label" :value="item.value" /></el-select><el-select v-model="knowledgeFilter.model" clearable filterable placeholder="适用型号"><el-option v-for="item in controls.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.modelCode" /></el-select><el-select v-model="knowledgeFilter.status" clearable placeholder="状态"><el-option label="待审核" value="PENDING" /><el-option label="可用" value="READY" /><el-option label="禁用" value="BLOCKED" /></el-select><el-button type="primary" :icon="Search" @click="run(loadKnowledge)">查询</el-button></div>
        <div class="data-panel"><el-table :data="knowledge" stripe height="500"><el-table-column prop="id" label="知识编号" width="165" show-overflow-tooltip /><el-table-column label="类型" width="100"><template #default="scope">{{ typeLabel(scope.row.type) }}</template></el-table-column><el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip /><el-table-column prop="model" label="型号" width="110"><template #default="scope">{{ scope.row.model || '通用' }}</template></el-table-column><el-table-column label="内容" min-width="280" show-overflow-tooltip><template #default="scope">{{ scope.row.reply || scope.row.summary || scope.row.body || '待完善' }}</template></el-table-column><el-table-column label="来源" width="145"><template #default="scope">{{ scope.row.source }}<small class="cell-note">等级 {{ scope.row.sourceLevel || 'B' }}</small></template></el-table-column><el-table-column label="调用" width="90"><template #default="scope"><el-tag :type="scope.row.aiCallable ? 'success' : 'info'">{{ scope.row.aiCallable ? '可调用' : '未进入' }}</el-tag></template></el-table-column><el-table-column label="状态" width="90"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column><el-table-column label="操作" width="180" fixed="right"><template #default="scope"><el-button link type="primary" @click="openKnowledge(scope.row)">编辑</el-button><el-button v-if="scope.row.status !== 'READY'" link type="success" @click="reviewKnowledge(scope.row, true)">通过</el-button><el-button v-if="scope.row.status !== 'BLOCKED'" link type="danger" @click="reviewKnowledge(scope.row, false)">禁用</el-button></template></el-table-column></el-table></div>
      </template>
      <div v-else-if="knowledgeView === 'brand'" class="data-panel"><el-table :data="controls.brandProfiles" stripe height="545"><el-table-column prop="version" label="版本" width="90" /><el-table-column prop="title" label="品牌版本" min-width="180" /><el-table-column prop="positioning" label="品牌定位" min-width="300" show-overflow-tooltip /><el-table-column prop="source" label="来源" min-width="180" /><el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column><el-table-column label="生效时间" width="150"><template #default="scope">{{ dateTime(scope.row.effectiveAt) }}</template></el-table-column></el-table></div>
      <div v-else-if="knowledgeView === 'products'" class="data-panel"><el-table :data="controls.products" stripe height="545"><el-table-column prop="modelCode" label="型号" width="140" /><el-table-column prop="name" label="产品名称" min-width="200" /><el-table-column prop="category" label="系列" width="150" /><el-table-column label="SKU" width="90"><template #default="scope">{{ scope.row.skus?.length || 0 }}</template></el-table-column><el-table-column label="证据" min-width="220"><template #default="scope">{{ list(scope.row.evidenceIds) }}</template></el-table-column><el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column></el-table></div>
      <div v-else-if="knowledgeView === 'faqs'" class="data-panel"><el-table :data="controls.faqs" stripe height="545"><el-table-column prop="faqNo" label="FAQ编号" width="165" show-overflow-tooltip /><el-table-column prop="standardQuestion" label="标准问题" min-width="220" /><el-table-column prop="shortAnswer" label="短回复" min-width="280" show-overflow-tooltip /><el-table-column label="不同问法" width="100"><template #default="scope">{{ scope.row.variants?.length || 0 }}</template></el-table-column><el-table-column prop="frequency" label="频次" width="80" /><el-table-column label="AI调用" width="100"><template #default="scope"><el-tag :type="scope.row.externallyUsable ? 'success' : 'info'">{{ scope.row.externallyUsable ? '可调用' : '未进入' }}</el-tag></template></el-table-column></el-table></div>
      <div v-else-if="knowledgeView === 'claims'" class="data-panel"><el-table :data="controls.claims" stripe height="545"><el-table-column prop="id" label="证据编号" width="110" /><el-table-column prop="name" label="证据名称" min-width="210" /><el-table-column prop="coveredObject" label="适用范围" min-width="230" show-overflow-tooltip /><el-table-column prop="publicWording" label="允许表述" min-width="320" show-overflow-tooltip /><el-table-column prop="internalRestriction" label="使用限制" min-width="250" show-overflow-tooltip /><el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column></el-table></div>
      <div v-else-if="knowledgeView === 'mappings'" class="data-panel"><el-table :data="controls.mappings" stripe height="545"><el-table-column prop="commercialName" label="商品名称" min-width="180" /><el-table-column prop="nameplateModel" label="包装/铭牌型号" min-width="190" /><el-table-column prop="registeredModel" label="注册型号" min-width="190" /><el-table-column prop="registrationNumber" label="注册编号" min-width="200" /><el-table-column prop="requiredAction" label="发布前动作" min-width="300" show-overflow-tooltip /></el-table></div>
      <div v-else class="data-panel"><el-table :data="controls.phraseRules" stripe height="545"><el-table-column prop="category" label="规则类别" width="140" /><el-table-column prop="blockedText" label="拦截表述" min-width="260" /><el-table-column prop="replacement" label="建议替代表述" min-width="320" /><el-table-column prop="condition" label="使用条件" min-width="300" /></el-table></div>
    </template>

    <template v-else>
      <div class="workspace-heading"><div><h3>素材库</h3><p>按类型、型号和状态快速查找；上传时由AI辅助填写。</p></div><div><el-button :icon="Refresh" @click="syncAssets">扫描同步</el-button><el-button type="primary" :icon="Plus" @click="openBatchUpload">上传素材</el-button></div></div>
      <el-segmented v-model="assetView" :options="[{ label: `素材 ${assetTotal}`, value: 'list' }, { label: `待审核 ${overview?.assets.pending || 0}`, value: 'review' }, { label: '视频切片', value: 'video' }, { label: `AI处理 ${jobs.length}`, value: 'jobs' }, { label: `缺口 ${gaps.filter(item => item.gapCount > 0).length}`, value: 'gaps' }, { label: '日报', value: 'report' }, { label: '增长闭环', value: 'loop' }]" />

      <template v-if="assetView === 'loop'">
        <div class="workspace-heading compact"><div><h3>素材增长闭环</h3><p>上传、处理、审核、调用、效果回流、评分和下一轮任务在同一条链路中追踪。</p></div><el-button type="primary" :icon="Refresh" @click="refreshGrowthLoop">更新闭环</el-button></div>
        <div v-if="growthLoop" class="growth-loop">
          <article v-for="(stage, index) in growthLoop.stages" :key="stage.key" :class="['growth-stage', `state-${String(stage.state).toLowerCase()}`]">
            <div class="stage-index">{{ String(index + 1).padStart(2, '0') }}</div>
            <div><strong>{{ stage.label }}</strong><span>当前 {{ stage.count }}<template v-if="stage.secondaryCount !== undefined"> · 待处理 {{ stage.secondaryCount }}</template></span></div>
          </article>
        </div>
        <div v-if="growthLoop" class="two-panels">
          <div class="data-panel"><h4>下一轮拍摄和收集任务</h4><el-table :data="growthLoop.tasks" stripe height="360"><el-table-column prop="title" label="任务" min-width="260" /><el-table-column prop="priority" label="优先级" width="90"><template #default="scope"><el-tag :type="scope.row.priority === 'HIGH' ? 'danger' : 'warning'">{{ scope.row.priority }}</el-tag></template></el-table-column><el-table-column prop="owner" label="负责人" width="110"><template #default="scope">{{ scope.row.owner || '待分配' }}</template></el-table-column><el-table-column label="截止" width="125"><template #default="scope">{{ dateTime(scope.row.dueAt) }}</template></el-table-column></el-table></div>
          <div class="data-panel"><h4>最近效果回流</h4><el-table :data="growthLoop.latestMetrics" stripe height="360"><el-table-column label="素材" min-width="190"><template #default="scope">{{ scope.row.asset?.assetNo }}<small class="cell-note">{{ scope.row.asset?.displayName || scope.row.asset?.fileName }}</small></template></el-table-column><el-table-column prop="platform" label="平台" width="110"><template #default="scope">{{ scope.row.platform || '未记录' }}</template></el-table-column><el-table-column prop="views" label="播放" width="90"><template #default="scope">{{ scope.row.views ?? '未获取' }}</template></el-table-column><el-table-column prop="comments" label="评论" width="80"><template #default="scope">{{ scope.row.comments ?? '未获取' }}</template></el-table-column><el-table-column prop="orders" label="订单" width="80"><template #default="scope">{{ scope.row.orders ?? '未获取' }}</template></el-table-column><el-table-column label="评分/权重" width="110"><template #default="scope">{{ scope.row.asset?.performance?.growthScore ?? scope.row.asset?.qualityScore }} / {{ scope.row.asset?.performance?.recommendationWeight ?? '—' }}</template></el-table-column></el-table></div>
        </div>
      </template>

      <template v-else-if="assetView === 'list' || assetView === 'review'">
        <div class="asset-index">
          <button :class="{ active: !assetFilter.kind && !assetFilter.reviewStatus }" @click="quickFilter()">全部素材 <b>{{ overview?.assets.total || 0 }}</b></button>
          <button :class="{ active: assetFilter.kind === 'IMAGE' }" @click="quickFilter('IMAGE')">图片</button>
          <button :class="{ active: assetFilter.kind === 'VIDEO' }" @click="quickFilter('VIDEO')">视频</button>
          <button :class="{ active: assetFilter.kind === 'AUDIO' }" @click="quickFilter('AUDIO')">音频</button>
          <button :class="{ active: assetFilter.kind === 'DOCUMENT' }" @click="quickFilter('DOCUMENT')">文档</button>
          <button :class="{ active: assetFilter.reviewStatus === 'PENDING' }" @click="quickFilter('', 'PENDING')">待审核 <b>{{ overview?.assets.pending || 0 }}</b></button>
        </div>
        <div v-if="assetView === 'list'" class="filter-bar asset-filter">
          <el-input v-model="assetFilter.query" clearable placeholder="搜索名称、编号或内容" :prefix-icon="Search" @keyup.enter="run(() => loadAssets())" />
          <el-select v-model="assetFilter.kind" clearable placeholder="素材类型"><el-option v-for="item in kindOptions" :key="item" :label="kindLabel(item)" :value="item" /></el-select>
          <el-select v-model="assetFilter.model" clearable filterable placeholder="产品型号"><el-option v-for="item in controls.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.modelCode" /></el-select>
          <el-select v-model="assetFilter.reviewStatus" clearable placeholder="审核状态"><el-option label="待审核" value="PENDING" /><el-option label="已通过" value="APPROVED" /><el-option label="已退回" value="RETURNED" /><el-option label="已拒绝" value="REJECTED" /></el-select>
          <el-button type="primary" :icon="Search" @click="run(() => loadAssets())">查询</el-button>
          <el-collapse class="advanced-filter"><el-collapse-item title="更多筛选" name="advanced"><div class="advanced-filter-grid"><el-select v-model="assetFilter.level" clearable placeholder="素材层级"><el-option v-for="item in levelOptions" :key="item" :label="item" :value="item" /></el-select><el-select v-model="assetFilter.moduleType" clearable placeholder="视频模块"><el-option v-for="item in moduleOptions" :key="item" :label="item" :value="item" /></el-select><el-select v-model="assetFilter.employeeId" clearable filterable placeholder="上传员工"><el-option v-for="item in controls.employees" :key="item.id" :label="item.name" :value="item.id" /></el-select><el-select v-model="assetFilter.rightsStatus" clearable placeholder="使用权限"><el-option v-for="item in rightsOptions" :key="item" :label="statusLabel(item)" :value="item" /></el-select></div></el-collapse-item></el-collapse>
        </div>
        <div class="data-panel"><el-table :data="assetView === 'review' ? assets.filter(item => item.reviewStatus === 'PENDING') : assets" stripe height="540"><el-table-column label="素材" min-width="290"><template #default="scope"><strong>{{ scope.row.displayName }}</strong><small class="cell-note">{{ scope.row.assetNo }} · {{ fileSize(scope.row.sizeBytes) }}</small></template></el-table-column><el-table-column label="类型" width="105"><template #default="scope">{{ kindLabel(scope.row.kind) }}<small class="cell-note">{{ scope.row.level }}</small></template></el-table-column><el-table-column label="型号" width="150"><template #default="scope">{{ scope.row.products?.length ? scope.row.products.map((item: Row) => item.modelCode).join('、') : (scope.row.model || '待确认') }}</template></el-table-column><el-table-column label="上传员工" width="135"><template #default="scope">{{ scope.row.createdByEmployee?.name || scope.row.actor }}</template></el-table-column><el-table-column label="状态" width="150"><template #default="scope"><el-tag :type="statusType(scope.row.reviewStatus)">{{ statusLabel(scope.row.reviewStatus) }}</el-tag><small class="cell-note">{{ statusLabel(scope.row.processingStatus) }} · {{ statusLabel(scope.row.availabilityStatus) }}</small></template></el-table-column><el-table-column label="操作" width="300" fixed="right"><template #default="scope"><el-button link :icon="View" @click="openDetail(scope.row)">详情</el-button><el-button link type="primary" @click="openMetadata(scope.row)">编辑</el-button><el-button v-if="scope.row.objectKey" link :icon="Download" @click="downloadAsset(scope.row)">下载</el-button><el-button v-if="scope.row.reviewStatus === 'PENDING'" link type="success" @click="reviewAsset(scope.row, 'APPROVE')">通过</el-button><el-dropdown v-if="scope.row.reviewStatus === 'PENDING'" trigger="click" @command="(action: string) => reviewAsset(scope.row, action)"><el-button link type="warning">其他处理</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="RETURN">退回修改</el-dropdown-item><el-dropdown-item command="INTERNAL_ONLY">仅内部</el-dropdown-item><el-dropdown-item command="REJECT" divided>拒绝</el-dropdown-item></el-dropdown-menu></template></el-dropdown><el-button link @click="reanalyze(scope.row)">重分析</el-button></template></el-table-column></el-table></div>
        <div v-if="nextCursor && assetView === 'list'" class="load-more"><el-button @click="run(() => loadAssets(false))">加载更多</el-button></div>
      </template>

      <template v-else-if="assetView === 'video'">
        <div class="video-toolbar"><el-select v-model="selectedVideoId" filterable placeholder="选择视频原片" @change="run(loadSegments)"><el-option v-for="item in videoAssets" :key="item.id" :label="`${item.assetNo} · ${item.displayName}`" :value="item.id" /></el-select><span>系统先生成切段建议和预览；确认片段后再生成高质量模块文件。</span></div>
        <div class="data-panel"><el-table :data="segments" stripe height="545"><el-table-column label="时间范围" width="210"><template #default="scope"><div class="time-range"><el-input-number v-model="scope.row.startSeconds" :min="0" :precision="2" controls-position="right" /><span>—</span><el-input-number v-model="scope.row.endSeconds" :min="0" :precision="2" controls-position="right" /></div></template></el-table-column><el-table-column label="模块" width="150"><template #default="scope"><el-select v-model="scope.row.moduleType" clearable><el-option v-for="item in moduleOptions" :key="item" :label="item" :value="item" /></el-select></template></el-table-column><el-table-column label="转写/说明" min-width="340"><template #default="scope"><el-input v-model="scope.row.transcript" /></template></el-table-column><el-table-column prop="analysisVersion" label="分析版本" width="95" /><el-table-column label="状态" width="110"><template #default="scope">{{ scope.row.status }}</template></el-table-column><el-table-column label="操作" width="180"><template #default="scope"><el-button link type="primary" @click="saveSegment(scope.row)">保存</el-button><el-button link type="success" :disabled="Boolean(scope.row.materializedAssetId)" @click="materializeSegment(scope.row)">{{ scope.row.materializedAssetId ? '已生成' : '生成模块' }}</el-button></template></el-table-column></el-table></div>
      </template>

      <template v-else-if="assetView === 'jobs'">
        <div class="capability-note"><strong>AI能力：</strong>{{ overview?.ai.message }}<el-button link type="primary" @click="run(loadJobs)">刷新队列</el-button></div>
        <div class="data-panel"><el-table :data="jobs" stripe height="545"><el-table-column label="素材" min-width="210"><template #default="scope">{{ scope.row.asset?.assetNo }}<small class="cell-note">{{ scope.row.asset?.displayName || scope.row.asset?.fileName }}</small></template></el-table-column><el-table-column prop="type" label="任务" width="190" /><el-table-column prop="provider" label="执行方" width="150" /><el-table-column prop="model" label="模型" width="150"><template #default="scope">{{ scope.row.model || '本地工具' }}</template></el-table-column><el-table-column label="状态" width="120"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column><el-table-column prop="attempts" label="尝试" width="75" /><el-table-column prop="failureReason" label="失败/未配置原因" min-width="260" show-overflow-tooltip /><el-table-column label="更新时间" width="145"><template #default="scope">{{ dateTime(scope.row.updatedAt) }}</template></el-table-column></el-table></div>
      </template>

      <template v-else-if="assetView === 'gaps'">
        <div class="workspace-heading compact"><div><h3>素材缺口</h3><p>V2基础覆盖线按型号计算；缺口不会被“未获取”当作零表现数据。</p></div><el-button :icon="Refresh" @click="run(() => loadGaps(true), '缺口已重新计算')">重新计算</el-button></div>
        <div class="data-panel"><el-table :data="gaps" stripe height="545"><el-table-column prop="productModel" label="型号" width="130" /><el-table-column prop="assetKind" label="素材类型" width="110" /><el-table-column prop="category" label="覆盖项" min-width="180" /><el-table-column prop="requiredCount" label="基线" width="80" /><el-table-column prop="activeCount" label="可调用" width="90" /><el-table-column prop="gapCount" label="缺口" width="80" /><el-table-column label="级别" width="90"><template #default="scope"><el-tag :type="scope.row.gapCount ? 'danger' : 'success'">{{ scope.row.severity }}</el-tag></template></el-table-column><el-table-column prop="recommendation" label="补拍建议" min-width="300" /></el-table></div>
      </template>

      <template v-else>
        <div class="report-summary" v-if="dailyReport"><article><span>员工上传</span><strong>{{ dailyReport.summary.uploaded }}</strong></article><article><span>正式新增</span><strong>{{ dailyReport.summary.created }}</strong></article><article><span>重复上传</span><strong>{{ dailyReport.summary.duplicates }}</strong></article><article><span>审核通过</span><strong>{{ dailyReport.summary.approved }}</strong></article><article><span>AI派生模块</span><strong>{{ dailyReport.summary.aiDerivedModules }}</strong></article><article><span>实际调用</span><strong>{{ dailyReport.summary.actualUsages }}</strong></article><article><span>效果回流</span><strong>{{ dailyReport.summary.metricSnapshots || 0 }}</strong></article><article><span>下一轮任务</span><strong>{{ dailyReport.summary.generatedTasks || 0 }}</strong></article></div>
        <div class="two-panels" v-if="dailyReport"><div class="data-panel"><h4>员工增量</h4><el-table :data="dailyReport.employees" stripe height="420"><el-table-column prop="employee" label="员工" min-width="130" /><el-table-column prop="uploaded" label="上传" width="75" /><el-table-column prop="created" label="新增" width="75" /><el-table-column prop="duplicates" label="重复" width="75" /><el-table-column prop="failed" label="失败" width="75" /></el-table></div><div class="data-panel"><h4>当日素材记录</h4><el-table :data="dailyReport.uploads" stripe height="420"><el-table-column prop="asset.assetNo" label="素材编号" width="180" /><el-table-column prop="originalFileName" label="文件" min-width="180" show-overflow-tooltip /><el-table-column prop="batch.uploadedBy" label="员工/主体" width="140" /><el-table-column label="结果" width="120"><template #default="scope"><el-tag :type="scope.row.result === 'CREATED' ? 'success' : scope.row.result === 'FAILED' ? 'danger' : 'warning'">{{ scope.row.result }}</el-tag></template></el-table-column><el-table-column label="时间" width="135"><template #default="scope">{{ dateTime(scope.row.occurredAt) }}</template></el-table-column></el-table></div></div>
      </template>
    </template>

    <el-dialog v-model="knowledgeDialog" :title="editingKnowledgeId ? '编辑品牌知识' : '新建品牌知识'" width="780px" destroy-on-close><el-form label-position="top" class="form-grid"><el-form-item label="知识类型" required><el-select v-model="knowledgeForm.type"><el-option v-for="item in knowledgeTypes" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item><el-form-item label="知识标题" required><el-input v-model="knowledgeForm.title" maxlength="100" /></el-form-item><el-form-item label="知识分类"><el-input v-model="knowledgeForm.category" /></el-form-item><el-form-item label="适用型号"><el-select v-model="knowledgeForm.model" clearable filterable><el-option v-for="item in controls.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.modelCode" /></el-select></el-form-item><el-form-item label="摘要" class="full"><el-input v-model="knowledgeForm.summary" type="textarea" :rows="2" /></el-form-item><el-form-item label="标准回复/允许话术" class="full"><el-input v-model="knowledgeForm.reply" type="textarea" :rows="3" /></el-form-item><el-form-item label="完整正文" class="full"><el-input v-model="knowledgeForm.body" type="textarea" :rows="4" /></el-form-item><el-form-item label="来源等级"><el-select v-model="knowledgeForm.sourceLevel"><el-option v-for="item in ['A','B','C','D','E']" :key="item" :label="item" :value="item" /></el-select></el-form-item><el-form-item label="有效期"><el-date-picker v-model="knowledgeForm.validUntil" type="date" value-format="YYYY-MM-DD" /></el-form-item><el-form-item label="关联证据编号"><el-input v-model="knowledgeForm.evidenceIds" placeholder="逗号分隔" /></el-form-item><el-form-item label="关键词"><el-input v-model="knowledgeForm.keywords" placeholder="逗号分隔" /></el-form-item><el-form-item label="适用场景"><el-input v-model="knowledgeForm.scenarios" placeholder="逗号分隔" /></el-form-item><el-form-item label="资料来源"><el-input v-model="knowledgeForm.source" /></el-form-item><el-form-item label="来源链接/文件" class="full"><el-input v-model="knowledgeForm.sourceRefs" /></el-form-item></el-form><template #footer><el-button @click="knowledgeDialog = false">取消</el-button><el-button type="primary" @click="saveKnowledge">保存为待审核</el-button></template></el-dialog>

    <el-dialog v-model="uploadDialog" title="上传素材" width="760px" destroy-on-close>
      <el-upload v-model:file-list="batchFiles" drag multiple :auto-upload="false" :limit="20" class="asset-upload">
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon><div class="el-upload__text">拖入文件，或<em>点击选择</em></div>
        <template #tip><div class="el-upload__tip">最多20个，单文件不超过200MB；上传员工由企业微信身份自动记录。</div></template>
      </el-upload>
      <div class="ai-assist">
        <div><strong>AI辅助填写</strong><span>{{ assistMessage || '选择文件后，可自动判断类型、型号和内容说明' }}</span></div>
        <el-button :loading="assistState === 'RUNNING'" @click="assistUpload">AI帮我填写</el-button>
      </div>
      <el-form label-position="top" class="form-grid simple-upload-form">
        <el-form-item label="产品型号（可不选）"><el-select v-model="batchForm.productIds" multiple filterable placeholder="AI识别后请确认"><el-option v-for="item in controls.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="素材来源"><el-select v-model="batchForm.sourceType"><el-option label="员工拍摄/制作" value="EMPLOYEE_CAPTURE" /><el-option label="网页上传" value="WEB_UPLOAD" /><el-option label="供应商" value="SUPPLIER" /><el-option label="UGC授权" value="UGC" /></el-select></el-form-item>
        <el-form-item label="内容说明" class="full"><el-input v-model="batchForm.contentDescription" type="textarea" :rows="2" placeholder="可留空，由AI辅助填写" /></el-form-item>
        <el-collapse class="full upload-advanced"><el-collapse-item title="更多信息（一般无需修改）" name="advanced"><div class="advanced-filter-grid"><el-select v-model="batchForm.assetKind" clearable placeholder="素材类型自动识别"><el-option v-for="item in kindOptions" :key="item" :label="kindLabel(item)" :value="item" /></el-select><el-select v-model="batchForm.rightsStatus"><el-option v-for="item in rightsOptions" :key="item" :label="statusLabel(item)" :value="item" /></el-select><el-date-picker v-model="batchForm.acquiredAt" type="date" value-format="YYYY-MM-DD" placeholder="获得/拍摄日期" /><el-switch v-model="batchForm.originalStatus" active-text="公司原创" inactive-text="非原创" /></div></el-collapse-item></el-collapse>
      </el-form>
      <template #footer><el-button @click="uploadDialog = false">取消</el-button><el-button type="primary" @click="submitBatch">确认上传</el-button></template>
    </el-dialog>

    <el-dialog v-model="metadataDialog" title="编辑素材元数据" width="760px" destroy-on-close><el-form label-position="top" class="form-grid"><el-form-item label="素材名称"><el-input v-model="metadataForm.displayName" /></el-form-item><el-form-item label="素材层级"><el-select v-model="metadataForm.level"><el-option v-for="item in levelOptions" :key="item" :label="item" :value="item" /></el-select></el-form-item><el-form-item label="产品范围"><el-select v-model="metadataForm.productScope"><el-option v-for="item in ['MODEL','SERIES','BRAND','COMMON','UNKNOWN']" :key="item" :label="item" :value="item" /></el-select></el-form-item><el-form-item label="关联产品"><el-select v-model="metadataForm.productIds" multiple filterable><el-option v-for="item in controls.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.id" /></el-select></el-form-item><el-form-item label="使用权限"><el-select v-model="metadataForm.rightsStatus"><el-option v-for="item in rightsOptions" :key="item" :label="statusLabel(item)" :value="item" /></el-select></el-form-item><el-form-item label="获得日期"><el-date-picker v-model="metadataForm.acquiredAt" type="date" value-format="YYYY-MM-DD" /></el-form-item><el-form-item label="内容说明" class="full"><el-input v-model="metadataForm.contentDescription" type="textarea" :rows="3" /></el-form-item><el-form-item label="关联证据"><el-input v-model="metadataForm.evidenceIds" placeholder="逗号分隔" /></el-form-item><el-form-item label="使用限制"><el-input v-model="metadataForm.restriction" /></el-form-item></el-form><template #footer><el-button @click="metadataDialog = false">取消</el-button><el-button type="primary" @click="saveMetadata">保存</el-button></template></el-dialog>

    <el-drawer v-model="detailDrawer" title="素材对象详情" size="62%" destroy-on-close><template v-if="assetDetail"><div class="detail-head"><div><span>{{ assetDetail.assetNo }}</span><h3>{{ assetDetail.displayName }}</h3></div><div><el-tag :type="statusType(assetDetail.processingStatus)">{{ statusLabel(assetDetail.processingStatus) }}</el-tag><el-tag :type="statusType(assetDetail.reviewStatus)">{{ statusLabel(assetDetail.reviewStatus) }}</el-tag><el-tag :type="statusType(assetDetail.availabilityStatus)">{{ statusLabel(assetDetail.availabilityStatus) }}</el-tag></div></div><el-descriptions :column="3" border><el-descriptions-item label="原始文件名">{{ assetDetail.originalFileName || assetDetail.fileName }}</el-descriptions-item><el-descriptions-item label="类型/层级">{{ assetDetail.kind }} / {{ assetDetail.level }}</el-descriptions-item><el-descriptions-item label="权限">{{ statusLabel(assetDetail.rightsStatus) }}</el-descriptions-item><el-descriptions-item label="OSS对象" :span="2">{{ assetDetail.objectKey || '未存储' }}</el-descriptions-item><el-descriptions-item label="SHA256">{{ assetDetail.sha256?.slice(0, 18) }}…</el-descriptions-item><el-descriptions-item label="上传员工">{{ assetDetail.createdByEmployee?.name || assetDetail.actor }}</el-descriptions-item><el-descriptions-item label="型号">{{ assetDetail.products?.map((item: Row) => item.modelCode).join('、') || '待确认' }}</el-descriptions-item><el-descriptions-item label="质量评分">{{ assetDetail.qualityScore }}</el-descriptions-item></el-descriptions><div class="detail-grid"><section><h4>受控标签</h4><div class="tag-cloud"><el-tag v-for="item in assetDetail.tags" :key="`${item.namespace}-${item.code}`" :type="item.locked ? 'success' : 'info'">{{ item.namespace }}：{{ item.label }}</el-tag><span v-if="!assetDetail.tags?.length">暂无标签</span></div></section><section><h4>版本</h4><el-table :data="assetDetail.versions" size="small"><el-table-column prop="version" label="版本" width="65" /><el-table-column prop="originalFileName" label="原文件名" min-width="150" /><el-table-column prop="objectKey" label="OSS对象" min-width="210" show-overflow-tooltip /></el-table></section><section><h4>AI任务</h4><el-table :data="assetDetail.analysisJobs" size="small"><el-table-column prop="type" label="任务" min-width="150" /><el-table-column label="状态" width="105"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column><el-table-column prop="failureReason" label="原因" min-width="180" show-overflow-tooltip /></el-table></section><section><h4>审核记录</h4><el-table :data="assetDetail.reviewDecisions" size="small"><el-table-column prop="action" label="动作" width="110" /><el-table-column prop="reviewer" label="审核人" width="120" /><el-table-column prop="note" label="说明" min-width="180" /><el-table-column label="时间" width="135"><template #default="scope">{{ dateTime(scope.row.createdAt) }}</template></el-table-column></el-table></section><section><h4>使用与效果</h4><el-table :data="assetDetail.usages" size="small"><el-table-column prop="businessObjectType" label="业务对象" width="120" /><el-table-column prop="businessObjectId" label="对象编号" min-width="150" /><el-table-column prop="usedBy" label="使用人/AI" width="120" /><el-table-column label="最新播放" width="90"><template #default="scope">{{ scope.row.metrics?.[0]?.views ?? '未获取' }}</template></el-table-column><el-table-column label="订单" width="80"><template #default="scope">{{ scope.row.metrics?.[0]?.orders ?? '未获取' }}</template></el-table-column></el-table></section></div></template></el-drawer>
  </section>
</template>

<style scoped>
.brand-data-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.brand-hero { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 24px 28px; color: #fff; border-radius: 20px; background: linear-gradient(120deg, #15213a 0%, #1b365d 58%, #a2202b 160%); box-shadow: 0 14px 38px rgba(24, 40, 72, .16); }
.brand-hero h2 { margin: 5px 0 7px; font-size: 28px; }.brand-hero p { margin: 0; color: rgba(255,255,255,.72); }.brand-eyebrow { font-size: 11px; font-weight: 800; letter-spacing: .16em; color: #f2b8be; }.hero-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.brand-metrics, .report-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }.brand-metrics article, .report-summary article { padding: 18px 20px; border: 1px solid #e9edf4; border-radius: 16px; background: #fff; box-shadow: 0 7px 20px rgba(28, 44, 72, .05); }.brand-metrics span, .brand-metrics small, .report-summary span { display: block; color: #7a8496; }.brand-metrics strong, .report-summary strong { display: block; margin: 5px 0 2px; font-size: 27px; color: #162239; }.report-summary { grid-template-columns: repeat(6, 1fr); }
.main-tabs { display: flex; width: fit-content; padding: 5px; border-radius: 14px; background: #e9edf4; }.main-tabs button { display: flex; align-items: center; gap: 8px; min-width: 170px; padding: 11px 17px; color: #637086; border: 0; border-radius: 10px; background: transparent; cursor: pointer; }.main-tabs button.active { color: #a2202b; background: #fff; box-shadow: 0 4px 12px rgba(32, 45, 69, .1); }.main-tabs b { margin-left: auto; padding: 2px 7px; font-size: 12px; border-radius: 999px; background: #f1f3f7; }
.workspace-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; }.workspace-heading.compact { padding-top: 4px; }.workspace-heading h3 { margin: 0 0 4px; font-size: 21px; color: #17243b; }.workspace-heading p { margin: 0; color: #7d8798; }
.filter-bar { display: grid; gap: 10px; padding: 14px; border: 1px solid #e7ebf2; border-radius: 14px; background: #fff; }.knowledge-filter { grid-template-columns: minmax(260px, 1.5fr) 150px 160px 130px auto; }.asset-filter { grid-template-columns: minmax(240px, 1.5fr) 140px 190px 140px auto; }.advanced-filter { grid-column: 1 / -1; }.advanced-filter-grid { display: grid; grid-template-columns: repeat(4, minmax(130px, 1fr)); gap: 10px; padding-top: 5px; }.asset-index { display: flex; gap: 8px; overflow-x: auto; padding: 2px; }.asset-index button { min-width: 105px; padding: 11px 15px; color: #5f6b7d; border: 1px solid #e2e7ef; border-radius: 11px; background: #fff; cursor: pointer; }.asset-index button.active { color: #a2202b; border-color: #e1a9ae; background: #fff7f7; }.asset-index b { margin-left: 5px; }.data-panel { overflow: hidden; border: 1px solid #e7ebf2; border-radius: 15px; background: #fff; }.data-panel h4 { margin: 0; padding: 15px 17px; color: #1b2941; border-bottom: 1px solid #edf0f5; }.cell-note { display: block; margin-top: 2px; color: #9099a8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.cell-note.danger { color: #c53943; }.form-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 18px; }.form-grid .full { grid-column: 1 / -1; }.asset-upload { margin-bottom: 14px; }.ai-assist { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 15px; padding: 13px 15px; border: 1px solid #dce7f5; border-radius: 12px; background: #f5f9ff; }.ai-assist strong, .ai-assist span { display: block; }.ai-assist span { margin-top: 3px; color: #778398; font-size: 12px; }.upload-advanced { margin-top: 2px; }.load-more { display: flex; justify-content: center; }.video-toolbar, .capability-note { display: flex; align-items: center; gap: 16px; padding: 14px 16px; color: #6f798b; border: 1px solid #e7ebf2; border-radius: 14px; background: #fff; }.video-toolbar .el-select { width: 460px; }.time-range { display: flex; align-items: center; gap: 5px; }.time-range .el-input-number { width: 88px; }.two-panels { display: grid; grid-template-columns: .8fr 1.2fr; gap: 14px; }.detail-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }.detail-head span { color: #8b95a5; }.detail-head h3 { margin: 4px 0 0; font-size: 23px; color: #17243b; }.detail-head > div:last-child { display: flex; gap: 7px; }.detail-grid { display: grid; gap: 16px; margin-top: 18px; }.detail-grid section { border: 1px solid #e8ecf2; border-radius: 12px; overflow: hidden; }.detail-grid h4 { margin: 0; padding: 12px 15px; background: #f7f9fc; }.tag-cloud { display: flex; flex-wrap: wrap; gap: 8px; padding: 15px; }
.growth-loop { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }.growth-stage { position: relative; display: flex; align-items: center; gap: 12px; min-height: 82px; padding: 14px; border: 1px solid #e6eaf1; border-radius: 14px; background: #fff; }.growth-stage:not(:last-child)::after { position: absolute; right: -10px; z-index: 2; content: "→"; color: #9aa4b3; }.stage-index { display: grid; place-items: center; flex: 0 0 34px; width: 34px; height: 34px; color: #fff; font-size: 12px; font-weight: 800; border-radius: 50%; background: #7d8798; }.growth-stage strong, .growth-stage span { display: block; }.growth-stage strong { color: #17243b; line-height: 1.35; }.growth-stage span { margin-top: 5px; color: #818b9b; font-size: 12px; }.growth-stage.state-active .stage-index, .growth-stage.state-ready .stage-index { background: #2f8f64; }.growth-stage.state-running .stage-index, .growth-stage.state-tracking .stage-index { background: #3978c5; }.growth-stage.state-action_required { border-color: #f0b8bd; background: #fff8f8; }.growth-stage.state-action_required .stage-index { background: #c53943; }
@media (max-width: 1400px) { .asset-filter { grid-template-columns: minmax(220px, 1fr) repeat(3, minmax(130px, .65fr)) auto; }.report-summary { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 1400px) { .growth-loop { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 1100px) { .brand-metrics { grid-template-columns: repeat(2, 1fr); }.knowledge-filter { grid-template-columns: repeat(3, 1fr); }.two-panels { grid-template-columns: 1fr; }.growth-loop { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .brand-hero, .workspace-heading { align-items: flex-start; flex-direction: column; }.brand-metrics, .report-summary, .growth-loop { grid-template-columns: 1fr; }.growth-stage::after { display: none; }.main-tabs { width: 100%; }.main-tabs button { min-width: 0; flex: 1; }.filter-bar, .form-grid, .advanced-filter-grid { grid-template-columns: 1fr; }.advanced-filter { grid-column: auto; }.form-grid .full { grid-column: auto; }.video-toolbar, .ai-assist { align-items: flex-start; flex-direction: column; }.video-toolbar .el-select { width: 100%; } }
</style>
