<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox, type UploadUserFile } from "element-plus";
import { Collection, Download, Plus, Refresh, Search, UploadFilled, View } from "@element-plus/icons-vue";
import { api, patch, post, remove, upload, uploadWithProgress } from "../api";

type Row = Record<string, any>;
type Overview = {
  knowledge: { total: number; ready: number; pending: number };
  assets: { total: number; ready: number; pending: number; aiFailed: number; today: number; highQuality: number; ossStored: number; gapCount: number; trash: number };
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
const gapProductModel = ref("");
const selectedGaps = ref<Row[]>([]);
const gapTasks = ref<Row[]>([]);
const gapTaskUploadDialog = ref(false);
const gapTaskUploadTarget = ref<Row>();
const gapTaskUploadFiles = ref<UploadUserFile[]>([]);
const gapTaskUploading = ref(false);
const gapTaskUploadProgress = ref(0);
const dailyReport = ref<Row>();
const growthLoop = ref<Row>();
const externalVideos = ref<Row[]>([]);
const remakeTasks = ref<Row[]>([]);
const cloudJobs = ref<Row[]>([]);
const aiCapabilities = ref<Row>();
const viralCapabilities = ref<Row[]>([]);
const viralTrend = ref<Row>({ summary: {}, devices: [], items: [] });
const viralKeywordPlan = ref<Row>({ keywords: [] });
const keywordView = ref("overview");
const keywordPlatform = ref("");
const smartKeywordResult = ref<Row>({ items: [], total: 0, summary: [] });
const keywordClusters = ref<Row[]>([]);
const keywordDirections = ref<Row[]>([]);
const keywordSourceStatus = ref<Row[]>([]);
const keywordAnalysis = ref<Row>();
const keywordDialog = ref(false);
const keywordBatchDialog = ref(false);
const keywordDirectionDialog = ref(false);
const keywordAnalysisDrawer = ref(false);
const editingKeywordId = ref("");
const editingDirectionId = ref("");
const keywordImportFiles = ref<UploadUserFile[]>([]);
const controls = ref<{ claims: Row[]; mappings: Row[]; phraseRules: Row[]; brandProfiles: Row[]; products: Row[]; faqs: Row[]; employees: Row[]; categories: string[] }>({ claims: [], mappings: [], phraseRules: [], brandProfiles: [], products: [], faqs: [], employees: [], categories: [] });
const knowledgeDialog = ref(false);
const productDialog = ref(false);
const uploadDialog = ref(false);
const metadataDialog = ref(false);
const assetBulkDialog = ref(false);
const replaceDialog = ref(false);
const documentEditorDialog = ref(false);
const controlDialog = ref(false);
const restrictedRulesDialog = ref(false);
const detailDrawer = ref(false);
const collectorConfigDialog = ref(false);
const collectorImportDialog = ref(false);
const collectorLinkDialog = ref(false);
const editingKnowledgeId = ref("");
const editingProductId = ref("");
const editingAssetId = ref("");
const assetDetail = ref<Row>();
const assetPreviewUrl = ref("");
const assetPreviewLoading = ref(false);
const batchFiles = ref<UploadUserFile[]>([]);
const collectorImportFiles = ref<UploadUserFile[]>([]);
const nextCursor = ref<string | null>(null);
const assetTotal = ref(0);
const selectedVideoId = ref("");
const segments = ref<Row[]>([]);
const assistState = ref("");
const assistMessage = ref("");
const selectedKnowledge = ref<Row[]>([]);
const selectedProducts = ref<Row[]>([]);
const selectedFaqs = ref<Row[]>([]);
const selectedAssets = ref<Row[]>([]);
const uploadTechnicalInfo = ref<Row[]>([]);
const uploading = ref(false);
const uploadProgress = ref(0);
const uploadEta = ref("");
const uploadStage = ref("");
const productionPlans = ref<Row[]>([]);
const replacementFiles = ref<UploadUserFile[]>([]);
const replacementUploading = ref(false);
const documentContent = ref("");
const controlResource = ref("");
const controlEditingId = ref("");

const knowledgeFilter = reactive({ query: "", type: "", status: "", model: "" });
const assetFilter = reactive({ query: "", kind: "", level: "", model: "", moduleType: "", employeeId: "", reviewStatus: "", reviewScope: "NORMAL", availabilityStatus: "", rightsStatus: "", minimumScore: "" });
const knowledgeForm = reactive({ type: "FAQ", title: "", category: "", model: "", reply: "", body: "", source: "运营后台录入", sourceRefs: "", sourceLevel: "B", keywords: "", scenarios: "", audience: "customer" });
const productForm = reactive({ modelCode: "", name: "", category: "", status: "READY", aliases: "", functions: "", customerValues: "", audiences: "", scenes: "", contentDirections: "" });
const batchForm = reactive({ sourceType: "EMPLOYEE_CAPTURE", productScope: "UNKNOWN", productIds: [] as string[], assetKind: "", contentDescription: "", classificationTags: [] as string[], aiRename: true, originalStatus: true, rightsStatus: "COMMERCIAL", acquiredAt: "", contentPlanId: "", shootRequirementId: "" });
const metadataForm = reactive({ displayName: "", level: "ORIGINAL", productScope: "UNKNOWN", productIds: [] as string[], rightsStatus: "AUTH_REQUIRED", contentDescription: "", acquiredAt: "", restriction: "", evidenceIds: "" });
const assetBulkForm = reactive({ level: "", productScope: "", productIds: [] as string[], rightsStatus: "", acquiredAt: "", restriction: "", contentDescription: "", tags: [] as string[], tagMode: "APPEND" });
const controlForm = reactive<Record<string, any>>({});
const restrictedRulesForm = reactive({ category: "HEALTH_RESTRICTED_WORD", values: "" });
const collectorForm = reactive({
  platform: "DOUYIN",
  providerName: "",
  mode: "API",
  endpoint: "",
  token: "",
  keywords: "",
  competitorAccounts: "",
  dailyLimit: 20,
  resolveLimit: 5,
  analysisLimit: 3,
  enabled: true,
  officialEnabled: true,
  tikHubEnabled: true,
  tikHubApiKey: "",
  selfHostedEnabled: true,
  selfHostedBaseUrl: "",
  selfHostedSearchUrl: "",
  selfHostedToken: "",
});
const collectorImportForm = reactive({ platform: "DOUYIN" });
const collectorLinkForm = reactive({ platform: "DOUYIN", sourceUrl: "", downloadUrl: "", accountName: "", title: "", publishedAt: "", views: "", likes: "", comments: "", shares: "", saves: "" });
const smartKeywordFilter = reactive({ search: "", type: "", grade: "", status: "ACTIVE" });
const smartKeywordForm = reactive({
  platform: "DOUYIN",
  keyword: "",
  type: "PRODUCT",
  productId: "",
  audience: "",
  pain: "",
  scene: "",
  language: "zh-CN",
  market: "CN",
  priority: "B",
  collectionEnabled: true,
  contentEnabled: true,
  pinned: false,
  locked: false,
  notes: "",
});
const smartKeywordBatchForm = reactive({ platform: "DOUYIN", text: "", type: "PRODUCT", priority: "B", collectionEnabled: true, contentEnabled: true });
const keywordDirectionForm = reactive({
  name: "",
  platform: "DOUYIN",
  startAt: "",
  endAt: "",
  productIds: [] as string[],
  productSeries: "",
  audienceTerms: "",
  painTerms: "",
  sceneTerms: "",
  competitorTerms: "",
  objective: "",
  boostTerms: "",
  excludeTerms: "",
  explorationRatio: 0.3,
  priority: "B",
  active: true,
});

const knowledgeTypes = [
  { label: "品牌信息", value: "BRAND" }, { label: "产品卖点", value: "PRODUCT" }, { label: "产品参数", value: "PARAMETER" },
  { label: "知识条目", value: "KNOWLEDGE" }, { label: "标准话术", value: "WORDING" }, { label: "常见问答", value: "FAQ" },
  { label: "禁用词", value: "FORBIDDEN" }, { label: "售后规则", value: "AFTER_SALE" }, { label: "使用教程", value: "TUTORIAL" },
];
const kindOptions = ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"];
const levelOptions = ["ORIGINAL", "MODULE", "FINISHED", "REFERENCE", "AI_GENERATED"];
const moduleOptions = ["HOOK", "PAIN", "SCENE", "FEATURE", "BENEFIT", "PROOF", "DEMO", "COMPARE", "UGC", "STORY", "TRANSITION", "TRAFFIC", "OFFER", "CTA", "ENDING"];
const smartKeywordTypes = [
  { value: "PRODUCT", label: "产品与品类" },
  { value: "AUDIENCE", label: "用户人群" },
  { value: "PAIN", label: "用户痛点" },
  { value: "VALUE", label: "功能与价值" },
  { value: "SCENE", label: "使用场景" },
  { value: "HOOK", label: "开场表达" },
  { value: "CONVERSION", label: "测评与决策" },
  { value: "TREND", label: "节日及趋势" },
  { value: "COMPETITOR", label: "竞品研究" },
];
const classificationOptions = [
  { label: "HOOK", value: "HOOK" }, { label: "痛点", value: "PAIN" }, { label: "功能", value: "FEATURE" },
  { label: "教程", value: "TUTORIAL" }, { label: "测评", value: "REVIEW" }, { label: "故事", value: "STORY" },
  { label: "硬广", value: "HARD_AD" }, { label: "直播预告", value: "LIVE_PREVIEW" }, { label: "演示", value: "DEMO" },
  { label: "引流", value: "TRAFFIC" }, { label: "CTA", value: "CTA" },
];
const rightsOptions = ["COMMERCIAL", "INTERNAL", "EDIT_ONLY", "AUTH_REQUIRED", "EXPIRED", "PROHIBITED"];
const videoAssets = computed(() => assets.value.filter((item) => item.kind === "VIDEO"));
const assetPreviewType = computed(() => {
  const kind = String(assetDetail.value?.kind || "");
  const extension = String(assetDetail.value?.extension || "").toLowerCase();
  if (kind === "IMAGE") return "image";
  if (kind === "VIDEO") return "video";
  if (kind === "AUDIO") return "audio";
  if ([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"].includes(extension)) return "office";
  if (extension === ".pdf" || extension === ".txt" || extension === ".md") return "document";
  return "unsupported";
});
const assetPreviewEmbedUrl = computed(() => assetPreviewType.value === "office" && assetPreviewUrl.value
  ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(assetPreviewUrl.value)}`
  : assetPreviewUrl.value);
const aiCapabilityItems = computed<Array<{ key: string; label: string; state: string; message: string; lastSuccessAt?: string | null; recentError?: string | null }>>(() => Object.entries(aiCapabilities.value?.items || {}).map(([key, value]) => {
  const capability = value as Row;
  return {
    key,
    label: ({ oss: "OSS连接", imsSubmit: "IMS任务提交", imsCallback: "IMS回调", bailianImage: "百炼图片理解", bailianVideo: "百炼视频理解", bailianTranscription: "百炼语音转写", bailianText: "百炼文本生成" } as Record<string, string>)[key] || key,
    state: String(capability.state || "UNCONFIGURED"),
    message: String(capability.message || "未配置"),
    lastSuccessAt: capability.lastSuccessAt,
    recentError: capability.recentError,
  };
}));

function typeLabel(value: string) { return knowledgeTypes.find((item) => item.value === value)?.label || value; }
function dateTime(value?: string) { if (!value) return "未记录"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "未记录" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date); }
function list(value: unknown) { return Array.isArray(value) && value.length ? value.join("、") : "—"; }
function editableList(value: unknown) { return Array.isArray(value) ? value.map(String).join("、") : ""; }
function fileSize(value: unknown) { const size = Number(value || 0); if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(2)} GB`; if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`; if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`; return `${size} B`; }
function durationLabel(value: unknown) { const seconds = Math.max(0, Number(value || 0)); if (!seconds) return "—"; const minutes = Math.floor(seconds / 60); const remain = Math.round(seconds % 60); return minutes ? `${minutes}分${remain}秒` : `${remain}秒`; }
function statusType(value: string) { if (["READY", "APPROVED", "ACTIVE", "SUCCEEDED", "AVAILABLE", "CONFIGURED", "HEALTHY", "COMMERCIAL", "ONLINE", "LOGGED_IN"].includes(value)) return "success"; if (["FAILED", "REJECTED", "SUSPENDED", "PROHIBITED", "ERROR", "OFFLINE"].includes(value)) return "danger"; if (["PENDING", "RETURNED", "RETRY", "UNCONFIGURED", "AUTH_REQUIRED", "ANALYZING", "WAITING_PERMISSION", "LOGIN_REQUIRED", "NEEDS_LOGIN", "CAPTCHA"].includes(value)) return "warning"; return "info"; }
function statusLabel(value: string) { return ({ DRAFT: "草稿", PENDING: "待审核", READY: "可用", BLOCKED: "禁用", ARCHIVED: "归档", APPROVED: "已通过", RETURNED: "已退回", REJECTED: "已拒绝", ACTIVE: "可调用", INACTIVE: "未启用", SUSPENDED: "暂停", RECEIVED: "已接收", HASHED: "已计算哈希", STORED: "已存OSS", ANALYZING: "AI处理中", READY_FOR_REVIEW: "待人工审核", DISCOVERED: "已发现", QUEUED: "待处理", PROCESSING: "处理中", CONFIGURED: "已配置", AVAILABLE: "可用", FAILED: "失败", SUCCEEDED: "已完成", RETRY: "待重试", UNCONFIGURED: "未配置", WAITING_PERMISSION: "等待官方审批", COMMERCIAL: "可商用", INTERNAL: "仅内部", EDIT_ONLY: "修改后可用", AUTH_REQUIRED: "待授权", EXPIRED: "已过期", PROHIBITED: "禁止使用", ONLINE: "在线", OFFLINE: "离线", LOGGED_IN: "已登录", NEEDS_LOGIN: "需要扫码", LOGIN_REQUIRED: "需要扫码", CAPTCHA: "需要验证" } as Record<string, string>)[value] || value; }
function kindLabel(value: string) { return ({ IMAGE: "图片", VIDEO: "视频", AUDIO: "音频", DOCUMENT: "文档" } as Record<string, string>)[value] || value; }
function queryString(values: Record<string, string>) { const params = new URLSearchParams(); Object.entries(values).forEach(([key, value]) => { if (String(value).trim()) params.set(key, String(value).trim()); }); return params.toString(); }
function compactNumber(value: unknown) { const number = Number(value || 0); if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}万`; return new Intl.NumberFormat("zh-CN").format(number); }
function percent(value: unknown) { return `${(Number(value || 0) * 100).toFixed(2)}%`; }
function viralGradeType(value: string) { return value === "S" ? "danger" : value === "A" ? "warning" : value === "B" ? "success" : "info"; }
function smartKeywordTypeLabel(value: string) { return smartKeywordTypes.find((item) => item.value === value)?.label || value; }

async function run(task: () => Promise<void>, success?: string) {
  loading.value = true;
  try { await task(); if (success) ElMessage.success(success); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : "操作失败"); }
  finally { loading.value = false; }
}

async function loadKnowledge() { knowledge.value = await api<Row[]>(`/api/v1/brand-data/knowledge?${queryString(knowledgeFilter)}`); }
async function loadControls() { controls.value = await api<typeof controls.value>("/api/v1/brand-data/knowledge-controls"); }
async function loadAssets(reset = true) {
  const params = new URLSearchParams(queryString(assetFilter)); params.set("pageSize", "50");
  if (!reset && nextCursor.value) params.set("cursor", nextCursor.value);
  const result = await api<{ items: Row[]; total: number; nextCursor: string | null }>(`/api/v1/brand-data/assets?${params.toString()}`);
  assets.value = reset ? result.items : [...assets.value, ...result.items]; assetTotal.value = result.total; nextCursor.value = result.nextCursor;
}
async function loadJobs() { jobs.value = await api<Row[]>("/api/v1/brand-data/analysis-jobs"); }
async function loadAiCapabilities() { aiCapabilities.value = await api<Row>("/api/v1/brand-data/ai-capabilities"); }
async function loadGaps(refresh = false) { gaps.value = await api<Row[]>(`/api/v1/brand-data/asset-gaps${refresh ? "?refresh=1" : ""}`); }
async function loadGapTasks() {
  const suffix = gapProductModel.value ? `?productModel=${encodeURIComponent(gapProductModel.value)}` : "";
  gapTasks.value = await api<Row[]>(`/api/v1/brand-data/asset-gaps/tasks${suffix}`);
}
async function analyzeSelectedProductGaps() {
  if (!gapProductModel.value) return ElMessage.warning("请先选择产品型号");
  await run(async () => {
    gaps.value = await post<Row[]>("/api/v1/brand-data/asset-gaps/analyze", { productModel: gapProductModel.value });
    selectedGaps.value = [];
    await loadGapTasks();
  }, "AI已根据当前素材索引列出缺失素材");
}
async function createGapTasks() {
  if (!selectedGaps.value.length) return ElMessage.warning("请勾选需要安排补拍的缺失素材");
  await run(async () => {
    const result = await post<Row>("/api/v1/brand-data/asset-gaps/tasks", { ids: selectedGaps.value.map((item) => item.id) });
    selectedGaps.value = [];
    await loadGapTasks();
    ElMessage.success(`已生成 ${result.created || 0} 个补拍任务`);
  });
}
function openGapTaskUpload(task: Row) {
  gapTaskUploadTarget.value = task;
  gapTaskUploadFiles.value = [];
  gapTaskUploadProgress.value = 0;
  gapTaskUploadDialog.value = true;
}
async function uploadGapTaskMaterials() {
  const task = gapTaskUploadTarget.value;
  const files = gapTaskUploadFiles.value.map((item) => item.raw).filter(Boolean) as File[];
  if (!task || !files.length) return ElMessage.warning("请选择补拍完成的素材");
  gapTaskUploading.value = true;
  try {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    await uploadWithProgress<Row>(`/api/v1/brand-data/asset-gaps/tasks/${task.id}/files`, form, (loaded, total) => {
      gapTaskUploadProgress.value = total ? Math.round(loaded / total * 100) : 0;
    });
    gapTaskUploadDialog.value = false;
    await Promise.all([loadGapTasks(), loadAssets(), loadJobs(), refreshOverview()]);
    ElMessage.success("补拍素材已入库，并进入AI分类、索引和标签分析");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "任务素材上传失败");
  } finally {
    gapTaskUploading.value = false;
  }
}
async function loadReport() { dailyReport.value = await api<Row>("/api/v1/brand-data/reports/daily"); }
async function loadGrowthLoop() { growthLoop.value = await api<Row>("/api/v1/brand-data/growth-loop"); }
async function loadViralWorkspace() {
  const [videos, tasks, queue, capabilities, trend, keywordPlan] = await Promise.all([
    api<Row[]>("/api/v1/brand-data/external-videos?take=100"),
    api<Row[]>("/api/v1/brand-data/remake-tasks?take=100"),
    api<Row[]>("/api/v1/brand-data/cloud/jobs?take=100"),
    api<Row[]>("/api/v1/brand-data/viral-collector/capabilities"),
    api<Row>("/api/v1/brand-data/viral-trends?take=100"),
    api<Row>("/api/v1/brand-data/viral-keywords/today?platform=DOUYIN"),
  ]);
  externalVideos.value = videos; remakeTasks.value = tasks; cloudJobs.value = queue; viralCapabilities.value = capabilities; viralTrend.value = trend; viralKeywordPlan.value = keywordPlan;
}
async function loadSmartKeywordWorkspace() {
  const query = new URLSearchParams();
  if (keywordPlatform.value) query.set("platform", keywordPlatform.value);
  if (smartKeywordFilter.search) query.set("search", smartKeywordFilter.search);
  if (smartKeywordFilter.type) query.set("type", smartKeywordFilter.type);
  if (smartKeywordFilter.grade) query.set("grade", smartKeywordFilter.grade);
  if (smartKeywordFilter.status) query.set("status", smartKeywordFilter.status);
  const [keywords, clusters, directions, sources] = await Promise.all([
    api<Row>(`/api/v1/brand-data/smart-keywords?${query.toString()}`),
    api<Row[]>(`/api/v1/brand-data/keyword-clusters${keywordPlatform.value ? `?platform=${keywordPlatform.value}` : ""}`),
    api<Row[]>(`/api/v1/brand-data/keyword-directions${keywordPlatform.value ? `?platform=${keywordPlatform.value}` : ""}`),
    api<Row[]>("/api/v1/brand-data/smart-keywords/source-status"),
  ]);
  smartKeywordResult.value = keywords;
  keywordClusters.value = clusters;
  keywordDirections.value = directions;
  keywordSourceStatus.value = sources;
}
async function handleKeywordViewChange(value: string | number | boolean) {
  keywordPlatform.value = value === "douyin" ? "DOUYIN" : value === "tiktok" ? "TIKTOK" : "";
  await run(loadSmartKeywordWorkspace);
}
async function generateSmartKeywordPlan(target = keywordPlatform.value || "DOUYIN") {
  await run(async () => {
    await post("/api/v1/brand-data/smart-keywords/generate", { platform: target, force: true });
    await Promise.all([loadSmartKeywordWorkspace(), loadViralWorkspace()]);
  }, `${target === "TIKTOK" ? "TikTok" : "抖音"}今日关键词已生成`);
}
function openSmartKeyword(row?: Row, target = keywordPlatform.value || "DOUYIN") {
  editingKeywordId.value = row?.id || "";
  clearObject(smartKeywordForm, {
    platform: row?.platform || target,
    keyword: row?.keyword || "",
    type: row?.type || "PRODUCT",
    productId: row?.productId || "",
    audience: row?.audience || "",
    pain: row?.pain || "",
    scene: row?.scene || "",
    language: row?.language || (target === "TIKTOK" ? "en" : "zh-CN"),
    market: row?.market || (target === "TIKTOK" ? "US" : "CN"),
    priority: row?.priority || "B",
    collectionEnabled: row?.collectionEnabled !== false,
    contentEnabled: row?.contentEnabled !== false,
    pinned: Boolean(row?.pinned),
    locked: Boolean(row?.locked),
    notes: row?.notes || "",
  });
  keywordDialog.value = true;
}
async function saveSmartKeyword() {
  if (!smartKeywordForm.keyword.trim()) return ElMessage.warning("请填写关键词");
  await run(async () => {
    if (editingKeywordId.value) await patch(`/api/v1/brand-data/smart-keywords/${editingKeywordId.value}`, smartKeywordForm);
    else await post("/api/v1/brand-data/smart-keywords", smartKeywordForm);
    keywordDialog.value = false;
    await Promise.all([loadSmartKeywordWorkspace(), loadViralWorkspace()]);
  }, editingKeywordId.value ? "关键词已更新" : "关键词已加入主库");
}
async function updateSmartKeywordFlag(row: Row, field: string, value: unknown) {
  await run(async () => {
    await patch(`/api/v1/brand-data/smart-keywords/${row.id}`, { [field]: value });
    await Promise.all([loadSmartKeywordWorkspace(), loadViralWorkspace()]);
  }, "关键词状态已更新");
}
function openSmartKeywordBatch(target = keywordPlatform.value || "DOUYIN") {
  clearObject(smartKeywordBatchForm, { platform: target, text: "", type: "PRODUCT", priority: "B", collectionEnabled: true, contentEnabled: true });
  keywordImportFiles.value = [];
  keywordBatchDialog.value = true;
}
async function submitSmartKeywordBatch() {
  let items: Row[] | undefined;
  const file = keywordImportFiles.value[0]?.raw as File | undefined;
  if (file) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "" });
    items = rows.map((row) => ({
      platform: ["抖音", "DOUYIN"].includes(String(row.platform || row["平台"]).toUpperCase()) ? "DOUYIN"
        : ["TIKTOK", "TK"].includes(String(row.platform || row["平台"]).toUpperCase()) ? "TIKTOK"
          : smartKeywordBatchForm.platform,
      keyword: row.keyword || row["关键词"],
      type: row.type || row["关键词类型"] || smartKeywordBatchForm.type,
      productModel: row.productModel || row["产品型号"],
      audience: row.audience || row["目标人群"],
      pain: row.pain || row["痛点"],
      scene: row.scene || row["场景"],
      priority: row.priority || row["优先级"] || smartKeywordBatchForm.priority,
      collectionEnabled: row.collectionEnabled === "" ? smartKeywordBatchForm.collectionEnabled : row.collectionEnabled !== false,
      contentEnabled: row.contentEnabled === "" ? smartKeywordBatchForm.contentEnabled : row.contentEnabled !== false,
      notes: row.notes || row["备注"],
    })).filter((row) => String(row.keyword || "").trim());
  }
  if (!items?.length && !smartKeywordBatchForm.text.trim()) return ElMessage.warning("请粘贴关键词或选择Excel/CSV文件");
  await run(async () => {
    const result = await post<Row>("/api/v1/brand-data/smart-keywords/batch", { ...smartKeywordBatchForm, items, text: smartKeywordBatchForm.text });
    keywordBatchDialog.value = false;
    await loadSmartKeywordWorkspace();
    if (result.skipped) ElMessage.warning(`成功${result.created || 0}条，跳过${result.skipped}条`);
  }, "关键词批量导入完成");
}
async function openSmartKeywordAnalysis(row: Row) {
  await run(async () => {
    keywordAnalysis.value = await api<Row>(`/api/v1/brand-data/smart-keywords/${row.id}/analysis`);
    keywordAnalysisDrawer.value = true;
  });
}
async function generateVideoFromKeyword(row: Row) {
  await run(async () => {
    const result = await post<Row>("/api/v1/content/daily-video/generate", {
      platform: row.platform,
      productModel: row.product?.modelCode,
      keywordIds: [row.id],
      force: true,
    });
    if (!result.created) throw new Error("未生成新候选，请检查已审核产品、素材与AI文本能力");
  }, "已生成3个相关视频候选，第1个为主执行包");
}
function openKeywordDirection(row?: Row, target = keywordPlatform.value || "DOUYIN") {
  editingDirectionId.value = row?.id || "";
  clearObject(keywordDirectionForm, {
    name: row?.name || "",
    platform: row?.platform || target,
    startAt: row?.startAt ? String(row.startAt).slice(0, 10) : new Date().toISOString().slice(0, 10),
    endAt: row?.endAt ? String(row.endAt).slice(0, 10) : "",
    productIds: row?.productIds || [],
    productSeries: editableList(row?.productSeries),
    audienceTerms: editableList(row?.audienceTerms),
    painTerms: editableList(row?.painTerms),
    sceneTerms: editableList(row?.sceneTerms),
    competitorTerms: editableList(row?.competitorTerms),
    objective: row?.objective || "",
    boostTerms: editableList(row?.boostTerms),
    excludeTerms: editableList(row?.excludeTerms),
    explorationRatio: row?.explorationRatio ?? 0.3,
    priority: row?.priority || "B",
    active: row?.active !== false,
  });
  keywordDirectionDialog.value = true;
}
async function saveKeywordDirection() {
  if (!keywordDirectionForm.name.trim()) return ElMessage.warning("请填写方向名称");
  await run(async () => {
    if (editingDirectionId.value) await patch(`/api/v1/brand-data/keyword-directions/${editingDirectionId.value}`, keywordDirectionForm);
    else await post("/api/v1/brand-data/keyword-directions", keywordDirectionForm);
    keywordDirectionDialog.value = false;
    await loadSmartKeywordWorkspace();
  }, editingDirectionId.value ? "运营方向已更新并保留版本" : "运营方向已创建");
}
async function runViralCollector() { await run(async () => { await post("/api/v1/brand-data/viral-collector/run", { platform: "DOUYIN" }); await loadViralWorkspace(); }, "抖音采集任务已执行"); }
async function generateViralKeywords() { await run(async () => { viralKeywordPlan.value = await post<Row>("/api/v1/brand-data/viral-keywords/generate", { force: true }); }, "今日关键词已重新生成"); }
async function toggleViralKeyword(row: Row) { await run(async () => { await patch(`/api/v1/brand-data/viral-keywords/${row.id}`, { locked: !row.locked }); await loadViralWorkspace(); }, row.locked ? "关键词已取消锁定" : "关键词已锁定"); }
async function analyzeViralTrend(row: Row) { await run(async () => { await post(`/api/v1/brand-data/viral-videos/${row.id}/analyze`, {}); await loadViralWorkspace(); }, "已提交IMS与百炼深度分析"); }
function openCollectorConfig(row: Row) {
  clearObject(collectorForm, {
    platform: row.platform,
    providerName: row.providerName || "",
    mode: row.mode || "API",
    endpoint: row.endpoint || "",
    token: "",
    keywords: list(row.keywords) === "—" ? "" : list(row.keywords),
    competitorAccounts: list(row.competitorAccounts) === "—" ? "" : list(row.competitorAccounts),
    dailyLimit: row.dailyLimit || 20,
    resolveLimit: row.resolveLimit || 5,
    analysisLimit: row.analysisLimit || 3,
    enabled: row.enabled !== false,
    officialEnabled: row.officialEnabled !== false,
    tikHubEnabled: row.tikHubEnabled !== false,
    tikHubApiKey: "",
    selfHostedEnabled: row.selfHostedEnabled !== false,
    selfHostedBaseUrl: row.selfHostedBaseUrl || "",
    selfHostedSearchUrl: row.selfHostedSearchUrl || "",
    selfHostedToken: "",
  });
  collectorConfigDialog.value = true;
}
async function saveCollectorConfig() {
  await run(async () => {
    await patch(`/api/v1/brand-data/viral-collector/config/${collectorForm.platform}`, collectorForm);
    collectorConfigDialog.value = false;
    await loadViralWorkspace();
  }, "采集源配置已保存");
}
async function testCollectorProvider(provider: string) {
  await run(async () => {
    await post(`/api/v1/brand-data/viral-collector/providers/${collectorForm.platform}/test`, { provider });
    await loadViralWorkspace();
  }, `${provider === "OFFICIAL" ? "官方" : provider === "SELF_HOSTED" ? "自建" : "TikHub"}渠道连接成功`);
}
async function resolveExternalVideo(row: Row) {
  await run(async () => {
    if (row.resolveJob?.status === "FAILED") {
      await post(`/api/v1/brand-data/viral-collector/resolve-jobs/${row.resolveJob.id}/retry`, {});
    } else {
      await post(`/api/v1/brand-data/viral-collector/references/${row.id}/resolve`, { analyze: true });
    }
    await loadViralWorkspace();
  }, "已提交媒体解析与AI分析");
}
function openCollectorImport(platform = "DOUYIN") {
  collectorImportForm.platform = platform;
  collectorImportFiles.value = [];
  collectorImportDialog.value = true;
}
function downloadCollectorTemplate() {
  const csv = "\uFEFF视频链接,内容ID,账号,标题,发布时间,播放量,点赞量,评论量,分享量,收藏量,视频下载地址\n";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = "赛电爆款视频导入模板.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}
async function submitCollectorImport() {
  const file = collectorImportFiles.value[0]?.raw as File | undefined;
  if (!file) return ElMessage.warning("请选择CSV文件");
  await run(async () => {
    const form = new FormData();
    form.append("file", file);
    form.append("platform", collectorImportForm.platform);
    const result = await upload<Row>("/api/v1/brand-data/viral-collector/import", form);
    collectorImportDialog.value = false;
    await loadViralWorkspace();
    if (result.rejected) ElMessage.warning(`导入${result.imported || 0}条，拒绝${result.rejected}条`);
  }, "爆款数据已导入");
}
function openCollectorLink(platform = "DOUYIN") {
  clearObject(collectorLinkForm, { platform, sourceUrl: "", downloadUrl: "", accountName: "", title: "", publishedAt: "", views: "", likes: "", comments: "", shares: "", saves: "" });
  collectorLinkDialog.value = true;
}
async function submitCollectorLink() {
  if (!collectorLinkForm.sourceUrl.trim()) return ElMessage.warning("请填写内容链接");
  await run(async () => {
    await post("/api/v1/brand-data/viral-collector/links", collectorLinkForm);
    collectorLinkDialog.value = false;
    await loadViralWorkspace();
  }, "链接已进入爆款研究库");
}
async function confirmRemake(row: Row) { await run(async () => { await patch(`/api/v1/brand-data/remake-tasks/${row.id}`, { status: "CONFIRMED" }); await loadViralWorkspace(); }, "仿拍任务已确认"); }
async function retryCloudJob(row: Row) { await run(async () => { await post(`/api/v1/brand-data/cloud/jobs/${row.id}/retry`, {}); await loadViralWorkspace(); }, "云任务已重新入队"); }
function openExternal(url: string) { window.open(url, "_blank", "noopener,noreferrer"); }
async function refreshGrowthLoop() { await run(async () => { growthLoop.value = await post<Row>("/api/v1/brand-data/growth-loop/refresh"); await Promise.all([loadAssets(), loadGaps(), loadReport(), refreshOverview()]); }, "评分、缺口和下一轮任务已更新"); }
async function refreshOverview() { overview.value = await api<Overview>("/api/v1/brand-data/overview"); }
async function reload() {
  await run(async () => {
    const [summary, knowledgeRows, controlsRows] = await Promise.all([api<Overview>("/api/v1/brand-data/overview"), api<Row[]>("/api/v1/brand-data/knowledge"), api<typeof controls.value>("/api/v1/brand-data/knowledge-controls")]);
    overview.value = summary; knowledge.value = knowledgeRows; controls.value = controlsRows;
    await Promise.all([loadAssets(), loadJobs(), loadAiCapabilities(), loadGaps(), loadReport(), loadGrowthLoop(), loadViralWorkspace(), loadSmartKeywordWorkspace()]);
  });
}

function clearObject(target: Record<string, any>, values: Record<string, any>) { Object.keys(target).forEach((key) => { target[key] = values[key] ?? (Array.isArray(target[key]) ? [] : ""); }); }
function openKnowledge(row?: Row) {
  editingKnowledgeId.value = row?.id || "";
  clearObject(knowledgeForm, { type: row?.type || "FAQ", title: row?.title || "", category: row?.category || "", model: row?.model || "", reply: row?.reply || "", body: row?.body || "", source: row?.source || "运营后台录入", sourceRefs: row?.sourceRefs || "", sourceLevel: row?.sourceLevel || "B", keywords: list(row?.metadata?.keywords) === "—" ? "" : list(row?.metadata?.keywords), scenarios: list(row?.metadata?.scenarios) === "—" ? "" : list(row?.metadata?.scenarios), audience: row?.audience || "customer" });
  knowledgeDialog.value = true;
}
async function saveKnowledge(publishMode: "PENDING" | "READY") {
  if (!knowledgeForm.title.trim()) return ElMessage.warning("请填写知识标题");
  if (!knowledgeForm.category) return ElMessage.warning("请选择知识分类");
  if (!knowledgeForm.reply.trim() && !knowledgeForm.body.trim()) return ElMessage.warning("标准回复或完整正文至少填写一项");
  await run(async () => {
    const payload = { ...knowledgeForm, publishMode };
    if (editingKnowledgeId.value) await patch(`/api/v1/brand-data/knowledge/${editingKnowledgeId.value}`, payload);
    else await post("/api/v1/brand-data/knowledge", payload);
    knowledgeDialog.value = false;
    await Promise.all([loadKnowledge(), loadControls(), refreshOverview()]);
  }, publishMode === "READY" ? "知识已直接进入可调用库" : "知识已保存为待审核");
}
async function reviewKnowledge(row: Row, approved: boolean) { let note = ""; if (!approved) { const result = await ElMessageBox.prompt("填写退回原因", "知识审核", { confirmButtonText: "确认", cancelButtonText: "取消" }); note = String(result.value || ""); } await run(async () => { await post(`/api/v1/brand-data/knowledge/${row.id}/review`, { approved, note }); await Promise.all([loadKnowledge(), refreshOverview()]); }, approved ? "知识已审核" : "知识已禁用"); }
async function archiveKnowledge(row: Row) {
  await ElMessageBox.confirm(`确认删除“${row.title}”？删除后将归档并停止调用。`, "归档删除", { confirmButtonText: "确认删除", cancelButtonText: "取消", type: "warning" });
  await run(async () => {
    await post("/api/v1/brand-data/knowledge/bulk", { ids: [row.id], action: "ARCHIVE" });
    await Promise.all([loadKnowledge(), loadControls(), refreshOverview()]);
  }, "知识已归档");
}
function openProduct(row: Row) {
  const metadata = row.metadata || {};
  const publicKnowledge = metadata.publicKnowledge || {};
  editingProductId.value = row.id;
  clearObject(productForm, {
    modelCode: row.modelCode || "", name: row.name || "", category: row.category || "", status: row.status || "READY",
    aliases: editableList(metadata.aliases), functions: editableList(publicKnowledge.functions),
    customerValues: editableList(publicKnowledge.customerValues), audiences: editableList(publicKnowledge.audiences),
    scenes: editableList(publicKnowledge.scenes), contentDirections: editableList(publicKnowledge.contentDirections),
  });
  productDialog.value = true;
}
async function saveProduct() {
  if (!productForm.name.trim() || !productForm.category.trim()) return ElMessage.warning("请填写产品名称和系列");
  await run(async () => {
    await patch(`/api/v1/brand-data/products/${editingProductId.value}`, productForm);
    productDialog.value = false;
    await loadControls();
  }, "产品信息已更新");
}
async function bulkManage(target: "knowledge" | "products" | "faqs", action: string) {
  const selected = target === "knowledge" ? selectedKnowledge.value : target === "products" ? selectedProducts.value : selectedFaqs.value;
  if (!selected.length) return ElMessage.warning("请先勾选记录");
  if (action === "ARCHIVE") {
    await ElMessageBox.confirm(`确认归档已选择的${selected.length}条记录？归档后不再显示。`, "批量归档", { confirmButtonText: "确认归档", cancelButtonText: "取消", type: "warning" });
  }
  await run(async () => {
    await post(`/api/v1/brand-data/${target}/bulk`, { ids: selected.map((item) => item.id), action });
    selectedKnowledge.value = []; selectedProducts.value = []; selectedFaqs.value = [];
    await Promise.all([loadKnowledge(), loadControls(), refreshOverview()]);
  }, `已处理${selected.length}条记录`);
}

function openControl(resource: string, row: Row) {
  controlResource.value = resource;
  controlEditingId.value = row.id;
  Object.keys(controlForm).forEach((key) => delete controlForm[key]);
  Object.assign(controlForm, JSON.parse(JSON.stringify(row)));
  if (controlForm.validFrom) controlForm.validFrom = String(controlForm.validFrom).slice(0, 10);
  if (controlForm.validUntil) controlForm.validUntil = String(controlForm.validUntil).slice(0, 10);
  if (controlForm.effectiveAt) controlForm.effectiveAt = String(controlForm.effectiveAt).slice(0, 10);
  controlDialog.value = true;
}
function controlTitle() {
  return ({ "brand-profiles": "品牌版本", faqs: "FAQ", claims: "资质证书", mappings: "型号映射", rules: "表述规则" } as Record<string, string>)[controlResource.value] || "知识记录";
}
async function saveControl() {
  await run(async () => {
    await patch(`/api/v1/brand-data/knowledge-controls/${controlResource.value}/${controlEditingId.value}`, controlForm);
    controlDialog.value = false;
    await loadControls();
  }, `${controlTitle()}已更新`);
}

async function saveRestrictedRules() {
  const values = restrictedRulesForm.values.split(/\r?\n/gu).map((item) => item.trim()).filter(Boolean);
  if (!values.length) return ElMessage.warning("请按每行一条填写风险词或风险画面");
  await run(async () => {
    const result = await post<Row>("/api/v1/brand-data/knowledge-controls/rules/bulk", {
      category: restrictedRulesForm.category,
      values,
    });
    restrictedRulesDialog.value = false;
    restrictedRulesForm.values = "";
    await loadControls();
    ElMessage.success(`新增${result.created || 0}条，跳过重复${result.skipped || 0}条`);
  });
}
async function archiveControl(resource: string, row: Row) {
  await ElMessageBox.confirm(`确认删除“${row.title || row.name || row.standardQuestion || row.commercialName || row.blockedText}”？删除后将归档并停止调用。`, "归档删除", { confirmButtonText: "确认删除", cancelButtonText: "取消", type: "warning" });
  await run(async () => {
    await remove(`/api/v1/brand-data/knowledge-controls/${resource}/${row.id}`);
    await Promise.all([loadControls(), refreshOverview()]);
  }, "记录已归档");
}

async function openBatchUpload() {
  batchFiles.value = [];
  uploadTechnicalInfo.value = [];
  assistState.value = "";
  assistMessage.value = "";
  uploadProgress.value = 0;
  uploadEta.value = "";
  uploadStage.value = "";
  clearObject(batchForm, { sourceType: "EMPLOYEE_CAPTURE", productScope: "UNKNOWN", productIds: [], assetKind: "", contentDescription: "", classificationTags: [], aiRename: true, originalStatus: true, rightsStatus: "COMMERCIAL", acquiredAt: "", contentPlanId: "", shootRequirementId: "" });
  const plans = await api<Row[]>("/api/v1/content");
  productionPlans.value = plans.filter((item) => item.kind === "VIDEO" && item.productionStage === "AWAITING_ASSETS");
  uploadDialog.value = true;
}
const selectedProductionPlan = computed(() => productionPlans.value.find((item) => item.id === batchForm.contentPlanId));
const selectedUploadModels = computed(() => controls.value.products
  .filter((item) => batchForm.productIds.includes(item.id))
  .map((item) => item.modelCode));
const editingIndexDimensions = [
  "产品型号", "素材用途", "核心功能", "使用场景", "人物动作", "镜头类型",
  "人物/物体", "目标人群", "适用平台", "视觉风格", "画面方向", "口播主题", "用户痛点",
];
const indexLabels: Record<string, string> = {
  product_model: "型号", purpose: "用途", feature: "功能", scene: "场景",
  action: "动作", shot_type: "镜头", person: "人物", object: "物体",
  audience: "人群", platform: "平台", visual_style: "风格", orientation: "方向",
  speech_topic: "口播", pain_point: "痛点", keyword: "关键词",
};
function assetIndexEntries(row: Row) {
  const index = row.aiIndex && typeof row.aiIndex === "object" && !Array.isArray(row.aiIndex) ? row.aiIndex : {};
  return Object.entries(index)
    .map(([key, value]) => ({ key, label: indexLabels[key] || key, values: Array.isArray(value) ? value.map(String).filter(Boolean) : [] }))
    .filter((item) => item.values.length);
}
function assetIndexSummary(row: Row) {
  const index = assetIndexEntries(row);
  const pick = (key: string) => index.find((item) => item.key === key)?.values[0];
  return [pick("product_model"), pick("purpose"), pick("feature") || pick("scene") || pick("action")]
    .filter(Boolean).join("－") || (row.indexVersion ? row.displayName : "等待AI查看画面");
}
function selectProductionPlan() {
  batchForm.shootRequirementId = "";
}
async function inspectBatchFiles() {
  await Promise.resolve();
  const files = batchFiles.value.map((item) => item.raw).filter(Boolean) as File[];
  uploadTechnicalInfo.value = await Promise.all(files.map(async (file) => {
    const extension = file.name.includes(".") ? file.name.split(".").pop()?.toUpperCase() || "未知" : "未知";
    const base: Row = { name: file.name, format: extension, mimeType: file.type || "未知", size: file.size, width: 0, height: 0, durationSeconds: 0, quality: "待AI分析" };
    if (!file.type.startsWith("video/") && !file.type.startsWith("image/")) return base;
    const url = URL.createObjectURL(file);
    try {
      if (file.type.startsWith("video/")) {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.src = url;
        await new Promise<void>((resolve) => { video.onloadedmetadata = () => resolve(); video.onerror = () => resolve(); });
        base.width = video.videoWidth || 0; base.height = video.videoHeight || 0; base.durationSeconds = Number.isFinite(video.duration) ? video.duration : 0;
      } else {
        const image = new Image();
        image.src = url;
        await new Promise<void>((resolve) => { image.onload = () => resolve(); image.onerror = () => resolve(); });
        base.width = image.naturalWidth || 0; base.height = image.naturalHeight || 0;
      }
      if (base.width && base.height) base.quality = Math.min(base.width, base.height) >= 1080 ? "高清" : Math.min(base.width, base.height) >= 720 ? "清晰" : "建议优化";
      return base;
    } finally {
      URL.revokeObjectURL(url);
    }
  }));
}
async function assistUpload() {
  const files = batchFiles.value.map((item) => item.raw).filter(Boolean) as File[];
  if (!files.length) return ElMessage.warning("请先选择素材文件");
  await inspectBatchFiles();
  assistState.value = "RUNNING";
  assistMessage.value = "正在识别文件类型、型号和内容说明…";
  try {
    const result = await post<Row>("/api/v1/brand-data/upload-batches/assist", { files: files.map((file) => ({ name: file.name, type: file.type, size: file.size })) });
    const suggestions = result.suggestions || {};
    if (suggestions.assetKind) batchForm.assetKind = suggestions.assetKind;
    if (Array.isArray(suggestions.productIds)) batchForm.productIds = suggestions.productIds;
    batchForm.productScope = batchForm.productIds.length ? "MODEL" : (suggestions.productScope || "UNKNOWN");
    if (!batchForm.contentDescription && suggestions.contentDescription) batchForm.contentDescription = suggestions.contentDescription;
    if (Array.isArray(suggestions.classificationTags)) batchForm.classificationTags = suggestions.classificationTags;
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
  uploading.value = true;
  uploadProgress.value = 0;
  uploadEta.value = "计算中";
  uploadStage.value = "准备上传";
  try {
    if (uploadTechnicalInfo.value.length !== files.length) await inspectBatchFiles();
    batchForm.productScope = batchForm.productIds.length ? "MODEL" : "UNKNOWN";
    const batch = await post<Row>("/api/v1/brand-data/upload-batches", { ...batchForm });
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    form.append("classificationTags", JSON.stringify(batchForm.classificationTags));
    form.append("aiRename", String(batchForm.aiRename));
    form.append("technicalInfo", JSON.stringify(uploadTechnicalInfo.value));
    const startedAt = Date.now();
    const result = await uploadWithProgress<Row>(`/api/v1/brand-data/upload-batches/${batch.id}/files`, form, (loaded, total) => {
      uploadProgress.value = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
      const elapsed = Math.max((Date.now() - startedAt) / 1000, 0.2);
      const speed = loaded / elapsed;
      const remaining = speed > 0 ? Math.max(0, (total - loaded) / speed) : 0;
      uploadEta.value = remaining > 1 ? `约${Math.ceil(remaining)}秒` : "即将完成";
      uploadStage.value = uploadProgress.value >= 100 ? "正在写入OSS并提交AI处理" : "正在上传";
    });
    uploadDialog.value = false;
    const duplicates = Number(result.duplicateCount || 0); const failed = Number(result.failedCount || 0);
    if (duplicates || failed) ElMessage.warning(`批次完成：新增${result.createdCount || 0}，重复${duplicates}，失败${failed}`);
    await Promise.all([loadAssets(), loadJobs(), refreshOverview(), loadReport()]);
    ElMessage.success("素材批次已进入处理流水线");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "上传失败");
  } finally {
    uploading.value = false;
  }
}

async function loadAssetPreview(id: string) {
  assetPreviewLoading.value = true;
  try {
    const result = await api<{ url: string }>(`/api/v1/brand-data/assets/${id}/download-url`);
    assetPreviewUrl.value = result.url;
  } finally {
    assetPreviewLoading.value = false;
  }
}
async function openDetail(row: Row) {
  await run(async () => {
    assetPreviewUrl.value = "";
    assetDetail.value = await api<Row>(`/api/v1/brand-data/assets/${row.id}`);
    detailDrawer.value = true;
    if (assetDetail.value.objectKey) await loadAssetPreview(row.id);
  });
}
function openAssetPreview() {
  if (assetPreviewUrl.value) window.open(assetPreviewUrl.value, "_blank", "noopener,noreferrer");
}
function openMetadata(row: Row) { editingAssetId.value = row.id; clearObject(metadataForm, { displayName: row.displayName || row.fileName, level: row.level || "ORIGINAL", productScope: row.productScope || "UNKNOWN", productIds: (row.products || []).map((item: Row) => item.id), rightsStatus: row.rightsStatus || "AUTH_REQUIRED", contentDescription: row.contentDescription || "", acquiredAt: row.acquiredAt?.slice(0, 10) || "", restriction: row.restriction || "", evidenceIds: list(row.evidenceIds) === "—" ? "" : list(row.evidenceIds) }); metadataDialog.value = true; }
async function saveMetadata() { await run(async () => { await patch(`/api/v1/brand-data/assets/${editingAssetId.value}/metadata`, metadataForm); metadataDialog.value = false; await Promise.all([loadAssets(), refreshOverview()]); }, "素材元数据已更新"); }
async function reviewAsset(row: Row, action: string) { let note = ""; if (action !== "APPROVE") { const result = await ElMessageBox.prompt("填写处理原因", "素材审核", { confirmButtonText: "确认", cancelButtonText: "取消" }); note = String(result.value || ""); } await run(async () => { await post(`/api/v1/brand-data/assets/${row.id}/review`, { action, note }); await Promise.all([loadAssets(), refreshOverview(), loadReport()]); }, "审核结果已保存"); }
async function reanalyze(row: Row) { await run(async () => { await post(`/api/v1/brand-data/assets/${row.id}/reanalyze`); await Promise.all([loadAssets(), loadJobs()]); }, "已生成新分析版本"); }
async function downloadAsset(row: Row) { await run(async () => { const result = await api<{ url: string }>(`/api/v1/brand-data/assets/${row.id}/download-url`); window.open(result.url, "_blank", "noopener,noreferrer"); }); }
function openAssetBulk() {
  if (!selectedAssets.value.length) return ElMessage.warning("请先勾选素材");
  clearObject(assetBulkForm, { level: "", productScope: "", productIds: [], rightsStatus: "", acquiredAt: "", restriction: "", contentDescription: "", tags: [], tagMode: "APPEND" });
  assetBulkDialog.value = true;
}
async function bulkAssets(action: string) {
  if (!selectedAssets.value.length) return ElMessage.warning("请先勾选素材");
  const selectedCount = selectedAssets.value.length;
  if (action === "ARCHIVE") await ElMessageBox.confirm(`确认删除已选择的${selectedAssets.value.length}个素材？文件和历史版本会保留。`, "批量删除", { confirmButtonText: "确认删除", cancelButtonText: "取消", type: "warning" });
  await run(async () => {
    const patchData: Row = {};
    if (action === "UPDATE") {
      Object.entries(assetBulkForm).forEach(([key, value]) => {
        if (key !== "tagMode" && value !== "" && (!Array.isArray(value) || value.length)) patchData[key] = key === "tags"
          ? (value as string[]).map((code) => ({ namespace: "content_classification", code, label: classificationOptions.find((item) => item.value === code)?.label || code }))
          : value;
      });
    }
    await post("/api/v1/brand-data/assets/bulk", { ids: selectedAssets.value.map((item) => item.id), action, patch: patchData, tagMode: assetBulkForm.tagMode });
    selectedAssets.value = [];
    assetBulkDialog.value = false;
    await Promise.all([loadAssets(), loadJobs(), refreshOverview()]);
  }, `已处理${selectedCount}个素材`);
}
function openReplace(row?: Row) {
  const target = row || assetDetail.value;
  if (!target) return;
  assetDetail.value = target;
  replacementFiles.value = [];
  replaceDialog.value = true;
}
async function replaceAssetFile() {
  const file = replacementFiles.value[0]?.raw as File | undefined;
  if (!file || !assetDetail.value) return ElMessage.warning("请选择替换文件");
  replacementUploading.value = true;
  try {
    const form = new FormData();
    form.append("file", file);
    assetDetail.value = await upload<Row>(`/api/v1/brand-data/assets/${assetDetail.value.id}/versions`, form);
    replaceDialog.value = false;
    await Promise.all([loadAssets(), refreshOverview()]);
    if (detailDrawer.value) await openDetail(assetDetail.value);
    ElMessage.success("新版本已上传并进入AI分析");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "替换失败");
  } finally {
    replacementUploading.value = false;
  }
}
async function openDocumentEditor() {
  if (!assetDetail.value) return;
  const assetId = assetDetail.value.id;
  await run(async () => {
    const result = await api<{ content: string }>(`/api/v1/brand-data/assets/${assetId}/document-content`);
    documentContent.value = result.content;
    documentEditorDialog.value = true;
  });
}
async function saveDocumentContent() {
  if (!assetDetail.value) return;
  const assetId = assetDetail.value.id;
  await run(async () => {
    assetDetail.value = await patch<Row>(`/api/v1/brand-data/assets/${assetId}/document-content`, { content: documentContent.value });
    documentEditorDialog.value = false;
    await Promise.all([loadAssets(), refreshOverview()]);
    await loadAssetPreview(assetDetail.value.id);
  }, "正文已保存为新版本");
}
async function syncAssets() { await run(async () => { await post("/api/v1/jobs/run/SYNC_ASSETS"); await reload(); }, "只读扫描与OSS同步任务已加入队列"); }
async function rebuildAssetIndex() {
  await ElMessageBox.confirm("将为素材库中的图片和视频重新执行AI理解、命名和结构化标签。任务会在后台运行，是否继续？", "重建AI素材索引", {
    confirmButtonText: "开始重建",
    cancelButtonText: "取消",
    type: "warning",
  });
  await run(async () => {
    const result = await post<Row>("/api/v1/brand-data/assets/rebuild-index");
    await loadJobs();
    ElMessage.success(`已加入 ${result.queued || 0} 项素材索引任务`);
  });
}
async function quickFilter(kind = "", reviewStatus = "") {
  assetView.value = "list";
  assetFilter.kind = kind;
  assetFilter.reviewStatus = reviewStatus;
  assetFilter.reviewScope = reviewStatus === "PENDING" ? "PENDING" : "NORMAL";
  await run(() => loadAssets());
}

async function trashAssets(all = false) {
  if (!all && !selectedAssets.value.length) return ElMessage.warning("请先勾选素材");
  const target = all ? `素材库全部 ${overview.value?.assets.total || assetTotal.value} 个素材` : `已选择的 ${selectedAssets.value.length} 个素材`;
  const result = await ElMessageBox.prompt(
    `将${target}移入回收站，3天内可以恢复，之后系统会自动永久删除数据库记录和OSS文件。请输入“移入回收站”继续。`,
    all ? "清空素材库" : "删除所选素材",
    { confirmButtonText: "移入回收站", cancelButtonText: "取消", inputPlaceholder: "请输入：移入回收站", inputValidator: (value) => value === "移入回收站" || "确认文字不正确", type: "warning" },
  );
  await run(async () => {
    const response = await post<Row>("/api/v1/brand-data/assets/bulk", {
      ids: all ? [] : selectedAssets.value.map((item) => item.id),
      action: all ? "TRASH_ALL" : "TRASH",
      confirmation: result.value,
    });
    selectedAssets.value = [];
    await Promise.all([loadAssets(), loadJobs(), refreshOverview()]);
    ElMessage.success(`已将${response.count || 0}个素材移入回收站，3天内可恢复`);
  });
}

async function restoreAssets(ids = selectedAssets.value.map((item) => item.id)) {
  if (!ids.length) return ElMessage.warning("请先勾选需要恢复的素材");
  await run(async () => {
    const response = await post<Row>("/api/v1/brand-data/assets/bulk", { ids, action: "RESTORE" });
    selectedAssets.value = [];
    await Promise.all([loadAssets(), refreshOverview()]);
    ElMessage.success(`已恢复${response.count || 0}个素材，需重新审核后才可使用`);
  });
}

const quickAssetTags = computed(() => {
  const counts = new Map<string, number>();
  for (const asset of assets.value) {
    for (const tag of asset.tags || []) {
      const label = String(tag.label || "").trim();
      if (label && !["product_model"].includes(String(tag.namespace || ""))) counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN")).slice(0, 20);
});

async function filterByAssetTag(label: string) {
  detailDrawer.value = false;
  assetView.value = "list";
  assetFilter.query = label;
  await run(() => loadAssets());
}
async function handleAssetViewChange(value: string) {
  if (value === "gaps") await run(async () => { await Promise.all([loadGaps(), loadGapTasks()]); });
  if (value === "trash") {
    assetFilter.reviewStatus = "";
    assetFilter.reviewScope = "TRASH";
    await run(() => loadAssets());
  } else if (value === "review") {
    assetFilter.kind = "";
    assetFilter.reviewStatus = "PENDING";
    assetFilter.reviewScope = "PENDING";
    await run(() => loadAssets());
  } else if (value === "list" && ["PENDING", "TRASH"].includes(assetFilter.reviewScope)) {
    assetFilter.reviewStatus = "";
    assetFilter.reviewScope = "NORMAL";
    await run(() => loadAssets());
  }
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
      <div><span class="brand-eyebrow">BRAND DATA CENTER · V2.0</span><h2>品牌数据中心</h2></div>
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
      <button :class="{ active: activeTab === 'keywords' }" @click="activeTab = 'keywords'"><el-icon><Search /></el-icon><span>智能关键词</span><b>{{ smartKeywordResult.total || 0 }}</b></button>
      <button :class="{ active: activeTab === 'viral' }" @click="activeTab = 'viral'"><el-icon><View /></el-icon><span>爆款研究</span><b>{{ remakeTasks.length }}</b></button>
    </div>

    <template v-if="activeTab === 'knowledge'">
      <div class="workspace-heading"><div><h3>品牌知识库</h3><p>品牌版本、产品、知识、FAQ、证据、型号映射与表述规则使用同一审核口径。</p></div><el-button type="primary" :icon="Plus" @click="openKnowledge()">新建知识</el-button></div>
      <el-segmented v-model="knowledgeView" :options="[
        { label: `知识 ${knowledge.length}`, value: 'entries' }, { label: `品牌版本 ${controls.brandProfiles.length}`, value: 'brand' },
        { label: `产品 ${controls.products.length}`, value: 'products' }, { label: `FAQ ${controls.faqs.length}`, value: 'faqs' },
        { label: `资质证书 ${controls.claims.length}`, value: 'claims' }, { label: `型号映射 ${controls.mappings.length}`, value: 'mappings' }, { label: `表述规则 ${controls.phraseRules.length}`, value: 'rules' },
      ]" />
      <template v-if="knowledgeView === 'entries'">
        <div class="filter-bar knowledge-filter"><el-input v-model="knowledgeFilter.query" clearable placeholder="搜索编号、标题、正文或回复" :prefix-icon="Search" @keyup.enter="run(loadKnowledge)" /><el-select v-model="knowledgeFilter.type" clearable placeholder="知识类型"><el-option v-for="item in knowledgeTypes" :key="item.value" :label="item.label" :value="item.value" /></el-select><el-select v-model="knowledgeFilter.model" clearable filterable placeholder="适用型号"><el-option v-for="item in controls.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.modelCode" /></el-select><el-select v-model="knowledgeFilter.status" clearable placeholder="状态"><el-option label="待审核" value="PENDING" /><el-option label="可用" value="READY" /><el-option label="禁用" value="BLOCKED" /></el-select><el-button type="primary" :icon="Search" @click="run(loadKnowledge)">查询</el-button></div>
        <div class="bulk-toolbar"><span>已选 {{ selectedKnowledge.length }} 条</span><el-button size="small" type="success" :disabled="!selectedKnowledge.length" @click="bulkManage('knowledge', 'APPROVE')">批量通过</el-button><el-button size="small" :disabled="!selectedKnowledge.length" @click="bulkManage('knowledge', 'BLOCK')">批量禁用</el-button><el-button size="small" type="danger" plain :disabled="!selectedKnowledge.length" @click="bulkManage('knowledge', 'ARCHIVE')">批量删除</el-button></div>
        <div class="data-panel"><el-table :data="knowledge" stripe height="500" @selection-change="selectedKnowledge = $event"><el-table-column type="selection" width="46" /><el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip /><el-table-column label="类型" width="100"><template #default="scope">{{ typeLabel(scope.row.type) }}</template></el-table-column><el-table-column prop="model" label="型号" width="110"><template #default="scope">{{ scope.row.model || '通用' }}</template></el-table-column><el-table-column label="内容" min-width="280" show-overflow-tooltip><template #default="scope">{{ scope.row.reply || scope.row.summary || scope.row.body || '待完善' }}</template></el-table-column><el-table-column label="来源" width="145"><template #default="scope">{{ scope.row.source }}<small class="cell-note">等级 {{ scope.row.sourceLevel || 'B' }}</small></template></el-table-column><el-table-column label="调用" width="90"><template #default="scope"><el-tag :type="scope.row.aiCallable ? 'success' : 'info'">{{ scope.row.aiCallable ? '可调用' : '未进入' }}</el-tag></template></el-table-column><el-table-column label="状态" width="90"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column><el-table-column label="操作" width="225" fixed="right"><template #default="scope"><el-button link type="primary" @click="openKnowledge(scope.row)">编辑</el-button><el-button v-if="scope.row.status !== 'READY'" link type="success" @click="reviewKnowledge(scope.row, true)">通过</el-button><el-button v-if="scope.row.status !== 'BLOCKED'" link type="danger" @click="reviewKnowledge(scope.row, false)">禁用</el-button><el-button link type="danger" @click="archiveKnowledge(scope.row)">删除</el-button></template></el-table-column><el-table-column prop="id" label="知识编号" width="165" fixed="right" show-overflow-tooltip /></el-table></div>
      </template>
      <div v-else-if="knowledgeView === 'brand'" class="data-panel"><el-table :data="controls.brandProfiles" stripe height="545"><el-table-column prop="version" label="版本" width="90" /><el-table-column prop="title" label="品牌版本" min-width="180" /><el-table-column prop="positioning" label="品牌定位" min-width="300" show-overflow-tooltip /><el-table-column prop="source" label="来源" min-width="180" /><el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column><el-table-column label="生效时间" width="150"><template #default="scope">{{ dateTime(scope.row.effectiveAt) }}</template></el-table-column><el-table-column label="操作" width="130" fixed="right"><template #default="scope"><el-button link type="primary" @click="openControl('brand-profiles', scope.row)">编辑</el-button><el-button link type="danger" @click="archiveControl('brand-profiles', scope.row)">删除</el-button></template></el-table-column></el-table></div>
      <div v-else-if="knowledgeView === 'products'"><div class="bulk-toolbar"><span>已选 {{ selectedProducts.length }} 条</span><el-button size="small" type="success" :disabled="!selectedProducts.length" @click="bulkManage('products', 'ENABLE')">批量启用</el-button><el-button size="small" :disabled="!selectedProducts.length" @click="bulkManage('products', 'DISABLE')">批量停用</el-button><el-button size="small" type="danger" plain :disabled="!selectedProducts.length" @click="bulkManage('products', 'ARCHIVE')">批量删除</el-button></div><div class="data-panel"><el-table :data="controls.products" stripe height="500" @selection-change="selectedProducts = $event"><el-table-column type="selection" width="46" /><el-table-column prop="modelCode" label="型号" width="140" /><el-table-column prop="name" label="产品名称" min-width="240" /><el-table-column prop="category" label="系列" width="160" /><el-table-column label="SKU" width="90"><template #default="scope">{{ scope.row.skus?.length || 0 }}</template></el-table-column><el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column><el-table-column label="操作" width="130" fixed="right"><template #default="scope"><el-button link type="primary" @click="openProduct(scope.row)">编辑</el-button><el-button link type="danger" @click="archiveControl('products', scope.row)">删除</el-button></template></el-table-column></el-table></div></div>
      <div v-else-if="knowledgeView === 'faqs'"><div class="bulk-toolbar"><span>已选 {{ selectedFaqs.length }} 条</span><el-button size="small" type="success" :disabled="!selectedFaqs.length" @click="bulkManage('faqs', 'APPROVE')">批量通过</el-button><el-button size="small" :disabled="!selectedFaqs.length" @click="bulkManage('faqs', 'BLOCK')">批量禁用</el-button><el-button size="small" type="danger" plain :disabled="!selectedFaqs.length" @click="bulkManage('faqs', 'ARCHIVE')">批量删除</el-button></div><div class="data-panel"><el-table :data="controls.faqs" stripe height="500" @selection-change="selectedFaqs = $event"><el-table-column type="selection" width="46" /><el-table-column prop="standardQuestion" label="标准问题" min-width="220" /><el-table-column prop="shortAnswer" label="短回复" min-width="280" show-overflow-tooltip /><el-table-column label="不同问法" width="100"><template #default="scope">{{ scope.row.variants?.length || 0 }}</template></el-table-column><el-table-column prop="frequency" label="频次" width="80" /><el-table-column label="状态" width="90"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column><el-table-column label="AI调用" width="100"><template #default="scope"><el-tag :type="scope.row.externallyUsable ? 'success' : 'info'">{{ scope.row.externallyUsable ? '可调用' : '未进入' }}</el-tag></template></el-table-column><el-table-column label="操作" width="130" fixed="right"><template #default="scope"><el-button link type="primary" @click="openControl('faqs', scope.row)">编辑</el-button><el-button link type="danger" @click="archiveControl('faqs', scope.row)">删除</el-button></template></el-table-column><el-table-column prop="faqNo" label="FAQ编号" width="165" fixed="right" show-overflow-tooltip /></el-table></div></div>
      <div v-else-if="knowledgeView === 'claims'" class="data-panel"><el-table :data="controls.claims" stripe height="545"><el-table-column prop="name" label="证书名称" min-width="210" /><el-table-column prop="coveredObject" label="适用范围" min-width="230" show-overflow-tooltip /><el-table-column prop="publicWording" label="允许表述" min-width="320" show-overflow-tooltip /><el-table-column prop="internalRestriction" label="使用限制" min-width="250" show-overflow-tooltip /><el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column><el-table-column label="操作" width="130" fixed="right"><template #default="scope"><el-button link type="primary" @click="openControl('claims', scope.row)">编辑</el-button><el-button link type="danger" @click="archiveControl('claims', scope.row)">删除</el-button></template></el-table-column></el-table></div>
      <div v-else-if="knowledgeView === 'mappings'" class="data-panel"><el-table :data="controls.mappings" stripe height="545"><el-table-column prop="commercialName" label="商品名称" min-width="180" /><el-table-column prop="nameplateModel" label="包装/铭牌型号" min-width="190" /><el-table-column prop="registeredModel" label="注册型号" min-width="190" /><el-table-column prop="registrationNumber" label="注册编号" min-width="200" /><el-table-column prop="requiredAction" label="发布前动作" min-width="300" show-overflow-tooltip /><el-table-column label="操作" width="130" fixed="right"><template #default="scope"><el-button link type="primary" @click="openControl('mappings', scope.row)">编辑</el-button><el-button link type="danger" @click="archiveControl('mappings', scope.row)">删除</el-button></template></el-table-column></el-table></div>
      <div v-else><div class="bulk-toolbar"><span>受限脚本会同时检查文案和素材画面标签</span><el-button type="primary" :icon="Plus" @click="restrictedRulesDialog = true">批量添加受限规则</el-button></div><div class="data-panel"><el-table :data="controls.phraseRules" stripe height="500"><el-table-column label="规则类别" width="160"><template #default="scope">{{ scope.row.category === 'HEALTH_RESTRICTED_WORD' ? '受限脚本风险词' : scope.row.category === 'HEALTH_RESTRICTED_VISUAL' ? '受限脚本风险画面' : scope.row.category }}</template></el-table-column><el-table-column prop="blockedText" label="禁用内容" min-width="260" /><el-table-column prop="replacement" label="建议替代表述" min-width="260" /><el-table-column prop="condition" label="使用条件" min-width="240" /><el-table-column label="操作" width="130" fixed="right"><template #default="scope"><el-button link type="primary" @click="openControl('rules', scope.row)">编辑</el-button><el-button link type="danger" @click="archiveControl('rules', scope.row)">删除</el-button></template></el-table-column></el-table></div></div>
    </template>

    <template v-else-if="activeTab === 'keywords'">
      <div class="workspace-heading">
        <div><h3>智能关键词</h3><p>抖音与TikTok独立计算，人工关键词和运营方向优先；每日每个平台最多进入50个采集词。</p></div>
        <div class="collector-actions">
          <el-button @click="generateSmartKeywordPlan('DOUYIN')">生成抖音关键词</el-button>
          <el-button @click="generateSmartKeywordPlan('TIKTOK')">生成TikTok关键词</el-button>
          <el-button @click="openSmartKeywordBatch()">批量导入</el-button>
          <el-button @click="openKeywordDirection()">新增方向</el-button>
          <el-button type="primary" :icon="Plus" @click="openSmartKeyword()">人工新增</el-button>
        </div>
      </div>
      <el-segmented v-model="keywordView" :options="[
        { label: `关键词总览 ${smartKeywordResult.total || 0}`, value: 'overview' },
        { label: '抖音关键词', value: 'douyin' },
        { label: 'TikTok关键词', value: 'tiktok' },
        { label: `关键词簇 ${keywordClusters.length}`, value: 'clusters' },
        { label: `运营方向 ${keywordDirections.length}`, value: 'directions' },
        { label: '效果复盘', value: 'review' },
        { label: '数据源状态', value: 'sources' },
      ]" @change="handleKeywordViewChange" />

      <template v-if="['overview','douyin','tiktok','review'].includes(keywordView)">
        <div class="report-summary keyword-summary">
          <article><span>关键词主库</span><strong>{{ smartKeywordResult.total || 0 }}</strong><small>数量不限，按平台独立管理</small></article>
          <article><span>S/A级</span><strong>{{ (smartKeywordResult.items || []).filter((item: Row) => ['S','A'].includes(item.grade)).length }}</strong><small>智能视频可直接调用</small></article>
          <article><span>人工置顶</span><strong>{{ (smartKeywordResult.items || []).filter((item: Row) => item.pinned).length }}</strong><small>优先占用每日50个名额</small></article>
          <article><span>命中视频</span><strong>{{ (smartKeywordResult.items || []).reduce((sum: number, item: Row) => sum + Number(item.hitCount || 0), 0) }}</strong><small>发布与采集效果持续回流</small></article>
        </div>
        <div class="filter-bar keyword-filter">
          <el-input v-model="smartKeywordFilter.search" clearable placeholder="搜索关键词、用户表达或场景" :prefix-icon="Search" @keyup.enter="run(loadSmartKeywordWorkspace)" />
          <el-select v-model="smartKeywordFilter.type" clearable placeholder="关键词类型"><el-option v-for="item in smartKeywordTypes" :key="item.value" :label="item.label" :value="item.value" /></el-select>
          <el-select v-model="smartKeywordFilter.grade" clearable placeholder="机会等级"><el-option v-for="item in ['S','A','B','C']" :key="item" :label="item" :value="item" /></el-select>
          <el-select v-model="smartKeywordFilter.status" clearable placeholder="状态"><el-option label="启用" value="ACTIVE" /><el-option label="暂停" value="PAUSED" /><el-option label="归档" value="ARCHIVED" /></el-select>
          <el-button type="primary" :icon="Search" @click="run(loadSmartKeywordWorkspace)">查询</el-button>
        </div>
        <div class="data-panel">
          <el-table :data="smartKeywordResult.items || []" stripe height="535">
            <el-table-column label="平台" width="92"><template #default="scope"><el-tag>{{ scope.row.platform === 'TIKTOK' ? 'TikTok' : '抖音' }}</el-tag></template></el-table-column>
            <el-table-column label="关键词" min-width="230"><template #default="scope"><strong>{{ scope.row.keyword }}</strong><small class="cell-note">{{ scope.row.reason || '待补充生成原因' }}</small></template></el-table-column>
            <el-table-column label="类型/产品" width="150"><template #default="scope">{{ smartKeywordTypeLabel(scope.row.type) }}<small class="cell-note">{{ scope.row.product?.modelCode || '通用' }}</small></template></el-table-column>
            <el-table-column label="词簇" min-width="165"><template #default="scope">{{ scope.row.cluster?.name || '待聚类' }}</template></el-table-column>
            <el-table-column label="来源" width="105"><template #default="scope"><el-tag size="small" :type="scope.row.source === 'MANUAL' ? 'warning' : scope.row.source === 'DIRECTION' ? 'success' : 'info'">{{ scope.row.source }}</el-tag></template></el-table-column>
            <el-table-column label="机会" width="100"><template #default="scope"><el-tag :type="viralGradeType(scope.row.grade)">{{ scope.row.grade }}</el-tag><small class="cell-note">{{ Number(scope.row.opportunityScore || 0).toFixed(1) }}分</small></template></el-table-column>
            <el-table-column label="采集" width="82"><template #default="scope"><el-switch :model-value="scope.row.collectionEnabled" @change="(value: boolean) => updateSmartKeywordFlag(scope.row, 'collectionEnabled', value)" /></template></el-table-column>
            <el-table-column label="视频" width="82"><template #default="scope"><el-switch :model-value="scope.row.contentEnabled" @change="(value: boolean) => updateSmartKeywordFlag(scope.row, 'contentEnabled', value)" /></template></el-table-column>
            <el-table-column label="置顶/锁定" width="130"><template #default="scope"><el-button link :type="scope.row.pinned ? 'warning' : 'info'" @click="updateSmartKeywordFlag(scope.row, 'pinned', !scope.row.pinned)">{{ scope.row.pinned ? '已置顶' : '置顶' }}</el-button><el-button link :type="scope.row.locked ? 'danger' : 'info'" @click="updateSmartKeywordFlag(scope.row, 'locked', !scope.row.locked)">{{ scope.row.locked ? '已锁定' : '锁定' }}</el-button></template></el-table-column>
            <el-table-column label="命中/更新" width="120"><template #default="scope">{{ scope.row.hitCount || 0 }}<small class="cell-note">{{ dateTime(scope.row.lastSeenAt) }}</small></template></el-table-column>
            <el-table-column label="操作" width="235" fixed="right"><template #default="scope"><el-button link type="primary" @click="openSmartKeyword(scope.row)">编辑</el-button><el-button link @click="openSmartKeywordAnalysis(scope.row)">分析</el-button><el-button link type="success" :disabled="!['S','A'].includes(scope.row.grade) || !scope.row.contentEnabled" @click="generateVideoFromKeyword(scope.row)">生成视频</el-button><el-dropdown trigger="click" @command="(status: string) => updateSmartKeywordFlag(scope.row, 'status', status)"><el-button link>状态</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="ACTIVE">恢复</el-dropdown-item><el-dropdown-item command="PAUSED">暂停</el-dropdown-item><el-dropdown-item command="ARCHIVED">归档</el-dropdown-item></el-dropdown-menu></template></el-dropdown></template></el-table-column>
          </el-table>
        </div>
      </template>

      <div v-else-if="keywordView === 'clusters'" class="data-panel">
        <el-table :data="keywordClusters" stripe height="585">
          <el-table-column prop="name" label="关键词簇" min-width="220" />
          <el-table-column prop="canonicalKey" label="跨语言标识" min-width="220" />
          <el-table-column label="抖音主词/同义词" min-width="260"><template #default="scope">{{ scope.row.keywords?.filter((item: Row) => item.platform === 'DOUYIN').map((item: Row) => item.keyword).join('、') || '—' }}</template></el-table-column>
          <el-table-column label="TikTok主词/同义词" min-width="270"><template #default="scope">{{ scope.row.keywords?.filter((item: Row) => item.platform === 'TIKTOK').map((item: Row) => item.keyword).join('、') || '—' }}</template></el-table-column>
          <el-table-column label="人群/痛点/场景" min-width="300"><template #default="scope">{{ [...(scope.row.audienceTerms || []), ...(scope.row.painTerms || []), ...(scope.row.sceneTerms || [])].join('、') || '—' }}</template></el-table-column>
        </el-table>
      </div>

      <div v-else-if="keywordView === 'directions'" class="data-panel">
        <div class="bulk-toolbar"><span>方向优先于AI自动判断，所有修改保留版本和操作人。</span><el-button type="primary" :icon="Plus" @click="openKeywordDirection()">新增运营方向</el-button></div>
        <el-table :data="keywordDirections" stripe height="530">
          <el-table-column label="方向" min-width="190"><template #default="scope"><strong>{{ scope.row.name }}</strong><small class="cell-note">V{{ scope.row.version }} · {{ scope.row.platform === 'TIKTOK' ? 'TikTok' : '抖音' }}</small></template></el-table-column>
          <el-table-column label="产品/人群" min-width="220"><template #default="scope">{{ list(scope.row.productSeries) }}<small class="cell-note">{{ list(scope.row.audienceTerms) }}</small></template></el-table-column>
          <el-table-column label="痛点/场景" min-width="260"><template #default="scope">{{ list(scope.row.painTerms) }}<small class="cell-note">{{ list(scope.row.sceneTerms) }}</small></template></el-table-column>
          <el-table-column label="加强/排除" min-width="260"><template #default="scope">加强：{{ list(scope.row.boostTerms) }}<small class="cell-note">排除：{{ list(scope.row.excludeTerms) }}</small></template></el-table-column>
          <el-table-column label="效果回流" width="145"><template #default="scope">{{ scope.row.performance?.averageScore || 0 }}分 · 命中{{ scope.row.performance?.hitCount || 0 }}<small class="cell-note">S/A {{ scope.row.performance?.highOpportunityCount || 0 }} · 视频调用{{ scope.row.performance?.contentUsages || 0 }}</small></template></el-table-column>
          <el-table-column label="探索" width="90"><template #default="scope">{{ Math.round(Number(scope.row.explorationRatio || 0) * 100) }}%</template></el-table-column>
          <el-table-column label="有效期" width="175"><template #default="scope">{{ dateTime(scope.row.startAt) }}<small class="cell-note">至 {{ dateTime(scope.row.endAt) }}</small></template></el-table-column>
          <el-table-column label="状态" width="90"><template #default="scope"><el-tag :type="scope.row.active ? 'success' : 'info'">{{ scope.row.active ? '启用' : '停用' }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="150" fixed="right"><template #default="scope"><el-button link type="primary" @click="openKeywordDirection(scope.row)">编辑</el-button><el-button link :type="scope.row.active ? 'warning' : 'success'" @click="run(async () => { await patch(`/api/v1/brand-data/keyword-directions/${scope.row.id}`, { active: !scope.row.active }); await loadSmartKeywordWorkspace(); }, scope.row.active ? '方向已停用' : '方向已启用')">{{ scope.row.active ? '停用' : '启用' }}</el-button></template></el-table-column>
        </el-table>
      </div>

      <div v-else class="collector-capabilities">
        <article v-for="item in keywordSourceStatus" :key="item.platform">
          <strong>{{ item.platform === 'TIKTOK' ? 'TikTok关键词源' : '抖音关键词源' }}</strong>
          <el-tag :type="statusType(item.state)">{{ statusLabel(item.state) }}</el-tag>
          <span>{{ item.message }}</span>
          <small v-if="item.platform === 'DOUYIN'">本地Chrome：{{ item.localCollector ? statusLabel(item.localCollector.state) : '未配置' }} · 一方知识：已接入</small>
          <small v-else>Creator Search Insights：未配置 · Keyword Insights：未配置 · Top Ads：未配置 · 一方知识：已接入</small>
        </article>
      </div>
    </template>

    <template v-else-if="activeTab === 'assets'">
      <div class="workspace-heading"><div><h3>素材库</h3><p>按型号、用途、功能、场景、动作和景别建立AI剪辑索引。</p></div><div><el-button type="danger" plain @click="trashAssets(true)">清空素材库</el-button><el-button @click="rebuildAssetIndex">重建AI索引</el-button><el-button :icon="Refresh" @click="syncAssets">扫描同步</el-button><el-button type="primary" :icon="Plus" @click="openBatchUpload">上传素材</el-button></div></div>
      <el-segmented v-model="assetView" :options="[{ label: `素材 ${assetTotal}`, value: 'list' }, { label: `待审核 ${overview?.assets.pending || 0}`, value: 'review' }, { label: `回收站 ${overview?.assets.trash || 0}`, value: 'trash' }, { label: '视频切片', value: 'video' }, { label: `AI处理 ${jobs.length}`, value: 'jobs' }, { label: `缺口 ${gaps.filter(item => item.gapCount > 0).length}`, value: 'gaps' }, { label: '日报', value: 'report' }, { label: '增长闭环', value: 'loop' }]" @change="handleAssetViewChange" />

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

      <template v-else-if="assetView === 'list' || assetView === 'review' || assetView === 'trash'">
        <div class="asset-index">
          <button :class="{ active: !assetFilter.kind && !assetFilter.reviewStatus }" @click="quickFilter()">全部素材 <b>{{ overview?.assets.total || 0 }}</b></button>
          <button :class="{ active: assetFilter.kind === 'IMAGE' }" @click="quickFilter('IMAGE')">图片</button>
          <button :class="{ active: assetFilter.kind === 'VIDEO' }" @click="quickFilter('VIDEO')">视频</button>
          <button :class="{ active: assetFilter.kind === 'AUDIO' }" @click="quickFilter('AUDIO')">音频</button>
          <button :class="{ active: assetFilter.kind === 'DOCUMENT' }" @click="quickFilter('DOCUMENT')">文档</button>
          <button :class="{ active: assetFilter.reviewStatus === 'PENDING' }" @click="quickFilter('', 'PENDING')">待审核 <b>{{ overview?.assets.pending || 0 }}</b></button>
        </div>
        <div v-if="assetView === 'list'" class="filter-bar asset-filter">
          <el-input v-model="assetFilter.query" clearable placeholder="搜索型号、用途、功能、场景、动作或关键词" :prefix-icon="Search" @keyup.enter="run(() => loadAssets())" />
          <el-select v-model="assetFilter.kind" clearable placeholder="素材类型"><el-option v-for="item in kindOptions" :key="item" :label="kindLabel(item)" :value="item" /></el-select>
          <el-select v-model="assetFilter.model" clearable filterable placeholder="产品型号"><el-option v-for="item in controls.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.modelCode" /></el-select>
          <el-select v-model="assetFilter.reviewStatus" clearable placeholder="审核状态"><el-option label="待审核" value="PENDING" /><el-option label="已通过" value="APPROVED" /><el-option label="已退回" value="RETURNED" /><el-option label="已拒绝" value="REJECTED" /></el-select>
          <el-button type="primary" :icon="Search" @click="run(() => loadAssets())">查询</el-button>
          <el-collapse class="advanced-filter"><el-collapse-item title="更多筛选" name="advanced"><div class="advanced-filter-grid"><el-select v-model="assetFilter.level" clearable placeholder="素材层级"><el-option v-for="item in levelOptions" :key="item" :label="item" :value="item" /></el-select><el-select v-model="assetFilter.moduleType" clearable placeholder="视频模块"><el-option v-for="item in moduleOptions" :key="item" :label="item" :value="item" /></el-select><el-select v-model="assetFilter.employeeId" clearable filterable placeholder="上传员工"><el-option v-for="item in controls.employees" :key="item.id" :label="item.name" :value="item.id" /></el-select><el-select v-model="assetFilter.rightsStatus" clearable placeholder="使用权限"><el-option v-for="item in rightsOptions" :key="item" :label="statusLabel(item)" :value="item" /></el-select></div></el-collapse-item></el-collapse>
        </div>
        <div v-if="assetView === 'list' && quickAssetTags.length" class="asset-tag-filters">
          <span>AI标签快捷筛选</span>
          <el-tag v-for="[label, count] in quickAssetTags" :key="label" class="clickable-tag" :type="assetFilter.query === label ? 'primary' : 'info'" :effect="assetFilter.query === label ? 'dark' : 'plain'" @click="filterByAssetTag(label)">{{ label }} {{ count }}</el-tag>
        </div>
        <div v-if="assetView === 'list' && assets.length" class="editing-index-strip">
          <div class="editing-index-strip-head"><strong>剪辑AI索引</strong><span>组合名称与结构化标签均可被上方搜索框检索</span></div>
          <button v-for="row in assets" :key="`${row.id}-index`" type="button" @click="openDetail(row)">
            <strong>{{ assetIndexSummary(row) }}</strong>
            <small>{{ assetIndexEntries(row).slice(0, 4).map(entry => `${entry.label}：${entry.values.slice(0, 2).join('、')}`).join(' · ') || '等待AI查看画面' }}</small>
            <el-tag size="small" :type="row.indexNeedsReview ? 'warning' : 'success'">{{ row.indexVersion ? `${Math.round(Number(row.indexConfidence || 0) * 100)}%` : '待建立' }}</el-tag>
          </button>
        </div>
        <div v-if="assetView === 'trash'" class="bulk-toolbar"><span>已选 {{ selectedAssets.length }} 条 · 删除后保留3天</span><el-button size="small" type="success" :disabled="!selectedAssets.length" @click="restoreAssets()">恢复所选</el-button></div>
        <div v-else class="bulk-toolbar"><span>已选 {{ selectedAssets.length }} 条</span><el-button size="small" type="primary" :disabled="!selectedAssets.length" @click="openAssetBulk">批量修改</el-button><el-button size="small" type="success" :disabled="!selectedAssets.length" @click="bulkAssets('APPROVE')">批量通过</el-button><el-button size="small" :disabled="!selectedAssets.length" @click="bulkAssets('REANALYZE')">批量重分析</el-button><el-button size="small" type="warning" plain :disabled="!selectedAssets.length" @click="bulkAssets('ARCHIVE')">归档所选</el-button><el-button size="small" type="danger" :disabled="!selectedAssets.length" @click="trashAssets(false)">删除所选</el-button></div>
        <div class="data-panel"><el-table :data="assets" stripe height="540" @selection-change="selectedAssets = $event"><el-table-column type="selection" width="46" /><el-table-column label="预览" width="112"><template #default="scope"><img v-if="scope.row.kind === 'IMAGE' && scope.row.thumbnailUrl" class="asset-thumb" :src="scope.row.thumbnailUrl" loading="lazy" @click="openDetail(scope.row)" /><button v-else class="asset-placeholder" type="button" @click="openDetail(scope.row)">{{ kindLabel(scope.row.kind) }}</button></template></el-table-column><el-table-column label="素材" min-width="290"><template #default="scope"><strong>{{ scope.row.displayName }}</strong><button class="cell-note preview-link" type="button" title="点击预览素材" @click="openDetail(scope.row)">{{ scope.row.assetNo }} · {{ fileSize(scope.row.sizeBytes) }}</button></template></el-table-column><el-table-column label="类型" width="105"><template #default="scope">{{ kindLabel(scope.row.kind) }}<small class="cell-note">{{ scope.row.level }}</small></template></el-table-column><el-table-column label="型号" width="150"><template #default="scope">{{ scope.row.products?.length ? scope.row.products.map((item: Row) => item.modelCode).join('、') : (scope.row.model || '待确认') }}</template></el-table-column><el-table-column label="AI索引" width="145"><template #default="scope"><el-tag :type="scope.row.indexNeedsReview ? 'warning' : 'success'">{{ scope.row.indexVersion ? `${Math.round(Number(scope.row.indexConfidence || 0) * 100)}%` : '待建立' }}</el-tag><small class="cell-note">V{{ scope.row.indexVersion || 0 }} · {{ scope.row.tags?.length || 0 }}个标签</small></template></el-table-column><el-table-column label="上传员工" width="135"><template #default="scope">{{ scope.row.createdByEmployee?.name || scope.row.actor }}</template></el-table-column><el-table-column v-if="assetView === 'trash'" label="彻底删除时间" width="175"><template #default="scope">{{ dateTime(scope.row.purgeAfter) }}</template></el-table-column><el-table-column v-else label="状态" width="150"><template #default="scope"><el-tag :type="statusType(scope.row.reviewStatus)">{{ statusLabel(scope.row.reviewStatus) }}</el-tag><small class="cell-note">{{ statusLabel(scope.row.processingStatus) }} · {{ statusLabel(scope.row.availabilityStatus) }}</small></template></el-table-column><el-table-column v-if="assetView === 'trash'" label="操作" width="130" fixed="right"><template #default="scope"><el-button link :icon="View" @click="openDetail(scope.row)">详情</el-button><el-button link type="success" @click="restoreAssets([scope.row.id])">恢复</el-button></template></el-table-column><el-table-column v-else label="操作" width="340" fixed="right"><template #default="scope"><el-button link :icon="View" @click="openDetail(scope.row)">详情</el-button><el-button link type="primary" @click="openMetadata(scope.row)">编辑</el-button><el-button link @click="openReplace(scope.row)">替换</el-button><el-button v-if="scope.row.objectKey" link :icon="Download" @click="downloadAsset(scope.row)">下载</el-button><el-button v-if="scope.row.reviewStatus === 'PENDING'" link type="success" @click="reviewAsset(scope.row, 'APPROVE')">通过</el-button><el-dropdown v-if="scope.row.reviewStatus === 'PENDING'" trigger="click" @command="(action: string) => reviewAsset(scope.row, action)"><el-button link type="warning">其他处理</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="RETURN">退回修改</el-dropdown-item><el-dropdown-item command="INTERNAL_ONLY">仅内部</el-dropdown-item><el-dropdown-item command="REJECT" divided>拒绝</el-dropdown-item></el-dropdown-menu></template></el-dropdown><el-button link @click="reanalyze(scope.row)">重分析</el-button></template></el-table-column></el-table></div>
        <div v-if="nextCursor && assetView === 'list'" class="load-more"><el-button @click="run(() => loadAssets(false))">加载更多</el-button></div>
      </template>

      <template v-else-if="assetView === 'video'">
        <div class="video-toolbar"><el-select v-model="selectedVideoId" filterable placeholder="选择视频原片" @change="run(loadSegments)"><el-option v-for="item in videoAssets" :key="item.id" :label="`${item.assetNo} · ${item.displayName}`" :value="item.id" /></el-select><span>系统先生成切段建议和预览；确认片段后再生成高质量模块文件。</span></div>
        <div class="data-panel"><el-table :data="segments" stripe height="545"><el-table-column label="时间范围" width="210"><template #default="scope"><div class="time-range"><el-input-number v-model="scope.row.startSeconds" :min="0" :precision="2" controls-position="right" /><span>—</span><el-input-number v-model="scope.row.endSeconds" :min="0" :precision="2" controls-position="right" /></div></template></el-table-column><el-table-column label="模块" width="150"><template #default="scope"><el-select v-model="scope.row.moduleType" clearable><el-option v-for="item in moduleOptions" :key="item" :label="item" :value="item" /></el-select></template></el-table-column><el-table-column label="转写/说明" min-width="340"><template #default="scope"><el-input v-model="scope.row.transcript" /></template></el-table-column><el-table-column prop="analysisVersion" label="分析版本" width="95" /><el-table-column label="状态" width="110"><template #default="scope">{{ scope.row.status }}</template></el-table-column><el-table-column label="操作" width="180"><template #default="scope"><el-button link type="primary" @click="saveSegment(scope.row)">保存</el-button><el-button link type="success" :disabled="Boolean(scope.row.materializedAssetId)" @click="materializeSegment(scope.row)">{{ scope.row.materializedAssetId ? '已生成' : '生成模块' }}</el-button></template></el-table-column></el-table></div>
      </template>

      <template v-else-if="assetView === 'jobs'">
        <div class="capability-note"><strong>AI能力状态</strong><span>深圳OSS / IMS / 百炼分项显示最近成功和最近错误</span><el-button link type="primary" @click="run(async () => { await loadJobs(); await loadAiCapabilities(); })">刷新状态与队列</el-button></div>
        <div class="ai-capability-grid">
          <article v-for="item in aiCapabilityItems" :key="item.key">
            <div><strong>{{ item.label }}</strong><small>{{ item.message }}</small></div>
            <el-tag :type="statusType(item.state)">{{ statusLabel(item.state) }}</el-tag>
            <span>最后成功：{{ dateTime(item.lastSuccessAt || undefined) }}</span>
            <span v-if="item.recentError" class="danger">最近错误：{{ item.recentError }}</span>
          </article>
        </div>
        <div class="data-panel"><el-table :data="jobs" stripe height="545"><el-table-column label="素材" min-width="210"><template #default="scope">{{ scope.row.asset?.assetNo }}<small class="cell-note">{{ scope.row.asset?.displayName || scope.row.asset?.fileName }}</small></template></el-table-column><el-table-column prop="type" label="任务" width="190" /><el-table-column prop="provider" label="执行方" width="150" /><el-table-column prop="model" label="模型" width="150"><template #default="scope">{{ scope.row.model || '本地工具' }}</template></el-table-column><el-table-column label="状态" width="120"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column><el-table-column prop="attempts" label="尝试" width="75" /><el-table-column prop="failureReason" label="失败/未配置原因" min-width="260" show-overflow-tooltip /><el-table-column label="更新时间" width="145"><template #default="scope">{{ dateTime(scope.row.updatedAt) }}</template></el-table-column></el-table></div>
      </template>

      <template v-else-if="assetView === 'gaps'">
        <div class="workspace-heading compact"><div><h3>AI缺失素材分析</h3><p>选择产品型号，AI读取该型号当前可用素材索引，列出真正缺少的具体画面。</p></div><div class="gap-analysis-actions"><el-select v-model="gapProductModel" filterable placeholder="选择产品型号" @change="loadGapTasks"><el-option v-for="item in controls.products.filter(item => item.status === 'READY')" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.modelCode" /></el-select><el-button type="primary" :icon="Search" @click="analyzeSelectedProductGaps">分析缺失素材</el-button></div></div>
        <div class="gap-task-toolbar"><span>已选择 {{ selectedGaps.length }} 项缺失素材</span><el-button type="primary" :disabled="!selectedGaps.length" @click="createGapTasks">生成补拍任务</el-button></div>
        <div class="data-panel"><el-table :data="gaps" stripe height="360" @selection-change="selectedGaps = $event"><el-table-column type="selection" width="46" :selectable="(row: Row) => row.gapCount > 0" /><el-table-column prop="productModel" label="型号" width="120" /><el-table-column prop="assetKind" label="类型" width="90" /><el-table-column prop="category" label="缺失类别" min-width="170" /><el-table-column label="优先级" width="90"><template #default="scope"><el-tag :type="scope.row.severity === 'HIGH' ? 'danger' : 'warning'">{{ scope.row.severity }}</el-tag></template></el-table-column><el-table-column prop="recommendation" label="需要补拍的具体素材" min-width="430" /><el-table-column prop="generatedBy" label="分析方式" width="140" /></el-table></div>
        <div class="workspace-heading compact"><div><h3>补拍任务</h3><p>拍摄完成后直接从任务上传，系统自动入素材库并建立AI索引。</p></div><el-button :icon="Refresh" @click="run(loadGapTasks)">刷新任务</el-button></div>
        <div class="data-panel"><el-table :data="gapTasks" stripe height="300"><el-table-column prop="title" label="任务" min-width="230" /><el-table-column prop="description" label="拍摄要求" min-width="330" /><el-table-column prop="priority" label="优先级" width="90" /><el-table-column label="截止" width="135"><template #default="scope">{{ dateTime(scope.row.dueAt) }}</template></el-table-column><el-table-column label="状态" width="105"><template #default="scope"><el-tag :type="scope.row.status === 'DONE' ? 'success' : 'warning'">{{ scope.row.status === 'DONE' ? '已完成' : '待补拍' }}</el-tag></template></el-table-column><el-table-column label="操作" width="130"><template #default="scope"><el-button v-if="scope.row.status !== 'DONE'" link type="primary" @click="openGapTaskUpload(scope.row)">上传补拍素材</el-button><span v-else>已入素材库</span></template></el-table-column></el-table></div>
      </template>

      <template v-else>
        <div class="report-summary" v-if="dailyReport"><article><span>员工上传</span><strong>{{ dailyReport.summary.uploaded }}</strong></article><article><span>正式新增</span><strong>{{ dailyReport.summary.created }}</strong></article><article><span>重复上传</span><strong>{{ dailyReport.summary.duplicates }}</strong></article><article><span>审核通过</span><strong>{{ dailyReport.summary.approved }}</strong></article><article><span>AI派生模块</span><strong>{{ dailyReport.summary.aiDerivedModules }}</strong></article><article><span>实际调用</span><strong>{{ dailyReport.summary.actualUsages }}</strong></article><article><span>效果回流</span><strong>{{ dailyReport.summary.metricSnapshots || 0 }}</strong></article><article><span>关键词计划</span><strong>{{ dailyReport.summary.keywordPlanCount || 0 }}</strong></article><article><span>S/A关键词</span><strong>{{ dailyReport.summary.highOpportunityKeywords || 0 }}</strong></article><article><span>下一轮任务</span><strong>{{ dailyReport.summary.generatedTasks || 0 }}</strong></article></div>
        <div class="two-panels" v-if="dailyReport"><div class="data-panel"><h4>员工增量</h4><el-table :data="dailyReport.employees" stripe height="420"><el-table-column prop="employee" label="员工" min-width="130" /><el-table-column prop="uploaded" label="上传" width="75" /><el-table-column prop="created" label="新增" width="75" /><el-table-column prop="duplicates" label="重复" width="75" /><el-table-column prop="failed" label="失败" width="75" /></el-table></div><div class="data-panel"><h4>当日素材记录</h4><el-table :data="dailyReport.uploads" stripe height="420"><el-table-column prop="asset.assetNo" label="素材编号" width="180" /><el-table-column prop="originalFileName" label="文件" min-width="180" show-overflow-tooltip /><el-table-column prop="batch.uploadedBy" label="员工/主体" width="140" /><el-table-column label="结果" width="120"><template #default="scope"><el-tag :type="scope.row.result === 'CREATED' ? 'success' : scope.row.result === 'FAILED' ? 'danger' : 'warning'">{{ scope.row.result }}</el-tag></template></el-table-column><el-table-column label="时间" width="135"><template #default="scope">{{ dateTime(scope.row.occurredAt) }}</template></el-table-column></el-table></div></div>
      </template>
    </template>

    <template v-else>
      <div class="workspace-heading">
        <div><h3>抖音爆款趋势研究</h3><p>本地专用Chrome发现12小时内视频；官方、自建与TikHub保留为备用渠道。</p></div>
        <div class="collector-actions">
          <el-button @click="generateViralKeywords">生成今日关键词</el-button>
          <el-button @click="openCollectorImport()">导入CSV</el-button>
          <el-button @click="openCollectorLink()">补录链接</el-button>
          <el-button type="primary" :icon="Refresh" @click="runViralCollector">立即采集抖音</el-button>
        </div>
      </div>
      <div class="viral-trend-summary">
        <article><span>12小时视频</span><strong>{{ viralTrend.summary?.total || 0 }}</strong><small>最后同步 {{ dateTime(viralTrend.summary?.lastSyncAt) }}</small></article>
        <article><span>速度达标</span><strong>{{ viralTrend.summary?.candidates || 0 }}</strong><small>播放速度 &gt; 1万/小时</small></article>
        <article><span>S级趋势</span><strong>{{ viralTrend.summary?.sGrade || 0 }}</strong><small>自动进入深度分析</small></article>
        <article><span>A级观察</span><strong>{{ viralTrend.summary?.aGrade || 0 }}</strong><small>运营人员选择分析</small></article>
      </div>
      <div class="local-collector-panel">
        <div>
          <strong>本地Chrome采集器</strong>
          <span v-if="viralTrend.devices?.length">共 {{ viralTrend.devices.length }} 台设备</span>
          <span v-else>尚未收到设备心跳</span>
        </div>
        <article v-for="device in viralTrend.devices || []" :key="device.id">
          <el-tag :type="statusType(device.state)">{{ statusLabel(device.state) }}</el-tag>
          <strong>{{ device.name || device.deviceId }}</strong>
          <span>Chrome：{{ statusLabel(device.chromeLoginState || 'OFFLINE') }}</span>
          <span>心跳 {{ dateTime(device.lastHeartbeatAt) }} · 同步 {{ dateTime(device.lastSyncAt) }}</span>
          <small v-if="device.lastError" class="danger">{{ device.lastError }}</small>
        </article>
      </div>
      <div class="viral-keyword-panel">
        <div class="panel-title">
          <div><h4>今日智能关键词</h4><small>{{ viralKeywordPlan.keywords?.length || 0 }}/50 · 产品、痛点、竞品、场景</small></div>
          <el-tag v-if="viralKeywordPlan.source">{{ viralKeywordPlan.source }}</el-tag>
        </div>
        <div class="viral-keywords">
          <button v-for="keyword in viralKeywordPlan.keywords || []" :key="keyword.id" :class="[`priority-${String(keyword.priority).toLowerCase()}`, { locked: keyword.locked }]" :title="keyword.reason" @click="toggleViralKeyword(keyword)">
            <b>{{ keyword.priority }}</b>{{ keyword.keyword }}<small>{{ smartKeywordTypeLabel(keyword.type) }} · 命中{{ keyword.hitCount || 0 }}</small>
          </button>
        </div>
      </div>
      <div class="collector-capabilities">
        <article v-for="item in viralCapabilities" :key="item.platform">
          <strong>{{ ({ DOUYIN: '抖音', TIKTOK: 'TikTok', XIAOHONGSHU: '小红书', WECHAT_CHANNELS: '视频号' } as Record<string, string>)[item.platform] || item.platform }}</strong>
          <el-tag :type="statusType(item.state)">{{ statusLabel(item.state) }}</el-tag>
          <span>{{ item.providerName }}</span>
          <span>{{ item.message }}</span>
          <small>方式 {{ item.mode }} · 每日上限 {{ item.dailyLimit }} · 关键词 {{ item.keywords?.length || 0 }}个</small>
          <div v-if="item.platform === 'DOUYIN'" class="collector-provider-status">
            <small><el-tag size="small" :type="statusType(item.providers?.officialSearch?.state)">{{ statusLabel(item.providers?.officialSearch?.state) }}</el-tag> 官方搜索：{{ item.providers?.officialSearch?.message }}</small>
            <small><el-tag size="small" :type="statusType(item.providers?.selfHosted?.state)">{{ statusLabel(item.providers?.selfHosted?.state) }}</el-tag> 自建渠道：{{ item.providers?.selfHosted?.message }}</small>
            <small><el-tag size="small" :type="statusType(item.providers?.tikHub?.state)">{{ statusLabel(item.providers?.tikHub?.state) }}</el-tag> TikHub：{{ item.providers?.tikHub?.message }}</small>
            <small><el-tag size="small" :type="statusType(item.providers?.mediaResolution?.state)">{{ statusLabel(item.providers?.mediaResolution?.state) }}</el-tag> 媒体解析：{{ item.providers?.mediaResolution?.message }}</small>
          </div>
          <el-button link type="primary" @click="openCollectorConfig(item)">配置</el-button>
          <el-button link @click="openCollectorImport(item.platform)">导入</el-button>
          <el-button link @click="openCollectorLink(item.platform)">补录</el-button>
        </article>
      </div>
      <div class="data-panel viral-trend-table">
        <h4>12小时爆款趋势</h4>
        <el-table :data="viralTrend.items || []" stripe height="540">
          <el-table-column type="expand" width="42">
            <template #default="scope">
              <div class="viral-expand">
                <div><strong>命中关键词</strong><span>{{ scope.row.keywordHits?.map((hit: Row) => hit.keyword?.keyword).filter(Boolean).join('、') || '—' }}</span></div>
                <div><strong>爆款指数分项</strong><span>速度 {{ Number(scope.row.latestMetric?.velocityScore || 0).toFixed(1) }} · 互动 {{ Number(scope.row.latestMetric?.engagementScore || 0).toFixed(1) }} · 收藏分享 {{ Number(scope.row.latestMetric?.saveShareScore || 0).toFixed(1) }} · 账号 {{ Number(scope.row.latestMetric?.accountQualityScore || 0).toFixed(1) }}</span></div>
                <div class="timeline"><strong>指标时间线</strong><span v-for="metric in scope.row.metrics || []" :key="metric.id">{{ dateTime(metric.capturedAt) }}：播放{{ compactNumber(metric.views) }} / 指数{{ Number(metric.viralIndex || 0).toFixed(1) }}</span></div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="视频/作者" min-width="235"><template #default="scope"><strong>{{ scope.row.title || scope.row.externalContentId }}</strong><small class="cell-note">{{ scope.row.author?.nickname || scope.row.accountName || '未记录作者' }} · 粉丝 {{ compactNumber(scope.row.author?.followerCount) }}</small></template></el-table-column>
          <el-table-column label="时间" width="145"><template #default="scope">{{ dateTime(scope.row.publishedAt) }}<small class="cell-note">采集 {{ dateTime(scope.row.latestMetric?.capturedAt) }}</small></template></el-table-column>
          <el-table-column label="播放/速度" width="135"><template #default="scope"><strong>{{ compactNumber(scope.row.latestMetric?.views) }}</strong><small class="cell-note">{{ compactNumber(scope.row.latestMetric?.playVelocity) }}/小时</small></template></el-table-column>
          <el-table-column label="互动" width="125"><template #default="scope">{{ percent(scope.row.latestMetric?.engagementRate) }}<small class="cell-note">藏享 {{ percent(scope.row.latestMetric?.saveShareRate) }}</small></template></el-table-column>
          <el-table-column label="赞/评/藏/享" width="160"><template #default="scope">{{ compactNumber(scope.row.latestMetric?.likes) }} / {{ compactNumber(scope.row.latestMetric?.comments) }}<small class="cell-note">{{ compactNumber(scope.row.latestMetric?.saves) }} / {{ compactNumber(scope.row.latestMetric?.shares) }}</small></template></el-table-column>
          <el-table-column label="作者涨粉" width="105"><template #default="scope">{{ Number(scope.row.latestMetric?.authorFollowerDelta || 0) > 0 ? '+' : '' }}{{ compactNumber(scope.row.latestMetric?.authorFollowerDelta) }}</template></el-table-column>
          <el-table-column label="爆款指数" width="110"><template #default="scope"><strong>{{ Number(scope.row.latestMetric?.viralIndex || 0).toFixed(1) }}</strong><el-tag size="small" :type="viralGradeType(scope.row.latestMetric?.viralGrade)">{{ scope.row.latestMetric?.viralGrade || 'C' }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="145" fixed="right"><template #default="scope"><el-button link type="primary" @click="openExternal(scope.row.sourceUrl)">预览</el-button><el-button link type="warning" @click="analyzeViralTrend(scope.row)">深度分析</el-button></template></el-table-column>
        </el-table>
      </div>
      <div class="two-panels viral-panels">
        <div class="data-panel">
          <h4>外部优质视频</h4>
          <el-table :data="externalVideos" stripe height="480">
            <el-table-column label="来源视频" min-width="220"><template #default="scope"><strong>{{ scope.row.title || scope.row.externalContentId }}</strong><small class="cell-note">{{ scope.row.platform }} · {{ scope.row.accountName || '未记录账号' }}</small></template></el-table-column>
            <el-table-column label="最新数据" width="125"><template #default="scope">播放 {{ scope.row.metrics?.[0]?.views ?? '未获取' }}<small class="cell-note">赞 {{ scope.row.metrics?.[0]?.likes ?? '未获取' }}</small></template></el-table-column>
            <el-table-column label="AI评级" width="100"><template #default="scope"><strong>{{ scope.row.scoreSnapshots?.[0]?.score ?? '待分析' }}</strong><small class="cell-note">{{ scope.row.scoreSnapshots?.[0]?.grade || '' }}</small></template></el-table-column>
            <el-table-column label="状态" width="125"><template #default="scope"><el-tag :type="statusType(scope.row.resolveJob?.status || scope.row.status)">{{ statusLabel(scope.row.resolveJob?.status || scope.row.status) }}</el-tag><small v-if="scope.row.resolveJob?.failureReason" class="cell-note">{{ scope.row.resolveJob.failureReason }}</small></template></el-table-column>
            <el-table-column label="操作" width="145"><template #default="scope"><el-button link type="primary" @click="openExternal(scope.row.sourceUrl)">查看</el-button><el-button v-if="!scope.row.sourceObjectKey || scope.row.resolveJob?.status === 'FAILED'" link type="warning" @click="resolveExternalVideo(scope.row)">{{ scope.row.resolveJob?.status === 'FAILED' ? '重试' : '解析' }}</el-button></template></el-table-column>
          </el-table>
        </div>
        <div class="data-panel">
          <h4>仿拍任务</h4>
          <el-table :data="remakeTasks" stripe height="480">
            <el-table-column label="任务" min-width="230"><template #default="scope"><strong>{{ scope.row.title }}</strong><small class="cell-note">{{ scope.row.reason }}</small></template></el-table-column>
            <el-table-column prop="score" label="评分" width="75" />
            <el-table-column label="负责人" width="105"><template #default="scope">{{ scope.row.ownerEmployee?.name || '待分配' }}</template></el-table-column>
            <el-table-column label="状态" width="125"><template #default="scope"><el-tag :type="scope.row.status === 'PENDING_CONFIRMATION' ? 'warning' : 'success'">{{ scope.row.status }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="90"><template #default="scope"><el-button v-if="scope.row.status === 'PENDING_CONFIRMATION'" link type="success" @click="confirmRemake(scope.row)">确认</el-button></template></el-table-column>
          </el-table>
        </div>
      </div>
      <div class="data-panel">
        <h4>IMS / 百炼云任务</h4>
        <el-table :data="cloudJobs" stripe height="330">
          <el-table-column prop="type" label="任务" width="185" />
          <el-table-column prop="provider" label="服务商" width="145" />
          <el-table-column label="业务对象" min-width="190"><template #default="scope">{{ scope.row.assetId || scope.row.externalVideoId }}</template></el-table-column>
          <el-table-column prop="externalJobId" label="云任务编号" min-width="185" show-overflow-tooltip />
          <el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column>
          <el-table-column prop="failureReason" label="失败原因" min-width="240" show-overflow-tooltip />
          <el-table-column prop="attempts" label="重试" width="75" />
          <el-table-column label="操作" width="80"><template #default="scope"><el-button v-if="['FAILED','UNCONFIGURED'].includes(scope.row.status)" link type="primary" @click="retryCloudJob(scope.row)">重试</el-button></template></el-table-column>
        </el-table>
      </div>
    </template>

    <el-dialog v-model="knowledgeDialog" :title="editingKnowledgeId ? '编辑品牌知识' : '新建品牌知识'" width="780px" destroy-on-close><el-form label-position="top" class="form-grid"><el-form-item label="知识类型" required><el-select v-model="knowledgeForm.type"><el-option v-for="item in knowledgeTypes" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item><el-form-item label="知识标题" required><el-input v-model="knowledgeForm.title" maxlength="100" /></el-form-item><el-form-item label="知识分类" required><el-select v-model="knowledgeForm.category" filterable placeholder="选择已有分类"><el-option v-for="item in controls.categories" :key="item" :label="item" :value="item" /></el-select></el-form-item><el-form-item label="适用型号"><el-select v-model="knowledgeForm.model" clearable filterable><el-option v-for="item in controls.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.modelCode" /></el-select></el-form-item><el-form-item label="标准回复/允许话术" class="full"><el-input v-model="knowledgeForm.reply" type="textarea" :rows="3" /></el-form-item><el-form-item label="完整正文" class="full"><el-input v-model="knowledgeForm.body" type="textarea" :rows="5" /></el-form-item><el-form-item label="关键词"><el-input v-model="knowledgeForm.keywords" placeholder="逗号分隔" /></el-form-item><el-form-item label="适用场景"><el-input v-model="knowledgeForm.scenarios" placeholder="逗号分隔" /></el-form-item><el-form-item label="来源等级"><el-select v-model="knowledgeForm.sourceLevel"><el-option v-for="item in ['A','B','C','D','E']" :key="item" :label="item" :value="item" /></el-select></el-form-item><el-form-item label="资料来源"><el-input v-model="knowledgeForm.source" /></el-form-item><el-form-item label="来源链接/文件" class="full"><el-input v-model="knowledgeForm.sourceRefs" /></el-form-item></el-form><template #footer><el-button @click="knowledgeDialog = false">取消</el-button><el-button @click="saveKnowledge('PENDING')">保存为待审核</el-button><el-button type="primary" @click="saveKnowledge('READY')">保存并直接入库</el-button></template></el-dialog>

    <el-dialog v-model="productDialog" title="编辑产品信息" width="760px" destroy-on-close><el-form label-position="top" class="form-grid"><el-form-item label="产品型号"><el-input v-model="productForm.modelCode" disabled /></el-form-item><el-form-item label="产品名称" required><el-input v-model="productForm.name" maxlength="120" /></el-form-item><el-form-item label="系列" required><el-input v-model="productForm.category" maxlength="60" /></el-form-item><el-form-item label="状态"><el-select v-model="productForm.status"><el-option label="可用" value="READY" /><el-option label="待审核" value="PENDING" /><el-option label="禁用" value="BLOCKED" /></el-select></el-form-item><el-form-item label="型号别名" class="full"><el-input v-model="productForm.aliases" placeholder="多个别名用逗号分隔" /></el-form-item><el-form-item label="核心功能" class="full"><el-input v-model="productForm.functions" type="textarea" :rows="2" placeholder="多个功能用逗号分隔" /></el-form-item><el-form-item label="用户价值" class="full"><el-input v-model="productForm.customerValues" type="textarea" :rows="2" placeholder="多个价值点用逗号分隔" /></el-form-item><el-form-item label="目标人群"><el-input v-model="productForm.audiences" placeholder="逗号分隔" /></el-form-item><el-form-item label="适用场景"><el-input v-model="productForm.scenes" placeholder="逗号分隔" /></el-form-item><el-form-item label="内容方向" class="full"><el-input v-model="productForm.contentDirections" type="textarea" :rows="2" placeholder="多个方向用逗号分隔" /></el-form-item></el-form><template #footer><el-button @click="productDialog = false">取消</el-button><el-button type="primary" @click="saveProduct">保存</el-button></template></el-dialog>

    <el-dialog v-model="keywordDialog" :title="editingKeywordId ? '编辑智能关键词' : '人工新增关键词'" width="820px" destroy-on-close>
      <el-form label-position="top" class="form-grid">
        <el-form-item label="平台" required><el-select v-model="smartKeywordForm.platform"><el-option label="抖音" value="DOUYIN" /><el-option label="TikTok" value="TIKTOK" /></el-select></el-form-item>
        <el-form-item label="关键词" required><el-input v-model="smartKeywordForm.keyword" maxlength="120" /></el-form-item>
        <el-form-item label="关键词类型"><el-select v-model="smartKeywordForm.type"><el-option v-for="item in smartKeywordTypes" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
        <el-form-item label="关联产品"><el-select v-model="smartKeywordForm.productId" clearable filterable><el-option v-for="item in controls.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="目标人群"><el-input v-model="smartKeywordForm.audience" /></el-form-item>
        <el-form-item label="痛点"><el-input v-model="smartKeywordForm.pain" /></el-form-item>
        <el-form-item label="场景"><el-input v-model="smartKeywordForm.scene" /></el-form-item>
        <el-form-item label="优先级"><el-select v-model="smartKeywordForm.priority"><el-option v-for="item in ['A','B','C']" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="语言"><el-input v-model="smartKeywordForm.language" /></el-form-item>
        <el-form-item label="市场"><el-input v-model="smartKeywordForm.market" /></el-form-item>
        <el-form-item label="调用开关" class="full"><el-switch v-model="smartKeywordForm.collectionEnabled" active-text="用于爆款采集" /><el-switch v-model="smartKeywordForm.contentEnabled" active-text="用于智能视频" /><el-switch v-model="smartKeywordForm.pinned" active-text="加入每日计划/置顶" /><el-switch v-model="smartKeywordForm.locked" active-text="锁定，禁止AI修改" /></el-form-item>
        <el-form-item label="备注" class="full"><el-input v-model="smartKeywordForm.notes" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="keywordDialog = false">取消</el-button><el-button type="primary" @click="saveSmartKeyword">保存关键词</el-button></template>
    </el-dialog>

    <el-dialog v-model="keywordBatchDialog" title="批量导入智能关键词" width="760px" destroy-on-close>
      <el-form label-position="top" class="form-grid">
        <el-form-item label="平台"><el-select v-model="smartKeywordBatchForm.platform"><el-option label="抖音" value="DOUYIN" /><el-option label="TikTok" value="TIKTOK" /></el-select></el-form-item>
        <el-form-item label="默认类型"><el-select v-model="smartKeywordBatchForm.type"><el-option v-for="item in smartKeywordTypes" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
        <el-form-item label="默认优先级"><el-select v-model="smartKeywordBatchForm.priority"><el-option v-for="item in ['A','B','C']" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="默认用途"><el-switch v-model="smartKeywordBatchForm.collectionEnabled" active-text="爆款采集" /><el-switch v-model="smartKeywordBatchForm.contentEnabled" active-text="智能视频" /></el-form-item>
        <el-form-item label="Excel/CSV文件" class="full"><el-upload v-model:file-list="keywordImportFiles" :auto-upload="false" :limit="1" accept=".xlsx,.xls,.csv"><el-button>选择文件</el-button><template #tip><div class="el-upload__tip">表头支持：平台、关键词、关键词类型、产品型号、目标人群、痛点、场景、优先级、备注。</div></template></el-upload></el-form-item>
        <el-form-item label="或粘贴文本" class="full"><el-input v-model="smartKeywordBatchForm.text" type="textarea" :rows="8" placeholder="每行一个关键词；也可用CSV顺序：关键词,类型,产品型号,目标人群,痛点,场景,优先级" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="keywordBatchDialog = false">取消</el-button><el-button type="primary" @click="submitSmartKeywordBatch">开始导入</el-button></template>
    </el-dialog>

    <el-dialog v-model="keywordDirectionDialog" :title="editingDirectionId ? '编辑运营方向' : '新增运营方向'" width="900px" destroy-on-close>
      <el-form label-position="top" class="form-grid">
        <el-form-item label="方向名称" required><el-input v-model="keywordDirectionForm.name" /></el-form-item>
        <el-form-item label="适用平台"><el-select v-model="keywordDirectionForm.platform"><el-option label="抖音" value="DOUYIN" /><el-option label="TikTok" value="TIKTOK" /></el-select></el-form-item>
        <el-form-item label="开始日期"><el-date-picker v-model="keywordDirectionForm.startAt" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="结束日期"><el-date-picker v-model="keywordDirectionForm.endAt" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="关联产品" class="full"><el-select v-model="keywordDirectionForm.productIds" multiple filterable><el-option v-for="item in controls.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="产品系列"><el-input v-model="keywordDirectionForm.productSeries" placeholder="逗号分隔" /></el-form-item>
        <el-form-item label="目标人群"><el-input v-model="keywordDirectionForm.audienceTerms" placeholder="逗号分隔" /></el-form-item>
        <el-form-item label="重点痛点"><el-input v-model="keywordDirectionForm.painTerms" placeholder="逗号分隔" /></el-form-item>
        <el-form-item label="重点场景"><el-input v-model="keywordDirectionForm.sceneTerms" placeholder="逗号分隔" /></el-form-item>
        <el-form-item label="重点竞品"><el-input v-model="keywordDirectionForm.competitorTerms" placeholder="逗号分隔" /></el-form-item>
        <el-form-item label="内容目标"><el-input v-model="keywordDirectionForm.objective" /></el-form-item>
        <el-form-item label="需要加强的词"><el-input v-model="keywordDirectionForm.boostTerms" placeholder="逗号分隔" /></el-form-item>
        <el-form-item label="需要排除的词"><el-input v-model="keywordDirectionForm.excludeTerms" placeholder="逗号分隔" /></el-form-item>
        <el-form-item label="探索比例"><el-slider v-model="keywordDirectionForm.explorationRatio" :min="0" :max="1" :step="0.05" show-input /></el-form-item>
        <el-form-item label="优先级"><el-select v-model="keywordDirectionForm.priority"><el-option v-for="item in ['A','B','C']" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="状态"><el-switch v-model="keywordDirectionForm.active" active-text="启用" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="keywordDirectionDialog = false">取消</el-button><el-button type="primary" @click="saveKeywordDirection">保存方向</el-button></template>
    </el-dialog>

    <el-drawer v-model="keywordAnalysisDrawer" title="关键词分析与历史效果" size="60%">
      <template v-if="keywordAnalysis">
        <div class="detail-summary"><h3>{{ keywordAnalysis.keyword }}</h3><p>{{ keywordAnalysis.reason }}</p><el-tag :type="viralGradeType(keywordAnalysis.grade)">{{ keywordAnalysis.grade }} · {{ Number(keywordAnalysis.opportunityScore || 0).toFixed(1) }}分</el-tag></div>
        <div class="detail-grid">
          <section><h4>来源记录</h4><el-table :data="keywordAnalysis.sources" size="small" max-height="260"><el-table-column prop="sourceType" label="来源" width="120" /><el-table-column prop="sourceLabel" label="方向/人员" min-width="150" /><el-table-column label="时间" width="145"><template #default="scope">{{ dateTime(scope.row.observedAt) }}</template></el-table-column></el-table></section>
          <section><h4>评分快照</h4><el-table :data="keywordAnalysis.snapshots" size="small" max-height="260"><el-table-column label="日期" width="135"><template #default="scope">{{ dateTime(scope.row.snapshotDate) }}</template></el-table-column><el-table-column prop="opportunityScore" label="机会分" width="90" /><el-table-column prop="grade" label="等级" width="70" /><el-table-column prop="historyScore" label="历史效果" width="90" /></el-table></section>
          <section><h4>命中视频</h4><el-table :data="keywordAnalysis.planKeywords?.flatMap((item: Row) => item.videoHits || []) || []" size="small" max-height="300"><el-table-column label="视频" min-width="220"><template #default="scope">{{ scope.row.externalVideo?.title || scope.row.externalVideo?.externalContentId }}</template></el-table-column><el-table-column prop="hitCount" label="命中" width="70" /><el-table-column label="播放" width="95"><template #default="scope">{{ compactNumber(scope.row.externalVideo?.metrics?.[0]?.views) }}</template></el-table-column></el-table></section>
          <section><h4>智能视频使用</h4><el-table :data="keywordAnalysis.contentRelations || []" size="small" max-height="300"><el-table-column label="方案" min-width="220"><template #default="scope">{{ scope.row.contentPlan?.topic || scope.row.contentPlanId }}</template></el-table-column><el-table-column prop="position" label="位置" width="90" /><el-table-column prop="usageType" label="用途" width="120" /></el-table></section>
        </div>
      </template>
    </el-drawer>

    <el-dialog v-model="collectorConfigDialog" title="爆款采集源配置" width="820px" destroy-on-close>
      <el-alert title="抖音按“官方搜索 → 自建搜索 → TikHub”发现视频，按“自建解析 → TikHub”获取媒体；密钥留空保留原配置。" type="info" :closable="false" />
      <el-form label-position="top" class="form-grid collector-form">
        <el-form-item label="平台"><el-input :model-value="collectorForm.platform" disabled /></el-form-item>
        <el-form-item label="数据提供方"><el-input v-model="collectorForm.providerName" /></el-form-item>
        <el-form-item label="默认接入方式"><el-select v-model="collectorForm.mode"><el-option label="API自动采集" value="API" /><el-option label="CSV表格导入" value="CSV" /><el-option label="链接补录" value="URL" /></el-select></el-form-item>
        <el-form-item label="每日采集上限"><el-input-number v-model="collectorForm.dailyLimit" :min="1" :max="200" /></el-form-item>
        <el-form-item v-if="collectorForm.platform === 'DOUYIN'" label="每日媒体解析量"><el-input-number v-model="collectorForm.resolveLimit" :min="1" :max="50" /></el-form-item>
        <el-form-item v-if="collectorForm.platform === 'DOUYIN'" label="每日深度分析量"><el-input-number v-model="collectorForm.analysisLimit" :min="1" :max="20" /></el-form-item>
        <el-form-item label="Feed接口地址" class="full"><el-input v-model="collectorForm.endpoint" placeholder="未开通可留空" /></el-form-item>
        <el-form-item label="接口Token" class="full"><el-input v-model="collectorForm.token" type="password" show-password placeholder="留空保留原密钥" /></el-form-item>
        <template v-if="collectorForm.platform === 'DOUYIN'">
          <el-form-item label="官方搜索"><div class="collector-switch-row"><el-switch v-model="collectorForm.officialEnabled" /><el-button size="small" @click="testCollectorProvider('OFFICIAL')">测试官方</el-button></div></el-form-item>
          <el-form-item label="TikHub兜底"><div class="collector-switch-row"><el-switch v-model="collectorForm.tikHubEnabled" /><el-button size="small" @click="testCollectorProvider('TIKHUB')">测试TikHub</el-button></div></el-form-item>
          <el-form-item label="TikHub API Key" class="full"><el-input v-model="collectorForm.tikHubApiKey" type="password" show-password placeholder="留空保留原Key" /></el-form-item>
          <el-form-item label="启用自建渠道"><div class="collector-switch-row"><el-switch v-model="collectorForm.selfHostedEnabled" /><el-button size="small" @click="testCollectorProvider('SELF_HOSTED')">测试自建</el-button></div></el-form-item>
          <el-form-item label="自建服务地址" class="full"><el-input v-model="collectorForm.selfHostedBaseUrl" placeholder="例如 https://douyin-api.example.com" /></el-form-item>
          <el-form-item label="自建搜索接口" class="full"><el-input v-model="collectorForm.selfHostedSearchUrl" placeholder="可选，支持 {keyword} 占位符；不填时仅做媒体解析" /></el-form-item>
          <el-form-item label="自建服务Token" class="full"><el-input v-model="collectorForm.selfHostedToken" type="password" show-password placeholder="可选；留空保留原Token" /></el-form-item>
        </template>
        <el-form-item label="监控关键词" class="full"><el-input v-model="collectorForm.keywords" type="textarea" :rows="2" placeholder="智能手表、血压手表、智能戒指；逗号分隔" /></el-form-item>
        <el-form-item label="竞品账号白名单" class="full"><el-input v-model="collectorForm.competitorAccounts" type="textarea" :rows="2" placeholder="账号名或账号ID；逗号分隔" /></el-form-item>
        <el-form-item label="启用每日任务"><el-switch v-model="collectorForm.enabled" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="collectorConfigDialog = false">取消</el-button><el-button type="primary" @click="saveCollectorConfig">保存配置</el-button></template>
    </el-dialog>

    <el-dialog v-model="collectorImportDialog" title="导入爆款视频数据" width="650px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="平台"><el-select v-model="collectorImportForm.platform"><el-option label="抖音" value="DOUYIN" /><el-option label="TikTok" value="TIKTOK" /><el-option label="小红书" value="XIAOHONGSHU" /><el-option label="视频号" value="WECHAT_CHANNELS" /></el-select></el-form-item>
        <el-form-item label="CSV文件">
          <el-upload v-model:file-list="collectorImportFiles" drag :auto-upload="false" :limit="1" accept=".csv,text/csv">
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon><div class="el-upload__text">拖入CSV，或<em>点击选择</em></div>
          </el-upload>
        </el-form-item>
      </el-form>
      <el-alert title="至少包含“视频链接”。支持：内容ID、账号、标题、发布时间、播放量、点赞量、评论量、分享量、收藏量、视频下载地址。" type="info" :closable="false" />
      <el-button class="template-download" link type="primary" :icon="Download" @click="downloadCollectorTemplate">下载CSV模板</el-button>
      <template #footer><el-button @click="collectorImportDialog = false">取消</el-button><el-button type="primary" @click="submitCollectorImport">开始导入</el-button></template>
    </el-dialog>

    <el-dialog v-model="collectorLinkDialog" title="补录外部优质视频" width="720px" destroy-on-close>
      <el-form label-position="top" class="form-grid">
        <el-form-item label="平台"><el-select v-model="collectorLinkForm.platform"><el-option label="抖音" value="DOUYIN" /><el-option label="TikTok" value="TIKTOK" /><el-option label="小红书" value="XIAOHONGSHU" /><el-option label="视频号" value="WECHAT_CHANNELS" /></el-select></el-form-item>
        <el-form-item label="账号/作者"><el-input v-model="collectorLinkForm.accountName" /></el-form-item>
        <el-form-item label="内容链接" class="full"><el-input v-model="collectorLinkForm.sourceUrl" placeholder="必填" /></el-form-item>
        <el-form-item label="视频下载地址" class="full"><el-input v-model="collectorLinkForm.downloadUrl" placeholder="有直接下载地址时将自动进入IMS和百炼；没有可稍后补充" /></el-form-item>
        <el-form-item label="标题" class="full"><el-input v-model="collectorLinkForm.title" /></el-form-item>
        <el-form-item label="发布时间"><el-date-picker v-model="collectorLinkForm.publishedAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item>
        <el-form-item label="播放量"><el-input v-model="collectorLinkForm.views" /></el-form-item>
        <el-form-item label="点赞量"><el-input v-model="collectorLinkForm.likes" /></el-form-item>
        <el-form-item label="评论量"><el-input v-model="collectorLinkForm.comments" /></el-form-item>
        <el-form-item label="分享量"><el-input v-model="collectorLinkForm.shares" /></el-form-item>
        <el-form-item label="收藏量"><el-input v-model="collectorLinkForm.saves" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="collectorLinkDialog = false">取消</el-button><el-button type="primary" @click="submitCollectorLink">保存并分析</el-button></template>
    </el-dialog>

    <el-dialog v-model="gapTaskUploadDialog" title="上传补拍任务素材" width="680px" destroy-on-close>
      <div class="gap-upload-context"><strong>{{ gapTaskUploadTarget?.title }}</strong><span>{{ gapTaskUploadTarget?.description }}</span><small>上传后自动归入对应产品素材库，并执行与普通素材上传相同的AI分类、索引和标签分析。</small></div>
      <el-upload v-model:file-list="gapTaskUploadFiles" drag multiple :auto-upload="false" :limit="20" :disabled="gapTaskUploading"><el-icon class="el-icon--upload"><UploadFilled /></el-icon><div class="el-upload__text">拖入补拍素材，或<em>点击选择</em></div></el-upload>
      <el-progress v-if="gapTaskUploading || gapTaskUploadProgress" :percentage="gapTaskUploadProgress" />
      <template #footer><el-button :disabled="gapTaskUploading" @click="gapTaskUploadDialog = false">取消</el-button><el-button type="primary" :loading="gapTaskUploading" @click="uploadGapTaskMaterials">上传并完成任务</el-button></template>
    </el-dialog>

    <el-dialog v-model="uploadDialog" title="上传素材" width="760px" destroy-on-close>
      <el-upload v-model:file-list="batchFiles" drag multiple :auto-upload="false" :limit="20" class="asset-upload" :disabled="uploading" @change="inspectBatchFiles" @remove="inspectBatchFiles">
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon><div class="el-upload__text">拖入文件，或<em>点击选择</em></div>
        <template #tip><div class="el-upload__tip">最多20个，单文件不超过200MB；上传员工由企业微信身份自动记录。</div></template>
      </el-upload>
      <div class="ai-assist">
        <div><strong>AI辅助填写</strong><span>{{ assistMessage || '选择文件后，可自动判断类型、型号和内容说明' }}</span></div>
        <el-button :loading="assistState === 'RUNNING'" @click="assistUpload">AI帮我填写</el-button>
      </div>
      <el-form label-position="top" class="form-grid simple-upload-form">
        <el-form-item label="关联视频生产单"><el-select v-model="batchForm.contentPlanId" clearable filterable placeholder="补拍素材请选择对应生产单" @change="selectProductionPlan"><el-option v-for="item in productionPlans" :key="item.id" :label="`${item.productionNo || '历史内容'} · ${item.topic}`" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="对应补拍项"><el-select v-model="batchForm.shootRequirementId" clearable :disabled="!batchForm.contentPlanId" placeholder="选择这批素材完成的拍摄要求"><el-option v-for="item in (selectedProductionPlan?.shootRequirements || []).filter((row: Row) => row.status !== 'DONE')" :key="item.id" :label="item.description" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="产品型号（可不选）"><el-select v-model="batchForm.productIds" multiple filterable placeholder="AI识别后请确认"><el-option v-for="item in controls.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="素材来源"><el-select v-model="batchForm.sourceType"><el-option label="员工拍摄/制作" value="EMPLOYEE_CAPTURE" /><el-option label="网页上传" value="WEB_UPLOAD" /><el-option label="供应商" value="SUPPLIER" /><el-option label="UGC授权" value="UGC" /></el-select></el-form-item>
        <el-form-item label="内容说明" class="full"><el-input v-model="batchForm.contentDescription" type="textarea" :rows="2" placeholder="可留空，由AI辅助填写" /></el-form-item>
        <el-form-item label="人工基础分类（确认后锁定）" class="full"><el-select v-model="batchForm.classificationTags" multiple clearable filterable placeholder="用于人工归类；详细剪辑索引由AI看画面后生成"><el-option v-for="item in classificationOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
        <div class="full upload-index-preview">
          <div><strong>剪辑AI详细索引</strong><el-tag size="small" type="info">上传后自动生成</el-tag></div>
          <p>文件进入OSS后，AI会查看实际画面并生成标签；开启重命名时组合成易读名称，例如：<b>{{ selectedUploadModels[0] || 'W9S' }}－功能展示－心电图测量</b>。</p>
          <div><span v-for="item in editingIndexDimensions" :key="item">{{ item }}</span></div>
        </div>
        <el-form-item label="素材名称" class="full"><div class="upload-rename-option"><el-switch v-model="batchForm.aiRename" active-text="用AI标签重新命名" inactive-text="保留原文件名" /><small>{{ batchForm.aiRename ? 'AI分析完成后，用“型号－用途－核心功能/场景”作为素材名称' : '仍会生成AI标签和索引，但素材名称保持上传时的文件名' }}</small></div></el-form-item>
        <el-collapse class="full upload-advanced"><el-collapse-item title="更多信息（一般无需修改）" name="advanced"><div class="advanced-filter-grid"><el-select v-model="batchForm.assetKind" clearable placeholder="素材类型自动识别"><el-option v-for="item in kindOptions" :key="item" :label="kindLabel(item)" :value="item" /></el-select><el-select v-model="batchForm.rightsStatus"><el-option v-for="item in rightsOptions" :key="item" :label="statusLabel(item)" :value="item" /></el-select><el-date-picker v-model="batchForm.acquiredAt" type="date" value-format="YYYY-MM-DD" placeholder="获得/拍摄日期" /><el-switch v-model="batchForm.originalStatus" active-text="公司原创" inactive-text="非原创" /></div><div v-if="uploadTechnicalInfo.length" class="technical-info"><strong>文件与AI预检信息</strong><el-table :data="uploadTechnicalInfo" size="small" max-height="210"><el-table-column prop="name" label="文件" min-width="180" show-overflow-tooltip /><el-table-column prop="format" label="格式" width="72" /><el-table-column label="大小" width="90"><template #default="scope">{{ fileSize(scope.row.size) }}</template></el-table-column><el-table-column label="时长" width="90"><template #default="scope">{{ durationLabel(scope.row.durationSeconds) }}</template></el-table-column><el-table-column label="分辨率" width="105"><template #default="scope">{{ scope.row.width && scope.row.height ? `${scope.row.width}×${scope.row.height}` : '—' }}</template></el-table-column><el-table-column prop="quality" label="质量" width="90" /></el-table></div></el-collapse-item></el-collapse>
      </el-form>
      <div v-if="uploading || uploadProgress" class="upload-progress"><div><span>{{ uploadStage }}</span><small>{{ uploadProgress < 100 ? `预计剩余 ${uploadEta}` : '文件已上传，正在云端入库' }}</small></div><el-progress :percentage="uploadProgress" :status="uploadProgress === 100 && !uploading ? 'success' : undefined" /></div>
      <template #footer><el-button :disabled="uploading" @click="uploadDialog = false">取消</el-button><el-button type="primary" :loading="uploading" @click="submitBatch">{{ uploading ? `${uploadProgress}%` : '确认上传' }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="metadataDialog" title="编辑素材元数据" width="760px" destroy-on-close><el-form label-position="top" class="form-grid"><el-form-item label="素材名称"><el-input v-model="metadataForm.displayName" /><small class="field-tip">名称仅为字母、数字或系统编号时，保存后由AI按素材内容自动命名。</small></el-form-item><el-form-item label="素材层级"><el-select v-model="metadataForm.level"><el-option v-for="item in levelOptions" :key="item" :label="item" :value="item" /></el-select></el-form-item><el-form-item label="产品范围"><el-select v-model="metadataForm.productScope"><el-option v-for="item in ['MODEL','SERIES','BRAND','COMMON','UNKNOWN']" :key="item" :label="item" :value="item" /></el-select></el-form-item><el-form-item label="关联产品"><el-select v-model="metadataForm.productIds" multiple filterable><el-option v-for="item in controls.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.id" /></el-select></el-form-item><el-form-item label="使用权限"><el-select v-model="metadataForm.rightsStatus"><el-option v-for="item in rightsOptions" :key="item" :label="statusLabel(item)" :value="item" /></el-select></el-form-item><el-form-item label="获得日期"><el-date-picker v-model="metadataForm.acquiredAt" type="date" value-format="YYYY-MM-DD" /></el-form-item><el-form-item label="内容说明" class="full"><el-input v-model="metadataForm.contentDescription" type="textarea" :rows="3" /></el-form-item><el-form-item label="关联证据"><el-input v-model="metadataForm.evidenceIds" placeholder="逗号分隔" /></el-form-item><el-form-item label="使用限制"><el-input v-model="metadataForm.restriction" /></el-form-item></el-form><template #footer><el-button @click="metadataDialog = false">取消</el-button><el-button type="primary" @click="saveMetadata">保存</el-button></template></el-dialog>

    <el-dialog v-model="assetBulkDialog" title="批量管理素材" width="760px" destroy-on-close><el-form label-position="top" class="form-grid"><el-form-item label="素材层级"><el-select v-model="assetBulkForm.level" clearable><el-option v-for="item in levelOptions" :key="item" :label="item" :value="item" /></el-select></el-form-item><el-form-item label="使用权限"><el-select v-model="assetBulkForm.rightsStatus" clearable><el-option v-for="item in rightsOptions" :key="item" :label="statusLabel(item)" :value="item" /></el-select></el-form-item><el-form-item label="产品范围"><el-select v-model="assetBulkForm.productScope" clearable><el-option v-for="item in ['MODEL','SERIES','BRAND','COMMON','UNKNOWN']" :key="item" :label="item" :value="item" /></el-select></el-form-item><el-form-item label="关联产品"><el-select v-model="assetBulkForm.productIds" multiple clearable filterable><el-option v-for="item in controls.products" :key="item.id" :label="`${item.modelCode} · ${item.name}`" :value="item.id" /></el-select></el-form-item><el-form-item label="获得日期"><el-date-picker v-model="assetBulkForm.acquiredAt" type="date" value-format="YYYY-MM-DD" /></el-form-item><el-form-item label="使用限制"><el-input v-model="assetBulkForm.restriction" /></el-form-item><el-form-item label="内容说明" class="full"><el-input v-model="assetBulkForm.contentDescription" type="textarea" :rows="2" /></el-form-item><el-form-item label="分类标签" class="full"><el-select v-model="assetBulkForm.tags" multiple clearable filterable><el-option v-for="item in classificationOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item><el-form-item label="标签处理方式"><el-radio-group v-model="assetBulkForm.tagMode"><el-radio-button value="APPEND">追加</el-radio-button><el-radio-button value="REMOVE">移除</el-radio-button><el-radio-button value="REPLACE">覆盖</el-radio-button></el-radio-group></el-form-item></el-form><template #footer><el-button @click="assetBulkDialog = false">取消</el-button><el-button type="primary" @click="bulkAssets('UPDATE')">保存批量修改</el-button></template></el-dialog>

    <el-dialog v-model="replaceDialog" title="替换文件并生成新版本" width="560px" destroy-on-close><el-upload v-model:file-list="replacementFiles" drag :auto-upload="false" :limit="1"><el-icon class="el-icon--upload"><UploadFilled /></el-icon><div class="el-upload__text">拖入同类型文件，或<em>点击选择</em></div></el-upload><template #footer><el-button @click="replaceDialog = false">取消</el-button><el-button type="primary" :loading="replacementUploading" @click="replaceAssetFile">上传新版本</el-button></template></el-dialog>

    <el-dialog v-model="documentEditorDialog" title="编辑文档正文" width="820px" destroy-on-close><el-input v-model="documentContent" type="textarea" :rows="22" /><template #footer><el-button @click="documentEditorDialog = false">取消</el-button><el-button type="primary" @click="saveDocumentContent">保存为新版本</el-button></template></el-dialog>

    <el-dialog v-model="controlDialog" :title="`编辑${controlTitle()}`" width="780px" destroy-on-close><el-form label-position="top" class="form-grid">
      <template v-if="controlResource === 'brand-profiles'"><el-form-item label="版本"><el-input v-model="controlForm.version" /></el-form-item><el-form-item label="标题"><el-input v-model="controlForm.title" /></el-form-item><el-form-item label="品牌定位" class="full"><el-input v-model="controlForm.positioning" type="textarea" :rows="2" /></el-form-item><el-form-item label="品牌故事" class="full"><el-input v-model="controlForm.story" type="textarea" :rows="3" /></el-form-item><el-form-item label="来源"><el-input v-model="controlForm.source" /></el-form-item><el-form-item label="状态"><el-select v-model="controlForm.status"><el-option label="可用" value="READY" /><el-option label="待审核" value="PENDING" /><el-option label="禁用" value="BLOCKED" /></el-select></el-form-item></template>
      <template v-else-if="controlResource === 'faqs'"><el-form-item label="标准问题" class="full"><el-input v-model="controlForm.standardQuestion" /></el-form-item><el-form-item label="短回复" class="full"><el-input v-model="controlForm.shortAnswer" type="textarea" :rows="3" /></el-form-item><el-form-item label="详细回复" class="full"><el-input v-model="controlForm.detailedAnswer" type="textarea" :rows="4" /></el-form-item><el-form-item label="分类"><el-input v-model="controlForm.category" /></el-form-item><el-form-item label="意图"><el-input v-model="controlForm.intent" /></el-form-item><el-form-item label="频次"><el-input-number v-model="controlForm.frequency" :min="0" /></el-form-item><el-form-item label="优先级"><el-input-number v-model="controlForm.priority" :min="0" /></el-form-item><el-form-item label="状态"><el-select v-model="controlForm.status"><el-option label="可用" value="READY" /><el-option label="待审核" value="PENDING" /><el-option label="禁用" value="BLOCKED" /></el-select></el-form-item></template>
      <template v-else-if="controlResource === 'claims'"><el-form-item label="证书名称"><el-input v-model="controlForm.name" /></el-form-item><el-form-item label="证书类型"><el-input v-model="controlForm.evidenceType" /></el-form-item><el-form-item label="适用范围" class="full"><el-input v-model="controlForm.coveredObject" /></el-form-item><el-form-item label="允许表述" class="full"><el-input v-model="controlForm.publicWording" type="textarea" :rows="3" /></el-form-item><el-form-item label="使用限制" class="full"><el-input v-model="controlForm.internalRestriction" type="textarea" :rows="2" /></el-form-item><el-form-item label="来源"><el-input v-model="controlForm.source" /></el-form-item><el-form-item label="状态"><el-select v-model="controlForm.status"><el-option label="可用" value="READY" /><el-option label="待审核" value="PENDING" /><el-option label="禁用" value="BLOCKED" /></el-select></el-form-item></template>
      <template v-else-if="controlResource === 'mappings'"><el-form-item label="商品名称"><el-input v-model="controlForm.commercialName" /></el-form-item><el-form-item label="页面事实"><el-input v-model="controlForm.pageFacts" /></el-form-item><el-form-item label="包装/铭牌型号"><el-input v-model="controlForm.nameplateModel" /></el-form-item><el-form-item label="注册型号"><el-input v-model="controlForm.registeredModel" /></el-form-item><el-form-item label="注册编号"><el-input v-model="controlForm.registrationNumber" /></el-form-item><el-form-item label="生产关系"><el-input v-model="controlForm.productionRelation" /></el-form-item><el-form-item label="发布前动作" class="full"><el-input v-model="controlForm.requiredAction" type="textarea" :rows="3" /></el-form-item></template>
      <template v-else><el-form-item label="规则类别"><el-input v-model="controlForm.category" /></el-form-item><el-form-item label="拦截表述"><el-input v-model="controlForm.blockedText" /></el-form-item><el-form-item label="建议替代表述" class="full"><el-input v-model="controlForm.replacement" /></el-form-item><el-form-item label="使用条件" class="full"><el-input v-model="controlForm.condition" /></el-form-item><el-form-item label="启用"><el-switch v-model="controlForm.active" /></el-form-item></template>
    </el-form><template #footer><el-button @click="controlDialog = false">取消</el-button><el-button type="primary" @click="saveControl">保存</el-button></template></el-dialog>

    <el-dialog v-model="restrictedRulesDialog" title="批量添加受限内容规则" width="620px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="规则类型"><el-radio-group v-model="restrictedRulesForm.category"><el-radio-button value="HEALTH_RESTRICTED_WORD">风险词</el-radio-button><el-radio-button value="HEALTH_RESTRICTED_VISUAL">风险画面</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="规则内容（每行一条）"><el-input v-model="restrictedRulesForm.values" type="textarea" :rows="12" :placeholder="restrictedRulesForm.category === 'HEALTH_RESTRICTED_WORD' ? '血压\n心电\n医疗' : '血压测量界面\n心电波形画面\n吸烟画面'" /></el-form-item>
        <el-alert title="重复内容会自动跳过；新增规则只限制“健康内容受限脚本”，普通脚本不受影响。" type="info" :closable="false" />
      </el-form>
      <template #footer><el-button @click="restrictedRulesDialog = false">取消</el-button><el-button type="primary" @click="saveRestrictedRules">确认批量添加</el-button></template>
    </el-dialog>

    <el-drawer v-model="detailDrawer" title="素材对象详情" size="62%" destroy-on-close>
      <template v-if="assetDetail">
        <div class="detail-head">
          <div><span>{{ assetDetail.assetNo }}</span><h3>{{ assetDetail.displayName }}</h3></div>
          <div><el-tag :type="statusType(assetDetail.processingStatus)">{{ statusLabel(assetDetail.processingStatus) }}</el-tag><el-tag :type="statusType(assetDetail.reviewStatus)">{{ statusLabel(assetDetail.reviewStatus) }}</el-tag><el-tag :type="statusType(assetDetail.availabilityStatus)">{{ statusLabel(assetDetail.availabilityStatus) }}</el-tag></div>
        </div>
        <section class="asset-preview-panel" v-loading="assetPreviewLoading">
          <img v-if="assetPreviewUrl && assetPreviewType === 'image'" :src="assetPreviewUrl" :alt="assetDetail.displayName" />
          <video v-else-if="assetPreviewUrl && assetPreviewType === 'video'" :src="assetPreviewUrl" controls preload="metadata" playsinline />
          <audio v-else-if="assetPreviewUrl && assetPreviewType === 'audio'" :src="assetPreviewUrl" controls preload="metadata" />
          <iframe v-else-if="assetPreviewUrl && ['document', 'office'].includes(assetPreviewType)" :src="assetPreviewEmbedUrl" :title="assetDetail.displayName" />
          <el-empty v-else-if="!assetPreviewLoading" description="该格式暂不支持嵌入预览，可打开原文件查看" />
          <div class="preview-actions">
            <span>预览地址30分钟有效</span>
            <div><el-button @click="openMetadata(assetDetail)">编辑资料</el-button><el-button v-if="['.txt','.md'].includes(String(assetDetail.extension || '').toLowerCase())" @click="openDocumentEditor">编辑正文</el-button><el-button @click="openReplace(assetDetail)">替换文件</el-button><el-button :disabled="!assetDetail.objectKey" @click="loadAssetPreview(assetDetail.id)">刷新预览</el-button><el-button type="primary" :disabled="!assetPreviewUrl" @click="openAssetPreview">新窗口打开</el-button><el-button :icon="Download" @click="downloadAsset(assetDetail)">下载原文件</el-button></div>
          </div>
        </section>
        <section class="asset-structured-index">
          <h4>剪辑AI详细索引</h4>
          <div class="detail-index-head"><strong>{{ assetIndexSummary(assetDetail) }}</strong><span>置信度 {{ Math.round(Number(assetDetail.indexConfidence || 0) * 100) }}% · V{{ assetDetail.indexVersion || 0 }}</span></div>
          <div class="structured-index">
            <div v-for="entry in assetIndexEntries(assetDetail)" :key="entry.key"><b>{{ entry.label }}</b><span>{{ entry.values.join('、') }}</span></div>
            <span v-if="!assetIndexEntries(assetDetail).length">索引尚未建立，可点击“重分析”让AI重新查看画面。</span>
          </div>
        </section>
        <el-descriptions :column="3" border><el-descriptions-item label="原始文件名">{{ assetDetail.originalFileName || assetDetail.fileName }}</el-descriptions-item><el-descriptions-item label="类型/层级">{{ assetDetail.kind }} / {{ assetDetail.level }}</el-descriptions-item><el-descriptions-item label="权限">{{ statusLabel(assetDetail.rightsStatus) }}</el-descriptions-item><el-descriptions-item label="OSS对象" :span="2">{{ assetDetail.objectKey || '未存储' }}</el-descriptions-item><el-descriptions-item label="SHA256">{{ assetDetail.sha256?.slice(0, 18) }}…</el-descriptions-item><el-descriptions-item label="上传员工">{{ assetDetail.createdByEmployee?.name || assetDetail.actor }}</el-descriptions-item><el-descriptions-item label="型号">{{ assetDetail.products?.map((item: Row) => item.modelCode).join('、') || '待确认' }}</el-descriptions-item><el-descriptions-item label="质量评分">{{ assetDetail.qualityScore }}</el-descriptions-item></el-descriptions>
        <div class="detail-grid"><section><h4>受控标签（点击可筛选）</h4><div class="tag-cloud"><el-tag v-for="item in assetDetail.tags" :key="`${item.namespace}-${item.code}`" class="clickable-tag" :type="item.locked ? 'success' : 'info'" @click="filterByAssetTag(item.label)">{{ item.namespace }}：{{ item.label }}</el-tag><span v-if="!assetDetail.tags?.length">暂无标签</span></div></section><section><h4>版本</h4><el-table :data="assetDetail.versions" size="small"><el-table-column prop="version" label="版本" width="65" /><el-table-column prop="originalFileName" label="原文件名" min-width="150" /><el-table-column prop="objectKey" label="OSS对象" min-width="210" show-overflow-tooltip /></el-table></section><section><h4>AI任务</h4><el-table :data="assetDetail.analysisJobs" size="small"><el-table-column prop="type" label="任务" min-width="150" /><el-table-column label="状态" width="105"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column><el-table-column prop="failureReason" label="原因" min-width="180" show-overflow-tooltip /></el-table></section><section><h4>审核记录</h4><el-table :data="assetDetail.reviewDecisions" size="small"><el-table-column prop="action" label="动作" width="110" /><el-table-column prop="reviewer" label="审核人" width="120" /><el-table-column prop="note" label="说明" min-width="180" /><el-table-column label="时间" width="135"><template #default="scope">{{ dateTime(scope.row.createdAt) }}</template></el-table-column></el-table></section><section><h4>使用与效果</h4><el-table :data="assetDetail.usages" size="small"><el-table-column prop="businessObjectType" label="业务对象" width="120" /><el-table-column prop="businessObjectId" label="对象编号" min-width="150" /><el-table-column prop="usedBy" label="使用人/AI" width="120" /><el-table-column label="最新播放" width="90"><template #default="scope">{{ scope.row.metrics?.[0]?.views ?? '未获取' }}</template></el-table-column><el-table-column label="订单" width="80"><template #default="scope">{{ scope.row.metrics?.[0]?.orders ?? '未获取' }}</template></el-table-column></el-table></section></div>
      </template>
    </el-drawer>
  </section>
</template>

<style scoped>
.brand-data-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.brand-hero { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 16px 28px; color: #fff; border-radius: 20px; background: linear-gradient(120deg, #15213a 0%, #1b365d 58%, #a2202b 160%); box-shadow: 0 14px 38px rgba(24, 40, 72, .16); }
.brand-hero h2 { margin: 4px 0 0; font-size: 28px; }.brand-hero p { margin: 0; color: rgba(255,255,255,.72); }.brand-eyebrow { font-size: 11px; font-weight: 800; letter-spacing: .16em; color: #f2b8be; }.hero-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.brand-metrics, .report-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }.brand-metrics article, .report-summary article { padding: 18px 20px; border: 1px solid #e9edf4; border-radius: 16px; background: #fff; box-shadow: 0 7px 20px rgba(28, 44, 72, .05); }.brand-metrics span, .brand-metrics small, .report-summary span { display: block; color: #7a8496; }.brand-metrics strong, .report-summary strong { display: block; margin: 5px 0 2px; font-size: 27px; color: #162239; }.report-summary { grid-template-columns: repeat(6, 1fr); }
.main-tabs { display: flex; width: fit-content; padding: 5px; border-radius: 14px; background: #e9edf4; }.main-tabs button { display: flex; align-items: center; gap: 8px; min-width: 170px; padding: 11px 17px; color: #637086; border: 0; border-radius: 10px; background: transparent; cursor: pointer; }.main-tabs button.active { color: #a2202b; background: #fff; box-shadow: 0 4px 12px rgba(32, 45, 69, .1); }.main-tabs b { margin-left: auto; padding: 2px 7px; font-size: 12px; border-radius: 999px; background: #f1f3f7; }
.workspace-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; }.workspace-heading.compact { padding-top: 4px; }.workspace-heading h3 { margin: 0 0 4px; font-size: 21px; color: #17243b; }.workspace-heading p { margin: 0; color: #7d8798; }
.filter-bar { display: grid; gap: 10px; padding: 14px; border: 1px solid #e7ebf2; border-radius: 14px; background: #fff; }.knowledge-filter { grid-template-columns: minmax(260px, 1.5fr) 150px 160px 130px auto; }.keyword-filter { grid-template-columns: minmax(260px, 1.5fr) 170px 130px 130px auto; }.keyword-summary { grid-template-columns: repeat(4, minmax(0, 1fr)); }.asset-filter { grid-template-columns: minmax(240px, 1.5fr) 140px 190px 140px auto; }.advanced-filter { grid-column: 1 / -1; }.advanced-filter-grid { display: grid; grid-template-columns: repeat(4, minmax(130px, 1fr)); gap: 10px; padding-top: 5px; }.asset-index { display: flex; gap: 8px; overflow-x: auto; padding: 2px; }.asset-index button { min-width: 105px; padding: 11px 15px; color: #5f6b7d; border: 1px solid #e2e7ef; border-radius: 11px; background: #fff; cursor: pointer; }.asset-index button.active { color: #a2202b; border-color: #e1a9ae; background: #fff7f7; }.asset-index b { margin-left: 5px; }.data-panel { overflow: hidden; border: 1px solid #e7ebf2; border-radius: 15px; background: #fff; }.data-panel h4 { margin: 0; padding: 15px 17px; color: #1b2941; border-bottom: 1px solid #edf0f5; }.cell-note { display: block; margin-top: 2px; color: #9099a8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.cell-note.danger { color: #c53943; }.form-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 18px; }.form-grid .full { grid-column: 1 / -1; }.form-grid .full .el-switch { margin-right: 22px; }.asset-upload { margin-bottom: 14px; }.ai-assist { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 15px; padding: 13px 15px; border: 1px solid #dce7f5; border-radius: 12px; background: #f5f9ff; }.ai-assist strong, .ai-assist span { display: block; }.ai-assist span { margin-top: 3px; color: #778398; font-size: 12px; }.upload-advanced { margin-top: 2px; }.load-more { display: flex; justify-content: center; }.video-toolbar, .capability-note { display: flex; align-items: center; gap: 16px; padding: 14px 16px; color: #6f798b; border: 1px solid #e7ebf2; border-radius: 14px; background: #fff; }.video-toolbar .el-select { width: 460px; }.time-range { display: flex; align-items: center; gap: 5px; }.time-range .el-input-number { width: 88px; }.two-panels { display: grid; grid-template-columns: .8fr 1.2fr; gap: 14px; }.detail-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }.detail-head span { color: #8b95a5; }.detail-head h3 { margin: 4px 0 0; font-size: 23px; color: #17243b; }.detail-head > div:last-child { display: flex; gap: 7px; }.detail-grid { display: grid; gap: 16px; margin-top: 18px; }.detail-grid section { border: 1px solid #e8ecf2; border-radius: 12px; overflow: hidden; }.detail-grid h4 { margin: 0; padding: 12px 15px; background: #f7f9fc; }.tag-cloud { display: flex; flex-wrap: wrap; gap: 8px; padding: 15px; }
.bulk-toolbar { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 4px; }.bulk-toolbar span { margin-right: 4px; color: #7c8798; font-size: 13px; }.technical-info { margin-top: 14px; padding-top: 12px; border-top: 1px solid #e7ebf2; }.technical-info > strong { display: block; margin-bottom: 8px; color: #4d5a70; font-size: 13px; }.upload-progress { margin-top: 14px; padding: 12px 14px; border: 1px solid #dce7f5; border-radius: 12px; background: #f5f9ff; }.upload-progress > div { display: flex; justify-content: space-between; margin-bottom: 7px; color: #4d5a70; }.upload-progress small { color: #8590a2; }
.editing-index-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 12px; border: 1px solid #e3e8f0; border-radius: 14px; background: #f8fafc; }
.editing-index-strip-head { display: flex; align-items: baseline; justify-content: space-between; grid-column: 1 / -1; gap: 12px; }.editing-index-strip-head span { color: #818c9e; font-size: 12px; }
.editing-index-strip button { position: relative; display: grid; gap: 4px; min-width: 0; padding: 10px 70px 10px 11px; text-align: left; border: 1px solid #e4e9f1; border-radius: 9px; background: #fff; cursor: pointer; }.editing-index-strip button:hover { border-color: #adc8e9; background: #f9fcff; }
.editing-index-strip button strong, .editing-index-strip button small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.editing-index-strip button strong { color: #263850; }.editing-index-strip button small { color: #7d8899; }.editing-index-strip button .el-tag { position: absolute; top: 10px; right: 10px; }
.upload-index-preview { display: grid; gap: 8px; margin-bottom: 16px; padding: 13px 15px; border: 1px solid #dce7f5; border-radius: 12px; background: #f7faff; }
.upload-index-preview > div:first-child { display: flex; align-items: center; gap: 8px; }.upload-index-preview p { margin: 0; color: #647187; font-size: 13px; line-height: 1.6; }.upload-index-preview p b { color: #253a58; }
.upload-index-preview > div:last-child { display: flex; flex-wrap: wrap; gap: 6px; }.upload-index-preview > div:last-child span { padding: 3px 7px; color: #52647d; font-size: 11px; border-radius: 6px; background: #edf2f8; }
.upload-rename-option { display: grid; gap: 6px; width: 100%; padding: 11px 13px; border: 1px solid #e3e8f0; border-radius: 10px; background: #fafbfd; }.upload-rename-option small { color: #7c8798; line-height: 1.5; }
.asset-tag-filters { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; padding: 10px 12px; border: 1px solid #e7ebf2; border-radius: 12px; background: #fff; }.asset-tag-filters > span { margin-right: 4px; color: #68758a; font-size: 12px; font-weight: 700; }.clickable-tag { cursor: pointer; user-select: none; }
.asset-structured-index { margin: 0 0 16px; border: 1px solid #e4e9f1; border-radius: 12px; overflow: hidden; }.asset-structured-index h4 { margin: 0; padding: 11px 14px; background: #f7f9fc; }
.detail-index-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 14px 7px; }.detail-index-head strong { color: #263850; }.detail-index-head span { color: #8490a2; font-size: 12px; }
.structured-index { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px; padding: 7px 14px 14px; }.structured-index > div { display: grid; grid-template-columns: 58px 1fr; gap: 8px; padding: 7px 9px; border-radius: 8px; background: #f7f9fc; }.structured-index b { color: #637086; font-size: 12px; }.structured-index span { color: #293b55; font-size: 12px; line-height: 1.45; }
.gap-analysis-actions, .gap-task-toolbar { display: flex; align-items: center; gap: 9px; }.gap-analysis-actions .el-select { width: 260px; }.gap-task-toolbar { justify-content: flex-end; }.gap-task-toolbar span { margin-right: auto; color: #758196; font-size: 13px; }
.gap-upload-context { display: grid; gap: 6px; margin-bottom: 15px; padding: 12px 14px; border: 1px solid #dce7f5; border-radius: 12px; background: #f6f9fd; }.gap-upload-context span { color: #334155; }.gap-upload-context small { color: #718096; line-height: 1.55; }
.field-tip { display: block; margin-top: 6px; color: #8791a1; line-height: 1.45; }
.preview-link { max-width: 100%; padding: 0; border: 0; background: transparent; cursor: pointer; text-align: left; }.preview-link:hover { color: #2f83e5; text-decoration: underline; }
.asset-thumb { display: block; width: 96px; height: 72px; border-radius: 8px; background: #f1f4f8; object-fit: cover; cursor: pointer; }.asset-placeholder { width: 96px; height: 72px; color: #778398; border: 1px dashed #d8dee8; border-radius: 8px; background: #f7f9fc; cursor: pointer; }
.asset-preview-panel { display: grid; place-items: center; min-height: 260px; margin-bottom: 18px; padding: 14px; border: 1px solid #e5eaf1; border-radius: 14px; background: #f7f9fc; overflow: hidden; }.asset-preview-panel img, .asset-preview-panel video, .asset-preview-panel iframe { display: block; width: 100%; max-height: 560px; border: 0; border-radius: 10px; background: #10151e; object-fit: contain; }.asset-preview-panel iframe { min-height: 520px; background: #fff; }.asset-preview-panel audio { width: min(680px, 100%); }.preview-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; margin-top: 12px; }.preview-actions span { color: #8791a1; font-size: 12px; }.preview-actions > div { display: flex; gap: 8px; flex-wrap: wrap; }
.growth-loop { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }.growth-stage { position: relative; display: flex; align-items: center; gap: 12px; min-height: 82px; padding: 14px; border: 1px solid #e6eaf1; border-radius: 14px; background: #fff; }.growth-stage:not(:last-child)::after { position: absolute; right: -10px; z-index: 2; content: "→"; color: #9aa4b3; }.stage-index { display: grid; place-items: center; flex: 0 0 34px; width: 34px; height: 34px; color: #fff; font-size: 12px; font-weight: 800; border-radius: 50%; background: #7d8798; }.growth-stage strong, .growth-stage span { display: block; }.growth-stage strong { color: #17243b; line-height: 1.35; }.growth-stage span { margin-top: 5px; color: #818b9b; font-size: 12px; }.growth-stage.state-active .stage-index, .growth-stage.state-ready .stage-index { background: #2f8f64; }.growth-stage.state-running .stage-index, .growth-stage.state-tracking .stage-index { background: #3978c5; }.growth-stage.state-action_required { border-color: #f0b8bd; background: #fff8f8; }.growth-stage.state-action_required .stage-index { background: #c53943; }
.collector-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }.collector-capabilities { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }.collector-capabilities article { display: grid; grid-template-columns: 1fr auto auto; gap: 7px 8px; padding: 14px 16px; border: 1px solid #e7ebf2; border-radius: 13px; background: #fff; }.collector-capabilities article > strong { grid-column: 1 / 3; }.collector-capabilities span, .collector-capabilities small { grid-column: 1 / -1; color: #818b9b; font-size: 12px; }.collector-capabilities article > .el-button { margin: 0; justify-content: flex-start; }.collector-provider-status { grid-column: 1 / -1; display: grid; gap: 6px; padding: 8px; border-radius: 8px; background: #f7f9fc; }.collector-provider-status small { display: flex; align-items: center; gap: 6px; }.collector-form { margin-top: 16px; }.collector-switch-row { display: flex; align-items: center; gap: 12px; }.template-download { margin-top: 8px; }.viral-panels { grid-template-columns: 1.2fr 1fr; }
.viral-trend-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }.viral-trend-summary article { padding: 16px 18px; border: 1px solid #e7ebf2; border-radius: 14px; background: #fff; }.viral-trend-summary span, .viral-trend-summary small { display: block; color: #7d8798; }.viral-trend-summary strong { display: block; margin: 5px 0 2px; color: #17243b; font-size: 26px; }.local-collector-panel, .viral-keyword-panel { padding: 15px 17px; border: 1px solid #e7ebf2; border-radius: 14px; background: #fff; }.local-collector-panel { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }.local-collector-panel > div { margin-right: auto; }.local-collector-panel > div strong, .local-collector-panel > div span { display: block; }.local-collector-panel > div span, .local-collector-panel article span, .local-collector-panel article small { color: #818b9b; font-size: 12px; }.local-collector-panel article { display: grid; grid-template-columns: auto 1fr; gap: 5px 8px; min-width: 250px; padding: 10px 12px; border-radius: 10px; background: #f7f9fc; }.local-collector-panel article span, .local-collector-panel article small { grid-column: 1 / -1; }.panel-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }.panel-title h4 { margin: 0 0 3px; color: #1b2941; }.panel-title small { color: #818b9b; }.viral-keywords { display: flex; gap: 8px; flex-wrap: wrap; }.viral-keywords button { display: inline-flex; align-items: center; gap: 5px; padding: 7px 9px; color: #526077; border: 1px solid #e0e5ed; border-radius: 9px; background: #f9fafc; cursor: pointer; }.viral-keywords button b { color: #9a6d1f; }.viral-keywords button small { color: #9099a8; }.viral-keywords button.priority-a { border-color: #eab9bd; background: #fff7f7; }.viral-keywords button.priority-a b { color: #b12a35; }.viral-keywords button.locked { box-shadow: inset 0 0 0 1px #3978c5; }.viral-trend-table { min-height: 330px; }.viral-expand { display: grid; gap: 9px; padding: 8px 20px 14px 52px; }.viral-expand div { display: grid; grid-template-columns: 115px 1fr; gap: 12px; color: #657187; }.viral-expand .timeline span { display: block; margin-bottom: 4px; }
.ai-capability-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }.ai-capability-grid article { display: grid; grid-template-columns: 1fr auto; gap: 7px 10px; padding: 13px 15px; border: 1px solid #e7ebf2; border-radius: 12px; background: #fff; }.ai-capability-grid small, .ai-capability-grid span { display: block; color: #818b9b; font-size: 12px; }.ai-capability-grid article > span { grid-column: 1 / -1; }.ai-capability-grid .danger { color: #c53943; }
@media (max-width: 1400px) { .asset-filter { grid-template-columns: minmax(220px, 1fr) repeat(3, minmax(130px, .65fr)) auto; }.report-summary { grid-template-columns: repeat(3, 1fr); }.viral-trend-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 1400px) { .growth-loop { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 1100px) { .brand-metrics { grid-template-columns: repeat(2, 1fr); }.knowledge-filter { grid-template-columns: repeat(3, 1fr); }.two-panels { grid-template-columns: 1fr; }.growth-loop, .editing-index-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .brand-hero, .workspace-heading { align-items: flex-start; flex-direction: column; }.brand-metrics, .report-summary, .growth-loop, .editing-index-strip, .structured-index, .viral-trend-summary { grid-template-columns: 1fr; }.growth-stage::after { display: none; }.main-tabs { width: 100%; }.main-tabs button { min-width: 0; flex: 1; }.filter-bar, .form-grid, .advanced-filter-grid { grid-template-columns: 1fr; }.advanced-filter { grid-column: auto; }.form-grid .full { grid-column: auto; }.video-toolbar, .ai-assist { align-items: flex-start; flex-direction: column; }.video-toolbar .el-select { width: 100%; } }
</style>
