<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, post } from "../api";
import { filteredOverviewTasks } from "../ai-task-list";

type Row = Record<string, any>;
const emit = defineEmits<{ navigate: [key: string] }>();

const taskTypes = [
  ["VIDEO", "视频生成"],
  ["IMAGE", "图片生成"],
  ["ARTICLE", "软文生成"],
  ["STORE_ANALYSIS", "店铺分析"],
  ["COMPETITOR_ANALYSIS", "竞品分析"],
  ["LIVE_ANALYSIS", "直播分析"],
] as const;
const tabs = [
  ["overview", "总览"],
  ["pending", "待处理"],
  ["running", "处理中"],
  ["review", "待审核"],
  ["completed", "已完成"],
  ["failed", "失败重试"],
] as const;
const runningStatuses = ["CLAIMED", "RUNNING", "QUALITY_CHECK", "UPLOADING", "RETRY"];
const pendingStatuses = ["PENDING", "WAITING_CONFIRMATION", "WAITING_INPUT", "RETURNED"];

const activeTab = ref("overview");
const loading = ref(false);
const overview = ref<Row>({});
const tasks = ref<Row[]>([]);
const policies = ref<Row[]>([]);
const runners = ref<Row[]>([]);
const employees = ref<Row[]>([]);
const products = ref<Row[]>([]);
const detail = ref<Row>();
const detailVisible = ref(false);
const outputPreview = ref<Row>();
const outputPreviewUrl = ref("");
const outputPreviewVisible = ref(false);
const createVisible = ref(false);
const runnerVisible = ref(false);
const runnerToken = ref("");
const reviewVisible = ref(false);
const reviseVisible = ref(false);
const revising = ref(false);
const reviewAction = ref<"APPROVE" | "RETURN">("APPROVE");
const reviewNote = ref("");
const filters = reactive({ type: "", platform: "", keyword: "" });
const form = reactive<Row>({
  type: "VIDEO",
  title: "",
  platform: "DOUYIN",
  productId: "",
  productModel: "",
  audience: "",
  painPoint: "",
  keyword: "",
  recommendedScene: "",
  hook: "",
  instructions: "",
  ownerEmployeeId: "",
  reviewerEmployeeId: "",
  estimatedCost: 0,
  budgetLimit: 0,
  autoExecute: false,
  executionMode: "FULL_VIDEO",
  allowExternalGeneration: false,
});
const reviseForm = reactive<Row>({
  title: "",
  platform: "",
  productId: "",
  productModel: "",
  audience: "",
  painPoint: "",
  keyword: "",
  recommendedScene: "",
  hook: "",
  instructions: "",
  ownerEmployeeId: "",
  reviewerEmployeeId: "",
  estimatedCost: 0,
  budgetLimit: 0,
  autoExecute: true,
  executionMode: "FULL_VIDEO",
  allowExternalGeneration: false,
});
const runnerForm = reactive<Row>({
  nodeCode: "windows-codex-01",
  displayName: "Windows Codex执行器",
  capabilities: taskTypes.map(([value]) => value),
});
const wecom = reactive<Row>({
  configured: false,
  corpId: "",
  agentId: "",
  appSecret: "",
  secretConfigured: false,
  message: "企微个人通知未配置",
});

const visibleTasks = computed(() => {
  const selected = filteredOverviewTasks(tasks.value, filters);
  if (activeTab.value === "pending") return selected.filter((task) => pendingStatuses.includes(task.status));
  if (activeTab.value === "running") return selected.filter((task) => runningStatuses.includes(task.status));
  if (activeTab.value === "review") return selected.filter((task) => task.status === "PENDING_REVIEW");
  if (activeTab.value === "completed") return selected.filter((task) => task.status === "COMPLETED");
  if (activeTab.value === "failed") return selected.filter((task) => ["FAILED", "CANCELLED"].includes(task.status));
  return selected;
});

const typeCountRows = computed(() => {
  const map = new Map((overview.value.typeCounts || []).map((item: Row) => [item.type, item._count?._all || 0]));
  return taskTypes.map(([type, label]) => ({
    type,
    label,
    count: map.get(type) || 0,
    cost: tasks.value.filter((task) => task.type === type).reduce((sum, task) => sum + Number(task.actualCost || 0), 0),
  }));
});

function typeLabel(value: string) {
  return taskTypes.find(([type]) => type === value)?.[1] || value;
}

function taskTypeLabel(task: Row) {
  const sourceType = String(task?.sourceType || task?.input?.sourceType || "").toUpperCase();
  const executionMode = String(task?.input?.executionMode || "").toUpperCase();
  if (task?.type === "IMAGE" && (sourceType === "IMAGE_PROJECT" || executionMode === "IMAGE_POST")) {
    return "图文生成";
  }
  return typeLabel(task?.type);
}

function statusLabel(value: string) {
  const labels: Row = {
    PENDING: "待处理", WAITING_CONFIRMATION: "待确认", CLAIMED: "已领取", RUNNING: "处理中",
    WAITING_INPUT: "需补充资料", QUALITY_CHECK: "自动质检", UPLOADING: "上传中", PENDING_REVIEW: "待审核",
    RETURNED: "已退回", RETRY: "重试中", COMPLETED: "已完成", FAILED: "失败", CANCELLED: "已取消",
  };
  return labels[value] || value;
}

function statusType(value: string) {
  if (value === "COMPLETED") return "success";
  if (["FAILED", "CANCELLED"].includes(value)) return "danger";
  if (["WAITING_CONFIRMATION", "WAITING_INPUT", "RETURNED", "RETRY"].includes(value)) return "warning";
  return "info";
}

function platformLabel(value?: string) {
  const labels: Row = {
    DOUYIN: "抖音", TIKTOK: "TikTok", ALL: "全平台/经营分析",
    XIAOHONGSHU: "小红书", WECHAT: "视频号", AMAZON: "Amazon", SHOPIFY: "Shopify",
  };
  return value ? labels[value] || value : "未设置";
}

