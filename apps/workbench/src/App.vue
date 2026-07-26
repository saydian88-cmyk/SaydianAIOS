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
});
const dataCenterTab = ref("assets");
const dataCenterFilters = reactive({
  query: "",
  model: "",
  kind: "",
  moduleType: "",
  minimumScore: "60",
});

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
const can = (permission: string) => Boolean(user.value?.permissions.includes("*") || user.value?.permissions.includes(permission));
const canUseDataCenter = computed(() => can("DATA_CENTER_VIEW"));
const navigation = computed(() => [
  { key: "home", label: "今日工作", icon: House, visible: true },
  { key: "tasks", label: "任务中心", icon: DocumentChecked, visible: true },
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

async function loadLive() {
  Object.assign(liveData, await api<Row>("/api/v1/workbench/live/learning"));
}

async function loadNotices() {
  notices.value = await api<Row[]>("/api/v1/workbench/notifications");
}

async function loadDataCenter() {
  const parameters = new URLSearchParams();
  Object.entries(dataCenterFilters).forEach(([key, value]) => {
    if (value) parameters.set(key, value);
  });
  Object.assign(dataCenter, await api<Row>(`/api/v1/workbench/data-center?${parameters.toString()}`));
}

async function switchPage(page: string) {
  active.value = page;
  if (page === "home") await loadDashboard();
  if (page === "tasks") await loadTasks();
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

      <template v-else-if="active === 'data'">
        <section class="data-hero">
          <div>
            <p class="eyebrow">BRAND DATA CENTER</p>
            <h2>查素材、学知识，直接为任务服务</h2>
            <p>只展示已审核、可调用的数据；不同岗位按权限看到素材、知识和待整理内容。</p>
          </div>
          <div class="data-hero-actions">
            <el-button v-if="can('ASSET_UPLOAD')" type="primary" @click="uploadVisible = true">上传素材</el-button>
            <el-button v-if="can('KNOWLEDGE_SUBMIT')" @click="knowledgeVisible = true">补充知识</el-button>
          </div>
        </section>

        <section class="metric-grid data-metrics">
          <article><span>可用素材</span><strong>{{ dataCenter.summary.assets || 0 }}</strong></article>
          <article><span>S/A级素材</span><strong>{{ dataCenter.summary.priorityAssets || 0 }}</strong></article>
          <article><span>已审核知识</span><strong>{{ dataCenter.summary.knowledge || 0 }}</strong></article>
          <article v-if="can('ASSET_CURATE')"><span>待整理素材</span><strong>{{ dataCenter.summary.pending || 0 }}</strong></article>
        </section>

        <section class="section-card data-toolbar">
          <div class="data-search">
            <el-input v-model="dataCenterFilters.query" clearable placeholder="搜索名称、编号、内容或知识">
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-input v-model="dataCenterFilters.model" clearable placeholder="产品型号，如 W9" />
            <el-select v-model="dataCenterFilters.kind" clearable placeholder="素材类型">
              <el-option label="图片" value="IMAGE" />
              <el-option label="视频" value="VIDEO" />
              <el-option label="文档" value="DOCUMENT" />
              <el-option label="音频" value="AUDIO" />
            </el-select>
            <el-select v-model="dataCenterFilters.moduleType" clearable placeholder="视频模块">
              <el-option v-for="item in ['HOOK','PAIN','SCENE','FEATURE','BENEFIT','PROOF','DEMO','TRAFFIC','OFFER','CTA','ENDING']" :key="item" :label="item" :value="item" />
            </el-select>
            <el-button type="primary" @click="loadDataCenter">查找</el-button>
          </div>
          <el-segmented v-model="dataCenterTab" :options="[{label:'素材库',value:'assets'},{label:'知识库',value:'knowledge'},...(can('ASSET_CURATE')?[{label:'待整理',value:'pending'}]:[])]" />
        </section>

        <section v-if="dataCenterTab === 'assets'" class="asset-grid">
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

        <section v-else class="section-card task-list">
          <article v-for="asset in dataCenter.pendingAssets" :key="asset.id" class="task-card">
            <div class="task-main">
              <div class="task-meta"><span>{{ asset.kind }}</span><span>{{ asset.assetNo }}</span></div>
              <h4>{{ asset.displayName || asset.fileName || "待AI命名素材" }}</h4>
              <p>{{ asset.contentDescription || "请核对型号、分类、版权和AI标签后提交主管审核。" }}</p>
            </div>
            <el-button type="primary" plain @click="switchPage('tasks')">查看整理任务</el-button>
          </article>
          <el-empty v-if="!dataCenter.pendingAssets?.length" description="当前没有待整理素材" />
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
      <button v-if="canUseDataCenter" :class="{active: active === 'data'}" @click="switchPage('data')"><el-icon><Files /></el-icon><span>数据</span></button>
      <button v-if="isLiveHost" :class="{active: active === 'live'}" @click="switchPage('live')"><el-icon><VideoCamera /></el-icon><span>直播</span></button>
      <button :class="{active: active === 'messages'}" @click="switchPage('messages')"><el-icon><Bell /></el-icon><span>消息</span><i v-if="dashboard.summary.unread">{{ dashboard.summary.unread }}</i></button>
    </nav>
  </div>

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
