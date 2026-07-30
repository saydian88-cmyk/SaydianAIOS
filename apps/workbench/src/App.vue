<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { UploadUserFile } from "element-plus";
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
import { api, clearToken, getToken, post, setToken, uploadWithProgress } from "./api";
import TaskRichTextContent from "./components/TaskRichTextContent.vue";
import TaskRichTextEditor from "./components/TaskRichTextEditor.vue";

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
const latestOutputs = ref<Row[]>([]);
const outputLibrary = ref<Row[]>([]);
const outputCategory = ref("VIDEO");
const outputLibraryLoading = ref(false);
const outputPreviewVisible = ref(false);
const outputPreview = ref<Row>();
const outputPreviewUrl = ref("");
const tasks = ref<Row[]>([]);
const taskScope = ref("MINE");
const taskStatus = ref("");
const taskType = ref("");
const selectedTaskIds = ref<string[]>([]);
const bulkDeletingTasks = ref(false);
const taskDetailVisible = ref(false);
const taskDetail = ref<Row>();
const taskDetailLoading = ref(false);
const taskOutputUrls = reactive<Record<string, string>>({});
const emptyTaskDocument = () => ({ type: "doc", content: [{ type: "paragraph" }] });
const taskEditorDocument = (document: unknown, text: unknown) => {
  if (document && typeof document === "object" && (document as Row).type === "doc" && Array.isArray((document as Row).content)) {
    return JSON.parse(JSON.stringify(document));
  }
  const content = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line
      ? { type: "paragraph", content: [{ type: "text", text: line }] }
      : { type: "paragraph" });
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
};
const selfTaskVisible = ref(false);
const creatingSelfTask = ref(false);
const editingSelfTaskId = ref("");
const copyingSelfTask = ref(false);
const contentTaskOptions = reactive<Row>({ products: [], keywords: [] });
const contentTaskOptionsLoaded = ref(false);
const generatingTaskSuggestion = ref(false);
const selfTaskForm = reactive({
  contentType: "SHORT_VIDEO",
  productId: "",
  keywordId: "",
  platform: "DOUYIN",
  targetAudience: "",
  corePain: "",
  recommendedScene: "",
  hook: "",
  executionMode: "FULL_VIDEO",
  materialStrategy: "REAL_ASSET_FIRST",
  sourceKeywordIds: [] as string[],
  sourceExternalVideoIds: [] as string[],
  title: "",
  description: "",
  descriptionDocument: emptyTaskDocument(),
  expectedResult: "",
  expectedResultDocument: emptyTaskDocument(),
  priority: "MEDIUM",
  dueAt: "",
  recurrenceWeekdays: [] as number[],
  recurrenceDueTime: "23:59",
});
const filteredTaskKeywords = computed(() => (contentTaskOptions.keywords || []).filter((item: Row) => {
  if (selfTaskForm.productId && item.productId && item.productId !== selfTaskForm.productId) return false;
  if (selfTaskForm.platform && String(item.platform) !== selfTaskForm.platform) return false;
  return true;
}));
const videoProjectKeywordOptions = computed<Row[]>(() => {
  const product = (contentTaskOptions.products || []).find((item: Row) => item.modelCode === videoFactoryForm.productModel);
  const rows = [
    ...(contentTaskOptions.viralKeywords || []).map((item: Row) => ({ ...item, sourceLabel: "爆款研究" })),
    ...(contentTaskOptions.keywords || []).map((item: Row) => ({ ...item, sourceLabel: item.sourceLabel || "智能关键词" })),
  ];
  const seen = new Set<string>();
  return rows.filter((item: Row) => {
    const id = String(item.smartKeywordId || item.smartKeyword?.id || item.id || "");
    if (!id || !String(item.keyword || "").trim() || seen.has(id)) return false;
    if (product?.id && item.productId && item.productId !== product.id) return false;
    if (item.platform && String(item.platform) !== videoFactoryForm.platform) return false;
    seen.add(id);
    return true;
  });
});
const operationTeam = reactive<Row>({ supervisor: null, directReports: [], invitations: { incoming: [], outgoing: [] }, operators: [] });
const teamTasks = ref<Row[]>([]);
const receivedTeamTasks = ref<Row[]>([]);
const teamTaskFilters = reactive({ status: "", assigneeEmployeeId: "" });
const teamTaskVisible = ref(false);
const creatingTeamTask = ref(false);
const editingTeamTaskId = ref("");
const copyingTeamTask = ref(false);
const taskRecycleBinVisible = ref(false);
const taskRecycleBinLoading = ref(false);
const taskRecycleItems = ref<Row[]>([]);
const trashingTaskId = ref("");
const restoringTaskId = ref("");
const inviteVisible = ref(false);
const reviewVisible = ref(false);
const reviewTaskRow = ref<Row>();
const teamTaskForm = reactive({
  assigneeEmployeeId: "",
  title: "",
  description: "",
  descriptionDocument: emptyTaskDocument(),
  priority: "MEDIUM",
  dueAt: "",
  recurrenceWeekdays: [] as number[],
  recurrenceDueTime: "23:59",
  expectedResult: "",
  expectedResultDocument: emptyTaskDocument(),
  attachments: "",
});
const inviteForm = reactive({ recipientEmployeeId: "", relationshipNote: "" });
const reviewForm = reactive({ action: "APPROVE", note: "" });
const activeTask = ref<Row>();
const submitVisible = ref(false);
const submitForm = reactive({ summary: "", assetId: "", metrics: "", improvements: "" });
const uploadVisible = ref(false);
const uploadFiles = ref<UploadUserFile[]>([]);
const uploadTechnicalInfo = ref<Row[]>([]);
const uploadForm = reactive({
  sourceType: "EMPLOYEE_CAPTURE",
  purpose: "EDITING_FOOTAGE",
  packagingCategory: "",
  productScope: "UNKNOWN",
  productIds: [] as string[],
  assetKind: "",
  contentDescription: "",
  classificationTags: [] as string[],
  aiRename: true,
  originalStatus: true,
  rightsStatus: "COMMERCIAL",
  acquiredAt: "",
  contentPlanId: "",
  shootRequirementId: "",
});
const uploadAssistState = ref("");
const uploadAssistMessage = ref("");
const uploading = ref(false);
const uploadProgress = ref(0);
const uploadEta = ref("");
const uploadStage = ref("");
const assetPreviewVisible = ref(false);
const assetPreviewTitle = ref("素材预览");
const assetPreviewLoading = ref(false);
const assetPreviewUrl = ref("");
const assetPreviewPosterUrl = ref("");
const assetDetail = ref<Row>();
const assetEditMode = ref(false);
const assetEditSaving = ref(false);
const assetEditForm = reactive({
  displayName: "",
  productScope: "UNKNOWN",
  productIds: [] as string[],
  contentDescription: "",
  scene: "",
  classificationTags: [] as string[],
});
const knowledgeVisible = ref(false);
const knowledgeDetailVisible = ref(false);
const knowledgeDetail = ref<Row>();
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
  pagination: { total: 0, page: 1, pageSize: 30 },
  products: [],
  uploadOptions: { products: [], productionPlans: [] },
});
const dataCenterTab = ref("knowledge");
const dataCenterLoading = ref(false);
const dataCenterUpdatedAt = ref("");
const assetPage = ref(1);
const videoProjectPage = ref(1);
const videoProjectPageSize = 8;
const videoProjectStatus = ref("");
const dataCenterFilters = reactive({
  query: "",
  model: "",
  kind: "",
  purpose: "",
  packagingCategory: "",
  moduleType: "",
  type: "",
  minimumScore: "60",
});
const videoFactoryForm = reactive({
  platform: "DOUYIN",
  voiceoverMode: "VOICEOVER",
  accountType: "BRAND",
  estimatedDurationSeconds: 30,
  healthContentAllowed: true,
  productModel: "",
  topic: "",
  audience: "",
  objective: "种草与转化",
  soundPrompt: "",
  mustShowFacts: "",
  additionalPrompt: "",
  videoType: "",
  keywords: "",
  reference: "",
  hook: "",
  scene: "",
  painPoint: "",
  scriptEngines: ["REMOTE_CODEX", "SYSTEM_AI"] as string[],
  keywordIds: [] as string[],
  externalVideoIds: [] as string[],
});
const videoOptionalOpen = ref(false);
const videoDefaultsOpen = ref(false);
const videoProjectCollapseNames = ref<string[]>([]);
const videoTypeOptions = ["痛点解决型", "场景种草型", "功能演示型", "用户开箱型", "FAQ异议型", "优惠成交型"];
const videoProjectDefaultSummary = computed(() => {
  const platform = platformLabel(videoFactoryForm.platform);
  const duration = `${videoFactoryForm.estimatedDurationSeconds || 30}秒`;
  const account = ({ BRAND: "品牌账号", CREATOR: "达人账号", EMPLOYEE: "员工账号" } as Record<string, string>)[videoFactoryForm.accountType] || "品牌账号";
  const health = videoFactoryForm.healthContentAllowed ? "允许健康内容" : "不允许健康内容";
  const material = videoScriptMode.value === "ASSET_ONLY" ? "仅用已有素材" : "优先已有素材";
  const voiceover = videoFactoryForm.voiceoverMode === "NO_VOICEOVER" ? "无口播" : "有口播";
  return `${platform} · ${duration} · ${account} · ${health} · ${material} · ${voiceover}`;
});
const scriptPackageVisible = ref(false);
const scriptPackageCandidate = ref<Row>();
const scriptEditorVisible = ref(false);
const editingScriptProject = ref<Row>();
const editingScriptCandidateIndex = ref(0);
const savingScript = ref(false);
const scriptEditorForm = reactive({
  title: "",
  hook: "",
  script: "",
  coreTheme: "",
  communicationGoal: "",
  userPainPoint: "",
  uniqueSellingPoint: "",
  voiceoverText: "",
  retentionText: "",
  subtitlesText: "",
  emphasisText: "",
  endingSummary: "",
  endingInteraction: "",
  endingVisual: "",
});
const newVideoProjectVisible = ref(false);
const creatingVideoProject = ref(false);
const reviewingScriptProjectId = ref("");
const generatingProjectId = ref("");
const archivingVideoProjectId = ref("");
const videoRecycleBinVisible = ref(false);
const videoRecycleBinLoading = ref(false);
const videoRecycleProjects = ref<Row[]>([]);
const restoringVideoProjectId = ref("");
const generatingShotId = ref("");
const renderingProjectId = ref("");
const generatingPackagingProjectId = ref("");
const videoReviewVisible = ref(false);
const videoReviewProject = ref<Row>();
const videoReviewJob = ref<Row>();
const reviewingVideoAssetId = ref("");
const videoReviewForm = reactive({ action: "APPROVE", note: "" });
const similarVideoVisible = ref(false);
const similarVideoProject = ref<Row>();
const similarVideoJob = ref<Row>();
const creatingSimilarVideo = ref(false);
const similarVideoForm = reactive({
  replaceHook: true,
  hook: "",
  replaceProduct: false,
  productModel: "",
  replaceFeature: false,
  feature: "",
});
const packagingPreviewVisible = ref(false);
const packagingPreviewVariant = ref<Row>();
const packagingPreviewProject = ref<Row>();
const packagingPreviewUrl = ref("");
const reviewingPackagingVariantId = ref("");
const publishLinkVisible = ref(false);
const publishLinkProject = ref<Row>();
const publishLinkJob = ref<Row>();
const savingPublishLink = ref(false);
const publishPlatformOptions = [
  { value: "DOUYIN", label: "抖音" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "XIAOHONGSHU", label: "小红书" },
  { value: "BILIBILI", label: "B站" },
  { value: "WECHAT_CHANNELS", label: "视频号" },
  { value: "KUAISHOU", label: "快手" },
];
const publishLinkRecords = ref<Array<{ platform: string; remoteUrl: string; publishedAt: string }>>([]);
const expandedVideoProjectIds = ref<string[]>([]);
const activeVideoProjectId = ref("");
const activeVideoProject = computed(() => (dataCenter.videoProjects || []).find((project: Row) => project.id === activeVideoProjectId.value));
const lockedShotUpload = ref<Row>();
const videoScriptMode = ref("ASSET_FIRST");
const videoScriptRestriction = ref("NORMAL");
const analyzingAssetGaps = ref(false);
const creatingGapTasks = ref(false);
const assetGaps = ref<Row[]>([]);
const selectedAssetGapIds = ref<string[]>([]);
const assetGapVisible = ref(false);
const assetGapProductModel = ref("");
let dataCenterRequestId = 0;
const dataCenterCache = new Map<string, { data: Row; cachedAt: number }>();
const dataCenterCacheDbName = "saidian-workbench-cache";
const dataCenterCacheStore = "data-center";

function dataCenterCacheDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dataCenterCacheDbName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(dataCenterCacheStore)) {
        request.result.createObjectStore(dataCenterCacheStore);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readPersistentDataCenterCache(key: string) {
  try {
    const database = await dataCenterCacheDatabase();
    return await new Promise<{ data: Row; cachedAt: number } | undefined>((resolve, reject) => {
      const transaction = database.transaction(dataCenterCacheStore, "readonly");
      const request = transaction.objectStore(dataCenterCacheStore).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
    });
  } catch {
    return undefined;
  }
}

async function writePersistentDataCenterCache(key: string, value: { data: Row; cachedAt: number }) {
  try {
    const database = await dataCenterCacheDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(dataCenterCacheStore, "readwrite");
      transaction.objectStore(dataCenterCacheStore).put(value, key);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // 浏览器禁用持久存储时仍保留当前页面内存缓存。
  }
}

async function deletePersistentDataCenterSection(section: string) {
  try {
    const database = await dataCenterCacheDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(dataCenterCacheStore, "readwrite");
      const store = transaction.objectStore(dataCenterCacheStore);
      const request = store.getAllKeys();
      request.onsuccess = () => {
        for (const key of request.result) {
          if (String(key).includes(`"section":"${section}"`) && String(key).includes(`"employeeId":"${user.value?.id || ""}"`)) {
            store.delete(key);
          }
        }
      };
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // 无持久缓存时无需处理。
  }
}

const classificationOptions = [
  { label: "钩子", value: "HOOK" },
  { label: "痛点", value: "PAIN" },
  { label: "使用场景", value: "SCENE" },
  { label: "功能点", value: "FEATURE" },
  { label: "用户利益", value: "BENEFIT" },
  { label: "信任证明", value: "PROOF" },
  { label: "产品演示", value: "DEMO" },
  { label: "引流", value: "TRAFFIC" },
  { label: "优惠", value: "OFFER" },
  { label: "行动引导", value: "CTA" },
  { label: "结尾", value: "ENDING" },
];

const roleLabels: Record<string, string> = {
  CONTENT_OPERATOR: "运营",
  CONTENT_PRODUCTION: "内容制作",
  CONTENT_VIDEO: "视频制作",
  CONTENT_IMAGE: "图片制作",
  CONTENT_ARTICLE: "软文制作",
  VIDEO_SPECIALIST: "视频专员",
  ASSET_CURATOR: "知识素材整理员",
  DESIGNER: "设计",
  CUSTOMER_SERVICE: "客服",
  LIVE_HOST: "主播",
};
const categoryLabels: Record<string, string> = {
  CONTENT_VIDEO: "短视频",
  CONTENT_IMAGE: "图片",
  CONTENT_ARTICLE: "软文",
  AI_DELIVERY: "AI历史交付",
  GENERAL: "通用任务",
};
const statusLabels: Record<string, string> = {
  OPEN: "待领取",
  ACCEPTED: "待开始",
  IN_PROGRESS: "执行中",
  REVIEW: "待审核",
  RETURNED: "需修改",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  PENDING: "等待执行",
  WAITING_CONFIRMATION: "等待确认",
  WAITING_INPUT: "等待资料",
  CLAIMED: "已领取",
  RUNNING: "Codex处理中",
  QUALITY_CHECK: "自动质检",
  UPLOADING: "上传中",
  PENDING_REVIEW: "成果待审核",
  RETRY: "重试中",
  FAILED: "执行失败",
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
const productOptions = computed<Row[]>(() => {
  const rows = [
    ...(dataCenter.products || []),
    ...(dataCenter.uploadOptions?.products || []),
    ...(contentTaskOptions.products || []),
  ];
  const seen = new Set<string>();
  return rows.filter((item: Row) => {
    const key = String(item.id || item.modelCode || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return item.status !== "INACTIVE";
  });
});
const can = (permission: string) => Boolean(user.value?.permissions.includes("*") || user.value?.permissions.includes(permission));
const canUseDataCenter = computed(() => can("DATA_CENTER_VIEW"));
const navigation = computed(() => [
  { key: "home", label: "今日工作", icon: House, visible: true },
  { key: "tasks", label: "任务中心", icon: DocumentChecked, visible: true },
  { key: "outputs", label: "成品库", icon: Files, visible: true },
  { key: "team", label: "团队协作", icon: DocumentChecked, visible: isCollaborator.value },
  { key: "data", label: "数据中心", icon: Files, visible: canUseDataCenter.value },
  { key: "live", label: "直播学习", icon: VideoCamera, visible: isLiveHost.value },
  { key: "messages", label: "消息通知", icon: Bell, visible: true },
].filter((item) => item.visible));
const pageTitle = computed(() => navigation.value.find((item) => item.key === active.value)?.label || "员工工作台");
const workbenchLocationKey = () => user.value ? `saydian-workbench-location:${user.value.id}` : "";
const validDataCenterTabs = ["knowledge", "assets", "keywords", "viral", "videoFactory"];

function persistWorkbenchLocation() {
  const key = workbenchLocationKey();
  if (!key) return;
  localStorage.setItem(key, JSON.stringify({ page: active.value, dataCenterTab: dataCenterTab.value }));
}

function restoreWorkbenchLocation() {
  const key = workbenchLocationKey();
  if (!key) return;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "{}") as { page?: string; dataCenterTab?: string };
    if (saved.page && navigation.value.some((item) => item.key === saved.page)) active.value = saved.page;
    if (saved.dataCenterTab && validDataCenterTabs.includes(saved.dataCenterTab)) dataCenterTab.value = saved.dataCenterTab;
  } catch {
    localStorage.removeItem(key);
  }
}

watch([active, dataCenterTab], persistWorkbenchLocation);
const selectedProductionPlan = computed(() => dataCenter.uploadOptions.productionPlans
  ?.find((item: Row) => item.id === uploadForm.contentPlanId));
const selectedUploadModels = computed(() => dataCenter.uploadOptions.products
  ?.filter((item: Row) => uploadForm.productIds.includes(item.id))
  .map((item: Row) => item.modelCode) || []);
const assetPreviewType = computed(() => {
  const row = assetDetail.value || {};
  const latest = row.versions?.[0] || {};
  const name = String(latest.fileName || row.fileName || row.displayName || "").toLowerCase();
  const mime = String(latest.mimeType || row.mimeType || "").toLowerCase();
  if (row.kind === "IMAGE" || mime.startsWith("image/")) return "image";
  if (row.kind === "VIDEO" || mime.startsWith("video/")) return "video";
  if (row.kind === "AUDIO" || mime.startsWith("audio/")) return "audio";
  if (/\.(doc|docx|xls|xlsx|ppt|pptx)$/u.test(name)) return "office";
  if (/\.pdf$/u.test(name) || mime === "application/pdf") return "document";
  if (/\.(txt|md)$/u.test(name) || mime.startsWith("text/")) return "document";
  return "unsupported";
});
const assetPreviewEmbedUrl = computed(() => assetPreviewType.value === "office" && assetPreviewUrl.value
  ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(assetPreviewUrl.value)}`
  : assetPreviewUrl.value);

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

function fileSize(value?: number | string) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function durationLabel(value?: number | string) {
  const seconds = Math.max(0, Number(value || 0));
  if (!seconds) return "—";
  const minutes = Math.floor(seconds / 60);
  return `${minutes ? `${minutes}分` : ""}${Math.round(seconds % 60)}秒`;
}

function statusType(status: string) {
  if (status === "COMPLETED") return "success";
  if (["RETURNED", "FAILED", "CANCELLED"].includes(status)) return "danger";
  if (["REVIEW", "PENDING_REVIEW", "WAITING_INPUT", "RETRY"].includes(status)) return "warning";
  if (["IN_PROGRESS", "CLAIMED", "RUNNING", "QUALITY_CHECK", "UPLOADING"].includes(status)) return "primary";
  return "info";
}

function taskDisplayStatus(task: Row) {
  return task.projection?.displayStatus || statusLabels[task.status] || task.status;
}

function taskStatusCode(task: Row) {
  return task.projection?.aiTask?.status || task.status;
}

function isVideoProjectTask(task: Row) {
  return task.sourceType === "VIDEO_PROJECT" || task.category === "VIDEO_PROJECT";
}

function videoProjectTaskStep(task: Row) {
  return Number(task.projection?.project?.step || 1);
}

function videoProjectTaskHint(task: Row) {
  return task.projection?.project?.nextAction || task.projection?.nextAction || "进入项目继续处理";
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
  return ({
    DOUYIN: "抖音",
    TIKTOK: "TikTok",
    XIAOHONGSHU: "小红书",
    BILIBILI: "B站",
    WECHAT_CHANNELS: "视频号",
    KUAISHOU: "快手",
  } as Record<string, string>)[String(value)] || value || "未设置";
}

function projectCandidates(project: Row) {
  const signal = Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  return Array.isArray(project.scriptCandidates) ? project.scriptCandidates : signal?.scriptCandidates || [];
}

function isSingleScriptProject(project: Row) {
  return Number(project.workflowVersion || 0) >= 4;
}

function displayedProjectCandidates(project: Row) {
  return projectCandidates(project);
}

function scriptEngineLabel(candidate: Row) {
  return candidate.generationSource === "SYSTEM_AI" ? "系统 AI 脚本工厂" : "远程 Codex + 剪辑 Skill";
}

function projectScriptEngineStatus(project: Row) {
  const factory = Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  const status = { ...(factory?.scriptEngineStatus || {}) };
  for (const candidate of projectCandidates(project)) {
    const source = String(candidate.generationSource || "");
    if (source === "REMOTE_CODEX" || source === "SYSTEM_AI") status[source] = "COMPLETED";
  }
  return status;
}

function projectWaitingForScripts(project: Row) {
  if (!isSingleScriptProject(project)) return false;
  const factory = Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  const requestedEngines = Array.isArray(factory?.brief?.scriptEngines)
    ? factory.brief.scriptEngines.map((engine: unknown) => String(engine))
    : [];
  if (requestedEngines.length === 0) return false;
  const status = projectScriptEngineStatus(project);
  return requestedEngines.some((engine: string) => status[engine] !== "COMPLETED");
}

function openVideoProject(project: Row) {
  activeVideoProjectId.value = project.id;
  if (!expandedVideoProjectIds.value.includes(project.id)) expandedVideoProjectIds.value.push(project.id);
}

function closeVideoProject() {
  activeVideoProjectId.value = "";
}

const videoFlowSteps = [
  "项目创建",
  "脚本生成",
  "脚本审核",
  "素材补全",
  "视频生成",
  "成片审核",
  "封面标题与发布",
];

function videoFlowStep(project: Row) {
  if (projectWaitingForScripts(project)) return 2;
  const stage = String(project.productionStage || "");
  if (["PROJECT_BRIEF", "SCRIPT_GENERATING", "SCRIPT_RETURNED"].includes(stage)) return 2;
  if (["FACTORY_SCRIPT_READY"].includes(stage)) return 3;
  if (["SCRIPT_APPROVED", "FACTORY_GENERATING", "MATERIAL_REVIEW", "MATERIAL_RETURNED", "READY_TO_EDIT"].includes(stage)) return 4;
  if (["EDITING"].includes(stage)) return 5;
  if (["VIDEO_REVIEW"].includes(stage)) return 6;
  if (["PLATFORM_PACKAGING", "PACKAGING_REVIEW", "READY_TO_PUBLISH", "PUBLISHING", "TRACKING"].includes(stage)) return 7;
  return 1;
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
  void loadLatestOutputs();
}

async function loadLatestOutputs() {
  try {
    const result = await api<Row>("/api/v1/workbench/outputs?limit=5");
    latestOutputs.value = result.items || [];
  } catch {
    latestOutputs.value = [];
  }
}

async function loadOutputLibrary(category = outputCategory.value) {
  outputCategory.value = category;
  outputLibraryLoading.value = true;
  try {
    const result = await api<Row>(`/api/v1/workbench/outputs?type=${category}&limit=60`);
    outputLibrary.value = result.items || [];
  } finally {
    outputLibraryLoading.value = false;
  }
}

async function openOutputLibrary(category: string) {
  active.value = "outputs";
  await loadOutputLibrary(category);
}

function outputCategoryLabel(output: Row) {
  if (isVideoOutput(output)) return "视频";
  if (isImageOutput(output)) return "图片";
  return "软文";
}

async function openSystemOutput(output: Row) {
  outputPreview.value = output;
  outputPreviewUrl.value = "";
  outputPreviewVisible.value = true;
  if (!output.assetId && !output.url) return;
  try {
    const result = await api<Row>(`/api/v1/workbench/outputs/${output.id}/url`);
    outputPreviewUrl.value = result.url || "";
  } catch {
    // 软文和报告可直接使用结构化内容预览。
  }
}

async function recreateSystemOutput() {
  const output = outputPreview.value;
  if (!output) return;
  outputPreviewVisible.value = false;
  await openSelfTask();
  const input = output.aiTask?.input || {};
  const contentType = isVideoOutput(output) ? "SHORT_VIDEO" : isImageOutput(output) ? "IMAGE" : "ARTICLE";
  Object.assign(selfTaskForm, {
    contentType,
    productId: output.aiTask?.productId || "",
    platform: output.aiTask?.platform || "DOUYIN",
    targetAudience: input.targetAudience || input.audience || "",
    corePain: input.corePain || input.painPoint || "",
    recommendedScene: input.recommendedScene || input.scene || "",
    hook: input.hook || "",
    title: `${output.title} · 重新创作`,
    description: output.aiTask?.instructions || `基于已审核成果“${output.title}”调整参数后重新创作。`,
  });
  selfTaskForm.descriptionDocument = taskEditorDocument(null, selfTaskForm.description);
}

async function loadTasks() {
  loading.value = true;
  try {
    const parameters = new URLSearchParams({ scope: taskScope.value });
    if (taskStatus.value) parameters.set("status", taskStatus.value);
    if (taskType.value) parameters.set("taskType", taskType.value);
    tasks.value = await api<Row[]>(`/api/v1/workbench/tasks?${parameters.toString()}`);
    selectedTaskIds.value = selectedTaskIds.value.filter((id) => tasks.value.some((task) => task.id === id && task.sourceType === "SELF_CREATED" && task.status === "CANCELLED"));
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
  if (creatingTeamTask.value) return;
  if (!teamTaskForm.assigneeEmployeeId || !teamTaskForm.title.trim()) return ElMessage.warning("请选择协作成员并填写任务标题");
  creatingTeamTask.value = true;
  try {
    const payload = {
      ...teamTaskForm,
      attachments: teamTaskForm.attachments.split("\n").map((item) => item.trim()).filter(Boolean),
    };
    if (editingTeamTaskId.value) {
      await api(`/api/v1/workbench/operation-team/tasks/${editingTeamTaskId.value}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } else {
      await post("/api/v1/workbench/operation-team/tasks", payload);
    }
    teamTaskVisible.value = false;
    ElMessage.success(editingTeamTaskId.value
      ? "任务修改已同步通知协作成员"
      : copyingTeamTask.value
        ? "任务已复制并重新安排"
        : "任务已推送到协作成员的任务列表");
    editingTeamTaskId.value = "";
    copyingTeamTask.value = false;
    await loadOperationTeam();
  } finally {
    creatingTeamTask.value = false;
  }
}

