<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import {
  Bell,
  Collection,
  DataAnalysis,
  DocumentChecked,
  Files,
  House,
  Search,
  Shop,
  UploadFilled,
  VideoCamera,
} from "@element-plus/icons-vue";
import { api, clearToken, getToken, post, setToken } from "./api";

type Row = Record<string, any>;
type SessionUser = {
  id: string;
  name: string;
  roles: string[];
  permissions: string[];
  departmentNames?: string[];
};

const authReady = ref(false);
const user = ref<SessionUser>();
const loginMessage = ref("");
const qrLoginUrl = ref("");
const qrLoading = ref(false);
const active = ref("home");
const loading = ref(false);
const dashboard = reactive<Row>({
  employee: {},
  summary: {},
  todayTasks: [],
  availableTasks: [],
  notices: [],
  quickActions: [],
});
const tasks = ref<Row[]>([]);
const taskScope = ref("MINE");
const taskStatus = ref("");
const operationTeam = reactive<Row>({ supervisor: null, directReports: [], invitations: { incoming: [], outgoing: [] }, operators: [] });
const teamTasks = ref<Row[]>([]);
const receivedTeamTasks = ref<Row[]>([]);
const teamTaskFilters = reactive({ status: "", assigneeEmployeeId: "" });
const teamTaskVisible = ref(false);
const inviteVisible = ref(false);
const reviewVisible = ref(false);
const reviewTaskRow = ref<Row>();
const teamTaskForm = reactive({ assigneeEmployeeId: "", title: "", description: "", priority: "MEDIUM", dueAt: "", expectedResult: "", attachments: "" });
const inviteForm = reactive({ recipientEmployeeId: "", relationshipNote: "" });
const reviewForm = reactive({ action: "APPROVE", note: "" });
const activeTask = ref<Row>();
const submitVisible = ref(false);
const submitForm = reactive({ summary: "", assetId: "", metrics: "", improvements: "" });
const uploadVisible = ref(false);
const uploadForm = reactive({ model: "", name: "", source: "员工原创", copyrightStatus: "OWNED" });
const uploadFile = ref<File>();
const knowledgeVisible = ref(false);
const knowledgeForm = reactive({
  title: "",
  type: "FAQ",
  category: "产品问答",
  reply: "",
  body: "",
  model: "",
});
const liveData = reactive<Row>({ roleEnabled: false, courses: [], reviews: [] });
const notices = ref<Row[]>([]);
const dataCenter = reactive<Row>({
  permissions: [],
  summary: {},
  assets: [],
  knowledge: [],
  pendingAssets: [],
  keywords: { total: 0, items: [] },
  viralKeywords: { keywords: [] },
  viralTrend: { summary: {}, items: [] },
  videoProjects: [],
  videoScripts: [],
});
const dataCenterTab = ref("assets");
const dataCenterFilters = reactive({
  query: "",
  model: "",
  kind: "",
  moduleType: "",
  minimumScore: "60",
});
const videoFactoryForm = reactive({
  platform: "DOUYIN",
  productModel: "",
  topic: "",
  audience: "",
  objective: "种草与转化",
  keywordIds: [] as string[],
  externalVideoIds: [] as string[],
});
const creatingVideoProject = ref(false);
const generatingProjectId = ref("");
const generatingVideoScript = ref(false);
const videoScriptMode = ref("ASSET_FIRST");
const videoScriptRestriction = ref("NORMAL");
const analyzingAssetGaps = ref(false);
const creatingGapTasks = ref(false);
const assetGaps = ref<Row[]>([]);
const selectedAssetGapIds = ref<string[]>([]);
let dataCenterRequestId = 0;

const roleLabels: Record<string, string> = {
  CONTENT_OPERATOR: "运营",
  VIDEO_SPECIALIST: "视频专员",
  ASSET_CURATOR: "知识素材整理员",
  DESIGNER: "设计",
  CUSTOMER_SERVICE: "客服",
  LIVE_HOST: "主播",
};
const statusLabels: Record<string, string> = {
  OPEN: "待领取",
  ACCEPTED: "待开始",
  IN_PROGRESS: "执行中",
  REVIEW: "待审核",
  RETURNED: "需修改",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};