function attemptStatusLabel(value: string) {
  const labels: Row = {
    PENDING: "待执行", RUNNING: "执行中", SUCCEEDED: "执行成功",
    FAILED: "执行失败", CANCELLED: "已取消",
  };
  return labels[value] || value;
}

function hasSuccessfulAttempt(task?: Row) {
  return Boolean(task?.attempts?.some((attempt: Row) => attempt.status === "SUCCEEDED"));
}

function routedSkill(task?: Row) {
  if (task?.output?.execution?.skill) return task.output.execution.skill;
  if (task?.input?.taskRoute?.requiredSkill) return task.input.taskRoute.requiredSkill;
  if (!hasSuccessfulAttempt(task)) return "等待执行";
  if (task?.input?.factoryModule === "DOUYIN_VIRAL") return "saydian-douyin-viral-video-generator";
  return ({
    VIDEO: "video-editing-from-media-library",
    IMAGE: "imagegen",
    ARTICLE: "build-health-brand-trust-content",
  } as Row)[task?.type] || "Codex本地分析";
}

function skillVersion(task?: Row) {
  if (task?.output?.execution?.skillVersion) return task.output.execution.skillVersion;
  return hasSuccessfulAttempt(task) ? "历史执行记录" : "等待执行";
}

function executionStrategy(task?: Row) {
  if (task?.output?.execution?.strategy) return task.output.execution.strategy;
  return hasSuccessfulAttempt(task) ? "CODEX_SKILL" : "等待执行";
}

function missingInputText(task?: Row) {
  if (Array.isArray(task?.missingInputs) && task.missingInputs.length) return task.missingInputs.join("、");
  if (task?.status === "WAITING_INPUT") return task.progressMessage || "请查看补拍或资料任务";
  return "无";
}

function displayProgress(task?: Row) {
  const progress = Math.max(0, Math.min(100, Number(task?.progress || 0)));
  return task?.status === "WAITING_INPUT" ? Math.min(progress, 90) : progress;
}

function outputKindLabel(value: string) {
  const labels: Row = {
    VIDEO_MASTER: "视频成片", VIDEO_PROJECT: "视频项目", VIDEO_COVER: "视频封面",
    VIDEO_SCRIPT: "完整脚本", SCRIPT_CANDIDATES_JSON: "脚本方案", STORYBOARD_JSON: "分镜方案",
    IMAGE_MASTER: "图片成品", IMAGE: "图片成品", ARTICLE_OUTPUT: "软文成品",
    ARTICLE: "软文成品", QUALITY_REPORT: "质检报告", RESHOOT_BRIEF: "补拍清单",
    OPS_TASK: "关联员工任务",
  };
  return labels[value] || value;
}

function reviewStatusLabel(value: string) {
  const labels: Row = {
    PENDING: "待审核", APPROVED: "已通过", RETURNED: "已退回", REJECTED: "已驳回",
  };
  return labels[value] || value;
}

function channelLabel(value: string) {
  return value === "WECOM" ? "企业微信" : value === "IN_APP" ? "站内消息" : value;
}

function time(value?: string) {
  return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "未记录";
}

async function load() {
  loading.value = true;
  try {
    const [summary, taskRows, policyRows, runnerRows, ledger, wecomStatus, productRows] = await Promise.allSettled([
      api<Row>("/api/v1/ai-tasks/overview"),
      api<Row[]>("/api/v1/ai-tasks"),
      api<Row[]>("/api/v1/ai-tasks/policies"),
      api<Row[]>("/api/v1/ai-tasks/runners"),
      api<Row>("/api/v1/ledger"),
      api<Row>("/api/v1/ai-tasks/notifications/wecom"),
      api<Row[]>("/api/v1/brand-data/products"),
    ]);
    if (summary.status === "fulfilled") overview.value = summary.value;
    if (taskRows.status === "fulfilled") tasks.value = taskRows.value;
    if (policyRows.status === "fulfilled") policies.value = policyRows.value.map((row) => ({ ...row }));
    if (runnerRows.status === "fulfilled") runners.value = runnerRows.value;
    if (ledger.status === "fulfilled") employees.value = ledger.value.employees || [];
    if (productRows.status === "fulfilled") products.value = productRows.value || [];
    if (wecomStatus.status === "fulfilled") Object.assign(wecom, wecomStatus.value, { appSecret: "" });

    const coreFailures = [summary, taskRows].filter((result) => result.status === "rejected");
    if (coreFailures.length) {
      const reason = coreFailures[0]?.status === "rejected" ? coreFailures[0].reason : undefined;
      ElMessage.error(reason instanceof Error ? reason.message : "AI任务数据加载失败");
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "AI任务中心加载失败");
  } finally {
    loading.value = false;
  }
}

async function createTask() {
  try {
    const product = products.value.find((item) => item.id === form.productId);
    if (form.productId && !product) {
      return ElMessage.warning("请从产品库重新选择产品型号");
    }
    await post("/api/v1/ai-tasks", {
      ...form,
      ownerEmployeeId: form.ownerEmployeeId || undefined,
      reviewerEmployeeId: form.reviewerEmployeeId || undefined,
      productId: form.productId || undefined,
      productModel: product?.modelCode || undefined,
      estimatedCost: Number(form.estimatedCost || 0),
      budgetLimit: Number(form.budgetLimit || 0),
      input: {
        ...(form.type === "VIDEO" ? { executionMode: form.executionMode } : {}),
        audience: form.audience || undefined,
        targetAudience: form.audience || undefined,
        painPoint: form.painPoint || undefined,
        corePain: form.painPoint || undefined,
        keyword: form.keyword || undefined,
        recommendedScene: form.recommendedScene || undefined,
        hook: form.hook || undefined,
      },
      modelPolicy: {
        strategy: "CODEX_FIRST",
        allowExternalGeneration: form.type === "VIDEO" && Boolean(form.allowExternalGeneration),
        executionClass: form.type === "VIDEO" && form.allowExternalGeneration ? "EXTERNAL_PAID" : ["STORE_ANALYSIS", "COMPETITOR_ANALYSIS", "LIVE_ANALYSIS"].includes(form.type) ? "ANALYSIS" : "CODEX_SKILL",
      },
    });
    createVisible.value = false;
    ElMessage.success("AI任务已创建");
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "创建失败");
  }
}

