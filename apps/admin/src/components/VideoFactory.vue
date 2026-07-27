<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { Plus, Refresh, VideoCamera } from "@element-plus/icons-vue";
import { api, patch, post } from "../api";

type Row = Record<string, any>;

const props = defineProps<{ products: Row[] }>();
const emit = defineEmits<{ (event: "open-system-config"): void }>();
const loading = ref(false);
const view = ref("opportunities");
const projects = ref<Row[]>([]);
const providers = ref<Row[]>([]);
const models = ref<Row[]>([]);
const routing = ref<Row[]>([]);
const opportunityKeywords = ref<Row[]>([]);
const opportunityReferences = ref<Row[]>([]);
const selectedProject = ref<Row>();
const detailDrawer = ref(false);
const createDialog = ref(false);
const providerDialog = ref(false);
const modelDialog = ref(false);
const editingProviderId = ref("");
const editingModelId = ref("");
let pollTimer: number | undefined;

const createForm = reactive({
  platform: "DOUYIN",
  productModel: "",
  topic: "",
  audience: "",
  objective: "内容种草与商品点击",
  keywordIds: [] as string[],
  externalVideoIds: [] as string[],
  assetGapTaskId: "",
  requestedModelId: "",
  allowFallback: true,
  executionMode: "FULL_VIDEO",
  allowExternalGeneration: false,
});
const providerForm = reactive({
  code: "",
  displayName: "",
  region: "GLOBAL",
  baseUrl: "",
  capabilities: [] as string[],
  apiKey: "",
  webhookSecret: "",
  maxConcurrency: 2,
  dailyBudget: "" as string | number,
  priority: 100,
  enabled: false,
  healthPath: "",
});
const modelForm = reactive({
  providerId: "",
  code: "",
  displayName: "",
  capabilities: [] as string[],
  supportedRatios: ["9:16"] as string[],
  supportedDurations: [5, 10] as number[],
  supportedResolutions: ["720P"] as string[],
  scenarioTags: [] as string[],
  costPerSecond: 0,
  fixedCost: 0,
  currency: "USD",
  priority: 100,
  enabled: false,
});
const routeForm = reactive({ DOUYIN: "", TIKTOK: "" });

const enabledModels = computed(() => models.value.filter((item) =>
  item.enabled
  && item.provider?.enabled
  && ["CONFIGURED", "HEALTHY"].includes(item.provider?.state),
));
const runningCount = computed(() => projects.value.reduce((total, project) =>
  total
  + (project.videoGenerationJobs || []).filter((job: Row) => ["PENDING", "RUNNING", "RETRY"].includes(job.status)).length
  + (project.videoRenderJobs || []).filter((job: Row) => ["PENDING", "RUNNING"].includes(job.status)).length,
0));
const outputs = computed(() => projects.value.flatMap((project) => [
  ...(project.videoGenerationJobs || []).filter((job: Row) => job.outputAsset).map((job: Row) => ({ ...job, project, outputType: "AI镜头" })),
  ...(project.videoRenderJobs || []).filter((job: Row) => job.outputAsset).map((job: Row) => ({ ...job, project, outputType: "最终成片" })),
]));
const qualityChecks = computed(() => projects.value.flatMap((project) =>
  (project.videoQualityChecks || []).map((check: Row) => ({ ...check, project })),
));
const opportunities = computed(() => [
  ...opportunityKeywords.value.slice(0, 8).map((item) => ({ ...item, opportunityType: "KEYWORD", opportunityTitle: item.keyword })),
  ...opportunityReferences.value.slice(0, 6).map((item) => ({ ...item, opportunityType: "REFERENCE", opportunityTitle: item.title || item.externalContentId })),
]);

const statusLabels: Record<string, string> = {
  UNCONFIGURED: "未配置", CONFIGURED: "待验证", HEALTHY: "正常", DEGRADED: "部分可用", ERROR: "异常",
  PENDING: "排队中", RUNNING: "生成中", RETRY: "重试中", SUCCEEDED: "已完成", FAILED: "失败",
  FACTORY_SCRIPT_READY: "脚本候选", FACTORY_GENERATING: "镜头生成", READY_TO_EDIT: "可合成",
  EDITING: "合成中", VIDEO_REVIEW: "成片待审", PLATFORM_PACKAGING: "已通过",
  OPEN: "待补素材", GENERATING: "生成中", PENDING_REVIEW: "素材待审", DONE: "已完成",
  PASSED: "通过", REVIEW_REQUIRED: "待人工审核", REJECTED: "已退回",
};

function label(value?: string) {
  return statusLabels[String(value || "")] || String(value || "未记录");
}

function tagType(value?: string) {
  if (["HEALTHY", "SUCCEEDED", "DONE", "PASSED", "PLATFORM_PACKAGING"].includes(String(value))) return "success";
  if (["FAILED", "ERROR", "REJECTED"].includes(String(value))) return "danger";
  if (["PENDING", "RUNNING", "RETRY", "CONFIGURED", "PENDING_REVIEW", "REVIEW_REQUIRED", "VIDEO_REVIEW"].includes(String(value))) return "warning";
  return "info";
}

function dateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
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

