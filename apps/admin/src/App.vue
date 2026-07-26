<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox, type UploadUserFile } from "element-plus";
import {
  Bell, Connection, DataAnalysis, DocumentChecked, Files, House, Monitor, Promotion,
  Refresh, Search, Setting, Shop, UploadFilled, VideoCamera,
} from "@element-plus/icons-vue";
import { api, clearToken, download, getActor, getToken, patch, post, remove, setActor, setToken, uploadWithProgress } from "./api";
import BrandDataCenter from "./components/BrandDataCenter.vue";
import OperationAnalysis from "./components/OperationAnalysis.vue";
import type { ContentPlan, Dashboard, Integration } from "./types";

type AnyRow = Record<string, any>;
type Ledger = { departments: AnyRow[]; employees: AnyRow[]; products: AnyRow[]; accounts: AnyRow[]; stores: AnyRow[]; imports: AnyRow[]; snapshots: AnyRow[]; attributions: AnyRow[]; sourceHealth: AnyRow[] };
type AuthUser = { employeeId?: string; id?: string; name: string; wecomUserId?: string; departmentNames?: string[]; isSuperAdmin?: boolean; loginType: string };
type DouyinStatus = {
  state: string;
  message: string;
  clientKey: string;
  clientSecretConfigured: boolean;
  authorized: boolean;
  openIdMasked: string;
  scope: string;
  expiresAt?: string;
  redirectUri: string;
  webhookUrl: string;
  lastSuccessAt?: string;
};

const navItems = [
  { key: "dashboard", label: "今日总览", icon: House },
  { key: "mall", label: "赛电商城", icon: Shop },
  { key: "content", label: "内容审核", icon: DocumentChecked },
  { key: "assets", label: "品牌数据中心", icon: Files },
  { key: "ledger", label: "经营责任台账", icon: Monitor },
  { key: "operationAnalysis", label: "运营分析", icon: DataAnalysis },
  { key: "engagement", label: "评论与直播", icon: VideoCamera },
  { key: "reports", label: "报告与任务", icon: DataAnalysis },
  { key: "integrations", label: "连接设置", icon: Connection },
];

const active = ref("dashboard");
const loading = ref(false);
const error = ref("");
const authReady = ref(false);
const authUser = ref<AuthUser>();
const loginMessage = ref("");
const qrLoginUrl = ref("");
const qrLoading = ref(false);
const dashboard = ref<Dashboard>();
const integrations = ref<Integration[]>([]);
const content = ref<ContentPlan[]>([]);
const contentFilter = ref<"ALL" | "PENDING_APPROVAL" | "APPROVED" | "PUBLISHED">("ALL");
const assetOnlyProductModel = ref("");
const contentRestrictionMode = ref<"NORMAL" | "HEALTH_RESTRICTED">("NORMAL");
const brandDataCenter = ref<{ reload: () => Promise<void> }>();
const operationAnalysis = ref<{ reload: () => Promise<void> }>();
const comments = ref<AnyRow[]>([]);
const live = ref<AnyRow[]>([]);
const shopItems = ref<AnyRow[]>([]);
const competitors = ref<AnyRow[]>([]);
const trends = ref<AnyRow[]>([]);
const alerts = ref<AnyRow[]>([]);
const tasks = ref<AnyRow[]>([]);
const reports = ref<AnyRow[]>([]);
const jobs = ref<AnyRow[]>([]);
const sops = ref<AnyRow[]>([]);
const ledger = ref<Ledger>({ departments: [], employees: [], products: [], accounts: [], stores: [], imports: [], snapshots: [], attributions: [], sourceHealth: [] });
const actorInput = ref(getActor());
const opsSubTab = ref("shop");
const reportSubTab = ref("reports");
const ledgerSubTab = ref("employees");
const ledgerDialog = ref(false);
const ledgerFormType = ref<"employees" | "products" | "accounts" | "stores">("employees");
const ledgerEditingId = ref("");
const ledgerContinue = ref(false);
const ledgerForm = reactive<Record<string, any>>({});
const douyinStatus = ref<DouyinStatus>();
const douyinClientKey = ref("");
const douyinClientSecret = ref("");
const productionUploadDialog = ref(false);
const productionUploadFiles = ref<UploadUserFile[]>([]);
const productionUploadProgress = ref(0);
const productionUploading = ref(false);
const productionUploadTarget = ref<{ plan: ContentPlan; requirement: ContentPlan["shootRequirements"][number] }>();
const productionAiDialog = ref(false);
const productionAiTarget = ref<{ plan: ContentPlan; requirement: ContentPlan["shootRequirements"][number] }>();
const productionAiPrompt = ref("");
const productionAiDuration = ref(5);
const productionAiModels = ref<AnyRow[]>([]);
const productionAiModelId = ref("");
const productionAiAllowFallback = ref(false);
const productionAiSubmitting = ref(false);
const productionAiPollingRequirementId = ref("");
const assetPreviewDialog = ref(false);
const assetPreviewLoading = ref(false);
const assetPreviewUrl = ref("");
const assetPreviewName = ref("");
const assetPreviewKind = ref("");

const todayLabel = new Intl.DateTimeFormat("zh-CN", { dateStyle: "full" }).format(new Date());
const pageTitle = computed(() => navItems.find((item) => item.key === active.value)?.label || "运营中台");
const pendingContent = computed(() => content.value.filter((item) => item.status === "PENDING_APPROVAL"));
const filteredContent = computed(() => contentFilter.value === "ALL"
  ? content.value
  : content.value.filter((item) => item.status === contentFilter.value));
const configuredCount = computed(() => integrations.value.filter((item) => item.state !== "UNCONFIGURED").length);
const wecomUnconfigured = computed(() => loginMessage.value.includes("未配置"));

function time(value?: string) {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未记录" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    UNCONFIGURED: "未配置", CONFIGURED: "待验证", HEALTHY: "正常", DEGRADED: "部分可用", ERROR: "异常",
    DRAFT: "候选", PENDING_APPROVAL: "待审核", APPROVED: "已审核", REJECTED: "已退回", SCHEDULED: "待发布",
    PUBLISHED: "已发布", FAILED: "失败", PENDING: "待处理", READY: "可用", BLOCKED: "禁用", ARCHIVED: "归档",
    RUNNING: "执行中", RETRY: "重试中", SUCCEEDED: "已完成", LIVE: "直播中", OPEN: "待处理", RESOLVED: "已解决",
    PARTIAL: "部分成功", ACTIVE: "在职", SCRIPT_REVIEW: "脚本审核", AWAITING_ASSETS: "等待拍摄素材",
    READY_TO_EDIT: "素材已齐套", EDITING: "AI剪辑中", VIDEO_REVIEW: "成片审核", PLATFORM_PACKAGING: "生成平台包装",
    PACKAGING_REVIEW: "平台包装审核", READY_TO_PUBLISH: "可以发布", PUBLISHING: "发布中", TRACKING: "数据跟踪",
    WAITING_ASSETS: "等待素材", WAITING_RENDER_PROVIDER: "剪辑能力未配置", READY_FOR_REVIEW: "待成片审核",
    RETURNED: "已退回", WAITING_COVER_PROVIDER: "等待封面成品", PENDING_CONFIRMATION: "待确认", CONFIRMED: "已确认",
  };
  return labels[value] || value || "未获取";
}

function statusType(value: string) {
  if (["HEALTHY", "READY", "APPROVED", "PUBLISHED", "SUCCEEDED", "RESOLVED"].includes(value)) return "success";
  if (["ERROR", "FAILED", "BLOCKED", "CRITICAL"].includes(value)) return "danger";
  if (["DEGRADED", "PENDING_APPROVAL", "RETRY", "WARNING", "OVERDUE"].includes(value)) return "warning";
  return "info";
}

function platformName(value: string) {
  const names: Record<string, string> = {
    DOUYIN: "抖音", TIKTOK: "TikTok", AMAZON: "Amazon", SHOPIFY: "Shopify", WECHAT_CHANNELS: "视频号", XIAOHONGSHU: "小红书", WECHAT_OFFICIAL: "公众号",
    WECOM: "企业微信", TMALL: "天猫", JD: "京东", PINDUODUO: "拼多多", SAIDIAN_MALL: "自有商城",
    JUSHUITAN: "聚水潭", FEIGUA: "飞瓜", WEB_SEARCH: "全网搜索", LOCAL_ASSET: "本地素材库",
    WECOM_DRIVE: "企微网盘", HELP_CENTER: "客服帮助网站", EVIDENCE_WORKBOOK: "证据底表", ALIYUN_OSS: "阿里云 OSS",
  };
  return names[value] || value;
}

function reportColumnLabel(value: string) {
  const labels: Record<string, string> = {
    change: "变更", material: "素材", source: "来源", model: "型号", mediaType: "类型", qualityScore: "质量分",
    employee: "员工/执行者", recordedAt: "记录时间", storageProvider: "统一存储", objectKey: "OSS对象", storageSyncedAt: "同步时间", storageError: "存储异常", content: "内容", kind: "形式", platform: "平台", account: "账号",
    publishedAt: "发布时间", views: "播放量", completionRate: "完播率", likes: "点赞", comments: "评论", shares: "分享",
    saves: "收藏", consultations: "咨询", orders: "订单", action: "动作", object: "对象", occurredAt: "操作时间", result: "结果",
    store: "店铺", type: "事项类型", sourceId: "外部编号", status: "状态", amount: "金额", currency: "币种", unavailableFields: "未获取字段",
    format: "格式", received: "收到", imported: "成功", rejected: "拒绝", attributionCode: "归因码", eventType: "归因事件",
    campaign: "活动", revenue: "成交金额", state: "连接状态", message: "检查结果", latencyMs: "耗时(ms)",
  };
  return labels[value] || value;
}

function reportCell(column: string, value: unknown) {
  if (["recordedAt", "publishedAt", "occurredAt", "storageSyncedAt"].includes(column) && typeof value === "string" && value !== "未同步") return time(value);
  if (column === "unavailableFields" && Array.isArray(value)) return value.length ? value.join("、") : "无";
  if (column === "state" && typeof value === "string") return statusLabel(value);
  if (column === "platform" && typeof value === "string") return platformName(value);
  if (column === "kind") return value === "VIDEO" ? "视频" : value === "ARTICLE" ? "软文" : value;
  if (column === "completionRate" && typeof value === "number") return `${Math.round(value * 10000) / 100}%`;
  return value ?? "未获取";
}

async function withLoading(task: () => Promise<void>, success?: string) {
  loading.value = true;
  error.value = "";
  try {
    await task();
    if (success) ElMessage.success(success);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "请求失败";
    ElMessage.error(error.value);
  } finally {
    loading.value = false;
  }
}

async function loadDashboard() {
  [dashboard.value, integrations.value] = await Promise.all([
    api<Dashboard>("/api/v1/dashboard"),
    api<Integration[]>("/api/v1/integrations"),
  ]);
}

