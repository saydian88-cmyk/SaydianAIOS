<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { DataAnalysis, Refresh, UploadFilled } from "@element-plus/icons-vue";
import { api, patch, post } from "../api";

type Row = Record<string, any>;

const loading = ref(false);
const activeTab = ref("overview");
const overview = ref<Row>({ metrics: {}, stores: [], findingCounts: {} });
const products = ref<Row>({ snapshots: [], products: [] });
const stores = ref<Row[]>([]);
const competitors = ref<Row>({ watchlist: [], snapshots: [] });
const findings = ref<Row[]>([]);
const tasks = ref<Row[]>([]);
const runs = ref<Row[]>([]);
const importDialog = ref(false);
const importForm = ref({ sourceName: "", periodStart: "", periodEnd: "", fileName: "", content: "", format: "CSV" });

const activeTasks = computed(() => tasks.value.filter((item) => item.status !== "DONE"));
const completedTasks = computed(() => tasks.value.filter((item) => item.status === "DONE"));

const statusNames: Record<string, string> = {
  PENDING_CONFIRMATION: "待确认", PENDING_ASSIGNMENT: "待分派", OPEN: "待处理", ASSIGNED: "已分派",
  IN_PROGRESS: "执行中", PENDING_VERIFICATION: "待验收", DONE: "已完成", REOPENED: "重新打开",
  CONFIRMED: "已转任务", RESOLVED: "已解决", SUCCEEDED: "成功", PARTIAL: "部分成功", FAILED: "失败",
};
const platformNames: Record<string, string> = { TMALL: "天猫", JD: "京东", DOUYIN: "抖音" };

function statusName(value?: string) {
  return statusNames[value || ""] || value || "未获取";
}

function statusType(value?: string) {
  if (["DONE", "RESOLVED", "SUCCEEDED"].includes(value || "")) return "success";
  if (["P0", "FAILED", "REOPENED"].includes(value || "")) return "danger";
  if (["P1", "PARTIAL", "PENDING_VERIFICATION", "PENDING_CONFIRMATION"].includes(value || "")) return "warning";
  return "info";
}

function money(value?: number | null) {
  if (value === null || value === undefined) return "未获取";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value);
}

function percent(value?: number | null) {
  return value === null || value === undefined ? "未获取" : `${(value * 100).toFixed(1)}%`;
}

function dateTime(value?: string) {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未记录" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(date);
}

async function reload() {
  loading.value = true;
  try {
    [overview.value, products.value, stores.value, competitors.value, findings.value, tasks.value, runs.value] = await Promise.all([
      api<Row>("/api/v1/operation-analysis/overview"),
      api<Row>("/api/v1/operation-analysis/products"),
      api<Row[]>("/api/v1/operation-analysis/stores"),
      api<Row>("/api/v1/operation-analysis/competitors"),
      api<Row[]>("/api/v1/operation-analysis/findings"),
      api<Row[]>("/api/v1/operation-analysis/tasks"),
      api<Row[]>("/api/v1/operation-analysis/runs"),
    ]);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "运营分析加载失败");
  } finally {
    loading.value = false;
  }
}

async function runAnalysis() {
  loading.value = true;
  try {
    const result = await post<Row>("/api/v1/operation-analysis/runs", {});
    ElMessage.success(`分析完成，识别${result.findings?.length || 0}项问题`);
    await reload();
  } finally {
    loading.value = false;
  }
}

function openImport() {
  importForm.value = {
    sourceName: `聚水潭经营报表-${new Date().toISOString().slice(0, 10)}`,
    periodStart: "", periodEnd: "", fileName: "", content: "", format: "CSV",
  };
  importDialog.value = true;
}

async function selectFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".csv") && !lower.endsWith(".json")) {
    ElMessage.warning("后台直接接收CSV/JSON；Excel由办公电脑采集器自动转换");
    return;
  }
  importForm.value.fileName = file.name;
  importForm.value.sourceName = file.name;
  importForm.value.format = lower.endsWith(".json") ? "JSON" : "CSV";
  importForm.value.content = await file.text();
}