async function reload() {
  await run(async () => {
    const [projectRows, providerRows, modelRows, routeRows, douyinKeywords, tiktokKeywords, referenceRows] = await Promise.all([
      api<Row[]>("/api/v1/video-factory/projects"),
      api<Row[]>("/api/v1/video-factory/providers"),
      api<Row[]>("/api/v1/video-factory/models"),
      api<Row[]>("/api/v1/video-factory/routing"),
      api<Row[]>("/api/v1/brand-data/smart-keywords/active?platform=DOUYIN&consumer=SMART_VIDEO"),
      api<Row[]>("/api/v1/brand-data/smart-keywords/active?platform=TIKTOK&consumer=SMART_VIDEO"),
      api<Row[]>("/api/v1/brand-data/external-videos?take=20"),
    ]);
    projects.value = projectRows;
    providers.value = providerRows;
    models.value = modelRows;
    routing.value = routeRows;
    opportunityKeywords.value = [...douyinKeywords.slice(0, 5), ...tiktokKeywords.slice(0, 5)];
    opportunityReferences.value = referenceRows;
    for (const platform of ["DOUYIN", "TIKTOK"] as const) {
      routeForm[platform] = routeRows.find((item) => item.platform === platform)?.primaryModelId || "";
    }
  });
}

function resetCreate() {
  Object.assign(createForm, {
    platform: "DOUYIN", productModel: "", topic: "", audience: "", objective: "内容种草与商品点击",
    keywordIds: [], externalVideoIds: [], requestedModelId: "", allowFallback: true,
    executionMode: "FULL_VIDEO", allowExternalGeneration: false,
    assetGapTaskId: "",
  });
}

function openCreate() {
  resetCreate();
  createDialog.value = true;
}

function onCreateModelChange(value: string) {
  createForm.allowFallback = !value;
  createForm.allowExternalGeneration = Boolean(value);
}

function shotModels(shot: Row) {
  const capability = shot.metadata?.imageAssetIds?.length ? "IMAGE_TO_VIDEO" : "TEXT_TO_VIDEO";
  return enabledModels.value.filter((model) => model.capabilities?.includes(capability));
}

function createFromKeyword(keyword: Row) {
  resetCreate();
  createForm.platform = keyword.platform === "TIKTOK" ? "TIKTOK" : "DOUYIN";
  createForm.productModel = keyword.product?.modelCode || "";
  createForm.topic = keyword.keyword || "";
  createForm.audience = keyword.audience || "";
  createForm.keywordIds = keyword.id ? [keyword.id] : [];
  createDialog.value = true;
}

function createFromReference(reference: Row) {
  resetCreate();
  createForm.platform = reference.platform === "TIKTOK" ? "TIKTOK" : "DOUYIN";
  createForm.topic = reference.title ? `参考结构：${reference.title}` : "爆款结构改编";
  createForm.externalVideoIds = reference.id ? [reference.id] : [];
  createDialog.value = true;
}

function createFromGap(task: Row) {
  resetCreate();
  createForm.productModel = task.evidence?.productModel || "";
  createForm.topic = task.title || task.description || "AI补齐缺失素材";
  createForm.objective = task.description || "补齐素材库缺失镜头";
  createForm.assetGapTaskId = task.id || "";
  createDialog.value = true;
}

async function createAndGenerate() {
  if (!createForm.topic.trim()) return ElMessage.warning("请填写视频主题或选择关键词");
  await run(async () => {
    await post<Row>("/api/v1/ai-tasks", {
      type: "VIDEO",
      title: createForm.topic,
      platform: createForm.platform,
      productModel: createForm.productModel || undefined,
      sourceType: createForm.assetGapTaskId
        ? "ASSET_GAP"
        : createForm.keywordIds.length
          ? "SMART_KEYWORD"
          : createForm.externalVideoIds.length
            ? "VIRAL_RESEARCH"
            : "VIDEO_FACTORY",
      sourceId: createForm.assetGapTaskId || createForm.keywordIds[0] || createForm.externalVideoIds[0] || undefined,
      instructions: `${createForm.objective}；目标人群：${createForm.audience || "目标用户"}`,
      input: {
        executionMode: createForm.executionMode,
        topic: createForm.topic,
        audience: createForm.audience,
        objective: createForm.objective,
        keywordIds: createForm.keywordIds,
        externalVideoIds: createForm.externalVideoIds,
        assetGapTaskId: createForm.assetGapTaskId || undefined,
      },
      modelPolicy: {
        strategy: "CODEX_FIRST",
        requestedModelId: createForm.requestedModelId || undefined,
        allowFallback: createForm.allowFallback,
        allowExternalGeneration: createForm.allowExternalGeneration,
      },
    });
    createDialog.value = false;
    await reload();
  }, createForm.executionMode === "SCRIPT_ONLY" ? "脚本任务已进入AI任务中心" : "完整视频任务已进入AI任务中心");
}

async function openProject(id: string) {
  selectedProject.value = await api<Row>(`/api/v1/video-factory/projects/${id}`);
  detailDrawer.value = true;
}