async function loadActive() {
  if (active.value === "mall") return;
  if (active.value === "dashboard") return loadDashboard();
  if (active.value === "content") [content.value, ledger.value] = await Promise.all([api<ContentPlan[]>("/api/v1/content"), api<Ledger>("/api/v1/ledger")]);
  if (active.value === "assets") await brandDataCenter.value?.reload();
  if (active.value === "operationAnalysis") await operationAnalysis.value?.reload();
  if (active.value === "ledger") ledger.value = await api("/api/v1/ledger");
  if (active.value === "operations") {
    [shopItems.value, competitors.value, trends.value, alerts.value] = await Promise.all([
      api<AnyRow[]>("/api/v1/shop"), api<AnyRow[]>("/api/v1/competitors"), api<AnyRow[]>("/api/v1/trends"), api<AnyRow[]>("/api/v1/alerts"),
    ]);
  }
  if (active.value === "engagement") [comments.value, live.value] = await Promise.all([api<AnyRow[]>("/api/v1/comments"), api<AnyRow[]>("/api/v1/live")]);
  if (active.value === "reports") [reports.value, jobs.value, tasks.value, sops.value] = await Promise.all([api<AnyRow[]>("/api/v1/reports"), api<AnyRow[]>("/api/v1/jobs"), api<AnyRow[]>("/api/v1/tasks"), api<AnyRow[]>("/api/v1/sops")]);
  if (active.value === "integrations") {
    [integrations.value, douyinStatus.value] = await Promise.all([
      api<Integration[]>("/api/v1/integrations"),
      api<DouyinStatus>("/api/v1/integrations/douyin/status"),
    ]);
    douyinClientKey.value = douyinStatus.value.clientKey;
  }
}

async function switchPage(key: string) {
  active.value = key;
  await withLoading(loadActive);
}

async function openGeneratedContent() {
  active.value = "content";
  contentFilter.value = "PENDING_APPROVAL";
  await withLoading(loadActive);
}

async function runDaily() {
  await withLoading(async () => {
    await post("/api/v1/jobs/run-daily");
    await loadDashboard();
  }, "今日流程已加入任务队列");
}

async function generateContent() {
  await withLoading(async () => {
    await post("/api/v1/content/generate", { contentRestrictionMode: contentRestrictionMode.value });
    active.value = "content";
    await loadActive();
  }, "今日选题已生成");
}

async function generateAssetOnlyVideo() {
  if (!assetOnlyProductModel.value) return ElMessage.warning("请先选择需要快速成片的产品型号");
  await withLoading(async () => {
    await post("/api/v1/content/asset-only-video/generate", { productModel: assetOnlyProductModel.value, contentRestrictionMode: contentRestrictionMode.value });
    contentFilter.value = "PENDING_APPROVAL";
    await loadActive();
  }, "无需补拍脚本已生成，审核通过后可直接启动AI剪辑");
}

async function checkIntegrations() {
  await withLoading(async () => {
    await post("/api/v1/integrations/check");
    integrations.value = await api("/api/v1/integrations");
    if (active.value === "dashboard") await loadDashboard();
  }, "连接状态已刷新");
}

async function saveDouyinConfig() {
  await withLoading(async () => {
    douyinStatus.value = await post<DouyinStatus>("/api/v1/integrations/douyin/config", {
      clientKey: douyinClientKey.value,
      clientSecret: douyinClientSecret.value,
    });
    douyinClientSecret.value = "";
    integrations.value = await api("/api/v1/integrations");
  }, "抖音应用配置已保存");
}

async function authorizeDouyin() {
  await withLoading(async () => {
    const result = await api<{ url: string }>("/api/v1/integrations/douyin/authorize-url");
    window.location.assign(result.url);
  });
}

async function approve(item: ContentPlan) {
  await withLoading(async () => {
    const targetPlatforms = item.targetPlatforms?.length ? item.targetPlatforms : item.variants.map((variant) => variant.platform);
    await post(`/api/v1/content/${item.id}/approve`, { note: "脚本与补拍清单审核通过", owner: getActor(), targetPlatforms });
    content.value = await api("/api/v1/content");
  }, "脚本与补拍清单已通过审核");
}

async function reject(item: ContentPlan) {
  const { value } = await ElMessageBox.prompt("填写退回原因", "退回内容", { inputPlaceholder: "例如：素材型号与脚本不一致", confirmButtonText: "确认退回", cancelButtonText: "取消" });
  await withLoading(async () => {
    await post(`/api/v1/content/${item.id}/reject`, { reason: value });
    content.value = await api("/api/v1/content");
  }, "内容已退回");
}

async function assignVariantAccount(variantId: string, value: unknown) {
  const platformAccountId = String(value || "");
  if (!platformAccountId) return;
  await withLoading(async () => {
    await patch(`/api/v1/content/variants/${variantId}/target-account`, { platformAccountId });
    content.value = await api("/api/v1/content");
  }, "发布账号已指定");
}

async function setShootRequirement(item: ContentPlan, requirementId: string, done: boolean) {
  const requirements = item.shootRequirements.map((requirement) => requirement.id === requirementId ? { ...requirement, status: done ? "DONE" : "OPEN" } : requirement);
  await withLoading(async () => {
    await patch(`/api/v1/content/${item.id}/shoot-requirements`, { requirements });
    content.value = await api("/api/v1/content");
  }, done ? "补拍项已完成" : "补拍项已重新打开");
}

function openProductionUpload(item: ContentPlan, requirement: ContentPlan["shootRequirements"][number]) {
  productionUploadTarget.value = { plan: item, requirement };
  productionUploadFiles.value = [];
  productionUploadProgress.value = 0;
  productionUploadDialog.value = true;
}

async function openProductionAi(item: ContentPlan, requirement: ContentPlan["shootRequirements"][number]) {
  productionAiTarget.value = { plan: item, requirement };
  productionAiPrompt.value = [
    `为短视频“${item.topic}”生成一个真实自然的竖屏补拍镜头。`,
    item.productModel ? `产品型号：${item.productModel}，保持产品外观、结构和佩戴方式一致。` : "",
    `镜头内容：${requirement.description}。`,
    "电商UGC实拍质感，动作清楚，主体完整，光线自然，镜头稳定，不添加字幕、Logo或水印。",
  ].filter(Boolean).join("");
  productionAiDuration.value = 5;
  productionAiModelId.value = "";
  productionAiAllowFallback.value = false;
  try {
    productionAiModels.value = await api<AnyRow[]>("/api/v1/video-factory/models");
  } catch {
    productionAiModels.value = [];
  }
  productionAiDialog.value = true;
}

function aiGenerationLabel(status?: string) {
  return status === "SUCCEEDED" ? "已生成"
    : status === "FAILED" ? "生成失败"
      : status === "RUNNING" ? "正在生成"
        : status === "PENDING" ? "排队中"
          : "";
}

async function pollAiShotGeneration(item: ContentPlan, requirement: ContentPlan["shootRequirements"][number]) {
  if (productionAiPollingRequirementId.value === requirement.id) return;
  productionAiPollingRequirementId.value = requirement.id;
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = await api<{ status: string; failureReason?: string }>(`/api/v1/content/${item.id}/shoot-requirements/${requirement.id}/ai-generation`);
      if (result.status === "SUCCEEDED") {
        content.value = await api("/api/v1/content");
        ElMessage.success("AI补拍视频已生成，已进入视频工厂待审核");
        return;
      }
      if (result.status === "FAILED") {
        content.value = await api("/api/v1/content");
        ElMessage.error(result.failureReason || "AI补拍视频生成失败，可调整提示词后重试");
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 10_000));
    }
    ElMessage.info("AI仍在生成，可稍后点击“查看生成进度”继续查询");
  } catch (reason) {
    ElMessage.error(reason instanceof Error ? reason.message : "AI生成进度查询失败");
  } finally {
    if (productionAiPollingRequirementId.value === requirement.id) productionAiPollingRequirementId.value = "";
  }
}

async function submitProductionAi() {
  const target = productionAiTarget.value;
  if (!target) return;
  const prompt = productionAiPrompt.value.trim();
  if (!prompt) return ElMessage.warning("请填写AI生成要求");
  productionAiSubmitting.value = true;
  try {
    await post(`/api/v1/content/${target.plan.id}/shoot-requirements/${target.requirement.id}/ai-generate`, {
      prompt,
      duration: productionAiDuration.value,
      requestedModelId: productionAiModelId.value || undefined,
      routingMode: productionAiModelId.value ? "FIXED" : "AUTO",
      allowFallback: productionAiModelId.value ? productionAiAllowFallback.value : true,
    });
    content.value = await api("/api/v1/content");
    productionAiDialog.value = false;
    ElMessage.success("AI生成任务已提交，完成后进入视频工厂待审核");
    void pollAiShotGeneration(target.plan, target.requirement);
  } catch (reason) {
    ElMessage.error(reason instanceof Error ? reason.message : "AI生成任务提交失败");
  } finally {
    productionAiSubmitting.value = false;
  }
}

function productionAsset(item: ContentPlan, assetId: string) {
  return item.contentAssets?.find((contentAsset) => contentAsset.asset.id === assetId)?.asset;
}

function shotRequirements(item: ContentPlan, coverage: "EXISTING" | "MISSING") {
  return item.shootRequirements.filter((requirement) => coverage === "EXISTING"
    ? requirement.coverage === "EXISTING" && requirement.status === "DONE"
    : requirement.coverage !== "EXISTING" || requirement.status !== "DONE");
}

function isHealthRestricted(item: ContentPlan) {
  return item.sourceSignals?.some((signal) => signal.contentRestrictionMode === "HEALTH_RESTRICTED") || false;
}

async function previewProductionAsset(item: ContentPlan, assetId: string) {
  const asset = productionAsset(item, assetId);
  assetPreviewName.value = asset?.displayName || asset?.assetNo || assetId;
  assetPreviewKind.value = String(asset?.kind || "").toUpperCase();
  assetPreviewUrl.value = "";
  assetPreviewDialog.value = true;
  assetPreviewLoading.value = true;
  try {
    const result = await api<{ url: string }>(`/api/v1/brand-data/assets/${assetId}/download-url`);
    assetPreviewUrl.value = result.url;
  } catch (reason) {
    assetPreviewDialog.value = false;
    ElMessage.error(reason instanceof Error ? reason.message : "素材预览加载失败");
  } finally {
    assetPreviewLoading.value = false;
  }
}

async function refreshAssetCoverage(item: ContentPlan) {
  await withLoading(async () => {
    await post(`/api/v1/content/${item.id}/asset-coverage`);
    content.value = await api("/api/v1/content");
  }, "已按当前素材库重新生成逐镜头素材清单");
}

async function replaceShotAsset(item: ContentPlan, requirement: ContentPlan["shootRequirements"][number]) {
  await ElMessageBox.confirm(`确认不使用已有素材，重新拍摄“${requirement.description}”？`, "拍摄替换", {
    confirmButtonText: "确认重新拍摄",
    cancelButtonText: "继续使用已有素材",
    type: "warning",
  });
  await withLoading(async () => {
    await post(`/api/v1/content/${item.id}/shoot-requirements/${requirement.id}/replace`);
    content.value = await api("/api/v1/content");
  }, "该镜头已转为需要补拍");
}

