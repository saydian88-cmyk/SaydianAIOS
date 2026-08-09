<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { UploadUserFile } from "element-plus";
import JSZip from "jszip";
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
import { batchImagePreviewPages, batchImageReviewGroup } from "./batch-image-review";
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
const videoLibrary = ref<Row[]>([]);
const videoLibraryLoading = ref(false);
const videoLibraryFilters = reactive({ search: "", productModel: "", sort: "LATEST" });
const videoLibraryCategories = ref<string[]>([]);
const videoLibraryProductModels = ref<string[]>([]);
const videoLibraryCoverUrls = reactive<Record<string, string>>({});
const videoLibraryPage = ref(1);
const videoLibraryTotal = ref(0);
const videoLibraryJumpPage = ref(1);
const videoLibraryDetailVisible = ref(false);
const videoLibraryDetail = ref<Row>();
const videoLibraryPreviewUrl = ref("");
const videoLibraryDetailCoverUrl = ref("");
const videoLibraryHistoryExpanded = ref(false);
const videoLibraryCreateVisible = ref(false);
const videoLibraryCreating = ref(false);
const videoLibraryCreateForm = reactive({
  mode: "REFERENCE_DIRECT",
  productModel: "",
  replaceProduct: false,
  replaceHook: false,
  hook: "",
  replaceFeature: false,
  feature: "",
  replaceOther: false,
  otherChange: "",
  targetLanguage: "ZH",
  customLanguage: "",
  taskRequirement: "",
});
const videoLibraryOriginalRequirement = ref("");
const tasks = ref<Row[]>([]);
const taskScope = ref("MINE");
const taskStatus = ref("");
const taskType = ref("");
const taskPage = ref(1);
const taskPageSize = 5;
const taskTotal = ref(0);
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
const recycleCategory = ref("TASK");
const recyclePageSize = 5;
const recyclePages = reactive({ TASK: 1, VIDEO: 1, IMAGE: 1, ARTICLE: 1 });
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
const markingUrgentAiTaskId = ref("");
const dataCenter = reactive<Row>({
  permissions: [],
  summary: {},
  assets: [],
  materialIndex: {},
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
  platform: "AUTO",
  voiceoverMode: "AUTO",
  accountType: "AUTO",
  estimatedDurationSeconds: 0,
  healthContentAllowed: null as boolean | null,
  productModel: "",
  topic: "",
  audience: "",
  objective: "",
  soundPrompt: "",
  mustShowFacts: "",
  additionalPrompt: "",
  videoType: "",
  keywords: "",
  reference: "",
  hook: "",
  scene: "",
  painPoint: "",
  referenceVideoUrl: "",
  referenceDirectTaskRequirement: "",
  referenceAudioStrategy: "REFERENCE_ORIGINAL",
  scriptEngines: ["SYSTEM_AI"] as string[],
  keywordIds: [] as string[],
  externalVideoIds: [] as string[],
  batchProducts: [{ model: "", count: 2 }] as Array<{ model: string; count: number }>,
  batchVoiceoverSplit: "HALF" as "HALF" | "ALL" | "NONE",
  batchBgmVariety: true,
  batchVoiceVariety: true,
  batchGenerateCoverTitle: true,
  batchTaskRequirement: "",
});
const videoProjectMode = ref<"STANDARD" | "REFERENCE_DIRECT_FULL_VIDEO" | "CODEX_DIRECT_FULL_VIDEO" | "BATCH_CODEX_DIRECT_FULL_VIDEO">("STANDARD");
const referenceDirectRequirementEdited = ref(false);
const lastAutoReferenceDirectRequirement = ref("");
const batchRequirementEdited = ref(false);
const lastAutoBatchRequirement = ref("");
const videoOptionalOpen = ref(false);
const videoDefaultsOpen = ref(false);
const videoProjectCollapseNames = ref<string[]>([]);
const videoTypeOptions = ["痛点解决型", "场景种草型", "功能演示型", "用户开箱型", "FAQ异议型", "优惠成交型"];
const videoProjectDefaultSummary = computed(() => {
  const platform = videoFactoryForm.platform === "AUTO" ? "平台不限" : platformLabel(videoFactoryForm.platform);
  const duration = videoFactoryForm.estimatedDurationSeconds ? `${videoFactoryForm.estimatedDurationSeconds}秒` : "时长不限";
  const account = ({ AUTO: "账号不限", BRAND: "品牌账号", CREATOR: "达人账号", EMPLOYEE: "员工账号" } as Record<string, string>)[videoFactoryForm.accountType] || "账号不限";
  const health = videoFactoryForm.healthContentAllowed === null ? "健康内容不限" : videoFactoryForm.healthContentAllowed ? "允许健康内容" : "不允许健康内容";
  const material = videoScriptMode.value === "ASSET_ONLY" ? "仅用已有素材" : videoScriptMode.value === "ASSET_FIRST" ? "优先已有素材" : "素材策略不限";
  const voiceover = videoFactoryForm.voiceoverMode === "NO_VOICEOVER" ? "无口播" : videoFactoryForm.voiceoverMode === "VOICEOVER" ? "有口播" : "口播不限";
  return `${platform} · ${duration} · ${account} · ${health} · ${material} · ${voiceover}`;
});
const scriptPackageVisible = ref(false);
const scriptPackageCandidate = ref<Row>();
const savingInlineScriptKey = ref("");
const regeneratingSystemScriptProjectId = ref("");
const transferringFailedScriptProjectId = ref("");
const systemScriptConversationVisible = ref(false);
const systemScriptConversationProject = ref<Row>();
const newVideoProjectVisible = ref(false);
const videoProjectOptionsLoading = ref(false);
const creatingVideoProject = ref(false);
const createdVideoProjectDialogId = ref("");
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
const batchCoverPreviewVisible = ref(false);
const batchCoverPreviewVideo = ref<Row>();
const batchCoverPreviewUrl = ref("");
const packagingCoverUrls = reactive<Record<string, string>>({});
const loadingPackagingCoverIds = new Set<string>();
const failedPackagingCoverIds = new Set<string>();
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
const expandedTaskVideoProjectId = ref("");
const taskVideoProjectDetail = ref<Row>();
const taskVideoProjectLoading = ref(false);
const newImageProjectVisible = ref(false);
const creatingImageProject = ref(false);
const imageProjectVisible = ref(false);
const taskImageProjectLoading = ref(false);
const deletingImageProjectId = ref("");
const activeImageProjectId = ref("");
const taskImageProjectDetail = ref<Row>({});
const imageProjectPreviewVisible = ref(false);
const imageProjectPreviewIndex = ref(0);
const batchImagePreviewPageSet = ref<Array<Row>>([]);
const reviewingImageProject = ref(false);
const downloadingImageProject = ref(false);
const imageProjectForm = reactive({
  productModel: "",
  imageType: "送礼类",
  audience: "给爸妈挑健康手表的人",
  hook: "给爸妈买前先看",
  competitor: "",
  creativeIntent: "",
  additionalPrompt: "",
  requirement: "",
  batchProducts: [{ model: "", count: 2 }] as Array<{ model: string; count: number }>,
  batchTypes: [{ type: "种草类", count: 2 }] as Array<{ type: string; count: number }>,
  batchTaskRequirement: "",
});
const imageRequirementEdited = ref(false);
const imageProjectMode = ref<"SINGLE" | "BATCH">("SINGLE");
const imageBatchRequirementEdited = ref(false);
const lastAutoImageBatchRequirement = ref("");
const batchImagePublishForm = ref<Record<string, { platform: string; remoteUrl: string }>>({});
const imagePublishRecords = ref<Array<{ platform: string; remoteUrl: string }>>([{ platform: "DOUYIN", remoteUrl: "" }]);
const imageProjectTypes = ["送礼类", "种草类", "避坑类", "科普类", "实拍类", "测评类", "教程类", "对比类"];
const lockedShotUpload = ref<Row>();
const videoScriptMode = ref("AUTO");
const videoScriptRestriction = ref("NORMAL");
const analyzingAssetGaps = ref(false);
const creatingGapTasks = ref(false);
const assetGaps = ref<Row[]>([]);
const selectedAssetGapIds = ref<string[]>([]);
const assetGapVisible = ref(false);
const assetGapProductModel = ref("");
let dataCenterRequestId = 0;
let currentVideoProjectPollingTimer: ReturnType<typeof setInterval> | undefined;
let currentVideoProjectPolling = false;
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
  SUCCEEDED: "已完成",
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

function linkedAiTask(task: Row) {
  return task.projection?.aiTask && typeof task.projection.aiTask === "object"
    ? task.projection.aiTask as Row
    : undefined;
}

function canMarkAiTaskUrgent(task: Row) {
  const aiTask = linkedAiTask(task);
  return Boolean(aiTask?.id)
    && aiTask?.priority !== "URGENT"
    && !["COMPLETED", "CANCELLED"].includes(String(aiTask?.status || ""));
}

async function markAiTaskUrgent(task: Row) {
  const aiTask = linkedAiTask(task);
  if (!aiTask?.id) return;
  markingUrgentAiTaskId.value = String(aiTask.id);
  try {
    await post(`/api/v1/workbench/ai-tasks/${aiTask.id}/urgent`, {});
    aiTask.priority = "URGENT";
    task.priority = "URGENT";
    ElMessage.success("已标记紧急，将优先于其他AI任务执行");
    await loadTasks();
  } finally {
    markingUrgentAiTaskId.value = "";
  }
}

function isVideoProjectTask(task: Row) {
  return task.sourceType === "VIDEO_PROJECT" || task.category === "VIDEO_PROJECT";
}

function isImageProjectTask(task: Row) {
  return task.sourceType === "IMAGE_PROJECT" || task.category === "IMAGE_PROJECT";
}

const imageFlowSteps = ["项目创建", "图文与文案生成、审核", "发布与回传"];

function imageProjectTaskStep(task: Row) {
  return Number(task.projection?.project?.step || 1);
}

function imageProjectTaskHint(task: Row) {
  return task.projection?.project?.nextAction || task.projection?.nextAction || "进入项目继续处理";
}

function imageProjectPrimaryAction(task: Row) {
  const projectId = task.sourceId || task.evidence?.contentPlanId;
  if (imageProjectVisible.value && activeImageProjectId.value === projectId) return "收起项目";
  const stage = String(task.projection?.project?.stage || "").toUpperCase();
  if (stage === "IMAGE_PUBLISHED" || ["COMPLETED", "PUBLISHED"].includes(String(task.status || "").toUpperCase())) return "查看项目";
  if (stage === "IMAGE_REVIEW") return "审核图文";
  if (["IMAGE_GENERATING", "IMAGE_RETURNED"].includes(stage)) return "查看进度";
  return "处理项目";
}

function imageProjectModeLabel(task: Row) {
  return isBatchImageProject(task) ? "批量图文" : "图文项目";
}

function imageProjectCardTitle(task: Row) {
  const project = task.projection?.project || {};
  const model = String(project.productModel || "").trim() || "未标注产品";
  if (String(project.projectMode || "") === "BATCH_IMAGE_POST_PROJECT") {
    const products = Array.isArray(project.batch?.products) ? project.batch.products as Array<Row> : [];
    const names = products.map((item) => String(item.model || "").split(" · ")[0]).filter(Boolean);
    return `${names.length ? names.join(" · ") : model} · 批量图文`;
  }
  const imageType = String(project.imageType || project.videoType || "图文").trim();
  const topic = String(project.topic || task.title || "").trim();
  const normalized = topic.replace(/^.+?·\s*/u, "");
  return `${model} · ${imageType} · ${normalized || formatTime(project.createdAt || task.createdAt)}`;
}

function isBatchImageProject(task: Row) {
  return String(task.projection?.project?.projectMode || "") === "BATCH_IMAGE_POST_PROJECT";
}

function isBatchImageProjectDetail(project?: Row) {
  if (!project) return false;
  if (String(project.projectMode || "") === "BATCH_IMAGE_POST_PROJECT") return true;
  const factory = Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "IMAGE_PROJECT")
    : undefined;
  const brief = factory?.brief && typeof factory.brief === "object" ? factory.brief as Row : {};
  return String(brief.projectMode || "") === "BATCH_IMAGE_POST_PROJECT";
}

function batchImageConfigOf(project?: Row) {
  if (!project) return undefined;
  if (project.batch) return project.batch as Row;
  const factory = Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "IMAGE_PROJECT")
    : undefined;
  const brief = factory?.brief && typeof factory.brief === "object" ? factory.brief as Row : {};
  return brief.batchDirect as Row | undefined;
}

function batchImageGroups(project?: Row) {
  const cfg = batchImageConfigOf(project);
  const stored = Array.isArray(cfg?.groups) ? cfg.groups as Array<Row> : [];
  if (stored.length) return stored;
  const products = Array.isArray(cfg?.products) ? cfg.products as Array<Row> : [];
  const types = Array.isArray(cfg?.typeDistribution) ? cfg.typeDistribution as Array<Row> : [];
  const groups: Array<Row> = [];
  let productIndex = 0;
  types.forEach((row) => {
    for (let i = 0; i < Math.max(0, Number(row.count || 0)); i += 1) {
      if (!products.length) break;
      let guard = 0;
      while (guard < products.length * 2) {
        const idx = productIndex % products.length;
        const used = groups.filter((group) => group.product === String(products[idx].model || "")).length;
        if (used < Math.max(0, Number(products[idx].count || 0))) break;
        productIndex += 1;
        guard += 1;
      }
      const idx = productIndex % products.length;
      groups.push({
        product: String(products[idx].model || ""),
        type: String(row.type || ""),
        groupKey: `${idx + 1}-${groups.filter((group) => group.product === String(products[idx].model || "")).length + 1}`,
      });
      productIndex += 1;
    }
  });
  return groups;
}

function batchImageTotalGroups() {
  return imageProjectForm.batchProducts.reduce((sum, product) => sum + Math.max(0, Number(product.count || 0)), 0);
}

function batchImageTypeTotal() {
  return imageProjectForm.batchTypes.reduce((sum, row) => sum + Math.max(0, Number(row.count || 0)), 0);
}

function plannedBatchImageGroups() {
  const products = imageProjectForm.batchProducts
    .filter((product) => product.model && Number(product.count) > 0)
    .map((product) => ({ model: product.model, count: Math.max(0, Number(product.count || 0)) }));
  const types = imageProjectForm.batchTypes
    .filter((row) => row.type && Number(row.count) > 0)
    .map((row) => ({ type: row.type, count: Math.max(0, Number(row.count || 0)) }));
  const groups: Array<{ product: string; type: string; groupKey: string }> = [];
  let productIndex = 0;
  types.forEach((row) => {
    for (let index = 0; index < row.count && products.length; index += 1) {
      let guard = 0;
      while (guard < products.length * 2) {
        const selected = products[productIndex % products.length];
        const used = groups.filter((group) => group.product === selected.model).length;
        if (used < selected.count) break;
        productIndex += 1;
        guard += 1;
      }
      const selectedIndex = productIndex % products.length;
      const selected = products[selectedIndex];
      groups.push({
        product: selected.model,
        type: row.type,
        groupKey: `${selectedIndex + 1}-${groups.filter((group) => group.product === selected.model).length + 1}`,
      });
      productIndex += 1;
    }
  });
  return groups;
}

function buildBatchImageTaskRequirement() {
  const groupLines = plannedBatchImageGroups()
    .map((group, index) => `${index + 1}. ${group.product}｜${group.type}｜第 ${group.groupKey.split("-")[1]} 组`)
    .join("\n") || "待完成产品和类型配置";
  const additionalPrompt = imageProjectForm.additionalPrompt.trim();
  return `批量图文执行清单（每项为 1 组，必须按此执行，不可调换产品或类型）：
${groupLines}

交付：每组同步完成图文页、标题、标签和发布文案。
素材限制：仅使用对应产品的真实素材，不得混用其他产品素材。${additionalPrompt ? `\n补充要求：${additionalPrompt}` : ""}`;
}

function syncBatchImageTaskRequirement() {
  const next = buildBatchImageTaskRequirement();
  if (!imageBatchRequirementEdited.value || imageProjectForm.batchTaskRequirement === lastAutoImageBatchRequirement.value) {
    imageProjectForm.batchTaskRequirement = next;
    imageBatchRequirementEdited.value = false;
  }
  lastAutoImageBatchRequirement.value = next;
}

function markBatchImageRequirementEdited() {
  imageBatchRequirementEdited.value = imageProjectForm.batchTaskRequirement !== lastAutoImageBatchRequirement.value;
}

function addBatchImageProduct() {
  if (imageProjectForm.batchProducts.length >= 5) {
    ElMessage.warning("批量图文最多 5 个产品");
    return;
  }
  imageProjectForm.batchProducts.push({ model: "", count: 2 });
  syncBatchImageTaskRequirement();
}

function removeBatchImageProduct(index: number) {
  if (imageProjectForm.batchProducts.length <= 1) return;
  imageProjectForm.batchProducts.splice(index, 1);
  syncBatchImageTaskRequirement();
}

function addBatchImageType() {
  imageProjectForm.batchTypes.push({ type: "种草类", count: 1 });
  syncBatchImageTaskRequirement();
}

function removeBatchImageType(index: number) {
  if (imageProjectForm.batchTypes.length <= 1) return;
  imageProjectForm.batchTypes.splice(index, 1);
  syncBatchImageTaskRequirement();
}

function batchImagePublishRecord(groupKey: string) {
  if (!batchImagePublishForm.value[groupKey]) {
    batchImagePublishForm.value[groupKey] = { platform: "DOUYIN", remoteUrl: "" };
  }
  return batchImagePublishForm.value[groupKey];
}

function batchImageReviewResult(project: Row | undefined, group: Row) {
  return batchImageReviewGroup(project, group);
}

function batchImageFirstPageUrl(project: Row | undefined, group: Row) {
  const page = batchImageReviewResult(project, group).pages[0] as Row | undefined;
  return page ? imageProjectPageUrl(page) : "";
}

function batchImageReadyForReview(project?: Row) {
  return batchImageGroups(project).every((group) => batchImageReviewResult(project, group).status === "READY");
}

function batchImageProgressStats(project?: Row) {
  const groups = batchImageGroups(project);
  const task = project?.aiTask as Row | undefined;
  const status = String(task?.status || "").toUpperCase();
  const done = ["COMPLETED", "SUCCEEDED"].includes(status) ? groups.length : 0;
  const failed = status === "FAILED" ? groups.length : 0;
  const products = Array.from(new Set(groups.map((group) => String(group.product || "")))).length;
  return { total: groups.length, products, done, failed };
}

async function approveBatchImage() {
  const projectId = activeImageProjectId.value;
  if (!projectId) return;
  try {
    await post(`/api/v1/workbench/image-projects/${projectId}/batch-review`, { action: "APPROVE" });
    ElMessage.success("整批审核通过，可以回传发布链接");
    await refreshImageProject();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "审核提交失败");
  }
}

async function rejectBatchImage(group?: Row) {
  const target = group ? String(group.groupKey || "该组图文") : "整批";
  const answer = await ElMessageBox.prompt(
    `退回${target === "整批" ? "整批" : `第 ${target} 组`}。填写具体原因后，Codex 会按原因定向修改。`,
    "填写退回原因",
    { inputType: "textarea", inputValidator: (value) => (value?.trim() ? true : "请填写退回原因") },
  ).catch(() => null);
  if (!answer) return;
  const note = answer.value.trim();
  if (!note) return;
  const projectId = activeImageProjectId.value;
  if (!projectId) return;
  try {
    await post(`/api/v1/workbench/image-projects/${projectId}/batch-review`, { action: "RETURN", note });
    ElMessage.success("已退回，Codex 正在按原因修改");
    await refreshImageProject();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "退回提交失败");
  }
}

async function submitBatchImagePublish() {
  const projectId = activeImageProjectId.value;
  const project = taskImageProjectDetail.value;
  if (!projectId || !project) return;
  const records = batchImageGroups(project)
    .map((group) => {
      const form = batchImagePublishForm.value[String(group.groupKey || "")];
      return {
        groupKey: String(group.groupKey || ""),
        platform: form?.platform || "DOUYIN",
        remoteUrl: form?.remoteUrl || "",
      };
    })
    .filter((record) => Boolean(record.remoteUrl.trim()));
  if (!records.length) return ElMessage.warning("请至少为一组图文粘贴发布链接");
  try {
    await post(`/api/v1/workbench/image-projects/${projectId}/batch-publish`, { records });
    ElMessage.success("发布链接已回传，任务完成");
    await refreshImageProject();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "回传发布链接失败");
  }
}

function imageProjectPages(project?: Row) {
  const metadata = project?.variants?.[0]?.metadata || project?.imagePost || {};
  return Array.isArray(metadata.pages) ? metadata.pages : Array.isArray(project?.pages) ? project.pages : [];
}

function imageProjectPageUrl(page: Row) {
  return String(page.downloadUrl || page.imageUrl || page.fileUrl || page.storageUrl || page.url || "");
}

const imageProjectPreviewPages = computed(() => batchImagePreviewPageSet.value.length ? batchImagePreviewPageSet.value : imageProjectPages(taskImageProjectDetail.value));
const currentImageProjectPreviewPage = computed(() => imageProjectPreviewPages.value[imageProjectPreviewIndex.value]);

function openImageProjectPreview() {
  batchImagePreviewPageSet.value = [];
  imageProjectPreviewIndex.value = 0;
  imageProjectPreviewVisible.value = true;
}

function openBatchImagePreview(group: Row) {
  const pages = batchImagePreviewPages(taskImageProjectDetail.value, group) as Array<Row>;
  if (!pages.length) return ElMessage.warning("该组暂无可预览图文");
  batchImagePreviewPageSet.value = pages;
  imageProjectPreviewIndex.value = 0;
  imageProjectPreviewVisible.value = true;
}

function changeImageProjectPreviewPage(direction: number) {
  const nextIndex = imageProjectPreviewIndex.value + direction;
  if (nextIndex < 0 || nextIndex >= imageProjectPreviewPages.value.length) return;
  imageProjectPreviewIndex.value = nextIndex;
}

function imageProjectVariant(project?: Row) {
  return (project?.variants || []).find((item: Row) => String(item.platform || "").toUpperCase() === "DOUYIN") || project?.variants?.[0] || {};
}

