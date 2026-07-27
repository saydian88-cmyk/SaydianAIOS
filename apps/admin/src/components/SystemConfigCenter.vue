<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { Connection, Plus, Refresh, Setting, UploadFilled } from "@element-plus/icons-vue";
import { api, patch, post } from "../api";

type Row = Record<string, any>;

const loading = ref(false);
const activeTab = ref("overview");
const overview = ref<Row>({});
const groups = ref<Row>({
  integrations: [], providers: [], models: [], routing: [], policies: [], runners: [],
  notification: {}, bootstrap: [], logs: [],
});
const integrationVisible = ref(false);
const providerVisible = ref(false);
const runnerVisible = ref(false);
const importVisible = ref(false);
const importToken = ref("");
const importEntries = ref<Row[]>([]);
const importOverwrite = ref(false);
const runnerToken = ref("");
const integrationForm = reactive({
  kind: "",
  displayName: "",
  region: "CN",
  publicConfigText: "{}",
  secretsText: "",
});
const providerForm = reactive<Row>({
  id: "", code: "", displayName: "", region: "GLOBAL", baseUrl: "", apiKey: "",
  webhookSecret: "", maxConcurrency: 2, dailyBudget: "", priority: 100, enabled: false,
  capabilities: [],
});
const runnerForm = reactive<Row>({
  nodeCode: "windows-codex-01",
  displayName: "Windows Codex执行器",
  capabilities: ["VIDEO", "IMAGE", "ARTICLE", "STORE_ANALYSIS", "COMPETITOR_ANALYSIS", "LIVE_ANALYSIS"],
});
const wecom = reactive<Row>({ corpId: "", agentId: "", appSecret: "", secretConfigured: false });

const tabs = [
  ["overview", "配置总览"],
  ["integrations", "平台与业务接口"],
  ["ai", "AI与媒体能力"],
  ["storage", "存储与媒体处理"],
  ["notifications", "通知配置"],
  ["policies", "AI任务策略"],
  ["runners", "执行节点"],
  ["logs", "配置日志"],
];

const storageIntegrations = computed(() =>
  (groups.value.integrations || []).filter((item: Row) =>
    ["ALIYUN_OSS", "LOCAL_ASSET", "WECOM_DRIVE", "HELP_CENTER", "EVIDENCE_WORKBOOK"].includes(item.kind),
  ),
);
const businessIntegrations = computed(() =>
  (groups.value.integrations || []).filter((item: Row) =>
    !["ALIYUN_OSS", "LOCAL_ASSET", "WECOM_DRIVE", "HELP_CENTER", "EVIDENCE_WORKBOOK"].includes(item.kind),
  ),
);

function stateLabel(value?: string) {
  return {
    HEALTHY: "正常", CONFIGURED: "待验证", DEGRADED: "部分可用", ERROR: "异常", UNCONFIGURED: "未配置",
    ONLINE: "在线", OFFLINE: "离线", BUSY: "执行中",
  }[String(value || "")] || String(value || "未配置");
}

function stateType(value?: string) {
  if (["HEALTHY", "ONLINE"].includes(String(value))) return "success";
  if (["ERROR", "OFFLINE"].includes(String(value))) return "danger";
  if (["CONFIGURED", "DEGRADED", "BUSY"].includes(String(value))) return "warning";
  return "info";
}

function time(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

async function reload() {
  loading.value = true;
  try {
    const [summary, configGroups] = await Promise.all([
      api<Row>("/api/v1/system-config/overview"),
      api<Row>("/api/v1/system-config/groups"),
    ]);
    overview.value = summary;
    groups.value = configGroups;
    Object.assign(wecom, {
      corpId: configGroups.notification?.corpId || "",
      agentId: configGroups.notification?.agentId || "",
      appSecret: "",
      secretConfigured: Boolean(configGroups.notification?.secretConfigured),
    });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "系统配置加载失败");
  } finally {
    loading.value = false;
  }
}