async function submitProductionUpload() {
  const target = productionUploadTarget.value;
  const files = productionUploadFiles.value.map((item) => item.raw).filter(Boolean) as File[];
  if (!target || !files.length) return ElMessage.warning("请选择需要上传的拍摄素材");
  if (files.length > 20) return ElMessage.warning("每次最多上传20个文件");
  productionUploading.value = true;
  productionUploadProgress.value = 0;
  try {
    const assisted = await post<AnyRow>("/api/v1/brand-data/upload-batches/assist", {
      files: files.map((file) => ({ name: file.name, type: file.type, size: file.size })),
    });
    const suggestions = assisted.suggestions || {};
    const classificationTags = Array.isArray(suggestions.classificationTags) ? suggestions.classificationTags : [];
    const productIds = Array.isArray(suggestions.productIds) ? suggestions.productIds : [];
    const batch = await post<AnyRow>("/api/v1/brand-data/upload-batches", {
      sourceType: "EMPLOYEE_CAPTURE",
      productScope: productIds.length ? "MODEL" : "UNKNOWN",
      productIds,
      assetKind: suggestions.assetKind || undefined,
      contentDescription: suggestions.contentDescription || target.requirement.description,
      classificationTags,
      originalStatus: true,
      rightsStatus: "COMMERCIAL",
      acquiredAt: new Date().toISOString(),
      contentPlanId: target.plan.id,
      shootRequirementId: target.requirement.id,
    });
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    form.append("classificationTags", JSON.stringify(classificationTags));
    form.append("productionDirect", "true");
    const result = await uploadWithProgress<AnyRow>(`/api/v1/brand-data/upload-batches/${batch.id}/files`, form, (loaded, total) => {
      productionUploadProgress.value = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    });
    if (Number(result.failedCount || 0) > 0) throw new Error(`有 ${result.failedCount} 个文件上传失败，请重新上传`);
    content.value = await api("/api/v1/content");
    productionUploadDialog.value = false;
    const updated = content.value.find((item) => item.id === target.plan.id);
    ElMessage.success(updated?.productionStage === "READY_TO_EDIT"
      ? "素材已入库并进入AI分类、索引和标签分析，可以继续AI剪辑"
      : "素材已关联补拍项，并进入与素材库相同的AI分类、索引和标签分析");
  } catch (uploadError) {
    ElMessage.error(uploadError instanceof Error ? uploadError.message : "素材上传失败");
  } finally {
    productionUploading.value = false;
  }
}

async function startVideoEditing(item: ContentPlan) {
  await withLoading(async () => {
    await post(`/api/v1/content/${item.id}/edit`);
    content.value = await api("/api/v1/content");
  }, "AI剪辑任务已执行");
}

async function reviewMasterVideo(item: ContentPlan, approved: boolean) {
  const result = await ElMessageBox.prompt(approved ? "填写成片审核意见（可选）" : "填写成片退回原因", approved ? "通过主成片" : "退回主成片", { confirmButtonText: "确认", cancelButtonText: "取消" });
  await withLoading(async () => {
    await post(`/api/v1/content/${item.id}/video-review`, { approved, note: result.value });
    content.value = await api("/api/v1/content");
  }, approved ? "主成片已通过" : "主成片已退回剪辑");
}

async function generatePlatformPackaging(item: ContentPlan) {
  await withLoading(async () => {
    await post(`/api/v1/content/${item.id}/platform-packaging`);
    content.value = await api("/api/v1/content");
  }, "平台标题与封面方案已生成");
}

async function reviewPackaging(variant: ContentPlan["variants"][number], approved: boolean) {
  const result = await ElMessageBox.prompt(
    approved ? "填写封面成品地址；接入封面渲染器后将自动带入" : "填写平台包装退回原因",
    approved ? `通过${platformName(variant.platform)}包装` : `退回${platformName(variant.platform)}包装`,
    { inputValue: approved ? (variant.coverPath || "") : "", confirmButtonText: "确认", cancelButtonText: "取消" },
  );
  await withLoading(async () => {
    await post(`/api/v1/content/variants/${variant.id}/packaging-review`, approved ? { approved, coverPath: result.value } : { approved, note: result.value });
    content.value = await api("/api/v1/content");
  }, approved ? "平台包装已通过" : "平台包装已退回");
}

async function recordManualPublish(variant: ContentPlan["variants"][number]) {
  const result = await ElMessageBox.prompt("填写已发布作品链接或作品ID", `回填${platformName(variant.platform)}发布结果`, { inputPlaceholder: "https://... 或平台作品ID", confirmButtonText: "确认", cancelButtonText: "取消" });
  const value = String(result.value || "").trim();
  await withLoading(async () => {
    await post(`/api/v1/content/variants/${variant.id}/manual-publish`, /^https?:\/\//i.test(value) ? { remoteUrl: value } : { remoteId: value });
    content.value = await api("/api/v1/content");
  }, "人工发布结果已登记，数据跟踪任务已建立");
}

async function downloadDelivery(variant: ContentPlan["variants"][number], type: "video" | "cover") {
  await withLoading(
    () => download(`/api/v1/content/variants/${variant.id}/delivery/${type}`, `${platformName(variant.platform)}-${type}`),
    type === "video" ? "成片下载已开始" : "封面下载已开始",
  );
}

async function generateOptimization(item: ContentPlan, checkpointHours: 168 | 720) {
  await withLoading(async () => {
    await post(`/api/v1/content/${item.id}/optimizations/${checkpointHours}`);
    content.value = await api("/api/v1/content");
  }, checkpointHours === 168 ? "7日初评已生成" : "30日终评已生成");
}

async function decideOptimization(id: string, confirmed: boolean) {
  await withLoading(async () => {
    await post(`/api/v1/content/optimizations/${id}/decision`, { confirmed, note: confirmed ? "运营负责人确认进入下一轮脚本规则" : "本轮不采用" });
    content.value = await api("/api/v1/content");
  }, confirmed ? "优化建议已确认" : "优化建议已拒绝");
}

async function resolveAlert(id: string) {
  await withLoading(async () => {
    await post(`/api/v1/alerts/${id}/resolve`);
    alerts.value = await api("/api/v1/alerts");
  }, "提醒已关闭");
}

async function approveReply(id: string) {
  await withLoading(async () => {
    await post(`/api/v1/comments/replies/${id}/approve`);
    comments.value = await api("/api/v1/comments");
  }, "回复任务已执行");
}

async function runJob(kind: string) {
  await withLoading(async () => {
    await post(`/api/v1/jobs/run/${kind}`);
    jobs.value = await api("/api/v1/jobs");
  }, "任务已加入队列");
}

async function startWecomLogin() {
  loginMessage.value = "";
  try {
    const redirectUri = `${window.location.origin}/saidian-ops/`;
    const result = await api<{ url: string }>(`/api/v1/auth/wecom/authorize-url?redirectUri=${encodeURIComponent(redirectUri)}`);
    window.location.assign(result.url);
  } catch (reason) {
    loginMessage.value = reason instanceof Error ? reason.message : "企业微信登录入口暂不可用";
  }
}

async function loadWecomQr() {
  qrLoading.value = true;
  loginMessage.value = "";
  try {
    const redirectUri = `${window.location.origin}/saidian-ops/?wecom_qr=1`;
    const result = await api<{ url: string }>(`/api/v1/auth/wecom/qr-authorize-url?redirectUri=${encodeURIComponent(redirectUri)}`);
    qrLoginUrl.value = result.url;
  } catch (reason) {
    qrLoginUrl.value = "";
    loginMessage.value = reason instanceof Error ? reason.message : "企业微信扫码登录入口暂不可用";
  } finally {
    qrLoading.value = false;
  }
}

function logout() {
  clearToken();
  authUser.value = undefined;
  actorInput.value = "";
  void loadWecomQr();
}

function openMall(path: string) {
  window.location.assign(path);
}

async function bootstrap() {
  try {
    const parameters = new URLSearchParams(window.location.search);
    const douyinAuthorized = parameters.get("douyin") === "authorized";
    const douyinFailed = parameters.get("douyin") === "failed";
    const douyinError = parameters.get("douyin_error");
    const code = parameters.get("code");
    if (code) {
      const result = await post<{ token: string; user: AuthUser }>("/api/v1/auth/wecom/login", { code });
      setToken(result.token);
      setActor(result.user.name);
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (!getToken()) {
      const mallEmployeeToken = localStorage.getItem("employee-token");
      if (mallEmployeeToken) {
        try {
          const result = await post<{ token: string; user: AuthUser }>("/api/v1/auth/wecom/session", { mallToken: mallEmployeeToken });
          setToken(result.token);
          setActor(result.user.name);
        } catch {
          localStorage.removeItem("employee-token");
        }
      }
    }
    if (!getToken()) return;
    authUser.value = await api<AuthUser>("/api/v1/auth/me");
    actorInput.value = authUser.value.name;
    setActor(authUser.value.name);
    await loadDashboard();
    if (douyinAuthorized) {
      ElMessage.success("抖音账号授权成功");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (douyinFailed) {
      ElMessage.error(douyinError || "抖音账号授权失败，请重新授权");
      window.history.replaceState({}, "", window.location.pathname);
    }
  } catch (reason) {
    clearToken();
    authUser.value = undefined;
    loginMessage.value = reason instanceof Error ? reason.message : "登录失败";
  } finally {
    authReady.value = true;
    if (!authUser.value && !getToken()) await loadWecomQr();
  }
}

function handleSharedLogin(event: StorageEvent) {
  if (event.key === "saidian-ops-token" && event.newValue && !authUser.value) void bootstrap();
}

async function promptValue(title: string, placeholder: string, value = "") {
  const result = await ElMessageBox.prompt(placeholder, title, { inputValue: value, confirmButtonText: "确认", cancelButtonText: "取消" });
  return String(result.value || "").trim();
}

function resetLedgerForm(type: "employees" | "products" | "accounts" | "stores", row?: AnyRow) {
  Object.keys(ledgerForm).forEach((key) => delete ledgerForm[key]);
  const metadata = row?.metadata || {};
  if (type === "employees") Object.assign(ledgerForm, { name: row?.name || "", employeeNo: row?.employeeNo || "", departmentId: row?.departmentId || "", role: row?.role || "运营", wecomUserId: row?.wecomUserId || "", mobileMasked: row?.mobileMasked || "", isSuperAdmin: Boolean(row?.isSuperAdmin), status: row?.status || "ACTIVE" });
  if (type === "products") Object.assign(ledgerForm, { modelCode: row?.modelCode || "", name: row?.name || "", category: row?.category || "智能健康穿戴", status: row?.status || "PENDING", aliases: (metadata.aliases || []).join("、"), functions: (metadata.publicKnowledge?.functions || []).join("、"), customerValues: (metadata.publicKnowledge?.customerValues || []).join("、"), audiences: (metadata.publicKnowledge?.audiences || []).join("、"), scenes: (metadata.publicKnowledge?.scenes || []).join("、"), contentDirections: (metadata.publicKnowledge?.contentDirections || []).join("、"), skus: (row?.skus || []).map((item: AnyRow) => item.skuCode).join("、") });
  if (type === "accounts") Object.assign(ledgerForm, { integrationKind: row?.integration?.kind || "", accountName: row?.accountName || "", externalAccountId: row?.externalAccountId || "", region: row?.region || "CN", ownerEmployeeId: row?.ownerEmployeeId || "", message: row?.message || "" });
  if (type === "stores") Object.assign(ledgerForm, { platformAccountId: row?.platformAccountId || "", name: row?.name || "", externalStoreId: row?.externalStoreId || "", region: row?.region || "CN", ownerEmployeeId: row?.ownerEmployeeId || "", notes: metadata.notes || "" });
}

function openLedgerForm(type: "employees" | "products" | "accounts" | "stores", row?: AnyRow) {
  ledgerFormType.value = type;
  ledgerEditingId.value = row?.id || "";
  ledgerContinue.value = false;
  resetLedgerForm(type, row);
  ledgerDialog.value = true;
}

function splitLedgerList(value: unknown) {
  return String(value || "").split(/[、,，;\n]/).map((item) => item.trim()).filter(Boolean);
}

async function saveLedgerForm(continueAdding = false) {
  const payload: AnyRow = { ...ledgerForm };
  if (ledgerFormType.value === "products") {
    payload.metadata = { aliases: splitLedgerList(ledgerForm.aliases), publicKnowledge: { functions: splitLedgerList(ledgerForm.functions), customerValues: splitLedgerList(ledgerForm.customerValues), audiences: splitLedgerList(ledgerForm.audiences), scenes: splitLedgerList(ledgerForm.scenes), contentDirections: splitLedgerList(ledgerForm.contentDirections) } };
    payload.skus = splitLedgerList(ledgerForm.skus).map((skuCode) => ({ skuCode, name: skuCode }));
  }
  if (ledgerFormType.value === "stores") payload.metadata = { notes: ledgerForm.notes || "" };
  await withLoading(async () => {
    const base = `/api/v1/ledger/${ledgerFormType.value}`;
    if (ledgerEditingId.value) await patch(`${base}/${ledgerEditingId.value}`, payload);
    else await post(base, payload);
    ledger.value = await api("/api/v1/ledger");
    if (continueAdding && !ledgerEditingId.value) resetLedgerForm(ledgerFormType.value);
    else ledgerDialog.value = false;
  }, ledgerEditingId.value ? "资料已更新" : "主数据已新增");
}

async function archiveLedger(type: "employees" | "products" | "accounts" | "stores", row: AnyRow) {
  await ElMessageBox.confirm(`确认删除“${row.name || row.accountName}”？历史记录会保留。`, "归档删除", { confirmButtonText: "确认删除", cancelButtonText: "取消", type: "warning" });
  await withLoading(async () => {
    await remove(`/api/v1/ledger/${type}/${row.id}`);
    ledger.value = await api("/api/v1/ledger");
  }, "记录已归档");
}

async function createAttribution() {
  const attributionCode = await promptValue("记录归因", "归因码，例如 DY-W9S-20260722-01");
  const eventType = (await promptValue("记录归因", "事件类型：CONSULTATION、ORDER、PAYMENT", "ORDER")).toUpperCase();
  const orders = eventType === "ORDER" || eventType === "PAYMENT" ? 1 : 0;
  const consultations = eventType === "CONSULTATION" ? 1 : 0;
  await withLoading(async () => {
    await post("/api/v1/ledger/attributions", { attributionCode, eventType, source: "运营后台人工记录", orders, consultations, occurredAt: new Date().toISOString() });
    ledger.value = await api("/api/v1/ledger");
    ledgerSubTab.value = "attributions";
  }, "归因事件已记录");
}

async function importCsv() {
  const integrationKind = (await promptValue("导入经营快照", "平台代码，例如 AMAZON、SHOPIFY、DOUYIN")).toUpperCase();
  const snapshotType = (await promptValue("导入经营快照", "数据类型：ORDER、SHIPMENT、AFTER_SALE、REFUND、INVENTORY", "ORDER")).toUpperCase();
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,text/csv";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    await withLoading(async () => {
      await post("/api/v1/ledger/import-snapshots", { integrationKind, snapshotType, format: "CSV", sourceName: file.name, csv: await file.text() });
      ledger.value = await api("/api/v1/ledger");
      ledgerSubTab.value = "imports";
    }, "经营数据已导入");
  };
  input.click();
}