async function showDetail(row: Row) {
  detail.value = await api<Row>(`/api/v1/ai-tasks/${row.id}`);
  detailVisible.value = true;
}

function openRevise() {
  if (!detail.value) return;
  const input = detail.value.input || {};
  const modelPolicy = detail.value.modelPolicy || {};
  Object.assign(reviseForm, {
    title: detail.value.title || "",
    platform: detail.value.platform || "ALL",
    productId: detail.value.productId || "",
    productModel: detail.value.productModel || "",
    audience: input.targetAudience || input.audience || "",
    painPoint: input.corePain || input.painPoint || "",
    keyword: input.keyword || "",
    recommendedScene: input.recommendedScene || "",
    hook: input.hook || "",
    instructions: detail.value.instructions || "",
    ownerEmployeeId: detail.value.ownerEmployeeId || "",
    reviewerEmployeeId: detail.value.reviewerEmployeeId || "",
    estimatedCost: Number(detail.value.estimatedCost || 0),
    budgetLimit: Number(detail.value.budgetLimit || 0),
    autoExecute: detail.value.executionPolicy !== "MANUAL",
    executionMode: input.executionMode || "FULL_VIDEO",
    allowExternalGeneration: Boolean(modelPolicy.allowExternalGeneration),
  });
  reviseVisible.value = true;
}

async function submitRevision() {
  if (!detail.value || !reviseForm.title.trim()) return ElMessage.warning("请填写任务标题");
  revising.value = true;
  try {
    const row = detail.value;
    const product = products.value.find((item) => item.id === reviseForm.productId);
    if (reviseForm.productId && !product) {
      return ElMessage.warning("请从产品库重新选择产品型号");
    }
    await post(`/api/v1/ai-tasks/${row.id}/revise`, {
      ...reviseForm,
      ownerEmployeeId: reviseForm.ownerEmployeeId || null,
      reviewerEmployeeId: reviseForm.reviewerEmployeeId || null,
      productId: reviseForm.productId || null,
      productModel: product?.modelCode || null,
      input: {
        ...(row.type === "VIDEO" ? { executionMode: reviseForm.executionMode } : {}),
        audience: reviseForm.audience || null,
        targetAudience: reviseForm.audience || null,
        painPoint: reviseForm.painPoint || null,
        corePain: reviseForm.painPoint || null,
        keyword: reviseForm.keyword || null,
        recommendedScene: reviseForm.recommendedScene || null,
        hook: reviseForm.hook || null,
      },
      modelPolicy: {
        ...(row.modelPolicy || {}),
        strategy: "CODEX_FIRST",
        allowExternalGeneration: row.type === "VIDEO" && Boolean(reviseForm.allowExternalGeneration),
        executionClass: row.type === "VIDEO" && reviseForm.allowExternalGeneration ? "EXTERNAL_PAID" : ["STORE_ANALYSIS", "COMPETITOR_ANALYSIS", "LIVE_ANALYSIS"].includes(row.type) ? "ANALYSIS" : "CODEX_SKILL",
      },
    });
    reviseVisible.value = false;
    ElMessage.success("参数已修改，任务已重新进入AI任务中心");
    await load();
    await showDetail(row);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "重新提交失败");
  } finally {
    revising.value = false;
  }
}

async function action(row: Row, name: "start" | "cancel" | "retry") {
  try {
    if (name === "cancel") await ElMessageBox.confirm("确认取消该AI任务？", "取消任务");
    await post(`/api/v1/ai-tasks/${row.id}/${name}`);
    ElMessage.success(name === "start" ? "任务已进入执行队列" : name === "retry" ? "任务已重新排队" : "任务已取消");
    await load();
    if (detailVisible.value) await showDetail(row);
  } catch (error) {
    if (error !== "cancel") ElMessage.error(error instanceof Error ? error.message : "操作失败");
  }
}

function openReview(row: Row, actionName: "APPROVE" | "RETURN") {
  detail.value = row;
  reviewAction.value = actionName;
  reviewNote.value = "";
  reviewVisible.value = true;
}

async function submitReview() {
  if (!detail.value) return;
  try {
    await post(`/api/v1/ai-tasks/${detail.value.id}/review`, { action: reviewAction.value, note: reviewNote.value });
    reviewVisible.value = false;
    detailVisible.value = false;
    ElMessage.success(reviewAction.value === "APPROVE" ? "审核通过" : "已退回");
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "审核失败");
  }
}

async function convertToOpsTask(row: Row) {
  try {
    await post(`/api/v1/ai-tasks/${row.id}/convert-to-ops-task`, {});
    ElMessage.success("已转为员工改进任务");
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "转换失败");
  }
}

async function savePolicies() {
  try {
    policies.value = await api<Row[]>("/api/v1/ai-tasks/policies", {
      method: "PUT",
      body: JSON.stringify({ policies: policies.value }),
    });
    ElMessage.success("AI任务策略已保存");
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "保存失败");
  }
}

async function createRunner() {
  try {
    const result = await post<Row>("/api/v1/ai-tasks/runners", runnerForm);
    runnerToken.value = result.token || "";
    runnerVisible.value = false;
    ElMessage.success("执行节点已创建，请立即保存一次性Token");
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "执行节点创建失败");
  }
}

async function rotateToken(row: Row) {
  try {
    const result = await post<Row>(`/api/v1/ai-tasks/runners/${row.id}/rotate-token`);
    runnerToken.value = result.token || "";
    ElMessage.success("Token已轮换，请更新Windows执行器");
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "Token轮换失败");
  }
}

async function saveWecom() {
  try {
    const result = await api<Row>("/api/v1/ai-tasks/notifications/wecom", {
      method: "PUT",
      body: JSON.stringify({ corpId: wecom.corpId, agentId: wecom.agentId, appSecret: wecom.appSecret }),
    });
    Object.assign(wecom, result, { appSecret: "" });
    ElMessage.success(result.configured ? "企微个人通知配置已保存" : "企微个人通知保持未配置");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "企微配置保存失败");
  }
}