async function generateProject(row: Row, candidateIndex = 0) {
  await run(async () => {
    await post("/api/v1/ai-tasks", {
      type: "VIDEO",
      title: row.topic,
      platform: row.targetPlatforms?.[0] || "DOUYIN",
      productModel: row.productModel || undefined,
      sourceType: "VIDEO_PROJECT",
      sourceId: row.id,
      instructions: `执行视频工厂第${candidateIndex + 1}套方案`,
      input: {
        executionMode: "FULL_VIDEO",
        existingContentPlanId: row.id,
        candidateIndex,
      },
      modelPolicy: {
        strategy: "CODEX_FIRST",
        allowExternalGeneration: false,
      },
    });
    await reload();
  }, "视频项目已进入AI任务中心");
}

async function generateShot(shot: Row, modelId = "") {
  await run(async () => {
    await post(`/api/v1/video-factory/shots/${shot.id}/generate`, {
      prompt: shot.prompt || shot.description,
      duration: shot.durationSeconds || 5,
      requestedModelId: modelId || undefined,
      routingMode: modelId ? "FIXED" : "AUTO",
      allowFallback: !modelId,
    });
    await reload();
    if (selectedProject.value) await openProject(selectedProject.value.id);
  }, "镜头生成任务已排队");
}

async function renderProject(row: Row) {
  await run(async () => {
    await post(`/api/v1/video-factory/projects/${row.id}/render`, {});
    await reload();
  }, "成片合成任务已排队");
}

async function openOutput(assetId: string) {
  await run(async () => {
    const result = await api<Row>(`/api/v1/video-factory/outputs/${assetId}/url`);
    window.open(result.url, "_blank", "noopener,noreferrer");
  });
}

async function reviewOutput(assetId: string, approved: boolean) {
  await run(async () => {
    await post(`/api/v1/video-factory/outputs/${assetId}/review`, { approved });
    await reload();
    if (selectedProject.value) await openProject(selectedProject.value.id);
  }, approved ? "视频已审核通过" : "视频已退回");
}

function openProvider(row?: Row) {
  editingProviderId.value = row?.id || "";
  Object.assign(providerForm, {
    code: row?.code || "",
    displayName: row?.displayName || "",
    region: row?.region || "GLOBAL",
    baseUrl: row?.baseUrl || "",
    capabilities: row?.capabilities || [],
    apiKey: "",
    webhookSecret: "",
    maxConcurrency: row?.maxConcurrency || 2,
    dailyBudget: row?.dailyBudget ?? "",
    priority: row?.priority || 100,
    enabled: Boolean(row?.enabled),
    healthPath: row?.publicConfig?.healthPath || "",
  });
  providerDialog.value = true;
}

async function saveProvider() {
  if (!providerForm.displayName.trim()) return ElMessage.warning("请填写服务商名称");
  await run(async () => {
    const body = {
      ...providerForm,
      publicConfig: { healthPath: providerForm.healthPath || undefined },
      secret: {
        ...(providerForm.apiKey ? { apiKey: providerForm.apiKey } : {}),
        ...(providerForm.webhookSecret ? { webhookSecret: providerForm.webhookSecret } : {}),
      },
    };
    if (editingProviderId.value) await patch(`/api/v1/video-factory/providers/${editingProviderId.value}`, body);
    else await post("/api/v1/video-factory/providers", body);
    providerDialog.value = false;
    await reload();
  }, "模型服务商配置已保存");
}

async function checkProvider(row: Row) {
  await run(async () => {
    await post(`/api/v1/video-factory/providers/${row.id}/check`, {});
    await reload();
  }, "连接检查已完成");
}

function openModel(row?: Row) {
  editingModelId.value = row?.id || "";
  Object.assign(modelForm, {
    providerId: row?.providerId || providers.value[0]?.id || "",
    code: row?.code || "",
    displayName: row?.displayName || "",
    capabilities: row?.capabilities || [],
    supportedRatios: row?.supportedRatios || ["9:16"],
    supportedDurations: row?.supportedDurations || [5, 10],
    supportedResolutions: row?.supportedResolutions || ["720P"],
    scenarioTags: row?.scenarioTags || [],
    costPerSecond: Number(row?.costConfig?.perSecond || 0),
    fixedCost: Number(row?.costConfig?.fixed || 0),
    currency: row?.costConfig?.currency || "USD",
    priority: row?.priority || 100,
    enabled: Boolean(row?.enabled),
  });
  modelDialog.value = true;
}

async function saveModel() {
  if (!modelForm.providerId || !modelForm.code.trim() || !modelForm.displayName.trim()) return ElMessage.warning("请完整填写模型信息");
  await run(async () => {
    const body = {
      ...modelForm,
      costConfig: {
        perSecond: Number(modelForm.costPerSecond || 0),
        fixed: Number(modelForm.fixedCost || 0),
        currency: modelForm.currency || "USD",
      },
    };
    if (editingModelId.value) await patch(`/api/v1/video-factory/models/${editingModelId.value}`, body);
    else await post("/api/v1/video-factory/models", body);
    modelDialog.value = false;
    await reload();
  }, "视频模型已保存");
}

async function saveRoute(platform: "DOUYIN" | "TIKTOK") {
  await run(async () => {
    const existing = routing.value.find((item) => item.platform === platform);
    await post("/api/v1/video-factory/routing", {
      policyKey: `DEFAULT_${platform}`,
      name: `${platform === "DOUYIN" ? "抖音" : "TikTok"}默认视频路由`,
      platform,
      primaryModelId: routeForm[platform] || null,
      fallbackModelIds: existing?.fallbackModelIds || [],
      rules: { capability: "IMAGE_TO_VIDEO", preferRealAssets: true },
      priority: 10,
      active: true,
    });
    await reload();
  }, "默认模型已更新");
}