function openIntegration(item: Row) {
  Object.assign(integrationForm, {
    kind: item.kind,
    displayName: item.displayName,
    region: item.region || "CN",
    publicConfigText: JSON.stringify(item.publicConfig || {}, null, 2),
    secretsText: "",
  });
  integrationVisible.value = true;
}

function nestedSecrets(text: string) {
  const result: Row = {};
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || !line.includes("=")) continue;
    const [path, ...rest] = line.split("=");
    const value = rest.join("=").trim();
    if (!path.trim() || !value) continue;
    const parts = path.trim().split(".");
    let target = result;
    for (const part of parts.slice(0, -1)) target = target[part] ||= {};
    target[parts.at(-1)!] = value;
  }
  return result;
}

async function saveIntegration() {
  try {
    const publicConfig = JSON.parse(integrationForm.publicConfigText || "{}");
    await patch(`/api/v1/system-config/integrations/${integrationForm.kind}`, {
      displayName: integrationForm.displayName,
      region: integrationForm.region,
      publicConfig,
      secrets: nestedSecrets(integrationForm.secretsText),
    });
    integrationVisible.value = false;
    await reload();
    ElMessage.success("接口配置已保存");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "配置保存失败");
  }
}

async function checkIntegration(item: Row) {
  try {
    await post(`/api/v1/system-config/integrations/${item.kind}/check`, {});
    await reload();
    ElMessage.success("连接检查已完成");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "连接检查失败");
  }
}

function openProvider(item?: Row) {
  Object.assign(providerForm, {
    id: item?.id || "",
    code: item?.code || "",
    displayName: item?.displayName || "",
    region: item?.region || "GLOBAL",
    baseUrl: item?.baseUrl || "",
    apiKey: "",
    webhookSecret: "",
    maxConcurrency: item?.maxConcurrency || 2,
    dailyBudget: item?.dailyBudget ?? "",
    priority: item?.priority || 100,
    enabled: Boolean(item?.enabled),
    capabilities: item?.capabilities || [],
  });
  providerVisible.value = true;
}

async function saveProvider() {
  try {
    const body = {
      ...providerForm,
      secret: {
        ...(providerForm.apiKey ? { apiKey: providerForm.apiKey } : {}),
        ...(providerForm.webhookSecret ? { webhookSecret: providerForm.webhookSecret } : {}),
      },
      publicConfig: {},
    };
    if (providerForm.id) await patch(`/api/v1/video-factory/providers/${providerForm.id}`, body);
    else await post("/api/v1/video-factory/providers", body);
    providerVisible.value = false;
    await reload();
    ElMessage.success("AI服务商已保存");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "AI服务商保存失败");
  }
}

async function toggleModel(item: Row) {
  try {
    await patch(`/api/v1/video-factory/models/${item.id}`, {
      providerId: item.providerId,
      code: item.code,
      displayName: item.displayName,
      capabilities: item.capabilities,
      supportedRatios: item.supportedRatios,
      supportedDurations: item.supportedDurations,
      supportedResolutions: item.supportedResolutions,
      scenarioTags: item.scenarioTags,
      costConfig: item.costConfig,
      modelConfig: item.modelConfig,
      priority: item.priority,
      enabled: item.enabled,
    });
    ElMessage.success("模型状态已保存");
  } catch (error) {
    item.enabled = !item.enabled;
    ElMessage.error(error instanceof Error ? error.message : "模型状态保存失败");
  }
}

async function savePolicies() {
  try {
    await api("/api/v1/system-config/ai-policy", {
      method: "PUT",
      body: JSON.stringify({ policies: groups.value.policies || [] }),
    });
    await reload();
    ElMessage.success("AI任务策略已保存");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "策略保存失败");
  }
}

async function saveWecom() {
  try {
    await api("/api/v1/system-config/notifications/wecom", {
      method: "PUT",
      body: JSON.stringify({
        corpId: wecom.corpId,
        agentId: wecom.agentId,
        appSecret: wecom.appSecret || undefined,
      }),
    });
    await reload();
    ElMessage.success("通知配置已保存");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "通知配置保存失败");
  }
}

