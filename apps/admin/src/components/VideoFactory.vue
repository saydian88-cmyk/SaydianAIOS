<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { Plus, Refresh } from "@element-plus/icons-vue";
import { api, patch, post } from "../api";

type Row = Record<string, any>;

const props = withDefaults(defineProps<{
  products: Row[];
  platformScope?: "" | "DOUYIN" | "TIKTOK";
  mode?: "factory" | "douyin-viral";
}>(), {
  platformScope: "",
  mode: "factory",
});
const emit = defineEmits<{ (event: "open-system-config"): void }>();
const loading = ref(false);
const view = ref("topicCards");
const topicCards = ref<Row[]>([]);
const projects = ref<Row[]>([]);
const providers = ref<Row[]>([]);
const models = ref<Row[]>([]);
const routing = ref<Row[]>([]);
const opportunityKeywords = ref<Row[]>([]);
const opportunityReferences = ref<Row[]>([]);
const employees = ref<Row[]>([]);
const selectedTopicCards = ref<Row[]>([]);
const topicTable = ref<Row>();
const selectedTopicCard = ref<Row>();
const topicCardPreviewUrl = ref("");
const topicCardPreviewError = ref("");
const topicCardDrawer = ref(false);
const topicCardEdit = ref(false);
const approvalDialog = ref(false);
const selectedProject = ref<Row>();
const detailDrawer = ref(false);
const outputPreviewDialog = ref(false);
const selectedOutput = ref<Row>();
const outputPreviewUrl = ref("");
const createDialog = ref(false);
const providerDialog = ref(false);
const modelDialog = ref(false);
const editingProviderId = ref("");
const editingModelId = ref("");
let pollTimer: number | undefined;

const topicFilters = reactive({
  platform: props.platformScope,
  productModel: "",
  sourceType: "",
  status: "",
  minScore: 0,
  minCoverage: 0,
});
const topicCardForm = reactive({
  audience: "",
  pain: "",
  scene: "",
  objective: "",
  mainKeyword: "",
  auxiliaryKeywords: [] as string[],
  hookCandidates: [] as string[],
  primaryRecipe: "PAIN_SOLVE",
  backupRecipe: "UGC",
});
const approvalForm = reactive({
  executionMode: "FULL_VIDEO",
  ownerId: "",
  reviewerId: "",
  requestedModelId: "",
  allowExternalGeneration: true,
  allowFallback: true,
});