function openScriptPackage(candidate: Row) {
  scriptPackageCandidate.value = candidate;
  scriptPackageVisible.value = true;
}

async function openVideoProjectFromTask(task: Row) {
  active.value = "data";
  dataCenterTab.value = "videoFactory";
  await loadDataCenter();
  const projectId = task.sourceId || task.evidence?.contentPlanId;
  const project = (dataCenter.videoProjects || []).find((item: Row) => item.id === projectId);
  if (project) {
    openVideoProject(project);
    return;
  }
  ElMessage.warning("项目不在当前缓存中，请在视频工厂手动重新拉取后查看");
}

async function quickCreateProject(command: string) {
  if (command === "VIDEO") {
    await openNewVideoProjectDialog();
    return;
  }
  ElMessage.info(command === "IMAGE" ? "图文项目稍后完善" : "软文项目稍后完善");
}

function openScriptEditor(project: Row, candidate: Row, candidateIndex = 0) {
  const scriptPackage = candidate.scriptPackage || {};
  const positioning = scriptPackage.positioning || {};
  const ending = scriptPackage.ending || {};
  editingScriptProject.value = project;
  editingScriptCandidateIndex.value = candidateIndex;
  Object.assign(scriptEditorForm, {
    title: candidate.titleZh || candidate.title || candidate.topic || project.topic || "",
    hook: candidate.hook || scriptPackage.goldenHook?.copy || "",
    script: candidate.scripts?.zh30 || candidate.scripts?.zh15 || candidate.script || "",
    coreTheme: positioning.coreTheme || "",
    communicationGoal: positioning.communicationGoal || "",
    userPainPoint: positioning.userPainPoint || "",
    uniqueSellingPoint: positioning.uniqueSellingPoint || "",
    voiceoverText: (scriptPackage.voiceoverLines || []).map((item: Row) => item.text).filter(Boolean).join("\n"),
    retentionText: (scriptPackage.retentionDesign || []).join("\n"),
    subtitlesText: (scriptPackage.subtitles || []).join("\n"),
    emphasisText: (scriptPackage.emphasisTexts || []).join("\n"),
    endingSummary: ending.summary || "",
    endingInteraction: ending.interaction || "",
    endingVisual: ending.visual || "",
  });
  scriptEditorVisible.value = true;
}

async function saveEditedScript() {
  const project = editingScriptProject.value;
  if (!project) return;
  if (!scriptEditorForm.hook.trim() || !scriptEditorForm.script.trim()) return ElMessage.warning("钩子和完整脚本不能为空");
  savingScript.value = true;
  try {
    const lines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
    await post(`/api/v1/workbench/data-center/video-projects/${project.id}/script`, {
      ...scriptEditorForm,
      candidateIndex: editingScriptCandidateIndex.value,
      voiceoverLines: lines(scriptEditorForm.voiceoverText),
      retentionDesign: lines(scriptEditorForm.retentionText),
      subtitles: lines(scriptEditorForm.subtitlesText),
      emphasisTexts: lines(scriptEditorForm.emphasisText),
    });
    scriptEditorVisible.value = false;
    ElMessage.success("脚本修改已保存，仍处于待审核状态");
    await invalidateDataCenterSection("videoFactory");
    await loadDataCenter(true);
  } finally {
    savingScript.value = false;
  }
}

const bulkDeletableTasks = computed(() => tasks.value.filter((task) => task.sourceType === "SELF_CREATED" && task.status === "CANCELLED"));

function toggleTaskSelection(task: Row, checked: boolean) {
  selectedTaskIds.value = checked
    ? Array.from(new Set([...selectedTaskIds.value, task.id]))
    : selectedTaskIds.value.filter((id) => id !== task.id);
}

function toggleAllDeletableTasks(checked: boolean) {
  selectedTaskIds.value = checked ? bulkDeletableTasks.value.map((task) => task.id) : [];
}

async function bulkTrashCancelledTasks() {
  if (!selectedTaskIds.value.length) return ElMessage.warning("请先勾选需要删除的已取消任务");
  await ElMessageBox.confirm(
    `确认批量删除选中的 ${selectedTaskIds.value.length} 个任务吗？删除后进入回收站，3天内可以恢复。`,
    "批量删除任务",
    { confirmButtonText: "批量删除", cancelButtonText: "取消", type: "warning" },
  );
  bulkDeletingTasks.value = true;
  try {
    await Promise.all(selectedTaskIds.value.map((id) => post(`/api/v1/workbench/tasks/${id}/trash`)));
    selectedTaskIds.value = [];
    ElMessage.success("选中任务已移入回收站，将保留3天");
    await Promise.all([loadTasks(), loadDashboard()]);
  } finally {
    bulkDeletingTasks.value = false;
  }
}

async function copyCompleteVideoScript() {
  const candidate = scriptPackageCandidate.value;
  if (!candidate?.scriptPackage) return ElMessage.warning("暂无可复制的完整脚本");
  const payload = {
    direction: candidate.topic,
    hook: candidate.hook,
    fullScript: candidate.scripts?.zh30 || candidate.scripts?.zh15 || "",
    ...candidate.scriptPackage,
  };
  await copyTaskContent(JSON.stringify(payload, null, 2), "完整脚本");
}

function assetCoverageLabel(status?: string) {
  return ({
    COVERED: "已有素材覆盖",
    REWRITABLE: "可以改写",
    NEED_SHOOT: "需要补拍",
    PROHIBITED: "禁止制作",
  } as Record<string, string>)[status || ""] || status || "未判断";
}

function openTeamTaskCreate() {
  editingTeamTaskId.value = "";
  copyingTeamTask.value = false;
  Object.assign(teamTaskForm, {
    assigneeEmployeeId: "",
    title: "",
    description: "",
    descriptionDocument: emptyTaskDocument(),
    expectedResult: "",
    expectedResultDocument: emptyTaskDocument(),
    priority: "MEDIUM",
    dueAt: "",
    recurrenceWeekdays: [],
    recurrenceDueTime: "23:59",
    attachments: "",
  });
  teamTaskVisible.value = true;
}

function openTeamTaskEdit(task: Row) {
  editingTeamTaskId.value = task.id;
  copyingTeamTask.value = false;
  Object.assign(teamTaskForm, {
    assigneeEmployeeId: task.assigneeEmployeeId || task.assignee?.id || "",
    title: task.title || "",
    description: task.description || "",
    descriptionDocument: taskEditorDocument(task.descriptionDocument, task.description),
    expectedResult: task.expectedResult || "",
    expectedResultDocument: taskEditorDocument(task.expectedResultDocument, task.expectedResult),
    priority: task.priority || "MEDIUM",
    dueAt: task.dueAt || "",
    recurrenceWeekdays: [],
    recurrenceDueTime: "23:59",
    attachments: taskAttachments(task).map((item) => item.url).filter(Boolean).join("\n"),
  });
  teamTaskVisible.value = true;
}

function openTeamTaskCopy(task: Row) {
  openTeamTaskEdit(task);
  editingTeamTaskId.value = "";
  copyingTeamTask.value = true;
  teamTaskForm.recurrenceWeekdays = [];
}

async function cancelOwnedTask(task: Row, team = false) {
  await post(team
    ? `/api/v1/workbench/operation-team/tasks/${task.id}/cancel`
    : `/api/v1/workbench/tasks/${task.id}/cancel`);
  ElMessage.success(team ? "任务已取消，并已通知协作成员" : "任务已取消");
  await Promise.all([loadTasks(), loadDashboard(), ...(team ? [loadOperationTeam()] : [])]);
}

async function trashCancelledTask(task: Row) {
  await ElMessageBox.confirm("删除后任务会进入回收站，3天内可以恢复。确认删除吗？", "删除已取消任务", {
    confirmButtonText: "删除",
    cancelButtonText: "暂不删除",
    type: "warning",
  });
  trashingTaskId.value = task.id;
  try {
    await post(`/api/v1/workbench/tasks/${task.id}/trash`);
    ElMessage.success("任务已移入回收站，将保留3天");
    await Promise.all([loadTasks(), loadDashboard(), loadOperationTeam()]);
    if (taskRecycleBinVisible.value) await loadTaskRecycleBin();
  } finally {
    trashingTaskId.value = "";
  }
}

async function loadTaskRecycleBin() {
  taskRecycleBinLoading.value = true;
  try {
    taskRecycleItems.value = await api<Row[]>("/api/v1/workbench/task-recycle-bin");
  } finally {
    taskRecycleBinLoading.value = false;
  }
}

async function openTaskRecycleBin() {
  taskRecycleBinVisible.value = true;
  await loadTaskRecycleBin();
}

async function restoreRecycledTask(task: Row) {
  restoringTaskId.value = task.id;
  try {
    await post(`/api/v1/workbench/tasks/${task.id}/restore`);
    ElMessage.success("任务已恢复");
    await Promise.all([loadTaskRecycleBin(), loadTasks(), loadDashboard(), loadOperationTeam()]);
  } finally {
    restoringTaskId.value = "";
  }
}

function recycleRemaining(task: Row) {
  const remaining = new Date(task.purgeAfter).getTime() - Date.now();
  if (remaining <= 0) return "即将彻底删除";
  const hours = Math.ceil(remaining / (60 * 60 * 1000));
  return hours > 24 ? `剩余 ${Math.ceil(hours / 24)} 天` : `剩余 ${hours} 小时`;
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

function dataCenterCacheKey() {
  return JSON.stringify({
    employeeId: user.value?.id || "",
    section: dataCenterTab.value,
    scopeVersion: dataCenterTab.value === "videoFactory" ? "employee-projects-v1" : "",
    page: dataCenterTab.value === "assets" ? assetPage.value : dataCenterTab.value === "videoFactory" ? videoProjectPage.value : 1,
    videoProjectStatus: dataCenterTab.value === "videoFactory" ? videoProjectStatus.value : "",
    ...dataCenterFilters,
  });
}

function assetIndexStatus(asset: Row) {
  if (asset.processingStatus === "FAILED") return { label: "AI分析失败", type: "danger" };
  if (["RECEIVED", "HASHED", "STORED", "ANALYZING"].includes(asset.processingStatus)) return { label: "AI分析中", type: "primary" };
  if (asset.indexNeedsReview || Number(asset.indexConfidence || 0) < 0.7) return { label: "低置信度待确认", type: "warning" };
  return { label: "索引已完成", type: "success" };
}

async function invalidateDataCenterSection(section = dataCenterTab.value) {
  for (const key of dataCenterCache.keys()) {
    if (key.includes(`"section":"${section}"`)) dataCenterCache.delete(key);
  }
  await deletePersistentDataCenterSection(section);
}

async function ensureContentTaskOptions() {
  if (contentTaskOptionsLoaded.value) return;
  Object.assign(contentTaskOptions, await api<Row>("/api/v1/workbench/task-creation/options"));
  contentTaskOptionsLoaded.value = true;
}

async function openNewVideoProjectDialog() {
  try {
    await ensureContentTaskOptions();
    newVideoProjectVisible.value = true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "产品和关键词加载失败，请稍后重试");
  }
}

async function openSelfTask() {
  editingSelfTaskId.value = "";
  copyingSelfTask.value = false;
  Object.assign(selfTaskForm, {
    contentType: "SHORT_VIDEO",
    productId: "",
    keywordId: "",
    platform: "DOUYIN",
    targetAudience: "",
    corePain: "",
    recommendedScene: "",
    hook: "",
    executionMode: "FULL_VIDEO",
    materialStrategy: "REAL_ASSET_FIRST",
    sourceKeywordIds: [],
    sourceExternalVideoIds: [],
    title: "",
    description: "",
    descriptionDocument: emptyTaskDocument(),
    expectedResult: "",
    expectedResultDocument: emptyTaskDocument(),
    priority: "MEDIUM",
    dueAt: "",
    recurrenceWeekdays: [],
    recurrenceDueTime: "23:59",
  });
  selfTaskVisible.value = true;
  await ensureContentTaskOptions();
}

async function openSelfTaskEdit(task: Row) {
  editingSelfTaskId.value = task.id;
  copyingSelfTask.value = false;
  const evidence = task.evidence || {};
  Object.assign(selfTaskForm, {
    contentType: evidence.contentType || (task.category === "CONTENT_IMAGE" ? "IMAGE" : task.category === "CONTENT_ARTICLE" ? "ARTICLE" : "SHORT_VIDEO"),
    productId: task.productId || "",
    keywordId: evidence.keywordId || "",
    platform: task.platform || "DOUYIN",
    targetAudience: evidence.targetAudience || "",
    corePain: evidence.corePain || "",
    recommendedScene: evidence.recommendedScene || "",
    hook: evidence.hook || "",
    executionMode: evidence.executionMode || "FULL_VIDEO",
    materialStrategy: evidence.materialStrategy || "REAL_ASSET_FIRST",
    sourceKeywordIds: evidence.sourceKeywordIds || [],
    sourceExternalVideoIds: evidence.sourceExternalVideoIds || [],
    title: task.title || "",
    description: task.description || "",
    descriptionDocument: taskEditorDocument(task.descriptionDocument, task.description),
    expectedResult: task.expectedResult || "",
    expectedResultDocument: taskEditorDocument(task.expectedResultDocument, task.expectedResult),
    priority: task.priority || "MEDIUM",
    dueAt: task.dueAt || "",
    recurrenceWeekdays: [],
    recurrenceDueTime: "23:59",
  });
  selfTaskVisible.value = true;
  await ensureContentTaskOptions();
}

async function openSelfTaskCopy(task: Row) {
  await openSelfTaskEdit(task);
  editingSelfTaskId.value = "";
  copyingSelfTask.value = true;
  selfTaskForm.recurrenceWeekdays = [];
}

function quickDue(target: { dueAt: string }, mode: "TODAY" | "WEEK") {
  const due = new Date();
  if (mode === "WEEK") {
    const weekday = due.getDay() || 7;
    due.setDate(due.getDate() + (7 - weekday));
  }
  due.setHours(23, 59, 59, 999);
  target.dueAt = due.toISOString();
}

async function openTaskDetail(task: Row) {
  taskDetailLoading.value = true;
  taskDetailVisible.value = true;
  try {
    const fullTask = await api<Row>(`/api/v1/workbench/tasks/${task.id}`);
    taskDetail.value = fullTask;
    Object.keys(taskOutputUrls).forEach((key) => delete taskOutputUrls[key]);
    await Promise.all((fullTask.projection?.deliverables || []).map(async (output: Row) => {
      try {
        const result = await api<Row>(`/api/v1/workbench/tasks/${fullTask.id}/outputs/${output.id}/url`);
        if (result.url) taskOutputUrls[output.id] = result.url;
      } catch {
        // 保留成果文字信息；没有可访问文件时不阻塞详情。
      }
    }));
  } finally {
    taskDetailLoading.value = false;
  }
}

function outputMime(output: Row) {
  return String(output.mimeType || output.asset?.mediaType || "").toLowerCase();
}

function isAiContentTask(task?: Row) {
  if (!task) return false;
  return Boolean(
    task.projection?.isAiManaged
    || task.aiRequest
    || task.evidence?.aiTaskId
    || task.sourceType === "WORKBENCH_CONTENT_REQUEST"
    || task.category === "AI_DELIVERY"
    || (task.sourceType === "SELF_CREATED" && ["CONTENT_VIDEO", "CONTENT_IMAGE", "CONTENT_ARTICLE"].includes(task.category)),
  );
}

function taskCardSummary(task: Row) {
  if (task.projection?.nextAction) return task.projection.nextAction;
  if (String(task.title || "").startsWith("补拍素材：")) {
    return "请按任务详情中的镜头清单补拍并上传真实素材，完成后交管理员审核。";
  }
  const source = String(task.description || task.expectedResult || "按任务要求完成并提交成果。")
    .replace(/\s+/g, " ")
    .trim();
  return source.length > 96 ? `${source.slice(0, 96)}…` : source;
}

function isVideoOutput(output: Row) {
  return output.previewKind === "VIDEO" || outputMime(output).startsWith("video/") || output.kind === "VIDEO_MASTER";
}

function isImageOutput(output: Row) {
  return output.previewKind === "IMAGE" || outputMime(output).startsWith("image/") || ["IMAGE", "IMAGE_ASSET", "IMAGE_OUTPUT", "IMAGE_GENERATED", "IMAGE_MASTER"].includes(output.kind);
}

function isPdfOutput(output: Row) {
  return outputMime(output) === "application/pdf" || String(output.asset?.extension || "").toLowerCase() === ".pdf";
}

function outputText(output: Row) {
  if (output.contentPlan?.variants?.length) {
    return output.contentPlan.variants.map((item: Row) => `${item.title}\n${item.body}`).join("\n\n");
  }
  if (output.report) return `${output.report.summary || ""}\n${JSON.stringify(output.report.sections || [], null, 2)}`;
  return "";
}

function outputPublishedVariants(output?: Row) {
  return (output?.contentPlan?.variants || []).filter((variant: Row) => variant.manualPublishUrl);
}

async function generateTaskSuggestion() {
  if (!selfTaskForm.productId) return ElMessage.warning("请先从产品库选择产品");
  generatingTaskSuggestion.value = true;
  try {
    const suggestion = await post<Row>("/api/v1/workbench/task-creation/suggest", {
      contentType: selfTaskForm.contentType,
      productId: selfTaskForm.productId,
      keywordId: selfTaskForm.keywordId,
      platform: selfTaskForm.platform,
    });
    selfTaskForm.title = suggestion.title || selfTaskForm.title;
    selfTaskForm.description = suggestion.description || "";
    selfTaskForm.descriptionDocument = taskEditorDocument(null, suggestion.description);
    selfTaskForm.expectedResult = suggestion.expectedResult || "";
    selfTaskForm.expectedResultDocument = taskEditorDocument(null, suggestion.expectedResult);
    selfTaskForm.targetAudience = suggestion.targetAudience || selfTaskForm.targetAudience;
    selfTaskForm.corePain = suggestion.corePain || selfTaskForm.corePain;
    selfTaskForm.recommendedScene = suggestion.recommendedScene || selfTaskForm.recommendedScene;
    selfTaskForm.hook = suggestion.hook || selfTaskForm.hook;
    ElMessage.success("已生成选题、推荐和任务提示");
  } finally {
    generatingTaskSuggestion.value = false;
  }
}

async function copyTaskContent(content: unknown, label: string) {
  const text = String(content || "").trim();
  if (!text) return ElMessage.warning(`${label}暂无可复制内容`);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  ElMessage.success(`${label}已复制`);
}

function taskAttachments(task?: Row) {
  if (!task) return [];
  const records = Array.isArray(task.attachments) ? task.attachments : [];
  const links = Array.isArray(task.evidence?.attachments) ? task.evidence.attachments : [];
  return [...records, ...links].map((item) => typeof item === "string" ? { name: item, url: item } : item);
}