async function openOutput(output: Row) {
  outputPreview.value = output;
  outputPreviewUrl.value = "";
  outputPreviewVisible.value = true;
  try {
    if (output.assetId || output.url) {
      const result = await api<Row>(`/api/v1/ai-tasks/outputs/${output.id}/url`);
      outputPreviewUrl.value = result.url || "";
    }
  } catch (error) {
    if (!output.contentPlan?.variants?.length) ElMessage.error(error instanceof Error ? error.message : "文件暂不可预览");
  }
}

function previewKind(output?: Row) {
  if (!output) return "DOCUMENT";
  if (output.kind === "VIDEO_MASTER" || String(output.mimeType || output.asset?.mediaType || "").startsWith("video/")) return "VIDEO";
  if (String(output.mimeType || output.asset?.mediaType || "").startsWith("image/") || ["IMAGE", "IMAGE_ASSET", "IMAGE_OUTPUT", "IMAGE_GENERATED"].includes(output.kind)) return "IMAGE";
  if (output.kind === "VIDEO_SCRIPT") return "SCRIPT";
  if (["ARTICLE", "ARTICLE_OUTPUT"].includes(output.kind) || output.contentPlan?.variants?.length) return "ARTICLE";
  return "DOCUMENT";
}

function cleanVideoScriptVoiceover(value: unknown) {
  let raw = String(value || "").trim();
  if (!raw) return "";
  raw = raw
    .replace(/[。！？]?\s*预计\s*\d+(?:\.\d+)?\s*秒[；;].*$/s, "。")
    .replace(/\s*健康提示(?:仅作[^：:]*|)[：:].*$/s, "")
    .trim();
  const lineMarker = /\[(?:C\d+-)?L\d+\]\s*/gi;
  const parts = raw.split(lineMarker).map((line) => line.trim()).filter(Boolean);
  const lines = (parts.length > 1 ? parts : raw.split(/\r?\n/))
    .map((line) => line.replace(/^(?:C\d+-)?L\d+\s*[:：.\-、]?\s*/i, "").trim())
    .filter((line) => line && !/^预计\s*\d+(?:\.\d+)?\s*秒/.test(line) && !/^健康提示/.test(line));
  return lines.join("\n");
}

function previewText(output?: Row) {
  if (output?.kind === "VIDEO_SCRIPT") {
    const script = output.metadata?.script || {};
    const packageLines = Array.isArray(script.scriptPackage?.voiceoverLines)
      ? script.scriptPackage.voiceoverLines.map((item: Row) => String(item?.text || "").trim()).filter(Boolean)
      : [];
    const voiceover = packageLines.length
      ? packageLines.join("\n")
      : cleanVideoScriptVoiceover(script.script);
    const shots = Array.isArray(script.shots) ? script.shots : [];
    const covered = shots.filter((shot: Row) =>
      ["COVERED", "APPROVED"].includes(String(shot.assetStatus || shot.coverageStatus || "").toUpperCase())
      || (Array.isArray(shot.selectedAssetIds) && shot.selectedAssetIds.length > 0),
    ).length;
    const sections = [
      script.direction ? `方向\n${script.direction}` : "",
      script.estimatedDurationSeconds ? `预计时长\n约${script.estimatedDurationSeconds}秒` : "",
      voiceover ? `完整口播\n${voiceover}` : "",
      shots.length ? `素材状态\n已覆盖 ${covered} 句 · 待补充或重新匹配 ${Math.max(0, shots.length - covered)} 句` : "",
    ];
    return sections.filter(Boolean).join("\n\n");
  }
  return (output?.contentPlan?.variants || []).map((item: Row) => `${item.title}\n\n${item.body}`).join("\n\n");
}

defineExpose({ reload: load });
onMounted(load);
</script>