const priorityLabels: Record<string, string> = {
  URGENT: "紧急",
  HIGH: "高",
  MEDIUM: "普通",
  LOW: "低",
};
const currentRoles = computed(() => user.value?.roles || []);
const isLiveHost = computed(() => currentRoles.value.includes("LIVE_HOST"));
const isOperator = computed(() => currentRoles.value.includes("CONTENT_OPERATOR"));
const isCollaborator = computed(() => currentRoles.value.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST", "DESIGNER"].includes(role)));
const canGenerateVideoScript = computed(() => currentRoles.value.some((role) => ["CONTENT_OPERATOR", "VIDEO_SPECIALIST"].includes(role)) && can("CONTENT_SUBMIT"));
const can = (permission: string) => Boolean(user.value?.permissions.includes("*") || user.value?.permissions.includes(permission));
const canUseDataCenter = computed(() => can("DATA_CENTER_VIEW"));
const navigation = computed(() => [
  { key: "home", label: "今日工作", icon: House, visible: true },
  { key: "tasks", label: "任务中心", icon: DocumentChecked, visible: true },
  { key: "team", label: "团队协作", icon: DocumentChecked, visible: isCollaborator.value },
  { key: "data", label: "数据中心", icon: Files, visible: canUseDataCenter.value },
  { key: "live", label: "直播学习", icon: VideoCamera, visible: isLiveHost.value },
  { key: "messages", label: "消息通知", icon: Bell, visible: true },
].filter((item) => item.visible));
const pageTitle = computed(() => navigation.value.find((item) => item.key === active.value)?.label || "员工工作台");

function formatTime(input?: string) {
  if (!input) return "未设置";
  const value = new Date(input);
  if (Number.isNaN(value.getTime())) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function statusType(status: string) {
  if (status === "COMPLETED") return "success";
  if (status === "RETURNED") return "danger";
  if (status === "REVIEW") return "warning";
  if (status === "IN_PROGRESS") return "primary";
  return "info";
}

function compactNumber(value?: number | string) {
  const number = Number(value || 0);
  if (number >= 100_000_000) return `${(number / 100_000_000).toFixed(1)}亿`;
  if (number >= 10_000) return `${(number / 10_000).toFixed(1)}万`;
  return new Intl.NumberFormat("zh-CN").format(number);
}

function percent(value?: number | string) {
  const number = Number(value || 0);
  return `${(number <= 1 ? number * 100 : number).toFixed(1)}%`;
}

function platformLabel(value?: string) {
  return ({ DOUYIN: "抖音", TIKTOK: "TikTok", XIAOHONGSHU: "小红书", WECHAT_CHANNELS: "视频号" } as Record<string, string>)[String(value)] || value || "未设置";
}

function projectCandidates(project: Row) {
  const signal = Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  return Array.isArray(project.scriptCandidates) ? project.scriptCandidates : signal?.scriptCandidates || [];
}

function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function liveOptimization(task: Row) {
  return task.submissions?.[0]?.payload?.aiOptimization as Row | undefined;
}

async function loadDashboard() {
  loading.value = true;
  try {
    Object.assign(dashboard, await api<Row>("/api/v1/workbench/dashboard"));
  } finally {
    loading.value = false;
  }
}

async function loadTasks() {
  loading.value = true;
  try {
    const parameters = new URLSearchParams({ scope: taskScope.value });
    if (taskStatus.value) parameters.set("status", taskStatus.value);
    tasks.value = await api<Row[]>(`/api/v1/workbench/tasks?${parameters.toString()}`);
  } finally {
    loading.value = false;
  }
}

function collaborationRoleLabel(employee: Row) {
  const codes = (employee.roles || []).map((item: Row) => item.role?.code).filter(Boolean);
  const code = ["CONTENT_OPERATOR", "VIDEO_SPECIALIST", "DESIGNER"].find((item) => codes.includes(item));
  return roleLabels[code || ""] || "协作成员";
}

async function loadOperationTeam() {
  const parameters = new URLSearchParams();
  if (teamTaskFilters.status) parameters.set("status", teamTaskFilters.status);
  if (teamTaskFilters.assigneeEmployeeId) parameters.set("assigneeEmployeeId", teamTaskFilters.assigneeEmployeeId);
  const [team, taskResult, receivedResult] = await Promise.all([
    api<Row>("/api/v1/workbench/operation-team"),
    api<Row>(`/api/v1/workbench/operation-team/tasks?${parameters.toString()}`),
    api<Row>("/api/v1/workbench/operation-team/tasks?scope=RECEIVED"),
  ]);
  Object.assign(operationTeam, team);
  teamTasks.value = taskResult.items || [];
  receivedTeamTasks.value = receivedResult.items || [];
}

async function setTeamTaskUrgency(task: Row, urgent: boolean) {
  await post(`/api/v1/workbench/operation-team/tasks/${task.id}/urgency`, { urgent });
  ElMessage.success(urgent ? "已标记为紧急任务，并通知协作成员优先处理" : "已取消紧急标记");
  await loadOperationTeam();
}

async function sendTeamInvite() {
  if (!inviteForm.recipientEmployeeId) return ElMessage.warning("请选择运营");
  await post("/api/v1/workbench/operation-team/invitations", inviteForm);
  inviteVisible.value = false;
  ElMessage.success("协作关系邀请已发送");
  await loadOperationTeam();
}

async function respondInvite(id: string, action: string) {
  await post(`/api/v1/workbench/operation-team/invitations/${id}/respond`, { action });
  ElMessage.success(action === "ACCEPT" ? "协作关系已建立" : "邀请已拒绝");
  await loadOperationTeam();
}

async function cancelInvite(id: string) {
  await post(`/api/v1/workbench/operation-team/invitations/${id}/cancel`);
  await loadOperationTeam();
}

async function removeDirectReport(id: string) {
  await post(`/api/v1/workbench/operation-team/direct-reports/${id}/remove`);
  ElMessage.success("协作关系已解除");
  await loadOperationTeam();
}

async function createTeamTask() {
  if (!teamTaskForm.assigneeEmployeeId || !teamTaskForm.title.trim()) return ElMessage.warning("请选择协作成员并填写任务标题");
  await post("/api/v1/workbench/operation-team/tasks", {
    ...teamTaskForm,
    attachments: teamTaskForm.attachments.split("\n").map((item) => item.trim()).filter(Boolean),
  });
  teamTaskVisible.value = false;
  ElMessage.success("任务已推送到协作成员的任务列表");
  await loadOperationTeam();
}

function openTeamReview(task: Row) {
  reviewTaskRow.value = task;
  reviewForm.action = "APPROVE";
  reviewForm.note = "";
  reviewVisible.value = true;
}

async function reviewTeamTask() {
  if (!reviewTaskRow.value) return;
  if (reviewForm.action === "RETURN" && !reviewForm.note.trim()) return ElMessage.warning("退回时请填写修改要求");
  await post(`/api/v1/workbench/operation-team/tasks/${reviewTaskRow.value.id}/review`, reviewForm);
  reviewVisible.value = false;
  ElMessage.success(reviewForm.action === "APPROVE" ? "任务已审核通过" : "任务已退回修改");
  await loadOperationTeam();
}

async function loadLive() {
  Object.assign(liveData, await api<Row>("/api/v1/workbench/live/learning"));
}

async function loadNotices() {
  notices.value = await api<Row[]>("/api/v1/workbench/notifications");
}

async function loadDataCenter() {
  const requestId = ++dataCenterRequestId;
  const parameters = new URLSearchParams();
  Object.entries(dataCenterFilters).forEach(([key, value]) => {
    if (value) parameters.set(key, value);
  });
  parameters.set("_", String(Date.now()));
  const result = await api<Row>(`/api/v1/workbench/data-center?${parameters.toString()}`);
  if (requestId === dataCenterRequestId) Object.assign(dataCenter, result);
}

function useKeywordInFactory(keyword: Row) {
  dataCenterTab.value = "videoFactory";
  videoFactoryForm.platform = keyword.platform || "DOUYIN";
  videoFactoryForm.productModel = keyword.product?.modelCode || "";
  videoFactoryForm.topic = keyword.keyword || "";
  videoFactoryForm.audience = keyword.audience || "";
  videoFactoryForm.keywordIds = [keyword.id];
  videoFactoryForm.externalVideoIds = [];
}

function useViralVideoInFactory(video: Row) {
  dataCenterTab.value = "videoFactory";
  videoFactoryForm.platform = video.platform || "DOUYIN";
  videoFactoryForm.productModel = video.keywordHits?.find((item: Row) => item.keyword?.product)?.keyword?.product?.modelCode || "";
  videoFactoryForm.topic = video.title || "爆款结构仿拍";
  videoFactoryForm.audience = "";
  videoFactoryForm.keywordIds = (video.keywordHits || []).map((item: Row) => item.keywordId || item.keyword?.id).filter(Boolean);
  videoFactoryForm.externalVideoIds = [video.id];
}

async function createVideoProject() {
  if (!videoFactoryForm.topic.trim()) {
    ElMessage.warning("请填写视频主题或先选择关键词、爆款参考");
    return;
  }
  creatingVideoProject.value = true;
  try {
    await post("/api/v1/workbench/data-center/video-projects", videoFactoryForm);
    ElMessage.success("已生成3个视频方向，可继续生成拍摄执行包");
    videoFactoryForm.keywordIds = [];
    videoFactoryForm.externalVideoIds = [];
    await loadDataCenter();
    dataCenterTab.value = "videoFactory";
  } finally {
    creatingVideoProject.value = false;
  }
}

async function generateWorkbenchVideoScript() {
  if (videoScriptMode.value === "ASSET_ONLY" && !videoFactoryForm.productModel.trim()) {
    return ElMessage.warning("生成无需补拍脚本前，请填写产品型号");
  }
  generatingVideoScript.value = true;
  try {
    const result = await post<Row>("/api/v1/workbench/data-center/video-scripts/generate", {
      generationMode: videoScriptMode.value,
      contentRestrictionMode: videoScriptRestriction.value,
      productModel: videoFactoryForm.productModel,
      platform: videoFactoryForm.platform,
      keywordIds: videoFactoryForm.keywordIds,
    });
    ElMessage.success(result.created
      ? (videoScriptMode.value === "ASSET_ONLY" ? "无需补拍脚本已生成，已进入脚本审核" : "视频脚本已生成，已进入脚本审核")
      : "今天已有同类脚本，没有重复创建");
    await loadDataCenter();
    dataCenterTab.value = "videoFactory";
  } finally {
    generatingVideoScript.value = false;
  }
}

async function analyzeWorkbenchAssetGaps() {
  if (!videoFactoryForm.productModel.trim()) return ElMessage.warning("请先填写需要分析的产品型号");
  analyzingAssetGaps.value = true;
  try {
    assetGaps.value = await post<Row[]>("/api/v1/workbench/data-center/asset-gaps/analyze", {
      productModel: videoFactoryForm.productModel,
    });
    selectedAssetGapIds.value = assetGaps.value.filter((item) => Number(item.gapCount || 0) > 0).map((item) => item.id);
    ElMessage.success(assetGaps.value.length ? "缺失素材分析完成，可勾选生成补拍任务" : "当前没有发现缺失素材");
  } finally {
    analyzingAssetGaps.value = false;
  }
}

async function createWorkbenchGapTasks() {
  if (!selectedAssetGapIds.value.length) return ElMessage.warning("请先勾选需要补拍的素材");
  creatingGapTasks.value = true;
  try {
    const result = await post<Row>("/api/v1/workbench/data-center/asset-gaps/tasks", { ids: selectedAssetGapIds.value });
    ElMessage.success(`已生成 ${result.created || 0} 个补拍任务`);
    selectedAssetGapIds.value = [];
  } finally {
    creatingGapTasks.value = false;
  }
}

async function generateVideoProject(project: Row, candidateIndex = 0) {
  generatingProjectId.value = project.id;
  try {
    await post(`/api/v1/workbench/data-center/video-projects/${project.id}/generate`, { candidateIndex });
    ElMessage.success("拍摄执行包已生成，缺失镜头已形成补拍要求");
    await loadDataCenter();
    dataCenterTab.value = "videoFactory";
  } finally {
    generatingProjectId.value = "";
  }
}

async function switchPage(page: string) {
  active.value = page;
  if (page === "home") await loadDashboard();
  if (page === "tasks") await loadTasks();
  if (page === "team") await loadOperationTeam();
  if (page === "data") await loadDataCenter();
  if (page === "live") await loadLive();
  if (page === "messages") await loadNotices();
}

async function acceptTask(task: Row) {
  await post(`/api/v1/workbench/tasks/${task.id}/accept`);
  ElMessage.success("任务已领取");
  await Promise.all([loadDashboard(), loadTasks()]);
}

async function startTask(task: Row) {
  await post(`/api/v1/workbench/tasks/${task.id}/start`);
  ElMessage.success("任务已开始");
  await Promise.all([loadDashboard(), loadTasks()]);
  if (active.value === "team") await loadOperationTeam();
}

function openSubmit(task: Row) {
  activeTask.value = task;
  submitForm.summary = "";
  submitForm.assetId = "";
  submitForm.metrics = "";
  submitForm.improvements = "";
  submitVisible.value = true;
}

async function submitTask() {
  if (!activeTask.value || !submitForm.summary.trim()) {
    ElMessage.warning("请填写任务成果说明");
    return;
  }
  await post(`/api/v1/workbench/tasks/${activeTask.value.id}/submit`, {
    summary: submitForm.summary,
    payload: {
      assetId: submitForm.assetId,
      metrics: submitForm.metrics,
      improvements: submitForm.improvements,
    },
  });
  submitVisible.value = false;
  ElMessage.success("已提交主管审核");
  await Promise.all([loadDashboard(), loadTasks()]);
  if (active.value === "team") await loadOperationTeam();
}

async function submitAsset() {
  if (!can("ASSET_UPLOAD")) {
    ElMessage.warning("当前岗位没有素材上传权限");
    return;
  }
  if (!uploadFile.value) {
    ElMessage.warning("请选择素材文件");
    return;
  }
  const form = new FormData();
  form.append("file", uploadFile.value);
  Object.entries(uploadForm).forEach(([key, value]) => form.append(key, value));
  await api("/api/v1/workbench/assets/upload", { method: "POST", body: form });
  uploadVisible.value = false;
  uploadFile.value = undefined;
  ElMessage.success("素材已上传，AI分析完成后进入待审核");
}

async function submitKnowledge() {
  if (!can("KNOWLEDGE_SUBMIT")) {
    ElMessage.warning("当前岗位没有知识提交权限");
    return;
  }
  await post("/api/v1/workbench/knowledge", { ...knowledgeForm });
  knowledgeVisible.value = false;
  ElMessage.success("知识已提交审核");
}

async function readNotice(item: Row) {
  if (!item.readAt) await post(`/api/v1/workbench/notifications/${item.id}/read`);
  item.readAt = new Date().toISOString();
}

function logout() {
  clearToken();
  user.value = undefined;
  void loadQr();
}

function openMall() {
  window.location.assign("/saidian-mall/#/pages/employee/index");
}

async function startWecomLogin() {
  loginMessage.value = "";
  try {
    const redirectUri = `${window.location.origin}/saidian-work/`;
    const result = await api<{ url: string }>(
      `/api/v1/auth/wecom/authorize-url?redirectUri=${encodeURIComponent(redirectUri)}`,
    );
    window.location.assign(result.url);
  } catch (error) {
    loginMessage.value = error instanceof Error ? error.message : "企业微信登录暂不可用";
  }
}

async function loadQr() {
  qrLoading.value = true;
  try {
    const redirectUri = `${window.location.origin}/saidian-work/?wecom_qr=1`;
    const result = await api<{ url: string }>(
      `/api/v1/auth/wecom/qr-authorize-url?redirectUri=${encodeURIComponent(redirectUri)}`,
    );
    qrLoginUrl.value = result.url;
  } catch (error) {
    loginMessage.value = error instanceof Error ? error.message : "二维码暂不可用";
  } finally {
    qrLoading.value = false;
  }
}

async function bootstrap() {
  try {
    const parameters = new URLSearchParams(window.location.search);
    const code = parameters.get("code");
    if (code) {
      const result = await post<{ token: string; mallToken?: string; user: SessionUser }>("/api/v1/auth/wecom/login", { code });
      setToken(result.token);
      if (result.mallToken) localStorage.setItem("employee-token", result.mallToken);
      window.history.replaceState({}, "", "/saidian-work/");
    }
    const mallToken = localStorage.getItem("employee-token") || "";
    if (mallToken) {
      try {
        const result = await post<{ token: string; user: SessionUser }>("/api/v1/auth/wecom/session", { mallToken });
        setToken(result.token);
      } catch {
        if (!getToken()) localStorage.removeItem("employee-token");
      }
    }
    if (getToken()) {
      const identity = await api<Row>("/api/v1/workbench/me");
      if (identity.portal !== "EMPLOYEE_WORKBENCH") throw new Error("请使用企业微信员工身份登录");
      user.value = {
        id: identity.employeeId,
        name: identity.name,
        roles: identity.roles || [],
        permissions: identity.permissions || [],
      };
      await loadDashboard();
    } else {
      await loadQr();
    }
  } catch (error) {
    clearToken();
    loginMessage.value = error instanceof Error ? error.message : "登录失败";
    await loadQr();
  } finally {
    authReady.value = true;
  }
}

onMounted(() => void bootstrap());
</script>

<template>
  <div v-if="!authReady" class="center-screen"><el-icon class="spin" :size="32"><House /></el-icon></div>

  <div v-else-if="!user" class="login-page">
    <section class="login-card">
      <div class="logo">S</div>
      <p class="eyebrow">SAYDIAN WORKBENCH</p>
      <h1>赛电员工工作台</h1>
      <p class="muted">进入后只看与你岗位相关的任务、素材和消息。</p>
      <el-alert v-if="loginMessage" :title="loginMessage" type="warning" :closable="false" />
      <div class="qr-frame" v-loading="qrLoading">
        <iframe v-if="qrLoginUrl" :src="qrLoginUrl" title="企业微信登录二维码" />
        <div v-else class="qr-placeholder">二维码暂未加载</div>
      </div>
      <el-button type="primary" size="large" @click="startWecomLogin">企业微信内直接登录</el-button>
      <el-button link @click="loadQr">刷新二维码</el-button>
    </section>
  </div>

  <div v-else class="workbench">
    <aside class="side-nav">
      <div class="side-brand">
        <div class="logo small">S</div>
        <div><strong>SAYDIAN</strong><span>员工工作台</span></div>
      </div>
      <nav>
        <button v-for="item in navigation" :key="item.key" :class="{ active: active === item.key }" @click="switchPage(item.key)">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
          <i v-if="item.key === 'messages' && dashboard.summary.unread">{{ dashboard.summary.unread }}</i>
        </button>
      </nav>
      <button class="mall-entry" @click="openMall"><el-icon><Shop /></el-icon><span>商城员工端</span></button>
    </aside>

    <header class="topbar">
      <div>
        <p class="eyebrow">SAYDIAN WORKBENCH</p>
        <h1>{{ pageTitle }}</h1>
      </div>
      <div class="user-block">
        <div class="user-copy">
          <strong>{{ user.name }}</strong>
          <span>{{ currentRoles.map((role) => roleLabels[role] || role).join(" · ") || "待分配岗位" }}</span>
        </div>
        <button class="avatar" @click="logout">{{ user.name.slice(0, 1) }}</button>
      </div>
    </header>

    <main v-loading="loading">
      <template v-if="active === 'home'">
        <section class="hero">
          <div>
            <p class="eyebrow">TODAY'S PRIORITIES</p>
            <h2>{{ dashboard.summary.overdue ? `先处理 ${dashboard.summary.overdue} 项逾期任务` : "按优先级完成今天的工作" }}</h2>
            <p>领取、执行、提交和审核结果均自动进入日报，不需要重复填写日报。</p>
          </div>
          <el-button type="primary" size="large" @click="switchPage('tasks')">开始处理任务</el-button>
        </section>

        <section class="metric-grid">
          <article><span>今日任务</span><strong>{{ dashboard.summary.today || 0 }}</strong></article>
          <article><span>执行中</span><strong>{{ dashboard.summary.inProgress || 0 }}</strong></article>
          <article><span>待审核</span><strong>{{ dashboard.summary.awaitingReview || 0 }}</strong></article>
          <article class="danger"><span>已逾期</span><strong>{{ dashboard.summary.overdue || 0 }}</strong></article>
        </section>

        <section class="home-grid">
          <article class="section-card">
            <div class="section-title">
              <div><p class="eyebrow">MY TASKS</p><h3>今天要做</h3></div>
              <el-button link type="primary" @click="switchPage('tasks')">查看全部</el-button>
            </div>
            <div v-if="dashboard.todayTasks?.length" class="task-list">
              <article v-for="task in dashboard.todayTasks" :key="task.id" class="task-card">
                <div class="task-main">
                  <div class="task-meta">
                    <el-tag size="small" :type="statusType(task.status)">{{ statusLabels[task.status] || task.status }}</el-tag>
                    <span>{{ priorityLabels[task.priority] || task.priority }}</span>
                    <span>截止 {{ formatTime(task.dueAt) }}</span>
                  </div>
                  <h4>{{ task.title }}</h4>
                  <p>{{ task.description || task.expectedResult || "按任务要求完成并提交成果。" }}</p>
                  <p v-if="task.returnReason" class="return-note">修改要求：{{ task.returnReason }}</p>
                </div>
                <div class="task-actions">
                  <el-button v-if="task.status === 'ACCEPTED' || task.status === 'RETURNED'" type="primary" @click="startTask(task)">开始</el-button>
                  <el-button v-if="['ACCEPTED','IN_PROGRESS','RETURNED'].includes(task.status)" @click="openSubmit(task)">提交成果</el-button>
                </div>
              </article>
            </div>
            <el-empty v-else description="当前没有待办任务" />
          </article>

          <div class="home-side">
            <article class="section-card">
            <div class="section-title"><div><p class="eyebrow">QUICK ACTIONS</p><h3>快捷操作</h3></div></div>
            <div class="action-grid">
              <button @click="switchPage('tasks')"><el-icon><DocumentChecked /></el-icon><span>处理任务</span></button>
              <button v-if="canUseDataCenter" @click="switchPage('data')"><el-icon><DataAnalysis /></el-icon><span>数据中心</span></button>
              <button v-if="can('ASSET_UPLOAD')" @click="uploadVisible = true"><el-icon><UploadFilled /></el-icon><span>上传素材</span></button>
              <button v-if="can('KNOWLEDGE_SUBMIT')" @click="knowledgeVisible = true"><el-icon><Collection /></el-icon><span>补充知识</span></button>
              <button v-if="isLiveHost" @click="switchPage('live')"><el-icon><VideoCamera /></el-icon><span>直播学习</span></button>
              <button @click="openMall"><el-icon><Shop /></el-icon><span>商城员工端</span></button>
            </div>
            </article>

            <article class="section-card">
              <div class="section-title"><div><p class="eyebrow">AVAILABLE</p><h3>可领取任务</h3></div></div>
              <div v-if="dashboard.availableTasks?.length" class="compact-list">
                <div v-for="task in dashboard.availableTasks" :key="task.id">
                  <div><strong>{{ task.title }}</strong><span>{{ roleLabels[task.requiredRoleCode] || "通用任务" }}</span></div>
                  <el-button size="small" @click="acceptTask(task)">领取</el-button>
                </div>
              </div>
              <el-empty v-else description="暂无可领取任务" :image-size="60" />
            </article>
          </div>
        </section>
      </template>

      <template v-else-if="active === 'tasks'">
        <section class="toolbar section-card">
          <el-segmented v-model="taskScope" :options="[{label:'我的任务',value:'MINE'},{label:'可领取',value:'AVAILABLE'},{label:'全部相关',value:'ALL'}]" @change="loadTasks" />
          <el-select v-model="taskStatus" clearable placeholder="全部状态" @change="loadTasks">
            <el-option v-for="(label, key) in statusLabels" :key="key" :label="label" :value="key" />
          </el-select>
        </section>
        <section class="section-card task-list">
          <article v-for="task in tasks" :key="task.id" class="task-card">
            <div class="task-main">
              <div class="task-meta">
                <el-tag size="small" :type="statusType(task.status)">{{ statusLabels[task.status] || task.status }}</el-tag>
                <span>{{ task.taskNo || "系统任务" }}</span>
                <span>{{ roleLabels[task.requiredRoleCode] || task.category }}</span>
                <span>截止 {{ formatTime(task.dueAt) }}</span>
              </div>
              <h4>{{ task.title }}</h4>
              <p>{{ task.description || task.expectedResult || "按任务要求完成并提交成果。" }}</p>
              <p v-if="task.returnReason" class="return-note">修改要求：{{ task.returnReason }}</p>
            </div>
            <div class="task-actions">
              <el-button v-if="!task.assigneeEmployeeId && task.status === 'OPEN'" type="primary" @click="acceptTask(task)">领取</el-button>
              <el-button v-if="task.assigneeEmployeeId === user.id && ['ACCEPTED','RETURNED'].includes(task.status)" type="primary" @click="startTask(task)">开始</el-button>
              <el-button v-if="task.assigneeEmployeeId === user.id && ['ACCEPTED','IN_PROGRESS','RETURNED'].includes(task.status)" @click="openSubmit(task)">提交成果</el-button>
            </div>
          </article>
          <el-empty v-if="!tasks.length" description="没有符合条件的任务" />
        </section>
      </template>

      <template v-else-if="active === 'team'">
        <section class="team-hero section-card">
          <div>
            <p class="eyebrow">OPERATION TEAM</p>
            <h2>运营团队协作</h2>
          </div>
          <div class="team-hero-actions">
            <el-button v-if="isOperator" @click="inviteVisible = true">邀请协作成员</el-button>
            <el-button v-if="operationTeam.directReports?.length" type="primary" @click="teamTaskVisible = true">安排任务</el-button>
          </div>
        </section>

        <section class="team-grid">
          <article class="section-card">
            <div class="section-title"><div><p class="eyebrow">COLLABORATION</p><h3>协作关系</h3></div></div>
            <p class="team-supervisor">我的上级运营：<strong>{{ operationTeam.supervisor?.name || "暂未建立" }}</strong><small v-if="operationTeam.supervisor?.collaborationNote">{{ operationTeam.supervisor.collaborationNote }}</small></p>
            <div class="compact-list">
              <div v-for="employee in operationTeam.directReports" :key="employee.id">
                <div><strong>{{ employee.name }}</strong><span>{{ collaborationRoleLabel(employee) }} · {{ employee.employeeNo || "未设置工号" }}<template v-if="employee.collaborationNote"> · {{ employee.collaborationNote }}</template></span></div>
                <el-button size="small" @click="removeDirectReport(employee.id)">解除</el-button>
              </div>
            </div>
            <el-empty v-if="!operationTeam.directReports?.length" description="暂无协作成员" :image-size="60" />
          </article>

          <article class="section-card">
            <div class="section-title"><div><p class="eyebrow">INVITATIONS</p><h3>关系邀请</h3></div></div>
            <div class="compact-list">
              <div v-for="invite in operationTeam.invitations?.incoming" :key="invite.id">
                <div><strong>{{ invite.sender.name }}</strong><span>邀请你成为协作成员<template v-if="invite.relationshipNote"> · {{ invite.relationshipNote }}</template></span></div>
                <div><el-button size="small" @click="respondInvite(invite.id, 'REJECT')">拒绝</el-button><el-button size="small" type="primary" @click="respondInvite(invite.id, 'ACCEPT')">接受</el-button></div>
              </div>
              <div v-for="invite in operationTeam.invitations?.outgoing" :key="invite.id">
                <div><strong>{{ invite.recipient.name }}</strong><span>等待对方确认</span></div>
                <el-button size="small" @click="cancelInvite(invite.id)">撤回</el-button>
              </div>
            </div>
            <el-empty v-if="!operationTeam.invitations?.incoming?.length && !operationTeam.invitations?.outgoing?.length" description="暂无待处理邀请" :image-size="60" />
          </article>
        </section>

        <section class="section-card task-list received-team-tasks">
          <div class="section-heading"><div><p class="eyebrow">ASSIGNED TO ME</p><h3>别人安排给我的任务</h3><p>紧急事项会自动排在最前面。</p></div></div>
          <article v-for="task in receivedTeamTasks" :key="task.id" class="task-card" :class="{ urgent: task.priority === 'URGENT' }">
            <div class="task-main">
              <div class="task-meta">
                <el-tag v-if="task.priority === 'URGENT'" size="small" type="danger">紧急优先</el-tag>
                <el-tag size="small" :type="statusType(task.status)">{{ statusLabels[task.status] || task.status }}</el-tag>
                <span>{{ task.assignedBy || "运营安排" }}</span>
                <span>截止 {{ formatTime(task.dueAt) }}</span>
              </div>
              <h4>{{ task.title }}</h4>
              <p>{{ task.description || task.expectedResult || "按要求完成并提交成果。" }}</p>
              <p v-if="task.returnReason" class="return-note">修改要求：{{ task.returnReason }}</p>
            </div>
            <div class="task-actions">
              <el-button v-if="['ACCEPTED','RETURNED'].includes(task.status)" type="primary" @click="startTask(task)">开始任务</el-button>
              <el-button v-if="['ACCEPTED','IN_PROGRESS','RETURNED'].includes(task.status)" @click="openSubmit(task)">提交成果</el-button>
            </div>
          </article>
          <el-empty v-if="!receivedTeamTasks.length" description="当前没有别人安排给你的协作任务" />
        </section>

        <section v-if="isOperator" class="section-card task-list">
          <div class="section-heading">
            <div><h3>我安排的任务</h3><p>只显示由你安排的协作任务，紧急任务优先排列。</p></div>
            <div class="team-task-filters">
              <el-select v-model="teamTaskFilters.status" clearable placeholder="全部状态" @change="loadOperationTeam">
                <el-option v-for="(label, key) in statusLabels" :key="key" :label="label" :value="key" />
              </el-select>
              <el-select v-model="teamTaskFilters.assigneeEmployeeId" clearable placeholder="全部协作人" @change="loadOperationTeam">
                <el-option v-for="employee in operationTeam.directReports" :key="employee.id" :label="employee.name" :value="employee.id" />
              </el-select>
            </div>
          </div>
          <article v-for="task in teamTasks" :key="task.id" class="task-card">
            <div class="task-main">
              <div class="task-meta"><el-tag v-if="task.priority === 'URGENT'" size="small" type="danger">紧急</el-tag><el-tag size="small" :type="statusType(task.status)">{{ statusLabels[task.status] || task.status }}</el-tag><span>{{ task.assignee?.name }}</span><span>截止 {{ formatTime(task.dueAt) }}</span></div>
              <h4>{{ task.title }}</h4>
              <p>{{ task.description || task.expectedResult || "按要求完成并提交成果。" }}</p>
              <p v-if="task.submissions?.[0]"><strong>最新提交：</strong>{{ task.submissions[0].summary }}</p>
            </div>
            <div class="task-actions">
              <el-button v-if="!['COMPLETED','CANCELLED','VERIFIED'].includes(task.status)" :type="task.priority === 'URGENT' ? 'danger' : 'default'" @click="setTeamTaskUrgency(task, task.priority !== 'URGENT')">{{ task.priority === "URGENT" ? "取消紧急" : "标记紧急" }}</el-button>
              <el-button v-if="task.status === 'REVIEW'" type="primary" @click="openTeamReview(task)">审核成果</el-button>
            </div>
          </article>
          <el-empty v-if="!teamTasks.length" description="还没有安排协作任务" />
        </section>
      </template>

      <template v-else-if="active === 'data'">
        <section class="data-hero">
          <div>
            <p class="eyebrow">BRAND DATA CENTER</p>
            <h2>从品牌资产到爆款内容，一站完成</h2>
            <p>每位员工都可检索全量可用素材与知识，使用智能关键词、爆款研究和视频工厂直接形成执行方案。</p>
          </div>
          <div class="data-hero-actions">
            <el-button v-if="can('ASSET_UPLOAD')" type="primary" @click="uploadVisible = true">上传素材</el-button>
            <el-button v-if="can('KNOWLEDGE_SUBMIT')" @click="knowledgeVisible = true">补充知识</el-button>
          </div>
        </section>

        <section class="data-module-nav">
          <button :class="{ active: dataCenterTab === 'assets' }" @click="dataCenterTab = 'assets'"><el-icon><Files /></el-icon><span>素材库</span><b>{{ dataCenter.summary.assets || 0 }}</b><small>全库检索与调用</small></button>
          <button :class="{ active: dataCenterTab === 'knowledge' }" @click="dataCenterTab = 'knowledge'"><el-icon><Collection /></el-icon><span>品牌知识</span><b>{{ dataCenter.summary.knowledge || 0 }}</b><small>产品、FAQ与SOP</small></button>
          <button :class="{ active: dataCenterTab === 'keywords' }" @click="dataCenterTab = 'keywords'"><el-icon><Search /></el-icon><span>智能关键词</span><b>{{ dataCenter.summary.keywords || 0 }}</b><small>选题和流量方向</small></button>
          <button :class="{ active: dataCenterTab === 'viral' }" @click="dataCenterTab = 'viral'"><el-icon><DataAnalysis /></el-icon><span>爆款研究</span><b>{{ dataCenter.summary.viralVideos || 0 }}</b><small>结构拆解与仿拍</small></button>
          <button :class="{ active: dataCenterTab === 'videoFactory' }" @click="dataCenterTab = 'videoFactory'"><el-icon><VideoCamera /></el-icon><span>视频工厂</span><b>{{ dataCenter.summary.videoProjects || 0 }}</b><small>脚本与执行包</small></button>
        </section>

        <section v-if="['assets','knowledge','keywords'].includes(dataCenterTab)" class="section-card data-toolbar">
          <div class="data-search" :class="{ compact: dataCenterTab !== 'assets' }">
            <el-input v-model="dataCenterFilters.query" clearable placeholder="搜索名称、编号、内容或知识">
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-input v-model="dataCenterFilters.model" clearable placeholder="产品型号，如 W9" />
            <el-select v-if="dataCenterTab === 'assets'" v-model="dataCenterFilters.kind" clearable placeholder="素材类型">
              <el-option label="图片" value="IMAGE" />
              <el-option label="视频" value="VIDEO" />
              <el-option label="文档" value="DOCUMENT" />
              <el-option label="音频" value="AUDIO" />
            </el-select>
            <el-select v-if="dataCenterTab === 'assets'" v-model="dataCenterFilters.moduleType" clearable placeholder="视频模块">
              <el-option v-for="item in ['HOOK','PAIN','SCENE','FEATURE','BENEFIT','PROOF','DEMO','TRAFFIC','OFFER','CTA','ENDING']" :key="item" :label="item" :value="item" />
            </el-select>
            <el-button type="primary" @click="loadDataCenter">查找</el-button>
          </div>
        </section>

        <section v-if="dataCenterTab === 'assets'">
          <div class="workspace-summary"><strong>素材检索结果 {{ dataCenter.summary.assetResults || 0 }} 条</strong><span>全库可用素材 {{ dataCenter.summary.assets || 0 }} 条，按评级优先展示；输入型号、场景或模块可检索全库。</span></div>
          <div class="asset-grid">
            <article v-for="asset in dataCenter.assets" :key="asset.id" class="asset-card">
              <div class="asset-thumb">
                <img v-if="asset.thumbnailUrl" :src="asset.thumbnailUrl" :alt="asset.displayName || asset.assetNo" />
                <el-icon v-else><Files /></el-icon>
                <b>{{ asset.grade || "B" }}</b>
              </div>
              <div class="asset-copy">
                <div class="task-meta"><span>{{ asset.kind || "素材" }}</span><span>{{ asset.model || asset.productScope || "通用" }}</span><span>{{ asset.qualityScore || 0 }}分</span></div>
                <h4>{{ asset.displayName || asset.fileName || asset.assetNo }}</h4>
                <p>{{ asset.contentDescription || asset.searchText || "已审核可调用素材" }}</p>
                <small>{{ asset.assetNo }}</small>
              </div>
            </article>
            <el-empty v-if="!dataCenter.assets?.length" description="没有找到符合条件的可用素材" />
          </div>
        </section>

        <section v-else-if="dataCenterTab === 'knowledge'" class="section-card knowledge-list">
          <article v-for="item in dataCenter.knowledge" :key="item.id">
            <div class="knowledge-type">{{ item.type || "知识" }}</div>
            <div>
              <div class="task-meta"><span>{{ item.category || "未分类" }}</span><span>{{ item.model || "品牌通用" }}</span></div>
              <h4>{{ item.title }}</h4>
              <p>{{ item.summary || item.reply || item.body || "已审核知识" }}</p>
            </div>
          </article>
          <el-empty v-if="!dataCenter.knowledge?.length" description="没有找到符合条件的知识" />
        </section>

        <section v-else-if="dataCenterTab === 'keywords'" class="keyword-workspace">
          <div class="workspace-summary"><strong>智能关键词 {{ dataCenter.keywords?.total || 0 }} 条</strong><span>按机会分和优先级排序，点击“用于视频”即可带入视频工厂。</span></div>
          <div class="keyword-grid">
            <article v-for="keyword in dataCenter.keywords?.items || []" :key="keyword.id">
              <div><el-tag :type="keyword.grade === 'S' ? 'danger' : keyword.grade === 'A' ? 'warning' : 'info'">{{ keyword.grade || keyword.priority || 'B' }}</el-tag><small>{{ platformLabel(keyword.platform) }} · {{ keyword.type }}</small></div>
              <h4>{{ keyword.keyword }}</h4>
              <p>{{ keyword.reason || [keyword.audience, keyword.pain, keyword.scene].filter(Boolean).join(" · ") || "可用于内容选题与平台搜索" }}</p>
              <div class="keyword-score"><span>机会分</span><strong>{{ Number(keyword.opportunityScore || 0).toFixed(0) }}</strong></div>
              <el-button type="primary" plain @click="useKeywordInFactory(keyword)">用于视频</el-button>
            </article>
          </div>
          <el-empty v-if="!dataCenter.keywords?.items?.length" description="当前没有符合条件的关键词" />
        </section>

        <section v-else-if="dataCenterTab === 'viral'" class="viral-workspace">
          <div class="metric-grid viral-metrics">
            <article><span>12小时视频</span><strong>{{ dataCenter.viralTrend?.summary?.total || 0 }}</strong></article>
            <article><span>速度达标</span><strong>{{ dataCenter.viralTrend?.summary?.candidates || 0 }}</strong></article>
            <article><span>S级趋势</span><strong>{{ dataCenter.viralTrend?.summary?.sGrade || 0 }}</strong></article>
            <article><span>A级观察</span><strong>{{ dataCenter.viralTrend?.summary?.aGrade || 0 }}</strong></article>
          </div>
          <div class="section-card viral-keywords">
            <div class="section-heading"><div><h3>今日研究关键词</h3><p>由产品、痛点、竞品与场景自动生成。</p></div><span>更新 {{ formatTime(dataCenter.viralTrend?.summary?.lastSyncAt) }}</span></div>
            <div class="chip-list"><span v-for="keyword in dataCenter.viralKeywords?.keywords || []" :key="keyword.id">{{ keyword.keyword }}</span></div>
          </div>
          <div class="section-card viral-list">
            <article v-for="video in dataCenter.viralTrend?.items || []" :key="video.id">
              <div class="viral-grade">{{ video.latestMetric?.viralGrade || "C" }}<small>{{ Number(video.latestMetric?.viralIndex || 0).toFixed(0) }}</small></div>
              <div class="viral-copy">
                <div class="task-meta"><span>{{ platformLabel(video.platform) }}</span><span>{{ video.author?.nickname || video.accountName || "未知作者" }}</span><span>{{ formatTime(video.publishedAt) }}</span></div>
                <h4>{{ video.title || video.externalContentId }}</h4>
                <p>播放 {{ compactNumber(video.latestMetric?.views) }} · 速度 {{ compactNumber(video.latestMetric?.playVelocity) }}/小时 · 互动 {{ percent(video.latestMetric?.engagementRate) }}</p>
                <small>命中：{{ video.keywordHits?.map((item: Row) => item.keyword?.keyword).filter(Boolean).join("、") || "未关联关键词" }}</small>
              </div>
              <div class="viral-actions">
                <el-button v-if="video.sourceUrl" @click="openExternal(video.sourceUrl)">查看原视频</el-button>
                <el-button type="primary" @click="useViralVideoInFactory(video)">生成仿拍方案</el-button>
              </div>
            </article>
            <el-empty v-if="!dataCenter.viralTrend?.items?.length" description="暂无12小时爆款数据，等待采集任务同步" />
          </div>
        </section>

        <section v-else class="video-factory-workspace">
          <div v-if="canGenerateVideoScript" class="section-card factory-capabilities">
            <div class="section-heading"><div><h3>视频脚本生成</h3><p>运营和视频专员可直接生成脚本，继续进入现有脚本审核流程。</p></div><el-tag type="success">运营 / 视频专员</el-tag></div>
            <div class="factory-capability-form">
              <el-input v-model="videoFactoryForm.productModel" placeholder="产品型号；无需补拍模式必填" />
              <el-select v-model="videoFactoryForm.platform"><el-option label="抖音" value="DOUYIN" /><el-option label="TikTok" value="TIKTOK" /></el-select>
              <el-select v-model="videoScriptMode">
                <el-option label="普通脚本（优先复用素材）" value="ASSET_FIRST" />
                <el-option label="无需补拍快速成片" value="ASSET_ONLY" />
              </el-select>
              <el-select v-model="videoScriptRestriction">
                <el-option label="普通内容" value="NORMAL" />
                <el-option label="健康内容受限" value="HEALTH_RESTRICTED" />
              </el-select>
              <el-button type="primary" :loading="generatingVideoScript" @click="generateWorkbenchVideoScript">{{ videoScriptMode === "ASSET_ONLY" ? "生成无需补拍脚本" : "生成视频脚本" }}</el-button>
            </div>
            <el-alert v-if="videoScriptMode === 'ASSET_ONLY'" title="只使用素材库已有视频素材；素材无法完整覆盖时不会伪造脚本，将明确提示缺少素材。" type="info" :closable="false" />
            <div v-if="dataCenter.videoScripts?.length" class="factory-script-list">
              <article v-for="script in dataCenter.videoScripts.slice(0, 6)" :key="script.id">
                <div><strong>{{ script.topic }}</strong><span>{{ script.productModel || "通用" }} · {{ statusLabels[script.status] || script.status }}</span></div>
                <el-tag size="small" :type="script.sourceSignals?.[0]?.generationMode === 'ASSET_ONLY' ? 'success' : 'info'">{{ script.sourceSignals?.[0]?.generationMode === "ASSET_ONLY" ? "无需补拍" : "优先复用素材" }}</el-tag>
              </article>
            </div>
          </div>

          <div v-if="canGenerateVideoScript" class="section-card factory-capabilities">
            <div class="section-heading"><div><h3>AI缺失素材分析</h3><p>按产品型号读取当前素材索引，列出真正缺少的画面，并生成补拍任务。</p></div></div>
            <div class="gap-analysis-form">
              <el-input v-model="videoFactoryForm.productModel" placeholder="输入已审核产品型号，如 W9" />
              <el-button type="primary" :loading="analyzingAssetGaps" @click="analyzeWorkbenchAssetGaps">分析缺失素材</el-button>
            </div>
            <el-checkbox-group v-if="assetGaps.length" v-model="selectedAssetGapIds" class="gap-result-list">
              <el-checkbox v-for="gap in assetGaps" :key="gap.id" :value="gap.id">
                <strong>{{ gap.category }}</strong><span>{{ gap.assetKind }} · {{ gap.severity }} · {{ gap.recommendation }}</span>
              </el-checkbox>
            </el-checkbox-group>
            <div v-if="assetGaps.length" class="gap-task-action"><span>已选择 {{ selectedAssetGapIds.length }} 项</span><el-button type="primary" :disabled="!selectedAssetGapIds.length" :loading="creatingGapTasks" @click="createWorkbenchGapTasks">生成补拍任务</el-button></div>
          </div>

          <div class="section-card factory-create">
            <div class="section-heading"><div><h3>新建智能视频项目</h3><p>可直接填写主题，也可从关键词或爆款研究一键带入。</p></div><el-tag type="success">员工可用</el-tag></div>
            <div class="factory-form">
              <el-select v-model="videoFactoryForm.platform" placeholder="目标平台"><el-option label="抖音" value="DOUYIN" /><el-option label="TikTok" value="TIKTOK" /></el-select>
              <el-input v-model="videoFactoryForm.productModel" placeholder="产品型号，如 W9" />
              <el-input v-model="videoFactoryForm.audience" placeholder="目标人群，如 子女送父母" />
              <el-input v-model="videoFactoryForm.topic" placeholder="视频主题或关键词" />
              <el-input v-model="videoFactoryForm.objective" placeholder="内容目标" />
              <el-button type="primary" :loading="creatingVideoProject" @click="createVideoProject">生成3个视频方向</el-button>
            </div>
            <div v-if="videoFactoryForm.keywordIds.length || videoFactoryForm.externalVideoIds.length" class="factory-context">
              已带入 {{ videoFactoryForm.keywordIds.length }} 个关键词、{{ videoFactoryForm.externalVideoIds.length }} 条爆款参考
            </div>
          </div>

          <div class="factory-projects">
            <article v-for="project in dataCenter.videoProjects || []" :key="project.id" class="section-card factory-project">
              <div class="factory-project-head">
                <div><div class="task-meta"><span>{{ platformLabel(project.targetPlatforms?.[0]) }}</span><span>{{ project.productModel || "品牌通用" }}</span><span>{{ project.productionNo }}</span></div><h3>{{ project.topic }}</h3></div>
                <el-tag>{{ project.productionStage || "脚本已生成" }}</el-tag>
              </div>
              <div class="candidate-grid">
                <article v-for="(candidate, index) in projectCandidates(project)" :key="`${project.id}-${index}`">
                  <small>方向 {{ Number(index) + 1 }} · {{ candidate.score || 0 }}分</small>
                  <h4>{{ candidate.topic }}</h4>
                  <p><b>HOOK：</b>{{ candidate.hook }}</p>
                  <p>{{ candidate.scripts?.zh15 || candidate.outline?.join("；") }}</p>
                  <el-button type="primary" plain :loading="generatingProjectId === project.id" @click="generateVideoProject(project, Number(index))">生成拍摄执行包</el-button>
                </article>
              </div>
              <div v-if="project.videoShots?.length" class="shot-summary">已形成 {{ project.videoShots.length }} 个镜头任务 · {{ project.videoShots.filter((shot: Row) => !shot.selectedAssetId).length }} 个镜头待补拍或生成</div>
            </article>
            <el-empty v-if="!dataCenter.videoProjects?.length" description="暂无视频项目，可从关键词、爆款研究或上方表单开始" />
          </div>
        </section>
      </template>

      <template v-else-if="active === 'live'">
        <section v-if="liveData.roleEnabled" class="live-layout">
          <article class="hero live-hero">
            <div><p class="eyebrow">LIVE HOST CENTER</p><h2>每场直播都形成可复用经验</h2><p>开播前学产品和话术，直播后提交数据，AI给出下一场优化建议。</p></div>
            <el-button type="primary" @click="switchPage('tasks')">查看直播任务</el-button>
          </article>
          <section class="split-grid">
            <article class="section-card">
              <div class="section-title"><div><p class="eyebrow">LEARNING</p><h3>直播知识</h3></div></div>
              <div class="learning-list">
                <div v-for="course in liveData.courses" :key="course.id">
                  <el-icon><Collection /></el-icon>
                  <div><strong>{{ course.title }}</strong><p>{{ course.summary || course.category }}</p></div>
                </div>
              </div>
              <el-empty v-if="!liveData.courses?.length" description="暂无已审核直播知识" />
            </article>
            <article class="section-card">
              <div class="section-title"><div><p class="eyebrow">REVIEW</p><h3>直播任务与复盘</h3></div></div>
              <div class="compact-list">
                <div v-for="task in liveData.reviews" :key="task.id">
                  <div>
                    <strong>{{ task.title }}</strong>
                    <span>{{ statusLabels[task.status] || task.status }} · {{ formatTime(task.dueAt) }}</span>
                    <div v-if="liveOptimization(task)?.summary" class="ai-coach">
                      <b>AI复盘：{{ liveOptimization(task)?.summary }}</b>
                      <p v-for="(action, index) in liveOptimization(task)?.nextActions || []" :key="index">{{ index + 1 }}. {{ action.action }}</p>
                    </div>
                  </div>
                  <el-button size="small" @click="switchPage('tasks')">处理</el-button>
                </div>
              </div>
              <el-empty v-if="!liveData.reviews?.length" description="暂无直播任务" />
            </article>
          </section>
        </section>
        <el-empty v-else description="当前账号未分配主播岗位" />
      </template>

      <template v-else-if="active === 'messages'">
        <section class="section-card message-list">
          <article v-for="notice in notices" :key="notice.id" :class="{ unread: !notice.readAt }" @click="readNotice(notice)">
            <el-icon><Bell /></el-icon>
            <div><strong>{{ notice.title }}</strong><p>{{ notice.content }}</p><span>{{ formatTime(notice.createdAt) }}</span></div>
          </article>
          <el-empty v-if="!notices.length" description="暂无消息" />
        </section>
      </template>
    </main>

    <nav class="bottom-nav">
      <button :class="{active: active === 'home'}" @click="switchPage('home')"><el-icon><House /></el-icon><span>今日</span></button>
      <button :class="{active: active === 'tasks'}" @click="switchPage('tasks')"><el-icon><DocumentChecked /></el-icon><span>任务</span></button>
      <button v-if="isCollaborator" :class="{active: active === 'team'}" @click="switchPage('team')"><el-icon><DocumentChecked /></el-icon><span>协作</span></button>
      <button v-if="canUseDataCenter" :class="{active: active === 'data'}" @click="switchPage('data')"><el-icon><Files /></el-icon><span>数据</span></button>
      <button v-if="isLiveHost" :class="{active: active === 'live'}" @click="switchPage('live')"><el-icon><VideoCamera /></el-icon><span>直播</span></button>
      <button :class="{active: active === 'messages'}" @click="switchPage('messages')"><el-icon><Bell /></el-icon><span>消息</span><i v-if="dashboard.summary.unread">{{ dashboard.summary.unread }}</i></button>
    </nav>
  </div>

  <el-dialog v-model="inviteVisible" title="邀请协作成员" width="min(520px, 92vw)">
    <el-form label-position="top">
      <el-form-item label="选择运营" required>
        <el-select v-model="inviteForm.recipientEmployeeId" filterable placeholder="搜索运营、视频专员或设计">
          <el-option v-for="employee in operationTeam.operators" :key="employee.id" :label="`${employee.name} · ${collaborationRoleLabel(employee)}`" :value="employee.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="关系说明"><el-input v-model="inviteForm.relationshipNote" type="textarea" :rows="3" placeholder="例如：负责协助短视频排期、素材跟进和发布复盘" /></el-form-item>
      <p class="muted">运营、视频专员和设计均可接受邀请；如果对方已有上级运营，会明确替换原关系。</p>
    </el-form>
    <template #footer><el-button @click="inviteVisible = false">取消</el-button><el-button type="primary" @click="sendTeamInvite">发送邀请</el-button></template>
  </el-dialog>

  <el-dialog v-model="teamTaskVisible" title="安排运营协作任务" width="min(620px, 92vw)">
    <el-form label-position="top">
      <el-form-item label="协作成员" required><el-select v-model="teamTaskForm.assigneeEmployeeId"><el-option v-for="employee in operationTeam.directReports" :key="employee.id" :label="`${employee.name} · ${collaborationRoleLabel(employee)}`" :value="employee.id" /></el-select></el-form-item>
      <el-form-item label="任务标题" required><el-input v-model="teamTaskForm.title" /></el-form-item>
      <el-form-item label="工作要求"><el-input v-model="teamTaskForm.description" type="textarea" :rows="3" /></el-form-item>
      <el-form-item label="期望交付结果"><el-input v-model="teamTaskForm.expectedResult" type="textarea" :rows="2" /></el-form-item>
      <div class="team-form-row">
        <el-form-item label="优先级"><el-select v-model="teamTaskForm.priority"><el-option label="紧急" value="URGENT" /><el-option label="高" value="HIGH" /><el-option label="普通" value="MEDIUM" /><el-option label="低" value="LOW" /></el-select></el-form-item>
        <el-form-item label="截止时间"><el-date-picker v-model="teamTaskForm.dueAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item>
      </div>
      <el-form-item label="附件链接（每行一个）"><el-input v-model="teamTaskForm.attachments" type="textarea" :rows="2" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="teamTaskVisible = false">取消</el-button><el-button type="primary" @click="createTeamTask">安排任务</el-button></template>
  </el-dialog>

  <el-dialog v-model="reviewVisible" title="审核运营任务成果" width="min(560px, 92vw)">
    <el-form label-position="top">
      <el-form-item label="审核结果"><el-radio-group v-model="reviewForm.action"><el-radio-button value="APPROVE">审核通过</el-radio-button><el-radio-button value="RETURN">退回修改</el-radio-button></el-radio-group></el-form-item>
      <el-form-item label="审核说明"><el-input v-model="reviewForm.note" type="textarea" :rows="4" :placeholder="reviewForm.action === 'RETURN' ? '请填写具体修改要求' : '可填写确认说明'" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="reviewVisible = false">取消</el-button><el-button type="primary" @click="reviewTeamTask">确认</el-button></template>
  </el-dialog>

  <el-dialog v-model="submitVisible" title="提交任务成果" width="min(560px, 92vw)">
    <el-form label-position="top">
      <el-form-item label="成果说明" required><el-input v-model="submitForm.summary" type="textarea" :rows="4" placeholder="说明完成了什么、产出位置和需要审核的重点" /></el-form-item>
      <el-form-item label="关联素材编号"><el-input v-model="submitForm.assetId" placeholder="例如 SD-VIDEO-..." /></el-form-item>
      <template v-if="activeTask?.category?.startsWith('LIVE')">
        <el-form-item label="直播关键数据"><el-input v-model="submitForm.metrics" type="textarea" :rows="3" placeholder="在线、停留、点击、成交等" /></el-form-item>
        <el-form-item label="下一场优化动作"><el-input v-model="submitForm.improvements" type="textarea" :rows="3" /></el-form-item>
      </template>
    </el-form>
    <template #footer><el-button @click="submitVisible = false">取消</el-button><el-button type="primary" @click="submitTask">提交审核</el-button></template>
  </el-dialog>

  <el-dialog v-model="uploadVisible" title="上传新素材" width="min(560px, 92vw)">
    <el-form label-position="top">
      <el-form-item label="选择文件" required><input type="file" @change="uploadFile = ($event.target as HTMLInputElement).files?.[0]" /></el-form-item>
      <el-form-item label="关联型号"><el-input v-model="uploadForm.model" placeholder="可不填，AI将自动识别" /></el-form-item>
      <el-form-item label="一句话说明"><el-input v-model="uploadForm.name" placeholder="例如 W9家庭场景佩戴演示" /></el-form-item>
      <el-form-item label="来源"><el-select v-model="uploadForm.source"><el-option label="员工原创" value="员工原创" /><el-option label="AI生成" value="AI生成" /><el-option label="外部参考" value="外部参考" /></el-select></el-form-item>
    </el-form>
    <template #footer><el-button @click="uploadVisible = false">取消</el-button><el-button type="primary" @click="submitAsset">上传并AI分析</el-button></template>
  </el-dialog>

  <el-dialog v-model="knowledgeVisible" title="补充知识或FAQ" width="min(600px, 92vw)">
    <el-form label-position="top">
      <el-form-item label="标题" required><el-input v-model="knowledgeForm.title" /></el-form-item>
      <el-form-item label="类型"><el-select v-model="knowledgeForm.type"><el-option label="FAQ问答" value="FAQ" /><el-option label="产品知识" value="PRODUCT" /><el-option label="直播知识" value="SOP" /><el-option label="行业知识" value="INDUSTRY" /></el-select></el-form-item>
      <el-form-item label="分类" required><el-input v-model="knowledgeForm.category" /></el-form-item>
      <el-form-item label="关联型号"><el-input v-model="knowledgeForm.model" /></el-form-item>
      <el-form-item label="标准回复"><el-input v-model="knowledgeForm.reply" type="textarea" :rows="4" /></el-form-item>
      <el-form-item label="完整正文"><el-input v-model="knowledgeForm.body" type="textarea" :rows="5" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="knowledgeVisible = false">取消</el-button><el-button type="primary" @click="submitKnowledge">提交审核</el-button></template>
  </el-dialog>
</template>