const createForm = reactive({
  platform: props.platformScope || "DOUYIN",
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
const isDouyinViralSystem = computed(() => props.mode === "douyin-viral");
const factoryModule = computed(() => isDouyinViralSystem.value ? "DOUYIN_VIRAL" : "GENERAL_VIDEO_FACTORY");
const heroKicker = computed(() => isDouyinViralSystem.value ? "DOUYIN VIRAL VIDEO SYSTEM · V1.0" : "SMART VIDEO FACTORY · V2.0");
const heroTitle = computed(() => isDouyinViralSystem.value ? "抖音爆款视频生成系统" : "视频工厂");
const heroDescription = computed(() => isDouyinViralSystem.value
  ? "从抖音关键词和爆款结构发现机会，结合产品知识与真实素材生成选题卡；人工确认后由独立Codex Skill按镜头选择本地合成、Seedance或Kling。"
  : "先把关键词、爆款结构、FAQ、产品知识和真实素材整理成选题卡；人工确认后再进入Codex生产。");

const enabledModels = computed(() => models.value.filter((item) =>
  item.enabled
  && item.provider?.enabled
  && ["CONFIGURED", "HEALTHY"].includes(item.provider?.state),
));
const taskModels = computed(() => isDouyinViralSystem.value
  ? enabledModels.value.filter((item) => ["VOLCENGINE_SEEDANCE", "KLING"].includes(item.provider?.code))
  : enabledModels.value);
const runningCount = computed(() => projects.value.reduce((total, project) =>
  total
  + (project.videoGenerationJobs || []).filter((job: Row) => ["PENDING", "RUNNING", "RETRY"].includes(job.status)).length
  + (project.videoRenderJobs || []).filter((job: Row) => ["PENDING", "RUNNING"].includes(job.status)).length,
0));
const filteredTopicCards = computed(() => topicCards.value.filter((row) => {
  const card = row.topicCard || {};
  return (!topicFilters.platform || card.platform === topicFilters.platform)
    && (!topicFilters.productModel || row.productModel === topicFilters.productModel)
    && (!topicFilters.sourceType || card.sourceTypes?.includes(topicFilters.sourceType))
    && (!topicFilters.status || row.productionStage === topicFilters.status)
    && Number(row.score || 0) >= Number(topicFilters.minScore || 0)
    && Number(card.materialCoverage?.coveragePercent || 0) >= Number(topicFilters.minCoverage || 0);
}));
const outputs = computed(() => projects.value.flatMap((project) => [
  ...(project.videoGenerationJobs || []).filter((job: Row) => job.outputAsset).map((job: Row) => ({ ...job, project, outputType: "AI镜头" })),
  ...(project.videoRenderJobs || []).filter((job: Row) => job.outputAsset).map((job: Row) => ({ ...job, project, outputType: "最终成片" })),
]));
const topicCardOutput = computed(() =>
  (selectedTopicCard.value?.videoRenderJobs || []).find((job: Row) => job.outputAsset)?.outputAsset,
);
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
  TOPIC_CARD_RECOMMENDED: "待确认", TOPIC_CARD_APPROVED: "已确认", TOPIC_CARD_ARCHIVED: "已归档",
  FACTORY_SCRIPT_READY: "脚本已生成", FACTORY_GENERATING: "生成中", READY_TO_EDIT: "可合成",
  EDITING: "合成中", VIDEO_REVIEW: "成片待审", PLATFORM_PACKAGING: "已通过",
  OPEN: "待补素材", GENERATING: "生成中", PENDING_REVIEW: "素材待审", DONE: "已完成",
  PASSED: "通过", APPROVED: "已通过", REVIEW_REQUIRED: "待人工审核", REJECTED: "已退回", RETURNED: "已退回",
};

function label(value?: string) {
  return statusLabels[String(value || "")] || String(value || "未记录");
}

function tagType(value?: string) {
  if (["HEALTHY", "SUCCEEDED", "DONE", "PASSED", "APPROVED", "PLATFORM_PACKAGING", "TOPIC_CARD_APPROVED"].includes(String(value))) return "success";
  if (["FAILED", "ERROR", "REJECTED", "RETURNED"].includes(String(value))) return "danger";
  if (["PENDING", "RUNNING", "RETRY", "CONFIGURED", "PENDING_REVIEW", "REVIEW_REQUIRED", "VIDEO_REVIEW", "TOPIC_CARD_RECOMMENDED"].includes(String(value))) return "warning";
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
    const platformQuery = props.platformScope ? `?platform=${props.platformScope}` : "";
    const referenceQuery = props.platformScope ? `?platform=${props.platformScope}&take=20` : "?take=20";
    const [cardRows, projectRows, providerRows, modelRows, routeRows, douyinKeywords, tiktokKeywords, referenceRows, workspace] = await Promise.all([
      api<Row[]>(`/api/v1/video-factory/topic-cards${platformQuery}`),
      api<Row[]>(`/api/v1/video-factory/projects${platformQuery}`),
      api<Row[]>("/api/v1/video-factory/providers"),
      api<Row[]>("/api/v1/video-factory/models"),
      api<Row[]>("/api/v1/video-factory/routing"),
      api<Row[]>("/api/v1/brand-data/smart-keywords/active?platform=DOUYIN&consumer=SMART_VIDEO"),
      props.platformScope === "DOUYIN"
        ? Promise.resolve([] as Row[])
        : api<Row[]>("/api/v1/brand-data/smart-keywords/active?platform=TIKTOK&consumer=SMART_VIDEO"),
      api<Row[]>(`/api/v1/brand-data/external-videos${referenceQuery}`),
      api<Row>("/api/v1/admin/workspace"),
    ]);
    topicCards.value = cardRows;
    projects.value = projectRows;
    providers.value = providerRows;
    models.value = modelRows;
    routing.value = routeRows;
    opportunityKeywords.value = [...douyinKeywords.slice(0, 5), ...tiktokKeywords.slice(0, 5)];
    opportunityReferences.value = referenceRows;
    employees.value = workspace.employees || [];
    for (const platform of ["DOUYIN", "TIKTOK"] as const) {
      routeForm[platform] = routeRows.find((item) => item.platform === platform)?.primaryModelId || "";
    }
  });
}

const recipeOptions = [
  { value: "PAIN_SOLVE", label: "痛点解决型" },
  { value: "GIFT_EMOTION", label: "送礼情感型" },
  { value: "CONTRARIAN", label: "反常识型" },
  { value: "FAQ", label: "问答型" },
  { value: "REVIEW", label: "测评型" },
  { value: "COMPARISON", label: "对比型" },
  { value: "UGC", label: "真人口播型" },
  { value: "VISUAL_AD", label: "纯视觉广告型" },
];

function recipeLabel(value?: string) {
  return recipeOptions.find((item) => item.value === value)?.label || value || "未选择";
}

function topicSelection(rows: Row[]) {
  if (rows.length > 3) {
    topicTable.value?.toggleRowSelection?.(rows[rows.length - 1], false);
    selectedTopicCards.value = rows.slice(0, 3);
    ElMessage.warning("最多对比3张选题卡");
    return;
  }
  selectedTopicCards.value = rows;
}

async function openTopicCard(id: string) {
  selectedTopicCard.value = await api<Row>(`/api/v1/video-factory/topic-cards/${id}`);
  topicCardPreviewUrl.value = "";
  topicCardPreviewError.value = "";
  if (topicCardOutput.value?.id) {
    try {
      const result = await api<Row>(`/api/v1/video-factory/outputs/${topicCardOutput.value.id}/url`);
      topicCardPreviewUrl.value = result.url || "";
    } catch (error) {
      topicCardPreviewError.value = error instanceof Error ? error.message : "成片地址暂时不可用";
    }
  }
  const card = selectedTopicCard.value.topicCard || {};
  Object.assign(topicCardForm, {
    audience: card.audience || "",
    pain: card.pain || "",
    scene: card.scene || "",
    objective: card.objective || "",
    mainKeyword: card.mainKeyword || "",
    auxiliaryKeywords: card.auxiliaryKeywords || [],
    hookCandidates: card.hookCandidates || [],
    primaryRecipe: card.primaryRecipe || "PAIN_SOLVE",
    backupRecipe: card.backupRecipe || "UGC",
  });
  topicCardEdit.value = false;
  topicCardDrawer.value = true;
}