<template>
  <div class="ai-task-center" v-loading="loading">
    <div class="page-head">
      <div>
        <h2>AI任务中心</h2>
        <p>Codex及AI模型执行；审核通过后的改进事项再转入员工任务指挥台。</p>
      </div>
      <div class="section-head">
        <el-button @click="emit('navigate', 'integrations')">前往系统配置</el-button>
        <el-button type="primary" @click="createVisible = true">创建AI任务</el-button>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-card"><span>今日任务</span><strong>{{ overview.today?.taskCount || 0 }}</strong></div>
      <div class="summary-card"><span>待审核</span><strong>{{ overview.pendingReview || 0 }}</strong></div>
      <div class="summary-card"><span>失败任务</span><strong>{{ overview.failed || 0 }}</strong></div>
      <div class="summary-card"><span>今日实际费用</span><strong>¥{{ Number(overview.today?.actualCost || 0).toFixed(2) }}</strong></div>
      <div class="summary-card"><span>在线节点</span><strong>{{ (overview.workers || []).filter((item: Row) => item.online).length }}</strong></div>
      <div class="summary-card"><span>个人企微通知</span><strong class="compact">{{ overview.notification?.configured ? "已配置" : "未配置" }}</strong></div>
    </div>

    <el-tabs v-model="activeTab" class="task-tabs">
      <el-tab-pane v-for="[value, label] in tabs" :key="value" :name="value" :label="label" />
    </el-tabs>

    <template v-if="!['policies', 'runners', 'cost'].includes(activeTab)">
      <div class="filters">
        <el-select v-model="filters.type" clearable placeholder="全部任务类型">
          <el-option v-for="[value, label] in taskTypes" :key="value" :value="value" :label="label" />
        </el-select>
        <el-select v-model="filters.platform" clearable placeholder="全部平台">
          <el-option label="抖音" value="DOUYIN" />
          <el-option label="TikTok" value="TIKTOK" />
          <el-option label="全平台/经营分析" value="ALL" />
        </el-select>
        <el-input v-model="filters.keyword" clearable placeholder="任务编号或标题" />
        <el-button @click="load">刷新</el-button>
      </div>

      <el-table :data="visibleTasks" stripe>
        <el-table-column prop="taskNo" label="任务编号" min-width="180" />
        <el-table-column label="类型" width="110"><template #default="{ row }">{{ taskTypeLabel(row) }}</template></el-table-column>
        <el-table-column prop="title" label="任务" min-width="220" show-overflow-tooltip />
        <el-table-column label="平台" width="120"><template #default="{ row }">{{ platformLabel(row.platform) }}</template></el-table-column>
        <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="进度" width="150">
          <template #default="{ row }"><el-progress :percentage="displayProgress(row)" :stroke-width="8" /></template>
        </el-table-column>
        <el-table-column label="负责人" width="120"><template #default="{ row }">{{ row.owner?.name || "未指定" }}</template></el-table-column>
        <el-table-column label="创建时间" width="150"><template #default="{ row }">{{ time(row.createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="290" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="showDetail(row)">详情</el-button>
            <span v-if="row.status === 'PENDING'" class="muted">已排队</span>
            <el-button v-if="['WAITING_CONFIRMATION','RETURNED'].includes(row.status)" link type="primary" @click="action(row, 'start')">运行</el-button>
            <el-button v-if="runningStatuses.includes(row.status)" link type="danger" @click="action(row, 'cancel')">取消</el-button>
            <el-button v-if="['FAILED','CANCELLED'].includes(row.status)" link type="warning" @click="action(row, 'retry')">重试</el-button>
            <el-button v-if="row.status === 'PENDING_REVIEW'" link type="success" @click="openReview(row, 'APPROVE')">通过</el-button>
            <el-button v-if="row.status === 'PENDING_REVIEW'" link type="danger" @click="openReview(row, 'RETURN')">退回</el-button>
            <el-button v-if="['STORE_ANALYSIS','COMPETITOR_ANALYSIS','LIVE_ANALYSIS'].includes(row.type)" link @click="convertToOpsTask(row)">转员工任务</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <div v-else-if="activeTab === 'policies'" class="settings-grid">
      <el-table :data="policies" stripe>
        <el-table-column label="任务类型" min-width="140"><template #default="{ row }">{{ typeLabel(row.type) }}</template></el-table-column>
        <el-table-column label="启用" width="90"><template #default="{ row }"><el-switch v-model="row.enabled" /></template></el-table-column>
        <el-table-column label="预算内自动执行" width="150"><template #default="{ row }"><el-switch v-model="row.autoExecute" /></template></el-table-column>
        <el-table-column label="每日预算" width="150"><template #default="{ row }"><el-input-number v-model="row.dailyBudget" :min="0" :precision="2" /></template></el-table-column>
        <el-table-column label="并发" width="120"><template #default="{ row }"><el-input-number v-model="row.maxConcurrency" :min="1" :max="10" /></template></el-table-column>
        <el-table-column label="重试次数" width="130"><template #default="{ row }"><el-input-number v-model="row.maxAttempts" :min="1" :max="10" /></template></el-table-column>
        <el-table-column label="超时(秒)" width="150"><template #default="{ row }"><el-input-number v-model="row.timeoutSeconds" :min="60" :step="60" /></template></el-table-column>
      </el-table>
      <div class="settings-actions"><el-button type="primary" @click="savePolicies">保存策略</el-button></div>
    </div>

    <div v-else-if="activeTab === 'runners'" class="settings-grid">
      <div class="section-head"><h3>Windows Codex执行节点</h3><el-button type="primary" @click="runnerVisible = true">新增节点</el-button></div>
      <el-alert v-if="runnerToken" type="warning" :closable="false" title="一次性Runner Token">
        <template #default><div class="token-box">{{ runnerToken }}</div><div>请立即保存并用于安装Windows执行器，页面刷新后不再显示。</div></template>
      </el-alert>
      <el-table :data="runners" stripe>
        <el-table-column prop="displayName" label="节点" min-width="160" />
        <el-table-column prop="nodeCode" label="编码" min-width="160" />
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.online ? 'success' : 'info'">{{ row.online ? "在线" : "离线" }}</el-tag></template></el-table-column>
        <el-table-column prop="version" label="版本" width="100" />
        <el-table-column label="当前任务" min-width="160"><template #default="{ row }">{{ row.currentTaskId || "空闲" }}</template></el-table-column>
        <el-table-column label="当前 Skill" min-width="220"><template #default="{ row }">{{ row.currentSkill || "空闲" }}</template></el-table-column>
        <el-table-column label="最后心跳" width="160"><template #default="{ row }">{{ time(row.lastHeartbeatAt) }}</template></el-table-column>
        <el-table-column prop="lastError" label="最近错误" min-width="180" show-overflow-tooltip />
        <el-table-column label="操作" width="110"><template #default="{ row }"><el-button link type="warning" @click="rotateToken(row)">轮换Token</el-button></template></el-table-column>
      </el-table>

      <div class="config-card">
        <div><h3>企业微信个人应用通知</h3><p>{{ wecom.message }}</p></div>
        <el-form label-position="top">
          <el-form-item label="Corp ID"><el-input v-model="wecom.corpId" placeholder="未配置" /></el-form-item>
          <el-form-item label="Agent ID"><el-input v-model="wecom.agentId" placeholder="未配置" /></el-form-item>
          <el-form-item :label="wecom.secretConfigured ? 'Secret（已配置，留空保持不变）' : 'Secret'"><el-input v-model="wecom.appSecret" type="password" show-password placeholder="未配置" /></el-form-item>
          <el-button type="primary" @click="saveWecom">保存通知配置</el-button>
        </el-form>
      </div>
    </div>

    <div v-else class="settings-grid">
      <el-table :data="typeCountRows" stripe>
        <el-table-column prop="label" label="任务类型" />
        <el-table-column prop="count" label="累计任务数" />
        <el-table-column label="已记录实际费用"><template #default="{ row }">¥{{ Number(row.cost).toFixed(2) }}</template></el-table-column>
        <el-table-column label="预算与模型"><template #default="{ row }">{{ policies.find((item) => item.type === row.type)?.dailyBudget == null ? "预算未配置" : "已配置每日预算" }}</template></el-table-column>
      </el-table>
      <el-alert type="info" :closable="false" title="模型能力仍在“连接设置”和“智能视频工厂”配置；AI任务中心只按可用状态、预算和任务策略调用。" />
    </div>

    <el-dialog v-model="createVisible" title="创建AI任务" width="620px">
      <el-form label-position="top">
        <div class="form-grid">
          <el-form-item label="任务类型"><el-select v-model="form.type"><el-option v-for="[value, label] in taskTypes" :key="value" :value="value" :label="label" /></el-select></el-form-item>
          <el-form-item label="平台"><el-select v-model="form.platform"><el-option label="抖音" value="DOUYIN" /><el-option label="TikTok" value="TIKTOK" /><el-option label="全平台/经营分析" value="ALL" /></el-select></el-form-item>
        </div>
        <el-form-item label="任务标题"><el-input v-model="form.title" placeholder="留空时按任务类型自动命名" /></el-form-item>
        <div class="form-grid">
          <el-form-item label="产品型号（产品库）">
            <el-select v-model="form.productId" clearable filterable default-first-option placeholder="点击搜索产品型号或名称" no-data-text="产品库暂无可选型号">
              <el-option v-for="item in products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.id" />
            </el-select>
            <div class="field-tip">仅可选择品牌数据中心产品库中的型号</div>
          </el-form-item>
          <el-form-item label="负责人"><el-select v-model="form.ownerEmployeeId" clearable><el-option v-for="item in employees" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
        </div>
        <el-form-item label="审核人"><el-select v-model="form.reviewerEmployeeId" clearable><el-option v-for="item in employees" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
        <div class="form-grid">
          <el-form-item label="目标用户（可选）"><el-input v-model="form.audience" placeholder="例如：为父母购买健康手表的子女" /></el-form-item>
          <el-form-item label="核心痛点（可选）"><el-input v-model="form.painPoint" placeholder="例如：不会区分健康数据入口" /></el-form-item>
          <el-form-item label="关键词（可选）"><el-input v-model="form.keyword" placeholder="主关键词或关键词簇" /></el-form-item>
          <el-form-item label="推荐场景（可选）"><el-input v-model="form.recommendedScene" placeholder="例如：首次连接手机与查看数据" /></el-form-item>
        </div>
        <el-form-item label="Hook（可选）"><el-input v-model="form.hook" placeholder="视频前三秒或内容开场提示" /></el-form-item>
        <el-form-item label="任务要求"><el-input v-model="form.instructions" type="textarea" :rows="4" /></el-form-item>
        <div v-if="form.type === 'VIDEO'" class="form-grid">
          <el-form-item label="视频任务模式"><el-radio-group v-model="form.executionMode"><el-radio-button value="FULL_VIDEO">生成完整视频</el-radio-button><el-radio-button value="SCRIPT_ONLY">仅生成脚本</el-radio-button></el-radio-group></el-form-item>
          <el-form-item label="外部视觉模型"><el-switch v-model="form.allowExternalGeneration" active-text="本地能力不足时允许调用" /></el-form-item>
        </div>
        <div v-if="form.type === 'VIDEO' && form.allowExternalGeneration" class="form-grid">
          <el-form-item label="预计费用"><el-input-number v-model="form.estimatedCost" :min="0" :precision="2" /></el-form-item>
          <el-form-item label="单任务预算上限"><el-input-number v-model="form.budgetLimit" :min="0" :precision="2" /></el-form-item>
        </div>
        <el-alert title="创建后先由管理员确认；本地Codex Skill任务确认后直接执行，无需配置预算。" type="info" :closable="false" />
      </el-form>
      <template #footer><el-button @click="createVisible = false">取消</el-button><el-button type="primary" @click="createTask">创建</el-button></template>
    </el-dialog>

    <el-dialog v-model="runnerVisible" title="新增Codex执行节点" width="560px">
      <el-form label-position="top">
        <el-form-item label="节点编码"><el-input v-model="runnerForm.nodeCode" /></el-form-item>
        <el-form-item label="显示名称"><el-input v-model="runnerForm.displayName" /></el-form-item>
        <el-form-item label="任务能力"><el-checkbox-group v-model="runnerForm.capabilities"><el-checkbox v-for="[value, label] in taskTypes" :key="value" :value="value">{{ label }}</el-checkbox></el-checkbox-group></el-form-item>
      </el-form>
      <template #footer><el-button @click="runnerVisible = false">取消</el-button><el-button type="primary" @click="createRunner">创建</el-button></template>
    </el-dialog>

    <el-dialog v-model="reviewVisible" :title="reviewAction === 'APPROVE' ? '审核通过' : '退回AI任务'" width="520px">
      <el-input v-model="reviewNote" type="textarea" :rows="4" :placeholder="reviewAction === 'RETURN' ? '请填写修改要求' : '审核备注（可选）'" />
      <template #footer><el-button @click="reviewVisible = false">取消</el-button><el-button :type="reviewAction === 'APPROVE' ? 'success' : 'danger'" @click="submitReview">确认</el-button></template>
    </el-dialog>

    <el-dialog v-model="reviseVisible" title="编辑参数并重新执行" width="640px">
      <el-form label-position="top">
        <el-form-item label="任务标题" required><el-input v-model="reviseForm.title" /></el-form-item>
        <div class="form-grid">
          <el-form-item label="平台"><el-select v-model="reviseForm.platform"><el-option label="抖音" value="DOUYIN" /><el-option label="TikTok" value="TIKTOK" /><el-option label="全平台/经营分析" value="ALL" /></el-select></el-form-item>
          <el-form-item label="产品型号（产品库）">
            <el-select v-model="reviseForm.productId" clearable filterable default-first-option placeholder="点击搜索产品型号或名称" no-data-text="产品库暂无可选型号">
              <el-option v-for="item in products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.id" />
            </el-select>
            <div class="field-tip">仅可选择品牌数据中心产品库中的型号</div>
          </el-form-item>
        </div>
        <div class="form-grid">
          <el-form-item label="负责人"><el-select v-model="reviseForm.ownerEmployeeId" clearable><el-option v-for="item in employees" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
          <el-form-item label="审核人"><el-select v-model="reviseForm.reviewerEmployeeId" clearable><el-option v-for="item in employees" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
        </div>
        <div class="form-grid">
          <el-form-item label="目标用户（可选）"><el-input v-model="reviseForm.audience" /></el-form-item>
          <el-form-item label="核心痛点（可选）"><el-input v-model="reviseForm.painPoint" /></el-form-item>
          <el-form-item label="关键词（可选）"><el-input v-model="reviseForm.keyword" /></el-form-item>
          <el-form-item label="推荐场景（可选）"><el-input v-model="reviseForm.recommendedScene" /></el-form-item>
        </div>
        <el-form-item label="Hook（可选）"><el-input v-model="reviseForm.hook" /></el-form-item>
        <el-form-item label="任务要求"><el-input v-model="reviseForm.instructions" type="textarea" :rows="5" /></el-form-item>
        <div v-if="detail?.type === 'VIDEO'" class="form-grid">
          <el-form-item label="视频任务模式"><el-radio-group v-model="reviseForm.executionMode"><el-radio-button value="FULL_VIDEO">生成完整视频</el-radio-button><el-radio-button value="SCRIPT_ONLY">仅生成脚本</el-radio-button></el-radio-group></el-form-item>
          <el-form-item label="外部视觉模型"><el-switch v-model="reviseForm.allowExternalGeneration" active-text="本地能力不足时允许调用" /></el-form-item>
        </div>
        <div v-if="detail?.type === 'VIDEO' && reviseForm.allowExternalGeneration" class="form-grid">
          <el-form-item label="预计费用"><el-input-number v-model="reviseForm.estimatedCost" :min="0" :precision="2" /></el-form-item>
          <el-form-item label="单任务预算上限"><el-input-number v-model="reviseForm.budgetLimit" :min="0" :precision="2" /></el-form-item>
        </div>
        <el-alert title="保存即生成新的执行版本，旧成果和旧执行记录会保留。" type="info" :closable="false" />
      </el-form>
      <template #footer><el-button @click="reviseVisible = false">取消</el-button><el-button type="primary" :loading="revising" @click="submitRevision">保存并重新进入执行队列</el-button></template>
    </el-dialog>

    <el-drawer v-model="detailVisible" title="AI任务详情" size="58%">
      <template v-if="detail">
        <div class="detail-actions">
          <el-button
            v-if="!runningStatuses.includes(detail.status)"
            type="primary"
            plain
            @click="openRevise"
          >编辑参数并再次执行</el-button>
        </div>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="任务编号">{{ detail.taskNo }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ statusLabel(detail.status) }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ taskTypeLabel(detail) }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.input?.executionClass === 'EXTERNAL_PAID'" label="外部模型费用">预计 ¥{{ Number(detail.estimatedCost || 0).toFixed(2) }} / 实际 ¥{{ Number(detail.actualCost || 0).toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item v-else label="执行方式">{{ detail.input?.executionClass === "ANALYSIS" ? "本地Codex分析" : "本地Codex Skill" }}</el-descriptions-item>
          <el-descriptions-item label="平台">{{ platformLabel(detail.platform) }}</el-descriptions-item>
          <el-descriptions-item label="产品">{{ detail.productModel || "未选择" }}</el-descriptions-item>
          <el-descriptions-item label="负责人">{{ detail.owner?.name || "未指定" }}</el-descriptions-item>
          <el-descriptions-item label="审核人">{{ detail.reviewer?.name || "未指定" }}</el-descriptions-item>
          <el-descriptions-item label="目标用户">{{ detail.input?.targetAudience || detail.input?.audience || "未设置" }}</el-descriptions-item>
          <el-descriptions-item label="核心痛点">{{ detail.input?.corePain || detail.input?.painPoint || "未设置" }}</el-descriptions-item>
          <el-descriptions-item label="关键词">{{ detail.input?.keyword || "未设置" }}</el-descriptions-item>
          <el-descriptions-item label="推荐场景">{{ detail.input?.recommendedScene || "未设置" }}</el-descriptions-item>
          <el-descriptions-item label="Hook" :span="2">{{ detail.input?.hook || "未设置" }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.type === 'VIDEO'" label="执行模式">{{ detail.input?.executionMode === "SCRIPT_ONLY" ? "仅生成脚本" : "生成完整视频" }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.type === 'VIDEO'" label="外部视觉模型">{{ detail.modelPolicy?.allowExternalGeneration ? "允许" : "不允许" }}</el-descriptions-item>
          <el-descriptions-item label="进度" :span="2">{{ displayProgress(detail) }}% · {{ detail.progressMessage || "未开始" }}</el-descriptions-item>
          <el-descriptions-item label="实际 Skill">{{ routedSkill(detail) }}</el-descriptions-item>
          <el-descriptions-item label="Skill 版本">{{ skillVersion(detail) }}</el-descriptions-item>
          <el-descriptions-item label="执行耗时">{{ detail.output?.execution?.durationMs == null ? (hasSuccessfulAttempt(detail) ? "历史记录未保存" : "等待执行") : `${(Number(detail.output.execution.durationMs) / 1000).toFixed(1)} 秒` }}</el-descriptions-item>
          <el-descriptions-item label="路由策略">{{ executionStrategy(detail) }}</el-descriptions-item>
          <el-descriptions-item label="任务要求" :span="2">{{ detail.instructions || "按输入数据自动执行" }}</el-descriptions-item>
          <el-descriptions-item label="缺失输入" :span="2">{{ missingInputText(detail) }}</el-descriptions-item>
        </el-descriptions>

        <h3>输入数据快照</h3>
        <el-collapse>
          <el-collapse-item v-for="item in detail.inputSnapshots || []" :key="item.id" :title="item.label || item.kind">
            <pre>{{ JSON.stringify(item.payload, null, 2) }}</pre>
          </el-collapse-item>
        </el-collapse>

        <h3>Codex执行时间线</h3>
        <el-timeline>
          <el-timeline-item v-for="item in detail.attempts || []" :key="item.id" :timestamp="time(item.startedAt)" placement="top">
            第 {{ item.attemptNo }} 次 · {{ attemptStatusLabel(item.status) }} · {{ item.logs?.skill || item.logs?.checkpoint?.data?.currentSkill || "Codex" }}
            <div v-if="item.failureReason" class="error-text">{{ item.failureReason }}</div>
            <div v-if="item.logs?.checkpoint?.message">{{ item.logs.checkpoint.message }}</div>
          </el-timeline-item>
        </el-timeline>

        <h3>通知回执</h3>
        <el-empty v-if="!(detail.notifications || []).length" description="尚无通知记录" />
        <div v-for="item in detail.notifications || []" :key="item.id" class="output-row">
          <div>
            <strong>{{ item.title }}</strong>
            <span>{{ channelLabel(item.channel) }} · {{ item.channel === "WECOM" ? (item.sentAt ? "已发送" : "发送失败") : "已记录" }} · {{ time(item.sentAt || item.createdAt) }}</span>
          </div>
        </div>

        <h3>结果与文件</h3>
        <el-empty v-if="!(detail.outputs || []).length" description="尚无输出" />
        <div v-for="output in detail.outputs || []" :key="output.id" class="output-row">
          <div>
            <strong>{{ output.title }}</strong>
            <span>{{ outputKindLabel(output.kind) }} · {{ reviewStatusLabel(output.reviewStatus) }}<template v-if="output.metadata?.sizeBytes"> · {{ output.metadata.sizeBytes }} bytes</template></span>
          </div>
          <el-button v-if="output.assetId || output.url || output.contentPlan?.variants?.length || previewText(output)" link type="primary" @click="openOutput(output)">预览</el-button>
        </div>
      </template>
    </el-drawer>
    <el-dialog v-model="outputPreviewVisible" title="成果预览" width="min(860px, 94vw)" destroy-on-close>
      <article v-if="outputPreview" class="output-preview">
        <div class="output-preview-head">
          <div><strong>{{ outputPreview.title }}</strong><span>{{ outputKindLabel(outputPreview.kind) }} · {{ reviewStatusLabel(outputPreview.reviewStatus) }}</span></div>
          <a v-if="outputPreviewUrl" :href="outputPreviewUrl" target="_blank" rel="noopener noreferrer">下载原文件</a>
        </div>
        <video v-if="previewKind(outputPreview) === 'VIDEO' && outputPreviewUrl" :src="outputPreviewUrl" controls playsinline preload="metadata" />
        <img v-else-if="previewKind(outputPreview) === 'IMAGE' && outputPreviewUrl" :src="outputPreviewUrl" :alt="outputPreview.title" />
        <pre v-else-if="['ARTICLE', 'SCRIPT'].includes(previewKind(outputPreview)) && previewText(outputPreview)">{{ previewText(outputPreview) }}</pre>
        <el-empty v-else description="当前成果没有可直接预览的文件" />
        <dl v-if="outputPreview.asset" class="preview-meta">
          <div><dt>尺寸</dt><dd>{{ outputPreview.asset.width || "—" }} × {{ outputPreview.asset.height || "—" }}</dd></div>
          <div><dt>时长</dt><dd>{{ outputPreview.asset.durationSeconds == null ? "—" : `${Number(outputPreview.asset.durationSeconds).toFixed(1)}秒` }}</dd></div>
          <div><dt>版本</dt><dd>第{{ Number(outputPreview.metadata?.version || 1) }}版</dd></div>
        </dl>
      </article>
      <template #footer><el-button @click="outputPreviewVisible = false">关闭</el-button><el-button type="primary" @click="outputPreviewVisible = false; openRevise()">修改参数并重新创作</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.ai-task-center{display:grid;gap:18px}.page-head,.section-head,.output-row,.output-preview-head{display:flex;align-items:center;justify-content:space-between;gap:16px}.page-head h2,.section-head h3,.config-card h3{margin:0}.page-head p,.config-card p{margin:6px 0 0;color:#64748b}.summary-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}.summary-card{padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;display:grid;gap:8px}.summary-card span{font-size:13px;color:#64748b}.summary-card strong{font-size:24px;color:#0f172a}.summary-card strong.compact{font-size:18px}.filters{display:grid;grid-template-columns:180px 180px minmax(220px,1fr) auto;gap:12px;margin-bottom:14px}.settings-grid{display:grid;gap:16px}.settings-actions{text-align:right}.token-box{font-family:Consolas,monospace;word-break:break-all;padding:8px 0;font-weight:700}.config-card{display:grid;grid-template-columns:1fr 1.5fr;gap:30px;border:1px solid #e2e8f0;border-radius:12px;padding:20px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.field-tip{width:100%;margin-top:5px;color:#94a3b8;font-size:12px;line-height:1.4}.detail-actions{display:flex;justify-content:flex-end;margin-bottom:12px}.output-row{border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin:8px 0}.output-row div,.output-preview-head div{display:grid;gap:4px}.output-row span,.output-preview-head span{font-size:12px;color:#64748b}.output-preview{display:grid;gap:16px}.output-preview video,.output-preview img{display:block;max-width:100%;max-height:64vh;margin:auto;border-radius:12px;background:#0f172a}.preview-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.preview-meta div{padding:10px;border:1px solid #e2e8f0;border-radius:8px}.preview-meta dt{font-size:12px;color:#64748b}.preview-meta dd{margin:4px 0 0}h3{margin:24px 0 12px}pre{max-height:320px;overflow:auto;white-space:pre-wrap;background:#f8fafc;padding:12px;border-radius:8px}.error-text{color:#dc2626;margin-top:6px}@media(max-width:1200px){.summary-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:760px){.summary-grid,.form-grid,.config-card,.preview-meta{grid-template-columns:1fr}.filters{grid-template-columns:1fr}}
</style>
