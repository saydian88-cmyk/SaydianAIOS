<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox, type UploadFile } from "element-plus";
import { Collection, Download, Plus, Refresh, Search, UploadFilled } from "@element-plus/icons-vue";
import { api, patch, post, upload } from "../api";

type Row = Record<string, any>;
type Overview = {
  knowledge: { total: number; ready: number; pending: number };
  assets: { total: number; ready: number; pending: number; ossStored: number };
  oss: { ok: boolean; message: string };
};

const activeTab = ref("knowledge");
const knowledgeView = ref("entries");
const loading = ref(false);
const overview = ref<Overview>();
const knowledge = ref<Row[]>([]);
const assets = ref<Row[]>([]);
const controls = ref<{ claims: Row[]; mappings: Row[]; phraseRules: Row[] }>({ claims: [], mappings: [], phraseRules: [] });
const knowledgeDialog = ref(false);
const assetDialog = ref(false);
const editingKnowledgeId = ref("");
const editingAssetId = ref("");
const selectedFile = ref<File>();

const knowledgeFilter = reactive({ query: "", type: "", status: "", model: "" });
const assetFilter = reactive({ query: "", category: "", status: "", model: "" });
const knowledgeForm = reactive({ type: "FAQ", title: "", category: "", model: "", summary: "", reply: "", body: "", source: "运营后台录入", sourceRefs: "", keywords: "", scenarios: "", audience: "customer" });
const assetForm = reactive({ name: "", category: "", model: "", scene: "", creator: "", participants: "", language: "中文", targetPlatforms: "", hook: "", sellingPoints: "", scenarios: "", audienceTags: "", copyrightStatus: "待确认", aiTags: "", restriction: "", evidenceIds: "" });

const knowledgeTypes = [
  { label: "产品卖点", value: "PRODUCT" }, { label: "产品参数", value: "PARAMETER" },
  { label: "标准话术", value: "WORDING" }, { label: "常见问答", value: "FAQ" },
  { label: "禁用词", value: "FORBIDDEN" }, { label: "售后规则", value: "AFTER_SALE" },
  { label: "使用教程", value: "TUTORIAL" },
];
const assetCategories = ["视频原片", "视频成片", "直播切片", "产品图", "场景图", "详情页", "脚本", "软文", "封面", "配音", "音乐", "字幕", "用户案例", "产品资料"];
const categoryOptions = computed(() => Array.from(new Set([...assetCategories, ...assets.value.map((item) => item.category).filter(Boolean)])));

function typeLabel(value: string) {
  return knowledgeTypes.find((item) => item.value === value)?.label || value;
}

function statusLabel(value: string) {
  return ({ DRAFT: "草稿", PENDING: "待审核", READY: "可用", BLOCKED: "禁用", ARCHIVED: "归档" } as Record<string, string>)[value] || value;
}

function statusType(value: string) {
  if (value === "READY") return "success";
  if (value === "BLOCKED") return "danger";
  if (value === "PENDING") return "warning";
  return "info";
}

function dateTime(value?: string) {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未记录" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function list(value: unknown) {
  return Array.isArray(value) && value.length ? value.join("、") : "—";
}