async function saveTopicCard() {
  if (!selectedTopicCard.value) return;
  await run(async () => {
    selectedTopicCard.value = await patch<Row>(
      `/api/v1/video-factory/topic-cards/${selectedTopicCard.value!.id}`,
      topicCardForm,
    );
    topicCardEdit.value = false;
    await reload();
  }, "选题卡已保存");
}

function openApproval(row: Row, executionMode: "SCRIPT_ONLY" | "FULL_VIDEO") {
  selectedTopicCard.value = row;
  Object.assign(approvalForm, {
    executionMode,
    ownerId: row.topicCard?.ownerEmployeeId || row.assignedEmployeeId || "",
    reviewerId: row.topicCard?.reviewerEmployeeId || "",
    requestedModelId: "",
    allowExternalGeneration: executionMode === "FULL_VIDEO",
    allowFallback: true,
  });
  approvalDialog.value = true;
}

async function approveTopicCard() {
  if (!selectedTopicCard.value) return;
  if (!approvalForm.ownerId || !approvalForm.reviewerId) return ElMessage.warning("请选择负责人和审核人");
  await run(async () => {
    await post(`/api/v1/video-factory/topic-cards/${selectedTopicCard.value!.id}/approve`, {
      ...approvalForm,
      factoryModule: factoryModule.value,
    });
    approvalDialog.value = false;
    topicCardDrawer.value = false;
    await reload();
  }, approvalForm.executionMode === "SCRIPT_ONLY" ? "脚本任务已进入AI任务中心" : "完整视频任务已进入AI任务中心");
}

async function generateDailyTopicCards() {
  await run(async () => {
    await post("/api/v1/video-factory/topic-cards/generate-daily", {
      ...(props.platformScope ? { platform: props.platformScope } : {}),
      factoryModule: factoryModule.value,
    });
    await reload();
  }, props.platformScope === "DOUYIN" ? "今日抖音选题卡任务已创建" : "抖音和TikTok选题卡任务已创建");
}

async function rematchTopicCard(row: Row) {
  await run(async () => {
    await post(`/api/v1/video-factory/topic-cards/${row.id}/rematch-assets`, {});
    await reload();
    if (selectedTopicCard.value?.id === row.id) await openTopicCard(row.id);
  }, "已按当前素材库重新匹配");
}

async function archiveTopicCard(row: Row) {
  await run(async () => {
    await post(`/api/v1/video-factory/topic-cards/${row.id}/archive`, {});
    topicCardDrawer.value = false;
    await reload();
  }, "选题卡已归档");
}

function resetCreate() {
  Object.assign(createForm, {
    platform: props.platformScope || "DOUYIN", productModel: "", topic: "", audience: "", objective: "内容种草与商品点击",
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
  return taskModels.value.filter((model) => model.capabilities?.includes(capability));
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
        factoryModule: factoryModule.value,
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
        factoryModule: factoryModule.value,
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
    selectedOutput.value = outputs.value.find((item: Row) => item.outputAsset?.id === assetId)
      || { outputAsset: { id: assetId } };
    outputPreviewUrl.value = "";
    outputPreviewDialog.value = true;
    const result = await api<Row>(`/api/v1/video-factory/outputs/${assetId}/url`);
    outputPreviewUrl.value = result.url;
  });
}

function recreateFromOutput(row?: Row) {
  const project = row?.project;
  resetCreate();
  if (project) {
    createForm.platform = project.platform || "DOUYIN";
    createForm.productModel = project.productModel || "";
    createForm.topic = project.topic || row?.outputAsset?.displayName || "";
    createForm.audience = project.audience || "";
    createForm.objective = project.objective || "基于现有成片调整参数后重新创作";
    createForm.keywordIds = (project.keywordBindings || []).map((item: Row) => item.keywordId).filter(Boolean);
  }
  outputPreviewDialog.value = false;
  createDialog.value = true;
}