function imageProjectTags(project?: Row) {
  const metadata = imageProjectVariant(project).metadata || {};
  return Array.isArray(metadata.tags)
    ? metadata.tags.map((tag: unknown) => String(tag || "").trim().replace(/^#+/, "")).filter(Boolean)
    : [];
}

function safeDownloadName(value: unknown, fallback: string) {
  const normalized = String(value || "")
    .replace(/[\\/:*?"<>|]/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/[. ]+$/gu, "")
    .trim();
  return normalized || fallback;
}

function imageProjectPageFileName(page: Row, index: number, extension = "png") {
  const sequence = String(index + 1).padStart(2, "0");
  const pageLabel = index === 0 ? "封面" : safeDownloadName(page.title, `第${index + 1}页`);
  return `${sequence}-${pageLabel}.${extension}`;
}

function imageExtension(blob: Blob, url: string) {
  const byMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  if (byMime[blob.type]) return byMime[blob.type];
  const pathname = (() => { try { return new URL(url, window.location.href).pathname; } catch { return ""; } })();
  const match = pathname.match(/\.([a-z0-9]{2,5})$/iu);
  return match?.[1]?.toLowerCase() || "png";
}

function compactDownloadTime(date = new Date()) {
  const part = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
}

async function downloadAllImageProjectPages(project?: Row) {
  const pages = imageProjectPages(project).filter((page: Row) => imageProjectPageUrl(page));
  if (!pages.length) return ElMessage.warning("暂无可下载的图文");
  if (downloadingImageProject.value) return;
  downloadingImageProject.value = true;
  try {
    const zip = new JSZip();
    const downloads = await Promise.all(pages.map(async (page: Row, index: number) => {
      const url = imageProjectPageUrl(page);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`第 ${index + 1} 张下载失败`);
      const blob = await response.blob();
      return { blob, fileName: imageProjectPageFileName(page, index, imageExtension(blob, url)) };
    }));
    downloads.forEach(({ blob, fileName }) => zip.file(fileName, blob));
    const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const objectUrl = URL.createObjectURL(zipBlob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    const productName = safeDownloadName(project?.productModel, "未标注产品");
    const imageType = safeDownloadName(project?.imageType || project?.videoType, "图文");
    anchor.download = `图文-${productName}-${imageType}-${compactDownloadTime()}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    ElMessage.success(`已打包下载 ${pages.length} 张图文`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "图文打包下载失败，请稍后重试");
  } finally {
    downloadingImageProject.value = false;
  }
}

function imageProjectCopy(project?: Row) {
  const metadata = imageProjectVariant(project).metadata || {};
  return String(metadata.publishCopy || imageProjectVariant(project).body || "");
}

function imageProjectAiTask(project?: Row): Row | undefined {
  return project?.aiTask && typeof project.aiTask === "object" ? project.aiTask as Row : undefined;
}

function imageProjectAiTaskProgress(project?: Row) {
  return Math.max(0, Math.min(100, Number(imageProjectAiTask(project)?.progress || 0)));
}

function imageProjectAiTaskMessage(project?: Row) {
  const task = imageProjectAiTask(project);
  if (task?.failureReason) return String(task.failureReason);
  return String(task?.progressMessage || "图文制作 Skill 正在生成图文、标题、标签和发布文案。");
}

function videoProjectTaskStep(task: Row) {
  return Number(task.projection?.project?.step || 1);
}

function videoProjectTaskHint(task: Row) {
  return task.projection?.project?.nextAction || task.projection?.nextAction || "进入项目继续处理";
}

function videoProjectModeLabel(task: Row) {
  const mode = String(task.projection?.project?.projectMode || "");
  if (mode === "REFERENCE_DIRECT_FULL_VIDEO") return "参考直出";
  if (mode === "CODEX_DIRECT_FULL_VIDEO") return "Codex 直出";
  if (mode === "BATCH_CODEX_DIRECT_FULL_VIDEO") return "批量Codex直出";
  return "标准项目";
}

function videoProjectPrimaryAction(task: Row) {
  const projectId = task.sourceId || task.evidence?.contentPlanId;
  if (expandedTaskVideoProjectId.value === projectId) return "收起项目";
  const stage = String(task.projection?.project?.stage || "").toUpperCase();
  if (["COMPLETED", "PUBLISHED"].includes(String(task.status || "").toUpperCase())) return "查看项目";
  if (isBatchVideoProjectTask(task)) {
    const step = Number(task.projection?.project?.step || 2);
    const cfg = task.projection?.project?.batch as Row | undefined;
    const cover = cfg ? cfg.generateCoverTitle !== false : true;
    const finalStep = cover ? 3 : 4;
    if (step === finalStep) return "审核成片";
    if (["READY_TO_PUBLISH", "PUBLISHING", "TRACKING"].includes(stage)) return "回传链接";
    return step > 1 ? "查看进度" : "处理项目";
  }
  if (stage === "VIDEO_REVIEW") return "审核成片";
  if ([
    "FACTORY_SCRIPT_READY",
    "SCRIPT_APPROVED",
    "MATERIAL_REVIEW",
    "MATERIAL_RETURNED",
    "READY_TO_EDIT",
    "PACKAGING_REVIEW",
    "READY_TO_PUBLISH",
    "TRACKING",
  ].includes(stage)) return "处理项目";
  return "查看进度";
}

function videoProjectCardTitle(task: Row) {
  const project = task.projection?.project || {};
  const model = String(project.productModel || "").trim() || "未标注产品";
  const mode = String(project.projectMode || "");
  if (mode === "REFERENCE_DIRECT_FULL_VIDEO") return `${model} · 参考直出`;
  if (mode === "CODEX_DIRECT_FULL_VIDEO") return `${model} · Codex直出`;
  if (mode === "BATCH_CODEX_DIRECT_FULL_VIDEO") {
    const products = Array.isArray(project.batch?.products) ? project.batch.products as Array<Row> : [];
    const names = products.map((item) => String(item.model || "").split(" · ")[0]).filter(Boolean);
    const titleBase = names.length ? names.join(" · ") : model;
    return `${titleBase} · 批量Codex直出`;
  }
  const videoType = String(project.videoType || "").trim() || "智能视频";
  const rawTopic = String(project.topic || task.title || "").trim();
  const genericTopic = !rawTopic || rawTopic === `${model} 智能视频项目` || rawTopic === `${model} · ${videoType}`;
  const topic = genericTopic ? String(project.keywords || "").trim() : rawTopic;
  if (topic && topic.includes(" · ")) return topic;
  return [model, videoType, topic || (project.createdAt ? formatTime(project.createdAt) : "未命名")].filter(Boolean).join(" · ");
}

function videoProjectDueText(task: Row) {
  if (!task.dueAt) return "";
  const dueAt = new Date(task.dueAt);
  if (Number.isNaN(dueAt.getTime())) return "";
  const remain = dueAt.getTime() - Date.now();
  if (remain > 24 * 60 * 60 * 1000) return "";
  return remain < 0 ? `已逾期 ${formatTime(task.dueAt)}` : `截止 ${formatTime(task.dueAt)}`;
}

function isBatchCodexVideoProject(project?: Row) {
  return projectMode(project || {}) === "BATCH_CODEX_DIRECT_FULL_VIDEO";
}

function isBatchVideoProjectTask(task: Row) {
  return String(task.projection?.project?.projectMode || "") === "BATCH_CODEX_DIRECT_FULL_VIDEO";
}

function batchConfigOf(project?: Row) {
  if (!project) return undefined;
  if (project.batch) return project.batch as Row;
  const factory = Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  const brief = factory?.brief && typeof factory.brief === "object" ? factory.brief as Row : {};
  return brief.batchDirect as Row | undefined;
}

function batchFlowSteps(task: Row) {
  const cover = task.projection?.project?.batch?.generateCoverTitle !== false;
  return cover
    ? ["新建项目", "生成视频 · 封面 · 标题", "成片审核与回传"]
    : ["新建项目", "生成视频", "封面标题生成", "成片审核与回传"];
}

function batchFlowStepsForProject(project?: Row) {
  const cfg = batchConfigOf(project);
  const cover = cfg ? cfg.generateCoverTitle !== false : true;
  return cover
    ? ["新建项目", "生成视频 · 封面 · 标题", "成片审核与回传"]
    : ["新建项目", "生成视频", "封面标题生成", "成片审核与回传"];
}

function batchFlowStep(project?: Row) {
  const cfg = batchConfigOf(project);
  const cover = cfg ? cfg.generateCoverTitle !== false : true;
  const stage = String(project?.productionStage || "").toUpperCase();
  if (["EDITING", "FACTORY_GENERATING", "PROJECT_BRIEF"].includes(stage)) return 2;
  if (!cover) {
    if (stage === "VIDEO_REVIEW") return 3;
    if (stage === "PLATFORM_PACKAGING") return 3;
    if (["PACKAGING_REVIEW", "READY_TO_PUBLISH", "PUBLISHING", "TRACKING"].includes(stage)) return 4;
    return 3;
  }
  if (["VIDEO_REVIEW", "PACKAGING_REVIEW", "READY_TO_PUBLISH", "PUBLISHING", "TRACKING"].includes(stage)) return 3;
  return 2;
}

function batchVideos(project?: Row) {
  const cfg = batchConfigOf(project);
  const products = Array.isArray(cfg?.products) ? cfg.products as Array<Row> : [];
  const split = String(cfg?.voiceoverSplit || "HALF").toUpperCase();
  const videos: Array<Row> = [];
  const returned = Array.isArray(cfg?.results) ? cfg!.results as Array<Row> : [];
  products.forEach((product, productIndex) => {
    const count = Math.max(0, Number(product.count || 0));
    const voiced = split === "ALL" ? count : split === "NONE" ? 0 : Math.floor(count / 2);
    const model = String(product.model || "未标注产品");
    for (let index = 0; index < count; index += 1) {
      const videoKey = `${productIndex + 1}-${index + 1}`;
      const result = returned.find((item) => String(item.videoKey || "") === videoKey);
      const job = batchVideoJobFor(project, videoKey, videos.length);
      const manifestStatus = String(result?.status || "").toUpperCase();
      const hasReviewableMaster = Boolean(job?.outputAsset);
      const resultStatus = hasReviewableMaster || manifestStatus === "READY"
        ? "READY"
        : manifestStatus === "FAILED"
          ? "FAILED"
          : "GENERATING";
      videos.push({
        videoKey,
        product: model,
        productShort: model.split(" · ")[0],
        type: index < voiced ? "口播" : "无口播",
        displayName: `${model.split(" · ")[0]} · 视频 ${productIndex + 1}-${index + 1}`,
        resultStatus,
        resultTitle: String(result?.title || ""),
        resultTags: Array.isArray(result?.tags) ? result.tags.map(String).filter(Boolean) : [],
        failureReason: String(result?.failureReason || ""),
        coverUrl: String(result?.coverUrl || ""),
        coverAssetId: String(result?.coverAssetId || ""),
      });
    }
  });
  return videos;
}

function batchTotalVideos() {
  return videoFactoryForm.batchProducts.reduce((sum, product) => sum + Math.max(0, Number(product.count || 0)), 0);
}

function batchProductOptions() {
  return (contentTaskOptions.products || []) as Array<Row>;
}

function addBatchProduct() {
  if (videoFactoryForm.batchProducts.length >= 5) {
    ElMessage.warning("批量视频最多 5 个产品");
    return;
  }
  videoFactoryForm.batchProducts.push({ model: "", count: 2 });
  syncBatchTaskRequirement();
}

function removeBatchProduct(index: number) {
  if (videoFactoryForm.batchProducts.length <= 1) return;
  videoFactoryForm.batchProducts.splice(index, 1);
  syncBatchTaskRequirement();
}

function buildBatchTaskRequirement() {
  const valid = videoFactoryForm.batchProducts.filter((product) => product.model && Number(product.count) > 0);
  const total = batchTotalVideos();
  const productLines = valid.length
    ? valid.map((product, index) => `${index + 1}. ${product.model}（${product.count} 条）`).join("\n")
    : "产品型号：待选择";
  const voiceover = videoFactoryForm.batchVoiceoverSplit === "ALL"
    ? "全部口播"
    : videoFactoryForm.batchVoiceoverSplit === "NONE"
      ? "全部无口播"
      : "一半口播、一半无口播（按每个产品各半分配，奇数条时无口播多一条）";
  const cover = videoFactoryForm.batchGenerateCoverTitle;
  const additionalPrompt = videoFactoryForm.additionalPrompt.trim();
  return `模式：BATCH_CODEX_DIRECT_FULL_VIDEO
执行目标：作为批量 Codex 直出项目，一次任务内直接生成全部 ${total} 条视频并交付最终成片。内部脚本、素材匹配和剪辑由 Codex 自动完成，不回传员工端，只回传总体进度和最终成品${cover ? "，并为每条视频生成封面、标题和标签" : ""}。

产品与视频分配：
${productLines}

口播分配：${voiceover}
每条视频使用不同 BGM：${videoFactoryForm.batchBgmVariety ? "是（默认）" : "否"}
多使用几种音色、尽量不重复：${videoFactoryForm.batchVoiceVariety ? "是（默认）" : "否"}
${cover ? "同时生成封面标题：是（员工提交后直接获得最终成品；每条视频的标签至少 5 个）" : "同时生成封面标题：否（封面标题在后续单独步骤生成）"}

${additionalPrompt ? `用户补充提示词：\n${additionalPrompt}\n` : ""}

画面约束：只使用所选产品的真实素材，不得混用其他产品素材。各视频在脚本方向、开场、画面节奏上尽量错开，避免整批重复。最终以批量任务整体交付，等待员工审核。`;
}

function syncBatchTaskRequirement() {
  const next = buildBatchTaskRequirement();
  if (!batchRequirementEdited.value || videoFactoryForm.batchTaskRequirement === lastAutoBatchRequirement.value) {
    videoFactoryForm.batchTaskRequirement = next;
    batchRequirementEdited.value = false;
  }
  lastAutoBatchRequirement.value = next;
}

function markBatchRequirementEdited() {
  batchRequirementEdited.value = videoFactoryForm.batchTaskRequirement !== lastAutoBatchRequirement.value;
}

const batchPublishForm = ref<Record<string, { platform: string; remoteUrl: string }>>({});

function batchPublishRecord(videoKey: string) {
  if (!batchPublishForm.value[videoKey]) {
    batchPublishForm.value[videoKey] = { platform: "DOUYIN", remoteUrl: "" };
  }
  return batchPublishForm.value[videoKey];
}

function batchProductsCount(project?: Row) {
  const cfg = batchConfigOf(project);
  return Array.isArray(cfg?.products) ? cfg.products.length : 0;
}

function batchProgressStats(project?: Row) {
  const videos = batchVideos(project);
  const task = activeProjectVideoTask(project);
  const status = String(task?.status || "").toUpperCase();
  const returnedReady = videos.filter((video) => String(video.resultStatus || "") === "READY").length;
  const returnedFailed = videos.filter((video) => String(video.resultStatus || "") === "FAILED").length;
  const renderJobs = Array.isArray(project?.videoRenderJobs) ? project!.videoRenderJobs : [];
  const succeededRenders = renderJobs.filter((job: Row) => String(job.status || "").toUpperCase() === "SUCCEEDED").length;
  const done = returnedReady || (["COMPLETED", "SUCCEEDED"].includes(status)
    ? videos.length
    : Math.max(0, Math.min(videos.length, succeededRenders)));
  const failed = returnedFailed || (status === "FAILED" ? videos.length : 0);
  return { total: videos.length, products: batchProductsCount(project), done, failed };
}

function batchVideoRenderJob(project?: Row, videoKey?: string) {
  const index = batchVideos(project).findIndex((video) => video.videoKey === videoKey);
  return batchVideoJobFor(project, videoKey, index);
}

function batchVideoJobFor(project?: Row, videoKey?: string, index = -1) {
  const jobs = reviewableVideoRenderJobs(project);
  const matched = jobs.find((job: Row) => String((job.input as Row | undefined)?.videoKey || "") === String(videoKey || ""));
  if (matched) return matched;
  const ordered = [...jobs].sort(
    (a, b) => new Date(String(a.createdAt || "")).getTime() - new Date(String(b.createdAt || "")).getTime(),
  );
  return index >= 0 ? ordered[index] : ordered[0];
}

async function previewBatchVideo(video: Row) {
  const job = batchVideoRenderJob(taskVideoProjectDetail.value, String(video.videoKey || ""));
  if (job?.outputAsset) {
    await openAssetPreview(job.outputAsset, String(video.displayName || "成片预览"));
    return;
  }
  ElMessage.warning("该条成片尚未回传，请稍后刷新");
}

function openBatchCoverPreview(video: Row) {
  if (video.coverUrl) {
    batchCoverPreviewUrl.value = String(video.coverUrl || "");
    batchCoverPreviewVideo.value = video;
    batchCoverPreviewVisible.value = true;
    return;
  }
  ElMessage.warning("该条封面图尚未回传，可先预览成片画面");
}

function discardBatchCoverUrl(video: Row) {
  video.coverUrl = "";
}

async function downloadBatchVideo(video: Row) {
  const job = batchVideoRenderJob(taskVideoProjectDetail.value, String(video.videoKey || ""));
  if (!job?.outputAsset) {
    ElMessage.warning("该条成片尚未回传，无法下载");
    return;
  }
  try {
    const result = await api<{ url: string }>(`/api/v1/workbench/assets/${job.outputAsset.id}/download-url`);
    if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "成片下载失败");
  }
}

async function retryBatchVideo(video: Row) {
  const projectId = activeVideoProjectId.value;
  if (!projectId) return;
  await post(`/api/v1/workbench/data-center/video-projects/${projectId}/batch-retry`, { videoKey: String(video.videoKey || "") });
  ElMessage.success("已仅重试该条视频");
  await refreshTaskVideoProject();
}

async function approveBatchVideo() {
  const projectId = expandedTaskVideoProjectId.value;
  if (!projectId) return;
  try {
    await post(`/api/v1/workbench/data-center/video-projects/${projectId}/batch-review`, { action: "APPROVE" });
    await refreshTaskVideoProject();
    ElMessage.success("整批审核通过，可以回传发布链接");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "审核提交失败");
  }
}

async function rejectBatchVideo(video?: Row) {
  const target = video ? String(video.displayName || "该条视频") : "整批";
  const result = await ElMessageBox.prompt(
    `退回${target}。填写具体原因后，Codex 会按原因定向修改${video ? "这条视频" : "整批视频"}。`,
    "填写退回原因",
    { confirmButtonText: "确认退回", cancelButtonText: "取消", inputType: "textarea" },
  ).catch(() => null);
  if (!result) return;
  const note = result.value.trim();
  if (!note) return ElMessage.warning("退回时必须填写具体修改原因");
  const projectId = expandedTaskVideoProjectId.value;
  if (!projectId) return;
  try {
    await post(`/api/v1/workbench/data-center/video-projects/${projectId}/batch-review`, { action: "RETURN", note });
    await refreshTaskVideoProject();
    ElMessage.success("已退回，Codex 正在按原因修改");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "退回提交失败");
  }
}

async function submitBatchCoverTitle() {
  const projectId = expandedTaskVideoProjectId.value;
  if (!projectId) return;
  try {
    await post(`/api/v1/workbench/data-center/video-projects/${projectId}/batch-cover-title`, {});
    await refreshTaskVideoProject();
    ElMessage.success("批量封面标题任务已提交");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "封面标题任务提交失败");
  }
}

async function submitBatchPublish() {
  const projectId = expandedTaskVideoProjectId.value;
  const project = taskVideoProjectDetail.value;
  if (!projectId || !project) return;
  const records = batchVideos(project)
    .map((video) => {
      const form = batchPublishForm.value[String(video.videoKey || "")];
      return {
        videoKey: String(video.videoKey || ""),
        platform: form?.platform || "DOUYIN",
        remoteUrl: form?.remoteUrl || "",
      };
    })
    .filter((record) => Boolean(record.remoteUrl.trim()));
  if (!records.length) return ElMessage.warning("请至少为一条视频粘贴发布链接");
  try {
    await post(`/api/v1/workbench/data-center/video-projects/${projectId}/batch-publish`, { records });
    await refreshTaskVideoProject();
    ElMessage.success("发布链接已回传，任务完成");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "回传发布链接失败");
  }
}

function batchVideoCoverMeta(video: Row, index: number) {
  const resultTitle = String(video.resultTitle || "").trim();
  const resultTags = Array.isArray(video.resultTags) ? video.resultTags.map(String).filter(Boolean) : [];
  if (resultTitle || resultTags.length) {
    return { title: resultTitle || "标题未回传", coverText: resultTitle || "封面未回传", tags: resultTags };
  }
  return { title: "标题未回传", coverText: "封面未回传", tags: [] };
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
  const candidates = projectCandidates(project);
  const factory = Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  const requestedEngines = Array.isArray(factory?.brief?.scriptEngines)
    ? factory.brief.scriptEngines.map(String)
    : [];
  // A transfer to Codex replaces the active review version.  The previous
  // system-AI draft remains in history but must not appear beside Codex.
  if (requestedEngines.length === 1 && requestedEngines[0] === "REMOTE_CODEX") {
    return candidates.filter((candidate: Row) => candidate.generationSource === "REMOTE_CODEX");
  }
  // A system-AI regeneration replaces the active system draft.  Old system
  // drafts remain in backend version history, rather than appearing as a
  // second side-by-side script in the current project workspace.
  if (isSingleScriptProject(project)) {
    const lastSystemCandidateIndex = candidates.reduce(
      (last: number, candidate: Row, index: number) => candidate.generationSource === "SYSTEM_AI" ? index : last,
      -1,
    );
    return candidates.filter((candidate: Row, index: number) =>
      candidate.generationSource !== "SYSTEM_AI" || index === lastSystemCandidateIndex,
    );
  }
  return candidates;
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
    // The persisted engine status is authoritative during a regeneration.
    // A previous candidate must not turn a newly queued/running request back
    // into "completed" in the employee UI.
    if ((source === "REMOTE_CODEX" || source === "SYSTEM_AI") && !status[source]) status[source] = "COMPLETED";
  }
  const remoteOutputCompleted = (project.aiTaskOutputs || []).some((output: Row) =>
    output.kind === "VIDEO_PROJECT"
    && ["COMPLETED", "PENDING_REVIEW"].includes(String(output.aiTask?.status || "")));
  if (remoteOutputCompleted) status.REMOTE_CODEX = "COMPLETED";
  return status;
}

function projectScriptEngineErrors(project: Row) {
  const factory = Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  return { ...(factory?.scriptEngineErrors || {}) };
}

function scriptEngineStatusText(project: Row, engine: string) {
  const status = String(projectScriptEngineStatus(project)[engine] || "PENDING");
  if (status === "COMPLETED") return "已完成";
  if (status === "FAILED") return "生成失败";
  if (status === "RUNNING") return "生成中";
  return "等待生成";
}

function requestedProjectScriptEngines(project: Row) {
  const factory = Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  const engines = Array.isArray(factory?.brief?.scriptEngines)
    ? factory.brief.scriptEngines.map((engine: unknown) => String(engine))
    : [];
  return engines.length ? engines : ["SYSTEM_AI"];
}

function projectWaitingForScripts(project: Row) {
  if (!isSingleScriptProject(project)) return false;
  const factory = Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  if (["REFERENCE_DIRECT_FULL_VIDEO", "CODEX_DIRECT_FULL_VIDEO"].includes(String(factory?.projectMode || ""))) return false;
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

function applyRefreshedVideoProject(refreshed: Row) {
  const current = Array.isArray(dataCenter.videoProjects) ? dataCenter.videoProjects : [];
  dataCenter.videoProjects = current.map((project: Row) => project.id === refreshed.id ? refreshed : project);
  if (expandedTaskVideoProjectId.value === refreshed.id) taskVideoProjectDetail.value = refreshed;
  if (systemScriptConversationProject.value?.id === refreshed.id) systemScriptConversationProject.value = refreshed;
}

async function refreshActiveVideoProject() {
  const projectId = activeVideoProjectId.value;
  if (!projectId) return;
  await refreshVideoProject(projectId);
}

async function refreshVideoProject(projectId: string) {
  if (!projectId) return;
  const refreshed = await api<Row>(`/api/v1/workbench/data-center/video-projects/${projectId}`);
  applyRefreshedVideoProject(refreshed);
  ElMessage.success("当前项目已刷新");
}

const videoFlowSteps = [
  "项目创建",
  "脚本与素材准备",
  "视频生成与成片审核",
  "封面标题与发布",
];

function videoFlowStep(project: Row) {
  if (isBatchCodexVideoProject(project)) return batchFlowStep(project);
  if (projectWaitingForScripts(project)) return 2;
  const stage = String(project.productionStage || "");
  if (isCodexDirectVideoProject(project) && codexDirectRevision(project) && ["FACTORY_GENERATING", "EDITING"].includes(stage)) return 3;
  if (["PROJECT_BRIEF", "SCRIPT_GENERATING", "SCRIPT_RETURNED"].includes(stage)) return 2;
  if (["FACTORY_SCRIPT_READY", "SCRIPT_APPROVED", "FACTORY_GENERATING", "MATERIAL_REVIEW", "MATERIAL_RETURNED"].includes(stage)) return 2;
  if (["READY_TO_EDIT", "EDITING", "VIDEO_REVIEW"].includes(stage)) return 3;
  if (["PLATFORM_PACKAGING", "PACKAGING_REVIEW", "READY_TO_PUBLISH", "PUBLISHING", "TRACKING"].includes(stage)) return 4;
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

async function loadVideoLibrary() {
  videoLibraryLoading.value = true;
  try {
    const query = new URLSearchParams(Object.entries(videoLibraryFilters)
      .filter(([, value]) => String(value || "").trim())
      .map(([key, value]) => [key, String(value)]));
    query.set("page", String(videoLibraryPage.value));
    query.set("pageSize", "12");
    const result = await api<Row>(`/api/v1/workbench/video-library?${query.toString()}`);
    videoLibrary.value = result.items || [];
    videoLibraryTotal.value = Number(result.total || 0);
    videoLibraryCategories.value = result.categories || [];
    videoLibraryProductModels.value = result.productModels || [];
    videoLibraryJumpPage.value = videoLibraryPage.value;
    await Promise.all(videoLibrary.value.map(async (entry) => {
      try {
        const cover = await api<Row>(`/api/v1/workbench/video-library/${entry.id}/cover-url`);
        if (cover.url) {
          const key = String(entry.id);
          const previous = videoLibraryCoverUrls[key];
          if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
          videoLibraryCoverUrls[key] = await authenticatedMediaUrl(String(cover.url));
        }
      } catch {
        delete videoLibraryCoverUrls[String(entry.id)];
      }
    }));
  } finally {
    videoLibraryLoading.value = false;
  }
}

async function changeVideoLibraryPage(page: number) {
  videoLibraryPage.value = page;
  videoLibraryJumpPage.value = page;
  await loadVideoLibrary();
}

async function jumpToVideoLibraryPage() {
  const pageCount = Math.max(1, Math.ceil(videoLibraryTotal.value / 12));
  const page = Math.min(Math.max(Number(videoLibraryJumpPage.value) || 1, 1), pageCount);
  await changeVideoLibraryPage(page);
}

async function authenticatedMediaUrl(url: string) {
  if (!url.startsWith("/api/")) return url;
  const headers = new Headers();
  if (getToken()) headers.set("authorization", `Bearer ${getToken()}`);
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error("媒体文件加载失败");
  return URL.createObjectURL(await response.blob());
}

function videoLibraryTitle(entry: Row) {
  return String(entry.contentPlan?.variants?.find((item: Row) => item.platform === entry.platform && item.packagingStatus === "APPROVED")?.title || entry.title || "未命名成品");
}

function videoLibraryTags(entry: Row) {
  const variant = entry.contentPlan?.variants?.find((item: Row) => item.platform === entry.platform && item.packagingStatus === "APPROVED") || {};
  const metadata = variant.metadata && typeof variant.metadata === "object" ? variant.metadata : {};
  const coverSpec = variant.coverSpec && typeof variant.coverSpec === "object" ? variant.coverSpec : {};
  const tags = Array.isArray(metadata.tags) ? metadata.tags : Array.isArray(coverSpec.hashtags) ? coverSpec.hashtags : [];
  return tags.map((tag: unknown) => String(tag || "").replace(/^#/, "").trim()).filter(Boolean).slice(0, 3);
}

function videoLibraryMetric(entry: Row, field: "latestViews" | "latestLikes" | "latestComments") {
  const value = Number(entry[field]);
  if (!Number.isFinite(value)) return "—";
  return value >= 10000 ? `${(value / 10000).toFixed(value >= 100000 ? 1 : 2).replace(/\.0$/, "")}万` : value.toLocaleString("zh-CN");
}

function videoLibraryMetricCheckpoint(entry: Row) {
  const hours = Number(entry.latestMetricCheckpointHours);
  return hours === 720 ? "第30天" : hours === 168 ? "第7天" : hours === 72 ? "第3天" : hours === 3 ? "第3小时" : "最新采集";
}

function videoLibraryPublishedVariants(entry?: Row) {
  return (entry?.contentPlan?.variants || []).filter((variant: Row) => variant.manualPublishUrl || variant.publishJobs?.some((job: Row) => job.remoteUrl));
}

function videoLibraryMetricHistory(entry?: Row) {
  if (Array.isArray(entry?.metricHistory) && entry.metricHistory.length) {
    return [...entry.metricHistory].sort((left: Row, right: Row) => Number(right.checkpointHours) - Number(left.checkpointHours));
  }
  return [];
}

function videoLibraryMetricRowLabel(metric: Row, index: number) {
  const hours = Number(metric.checkpointHours) || [720, 168, 72, 3][index];
  return hours === 720 ? "第30天采集" : hours === 168 ? "第7天采集" : hours === 72 ? "第3天采集" : hours === 3 ? "第3小时采集" : "历史采集";
}

function openDownload(url: string, fileName: string) {
  if (!url) return ElMessage.warning("文件暂不可下载");
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.click();
}

async function switchOutputCategory(category: string) {
  outputCategory.value = category;
  if (category === "VIDEO") await loadVideoLibrary();
  else await loadOutputLibrary(category);
}

async function openVideoLibraryEntry(entry: Row) {
  videoLibraryDetailVisible.value = true;
  videoLibraryDetail.value = undefined;
  videoLibraryPreviewUrl.value = "";
  videoLibraryDetailCoverUrl.value = "";
  videoLibraryHistoryExpanded.value = false;
  try {
    const [detail, preview] = await Promise.all([
      api<Row>(`/api/v1/workbench/video-library/${entry.id}`),
      api<Row>(`/api/v1/workbench/video-library/${entry.id}/url`),
    ]);
    videoLibraryDetail.value = detail;
    videoLibraryPreviewUrl.value = preview.url || "";
    try {
      const cover = await api<Row>(`/api/v1/workbench/video-library/${entry.id}/cover-url`);
      videoLibraryDetailCoverUrl.value = cover.url ? await authenticatedMediaUrl(String(cover.url)) : "";
    } catch {
      videoLibraryDetailCoverUrl.value = "";
    }
  } catch (error) {
    videoLibraryDetailVisible.value = false;
    ElMessage.error(error instanceof Error ? error.message : "成品加载失败");
  }
}

function videoLibrarySourceProject(entry?: Row): Row {
  const snapshot = entry?.snapshot;
  return snapshot?.project && typeof snapshot.project === "object" ? snapshot.project as Row : {};
}

function videoLibraryLanguageInstruction() {
  if (videoLibraryCreateForm.targetLanguage === "EN") return "新生成的字幕和贴纸文案等都用英文，这条视频面向英文社交平台；未要求重配的原声保持不变。";
  if (videoLibraryCreateForm.targetLanguage === "OTHER") {
    const language = videoLibraryCreateForm.customLanguage.trim();
    return language
      ? `新生成的字幕和贴纸文案等都用${language}，这条视频面向${language}社交平台；未要求重配的原声保持不变。`
      : "请填写新生成字幕和贴纸文案所用的语言。";
  }
  return "新生成的字幕和贴纸文案等都用中文，这条视频面向中文社交平台；未要求重配的原声保持不变。";
}

function videoLibrarySourceTaskSummary(entry?: Row) {
  const source = videoLibrarySourceProject(entry);
  const snapshot = entry?.snapshot || {};
  const summary = String(snapshot.taskSummary || source.taskSummary || source.objective || "").trim();
  return /^内容测试[。.!！]?$/.test(summary) ? "" : summary;
}

function syncVideoLibraryTaskRequirement() {
  const entry = videoLibraryDetail.value;
  if (!entry) return;
  const languageInstruction = videoLibraryLanguageInstruction();
  if (videoLibraryCreateForm.mode === "REFERENCE_DIRECT") {
    const changes: string[] = [];
    if (videoLibraryCreateForm.replaceProduct && videoLibraryCreateForm.productModel) {
      const product = videoLibraryCreateForm.productModel;
      changes.push(`产品替换：改为${product}。仅替换涉及原产品的画面，并使用${product}的真实素材；其它未要求修改的参考画面保持复用。`);
    }
    if (videoLibraryCreateForm.replaceHook && videoLibraryCreateForm.hook.trim()) changes.push(`开场钩子改为：${videoLibraryCreateForm.hook.trim()}。`);
    if (videoLibraryCreateForm.replaceFeature && videoLibraryCreateForm.feature.trim()) changes.push(`核心卖点改为：${videoLibraryCreateForm.feature.trim()}。`);
    if (videoLibraryCreateForm.replaceOther && videoLibraryCreateForm.otherChange.trim()) changes.push(`其它修改：${videoLibraryCreateForm.otherChange.trim()}。`);
    changes.push(languageInstruction);
    videoLibraryCreateForm.taskRequirement = ["成品库参考直出：直接复用参考视频的画面和完整可用原声，只按下列要求修改；未列出的画面、结构、节奏和原声保持不变。", ...changes].join("\n");
    return;
  }
  const changes: string[] = [];
  if (videoLibraryCreateForm.replaceProduct && videoLibraryCreateForm.productModel) changes.push(`产品型号改为：${videoLibraryCreateForm.productModel}。`);
  if (videoLibraryCreateForm.replaceHook && videoLibraryCreateForm.hook.trim()) changes.push(`开场钩子改为：${videoLibraryCreateForm.hook.trim()}。`);
  if (videoLibraryCreateForm.replaceFeature && videoLibraryCreateForm.feature.trim()) changes.push(`核心卖点改为：${videoLibraryCreateForm.feature.trim()}。`);
  videoLibraryCreateForm.taskRequirement = [
    "复用项目配置：以该审核通过的成品视频作为镜头节奏与画面结构参考，不直接复用其中的产品素材。",
    videoLibraryOriginalRequirement.value,
    ...changes,
    languageInstruction,
  ].filter(Boolean).join("\n");
}

async function openVideoLibraryCreate() {
  const entry = videoLibraryDetail.value;
  if (!entry) return;
  videoLibraryCreateForm.mode = "REFERENCE_DIRECT";
  videoLibraryCreateForm.productModel = String(videoLibrarySourceProject(entry).productModel || entry.productModel || entry.contentPlan?.productModel || "");
  videoLibraryCreateForm.replaceProduct = false;
  videoLibraryCreateForm.replaceHook = false;
  videoLibraryCreateForm.hook = "";
  videoLibraryCreateForm.replaceFeature = false;
  videoLibraryCreateForm.feature = "";
  videoLibraryCreateForm.replaceOther = false;
  videoLibraryCreateForm.otherChange = "";
  videoLibraryCreateForm.targetLanguage = "ZH";
  videoLibraryCreateForm.customLanguage = "";
  videoLibraryOriginalRequirement.value = videoLibrarySourceTaskSummary(entry);
  syncVideoLibraryTaskRequirement();
  try {
    await ensureContentTaskOptions();
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : "系统产品型号加载失败");
  }
  videoLibraryCreateVisible.value = true;
}

async function createVideoLibraryProject() {
  const entry = videoLibraryDetail.value;
  if (!entry?.id) return;
  if (videoLibraryCreateForm.replaceProduct && !videoLibraryCreateForm.productModel) return ElMessage.warning("请选择替换后的产品型号");
  if (videoLibraryCreateForm.targetLanguage === "OTHER" && !videoLibraryCreateForm.customLanguage.trim()) return ElMessage.warning("请填写内容语言");
  if (!videoLibraryCreateForm.taskRequirement.trim()) return ElMessage.warning("请确认最终 AI 任务要求");
  videoLibraryCreating.value = true;
  try {
    await post(`/api/v1/workbench/video-library/${entry.id}/create-project`, { ...videoLibraryCreateForm });
    videoLibraryCreateVisible.value = false;
    videoLibraryDetailVisible.value = false;
    active.value = "tasks";
    await loadTasks();
    ElMessage.success("已创建新项目，已加入任务中心");
  } finally {
    videoLibraryCreating.value = false;
  }
}

async function openOutputLibrary(category: string) {
  active.value = "outputs";
  await switchOutputCategory(category);
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
    const parameters = new URLSearchParams({
      scope: taskScope.value,
      paginated: "1",
      page: String(taskPage.value),
      pageSize: String(taskPageSize),
    });
    if (taskStatus.value) parameters.set("status", taskStatus.value);
    if (taskType.value) parameters.set("taskType", taskType.value);
    if (taskScope.value === "MINE" && !taskStatus.value && !taskType.value) parameters.set("defaultWorkQueue", "1");
    const response = await api<Row[] | { items: Row[]; total: number; page: number; pageSize: number }>(`/api/v1/workbench/tasks?${parameters.toString()}`);
    if (Array.isArray(response)) {
      tasks.value = response;
      taskTotal.value = response.length;
    } else {
      tasks.value = response.items || [];
      taskTotal.value = Number(response.total) || 0;
      taskPage.value = Number(response.page) || 1;
    }
    selectedTaskIds.value = selectedTaskIds.value.filter((id) => tasks.value.some((task) => task.id === id && task.sourceType === "SELF_CREATED" && task.status === "CANCELLED"));
  } finally {
    loading.value = false;
  }
}

async function resetTaskPage() {
  taskPage.value = 1;
  selectedTaskIds.value = [];
  await loadTasks();
}

async function changeTaskPage(page: number) {
  taskPage.value = page;
  await loadTasks();
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
  const projectId = task.sourceId || task.evidence?.contentPlanId;
  if (!projectId) return ElMessage.warning("该任务未关联视频项目");
  if (expandedTaskVideoProjectId.value === projectId) {
    expandedTaskVideoProjectId.value = "";
    taskVideoProjectDetail.value = undefined;
    return;
  }
  taskVideoProjectLoading.value = true;
  try {
    taskVideoProjectDetail.value = await api<Row>(`/api/v1/workbench/data-center/video-projects/${projectId}`);
    expandedTaskVideoProjectId.value = projectId;
    if (taskVideoProjectDetail.value?.videoShots?.length
      && !expandedVideoProjectIds.value.includes(projectId)) {
      expandedVideoProjectIds.value.push(projectId);
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "视频项目加载失败");
  } finally {
    taskVideoProjectLoading.value = false;
  }
}

async function refreshTaskVideoProject() {
  const projectId = expandedTaskVideoProjectId.value;
  if (!projectId) return;
  taskVideoProjectDetail.value = await api<Row>(`/api/v1/workbench/data-center/video-projects/${projectId}`);
  ElMessage.success("当前项目已刷新");
}

async function pollCurrentVideoProject() {
  if (currentVideoProjectPolling) return;
  const projectId = expandedTaskVideoProjectId.value || activeVideoProjectId.value;
  if (!projectId) return;
  const currentProject = expandedTaskVideoProjectId.value === projectId
    ? taskVideoProjectDetail.value
    : activeVideoProject.value;
  if (!currentProject || !projectWaitingForScripts(currentProject)) return;
  currentVideoProjectPolling = true;
  try {
    const refreshed = await api<Row>(`/api/v1/workbench/data-center/video-projects/${projectId}`);
    applyRefreshedVideoProject(refreshed);
  } catch {
    // 后台生成期间的短暂网络错误留给下一轮当前项目轮询，不刷新全部项目。
  } finally {
    currentVideoProjectPolling = false;
  }
}

async function quickCreateProject(command: string) {
  if (command === "VIDEO") {
    await openNewVideoProjectDialog();
    return;
  }
  if (command === "IMAGE") {
    await openNewImageProjectDialog();
    return;
  }
  ElMessage.info("软文项目稍后完善");
}

function imageDefaultsForType(type: string) {
  const defaults: Record<string, { audience: string; hook: string }> = {
    "送礼类": { audience: "给爸妈挑健康手表的人", hook: "给爸妈买前先看" },
    "种草类": { audience: "正在挑选智能手表的人", hook: "真实体验怎么样" },
    "避坑类": { audience: "第一次买健康手表的人", hook: "买前先避开这几个坑" },
    "科普类": { audience: "对功能还不了解的人", hook: "很多人都忽略了这一点" },
    "实拍类": { audience: "想看真实使用过程的人", hook: "真实操作给你看" },
    "测评类": { audience: "正在比较同类产品的人", hook: "实测后再说值不值得" },
    "教程类": { audience: "刚拿到产品的用户", hook: "这几个功能这样用更方便" },
    "对比类": { audience: "正在横向比较产品的人", hook: "高血压人群买前先看" },
  };
  return defaults[type] || defaults["送礼类"];
}

function imageSuggestionsForType(type: string) {
  const defaults = imageDefaultsForType(type);
  const suggestions: Record<string, { audiences: string[]; hooks: string[] }> = {
    "送礼类": { audiences: ["给爸妈挑健康手表的人", "想送父母实用礼物的人", "给长辈准备节日礼物的人"], hooks: ["给爸妈买前先看", "送父母礼物别只看外观", "真正实用的健康礼物怎么选"] },
    "种草类": { audiences: ["正在挑选智能手表的人", "重视日常健康管理的人", "想换一块更实用手表的人"], hooks: ["真实体验怎么样", "这类手表到底值不值得买", "用了以后才知道的方便"] },
    "避坑类": { audiences: ["第一次买健康手表的人", "给父母买手表的人", "担心买错功能的人"], hooks: ["买前先避开这几个坑", "别只看参数，这点更重要", "给父母买表最容易忽略什么"] },
    "科普类": { audiences: ["对功能还不了解的人", "刚开始关注健康手表的人", "想看懂日常使用场景的人"], hooks: ["很多人都忽略了这一点", "这个功能其实这样用", "别把它只当普通手表"] },
    "实拍类": { audiences: ["想看真实使用过程的人", "准备购买前看操作的人", "关注产品实际效果的人"], hooks: ["真实操作给你看", "不讲参数直接实拍", "从佩戴到使用完整拍一遍"] },
    "测评类": { audiences: ["正在比较同类产品的人", "想看真实使用感受的人", "准备下单前做功课的人"], hooks: ["实测后再说值不值得", "连续使用后真实感受", "这几个细节很关键"] },
    "教程类": { audiences: ["刚拿到产品的用户", "需要帮父母设置手表的人", "想快速上手功能的人"], hooks: ["这几个功能这样用更方便", "新手先学会这一步", "三分钟看懂日常操作"] },
    "对比类": { audiences: ["正在横向比较产品的人", "高血压人群购前对比的人", "想看核心功能差异的人"], hooks: ["高血压人群买前先看", "横向对比后差别在哪", "别只比价格，先比这些"] },
  };
  return suggestions[type] || { audiences: [defaults.audience], hooks: [defaults.hook] };
}

function imageViralTopicsForType(type: string) {
  const suggestions = imageSuggestionsForType(type);
  return suggestions.hooks.map((hook, index) => ({
    hook,
    audience: suggestions.audiences[index % suggestions.audiences.length] || imageDefaultsForType(type).audience,
  }));
}

function applyImageViralTopic(topic: { hook: string; audience: string }) {
  imageProjectForm.hook = topic.hook;
  imageProjectForm.audience = topic.audience;
  // Selecting a recommended topic is an explicit choice. It should refresh
  // the generated task requirement even if the employee had looked at it
  // before, otherwise the worker receives the old topic by mistake.
  imageRequirementEdited.value = false;
  syncImageProjectRequirement();
}

function buildImageProjectRequirement() {
  const form = imageProjectForm;
  const clauses = [
    `用图文制作 skill，做一组赛电${form.productModel}${form.imageType}图文`,
    form.audience.trim() ? `面向${form.audience.trim()}` : "",
    form.hook.trim() ? `主钩子是“${form.hook.trim()}”` : "",
    form.competitor.trim() ? `对比对象为${form.competitor.trim()}` : "",
    form.creativeIntent.trim() ? form.creativeIntent.trim() : "",
    form.additionalPrompt.trim() ? form.additionalPrompt.trim() : "",
    "可以放注册证，但不要露内部型号。",
  ].filter(Boolean);
  return clauses.join("，");
}

function syncImageProjectRequirement() {
  if (!imageRequirementEdited.value) imageProjectForm.requirement = buildImageProjectRequirement();
}

function markImageRequirementEdited() {
  // Only the editable task-requirement box opts the employee into preserving
  // their custom wording. Other form fields keep regenerating the preview.
  imageRequirementEdited.value = true;
}

function buildReferenceDirectTaskRequirement() {
  const model = videoFactoryForm.productModel.trim() || "所选产品";
  const referenceUrl = videoFactoryForm.referenceVideoUrl.trim() || "待填写的参考视频链接";
  const audioInstruction = videoFactoryForm.referenceAudioStrategy === "DOUBAO_REVOICE"
    ? "重配口播：仅使用已配置的豆包语音，绝不使用 Windows 或系统默认配音；保留参考视频可用的 BGM、环境声和音效节拍。"
    : "保留参考原声：沿用参考视频完整可用音轨，不做配音。";
  return `参考视频：${referenceUrl}。参考其镜头结构、画面节奏和氛围，使用${model}的真实素材重建画面，不得混用其他产品素材。${audioInstruction}只回传最终成片供员工审核。`;
}

function syncReferenceDirectTaskRequirement() {
  const next = buildReferenceDirectTaskRequirement();
  if (!referenceDirectRequirementEdited.value || videoFactoryForm.referenceDirectTaskRequirement === lastAutoReferenceDirectRequirement.value) {
    videoFactoryForm.referenceDirectTaskRequirement = next;
    referenceDirectRequirementEdited.value = false;
  }
  lastAutoReferenceDirectRequirement.value = next;
}

function markReferenceDirectRequirementEdited() {
  referenceDirectRequirementEdited.value = videoFactoryForm.referenceDirectTaskRequirement !== lastAutoReferenceDirectRequirement.value;
}

function changeImageProjectType() {
  const defaults = imageDefaultsForType(imageProjectForm.imageType);
  imageProjectForm.audience = defaults.audience;
  imageProjectForm.hook = defaults.hook;
  syncImageProjectRequirement();
}

async function openNewImageProjectDialog() {
  imageProjectMode.value = "SINGLE";
  imageProjectForm.batchProducts = [{ model: "", count: 2 }];
  imageProjectForm.batchTypes = [{ type: "种草类", count: 2 }];
  imageProjectForm.batchTaskRequirement = "";
  imageBatchRequirementEdited.value = false;
  lastAutoImageBatchRequirement.value = "";
  syncBatchImageTaskRequirement();
  try {
    // This entry can be opened directly from the employee task page, before
    // the data-center cache has loaded. Fetch the current product catalogue
    // first so the mandatory product selector never opens as “No data”.
    await ensureContentTaskOptions();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "产品型号加载失败，请稍后重试");
  }
  const defaults = imageDefaultsForType("送礼类");
  Object.assign(imageProjectForm, {
    productModel: productOptions.value[0]?.modelCode || "",
    imageType: "送礼类",
    audience: defaults.audience,
    hook: defaults.hook,
    competitor: "",
    creativeIntent: "",
    additionalPrompt: "",
    requirement: "",
  });
  imageRequirementEdited.value = false;
  syncImageProjectRequirement();
  newImageProjectVisible.value = true;
}

async function createImageProject() {
  if (imageProjectMode.value === "BATCH") {
    const valid = imageProjectForm.batchProducts.filter((product) => product.model && Number(product.count) > 0);
    if (!valid.length) return ElMessage.warning("请至少选择一个产品型号");
    if (valid.length > 5) return ElMessage.warning("批量图文产品最多 5 个");
    const total = batchImageTotalGroups();
    if (total > 10) return ElMessage.warning("批量图文总数量最多 10 组");
    if (batchImageTypeTotal() !== total) return ElMessage.warning("类型组数合计必须等于图文总量");
    if (!imageProjectForm.batchTaskRequirement.trim()) return ElMessage.warning("请填写提交给图文 Skill 的任务要求");
    creatingImageProject.value = true;
    try {
      const requirement = imageProjectForm.batchTaskRequirement.trim();
      const result = await post<Row>("/api/v1/workbench/image-projects", {
        mode: "BATCH_IMAGE_POST_PROJECT",
        batchProducts: imageProjectForm.batchProducts.filter((product) => product.model && Number(product.count) > 0),
        batchTypes: imageProjectForm.batchTypes.filter((row) => row.type && Number(row.count) > 0),
        batchTaskRequirement: requirement,
        additionalPrompt: imageProjectForm.additionalPrompt,
      });
      newImageProjectVisible.value = false;
      await loadTasks();
      const project = result.project || result;
      activeImageProjectId.value = project.id;
      taskImageProjectDetail.value = project;
      imageProjectVisible.value = false;
      ElMessage.success("批量图文项目已创建，正在生成图文和文案");
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "批量图文项目创建失败");
    } finally {
      creatingImageProject.value = false;
    }
    return;
  }
  if (!imageProjectForm.productModel || !imageProjectForm.imageType || !imageProjectForm.audience.trim() || !imageProjectForm.hook.trim()) {
    return ElMessage.warning("请填写产品型号、图文类型、目标人群/场景和主钩子方向");
  }
  creatingImageProject.value = true;
  try {
    // Submit exactly the requirement the employee sees. This also makes a
    // selected viral topic, product, audience, hook or optional input reach
    // the image-production Skill instead of leaving an earlier draft behind.
    const requirement = imageRequirementEdited.value
      ? imageProjectForm.requirement.trim()
      : buildImageProjectRequirement();
    imageProjectForm.requirement = requirement;
    const result = await post<Row>("/api/v1/workbench/image-projects", {
      ...imageProjectForm,
      requirement,
    });
    newImageProjectVisible.value = false;
    await loadTasks();
    const project = result.project || result;
    activeImageProjectId.value = project.id;
    taskImageProjectDetail.value = project;
    imageProjectVisible.value = false;
    ElMessage.success("图文项目已创建，正在生成图文和文案");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "图文项目创建失败");
  } finally {
    creatingImageProject.value = false;
  }
}

async function openImageProjectFromTask(task: Row) {
  const projectId = task.sourceId || task.evidence?.contentPlanId;
  if (!projectId) return ElMessage.warning("该任务未关联图文项目");
  if (imageProjectVisible.value && activeImageProjectId.value === projectId) {
    imageProjectVisible.value = false;
    return;
  }
  taskImageProjectLoading.value = true;
  try {
    taskImageProjectDetail.value = await api<Row>(`/api/v1/workbench/image-projects/${projectId}`);
    activeImageProjectId.value = projectId;
    imageProjectVisible.value = true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "图文项目加载失败");
  } finally {
    taskImageProjectLoading.value = false;
  }
}

async function deleteImageProject(task: Row) {
  const projectId = task.sourceId || task.evidence?.contentPlanId;
  if (!projectId) return ElMessage.warning("该任务未关联图文项目");
  try {
    await ElMessageBox.confirm(
      `确认删除“${imageProjectCardTitle(task)}”？系统会同步取消尚未完成的关联 AI 任务，并从员工任务列表移除该项目。`,
      "删除图文项目",
      { confirmButtonText: "确认删除", cancelButtonText: "取消", type: "warning" },
    );
  } catch {
    return;
  }
  deletingImageProjectId.value = projectId;
  try {
    await api(`/api/v1/workbench/image-projects/${projectId}`, { method: "DELETE" });
    if (activeImageProjectId.value === projectId) {
      activeImageProjectId.value = "";
      taskImageProjectDetail.value = {};
      imageProjectVisible.value = false;
    }
    await loadTasks();
    ElMessage.success("图文项目和员工任务已删除，关联 AI 任务已同步取消");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "删除图文项目失败");
  } finally {
    deletingImageProjectId.value = "";
  }
}

async function refreshImageProject() {
  if (!activeImageProjectId.value) return;
  taskImageProjectLoading.value = true;
  try {
    taskImageProjectDetail.value = await api<Row>(`/api/v1/workbench/image-projects/${activeImageProjectId.value}`);
    ElMessage.success("当前项目已刷新");
  } finally {
    taskImageProjectLoading.value = false;
  }
}

async function retryImageProject() {
  if (!activeImageProjectId.value) return;
  taskImageProjectLoading.value = true;
  try {
    taskImageProjectDetail.value = await post<Row>(`/api/v1/workbench/image-projects/${activeImageProjectId.value}/retry`, {});
    ElMessage.success("已重新提交图文生成任务");
    await loadTasks();
  } finally {
    taskImageProjectLoading.value = false;
  }
}

async function reviewImageProject(approve: boolean) {
  if (!activeImageProjectId.value || reviewingImageProject.value) return;
  let note = "";
  if (!approve) {
    try {
      const answer = await ElMessageBox.prompt("请说明需要修改的内容", "退回图文", { inputType: "textarea", inputValidator: (value) => value?.trim() ? true : "请填写退回原因" });
      note = answer.value.trim();
    } catch { return; }
  }
  reviewingImageProject.value = true;
  try {
    await post<Row>(`/api/v1/workbench/image-projects/${activeImageProjectId.value}/review`, {
      action: approve ? "APPROVE" : "RETURN",
      note,
    });
    ElMessage.success(approve ? "图文审核通过" : "图文已退回，正在按修改要求重新生成");
    await refreshImageProject();
  } finally {
    reviewingImageProject.value = false;
  }
}

function addImagePublishRecord() {
  imagePublishRecords.value.push({ platform: "DOUYIN", remoteUrl: "" });
}

async function saveImagePublishLinks() {
  if (!activeImageProjectId.value) return;
  const records = imagePublishRecords.value.filter((item) => item.remoteUrl.trim());
  if (!records.length) return ElMessage.warning("请至少填写一个发布链接");
  await post<Row>(`/api/v1/workbench/image-projects/${activeImageProjectId.value}/publish-links`, { records });
  await refreshImageProject();
}

function editableCandidateLines(candidate: Row) {
  if (Array.isArray(candidate.shots) && candidate.shots.length) return candidate.shots;
  return candidateVoiceover(candidate).split("\n").map((line: string, index: number) => ({
    lineId: `line_${String(index + 1).padStart(2, "0")}`,
    voiceover: line,
    description: line,
    selectedAssetIds: [],
  }));
}

function updateCandidateLine(candidate: Row, lineIndex: number, value: string) {
  const lines = editableCandidateLines(candidate);
  const line = lines[lineIndex];
  if (!line) return;
  line.__editedVoiceover = value;
  const original = String(line.voiceover || line.description || "");
  line.__dirty = value.trim() !== original.trim();
  candidate.__dirtyLineIds = lines
    .filter((item: Row) => item.__dirty)
    .map((item: Row) => String(item.lineId));
}

async function saveInlineProjectScript(project: Row, candidate: Row, candidateIndex = 0) {
  const title = String(candidate.__editedTitle ?? candidate.titleZh ?? candidate.title ?? candidate.topic ?? project.topic ?? "").trim();
  const hook = String(candidate.__editedHook ?? candidate.hook ?? candidate.scriptPackage?.goldenHook?.copy ?? "").trim();
  const editableLines = editableCandidateLines(candidate);
  const voiceoverLines = editableLines
    .map((line: Row) => String(line.__editedVoiceover ?? line.voiceover ?? line.description ?? "").trim())
    .filter(Boolean);
  const script = String(candidate.__editedScript ?? voiceoverLines.join("\n") ?? candidateVoiceover(candidate)).trim();
  if (!hook || !script) return ElMessage.warning("钩子和完整脚本不能为空");
  const key = `${project.id}:${candidateIndex}`;
  savingInlineScriptKey.value = key;
  try {
    await post(`/api/v1/workbench/data-center/video-projects/${project.id}/script`, {
      candidateIndex,
      title,
      hook,
      script,
      voiceoverLines,
      changedLineIds: Array.isArray(candidate.__dirtyLineIds) ? candidate.__dirtyLineIds : [],
    });
    candidate.__dirtyLineIds = [];
    editableLines.forEach((line: Row) => {
      if (line.__editedVoiceover !== undefined) line.voiceover = line.__editedVoiceover;
      line.__dirty = false;
    });
    ElMessage.success("修改已保存；仅重新匹配语义发生变化的句子");
    await invalidateDataCenterSection("videoFactory");
    if (expandedTaskVideoProjectId.value === project.id) await refreshTaskVideoProject();
    else await loadDataCenter(true);
  } finally {
    savingInlineScriptKey.value = "";
  }
}

async function regenerateSystemScript(project: Row) {
  const result = await ElMessageBox.prompt(
    "可以填写希望系统 AI 调整的方向；不填写则按原项目要求重新生成。",
    "系统 AI 重新生成脚本",
    {
      confirmButtonText: "重新生成",
      cancelButtonText: "取消",
      inputType: "textarea",
      inputPlaceholder: "例如：钩子更生活化；增加真实操作过程；不要在开头讲完全部重点。",
    },
  ).catch(() => null);
  if (!result) return;
  regeneratingSystemScriptProjectId.value = project.id;
  try {
    const refreshed = await post<Row>(`/api/v1/workbench/data-center/video-projects/${project.id}/system-script-regenerate`, {
      prompt: result.value.trim(),
    });
    applyRefreshedVideoProject(refreshed);
    ElMessage.success("已提交重新生成；当前项目正在生成新版脚本与素材匹配");
  } finally {
    regeneratingSystemScriptProjectId.value = "";
  }
}

async function openSystemScriptConversation(project: Row) {
  systemScriptConversationProject.value = project;
  systemScriptConversationVisible.value = true;
  try {
    const refreshed = await api<Row>(`/api/v1/workbench/data-center/video-projects/${project.id}`);
    applyRefreshedVideoProject(refreshed);
  } catch {
    // Keep the information already shown on the card if a one-project refresh fails.
  }
}

function projectMode(project: Row) {
  const factory = Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  return String(factory?.projectMode || "");
}

function projectReferenceVideoUrl(project?: Row) {
  const factory = project && Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  return String(factory?.brief?.referenceVideoUrl || factory?.brief?.reference || factory?.referenceVideoUrl || "").trim();
}

function openProjectReferenceVideo(project: Row) {
  const libraryEntryId = videoLibraryEntryId(project);
  if (libraryEntryId) {
    void openVideoLibraryEntry({ id: libraryEntryId });
    return;
  }
  const referenceUrl = projectReferenceVideoUrl(project);
  if (!referenceUrl) return ElMessage.warning("当前项目没有可查看的参考视频链接");
  try {
    const parsed = new URL(referenceUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("unsupported protocol");
    window.open(parsed.toString(), "_blank", "noopener,noreferrer");
  } catch {
    ElMessage.warning("参考视频链接无效，请在项目信息中核对");
  }
}

function isCodexDirectVideoProject(project: Row) {
  return projectMode(project) === "CODEX_DIRECT_FULL_VIDEO";
}

function isCodexOnlyVideoProject(project: Row) {
  return ["CODEX_DIRECT_FULL_VIDEO", "REFERENCE_DIRECT_FULL_VIDEO"].includes(projectMode(project));
}

function codexDirectRevision(project?: Row) {
  const signal = project && Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  return signal?.directVideoRevision && typeof signal.directVideoRevision === "object"
    ? signal.directVideoRevision as Row
    : undefined;
}

function codexDirectTaskTitle(project?: Row) {
  return codexDirectRevision(project)
    ? "Codex 正在按退回说明修改成片"
    : "Codex 直出成片中";
}

function codexDirectHasReviewableMaster(project?: Row) {
  if (!isCodexDirectVideoProject(project || {})) return false;
  return Array.isArray(project?.videoRenderJobs)
    && project!.videoRenderJobs.some((job: Row) => (
      job?.status === "SUCCEEDED"
      && Boolean(job?.outputAsset)
      && ["PENDING", "APPROVED"].includes(String(job.outputAsset?.reviewStatus || "PENDING"))
    ));
}

function reviewableVideoRenderJobs(project?: Row) {
  const jobs = Array.isArray(project?.videoRenderJobs) ? project!.videoRenderJobs : [];
  if (!isCodexDirectVideoProject(project || {})) return jobs;
  // A returned master is only the source for Codex's revision.  It must not
  // remain in the active review area or suppress the revision progress panel.
  return jobs.filter((job: Row) => job?.outputAsset?.reviewStatus !== "RETURNED");
}

function codexDirectTaskIsRunning(project?: Row) {
  const task = activeCodexDirectVideoTask(project);
  if (!task) return false;
  const status = String(task.status || "");
  return ["PENDING", "CLAIMED", "RUNNING", "UPLOADING", "QUALITY_CHECK", "RETRY"].includes(status);
}

function codexDirectShouldShowProgress(project?: Row) {
  const status = codexDirectTaskStatus(project);
  return codexDirectTaskIsRunning(project)
    || status === "FAILED"
    || !codexDirectHasReviewableMaster(project);
}

function systemScriptConversation(project?: Row) {
  const signal = project && Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  return Array.isArray(signal?.systemScriptConversation) ? signal.systemScriptConversation : [];
}

function activeRemoteScriptTask(project?: Row) {
  const signal = project && Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  const taskId = String(signal?.aiTaskId || "");
  if (!taskId) return undefined;
  return (Array.isArray(project?.activeAiTasks) ? project?.activeAiTasks : [])
    .find((task: Row) => String(task.id) === taskId);
}

function activeCodexDirectVideoTask(project?: Row) {
  if (!isCodexOnlyVideoProject(project || {})) return undefined;
  const signal = project && Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  const taskId = String(signal?.videoAiTaskId || "");
  if (!taskId) return undefined;
  return (Array.isArray(project?.activeAiTasks) ? project?.activeAiTasks : [])
    .find((task: Row) => String(task.id) === taskId);
}

function activeProjectVideoTask(project?: Row) {
  const signal = project && Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  const taskId = String(signal?.videoAiTaskId || "");
  if (!taskId) return undefined;
  return (Array.isArray(project?.activeAiTasks) ? project?.activeAiTasks : [])
    .find((task: Row) => String(task.id) === taskId);
}

function projectVideoTaskProgress(project?: Row) {
  return Math.max(0, Math.min(100, Number(activeProjectVideoTask(project)?.progress || 0)));
}

function projectVideoTaskStatus(project?: Row) {
  return String(activeProjectVideoTask(project)?.status || "");
}

function projectVideoTaskMessage(project?: Row) {
  return String(activeProjectVideoTask(project)?.progressMessage || "远程节点正在按已确认脚本和素材生成视频。");
}

function activeCoverTitleTask(project?: Row) {
  const signal = project && Array.isArray(project.sourceSignals)
    ? project.sourceSignals.find((item: Row) => item.type === "VIDEO_FACTORY")
    : undefined;
  const taskId = String(signal?.coverAiTaskId || "");
  if (!taskId) return undefined;
  return (Array.isArray(project?.activeAiTasks) ? project?.activeAiTasks : [])
    .find((task: Row) => String(task.id) === taskId);
}

function coverTitleTaskStatus(project?: Row) {
  return String(activeCoverTitleTask(project)?.status || "");
}

function coverTitleTaskIsRunning(project?: Row) {
  return ["PENDING", "CLAIMED", "RUNNING", "QUALITY_CHECK", "UPLOADING", "RETRY"].includes(coverTitleTaskStatus(project));
}

function coverTitleTaskNeedsAttention(project?: Row) {
  return ["FAILED", "WAITING_INPUT", "CANCELLED"].includes(coverTitleTaskStatus(project));
}

function coverTitleTaskProgress(project?: Row) {
  return Math.max(0, Math.min(100, Number(activeCoverTitleTask(project)?.progress || 0)));
}

function coverTitleTaskMessage(project?: Row) {
  const task = activeCoverTitleTask(project);
  if (!task) return "尚未提交封面和标题生成任务";
  return String(task.progressMessage || task.failureReason || (
    coverTitleTaskIsRunning(project) ? "等待封面和标题任务处理" : "等待封面和标题结果回传"
  ));
}

function packagingVariants(project?: Row) {
  return (Array.isArray(project?.variants) ? project!.variants : [])
    .filter((variant: Row) => Boolean(variant.coverPath || variant.packagingStatus === "PENDING_REVIEW" || variant.packagingStatus === "APPROVED" || variant.packagingStatus === "RETURNED"));
}

function packagingStatusText(variant: Row) {
  if (variant.packagingStatus === "APPROVED") return "封面标题已通过";
  if (variant.packagingStatus === "RETURNED") return "封面标题已退回";
  return "封面标题待审核";
}

function packagingCoverText(variant: Row) {
  const spec = variant.coverSpec && typeof variant.coverSpec === "object" ? variant.coverSpec as Row : {};
  return String(spec.coverText || spec.cover_text || "").trim();
}

function packagingHashtags(variant: Row) {
  const spec = variant.coverSpec && typeof variant.coverSpec === "object" ? variant.coverSpec as Row : {};
  return Array.isArray(spec.hashtags)
    ? spec.hashtags.map((tag) => String(tag || "").trim().replace(/^#/, "")).filter(Boolean).slice(0, 5)
    : [];
}

function packagingCoverUrl(project: Row, variant: Row) {
  const key = String(variant.id || "");
  if (!key || !project?.id || failedPackagingCoverIds.has(key)) return "";
  if (!packagingCoverUrls[key] && !loadingPackagingCoverIds.has(key)) {
    loadingPackagingCoverIds.add(key);
    api<{ url: string }>(`/api/v1/workbench/data-center/video-projects/${project.id}/packaging/${variant.id}/cover-url`)
      .then((result) => {
        if (result.url) packagingCoverUrls[key] = result.url;
      })
      .catch(() => {
        // The textual cover placeholder remains available if the image is not ready.
      })
      .finally(() => loadingPackagingCoverIds.delete(key));
  }
  return packagingCoverUrls[key] || "";
}

function discardPackagingCoverUrl(variant: Row) {
  const key = String(variant.id || "");
  failedPackagingCoverIds.add(key);
  delete packagingCoverUrls[key];
}

function activeProjectGenerationTask(project?: Row) {
  return activeCodexDirectVideoTask(project) || activeRemoteScriptTask(project);
}

function codexDirectTaskStatus(project?: Row) {
  return String(activeCodexDirectVideoTask(project)?.status || "PENDING");
}

function codexDirectTaskProgress(project?: Row) {
  return Math.max(0, Math.min(100, Number(activeCodexDirectVideoTask(project)?.progress || 0)));
}

function codexDirectTaskMessage(project?: Row) {
  const task = activeCodexDirectVideoTask(project);
  const revision = codexDirectRevision(project);
  return String(task?.failureReason || task?.progressMessage || (revision
    ? "等待远程 Codex 领取按退回说明修改成片任务"
    : "等待远程 Codex 领取直出成片任务"));
}

function taskQualityWarnings(task?: Row) {
  const warnings = task?.projection?.aiTask?.output?.qualityWarnings;
  return Array.isArray(warnings)
    ? warnings.filter((warning): warning is Row => Boolean(warning && typeof warning === "object"))
    : [];
}

function scriptGenerationMessages(project?: Row) {
  const task = activeProjectGenerationTask(project);
  if (!task) return systemScriptConversation(project);
  const progress = Math.max(0, Math.min(100, Number(task.progress || 0)));
  const status = String(task.status || "PENDING");
  const progressText = String(task.progressMessage || task.failureReason || "等待远程 Codex 领取任务");
  const direct = isCodexOnlyVideoProject(project || {});
  return [
    { role: "SYSTEM", provider: "CODEX", status: "SUBMITTED", at: task.createdAt, content: `${direct ? "已提交远程 Codex 直出成片任务" : "已提交远程 Codex 脚本任务"} ${task.taskNo || ""}`.trim() },
    { role: "CODEX", provider: "CODEX", status, at: task.updatedAt || task.startedAt || task.finishedAt, content: `${progressText}${["COMPLETED", "FAILED", "CANCELLED"].includes(status) ? "" : `（${progress}%）`}` },
  ];
}

function scriptGenerationDialogTitle(project?: Row) {
  if (isCodexOnlyVideoProject(project || {})) return projectMode(project || {}) === "REFERENCE_DIRECT_FULL_VIDEO" ? "Codex 参考直出任务进度" : "Codex 直出成片任务进度";
  return activeRemoteScriptTask(project) ? "Codex 脚本任务进度" : "系统与百炼生成记录";
}

function scriptGenerationDialogHint(project?: Row) {
  if (isCodexOnlyVideoProject(project || {})) {
    return "仅展示直出成片 AI 任务的真实状态、进度和失败原因；不会回传脚本、素材匹配或剪辑过程。点击“只刷新当前项目”只更新本项目。";
  }
  return activeRemoteScriptTask(project)
    ? "这里展示当前远程 Codex AI 任务的真实状态、进度与失败原因；点击“只刷新当前项目”只会更新本项目。"
    : "百炼接口完成后一次性返回结果；生成期间这里只展示真实的任务提交和处理状态。";
}

function scriptGenerationMessageLabel(message: Row, project?: Row) {
  if (activeProjectGenerationTask(project)) return message.role === "SYSTEM" ? "系统 ⇒ Codex" : "Codex ⇒ 系统";
  return message.role === "SYSTEM" ? "系统 ⇒ 百炼" : "百炼 ⇒ 系统";
}

function scriptTaskStatusLabel(status: string) {
  return ({
    PENDING: "等待领取",
    CLAIMED: "已领取",
    RUNNING: "生成中",
    UPLOADING: "上传成果中",
    QUALITY_CHECK: "质量检查中",
    PENDING_REVIEW: "等待审核",
    COMPLETED: "已完成",
    FAILED: "失败",
    CANCELLED: "已取消",
  } as Record<string, string>)[status] || "已提交";
}

async function refreshSystemScriptConversationProject() {
  const projectId = systemScriptConversationProject.value?.id;
  if (!projectId) return;
  const refreshed = await api<Row>(`/api/v1/workbench/data-center/video-projects/${projectId}`);
  applyRefreshedVideoProject(refreshed);
  ElMessage.success("当前项目已刷新");
}

async function transferFailedSystemScriptToCodex(project: Row) {
  const confirmed = await ElMessageBox.confirm(
    "将保留当前项目的全部需求、素材上下文和百炼失败原因，直接交给远程 Codex 生成脚本，不会重复创建项目。",
    "转交 Codex",
    { confirmButtonText: "确认转交", cancelButtonText: "取消", type: "warning" },
  ).catch(() => false);
  if (!confirmed) return;
  transferringFailedScriptProjectId.value = project.id;
  try {
    const refreshed = await post<Row>(`/api/v1/workbench/data-center/video-projects/${project.id}/system-script-transfer-to-codex`, {});
    ElMessage.success("已转交 Codex，原项目需求和素材上下文已保留");
    applyRefreshedVideoProject(refreshed);
  } finally {
    transferringFailedScriptProjectId.value = "";
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
    fullScript: candidateVoiceover(candidate),
    ...candidate.scriptPackage,
  };
  await copyTaskContent(JSON.stringify(payload, null, 2), "完整脚本");
}

function candidateVoiceover(candidate: Row) {
  const packageLines = (candidate.scriptPackage?.voiceoverLines || [])
    .map((item: Row) => String(item.text || "").trim())
    .filter(Boolean);
  if (packageLines.length) return packageLines.join("\n");
  const shotLines = (candidate.shots || [])
    .map((item: Row) => String(item.voiceover || "").trim())
    .filter(Boolean);
  const source = packageLines.length
    ? packageLines.join("\n")
    : shotLines.length
      ? shotLines.join("\n")
      : String(candidate.script || candidate.scripts?.zh30 || candidate.scripts?.zh15 || "");
  return source
    .replace(/\[(?:C\d+-)?L\d+\]\s*/gi, "")
    .replace(/健康监测数据仅供日常健康管理参考[。.]?/g, "")
    .trim();
}

function candidateCoverageSummary(candidate: Row) {
  const requirements = candidate.scriptPackage?.shotRequirements || [];
  const covered = requirements.filter((item: Row) => item.assetStatus === "COVERED").length;
  const missing = requirements.filter((item: Row) => ["NEED_SHOOT", "REWRITABLE"].includes(item.assetStatus)).length;
  return requirements.length ? `已有素材 ${covered} 句 · 待匹配或补拍 ${missing} 句` : "素材覆盖将在脚本下方自动整理";
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
  await Promise.all([loadTaskRecycleBin(), loadVideoRecycleBin()]);
}

function recycleDeletedAt(item: Row) {
  return new Date(item.deletedAt || item.archivedAt || 0).getTime();
}

function newestRecycleItems(items: Row[]) {
  return [...items].sort((a, b) => recycleDeletedAt(b) - recycleDeletedAt(a));
}

function recyclePageItems(items: Row[], page: number) {
  const start = (page - 1) * recyclePageSize;
  return items.slice(start, start + recyclePageSize);
}

const recycledNormalTasks = computed(() => newestRecycleItems(taskRecycleItems.value.filter((item) => !["VIDEO_PROJECT", "IMAGE_PROJECT"].includes(String(item.sourceType || "")) && item.category !== "ARTICLE_PROJECT")));
const recycledImageProjects = computed(() => newestRecycleItems(taskRecycleItems.value.filter((item) => item.sourceType === "IMAGE_PROJECT" || item.category === "IMAGE_PROJECT")));
const recycledArticleProjects = computed(() => newestRecycleItems(taskRecycleItems.value.filter((item) => item.sourceType === "ARTICLE_PROJECT" || item.category === "ARTICLE_PROJECT")));
const recycledVideoProjects = computed(() => newestRecycleItems(videoRecycleProjects.value));
const pagedRecycledNormalTasks = computed(() => recyclePageItems(recycledNormalTasks.value, recyclePages.TASK));
const pagedRecycledVideoProjects = computed(() => recyclePageItems(recycledVideoProjects.value, recyclePages.VIDEO));
const pagedRecycledImageProjects = computed(() => recyclePageItems(recycledImageProjects.value, recyclePages.IMAGE));
const pagedRecycledArticleProjects = computed(() => recyclePageItems(recycledArticleProjects.value, recyclePages.ARTICLE));

watch(
  [() => recycledNormalTasks.value.length, () => recycledVideoProjects.value.length, () => recycledImageProjects.value.length, () => recycledArticleProjects.value.length],
  ([taskCount, videoCount, imageCount, articleCount]) => {
    recyclePages.TASK = Math.min(recyclePages.TASK, Math.max(1, Math.ceil(taskCount / recyclePageSize)));
    recyclePages.VIDEO = Math.min(recyclePages.VIDEO, Math.max(1, Math.ceil(videoCount / recyclePageSize)));
    recyclePages.IMAGE = Math.min(recyclePages.IMAGE, Math.max(1, Math.ceil(imageCount / recyclePageSize)));
    recyclePages.ARTICLE = Math.min(recyclePages.ARTICLE, Math.max(1, Math.ceil(articleCount / recyclePageSize)));
  },
);

function recycleTaskTypeLabel(task: Row) {
  if (task.sourceType === "IMAGE_PROJECT" || task.category === "IMAGE_PROJECT") return "图文项目";
  if (task.sourceType === "ARTICLE_PROJECT" || task.category === "ARTICLE_PROJECT") return "软文项目";
  return task.sourceType === "OPERATOR_COLLAB" ? "协作任务" : "普通任务";
}

function recycleProjectStageLabel(stage: unknown, kind: "VIDEO" | "IMAGE") {
  const value = String(stage || "");
  if (kind === "IMAGE") {
    if (["IMAGE_DRAFT"].includes(value)) return "项目创建";
    if (["IMAGE_GENERATING", "IMAGE_RETURNED", "IMAGE_REVIEW"].includes(value)) return "图文与文案生成、审核";
    if (["IMAGE_PUBLISHING", "IMAGE_PUBLISHED"].includes(value)) return "发布与回传";
    return "项目创建";
  }
  if (["PROJECT_BRIEF"].includes(value)) return "项目创建";
  if (["SCRIPT_GENERATING", "SCRIPT_RETURNED", "FACTORY_SCRIPT_READY", "SCRIPT_APPROVED", "FACTORY_GENERATING", "MATERIAL_REVIEW", "MATERIAL_RETURNED"].includes(value)) return "脚本与素材准备";
  if (["READY_TO_EDIT", "EDITING", "VIDEO_REVIEW"].includes(value)) return "视频生成与成片审核";
  if (["PLATFORM_PACKAGING", "PACKAGING_REVIEW", "READY_TO_PUBLISH", "PUBLISHING", "TRACKING"].includes(value)) return "封面标题与发布";
  return "项目创建";
}

async function restoreRecycledImageProject(task: Row) {
  const projectId = task.sourceId || task.evidence?.contentPlanId;
  if (!projectId) return ElMessage.warning("该回收记录未关联图文项目");
  restoringTaskId.value = task.id;
  try {
    await post(`/api/v1/workbench/image-projects/${projectId}/restore`);
    ElMessage.success("图文项目已恢复");
    await Promise.all([loadTaskRecycleBin(), loadTasks()]);
  } finally {
    restoringTaskId.value = "";
  }
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
  videoProjectMode.value = "STANDARD";
  videoFactoryForm.referenceVideoUrl = "";
  videoFactoryForm.referenceDirectTaskRequirement = "";
  videoFactoryForm.referenceAudioStrategy = "REFERENCE_ORIGINAL";
  referenceDirectRequirementEdited.value = false;
  lastAutoReferenceDirectRequirement.value = "";
  syncReferenceDirectTaskRequirement();
  videoFactoryForm.batchProducts = [{ model: "", count: 2 }];
  videoFactoryForm.batchVoiceoverSplit = "HALF";
  videoFactoryForm.batchBgmVariety = true;
  videoFactoryForm.batchVoiceVariety = true;
  videoFactoryForm.batchGenerateCoverTitle = true;
  videoFactoryForm.batchTaskRequirement = "";
  batchRequirementEdited.value = false;
  lastAutoBatchRequirement.value = "";
  syncBatchTaskRequirement();
  videoFactoryForm.scriptEngines = ["SYSTEM_AI"];
  videoProjectCollapseNames.value = active.value === "tasks" ? ["optional"] : [];
  createdVideoProjectDialogId.value = "";
  newVideoProjectVisible.value = true;
  if (contentTaskOptionsLoaded.value) return;
  videoProjectOptionsLoading.value = true;
  try {
    await ensureContentTaskOptions();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "产品和关键词加载失败，请稍后重试");
  } finally {
    videoProjectOptionsLoading.value = false;
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
  if (!selfTaskForm.title.trim()) return ElMessage.warning("请填写任务标题");
  creatingSelfTask.value = true;
  try {
    const payload = {
      ...selfTaskForm,
      category: "GENERAL",
      contentType: "GENERAL",
      productId: null,
      keywordId: null,
      evidence: {},
    };
    if (editingSelfTaskId.value) {
      await api(`/api/v1/workbench/tasks/${editingSelfTaskId.value}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } else {
      await post("/api/v1/workbench/tasks", payload);
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
  if (videoProjectMode.value === "REFERENCE_DIRECT_FULL_VIDEO") {
    if (!videoFactoryForm.productModel) return ElMessage.warning("请选择产品型号");
    if (!videoFactoryForm.referenceVideoUrl.trim()) return ElMessage.warning("请填写参考视频链接");
    if (!videoFactoryForm.referenceDirectTaskRequirement.trim()) return ElMessage.warning("请填写提交给剪辑 Skill 的任务要求");
  } else if (videoProjectMode.value === "CODEX_DIRECT_FULL_VIDEO") {
    if (!videoFactoryForm.productModel) return ElMessage.warning("请选择产品型号");
    if (!videoFactoryForm.additionalPrompt.trim()) return ElMessage.warning("请填写 AI 提示词");
  } else if (videoProjectMode.value === "BATCH_CODEX_DIRECT_FULL_VIDEO") {
    const valid = videoFactoryForm.batchProducts.filter((product) => product.model && Number(product.count) > 0);
    if (!valid.length) return ElMessage.warning("请至少选择一个产品型号");
    if (valid.length > 5) return ElMessage.warning("批量产品最多 5 个");
    const total = valid.reduce((sum, product) => sum + Math.max(0, Number(product.count || 0)), 0);
    if (total > 10) return ElMessage.warning("批量视频总数最多 10 条");
    if (!videoFactoryForm.batchTaskRequirement.trim()) return ElMessage.warning("请填写提交给 Codex 的任务要求");
  } else {
    if (!videoFactoryForm.productModel) return ElMessage.warning("请选择产品型号");
    if (!videoFactoryForm.videoType.trim()) return ElMessage.warning("请选择或填写视频类型");
    if (!videoFactoryForm.keywords.trim() && !videoFactoryForm.keywordIds.length) return ElMessage.warning("请填写或选择关键词");
  }
  videoFactoryForm.scriptEngines = videoProjectMode.value === "STANDARD" ? ["SYSTEM_AI"] : ["REMOTE_CODEX"];
  creatingVideoProject.value = true;
  try {
    const createdProject = await post<Row>("/api/v1/workbench/data-center/video-projects", {
      ...videoFactoryForm,
      projectMode: videoProjectMode.value,
      batchProducts: videoFactoryForm.batchProducts.filter((product) => product.model && Number(product.count) > 0),
      batchVoiceoverSplit: videoFactoryForm.batchVoiceoverSplit,
      batchBgmVariety: videoFactoryForm.batchBgmVariety,
      batchVoiceVariety: videoFactoryForm.batchVoiceVariety,
      batchGenerateCoverTitle: videoFactoryForm.batchGenerateCoverTitle,
      batchTaskRequirement: videoFactoryForm.batchTaskRequirement,
      generationMode: videoScriptMode.value === "ASSET_ONLY" ? "ASSET_ONLY" : videoScriptMode.value === "ASSET_FIRST" ? "ASSET_FIRST" : "AUTO",
      contentRestrictionMode: videoFactoryForm.healthContentAllowed === null
        ? "AUTO"
        : videoFactoryForm.healthContentAllowed ? "NORMAL" : "HEALTH_RESTRICTED",
    });
    videoProjectPage.value = 1;
    videoProjectStatus.value = "";
    await invalidateDataCenterSection("videoFactory");
    if (active.value === "data" && dataCenterTab.value === "videoFactory") {
      await loadDataCenter(true);
    } else {
      await loadTasks();
    }
    createdVideoProjectDialogId.value = "";
    expandedTaskVideoProjectId.value = createdProject.id;
    taskVideoProjectDetail.value = createdProject;
    newVideoProjectVisible.value = false;
    ElMessage.success("视频项目已创建，已自动进入脚本处理");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "视频项目创建失败，请稍后重试");
  } finally {
    creatingVideoProject.value = false;
  }
}

function checkNewVideoProjectBrief() {
  if (videoProjectMode.value === "REFERENCE_DIRECT_FULL_VIDEO") {
    if (!videoFactoryForm.productModel) return ElMessage.warning("请先选择产品型号");
    if (!videoFactoryForm.referenceVideoUrl.trim()) return ElMessage.warning("请填写参考视频链接");
    return ElMessage.success("参考视频链接可用，可以提交 Codex 全流程任务");
  }
  if (videoProjectMode.value === "CODEX_DIRECT_FULL_VIDEO") {
    if (!videoFactoryForm.productModel) return ElMessage.warning("请先选择产品型号");
    if (!videoFactoryForm.additionalPrompt.trim()) return ElMessage.warning("请填写 AI 提示词");
    return ElMessage.success("项目会直接交给 Codex 完成，系统仅在成片完成后通知你审核");
  }
  if (videoProjectMode.value === "BATCH_CODEX_DIRECT_FULL_VIDEO") {
    const valid = videoFactoryForm.batchProducts.filter((product) => product.model && Number(product.count) > 0);
    if (!valid.length) return ElMessage.warning("请先选择产品型号");
    const total = valid.reduce((sum, product) => sum + Math.max(0, Number(product.count || 0)), 0);
    if (total > 10) return ElMessage.warning("批量视频总数最多 10 条");
    return ElMessage.success("批量任务信息完整，可以创建项目");
  }
  if (!videoFactoryForm.productModel) return ElMessage.warning("请先选择产品型号");
  if (!videoFactoryForm.videoType.trim()) return ElMessage.warning("请选择或填写视频类型");
  if (!videoFactoryForm.keywords.trim() && !videoFactoryForm.keywordIds.length) return ElMessage.warning("请填写或选择关键词");
  ElMessage.success("任务信息完整，可以创建项目");
}

async function reviewProjectScript(project: Row, approved: boolean, candidateIndex?: number) {
  let note = "";
  const candidates = projectCandidates(project);
  const selectedCandidate = candidates[candidateIndex ?? 0] || {};
  if (!approved) {
    const result = await ElMessageBox.prompt(
      "请说明当前 Codex 脚本哪里需要修改，Codex 会根据原因重写",
      "退回 Codex 重写",
      { confirmButtonText: "确认退回", cancelButtonText: "取消", inputType: "textarea" },
    ).catch(() => null);
    if (!result) return;
    note = result.value.trim();
    if (!note) return ElMessage.warning("退回脚本时必须填写修改原因");
  }
  reviewingScriptProjectId.value = project.id;
  try {
    const result = await post<Row>(`/api/v1/workbench/data-center/video-projects/${project.id}/script-review`, {
      action: approved ? "APPROVE" : "RETURN",
      note,
      candidateIndex,
    });
    ElMessage.success(approved
      ? result.autoSubmittedVideoTask
        ? "脚本与素材已确认，已自动提交视频生成任务"
        : "脚本审核通过，请处理缺失素材"
      : "Codex 脚本已退回，系统已按修改原因提交重写任务");
    await invalidateDataCenterSection("videoFactory");
    await loadDataCenter(true);
    await refreshTaskVideoProject();
  } finally {
    reviewingScriptProjectId.value = "";
  }
}

async function transferProjectScriptToCodex(project: Row, candidateIndex?: number) {
  const confirmed = await ElMessageBox.confirm(
    "将沿用创建项目时的全部需求、素材策略和当前系统脚本交给 Codex 生成新版本，无需重复填写要求。",
    "转交 Codex 生成",
    { confirmButtonText: "确认转交", cancelButtonText: "取消", type: "info" },
  ).then(() => true).catch(() => false);
  if (!confirmed) return;
  reviewingScriptProjectId.value = project.id;
  try {
    await post(`/api/v1/workbench/data-center/video-projects/${project.id}/script-transfer-to-codex`, { candidateIndex });
    ElMessage.success("已转交 Codex，项目需求、当前脚本和素材上下文已自动携带");
    await invalidateDataCenterSection("videoFactory");
    await refreshTaskVideoProject();
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
    await refreshTaskVideoProject();
  } finally {
    generatingProjectId.value = "";
  }
}

function videoProjectHasActiveJob(project: Row) {
  const activeStatuses = ["PENDING", "RUNNING", "RETRY"];
  return project.videoGenerationJobs?.some((job: Row) => activeStatuses.includes(job.status))
    || project.videoRenderJobs?.some((job: Row) => activeStatuses.includes(job.status));
}

function videoLibraryEntryId(project?: Row) {
  const factory = (project?.sourceSignals || []).find((item: Row) => item?.type === "VIDEO_FACTORY") || {};
  return String(factory.libraryEntryId || "");
}

async function archiveVideoProject(project: Row) {
  await ElMessageBox.confirm(
    `确认删除“${project.topic}”？系统会同步取消该项目尚未完成的 AI、素材生成和剪辑任务，并从员工任务与视频工厂同时移除。项目在回收站保留 3 天。`,
    "删除视频项目",
    { confirmButtonText: "确认删除", cancelButtonText: "取消", type: "warning" },
  );
  const hideLibraryEntries = await ElMessageBox.confirm(
    "该项目已有审核通过的成品。是否同时从全员成品库隐藏？恢复项目时会自动恢复展示。",
    "成品库处理",
    { confirmButtonText: "隐藏成品", cancelButtonText: "保留为团队参考", type: "info" },
  ).then(() => true).catch(() => false);
  archivingVideoProjectId.value = project.id;
  try {
    await post(`/api/v1/workbench/data-center/video-projects/${project.id}/archive`, { hideLibraryEntries });
    ElMessage.success("视频项目、员工任务及未完成 AI 任务已同步处理");
    if (expandedTaskVideoProjectId.value === project.id) {
      expandedTaskVideoProjectId.value = "";
      taskVideoProjectDetail.value = undefined;
    }
    await invalidateDataCenterSection("videoFactory");
    await Promise.all([loadTasks(), loadDataCenter(true)]);
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
  recycleCategory.value = "VIDEO";
  await openTaskRecycleBin();
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
    PROJECT_BRIEF: "项目创建",
    SCRIPT_GENERATING: "脚本与素材生成中",
    SCRIPT_RETURNED: "脚本与素材重写中",
    SCRIPT_APPROVED: "脚本与素材准备",
    FACTORY_SCRIPT_READY: "脚本与素材待确认",
    FACTORY_GENERATING: "脚本与素材匹配中",
    MATERIAL_REVIEW: "脚本与素材待确认",
    MATERIAL_RETURNED: "脚本与素材待处理",
    READY_TO_EDIT: "视频生成待提交",
    EDITING: "视频生成中",
    VIDEO_REVIEW: "成片待审核",
    PLATFORM_PACKAGING: "封面标题与发布",
    PACKAGING_REVIEW: "封面标题待审核",
    READY_TO_PUBLISH: "待发布",
    PUBLISHING: "发布中",
    TRACKING: "发布完成",
  } as Record<string, string>)[String(stage || "")] || stage || "项目创建";
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

function projectShotForScriptLine(project: Row, scriptLine: Row, index: number) {
  const shots = Array.isArray(project?.videoShots) ? project.videoShots : [];
  const lineId = String(scriptLine?.lineId || "");
  return shots.find((shot: Row) => String(shot?.metadata?.lineId || "") === lineId)
    || shots.find((shot: Row) => Number(shot?.sequence) === index)
    || shots[index];
}

function candidateIndexFor(project: Row, candidate: Row) {
  const index = projectCandidates(project).indexOf(candidate);
  return index >= 0 ? index : 0;
}

async function ensureScriptLineShot(project: Row, candidate: Row, scriptLine: Row, lineIndex: number) {
  const existing = projectShotForScriptLine(project, scriptLine, lineIndex);
  if (existing?.id) return existing;
  const refreshed = await post<Row>(`/api/v1/workbench/data-center/video-projects/${project.id}/ensure-script-line-shot`, {
    candidateIndex: candidateIndexFor(project, candidate),
    lineIndex,
  });
  applyRefreshedVideoProject(refreshed);
  const lineId = String(scriptLine?.lineId || "");
  return (Array.isArray(refreshed.videoShots) ? refreshed.videoShots : [])
    .find((shot: Row) => String(shot?.metadata?.lineId || "") === lineId)
    || projectShotForScriptLine(refreshed, scriptLine, lineIndex);
}

async function uploadScriptLineShot(project: Row, candidate: Row, scriptLine: Row, lineIndex: number) {
  const shot = await ensureScriptLineShot(project, candidate, scriptLine, lineIndex);
  if (!shot?.id) return ElMessage.error("未能创建对应的补拍项，请刷新项目后重试");
  await openShotUpload(project, shot);
}

async function generateScriptLineShot(project: Row, candidate: Row, scriptLine: Row, lineIndex: number) {
  const shot = await ensureScriptLineShot(project, candidate, scriptLine, lineIndex);
  if (!shot?.id) return ElMessage.error("未能创建对应的补拍项，请刷新项目后重试");
  await generateWorkbenchShot(project, shot);
}

function scriptLineVideoAssetId(project: Row, scriptLine: Row, index: number) {
  const persistedShot = projectShotForScriptLine(project, scriptLine, index);
  return String(persistedShot?.selectedAssetId || scriptLine?.selectedAssetIds?.[0] || "");
}

function scriptLineMaterialDescription(project: Row, scriptLine: Row, index: number) {
  const persistedShot = projectShotForScriptLine(project, scriptLine, index);
  const assetId = scriptLineVideoAssetId(project, scriptLine, index);
  let description = String(scriptLine.materialMatchReason || scriptLine.missingReason || scriptLine.description || "").trim();
  if (assetId) {
    const escapedAssetId = assetId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    description = description
      .replace(new RegExp(`^asset\\s*${escapedAssetId}\\s*`, "i"), "")
      .replace(new RegExp(escapedAssetId, "gi"), "")
      .replace(/^[：:，,；;、\-—\s]+/u, "")
      .trim();
  }
  return description
    || String(persistedShot?.selectedAsset?.displayName || persistedShot?.selectedAsset?.title || "").trim()
    || (assetId ? "已匹配对应视频素材" : "暂未匹配到合适的视频素材");
}

function previewScriptLineAsset(project: Row, scriptLine: Row, index: number) {
  const persistedShot = projectShotForScriptLine(project, scriptLine, index);
  const assetId = scriptLineVideoAssetId(project, scriptLine, index);
  if (!assetId) return;
  openAssetPreview(persistedShot?.selectedAsset || { id: assetId });
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
    await refreshTaskVideoProject();
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
    project.productionStage === "READY_TO_EDIT"
    && project.videoShots?.length
    && project.videoShots.every((shot: Row) => shot.status === "DONE" && shot.selectedAssetId),
  );
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
    await refreshTaskVideoProject();
  } finally {
    renderingProjectId.value = "";
  }
}

function openVideoReview(project: Row, job: Row, action: "APPROVE" | "RETURN") {
  videoReviewProject.value = project;
  videoReviewJob.value = job;
  videoReviewForm.action = action;
  videoReviewForm.note = "";
  // Passing a finished video needs no extra employee input.  The review API
  // advances the project into cover/title and publishing in the same action.
  if (action === "APPROVE") {
    void reviewWorkbenchVideo();
    return;
  }
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
      : isCodexDirectVideoProject(project)
        ? "成片已退回，已自动交给 Codex 按退回说明修改并生成新版本"
        : "成片已退回，修改说明已同步到后台优化流程");
    await invalidateDataCenterSection("videoFactory");
    await loadDataCenter(true);
    await refreshTaskVideoProject();
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
    await refreshTaskVideoProject();
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
    const result = await post<{ project?: Row }>(`/api/v1/workbench/data-center/video-projects/${project.id}/packaging`, {
      outputAssetId: job.outputAsset.id,
    });
    if (result.project) applyRefreshedVideoProject(result.project);
    ElMessage.success("封面标题任务已提交，当前项目会显示生成进度");
    await invalidateDataCenterSection("videoFactory");
    await refreshTaskVideoProject();
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
    await refreshTaskVideoProject();
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

async function downloadProjectPackagingCover(project: Row, variant: Row) {
  const result = await api<{ url: string }>(
    `/api/v1/workbench/data-center/video-projects/${project.id}/packaging/${variant.id}/cover-url`,
  );
  if (!result.url) return ElMessage.warning("封面文件暂不可下载");
  window.open(result.url, "_blank", "noopener,noreferrer");
}

async function reviewProjectPackagingDirect(project: Row, variant: Row, approved: boolean) {
  packagingPreviewProject.value = project;
  packagingPreviewVariant.value = variant;
  await reviewProjectPackaging(approved);
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
    // Reflect the completed review immediately. The following project refresh
    // remains the source of truth, but users should never need to refresh the
    // whole page to see that their click succeeded.
    variant.packagingStatus = approved ? "APPROVED" : "RETURNED";
    closePackagingPreview();
    ElMessage.success(approved ? "封面和标题审核通过，可以进入发布环节" : "已退回并同步修改说明");
    await invalidateDataCenterSection("videoFactory");
    await loadDataCenter(true);
    await refreshVideoProject(project.id);
    await loadTasks();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "封面标题审核失败，请重试");
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
  try {
    const result = await api<{ url: string }>(`/api/v1/workbench/assets/${asset.id}/download-url`);
    if (!result.url) return ElMessage.warning("成片文件暂不可下载");
    const response = await fetch(result.url);
    if (!response.ok) throw new Error(`下载失败（${response.status}）`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const rawName = String(asset.displayName || asset.originalName || asset.fileName || asset.title || "成片")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
    const extension = rawName.includes(".") ? "" : blob.type.includes("quicktime") ? ".mov" : ".mp4";
    link.href = objectUrl;
    link.download = `${rawName || "成片"}${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "成片下载失败，请重试");
  }
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
  if (page === "outputs") await loadVideoLibrary();
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
  const uploadedForVideoShot = Boolean(lockedShotUpload.value);
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
    if (uploadedForVideoShot) await invalidateDataCenterSection("videoFactory");
    if (active.value === "data") await loadDataCenter(true);
    else if (active.value === "tasks") {
      await refreshTaskVideoProject();
    } else await loadDashboard();
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

onMounted(() => {
  void bootstrap();
  currentVideoProjectPollingTimer = setInterval(() => void pollCurrentVideoProject(), 5000);
});
onBeforeUnmount(() => {
  if (currentVideoProjectPollingTimer) clearInterval(currentVideoProjectPollingTimer);
});
</script>

<template>
  <div v-if="!authReady" class="center-screen"><el-icon class="spin" :size="32"><House /></el-icon></div>

  <div v-else-if="!user" class="login-page">
    <section class="login-card">
      <div class="logo">S</div>
      <p class="eyebrow">SAYDIAN WORKBENCH</p>
      <h1>赛电智能工作台</h1>
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
          <div><p class="eyebrow">VIDEO CREATION LIBRARY</p><h2>视频成品库</h2><small>全员可参考已审核通过的成片、提示词与发布结果</small></div>
          <el-radio-group v-model="outputCategory" @change="switchOutputCategory(String($event))"><el-radio-button value="VIDEO">视频</el-radio-button><el-radio-button value="IMAGE">图片</el-radio-button><el-radio-button value="ARTICLE">软文</el-radio-button></el-radio-group>
        </section>
        <section v-if="outputCategory === 'VIDEO'" class="toolbar section-card video-library-toolbar">
          <el-input v-model="videoLibraryFilters.search" clearable placeholder="搜索视频标题、审核标题或标签" @keyup.enter="videoLibraryPage = 1; loadVideoLibrary()" />
          <el-select v-model="videoLibraryFilters.productModel" clearable filterable placeholder="全部产品"><el-option v-for="model in videoLibraryProductModels" :key="model" :label="model" :value="model" /></el-select>
          <span class="video-library-sort-label">排序方式</span>
          <el-select v-model="videoLibraryFilters.sort" @change="videoLibraryPage = 1; loadVideoLibrary()"><el-option label="按最新成品排序（默认）" value="LATEST" /><el-option label="按播放量排序" value="VIEWS" /><el-option label="按点赞量排序" value="LIKES" /><el-option label="按评论量排序" value="COMMENTS" /></el-select>
          <el-button type="primary" @click="videoLibraryPage = 1; loadVideoLibrary()">搜索</el-button>
          <el-button @click="Object.assign(videoLibraryFilters, { search: '', productModel: '', sort: 'LATEST' }); videoLibraryPage = 1; loadVideoLibrary()">重置</el-button>
        </section>
        <section v-if="outputCategory === 'VIDEO'" v-loading="videoLibraryLoading" class="section-card video-library-results">
          <div v-if="videoLibrary.length" class="video-library-grid">
            <button v-for="entry in videoLibrary" :key="entry.id" class="video-library-card" @click="openVideoLibraryEntry(entry)">
              <span class="video-library-cover"><img v-if="videoLibraryCoverUrls[String(entry.id)]" :src="videoLibraryCoverUrls[String(entry.id)]" :alt="videoLibraryTitle(entry)" /><el-icon v-else><VideoCamera /></el-icon><em>{{ entry.outputAsset?.durationSeconds ? `${Math.round(Number(entry.outputAsset.durationSeconds))}秒` : '视频' }}</em></span>
              <span class="video-library-copy"><strong>{{ videoLibraryTitle(entry) }}</strong><span v-if="videoLibraryTags(entry).length" class="video-library-tags"><el-tag v-for="tag in videoLibraryTags(entry)" :key="tag" size="small"># {{ tag }}</el-tag></span><small>{{ entry.productModel || '品牌通用' }} · {{ platformLabel(entry.platform) }}</small><span v-if="entry.latestMetricAt" class="video-library-metrics"><i>最新采集 · {{ videoLibraryMetricCheckpoint(entry) }}</i><b>播放 {{ videoLibraryMetric(entry, 'latestViews') }}</b><b>点赞 {{ videoLibraryMetric(entry, 'latestLikes') }}</b><b>评论 {{ videoLibraryMetric(entry, 'latestComments') }}</b></span><span v-else-if="videoLibraryPublishedVariants(entry).length" class="video-library-unpublished">已回传发布链接，等待首次采集</span><span v-else class="video-library-unpublished">尚未回传发布链接</span><span class="video-library-footer">{{ entry.createdBy || '系统' }}<em>{{ formatTime(entry.createdAt) }}</em></span></span>
            </button>
          </div>
          <el-empty v-else description="暂无已审核通过的视频成品" />
          <div v-if="videoLibraryTotal > 12" class="video-library-pagination">
            <el-pagination :current-page="videoLibraryPage" small background layout="prev, pager, next" :page-size="12" :total="videoLibraryTotal" @current-change="changeVideoLibraryPage" />
            <label class="video-library-jump">跳至 <el-input v-model.number="videoLibraryJumpPage" inputmode="numeric" @keyup.enter="jumpToVideoLibraryPage" /> 页</label>
          </div>
        </section>
        <section v-else v-loading="outputLibraryLoading" class="section-card">
          <div v-if="outputLibrary.length" class="output-library-grid">
            <button v-for="output in outputLibrary" :key="output.id" class="output-library-card" @click="openSystemOutput(output)">
              <span class="output-library-cover"><el-icon><VideoCamera v-if="isVideoOutput(output)" /><Files v-else /></el-icon><em>{{ outputCategoryLabel(output) }}</em></span>
              <span class="output-library-copy"><strong>{{ output.title }}</strong><small>{{ output.aiTask?.taskNo }} · {{ output.aiTask?.platform ? platformLabel(output.aiTask.platform) : '全平台' }}</small><span>{{ formatTime(output.createdAt) }}</span></span>
            </button>
          </div>
          <el-empty v-else description="该分类暂无成品" />
        </section>
      </template>

      <template v-else-if="active === 'tasks'">
        <section class="toolbar section-card">
          <div class="task-toolbar-filters">
            <el-segmented v-model="taskScope" :options="[{label:'我的任务',value:'MINE'},{label:'可领取',value:'AVAILABLE'},{label:'全部相关',value:'ALL'}]" @change="resetTaskPage" />
            <el-select v-model="taskStatus" clearable placeholder="全部状态" @change="resetTaskPage">
              <el-option label="待完成" value="TODO" />
              <el-option label="待审核" value="PENDING_REVIEW" />
              <el-option label="已完成" value="DONE" />
              <el-option label="已取消" value="CANCELLED" />
            </el-select>
            <el-select v-model="taskType" clearable placeholder="全部任务类型" @change="resetTaskPage">
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
            <el-button @click="openTaskRecycleBin">回收站</el-button>
            <el-button @click="openSelfTask">普通任务</el-button>
            <el-button type="primary" @click="openNewVideoProjectDialog">视频项目</el-button>
            <el-button type="primary" plain @click="openNewImageProjectDialog">图文项目</el-button>
            <el-button type="primary" plain @click="quickCreateProject('ARTICLE')">软文项目</el-button>
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
              <template v-if="isVideoProjectTask(task)">
                <div class="video-project-card-meta">
                  <el-tag size="small" :type="statusType(taskStatusCode(task))">{{ taskDisplayStatus(task) }}</el-tag>
                  <el-tag v-if="videoProjectModeLabel(task)" size="small" type="info">{{ videoProjectModeLabel(task) }}</el-tag>
                </div>
                <h4
                  class="video-project-card-title"
                  role="button"
                  tabindex="0"
                  @click="openVideoProjectFromTask(task)"
                  @keydown.enter.prevent="openVideoProjectFromTask(task)"
                >{{ videoProjectCardTitle(task) }}</h4>
                <div class="video-task-identifiers">
                  <span v-if="task.projection?.project?.productModel">{{ task.projection.project.productModel }}</span>
                  <span v-if="task.projection?.project?.videoType">{{ task.projection.project.videoType }}</span>
                  <span v-if="task.projection?.project?.createdAt">创建于 {{ formatTime(task.projection.project.createdAt) }}</span>
                  <span v-if="videoProjectDueText(task)" class="video-project-due">{{ videoProjectDueText(task) }}</span>
                </div>
              </template>
              <template v-else-if="isImageProjectTask(task)">
                <div class="video-project-card-meta">
                  <el-tag size="small" :type="statusType(taskStatusCode(task))">{{ taskDisplayStatus(task) }}</el-tag>
                  <el-tag size="small" type="info">{{ imageProjectModeLabel(task) }}</el-tag>
                </div>
                <h4 class="video-project-card-title" role="button" tabindex="0" @click="openImageProjectFromTask(task)" @keydown.enter.prevent="openImageProjectFromTask(task)">{{ imageProjectCardTitle(task) }}</h4>
                <div class="video-task-identifiers">
                  <span v-if="task.projection?.project?.productModel">{{ task.projection.project.productModel }}</span>
                  <span v-if="task.projection?.project?.imageType || task.projection?.project?.videoType">{{ task.projection?.project?.imageType || task.projection?.project?.videoType }}</span>
                  <span v-if="task.projection?.project?.createdAt">创建于 {{ formatTime(task.projection.project.createdAt) }}</span>
                </div>
              </template>
              <template v-else>
                <div class="task-meta">
                  <el-tag size="small" :type="statusType(taskStatusCode(task))">{{ taskDisplayStatus(task) }}</el-tag>
                  <span>{{ task.taskNo || "系统任务" }}</span>
                  <span>{{ roleLabels[task.requiredRoleCode] || categoryLabels[task.category] || "业务任务" }}</span>
                  <span v-if="task.projection?.currentPhase">{{ task.projection.currentPhase }}</span>
                  <span>截止 {{ formatTime(task.dueAt) }}</span>
                </div>
                <h4>{{ task.title }}</h4>
                <p class="task-summary">{{ taskCardSummary(task) }}</p>
              </template>
              <template v-if="isVideoProjectTask(task)">
                <div class="video-task-steps" :aria-label="`当前进行到第 ${videoProjectTaskStep(task)} 步`">
                  <span
                    v-for="(step, index) in isBatchVideoProjectTask(task) ? batchFlowSteps(task) : videoFlowSteps"
                    :key="step"
                    :class="{ active: videoProjectTaskStep(task) === index + 1, done: videoProjectTaskStep(task) > index + 1 }"
                  >{{ index + 1 }} {{ step }}</span>
                </div>
                <p class="video-task-next"><b>现在需要：</b>{{ videoProjectTaskHint(task) }}</p>
              </template>
              <template v-else-if="isImageProjectTask(task)">
                <div class="video-task-steps" :aria-label="`当前进行到第 ${imageProjectTaskStep(task)} 步`">
                  <span v-for="(step, index) in imageFlowSteps" :key="step" :class="{ active: imageProjectTaskStep(task) === index + 1, done: imageProjectTaskStep(task) > index + 1 }">{{ index + 1 }} {{ step }}</span>
                </div>
                <p class="video-task-next"><b>现在需要：</b>{{ imageProjectTaskHint(task) }}</p>
              </template>
              <p v-else-if="task.returnReason" class="return-note">修改要求：{{ task.returnReason }}</p>
            </div>
            <div class="task-actions">
              <el-button
                v-if="can('CONTENT_SUBMIT') && canMarkAiTaskUrgent(task)"
                type="danger"
                plain
                :loading="markingUrgentAiTaskId === linkedAiTask(task)?.id"
                @click="markAiTaskUrgent(task)"
              >标记紧急</el-button>
              <el-tag v-else-if="linkedAiTask(task)?.priority === 'URGENT'" type="danger">紧急优先</el-tag>
              <el-button
                v-if="isVideoProjectTask(task)"
                type="primary"
                :loading="taskVideoProjectLoading && expandedTaskVideoProjectId === (task.sourceId || task.evidence?.contentPlanId)"
                @click="openVideoProjectFromTask(task)"
              >{{ videoProjectPrimaryAction(task) }}</el-button>
              <el-button
                v-if="isVideoProjectTask(task) && can('CONTENT_SUBMIT')"
                type="danger"
                plain
                :loading="archivingVideoProjectId === (task.sourceId || task.evidence?.contentPlanId)"
                @click="archiveVideoProject({ id: task.sourceId || task.evidence?.contentPlanId, topic: videoProjectCardTitle(task) })"
              >删除项目</el-button>
              <template v-else-if="isImageProjectTask(task)">
                <el-button
                  type="primary"
                  :loading="taskImageProjectLoading && activeImageProjectId === (task.sourceId || task.evidence?.contentPlanId)"
                  @click="openImageProjectFromTask(task)"
                >{{ imageProjectPrimaryAction(task) }}</el-button>
                <el-button
                  v-if="can('CONTENT_SUBMIT')"
                  type="danger"
                  plain
                  :loading="deletingImageProjectId === (task.sourceId || task.evidence?.contentPlanId)"
                  @click="deleteImageProject(task)"
                >删除项目</el-button>
              </template>
              <template v-else>
                <el-button @click="openTaskDetail(task)">查看详情</el-button>
                <el-button v-if="!task.assigneeEmployeeId && task.status === 'OPEN'" type="primary" @click="acceptTask(task)">领取</el-button>
                <el-button v-if="!isAiContentTask(task) && task.assigneeEmployeeId === user.id && ['ACCEPTED','RETURNED'].includes(task.status)" type="primary" @click="startTask(task)">开始</el-button>
                <el-button v-if="!isAiContentTask(task) && task.assigneeEmployeeId === user.id && ['ACCEPTED','IN_PROGRESS','RETURNED'].includes(task.status)" @click="openSubmit(task)">提交成果</el-button>
                <el-button v-if="task.sourceType === 'SELF_CREATED' && (!isAiContentTask(task) || task.status === 'ACCEPTED') && !['COMPLETED','CANCELLED','VERIFIED'].includes(task.status)" @click="openSelfTaskEdit(task)">修改</el-button>
                <el-button v-if="task.sourceType === 'SELF_CREATED' && !['COMPLETED','CANCELLED','VERIFIED'].includes(task.status)" type="danger" plain @click="cancelOwnedTask(task)">取消任务</el-button>
                <el-button v-if="task.sourceType === 'SELF_CREATED' && task.status === 'CANCELLED'" @click="openSelfTaskCopy(task)">复制再次添加</el-button>
                <el-button v-if="task.sourceType === 'SELF_CREATED' && task.status === 'CANCELLED'" type="danger" plain :loading="trashingTaskId === task.id" @click="trashCancelledTask(task)">删除</el-button>
              </template>
            </div>
            <section
              v-if="isImageProjectTask(task) && imageProjectVisible && activeImageProjectId === (task.sourceId || task.evidence?.contentPlanId)"
              v-loading="taskImageProjectLoading"
              class="task-video-workspace task-image-workspace"
            >
              <template v-if="taskImageProjectDetail">
                <header class="task-video-workspace-head">
                  <div>
                    <small>当前阶段 {{ imageProjectTaskStep(task) }}/3</small>
                    <h3>{{ imageFlowSteps[imageProjectTaskStep(task) - 1] }}</h3>
                    <p>{{ imageProjectTaskHint(task) }}</p>
                  </div>
                  <el-button @click="refreshImageProject">刷新当前项目</el-button>
                </header>
                <nav class="task-video-stage-tabs" aria-label="图文项目阶段">
                  <button
                    v-for="(step, index) in imageFlowSteps"
                    :key="step"
                    type="button"
                    :class="{ active: imageProjectTaskStep(task) === index + 1, done: imageProjectTaskStep(task) > index + 1 }"
                  >{{ index + 1 }} {{ step }}</button>
                </nav>

                <template v-if="isBatchImageProjectDetail(taskImageProjectDetail)">
                  <section v-if="['IMAGE_GENERATING', 'IMAGE_RETURNED'].includes(taskImageProjectDetail.productionStage)" class="task-video-stage-panel">
                    <h4>{{ taskImageProjectDetail.productionStage === 'IMAGE_RETURNED' ? '批量图文正在按意见修改' : '批量图文与文案生成中' }}</h4>
                    <p>一个项目一个 AI 任务，同步生成每组图文页、标题、标签和发布文案。</p>
                    <div class="batch-summary-strip">
                      <div><b>{{ batchImageProgressStats(taskImageProjectDetail).total }}</b><span>组图文</span></div>
                      <div><b>{{ batchImageProgressStats(taskImageProjectDetail).products }}</b><span>个产品</span></div>
                      <div><b>{{ batchImageProgressStats(taskImageProjectDetail).done }}</b><span>已完成</span></div>
                      <div><b>{{ batchImageProgressStats(taskImageProjectDetail).failed }}</b><span>失败</span></div>
                    </div>
                    <template v-if="taskImageProjectDetail.aiTask">
                      <div class="project-running-task-meta">
                        <el-tag size="small" type="info">AI 任务 {{ taskImageProjectDetail.aiTask?.taskNo || '已提交' }}</el-tag>
                        <el-tag size="small" :type="taskImageProjectDetail.aiTask?.status === 'FAILED' ? 'danger' : taskImageProjectDetail.aiTask?.status === 'SUCCEEDED' ? 'success' : 'warning'">{{ statusLabels[String(taskImageProjectDetail.aiTask?.status || '')] || taskImageProjectDetail.aiTask?.status }}</el-tag>
                      </div>
                      <el-progress :percentage="imageProjectAiTaskProgress(taskImageProjectDetail)" :status="taskImageProjectDetail.aiTask?.status === 'FAILED' ? 'exception' : undefined" />
                      <p class="project-running-message">{{ imageProjectAiTaskMessage(taskImageProjectDetail) }}</p>
                      <el-button v-if="taskImageProjectDetail.aiTask?.status === 'FAILED'" type="primary" @click="retryImageProject">重新执行</el-button>
                    </template>
                    <div class="group-grid">
                      <article v-for="group in batchImageGroups(taskImageProjectDetail)" :key="`gen-${group.groupKey}`" class="group-card">
                        <div class="g-head"><b>{{ String(group.product || '').split(' · ')[0] }} · 第{{ group.groupKey }}组</b><el-tag size="small" type="info">{{ group.type }}</el-tag></div>
                        <div class="group-thumb"><div><div style="font-size:22px">▦</div><div style="margin-top:6px;font-size:12px">{{ group.type }} · 图文与文案同步生成</div></div></div>
                        <div class="group-meta">标题、标签和发布文案随图文同步生成</div>
                      </article>
                    </div>
                    <div class="preview-actions"><el-button @click="refreshImageProject">刷新当前项目</el-button></div>
                  </section>
                  <section v-else-if="taskImageProjectDetail.productionStage === 'IMAGE_REVIEW'" class="task-video-stage-panel">
                    <h4>批量图文审核</h4>
                    <p>每组图文、标题、标签和发布文案集中审核，可整批通过，也可填写原因退回。</p>
                    <div class="group-grid">
                      <article v-for="group in batchImageGroups(taskImageProjectDetail)" :key="`review-${group.groupKey}`" class="group-card">
                        <div class="g-head"><b>{{ String(group.product || '').split(' · ')[0] }} · 第{{ group.groupKey }}组</b><el-tag size="small" type="success">图文待审核</el-tag></div>
                        <div v-if="batchImageReviewResult(taskImageProjectDetail, group).status === 'READY'" class="group-thumb"><img :src="batchImageFirstPageUrl(taskImageProjectDetail, group)" :alt="batchImageReviewResult(taskImageProjectDetail, group).title" /></div>
                        <div v-else class="group-thumb"><div><div style="font-size:22px">!</div><div style="margin-top:6px;font-size:12px">该组图文未回传</div></div></div>
                        <div v-if="batchImageReviewResult(taskImageProjectDetail, group).status === 'READY'" class="copy-line">
                          <div class="copy-title">{{ batchImageReviewResult(taskImageProjectDetail, group).title }}</div>
                          <div class="tags"><el-tag v-for="tag in batchImageReviewResult(taskImageProjectDetail, group).tags" :key="tag" size="small" type="info">#{{ tag }}</el-tag></div>
                          <div class="note">{{ batchImageReviewResult(taskImageProjectDetail, group).publishCopy }}</div>
                        </div>
                        <div v-else class="copy-line"><div class="copy-title">未回传</div><div class="note">请重新执行或退回该组后再审核。</div></div>
                        <div class="group-actions">
                          <el-button size="small" :disabled="batchImageReviewResult(taskImageProjectDetail, group).status !== 'READY'" @click="openBatchImagePreview(group)">预览图文</el-button>
                          <el-button size="small" :disabled="batchImageReviewResult(taskImageProjectDetail, group).status !== 'READY'" @click="copyTaskContent(batchImageReviewResult(taskImageProjectDetail, group).title + '\n' + batchImageReviewResult(taskImageProjectDetail, group).tags.map((tag: string) => '#' + tag).join(' '), '标题与标签')">复制标题标签</el-button>
                          <el-button size="small" :disabled="batchImageReviewResult(taskImageProjectDetail, group).status !== 'READY'" @click="copyTaskContent(batchImageReviewResult(taskImageProjectDetail, group).publishCopy, '发布文案')">复制文案</el-button>
                          <el-button size="small" type="danger" plain @click="rejectBatchImage(group)">退回</el-button>
                        </div>
                      </article>
                    </div>
                    <div class="status-line">整批审核通过后进入回传链接；单组退回时填写原因，Codex 只修改对应图文。</div>
                    <div class="preview-actions">
                      <el-button @click="refreshImageProject">刷新当前项目</el-button>
                      <el-button type="danger" plain @click="rejectBatchImage()">整批退回</el-button>
                      <el-button type="success" :disabled="!batchImageReadyForReview(taskImageProjectDetail)" @click="approveBatchImage">整批审核通过</el-button>
                    </div>
                  </section>
                  <section v-else class="task-video-stage-panel">
                    <h4>发布与回传</h4>
                    <p>整批已审核通过。下载文件后，逐组粘贴发布链接并回传。</p>
                    <div class="batch-publish-rows">
                      <div v-for="group in batchImageGroups(taskImageProjectDetail)" :key="`pub-${group.groupKey}`" class="batch-publish-row">
                        <b>{{ String(group.product || '').split(' · ')[0] }} · 第{{ group.groupKey }}组（{{ group.type }}）</b>
                        <el-select v-model="batchImagePublishRecord(String(group.groupKey)).platform">
                          <el-option label="抖音" value="DOUYIN" />
                          <el-option label="小红书" value="XIAOHONGSHU" />
                          <el-option label="快手" value="KUAISHOU" />
                          <el-option label="视频号" value="WECHAT_CHANNELS" />
                          <el-option label="B站" value="BILIBILI" />
                        </el-select>
                        <el-input v-model="batchImagePublishRecord(String(group.groupKey)).remoteUrl" placeholder="粘贴已发布图文链接" />
                      </div>
                    </div>
                    <div class="preview-actions">
                      <el-button @click="refreshImageProject">刷新当前项目</el-button>
                      <el-button type="primary" @click="submitBatchImagePublish">全部回传完成</el-button>
                    </div>
                  </section>
                </template>

                <section v-if="!isBatchImageProjectDetail(taskImageProjectDetail) && ['IMAGE_GENERATING', 'IMAGE_RETURNED'].includes(taskImageProjectDetail.productionStage)" class="task-video-stage-panel">
                  <h4>{{ taskImageProjectDetail.productionStage === 'IMAGE_RETURNED' ? '图文正在按意见修改' : '图文与文案生成中' }}</h4>
                  <p>{{ taskImageProjectDetail.productionStage === 'IMAGE_RETURNED' ? '图文制作 Skill 正在根据退回意见生成修改版本。' : '图文制作 Skill 正在生成图文、标题、标签和发布文案。' }}</p>
                  <template v-if="imageProjectAiTask(taskImageProjectDetail)">
                    <div class="project-running-task-meta">
                      <el-tag size="small" type="info">AI 任务 {{ imageProjectAiTask(taskImageProjectDetail)?.taskNo || '已提交' }}</el-tag>
                      <el-tag size="small" :type="imageProjectAiTask(taskImageProjectDetail)?.status === 'FAILED' ? 'danger' : imageProjectAiTask(taskImageProjectDetail)?.status === 'SUCCEEDED' ? 'success' : 'warning'">{{ statusLabels[String(imageProjectAiTask(taskImageProjectDetail)?.status || '')] || imageProjectAiTask(taskImageProjectDetail)?.status }}</el-tag>
                    </div>
                    <el-progress :percentage="imageProjectAiTaskProgress(taskImageProjectDetail)" :status="imageProjectAiTask(taskImageProjectDetail)?.status === 'FAILED' ? 'exception' : undefined" />
                    <p class="project-running-message">{{ imageProjectAiTaskMessage(taskImageProjectDetail) }}</p>
                    <el-button
                      v-if="imageProjectAiTask(taskImageProjectDetail)?.status === 'FAILED'"
                      type="primary"
                      @click="retryImageProject"
                    >重新执行</el-button>
                  </template>
                  <el-alert v-else title="图文 AI 任务正在登记，稍后可点击“刷新当前项目”查看进度。" type="info" :closable="false" show-icon />
                </section>
                <template v-else-if="!isBatchImageProjectDetail(taskImageProjectDetail) && taskImageProjectDetail.productionStage === 'IMAGE_REVIEW'">
                  <section class="image-result-layout">
                    <div class="image-page-list">
                      <article v-for="(page, index) in imageProjectPages(taskImageProjectDetail)" :key="page.id || index" class="image-page-card">
                        <img v-if="imageProjectPageUrl(page)" :src="imageProjectPageUrl(page)" :alt="page.title || `第${index + 1}页`" />
                        <div v-else><el-tag size="small">第 {{ index + 1 }} 页</el-tag><strong>{{ page.title || `第${index + 1}页图文` }}</strong><p>{{ page.copy || page.description || '图文内容已生成' }}</p></div>
                      </article>
                    </div>
                    <div class="image-copy-panels">
                      <section><header><strong>标题与标签</strong><el-button size="small" @click="copyTaskContent(`${imageProjectVariant(taskImageProjectDetail).title || ''}\n${imageProjectTags(taskImageProjectDetail).map((tag: string) => `#${tag}`).join(' ')}`, '标题与标签')">复制</el-button></header><h4>{{ imageProjectVariant(taskImageProjectDetail).title }}</h4><el-tag v-for="tag in imageProjectTags(taskImageProjectDetail)" :key="tag" size="small">#{{ tag }}</el-tag></section>
                      <section><header><strong>发布文案</strong><el-button size="small" @click="copyTaskContent(imageProjectCopy(taskImageProjectDetail), '发布文案')">复制</el-button></header><p>{{ imageProjectCopy(taskImageProjectDetail) || '发布文案已随图文生成' }}</p></section>
                    </div>
                  </section>
                  <div class="preview-actions"><el-button @click="openImageProjectPreview">预览图文</el-button><el-button :loading="downloadingImageProject" @click="downloadAllImageProjectPages(taskImageProjectDetail)">一键下载全部</el-button><el-button type="danger" plain :loading="reviewingImageProject" @click="reviewImageProject(false)">退回并填写原因</el-button><el-button type="success" :loading="reviewingImageProject" @click="reviewImageProject(true)">图文审核通过</el-button></div>
                </template>
                <template v-else-if="!isBatchImageProjectDetail(taskImageProjectDetail)">
                  <section class="image-result-layout published">
                    <div class="image-page-list"><article v-for="(page, index) in imageProjectPages(taskImageProjectDetail)" :key="page.id || index" class="image-page-card"><img v-if="imageProjectPageUrl(page)" :src="imageProjectPageUrl(page)" :alt="page.title || `第${index + 1}页`" /><div v-else><strong>{{ page.title || `第${index + 1}页图文` }}</strong></div></article></div>
                    <div class="image-copy-panels"><section><header><strong>标题与标签</strong><el-button size="small" @click="copyTaskContent(`${imageProjectVariant(taskImageProjectDetail).title || ''}\n${imageProjectTags(taskImageProjectDetail).map((tag: string) => `#${tag}`).join(' ')}`, '标题与标签')">复制</el-button></header><h4>{{ imageProjectVariant(taskImageProjectDetail).title }}</h4><el-tag v-for="tag in imageProjectTags(taskImageProjectDetail)" :key="tag" size="small">#{{ tag }}</el-tag></section><section><header><strong>发布文案</strong><el-button size="small" @click="copyTaskContent(imageProjectCopy(taskImageProjectDetail), '发布文案')">复制</el-button></header><p>{{ imageProjectCopy(taskImageProjectDetail) }}</p></section></div>
                  </section>
                  <div class="image-publish-form">
                    <div v-for="(record, index) in imagePublishRecords" :key="index" class="image-publish-record"><el-select v-model="record.platform"><el-option v-for="item in publishPlatformOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select><el-input v-model="record.remoteUrl" placeholder="粘贴已发布图文链接" /></div>
                    <el-button @click="addImagePublishRecord">添加一个发布平台</el-button><el-button :loading="downloadingImageProject" @click="downloadAllImageProjectPages(taskImageProjectDetail)">一键下载全部</el-button><el-button @click="openImageProjectPreview">预览图文</el-button><el-button type="primary" @click="saveImagePublishLinks">回传发布链接</el-button>
                  </div>
                </template>
              </template>
            </section>
            <section
              v-if="isVideoProjectTask(task) && expandedTaskVideoProjectId === (task.sourceId || task.evidence?.contentPlanId)"
              v-loading="taskVideoProjectLoading"
              class="task-video-workspace"
            >
              <template v-if="taskVideoProjectDetail">
                <header class="task-video-workspace-head">
                  <div>
                    <small>当前阶段 {{ videoFlowStep(taskVideoProjectDetail) }}/{{ isBatchVideoProjectTask(task) ? batchFlowSteps(task).length : 4 }}</small>
                    <h3>{{ isBatchVideoProjectTask(task) ? batchFlowSteps(task)[videoFlowStep(taskVideoProjectDetail) - 1] : videoFlowSteps[videoFlowStep(taskVideoProjectDetail) - 1] }}</h3>
                    <p>{{ videoProjectTaskHint(task) }}</p>
                    <div class="video-project-version-strip">
                      <el-tag size="small" type="info">项目版本 v{{ taskVideoProjectDetail.workflowVersion || 1 }}</el-tag>
                      <el-tag size="small" type="success">{{ videoProjectStageLabel(taskVideoProjectDetail.productionStage) }}</el-tag>
                      <span>后续任务只使用当前已审核版本；旧版本任务会自动停止，不会覆盖新结果。</span>
                    </div>
                    <details class="video-project-more-info">
                      <summary>更多信息</summary>
                      <div>
                        <span v-if="task.projection?.project?.keywords">关键词：{{ task.projection.project.keywords }}</span>
                        <span v-if="task.projection?.project?.platform">发布平台：{{ task.projection.project.platform }}</span>
                        <span>项目模式：{{ videoProjectModeLabel(task) || "标准智能项目" }}</span>
                        <span>项目编号：{{ taskVideoProjectDetail.productionNo || taskVideoProjectDetail.id }}</span>
                      </div>
                    </details>
                  </div>
                  <el-button
                    v-if="projectMode(taskVideoProjectDetail) === 'REFERENCE_DIRECT_FULL_VIDEO'"
                    @click="openProjectReferenceVideo(taskVideoProjectDetail)"
                  >查看参考视频</el-button>
                  <el-button
                    @click="refreshTaskVideoProject"
                  >刷新</el-button>
                  <el-button
                    type="danger"
                    plain
                    :loading="archivingVideoProjectId === taskVideoProjectDetail.id"
                    @click="archiveVideoProject(taskVideoProjectDetail)"
                  >删除项目</el-button>
                </header>

                <nav class="task-video-stage-tabs" aria-label="视频项目阶段">
                  <button
                    v-for="(step, index) in isBatchVideoProjectTask(task) ? batchFlowSteps(task) : videoFlowSteps"
                    :key="step"
                    type="button"
                    :class="{ active: videoFlowStep(taskVideoProjectDetail) === index + 1, done: videoFlowStep(taskVideoProjectDetail) > index + 1 }"
                  >{{ index + 1 }} {{ step }}</button>
                </nav>

                <template v-if="isBatchVideoProjectTask(task)">
                  <section v-if="videoFlowStep(taskVideoProjectDetail) === 2" class="task-video-stage-panel">
                    <h4>批量 Codex 直出</h4>
                    <p>一个项目一个 AI 任务，Codex 统一完成全部视频{{ batchConfigOf(taskVideoProjectDetail)?.generateCoverTitle !== false ? '、封面和标题' : '' }}。</p>
                    <div class="batch-summary-strip">
                      <div><b>{{ batchProgressStats(taskVideoProjectDetail).total }}</b><span>条视频</span></div>
                      <div><b>{{ batchProgressStats(taskVideoProjectDetail).products }}</b><span>个产品</span></div>
                      <div><b>{{ batchProgressStats(taskVideoProjectDetail).done }}</b><span>已完成</span></div>
                      <div><b>{{ batchProgressStats(taskVideoProjectDetail).failed }}</b><span>失败</span></div>
                    </div>
                    <template v-if="activeProjectVideoTask(taskVideoProjectDetail)">
                      <el-progress
                        :percentage="projectVideoTaskProgress(taskVideoProjectDetail)"
                        :status="projectVideoTaskStatus(taskVideoProjectDetail) === 'FAILED' ? 'exception' : undefined"
                      />
                      <p class="project-running-message">{{ projectVideoTaskMessage(taskVideoProjectDetail) }}</p>
                    </template>
                    <el-alert
                      v-if="projectVideoTaskStatus(taskVideoProjectDetail) === 'FAILED'"
                      :title="`批量生成失败：${projectVideoTaskMessage(taskVideoProjectDetail)}`"
                      type="error"
                      :closable="false"
                      show-icon
                    />
                    <div class="batch-video-grid">
                      <article v-for="(video, index) in batchVideos(taskVideoProjectDetail)" :key="video.videoKey" class="batch-video-card">
                        <div class="v-head">
                          <b>{{ video.displayName }}</b>
                          <el-tag size="small" :type="index < batchProgressStats(taskVideoProjectDetail).done ? 'success' : 'warning'">{{ index < batchProgressStats(taskVideoProjectDetail).done ? '已完成' : '生成中' }}</el-tag>
                        </div>
                        <div class="batch-video-thumb"><span class="play">▶</span></div>
                        <div class="batch-video-meta">{{ video.type }} · 对应产品 {{ video.product }} · {{ batchConfigOf(taskVideoProjectDetail)?.generateCoverTitle !== false ? '含封面标题' : '封面标题另行生成' }}</div>
                        <div class="preview-actions" style="margin-top:10px">
                          <el-button size="small" @click="previewBatchVideo(video)">预览</el-button>
                          <el-button size="small" @click="downloadBatchVideo(video)">下载</el-button>
                        </div>
                      </article>
                    </div>
                    <div
                      v-if="batchConfigOf(taskVideoProjectDetail)?.generateCoverTitle === false
                        && ['VIDEO_REVIEW', 'FACTORY_GENERATING', 'EDITING'].includes(String(taskVideoProjectDetail.productionStage || ''))
                        && batchProgressStats(taskVideoProjectDetail).done === batchProgressStats(taskVideoProjectDetail).total
                        && !coverTitleTaskIsRunning(taskVideoProjectDetail)"
                      class="preview-actions"
                      style="margin-top:14px"
                    >
                      <el-button type="primary" @click="submitBatchCoverTitle">生成封面标题</el-button>
                    </div>
                    <div class="preview-actions" style="margin-top:14px">
                      <el-button @click="refreshTaskVideoProject">刷新当前项目</el-button>
                    </div>
                  </section>

                  <section
                    v-else-if="videoFlowStep(taskVideoProjectDetail) === 3
                      && batchConfigOf(taskVideoProjectDetail)?.generateCoverTitle === false
                      && !['PACKAGING_REVIEW', 'READY_TO_PUBLISH', 'PUBLISHING', 'TRACKING'].includes(String(taskVideoProjectDetail.productionStage || ''))"
                    class="task-video-stage-panel"
                  >
                    <h4>封面标题生成</h4>
                    <template v-if="coverTitleTaskIsRunning(taskVideoProjectDetail)">
                      <p>正在为 {{ batchVideos(taskVideoProjectDetail).length }} 条已生成视频制作封面、标题和标签。</p>
                      <el-progress :percentage="coverTitleTaskProgress(taskVideoProjectDetail)" />
                      <p class="project-running-message">{{ coverTitleTaskMessage(taskVideoProjectDetail) }}</p>
                    </template>
                    <el-alert
                      v-else-if="['FAILED', 'WAITING_INPUT', 'CANCELLED'].includes(coverTitleTaskStatus(taskVideoProjectDetail))"
                      :title="`封面标题任务未完成：${coverTitleTaskMessage(taskVideoProjectDetail)}`"
                      type="error"
                      :closable="false"
                      show-icon
                    />
                    <template v-else>
                      <p>视频已生成。提交后 Codex 会为每条视频生成封面、标题和标签，每条视频标签至少 5 个。</p>
                      <div class="preview-actions" style="margin-top:12px">
                        <el-button type="primary" @click="submitBatchCoverTitle">生成封面标题</el-button>
                      </div>
                    </template>
                    <div class="preview-actions" style="margin-top:14px">
                      <el-button @click="refreshTaskVideoProject">刷新当前项目</el-button>
                    </div>
                  </section>

                  <section v-else class="task-video-stage-panel">
                    <template v-if="['READY_TO_PUBLISH', 'PUBLISHING', 'TRACKING'].includes(String(taskVideoProjectDetail.productionStage || ''))">
                      <h4>发布与回传</h4>
                      <p>整批已审核通过。下载文件后，逐条粘贴各平台发布链接并回传。</p>
                      <div class="batch-publish-rows">
                        <div v-for="video in batchVideos(taskVideoProjectDetail)" :key="`publish-${video.videoKey}`" class="batch-publish-row">
                          <b>{{ video.displayName }}</b>
                          <el-button size="small" plain @click="previewBatchVideo(video)">预览成片</el-button>
                          <el-select v-model="batchPublishRecord(String(video.videoKey)).platform">
                            <el-option label="抖音" value="DOUYIN" />
                            <el-option label="快手" value="KUAISHOU" />
                            <el-option label="视频号" value="WECHAT_CHANNELS" />
                            <el-option label="小红书" value="XIAOHONGSHU" />
                            <el-option label="B站" value="BILIBILI" />
                          </el-select>
                          <el-input v-model="batchPublishRecord(String(video.videoKey)).remoteUrl" placeholder="粘贴已发布视频链接" />
                        </div>
                      </div>
                      <div class="preview-actions" style="margin-top:14px">
                        <el-button @click="refreshTaskVideoProject">刷新当前项目</el-button>
                        <el-button type="primary" @click="submitBatchPublish">全部回传完成</el-button>
                      </div>
                    </template>
                    <template v-else>
                      <h4>成片与封面标题审核</h4>
                      <p>成片、封面、标题和标签集中审核，可整批通过，也可填写原因退回。</p>
                      <div class="batch-video-grid">
                        <article v-for="(video, index) in batchVideos(taskVideoProjectDetail)" :key="`review-${video.videoKey}`" class="batch-video-card">
                          <div class="v-head">
                            <b>{{ video.displayName }}</b>
                            <el-tag size="small" :type="video.resultStatus === 'FAILED' ? 'danger' : video.resultStatus === 'GENERATING' ? 'warning' : 'success'">{{ video.resultStatus === 'FAILED' ? '未回传' : video.resultStatus === 'GENERATING' ? '继续生成中' : '成片待审核' }}</el-tag>
                          </div>
                          <template v-if="video.resultStatus === 'FAILED'">
                            <div class="batch-video-thumb"><span>{{ video.failureReason || '该条视频未回传' }}</span></div>
                          </template>
                          <template v-else-if="video.resultStatus === 'GENERATING'">
                            <div class="batch-video-thumb"><span>已回传的成品可先审核；这一条正在继续生成</span></div>
                          </template>
                          <template v-else>
                          <div class="batch-video-thumb"><span class="play">▶</span><span style="margin-left:8px;font-size:12px">00:{{ String(18 + index * 3).padStart(2, '0') }}</span></div>
                          <template v-if="batchConfigOf(taskVideoProjectDetail)?.generateCoverTitle !== false">
                            <div class="batch-cover-line">
                              <button class="batch-cover-thumb" type="button" @click="openBatchCoverPreview(video)">
                                <img v-if="video.coverUrl" :src="video.coverUrl" :alt="`${video.displayName} 封面`" @error="discardBatchCoverUrl(video)" />
                                <template v-else><div><b>赛电 {{ video.productShort }}</b><span>{{ batchVideoCoverMeta(video, index).coverText }}</span></div></template>
                              </button>
                              <div>
                                <div class="batch-cover-title">{{ batchVideoCoverMeta(video, index).title }}</div>
                                <div class="batch-tags"><el-tag v-for="tag in batchVideoCoverMeta(video, index).tags" :key="tag" size="small" type="info">{{ tag }}</el-tag></div>
                                <div class="batch-tags-note">标签 {{ batchVideoCoverMeta(video, index).tags.length }}/5{{ batchVideoCoverMeta(video, index).tags.length < 5 ? "，需补全" : "" }}</div>
                              </div>
                            </div>
                          </template>
                          </template>
                          <div class="preview-actions" style="margin-top:10px">
                            <el-button v-if="video.resultStatus === 'READY'" size="small" @click="previewBatchVideo(video)">预览成片</el-button>
                            <el-button v-if="video.resultStatus === 'READY'" size="small" @click="downloadBatchVideo(video)">下载成片</el-button>
                            <el-button v-if="video.resultStatus === 'FAILED'" size="small" type="primary" @click="retryBatchVideo(video)">仅重试这一条</el-button>
                            <el-button v-else-if="video.resultStatus === 'READY'" size="small" type="danger" plain @click="rejectBatchVideo(video)">退回</el-button>
                          </div>
                        </article>
                      </div>
                      <div class="preview-actions" style="margin-top:14px">
                        <el-button @click="refreshTaskVideoProject">刷新当前项目</el-button>
                        <el-button v-if="batchVideos(taskVideoProjectDetail).every((video) => video.resultStatus === 'READY')" type="danger" plain @click="rejectBatchVideo()">整批退回</el-button>
                        <el-button v-if="batchVideos(taskVideoProjectDetail).every((video) => video.resultStatus === 'READY')" type="success" @click="approveBatchVideo">整批审核通过</el-button>
                      </div>
                    </template>
                  </section>
                </template>

                <section v-if="!isBatchVideoProjectTask(task) && videoFlowStep(taskVideoProjectDetail) === 2 && projectWaitingForScripts(taskVideoProjectDetail)" class="task-video-stage-panel">
                  <h4>脚本与素材匹配中</h4>
                  <p>系统 AI 可直接生成；远程 Codex 会按素材库与风险规则生成。结果返回后会在这里直接编辑。</p>
                  <div class="script-engine-progress">
                    <span
                      v-if="requestedProjectScriptEngines(taskVideoProjectDetail).includes('SYSTEM_AI')"
                      :class="{
                        done: projectScriptEngineStatus(taskVideoProjectDetail).SYSTEM_AI === 'COMPLETED',
                        failed: projectScriptEngineStatus(taskVideoProjectDetail).SYSTEM_AI === 'FAILED',
                      }"
                    >
                      系统 AI 脚本工厂 · {{ scriptEngineStatusText(taskVideoProjectDetail, "SYSTEM_AI") }}
                    </span>
                    <span
                      v-if="requestedProjectScriptEngines(taskVideoProjectDetail).includes('REMOTE_CODEX')"
                      :class="{ done: projectScriptEngineStatus(taskVideoProjectDetail).REMOTE_CODEX === 'COMPLETED' }"
                    >
                      远程 Codex + 剪辑 Skill · {{ projectScriptEngineStatus(taskVideoProjectDetail).REMOTE_CODEX === "COMPLETED" ? "已完成" : "生成中" }}
                    </span>
                  </div>
                  <el-button @click="openSystemScriptConversation(taskVideoProjectDetail)">查看生成对话</el-button>
                  <el-alert
                    v-if="projectScriptEngineStatus(taskVideoProjectDetail).SYSTEM_AI === 'FAILED'"
                    :title="String(projectScriptEngineErrors(taskVideoProjectDetail).SYSTEM_AI || '系统 AI 脚本生成失败')"
                    type="error"
                    :closable="false"
                    show-icon
                  />
                  <el-button
                    v-if="projectScriptEngineStatus(taskVideoProjectDetail).SYSTEM_AI === 'FAILED'"
                    type="primary"
                    :loading="regeneratingSystemScriptProjectId === taskVideoProjectDetail.id"
                    @click="regenerateSystemScript(taskVideoProjectDetail)"
                  >重新生成</el-button>
                  <el-button
                    v-if="projectScriptEngineStatus(taskVideoProjectDetail).SYSTEM_AI === 'FAILED'"
                    :loading="transferringFailedScriptProjectId === taskVideoProjectDetail.id"
                    @click="transferFailedSystemScriptToCodex(taskVideoProjectDetail)"
                  >转交 Codex</el-button>
                </section>

                <section v-if="!isBatchVideoProjectTask(task) && videoFlowStep(taskVideoProjectDetail) === 2 && !projectWaitingForScripts(taskVideoProjectDetail)" class="task-video-stage-panel">
                  <h4>脚本与对应素材</h4>
                  <div class="task-script-candidates" :class="{ single: displayedProjectCandidates(taskVideoProjectDetail).length === 1 }">
                    <article v-for="(candidate, index) in displayedProjectCandidates(taskVideoProjectDetail)" :key="`${taskVideoProjectDetail.id}-task-${index}`">
                      <small>{{ scriptEngineLabel(candidate) }} · {{ candidate.score || 0 }}分</small>
                      <div class="script-material-summary compact-script-materials">
                        <strong>逐句脚本与素材：{{ candidateCoverageSummary(candidate) }}</strong>
                        <div v-for="(shot, shotIndex) in editableCandidateLines(candidate)" :key="shot.lineId || shotIndex" class="script-material-line">
                          <span>{{ shotIndex + 1 }}</span>
                          <el-input
                            :model-value="shot.__editedVoiceover ?? shot.voiceover ?? shot.description"
                            type="textarea"
                            :autosize="{ minRows: 1, maxRows: 3 }"
                            @update:model-value="updateCandidateLine(candidate, shotIndex, $event)"
                          />
                          <div class="script-line-asset">
                            <el-tag size="small" :type="projectShotForScriptLine(taskVideoProjectDetail, shot, shotIndex)?.selectedAssetId || shot.selectedAssetIds?.length ? 'success' : 'warning'">
                              {{ projectShotForScriptLine(taskVideoProjectDetail, shot, shotIndex)?.selectedAssetId || shot.selectedAssetIds?.length ? "已有素材" : "缺失素材" }}
                            </el-tag>
                            <small>{{ scriptLineMaterialDescription(taskVideoProjectDetail, shot, shotIndex) }}</small>
                            <div class="script-line-material-actions">
                              <template v-if="scriptLineVideoAssetId(taskVideoProjectDetail, shot, shotIndex)">
                                <el-button size="small" @click="previewScriptLineAsset(taskVideoProjectDetail, shot, shotIndex)">预览</el-button>
                                <el-button v-if="can('ASSET_UPLOAD')" size="small" @click="uploadScriptLineShot(taskVideoProjectDetail, candidate, shot, shotIndex)">替换素材</el-button>
                              </template>
                              <template v-else>
                                <el-button
                                  v-if="can('ASSET_UPLOAD')"
                                  size="small"
                                  @click="uploadScriptLineShot(taskVideoProjectDetail, candidate, shot, shotIndex)"
                                >上传补拍</el-button>
                                <el-button
                                  size="small"
                                  type="primary"
                                  plain
                                  :loading="generatingShotId === projectShotForScriptLine(taskVideoProjectDetail, shot, shotIndex)?.id"
                                  @click="generateScriptLineShot(taskVideoProjectDetail, candidate, shot, shotIndex)"
                                >AI 生成</el-button>
                              </template>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div v-if="taskVideoProjectDetail.productionStage === 'FACTORY_SCRIPT_READY'" class="preview-actions">
                        <el-button v-if="candidate.scriptPackage" @click="openScriptPackage(candidate)">查看完整脚本</el-button>
                        <el-button
                          type="primary"
                          plain
                          :loading="savingInlineScriptKey === `${taskVideoProjectDetail.id}:${candidateIndexFor(taskVideoProjectDetail, candidate)}`"
                          @click="saveInlineProjectScript(taskVideoProjectDetail, candidate, candidateIndexFor(taskVideoProjectDetail, candidate))"
                        >保存修改</el-button>
                        <el-button
                          v-if="candidate.generationSource === 'SYSTEM_AI'"
                          :loading="regeneratingSystemScriptProjectId === taskVideoProjectDetail.id"
                          @click="regenerateSystemScript(taskVideoProjectDetail)"
                        >重新生成</el-button>
                        <el-button type="success" @click="reviewProjectScript(taskVideoProjectDetail, true, candidateIndexFor(taskVideoProjectDetail, candidate))">确认脚本与素材</el-button>
                        <el-button type="danger" plain @click="candidate.generationSource === 'REMOTE_CODEX' ? reviewProjectScript(taskVideoProjectDetail, false, candidateIndexFor(taskVideoProjectDetail, candidate)) : transferProjectScriptToCodex(taskVideoProjectDetail, candidateIndexFor(taskVideoProjectDetail, candidate))">
                          {{ candidate.generationSource === "REMOTE_CODEX" ? "退回 Codex" : "转交 Codex" }}
                        </el-button>
                      </div>
                    </article>
                  </div>
                </section>

                <section v-if="!isBatchVideoProjectTask(task) && videoFlowStep(taskVideoProjectDetail) === 3" class="task-video-stage-panel">
                  <template v-if="isCodexDirectVideoProject(taskVideoProjectDetail)">
                    <template v-if="codexDirectShouldShowProgress(taskVideoProjectDetail)">
                      <h4>{{ codexDirectTaskTitle(taskVideoProjectDetail) }}</h4>
                      <p v-if="codexDirectRevision(taskVideoProjectDetail)">已把原成片、原任务和退回说明交给 Codex 定向修改；会回传新版本供再次审核。</p>
                      <p v-else>不回传脚本、素材匹配和剪辑细节；这里只展示后台 AI 任务进度。完成后自动进入最终成片审核。</p>
                      <el-progress :percentage="codexDirectTaskProgress(taskVideoProjectDetail)" :status="codexDirectTaskStatus(taskVideoProjectDetail) === 'FAILED' ? 'exception' : undefined" />
                      <p class="project-running-message">{{ codexDirectTaskMessage(taskVideoProjectDetail) }}</p>
                      <el-alert
                        v-if="codexDirectTaskStatus(taskVideoProjectDetail) === 'FAILED'"
                        :title="`直出成片失败：${codexDirectTaskMessage(taskVideoProjectDetail)}`"
                        type="error"
                        :closable="false"
                        show-icon
                      />
                      <div class="preview-actions">
                        <el-button @click="openSystemScriptConversation(taskVideoProjectDetail)">查看 AI 任务</el-button>
                        <el-button @click="refreshVideoProject(taskVideoProjectDetail.id)">刷新当前项目</el-button>
                      </div>
                    </template>
                    <template v-else>
                      <h4>成片审核</h4>
                      <article v-for="job in reviewableVideoRenderJobs(taskVideoProjectDetail)" :key="job.id" class="task-finished-video-row">
                        <div>
                          <strong>{{ job.outputAsset?.displayName || "视频成片" }}</strong>
                          <el-tag size="small" :type="renderStatusType(job)">{{ renderStatusText(job) }}</el-tag>
                        </div>
                        <div class="preview-actions">
                          <el-button v-if="job.outputAsset" @click="openAssetPreview(job.outputAsset, '成片预览')">预览成片</el-button>
                          <el-button v-if="job.status === 'SUCCEEDED' && job.outputAsset?.reviewStatus === 'PENDING'" type="success" @click="openVideoReview(taskVideoProjectDetail, job, 'APPROVE')">审核通过</el-button>
                          <el-button v-if="job.status === 'SUCCEEDED' && job.outputAsset?.reviewStatus === 'PENDING'" type="danger" plain @click="openVideoReview(taskVideoProjectDetail, job, 'RETURN')">退回并填写原因</el-button>
                        </div>
                      </article>
                    </template>
                  </template>
                  <template v-else>
                    <h4>{{ taskVideoProjectDetail.productionStage === "READY_TO_EDIT" ? "素材齐全，可以生成视频" : "视频生成中" }}</h4>
                    <el-button
                      v-if="projectReadyToRender(taskVideoProjectDetail)"
                      type="primary"
                      :loading="renderingProjectId === taskVideoProjectDetail.id"
                      @click="renderWorkbenchProject(taskVideoProjectDetail)"
                    >素材齐全，提交视频生成任务</el-button>
                    <template v-else>
                      <p>远程节点正在按已确认脚本、素材路径、有效时间段和画面事实剪辑，完成后会自动进入成片审核。</p>
                      <el-progress
                        v-if="activeProjectVideoTask(taskVideoProjectDetail)"
                        :percentage="projectVideoTaskProgress(taskVideoProjectDetail)"
                        :status="activeProjectVideoTask(taskVideoProjectDetail)?.status === 'FAILED' ? 'exception' : undefined"
                      />
                      <p v-if="activeProjectVideoTask(taskVideoProjectDetail)" class="project-running-message">{{ projectVideoTaskMessage(taskVideoProjectDetail) }}</p>
                      <div class="preview-actions">
                        <el-button @click="openSystemScriptConversation(taskVideoProjectDetail)">查看 AI 任务</el-button>
                        <el-button @click="refreshTaskVideoProject">刷新当前项目</el-button>
                      </div>
                    </template>
                  </template>
                </section>

                <section v-if="!isBatchVideoProjectTask(task) && (videoFlowStep(taskVideoProjectDetail) === 4 || (videoFlowStep(taskVideoProjectDetail) === 3 && !isCodexDirectVideoProject(taskVideoProjectDetail)))" class="task-video-stage-panel">
                  <h4>{{ videoFlowStep(taskVideoProjectDetail) === 3 ? "成片审核" : "封面标题、发布与回传" }}</h4>
                  <article
                    v-for="job in reviewableVideoRenderJobs(taskVideoProjectDetail)"
                    v-if="videoFlowStep(taskVideoProjectDetail) === 3 || !packagingVariants(taskVideoProjectDetail).length"
                    :key="job.id"
                    class="task-finished-video-row"
                  >
                    <div>
                      <strong>{{ job.outputAsset?.displayName || "视频成片" }}</strong>
                      <el-tag size="small" :type="renderStatusType(job)">{{ renderStatusText(job) }}</el-tag>
                    </div>
                    <div class="preview-actions">
                      <el-button v-if="job.outputAsset" @click="openAssetPreview(job.outputAsset, '成片预览')">预览成片</el-button>
                      <template v-if="job.status === 'SUCCEEDED' && job.outputAsset?.reviewStatus === 'PENDING'">
                        <el-button type="success" @click="openVideoReview(taskVideoProjectDetail, job, 'APPROVE')">审核通过</el-button>
                        <el-button type="danger" plain @click="openVideoReview(taskVideoProjectDetail, job, 'RETURN')">退回并填写原因</el-button>
                      </template>
                      <el-button
                        v-if="job.outputAsset?.reviewStatus === 'APPROVED' && !coverTitleTaskIsRunning(taskVideoProjectDetail) && coverTitleTaskStatus(taskVideoProjectDetail) !== 'PENDING_REVIEW'"
                        type="primary"
                        :loading="generatingPackagingProjectId === taskVideoProjectDetail.id"
                        @click="generateProjectPackaging(taskVideoProjectDetail, job)"
                      >{{ coverTitleTaskNeedsAttention(taskVideoProjectDetail) || packagingVariants(taskVideoProjectDetail).length ? '重新提交封面和标题' : '生成封面和标题' }}</el-button>
                      <el-button
                        v-if="job.outputAsset?.reviewStatus === 'APPROVED' && ['READY_TO_PUBLISH', 'PUBLISHING', 'TRACKING'].includes(String(taskVideoProjectDetail.productionStage || ''))"
                        @click="openPublishLink(taskVideoProjectDetail, job)"
                      >回传发布链接</el-button>
                    </div>
                  </article>
                  <section v-if="videoFlowStep(taskVideoProjectDetail) === 4 && coverTitleTaskIsRunning(taskVideoProjectDetail)" class="project-running-panel">
                    <h4>封面和标题生成中</h4>
                    <p>已提交封面标题任务，完成后会在这里显示封面、标题和审核入口。</p>
                    <el-progress :percentage="coverTitleTaskProgress(taskVideoProjectDetail)" />
                    <p class="project-running-message">{{ coverTitleTaskMessage(taskVideoProjectDetail) }}</p>
                    <div class="preview-actions">
                      <el-button @click="openSystemScriptConversation(taskVideoProjectDetail)">查看 AI 任务</el-button>
                      <el-button @click="refreshTaskVideoProject">刷新当前项目</el-button>
                    </div>
                  </section>
                  <el-alert
                    v-if="videoFlowStep(taskVideoProjectDetail) === 4 && coverTitleTaskNeedsAttention(taskVideoProjectDetail)"
                    :title="`封面标题尚未写入项目：${coverTitleTaskMessage(taskVideoProjectDetail)}`"
                    type="warning"
                    :closable="false"
                    show-icon
                  />
                  <div v-if="videoFlowStep(taskVideoProjectDetail) === 4 && packagingVariants(taskVideoProjectDetail).length" class="video-packaging-result-list">
                    <template v-for="job in reviewableVideoRenderJobs(taskVideoProjectDetail)" :key="`packaging-${job.id}`">
                    <article v-if="job.outputAsset" class="video-packaging-result-card">
                      <button class="video-packaging-video" type="button" @click="openAssetPreview(job.outputAsset, '成片预览')">
                        <img v-if="job.outputAsset?.thumbnailUrl" :src="job.outputAsset.thumbnailUrl" :alt="job.outputAsset?.displayName || '成片预览'" />
                        <el-icon v-else><VideoCamera /></el-icon>
                        <span>预览成片</span>
                      </button>
                      <div class="video-packaging-info">
                        <div v-for="variant in packagingVariants(taskVideoProjectDetail)" :key="variant.id" class="video-packaging-copy">
                          <button
                            class="video-packaging-cover"
                            type="button"
                            :disabled="!variant.coverPath"
                            @click="variant.coverPath && openPackagingPreview(taskVideoProjectDetail, variant)"
                          >
                            <img
                              v-if="packagingCoverUrl(taskVideoProjectDetail, variant)"
                              :src="packagingCoverUrl(taskVideoProjectDetail, variant)"
                              :alt="`${variant.title || '视频'}封面`"
                              @error="discardPackagingCoverUrl(variant)"
                            />
                            <span v-else>{{ packagingCoverText(variant) || '封面生成中' }}</span>
                          </button>
                          <div class="video-packaging-details">
                            <div class="video-packaging-heading">
                              <h5>{{ variant.title || '待生成标题' }}</h5>
                              <el-tag size="small" :type="variant.packagingStatus === 'APPROVED' ? 'success' : variant.packagingStatus === 'RETURNED' ? 'danger' : 'warning'">{{ packagingStatusText(variant) }}</el-tag>
                            </div>
                            <div v-if="packagingHashtags(variant).length" class="packaging-cover-meta">
                              <el-tag v-for="tag in packagingHashtags(variant)" :key="tag" size="small" type="info">#{{ tag }}</el-tag>
                            </div>
                            <p v-if="variant.packagingStatus === 'APPROVED'">封面标题已审核通过，可下载文件并回传发布链接。</p>
                            <p v-else-if="variant.packagingStatus === 'RETURNED'">封面标题已退回，修改说明已同步给生成任务。</p>
                            <p v-else>点击封面可放大查看；核对后直接审核，无需再打开单独的封面卡。</p>
                            <div class="video-packaging-actions">
                              <el-button @click="downloadWorkbenchAsset(job.outputAsset)">下载成片</el-button>
                              <template v-if="variant.packagingStatus === 'APPROVED'">
                                <el-button @click="downloadProjectPackagingCover(taskVideoProjectDetail, variant)">下载封面</el-button>
                                <el-button type="primary" @click="openPublishLink(taskVideoProjectDetail, job)">回传发布链接</el-button>
                              </template>
                              <template v-else-if="variant.packagingStatus === 'PENDING_REVIEW'">
                                <el-button type="danger" plain :loading="reviewingPackagingVariantId === variant.id" @click="reviewProjectPackagingDirect(taskVideoProjectDetail, variant, false)">退回并填写原因</el-button>
                                <el-button type="success" :loading="reviewingPackagingVariantId === variant.id" @click="reviewProjectPackagingDirect(taskVideoProjectDetail, variant, true)">审核通过</el-button>
                              </template>
                              <el-button
                                v-else
                                type="primary"
                                :loading="generatingPackagingProjectId === taskVideoProjectDetail.id"
                                @click="generateProjectPackaging(taskVideoProjectDetail, job)"
                              >重新生成封面和标题</el-button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </article>
                    </template>
                  </div>
                </section>
              </template>
            </section>
          </article>
          <div v-if="taskTotal > taskPageSize" class="task-list-pagination">
            <el-pagination
              small
              background
              layout="total, prev, pager, next"
              :current-page="taskPage"
              :page-size="taskPageSize"
              :total="taskTotal"
              @current-change="changeTaskPage"
            />
          </div>
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
          <div class="workspace-summary asset-summary material-index-summary">
            <strong>系统素材索引 v{{ dataCenter.materialIndex?.indexVersion || 4 }}</strong>
            <span>
              百炼增量学习 · OSS 中转 · 已学习 {{ dataCenter.materialIndex?.indexedAssets || 0 }} 条
              · 待学习 {{ dataCenter.materialIndex?.pendingLearning || 0 }} 条
              · 已停用 {{ dataCenter.materialIndex?.disabledAssets || 0 }} 条
            </span>
            <el-tag :type="Number(dataCenter.materialIndex?.pendingLearning || 0) ? 'warning' : 'success'">
              {{ Number(dataCenter.materialIndex?.pendingLearning || 0) ? "增量同步中" : "索引已就绪" }}
            </el-tag>
          </div>
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
                <strong>{{ videoFlowStep(project) }} / {{ videoFlowSteps.length }} · {{ videoFlowSteps[videoFlowStep(project) - 1] }}</strong>
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
                  <el-button @click="refreshActiveVideoProject">刷新</el-button>
                  <el-button v-if="videoLibraryEntryId(project)" plain @click="openProjectReferenceVideo(project)">查看参考成品</el-button>
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
                <el-tag type="warning">脚本与素材匹配中</el-tag>
                <h3>系统 AI 正在生成脚本并完成逐句素材预匹配</h3>
                <p>如后续转交 Codex，远程结果会作为新版本保留，不会覆盖当前脚本。</p>
                <div class="script-engine-progress">
                  <span
                    v-if="requestedProjectScriptEngines(project).includes('REMOTE_CODEX')"
                    :class="{ done: projectScriptEngineStatus(project).REMOTE_CODEX === 'COMPLETED' }"
                  >
                    远程 Codex + 剪辑 Skill · {{ projectScriptEngineStatus(project).REMOTE_CODEX === "COMPLETED" ? "已完成" : "生成中" }}
                  </span>
                  <span
                    v-if="requestedProjectScriptEngines(project).includes('SYSTEM_AI')"
                    :class="{
                      done: projectScriptEngineStatus(project).SYSTEM_AI === 'COMPLETED',
                      failed: projectScriptEngineStatus(project).SYSTEM_AI === 'FAILED',
                    }"
                  >
                    系统 AI 脚本工厂 · {{ scriptEngineStatusText(project, "SYSTEM_AI") }}
                  </span>
                </div>
                <el-button @click="openSystemScriptConversation(project)">查看生成对话</el-button>
                <el-alert
                  v-if="projectScriptEngineStatus(project).SYSTEM_AI === 'FAILED'"
                  :title="String(projectScriptEngineErrors(project).SYSTEM_AI || '系统 AI 脚本生成失败')"
                  type="error"
                  :closable="false"
                  show-icon
                />
                <el-button
                  v-if="projectScriptEngineStatus(project).SYSTEM_AI === 'FAILED'"
                  type="primary"
                  :loading="regeneratingSystemScriptProjectId === project.id"
                  @click="regenerateSystemScript(project)"
                >重新生成</el-button>
                <el-button
                  v-if="projectScriptEngineStatus(project).SYSTEM_AI === 'FAILED'"
                  :loading="transferringFailedScriptProjectId === project.id"
                  @click="transferFailedSystemScriptToCodex(project)"
                >转交 Codex</el-button>
              </section>
              <div
                v-if="projectCandidates(project).length && videoFlowStep(project) === 2 && !projectWaitingForScripts(project)"
                class="candidate-grid"
                :class="{ single: displayedProjectCandidates(project).length === 1, dual: displayedProjectCandidates(project).length > 1, 'script-review-workspace': true }"
              >
                <article v-for="(candidate, index) in displayedProjectCandidates(project)" :key="`${project.id}-${index}`">
                  <small>{{ scriptEngineLabel(candidate) }} · {{ candidate.score || 0 }}分</small>
                  <p><b>方向：</b>{{ candidate.scriptPackage?.positioning?.coreTheme || project.topic }} · 预计{{ candidate.scriptPackage?.basicInfo?.estimatedDurationSeconds || 30 }}秒</p>
                  <p><b>素材：</b>{{ candidateCoverageSummary(candidate) }}</p>
                  <div class="script-material-summary compact-script-materials">
                    <strong>逐句脚本与素材：{{ candidateCoverageSummary(candidate) }}</strong>
                    <div v-for="(shot, shotIndex) in editableCandidateLines(candidate)" :key="shot.lineId || shotIndex" class="script-material-line">
                      <span>{{ shotIndex + 1 }}</span>
                      <el-input
                        :model-value="shot.__editedVoiceover ?? shot.voiceover ?? shot.description"
                        type="textarea"
                        :autosize="{ minRows: 1, maxRows: 3 }"
                        @update:model-value="updateCandidateLine(candidate, shotIndex, $event)"
                      />
                      <div class="script-line-asset">
                        <el-tag size="small" :type="projectShotForScriptLine(project, shot, shotIndex)?.selectedAssetId || shot.selectedAssetIds?.length ? 'success' : 'warning'">
                          {{ projectShotForScriptLine(project, shot, shotIndex)?.selectedAssetId || shot.selectedAssetIds?.length ? "已有素材" : "缺失素材" }}
                        </el-tag>
                        <small>{{ scriptLineMaterialDescription(project, shot, shotIndex) }}</small>
                        <div class="script-line-material-actions">
                          <template v-if="scriptLineVideoAssetId(project, shot, shotIndex)">
                            <el-button size="small" @click="previewScriptLineAsset(project, shot, shotIndex)">预览</el-button>
                            <el-button v-if="can('ASSET_UPLOAD')" size="small" @click="uploadScriptLineShot(project, candidate, shot, shotIndex)">替换素材</el-button>
                          </template>
                          <template v-else>
                            <el-button
                              v-if="can('ASSET_UPLOAD')"
                              size="small"
                              @click="uploadScriptLineShot(project, candidate, shot, shotIndex)"
                            >上传补拍</el-button>
                            <el-button
                              size="small"
                              type="primary"
                              plain
                              :loading="generatingShotId === projectShotForScriptLine(project, shot, shotIndex)?.id"
                              @click="generateScriptLineShot(project, candidate, shot, shotIndex)"
                            >AI 生成</el-button>
                          </template>
                        </div>
                      </div>
                    </div>
                  </div>
                  <el-button v-if="candidate.scriptPackage" @click="openScriptPackage(candidate)">查看完整脚本</el-button>
                  <template v-if="project.productionStage === 'FACTORY_SCRIPT_READY'">
                    <el-button
                      type="primary"
                      plain
                      :loading="savingInlineScriptKey === `${project.id}:${candidateIndexFor(project, candidate)}`"
                      @click="saveInlineProjectScript(project, candidate, candidateIndexFor(project, candidate))"
                    >保存修改</el-button>
                    <el-button
                      v-if="candidate.generationSource === 'SYSTEM_AI'"
                      :loading="regeneratingSystemScriptProjectId === project.id"
                      @click="regenerateSystemScript(project)"
                    >重新生成</el-button>
                    <el-button
                      type="success"
                      :loading="reviewingScriptProjectId === project.id"
                      @click="reviewProjectScript(project, true, candidateIndexFor(project, candidate))"
                    >确认脚本与素材</el-button>
                    <el-button
                      type="danger"
                      plain
                      :loading="reviewingScriptProjectId === project.id"
                      @click="candidate.generationSource === 'REMOTE_CODEX' ? reviewProjectScript(project, false, candidateIndexFor(project, candidate)) : transferProjectScriptToCodex(project, candidateIndexFor(project, candidate))"
                    >{{ candidate.generationSource === "REMOTE_CODEX" ? "退回 Codex" : "转交 Codex" }}</el-button>
                  </template>
                  <el-tag v-else-if="project.productionStage === 'SCRIPT_APPROVED'" type="success">脚本已审核通过</el-tag>
                </article>
              </div>
              <div v-if="project.videoShots?.length && videoFlowStep(project) === 2" class="shot-panel">
                <button type="button" class="shot-summary" @click="toggleVideoProjectShots(project.id)">
                  <span>已形成 {{ project.videoShots.length }} 个镜头任务 · {{ project.videoShots.filter((shot: Row) => !shot.selectedAssetId).length }} 个镜头待补拍或生成</span>
                  <b>{{ expandedVideoProjectIds.includes(project.id) ? "收起镜头任务" : "查看镜头任务" }}</b>
                </button>
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
                <template v-if="isCodexDirectVideoProject(project)">
                  <h3>远程 Codex 正在直出成片</h3>
                  <p>不回传脚本、素材匹配或剪辑细节；这里只显示后台 AI 任务进度，成片完成后自动进入最终审核。</p>
                  <el-progress :percentage="codexDirectTaskProgress(project)" :status="codexDirectTaskStatus(project) === 'FAILED' ? 'exception' : undefined" />
                  <p class="project-running-message">{{ codexDirectTaskMessage(project) }}</p>
                  <el-alert
                    v-if="codexDirectTaskStatus(project) === 'FAILED'"
                    :title="`直出成片失败：${codexDirectTaskMessage(project)}`"
                    type="error"
                    :closable="false"
                    show-icon
                  />
                  <div class="preview-actions">
                    <el-button @click="openSystemScriptConversation(project)">查看 AI 任务</el-button>
                    <el-button @click="refreshVideoProject(project.id)">刷新当前项目</el-button>
                  </div>
                </template>
                <template v-else>
                  <h3>远程 Codex 正在使用已确认脚本和绑定素材剪辑</h3>
                  <p>系统已向远程节点提供每个脚本位置对应的素材路径、有效时间段、画面事实和使用限制。成片完成后自动进入审核。</p>
                  <el-steps :active="3" finish-status="success" simple>
                    <el-step title="素材清单已锁定" /><el-step title="配音字幕处理中" /><el-step title="剪辑包装与质检" /><el-step title="等待成片回传" />
                  </el-steps>
                </template>
              </section>
              <section v-if="videoFlowStep(project) >= 3" class="finished-video-panel">
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
                <div v-if="packagingVariants(project).length" class="packaging-result-list">
                  <article v-for="variant in packagingVariants(project)" :key="variant.id" class="packaging-result-card">
                    <div class="packaging-result-cover">
                      <img
                        v-if="packagingCoverUrl(project, variant)"
                        :src="packagingCoverUrl(project, variant)"
                        :alt="`${variant.title || '视频'}封面`"
                        @error="discardPackagingCoverUrl(variant)"
                      />
                      <span v-else>{{ packagingCoverText(variant) || '封面生成中' }}</span>
                    </div>
                    <div class="packaging-result-copy">
                      <strong>{{ variant.title || "待生成标题" }}</strong>
                      <div v-if="packagingHashtags(variant).length" class="packaging-cover-meta">
                        <el-tag v-for="tag in packagingHashtags(variant)" :key="tag" size="small" type="info">#{{ tag }}</el-tag>
                      </div>
                    </div>
                    <el-button @click="openPackagingPreview(project, variant)">查看封面</el-button>
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
      <section v-if="taskQualityWarnings(taskDetail).length" class="task-detail-section">
        <h3>质量提醒</h3>
        <el-alert
          v-for="warning in taskQualityWarnings(taskDetail)"
          :key="`${warning.validator}:${warning.summary}`"
          type="warning"
          :title="String(warning.summary || '存在可优化项')"
          :description="`${warning.validator || '官方校验'} · ${warning.recommendation || '成片可交付；如需优化，请在审核中退回并说明具体画面问题。'}`"
          :closable="false"
          show-icon
        />
      </section>
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

  <el-dialog v-model="taskRecycleBinVisible" title="回收站" width="min(820px, 94vw)">
    <p class="muted">删除内容保留 3 天，超期自动彻底删除。恢复项目时会同时恢复员工任务与项目本体。</p>
    <el-tabs v-model="recycleCategory" class="recycle-tabs">
      <el-tab-pane :label="`普通任务 (${recycledNormalTasks.length})`" name="TASK">
        <div v-loading="taskRecycleBinLoading" class="task-recycle-list">
          <article v-for="task in pagedRecycledNormalTasks" :key="task.id" class="task-recycle-item">
            <div>
              <div class="task-meta"><el-tag size="small" type="info">{{ recycleTaskTypeLabel(task) }}</el-tag><span>删除于 {{ formatTime(task.deletedAt) }}</span><span class="recycle-countdown">{{ recycleRemaining(task) }}</span></div>
              <h4>{{ task.title }}</h4>
              <p class="task-summary">{{ task.description || task.expectedResult || "未填写任务说明" }}</p>
            </div>
            <el-button type="primary" plain :loading="restoringTaskId === task.id" @click="restoreRecycledTask(task)">恢复</el-button>
          </article>
          <el-empty v-if="!taskRecycleBinLoading && !recycledNormalTasks.length" description="暂无已删除的普通任务" />
          <el-pagination v-if="recycledNormalTasks.length > recyclePageSize" v-model:current-page="recyclePages.TASK" small background layout="prev, pager, next" :page-size="recyclePageSize" :total="recycledNormalTasks.length" />
        </div>
      </el-tab-pane>
      <el-tab-pane :label="`视频项目 (${videoRecycleProjects.length})`" name="VIDEO">
        <div v-loading="videoRecycleBinLoading" class="task-recycle-list">
          <article v-for="project in pagedRecycledVideoProjects" :key="project.id" class="task-recycle-item">
            <div><div class="task-meta"><el-tag size="small">视频项目</el-tag><el-tag size="small" type="warning">删除前：{{ recycleProjectStageLabel(project.previousProductionStage, "VIDEO") }}</el-tag><span>删除于 {{ formatTime(project.archivedAt) }}</span><span class="recycle-countdown">{{ recycleRemainingText(project) }}</span></div><h4>{{ project.topic }}</h4><p class="task-summary">{{ project.productModel || "未填写产品型号" }}</p></div>
            <el-button type="primary" plain :loading="restoringVideoProjectId === project.id" @click="restoreVideoProject(project)">恢复</el-button>
          </article>
          <el-empty v-if="!videoRecycleBinLoading && !recycledVideoProjects.length" description="暂无已删除的视频项目" />
          <el-pagination v-if="recycledVideoProjects.length > recyclePageSize" v-model:current-page="recyclePages.VIDEO" small background layout="prev, pager, next" :page-size="recyclePageSize" :total="recycledVideoProjects.length" />
        </div>
      </el-tab-pane>
      <el-tab-pane :label="`图文项目 (${recycledImageProjects.length})`" name="IMAGE">
        <div v-loading="taskRecycleBinLoading" class="task-recycle-list">
          <article v-for="task in pagedRecycledImageProjects" :key="task.id" class="task-recycle-item">
            <div><div class="task-meta"><el-tag size="small" type="success">图文项目</el-tag><el-tag size="small" type="warning">删除前：{{ recycleProjectStageLabel(task.recyclePreviousStage, "IMAGE") }}</el-tag><span>删除于 {{ formatTime(task.deletedAt) }}</span><span class="recycle-countdown">{{ recycleRemaining(task) }}</span></div><h4>{{ task.title }}</h4><p class="task-summary">{{ task.description || task.expectedResult || "图文项目" }}</p></div>
            <el-button type="primary" plain :loading="restoringTaskId === task.id" @click="restoreRecycledImageProject(task)">恢复</el-button>
          </article>
          <el-empty v-if="!taskRecycleBinLoading && !recycledImageProjects.length" description="暂无已删除的图文项目" />
          <el-pagination v-if="recycledImageProjects.length > recyclePageSize" v-model:current-page="recyclePages.IMAGE" small background layout="prev, pager, next" :page-size="recyclePageSize" :total="recycledImageProjects.length" />
        </div>
      </el-tab-pane>
      <el-tab-pane :label="`软文项目 (${recycledArticleProjects.length})`" name="ARTICLE">
        <div v-loading="taskRecycleBinLoading" class="task-recycle-list">
          <article v-for="task in pagedRecycledArticleProjects" :key="task.id" class="task-recycle-item">
            <div><div class="task-meta"><el-tag size="small" type="warning">软文项目</el-tag><span>删除于 {{ formatTime(task.deletedAt) }}</span><span class="recycle-countdown">{{ recycleRemaining(task) }}</span></div><h4>{{ task.title }}</h4><p class="task-summary">{{ task.description || task.expectedResult || "软文项目" }}</p></div>
            <el-button type="primary" plain :loading="restoringTaskId === task.id" @click="restoreRecycledTask(task)">恢复</el-button>
          </article>
          <el-empty v-if="!taskRecycleBinLoading && !recycledArticleProjects.length" description="暂无已删除的软文项目" />
          <el-pagination v-if="recycledArticleProjects.length > recyclePageSize" v-model:current-page="recyclePages.ARTICLE" small background layout="prev, pager, next" :page-size="recyclePageSize" :total="recycledArticleProjects.length" />
        </div>
      </el-tab-pane>
    </el-tabs>
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
        <h3>{{ packagingPreviewVariant.title || "待生成标题" }}</h3>
        <div v-if="packagingHashtags(packagingPreviewVariant).length" class="packaging-hashtags">
          <el-tag v-for="tag in packagingHashtags(packagingPreviewVariant)" :key="tag" size="small" type="info">#{{ tag }}</el-tag>
        </div>
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

  <el-dialog v-model="batchCoverPreviewVisible" title="封面放大查看" width="min(560px, 92vw)" destroy-on-close>
    <div v-if="batchCoverPreviewVideo" class="batch-cover-preview">
      <img v-if="batchCoverPreviewUrl" :src="batchCoverPreviewUrl" :alt="`${batchCoverPreviewVideo.displayName || '视频'} 封面`" />
      <div class="batch-cover-preview-meta">
        <h3>{{ batchCoverPreviewVideo.resultTitle || '标题未回传' }}</h3>
        <div v-if="batchCoverPreviewVideo.resultTags?.length" class="batch-tags">
          <el-tag v-for="tag in batchCoverPreviewVideo.resultTags" :key="tag" size="small" type="info">{{ tag }}</el-tag>
        </div>
        <p v-else>标签未回传</p>
      </div>
    </div>
    <template #footer>
      <el-button type="primary" @click="batchCoverPreviewVisible = false">关闭</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="newImageProjectVisible" title="新建图文项目" width="min(920px, 96vw)" destroy-on-close>
    <div class="prototype-project-form image-project-form">
      <el-alert :title="imageProjectMode === 'BATCH' ? '批量图文：多个产品、多组图文只作为一个项目、只提交一个 AI 任务，一次性同步生成图文页、标题、标签和发布文案。' : '填写图文制作要求后创建项目。系统会生成图文初稿、标题、标签和发布文案，员工只需审核；所有内容都会自动保存。'" type="info" :closable="false" />
      <el-radio-group v-model="imageProjectMode" class="project-mode-switch" style="margin-top:12px">
        <el-radio-button label="SINGLE">单组图文</el-radio-button>
        <el-radio-button label="BATCH">批量图文</el-radio-button>
      </el-radio-group>
      <template v-if="imageProjectMode === 'SINGLE'">
      <section class="prototype-form-section">
        <header><strong>必填信息</strong><span>产品型号、图文类型、目标人群/场景和主钩子方向为必填项</span></header>
        <div class="prototype-required-grid image-project-required-grid">
          <el-form-item label="产品型号" required>
            <el-select v-model="imageProjectForm.productModel" filterable placeholder="搜索或选择产品型号" @change="syncImageProjectRequirement">
              <el-option v-for="product in productOptions" :key="product.id" :label="`${product.modelCode} · ${product.name}`" :value="product.modelCode" />
            </el-select>
          </el-form-item>
          <el-form-item label="图文类型" required>
            <el-select v-model="imageProjectForm.imageType" filterable allow-create default-first-option @change="changeImageProjectType">
              <el-option v-for="item in imageProjectTypes" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="目标人群/场景" required>
            <el-select v-model="imageProjectForm.audience" filterable allow-create default-first-option placeholder="选择或填写目标人群/场景" @change="syncImageProjectRequirement">
              <el-option v-for="item in imageSuggestionsForType(imageProjectForm.imageType).audiences" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="主钩子方向" required>
            <el-select v-model="imageProjectForm.hook" filterable allow-create default-first-option placeholder="选择或填写主钩子方向" @change="syncImageProjectRequirement">
              <el-option v-for="item in imageSuggestionsForType(imageProjectForm.imageType).hooks" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
        </div>
      </section>
      <section class="image-viral-topic-section">
        <header><strong>常见爆款选题</strong><span>按当前图文类型推荐，点击即可填入主钩子和目标人群</span></header>
        <div class="image-viral-topic-list">
          <button
            v-for="topic in imageViralTopicsForType(imageProjectForm.imageType)"
            :key="`${topic.hook}-${topic.audience}`"
            type="button"
            class="image-viral-topic"
            @click="applyImageViralTopic(topic)"
          ><b>{{ topic.hook }}</b><span>{{ topic.audience }}</span></button>
        </div>
      </section>
      <section class="prototype-form-section">
        <header><strong>可选创作信息</strong><span>竞品、补充创意或额外提示会自动写入任务要求</span></header>
        <div class="prototype-optional-grid image-project-optional-grid">
          <el-form-item label="竞品或对比对象"><el-input v-model="imageProjectForm.competitor" placeholder="如 D2、小米 H1E" @input="syncImageProjectRequirement" /></el-form-item>
          <el-form-item label="补充创意"><el-input v-model="imageProjectForm.creativeIntent" placeholder="如最后一页放送礼选择建议" @input="syncImageProjectRequirement" /></el-form-item>
          <el-form-item class="wide" label="补充 AI 提示词"><el-input v-model="imageProjectForm.additionalPrompt" type="textarea" :rows="3" placeholder="填写希望加强或避免的表达；未填写时由图文 Skill 自行创作" @input="syncImageProjectRequirement" /></el-form-item>
        </div>
      </section>
      <section class="prototype-form-section image-task-requirement">
        <header><strong>提交给图文制作 Skill 的任务要求</strong><span>仅提交这段内容，可直接修改</span></header>
        <el-input v-model="imageProjectForm.requirement" type="textarea" :rows="3" @input="markImageRequirementEdited" />
      </section>
      </template>
      <template v-else>
      <section class="prototype-form-section">
        <header><strong>批量任务</strong><span>每个产品选择图文数量，所有产品合计最多 10 组（最多 5 个产品）</span></header>
        <div v-for="(product, index) in imageProjectForm.batchProducts" :key="`batch-image-product-${index}`" class="batch-product-row">
          <el-form-item :label="`产品 ${index + 1}`" required>
            <el-select v-model="product.model" filterable placeholder="搜索或选择产品型号" @change="syncBatchImageTaskRequirement">
              <el-option v-for="option in productOptions" :key="option.id" :label="`${option.modelCode} · ${option.name}`" :value="option.modelCode" />
            </el-select>
          </el-form-item>
          <el-form-item label="图文数量">
            <el-select v-model="product.count" @change="syncBatchImageTaskRequirement">
              <el-option v-for="count in [2,3,4,5,6,7,8,9,10]" :key="count" :label="`${count} 组`" :value="count" />
            </el-select>
          </el-form-item>
          <el-button v-if="imageProjectForm.batchProducts.length > 1" type="danger" plain @click="removeBatchImageProduct(index)">移除</el-button>
          <span v-else></span>
        </div>
        <div class="batch-allocation-hint" :class="{ error: batchImageTotalGroups() > 10 }">
          <template v-if="batchImageTotalGroups() === 0">请为每个产品选择图文数量。</template>
          <template v-else-if="batchImageTotalGroups() > 10">当前合计 {{ batchImageTotalGroups() }} 组，超过上限 10 组。</template>
          <template v-else>合计 {{ batchImageTotalGroups() }} 组（最多 10 组）。</template>
        </div>
        <el-button type="primary" plain :disabled="imageProjectForm.batchProducts.length >= 5" @click="addBatchImageProduct">+ 添加产品</el-button>
      </section>
      <section class="prototype-form-section">
        <header><strong>类型总量</strong><span>填写各类型总组数后，系统会自动整理为逐组执行清单；不需要手动逐一分配</span></header>
        <div v-for="(row, index) in imageProjectForm.batchTypes" :key="`batch-image-type-${index}`" class="batch-product-row">
          <el-form-item :label="`类型 ${index + 1}`" required>
            <el-select v-model="row.type" @change="syncBatchImageTaskRequirement">
              <el-option v-for="item in imageProjectTypes" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="组数">
            <el-select v-model="row.count" @change="syncBatchImageTaskRequirement">
              <el-option v-for="count in [1,2,3,4,5,6,7,8,9,10]" :key="count" :label="`${count} 组`" :value="count" />
            </el-select>
          </el-form-item>
          <el-button v-if="imageProjectForm.batchTypes.length > 1" type="danger" plain @click="removeBatchImageType(index)">移除</el-button>
          <span v-else></span>
        </div>
        <div class="batch-allocation-hint" :class="{ error: batchImageTypeTotal() !== batchImageTotalGroups() }">
          <template v-if="batchImageTypeTotal() !== batchImageTotalGroups()">类型组数合计 {{ batchImageTypeTotal() }} 组，与图文总量 {{ batchImageTotalGroups() }} 组不一致。</template>
          <template v-else>类型组数合计 {{ batchImageTypeTotal() }} 组，与图文总量一致；下方会给出唯一的逐组执行清单。</template>
        </div>
        <el-button type="primary" plain @click="addBatchImageType">+ 添加类型</el-button>
      </section>
      <section v-if="batchImageTypeTotal() === batchImageTotalGroups() && plannedBatchImageGroups().length" class="prototype-form-section">
        <header><strong>逐组执行清单</strong><span>此清单会原样写入任务要求，并作为唯一执行依据</span></header>
        <div class="batch-allocation-hint">
          <div v-for="(group, index) in plannedBatchImageGroups()" :key="`${group.groupKey}-${group.type}`">
            {{ index + 1 }}. {{ group.product }}｜{{ group.type }}｜第 {{ group.groupKey.split('-')[1] }} 组
          </div>
        </div>
      </section>
      <section class="prototype-form-section">
        <header><strong>批量创作设置</strong><span>补充提示词会自动写入任务要求</span></header>
        <el-form-item label="补充 AI 提示词">
          <el-input v-model="imageProjectForm.additionalPrompt" type="textarea" :rows="3" placeholder="例如：整体真实温暖，各产品方向尽量错开" @input="syncBatchImageTaskRequirement" />
        </el-form-item>
      </section>
      <section class="prototype-form-section batch-task-requirement">
        <header><strong>提交给图文制作 Skill 的任务要求</strong><span>系统自动整理为唯一执行清单；补充要求请在上方填写</span></header>
        <el-input v-model="imageProjectForm.batchTaskRequirement" type="textarea" :rows="6" readonly />
      </section>
      </template>
    </div>
    <template #footer>
      <el-button @click="newImageProjectVisible = false">取消</el-button>
      <el-button type="primary" :loading="creatingImageProject" @click="createImageProject">{{ imageProjectMode === 'BATCH' ? '创建批量项目并提交任务' : '创建项目并生成图文' }}</el-button>
    </template>
  </el-dialog>

  <el-dialog v-if="false" v-model="imageProjectVisible" :title="taskImageProjectDetail?.topic || '图文项目'" width="min(1120px, 96vw)" destroy-on-close>
    <div v-if="taskImageProjectDetail" class="task-video-stage-panel image-project-workspace" v-loading="taskImageProjectLoading">
      <header class="task-video-workspace-head">
        <div>
          <small>当前阶段 {{ imageProjectTaskStep({ projection: { project: { step: taskImageProjectDetail.productionStage === 'IMAGE_PUBLISHING' || taskImageProjectDetail.productionStage === 'IMAGE_PUBLISHED' ? 3 : taskImageProjectDetail.productionStage === 'IMAGE_REVIEW' || taskImageProjectDetail.productionStage === 'IMAGE_RETURNED' ? 2 : 1 } } }) }}/3</small>
          <h3>{{ taskImageProjectDetail.productionStage === 'IMAGE_PUBLISHING' || taskImageProjectDetail.productionStage === 'IMAGE_PUBLISHED' ? '发布与回传' : '图文与文案生成、审核' }}</h3>
          <p>{{ taskImageProjectDetail.productionStage === 'IMAGE_GENERATING' ? '系统正在生成图文、标题、标签和发布文案。' : taskImageProjectDetail.productionStage === 'IMAGE_RETURNED' ? '系统正按退回意见修改图文和文案。' : taskImageProjectDetail.productionStage === 'IMAGE_REVIEW' ? '请查看图文、标题标签和发布文案后审核。' : '下载图文并回传发布链接。' }}</p>
        </div>
        <el-button @click="refreshImageProject">刷新当前项目</el-button>
      </header>
      <nav class="task-video-stage-tabs" aria-label="图文项目阶段">
        <button v-for="(step, index) in imageFlowSteps" :key="step" type="button" :class="{ active: (taskImageProjectDetail.productionStage === 'IMAGE_PUBLISHING' || taskImageProjectDetail.productionStage === 'IMAGE_PUBLISHED' ? 3 : taskImageProjectDetail.productionStage === 'IMAGE_REVIEW' || taskImageProjectDetail.productionStage === 'IMAGE_RETURNED' ? 2 : 1) === index + 1, done: (taskImageProjectDetail.productionStage === 'IMAGE_PUBLISHING' || taskImageProjectDetail.productionStage === 'IMAGE_PUBLISHED' ? 3 : taskImageProjectDetail.productionStage === 'IMAGE_REVIEW' || taskImageProjectDetail.productionStage === 'IMAGE_RETURNED' ? 2 : 1) > index + 1 }">{{ index + 1 }} {{ step }}</button>
      </nav>
      <template v-if="['IMAGE_GENERATING', 'IMAGE_RETURNED'].includes(taskImageProjectDetail.productionStage)">
        <el-empty :description="taskImageProjectDetail.productionStage === 'IMAGE_RETURNED' ? '正在按退回意见重新生成图文和文案' : '正在生成图文和文案'" />
      </template>
      <template v-else-if="taskImageProjectDetail.productionStage === 'IMAGE_REVIEW'">
        <section class="image-result-layout">
          <div class="image-page-list">
            <article v-for="(page, index) in imageProjectPages(taskImageProjectDetail)" :key="page.id || index" class="image-page-card">
              <img v-if="imageProjectPageUrl(page)" :src="imageProjectPageUrl(page)" :alt="page.title || `第${index + 1}页`" />
              <div v-else><el-tag size="small">第 {{ index + 1 }} 页</el-tag><strong>{{ page.title || `第 ${index + 1} 页图文` }}</strong><p>{{ page.copy || page.description || '图文内容已生成' }}</p></div>
            </article>
          </div>
          <div class="image-copy-panels">
            <section><header><strong>标题与标签</strong><el-button size="small" @click="copyTaskContent(`${imageProjectVariant(taskImageProjectDetail).title || ''}\n${imageProjectTags(taskImageProjectDetail).map((tag: string) => `#${tag}`).join(' ')}`, '标题与标签')">复制</el-button></header><h4>{{ imageProjectVariant(taskImageProjectDetail).title }}</h4><el-tag v-for="tag in imageProjectTags(taskImageProjectDetail)" :key="tag" size="small">#{{ tag }}</el-tag></section>
            <section><header><strong>发布文案</strong><el-button size="small" @click="copyTaskContent(imageProjectCopy(taskImageProjectDetail), '发布文案')">复制</el-button></header><p>{{ imageProjectCopy(taskImageProjectDetail) || '发布文案已随图文生成' }}</p></section>
          </div>
        </section>
        <div class="preview-actions">
          <el-button @click="openImageProjectPreview">预览图文</el-button>
          <el-button :loading="downloadingImageProject" @click="downloadAllImageProjectPages(taskImageProjectDetail)">一键下载全部</el-button>
          <el-button type="danger" plain :loading="reviewingImageProject" @click="reviewImageProject(false)">退回并填写原因</el-button>
          <el-button type="success" :loading="reviewingImageProject" @click="reviewImageProject(true)">图文审核通过</el-button>
        </div>
      </template>
      <template v-else>
        <section class="image-result-layout published">
          <div class="image-page-list"><article v-for="(page, index) in imageProjectPages(taskImageProjectDetail)" :key="page.id || index" class="image-page-card"><img v-if="imageProjectPageUrl(page)" :src="imageProjectPageUrl(page)" :alt="page.title || `第${index + 1}页`" /><div v-else><strong>{{ page.title || `第 ${index + 1} 页图文` }}</strong></div></article></div>
          <div class="image-copy-panels"><section><header><strong>标题与标签</strong><el-button size="small" @click="copyTaskContent(`${imageProjectVariant(taskImageProjectDetail).title || ''}\n${imageProjectTags(taskImageProjectDetail).map((tag: string) => `#${tag}`).join(' ')}`, '标题与标签')">复制</el-button></header><h4>{{ imageProjectVariant(taskImageProjectDetail).title }}</h4><el-tag v-for="tag in imageProjectTags(taskImageProjectDetail)" :key="tag" size="small">#{{ tag }}</el-tag></section><section><header><strong>发布文案</strong><el-button size="small" @click="copyTaskContent(imageProjectCopy(taskImageProjectDetail), '发布文案')">复制</el-button></header><p>{{ imageProjectCopy(taskImageProjectDetail) }}</p></section></div>
        </section>
        <div class="image-publish-form">
          <div v-for="(record, index) in imagePublishRecords" :key="index" class="image-publish-record"><el-select v-model="record.platform"><el-option v-for="item in publishPlatformOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select><el-input v-model="record.remoteUrl" placeholder="粘贴已发布图文链接" /></div>
          <el-button @click="addImagePublishRecord">添加一个发布平台</el-button>
          <el-button :loading="downloadingImageProject" @click="downloadAllImageProjectPages(taskImageProjectDetail)">一键下载全部</el-button>
          <el-button @click="openImageProjectPreview">预览并下载图文</el-button>
          <el-button type="primary" @click="saveImagePublishLinks">回传发布链接</el-button>
        </div>
      </template>
    </div>
    <template #footer><el-button @click="imageProjectVisible = false">关闭</el-button></template>
  </el-dialog>

  <el-dialog v-model="imageProjectPreviewVisible" title="图文预览" width="min(760px, 96vw)" class="image-preview-dialog">
    <div v-if="currentImageProjectPreviewPage" class="image-preview-viewer">
      <button
        class="image-preview-nav image-preview-nav-prev"
        type="button"
        aria-label="上一张"
        :disabled="imageProjectPreviewIndex === 0"
        @click="changeImageProjectPreviewPage(-1)"
      >‹</button>
      <div class="image-preview-stage">
        <img
          v-if="imageProjectPageUrl(currentImageProjectPreviewPage)"
          :src="imageProjectPageUrl(currentImageProjectPreviewPage)"
          :alt="currentImageProjectPreviewPage.title || `第${imageProjectPreviewIndex + 1}页`"
        />
        <div v-else class="image-preview-fallback">
          <strong>{{ currentImageProjectPreviewPage.title || `第 ${imageProjectPreviewIndex + 1} 页图文` }}</strong>
          <p>{{ currentImageProjectPreviewPage.copy || currentImageProjectPreviewPage.description }}</p>
        </div>
      </div>
      <button
        class="image-preview-nav image-preview-nav-next"
        type="button"
        aria-label="下一张"
        :disabled="imageProjectPreviewIndex >= imageProjectPreviewPages.length - 1"
        @click="changeImageProjectPreviewPage(1)"
      >›</button>
      <div class="image-preview-counter">{{ imageProjectPreviewIndex + 1 }} / {{ imageProjectPreviewPages.length }}</div>
    </div>
    <el-empty v-else description="暂无可预览的图文" />
    <template #footer>
      <a
        v-if="currentImageProjectPreviewPage && imageProjectPageUrl(currentImageProjectPreviewPage)"
        class="image-preview-download"
        :href="imageProjectPageUrl(currentImageProjectPreviewPage)"
        target="_blank"
        :download="imageProjectPageFileName(currentImageProjectPreviewPage, imageProjectPreviewIndex)"
      >下载本页</a>
      <el-button :loading="downloadingImageProject" @click="downloadAllImageProjectPages(taskImageProjectDetail)">一键下载全部</el-button>
      <el-button type="primary" @click="imageProjectPreviewVisible = false">完成预览</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="newVideoProjectVisible" title="新建智能视频项目" width="min(980px, 96vw)" destroy-on-close>
    <div v-if="!createdVideoProjectDialogId" v-loading="videoProjectOptionsLoading" class="prototype-project-form">
      <el-alert title="填写项目要求并创建后，系统 AI 会立即生成脚本并同步匹配素材；不满意时可重新生成或转交 Codex。" type="info" :closable="false" />

      <el-radio-group v-model="videoProjectMode" class="project-mode-switch">
        <el-radio-button label="STANDARD">标准智能项目</el-radio-button>
        <el-radio-button label="REFERENCE_DIRECT_FULL_VIDEO">参考视频直出</el-radio-button>
        <el-radio-button label="CODEX_DIRECT_FULL_VIDEO">Codex 直出视频</el-radio-button>
        <el-radio-button label="BATCH_CODEX_DIRECT_FULL_VIDEO">批量Codex直出</el-radio-button>
      </el-radio-group>
      <p v-if="videoProjectMode === 'REFERENCE_DIRECT_FULL_VIDEO'" class="project-mode-help">
        只需提供参考视频链接。项目会直接交给远程 Codex 完成脚本、素材匹配、剪辑和成片，默认参考其节奏与可访问的 BGM；员工只需审核最终成片。
      </p>
      <p v-else-if="videoProjectMode === 'CODEX_DIRECT_FULL_VIDEO'" class="project-mode-help">
        只需选择产品型号并填写 AI 提示词。项目会直接交给远程 Codex 完成脚本、素材匹配、剪辑和成片；中间过程不回传，员工只审核最终成片。
      </p>
      <p v-else-if="videoProjectMode === 'BATCH_CODEX_DIRECT_FULL_VIDEO'" class="project-mode-help">
        多个产品、多条视频只作为一个项目、只提交一个 AI 任务。每个产品选择视频数量，所有产品合计最多 10 条；Codex 统一完成全部视频和封面标题，员工最终一次性审核。
      </p>

      <section v-if="videoProjectMode === 'STANDARD'" class="prototype-form-section">
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

      <section v-else-if="videoProjectMode === 'REFERENCE_DIRECT_FULL_VIDEO'" class="prototype-form-section">
        <header><strong>参考视频</strong><span>此模式仅需产品型号和参考视频链接</span></header>
        <div class="prototype-reference-grid reference-video-fields">
          <el-form-item label="产品型号" required>
            <el-select v-model="videoFactoryForm.productModel" filterable placeholder="搜索或选择产品型号" @change="syncReferenceDirectTaskRequirement">
              <el-option v-for="product in productOptions" :key="product.id" :label="`${product.modelCode} · ${product.name}`" :value="product.modelCode" />
            </el-select>
          </el-form-item>
          <el-form-item class="reference-video-url-field" label="参考视频链接" required>
            <el-input v-model="videoFactoryForm.referenceVideoUrl" placeholder="粘贴可访问的参考视频链接" @input="syncReferenceDirectTaskRequirement" />
          </el-form-item>
        </div>
        <el-form-item label="音频策略" required>
          <el-radio-group v-model="videoFactoryForm.referenceAudioStrategy" @change="syncReferenceDirectTaskRequirement">
            <el-radio-button value="REFERENCE_ORIGINAL">保留参考原声</el-radio-button>
            <el-radio-button value="DOUBAO_REVOICE">重配口播（豆包）</el-radio-button>
          </el-radio-group>
          <div class="form-tip">保留原声会沿用完整可用音轨；重配口播只使用已配置的豆包语音，绝不使用 Windows 默认配音。</div>
        </el-form-item>
      </section>

      <section v-if="videoProjectMode === 'REFERENCE_DIRECT_FULL_VIDEO'" class="prototype-form-section">
        <header><strong>提交给剪辑 Skill 的创意要求</strong><span>系统会自动附加参考视频、音频策略和交付规则，可直接修改此处内容</span></header>
        <el-input
          v-model="videoFactoryForm.referenceDirectTaskRequirement"
          type="textarea"
          :rows="5"
          @input="markReferenceDirectRequirementEdited"
        />
      </section>

      <section v-if="videoProjectMode === 'CODEX_DIRECT_FULL_VIDEO'" class="prototype-form-section">
        <header><strong>Codex 直出视频</strong><span>仅需产品型号和 AI 提示词</span></header>
        <div class="prototype-reference-grid">
          <el-form-item label="产品型号" required>
            <el-select v-model="videoFactoryForm.productModel" filterable placeholder="搜索或选择产品型号">
              <el-option v-for="product in productOptions" :key="product.id" :label="`${product.modelCode} · ${product.name}`" :value="product.modelCode" />
            </el-select>
          </el-form-item>
          <el-form-item label="AI 提示词" required>
            <el-input v-model="videoFactoryForm.additionalPrompt" placeholder="说明这条视频想表现什么、风格或临时要求" />
          </el-form-item>
        </div>
      </section>

      <section v-if="videoProjectMode === 'BATCH_CODEX_DIRECT_FULL_VIDEO'" class="prototype-form-section">
        <header><strong>批量任务</strong><span>每个产品直接选择视频数量，所有产品合计最多 10 条（最多 5 个产品）</span></header>
        <div v-for="(product, index) in videoFactoryForm.batchProducts" :key="`batch-product-${index}`" class="batch-product-row">
          <el-form-item :label="`产品 ${index + 1}`" required>
            <el-select v-model="product.model" filterable placeholder="搜索或选择产品型号" @change="syncBatchTaskRequirement">
              <el-option v-for="option in batchProductOptions()" :key="option.id" :label="`${option.modelCode} · ${option.name}`" :value="option.modelCode" />
            </el-select>
          </el-form-item>
          <el-form-item label="视频数量">
            <el-select v-model="product.count" @change="syncBatchTaskRequirement">
              <el-option v-for="count in [2,3,4,5,6,7,8,9,10]" :key="count" :label="`${count} 条`" :value="count" />
            </el-select>
          </el-form-item>
          <el-button
            v-if="videoFactoryForm.batchProducts.length > 1"
            type="danger"
            plain
            @click="removeBatchProduct(index)"
          >移除</el-button>
          <span v-else></span>
        </div>
        <div class="batch-allocation-hint" :class="{ error: batchTotalVideos() > 10 }">
          <template v-if="batchTotalVideos() === 0">请为每个产品选择视频数量。</template>
          <template v-else-if="batchTotalVideos() > 10">当前合计 {{ batchTotalVideos() }} 条，超过上限 10 条，请调低部分产品数量。</template>
          <template v-else>合计 {{ batchTotalVideos() }} 条（最多 10 条）。</template>
        </div>
        <el-button type="primary" plain :disabled="videoFactoryForm.batchProducts.length >= 5" @click="addBatchProduct">+ 添加产品</el-button>
      </section>

      <section v-if="videoProjectMode === 'BATCH_CODEX_DIRECT_FULL_VIDEO'" class="prototype-form-section">
        <header><strong>批量创作设置</strong><span>默认已按最佳实践设置，可直接使用</span></header>
        <div class="batch-create-settings">
          <el-form-item label="口播分配">
            <el-radio-group v-model="videoFactoryForm.batchVoiceoverSplit" @change="syncBatchTaskRequirement">
              <el-radio-button label="HALF">一半口播、一半无口播</el-radio-button>
              <el-radio-button label="ALL">全部口播</el-radio-button>
              <el-radio-button label="NONE">全部无口播</el-radio-button>
            </el-radio-group>
            <div class="batch-setting-hint">一半口播时按每个产品各半分配，奇数条时无口播多一条。</div>
          </el-form-item>
          <el-form-item label="补充 AI 提示词">
            <el-input v-model="videoFactoryForm.additionalPrompt" type="textarea" :rows="3" placeholder="例如：整体真实温暖，各条视频方向尽量错开" @input="syncBatchTaskRequirement" />
          </el-form-item>
        </div>
        <div class="batch-option-checks">
          <el-checkbox v-model="videoFactoryForm.batchBgmVariety" @change="syncBatchTaskRequirement">每条视频使用不同 BGM</el-checkbox>
          <el-checkbox v-model="videoFactoryForm.batchVoiceVariety" @change="syncBatchTaskRequirement">多使用几种音色，尽量不重复</el-checkbox>
          <el-checkbox v-model="videoFactoryForm.batchGenerateCoverTitle" @change="syncBatchTaskRequirement">同时生成封面和标题（每条视频标签至少 5 个）</el-checkbox>
        </div>
      </section>

      <section v-if="videoProjectMode === 'BATCH_CODEX_DIRECT_FULL_VIDEO'" class="prototype-form-section batch-task-requirement">
        <header><strong>提交给 Codex 的任务要求</strong><span>自动整理成唯一 AI 任务，可直接修改，随输入实时更新</span></header>
        <el-input
          v-model="videoFactoryForm.batchTaskRequirement"
          type="textarea"
          :rows="6"
          @input="markBatchRequirementEdited"
        />
      </section>

      <el-collapse v-if="videoProjectMode === 'STANDARD'" v-model="videoProjectCollapseNames" class="prototype-collapses">
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
            <el-form-item label="发布平台"><el-select v-model="videoFactoryForm.platform"><el-option label="不限，由 AI 决定" value="AUTO" /><el-option label="抖音" value="DOUYIN" /><el-option label="小红书" value="XIAOHONGSHU" /><el-option label="B站" value="BILIBILI" /><el-option label="视频号" value="WECHAT_CHANNELS" /><el-option label="快手" value="KUAISHOU" /><el-option label="TikTok" value="TIKTOK" /></el-select></el-form-item>
            <el-form-item label="视频时长"><el-select v-model="videoFactoryForm.estimatedDurationSeconds"><el-option label="不限，由 AI 决定" :value="0" /><el-option label="15秒" :value="15" /><el-option label="30秒" :value="30" /><el-option label="60秒" :value="60" /></el-select></el-form-item>
            <el-form-item label="账号类型"><el-select v-model="videoFactoryForm.accountType"><el-option label="不限，由 AI 决定" value="AUTO" /><el-option label="品牌账号" value="BRAND" /><el-option label="达人账号" value="CREATOR" /><el-option label="员工账号" value="EMPLOYEE" /></el-select></el-form-item>
            <el-form-item label="健康相关内容"><el-select v-model="videoFactoryForm.healthContentAllowed"><el-option label="不限，由 AI 决定" :value="null" /><el-option label="允许健康相关内容" :value="true" /><el-option label="不允许健康相关内容" :value="false" /></el-select></el-form-item>
            <el-form-item label="素材使用"><el-select v-model="videoScriptMode"><el-option label="不限，由 AI 决定" value="AUTO" /><el-option label="优先使用素材库已有素材" value="ASSET_FIRST" /><el-option label="仅使用已有素材（缺少则改写）" value="ASSET_ONLY" /></el-select></el-form-item>
            <el-form-item label="口播"><el-select v-model="videoFactoryForm.voiceoverMode"><el-option label="不限，由 AI 决定" value="AUTO" /><el-option label="有口播视频" value="VOICEOVER" /><el-option label="无口播视频" value="NO_VOICEOVER" /></el-select></el-form-item>
          </div>
        </el-collapse-item>
      </el-collapse>

      <el-alert
        v-if="videoProjectMode === 'STANDARD'"
        title="创建项目后由系统 AI 立即生成可编辑脚本；不满意时可填写提示词重新生成，或转交远程 Codex 重写。"
        type="info"
        :closable="false"
      />
    </div>
    <div v-else-if="taskVideoProjectDetail" class="task-video-stage-panel">
      <el-alert
        :title="isBatchCodexVideoProject(taskVideoProjectDetail)
          ? '批量 Codex 直出任务已提交，一个任务直接产出全部视频和封面标题'
          : isCodexDirectVideoProject(taskVideoProjectDetail)
            ? 'Codex 正在直出最终成片，中间脚本、素材匹配和剪辑过程不会回传系统'
            : projectWaitingForScripts(taskVideoProjectDetail) ? '项目已创建，系统 AI 正在生成脚本并匹配素材' : '脚本与素材已经准备好，可直接查看、修改或确认'"
        type="success"
        :closable="false"
      />
      <div class="video-flow-steps compact">
        <span
          v-for="(step, index) in isBatchCodexVideoProject(taskVideoProjectDetail) ? batchFlowStepsForProject(taskVideoProjectDetail) : videoFlowSteps"
          :key="`dialog-${step}`"
          :class="{ active: videoFlowStep(taskVideoProjectDetail) === index + 1, done: videoFlowStep(taskVideoProjectDetail) > index + 1 }"
        >{{ index + 1 }} {{ step }}</span>
      </div>
      <section v-if="isBatchCodexVideoProject(taskVideoProjectDetail)">
        <h3>批量 Codex 直出成片中</h3>
        <p>项目已提交。一个 AI 任务直接产出全部视频{{ batchConfigOf(taskVideoProjectDetail)?.generateCoverTitle !== false ? '、封面和标题' : '' }}，仅最终成片或失败原因会回传到此项目。</p>
      </section>
      <section v-else-if="isCodexDirectVideoProject(taskVideoProjectDetail)">
        <h3>Codex 直出成片中</h3>
        <p>项目已提交。仅最终成片或失败原因会回传到此项目，完成后自动进入成片审核。</p>
      </section>
      <section v-else-if="videoFlowStep(taskVideoProjectDetail) === 2 && projectWaitingForScripts(taskVideoProjectDetail)">
        <h3>脚本与素材匹配中</h3>
        <p>弹窗会保留在当前步骤，生成完成后即可继续查看和修改脚本。</p>
      </section>
      <section v-else-if="videoFlowStep(taskVideoProjectDetail) === 2" class="task-script-candidates" :class="{ single: displayedProjectCandidates(taskVideoProjectDetail).length === 1 }">
        <article
          v-for="(candidate, index) in displayedProjectCandidates(taskVideoProjectDetail)"
          :key="`${taskVideoProjectDetail.id}-dialog-${index}`"
        >
          <small>{{ scriptEngineLabel(candidate) }} · {{ candidate.score || 0 }}分</small>
          <div class="script-material-summary compact-script-materials">
            <strong>逐句脚本与素材：{{ candidateCoverageSummary(candidate) }}</strong>
            <div v-for="(shot, shotIndex) in editableCandidateLines(candidate)" :key="shot.lineId || shotIndex" class="script-material-line">
              <span>{{ shotIndex + 1 }}</span>
              <el-input
                :model-value="shot.__editedVoiceover ?? shot.voiceover ?? shot.description"
                type="textarea"
                :autosize="{ minRows: 1, maxRows: 3 }"
                @update:model-value="updateCandidateLine(candidate, shotIndex, $event)"
              />
              <div class="script-line-asset">
                <el-tag size="small" :type="projectShotForScriptLine(taskVideoProjectDetail, shot, shotIndex)?.selectedAssetId || shot.selectedAssetIds?.length ? 'success' : 'warning'">
                  {{ projectShotForScriptLine(taskVideoProjectDetail, shot, shotIndex)?.selectedAssetId || shot.selectedAssetIds?.length ? "已有素材" : "缺失素材" }}
                </el-tag>
                <small>{{ scriptLineMaterialDescription(taskVideoProjectDetail, shot, shotIndex) }}</small>
                <div class="script-line-material-actions">
                  <template v-if="scriptLineVideoAssetId(taskVideoProjectDetail, shot, shotIndex)">
                    <el-button size="small" @click="previewScriptLineAsset(taskVideoProjectDetail, shot, shotIndex)">预览</el-button>
                    <el-button v-if="can('ASSET_UPLOAD')" size="small" @click="uploadScriptLineShot(taskVideoProjectDetail, candidate, shot, shotIndex)">替换素材</el-button>
                  </template>
                  <template v-else>
                    <el-button
                      v-if="can('ASSET_UPLOAD')"
                      size="small"
                      @click="uploadScriptLineShot(taskVideoProjectDetail, candidate, shot, shotIndex)"
                    >上传补拍</el-button>
                    <el-button
                      size="small"
                      type="primary"
                      plain
                      :loading="generatingShotId === projectShotForScriptLine(taskVideoProjectDetail, shot, shotIndex)?.id"
                      @click="generateScriptLineShot(taskVideoProjectDetail, candidate, shot, shotIndex)"
                    >AI 生成</el-button>
                  </template>
                </div>
              </div>
            </div>
          </div>
          <div class="preview-actions">
            <el-button v-if="candidate.scriptPackage" @click="openScriptPackage(candidate)">查看完整脚本</el-button>
            <el-button
              type="primary"
              plain
              :loading="savingInlineScriptKey === `${taskVideoProjectDetail.id}:${candidateIndexFor(taskVideoProjectDetail, candidate)}`"
              @click="saveInlineProjectScript(taskVideoProjectDetail, candidate, candidateIndexFor(taskVideoProjectDetail, candidate))"
            >保存修改</el-button>
            <el-button
              v-if="candidate.generationSource === 'SYSTEM_AI'"
              :loading="regeneratingSystemScriptProjectId === taskVideoProjectDetail.id"
              @click="regenerateSystemScript(taskVideoProjectDetail)"
            >重新生成</el-button>
            <el-button type="success" @click="reviewProjectScript(taskVideoProjectDetail, true, candidateIndexFor(taskVideoProjectDetail, candidate))">确认脚本与素材</el-button>
            <el-button type="danger" plain @click="candidate.generationSource === 'REMOTE_CODEX' ? reviewProjectScript(taskVideoProjectDetail, false, candidateIndexFor(taskVideoProjectDetail, candidate)) : transferProjectScriptToCodex(taskVideoProjectDetail, candidateIndexFor(taskVideoProjectDetail, candidate))">
              {{ candidate.generationSource === "REMOTE_CODEX" ? "退回 Codex" : "转交 Codex" }}
            </el-button>
          </div>
        </article>
      </section>
      <el-empty v-else description="项目已进入下一阶段，可关闭弹窗后在任务卡片中继续处理" />
    </div>
    <template #footer>
      <template v-if="!createdVideoProjectDialogId">
        <el-button @click="newVideoProjectVisible = false">取消</el-button>
        <el-button @click="checkNewVideoProjectBrief">AI检查任务信息</el-button>
        <el-button type="primary" :loading="creatingVideoProject" @click="createVideoFactoryProject">{{ videoProjectMode === 'STANDARD' ? '创建项目并生成脚本' : videoProjectMode === 'REFERENCE_DIRECT_FULL_VIDEO' ? '提交 Codex 全流程任务' : videoProjectMode === 'CODEX_DIRECT_FULL_VIDEO' ? '提交 Codex 直出任务' : '创建批量项目并提交 Codex 任务' }}</el-button>
      </template>
      <el-button v-else @click="newVideoProjectVisible = false">关闭，稍后继续</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="scriptPackageVisible" title="完整视频脚本包" width="min(980px, 96vw)" class="script-package-dialog">
    <div v-if="scriptPackageCandidate?.scriptPackage" class="script-package">
      <section>
        <h3>{{ scriptPackageCandidate.titleZh || scriptPackageCandidate.title || "完整脚本" }}</h3>
        <p><b>方向：</b>{{ scriptPackageCandidate.scriptPackage.positioning?.coreTheme || scriptPackageCandidate.topic }}</p>
        <p><b>预计时长：</b>{{ scriptPackageCandidate.scriptPackage.basicInfo?.estimatedDurationSeconds || 30 }}秒</p>
        <p><b>完整口播：</b></p>
        <p style="white-space: pre-line; line-height: 1.9">{{ candidateVoiceover(scriptPackageCandidate) }}</p>
        <p><b>素材状态：</b>{{ candidateCoverageSummary(scriptPackageCandidate) }}</p>
        <p v-if="scriptPackageCandidate.scriptPackage.overlayNotice"><b>画面小字：</b>{{ scriptPackageCandidate.scriptPackage.overlayNotice }}</p>
      </section>
      <el-collapse>
        <el-collapse-item title="查看脚本结构、镜头、字幕、声音和合规详情" name="advanced-script-package">
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
        </el-collapse-item>
      </el-collapse>
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
      <article v-for="project in pagedRecycledVideoProjects" :key="project.id" class="video-recycle-item">
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
      <el-empty v-if="!videoRecycleBinLoading && !recycledVideoProjects.length" description="回收站暂无可恢复的视频项目" />
      <el-pagination v-if="recycledVideoProjects.length > recyclePageSize" v-model:current-page="recyclePages.VIDEO" small background layout="prev, pager, next" :page-size="recyclePageSize" :total="recycledVideoProjects.length" />
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
    title="退回成片修改"
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
      <el-form-item label="退回说明（必填）">
        <el-input
          v-model="videoReviewForm.note"
          type="textarea"
          :rows="5"
          placeholder="请具体说明需要修改的字幕、配音、画面、节奏、产品展示或 CTA 等问题"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="videoReviewVisible = false">取消</el-button>
      <el-button
        type="danger"
        :loading="Boolean(reviewingVideoAssetId)"
        @click="reviewWorkbenchVideo"
      >确认退回并同步说明</el-button>
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
  <el-dialog v-model="systemScriptConversationVisible" :title="scriptGenerationDialogTitle(systemScriptConversationProject)" width="min(760px, 94vw)">
    <div class="system-script-conversation">
      <el-alert
        :title="scriptGenerationDialogHint(systemScriptConversationProject)"
        type="info"
        :closable="false"
      />
      <div
        v-for="(message, index) in scriptGenerationMessages(systemScriptConversationProject)"
        :key="`${message.at || index}-${index}`"
        class="system-script-message"
        :class="String(message.role || '').toLowerCase()"
      >
        <header>
          <strong>{{ scriptGenerationMessageLabel(message, systemScriptConversationProject) }}</strong>
          <el-tag size="small" :type="message.status === 'FAILED' ? 'danger' : message.status === 'COMPLETED' ? 'success' : 'warning'">
            {{ scriptTaskStatusLabel(String(message.status || "")) }}
          </el-tag>
          <small>{{ message.at ? formatTime(message.at) : "" }}</small>
        </header>
        <p>{{ message.content }}</p>
      </div>
      <el-empty v-if="!scriptGenerationMessages(systemScriptConversationProject).length" description="暂无生成记录；旧项目会从下一次重试开始记录" />
    </div>
    <template #footer>
      <el-button v-if="systemScriptConversationProject" @click="refreshSystemScriptConversationProject">只刷新当前项目</el-button>
      <el-button type="primary" @click="systemScriptConversationVisible = false">关闭</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="videoLibraryDetailVisible" title="成品详情" width="min(760px, 96vw)" destroy-on-close>
    <div v-if="videoLibraryDetail" class="video-library-detail-layout">
      <div class="video-library-player"><video v-if="videoLibraryPreviewUrl" :src="videoLibraryPreviewUrl" controls playsinline preload="metadata" :poster="videoLibraryDetailCoverUrl || undefined" /></div>
      <div class="video-library-detail-copy">
        <h3>{{ videoLibraryTitle(videoLibraryDetail) }}</h3>
        <div v-if="videoLibraryTags(videoLibraryDetail).length" class="video-library-tags"><el-tag v-for="tag in videoLibraryTags(videoLibraryDetail)" :key="tag" size="small"># {{ tag }}</el-tag></div>
        <div class="task-meta"><span>{{ videoLibraryDetail.productModel || '品牌通用' }}</span><span>{{ platformLabel(videoLibraryDetail.platform) }}</span><span>{{ Math.round(Number(videoLibraryDetail.outputAsset?.durationSeconds || 0)) || '—' }}秒</span><span>{{ videoLibraryDetail.createdBy || '系统' }}</span></div>
        <div class="video-library-detail-prompt"><strong>生成提示词：</strong>{{ videoLibraryDetail.snapshot?.prompt || videoLibraryDetail.snapshot?.project?.additionalPrompt || '未记录额外提示词' }}</div>
        <div v-if="videoLibraryPublishedVariants(videoLibraryDetail).length" class="video-library-publish"><span>已回传发布链接，最新数据已展示</span><el-button v-for="variant in videoLibraryPublishedVariants(videoLibraryDetail)" :key="variant.id" size="small" @click="openDownload(variant.manualPublishUrl || variant.publishJobs?.find((job: Row) => job.remoteUrl)?.remoteUrl, `${platformLabel(variant.platform)}发布视频`)">快捷查看发布视频</el-button></div>
        <div v-else class="video-library-publish"><span>尚未回传发布链接</span></div>
        <template v-if="videoLibraryDetail.latestMetricAt">
          <div class="video-library-history-row"><span>{{ videoLibraryMetricCheckpoint(videoLibraryDetail) }}采集</span><span>播放 {{ videoLibraryMetric(videoLibraryDetail, 'latestViews') }}　点赞 {{ videoLibraryMetric(videoLibraryDetail, 'latestLikes') }}　评论 {{ videoLibraryMetric(videoLibraryDetail, 'latestComments') }}</span></div>
          <el-button v-if="videoLibraryMetricHistory(videoLibraryDetail).length > 1" class="video-library-history-toggle" link type="primary" @click="videoLibraryHistoryExpanded = !videoLibraryHistoryExpanded">{{ videoLibraryHistoryExpanded ? '收起历史采集数据' : `查看全部 ${videoLibraryMetricHistory(videoLibraryDetail).length} 次采集数据` }}</el-button>
          <template v-if="videoLibraryHistoryExpanded"><div v-for="(metric, index) in videoLibraryMetricHistory(videoLibraryDetail).slice(1)" :key="metric.capturedAt" class="video-library-history-row"><span>{{ videoLibraryMetricRowLabel(metric, index + 1) }}</span><span>播放 {{ Number(metric.views || 0).toLocaleString('zh-CN') }}　点赞 {{ Number(metric.likes || 0).toLocaleString('zh-CN') }}　评论 {{ Number(metric.comments || 0).toLocaleString('zh-CN') }}</span></div></template>
        </template>
        <div v-if="videoLibraryDetail.snapshot?.reference"><a :href="videoLibraryDetail.snapshot.reference" target="_blank" rel="noopener noreferrer">打开原始参考链接</a></div>
        <small>来源项目：{{ videoLibraryDetail.contentPlan?.productionNo || '—' }} · {{ videoLibraryDetail.contentPlan?.topic }}</small>
      </div>
    </div>
    <template #footer><div class="video-library-detail-actions"><el-button @click="videoLibraryDetailVisible = false">关闭</el-button><el-button :disabled="!videoLibraryDetailCoverUrl" @click="openDownload(videoLibraryDetailCoverUrl, `${videoLibraryTitle(videoLibraryDetail || {})}-封面.jpg`)">下载封面</el-button><el-button :disabled="!videoLibraryPreviewUrl" @click="openDownload(videoLibraryPreviewUrl, `${videoLibraryTitle(videoLibraryDetail || {})}.mp4`)">下载成片</el-button><el-button v-if="canGenerateVideoScript" type="primary" @click="openVideoLibraryCreate">基于此成品生成类似视频</el-button></div></template>
  </el-dialog>

  <el-dialog v-model="videoLibraryCreateVisible" title="从成品生成类似视频" width="min(760px, 94vw)" class="video-library-create-dialog" destroy-on-close>
    <div class="video-library-create-intro"><strong>{{ videoLibraryTitle(videoLibraryDetail || {}) }}</strong>默认沿用该成品原项目的 AI 任务要求。只勾选需要改写的内容，系统会同步更新最终任务要求。</div>
    <div class="video-library-create-body">
      <div class="video-library-create-intro">系统会以该成片作为完整参考，直接生成新成片；不再进入脚本审核流程。</div>
      <span class="video-library-create-label">可选改写项</span>
      <div class="video-library-rewrite-list">
        <div class="video-library-rewrite-item"><el-checkbox v-model="videoLibraryCreateForm.replaceProduct" @change="syncVideoLibraryTaskRequirement">替换产品</el-checkbox><el-select v-model="videoLibraryCreateForm.productModel" :disabled="!videoLibraryCreateForm.replaceProduct" filterable placeholder="搜索或选择产品型号" @change="syncVideoLibraryTaskRequirement"><el-option v-for="product in productOptions" :key="product.id" :label="`${product.modelCode} · ${product.name}`" :value="product.modelCode" /></el-select></div>
        <div class="video-library-rewrite-item"><el-checkbox v-model="videoLibraryCreateForm.replaceHook" @change="syncVideoLibraryTaskRequirement">替换钩子</el-checkbox><el-input v-model="videoLibraryCreateForm.hook" :disabled="!videoLibraryCreateForm.replaceHook" placeholder="例如：爸妈总说不用买，其实最担心的是这个" @input="syncVideoLibraryTaskRequirement" /></div>
        <div class="video-library-rewrite-item"><el-checkbox v-model="videoLibraryCreateForm.replaceFeature" @change="syncVideoLibraryTaskRequirement">调整核心卖点</el-checkbox><el-input v-model="videoLibraryCreateForm.feature" :disabled="!videoLibraryCreateForm.replaceFeature" placeholder="例如：夜间睡眠监测、蓝牙通话" @input="syncVideoLibraryTaskRequirement" /></div>
        <div class="video-library-rewrite-item"><el-checkbox v-model="videoLibraryCreateForm.replaceOther" @change="syncVideoLibraryTaskRequirement">其它修改</el-checkbox><el-input v-model="videoLibraryCreateForm.otherChange" :disabled="!videoLibraryCreateForm.replaceOther" placeholder="请输入其它需要修改的内容" @input="syncVideoLibraryTaskRequirement" /></div>
      </div>
      <span class="video-library-create-label">内容语言</span>
      <div class="video-library-language-row"><el-radio-group v-model="videoLibraryCreateForm.targetLanguage" @change="syncVideoLibraryTaskRequirement"><el-radio-button value="ZH">中文</el-radio-button><el-radio-button value="EN">英文</el-radio-button><el-radio-button value="OTHER">其他</el-radio-button></el-radio-group><el-input v-if="videoLibraryCreateForm.targetLanguage === 'OTHER'" v-model="videoLibraryCreateForm.customLanguage" placeholder="请输入语言，例如：日文" @input="syncVideoLibraryTaskRequirement" /></div>
      <span class="video-library-create-label">最终 AI 任务要求</span>
      <el-input v-model="videoLibraryCreateForm.taskRequirement" class="video-library-task-requirement" type="textarea" :rows="8" />
      <div class="video-library-task-note">这里的内容会直接作为新项目的 AI 任务要求提交。你也可以继续直接编辑。</div>
    </div>
    <template #footer><el-button @click="videoLibraryCreateVisible = false">取消</el-button><el-button type="primary" :loading="videoLibraryCreating" @click="createVideoLibraryProject">创建项目</el-button></template>
  </el-dialog>
</template>