async function submitImport() {
  if (!importForm.value.content) return ElMessage.warning("请选择报表文件");
  loading.value = true;
  try {
    const payload: Row = {
      sourceName: importForm.value.sourceName,
      format: importForm.value.format,
      periodStart: importForm.value.periodStart || undefined,
      periodEnd: importForm.value.periodEnd || undefined,
    };
    if (importForm.value.format === "JSON") payload.records = JSON.parse(importForm.value.content);
    else payload.csv = importForm.value.content;
    const result = await post<Row>("/api/v1/operation-analysis/imports", payload);
    ElMessage.success(result.duplicate ? "同一报表已存在，未重复导入" : `已导入${result.run?.importedCount || 0}条记录`);
    importDialog.value = false;
    await reload();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "导入失败");
  } finally {
    loading.value = false;
  }
}

async function confirmFinding(item: Row) {
  const { value: owner } = await ElMessageBox.prompt("填写正式负责人；可先填岗位名称", "确认问题并生成任务", {
    inputValue: item.storeName?.includes("天猫") ? "天猫运营" : item.storeName?.includes("抖") ? "抖音运营" : "京东运营",
    confirmButtonText: "确认生成", cancelButtonText: "取消",
  });
  await post(`/api/v1/operation-analysis/findings/${item.id}/confirm`, { owner });
  ElMessage.success("已生成正式整改任务");
  await reload();
  activeTab.value = "tasks";
}

async function assignTask(item: Row) {
  const { value: owner } = await ElMessageBox.prompt("填写负责人姓名或岗位", "确认并分派任务", {
    inputValue: item.owner || "", confirmButtonText: "确认分派", cancelButtonText: "取消",
  });
  await patch(`/api/v1/operation-analysis/tasks/${item.id}`, { owner, status: "ASSIGNED", note: "人工确认并分派" });
  ElMessage.success("任务已分派");
  await reload();
}

async function startTask(item: Row) {
  await patch(`/api/v1/operation-analysis/tasks/${item.id}`, { status: "IN_PROGRESS", note: "开始执行" });
  ElMessage.success("任务已开始");
  await reload();
}

async function submitTask(item: Row) {
  const { value: result } = await ElMessageBox.prompt("填写完成动作和结果", "提交验收", {
    inputPlaceholder: "已完成哪些动作，数据有什么变化", confirmButtonText: "提交", cancelButtonText: "取消",
    inputType: "textarea",
  });
  await post(`/api/v1/operation-analysis/tasks/${item.id}/submit`, { result });
  ElMessage.success("已提交验收");
  await reload();
}

async function verifyTask(item: Row, passed: boolean) {
  const { value: note } = await ElMessageBox.prompt(passed ? "填写验收通过结论" : "填写不通过原因和返工要求", passed ? "通过验收" : "退回重做", {
    confirmButtonText: passed ? "确认通过" : "确认退回", cancelButtonText: "取消", inputType: "textarea",
  });
  await post(`/api/v1/operation-analysis/tasks/${item.id}/verify`, { passed, note });
  ElMessage.success(passed ? "任务已完成" : "任务已重新打开");
  await reload();
}

defineExpose({ reload });
onMounted(reload);
</script>