async function createRunner() {
  try {
    const result = await post<Row>("/api/v1/ai-tasks/runners", runnerForm);
    runnerToken.value = result.token || "";
    runnerVisible.value = false;
    await reload();
    ElMessage.success("执行节点已创建，请立即保存一次性Token");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "执行节点创建失败");
  }
}

async function previewImport(file: File) {
  try {
    const result = await post<Row>("/api/v1/system-config/import/preview", { text: await file.text() });
    importToken.value = result.importToken;
    importEntries.value = result.entries || [];
    importVisible.value = true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "配置文件识别失败");
  }
  return false;
}

async function applyImport() {
  try {
    const result = await post<Row>("/api/v1/system-config/import/apply", {
      importToken: importToken.value,
      overwrite: importOverwrite.value,
    });
    importVisible.value = false;
    await reload();
    ElMessage.success(`已导入${result.applied || 0}项，保留${result.skipped || 0}项`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "配置导入失败");
  }
}

onMounted(reload);
defineExpose({ reload });
</script>

<template>
  <section class="system-config" v-loading="loading">
    <div class="page-head">
      <div>
        <span class="eyebrow">SYSTEM CONFIGURATION</span>
        <h2>系统配置</h2>
        <p>接口、AI能力、存储、通知、任务策略和执行节点在此统一管理。</p>
      </div>
      <div class="head-actions">
        <el-upload :show-file-list="false" accept=".txt" :before-upload="previewImport">
          <el-button :icon="UploadFilled">导入配置</el-button>
        </el-upload>
        <el-button :icon="Refresh" @click="reload">刷新</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab">
      <el-tab-pane v-for="[value, label] in tabs" :key="value" :name="value" :label="label" />
    </el-tabs>

    <template v-if="activeTab === 'overview'">
      <div class="summary-grid">
        <article><span>平台接口</span><strong>{{ overview.integrations?.healthy || 0 }}/{{ overview.integrations?.total || 0 }}</strong><small>异常 {{ overview.integrations?.error || 0 }} · 未配置 {{ overview.integrations?.unconfigured || 0 }}</small></article>
        <article><span>AI服务商</span><strong>{{ overview.aiProviders?.healthy || 0 }}/{{ overview.aiProviders?.total || 0 }}</strong><small>待验证 {{ overview.aiProviders?.configured || 0 }}</small></article>
        <article><span>自动策略</span><strong>{{ overview.policies?.autoExecute || 0 }}</strong><small>已启用 {{ overview.policies?.enabled || 0 }}</small></article>
        <article><span>执行节点</span><strong>{{ overview.runners?.online || 0 }}/{{ overview.runners?.total || 0 }}</strong><small>Windows Codex节点</small></article>
        <article><span>企微通知</span><strong class="compact">{{ overview.notification?.configured ? "已配置" : "未配置" }}</strong><small>{{ overview.notification?.message }}</small></article>
      </div>
      <div class="config-card">
        <div><el-icon><Setting /></el-icon><div><strong>启动级配置</strong><p>数据库和加密根密钥仅显示状态，不在网页回传。</p></div></div>
        <el-table :data="groups.bootstrap || []" size="small">
          <el-table-column prop="name" label="配置" min-width="180" />
          <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.configured ? 'success' : 'danger'">{{ row.configured ? "已配置" : "未配置" }}</el-tag></template></el-table-column>
          <el-table-column prop="value" label="公开值" min-width="260"><template #default="{ row }">{{ row.value || "不回传" }}</template></el-table-column>
        </el-table>
      </div>
    </template>

    <template v-else-if="activeTab === 'integrations' || activeTab === 'storage'">
      <div class="integration-grid">
        <article v-for="item in activeTab === 'storage' ? storageIntegrations : businessIntegrations" :key="item.id">
          <div class="integration-icon"><el-icon><Connection /></el-icon></div>
          <div class="integration-copy">
            <div><h3>{{ item.displayName }}</h3><el-tag :type="stateType(item.state)">{{ stateLabel(item.state) }}</el-tag></div>
            <p>{{ item.message }}</p>
            <small>公开配置 {{ Object.keys(item.publicConfig || {}).length }}项 · 密钥 {{ item.secretKeys?.length || 0 }}项</small>
            <div class="row-actions"><el-button link type="primary" @click="openIntegration(item)">配置</el-button><el-button link @click="checkIntegration(item)">检查</el-button></div>
          </div>
        </article>
      </div>
    </template>

    <template v-else-if="activeTab === 'ai'">
      <div class="section-head"><div><h3>AI与媒体服务商</h3><p>Codex为默认执行器；视觉模型仅在任务明确允许时调用。</p></div><el-button type="primary" :icon="Plus" @click="openProvider()">新增服务商</el-button></div>
      <el-table :data="groups.providers || []" stripe>
        <el-table-column prop="displayName" label="服务商" min-width="180" />
        <el-table-column prop="region" label="地区" width="90" />
        <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="stateType(row.state)">{{ stateLabel(row.state) }}</el-tag></template></el-table-column>
        <el-table-column label="密钥" width="100"><template #default="{ row }">{{ row.secretConfigured ? "已配置" : "未配置" }}</template></el-table-column>
        <el-table-column prop="maxConcurrency" label="并发" width="80" />
        <el-table-column label="预算" width="120"><template #default="{ row }">{{ row.dailyBudget ?? "未限制" }}</template></el-table-column>
        <el-table-column label="操作" width="120"><template #default="{ row }"><el-button link type="primary" @click="openProvider(row)">配置</el-button></template></el-table-column>
      </el-table>
      <h3>模型目录</h3>
      <el-table :data="groups.models || []" stripe>
        <el-table-column label="模型" min-width="220"><template #default="{ row }">{{ row.provider?.displayName }} · {{ row.displayName }}</template></el-table-column>
        <el-table-column prop="capabilities" label="能力" min-width="260"><template #default="{ row }">{{ row.capabilities?.join("、") || "未配置" }}</template></el-table-column>
        <el-table-column prop="priority" label="优先级" width="90" />
        <el-table-column label="启用" width="100"><template #default="{ row }"><el-switch v-model="row.enabled" @change="toggleModel(row)" /></template></el-table-column>
      </el-table>
    </template>

    <template v-else-if="activeTab === 'notifications'">
      <div class="config-card">
        <div><h3>企业微信个人应用通知</h3><p>完成上传后通知负责人审核；留空Secret会保留原值。</p></div>
        <el-form label-position="top">
          <el-form-item label="Corp ID"><el-input v-model="wecom.corpId" /></el-form-item>
          <el-form-item label="Agent ID"><el-input v-model="wecom.agentId" /></el-form-item>
          <el-form-item :label="wecom.secretConfigured ? 'Secret（已配置，留空保持）' : 'Secret'"><el-input v-model="wecom.appSecret" type="password" show-password /></el-form-item>
          <el-button type="primary" @click="saveWecom">保存通知配置</el-button>
        </el-form>
      </div>
    </template>

    <template v-else-if="activeTab === 'policies'">
      <el-table :data="groups.policies || []" stripe>
        <el-table-column prop="type" label="任务类型" min-width="180" />
        <el-table-column label="启用" width="90"><template #default="{ row }"><el-switch v-model="row.enabled" /></template></el-table-column>
        <el-table-column label="自动执行" width="100"><template #default="{ row }"><el-switch v-model="row.autoExecute" /></template></el-table-column>
        <el-table-column label="每日预算" width="140"><template #default="{ row }"><el-input-number v-model="row.dailyBudget" :min="0" controls-position="right" /></template></el-table-column>
        <el-table-column label="并发" width="110"><template #default="{ row }"><el-input-number v-model="row.maxConcurrency" :min="1" :max="20" /></template></el-table-column>
        <el-table-column label="重试" width="110"><template #default="{ row }"><el-input-number v-model="row.maxAttempts" :min="1" :max="10" /></template></el-table-column>
        <el-table-column label="超时(秒)" width="150"><template #default="{ row }"><el-input-number v-model="row.timeoutSeconds" :min="60" /></template></el-table-column>
      </el-table>
      <div class="save-row"><el-button type="primary" @click="savePolicies">保存策略</el-button></div>
    </template>

    <template v-else-if="activeTab === 'runners'">
      <div class="section-head"><div><h3>Windows Codex执行节点</h3><p>节点常驻轮询，服务端按策略定时创建任务。</p></div><el-button type="primary" :icon="Plus" @click="runnerVisible = true">新增节点</el-button></div>
      <el-alert v-if="runnerToken" type="warning" :closable="false" title="一次性Runner Token"><template #default><div class="token-box">{{ runnerToken }}</div></template></el-alert>
      <el-table :data="groups.runners || []" stripe>
        <el-table-column prop="displayName" label="节点" min-width="180" />
        <el-table-column prop="nodeCode" label="编码" min-width="180" />
        <el-table-column prop="version" label="版本" width="100" />
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.online ? 'success' : 'danger'">{{ row.online ? "在线" : "离线" }}</el-tag></template></el-table-column>
        <el-table-column label="当前任务" min-width="180"><template #default="{ row }">{{ row.currentTaskId || "空闲" }}</template></el-table-column>
        <el-table-column label="最后心跳" width="170"><template #default="{ row }">{{ time(row.lastHeartbeatAt) }}</template></el-table-column>
      </el-table>
    </template>

    <template v-else>
      <el-table :data="groups.logs || []" stripe>
        <el-table-column prop="actor" label="操作人" width="130" />
        <el-table-column prop="action" label="操作" min-width="240" />
        <el-table-column prop="entityType" label="对象" width="160" />
        <el-table-column label="时间" width="180"><template #default="{ row }">{{ time(row.createdAt) }}</template></el-table-column>
      </el-table>
    </template>

    <el-dialog v-model="integrationVisible" :title="`${integrationForm.displayName}配置`" width="760px">
      <el-form label-position="top">
        <el-form-item label="名称"><el-input v-model="integrationForm.displayName" /></el-form-item>
        <el-form-item label="区域"><el-input v-model="integrationForm.region" /></el-form-item>
        <el-form-item label="公开配置(JSON)"><el-input v-model="integrationForm.publicConfigText" type="textarea" :rows="8" /></el-form-item>
        <el-form-item label="密钥（每行 key=value；留空保留原值）"><el-input v-model="integrationForm.secretsText" type="textarea" :rows="5" placeholder="credentials.apiKey=..." /></el-form-item>
      </el-form>
      <template #footer><el-button @click="integrationVisible = false">取消</el-button><el-button type="primary" @click="saveIntegration">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="providerVisible" title="AI与媒体服务商" width="720px">
      <el-form label-position="top" class="form-grid">
        <el-form-item label="代码"><el-input v-model="providerForm.code" :disabled="Boolean(providerForm.id)" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="providerForm.displayName" /></el-form-item>
        <el-form-item label="地区"><el-input v-model="providerForm.region" /></el-form-item>
        <el-form-item label="API地址"><el-input v-model="providerForm.baseUrl" /></el-form-item>
        <el-form-item label="API密钥"><el-input v-model="providerForm.apiKey" type="password" show-password placeholder="留空保留原值" /></el-form-item>
        <el-form-item label="Webhook密钥"><el-input v-model="providerForm.webhookSecret" type="password" show-password placeholder="留空保留原值" /></el-form-item>
        <el-form-item label="最大并发"><el-input-number v-model="providerForm.maxConcurrency" :min="1" /></el-form-item>
        <el-form-item label="每日预算"><el-input v-model="providerForm.dailyBudget" placeholder="留空不限制" /></el-form-item>
        <el-form-item label="启用"><el-switch v-model="providerForm.enabled" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="providerVisible = false">取消</el-button><el-button type="primary" @click="saveProvider">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="runnerVisible" title="新增Codex执行节点" width="620px">
      <el-form label-position="top">
        <el-form-item label="节点编码"><el-input v-model="runnerForm.nodeCode" /></el-form-item>
        <el-form-item label="显示名称"><el-input v-model="runnerForm.displayName" /></el-form-item>
        <el-form-item label="任务能力"><el-checkbox-group v-model="runnerForm.capabilities"><el-checkbox v-for="item in ['VIDEO','IMAGE','ARTICLE','STORE_ANALYSIS','COMPETITOR_ANALYSIS','LIVE_ANALYSIS']" :key="item" :value="item">{{ item }}</el-checkbox></el-checkbox-group></el-form-item>
      </el-form>
      <template #footer><el-button @click="runnerVisible = false">取消</el-button><el-button type="primary" @click="createRunner">创建</el-button></template>
    </el-dialog>

    <el-dialog v-model="importVisible" title="配置文件导入预览" width="780px">
      <el-alert type="info" :closable="false" title="页面只显示配置项名称，不显示密钥内容；默认保留线上已有配置。" />
      <el-table :data="importEntries" height="420">
        <el-table-column prop="section" label="分组" width="150" />
        <el-table-column prop="label" label="配置项" min-width="200" />
        <el-table-column prop="integrationKind" label="目标接口" width="150"><template #default="{ row }">{{ row.integrationKind || "未识别" }}</template></el-table-column>
        <el-table-column prop="targetType" label="类型" width="110" />
        <el-table-column label="状态" width="90"><template #default="{ row }">{{ row.configured ? "已识别" : "空值" }}</template></el-table-column>
      </el-table>
      <el-checkbox v-model="importOverwrite">覆盖线上已有非空配置</el-checkbox>
      <template #footer><el-button @click="importVisible = false">取消</el-button><el-button type="primary" @click="applyImport">确认导入</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.system-config{display:grid;gap:18px}.page-head,.head-actions,.section-head,.row-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.page-head h2,.section-head h3,.integration-copy h3{margin:0}.page-head p,.section-head p,.integration-copy p,.config-card p{margin:6px 0 0;color:#64748b}.eyebrow{font-size:12px;letter-spacing:.14em;color:#ef4444}.summary-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.summary-grid article{display:grid;gap:7px;padding:18px;border:1px solid #e2e8f0;border-radius:14px;background:#fff}.summary-grid span,.summary-grid small{color:#64748b}.summary-grid strong{font-size:25px}.summary-grid strong.compact{font-size:18px}.config-card{display:grid;grid-template-columns:1fr 2fr;gap:24px;padding:20px;border:1px solid #e2e8f0;border-radius:14px;background:#fff}.config-card>div:first-child{display:flex;gap:12px}.integration-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.integration-grid article{display:flex;gap:14px;padding:18px;border:1px solid #e2e8f0;border-radius:14px;background:#fff}.integration-icon{display:grid;place-items:center;width:40px;height:40px;border-radius:10px;background:#eff6ff;color:#2563eb}.integration-copy{min-width:0;flex:1}.integration-copy>div:first-child{display:flex;align-items:center;justify-content:space-between;gap:8px}.integration-copy small{display:block;margin:10px 0;color:#64748b}.save-row{text-align:right;margin-top:14px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.token-box{padding:10px;font-family:Consolas,monospace;word-break:break-all}.head-actions{justify-content:flex-end}@media(max-width:1200px){.summary-grid{grid-template-columns:repeat(3,1fr)}.integration-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:760px){.summary-grid,.integration-grid,.config-card,.form-grid{grid-template-columns:1fr}.page-head,.section-head{align-items:flex-start;flex-direction:column}}
</style>