function fileSize(value: unknown) {
  const size = Number(value || 0);
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(2)} GB`;
  if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

async function run(task: () => Promise<void>, success?: string) {
  loading.value = true;
  try {
    await task();
    if (success) ElMessage.success(success);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "操作失败");
  } finally {
    loading.value = false;
  }
}

function queryString(values: Record<string, string>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value.trim()) params.set(key, value.trim()); });
  return params.toString();
}

async function loadKnowledge() {
  knowledge.value = await api<Row[]>(`/api/v1/brand-data/knowledge?${queryString(knowledgeFilter)}`);
}

async function loadAssets() {
  assets.value = await api<Row[]>(`/api/v1/brand-data/assets?${queryString(assetFilter)}`);
}

async function reload() {
  await run(async () => {
    [overview.value, knowledge.value, assets.value, controls.value] = await Promise.all([
      api<Overview>("/api/v1/brand-data/overview"),
      api<Row[]>("/api/v1/brand-data/knowledge"),
      api<Row[]>("/api/v1/brand-data/assets"),
      api<{ claims: Row[]; mappings: Row[]; phraseRules: Row[] }>("/api/v1/brand-data/knowledge-controls"),
    ]);
  });
}

function clearObject(target: Record<string, string>, values: Record<string, string>) {
  Object.keys(target).forEach((key) => { target[key] = values[key] ?? ""; });
}

function openKnowledge(row?: Row) {
  editingKnowledgeId.value = row?.id || "";
  clearObject(knowledgeForm, {
    type: row?.type || "FAQ", title: row?.title || "", category: row?.category || "", model: row?.model || "",
    summary: row?.summary || "", reply: row?.reply || "", body: row?.body || "", source: row?.source || "运营后台录入",
    sourceRefs: row?.sourceRefs || "", keywords: list(row?.metadata?.keywords) === "—" ? "" : list(row?.metadata?.keywords),
    scenarios: list(row?.metadata?.scenarios) === "—" ? "" : list(row?.metadata?.scenarios), audience: row?.audience || "customer",
  });
  knowledgeDialog.value = true;
}

async function saveKnowledge() {
  if (!knowledgeForm.title.trim()) return ElMessage.warning("请填写知识标题");
  await run(async () => {
    if (editingKnowledgeId.value) await patch(`/api/v1/brand-data/knowledge/${editingKnowledgeId.value}`, knowledgeForm);
    else await post("/api/v1/brand-data/knowledge", knowledgeForm);
    knowledgeDialog.value = false;
    await Promise.all([loadKnowledge(), refreshOverview()]);
  }, editingKnowledgeId.value ? "知识已更新并生成新版本" : "知识已加入待审核库");
}

async function reviewKnowledge(row: Row, approved: boolean) {
  let note = "";
  if (!approved) {
    const result = await ElMessageBox.prompt("填写禁用或退回原因", "知识审核", { confirmButtonText: "确认", cancelButtonText: "取消" });
    note = String(result.value || "");
  }
  await run(async () => {
    await post(`/api/v1/brand-data/knowledge/${row.id}/review`, { approved, note });
    await Promise.all([loadKnowledge(), refreshOverview()]);
  }, approved ? "知识已审核通过" : "知识已标记禁用");
}

function resetAssetForm() {
  editingAssetId.value = "";
  selectedFile.value = undefined;
  clearObject(assetForm, { name: "", category: "", model: "", scene: "", creator: "", participants: "", language: "中文", targetPlatforms: "", hook: "", sellingPoints: "", scenarios: "", audienceTags: "", copyrightStatus: "待确认", aiTags: "", restriction: "", evidenceIds: "" });
}

function openAsset(row?: Row) {
  resetAssetForm();
  if (row) {
    editingAssetId.value = row.id;
    clearObject(assetForm, {
      name: row.displayName || row.fileName, category: row.category || "", model: row.model || "", scene: row.scene || "",
      creator: row.metadata?.creator || row.discoveredBy || "", participants: list(row.metadata?.participants) === "—" ? "" : list(row.metadata?.participants),
      language: row.metadata?.language || "中文", targetPlatforms: list(row.metadata?.targetPlatforms) === "—" ? "" : list(row.metadata?.targetPlatforms),
      hook: row.metadata?.hook || "", sellingPoints: list(row.metadata?.sellingPoints) === "—" ? "" : list(row.metadata?.sellingPoints),
      scenarios: list(row.metadata?.scenarios) === "—" ? "" : list(row.metadata?.scenarios), audienceTags: list(row.metadata?.audienceTags) === "—" ? "" : list(row.metadata?.audienceTags),
      copyrightStatus: row.metadata?.copyrightStatus || "待确认", aiTags: list(row.metadata?.aiTags) === "—" ? "" : list(row.metadata?.aiTags),
      restriction: row.restriction || "", evidenceIds: list(row.evidenceIds) === "—" ? "" : list(row.evidenceIds),
    });
  }
  assetDialog.value = true;
}

function selectFile(file: UploadFile) {
  selectedFile.value = file.raw;
  if (!assetForm.name && file.name) assetForm.name = file.name.replace(/\.[^.]+$/u, "");
}

async function saveAsset() {
  if (!editingAssetId.value && !selectedFile.value) return ElMessage.warning("请选择素材文件");
  await run(async () => {
    if (editingAssetId.value) {
      await patch(`/api/v1/brand-data/assets/${editingAssetId.value}`, assetForm);
    } else {
      const form = new FormData();
      form.append("file", selectedFile.value!);
      Object.entries(assetForm).forEach(([key, value]) => form.append(key, value));
      const result = await upload<{ duplicate: boolean; asset: Row }>("/api/v1/brand-data/assets/upload", form);
      if (result.duplicate) ElMessage.warning(`检测到重复素材，已保留原记录：${result.asset.displayName}`);
    }
    assetDialog.value = false;
    await Promise.all([loadAssets(), refreshOverview()]);
  }, editingAssetId.value ? "素材台账已更新" : "素材已上传到 OSS，等待审核");
}

async function reviewAsset(row: Row, approved: boolean) {
  let note = "";
  if (!approved) {
    const result = await ElMessageBox.prompt("填写禁用或退回原因", "素材审核", { confirmButtonText: "确认", cancelButtonText: "取消" });
    note = String(result.value || "");
  }
  await run(async () => {
    await post(`/api/v1/brand-data/assets/${row.id}/review`, { approved, note });
    await Promise.all([loadAssets(), refreshOverview()]);
  }, approved ? "素材已审核为可用" : "素材已标记禁用");
}

async function downloadAsset(row: Row) {
  await run(async () => {
    const result = await api<{ url: string }>(`/api/v1/brand-data/assets/${row.id}/download-url`);
    window.open(result.url, "_blank", "noopener,noreferrer");
  });
}

async function refreshOverview() {
  overview.value = await api<Overview>("/api/v1/brand-data/overview");
}

async function syncAssets() {
  await run(async () => {
    await post("/api/v1/jobs/run/SYNC_ASSETS");
    await reload();
  }, "素材扫描与 OSS 同步任务已加入队列");
}

defineExpose({ reload });
onMounted(reload);
</script>

<template>
  <section class="brand-data-page" v-loading="loading">
    <div class="brand-hero">
      <div>
        <span class="brand-eyebrow">BRAND DATA CENTER</span>
        <h2>品牌数据中心</h2>
        <p>统一沉淀审核后的品牌知识与素材资产，为后续内容生产提供唯一可信来源。</p>
      </div>
      <div class="hero-actions">
        <el-tag :type="overview?.oss.ok ? 'success' : 'warning'" effect="plain">{{ overview?.oss.message || 'OSS状态读取中' }}</el-tag>
        <el-button :icon="Refresh" @click="reload">刷新数据</el-button>
      </div>
    </div>

    <div class="brand-metrics">
      <article><span>知识总量</span><strong>{{ overview?.knowledge.total ?? 0 }}</strong><small>可用 {{ overview?.knowledge.ready ?? 0 }} · 待审核 {{ overview?.knowledge.pending ?? 0 }}</small></article>
      <article><span>素材总量</span><strong>{{ overview?.assets.total ?? 0 }}</strong><small>可用 {{ overview?.assets.ready ?? 0 }} · 待审核 {{ overview?.assets.pending ?? 0 }}</small></article>
      <article><span>OSS 已存储</span><strong>{{ overview?.assets.ossStored ?? 0 }}</strong><small>原始文件不覆盖，按哈希去重</small></article>
      <article><span>知识管控项</span><strong>{{ controls.claims.length + controls.mappings.length + controls.phraseRules.length }}</strong><small>证据、型号映射与表述规则</small></article>
    </div>

    <div class="main-tabs">
      <button :class="{ active: activeTab === 'knowledge' }" @click="activeTab = 'knowledge'"><el-icon><Collection /></el-icon><span>品牌知识库</span><b>{{ overview?.knowledge.total ?? 0 }}</b></button>
      <button :class="{ active: activeTab === 'assets' }" @click="activeTab = 'assets'"><el-icon><UploadFilled /></el-icon><span>素材库</span><b>{{ overview?.assets.total ?? 0 }}</b></button>
    </div>

    <template v-if="activeTab === 'knowledge'">
      <div class="workspace-heading">
        <div><h3>品牌知识库</h3><p>产品卖点、参数、标准话术、FAQ、禁用词、售后规则和教程统一版本管理。</p></div>
        <el-button type="primary" :icon="Plus" @click="openKnowledge()">新建知识</el-button>
      </div>
      <el-segmented v-model="knowledgeView" :options="[
        { label: `知识条目 ${knowledge.length}`, value: 'entries' },
        { label: `宣传证据 ${controls.claims.length}`, value: 'claims' },
        { label: `型号映射 ${controls.mappings.length}`, value: 'mappings' },
        { label: `表述规则 ${controls.phraseRules.length}`, value: 'rules' },
      ]" />
      <template v-if="knowledgeView === 'entries'">
        <div class="filter-bar">
          <el-input v-model="knowledgeFilter.query" clearable placeholder="搜索编号、标题、正文或回复" :prefix-icon="Search" @keyup.enter="run(loadKnowledge)" />
          <el-select v-model="knowledgeFilter.type" clearable placeholder="知识类型"><el-option v-for="item in knowledgeTypes" :key="item.value" :label="item.label" :value="item.value" /></el-select>
          <el-input v-model="knowledgeFilter.model" clearable placeholder="适用型号" @keyup.enter="run(loadKnowledge)" />
          <el-select v-model="knowledgeFilter.status" clearable placeholder="审核状态"><el-option label="待审核" value="PENDING" /><el-option label="可用" value="READY" /><el-option label="禁用" value="BLOCKED" /><el-option label="归档" value="ARCHIVED" /></el-select>
          <el-button type="primary" :icon="Search" @click="run(loadKnowledge)">查询</el-button>
        </div>
        <div class="data-panel">
          <el-table :data="knowledge" stripe height="500">
            <el-table-column prop="id" label="知识编号" width="170" show-overflow-tooltip />
            <el-table-column label="类型" width="110"><template #default="scope">{{ typeLabel(scope.row.type) }}</template></el-table-column>
            <el-table-column prop="title" label="知识标题" min-width="210" show-overflow-tooltip />
            <el-table-column prop="model" label="适用型号" width="120"><template #default="scope">{{ scope.row.model || '通用' }}</template></el-table-column>
            <el-table-column label="核心内容" min-width="300" show-overflow-tooltip><template #default="scope">{{ scope.row.reply || scope.row.summary || scope.row.body || '待完善' }}</template></el-table-column>
            <el-table-column prop="source" label="来源" width="150" show-overflow-tooltip />
            <el-table-column label="版本" width="80"><template #default="scope">V{{ scope.row.metadata?.version || 1 }}</template></el-table-column>
            <el-table-column label="审核状态" width="100"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column>
            <el-table-column label="更新时间" width="140"><template #default="scope">{{ dateTime(scope.row.updatedAt) }}</template></el-table-column>
            <el-table-column label="操作" width="190" fixed="right"><template #default="scope"><el-button link type="primary" @click="openKnowledge(scope.row)">编辑</el-button><el-button v-if="scope.row.status !== 'READY'" link type="success" @click="reviewKnowledge(scope.row, true)">通过</el-button><el-button v-if="scope.row.status !== 'BLOCKED'" link type="danger" @click="reviewKnowledge(scope.row, false)">禁用</el-button></template></el-table-column>
          </el-table>
        </div>
      </template>
      <div v-else-if="knowledgeView === 'claims'" class="data-panel"><el-table :data="controls.claims" stripe height="545"><el-table-column prop="id" label="证据编号" width="110" /><el-table-column prop="name" label="证据名称" min-width="210" /><el-table-column prop="coveredObject" label="适用范围" min-width="230" show-overflow-tooltip /><el-table-column prop="publicWording" label="允许表述" min-width="320" show-overflow-tooltip /><el-table-column prop="internalRestriction" label="使用限制" min-width="250" show-overflow-tooltip /><el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column></el-table></div>
      <div v-else-if="knowledgeView === 'mappings'" class="data-panel"><el-table :data="controls.mappings" stripe height="545"><el-table-column prop="commercialName" label="商品名称" min-width="180" /><el-table-column prop="nameplateModel" label="包装/铭牌型号" min-width="190" /><el-table-column prop="registeredModel" label="注册型号" min-width="190" /><el-table-column prop="registrationNumber" label="注册编号" min-width="200" /><el-table-column prop="requiredAction" label="发布前动作" min-width="300" show-overflow-tooltip /><el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column></el-table></div>
      <div v-else class="data-panel"><el-table :data="controls.phraseRules" stripe height="545"><el-table-column prop="category" label="规则类别" width="140" /><el-table-column prop="blockedText" label="拦截表述" min-width="260" /><el-table-column prop="replacement" label="建议替代表述" min-width="320" /><el-table-column prop="condition" label="使用条件" min-width="300" /></el-table></div>
    </template>

    <template v-else>
      <div class="workspace-heading">
        <div><h3>素材库</h3><p>网页上传、小程序同步和本地扫描形成统一素材编号；原文件进入私有 OSS，版本与审核全程留痕。</p></div>
        <div><el-button :icon="Refresh" @click="syncAssets">扫描同步 OSS</el-button><el-button type="primary" :icon="Plus" @click="openAsset()">上传素材</el-button></div>
      </div>
      <div class="filter-bar asset-filter">
        <el-input v-model="assetFilter.query" clearable placeholder="搜索素材编号、名称、型号或人员" :prefix-icon="Search" @keyup.enter="run(loadAssets)" />
        <el-select v-model="assetFilter.category" clearable filterable placeholder="素材分类"><el-option v-for="item in categoryOptions" :key="item" :label="item" :value="item" /></el-select>
        <el-input v-model="assetFilter.model" clearable placeholder="产品/型号" @keyup.enter="run(loadAssets)" />
        <el-select v-model="assetFilter.status" clearable placeholder="审核状态"><el-option label="待审核" value="PENDING" /><el-option label="可用" value="READY" /><el-option label="禁用" value="BLOCKED" /><el-option label="归档" value="ARCHIVED" /></el-select>
        <el-button type="primary" :icon="Search" @click="run(loadAssets)">查询</el-button>
      </div>
      <div class="data-panel">
        <el-table :data="assets" stripe height="540">
          <el-table-column prop="assetNo" label="素材编号" width="175" show-overflow-tooltip />
          <el-table-column prop="displayName" label="素材名称" min-width="220" show-overflow-tooltip />
          <el-table-column prop="category" label="分类" width="120" />
          <el-table-column label="产品/型号" width="120"><template #default="scope">{{ scope.row.model || '待标注' }}</template></el-table-column>
          <el-table-column label="来源/创建人" width="155"><template #default="scope">{{ scope.row.metadata?.creator || scope.row.discoveredBy }}<small class="cell-note">{{ scope.row.sourceType }}</small></template></el-table-column>
          <el-table-column label="文件信息" width="145"><template #default="scope">{{ scope.row.mediaType }} · {{ fileSize(scope.row.sizeBytes) }}<small class="cell-note">{{ scope.row.width && scope.row.height ? `${scope.row.width}×${scope.row.height}` : `V${scope.row.latestVersion || 1}` }}</small></template></el-table-column>
          <el-table-column label="平台/标签" min-width="190" show-overflow-tooltip><template #default="scope">{{ list(scope.row.metadata?.targetPlatforms) }}<small class="cell-note">{{ list(scope.row.metadata?.aiTags) }}</small></template></el-table-column>
          <el-table-column label="版权" width="95"><template #default="scope">{{ scope.row.metadata?.copyrightStatus || '待确认' }}</template></el-table-column>
          <el-table-column label="OSS" width="95"><template #default="scope"><el-tag :type="scope.row.objectKey ? 'success' : 'warning'" effect="plain">{{ scope.row.objectKey ? '已存储' : '待同步' }}</el-tag></template></el-table-column>
          <el-table-column label="状态" width="95"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="225" fixed="right"><template #default="scope"><el-button link type="primary" @click="openAsset(scope.row)">编辑</el-button><el-button v-if="scope.row.objectKey" link :icon="Download" @click="downloadAsset(scope.row)">下载</el-button><el-button v-if="scope.row.status !== 'READY'" link type="success" @click="reviewAsset(scope.row, true)">通过</el-button><el-button v-if="scope.row.status !== 'BLOCKED'" link type="danger" @click="reviewAsset(scope.row, false)">禁用</el-button></template></el-table-column>
        </el-table>
      </div>
    </template>

    <el-dialog v-model="knowledgeDialog" :title="editingKnowledgeId ? '编辑品牌知识' : '新建品牌知识'" width="760px" destroy-on-close>
      <el-form label-position="top" class="form-grid">
        <el-form-item label="知识类型" required><el-select v-model="knowledgeForm.type"><el-option v-for="item in knowledgeTypes" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
        <el-form-item label="知识标题" required><el-input v-model="knowledgeForm.title" maxlength="100" /></el-form-item>
        <el-form-item label="知识分类"><el-input v-model="knowledgeForm.category" placeholder="如：购买咨询、产品使用" /></el-form-item>
        <el-form-item label="适用型号"><el-input v-model="knowledgeForm.model" placeholder="通用可不填" /></el-form-item>
        <el-form-item label="摘要" class="full"><el-input v-model="knowledgeForm.summary" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="标准回复/允许话术" class="full"><el-input v-model="knowledgeForm.reply" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="完整正文" class="full"><el-input v-model="knowledgeForm.body" type="textarea" :rows="4" /></el-form-item>
        <el-form-item label="关键词"><el-input v-model="knowledgeForm.keywords" placeholder="逗号分隔" /></el-form-item>
        <el-form-item label="适用场景"><el-input v-model="knowledgeForm.scenarios" placeholder="逗号分隔" /></el-form-item>
        <el-form-item label="资料来源"><el-input v-model="knowledgeForm.source" /></el-form-item>
        <el-form-item label="来源链接/文件"><el-input v-model="knowledgeForm.sourceRefs" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="knowledgeDialog = false">取消</el-button><el-button type="primary" @click="saveKnowledge">保存为待审核</el-button></template>
    </el-dialog>

    <el-dialog v-model="assetDialog" :title="editingAssetId ? '编辑素材台账' : '上传素材到 OSS'" width="820px" destroy-on-close>
      <el-upload v-if="!editingAssetId" drag :auto-upload="false" :limit="1" :on-change="selectFile" :on-remove="() => selectedFile = undefined" class="asset-upload">
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon><div class="el-upload__text">拖入文件，或<em>点击选择</em></div><template #tip><div class="el-upload__tip">单文件不超过 200MB；大体积素材请使用本地扫描同步。</div></template>
      </el-upload>
      <el-form label-position="top" class="form-grid asset-form">
        <el-form-item label="素材名称"><el-input v-model="assetForm.name" /></el-form-item>
        <el-form-item label="素材分类"><el-select v-model="assetForm.category" filterable allow-create><el-option v-for="item in assetCategories" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="产品/型号"><el-input v-model="assetForm.model" placeholder="如 W9S" /></el-form-item>
        <el-form-item label="使用场景"><el-input v-model="assetForm.scene" placeholder="如 父母健康管理" /></el-form-item>
        <el-form-item label="创建人"><el-input v-model="assetForm.creator" placeholder="未填则记录当前员工" /></el-form-item>
        <el-form-item label="出镜/参与人员"><el-input v-model="assetForm.participants" placeholder="逗号分隔" /></el-form-item>
        <el-form-item label="目标平台"><el-input v-model="assetForm.targetPlatforms" placeholder="抖音、视频号、小红书" /></el-form-item>
        <el-form-item label="版权状态"><el-select v-model="assetForm.copyrightStatus"><el-option label="待确认" value="待确认" /><el-option label="自有可用" value="自有可用" /><el-option label="已授权" value="已授权" /><el-option label="限制使用" value="限制使用" /></el-select></el-form-item>
        <el-form-item label="前三秒 Hook" class="full"><el-input v-model="assetForm.hook" /></el-form-item>
        <el-form-item label="内容卖点" class="full"><el-input v-model="assetForm.sellingPoints" placeholder="逗号分隔" /></el-form-item>
        <el-form-item label="受众标签"><el-input v-model="assetForm.audienceTags" placeholder="逗号分隔" /></el-form-item>
        <el-form-item label="AI标签"><el-input v-model="assetForm.aiTags" placeholder="逗号分隔" /></el-form-item>
        <el-form-item label="关联证据编号"><el-input v-model="assetForm.evidenceIds" placeholder="逗号分隔" /></el-form-item>
        <el-form-item label="使用限制"><el-input v-model="assetForm.restriction" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="assetDialog = false">取消</el-button><el-button type="primary" @click="saveAsset">{{ editingAssetId ? '保存台账' : '上传并建档' }}</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.brand-data-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.brand-hero { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 24px 28px; color: #fff; border-radius: 20px; background: linear-gradient(120deg, #15213a 0%, #1b365d 58%, #a2202b 160%); box-shadow: 0 14px 38px rgba(24, 40, 72, .16); }
.brand-hero h2 { margin: 5px 0 7px; font-size: 28px; }
.brand-hero p { margin: 0; color: rgba(255,255,255,.72); }
.brand-eyebrow { font-size: 11px; font-weight: 800; letter-spacing: .16em; color: #f2b8be; }
.hero-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.brand-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.brand-metrics article { padding: 18px 20px; border: 1px solid #e9edf4; border-radius: 16px; background: #fff; box-shadow: 0 7px 20px rgba(28, 44, 72, .05); }
.brand-metrics span, .brand-metrics small { display: block; color: #7a8496; }
.brand-metrics strong { display: block; margin: 5px 0 2px; font-size: 27px; color: #162239; }
.main-tabs { display: flex; width: fit-content; padding: 5px; border-radius: 14px; background: #e9edf4; }
.main-tabs button { display: flex; align-items: center; gap: 8px; min-width: 170px; padding: 11px 17px; color: #637086; border: 0; border-radius: 10px; background: transparent; cursor: pointer; }
.main-tabs button.active { color: #a2202b; background: #fff; box-shadow: 0 4px 12px rgba(32, 45, 69, .1); }
.main-tabs b { margin-left: auto; padding: 2px 7px; font-size: 12px; border-radius: 999px; background: #f1f3f7; }
.workspace-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; }
.workspace-heading h3 { margin: 0 0 4px; font-size: 21px; color: #17243b; }
.workspace-heading p { margin: 0; color: #7d8798; }
.filter-bar { display: grid; grid-template-columns: minmax(260px, 1.5fr) 160px 150px 150px auto; gap: 10px; padding: 14px; border: 1px solid #e7ebf2; border-radius: 14px; background: #fff; }
.data-panel { overflow: hidden; border: 1px solid #e7ebf2; border-radius: 15px; background: #fff; }
.cell-note { display: block; margin-top: 2px; color: #9099a8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 18px; }
.form-grid .full { grid-column: 1 / -1; }
.asset-upload { margin-bottom: 18px; }
@media (max-width: 1200px) { .brand-metrics { grid-template-columns: repeat(2, 1fr); } .filter-bar { grid-template-columns: 1fr 1fr 1fr; } }
@media (max-width: 760px) { .brand-hero, .workspace-heading { align-items: flex-start; flex-direction: column; } .brand-metrics { grid-template-columns: 1fr; } .main-tabs { width: 100%; } .main-tabs button { min-width: 0; flex: 1; } .filter-bar, .form-grid { grid-template-columns: 1fr; } .form-grid .full { grid-column: auto; } }
</style>