onMounted(() => {
  window.addEventListener("storage", handleSharedLogin);
  void bootstrap();
});
onBeforeUnmount(() => window.removeEventListener("storage", handleSharedLogin));
</script>

<template>
  <div v-if="!authReady" class="login-shell">
    <div class="login-card login-loading"><div class="brand-mark">S</div><strong>正在进入赛电统一运营系统</strong></div>
  </div>
  <div v-else-if="!authUser" class="login-shell">
    <div class="login-card">
      <div class="login-brand"><div class="brand-mark">S</div><div><span>SAYDIAN</span><small>统一运营系统</small></div></div>
      <h1>企业微信扫码登录</h1>
      <p>请使用手机企业微信扫一扫。扫码后自动同步员工身份、部门和操作记录。</p>
      <el-alert v-if="loginMessage" :title="loginMessage" :type="wecomUnconfigured ? 'warning' : 'error'" :closable="false" show-icon />
      <el-button v-if="wecomUnconfigured" type="primary" plain @click="openMall('/saidian-mall-admin/')">打开商城接口配置</el-button>
      <div class="wecom-qr-panel" v-loading="qrLoading">
        <iframe v-if="qrLoginUrl" :src="qrLoginUrl" title="企业微信扫码登录二维码" />
        <div v-else class="qr-placeholder">{{ wecomUnconfigured ? "请先在商城后台配置企业微信" : "二维码暂未加载" }}</div>
      </div>
      <div class="qr-actions">
        <span>二维码失效？</span>
        <el-button link type="primary" @click="loadWecomQr">刷新二维码</el-button>
      </div>
      <el-button class="wecom-direct-button" size="large" @click="startWecomLogin">已在企业微信内，直接登录</el-button>
    </div>
  </div>
  <div v-else class="shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">S</div>
        <div><span>SAYDIAN</span><small>统一运营系统</small></div>
      </div>
      <nav>
        <button v-for="item in navItems" :key="item.key" :class="['nav-item', { active: active === item.key }]" @click="switchPage(item.key)">
          <el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span>
          <b v-if="item.key === 'content' && dashboard?.content.pendingApproval">{{ dashboard.content.pendingApproval }}</b>
          <b v-if="item.key === 'operationAnalysis' && dashboard?.operations.alerts">{{ dashboard.operations.alerts }}</b>
        </button>
      </nav>
      <div class="schedule-card">
        <span class="pulse-dot"></span>
        <strong>自动化已启用</strong>
        <small>下一轮巡查按任务计划执行</small>
        <div><span>评论/店铺</span><b>每10分钟</b></div>
        <div><span>运营日报</span><b>23:30</b></div>
      </div>
    </aside>

    <main class="main" v-loading="loading">
      <header class="topbar">
        <div><small>{{ todayLabel }}</small><h1>{{ pageTitle }}</h1></div>
        <div class="top-actions">
          <span class="employee-identity"><small>企业微信员工</small><strong>{{ actorInput }}</strong></span>
          <span class="connection-state"><i :class="error ? 'bad' : 'good'"></i>{{ error ? '连接异常' : '数据已连接' }}</span>
          <el-button :icon="Refresh" circle @click="withLoading(loadActive)" aria-label="刷新当前页面" />
          <el-dropdown>
            <div class="avatar">{{ actorInput.slice(0, 2) }}</div>
            <template #dropdown><el-dropdown-menu><el-dropdown-item @click="logout">退出登录</el-dropdown-item></el-dropdown-menu></template>
          </el-dropdown>
        </div>
      </header>

      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="page-alert" />

      <section v-if="active === 'dashboard'" class="page dashboard-page">
        <div class="hero-panel">
          <div class="hero-copy">
            <span class="eyebrow">TODAY'S OPERATIONS</span>
            <h2>从素材到发布，再到数据复盘</h2>
            <p>今日内容、店铺、直播与评论在同一条任务链路中运行。未接入账号保持“未配置”，不会进入自动发布。</p>
            <div class="hero-actions">
              <el-button type="primary" size="large" :icon="Promotion" @click="runDaily">执行今日流程</el-button>
              <el-button size="large" :icon="DocumentChecked" @click="generateContent">生成今日内容</el-button>
            </div>
          </div>
          <div class="orbit-card">
            <div class="orbit-core"><strong>{{ dashboard?.content.pendingApproval ?? 0 }}</strong><span>待审核</span></div>
            <div class="orbit-node node-a">素材</div><div class="orbit-node node-b">内容</div><div class="orbit-node node-c">发布</div><div class="orbit-node node-d">复盘</div>
          </div>
        </div>

        <div class="metric-grid">
          <article class="metric-card red"><span>今日内容</span><strong>{{ (dashboard?.content.pendingApproval ?? 0) + (dashboard?.content.approved ?? 0) }}</strong><small>待审核 {{ dashboard?.content.pendingApproval ?? 0 }} · 已发布 {{ dashboard?.content.published ?? 0 }}</small></article>
          <article class="metric-card orange"><span>素材资产</span><strong>{{ dashboard?.assets.total ?? 0 }}</strong><small>可用 {{ dashboard?.assets.ready ?? 0 }} · 待整理 {{ dashboard?.assets.pending ?? 0 }}</small></article>
          <article class="metric-card blue"><span>经营责任台账</span><strong>{{ dashboard?.ledger.accounts ?? 0 }}</strong><small>员工 {{ dashboard?.ledger.employees ?? 0 }} · 店铺 {{ dashboard?.ledger.stores ?? 0 }} · 待分配 {{ dashboard?.ledger.unassignedSnapshots ?? 0 }}</small></article>
          <article class="metric-card green"><span>已接入能力</span><strong>{{ dashboard?.integrations.healthy ?? 0 }}</strong><small>未配置 {{ dashboard?.integrations.unconfigured ?? 0 }} · 异常 {{ dashboard?.integrations.error ?? 0 }}</small></article>
        </div>

        <section class="panel today-todo-panel">
          <div class="panel-title"><div><span>今日待办</span><small>拍摄任务、爆款分析、素材缺口与运营事项</small></div><el-button link type="primary" @click="switchPage('reports')">全部任务</el-button></div>
          <div v-if="dashboard?.todayTodos.length" class="today-todo-grid">
            <button v-for="item in dashboard.todayTodos" :key="item.id" type="button" @click="switchPage(item.targetPage)">
              <span :class="['todo-type', item.type.toLowerCase()]">{{ ({ SHOOT: '拍摄', VIRAL: '爆款', GAP: '补拍', TASK: '任务' } as Record<string, string>)[item.type] }}</span>
              <div><strong>{{ item.title }}</strong><p>{{ item.description || '待补充执行说明' }}</p><small>{{ item.score ? `建议分 ${item.score}` : statusLabel(item.status) }}<template v-if="item.dueAt"> · {{ time(item.dueAt) }}</template></small></div>
            </button>
          </div>
          <el-empty v-else description="今日暂时没有待办；生成今日内容后会自动出现拍摄任务" :image-size="58" />
        </section>

        <div class="two-column">
          <section class="panel">
            <div class="panel-title"><div><span>今日工作流</span><small>Asia/Shanghai</small></div><el-button link type="primary" @click="switchPage('reports')">查看任务</el-button></div>
            <div class="timeline">
              <div v-for="item in [['00:30','素材、知识库和商城数据同步'],['05:30','店铺、竞品及集成巡查'],['07:00','生成视频与软文候选'],['08:30','企微发送审核提醒'],['10:00','发布已审核内容'],['23:30','生成并推送运营日报']]" :key="item[0]">
                <time>{{ item[0] }}</time><i></i><span>{{ item[1] }}</span>
              </div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-title"><div><span>最新运营报告</span><small>数据缺失时明确显示未获取</small></div></div>
            <div v-if="dashboard?.latestReports.length" class="report-list">
              <article v-for="report in dashboard.latestReports" :key="report.id"><div class="report-icon"><DataAnalysis /></div><div><strong>{{ report.title }}</strong><p>{{ report.summary }}</p><small>{{ time(report.createdAt) }}</small></div></article>
            </div>
            <el-empty v-else description="尚未生成运营报告" :image-size="70" />
          </section>
        </div>
      </section>

      <section v-else-if="active === 'mall'" class="page">
        <div class="section-heading"><div><span class="eyebrow">SAIDIAN MALL</span><h2>赛电商城</h2><p>商城作为统一运营系统的业务模块，沿用同一域名和企业微信员工身份。</p></div></div>
        <div class="module-grid">
          <article @click="openMall('/saidian-mall/')"><div class="module-icon">商</div><div><h3>商城前台</h3><p>商品浏览、会员与订单入口</p><small>/saidian-mall/</small></div><el-button type="primary" plain>进入</el-button></article>
          <article @click="openMall('/saidian-mall-admin/')"><div class="module-icon">管</div><div><h3>商城管理</h3><p>商品、订单与商城运营管理</p><small>/saidian-mall-admin/</small></div><el-button type="primary" plain>进入</el-button></article>
          <article @click="openMall('/saidian-mall/#/pages/employee/index')"><div class="module-icon">员</div><div><h3>员工中心</h3><p>企业微信员工业务入口</p><small>员工身份由商城统一维护</small></div><el-button type="primary" plain>进入</el-button></article>
        </div>
      </section>

      <section v-else-if="active === 'content'" class="page">
        <div class="section-heading">
          <div><span class="eyebrow">CONTENT COMMAND</span><h2>今日内容审核台</h2><p>普通生成优先复用已有素材；快速成片模式只生成无需补拍的脚本。</p></div>
          <div class="content-generate-actions">
            <el-select v-model="contentRestrictionMode" style="width: 190px">
              <el-option label="普通脚本" value="NORMAL" />
              <el-option label="健康内容受限脚本" value="HEALTH_RESTRICTED" />
            </el-select>
            <el-select v-model="assetOnlyProductModel" clearable filterable placeholder="快速成片产品型号"><el-option v-for="product in ledger.products.filter(product => product.status === 'READY')" :key="product.id" :label="`${product.modelCode} · ${product.name}`" :value="product.modelCode" /></el-select>
            <el-button @click="generateAssetOnlyVideo">生成无需补拍脚本</el-button>
            <el-button type="primary" :icon="DocumentChecked" @click="generateContent">生成今日候选</el-button>
          </div>
        </div>
        <div class="summary-strip content-filters" role="tablist" aria-label="内容状态筛选">
          <button type="button" :class="{ active: contentFilter === 'ALL' }" @click="contentFilter = 'ALL'">全部 <b>{{ content.length }}</b></button>
          <button type="button" :class="{ active: contentFilter === 'PENDING_APPROVAL' }" @click="contentFilter = 'PENDING_APPROVAL'">待审核 <b>{{ pendingContent.length }}</b></button>
          <button type="button" :class="{ active: contentFilter === 'APPROVED' }" @click="contentFilter = 'APPROVED'">已审核 <b>{{ content.filter(i => i.status === 'APPROVED').length }}</b></button>
          <button type="button" :class="{ active: contentFilter === 'PUBLISHED' }" @click="contentFilter = 'PUBLISHED'">已发布 <b>{{ content.filter(i => i.status === 'PUBLISHED').length }}</b></button>
        </div>
        <div class="content-grid">
          <article v-for="item in filteredContent" :key="item.id" class="content-card">
            <div class="content-card-head"><div><el-tag :type="item.kind === 'VIDEO' ? 'danger' : 'warning'" effect="dark">{{ item.kind === 'VIDEO' ? '视频' : '软文' }}</el-tag><el-tag :type="statusType(item.status)" effect="plain">{{ statusLabel(item.status) }}</el-tag><el-tag v-if="isHealthRestricted(item)" type="success" effect="plain">健康内容受限</el-tag></div><div class="score"><b>{{ item.score }}</b><span>选题分</span></div></div>
            <h3>{{ item.topic }}</h3>
            <div v-if="item.kind === 'VIDEO'" class="production-meta"><span>{{ item.productionNo || '历史内容' }}</span><el-tag type="primary">{{ statusLabel(item.productionStage) }}</el-tag><span>负责人：{{ item.owner || '待脚本审核时确定' }}</span></div>
            <p class="hook">“{{ item.hook }}”</p>
            <dl><div><dt>目标人群</dt><dd>{{ item.audience }}</dd></div><div><dt>传播目标</dt><dd>{{ item.objective }}</dd></div></dl>
            <ol><li v-for="line in item.outline" :key="line">{{ line }}</li></ol>
            <el-alert v-if="item.riskReasons.length" :title="item.riskReasons.join('；')" type="warning" :closable="false" show-icon />
            <div v-if="item.kind === 'VIDEO' && item.status === 'PENDING_APPROVAL'" class="workflow-block"><strong>脚本审核通过后生产的平台</strong><el-checkbox-group v-model="item.targetPlatforms"><el-checkbox v-for="variant in item.variants" :key="variant.id" :value="variant.platform">{{ platformName(variant.platform) }}</el-checkbox></el-checkbox-group></div>
            <div v-if="item.kind === 'VIDEO' && item.status === 'APPROVED'" class="workflow-block shot-library-block">
              <div class="workflow-block-head">
                <div><strong>镜头素材清单</strong><small>已有 {{ shotRequirements(item, 'EXISTING').length }} 项 · 需补拍 {{ shotRequirements(item, 'MISSING').length }} 项</small></div>
                <el-button size="small" @click="refreshAssetCoverage(item)">按当前素材库重新分析</el-button>
              </div>
              <el-collapse v-if="item.shootRequirements?.length" class="shot-groups">
                <el-collapse-item name="existing">
                  <template #title><span class="shot-group-title"><el-tag size="small" type="success">已有素材</el-tag><b>{{ shotRequirements(item, 'EXISTING').length }}项</b><small>点击展开预览或选择重拍</small></span></template>
                  <div v-for="requirement in shotRequirements(item, 'EXISTING')" :key="requirement.id" class="shoot-row">
                    <div class="shoot-copy">
                      <span>{{ requirement.description }}</span>
                      <small v-if="requirement.reason">{{ requirement.reason }}</small>
                      <div v-if="requirement.assetIds?.length" class="matched-assets">
                        <el-button v-for="assetId in requirement.assetIds" :key="assetId" size="small" text type="primary" @click.stop="previewProductionAsset(item, assetId)">{{ productionAsset(item, assetId)?.kind === 'VIDEO' ? '视频主画面' : productionAsset(item, assetId)?.kind === 'IMAGE' ? '图片辅助' : '素材' }} · {{ productionAsset(item, assetId)?.displayName || productionAsset(item, assetId)?.assetNo || assetId }}</el-button>
                      </div>
                    </div>
                    <div class="shoot-actions"><el-button size="small" @click="replaceShotAsset(item, requirement)">拍摄替换</el-button></div>
                  </div>
                  <el-empty v-if="!shotRequirements(item, 'EXISTING').length" description="当前没有可直接使用的已有素材" :image-size="42" />
                </el-collapse-item>
                <el-collapse-item name="missing">
                  <template #title><span class="shot-group-title"><el-tag size="small" type="warning">需要补拍</el-tag><b>{{ shotRequirements(item, 'MISSING').length }}项</b><small>可上传素材或由AI智能生成</small></span></template>
                  <div v-for="requirement in shotRequirements(item, 'MISSING')" :key="requirement.id" class="shoot-row">
                    <div class="shoot-copy"><span>{{ requirement.description }}</span><small v-if="requirement.reason">{{ requirement.reason }}</small><small v-if="requirement.aiGeneration" :class="{ 'ai-generation-error': requirement.aiGeneration.status === 'FAILED' }">AI生成：{{ aiGenerationLabel(requirement.aiGeneration.status) }}<template v-if="requirement.aiGeneration.failureReason"> · {{ requirement.aiGeneration.failureReason }}</template></small></div>
                    <div class="shoot-actions">
                      <el-button v-if="item.productionStage === 'AWAITING_ASSETS'" size="small" type="primary" plain @click="openProductionUpload(item, requirement)">上传对应素材</el-button>
                      <el-button
                        v-if="item.productionStage === 'AWAITING_ASSETS'"
                        size="small"
                        type="success"
                        :loading="productionAiPollingRequirementId === requirement.id"
                        @click="requirement.aiGeneration && ['PENDING','RUNNING'].includes(requirement.aiGeneration.status) ? pollAiShotGeneration(item, requirement) : openProductionAi(item, requirement)"
                      >{{ requirement.aiGeneration && ['PENDING','RUNNING'].includes(requirement.aiGeneration.status) ? '查看生成进度' : requirement.aiGeneration?.status === 'FAILED' ? '重新AI生成' : 'AI智能生成' }}</el-button>
                    </div>
                  </div>
                  <el-empty v-if="!shotRequirements(item, 'MISSING').length" description="素材已经齐全，无需补拍" :image-size="42" />
                </el-collapse-item>
              </el-collapse>
              <el-empty v-if="!item.shootRequirements?.length" description="尚未分析镜头素材覆盖情况" :image-size="50" />
            </div>
            <div class="platform-tags"><span v-for="variant in item.variants.filter(v => !item.targetPlatforms?.length || item.targetPlatforms.includes(v.platform))" :key="variant.id">{{ platformName(variant.platform) }}</span></div>
            <div class="variant-account-list"><div v-for="variant in item.variants" :key="`${variant.id}-account`"><small>{{ platformName(variant.platform) }}发布账号</small><el-select :model-value="variant.targetAccountId" placeholder="未指定，不会进入发布队列" clearable @change="assignVariantAccount(variant.id, $event)"><el-option v-for="account in ledger.accounts.filter(account => account.integration?.kind === variant.platform)" :key="account.id" :label="`${account.accountName}（${account.region}）`" :value="account.id" /></el-select></div></div>
            <div class="card-actions" v-if="item.status === 'PENDING_APPROVAL'"><el-button @click="reject(item)">退回修改</el-button><el-button type="primary" @click="approve(item)">审核通过</el-button></div>
            <div v-if="item.kind === 'VIDEO'" class="card-actions workflow-actions">
              <el-button v-if="item.productionStage === 'READY_TO_EDIT'" type="primary" @click="startVideoEditing(item)">启动AI剪辑</el-button>
              <template v-if="item.productionStage === 'VIDEO_REVIEW'"><el-button @click="reviewMasterVideo(item, false)">退回剪辑</el-button><el-button type="primary" @click="reviewMasterVideo(item, true)">成片审核通过</el-button></template>
              <el-button v-if="item.productionStage === 'PLATFORM_PACKAGING'" type="primary" @click="generatePlatformPackaging(item)">生成平台标题与封面</el-button>
              <template v-if="item.productionStage === 'TRACKING' || item.status === 'PUBLISHED'"><el-button @click="generateOptimization(item, 168)">生成7日初评</el-button><el-button @click="generateOptimization(item, 720)">生成30日终评</el-button></template>
            </div>
            <div v-if="item.kind === 'VIDEO' && ['PACKAGING_REVIEW','READY_TO_PUBLISH','PUBLISHING','TRACKING'].includes(item.productionStage)" class="workflow-block"><strong>平台包装与发布</strong><article v-for="variant in item.variants.filter(v => item.targetPlatforms.includes(v.platform))" :key="`${variant.id}-package`" class="package-row"><div><b>{{ platformName(variant.platform) }}</b><span>{{ statusLabel(variant.packagingStatus) }}</span><small>{{ variant.title }}</small></div><div><el-button v-if="variant.packagingStatus !== 'APPROVED'" size="small" @click="reviewPackaging(variant, false)">退回</el-button><el-button v-if="variant.packagingStatus !== 'APPROVED'" size="small" type="primary" @click="reviewPackaging(variant, true)">审核包装</el-button><el-button v-if="variant.packagingStatus === 'APPROVED'" size="small" @click="downloadDelivery(variant, 'video')">下载成片</el-button><el-button v-if="variant.packagingStatus === 'APPROVED' && variant.coverPath" size="small" @click="downloadDelivery(variant, 'cover')">下载封面</el-button><el-button v-if="variant.packagingStatus === 'APPROVED' && variant.status !== 'PUBLISHED'" size="small" @click="recordManualPublish(variant)">回填自行发布</el-button></div></article></div>
            <div v-if="item.optimizations?.length" class="workflow-block"><strong>数据优化建议</strong><article v-for="suggestion in item.optimizations" :key="suggestion.id" class="optimization-row"><div><b>{{ suggestion.checkpointHours === 168 ? '7日初评' : '30日终评' }} · {{ statusLabel(suggestion.status) }}</b><p>{{ suggestion.summary }}</p><small>{{ suggestion.recommendations?.join('；') || '当前数据未形成明确调整建议' }}</small></div><div v-if="suggestion.status === 'PENDING_CONFIRMATION'"><el-button size="small" @click="decideOptimization(suggestion.id, false)">不采用</el-button><el-button size="small" type="primary" @click="decideOptimization(suggestion.id, true)">确认进入下一轮</el-button></div></article></div>
          </article>
        </div>
        <el-empty v-if="!content.length" description="今日内容尚未生成" />
        <el-empty v-else-if="!filteredContent.length" description="当前分类暂无内容" />
      </section>

      <section v-else-if="active === 'assets'" class="page">
        <BrandDataCenter ref="brandDataCenter" @open-content="openGeneratedContent" />
      </section>

      <section v-else-if="active === 'ledger'" class="page">
        <div class="section-heading">
          <div><span class="eyebrow">ACCOUNTABILITY LEDGER</span><h2>经营主数据与责任台账</h2><p>员工、产品、账号、店铺、经营快照和归因记录使用同一条审计链路。</p></div>
          <div class="hero-actions"><el-button @click="openLedgerForm('employees')">新增员工</el-button><el-button @click="openLedgerForm('products')">新增产品</el-button><el-button @click="openLedgerForm('accounts')">新增账号</el-button><el-button @click="openLedgerForm('stores')">新增店铺</el-button><el-button type="primary" @click="importCsv">导入CSV</el-button></div>
        </div>
        <el-segmented v-model="ledgerSubTab" :options="[
          { label: `员工 ${ledger.employees.length}`, value: 'employees' },
          { label: `产品 ${ledger.products.length}`, value: 'products' },
          { label: `账号 ${ledger.accounts.length}`, value: 'accounts' },
          { label: `店铺 ${ledger.stores.length}`, value: 'stores' },
          { label: `经营快照 ${ledger.snapshots.length}`, value: 'snapshots' },
          { label: `导入批次 ${ledger.imports.length}`, value: 'imports' },
          { label: `归因 ${ledger.attributions.length}`, value: 'attributions' },
          { label: `数据源 ${ledger.sourceHealth.length}`, value: 'sources' },
        ]" />
        <div class="table-panel" v-if="ledgerSubTab === 'employees'"><el-table :data="ledger.employees" stripe height="560"><el-table-column prop="name" label="员工" width="140" /><el-table-column prop="employeeNo" label="员工编号" width="130"><template #default="scope">{{ scope.row.employeeNo || '未配置' }}</template></el-table-column><el-table-column label="部门" width="150"><template #default="scope">{{ scope.row.department?.name || '未分配' }}</template></el-table-column><el-table-column prop="role" label="岗位/角色" min-width="180" /><el-table-column prop="wecomUserId" label="企微身份" min-width="180"><template #default="scope">{{ scope.row.wecomUserId || '未配置' }}</template></el-table-column><el-table-column label="权限" width="120"><template #default="scope">{{ scope.row.isSuperAdmin ? '超级管理员' : '普通员工' }}</template></el-table-column><el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="scope.row.status === 'ACTIVE' ? 'success' : 'info'">{{ scope.row.status }}</el-tag></template></el-table-column><el-table-column label="操作" width="130" fixed="right"><template #default="scope"><el-button link type="primary" @click="openLedgerForm('employees', scope.row)">编辑</el-button><el-button link type="danger" @click="archiveLedger('employees', scope.row)">删除</el-button></template></el-table-column></el-table></div>
        <div class="table-panel" v-else-if="ledgerSubTab === 'products'"><el-table :data="ledger.products" stripe height="560"><el-table-column prop="modelCode" label="型号" width="130" /><el-table-column prop="name" label="产品" min-width="220" /><el-table-column prop="category" label="分类" min-width="180" /><el-table-column label="SKU" min-width="240"><template #default="scope">{{ scope.row.skus?.length ? scope.row.skus.map((i: AnyRow) => i.skuCode).join('、') : '未配置' }}</template></el-table-column><el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column><el-table-column label="操作" width="130" fixed="right"><template #default="scope"><el-button link type="primary" @click="openLedgerForm('products', scope.row)">编辑</el-button><el-button link type="danger" @click="archiveLedger('products', scope.row)">删除</el-button></template></el-table-column></el-table></div>
        <div class="table-panel" v-else-if="ledgerSubTab === 'accounts'"><el-table :data="ledger.accounts" stripe height="560"><el-table-column label="平台" width="120"><template #default="scope">{{ scope.row.integration?.displayName || '未获取' }}</template></el-table-column><el-table-column prop="accountName" label="账号" min-width="180" /><el-table-column prop="externalAccountId" label="平台账号编号" min-width="180" /><el-table-column prop="region" label="区域" width="90" /><el-table-column label="负责人" width="130"><template #default="scope">{{ scope.row.ownerEmployee?.name || '待分配' }}</template></el-table-column><el-table-column label="能力状态" min-width="260"><template #default="scope"><span v-if="Object.keys(scope.row.capabilityStatus || {}).length">{{ Object.entries(scope.row.capabilityStatus).map(([k,v]) => `${k}:${statusLabel(String(v))}`).join('；') }}</span><span v-else>未配置</span></template></el-table-column><el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="statusType(scope.row.state)">{{ statusLabel(scope.row.state) }}</el-tag></template></el-table-column><el-table-column label="操作" width="130" fixed="right"><template #default="scope"><el-button link type="primary" @click="openLedgerForm('accounts', scope.row)">编辑</el-button><el-button link type="danger" @click="archiveLedger('accounts', scope.row)">删除</el-button></template></el-table-column></el-table></div>
        <div class="table-panel" v-else-if="ledgerSubTab === 'stores'"><el-table :data="ledger.stores" stripe height="560"><el-table-column label="平台" width="120"><template #default="scope">{{ scope.row.platformAccount?.integration?.displayName || '未获取' }}</template></el-table-column><el-table-column label="账号" width="160"><template #default="scope">{{ scope.row.platformAccount?.accountName || '未获取' }}</template></el-table-column><el-table-column prop="name" label="店铺" min-width="200" /><el-table-column prop="externalStoreId" label="平台店铺编号" min-width="180" /><el-table-column prop="region" label="区域" width="90" /><el-table-column label="负责人" width="130"><template #default="scope">{{ scope.row.ownerEmployee?.name || '待分配' }}</template></el-table-column><el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="statusType(scope.row.state)">{{ statusLabel(scope.row.state) }}</el-tag></template></el-table-column><el-table-column label="操作" width="130" fixed="right"><template #default="scope"><el-button link type="primary" @click="openLedgerForm('stores', scope.row)">编辑</el-button><el-button link type="danger" @click="archiveLedger('stores', scope.row)">删除</el-button></template></el-table-column></el-table></div>
        <div class="table-panel" v-else-if="ledgerSubTab === 'snapshots'"><el-table :data="ledger.snapshots" stripe height="560"><el-table-column label="平台" width="120"><template #default="scope">{{ scope.row.integration?.displayName || '未获取' }}</template></el-table-column><el-table-column label="账号/店铺" min-width="180"><template #default="scope">{{ scope.row.platformAccount?.accountName || '未绑定账号' }} / {{ scope.row.store?.name || '未绑定店铺' }}</template></el-table-column><el-table-column prop="type" label="类型" width="130" /><el-table-column prop="sourceId" label="外部编号" min-width="170" /><el-table-column prop="status" label="状态" width="120" /><el-table-column prop="amount" label="金额" width="120"><template #default="scope">{{ scope.row.amount ?? '未获取' }} {{ scope.row.currency || '' }}</template></el-table-column><el-table-column label="负责人" width="130"><template #default="scope">{{ scope.row.ownerEmployee?.name || '待分配' }}</template></el-table-column><el-table-column label="发生时间" width="160"><template #default="scope">{{ time(scope.row.occurredAt) }}</template></el-table-column><el-table-column label="未获取字段" min-width="200"><template #default="scope">{{ scope.row.unavailableFields?.length ? scope.row.unavailableFields.join('、') : '无' }}</template></el-table-column></el-table></div>
        <div class="table-panel" v-else-if="ledgerSubTab === 'imports'"><el-table :data="ledger.imports" stripe height="560"><el-table-column label="平台" width="120"><template #default="scope">{{ scope.row.integration?.displayName || '未获取' }}</template></el-table-column><el-table-column prop="sourceName" label="数据文件/来源" min-width="220" /><el-table-column prop="format" label="格式" width="90" /><el-table-column prop="importedBy" label="导入员工" width="130" /><el-table-column prop="recordsReceived" label="收到" width="80" /><el-table-column prop="recordsImported" label="成功" width="80" /><el-table-column prop="recordsRejected" label="拒绝" width="80" /><el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column><el-table-column label="导入时间" width="160"><template #default="scope">{{ time(scope.row.createdAt) }}</template></el-table-column></el-table></div>
        <div class="table-panel" v-else-if="ledgerSubTab === 'attributions'"><div class="table-toolbar"><el-button type="primary" @click="createAttribution">记录归因事件</el-button></div><el-table :data="ledger.attributions" stripe height="520"><el-table-column prop="attributionCode" label="归因码" min-width="200" /><el-table-column prop="eventType" label="事件" width="130" /><el-table-column label="平台/账号" min-width="180"><template #default="scope">{{ scope.row.integration?.displayName || '未获取' }} / {{ scope.row.platformAccount?.accountName || '未获取' }}</template></el-table-column><el-table-column prop="source" label="来源" min-width="180" /><el-table-column prop="consultations" label="咨询" width="80" /><el-table-column prop="orders" label="订单" width="80" /><el-table-column prop="revenue" label="成交金额" width="120"><template #default="scope">{{ scope.row.revenue ?? '未获取' }}</template></el-table-column><el-table-column label="员工" width="120"><template #default="scope">{{ scope.row.employee?.name || '未绑定' }}</template></el-table-column><el-table-column label="时间" width="160"><template #default="scope">{{ time(scope.row.occurredAt) }}</template></el-table-column></el-table></div>
        <div class="table-panel" v-else><el-table :data="ledger.sourceHealth" stripe height="560"><el-table-column label="数据源" width="150"><template #default="scope">{{ scope.row.integration?.displayName || '未获取' }}</template></el-table-column><el-table-column label="账号" width="160"><template #default="scope">{{ scope.row.platformAccount?.accountName || '连接级' }}</template></el-table-column><el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="statusType(scope.row.state)">{{ statusLabel(scope.row.state) }}</el-tag></template></el-table-column><el-table-column prop="message" label="检查结果" min-width="300" /><el-table-column prop="latencyMs" label="耗时(ms)" width="100"><template #default="scope">{{ scope.row.latencyMs ?? '未获取' }}</template></el-table-column><el-table-column label="未获取原因" min-width="220"><template #default="scope">{{ scope.row.unavailableFields?.length ? scope.row.unavailableFields.join('、') : '无' }}</template></el-table-column><el-table-column label="检查时间" width="160"><template #default="scope">{{ time(scope.row.checkedAt) }}</template></el-table-column></el-table></div>
      </section>

      <section v-else-if="active === 'operationAnalysis'" class="page">
        <OperationAnalysis ref="operationAnalysis" />
      </section>

      <section v-else-if="active === 'operations'" class="page">
        <div class="section-heading"><div><span class="eyebrow">OPERATIONS WATCH</span><h2>店铺、竞品与全网趋势</h2><p>不可获得的数据记为“未获取”，不按零值参与判断。</p></div><el-button :icon="Search" @click="runJob('SYNC_SHOP')">执行巡查</el-button></div>
        <el-segmented v-model="opsSubTab" :options="[{ label: `店铺事项 ${shopItems.length}`, value: 'shop' }, { label: `竞品 ${competitors.length}`, value: 'competitors' }, { label: `趋势 ${trends.length}`, value: 'trends' }, { label: `提醒 ${alerts.filter(i => i.status === 'OPEN').length}`, value: 'alerts' }]" />
        <div class="table-panel" v-if="opsSubTab === 'shop'"><el-table :data="shopItems" stripe height="560"><el-table-column label="平台" width="120"><template #default="scope">{{ scope.row.integration?.displayName || '未获取' }}</template></el-table-column><el-table-column prop="type" label="事项" width="130" /><el-table-column prop="summary" label="摘要" min-width="360" /><el-table-column prop="owner" label="负责人" width="120"><template #default="scope">{{ scope.row.owner || '待分配' }}</template></el-table-column><el-table-column label="状态" width="120"><template #default="scope"><el-tag :type="scope.row.overdue ? 'danger' : 'info'">{{ scope.row.overdue ? '已超时' : statusLabel(scope.row.status) }}</el-tag></template></el-table-column></el-table></div>
        <div class="card-list" v-else-if="opsSubTab === 'competitors'"><article v-for="item in competitors" :key="item.id"><div><el-tag>{{ platformName(item.platform) }}</el-tag><h3>{{ item.name }}</h3><p>{{ item.snapshots?.[0]?.changes?.length ? item.snapshots[0].changes.join('；') : '最新变化未获取' }}</p></div><small>{{ item.snapshots?.[0] ? time(item.snapshots[0].capturedAt) : '尚无快照' }}</small></article><el-empty v-if="!competitors.length" description="竞品观察名单尚未导入" /></div>
        <div class="table-panel" v-else-if="opsSubTab === 'trends'"><el-table :data="trends" stripe height="560"><el-table-column prop="keyword" label="关键词" width="180" /><el-table-column prop="source" label="来源" width="140" /><el-table-column prop="category" label="分类" width="130" /><el-table-column prop="changeRate" label="变化" width="100"><template #default="scope">{{ scope.row.changeRate == null ? '未获取' : `${Math.round(scope.row.changeRate * 100)}%` }}</template></el-table-column><el-table-column prop="opportunity" label="机会" min-width="280" /><el-table-column prop="action" label="建议动作" min-width="280" /></el-table></div>
        <div class="alert-list" v-else><article v-for="item in alerts" :key="item.id" :class="item.level.toLowerCase()"><div><el-tag :type="statusType(item.level)">{{ item.level }}</el-tag><h3>{{ item.title }}</h3><p>{{ item.message }}</p><small>{{ time(item.createdAt) }}</small></div><el-button v-if="item.status === 'OPEN'" @click="resolveAlert(item.id)">标记解决</el-button></article><el-empty v-if="!alerts.length" description="当前没有运营提醒" /></div>
      </section>

      <section v-else-if="active === 'engagement'" class="page">
        <div class="section-heading"><div><span class="eyebrow">AUDIENCE CARE</span><h2>评论与直播巡查</h2><p>标准回复先匹配客服知识库；健康、投诉和售后问题自动转人工。</p></div><el-button :icon="Refresh" @click="runJob('SYNC_COMMENTS')">巡查评论</el-button></div>
        <div class="two-column engagement-grid">
          <section class="panel"><div class="panel-title"><div><span>评论处理队列</span><small>待处理 {{ comments.filter(i => i.status === 'PENDING').length }}</small></div></div><div class="comment-list"><article v-for="item in comments" :key="item.id"><div class="comment-meta"><span>{{ item.integration?.displayName }}</span><el-tag :type="item.requiresHuman ? 'warning' : 'success'">{{ item.requiresHuman ? '人工处理' : '标准问题' }}</el-tag></div><p class="comment-text">{{ item.text }}</p><div v-if="item.suggestedReply" class="reply-box"><small>建议回复 · {{ Math.round((item.confidence || 0) * 100) }}%</small><p>{{ item.suggestedReply }}</p></div><el-button v-if="item.replyJobs?.[0]?.status === 'PENDING'" type="primary" plain @click="approveReply(item.replyJobs[0].id)">审核并回复</el-button></article><el-empty v-if="!comments.length" description="暂无评论数据，平台能力未配置时不会生成模拟数据" /></div></section>
          <section class="panel"><div class="panel-title"><div><span>直播间状态</span><small>每5分钟快照</small></div></div><div class="live-list"><article v-for="item in live" :key="item.id"><div class="live-badge"><span></span>LIVE</div><h3>{{ item.title || item.remoteRoomId }}</h3><p>{{ item.issueSummary?.length ? item.issueSummary.join('；') : '当前未发现异常' }}</p><small>最近采集 {{ time(item.lastCapturedAt) }}</small></article><el-empty v-if="!live.length" description="当前未获取到直播间" /></div></section>
        </div>
      </section>

      <section v-else-if="active === 'reports'" class="page">
        <div class="section-heading"><div><span class="eyebrow">REPORTING & TASKS</span><h2>运营报告与自动化任务</h2><p>每一项自动动作均保存状态、重试次数和执行结果。</p></div><el-button type="primary" :icon="Promotion" @click="runDaily">执行今日流程</el-button></div>
        <el-segmented v-model="reportSubTab" :options="[{ label: `报告 ${reports.length}`, value: 'reports' }, { label: `自动任务 ${jobs.length}`, value: 'jobs' }, { label: `执行待办 ${tasks.length}`, value: 'tasks' }, { label: `SOP版本 ${sops.length}`, value: 'sops' }]" />
        <div class="report-cards" v-if="reportSubTab === 'reports'"><article v-for="item in reports" :key="item.id"><div class="report-card-top"><el-tag type="danger" effect="dark">{{ item.kind }}</el-tag><small>{{ time(item.createdAt) }}</small></div><h3>{{ item.title }}</h3><p>{{ item.summary }}</p><div class="action-chips"><span v-for="action in (item.actions || [])" :key="action.action">{{ action.priority }} · {{ action.action }}</span></div><el-collapse class="report-detail"><el-collapse-item title="查看素材、平台、员工和效果明细" name="detail"><section v-for="section in (item.sections || [])" :key="section.title" class="report-section"><h4>{{ section.title }}</h4><p v-if="section.text">{{ section.text }}</p><el-table v-if="section.rows?.length" :data="section.rows" size="small" border><el-table-column v-for="column in section.columns" :key="column" :label="reportColumnLabel(column)" min-width="125" show-overflow-tooltip><template #default="scope">{{ reportCell(column, scope.row[column]) }}</template></el-table-column></el-table><el-empty v-else-if="section.rows" description="今日无记录" :image-size="45" /></section></el-collapse-item></el-collapse></article><el-empty v-if="!reports.length" description="运行今日流程后生成报告" /></div>
        <div class="table-panel" v-else-if="reportSubTab === 'jobs'"><el-table :data="jobs" stripe height="560"><el-table-column prop="kind" label="任务" min-width="180" /><el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column><el-table-column prop="attempts" label="次数" width="80" /><el-table-column prop="lastError" label="最近错误" min-width="280"><template #default="scope">{{ scope.row.lastError || '—' }}</template></el-table-column><el-table-column label="计划时间" width="160"><template #default="scope">{{ time(scope.row.scheduledAt) }}</template></el-table-column></el-table></div>
        <div class="table-panel" v-else-if="reportSubTab === 'tasks'"><el-table :data="tasks" stripe height="560"><el-table-column prop="priority" label="优先级" width="100" /><el-table-column prop="title" label="任务" min-width="280" /><el-table-column prop="category" label="分类" width="130" /><el-table-column prop="owner" label="负责人" width="120"><template #default="scope">{{ scope.row.owner || '待分配' }}</template></el-table-column><el-table-column label="截止" width="160"><template #default="scope">{{ time(scope.row.dueAt) }}</template></el-table-column><el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column></el-table></div>
        <div class="sop-list" v-else><article v-for="item in sops" :key="item.id"><div><strong>{{ item.kind }} · V{{ item.version }}</strong><el-tag :type="item.status === 'ACTIVE' ? 'success' : 'info'">{{ item.status }}</el-tag></div><p>{{ item.changeNote }}</p><small>生效时间 {{ time(item.effectiveAt) }}</small></article></div>
      </section>

      <section v-else class="page">
        <div class="section-heading"><div><span class="eyebrow">INTEGRATION STATUS</span><h2>平台连接与能力状态</h2><p>每个账号分别显示能力；未验证的接口不会显示为已打通。</p></div><el-button :icon="Refresh" @click="checkIntegrations">检查全部连接</el-button></div>
        <section class="douyin-config-panel">
          <div class="douyin-config-head">
            <div><strong>抖音开放平台</strong><p>授权赛电自有抖音账号，接收平台事件并为内容效果回收提供身份基础。</p></div>
            <el-tag :type="statusType(douyinStatus?.state || 'UNCONFIGURED')">{{ statusLabel(douyinStatus?.state || "UNCONFIGURED") }}</el-tag>
          </div>
          <div class="douyin-config-form">
            <el-input v-model="douyinClientKey" placeholder="Client Key"><template #prepend>Client Key</template></el-input>
            <el-input v-model="douyinClientSecret" type="password" show-password placeholder="留空表示保留现有密钥"><template #prepend>Client Secret</template></el-input>
            <el-button type="primary" :loading="loading" @click="saveDouyinConfig">保存应用配置</el-button>
            <el-button :disabled="!douyinStatus?.clientSecretConfigured" @click="authorizeDouyin">{{ douyinStatus?.authorized ? "重新授权账号" : "授权抖音账号" }}</el-button>
          </div>
          <div class="douyin-config-meta">
            <span>回调：{{ douyinStatus?.redirectUri || "加载中" }}</span>
            <span>Webhook：{{ douyinStatus?.webhookUrl || "加载中" }}</span>
            <span>账号：{{ douyinStatus?.openIdMasked || "未授权" }}</span>
            <span>令牌有效期：{{ time(douyinStatus?.expiresAt) }}</span>
          </div>
        </section>
        <div class="integration-grid"><article v-for="item in integrations" :key="item.id"><div class="integration-icon">{{ item.displayName.slice(0, 1) }}</div><div class="integration-copy"><div><h3>{{ item.displayName }}</h3><el-tag :type="statusType(item.state)">{{ statusLabel(item.state) }}</el-tag></div><p>{{ item.message }}</p><div class="capability-tags"><span v-for="capability in item.capabilities" :key="capability">{{ capability }}</span><span v-if="!item.capabilities.length">暂无已验证能力</span></div><small>检查时间：{{ time(item.lastCheckedAt) }}</small></div></article></div>
        <section class="token-panel"><div><el-icon><Setting /></el-icon><div><strong>统一企业微信身份</strong><p>当前员工：{{ actorInput }}。登录、部门和员工资料由赛电商城企业微信机制统一提供。</p></div></div><el-tag type="success">已登录</el-tag></section>
      </section>

      <el-dialog v-model="productionUploadDialog" title="上传对应拍摄素材" width="680px" destroy-on-close>
        <div class="production-upload-context">
          <strong>{{ productionUploadTarget?.plan.productionNo || '历史内容' }} · {{ productionUploadTarget?.plan.topic }}</strong>
          <span>{{ productionUploadTarget?.requirement.description }}</span>
          <small>本入口按公司原创、可商用素材归档；系统自动识别类型、型号和分类，并关联当前补拍项。</small>
        </div>
        <el-upload v-model:file-list="productionUploadFiles" drag multiple :auto-upload="false" :limit="20" :disabled="productionUploading">
          <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
          <div class="el-upload__text">拖入拍摄素材，或<em>点击选择</em></div>
          <template #tip><div class="el-upload__tip">最多20个文件；上传后自动存入素材库并完成当前补拍项。</div></template>
        </el-upload>
        <el-progress v-if="productionUploading || productionUploadProgress" :percentage="productionUploadProgress" />
        <template #footer><el-button :disabled="productionUploading" @click="productionUploadDialog = false">取消</el-button><el-button type="primary" :loading="productionUploading" @click="submitProductionUpload">{{ productionUploading ? `正在上传 ${productionUploadProgress}%` : '上传并继续' }}</el-button></template>
      </el-dialog>

      <el-dialog v-model="productionAiDialog" title="AI智能生成补拍视频" width="680px" destroy-on-close>
        <div class="production-upload-context">
          <strong>{{ productionAiTarget?.plan.productionNo || '历史内容' }} · {{ productionAiTarget?.plan.topic }}</strong>
          <span>{{ productionAiTarget?.requirement.description }}</span>
          <small>系统优先使用素材库中的对应产品图保持外观；没有合适产品图时自动使用文生视频。</small>
        </div>
        <el-form label-position="top">
          <el-form-item label="生成要求"><el-input v-model="productionAiPrompt" type="textarea" :rows="6" maxlength="1500" show-word-limit /></el-form-item>
          <el-form-item label="视频时长"><el-radio-group v-model="productionAiDuration"><el-radio-button :value="5">5秒</el-radio-button><el-radio-button :value="10">10秒</el-radio-button></el-radio-group></el-form-item>
          <el-form-item label="视频模型">
            <el-select v-model="productionAiModelId" clearable placeholder="智能推荐（默认）">
              <el-option label="智能推荐（默认）" value="" />
              <el-option
                v-for="model in productionAiModels"
                :key="model.id"
                :label="`${model.provider?.displayName || model.provider?.code} · ${model.displayName}`"
                :value="model.id"
                :disabled="!model.enabled || !model.provider?.enabled || !['HEALTHY','CONFIGURED'].includes(model.provider?.state)"
              />
            </el-select>
            <small class="form-hint">未配置、已暂停或能力不匹配的模型不可提交。</small>
          </el-form-item>
          <el-form-item v-if="productionAiModelId" label="失败处理">
            <el-switch v-model="productionAiAllowFallback" active-text="失败后自动切换备用模型" />
          </el-form-item>
        </el-form>
        <template #footer><el-button :disabled="productionAiSubmitting" @click="productionAiDialog = false">取消</el-button><el-button type="success" :loading="productionAiSubmitting" @click="submitProductionAi">开始AI生成</el-button></template>
      </el-dialog>

      <el-dialog v-model="assetPreviewDialog" :title="`素材预览 · ${assetPreviewName}`" width="min(900px, 92vw)" destroy-on-close @closed="assetPreviewUrl = ''">
        <div class="production-asset-preview" v-loading="assetPreviewLoading">
          <video v-if="assetPreviewUrl && assetPreviewKind === 'VIDEO'" :src="assetPreviewUrl" controls playsinline preload="metadata" />
          <img v-else-if="assetPreviewUrl && assetPreviewKind === 'IMAGE'" :src="assetPreviewUrl" :alt="assetPreviewName" />
          <audio v-else-if="assetPreviewUrl && assetPreviewKind === 'AUDIO'" :src="assetPreviewUrl" controls preload="metadata" />
          <iframe v-else-if="assetPreviewUrl" :src="assetPreviewUrl" :title="assetPreviewName" />
          <el-empty v-else-if="!assetPreviewLoading" description="该素材暂时无法在线预览" />
        </div>
      </el-dialog>

      <el-dialog v-model="ledgerDialog" :title="`${ledgerEditingId ? '编辑' : '新增'}${({ employees: '员工', products: '产品', accounts: '账号', stores: '店铺' } as Record<string,string>)[ledgerFormType]}`" width="820px" destroy-on-close>
        <el-form label-position="top" class="ledger-form-grid">
          <template v-if="ledgerFormType === 'employees'">
            <el-form-item label="姓名" required><el-input v-model="ledgerForm.name" /></el-form-item><el-form-item label="员工编号"><el-input v-model="ledgerForm.employeeNo" /></el-form-item>
            <el-form-item label="部门"><el-select v-model="ledgerForm.departmentId" clearable filterable><el-option v-for="item in ledger.departments" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item><el-form-item label="岗位/角色"><el-input v-model="ledgerForm.role" /></el-form-item>
            <el-form-item label="企微身份"><el-input v-model="ledgerForm.wecomUserId" /></el-form-item><el-form-item label="脱敏手机"><el-input v-model="ledgerForm.mobileMasked" placeholder="例如 138****0000" /></el-form-item>
            <el-form-item label="权限"><el-switch v-model="ledgerForm.isSuperAdmin" active-text="超级管理员" inactive-text="普通员工" /></el-form-item><el-form-item label="状态"><el-select v-model="ledgerForm.status"><el-option label="在职" value="ACTIVE" /><el-option label="停用" value="INACTIVE" /></el-select></el-form-item>
          </template>
          <template v-else-if="ledgerFormType === 'products'">
            <el-form-item label="型号" required><el-input v-model="ledgerForm.modelCode" :disabled="Boolean(ledgerEditingId)" /></el-form-item><el-form-item label="产品名称" required><el-input v-model="ledgerForm.name" /></el-form-item>
            <el-form-item label="分类"><el-input v-model="ledgerForm.category" /></el-form-item><el-form-item label="状态"><el-select v-model="ledgerForm.status"><el-option label="待审核" value="PENDING" /><el-option label="可用" value="READY" /><el-option label="禁用" value="BLOCKED" /></el-select></el-form-item>
            <el-form-item label="别名" class="full"><el-input v-model="ledgerForm.aliases" placeholder="多个值用顿号或逗号分隔" /></el-form-item>
            <el-form-item label="核心功能" class="full"><el-input v-model="ledgerForm.functions" type="textarea" :rows="2" /></el-form-item><el-form-item label="用户价值" class="full"><el-input v-model="ledgerForm.customerValues" type="textarea" :rows="2" /></el-form-item>
            <el-form-item label="目标人群"><el-input v-model="ledgerForm.audiences" /></el-form-item><el-form-item label="适用场景"><el-input v-model="ledgerForm.scenes" /></el-form-item>
            <el-form-item label="内容方向" class="full"><el-input v-model="ledgerForm.contentDirections" type="textarea" :rows="2" /></el-form-item><el-form-item label="SKU明细" class="full"><el-input v-model="ledgerForm.skus" placeholder="SKU编码用顿号或逗号分隔" /></el-form-item>
          </template>
          <template v-else-if="ledgerFormType === 'accounts'">
            <el-form-item label="平台" required><el-select v-model="ledgerForm.integrationKind" :disabled="Boolean(ledgerEditingId)" filterable><el-option v-for="item in integrations" :key="item.kind" :label="item.displayName" :value="item.kind" /></el-select></el-form-item><el-form-item label="账号名称" required><el-input v-model="ledgerForm.accountName" /></el-form-item>
            <el-form-item label="平台账号编号" required><el-input v-model="ledgerForm.externalAccountId" /></el-form-item><el-form-item label="区域"><el-select v-model="ledgerForm.region"><el-option label="中国" value="CN" /><el-option label="美国" value="US" /><el-option label="全球" value="GLOBAL" /></el-select></el-form-item>
            <el-form-item label="负责人"><el-select v-model="ledgerForm.ownerEmployeeId" clearable filterable><el-option v-for="item in ledger.employees" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item><el-form-item label="备注"><el-input v-model="ledgerForm.message" /></el-form-item>
          </template>
          <template v-else>
            <el-form-item label="所属账号" required><el-select v-model="ledgerForm.platformAccountId" filterable><el-option v-for="item in ledger.accounts" :key="item.id" :label="`${item.accountName} · ${item.integration?.displayName || item.region}`" :value="item.id" /></el-select></el-form-item><el-form-item label="店铺名称" required><el-input v-model="ledgerForm.name" /></el-form-item>
            <el-form-item label="平台店铺编号" required><el-input v-model="ledgerForm.externalStoreId" /></el-form-item><el-form-item label="区域"><el-select v-model="ledgerForm.region"><el-option label="中国" value="CN" /><el-option label="美国" value="US" /><el-option label="全球" value="GLOBAL" /></el-select></el-form-item>
            <el-form-item label="负责人"><el-select v-model="ledgerForm.ownerEmployeeId" clearable filterable><el-option v-for="item in ledger.employees" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item><el-form-item label="备注"><el-input v-model="ledgerForm.notes" /></el-form-item>
          </template>
        </el-form>
        <template #footer><el-button @click="ledgerDialog = false">取消</el-button><el-button v-if="!ledgerEditingId" @click="saveLedgerForm(true)">保存并继续新增</el-button><el-button type="primary" @click="saveLedgerForm(false)">保存</el-button></template>
      </el-dialog>
    </main>
  </div>
</template>