async function reviewOutput(assetId: string, approved: boolean) {
  await run(async () => {
    await post(`/api/v1/video-factory/outputs/${assetId}/review`, { approved });
    await reload();
    if (selectedTopicCard.value) await openTopicCard(selectedTopicCard.value.id);
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
        <span>{{ heroKicker }}</span>
        <h3>{{ heroTitle }}</h3>
        <p>{{ heroDescription }}</p>
      </div>
      <div>
        <el-button :icon="Refresh" @click="reload">刷新</el-button>
        <el-button @click="emit('open-system-config')">前往系统配置</el-button>
        <el-button @click="openCreate">提交视频任务</el-button>
        <el-button type="primary" :icon="Plus" @click="generateDailyTopicCards">{{ isDouyinViralSystem ? '生成今日抖音选题卡' : '生成今日选题卡' }}</el-button>
      </div>
    </div>

    <div v-if="isDouyinViralSystem" class="viral-pipeline" aria-label="抖音爆款视频生产流程">
      <article><b>01</b><span>爆款与关键词</span><small>发现抖音内容机会</small></article>
      <i>→</i>
      <article><b>02</b><span>结构拆解</span><small>提取Hook、节奏与CTA</small></article>
      <i>→</i>
      <article><b>03</b><span>选题卡确认</span><small>人工确认产品与人群</small></article>
      <i>→</i>
      <article><b>04</b><span>智能模型制作</span><small>真实素材优先 · Seedance主生成 · Kling动作增强</small></article>
      <i>→</i>
      <article><b>05</b><span>审核与复盘</span><small>成片审核、发布和回流</small></article>
    </div>

    <div class="factory-summary">
      <article><span>待确认选题</span><strong>{{ topicCards.filter((item: Row) => item.productionStage === 'TOPIC_CARD_RECOMMENDED').length }}</strong><small>确认前不会创建生产任务</small></article>
      <article><span>视频项目</span><strong>{{ projects.length }}</strong><small>脚本、分镜、成片统一追踪</small></article>
      <article><span>执行中</span><strong>{{ runningCount }}</strong><small>生成与渲染异步处理</small></article>
      <article><span>待审核成片</span><strong>{{ outputs.filter((item: Row) => item.outputAsset?.reviewStatus === 'PENDING').length }}</strong><small>审核通过前不可发布</small></article>
    </div>

    <el-segmented v-model="view" :options="[
      { label: `视频选题卡 ${topicCards.length}`, value: 'topicCards' },
      { label: `视频项目 ${projects.length}`, value: 'projects' },
      { label: '分镜与素材', value: 'shots' },
      { label: `生成任务 ${runningCount}`, value: 'jobs' },
      { label: `成片库 ${outputs.length}`, value: 'outputs' },
      { label: '质检审核', value: 'quality' },
    ]" />

    <div v-if="view === 'topicCards'" class="data-card topic-card-panel">
      <div class="topic-filters">
        <el-select v-if="!props.platformScope" v-model="topicFilters.platform" clearable placeholder="全部平台"><el-option label="抖音" value="DOUYIN" /><el-option label="TikTok" value="TIKTOK" /></el-select>
        <el-tag v-else type="danger" effect="plain">抖音</el-tag>
        <el-select v-model="topicFilters.productModel" clearable filterable placeholder="全部产品"><el-option v-for="product in props.products" :key="product.id" :label="`${product.modelCode} · ${product.name}`" :value="product.modelCode" /></el-select>
        <el-select v-model="topicFilters.sourceType" clearable placeholder="全部来源"><el-option label="智能关键词" value="SMART_KEYWORD" /><el-option label="爆款研究" value="VIRAL_RESEARCH" /><el-option label="FAQ" value="FAQ" /></el-select>
        <el-select v-model="topicFilters.status" clearable placeholder="全部状态"><el-option label="待确认" value="TOPIC_CARD_RECOMMENDED" /><el-option label="已确认" value="TOPIC_CARD_APPROVED" /></el-select>
        <label>最低分 <el-input-number v-model="topicFilters.minScore" :min="0" :max="100" :step="10" controls-position="right" /></label>
        <label>素材覆盖 <el-input-number v-model="topicFilters.minCoverage" :min="0" :max="100" :step="10" controls-position="right" /></label>
      </div>
      <div v-if="selectedTopicCards.length > 1" class="topic-compare">
        <article v-for="row in selectedTopicCards" :key="row.id">
          <strong>{{ row.topic }}</strong>
          <span>{{ row.score }}分 · 素材{{ row.topicCard?.materialCoverage?.coveragePercent || 0 }}%</span>
          <small>{{ row.topicCard?.audience }}｜{{ row.topicCard?.pain }}</small>
        </article>
      </div>
      <div class="card-title"><h4>可执行选题</h4><small>{{ isDouyinViralSystem ? '每日生成10张抖音选题卡；管理员确认前不创建脚本或成片任务' : '每天抖音10张、TikTok 10张；管理员确认前不创建脚本或成片任务' }}</small></div>
      <el-table ref="topicTable" :data="filteredTopicCards" stripe height="510" @selection-change="topicSelection">
        <el-table-column type="selection" width="46" />
        <el-table-column label="选题卡" min-width="270"><template #default="scope"><strong>{{ scope.row.topic }}</strong><small>{{ scope.row.productionNo }} · {{ scope.row.productModel || '缺产品事实' }}</small></template></el-table-column>
        <el-table-column label="平台/来源" width="135"><template #default="scope">{{ scope.row.topicCard?.platform === 'TIKTOK' ? 'TikTok' : '抖音' }}<small>{{ scope.row.topicCard?.sourceTypes?.join('、') || '系统分析' }}</small></template></el-table-column>
        <el-table-column label="人群与痛点" min-width="220"><template #default="scope">{{ scope.row.topicCard?.audience }}<small>{{ scope.row.topicCard?.pain }}</small></template></el-table-column>
        <el-table-column label="配方" width="125"><template #default="scope">{{ recipeLabel(scope.row.topicCard?.primaryRecipe) }}<small>备选：{{ recipeLabel(scope.row.topicCard?.backupRecipe) }}</small></template></el-table-column>
        <el-table-column label="机会分" width="90"><template #default="scope"><strong>{{ scope.row.score }}</strong></template></el-table-column>
        <el-table-column label="素材覆盖" width="105"><template #default="scope">{{ scope.row.topicCard?.materialCoverage?.coveragePercent || 0 }}%<small>{{ scope.row.topicCard?.materialCoverage?.coveredShots || 0 }}/{{ scope.row.topicCard?.materialCoverage?.totalShots || 0 }}镜头</small></template></el-table-column>
        <el-table-column label="状态" width="105"><template #default="scope"><el-tag :type="tagType(scope.row.productionStage)">{{ label(scope.row.productionStage) }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="255" fixed="right"><template #default="scope"><el-button link type="primary" @click="openTopicCard(scope.row.id)">详情</el-button><template v-if="scope.row.productionStage === 'TOPIC_CARD_RECOMMENDED'"><el-button link @click="openApproval(scope.row, 'SCRIPT_ONLY')">仅生成脚本</el-button><el-button link type="success" @click="openApproval(scope.row, 'FULL_VIDEO')">生成完整视频</el-button></template></template></el-table-column>
      </el-table>
    </div>

    <div v-else-if="view === 'projects'" class="data-card">
      <el-table :data="projects" stripe height="570">
        <el-table-column label="项目" min-width="260"><template #default="scope"><strong>{{ scope.row.topic }}</strong><small>{{ scope.row.productionNo }} · {{ scope.row.productModel || '通用产品' }}</small></template></el-table-column>
        <el-table-column label="选题卡/AI任务" min-width="165"><template #default="scope">{{ scope.row.topicCard?.cardNo || '人工创建' }}<small>{{ scope.row.aiTaskOutputs?.[0]?.aiTask?.taskNo || '未关联任务' }}</small></template></el-table-column>
        <el-table-column label="平台" width="105"><template #default="scope">{{ scope.row.targetPlatforms?.join('、') }}</template></el-table-column>
        <el-table-column label="负责人/素材" min-width="155"><template #default="scope">{{ scope.row.assignedEmployee?.name || scope.row.owner || '未分配' }}<small>覆盖 {{ scope.row.topicCard?.materialCoverage?.coveragePercent || 0 }}%</small></template></el-table-column>
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
        <el-table-column label="编码/帧率" width="135"><template #default="scope">{{ scope.row.outputAsset.sourceSnapshot?.metadata?.codec || '—' }}<small>{{ scope.row.outputAsset.sourceSnapshot?.metadata?.frameRate || '—' }}</small></template></el-table-column>
        <el-table-column label="素材来源" min-width="150"><template #default="scope">{{ scope.row.outputAsset.sourceSnapshot?.metadata?.source || scope.row.renderer || '—' }}<small>{{ scope.row.outputAsset.sourceSnapshot?.metadata?.usedAssetIds?.length || 0 }}项素材</small></template></el-table-column>
        <el-table-column label="操作" width="200"><template #default="scope"><el-button link type="primary" @click="openOutput(scope.row.outputAsset.id)">预览</el-button><el-button v-if="scope.row.outputAsset.reviewStatus === 'PENDING'" link type="success" @click="reviewOutput(scope.row.outputAsset.id, true)">通过</el-button><el-button v-if="scope.row.outputAsset.reviewStatus === 'PENDING'" link type="danger" @click="reviewOutput(scope.row.outputAsset.id, false)">退回</el-button></template></el-table-column>
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

    <el-drawer v-model="topicCardDrawer" title="视频选题卡" size="70%">
      <template v-if="selectedTopicCard">
        <div class="detail-head">
          <div><strong>{{ selectedTopicCard.topic }}</strong><span>{{ selectedTopicCard.productionNo }} · {{ selectedTopicCard.productModel || '缺少产品事实' }}</span></div>
          <el-tag :type="tagType(selectedTopicCard.productionStage)">{{ label(selectedTopicCard.productionStage) }}</el-tag>
        </div>
        <div class="topic-card-kpis">
          <article><span>机会分</span><strong>{{ selectedTopicCard.score }}</strong></article>
          <article><span>素材覆盖</span><strong>{{ selectedTopicCard.topicCard?.materialCoverage?.coveragePercent || 0 }}%</strong></article>
          <article><span>本地预计</span><strong>{{ selectedTopicCard.topicCard?.estimatedCosts?.local || 0 }} {{ selectedTopicCard.topicCard?.estimatedCosts?.currency || 'CNY' }}</strong></article>
          <article><span>外部预计</span><strong>{{ selectedTopicCard.topicCard?.estimatedCosts?.external || 0 }} {{ selectedTopicCard.topicCard?.estimatedCosts?.currency || 'CNY' }}</strong></article>
        </div>
        <section v-if="topicCardOutput" class="topic-card-preview">
          <div class="topic-card-preview-head">
            <div><strong>成片预览</strong><span>{{ topicCardOutput.displayName || topicCardOutput.fileName }}</span></div>
            <el-tag :type="tagType(topicCardOutput.reviewStatus)">{{ label(topicCardOutput.reviewStatus) }}</el-tag>
          </div>
          <video v-if="topicCardPreviewUrl" :src="topicCardPreviewUrl" controls preload="metadata" playsinline />
          <el-alert v-else :title="topicCardPreviewError || '正在获取成片预览地址'" type="warning" :closable="false" />
          <div class="topic-card-preview-foot">
            <span>{{ topicCardOutput.width || '—' }}×{{ topicCardOutput.height || '—' }} · {{ Number(topicCardOutput.durationSeconds || 0).toFixed(1) }}秒</span>
            <div>
              <el-button @click="openOutput(topicCardOutput.id)">预览成片</el-button>
              <el-button v-if="topicCardOutput.reviewStatus === 'PENDING'" type="success" @click="reviewOutput(topicCardOutput.id, true)">审核通过</el-button>
              <el-button v-if="topicCardOutput.reviewStatus === 'PENDING'" type="danger" plain @click="reviewOutput(topicCardOutput.id, false)">退回修改</el-button>
            </div>
          </div>
        </section>
        <el-alert
          v-else-if="['VIDEO_REVIEW', 'PLATFORM_PACKAGING'].includes(selectedTopicCard.productionStage)"
          title="成片正在登记，请刷新后查看预览"
          type="info"
          :closable="false"
        />
        <el-form v-if="topicCardEdit" label-position="top" class="form-grid">
          <el-form-item label="目标人群"><el-input v-model="topicCardForm.audience" /></el-form-item>
          <el-form-item label="核心痛点"><el-input v-model="topicCardForm.pain" /></el-form-item>
          <el-form-item label="场景"><el-input v-model="topicCardForm.scene" /></el-form-item>
          <el-form-item label="内容目标"><el-input v-model="topicCardForm.objective" /></el-form-item>
          <el-form-item label="主关键词"><el-input v-model="topicCardForm.mainKeyword" /></el-form-item>
          <el-form-item label="辅助词"><el-select v-model="topicCardForm.auxiliaryKeywords" multiple allow-create filterable /></el-form-item>
          <el-form-item label="主配方"><el-select v-model="topicCardForm.primaryRecipe"><el-option v-for="item in recipeOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
          <el-form-item label="备用配方"><el-select v-model="topicCardForm.backupRecipe"><el-option v-for="item in recipeOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
          <el-form-item label="Hook候选" class="full"><el-select v-model="topicCardForm.hookCandidates" multiple allow-create filterable /></el-form-item>
        </el-form>
        <template v-else>
          <div class="topic-detail-grid">
            <article><span>人群</span><strong>{{ selectedTopicCard.topicCard?.audience }}</strong></article>
            <article><span>痛点</span><strong>{{ selectedTopicCard.topicCard?.pain }}</strong></article>
            <article><span>场景</span><strong>{{ selectedTopicCard.topicCard?.scene }}</strong></article>
            <article><span>目标</span><strong>{{ selectedTopicCard.topicCard?.objective }}</strong></article>
          </div>
          <h4>推荐依据</h4>
          <p class="detail-copy">{{ selectedTopicCard.topicCard?.rationale }}</p>
          <h4>3个Hook候选</h4>
          <ol class="hook-list"><li v-for="hook in selectedTopicCard.topicCard?.hookCandidates || []" :key="hook">{{ hook }}</li></ol>
          <h4>爆款可复用结构</h4>
          <p class="detail-copy">{{ selectedTopicCard.topicCard?.reusableViralStructure?.hookPattern }} · {{ selectedTopicCard.topicCard?.reusableViralStructure?.pace }}</p>
          <div class="structure-flow"><span v-for="item in selectedTopicCard.topicCard?.reusableViralStructure?.shotStructure || []" :key="item">{{ item }}</span></div>
          <h4>素材匹配与缺口</h4>
          <el-table :data="selectedTopicCard.topicCard?.materialCoverage?.missingShots || []" stripe>
            <el-table-column prop="moduleType" label="模块" width="110" />
            <el-table-column prop="description" label="缺失镜头" min-width="220" />
            <el-table-column prop="reason" label="原因" min-width="220" />
            <el-table-column prop="alternative" label="优先替代方案" min-width="260" />
          </el-table>
        </template>
        <div class="detail-actions">
          <el-button v-if="selectedTopicCard.productionStage === 'TOPIC_CARD_RECOMMENDED'" type="danger" plain @click="archiveTopicCard(selectedTopicCard)">归档</el-button>
          <el-button @click="rematchTopicCard(selectedTopicCard)">重新匹配素材</el-button>
          <el-button v-if="topicCardEdit" type="primary" @click="saveTopicCard">保存修改</el-button>
          <el-button v-else-if="selectedTopicCard.productionStage === 'TOPIC_CARD_RECOMMENDED'" @click="topicCardEdit = true">编辑选题</el-button>
          <el-button v-if="selectedTopicCard.productionStage === 'TOPIC_CARD_RECOMMENDED'" @click="openApproval(selectedTopicCard, 'SCRIPT_ONLY')">仅生成脚本</el-button>
          <el-button v-if="selectedTopicCard.productionStage === 'TOPIC_CARD_RECOMMENDED'" type="primary" @click="openApproval(selectedTopicCard, 'FULL_VIDEO')">生成完整视频</el-button>
        </div>
      </template>
    </el-drawer>

    <el-dialog v-model="approvalDialog" title="确认选题并创建AI任务" width="620px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="执行方式"><el-radio-group v-model="approvalForm.executionMode"><el-radio-button value="SCRIPT_ONLY">仅生成脚本</el-radio-button><el-radio-button value="FULL_VIDEO">生成完整视频</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="负责人" required><el-select v-model="approvalForm.ownerId" filterable><el-option v-for="employee in employees" :key="employee.id" :label="`${employee.name} · ${employee.role}`" :value="employee.id" /></el-select></el-form-item>
        <el-form-item label="审核人" required><el-select v-model="approvalForm.reviewerId" filterable><el-option v-for="employee in employees" :key="employee.id" :label="`${employee.name} · ${employee.role}`" :value="employee.id" /></el-select></el-form-item>
        <template v-if="approvalForm.executionMode === 'FULL_VIDEO'">
          <el-form-item label="外部补镜头"><el-switch v-model="approvalForm.allowExternalGeneration" active-text="本地素材不足时允许使用Seedance或Kling" /></el-form-item>
          <el-form-item v-if="approvalForm.allowExternalGeneration" label="生成模型"><el-select v-model="approvalForm.requestedModelId" clearable placeholder="智能推荐：Seedance主生成、Kling动作增强"><el-option v-for="item in taskModels" :key="item.id" :label="`${item.provider.displayName} · ${item.displayName}`" :value="item.id" /></el-select></el-form-item>
          <el-form-item v-if="approvalForm.allowExternalGeneration" label="失败策略"><el-switch v-model="approvalForm.allowFallback" active-text="当前模型失败时按专用路由切换" /></el-form-item>
        </template>
        <el-alert type="info" :closable="false" title="确认后进入AI任务中心；先用已审核真实素材和本地工具，只有明确允许时才调用外部模型。" />
      </el-form>
      <template #footer><el-button @click="approvalDialog = false">取消</el-button><el-button type="primary" @click="approveTopicCard">确认并创建任务</el-button></template>
    </el-dialog>

    <el-dialog v-model="outputPreviewDialog" title="成片预览" width="min(760px, 92vw)" destroy-on-close>
      <div v-if="selectedOutput" class="output-preview-dialog">
        <video v-if="outputPreviewUrl" :src="outputPreviewUrl" controls playsinline preload="metadata" />
        <el-empty v-else description="正在获取成片预览" :image-size="72" />
        <div class="output-preview-meta">
          <div>
            <strong>{{ selectedOutput.outputAsset?.displayName || selectedOutput.outputAsset?.fileName || '视频成片' }}</strong>
            <span>{{ selectedOutput.project?.topic || '视频工厂成片' }}</span>
          </div>
          <el-tag :type="tagType(selectedOutput.outputAsset?.reviewStatus)">{{ label(selectedOutput.outputAsset?.reviewStatus) }}</el-tag>
        </div>
      </div>
      <template #footer>
        <el-button v-if="outputPreviewUrl" tag="a" :href="outputPreviewUrl" target="_blank">下载成片</el-button>
        <el-button type="primary" @click="recreateFromOutput(selectedOutput)">调整参数重新创作</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="createDialog" :title="isDouyinViralSystem ? '提交抖音视频任务' : '提交视频任务'" width="820px" destroy-on-close>
      <el-form label-position="top" class="form-grid">
        <el-form-item label="目标平台"><el-select v-model="createForm.platform" :disabled="Boolean(props.platformScope)"><el-option label="抖音" value="DOUYIN" /><el-option label="TikTok" value="TIKTOK" /></el-select></el-form-item>
        <el-form-item label="产品型号"><el-select v-model="createForm.productModel" clearable filterable><el-option v-for="item in props.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.modelCode" /></el-select></el-form-item>
        <el-form-item label="任务模式" class="full"><el-radio-group v-model="createForm.executionMode"><el-radio-button value="SCRIPT_ONLY">仅生成脚本</el-radio-button><el-radio-button value="FULL_VIDEO">生成完整视频</el-radio-button></el-radio-group><small class="form-tip">脚本模式输出1套最终脚本与逐镜头计划；完整视频优先复用已审核素材，再按需调用Seedance或Kling补镜头。</small></el-form-item>
        <el-form-item label="主题/主关键词" class="full" required><el-input v-model="createForm.topic" maxlength="150" /></el-form-item>
        <el-form-item label="目标人群"><el-input v-model="createForm.audience" /></el-form-item>
        <el-form-item label="内容目标"><el-input v-model="createForm.objective" /></el-form-item>
        <el-form-item label="生成模型" class="full"><el-select v-model="createForm.requestedModelId" clearable placeholder="Codex智能推荐（默认）" @change="onCreateModelChange"><el-option v-for="item in taskModels" :key="item.id" :label="`${item.provider.displayName} · ${item.displayName}`" :value="item.id" /></el-select><small class="form-tip">默认使用Codex本地工具；指定模型表示允许该任务调用外部视觉能力。</small></el-form-item>
        <el-form-item label="外部视觉能力" class="full"><el-switch v-model="createForm.allowExternalGeneration" active-text="本地素材不足时允许调用已配置模型" /></el-form-item>
        <el-form-item label="失败策略" class="full"><el-switch v-model="createForm.allowFallback" active-text="允许失败后自动切换模型" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="createDialog = false">取消</el-button><el-button type="primary" @click="createAndGenerate">{{ createForm.executionMode === 'SCRIPT_ONLY' ? '提交脚本任务' : '提交完整视频任务' }}</el-button></template>
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
            <el-tag v-if="candidate.selected" type="success">主执行包</el-tag>
            <strong>{{ candidate.title || candidate.topic }}</strong>
            <p>{{ candidate.hook }}</p>
            <small>{{ recipeLabel(candidate.templateCode) }} · 评分 {{ candidate.score }} · 缺口 {{ candidate.missingAssets?.length || 0 }}</small>
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
.viral-pipeline { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr) auto) minmax(0, 1fr); align-items: center; gap: 10px; padding: 14px 16px; border: 1px solid #eadfe0; border-radius: 14px; background: linear-gradient(90deg, #fff, #fff7f5); }.viral-pipeline article { display: grid; grid-template-columns: auto 1fr; column-gap: 9px; align-items: center; }.viral-pipeline b { grid-row: 1 / 3; color: #b4232d; font-size: 20px; }.viral-pipeline span, .viral-pipeline small { display: block; }.viral-pipeline span { color: #202b3c; font-weight: 700; }.viral-pipeline small { margin-top: 2px; color: #8791a0; }.viral-pipeline i { color: #c8ced8; font-style: normal; }
.factory-summary { grid-template-columns: repeat(4, minmax(0, 1fr)); }.factory-summary article, .opportunity-grid article, .model-route article { padding: 17px 19px; border: 1px solid #e4e9f1; border-radius: 14px; background: #fff; }.factory-summary span, .factory-summary small { display: block; color: #7d8797; }.factory-summary strong { display: block; margin: 5px 0; color: #18263e; font-size: 27px; }
.opportunity-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }.opportunity-grid h4 { margin: 9px 0 5px; }.opportunity-grid p { min-height: 62px; color: #6f7a8c; line-height: 1.6; }.opportunity-grid .el-icon { color: #a2202b; font-size: 26px; }
.data-card { overflow: hidden; border: 1px solid #e4e9f1; border-radius: 14px; background: #fff; }.data-card strong, .data-card small { display: block; }.data-card small { margin-top: 3px; color: #8a94a5; }
.topic-card-panel { display: grid; gap: 0; }.topic-filters { display: grid; grid-template-columns: repeat(4, minmax(130px, 1fr)) auto auto; gap: 10px; align-items: center; padding: 14px 15px; border-bottom: 1px solid #edf0f5; }.topic-filters label { display: flex; align-items: center; gap: 7px; color: #667085; white-space: nowrap; }
.topic-compare { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 12px 15px; background: #f5f8fc; }.topic-compare article { padding: 12px; border: 1px solid #dfe7f1; border-radius: 10px; background: #fff; }.topic-compare strong, .topic-compare span, .topic-compare small { display: block; }.topic-compare span { margin: 7px 0; color: #a2202b; }
.topic-card-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px 0; }.topic-card-kpis article { padding: 13px; border: 1px solid #e5eaf2; border-radius: 10px; }.topic-card-kpis span { display: block; color: #7c8797; }.topic-card-kpis strong { display: block; margin-top: 5px; font-size: 20px; }
.topic-card-preview { display: grid; gap: 12px; margin: 16px 0; padding: 14px; border: 1px solid #dce4ef; border-radius: 14px; background: #f7f9fc; }.topic-card-preview-head, .topic-card-preview-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.topic-card-preview-head strong, .topic-card-preview-head span { display: block; }.topic-card-preview-head span, .topic-card-preview-foot > span { margin-top: 3px; color: #7c8797; }.topic-card-preview video { width: min(100%, 420px); max-height: 560px; margin: 0 auto; border-radius: 12px; background: #0d1117; }.topic-card-preview-foot > div { display: flex; gap: 8px; }
.output-preview-dialog { display: grid; gap: 14px; }.output-preview-dialog video { width: min(100%, 420px); max-height: 620px; margin: 0 auto; border-radius: 14px; background: #0d1117; }.output-preview-meta { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px; border-radius: 12px; background: #f5f7fb; }.output-preview-meta strong, .output-preview-meta span { display: block; }.output-preview-meta span { margin-top: 4px; color: #7c8797; }
.topic-detail-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }.topic-detail-grid article { padding: 13px; border-radius: 10px; background: #f5f7fb; }.topic-detail-grid span, .topic-detail-grid strong { display: block; }.topic-detail-grid span { margin-bottom: 5px; color: #7c8797; }.detail-copy { color: #536176; line-height: 1.7; }.hook-list { display: grid; gap: 8px; padding-left: 22px; color: #344054; }.structure-flow { display: flex; flex-wrap: wrap; gap: 8px; }.structure-flow span { padding: 7px 10px; border-radius: 999px; color: #23436d; background: #eaf1fb; }
.model-route { grid-template-columns: 1fr 1fr; }.model-route article { display: grid; grid-template-columns: 150px 1fr auto; align-items: center; gap: 10px; }.two-cards { grid-template-columns: .9fr 1.1fr; }.card-title { display: flex; align-items: center; justify-content: space-between; padding: 12px 15px; border-bottom: 1px solid #edf0f5; }.card-title h4 { margin: 0; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }.form-grid .full { grid-column: 1 / -1; }.form-tip { display: block; margin-top: 6px; color: #8a94a5; }
.detail-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 14px; border-bottom: 1px solid #edf0f5; }.detail-head strong, .detail-head span { display: block; }.detail-head strong { font-size: 22px; }.detail-head span { margin-top: 4px; color: #7c8797; }
.candidate-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }.candidate-grid article { padding: 14px; border: 1px solid #e3e8f0; border-radius: 12px; }.candidate-grid strong { display: block; margin: 8px 0; }.candidate-grid p { min-height: 48px; color: #657187; }.candidate-grid small { display: block; margin-bottom: 9px; color: #8a94a5; }.detail-actions { display: flex; justify-content: flex-end; padding-top: 16px; }
@media (max-width: 1100px) { .factory-summary, .opportunity-grid, .candidate-grid, .topic-card-kpis, .topic-detail-grid { grid-template-columns: 1fr 1fr; }.two-cards, .model-route, .topic-filters { grid-template-columns: 1fr 1fr; }.viral-pipeline { grid-template-columns: 1fr 1fr; }.viral-pipeline i { display: none; } }
</style>