async function createSelfTask() {
  if (!selfTaskForm.productId) return ElMessage.warning("请选择产品");
  if (!selfTaskForm.keywordId) return ElMessage.warning("请选择智能关键词");
  if (!selfTaskForm.title.trim()) return ElMessage.warning("请填写任务标题");
  creatingSelfTask.value = true;
  try {
    const category = selfTaskForm.contentType === "IMAGE"
      ? "CONTENT_IMAGE"
      : selfTaskForm.contentType === "ARTICLE"
        ? "CONTENT_ARTICLE"
        : "CONTENT_VIDEO";
    const payload = {
      ...selfTaskForm,
      category,
      evidence: {
        contentType: selfTaskForm.contentType,
        keywordId: selfTaskForm.keywordId || null,
        targetAudience: selfTaskForm.targetAudience || null,
        corePain: selfTaskForm.corePain || null,
        recommendedScene: selfTaskForm.recommendedScene || null,
        hook: selfTaskForm.hook || null,
        executionMode: selfTaskForm.executionMode,
        materialStrategy: selfTaskForm.materialStrategy,
        sourceKeywordIds: selfTaskForm.sourceKeywordIds,
        sourceExternalVideoIds: selfTaskForm.sourceExternalVideoIds,
      },
    };
    if (editingSelfTaskId.value) {
      await api(`/api/v1/workbench/tasks/${editingSelfTaskId.value}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } else {
      await post("/api/v1/workbench/task-creation/submit-ai", payload);
    }
    selfTaskVisible.value = false;
    taskScope.value = "MINE";
    ElMessage.success(editingSelfTaskId.value
      ? "任务已修改"
        : copyingSelfTask.value
        ? "任务已复制并提交AI任务中心"
        : "任务已提交后台AI任务中心");
    editingSelfTaskId.value = "";
    copyingSelfTask.value = false;
    await Promise.all([loadTasks(), loadDashboard()]);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "任务添加失败，请稍后重试");
  } finally {
    creatingSelfTask.value = false;
  }
}

async function loadDataCenter(force = false) {
  const cacheKey = dataCenterCacheKey();
  let cached = dataCenterCache.get(cacheKey);
  if (!force && !cached) {
    cached = await readPersistentDataCenterCache(cacheKey);
    if (cached) dataCenterCache.set(cacheKey, cached);
  }
  if (!force && cached) {
    Object.assign(dataCenter, cached.data);
    dataCenterUpdatedAt.value = new Date(cached.cachedAt).toISOString();
    return;
  }
  const requestId = ++dataCenterRequestId;
  dataCenterLoading.value = true;
  const parameters = new URLSearchParams();
  Object.entries(dataCenterFilters).forEach(([key, value]) => {
    if (value) parameters.set(key, value);
  });
  parameters.set("section", dataCenterTab.value);
  if (dataCenterTab.value === "assets") {
    parameters.set("page", String(assetPage.value));
    parameters.set("pageSize", "30");
  } else if (dataCenterTab.value === "videoFactory") {
    parameters.set("page", String(videoProjectPage.value));
    parameters.set("pageSize", String(videoProjectPageSize));
    if (videoProjectStatus.value) parameters.set("status", videoProjectStatus.value);
  }
  if (!dataCenter.uploadOptions.products?.length) parameters.set("includeOptions", "1");
  parameters.set("_", String(Date.now()));
  try {
    const result = await api<Row>(`/api/v1/workbench/data-center?${parameters.toString()}`);
    if (requestId === dataCenterRequestId) {
      const cachedAt = Date.now();
      dataCenterCache.set(cacheKey, { data: result, cachedAt });
      await writePersistentDataCenterCache(cacheKey, { data: result, cachedAt });
      Object.assign(dataCenter, result);
      dataCenterUpdatedAt.value = new Date(cachedAt).toISOString();
    }
  } finally {
    if (requestId === dataCenterRequestId) dataCenterLoading.value = false;
  }
}

async function switchDataCenterTab(tab: string) {
  dataCenterTab.value = tab;
  await loadDataCenter();
}

async function setAssetKind(kind: string) {
  dataCenterFilters.kind = kind;
  assetPage.value = 1;
  await loadDataCenter();
}

async function setAssetPurpose(purpose: string) {
  dataCenterFilters.purpose = purpose;
  if (purpose !== "PACKAGING_RESOURCE") dataCenterFilters.packagingCategory = "";
  assetPage.value = 1;
  await loadDataCenter();
}

async function setKnowledgeType(type: string) {
  dataCenterFilters.type = type;
  await loadDataCenter();
}

async function refreshDataCenter() {
  await invalidateDataCenterSection();
  await loadDataCenter(true);
  ElMessage.success("当前栏目已重新拉取");
}

async function searchDataCenter() {
  if (dataCenterTab.value === "assets") assetPage.value = 1;
  if (dataCenterTab.value === "videoFactory") videoProjectPage.value = 1;
  await loadDataCenter();
}

async function changeDataCenterPage(page: number) {
  if (dataCenterTab.value === "assets") assetPage.value = page;
  if (dataCenterTab.value === "videoFactory") videoProjectPage.value = page;
  await loadDataCenter();
}

async function useKeywordInFactory(keyword: Row) {
  await openSelfTask();
  const product = (contentTaskOptions.products || []).find((item: Row) => item.id === keyword.productId || item.modelCode === keyword.product?.modelCode);
  Object.assign(selfTaskForm, {
    contentType: "SHORT_VIDEO",
    productId: product?.id || "",
    keywordId: keyword.id || "",
    platform: keyword.platform || "DOUYIN",
    targetAudience: keyword.audience || "",
    corePain: keyword.pain || "",
    recommendedScene: keyword.scene || "",
    hook: keyword.hook || "",
    sourceKeywordIds: keyword.id ? [keyword.id] : [],
    sourceExternalVideoIds: [],
    title: `${product?.modelCode || "产品"} ${keyword.keyword || "关键词"}短视频`,
    description: `围绕“${keyword.keyword || ""}”创建短视频内容任务。`,
  });
  selfTaskForm.descriptionDocument = taskEditorDocument(null, selfTaskForm.description);
}

async function useViralVideoInFactory(video: Row) {
  await openSelfTask();
  const keywordIds = (video.keywordHits || []).map((item: Row) => item.keywordId || item.keyword?.id).filter(Boolean);
  const modelCode = video.keywordHits?.find((item: Row) => item.keyword?.product)?.keyword?.product?.modelCode || "";
  const product = (contentTaskOptions.products || []).find((item: Row) => item.modelCode === modelCode);
  Object.assign(selfTaskForm, {
    contentType: "SHORT_VIDEO",
    productId: product?.id || "",
    keywordId: keywordIds[0] || "",
    platform: video.platform || "DOUYIN",
    sourceKeywordIds: keywordIds,
    sourceExternalVideoIds: [video.id],
    title: `${modelCode || "产品"} 爆款结构短视频`,
    description: `参考“${video.title || "爆款视频"}”的Hook、节奏、镜头结构和CTA创建赛电版本，不复制竞品品牌、价格或承诺。`,
  });
  selfTaskForm.descriptionDocument = taskEditorDocument(null, selfTaskForm.description);
}

async function createVideoFactoryProject() {
  if (!videoFactoryForm.productModel) return ElMessage.warning("请选择产品型号");
  if (!videoFactoryForm.videoType.trim()) return ElMessage.warning("请选择或填写视频类型");
  if (!videoFactoryForm.keywords.trim() && !videoFactoryForm.keywordIds.length) return ElMessage.warning("请填写或选择关键词");
  if (!videoFactoryForm.scriptEngines.length) return ElMessage.warning("请至少选择一种脚本生成方式");
  creatingVideoProject.value = true;
  try {
    await post("/api/v1/workbench/data-center/video-projects", {
      ...videoFactoryForm,
      generationMode: videoScriptMode.value === "ASSET_ONLY" ? "ASSET_ONLY" : "NORMAL",
      contentRestrictionMode: videoFactoryForm.healthContentAllowed ? "NORMAL" : "HEALTH_RESTRICTED",
    });
    videoProjectPage.value = 1;
    videoProjectStatus.value = "";
    await invalidateDataCenterSection("videoFactory");
    if (active.value === "data" && dataCenterTab.value === "videoFactory") {
      await loadDataCenter(true);
    } else {
      await loadTasks();
    }
    newVideoProjectVisible.value = false;
    ElMessage.success("视频项目已创建，脚本生成任务已提交");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "视频项目创建失败，请稍后重试");
  } finally {
    creatingVideoProject.value = false;
  }
}

function checkNewVideoProjectBrief() {
  if (!videoFactoryForm.productModel) return ElMessage.warning("请先选择产品型号");
  if (!videoFactoryForm.videoType.trim()) return ElMessage.warning("请选择或填写视频类型");
  if (!videoFactoryForm.keywords.trim() && !videoFactoryForm.keywordIds.length) return ElMessage.warning("请填写或选择关键词");
  ElMessage.success("任务信息完整，可以创建项目");
}

async function reviewProjectScript(project: Row, approved: boolean, candidateIndex?: number) {
  let note = "";
  if (!approved) {
    const result = await ElMessageBox.prompt(
      "请说明脚本哪里需要修改，远程Codex会根据原因重写",
      "退回脚本",
      { confirmButtonText: "确认退回", cancelButtonText: "取消", inputType: "textarea" },
    ).catch(() => null);
    if (!result) return;
    note = result.value.trim();
    if (!note) return ElMessage.warning("退回脚本时必须填写修改原因");
  }
  reviewingScriptProjectId.value = project.id;
  try {
    await post(`/api/v1/workbench/data-center/video-projects/${project.id}/script-review`, {
      action: approved ? "APPROVE" : "RETURN",
      note,
      candidateIndex,
    });
    ElMessage.success(approved ? "脚本审核通过，可以补齐缺失素材" : "脚本已退回，系统已根据退回原因提交重写任务");
    await invalidateDataCenterSection("videoFactory");
    await loadDataCenter(true);
  } finally {
    reviewingScriptProjectId.value = "";
  }
}

async function analyzeWorkbenchAssetGaps() {
  if (!assetGapProductModel.value.trim()) return ElMessage.warning("请选择需要分析的产品型号");
  analyzingAssetGaps.value = true;
  try {
    assetGaps.value = await post<Row[]>("/api/v1/workbench/data-center/asset-gaps/analyze", {
      productModel: assetGapProductModel.value,
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
    dataCenterTab.value = "videoFactory";
    await invalidateDataCenterSection("videoFactory");
    await loadDataCenter(true);
  } finally {
    generatingProjectId.value = "";
  }
}

function videoProjectHasActiveJob(project: Row) {
  const activeStatuses = ["PENDING", "RUNNING", "RETRY"];
  return project.videoGenerationJobs?.some((job: Row) => activeStatuses.includes(job.status))
    || project.videoRenderJobs?.some((job: Row) => activeStatuses.includes(job.status));
}

async function archiveVideoProject(project: Row) {
  if (videoProjectHasActiveJob(project)) {
    return ElMessage.warning("该项目仍在生成素材或剪辑，任务结束后才能删除");
  }
  await ElMessageBox.confirm(
    `确认删除“${project.topic}”？项目会从视频工厂隐藏，历史镜头、成片和审核记录仍会安全保留。`,
    "删除视频项目",
    { confirmButtonText: "确认删除", cancelButtonText: "取消", type: "warning" },
  );
  archivingVideoProjectId.value = project.id;
  try {
    await post(`/api/v1/workbench/data-center/video-projects/${project.id}/archive`);
    ElMessage.success("视频项目已删除");
    await invalidateDataCenterSection("videoFactory");
    await loadDataCenter(true);
    if (videoRecycleBinVisible.value) await loadVideoRecycleBin();
  } finally {
    archivingVideoProjectId.value = "";
  }
}

async function loadVideoRecycleBin() {
  videoRecycleBinLoading.value = true;
  try {
    videoRecycleProjects.value = await api<Row[]>("/api/v1/workbench/data-center/video-projects-recycle-bin");
  } finally {
    videoRecycleBinLoading.value = false;
  }
}

async function openVideoRecycleBin() {
  videoRecycleBinVisible.value = true;
  await loadVideoRecycleBin();
}

function recycleRemainingText(project: Row) {
  const remaining = new Date(project.purgeAfter).getTime() - Date.now();
  if (remaining <= 0) return "恢复期限已到";
  const hours = Math.ceil(remaining / (60 * 60 * 1000));
  if (hours >= 24) return `剩余 ${Math.ceil(hours / 24)} 天`;
  return `剩余 ${hours} 小时`;
}

async function restoreVideoProject(project: Row) {
  restoringVideoProjectId.value = project.id;
  try {
    await post(`/api/v1/workbench/data-center/video-projects/${project.id}/restore`);
    ElMessage.success("视频项目已恢复");
    await Promise.all([
      loadVideoRecycleBin(),
      invalidateDataCenterSection("videoFactory").then(() => loadDataCenter(true)),
    ]);
  } finally {
    restoringVideoProjectId.value = "";
  }
}

async function filterVideoProjects() {
  videoProjectPage.value = 1;
  await invalidateDataCenterSection("videoFactory");
  await loadDataCenter(true);
}

function videoProjectStageLabel(stage?: string) {
  return ({
    PROJECT_BRIEF: "脚本任务提交中",
    SCRIPT_GENERATING: "脚本生成中",
    SCRIPT_RETURNED: "脚本重写任务提交中",
    SCRIPT_APPROVED: "脚本已通过",
    FACTORY_SCRIPT_READY: "项目脚本已生成",
    FACTORY_GENERATING: "素材准备中",
    MATERIAL_REVIEW: "素材待确认",
    MATERIAL_RETURNED: "素材已退回",
    READY_TO_EDIT: "可进入AI剪辑",
    EDITING: "AI剪辑中",
    VIDEO_REVIEW: "成片待审核",
    PLATFORM_PACKAGING: "最终成品",
    PACKAGING_REVIEW: "包装待审核",
    READY_TO_PUBLISH: "待发布",
    PUBLISHING: "发布中",
    TRACKING: "已发布并跟踪",
  } as Record<string, string>)[String(stage || "")] || stage || "项目脚本已生成";
}

function videoVoiceoverLabel(project: Row) {
  const factory = Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item?.type === "VIDEO_FACTORY")
    : undefined;
  return factory?.voiceoverMode === "NO_VOICEOVER" ? "无口播" : "有口播";
}

function toggleVideoProjectShots(projectId: string) {
  expandedVideoProjectIds.value = expandedVideoProjectIds.value.includes(projectId)
    ? expandedVideoProjectIds.value.filter((id) => id !== projectId)
    : [...expandedVideoProjectIds.value, projectId];
}

function shotStatusText(shot: Row) {
  if (shot.selectedAssetId) return "已有素材";
  if (shot.status === "GENERATING") return "AI生成中";
  if (shot.status === "FAILED") return "生成失败";
  if (shot.status === "PENDING_REVIEW") return "素材待审核";
  return "需要补拍";
}

function shotStatusType(shot: Row) {
  if (shot.selectedAssetId) return "success";
  if (shot.status === "GENERATING" || shot.status === "PENDING_REVIEW") return "primary";
  if (shot.status === "FAILED") return "danger";
  return "warning";
}

async function generateWorkbenchShot(project: Row, shot: Row) {
  generatingShotId.value = shot.id;
  try {
    await post(`/api/v1/workbench/data-center/video-shots/${shot.id}/generate`, {
      duration: Number(shot.durationSeconds || 5),
    });
    ElMessage.success("AI镜头生成任务已提交，可在这里查看进度");
    await invalidateDataCenterSection("videoFactory");
    await loadDataCenter(true);
    if (!expandedVideoProjectIds.value.includes(project.id)) {
      expandedVideoProjectIds.value.push(project.id);
    }
  } finally {
    generatingShotId.value = "";
  }
}

function renderStatusText(job: Row) {
  if (job.status === "SUCCEEDED") return job.outputAsset?.reviewStatus === "APPROVED" ? "审核通过" : job.outputAsset?.reviewStatus === "RETURNED" ? "审核退回" : "成片待审核";
  if (job.status === "RUNNING") return "AI剪辑中";
  if (job.status === "RETRY") return "等待重试";
  if (job.status === "FAILED") return "剪辑失败";
  if (job.status === "CANCELLED") return "已取消";
  return "等待剪辑";
}

function renderStatusType(job: Row) {
  if (job.status === "FAILED" || job.outputAsset?.reviewStatus === "RETURNED") return "danger";
  if (job.outputAsset?.reviewStatus === "APPROVED") return "success";
  if (job.status === "RUNNING" || job.status === "SUCCEEDED") return "primary";
  return "warning";
}

function projectReadyToRender(project: Row) {
  return Boolean(
    ["READY_TO_EDIT", "EDITING"].includes(project.productionStage)
    && project.videoShots?.length
    && project.videoShots.every((shot: Row) => shot.status === "DONE" && shot.selectedAssetId),
  );
}

function projectMaterialReview(project: Row) {
  const factory = Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item?.type === "VIDEO_FACTORY")
    : undefined;
  return factory?.materialReview || {};
}

function projectMaterialsComplete(project: Row) {
  return Boolean(
    project.videoShots?.length
    && project.videoShots.every((shot: Row) => shot.status === "DONE" && shot.selectedAssetId),
  );
}

async function reviewProjectMaterials(project: Row, approved: boolean) {
  let note = "";
  if (approved) {
    await ElMessageBox.confirm(
      "确认当前脚本的所有镜头素材、有效时间段和画面事实均正确吗？确认后才可提交成片任务。",
      "确认素材齐全",
      { confirmButtonText: "确认素材齐全", cancelButtonText: "继续检查", type: "warning" },
    );
  } else {
    const result = await ElMessageBox.prompt(
      "请填写需要重新匹配、替换或补拍的具体原因。",
      "退回素材匹配",
      { confirmButtonText: "确认退回", cancelButtonText: "取消", inputType: "textarea", inputValidator: (value) => Boolean(String(value || "").trim()) || "请填写退回原因" },
    );
    note = String(result.value || "").trim();
  }
  await post(`/api/v1/workbench/data-center/video-projects/${project.id}/material-review`, {
    action: approved ? "APPROVE" : "RETURN",
    note,
  });
  ElMessage.success(approved ? "素材已确认，可以提交成片任务" : "素材已退回，原因已记录");
  await invalidateDataCenterSection("videoFactory");
  await loadDataCenter(true);
}

function projectHasApprovedMaster(project: Row) {
  return Boolean(project.videoRenderJobs?.some((job: Row) => job.status === "SUCCEEDED" && job.outputAsset?.reviewStatus === "APPROVED"));
}

async function renderWorkbenchProject(project: Row) {
  renderingProjectId.value = project.id;
  try {
    await post(`/api/v1/workbench/data-center/video-projects/${project.id}/video-task`);
    ElMessage.success("远程剪辑任务已提交，成片完成后会自动进入待审核状态");
    await invalidateDataCenterSection("videoFactory");
    await loadDataCenter(true);
  } finally {
    renderingProjectId.value = "";
  }
}

function openVideoReview(project: Row, job: Row, action: "APPROVE" | "RETURN") {
  videoReviewProject.value = project;
  videoReviewJob.value = job;
  videoReviewForm.action = action;
  videoReviewForm.note = "";
  videoReviewVisible.value = true;
}

async function reviewWorkbenchVideo() {
  const project = videoReviewProject.value;
  const job = videoReviewJob.value;
  if (!project?.id || !job?.outputAsset?.id) return;
  if (videoReviewForm.action === "RETURN" && !videoReviewForm.note.trim()) {
    return ElMessage.warning("退回成片时请填写具体修改说明");
  }
  reviewingVideoAssetId.value = job.outputAsset.id;
  try {
    await post(`/api/v1/workbench/data-center/video-projects/${project.id}/review`, {
      outputAssetId: job.outputAsset.id,
      action: videoReviewForm.action,
      note: videoReviewForm.note.trim(),
    });
    videoReviewVisible.value = false;
    ElMessage.success(videoReviewForm.action === "APPROVE"
      ? "成片审核通过，可以继续生成封面和标题"
      : "成片已退回，修改说明已同步到后台优化流程");
    await invalidateDataCenterSection("videoFactory");
    await loadDataCenter(true);
  } finally {
    reviewingVideoAssetId.value = "";
  }
}

function openSimilarVideo(project: Row, job: Row) {
  similarVideoProject.value = project;
  similarVideoJob.value = job;
  similarVideoForm.replaceHook = true;
  similarVideoForm.hook = "";
  similarVideoForm.replaceProduct = false;
  similarVideoForm.productModel = project.productModel || "";
  similarVideoForm.replaceFeature = false;
  similarVideoForm.feature = "";
  similarVideoVisible.value = true;
}

async function createSimilarVideo() {
  const project = similarVideoProject.value;
  const outputAssetId = similarVideoJob.value?.outputAsset?.id;
  if (!project?.id || !outputAssetId) return;
  if (!similarVideoForm.replaceHook && !similarVideoForm.replaceProduct && !similarVideoForm.replaceFeature) {
    return ElMessage.warning("请至少选择一项需要替换的内容");
  }
  if (similarVideoForm.replaceHook && !similarVideoForm.hook.trim()) return ElMessage.warning("请填写新的钩子");
  if (similarVideoForm.replaceProduct && !similarVideoForm.productModel) return ElMessage.warning("请选择新的产品型号");
  if (similarVideoForm.replaceFeature && !similarVideoForm.feature.trim()) return ElMessage.warning("请填写新的核心功能");
  creatingSimilarVideo.value = true;
  try {
    const result = await post<Row>(`/api/v1/workbench/data-center/video-projects/${project.id}/similar`, {
      outputAssetId,
      ...similarVideoForm,
      hook: similarVideoForm.hook.trim(),
      feature: similarVideoForm.feature.trim(),
    });
    similarVideoVisible.value = false;
    await invalidateDataCenterSection("videoFactory");
    await loadDataCenter(true);
    if (result.videoShots?.every((shot: Row) => shot.selectedAssetId)) {
      ElMessage.success("相似视频项目已生成，素材齐全，已自动进入AI剪辑");
    } else {
      ElMessage.success("相似视频项目已生成；缺少的画面已列为补拍或AI生成镜头");
    }
  } finally {
    creatingSimilarVideo.value = false;
  }
}

function videoReturnNote(job: Row) {
  const checks = Array.isArray(job.qualityChecks) ? job.qualityChecks : [];
  const finalReview = checks.find((item: Row) => item.checkType === "FINAL_REVIEW");
  const findings = Array.isArray(finalReview?.findings) ? finalReview.findings : [];
  return [...findings]
    .reverse()
    .find((item: Row) => item?.type === "EMPLOYEE_RETURN" && item?.message)?.message || "";
}

async function generateProjectPackaging(project: Row, job: Row) {
  if (!job.outputAsset?.id || generatingPackagingProjectId.value) return;
  generatingPackagingProjectId.value = project.id;
  try {
    await post(`/api/v1/workbench/data-center/video-projects/${project.id}/packaging`, {
      outputAssetId: job.outputAsset.id,
    });
    ElMessage.success("封面标题 AI 任务已提交，完成后会自动进入审核");
    await invalidateDataCenterSection("videoFactory");
    await loadDataCenter(true);
  } finally {
    generatingPackagingProjectId.value = "";
  }
}

function openPublishLink(project: Row, job: Row) {
  publishLinkProject.value = project;
  publishLinkJob.value = job;
  const published = (project.variants || [])
    .filter((variant: Row) => variant.manualPublishUrl)
    .map((variant: Row) => ({
      platform: variant.platform,
      remoteUrl: variant.manualPublishUrl,
      publishedAt: variant.manualPublishedAt || "",
    }));
  publishLinkRecords.value = published.length ? published : [{
    platform: project.targetPlatforms?.[0] || "DOUYIN",
    remoteUrl: "",
    publishedAt: "",
  }];
  publishLinkVisible.value = true;
}

function addPublishLinkRecord() {
  const used = new Set(publishLinkRecords.value.map((record) => record.platform));
  const next = publishPlatformOptions.find((option) => !used.has(option.value));
  if (!next) return ElMessage.warning("所有支持的平台都已经添加");
  publishLinkRecords.value.push({ platform: next.value, remoteUrl: "", publishedAt: "" });
}

function removePublishLinkRecord(index: number) {
  if (publishLinkRecords.value.length === 1) return ElMessage.warning("至少保留一条发布记录");
  publishLinkRecords.value.splice(index, 1);
}

async function savePublishLink() {
  const project = publishLinkProject.value;
  const outputAssetId = publishLinkJob.value?.outputAsset?.id;
  if (!project?.id || !outputAssetId) return;
  const records = publishLinkRecords.value.map((record) => ({
    platform: record.platform,
    remoteUrl: record.remoteUrl.trim(),
    publishedAt: record.publishedAt || undefined,
  }));
  if (new Set(records.map((record) => record.platform)).size !== records.length) {
    return ElMessage.warning("同一平台请只添加一条发布记录");
  }
  if (records.some((record) => !record.platform || !/^https?:\/\/\S+$/i.test(record.remoteUrl))) {
    return ElMessage.warning("请为每个平台填写完整作品链接");
  }
  savingPublishLink.value = true;
  try {
    await post(`/api/v1/workbench/data-center/video-projects/${project.id}/manual-publish`, {
      outputAssetId,
      records,
    });
    publishLinkVisible.value = false;
    ElMessage.success("发布链接已回传，系统将按计划跟踪视频数据");
    await invalidateDataCenterSection("videoFactory");
    await loadDataCenter(true);
  } finally {
    savingPublishLink.value = false;
  }
}

function openPublishedVideo(url: string) {
  if (!/^https?:\/\//i.test(url)) return ElMessage.warning("发布链接不完整");
  window.open(url, "_blank", "noopener,noreferrer");
}

async function openPackagingPreview(project: Row, variant: Row) {
  if (packagingPreviewUrl.value.startsWith("blob:")) URL.revokeObjectURL(packagingPreviewUrl.value);
  const result = await api<{ url: string }>(
    `/api/v1/workbench/data-center/video-projects/${project.id}/packaging/${variant.id}/cover-url`,
  );
  packagingPreviewUrl.value = result.url;
  packagingPreviewProject.value = project;
  packagingPreviewVariant.value = variant;
  packagingPreviewVisible.value = true;
}

async function reviewProjectPackaging(approved: boolean) {
  const project = packagingPreviewProject.value;
  const variant = packagingPreviewVariant.value;
  if (!project?.id || !variant?.id || reviewingPackagingVariantId.value) return;
  let note = "";
  if (!approved) {
    const result = await ElMessageBox.prompt(
      "请说明封面、标题或发布文案需要怎样修改，远程节点会按此重新处理。",
      "退回平台包装",
      {
        confirmButtonText: "确认退回",
        cancelButtonText: "取消",
        inputType: "textarea",
        inputPlaceholder: "例如：标题过长；封面文字需要更突出产品型号。",
        inputValidator: (value) => value.trim().length >= 4 || "请至少填写 4 个字的修改说明",
      },
    );
    note = result.value.trim();
  }
  reviewingPackagingVariantId.value = variant.id;
  try {
    await post(`/api/v1/workbench/data-center/video-projects/${project.id}/packaging/${variant.id}/review`, {
      approved,
      note,
    });
    closePackagingPreview();
    ElMessage.success(approved ? "封面和标题审核通过，可以进入发布环节" : "已退回并同步修改说明");
    await invalidateDataCenterSection("videoFactory");
    await loadDataCenter(true);
  } finally {
    reviewingPackagingVariantId.value = "";
  }
}

function closePackagingPreview() {
  packagingPreviewVisible.value = false;
  if (packagingPreviewUrl.value) URL.revokeObjectURL(packagingPreviewUrl.value);
  packagingPreviewUrl.value = "";
  packagingPreviewProject.value = undefined;
  packagingPreviewVariant.value = undefined;
}

async function downloadWorkbenchAsset(asset: Row) {
  const result = await api<{ url: string }>(`/api/v1/workbench/assets/${asset.id}/download-url`);
  window.open(result.url, "_blank", "noopener,noreferrer");
}

async function openShotUpload(project: Row, shot: Row) {
  await openUpload();
  lockedShotUpload.value = { project, shot };
  uploadForm.contentPlanId = project.id;
  uploadForm.shootRequirementId = shot.requirementKey;
  uploadForm.contentDescription = shot.description || shot.title || "";
  const product = productOptions.value.find((item: Row) => item.modelCode === project.productModel);
  if (product) uploadForm.productIds = [product.id];
}

function closeUploadDialog() {
  uploadVisible.value = false;
  lockedShotUpload.value = undefined;
}

async function switchPage(page: string) {
  active.value = page;
  if (page === "home") await loadDashboard();
  if (page === "tasks") await loadTasks();
  if (page === "outputs") await loadOutputLibrary();
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
    ElMessage.warning(isAiContentTask(activeTask.value) ? "请填写需要修改的内容" : "请填写任务成果说明");
    return;
  }
  if (isAiContentTask(activeTask.value)) {
    await post(`/api/v1/workbench/tasks/${activeTask.value.id}/ai-feedback`, { note: submitForm.summary });
    submitVisible.value = false;
    ElMessage.success("修改反馈已提交，等待管理员确认");
    await Promise.all([loadDashboard(), loadTasks()]);
    if (taskDetailVisible.value) await openTaskDetail(activeTask.value);
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

async function openUpload() {
  if (!dataCenter.uploadOptions.products?.length) {
    try { await loadDataCenter(); } catch { /* 上传仍可在不选型号时继续 */ }
  }
  uploadFiles.value = [];
  uploadTechnicalInfo.value = [];
  Object.assign(uploadForm, {
    sourceType: "EMPLOYEE_CAPTURE",
    purpose: "EDITING_FOOTAGE",
    packagingCategory: "",
    productScope: "UNKNOWN",
    productIds: [],
    assetKind: "",
    contentDescription: "",
    classificationTags: [],
    aiRename: true,
    originalStatus: true,
    rightsStatus: "COMMERCIAL",
    acquiredAt: "",
    contentPlanId: "",
    shootRequirementId: "",
  });
  uploadAssistState.value = "";
  uploadAssistMessage.value = "";
  uploadProgress.value = 0;
  uploadEta.value = "";
  uploadStage.value = "";
  uploadVisible.value = true;
}

function selectProductionPlan() {
  uploadForm.shootRequirementId = "";
}

async function inspectUploadFiles() {
  await Promise.resolve();
  const files = uploadFiles.value.map((item) => item.raw).filter(Boolean) as File[];
  uploadTechnicalInfo.value = await Promise.all(files.map(async (file) => {
    const extension = file.name.includes(".") ? file.name.split(".").pop()?.toUpperCase() || "未知" : "未知";
    const base: Row = {
      name: file.name,
      format: extension,
      mimeType: file.type || "未知",
      size: file.size,
      width: 0,
      height: 0,
      durationSeconds: 0,
      quality: "待AI分析",
    };
    if (!file.type.startsWith("video/") && !file.type.startsWith("image/")) return base;
    const url = URL.createObjectURL(file);
    try {
      if (file.type.startsWith("video/")) {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.src = url;
        await new Promise<void>((resolve) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => resolve();
        });
        base.width = video.videoWidth || 0;
        base.height = video.videoHeight || 0;
        base.durationSeconds = Number.isFinite(video.duration) ? video.duration : 0;
      } else {
        const image = new Image();
        image.src = url;
        await new Promise<void>((resolve) => {
          image.onload = () => resolve();
          image.onerror = () => resolve();
        });
        base.width = image.naturalWidth || 0;
        base.height = image.naturalHeight || 0;
      }
      if (base.width && base.height) {
        base.quality = Math.min(base.width, base.height) >= 1080
          ? "高清"
          : Math.min(base.width, base.height) >= 720 ? "清晰" : "建议优化";
      }
      return base;
    } finally {
      URL.revokeObjectURL(url);
    }
  }));
}

async function assistUpload() {
  const files = uploadFiles.value.map((item) => item.raw).filter(Boolean) as File[];
  if (!files.length) return ElMessage.warning("请先选择素材文件");
  await inspectUploadFiles();
  uploadAssistState.value = "RUNNING";
  uploadAssistMessage.value = "正在识别文件类型、型号和内容说明…";
  try {
    const result = await post<Row>("/api/v1/workbench/upload-batches/assist", {
      files: files.map((file) => ({ name: file.name, type: file.type, size: file.size })),
    });
    const suggestions = result.suggestions || {};
    if (suggestions.assetKind) uploadForm.assetKind = suggestions.assetKind;
    if (Array.isArray(suggestions.productIds)) uploadForm.productIds = suggestions.productIds;
    uploadForm.productScope = uploadForm.productIds.length ? "MODEL" : (suggestions.productScope || "UNKNOWN");
    if (!uploadForm.contentDescription && suggestions.contentDescription) uploadForm.contentDescription = suggestions.contentDescription;
    if (Array.isArray(suggestions.classificationTags)) uploadForm.classificationTags = suggestions.classificationTags;
    uploadAssistState.value = result.state || "AVAILABLE";
    uploadAssistMessage.value = result.message || "辅助填写完成，请确认";
  } catch (error) {
    uploadAssistState.value = "FAILED";
    uploadAssistMessage.value = error instanceof Error ? error.message : "辅助填写失败";
  }
}

async function submitAsset() {
  if (!can("ASSET_UPLOAD")) return ElMessage.warning("当前岗位没有素材上传权限");
  const files = uploadFiles.value.map((item) => item.raw).filter(Boolean) as File[];
  if (!files.length) return ElMessage.warning("请选择素材文件");
  if (files.length > 20) return ElMessage.warning("每批最多20个文件");
  if (uploadForm.purpose === "PACKAGING_RESOURCE" && !uploadForm.packagingCategory) {
    return ElMessage.warning("请选择包装资源分类");
  }
  uploading.value = true;
  uploadProgress.value = 0;
  uploadEta.value = "计算中";
  uploadStage.value = "准备上传";
  try {
    if (uploadTechnicalInfo.value.length !== files.length) await inspectUploadFiles();
    uploadForm.productScope = uploadForm.productIds.length ? "MODEL" : "UNKNOWN";
    const batch = await post<Row>("/api/v1/workbench/upload-batches", { ...uploadForm });
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    form.append("classificationTags", JSON.stringify(uploadForm.classificationTags));
    form.append("aiRename", String(uploadForm.aiRename));
    form.append("technicalInfo", JSON.stringify(uploadTechnicalInfo.value));
    const startedAt = Date.now();
    const result = await uploadWithProgress<Row>(`/api/v1/workbench/upload-batches/${batch.id}/files`, form, (loaded, total) => {
      uploadProgress.value = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
      const elapsed = Math.max((Date.now() - startedAt) / 1000, 0.2);
      const speed = loaded / elapsed;
      const remaining = speed > 0 ? Math.max(0, (total - loaded) / speed) : 0;
      uploadEta.value = remaining > 1 ? `约${Math.ceil(remaining)}秒` : "即将完成";
      uploadStage.value = uploadProgress.value >= 100 ? "正在写入OSS并提交AI处理" : "正在上传";
    });
    uploadVisible.value = false;
    const duplicates = Number(result.duplicateCount || 0);
    const failed = Number(result.failedCount || 0);
    if (duplicates || failed) {
      ElMessage.warning(`批次完成：新增${result.createdCount || 0}，重复${duplicates}，失败${failed}`);
    } else {
      ElMessage.success("素材批次已进入AI处理流水线");
    }
    await invalidateDataCenterSection("assets");
    if (lockedShotUpload.value) await invalidateDataCenterSection("videoFactory");
    if (active.value === "data") await loadDataCenter(true);
    else await loadDashboard();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "上传失败");
  } finally {
    uploading.value = false;
  }
}

async function openAssetPreview(row: Row, title = "素材预览") {
  assetPreviewLoading.value = true;
  assetPreviewTitle.value = title;
  assetPreviewUrl.value = "";
  assetPreviewPosterUrl.value = row.thumbnailUrl || "";
  assetEditMode.value = false;
  assetPreviewVisible.value = true;
  try {
    const [detail, download] = await Promise.all([
      api<Row>(`/api/v1/workbench/assets/${row.id}`),
      api<{ url: string }>(`/api/v1/workbench/assets/${row.id}/download-url`),
    ]);
    assetDetail.value = detail;
    assetPreviewUrl.value = download.url;
    Object.assign(assetEditForm, {
      displayName: detail.displayName || detail.fileName || "",
      productScope: detail.productScope || (detail.products?.length ? "MODEL" : "UNKNOWN"),
      productIds: (detail.products || []).map((item: Row) => item.productId || item.product?.id || item.id).filter(Boolean),
      contentDescription: detail.contentDescription || "",
      scene: detail.scene || "",
      classificationTags: (detail.tags || [])
        .filter((item: Row) => (item.tag?.namespace || item.namespace) === "content_classification")
        .map((item: Row) => item.tag?.code || item.code)
        .filter(Boolean),
    });
  } catch (error) {
    assetPreviewVisible.value = false;
    ElMessage.error(error instanceof Error ? error.message : "素材预览加载失败");
  } finally {
    assetPreviewLoading.value = false;
  }
}

async function saveAssetMetadata() {
  if (!assetDetail.value?.id) return;
  assetEditSaving.value = true;
  try {
    const detail = await api<Row>(`/api/v1/workbench/assets/${assetDetail.value.id}/metadata`, {
      method: "PATCH",
      body: JSON.stringify({
        ...assetEditForm,
        productScope: assetEditForm.productIds.length ? "MODEL" : assetEditForm.productScope,
        tags: assetEditForm.classificationTags.map((code) => ({
          namespace: "content_classification",
          code,
          label: classificationOptions.find((item) => item.value === code)?.label || code,
        })),
      }),
    });
    assetDetail.value = detail;
    assetEditMode.value = false;
    ElMessage.success("素材分类与标签已保存");
    await invalidateDataCenterSection("assets");
    await loadDataCenter(true);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "素材信息保存失败");
  } finally {
    assetEditSaving.value = false;
  }
}

function openAssetFile() {
  if (assetPreviewUrl.value) window.open(assetPreviewUrl.value, "_blank", "noopener,noreferrer");
}

function openKnowledgeDetail(item: Row) {
  knowledgeDetail.value = item;
  knowledgeDetailVisible.value = true;
}

function isKnowledgeLink(value: unknown) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

async function submitKnowledge() {
  if (!can("KNOWLEDGE_SUBMIT")) {
    ElMessage.warning("当前岗位没有知识提交权限");
    return;
  }
  await post("/api/v1/workbench/knowledge", { ...knowledgeForm });
  knowledgeVisible.value = false;
  ElMessage.success("知识已提交审核");
  await invalidateDataCenterSection("knowledge");
}

async function readNotice(item: Row) {
  try {
    const result = await post<Row>(`/api/v1/workbench/notifications/${item.id}/read`);
    item.readAt = new Date().toISOString();
    if (result.taskId) {
      const task = await api<Row>(`/api/v1/workbench/tasks/${result.taskId}`);
      await switchPage(task.sourceType === "OPERATOR_COLLAB" ? "team" : "tasks");
      await openTaskDetail(task);
    } else {
      ElMessage.info("该消息暂未关联可查看的员工任务");
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "任务详情暂时无法打开");
  }
}

async function readAllNotices() {
  const unread = notices.value.filter((item) => !item.readAt);
  if (!unread.length) return ElMessage.info("没有未读消息");
  const result = await post<{ count: number }>("/api/v1/workbench/notifications/read-all", {
    ids: unread.map((item) => item.id),
  });
  const readAt = new Date().toISOString();
  unread.forEach((item) => { item.readAt = readAt; });
  dashboard.summary.unread = Math.max(0, Number(dashboard.summary.unread || 0) - result.count);
  ElMessage.success(`已将 ${result.count} 条消息标为已读`);
}

function logout() {
  const locationKey = workbenchLocationKey();
  if (locationKey) localStorage.removeItem(locationKey);
  clearToken();
  dataCenterCache.clear();
  user.value = undefined;
  active.value = "home";
  dataCenterTab.value = "knowledge";
  void loadQr();
}

function openMall() {
  window.location.assign("/saidian-mall/#/pages/employee/index");
}

async function startWecomLogin() {
  loginMessage.value = "";
  try {
    const pendingTaskId = sessionStorage.getItem("saidian-work-pending-task") || "";
    const redirectUri = `${window.location.origin}/saidian-work/${pendingTaskId ? `?taskId=${encodeURIComponent(pendingTaskId)}` : ""}`;
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
    const pendingTaskId = sessionStorage.getItem("saidian-work-pending-task") || "";
    const redirectUri = `${window.location.origin}/saidian-work/?wecom_qr=1${pendingTaskId ? `&taskId=${encodeURIComponent(pendingTaskId)}` : ""}`;
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
    const linkedTaskId = parameters.get("taskId") || sessionStorage.getItem("saidian-work-pending-task") || "";
    const linkedPage = parameters.get("page") || "";
    if (linkedTaskId) sessionStorage.setItem("saidian-work-pending-task", linkedTaskId);
    const code = parameters.get("code");
    if (code) {
      const result = await post<{ token: string; mallToken?: string; user: SessionUser }>("/api/v1/auth/wecom/login", { code });
      setToken(result.token);
      if (result.mallToken) localStorage.setItem("employee-token", result.mallToken);
      window.history.replaceState({}, "", linkedTaskId ? `/saidian-work/?taskId=${encodeURIComponent(linkedTaskId)}` : "/saidian-work/");
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
      dataCenterCache.clear();
      user.value = {
        id: identity.employeeId,
        name: identity.name,
        roles: identity.roles || [],
        permissions: identity.permissions || [],
      };
      restoreWorkbenchLocation();
      await loadDashboard();
      if (linkedTaskId) {
        await switchPage("tasks");
        try {
          await openTaskDetail({ id: linkedTaskId });
        } catch (error) {
          ElMessage.warning(error instanceof Error ? error.message : "对应任务暂不可查看");
        } finally {
          sessionStorage.removeItem("saidian-work-pending-task");
          window.history.replaceState({}, "", "/saidian-work/");
        }
      } else if (linkedPage === "messages") {
        await switchPage("messages");
        window.history.replaceState({}, "", "/saidian-work/");
      } else if (active.value !== "home") {
        await switchPage(active.value);
      }
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
        <div><strong>SAYDIAN</strong><span>智能工作台</span></div>
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

        <section class="section-card latest-output-section">
          <div class="section-title">
            <div><p class="eyebrow">LATEST CREATIONS</p><h3>全系统最新成品</h3></div>
            <el-button link type="primary" @click="openOutputLibrary('VIDEO')">进入成品库</el-button>
          </div>
          <div v-if="latestOutputs.length" class="latest-output-grid">
            <button v-for="output in latestOutputs" :key="output.id" class="latest-output-card" @click="openSystemOutput(output)">
              <span class="latest-output-icon">
                <el-icon><VideoCamera v-if="isVideoOutput(output)" /><Files v-else /></el-icon>
              </span>
              <span class="latest-output-copy">
                <strong>{{ output.title }}</strong>
                <small>{{ outputCategoryLabel(output) }} · {{ output.aiTask?.platform ? platformLabel(output.aiTask.platform) : '全平台' }}</small>
                <em>{{ formatTime(output.createdAt) }}</em>
              </span>
              <span class="latest-output-action">预览</span>
            </button>
          </div>
          <el-empty v-else description="暂无可预览成品" :image-size="64" />
          <div class="output-library-nav">
            <strong>成品库</strong>
            <button @click="openOutputLibrary('VIDEO')"><el-icon><VideoCamera /></el-icon><span>视频</span></button>
            <button @click="openOutputLibrary('IMAGE')"><el-icon><Files /></el-icon><span>图片</span></button>
            <button @click="openOutputLibrary('ARTICLE')"><el-icon><DocumentChecked /></el-icon><span>软文</span></button>
          </div>
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
                    <el-tag size="small" :type="statusType(taskStatusCode(task))">{{ taskDisplayStatus(task) }}</el-tag>
                    <span v-if="task.projection?.currentPhase">{{ task.projection.currentPhase }}</span>
                    <span>{{ priorityLabels[task.priority] || task.priority }}</span>
                    <span>截止 {{ formatTime(task.dueAt) }}</span>
                  </div>
                  <h4>{{ task.title }}</h4>
                  <p class="task-summary">{{ taskCardSummary(task) }}</p>
                  <p v-if="task.returnReason" class="return-note">修改要求：{{ task.returnReason }}</p>
                </div>
                <div class="task-actions">
                  <el-button @click="openTaskDetail(task)">查看详情</el-button>
                  <el-button v-if="!isAiContentTask(task) && (task.status === 'ACCEPTED' || task.status === 'RETURNED')" type="primary" @click="startTask(task)">开始</el-button>
                  <el-button v-if="!isAiContentTask(task) && ['ACCEPTED','IN_PROGRESS','RETURNED'].includes(task.status)" @click="openSubmit(task)">提交成果</el-button>
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
              <button v-if="can('ASSET_UPLOAD')" @click="openUpload"><el-icon><UploadFilled /></el-icon><span>上传素材</span></button>
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

      <template v-else-if="active === 'outputs'">
        <section class="toolbar section-card output-library-toolbar">
          <div>
            <p class="eyebrow">CREATION LIBRARY</p>
            <h2>成品库</h2>
          </div>
          <el-radio-group v-model="outputCategory" @change="loadOutputLibrary(String($event))">
            <el-radio-button value="VIDEO">视频</el-radio-button>
            <el-radio-button value="IMAGE">图片</el-radio-button>
            <el-radio-button value="ARTICLE">软文</el-radio-button>
          </el-radio-group>
        </section>
        <section v-loading="outputLibraryLoading" class="section-card">
          <div v-if="outputLibrary.length" class="output-library-grid">
            <button v-for="output in outputLibrary" :key="output.id" class="output-library-card" @click="openSystemOutput(output)">
              <span class="output-library-cover">
                <el-icon><VideoCamera v-if="isVideoOutput(output)" /><Files v-else /></el-icon>
                <em>{{ outputCategoryLabel(output) }}</em>
              </span>
              <span class="output-library-copy">
                <strong>{{ output.title }}</strong>
                <small>{{ output.aiTask?.taskNo }} · {{ output.aiTask?.platform ? platformLabel(output.aiTask.platform) : '全平台' }}</small>
                <span v-if="outputPublishedVariants(output).length" class="output-published-platforms">
                  已发布：{{ outputPublishedVariants(output).map((variant: Row) => platformLabel(variant.platform)).join("、") }}
                </span>
                <span>{{ formatTime(output.createdAt) }}</span>
              </span>
            </button>
          </div>
          <el-empty v-else description="该分类暂无成品" />
        </section>
      </template>

      <template v-else-if="active === 'tasks'">
        <section class="toolbar section-card">
          <div class="task-toolbar-filters">
            <el-segmented v-model="taskScope" :options="[{label:'我的任务',value:'MINE'},{label:'可领取',value:'AVAILABLE'},{label:'全部相关',value:'ALL'}]" @change="loadTasks" />
            <el-select v-model="taskStatus" clearable placeholder="全部状态" @change="loadTasks">
              <el-option label="待完成" value="TODO" />
              <el-option label="待审核" value="PENDING_REVIEW" />
              <el-option label="已完成" value="DONE" />
              <el-option label="已取消" value="CANCELLED" />
            </el-select>
            <el-select v-model="taskType" clearable placeholder="全部任务类型" @change="loadTasks">
              <el-option label="视频项目任务" value="VIDEO_PROJECT" />
              <el-option label="图文项目任务" value="IMAGE_PROJECT" />
              <el-option label="软文项目任务" value="ARTICLE_PROJECT" />
              <el-option label="其他" value="OTHER" />
            </el-select>
          </div>
          <div class="task-toolbar-actions">
            <el-checkbox
              v-if="bulkDeletableTasks.length"
              :model-value="selectedTaskIds.length === bulkDeletableTasks.length"
              :indeterminate="selectedTaskIds.length > 0 && selectedTaskIds.length < bulkDeletableTasks.length"
              @change="(checked: boolean) => toggleAllDeletableTasks(checked)"
            >全选可删除任务</el-checkbox>
            <el-button v-if="selectedTaskIds.length" type="danger" :loading="bulkDeletingTasks" @click="bulkTrashCancelledTasks">批量删除（{{ selectedTaskIds.length }}）</el-button>
            <el-button @click="openTaskRecycleBin">任务回收站</el-button>
            <el-button @click="openSelfTask">新建普通任务</el-button>
            <el-dropdown split-button type="primary" @click="quickCreateProject('VIDEO')" @command="quickCreateProject">
              快速新建视频项目
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="VIDEO">新建视频项目</el-dropdown-item>
                  <el-dropdown-item command="IMAGE">新建图文项目（待完善）</el-dropdown-item>
                  <el-dropdown-item command="ARTICLE">新建软文项目（待完善）</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </section>
        <section class="section-card task-list">
          <article v-for="task in tasks" :key="task.id" class="task-card">
            <el-checkbox
              v-if="task.sourceType === 'SELF_CREATED' && task.status === 'CANCELLED'"
              class="task-select-checkbox"
              :model-value="selectedTaskIds.includes(task.id)"
              @change="(checked: boolean) => toggleTaskSelection(task, checked)"
            />
            <div class="task-main">
              <div class="task-meta">
                <el-tag v-if="isVideoProjectTask(task)" size="small" type="primary">视频项目任务</el-tag>
                <el-tag size="small" :type="statusType(taskStatusCode(task))">{{ taskDisplayStatus(task) }}</el-tag>
                <span>{{ task.taskNo || "系统任务" }}</span>
                <span>{{ roleLabels[task.requiredRoleCode] || categoryLabels[task.category] || "业务任务" }}</span>
                <span v-if="task.projection?.currentPhase">{{ task.projection.currentPhase }}</span>
                <span>截止 {{ formatTime(task.dueAt) }}</span>
              </div>
              <h4>{{ task.title }}</h4>
              <div v-if="isVideoProjectTask(task)" class="video-task-identifiers">
                <span>{{ task.projection?.project?.productionNo || "项目编号待生成" }}</span>
                <span>{{ task.projection?.project?.productModel || "通用产品" }}</span>
                <span>{{ task.projection?.project?.videoType || "未标注视频类型" }}</span>
                <span v-if="task.projection?.project?.keywords">关键词：{{ task.projection.project.keywords }}</span>
                <span v-if="task.projection?.project?.platform">{{ platformLabel(task.projection.project.platform) }}</span>
                <span v-if="task.projection?.project?.createdAt">创建于 {{ formatTime(task.projection.project.createdAt) }}</span>
              </div>
              <p class="task-summary">{{ taskCardSummary(task) }}</p>
              <template v-if="isVideoProjectTask(task)">
                <div class="video-task-steps" :aria-label="`当前进行到第 ${videoProjectTaskStep(task)} 步`">
                  <span
                    v-for="(step, index) in videoFlowSteps"
                    :key="step"
                    :class="{ active: videoProjectTaskStep(task) === index + 1, done: videoProjectTaskStep(task) > index + 1 }"
                  >{{ index + 1 }} {{ step }}</span>
                </div>
                <p class="video-task-next"><b>现在需要：</b>{{ videoProjectTaskHint(task) }}</p>
              </template>
              <p v-if="task.returnReason" class="return-note">修改要求：{{ task.returnReason }}</p>
            </div>
            <div class="task-actions">
              <el-button @click="openTaskDetail(task)">查看详情</el-button>
              <el-button v-if="isVideoProjectTask(task)" type="primary" @click="openVideoProjectFromTask(task)">进入视频项目</el-button>
              <el-button v-if="!task.assigneeEmployeeId && task.status === 'OPEN'" type="primary" @click="acceptTask(task)">领取</el-button>
              <el-button v-if="!isAiContentTask(task) && task.assigneeEmployeeId === user.id && ['ACCEPTED','RETURNED'].includes(task.status)" type="primary" @click="startTask(task)">开始</el-button>
              <el-button v-if="!isAiContentTask(task) && task.assigneeEmployeeId === user.id && ['ACCEPTED','IN_PROGRESS','RETURNED'].includes(task.status)" @click="openSubmit(task)">提交成果</el-button>
              <el-button v-if="task.sourceType === 'SELF_CREATED' && (!isAiContentTask(task) || task.status === 'ACCEPTED') && !['COMPLETED','CANCELLED','VERIFIED'].includes(task.status)" @click="openSelfTaskEdit(task)">修改</el-button>
              <el-button v-if="task.sourceType === 'SELF_CREATED' && !['COMPLETED','CANCELLED','VERIFIED'].includes(task.status)" type="danger" plain @click="cancelOwnedTask(task)">取消任务</el-button>
              <el-button v-if="task.sourceType === 'SELF_CREATED' && task.status === 'CANCELLED'" @click="openSelfTaskCopy(task)">复制再次添加</el-button>
              <el-button v-if="task.sourceType === 'SELF_CREATED' && task.status === 'CANCELLED'" type="danger" plain :loading="trashingTaskId === task.id" @click="trashCancelledTask(task)">删除</el-button>
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
            <el-button @click="openTaskRecycleBin">任务回收站</el-button>
            <el-button v-if="isOperator" @click="inviteVisible = true">邀请协作成员</el-button>
            <el-button v-if="operationTeam.directReports?.length" type="primary" @click="openTeamTaskCreate">安排任务</el-button>
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
              <p class="task-summary">{{ taskCardSummary(task) }}</p>
              <p v-if="task.returnReason" class="return-note">修改要求：{{ task.returnReason }}</p>
            </div>
            <div class="task-actions">
              <el-button @click="openTaskDetail(task)">查看详情</el-button>
              <el-button v-if="!isAiContentTask(task) && ['ACCEPTED','RETURNED'].includes(task.status)" type="primary" @click="startTask(task)">开始任务</el-button>
              <el-button v-if="!isAiContentTask(task) && ['ACCEPTED','IN_PROGRESS','RETURNED'].includes(task.status)" @click="openSubmit(task)">提交成果</el-button>
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
              <p class="task-summary">{{ taskCardSummary(task) }}</p>
              <p v-if="task.submissions?.[0]" class="task-summary"><strong>最新提交：</strong>{{ task.submissions[0].summary }}</p>
            </div>
            <div class="task-actions">
              <el-button @click="openTaskDetail(task)">查看详情</el-button>
              <el-button v-if="!['COMPLETED','CANCELLED','VERIFIED'].includes(task.status)" :type="task.priority === 'URGENT' ? 'danger' : 'default'" @click="setTeamTaskUrgency(task, task.priority !== 'URGENT')">{{ task.priority === "URGENT" ? "取消紧急" : "标记紧急" }}</el-button>
              <el-button v-if="!['COMPLETED','CANCELLED','VERIFIED'].includes(task.status)" @click="openTeamTaskEdit(task)">修改</el-button>
              <el-button v-if="!['COMPLETED','CANCELLED','VERIFIED'].includes(task.status)" type="danger" plain @click="cancelOwnedTask(task, true)">取消任务</el-button>
              <el-button v-if="task.status === 'CANCELLED'" @click="openTeamTaskCopy(task)">复制再次安排</el-button>
              <el-button v-if="task.status === 'CANCELLED'" type="danger" plain :loading="trashingTaskId === task.id" @click="trashCancelledTask(task)">删除</el-button>
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
            <span v-if="dataCenterUpdatedAt" class="data-updated-at">本地缓存更新于 {{ formatTime(dataCenterUpdatedAt) }}</span>
            <el-button :loading="dataCenterLoading" @click="refreshDataCenter">手动重新拉取当前栏目</el-button>
            <el-button v-if="can('ASSET_UPLOAD')" type="primary" @click="openUpload">上传素材</el-button>
            <el-button v-if="can('KNOWLEDGE_SUBMIT')" @click="knowledgeVisible = true">补充知识</el-button>
          </div>
        </section>

        <section class="data-module-nav">
          <button :class="{ active: dataCenterTab === 'knowledge' }" @click="switchDataCenterTab('knowledge')"><el-icon><Collection /></el-icon><span>品牌知识</span><b>{{ dataCenter.summary.knowledge || 0 }}</b><small>产品、FAQ与SOP</small></button>
          <button :class="{ active: dataCenterTab === 'assets' }" @click="switchDataCenterTab('assets')"><el-icon><Files /></el-icon><span>素材库</span><b>{{ dataCenter.summary.assets || 0 }}</b><small>全库检索与调用</small></button>
          <button :class="{ active: dataCenterTab === 'keywords' }" @click="switchDataCenterTab('keywords')"><el-icon><Search /></el-icon><span>智能关键词</span><b>{{ dataCenter.summary.keywords || 0 }}</b><small>选题和流量方向</small></button>
          <button :class="{ active: dataCenterTab === 'viral' }" @click="switchDataCenterTab('viral')"><el-icon><DataAnalysis /></el-icon><span>爆款研究</span><b>{{ dataCenter.summary.viralVideos || 0 }}</b><small>结构拆解与仿拍</small></button>
          <button :class="{ active: dataCenterTab === 'videoFactory' }" @click="switchDataCenterTab('videoFactory')"><el-icon><VideoCamera /></el-icon><span>视频工厂</span><b>{{ dataCenter.summary.videoProjects || 0 }}</b><small>脚本与执行包</small></button>
        </section>

        <section v-if="dataCenterTab === 'assets'" class="data-quick-switch" aria-label="素材类型快速切换">
          <button v-for="item in [{ label: '全部', value: '' }, { label: '视频', value: 'VIDEO' }, { label: '图片', value: 'IMAGE' }, { label: '音频', value: 'AUDIO' }, { label: '文档', value: 'DOCUMENT' }]" :key="item.value || 'ALL'" :class="{ active: dataCenterFilters.kind === item.value }" @click="setAssetKind(item.value)">{{ item.label }}</button>
        </section>

        <section v-if="dataCenterTab === 'assets'" class="data-quick-switch" aria-label="资源用途">
          <button :class="{ active: dataCenterFilters.purpose === '' }" @click="setAssetPurpose('')">全部用途</button>
          <button :class="{ active: dataCenterFilters.purpose === 'EDITING_FOOTAGE' }" @click="setAssetPurpose('EDITING_FOOTAGE')">剪辑镜头</button>
          <button :class="{ active: dataCenterFilters.purpose === 'PACKAGING_RESOURCE' }" @click="setAssetPurpose('PACKAGING_RESOURCE')">包装资源</button>
        </section>

        <section v-if="dataCenterTab === 'knowledge'" class="data-quick-switch" aria-label="品牌知识快速切换">
          <button v-for="item in [{ label: '全部知识', value: '' }, { label: '产品', value: 'PRODUCT' }, { label: '知识 / SOP', value: 'KNOWLEDGE_GROUP' }, { label: 'FAQ', value: 'FAQ' }, { label: '资质', value: 'QUALIFICATION' }]" :key="item.value || 'ALL'" :class="{ active: dataCenterFilters.type === item.value }" @click="setKnowledgeType(item.value)">{{ item.label }}</button>
        </section>

        <section v-if="['assets','knowledge','keywords'].includes(dataCenterTab)" class="section-card data-toolbar">
          <div class="data-search" :class="{ compact: dataCenterTab !== 'assets' }">
            <el-input v-model="dataCenterFilters.query" clearable placeholder="搜索名称、编号、内容或知识" @keyup.enter="searchDataCenter">
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-select v-model="dataCenterFilters.model" clearable filterable placeholder="搜索或选择产品型号">
              <el-option v-for="product in productOptions" :key="product.id" :label="`${product.modelCode} · ${product.name}`" :value="product.modelCode" />
            </el-select>
            <el-select v-if="dataCenterTab === 'assets'" v-model="dataCenterFilters.kind" clearable placeholder="素材类型">
              <el-option label="图片" value="IMAGE" />
              <el-option label="视频" value="VIDEO" />
              <el-option label="文档" value="DOCUMENT" />
              <el-option label="音频" value="AUDIO" />
            </el-select>
            <el-select v-if="dataCenterTab === 'assets'" v-model="dataCenterFilters.moduleType" clearable placeholder="视频模块">
              <el-option v-for="item in classificationOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
            <el-select
              v-if="dataCenterTab === 'assets' && dataCenterFilters.purpose === 'PACKAGING_RESOURCE'"
              v-model="dataCenterFilters.packagingCategory"
              clearable
              placeholder="包装资源分类"
            >
              <el-option label="背景音乐 BGM" value="BGM" />
              <el-option label="音效" value="SOUND_EFFECT" />
              <el-option label="贴纸素材" value="STICKER" />
              <el-option label="视频特效" value="VIDEO_EFFECT" />
              <el-option label="文字特效" value="TEXT_EFFECT" />
              <el-option label="字体" value="FONT" />
              <el-option label="品牌元素" value="BRAND_ELEMENT" />
              <el-option label="授权资料" value="LICENSE_DOCUMENT" />
            </el-select>
            <el-button type="primary" @click="searchDataCenter">查找</el-button>
          </div>
        </section>

        <section v-if="dataCenterTab === 'assets'" v-loading="dataCenterLoading">
          <div class="workspace-summary asset-summary">
            <strong>素材检索结果 {{ dataCenter.summary.assetResults || 0 }} 条</strong>
            <span>全库可用素材 {{ dataCenter.summary.assets || 0 }} 条，按评级优先展示；输入型号、场景或模块可检索全库。</span>
            <el-button v-if="canGenerateVideoScript" size="small" plain @click="assetGapVisible = true">AI 缺失素材分析</el-button>
          </div>
          <div class="asset-grid">
            <article v-for="asset in dataCenter.assets" :key="asset.id" class="asset-card" role="button" tabindex="0" @click="openAssetPreview(asset)" @keydown.enter="openAssetPreview(asset)">
              <div class="asset-thumb">
                <img v-if="asset.thumbnailUrl" :src="asset.thumbnailUrl" :alt="asset.displayName || asset.assetNo" />
                <el-icon v-else><Files /></el-icon>
                <span v-if="asset.kind === 'VIDEO'" class="asset-play">▶</span>
                <small class="asset-kind-label">{{ asset.kind === "VIDEO" ? "视频" : asset.kind === "IMAGE" ? "图片" : asset.kind === "AUDIO" ? "音频" : "文档" }}</small>
                <b>{{ asset.grade || "B" }}</b>
              </div>
              <div class="asset-copy">
                <el-tag v-if="asset.purpose === 'PACKAGING_RESOURCE'" size="small" type="warning">
                  包装资源 · {{ asset.packagingCategory || "其他" }}
                </el-tag>
                <div class="task-meta"><span>{{ asset.kind || "素材" }}</span><span>{{ asset.model || asset.productScope || "通用" }}</span><span>{{ asset.qualityScore || 0 }}分</span></div>
                <h4>{{ asset.displayName || asset.fileName || asset.assetNo }}</h4>
                <p>{{ asset.contentDescription || asset.searchText || "已审核可调用素材" }}</p>
                <div class="asset-index-state">
                  <el-tag size="small" :type="assetIndexStatus(asset).type">{{ assetIndexStatus(asset).label }}</el-tag>
                  <span>置信度 {{ Math.round(Number(asset.indexConfidence || 0) * 100) }}%</span>
                  <span v-if="['VIDEO','IMAGE'].includes(asset.kind) && !asset.thumbnailUrl">封面待生成</span>
                </div>
                <small>{{ asset.assetNo }}</small>
              </div>
            </article>
            <el-empty v-if="!dataCenter.assets?.length" description="没有找到符合条件的可用素材" />
          </div>
          <el-pagination
            v-if="Number(dataCenter.pagination?.total || 0) > 30"
            class="data-pagination"
            background
            layout="prev, pager, next, total"
            :current-page="assetPage"
            :page-size="30"
            :total="Number(dataCenter.pagination?.total || 0)"
            @current-change="changeDataCenterPage"
          />
        </section>

        <section v-else-if="dataCenterTab === 'knowledge'" v-loading="dataCenterLoading" class="section-card knowledge-list">
          <article v-for="item in dataCenter.knowledge" :key="item.id" class="knowledge-card" tabindex="0" role="button" @click="openKnowledgeDetail(item)" @keydown.enter="openKnowledgeDetail(item)">
            <div class="knowledge-type">{{ item.type || "知识" }}</div>
            <div>
              <div class="task-meta"><span>{{ item.category || "未分类" }}</span><span>{{ item.model || "品牌通用" }}</span></div>
              <h4>{{ item.title }}</h4>
              <p>{{ item.summary || item.reply || item.body || "已审核知识" }}</p>
              <small class="knowledge-view-hint">点击查看完整内容</small>
            </div>
          </article>
          <el-empty v-if="!dataCenter.knowledge?.length" description="没有找到符合条件的知识" />
        </section>

        <section v-else-if="dataCenterTab === 'keywords'" v-loading="dataCenterLoading" class="keyword-workspace">
          <div class="workspace-summary"><strong>智能关键词 {{ dataCenter.keywords?.total || 0 }} 条</strong><span>按机会分和优先级排序，点击“用于视频”即可带入视频工厂。</span></div>
          <div class="keyword-grid">
            <article v-for="keyword in dataCenter.keywords?.items || []" :key="keyword.id">
              <div><el-tag :type="keyword.grade === 'S' ? 'danger' : keyword.grade === 'A' ? 'warning' : 'info'">{{ keyword.grade || keyword.priority || 'B' }}</el-tag><small>{{ platformLabel(keyword.platform) }} · {{ keyword.type }}</small></div>
              <h4>{{ keyword.keyword }}</h4>
              <p>{{ keyword.reason || [keyword.audience, keyword.pain, keyword.scene].filter(Boolean).join(" · ") || "可用于内容选题与平台搜索" }}</p>
              <div class="keyword-score"><span>机会分</span><strong>{{ Number(keyword.opportunityScore || 0).toFixed(0) }}</strong></div>
              <el-button type="primary" plain @click="useKeywordInFactory(keyword)">创建内容任务</el-button>
            </article>
          </div>
          <el-empty v-if="!dataCenter.keywords?.items?.length" description="当前没有符合条件的关键词" />
        </section>

        <section v-else-if="dataCenterTab === 'viral'" v-loading="dataCenterLoading" class="viral-workspace">
          <el-alert
            v-if="dataCenter.viralTrend?.summary?.freshness && dataCenter.viralTrend.summary.freshness !== 'FRESH'"
            title="爆款采集数据已过期，仅供参考"
            description="采集器恢复并完成新一轮同步前，不会把这些旧数据直接带入新的内容任务。"
            type="warning"
            :closable="false"
            show-icon
          />
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
                <el-button
                  type="primary"
                  :disabled="dataCenter.viralTrend?.summary?.freshness !== 'FRESH'"
                  @click="useViralVideoInFactory(video)"
                >创建赛电版本任务</el-button>
              </div>
            </article>
            <el-empty v-if="!dataCenter.viralTrend?.items?.length" description="暂无12小时爆款数据，等待采集任务同步" />
          </div>
        </section>

        <section v-else v-loading="dataCenterLoading" class="video-factory-workspace">
          <div v-if="!activeVideoProject && canGenerateVideoScript" class="factory-create-entry">
            <el-button type="primary" size="large" @click="openNewVideoProjectDialog">新建智能视频项目</el-button>
          </div>

          <div class="section-card factory-results-toolbar">
            <div>
              <el-button v-if="activeVideoProject" text @click="closeVideoProject">← 返回项目列表</el-button>
              <h3>{{ activeVideoProject ? activeVideoProject.topic : "视频项目" }}</h3>
              <p>{{ activeVideoProject ? `${activeVideoProject.productionNo} · ${videoProjectStageLabel(activeVideoProject.productionStage)}` : `最新生成的项目优先显示，每页 ${videoProjectPageSize} 条。` }}</p>
            </div>
            <div v-if="!activeVideoProject" class="factory-results-actions">
              <el-select v-model="videoProjectStatus" placeholder="全部项目状态" @change="filterVideoProjects">
                <el-option label="全部项目" value="" />
                <el-option label="脚本生成中" value="SCRIPT_GENERATING" />
                <el-option label="项目脚本已生成" value="FACTORY_SCRIPT_READY" />
                <el-option label="脚本已通过" value="SCRIPT_APPROVED" />
                <el-option label="素材准备中" value="FACTORY_GENERATING" />
                <el-option label="可进入AI剪辑" value="READY_TO_EDIT" />
                <el-option label="AI剪辑中" value="EDITING" />
                <el-option label="成片待审核" value="VIDEO_REVIEW" />
                <el-option label="最终成品" value="FINAL_PRODUCT" />
                <el-option label="包装待审核" value="PACKAGING_REVIEW" />
              </el-select>
              <div class="factory-page-controls">
                <el-button :disabled="videoProjectPage <= 1" @click="changeDataCenterPage(videoProjectPage - 1)">上一页</el-button>
                <span>第 {{ videoProjectPage }} / {{ Math.max(1, Math.ceil(Number(dataCenter.pagination?.total || 0) / videoProjectPageSize)) }} 页</span>
                <el-button
                  :disabled="videoProjectPage * videoProjectPageSize >= Number(dataCenter.pagination?.total || 0)"
                  @click="changeDataCenterPage(videoProjectPage + 1)"
                >下一页</el-button>
              </div>
              <el-button v-if="canGenerateVideoScript" @click="openVideoRecycleBin">回收站</el-button>
            </div>
          </div>

          <div v-if="!activeVideoProject" class="factory-project-overview-grid">
            <article v-for="project in dataCenter.videoProjects || []" :key="`overview-${project.id}`" class="section-card factory-project-overview">
              <div class="factory-project-head">
                <div>
                  <div class="task-meta"><span>{{ platformLabel(project.targetPlatforms?.[0]) }}</span><span>{{ project.productModel || "品牌通用" }}</span><span>{{ project.productionNo }}</span></div>
                  <h3>{{ project.topic }}</h3>
                  <p>单项目 · {{ projectCandidates(project).length }} 份候选脚本 · 选择一份进入后续制作</p>
                </div>
                <el-tag type="success">{{ videoProjectStageLabel(project.productionStage) }}</el-tag>
              </div>
              <div class="project-overview-progress">
                <span>当前阶段</span>
                <strong>{{ videoFlowStep(project) }} / 7 · {{ videoFlowSteps[videoFlowStep(project) - 1] }}</strong>
              </div>
              <div class="project-overview-actions">
                <small>更新于 {{ formatTime(project.updatedAt || project.createdAt) }}</small>
                <el-button type="primary" @click="openVideoProject(project)">进入项目</el-button>
              </div>
            </article>
            <el-empty v-if="!dataCenter.videoProjects?.length" description="暂无视频项目，可从上方创建" />
          </div>

          <div v-if="activeVideoProject" class="video-project-flow-tabs section-card">
            <div
              v-for="(step, index) in videoFlowSteps"
              :key="step"
              :class="{ active: videoFlowStep(activeVideoProject) === index + 1, done: videoFlowStep(activeVideoProject) > index + 1 }"
            >
              <b>{{ index + 1 }}</b><span>{{ step }}</span>
            </div>
          </div>

          <div v-if="activeVideoProject" class="factory-projects">
            <article v-for="project in [activeVideoProject]" :key="project.id" class="section-card factory-project">
              <div class="factory-project-head">
                <div><div class="task-meta"><span>{{ platformLabel(project.targetPlatforms?.[0]) }}</span><span>{{ project.productModel || "品牌通用" }}</span><span>{{ videoVoiceoverLabel(project) }}</span><span>{{ project.productionNo }}</span><span>生成于 {{ formatTime(project.createdAt) }}</span><span v-if="project.updatedAt !== project.createdAt">更新于 {{ formatTime(project.updatedAt) }}</span></div><h3>{{ project.topic }}</h3></div>
                <div class="factory-project-head-actions">
                  <el-tag>{{ videoProjectStageLabel(project.productionStage) }}</el-tag>
                  <el-button
                    v-if="canGenerateVideoScript"
                    type="danger"
                    plain
                    :disabled="videoProjectHasActiveJob(project)"
                    :loading="archivingVideoProjectId === project.id"
                    @click="archiveVideoProject(project)"
                  >删除</el-button>
                </div>
              </div>
              <section
                v-if="project.productionStage === 'SCRIPT_GENERATING' || projectWaitingForScripts(project)"
                class="project-running-panel"
              >
                <el-tag type="warning">双引擎脚本生成中</el-tag>
                <h3>等待所选脚本引擎全部返回，再进入对比审核</h3>
                <p>已经完成的候选会暂存，但不会提前推进到脚本审核，也不会隐藏另一个引擎的结果。</p>
                <div class="script-engine-progress">
                  <span :class="{ done: projectScriptEngineStatus(project).REMOTE_CODEX === 'COMPLETED' }">
                    远程 Codex + 剪辑 Skill · {{ projectScriptEngineStatus(project).REMOTE_CODEX === "COMPLETED" ? "已完成" : "生成中" }}
                  </span>
                  <span :class="{ done: projectScriptEngineStatus(project).SYSTEM_AI === 'COMPLETED' }">
                    系统 AI 脚本工厂 · {{ projectScriptEngineStatus(project).SYSTEM_AI === "COMPLETED" ? "已完成" : "生成中" }}
                  </span>
                </div>
              </section>
              <div
                v-if="projectCandidates(project).length && videoFlowStep(project) === 3"
                class="candidate-grid"
                :class="{ dual: projectCandidates(project).length > 1, 'script-review-workspace': true }"
              >
                <article v-for="(candidate, index) in displayedProjectCandidates(project)" :key="`${project.id}-${index}`">
                  <small>{{ scriptEngineLabel(candidate) }} · {{ candidate.score || 0 }}分</small>
                  <h4>{{ candidate.title || candidate.topic }}</h4>
                  <p><b>HOOK：</b>{{ candidate.hook }}</p>
                  <p class="candidate-full-script"><b>完整脚本：</b>{{ candidate.script || candidate.scripts?.zh30 || candidate.scripts?.zh15 || candidate.outline?.join("；") }}</p>
                  <el-button v-if="candidate.scriptPackage" @click="openScriptPackage(candidate)">查看完整脚本</el-button>
                  <template v-if="project.productionStage === 'FACTORY_SCRIPT_READY'">
                    <el-button @click="openScriptEditor(project, candidate, index)">直接修改脚本</el-button>
                    <el-button
                      type="success"
                      :loading="reviewingScriptProjectId === project.id"
                      @click="reviewProjectScript(project, true, index)"
                    >脚本审核通过</el-button>
                    <el-button
                      type="danger"
                      plain
                      :loading="reviewingScriptProjectId === project.id"
                      @click="reviewProjectScript(project, false, index)"
                    >退回并填写原因</el-button>
                  </template>
                  <el-tag v-else-if="project.productionStage === 'SCRIPT_APPROVED'" type="success">脚本已审核通过</el-tag>
                </article>
              </div>
              <div v-if="project.videoShots?.length && videoFlowStep(project) === 4" class="shot-panel">
                <button type="button" class="shot-summary" @click="toggleVideoProjectShots(project.id)">
                  <span>已形成 {{ project.videoShots.length }} 个镜头任务 · {{ project.videoShots.filter((shot: Row) => !shot.selectedAssetId).length }} 个镜头待补拍或生成</span>
                  <b>{{ expandedVideoProjectIds.includes(project.id) ? "收起镜头任务" : "查看镜头任务" }}</b>
                </button>
                <div v-if="canGenerateVideoScript && projectMaterialsComplete(project) && ['MATERIAL_REVIEW','MATERIAL_RETURNED'].includes(project.productionStage)" class="preview-actions">
                  <el-button type="success" @click="reviewProjectMaterials(project, true)">确认素材齐全</el-button>
                  <el-button type="danger" plain @click="reviewProjectMaterials(project, false)">退回素材匹配</el-button>
                </div>
                <el-alert
                  v-if="projectMaterialReview(project).status === 'RETURNED'"
                  :title="`素材退回原因：${projectMaterialReview(project).note || '未填写'}`"
                  type="warning"
                  :closable="false"
                />
                <el-button
                  v-if="canGenerateVideoScript && projectReadyToRender(project) && !project.videoRenderJobs?.some((job: Row) => ['PENDING','RUNNING','RETRY'].includes(job.status))"
                  type="primary"
                  :loading="renderingProjectId === project.id"
                  @click="renderWorkbenchProject(project)"
                >提交远程视频生成任务</el-button>
                <div v-if="expandedVideoProjectIds.includes(project.id)" class="shot-task-list">
                  <article v-for="(shot, shotIndex) in project.videoShots" :key="shot.id" class="shot-task">
                    <div class="shot-task-index">{{ shotIndex + 1 }}</div>
                    <div class="shot-task-copy">
                      <div class="shot-task-title">
                        <strong>{{ shot.title || `镜头 ${shotIndex + 1}` }}</strong>
                        <el-tag size="small" :type="shotStatusType(shot)">{{ shotStatusText(shot) }}</el-tag>
                      </div>
                      <p>{{ shot.description || "暂未填写画面要求" }}</p>
                      <small>脚本位置：第 {{ Number(shot.sequence || shotIndex) + 1 }} 句 · 建议时长 {{ shot.durationSeconds || 5 }} 秒<span v-if="shot.selectedAsset"> · {{ shot.selectedAsset.displayName || shot.selectedAsset.fileName }}</span></small>
                      <div v-if="shot.selectedAsset" class="shot-binding-detail">
                        <span><b>远程可访问路径：</b>{{ shot.selectedAsset.sourcePath || shot.selectedAsset.storageUrl || "等待系统生成访问路径" }}</span>
                        <span v-if="shot.metadata?.sourceIn != null || shot.metadata?.sourceOut != null"><b>有效时间段：</b>{{ shot.metadata?.sourceIn ?? 0 }}s–{{ shot.metadata?.sourceOut ?? "结尾" }}s</span>
                        <span v-if="shot.metadata?.visibleFacts?.length"><b>画面事实：</b>{{ shot.metadata.visibleFacts.join("；") }}</span>
                      </div>
                      <el-alert
                        v-if="shot.status === 'FAILED' && shot.generationJobs?.[0]?.failureReason"
                        :title="shot.generationJobs[0].failureReason"
                        type="error"
                        :closable="false"
                      />
                    </div>
                    <div class="shot-task-actions">
                      <el-button v-if="shot.selectedAsset" @click="openAssetPreview(shot.selectedAsset)">预览素材</el-button>
                      <el-button v-if="!shot.selectedAssetId && can('ASSET_UPLOAD')" @click="openShotUpload(project, shot)">上传补拍</el-button>
                      <el-button
                        v-if="!shot.selectedAssetId && ['OPEN', 'FAILED'].includes(shot.status)"
                        type="primary"
                        plain
                        :loading="generatingShotId === shot.id"
                        @click="generateWorkbenchShot(project, shot)"
                      >AI生成</el-button>
                    </div>
                  </article>
                </div>
              </div>
              <section v-if="project.productionStage === 'EDITING'" class="project-running-panel">
                <el-tag type="warning">视频生成中</el-tag>
                <h3>远程 Codex 正在使用已确认脚本和绑定素材剪辑</h3>
                <p>系统已向远程节点提供每个脚本位置对应的素材路径、有效时间段、画面事实和使用限制。成片完成后自动进入审核。</p>
                <el-steps :active="3" finish-status="success" simple>
                  <el-step title="素材清单已锁定" /><el-step title="配音字幕处理中" /><el-step title="剪辑包装与质检" /><el-step title="等待成片回传" />
                </el-steps>
              </section>
              <section v-if="videoFlowStep(project) >= 6" class="finished-video-panel">
                <div class="finished-video-head">
                  <div>
                    <h4>成片与审核</h4>
                    <p>脚本通过且镜头齐套后提交远程Codex剪辑；成片完成会自动进入审核流程。</p>
                  </div>
                  <el-button
                    v-if="canGenerateVideoScript && projectReadyToRender(project) && !project.videoRenderJobs?.some((job: Row) => ['PENDING','RUNNING','RETRY'].includes(job.status))"
                    type="primary"
                    :loading="renderingProjectId === project.id"
                    @click="renderWorkbenchProject(project)"
                  >{{ project.videoRenderJobs?.length ? "提交远程重新剪辑" : "提交远程视频生成任务" }}</el-button>
                </div>
                <div v-if="project.videoRenderJobs?.length" class="finished-video-list">
                  <article v-for="(job, jobIndex) in project.videoRenderJobs" :key="job.id" class="finished-video-item">
                    <div class="finished-video-poster" :class="{ empty: !job.outputAsset?.thumbnailUrl }">
                      <img v-if="job.outputAsset?.thumbnailUrl" :src="job.outputAsset.thumbnailUrl" :alt="job.outputAsset.displayName || '成片封面'" />
                      <el-icon v-else><VideoCamera /></el-icon>
                    </div>
                    <div class="finished-video-copy">
                      <div><strong>成片版本 V{{ project.videoRenderJobs.length - Number(jobIndex) }}</strong><el-tag size="small" :type="renderStatusType(job)">{{ renderStatusText(job) }}</el-tag></div>
                      <p>{{ job.outputAsset?.displayName || job.outputAsset?.fileName || `渲染任务 ${job.id.slice(-6)}` }}</p>
                      <small>提交于 {{ formatTime(job.createdAt) }}<template v-if="job.finishedAt"> · 完成于 {{ formatTime(job.finishedAt) }}</template></small>
                      <el-alert v-if="job.failureReason" :title="job.failureReason" type="error" :closable="false" />
                      <el-alert v-if="videoReturnNote(job)" :title="`退回说明：${videoReturnNote(job)}`" type="warning" :closable="false" />
                      <small v-if="job.status === 'SUCCEEDED' && job.outputAsset?.reviewStatus === 'PENDING'" class="review-hint">已提交内容审核，请等待审核结果</small>
                    </div>
                    <div class="finished-video-actions">
                      <el-button v-if="job.outputAsset" @click="openAssetPreview(job.outputAsset, '成片预览')">预览成片</el-button>
                      <el-button v-if="job.outputAsset" @click="downloadWorkbenchAsset(job.outputAsset)">下载成片</el-button>
                      <el-button
                        v-if="job.status === 'SUCCEEDED' && job.outputAsset?.reviewStatus === 'APPROVED' && canGenerateVideoScript && ['READY_TO_PUBLISH','PUBLISHING','TRACKING'].includes(project.productionStage)"
                        @click="openPublishLink(project, job)"
                      >{{ project.variants?.some((variant: Row) => variant.manualPublishUrl) ? "更新发布链接" : "回传发布链接" }}</el-button>
                      <el-button
                        v-for="variant in project.variants?.filter((item: Row) => item.manualPublishUrl) || []"
                        :key="`${job.id}-${variant.id}-published`"
                        type="success"
                        plain
                        @click="openPublishedVideo(variant.manualPublishUrl)"
                      >查看{{ platformLabel(variant.platform) }}作品</el-button>
                      <template v-if="job.status === 'SUCCEEDED' && job.outputAsset?.reviewStatus === 'PENDING' && canGenerateVideoScript">
                        <el-button
                          type="success"
                          :loading="reviewingVideoAssetId === job.outputAsset.id"
                          @click="openVideoReview(project, job, 'APPROVE')"
                        >审核通过</el-button>
                        <el-button
                          type="danger"
                          plain
                          :loading="reviewingVideoAssetId === job.outputAsset.id"
                          @click="openVideoReview(project, job, 'RETURN')"
                        >退回修改</el-button>
                      </template>
                      <el-button
                        v-if="job.status === 'SUCCEEDED' && job.outputAsset?.reviewStatus === 'APPROVED' && canGenerateVideoScript"
                        type="success"
                        plain
                        @click="openSimilarVideo(project, job)"
                      >一键生成类似视频</el-button>
                      <el-button
                        v-if="job.status === 'SUCCEEDED' && job.outputAsset?.reviewStatus === 'APPROVED' && canGenerateVideoScript"
                        type="primary"
                        :loading="generatingPackagingProjectId === project.id"
                        @click="generateProjectPackaging(project, job)"
                      >{{ project.variants?.some((variant: Row) => variant.coverPath) ? "重新生成封面和标题" : "成片满意，生成封面和标题" }}</el-button>
                    </div>
                  </article>
                </div>
                <el-empty v-else :image-size="56" description="暂未生成成片" />
                <div v-if="project.variants?.some((variant: Row) => variant.coverPath)" class="packaging-result-list">
                  <article v-for="variant in project.variants.filter((item: Row) => item.coverPath)" :key="variant.id" class="packaging-result-card">
                    <div>
                      <el-tag size="small">{{ variant.platform }}</el-tag>
                      <el-tag size="small" :type="variant.packagingStatus === 'APPROVED' ? 'success' : variant.packagingStatus === 'RETURNED' ? 'danger' : 'warning'">
                        {{ variant.packagingStatus === "APPROVED" ? "包装已通过" : variant.packagingStatus === "RETURNED" ? "包装已退回" : "待包装审核" }}
                      </el-tag>
                      <strong>{{ variant.title || "待生成标题" }}</strong>
                      <p>{{ variant.body || "暂无发布文案" }}</p>
                      <small v-if="variant.packagingRejectedReason">退回说明：{{ variant.packagingRejectedReason }}</small>
                    </div>
                    <el-button @click="openPackagingPreview(project, variant)">预览封面和标题</el-button>
                  </article>
                </div>
                <el-alert
                  v-if="project.videoShots?.length && !projectReadyToRender(project) && !projectHasApprovedMaster(project)"
                  title="镜头素材尚未齐套，完成补拍或AI生成后才能开始剪辑"
                  type="warning"
                  :closable="false"
                />
              </section>
            </article>
          </div>
          <el-pagination
            v-if="!activeVideoProject && Number(dataCenter.pagination?.total || 0) > videoProjectPageSize"
            class="data-pagination"
            background
            layout="prev, pager, next, total"
            :current-page="videoProjectPage"
            :page-size="videoProjectPageSize"
            :total="Number(dataCenter.pagination?.total || 0)"
            @current-change="changeDataCenterPage"
          />
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
          <div class="section-heading">
            <div><h3>消息通知</h3><p>点击任务消息会直接打开对应任务。</p></div>
            <el-button :disabled="!notices.some((item: Row) => !item.readAt)" @click="readAllNotices">全部标为已读</el-button>
          </div>
          <article
            v-for="notice in notices"
            :key="notice.id"
            :class="{ unread: !notice.readAt }"
            role="button"
            tabindex="0"
            @click="readNotice(notice)"
            @keydown.enter.prevent="readNotice(notice)"
            @keydown.space.prevent="readNotice(notice)"
          >
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
      <button :class="{active: active === 'outputs'}" @click="switchPage('outputs')"><el-icon><Files /></el-icon><span>成品</span></button>
      <button v-if="isCollaborator" :class="{active: active === 'team'}" @click="switchPage('team')"><el-icon><DocumentChecked /></el-icon><span>协作</span></button>
      <button v-if="canUseDataCenter" :class="{active: active === 'data'}" @click="switchPage('data')"><el-icon><Files /></el-icon><span>数据</span></button>
      <button v-if="isLiveHost" :class="{active: active === 'live'}" @click="switchPage('live')"><el-icon><VideoCamera /></el-icon><span>直播</span></button>
      <button :class="{active: active === 'messages'}" @click="switchPage('messages')"><el-icon><Bell /></el-icon><span>消息</span><i v-if="dashboard.summary.unread">{{ dashboard.summary.unread }}</i></button>
    </nav>
  </div>

  <el-drawer v-model="taskDetailVisible" title="任务详情" size="min(680px, 94vw)" class="task-detail-drawer">
    <div v-loading="taskDetailLoading">
    <template v-if="taskDetail">
      <div class="task-detail-header">
        <div class="task-meta">
          <el-tag :type="statusType(taskStatusCode(taskDetail))">{{ taskDisplayStatus(taskDetail) }}</el-tag>
          <el-tag v-if="taskDetail.priority === 'URGENT'" type="danger">紧急</el-tag>
          <span>{{ taskDetail.taskNo || "自建任务" }}</span>
        </div>
        <h2>{{ taskDetail.title }}</h2>
      </div>
      <dl class="task-detail-meta">
        <div><dt>安排人</dt><dd>{{ taskDetail.assignedByEmployee?.name || taskDetail.assignedBy || "本人" }}</dd></div>
        <div><dt>执行人</dt><dd>{{ taskDetail.assignee?.name || taskDetail.owner || "待领取" }}</dd></div>
        <div><dt>优先级</dt><dd>{{ priorityLabels[taskDetail.priority] || taskDetail.priority }}</dd></div>
        <div><dt>截止时间</dt><dd>{{ formatTime(taskDetail.dueAt) }}</dd></div>
      </dl>
      <el-alert
        v-if="taskDetail.projection?.aiTask"
        :title="`${taskDetail.projection.displayStatus} · ${taskDetail.projection.currentPhase}`"
        :description="`${taskDetail.projection.aiTask.progress || 0}% · ${taskDetail.projection.aiTask.progressMessage || '等待Codex处理'} · 下一步：${taskDetail.projection.nextAction}`"
        type="info"
        :closable="false"
        show-icon
      />
      <section class="task-detail-section task-detail-scroll">
        <div class="task-detail-section-heading">
          <h3>任务说明</h3>
          <el-button size="small" plain @click="copyTaskContent(taskDetail.description, '任务说明')">复制内容</el-button>
        </div>
        <TaskRichTextContent :document="taskDetail.descriptionDocument" :text="taskDetail.description" />
      </section>
      <section class="task-detail-section task-detail-scroll">
        <div class="task-detail-section-heading">
          <h3>期望交付结果</h3>
          <el-button size="small" plain @click="copyTaskContent(taskDetail.expectedResult, '期望交付结果')">复制内容</el-button>
        </div>
        <TaskRichTextContent :document="taskDetail.expectedResultDocument" :text="taskDetail.expectedResult" />
      </section>
      <section v-if="taskAttachments(taskDetail).length" class="task-detail-section">
        <h3>附件</h3>
        <a v-for="(item, index) in taskAttachments(taskDetail)" :key="item.id || index" :href="item.url || item.fileUrl" target="_blank" rel="noopener noreferrer">{{ item.name || item.fileName || `附件 ${index + 1}` }}</a>
      </section>
      <section v-if="taskDetail.projection?.deliverables?.length" class="task-detail-section ai-result-section">
        <h3>审核通过的成果</h3>
        <article v-for="output in taskDetail.projection.deliverables" :key="output.id" class="task-output-card">
          <div class="task-output-heading">
            <div><strong>{{ output.title }}</strong><span>{{ output.previewKind === "VIDEO" ? "视频" : output.previewKind === "IMAGE" ? "图片" : output.previewKind === "ARTICLE" ? "软文" : "文档" }} · 第{{ output.version }}版 · 已审核</span></div>
            <a v-if="taskOutputUrls[output.id]" :href="taskOutputUrls[output.id]" target="_blank" rel="noopener noreferrer">预览/下载</a>
          </div>
          <video v-if="isVideoOutput(output) && taskOutputUrls[output.id]" :src="taskOutputUrls[output.id]" controls playsinline preload="metadata" />
          <img v-else-if="isImageOutput(output) && taskOutputUrls[output.id]" :src="taskOutputUrls[output.id]" :alt="output.title" />
          <iframe v-else-if="isPdfOutput(output) && taskOutputUrls[output.id]" :src="taskOutputUrls[output.id]" :title="output.title" />
          <pre v-else-if="outputText(output)">{{ outputText(output) }}</pre>
          <p v-else class="muted">成果已记录，当前没有可直接预览的文件。</p>
        </article>
      </section>
      <section v-if="taskDetail.submissions?.length" class="task-detail-section">
        <h3>反馈与提交记录</h3>
        <article v-for="submission in taskDetail.submissions" :key="submission.id" class="feedback-row">
          <strong>{{ submission.employee?.name || "执行人" }} · 第{{ submission.version }}次</strong>
          <p>{{ submission.summary }}</p>
          <span>{{ formatTime(submission.createdAt) }}</span>
        </article>
      </section>
      <section v-if="taskDetail.returnReason" class="task-detail-section return-note"><h3>退回说明</h3><p>{{ taskDetail.returnReason }}</p></section>
      <div class="task-detail-actions">
        <el-button
          v-if="((taskDetail.sourceType === 'SELF_CREATED' && taskDetail.assigneeEmployeeId === user?.id) || (taskDetail.sourceType === 'OPERATOR_COLLAB' && taskDetail.assignedByEmployeeId === user?.id)) && (!isAiContentTask(taskDetail) || taskDetail.aiRequest?.status === 'WAITING_CONFIRMATION')"
          @click="taskDetailVisible = false; taskDetail.sourceType === 'SELF_CREATED' ? openSelfTaskEdit(taskDetail) : openTeamTaskEdit(taskDetail)"
        >编辑任务</el-button>
        <el-button v-if="!taskDetail.assigneeEmployeeId && taskDetail.status === 'OPEN'" type="primary" @click="acceptTask(taskDetail)">领取任务</el-button>
        <el-button v-if="!isAiContentTask(taskDetail) && taskDetail.assigneeEmployeeId === user?.id && ['ACCEPTED','RETURNED'].includes(taskDetail.status)" type="primary" @click="startTask(taskDetail)">开始任务</el-button>
        <el-button v-if="!isAiContentTask(taskDetail) && taskDetail.assigneeEmployeeId === user?.id && ['ACCEPTED','IN_PROGRESS','RETURNED'].includes(taskDetail.status)" @click="openSubmit(taskDetail)">提交成果</el-button>
        <el-button v-if="isAiContentTask(taskDetail) && ['COMPLETED','RETURNED','FAILED'].includes(taskDetail.aiRequest?.status)" @click="openSubmit(taskDetail)">反馈修改</el-button>
        <el-button v-if="taskDetail.assignedByEmployeeId === user?.id && taskDetail.status === 'REVIEW'" type="primary" @click="openTeamReview(taskDetail)">审核成果</el-button>
      </div>
    </template>
    </div>
  </el-drawer>

  <el-dialog v-model="outputPreviewVisible" title="成品预览" width="min(820px, 94vw)" destroy-on-close>
    <article v-if="outputPreview" class="system-output-preview">
      <div class="system-output-preview-head">
        <div><strong>{{ outputPreview.title }}</strong><span>{{ outputCategoryLabel(outputPreview) }} · {{ formatTime(outputPreview.createdAt) }}</span></div>
        <el-tag>{{ outputPreview.reviewStatus === "APPROVED" ? "已审核" : outputPreview.reviewStatus }}</el-tag>
      </div>
      <div v-if="outputPublishedVariants(outputPreview).length" class="output-published-links">
        <span>已回传发布作品</span>
        <el-button
          v-for="variant in outputPublishedVariants(outputPreview)"
          :key="`${variant.platform}-${variant.manualPublishUrl}`"
          type="success"
          plain
          @click="openPublishedVideo(variant.manualPublishUrl)"
        >查看{{ platformLabel(variant.platform) }}作品</el-button>
      </div>
      <video v-if="isVideoOutput(outputPreview) && outputPreviewUrl" :src="outputPreviewUrl" controls playsinline preload="metadata" />
      <img v-else-if="isImageOutput(outputPreview) && outputPreviewUrl" :src="outputPreviewUrl" :alt="outputPreview.title" />
      <iframe v-else-if="isPdfOutput(outputPreview) && outputPreviewUrl" :src="outputPreviewUrl" :title="outputPreview.title" />
      <pre v-else-if="outputText(outputPreview)">{{ outputText(outputPreview) }}</pre>
      <el-empty v-else description="该成品暂无可直接预览的文件" :image-size="72" />
    </article>
    <template #footer>
      <el-button
        v-for="variant in outputPublishedVariants(outputPreview)"
        :key="`footer-${variant.platform}-${variant.manualPublishUrl}`"
        type="success"
        plain
        @click="openPublishedVideo(variant.manualPublishUrl)"
      >查看{{ platformLabel(variant.platform) }}作品</el-button>
      <el-button v-if="outputPreviewUrl" tag="a" :href="outputPreviewUrl" target="_blank">下载</el-button>
      <el-button @click="recreateSystemOutput">调整参数重新创作</el-button>
      <el-button type="primary" @click="outputPreviewVisible = false">完成</el-button>
    </template>
  </el-dialog>

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

  <el-dialog v-model="selfTaskVisible" :title="editingSelfTaskId ? '修改我的任务' : copyingSelfTask ? '复制并再次添加' : '新建我的任务'" width="min(620px, 92vw)">
    <el-form label-position="top">
      <el-form-item label="内容任务类型" required>
        <el-radio-group v-model="selfTaskForm.contentType">
          <el-radio-button value="SHORT_VIDEO">短视频</el-radio-button>
          <el-radio-button value="IMAGE">图片</el-radio-button>
          <el-radio-button value="ARTICLE">软文</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <div class="team-form-row">
        <el-form-item label="产品" required>
          <el-select v-model="selfTaskForm.productId" filterable placeholder="选择产品">
            <el-option v-for="item in contentTaskOptions.products || []" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="平台">
          <el-select v-model="selfTaskForm.platform"><el-option label="抖音" value="DOUYIN" /><el-option label="TikTok" value="TIKTOK" /><el-option label="全平台" value="ALL" /></el-select>
        </el-form-item>
      </div>
      <el-form-item label="智能关键词（可选）">
        <el-select v-model="selfTaskForm.keywordId" clearable filterable placeholder="可选择关键词辅助生成选题">
          <el-option v-for="item in filteredTaskKeywords" :key="item.id" :label="`${item.keyword} · ${item.grade || 'C'}级 · ${Math.round(Number(item.opportunityScore || 0))}分`" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-button class="suggest-task-button" type="primary" plain :loading="generatingTaskSuggestion" @click="generateTaskSuggestion">智能生成选题、推荐与提示</el-button>
      <div class="team-form-row">
        <el-form-item label="目标用户"><el-input v-model="selfTaskForm.targetAudience" placeholder="例如：为父母选购健康手表的子女" /></el-form-item>
        <el-form-item label="核心痛点"><el-input v-model="selfTaskForm.corePain" placeholder="例如：入口多，不清楚如何查看数据" /></el-form-item>
      </div>
      <div class="team-form-row">
        <el-form-item label="推荐场景"><el-input v-model="selfTaskForm.recommendedScene" placeholder="例如：家庭首次连接与日常查看" /></el-form-item>
        <el-form-item label="Hook（可选）"><el-input v-model="selfTaskForm.hook" placeholder="例如：界面很多，先分清这三类入口" /></el-form-item>
      </div>
      <div v-if="selfTaskForm.contentType === 'SHORT_VIDEO'" class="team-form-row">
        <el-form-item label="视频任务模式">
          <el-select v-model="selfTaskForm.executionMode"><el-option label="生成完整视频" value="FULL_VIDEO" /><el-option label="仅生成脚本" value="SCRIPT_ONLY" /></el-select>
        </el-form-item>
        <el-form-item label="素材策略">
          <el-select v-model="selfTaskForm.materialStrategy"><el-option label="优先使用已审核真实素材" value="REAL_ASSET_FIRST" /><el-option label="仅使用指定素材" value="ASSIGNED_ONLY" /></el-select>
        </el-form-item>
      </div>
      <el-form-item label="任务标题" required><el-input v-model="selfTaskForm.title" placeholder="例如：整理本周待拍视频清单" /></el-form-item>
      <el-form-item label="任务说明"><TaskRichTextEditor v-model="selfTaskForm.descriptionDocument" placeholder="填写需要完成的具体工作" /></el-form-item>
      <el-form-item label="期望结果"><TaskRichTextEditor v-model="selfTaskForm.expectedResultDocument" placeholder="填写完成标准或交付内容" /></el-form-item>
      <div class="team-form-row">
        <el-form-item label="优先级">
          <el-select v-model="selfTaskForm.priority"><el-option label="紧急" value="URGENT" /><el-option label="高" value="HIGH" /><el-option label="普通" value="MEDIUM" /><el-option label="低" value="LOW" /></el-select>
        </el-form-item>
        <el-form-item label="截止时间">
          <el-date-picker v-model="selfTaskForm.dueAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" placeholder="不选则默认为今天" />
          <div class="date-shortcuts"><el-button size="small" @click="quickDue(selfTaskForm, 'TODAY')">今日</el-button><el-button size="small" @click="quickDue(selfTaskForm, 'WEEK')">本周内</el-button></div>
        </el-form-item>
      </div>
      <el-alert v-if="!editingSelfTaskId" title="提交后会同步进入总管理后台 AI任务中心，由Codex处理；审核后的成果会回到本任务详情。" type="info" :closable="false" show-icon />
    </el-form>
    <template #footer><el-button @click="selfTaskVisible = false">取消</el-button><el-button type="primary" :loading="creatingSelfTask" @click="createSelfTask">{{ editingSelfTaskId ? "保存修改" : copyingSelfTask ? "确认再次添加" : "添加到我的任务" }}</el-button></template>
  </el-dialog>

  <el-dialog v-model="teamTaskVisible" :title="editingTeamTaskId ? '修改协作任务' : copyingTeamTask ? '复制并再次安排' : '安排协作任务'" width="min(660px, 92vw)">
    <el-form label-position="top">
      <el-form-item label="协作成员" required><el-select v-model="teamTaskForm.assigneeEmployeeId"><el-option v-for="employee in operationTeam.directReports" :key="employee.id" :label="`${employee.name} · ${collaborationRoleLabel(employee)}`" :value="employee.id" /></el-select></el-form-item>
      <el-form-item label="任务标题" required><el-input v-model="teamTaskForm.title" /></el-form-item>
      <el-form-item label="工作要求"><TaskRichTextEditor v-model="teamTaskForm.descriptionDocument" placeholder="填写需要完成的具体工作" /></el-form-item>
      <el-form-item label="期望交付结果"><TaskRichTextEditor v-model="teamTaskForm.expectedResultDocument" placeholder="填写完成标准或交付内容" /></el-form-item>
      <div class="team-form-row">
        <el-form-item label="优先级"><el-select v-model="teamTaskForm.priority"><el-option label="紧急" value="URGENT" /><el-option label="高" value="HIGH" /><el-option label="普通" value="MEDIUM" /><el-option label="低" value="LOW" /></el-select></el-form-item>
        <el-form-item label="截止时间">
          <el-date-picker v-model="teamTaskForm.dueAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" placeholder="不选则默认为今天" />
          <div class="date-shortcuts"><el-button size="small" @click="quickDue(teamTaskForm, 'TODAY')">今日</el-button><el-button size="small" @click="quickDue(teamTaskForm, 'WEEK')">本周内</el-button></div>
        </el-form-item>
      </div>
      <el-form-item v-if="!editingTeamTaskId" label="每周固定安排（可选）">
        <el-checkbox-group v-model="teamTaskForm.recurrenceWeekdays">
          <el-checkbox-button v-for="item in [{v:1,l:'周一'},{v:2,l:'周二'},{v:3,l:'周三'},{v:4,l:'周四'},{v:5,l:'周五'},{v:6,l:'周六'},{v:7,l:'周日'}]" :key="item.v" :value="item.v">{{ item.l }}</el-checkbox-button>
        </el-checkbox-group>
        <p class="muted">所选日期会自动生成当天任务，并通知协作成员。</p>
      </el-form-item>
      <el-form-item label="附件链接（每行一个）"><el-input v-model="teamTaskForm.attachments" type="textarea" :rows="2" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="teamTaskVisible = false">取消</el-button><el-button type="primary" :loading="creatingTeamTask" @click="createTeamTask">{{ editingTeamTaskId ? "保存并通知" : copyingTeamTask ? "确认再次安排" : "安排任务" }}</el-button></template>
  </el-dialog>

  <el-dialog v-model="taskRecycleBinVisible" title="任务回收站" width="min(720px, 94vw)">
    <p class="muted">这里只显示你删除的任务。删除后保留3天，超期将自动彻底删除。</p>
    <div v-loading="taskRecycleBinLoading" class="task-recycle-list">
      <article v-for="task in taskRecycleItems" :key="task.id" class="task-recycle-item">
        <div>
          <div class="task-meta">
            <el-tag size="small" type="info">{{ task.sourceType === "OPERATOR_COLLAB" ? "协作任务" : "我的任务" }}</el-tag>
            <span>删除于 {{ formatTime(task.deletedAt) }}</span>
            <span class="recycle-countdown">{{ recycleRemaining(task) }}</span>
          </div>
          <h4>{{ task.title }}</h4>
          <p class="task-summary">{{ task.description || task.expectedResult || "未填写任务说明" }}</p>
        </div>
        <el-button type="primary" plain :loading="restoringTaskId === task.id" @click="restoreRecycledTask(task)">恢复</el-button>
      </article>
      <el-empty v-if="!taskRecycleBinLoading && !taskRecycleItems.length" description="回收站暂无任务" />
    </div>
  </el-dialog>

  <el-dialog v-model="reviewVisible" title="审核运营任务成果" width="min(560px, 92vw)">
    <el-form label-position="top">
      <el-form-item label="审核结果"><el-radio-group v-model="reviewForm.action"><el-radio-button value="APPROVE">审核通过</el-radio-button><el-radio-button value="RETURN">退回修改</el-radio-button></el-radio-group></el-form-item>
      <el-form-item label="审核说明"><el-input v-model="reviewForm.note" type="textarea" :rows="4" :placeholder="reviewForm.action === 'RETURN' ? '请填写具体修改要求' : '可填写确认说明'" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="reviewVisible = false">取消</el-button><el-button type="primary" @click="reviewTeamTask">确认</el-button></template>
  </el-dialog>

  <el-dialog v-model="submitVisible" :title="isAiContentTask(activeTask) ? '反馈修改' : '提交任务成果'" width="min(560px, 92vw)">
    <el-form label-position="top">
      <el-form-item :label="isAiContentTask(activeTask) ? '修改要求' : '成果说明'" required><el-input v-model="submitForm.summary" type="textarea" :rows="4" :placeholder="isAiContentTask(activeTask) ? '说明需要修改的参数、文案、画面或输出版本' : '说明完成了什么、产出位置和需要审核的重点'" /></el-form-item>
      <el-form-item v-if="!isAiContentTask(activeTask)" label="关联素材编号"><el-input v-model="submitForm.assetId" placeholder="例如 SD-VIDEO-..." /></el-form-item>
      <template v-if="!isAiContentTask(activeTask) && activeTask?.category?.startsWith('LIVE')">
        <el-form-item label="直播关键数据"><el-input v-model="submitForm.metrics" type="textarea" :rows="3" placeholder="在线、停留、点击、成交等" /></el-form-item>
        <el-form-item label="下一场优化动作"><el-input v-model="submitForm.improvements" type="textarea" :rows="3" /></el-form-item>
      </template>
    </el-form>
    <template #footer><el-button @click="submitVisible = false">取消</el-button><el-button type="primary" @click="submitTask">{{ isAiContentTask(activeTask) ? "提交修改反馈" : "提交审核" }}</el-button></template>
  </el-dialog>

  <el-dialog v-model="uploadVisible" title="上传素材" width="min(760px, 94vw)" destroy-on-close @closed="lockedShotUpload = undefined">
    <el-upload
      v-model:file-list="uploadFiles"
      drag
      multiple
      :auto-upload="false"
      :limit="20"
      :disabled="uploading"
      class="employee-asset-upload"
      @change="inspectUploadFiles"
      @remove="inspectUploadFiles"
    >
      <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
      <div class="el-upload__text">拖入文件，或<em>点击选择</em></div>
      <template #tip><div class="el-upload__tip">最多20个，单文件不超过200MB；上传员工由企业微信身份自动记录。</div></template>
    </el-upload>

    <div class="upload-ai-assist">
      <div><strong>AI辅助填写</strong><span>{{ uploadAssistMessage || "选择文件后，可自动判断类型、型号和内容说明" }}</span></div>
      <el-button :loading="uploadAssistState === 'RUNNING'" @click="assistUpload">AI帮我填写</el-button>
    </div>

    <el-alert
      v-if="lockedShotUpload"
      class="locked-shot-upload"
      :title="`补拍素材将自动关联：${lockedShotUpload.project.productionNo || lockedShotUpload.project.topic}`"
      :description="lockedShotUpload.shot.description || lockedShotUpload.shot.title"
      type="info"
      :closable="false"
    />
    <el-form label-position="top" class="upload-form-grid">
      <el-form-item v-if="!lockedShotUpload" label="关联视频生产单">
        <el-select v-model="uploadForm.contentPlanId" clearable filterable placeholder="补拍素材请选择对应生产单" @change="selectProductionPlan">
          <el-option v-for="item in dataCenter.uploadOptions.productionPlans" :key="item.id" :label="`${item.productionNo || '历史内容'} · ${item.topic}`" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="!lockedShotUpload" label="对应补拍项">
        <el-select v-model="uploadForm.shootRequirementId" clearable :disabled="!uploadForm.contentPlanId" placeholder="选择这批素材完成的拍摄要求">
          <el-option v-for="item in (selectedProductionPlan?.shootRequirements || []).filter((row: Row) => row.status !== 'DONE')" :key="item.id" :label="item.description" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="产品型号（可不选）">
        <el-select v-model="uploadForm.productIds" multiple filterable placeholder="AI识别后请确认">
          <el-option v-for="item in dataCenter.uploadOptions.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="素材来源">
        <el-select v-model="uploadForm.sourceType">
          <el-option label="员工拍摄/制作" value="EMPLOYEE_CAPTURE" />
          <el-option label="网页上传" value="WEB_UPLOAD" />
          <el-option label="供应商" value="SUPPLIER" />
          <el-option label="UGC授权" value="UGC" />
          <el-option label="外部参考" value="EXTERNAL_REFERENCE" />
        </el-select>
      </el-form-item>
      <el-form-item label="资源用途">
        <el-select v-model="uploadForm.purpose">
          <el-option label="剪辑镜头素材" value="EDITING_FOOTAGE" />
          <el-option label="视频包装资源" value="PACKAGING_RESOURCE" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="uploadForm.purpose === 'PACKAGING_RESOURCE'" label="包装资源分类">
        <el-select v-model="uploadForm.packagingCategory" placeholder="请选择包装资源分类">
          <el-option label="背景音乐 BGM" value="BGM" />
          <el-option label="音效" value="SOUND_EFFECT" />
          <el-option label="贴纸素材" value="STICKER" />
          <el-option label="视频特效" value="VIDEO_EFFECT" />
          <el-option label="文字特效" value="TEXT_EFFECT" />
          <el-option label="字体" value="FONT" />
          <el-option label="品牌元素" value="BRAND_ELEMENT" />
          <el-option label="授权资料" value="LICENSE_DOCUMENT" />
          <el-option label="其他包装资源" value="OTHER" />
        </el-select>
      </el-form-item>
      <el-alert
        v-if="uploadForm.purpose === 'PACKAGING_RESOURCE'"
        class="full"
        type="info"
        :closable="false"
        title="包装资源只供字幕、贴纸、特效、音效和 BGM 调用，不参与脚本镜头匹配或补拍分析。"
      />
      <el-form-item label="内容说明" class="full">
        <el-input v-model="uploadForm.contentDescription" type="textarea" :rows="2" placeholder="可留空，由AI辅助填写" />
      </el-form-item>
      <el-form-item label="人工基础分类（确认后锁定）" class="full">
        <el-select v-model="uploadForm.classificationTags" multiple clearable filterable placeholder="详细剪辑索引由AI查看画面后生成">
          <el-option v-for="item in classificationOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-form-item>
      <div class="full upload-index-note">
        <div><strong>剪辑AI详细索引</strong><el-tag size="small" type="info">上传后自动生成</el-tag></div>
        <p>AI会查看实际画面，识别型号、用途、功能、场景、动作、人群、平台、口播和痛点；并按内容自动命名，例如：<b>{{ selectedUploadModels[0] || "W9S" }}－功能展示－心电图测量</b>。</p>
      </div>
      <el-form-item label="素材名称" class="full">
        <div class="upload-rename-option">
          <el-switch v-model="uploadForm.aiRename" active-text="用AI标签重新命名" inactive-text="保留原文件名" />
          <small>{{ uploadForm.aiRename ? "AI分析完成后，用“型号－用途－核心功能/场景”作为素材名称" : "仍会生成AI标签和索引，但素材名称保持上传时的文件名" }}</small>
        </div>
      </el-form-item>
      <el-collapse class="full upload-advanced">
        <el-collapse-item title="更多信息（一般无需修改）" name="advanced">
          <div class="upload-advanced-grid">
            <el-select v-model="uploadForm.assetKind" clearable placeholder="素材类型自动识别">
              <el-option label="图片" value="IMAGE" />
              <el-option label="视频" value="VIDEO" />
              <el-option label="音频" value="AUDIO" />
              <el-option label="文档" value="DOCUMENT" />
            </el-select>
            <el-select v-model="uploadForm.rightsStatus">
              <el-option label="可直接商用" value="COMMERCIAL" />
              <el-option label="修改后可用" value="EDIT_ONLY" />
              <el-option label="内部参考" value="INTERNAL" />
              <el-option label="待确认授权" value="AUTH_REQUIRED" />
            </el-select>
            <el-date-picker v-model="uploadForm.acquiredAt" type="date" value-format="YYYY-MM-DD" placeholder="获得/拍摄日期" />
            <el-switch v-model="uploadForm.originalStatus" active-text="公司原创" inactive-text="非原创" />
          </div>
          <div v-if="uploadTechnicalInfo.length" class="upload-technical-info">
            <strong>文件与AI预检信息</strong>
            <el-table :data="uploadTechnicalInfo" size="small" max-height="210">
              <el-table-column prop="name" label="文件" min-width="180" show-overflow-tooltip />
              <el-table-column prop="format" label="格式" width="72" />
              <el-table-column label="大小" width="90"><template #default="scope">{{ fileSize(scope.row.size) }}</template></el-table-column>
              <el-table-column label="时长" width="90"><template #default="scope">{{ durationLabel(scope.row.durationSeconds) }}</template></el-table-column>
              <el-table-column label="分辨率" width="105"><template #default="scope">{{ scope.row.width && scope.row.height ? `${scope.row.width}×${scope.row.height}` : "—" }}</template></el-table-column>
              <el-table-column prop="quality" label="质量" width="90" />
            </el-table>
          </div>
        </el-collapse-item>
      </el-collapse>
    </el-form>
    <div v-if="uploading || uploadProgress" class="employee-upload-progress">
      <div><span>{{ uploadStage }}</span><small>{{ uploadProgress < 100 ? `预计剩余 ${uploadEta}` : "文件已上传，正在云端入库" }}</small></div>
      <el-progress :percentage="uploadProgress" />
    </div>
    <template #footer>
      <el-button :disabled="uploading" @click="closeUploadDialog">取消</el-button>
      <el-button type="primary" :loading="uploading" @click="submitAsset">{{ uploading ? `${uploadProgress}%` : "确认上传" }}</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="assetGapVisible" title="AI 缺失素材分析" width="min(720px, 94vw)" destroy-on-close>
    <p class="dialog-hint">选择产品型号，AI 将读取该型号现有素材索引，只列出真正缺少的画面。</p>
    <div class="gap-analysis-form">
      <el-select v-model="assetGapProductModel" clearable filterable placeholder="搜索或选择产品型号">
        <el-option v-for="product in productOptions" :key="product.id" :label="`${product.modelCode} · ${product.name}`" :value="product.modelCode" />
      </el-select>
      <el-button type="primary" :loading="analyzingAssetGaps" @click="analyzeWorkbenchAssetGaps">开始分析</el-button>
    </div>
    <el-checkbox-group v-if="assetGaps.length" v-model="selectedAssetGapIds" class="gap-result-list">
      <el-checkbox v-for="gap in assetGaps" :key="gap.id" :value="gap.id">
        <strong>{{ gap.category }}</strong><span>{{ gap.assetKind }} · {{ gap.severity }} · {{ gap.recommendation }}</span>
      </el-checkbox>
    </el-checkbox-group>
    <el-empty v-else-if="!analyzingAssetGaps" description="选择产品型号后开始分析" />
    <template #footer>
      <div class="gap-task-action">
        <span v-if="assetGaps.length">已选择 {{ selectedAssetGapIds.length }} 项</span>
        <el-button @click="assetGapVisible = false">关闭</el-button>
        <el-button v-if="assetGaps.length" type="primary" :disabled="!selectedAssetGapIds.length" :loading="creatingGapTasks" @click="createWorkbenchGapTasks">生成补拍任务</el-button>
      </div>
    </template>
  </el-dialog>

  <el-dialog v-model="packagingPreviewVisible" title="封面和标题预览" width="min(920px, 96vw)" destroy-on-close @closed="closePackagingPreview">
    <div v-if="packagingPreviewVariant" class="packaging-preview-dialog">
      <img v-if="packagingPreviewUrl" :src="packagingPreviewUrl" :alt="packagingPreviewVariant.title || '视频封面'" />
      <div>
        <el-tag>{{ packagingPreviewVariant.platform }}</el-tag>
        <h3>{{ packagingPreviewVariant.title || "待生成标题" }}</h3>
        <p>{{ packagingPreviewVariant.body || "暂无发布文案" }}</p>
        <div v-if="packagingPreviewVariant.coverSpec?.hashtags?.length" class="packaging-hashtags">
          <el-tag v-for="tag in packagingPreviewVariant.coverSpec.hashtags" :key="tag" size="small" type="info">#{{ tag }}</el-tag>
        </div>
        <el-alert
          v-if="packagingPreviewVariant.packagingRejectedReason"
          :title="`上次退回说明：${packagingPreviewVariant.packagingRejectedReason}`"
          type="warning"
          :closable="false"
        />
        <el-alert title="封面、标题和文案分别按平台审核；一个平台退回不会阻塞其他平台。" type="info" :closable="false" />
      </div>
    </div>
    <template #footer>
      <el-button @click="packagingPreviewVisible = false">关闭</el-button>
      <el-button
        v-if="packagingPreviewVariant && packagingPreviewVariant.packagingStatus !== 'APPROVED'"
        type="danger"
        plain
        :loading="reviewingPackagingVariantId === packagingPreviewVariant.id"
        @click="reviewProjectPackaging(false)"
      >退回并填写原因</el-button>
      <el-button
        v-if="packagingPreviewVariant && packagingPreviewVariant.packagingStatus !== 'APPROVED'"
        type="success"
        :loading="reviewingPackagingVariantId === packagingPreviewVariant.id"
        @click="reviewProjectPackaging(true)"
      >包装审核通过</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="newVideoProjectVisible" title="新建智能视频项目" width="min(980px, 96vw)" destroy-on-close>
    <div class="prototype-project-form">
      <el-alert title="填写项目要求并创建后，系统会立即提交所选脚本引擎；两种引擎的候选脚本都返回后再进入对比审核。" type="info" :closable="false" />

      <section class="prototype-form-section">
        <header><strong>必填信息</strong><span>视频类型、产品和关键词为必填项</span></header>
        <div class="prototype-required-grid">
          <el-form-item label="视频类型" required>
            <el-select v-model="videoFactoryForm.videoType" filterable allow-create default-first-option placeholder="选择或手动填写视频类型">
              <el-option v-for="item in videoTypeOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="产品型号" required>
            <el-select v-model="videoFactoryForm.productModel" clearable filterable placeholder="搜索或选择产品型号">
              <el-option v-for="product in productOptions" :key="product.id" :label="`${product.modelCode} · ${product.name}`" :value="product.modelCode" />
            </el-select>
          </el-form-item>
          <el-form-item label="关键词" required>
            <el-select
              v-model="videoFactoryForm.keywordIds"
              multiple
              filterable
              collapse-tags
              collapse-tags-tooltip
              placeholder="搜索并选择爆款研究关键词"
            >
              <el-option
                v-for="keyword in videoProjectKeywordOptions"
                :key="keyword.smartKeywordId || keyword.smartKeyword?.id || keyword.id"
                :label="`${keyword.keyword} · ${keyword.sourceLabel}`"
                :value="keyword.smartKeywordId || keyword.smartKeyword?.id || keyword.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="补充关键词">
            <el-input v-model="videoFactoryForm.keywords" placeholder="没有合适选项时可手动补充，多个词用逗号分隔" />
          </el-form-item>
        </div>
      </section>

      <el-collapse v-model="videoProjectCollapseNames" class="prototype-collapses">
        <el-collapse-item name="optional">
          <template #title>
            <span class="prototype-collapse-title">
              <strong>可选创作信息</strong>
              <small>模仿参考、钩子、场景、目标用户、痛点、AI提示词</small>
            </span>
          </template>
          <div class="prototype-optional-grid">
            <el-form-item label="模仿参考"><el-input v-model="videoFactoryForm.reference" placeholder="爆款研究、参考视频链接或已审核成片" /></el-form-item>
            <el-form-item label="钩子"><el-input v-model="videoFactoryForm.hook" placeholder="例如：不在父母身边，怎么知道他们今天的状态？" /></el-form-item>
            <el-form-item label="场景"><el-input v-model="videoFactoryForm.scene" placeholder="例如：父母居家、子女远程查看" /></el-form-item>
            <el-form-item label="目标用户"><el-input v-model="videoFactoryForm.audience" placeholder="例如：为父母选健康手表的子女" /></el-form-item>
            <el-form-item class="wide" label="用户痛点"><el-input v-model="videoFactoryForm.painPoint" type="textarea" :rows="3" /></el-form-item>
            <el-form-item class="wide" label="补充 AI 提示词"><el-input v-model="videoFactoryForm.additionalPrompt" type="textarea" :rows="3" placeholder="填写本次生成的临时要求" /></el-form-item>
          </div>
        </el-collapse-item>
        <el-collapse-item name="defaults">
          <template #title>
            <span class="prototype-collapse-title">
              <strong>默认设置</strong>
              <small>{{ videoProjectDefaultSummary }}</small>
            </span>
          </template>
          <div class="prototype-default-grid">
            <el-form-item label="发布平台"><el-select v-model="videoFactoryForm.platform"><el-option label="抖音" value="DOUYIN" /><el-option label="小红书" value="XIAOHONGSHU" /><el-option label="B站" value="BILIBILI" /><el-option label="视频号" value="WECHAT_CHANNELS" /><el-option label="快手" value="KUAISHOU" /><el-option label="TikTok" value="TIKTOK" /></el-select></el-form-item>
            <el-form-item label="视频时长"><el-select v-model="videoFactoryForm.estimatedDurationSeconds"><el-option label="15秒" :value="15" /><el-option label="30秒" :value="30" /><el-option label="60秒" :value="60" /></el-select></el-form-item>
            <el-form-item label="账号类型"><el-select v-model="videoFactoryForm.accountType"><el-option label="品牌账号" value="BRAND" /><el-option label="达人账号" value="CREATOR" /><el-option label="员工账号" value="EMPLOYEE" /></el-select></el-form-item>
            <el-form-item label="健康相关内容"><el-select v-model="videoFactoryForm.healthContentAllowed"><el-option label="允许健康相关内容" :value="true" /><el-option label="不允许健康相关内容" :value="false" /></el-select></el-form-item>
            <el-form-item label="素材使用"><el-select v-model="videoScriptMode"><el-option label="优先使用素材库已有素材" value="ASSET_FIRST" /><el-option label="仅使用已有素材（缺少则改写）" value="ASSET_ONLY" /></el-select></el-form-item>
            <el-form-item label="口播"><el-select v-model="videoFactoryForm.voiceoverMode"><el-option label="有口播视频" value="VOICEOVER" /><el-option label="无口播视频" value="NO_VOICEOVER" /></el-select></el-form-item>
          </div>
        </el-collapse-item>
      </el-collapse>

      <section class="prototype-form-section">
        <header><strong>脚本生成方式</strong><span>可选择一种，也可以同时生成两种用于比较</span></header>
        <el-checkbox-group v-model="videoFactoryForm.scriptEngines" class="script-engine-grid">
          <el-checkbox value="REMOTE_CODEX" border>
            <strong>远程 Codex + 剪辑 Skill</strong>
            <small>深度读取素材索引、包装资源和风险规则，返回逐句素材绑定。</small>
          </el-checkbox>
          <el-checkbox value="SYSTEM_AI" border>
            <strong>系统 AI 脚本工厂</strong>
            <small>直接调用系统模型快速生成另一版完整脚本，用于对比选择。</small>
          </el-checkbox>
        </el-checkbox-group>
      </section>
    </div>
    <template #footer>
      <el-button @click="newVideoProjectVisible = false">取消</el-button>
      <el-button @click="checkNewVideoProjectBrief">AI检查任务信息</el-button>
      <el-button type="primary" :loading="creatingVideoProject" @click="createVideoFactoryProject">创建项目</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="scriptEditorVisible" title="直接修改完整脚本" width="min(980px, 96vw)" destroy-on-close>
    <div class="script-editor-dialog">
      <el-alert title="修改后会保留原有逐句素材绑定和镜头编号，脚本仍停留在审核阶段；审核通过后才进入素材补全。" type="info" :closable="false" />
      <div class="script-editor-grid">
        <el-form-item label="脚本标题"><el-input v-model="scriptEditorForm.title" /></el-form-item>
        <el-form-item label="黄金三秒钩子" required><el-input v-model="scriptEditorForm.hook" /></el-form-item>
        <el-form-item label="核心主题"><el-input v-model="scriptEditorForm.coreTheme" /></el-form-item>
        <el-form-item label="传播目标"><el-input v-model="scriptEditorForm.communicationGoal" /></el-form-item>
        <el-form-item label="用户痛点"><el-input v-model="scriptEditorForm.userPainPoint" /></el-form-item>
        <el-form-item label="唯一核心卖点"><el-input v-model="scriptEditorForm.uniqueSellingPoint" /></el-form-item>
      </div>
      <el-form-item label="完整脚本" required>
        <el-input v-model="scriptEditorForm.script" type="textarea" :rows="8" />
      </el-form-item>
      <div class="script-editor-grid">
        <el-form-item label="逐句口播（每行一句）"><el-input v-model="scriptEditorForm.voiceoverText" type="textarea" :rows="7" /></el-form-item>
        <el-form-item label="字幕稿（每行一组）"><el-input v-model="scriptEditorForm.subtitlesText" type="textarea" :rows="7" /></el-form-item>
        <el-form-item label="留人设计（每行一个节点）"><el-input v-model="scriptEditorForm.retentionText" type="textarea" :rows="5" /></el-form-item>
        <el-form-item label="重点文字（每行一个词组）"><el-input v-model="scriptEditorForm.emphasisText" type="textarea" :rows="5" /></el-form-item>
        <el-form-item label="结尾总结"><el-input v-model="scriptEditorForm.endingSummary" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="互动提问"><el-input v-model="scriptEditorForm.endingInteraction" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="结尾画面与安全尾帧"><el-input v-model="scriptEditorForm.endingVisual" type="textarea" :rows="3" /></el-form-item>
      </div>
    </div>
    <template #footer>
      <el-button @click="scriptEditorVisible = false">取消</el-button>
      <el-button type="primary" :loading="savingScript" @click="saveEditedScript">保存脚本修改</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="scriptPackageVisible" title="完整视频脚本包" width="min(980px, 96vw)" class="script-package-dialog">
    <div v-if="scriptPackageCandidate?.scriptPackage" class="script-package">
      <section>
        <h3>基础任务信息</h3>
        <dl class="script-package-grid">
          <div><dt>产品型号</dt><dd>{{ scriptPackageCandidate.scriptPackage.basicInfo.productModel }}</dd></div>
          <div><dt>视频类型</dt><dd>{{ scriptPackageCandidate.scriptPackage.basicInfo.videoType }}</dd></div>
          <div><dt>发布平台</dt><dd>{{ platformLabel(scriptPackageCandidate.scriptPackage.basicInfo.platform) }}</dd></div>
          <div><dt>账号类型</dt><dd>{{ scriptPackageCandidate.scriptPackage.basicInfo.accountType }}</dd></div>
          <div><dt>目标受众</dt><dd>{{ scriptPackageCandidate.scriptPackage.basicInfo.targetAudience }}</dd></div>
          <div><dt>预计时长</dt><dd>{{ scriptPackageCandidate.scriptPackage.basicInfo.estimatedDurationSeconds }}秒</dd></div>
          <div><dt>健康内容</dt><dd>{{ scriptPackageCandidate.scriptPackage.basicInfo.healthContentAllowed ? "允许" : "禁止" }}</dd></div>
        </dl>
      </section>
      <section>
        <h3>内容定位</h3>
        <p><b>核心主题：</b>{{ scriptPackageCandidate.scriptPackage.positioning.coreTheme }}</p>
        <p><b>传播目标：</b>{{ scriptPackageCandidate.scriptPackage.positioning.communicationGoal }}</p>
        <p><b>用户痛点：</b>{{ scriptPackageCandidate.scriptPackage.positioning.userPainPoint }}</p>
        <p><b>唯一核心卖点：</b>{{ scriptPackageCandidate.scriptPackage.positioning.uniqueSellingPoint }}</p>
      </section>
      <section>
        <h3>黄金三秒钩子</h3>
        <p><b>钩子文案：</b>{{ scriptPackageCandidate.scriptPackage.goldenHook.copy }}</p>
        <p><b>类型与画面：</b>{{ scriptPackageCandidate.scriptPackage.goldenHook.type }} · {{ scriptPackageCandidate.scriptPackage.goldenHook.visual }}</p>
        <p><b>留人理由：</b>{{ scriptPackageCandidate.scriptPackage.goldenHook.retentionReason }}</p>
        <p><b>开头声音：</b>{{ scriptPackageCandidate.scriptPackage.goldenHook.openingSound }}</p>
      </section>
      <section>
        <h3>逐句口播与镜头需求</h3>
        <article v-for="(shot, index) in scriptPackageCandidate.scriptPackage.shotRequirements" :key="index" class="script-line-card">
          <div><b>{{ index + 1 }}. {{ shot.line }}</b><el-tag size="small">{{ assetCoverageLabel(shot.assetStatus) }}</el-tag></div>
          <p><b>对应画面：</b>{{ shot.visual }}</p>
          <p><b>画面事实：</b>{{ shot.factualProof }}</p>
          <p><b>音画匹配：</b>{{ shot.audioVisualRequirement }}</p>
          <p v-if="scriptPackageCandidate.scriptPackage.voiceoverLines[index]"><b>声音：</b>{{ scriptPackageCandidate.scriptPackage.voiceoverLines[index].tone }} · {{ scriptPackageCandidate.scriptPackage.voiceoverLines[index].speed }} · {{ scriptPackageCandidate.scriptPackage.voiceoverLines[index].emotion }} · 约{{ scriptPackageCandidate.scriptPackage.voiceoverLines[index].durationSeconds }}秒</p>
        </article>
      </section>
      <section>
        <h3>脚本结构与留人设计</h3>
        <p v-for="(item, index) in scriptPackageCandidate.scriptPackage.structure" :key="index"><b>{{ item.stage }}：</b>{{ item.content }}（{{ item.purpose }}）</p>
        <p><b>留人节点：</b>{{ scriptPackageCandidate.scriptPackage.retentionDesign.join("；") }}</p>
      </section>
      <section>
        <h3>字幕、重点文字与声音设计</h3>
        <p><b>字幕稿：</b>{{ scriptPackageCandidate.scriptPackage.subtitles.join(" / ") }}</p>
        <p><b>重点文字：</b>{{ scriptPackageCandidate.scriptPackage.emphasisTexts.join("、") }}</p>
        <p><b>配音与音效：</b>{{ scriptPackageCandidate.scriptPackage.soundDesign.voiceProfile }}；{{ scriptPackageCandidate.scriptPackage.soundDesign.tone }}；{{ scriptPackageCandidate.scriptPackage.soundDesign.speed }}；开头 {{ scriptPackageCandidate.scriptPackage.soundDesign.openingSfx }}；重点 {{ scriptPackageCandidate.scriptPackage.soundDesign.keySfx.join("、") }}；环境声 {{ scriptPackageCandidate.scriptPackage.soundDesign.ambientSound }}</p>
      </section>
      <section>
        <h3>合规检查</h3>
        <p v-for="(item, index) in scriptPackageCandidate.scriptPackage.complianceChecks" :key="index"><el-tag size="small" :type="item.status === 'BLOCK' ? 'danger' : item.status === 'REVIEW' ? 'warning' : 'success'">{{ item.status }}</el-tag> <b>{{ item.category }}：</b>{{ item.note }}</p>
      </section>
      <section>
        <h3>结尾设计与素材缺口</h3>
        <p><b>总结：</b>{{ scriptPackageCandidate.scriptPackage.ending.summary }}</p>
        <p><b>互动：</b>{{ scriptPackageCandidate.scriptPackage.ending.interaction }}</p>
        <p><b>尾帧：</b>{{ scriptPackageCandidate.scriptPackage.ending.visual }}，保留{{ scriptPackageCandidate.scriptPackage.ending.safeTailSeconds }}秒</p>
        <article v-for="(gap, index) in scriptPackageCandidate.scriptPackage.materialGaps" :key="index" class="script-gap-card">
          <b>{{ gap.product }} · {{ gap.action }} · {{ gap.shotSize }}</b>
          <p>{{ gap.processOrResult }}</p><p><b>补拍方法：</b>{{ gap.shootingMethod }}</p>
        </article>
        <el-empty v-if="!scriptPackageCandidate.scriptPackage.materialGaps.length" :image-size="48" description="暂无素材缺口" />
      </section>
    </div>
    <template #footer>
      <el-button @click="copyCompleteVideoScript">一键复制完整脚本</el-button>
      <el-button type="primary" @click="scriptPackageVisible = false">关闭</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="publishLinkVisible"
    title="回传已发布视频"
    width="min(620px, 94vw)"
    destroy-on-close
  >
    <el-alert title="回传后系统会保存作品链接，并按发布后1/3/6/24/72小时及7/30日安排数据跟踪。" type="info" :closable="false" />
    <div class="publish-link-list">
      <article v-for="(record, index) in publishLinkRecords" :key="index" class="publish-link-row">
        <el-form label-position="top" class="publish-link-form">
          <el-form-item label="实际发布平台" required>
            <el-select v-model="record.platform" placeholder="选择发布平台">
              <el-option
                v-for="option in publishPlatformOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
                :disabled="publishLinkRecords.some((item, itemIndex) => itemIndex !== index && item.platform === option.value)"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="作品链接" required>
            <el-input v-model="record.remoteUrl" placeholder="https://... 完整作品链接" />
          </el-form-item>
          <el-form-item label="发布时间（不填则按现在计算）">
            <el-date-picker
              v-model="record.publishedAt"
              type="datetime"
              value-format="YYYY-MM-DDTHH:mm:ss"
              placeholder="选择实际发布时间"
            />
          </el-form-item>
        </el-form>
        <el-button type="danger" plain @click="removePublishLinkRecord(index)">移除</el-button>
      </article>
      <el-button class="add-publish-link" plain @click="addPublishLinkRecord">+ 添加另一个发布平台</el-button>
    </div>
    <template #footer>
      <el-button @click="publishLinkVisible = false">取消</el-button>
      <el-button type="primary" :loading="savingPublishLink" @click="savePublishLink">保存并开始数据跟踪</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="videoRecycleBinVisible"
    title="视频项目回收站"
    width="min(760px, 94vw)"
    destroy-on-close
  >
    <el-alert title="这里只显示你自己删除的视频项目。删除后保留3天，期限内可以恢复。" type="info" :closable="false" />
    <div v-loading="videoRecycleBinLoading" class="video-recycle-list">
      <article v-for="project in videoRecycleProjects" :key="project.id" class="video-recycle-item">
        <div>
          <div class="task-meta">
            <span>{{ platformLabel(project.targetPlatforms?.[0]) }}</span>
            <span>{{ project.productModel || "品牌通用" }}</span>
            <span>{{ project.productionNo }}</span>
          </div>
          <strong>{{ project.topic }}</strong>
          <small>删除于 {{ formatTime(project.archivedAt) }} · {{ recycleRemainingText(project) }}</small>
        </div>
        <el-button
          type="primary"
          plain
          :loading="restoringVideoProjectId === project.id"
          @click="restoreVideoProject(project)"
        >恢复项目</el-button>
      </article>
      <el-empty v-if="!videoRecycleBinLoading && !videoRecycleProjects.length" description="回收站暂无可恢复的视频项目" />
    </div>
    <template #footer><el-button @click="videoRecycleBinVisible = false">关闭</el-button></template>
  </el-dialog>

  <el-dialog
    v-model="similarVideoVisible"
    title="一键生成类似视频"
    width="min(680px, 94vw)"
    destroy-on-close
  >
    <div class="similar-video-intro">
      <strong>{{ similarVideoProject?.topic || "当前成片" }}</strong>
      <p>保留已审核成片的节奏、时长、镜头结构和平台规格，只替换你勾选的内容。</p>
    </div>
    <el-form label-position="top" class="similar-video-form">
      <div class="similar-video-option">
        <el-checkbox v-model="similarVideoForm.replaceHook">替换钩子</el-checkbox>
        <el-input
          v-model="similarVideoForm.hook"
          :disabled="!similarVideoForm.replaceHook"
          placeholder="例如：爸妈总说不用买，其实最担心的是这个"
        />
      </div>
      <div class="similar-video-option">
        <el-checkbox v-model="similarVideoForm.replaceProduct">替换产品</el-checkbox>
        <el-select
          v-model="similarVideoForm.productModel"
          :disabled="!similarVideoForm.replaceProduct"
          filterable
          placeholder="搜索或选择产品型号"
        >
          <el-option v-for="product in productOptions" :key="product.id" :label="`${product.modelCode} · ${product.name}`" :value="product.modelCode" />
        </el-select>
      </div>
      <div class="similar-video-option">
        <el-checkbox v-model="similarVideoForm.replaceFeature">替换核心功能</el-checkbox>
        <el-input
          v-model="similarVideoForm.feature"
          :disabled="!similarVideoForm.replaceFeature"
          placeholder="例如：一键SOS、独立GPS、睡眠监测"
        />
      </div>
    </el-form>
    <el-alert
      title="更换产品或功能后，系统会重新匹配素材库。不会把旧产品素材直接套入新视频；缺少的画面会明确列为补拍或AI生成。"
      type="info"
      :closable="false"
    />
    <template #footer>
      <el-button @click="similarVideoVisible = false">取消</el-button>
      <el-button type="primary" :loading="creatingSimilarVideo" @click="createSimilarVideo">确认并一键生成</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="videoReviewVisible"
    :title="videoReviewForm.action === 'APPROVE' ? '审核通过成片' : '退回成片修改'"
    width="min(620px, 94vw)"
    destroy-on-close
  >
    <el-alert
      v-if="videoReviewForm.action === 'RETURN'"
      title="退回说明会同步到后台，并写入下一次成片任务的优化要求。"
      type="warning"
      :closable="false"
    />
    <el-form label-position="top" class="video-review-form">
      <el-form-item label="成片">
        <strong>{{ videoReviewJob?.outputAsset?.displayName || videoReviewJob?.outputAsset?.fileName || "当前成片" }}</strong>
      </el-form-item>
      <el-form-item :label="videoReviewForm.action === 'RETURN' ? '退回说明（必填）' : '审核说明（可选）'">
        <el-input
          v-model="videoReviewForm.note"
          type="textarea"
          :rows="5"
          :placeholder="videoReviewForm.action === 'RETURN' ? '请具体说明需要修改的字幕、配音、画面、节奏、产品展示或 CTA 等问题' : '可填写确认意见'"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="videoReviewVisible = false">取消</el-button>
      <el-button
        :type="videoReviewForm.action === 'APPROVE' ? 'success' : 'danger'"
        :loading="Boolean(reviewingVideoAssetId)"
        @click="reviewWorkbenchVideo"
      >{{ videoReviewForm.action === "APPROVE" ? "确认通过" : "确认退回并同步说明" }}</el-button>
    </template>
  </el-dialog>

  <el-drawer v-model="assetPreviewVisible" :title="assetPreviewTitle" size="min(860px, 96vw)" destroy-on-close>
    <div v-loading="assetPreviewLoading" class="employee-asset-preview">
      <template v-if="assetPreviewUrl">
        <img v-if="assetPreviewType === 'image'" :src="assetPreviewUrl" :alt="assetDetail?.displayName || assetDetail?.fileName" />
        <video v-else-if="assetPreviewType === 'video'" :src="assetPreviewUrl" :poster="assetPreviewPosterUrl" controls preload="metadata" playsinline />
        <audio v-else-if="assetPreviewType === 'audio'" :src="assetPreviewUrl" controls />
        <iframe v-else-if="['office','document'].includes(assetPreviewType)" :src="assetPreviewEmbedUrl" :title="assetDetail?.displayName || '素材预览'" />
        <el-empty v-else description="该格式请在新窗口中打开预览" />
      </template>
      <div v-if="assetDetail" class="employee-asset-detail">
        <div>
          <small>{{ assetDetail.assetNo }}</small>
          <h3>{{ assetDetail.displayName || assetDetail.fileName || assetDetail.assetNo }}</h3>
          <p>{{ assetDetail.contentDescription || "暂无内容说明" }}</p>
        </div>
        <dl>
          <div><dt>类型</dt><dd>{{ assetDetail.kind || "—" }}</dd></div>
          <div><dt>型号</dt><dd>{{ assetDetail.model || assetDetail.products?.map((item: Row) => item.modelCode).join("、") || "通用" }}</dd></div>
          <div><dt>评级</dt><dd>{{ assetDetail.qualityScore || 0 }}分</dd></div>
          <div><dt>大小</dt><dd>{{ fileSize(assetDetail.sizeBytes) }}</dd></div>
          <div><dt>来源</dt><dd>{{ assetDetail.sourceType || "—" }}</dd></div>
          <div><dt>上传人</dt><dd>{{ assetDetail.createdByEmployee?.name || assetDetail.discoveredBy || "—" }}</dd></div>
        </dl>
        <div class="preview-actions">
          <el-button v-if="can('ASSET_CURATE')" @click="assetEditMode = !assetEditMode">{{ assetEditMode ? "取消编辑" : "编辑分类与标签" }}</el-button>
          <el-button @click="openAssetFile">新窗口打开</el-button>
          <el-button type="primary" @click="openAssetFile">下载原文件</el-button>
        </div>
        <el-form v-if="assetEditMode && can('ASSET_CURATE')" label-position="top" class="asset-edit-form">
          <el-form-item label="素材名称" class="full"><el-input v-model="assetEditForm.displayName" /></el-form-item>
          <el-form-item label="产品范围">
            <el-select v-model="assetEditForm.productScope">
              <el-option label="具体型号" value="MODEL" />
              <el-option label="系列通用" value="SERIES" />
              <el-option label="品牌通用" value="BRAND" />
              <el-option label="未确认" value="UNKNOWN" />
            </el-select>
          </el-form-item>
          <el-form-item label="关联产品">
            <el-select v-model="assetEditForm.productIds" multiple filterable clearable placeholder="可选择多个型号">
              <el-option v-for="item in dataCenter.uploadOptions.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="使用场景"><el-input v-model="assetEditForm.scene" placeholder="如家庭、运动、送礼" /></el-form-item>
          <el-form-item label="视频模块 / 内容标签">
            <el-select v-model="assetEditForm.classificationTags" multiple filterable clearable>
              <el-option v-for="item in classificationOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="内容说明" class="full"><el-input v-model="assetEditForm.contentDescription" type="textarea" :rows="3" /></el-form-item>
          <div class="full asset-edit-actions"><el-button type="primary" :loading="assetEditSaving" @click="saveAssetMetadata">保存分类与标签</el-button></div>
        </el-form>
      </div>
    </div>
  </el-drawer>

  <el-dialog v-model="knowledgeDetailVisible" :title="knowledgeDetail?.title || '品牌知识详情'" width="min(760px, 94vw)">
    <div v-if="knowledgeDetail" class="knowledge-detail">
      <div class="knowledge-detail-meta">
        <el-tag>{{ knowledgeDetail.type || "知识" }}</el-tag>
        <span>{{ knowledgeDetail.category || "未分类" }}</span>
        <span>{{ knowledgeDetail.model || "品牌通用" }}</span>
      </div>
      <section v-if="knowledgeDetail.summary">
        <h4>摘要</h4>
        <p>{{ knowledgeDetail.summary }}</p>
      </section>
      <section v-if="knowledgeDetail.reply">
        <h4>标准回复</h4>
        <p>{{ knowledgeDetail.reply }}</p>
      </section>
      <section v-if="knowledgeDetail.body">
        <h4>完整正文</h4>
        <p>{{ knowledgeDetail.body }}</p>
      </section>
      <section v-if="knowledgeDetail.source || knowledgeDetail.sourceRefs">
        <h4>资料来源</h4>
        <p>{{ knowledgeDetail.source || "未标注" }}</p>
        <a v-if="isKnowledgeLink(knowledgeDetail.sourceRefs)" :href="knowledgeDetail.sourceRefs" target="_blank" rel="noopener noreferrer">打开原始资料</a>
        <p v-else-if="knowledgeDetail.sourceRefs">{{ knowledgeDetail.sourceRefs }}</p>
      </section>
      <el-empty v-if="!knowledgeDetail.summary && !knowledgeDetail.reply && !knowledgeDetail.body && !knowledgeDetail.sourceRefs" description="该条目暂未录入详细内容" />
    </div>
    <template #footer><el-button type="primary" @click="knowledgeDetailVisible = false">关闭</el-button></template>
  </el-dialog>

  <el-dialog v-model="knowledgeVisible" title="补充知识或FAQ" width="min(600px, 92vw)">
    <el-form label-position="top">
      <el-form-item label="标题" required><el-input v-model="knowledgeForm.title" /></el-form-item>
      <el-form-item label="类型"><el-select v-model="knowledgeForm.type"><el-option label="FAQ问答" value="FAQ" /><el-option label="产品知识" value="PRODUCT" /><el-option label="直播知识" value="SOP" /><el-option label="行业知识" value="INDUSTRY" /></el-select></el-form-item>
      <el-form-item label="分类" required><el-input v-model="knowledgeForm.category" /></el-form-item>
      <el-form-item label="关联型号"><el-select v-model="knowledgeForm.model" clearable filterable placeholder="搜索或选择产品型号"><el-option v-for="product in productOptions" :key="product.id" :label="`${product.modelCode} · ${product.name}`" :value="product.modelCode" /></el-select></el-form-item>
      <el-form-item label="标准回复"><el-input v-model="knowledgeForm.reply" type="textarea" :rows="4" /></el-form-item>
      <el-form-item label="完整正文"><el-input v-model="knowledgeForm.body" type="textarea" :rows="5" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="knowledgeVisible = false">取消</el-button><el-button type="primary" @click="submitKnowledge">提交审核</el-button></template>
  </el-dialog>
</template>