defineExpose({ reload, createFromKeyword, createFromReference, createFromGap });

onMounted(async () => {
  await reload();
  pollTimer = window.setInterval(() => {
    if (runningCount.value > 0) void reload();
  }, 8_000);
});
onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer);
});
</script>

<template>
  <section class="video-factory" v-loading="loading">
    <div class="factory-hero">
      <div>
        <span>SMART VIDEO FACTORY · V1.0</span>
        <h3>视频工厂</h3>
        <p>优先复用已审核真实素材，缺失镜头再调用AI；外部爆款只提取结构、Hook和节奏。</p>
      </div>
      <div>
        <el-button :icon="Refresh" @click="reload">刷新</el-button>
        <el-button @click="emit('open-system-config')">模型配置</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">一键生成视频</el-button>
      </div>
    </div>

    <div class="factory-summary">
      <article><span>视频项目</span><strong>{{ projects.length }}</strong><small>脚本、分镜、成片统一追踪</small></article>
      <article><span>执行中</span><strong>{{ runningCount }}</strong><small>生成与渲染异步处理</small></article>
      <article><span>成片与镜头</span><strong>{{ outputs.length }}</strong><small>均可追溯模型与成本</small></article>
      <article><span>可用模型</span><strong>{{ enabledModels.length }}</strong><small>未配置模型不会被调用</small></article>
    </div>

    <el-segmented v-model="view" :options="[
      { label: '今日机会', value: 'opportunities' },
      { label: `视频项目 ${projects.length}`, value: 'projects' },
      { label: '分镜与素材', value: 'shots' },
      { label: `生成任务 ${runningCount}`, value: 'jobs' },
      { label: `成片库 ${outputs.length}`, value: 'outputs' },
      { label: '质检审核', value: 'quality' },
    ]" />

    <div v-if="view === 'opportunities'" class="opportunity-grid">
      <article>
        <el-icon><VideoCamera /></el-icon>
        <h4>从智能关键词生成</h4>
        <p>在“智能关键词”中选择S/A级词，点击“一键生成视频”，主词和辅助词会自动关联。</p>
      </article>
      <article>
        <el-icon><VideoCamera /></el-icon>
        <h4>从爆款研究生成</h4>
        <p>参考爆款的Hook、节奏和结构，系统只调用赛电自有或AI生成素材完成新成片。</p>
      </article>
      <article>
        <el-icon><VideoCamera /></el-icon>
        <h4>人工创意生成</h4>
        <p>填写主题、产品、平台和人群，系统生成3套脚本并自动选择主执行方案。</p>
        <el-button type="primary" @click="openCreate">立即创建</el-button>
      </article>
    </div>
    <div v-if="view === 'opportunities' && opportunities.length" class="data-card">
      <div class="card-title"><h4>今日可执行机会</h4><small>只推荐，不自动调用付费模型</small></div>
      <el-table :data="opportunities" stripe height="390">
        <el-table-column label="来源" width="105"><template #default="scope"><el-tag>{{ scope.row.opportunityType === 'KEYWORD' ? '智能关键词' : '爆款研究' }}</el-tag></template></el-table-column>
        <el-table-column label="机会" min-width="280"><template #default="scope"><strong>{{ scope.row.opportunityTitle }}</strong><small>{{ scope.row.reason || scope.row.accountName || scope.row.platform }}</small></template></el-table-column>
        <el-table-column label="平台" width="100"><template #default="scope">{{ scope.row.platform === 'TIKTOK' ? 'TikTok' : '抖音' }}</template></el-table-column>
        <el-table-column label="评分" width="95"><template #default="scope">{{ scope.row.opportunityScore || scope.row.scoreSnapshots?.[0]?.score || '—' }}</template></el-table-column>
        <el-table-column label="操作" width="125"><template #default="scope"><el-button link type="primary" @click="scope.row.opportunityType === 'KEYWORD' ? createFromKeyword(scope.row) : createFromReference(scope.row)">创建视频</el-button></template></el-table-column>
      </el-table>
    </div>

    <div v-else-if="view === 'projects'" class="data-card">
      <el-table :data="projects" stripe height="570">
        <el-table-column label="项目" min-width="260"><template #default="scope"><strong>{{ scope.row.topic }}</strong><small>{{ scope.row.productionNo }} · {{ scope.row.productModel || '通用产品' }}</small></template></el-table-column>
        <el-table-column label="平台" width="105"><template #default="scope">{{ scope.row.targetPlatforms?.join('、') }}</template></el-table-column>
        <el-table-column label="关键词" min-width="180"><template #default="scope">{{ scope.row.keywordRelations?.map((item: Row) => item.keyword?.keyword).join('、') || '人工创意' }}</template></el-table-column>
        <el-table-column label="阶段" width="130"><template #default="scope"><el-tag :type="tagType(scope.row.productionStage)">{{ label(scope.row.productionStage) }}</el-tag></template></el-table-column>
        <el-table-column label="镜头" width="100"><template #default="scope">{{ scope.row.videoShots?.filter((item: Row) => item.status === 'DONE').length || 0 }}/{{ scope.row.videoShots?.length || 0 }}</template></el-table-column>
        <el-table-column label="更新时间" width="165"><template #default="scope">{{ dateTime(scope.row.updatedAt) }}</template></el-table-column>
        <el-table-column label="操作" width="230" fixed="right"><template #default="scope"><el-button link type="primary" @click="openProject(scope.row.id)">详情</el-button><el-button v-if="scope.row.productionStage === 'FACTORY_SCRIPT_READY'" link type="success" @click="generateProject(scope.row)">开始生成</el-button><el-button v-if="scope.row.productionStage === 'READY_TO_EDIT'" link type="warning" @click="renderProject(scope.row)">合成成片</el-button></template></el-table-column>
      </el-table>
    </div>

    <div v-else-if="view === 'shots'" class="data-card">
      <el-table :data="projects.flatMap((project: Row) => (project.videoShots || []).map((shot: Row) => ({ ...shot, project })))" stripe height="570">
        <el-table-column label="项目/镜头" min-width="270"><template #default="scope"><strong>{{ scope.row.project.topic }}</strong><small>{{ scope.row.title }} · {{ scope.row.description }}</small></template></el-table-column>
        <el-table-column prop="moduleType" label="模块" width="100" />
        <el-table-column label="来源" width="130"><template #default="scope">{{ scope.row.sourcePreference }}</template></el-table-column>
        <el-table-column label="状态" width="125"><template #default="scope"><el-tag :type="tagType(scope.row.status)">{{ label(scope.row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="素材" min-width="185"><template #default="scope">{{ scope.row.selectedAsset?.displayName || scope.row.selectedAsset?.fileName || '待补素材' }}</template></el-table-column>
        <el-table-column label="操作" width="170"><template #default="scope"><el-button v-if="['OPEN','FAILED'].includes(scope.row.status)" link type="primary" @click="generateShot(scope.row)">AI生成</el-button><el-button v-if="scope.row.selectedAssetId" link @click="openOutput(scope.row.selectedAssetId)">预览</el-button></template></el-table-column>
      </el-table>
    </div>

    <div v-else-if="view === 'jobs'" class="data-card">
      <el-table :data="projects.flatMap((project: Row) => [...(project.videoGenerationJobs || []).map((job: Row) => ({ ...job, project, kind: '镜头生成' })), ...(project.videoRenderJobs || []).map((job: Row) => ({ ...job, project, kind: '成片合成' }))])" stripe height="570">
        <el-table-column prop="kind" label="任务" width="105" />
        <el-table-column label="项目" min-width="220"><template #default="scope">{{ scope.row.project.topic }}</template></el-table-column>
        <el-table-column label="模型/执行器" min-width="190"><template #default="scope">{{ scope.row.resolvedModel ? `${scope.row.resolvedModel.provider?.displayName} · ${scope.row.resolvedModel.displayName}` : scope.row.renderer || '智能推荐' }}</template></el-table-column>
        <el-table-column label="状态" width="120"><template #default="scope"><el-tag :type="tagType(scope.row.status)">{{ label(scope.row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="费用" width="100"><template #default="scope">{{ Number(scope.row.actualCost || 0).toFixed(2) }}</template></el-table-column>
        <el-table-column prop="failureReason" label="失败原因" min-width="250" show-overflow-tooltip />
        <el-table-column label="创建时间" width="165"><template #default="scope">{{ dateTime(scope.row.createdAt) }}</template></el-table-column>
      </el-table>
    </div>

    <div v-else-if="view === 'outputs'" class="data-card">
      <el-table :data="outputs" stripe height="570">
        <el-table-column prop="outputType" label="类型" width="105" />
        <el-table-column label="成品" min-width="250"><template #default="scope"><strong>{{ scope.row.outputAsset.displayName || scope.row.outputAsset.fileName }}</strong><small>{{ scope.row.project.topic }}</small></template></el-table-column>
        <el-table-column label="审核" width="120"><template #default="scope"><el-tag :type="tagType(scope.row.outputAsset.reviewStatus)">{{ label(scope.row.outputAsset.reviewStatus) }}</el-tag></template></el-table-column>
        <el-table-column label="尺寸" width="130"><template #default="scope">{{ scope.row.outputAsset.width || '—' }}×{{ scope.row.outputAsset.height || '—' }}</template></el-table-column>
        <el-table-column label="时长" width="90"><template #default="scope">{{ Number(scope.row.outputAsset.durationSeconds || 0).toFixed(1) }}s</template></el-table-column>
        <el-table-column label="操作" width="220"><template #default="scope"><el-button link type="primary" @click="openOutput(scope.row.outputAsset.id)">查看/下载</el-button><el-button v-if="scope.row.outputAsset.reviewStatus === 'PENDING'" link type="success" @click="reviewOutput(scope.row.outputAsset.id, true)">通过</el-button><el-button v-if="scope.row.outputAsset.reviewStatus === 'PENDING'" link type="danger" @click="reviewOutput(scope.row.outputAsset.id, false)">退回</el-button></template></el-table-column>
      </el-table>
    </div>

    <div v-else-if="view === 'quality'" class="data-card">
      <el-table :data="qualityChecks" stripe height="570">
        <el-table-column label="项目" min-width="230"><template #default="scope">{{ scope.row.project.topic }}</template></el-table-column>
        <el-table-column prop="checkType" label="检查项" width="180" />
        <el-table-column label="结果" width="130"><template #default="scope"><el-tag :type="tagType(scope.row.status)">{{ label(scope.row.status) }}</el-tag></template></el-table-column>
        <el-table-column prop="score" label="评分" width="85" />
        <el-table-column label="发现" min-width="340"><template #default="scope">{{ scope.row.findings?.map((item: Row) => item.message || JSON.stringify(item)).join('；') || '无异常' }}</template></el-table-column>
        <el-table-column label="时间" width="165"><template #default="scope">{{ dateTime(scope.row.createdAt) }}</template></el-table-column>
      </el-table>
    </div>

    <template v-else-if="view === 'models'">
      <div class="model-route">
        <article v-for="platform in ['DOUYIN','TIKTOK']" :key="platform">
          <strong>{{ platform === 'DOUYIN' ? '抖音默认模型' : 'TikTok默认模型' }}</strong>
          <el-select v-model="routeForm[platform as 'DOUYIN' | 'TIKTOK']" clearable placeholder="智能推荐">
            <el-option v-for="model in enabledModels" :key="model.id" :label="`${model.provider.displayName} · ${model.displayName}`" :value="model.id" />
          </el-select>
          <el-button @click="saveRoute(platform as 'DOUYIN' | 'TIKTOK')">保存</el-button>
        </article>
      </div>
      <div class="two-cards">
        <div class="data-card">
          <div class="card-title"><h4>视频服务商</h4><el-button size="small" :icon="Plus" @click="openProvider()">新增</el-button></div>
          <el-table :data="providers" stripe height="430">
            <el-table-column label="服务商" min-width="180"><template #default="scope"><strong>{{ scope.row.displayName }}</strong><small>{{ scope.row.code }} · {{ scope.row.region }}</small></template></el-table-column>
            <el-table-column label="状态" width="105"><template #default="scope"><el-tag :type="tagType(scope.row.state)">{{ label(scope.row.state) }}</el-tag></template></el-table-column>
            <el-table-column label="密钥" width="80"><template #default="scope">{{ scope.row.secretConfigured ? '已配置' : '未配置' }}</template></el-table-column>
            <el-table-column label="操作" width="150"><template #default="scope"><el-button link type="primary" @click="openProvider(scope.row)">设置</el-button><el-button link @click="checkProvider(scope.row)">检查</el-button></template></el-table-column>
          </el-table>
        </div>
        <div class="data-card">
          <div class="card-title"><h4>模型目录与成本</h4><el-button size="small" :icon="Plus" @click="openModel()">新增</el-button></div>
          <el-table :data="models" stripe height="430">
            <el-table-column label="模型" min-width="210"><template #default="scope"><strong>{{ scope.row.displayName }}</strong><small>{{ scope.row.provider?.displayName }} · {{ scope.row.code }}</small></template></el-table-column>
            <el-table-column label="能力" min-width="190"><template #default="scope">{{ scope.row.capabilities?.join('、') }}</template></el-table-column>
            <el-table-column label="成本" width="115"><template #default="scope">{{ scope.row.costConfig?.perSecond ? `${scope.row.costConfig.currency || 'USD'} ${scope.row.costConfig.perSecond}/秒` : scope.row.costConfig?.fixed ? `${scope.row.costConfig.currency || 'USD'} ${scope.row.costConfig.fixed}/次` : '未设置' }}</template></el-table-column>
            <el-table-column label="状态" width="90"><template #default="scope"><el-tag :type="scope.row.enabled ? 'success' : 'info'">{{ scope.row.enabled ? '启用' : '停用' }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="80"><template #default="scope"><el-button link type="primary" @click="openModel(scope.row)">编辑</el-button></template></el-table-column>
          </el-table>
        </div>
      </div>
    </template>

    <el-dialog v-model="createDialog" title="一键生成智能视频" width="820px" destroy-on-close>
      <el-form label-position="top" class="form-grid">
        <el-form-item label="目标平台"><el-select v-model="createForm.platform"><el-option label="抖音" value="DOUYIN" /><el-option label="TikTok" value="TIKTOK" /></el-select></el-form-item>
        <el-form-item label="产品型号"><el-select v-model="createForm.productModel" clearable filterable><el-option v-for="item in props.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.modelCode" /></el-select></el-form-item>
        <el-form-item label="任务模式" class="full"><el-radio-group v-model="createForm.executionMode"><el-radio-button value="SCRIPT_ONLY">仅生成脚本</el-radio-button><el-radio-button value="FULL_VIDEO">生成完整视频</el-radio-button></el-radio-group><small class="form-tip">完整视频优先复用已审核素材，由本地Codex完成合成和质检。</small></el-form-item>
        <el-form-item label="主题/主关键词" class="full" required><el-input v-model="createForm.topic" maxlength="150" /></el-form-item>
        <el-form-item label="目标人群"><el-input v-model="createForm.audience" /></el-form-item>
        <el-form-item label="内容目标"><el-input v-model="createForm.objective" /></el-form-item>
        <el-form-item label="生成模型" class="full"><el-select v-model="createForm.requestedModelId" clearable placeholder="Codex智能推荐（默认）" @change="onCreateModelChange"><el-option v-for="item in enabledModels" :key="item.id" :label="`${item.provider.displayName} · ${item.displayName}`" :value="item.id" /></el-select><small class="form-tip">默认使用Codex本地工具；指定模型表示允许该任务调用外部视觉能力。</small></el-form-item>
        <el-form-item label="外部视觉能力" class="full"><el-switch v-model="createForm.allowExternalGeneration" active-text="本地素材不足时允许调用已配置模型" /></el-form-item>
        <el-form-item label="失败策略" class="full"><el-switch v-model="createForm.allowFallback" active-text="允许失败后自动切换模型" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="createDialog = false">取消</el-button><el-button type="primary" @click="createAndGenerate">{{ createForm.executionMode === 'SCRIPT_ONLY' ? '生成3套脚本' : '生成3套脚本并执行主方案' }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="providerDialog" :title="editingProviderId ? '设置视频服务商' : '新增视频服务商'" width="760px" destroy-on-close>
      <el-form label-position="top" class="form-grid">
        <el-form-item label="服务商代码"><el-input v-model="providerForm.code" :disabled="Boolean(editingProviderId)" /></el-form-item>
        <el-form-item label="显示名称"><el-input v-model="providerForm.displayName" /></el-form-item>
        <el-form-item label="地区"><el-select v-model="providerForm.region"><el-option label="中国" value="CN" /><el-option label="全球" value="GLOBAL" /><el-option label="美国" value="US" /></el-select></el-form-item>
        <el-form-item label="API地址"><el-input v-model="providerForm.baseUrl" /></el-form-item>
        <el-form-item label="API密钥" class="full"><el-input v-model="providerForm.apiKey" type="password" show-password placeholder="留空则保留原密钥" /></el-form-item>
        <el-form-item label="Webhook密钥" class="full"><el-input v-model="providerForm.webhookSecret" type="password" show-password placeholder="留空则保留原密钥；回调头使用 x-video-webhook-secret" /></el-form-item>
        <el-form-item v-if="providerForm.code" label="Webhook地址" class="full"><el-input :model-value="`/api/v1/video-factory/webhooks/${providerForm.code}`" readonly /></el-form-item>
        <el-form-item label="健康检查路径"><el-input v-model="providerForm.healthPath" placeholder="可选，例如 /v1/models" /></el-form-item>
        <el-form-item label="最大并发"><el-input-number v-model="providerForm.maxConcurrency" :min="1" :max="20" /></el-form-item>
        <el-form-item label="每日预算"><el-input v-model="providerForm.dailyBudget" placeholder="留空不限" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="providerForm.enabled" active-text="启用" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="providerDialog = false">取消</el-button><el-button type="primary" @click="saveProvider">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="modelDialog" :title="editingModelId ? '编辑视频模型' : '新增视频模型'" width="780px" destroy-on-close>
      <el-form label-position="top" class="form-grid">
        <el-form-item label="服务商"><el-select v-model="modelForm.providerId"><el-option v-for="item in providers" :key="item.id" :label="item.displayName" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="模型代码"><el-input v-model="modelForm.code" /></el-form-item>
        <el-form-item label="模型名称"><el-input v-model="modelForm.displayName" /></el-form-item>
        <el-form-item label="优先级"><el-input-number v-model="modelForm.priority" :min="1" /></el-form-item>
        <el-form-item label="能力" class="full"><el-select v-model="modelForm.capabilities" multiple allow-create filterable><el-option v-for="item in ['TEXT_TO_VIDEO','IMAGE_TO_VIDEO','REFERENCE_TO_VIDEO','VIDEO_EDIT','AVATAR','NATIVE_AUDIO']" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="时长"><el-select v-model="modelForm.supportedDurations" multiple allow-create filterable><el-option v-for="item in [4,5,8,10,12,15,30]" :key="item" :label="`${item}秒`" :value="item" /></el-select></el-form-item>
        <el-form-item label="分辨率"><el-select v-model="modelForm.supportedResolutions" multiple allow-create filterable><el-option v-for="item in ['480P','720P','1080P']" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="每秒成本"><el-input-number v-model="modelForm.costPerSecond" :min="0" :precision="4" /></el-form-item>
        <el-form-item label="每次固定成本"><el-input-number v-model="modelForm.fixedCost" :min="0" :precision="4" /></el-form-item>
        <el-form-item label="成本币种"><el-select v-model="modelForm.currency"><el-option label="USD" value="USD" /><el-option label="CNY" value="CNY" /></el-select></el-form-item>
        <el-form-item label="状态"><el-switch v-model="modelForm.enabled" active-text="启用" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="modelDialog = false">取消</el-button><el-button type="primary" @click="saveModel">保存</el-button></template>
    </el-dialog>

    <el-drawer v-model="detailDrawer" title="视频项目详情" size="72%">
      <template v-if="selectedProject">
        <div class="detail-head"><div><strong>{{ selectedProject.topic }}</strong><span>{{ selectedProject.productionNo }} · {{ selectedProject.productModel || '通用产品' }}</span></div><el-tag :type="tagType(selectedProject.productionStage)">{{ label(selectedProject.productionStage) }}</el-tag></div>
        <h4>3套脚本候选</h4>
        <div class="candidate-grid">
          <article v-for="(candidate, index) in selectedProject.scriptCandidates || []" :key="index">
            <el-tag v-if="index === 0" type="success">主执行包</el-tag>
            <strong>{{ candidate.topic }}</strong>
            <p>{{ candidate.hook }}</p>
            <small>评分 {{ candidate.score }} · 缺口 {{ candidate.missingAssets?.length || 0 }}</small>
            <el-button v-if="selectedProject.productionStage === 'FACTORY_SCRIPT_READY'" size="small" @click="generateProject(selectedProject, index)">执行此方案</el-button>
          </article>
        </div>
        <h4>分镜与素材</h4>
        <el-table :data="selectedProject.videoShots || []" stripe>
          <el-table-column prop="title" label="镜头" width="100" />
          <el-table-column prop="description" label="画面" min-width="300" />
          <el-table-column label="状态" width="125"><template #default="scope"><el-tag :type="tagType(scope.row.status)">{{ label(scope.row.status) }}</el-tag></template></el-table-column>
          <el-table-column label="素材" min-width="180"><template #default="scope">{{ scope.row.selectedAsset?.displayName || '待补素材' }}</template></el-table-column>
          <el-table-column label="操作" width="250"><template #default="scope"><el-button v-if="scope.row.status === 'OPEN'" link type="primary" @click="generateShot(scope.row)">智能推荐生成</el-button><el-dropdown v-if="scope.row.status === 'OPEN'" @command="generateShot(scope.row, $event)"><el-button link>指定模型</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item v-for="model in shotModels(scope.row)" :key="model.id" :command="model.id">{{ model.provider.displayName }} · {{ model.displayName }}</el-dropdown-item></el-dropdown-menu></template></el-dropdown><el-button v-if="scope.row.selectedAssetId" link @click="openOutput(scope.row.selectedAssetId)">预览</el-button></template></el-table-column>
        </el-table>
        <div class="detail-actions"><el-button v-if="selectedProject.productionStage === 'READY_TO_EDIT'" type="primary" @click="renderProject(selectedProject)">合成1080×1920成片</el-button></div>
      </template>
    </el-drawer>
  </section>
</template>

<style scoped>
.video-factory { display: grid; gap: 16px; }
.factory-hero, .factory-summary, .model-route, .two-cards, .opportunity-grid { display: grid; gap: 14px; }
.factory-hero { grid-template-columns: 1fr auto; align-items: start; padding: 20px 22px; color: #fff; border-radius: 16px; background: linear-gradient(135deg, #16253f, #304e79); }
.factory-hero span { font-size: 12px; letter-spacing: .12em; opacity: .76; }.factory-hero h3 { margin: 5px 0; font-size: 25px; }.factory-hero p { margin: 0; color: #dce7f6; }.factory-hero > div:last-child { display: flex; gap: 9px; }
.factory-summary { grid-template-columns: repeat(4, minmax(0, 1fr)); }.factory-summary article, .opportunity-grid article, .model-route article { padding: 17px 19px; border: 1px solid #e4e9f1; border-radius: 14px; background: #fff; }.factory-summary span, .factory-summary small { display: block; color: #7d8797; }.factory-summary strong { display: block; margin: 5px 0; color: #18263e; font-size: 27px; }
.opportunity-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }.opportunity-grid h4 { margin: 9px 0 5px; }.opportunity-grid p { min-height: 62px; color: #6f7a8c; line-height: 1.6; }.opportunity-grid .el-icon { color: #a2202b; font-size: 26px; }
.data-card { overflow: hidden; border: 1px solid #e4e9f1; border-radius: 14px; background: #fff; }.data-card strong, .data-card small { display: block; }.data-card small { margin-top: 3px; color: #8a94a5; }
.model-route { grid-template-columns: 1fr 1fr; }.model-route article { display: grid; grid-template-columns: 150px 1fr auto; align-items: center; gap: 10px; }.two-cards { grid-template-columns: .9fr 1.1fr; }.card-title { display: flex; align-items: center; justify-content: space-between; padding: 12px 15px; border-bottom: 1px solid #edf0f5; }.card-title h4 { margin: 0; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }.form-grid .full { grid-column: 1 / -1; }.form-tip { display: block; margin-top: 6px; color: #8a94a5; }
.detail-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 14px; border-bottom: 1px solid #edf0f5; }.detail-head strong, .detail-head span { display: block; }.detail-head strong { font-size: 22px; }.detail-head span { margin-top: 4px; color: #7c8797; }
.candidate-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }.candidate-grid article { padding: 14px; border: 1px solid #e3e8f0; border-radius: 12px; }.candidate-grid strong { display: block; margin: 8px 0; }.candidate-grid p { min-height: 48px; color: #657187; }.candidate-grid small { display: block; margin-bottom: 9px; color: #8a94a5; }.detail-actions { display: flex; justify-content: flex-end; padding-top: 16px; }
@media (max-width: 1100px) { .factory-summary, .opportunity-grid, .candidate-grid { grid-template-columns: 1fr 1fr; }.two-cards, .model-route { grid-template-columns: 1fr; } }
</style>