<template>
  <section class="operation-analysis" v-loading="loading">
    <div class="analysis-heading">
      <div>
        <span>OPERATION INTELLIGENCE</span>
        <h2>三平台运营分析</h2>
        <p>聚水潭经营数据、天猫/京东/抖音店铺和竞品问题统一进入任务闭环。</p>
      </div>
      <div class="heading-actions">
        <el-button :icon="UploadFilled" @click="openImport">导入聚水潭报表</el-button>
        <el-button :icon="DataAnalysis" type="primary" @click="runAnalysis">立即分析</el-button>
        <el-button :icon="Refresh" circle @click="reload" />
      </div>
    </div>

    <el-segmented v-model="activeTab" :options="[
      { label: '经营总览', value: 'overview' },
      { label: '产品分析', value: 'products' },
      { label: '店铺分析', value: 'stores' },
      { label: '竞品分析', value: 'competitors' },
      { label: `问题池 ${findings.filter(i => i.status === 'PENDING_CONFIRMATION').length}`, value: 'findings' },
      { label: `任务跟踪 ${activeTasks.length}`, value: 'tasks' },
      { label: '复盘档案', value: 'archives' },
    ]" />

    <template v-if="activeTab === 'overview'">
      <div class="metric-grid">
        <article><small>本期销售额</small><strong>{{ money(overview.metrics?.salesAmount) }}</strong><span>三平台自有店铺</span></article>
        <article><small>净销售额</small><strong>{{ money(overview.metrics?.netSalesAmount) }}</strong><span>退款后统计口径</span></article>
        <article><small>销售订单</small><strong>{{ overview.metrics?.salesOrders || 0 }}</strong><span>客单价 {{ money(overview.metrics?.averageOrderValue) }}</span></article>
        <article><small>待确认/待办</small><strong>{{ overview.metrics?.openTasks || 0 }}</strong><span>逾期 {{ overview.metrics?.overdueTasks || 0 }}</span></article>
      </div>
      <div class="analysis-note">
        <div><strong>当前利润口径：{{ overview.profitLabel }}</strong><p>广告费、平台佣金和税费未补齐时，不显示为净利润。</p></div>
        <div><strong>最新数据：{{ overview.latestRun?.sourceName || '未导入' }}</strong><p>{{ dateTime(overview.latestRun?.periodEnd) }} · 完整率 {{ percent(overview.latestRun?.completeness) }}</p></div>
      </div>
      <div class="analysis-table">
        <el-table :data="overview.stores" stripe>
          <el-table-column label="平台" width="85"><template #default="{ row }">{{ platformNames[row.platform] || row.platform }}</template></el-table-column>
          <el-table-column prop="storeName" label="店铺" min-width="210" />
          <el-table-column label="销售额" width="130"><template #default="{ row }">{{ money(row.salesAmount) }}</template></el-table-column>
          <el-table-column prop="salesOrders" label="订单" width="80" />
          <el-table-column label="退款率" width="95"><template #default="{ row }"><el-tag :type="row.refundRate > .12 ? 'danger' : row.refundRate > .08 ? 'warning' : 'success'">{{ percent(row.refundRate) }}</el-tag></template></el-table-column>
          <el-table-column label="优惠率" width="95"><template #default="{ row }">{{ percent(row.discountRate) }}</template></el-table-column>
          <el-table-column label="基础贡献" width="105"><template #default="{ row }">{{ percent(row.basicContribution) }}</template></el-table-column>
          <el-table-column label="完整利润" width="105"><template #default="{ row }">{{ percent(row.fullContribution) }}</template></el-table-column>
          <el-table-column label="数据来源" min-width="220"><template #default="{ row }">{{ row.sourceRef }}</template></el-table-column>
        </el-table>
      </div>
    </template>

    <div v-else-if="activeTab === 'products'" class="analysis-table">
      <el-table :data="products.snapshots.length ? products.snapshots : products.products" stripe height="620">
        <el-table-column prop="modelCode" label="标准型号" width="130" />
        <el-table-column label="产品/SKU" min-width="220"><template #default="{ row }">{{ row.name || row.skuCode || '未映射' }}</template></el-table-column>
        <el-table-column label="平台/店铺" min-width="200"><template #default="{ row }">{{ platformNames[row.platform] || row.platform || '待映射' }} / {{ row.storeName || '待映射' }}</template></el-table-column>
        <el-table-column label="销售额" width="125"><template #default="{ row }">{{ money(row.salesAmount) }}</template></el-table-column>
        <el-table-column label="退款率" width="95"><template #default="{ row }">{{ percent(row.refundRate) }}</template></el-table-column>
        <el-table-column label="基础贡献" width="105"><template #default="{ row }">{{ percent(row.basicContribution) }}</template></el-table-column>
        <el-table-column label="库存覆盖" width="105"><template #default="{ row }">{{ row.inventoryCoverDays == null ? '未获取' : `${row.inventoryCoverDays}天` }}</template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }">{{ row.status || '待补经营数据' }}</template></el-table-column>
      </el-table>
    </div>

    <div v-else-if="activeTab === 'stores'" class="analysis-table">
      <el-table :data="stores" stripe height="620">
        <el-table-column label="周期" width="165"><template #default="{ row }">{{ dateTime(row.periodStart) }}<br />至 {{ dateTime(row.periodEnd) }}</template></el-table-column>
        <el-table-column label="平台" width="85"><template #default="{ row }">{{ platformNames[row.platform] }}</template></el-table-column>
        <el-table-column prop="storeName" label="店铺" min-width="210" />
        <el-table-column label="销售额" width="125"><template #default="{ row }">{{ money(row.salesAmount) }}</template></el-table-column>
        <el-table-column prop="salesOrders" label="订单" width="80" />
        <el-table-column label="客单价" width="115"><template #default="{ row }">{{ money(row.averageOrderValue) }}</template></el-table-column>
        <el-table-column label="退款率" width="95"><template #default="{ row }">{{ percent(row.refundRate) }}</template></el-table-column>
        <el-table-column label="优惠率" width="95"><template #default="{ row }">{{ percent(row.discountRate) }}</template></el-table-column>
        <el-table-column label="基础贡献" width="105"><template #default="{ row }">{{ percent(row.basicContribution) }}</template></el-table-column>
        <el-table-column label="完整率" width="90"><template #default="{ row }">{{ percent(row.dataCompleteness) }}</template></el-table-column>
      </el-table>
    </div>

    <div v-else-if="activeTab === 'competitors'" class="competitor-grid">
      <article v-for="item in competitors.watchlist" :key="item.id">
        <div><el-tag>{{ platformNames[item.platform] }}</el-tag><strong>{{ item.name }}</strong></div>
        <p>{{ item.watchUrl || '观察链接待补充' }}</p>
        <small>公开快照 {{ competitors.snapshots.filter((snapshot: Row) => snapshot.platform === item.platform && snapshot.competitorName === item.name).length }} 条</small>
      </article>
      <el-empty v-if="!competitors.watchlist.length" description="竞品观察名单未建立" />
    </div>

    <div v-else-if="activeTab === 'findings'" class="analysis-table">
      <el-table :data="findings" stripe height="620">
        <el-table-column label="级别" width="80"><template #default="{ row }"><el-tag :type="statusType(row.severity)">{{ row.severity }}</el-tag></template></el-table-column>
        <el-table-column prop="title" label="问题" min-width="240" />
        <el-table-column prop="description" label="数据判断" min-width="300" />
        <el-table-column label="来源" min-width="210"><template #default="{ row }">{{ row.sourceRefs?.join('、') || '未获取' }}</template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }">{{ statusName(row.status) }}</template></el-table-column>
        <el-table-column label="操作" width="115" fixed="right"><template #default="{ row }"><el-button v-if="row.status === 'PENDING_CONFIRMATION'" type="primary" link @click="confirmFinding(row)">确认生成任务</el-button><span v-else>已进入闭环</span></template></el-table-column>
      </el-table>
    </div>

    <div v-else-if="activeTab === 'tasks'" class="analysis-table">
      <el-table :data="activeTasks" stripe height="620">
        <el-table-column prop="taskNo" label="任务编号" width="155" />
        <el-table-column label="级别" width="75"><template #default="{ row }"><el-tag :type="statusType(row.priority)">{{ row.priority }}</el-tag></template></el-table-column>
        <el-table-column prop="title" label="任务" min-width="250" />
        <el-table-column prop="owner" label="负责人" width="120"><template #default="{ row }">{{ row.owner || '待分配' }}</template></el-table-column>
        <el-table-column label="截止" width="135"><template #default="{ row }">{{ dateTime(row.dueAt) }}</template></el-table-column>
        <el-table-column label="状态" width="105"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusName(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="验收标准" min-width="230"><template #default="{ row }">{{ row.expectedResult || '待补充' }}</template></el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button v-if="['PENDING_CONFIRMATION','PENDING_ASSIGNMENT'].includes(row.status)" type="primary" link @click="assignTask(row)">确认分派</el-button>
            <el-button v-else-if="['ASSIGNED','OPEN','REOPENED'].includes(row.status)" type="primary" link @click="startTask(row)">开始执行</el-button>
            <el-button v-else-if="row.status === 'IN_PROGRESS'" type="primary" link @click="submitTask(row)">提交验收</el-button>
            <template v-else-if="row.status === 'PENDING_VERIFICATION'">
              <el-button type="success" link @click="verifyTask(row, true)">通过</el-button>
              <el-button type="danger" link @click="verifyTask(row, false)">退回</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-else class="archive-grid">
      <section>
        <h3>已完成任务</h3>
        <el-table :data="completedTasks" stripe height="500">
          <el-table-column prop="taskNo" label="编号" width="150" />
          <el-table-column prop="title" label="任务" min-width="240" />
          <el-table-column prop="owner" label="负责人" width="110" />
          <el-table-column label="结果" min-width="220"><template #default="{ row }">{{ row.result || '未记录' }}</template></el-table-column>
          <el-table-column label="完成时间" width="150"><template #default="{ row }">{{ dateTime(row.completedAt) }}</template></el-table-column>
        </el-table>
      </section>
      <section>
        <h3>分析批次</h3>
        <el-table :data="runs" stripe height="500">
          <el-table-column prop="runNo" label="批次" min-width="170" />
          <el-table-column prop="sourceName" label="来源" min-width="230" />
          <el-table-column prop="importedCount" label="记录" width="70" />
          <el-table-column label="完整率" width="90"><template #default="{ row }">{{ percent(row.completeness) }}</template></el-table-column>
          <el-table-column label="状态" width="90"><template #default="{ row }">{{ statusName(row.status) }}</template></el-table-column>
        </el-table>
      </section>
    </div>

    <el-dialog v-model="importDialog" title="导入聚水潭经营报表" width="560px">
      <el-form label-position="top">
        <el-form-item label="数据文件"><input class="file-input" type="file" accept=".csv,.json" @change="selectFile" /><small>{{ importForm.fileName || '支持CSV/JSON；办公电脑采集器负责Excel自动转换' }}</small></el-form-item>
        <el-form-item label="来源名称"><el-input v-model="importForm.sourceName" /></el-form-item>
        <div class="date-row">
          <el-form-item label="周期开始"><el-date-picker v-model="importForm.periodStart" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="周期结束"><el-date-picker v-model="importForm.periodEnd" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        </div>
      </el-form>
      <template #footer><el-button @click="importDialog = false">取消</el-button><el-button type="primary" @click="submitImport">导入并分析</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.operation-analysis{display:grid;gap:20px}.analysis-heading{display:flex;justify-content:space-between;gap:20px;align-items:flex-end}.analysis-heading span{font-size:12px;letter-spacing:.18em;color:#c92d2d;font-weight:800}.analysis-heading h2{margin:7px 0 6px;font-size:27px}.analysis-heading p{margin:0;color:#6f7681}.heading-actions{display:flex;gap:10px;flex-wrap:wrap}.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.metric-grid article{padding:20px;background:#fff;border:1px solid #ebe6df;border-radius:16px;display:grid;gap:8px}.metric-grid small,.metric-grid span{color:#7b818b}.metric-grid strong{font-size:27px;color:#18222f}.analysis-note{display:grid;grid-template-columns:1fr 1fr;gap:14px}.analysis-note>div{padding:18px 20px;border-radius:14px;background:#f3f6fa;border:1px solid #e5eaf0}.analysis-note p{margin:7px 0 0;color:#727985}.analysis-table{background:#fff;border:1px solid #ece7df;border-radius:16px;overflow:hidden;padding:4px}.competitor-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.competitor-grid article{background:#fff;border:1px solid #ebe6df;border-radius:14px;padding:18px}.competitor-grid article>div{display:flex;gap:10px;align-items:center}.competitor-grid p{color:#808692}.competitor-grid small{color:#9a846d}.archive-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.archive-grid section{background:#fff;border:1px solid #ebe6df;border-radius:16px;padding:16px}.archive-grid h3{margin:0 0 14px}.file-input{display:block;width:100%;padding:12px;border:1px dashed #b9c1cc;border-radius:10px;margin-bottom:8px}.date-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:1000px){.metric-grid{grid-template-columns:repeat(2,1fr)}.analysis-heading{align-items:flex-start;flex-direction:column}.competitor-grid{grid-template-columns:repeat(2,1fr)}.archive-grid{grid-template-columns:1fr}}@media(max-width:650px){.metric-grid,.analysis-note,.competitor-grid,.date-row{grid-template-columns:1fr}}
</style>
