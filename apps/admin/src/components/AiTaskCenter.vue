<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, patch, post } from "../api";

type Row = Record<string, any>;

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
  ["policies", "定时策略"],
  ["runners", "执行节点"],
  ["cost", "模型与成本"],
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
const detail = ref<Row>();
const detailVisible = ref(false);
const createVisible = ref(false);
const runnerVisible = ref(false);
const runnerToken = ref("");
const reviewVisible = ref(false);
const reviewAction = ref<"APPROVE" | "RETURN">("APPROVE");
const reviewNote = ref("");
const filters = reactive({ type: "", platform: "", keyword: "" });
const form = reactive<Row>({
  type: "VIDEO",
  title: "",
  platform: "DOUYIN",
  productModel: "",
  instructions: "",
  ownerEmployeeId: "",
  reviewerEmployeeId: "",
  estimatedCost: 0,
  budgetLimit: 0,
  autoExecute: true,
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
  const selected = tasks.value.filter((task) => {
    if (filters.type && task.type !== filters.type) return false;
    if (filters.platform && task.platform !== filters.platform) return false;
    if (filters.keyword && !`${task.taskNo} ${task.title}`.toLowerCase().includes(filters.keyword.toLowerCase())) return false;
    return true;
  });
  if (activeTab.value === "pending") return selected.filter((task) => pendingStatuses.includes(task.status));
  if (activeTab.value === "running") return selected.filter((task) => runningStatuses.includes(task.status));
  if (activeTab.value === "review") return selected.filter((task) => task.status === "PENDING_REVIEW");
  if (activeTab.value === "completed") return selected.filter((task) => task.status === "COMPLETED");
  if (activeTab.value === "failed") return selected.filter((task) => ["FAILED", "CANCELLED"].includes(task.status));
  return selected.slice(0, 12);
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

function statusLabel(value: string) {
  const labels: Row = {
    PENDING: "待处理", WAITING_CONFIRMATION: "待确认", CLAIMED: "已领取", RUNNING: "处理中",
    WAITING_INPUT: "等待输入", QUALITY_CHECK: "自动质检", UPLOADING: "上传中", PENDING_REVIEW: "待审核",
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

function time(value?: string) {
  return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "未记录";
}

async function load() {
  loading.value = true;
  try {
    const [summary, taskRows, policyRows, runnerRows, ledger, wecomStatus] = await Promise.all([
      api<Row>("/api/v1/ai-tasks/overview"),
      api<Row[]>("/api/v1/ai-tasks"),
      api<Row[]>("/api/v1/ai-tasks/policies"),
      api<Row[]>("/api/v1/ai-tasks/runners"),
      api<Row>("/api/v1/ledger"),
      api<Row>("/api/v1/ai-tasks/notifications/wecom"),
    ]);
    overview.value = summary;
    tasks.value = taskRows;
    policies.value = policyRows.map((row) => ({ ...row }));
    runners.value = runnerRows;
    employees.value = ledger.employees || [];
    Object.assign(wecom, wecomStatus, { appSecret: "" });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "AI任务中心加载失败");
  } finally {
    loading.value = false;
  }
}

async function createTask() {
  try {
    await post("/api/v1/ai-tasks", {
      ...form,
      ownerEmployeeId: form.ownerEmployeeId || undefined,
      reviewerEmployeeId: form.reviewerEmployeeId || undefined,
      productModel: form.productModel || undefined,
      estimatedCost: Number(form.estimatedCost || 0),
      budgetLimit: Number(form.budgetLimit || 0),
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
  try {
    const result = await api<Row>(`/api/v1/ai-tasks/outputs/${output.id}/url`);
    window.open(result.url, "_blank", "noopener,noreferrer");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "文件暂不可下载");
  }
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
      <el-button type="primary" @click="createVisible = true">创建AI任务</el-button>
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
        <el-table-column label="类型" width="110"><template #default="{ row }">{{ typeLabel(row.type) }}</template></el-table-column>
        <el-table-column prop="title" label="任务" min-width="220" show-overflow-tooltip />
        <el-table-column prop="platform" label="平台" width="100" />
        <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="进度" width="150">
          <template #default="{ row }"><el-progress :percentage="row.progress || 0" :stroke-width="8" /></template>
        </el-table-column>
        <el-table-column label="负责人" width="120"><template #default="{ row }">{{ row.owner?.name || "未指定" }}</template></el-table-column>
        <el-table-column label="创建时间" width="150"><template #default="{ row }">{{ time(row.createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="290" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="showDetail(row)">详情</el-button>
            <el-button v-if="['PENDING','WAITING_CONFIRMATION','WAITING_INPUT','RETURNED'].includes(row.status)" link type="primary" @click="action(row, 'start')">运行</el-button>
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
          <el-form-item label="产品型号"><el-input v-model="form.productModel" placeholder="可选" /></el-form-item>
          <el-form-item label="负责人"><el-select v-model="form.ownerEmployeeId" clearable><el-option v-for="item in employees" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
        </div>
        <el-form-item label="任务要求"><el-input v-model="form.instructions" type="textarea" :rows="4" /></el-form-item>
        <div class="form-grid">
          <el-form-item label="预计费用"><el-input-number v-model="form.estimatedCost" :min="0" :precision="2" /></el-form-item>
          <el-form-item label="单任务预算上限"><el-input-number v-model="form.budgetLimit" :min="0" :precision="2" /></el-form-item>
        </div>
        <el-form-item><el-checkbox v-model="form.autoExecute">预算及模型可用时自动执行</el-checkbox></el-form-item>
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

    <el-drawer v-model="detailVisible" title="AI任务详情" size="58%">
      <template v-if="detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="任务编号">{{ detail.taskNo }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ statusLabel(detail.status) }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ typeLabel(detail.type) }}</el-descriptions-item>
          <el-descriptions-item label="费用">预计 ¥{{ Number(detail.estimatedCost || 0).toFixed(2) }} / 实际 ¥{{ Number(detail.actualCost || 0).toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="进度" :span="2">{{ detail.progress || 0 }}% · {{ detail.progressMessage || "未开始" }}</el-descriptions-item>
          <el-descriptions-item label="任务要求" :span="2">{{ detail.instructions || "按输入数据自动执行" }}</el-descriptions-item>
          <el-descriptions-item label="缺失输入" :span="2">{{ (detail.missingInputs || []).join("、") || "无" }}</el-descriptions-item>
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
            第 {{ item.attemptNo }} 次 · {{ item.status }} · {{ item.model || "Codex" }}<div v-if="item.errorMessage" class="error-text">{{ item.errorMessage }}</div>
          </el-timeline-item>
        </el-timeline>

        <h3>结果与文件</h3>
        <el-empty v-if="!(detail.outputs || []).length" description="尚无输出" />
        <div v-for="output in detail.outputs || []" :key="output.id" class="output-row">
          <div><strong>{{ output.title }}</strong><span>{{ output.kind }} · {{ output.reviewStatus }}</span></div>
          <el-button v-if="output.assetId || output.url" link type="primary" @click="openOutput(output)">预览/下载</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.ai-task-center{display:grid;gap:18px}.page-head,.section-head,.output-row{display:flex;align-items:center;justify-content:space-between;gap:16px}.page-head h2,.section-head h3,.config-card h3{margin:0}.page-head p,.config-card p{margin:6px 0 0;color:#64748b}.summary-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}.summary-card{padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;display:grid;gap:8px}.summary-card span{font-size:13px;color:#64748b}.summary-card strong{font-size:24px;color:#0f172a}.summary-card strong.compact{font-size:18px}.filters{display:grid;grid-template-columns:180px 180px minmax(220px,1fr) auto;gap:12px;margin-bottom:14px}.settings-grid{display:grid;gap:16px}.settings-actions{text-align:right}.token-box{font-family:Consolas,monospace;word-break:break-all;padding:8px 0;font-weight:700}.config-card{display:grid;grid-template-columns:1fr 1.5fr;gap:30px;border:1px solid #e2e8f0;border-radius:12px;padding:20px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.output-row{border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin:8px 0}.output-row div{display:grid;gap:4px}.output-row span{font-size:12px;color:#64748b}h3{margin:24px 0 12px}pre{max-height:320px;overflow:auto;white-space:pre-wrap;background:#f8fafc;padding:12px;border-radius:8px}.error-text{color:#dc2626;margin-top:6px}@media(max-width:1200px){.summary-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:760px){.summary-grid,.form-grid,.config-card{grid-template-columns:1fr}.filters{grid-template-columns:1fr}}
</style>
