<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, patch, post } from "../api";

type Row = Record<string, any>;

const loading = ref(false);
const tasks = ref<Row[]>([]);
const workspace = reactive<Row>({ roles: [], employees: [], templates: [], adminUsers: [], taskCounts: [] });
const activeStatus = ref("");
const taskDialog = ref(false);
const assignDialog = ref(false);
const reviewDialog = ref(false);
const roleDialog = ref(false);
const selectedTask = ref<Row>();
const taskForm = reactive({
  title: "",
  description: "",
  category: "VIDEO",
  priority: "MEDIUM",
  requiredRoleCode: "VIDEO_SPECIALIST",
  assigneeEmployeeId: "",
  dueAt: "",
  expectedResult: "",
  taskTemplateId: "",
});
const assignForm = reactive({ employeeId: "", dueAt: "" });
const reviewForm = reactive({ action: "APPROVE", note: "" });
const roleForm = reactive({ code: "", name: "", portal: "WORKBENCH", dataScope: "SELF", permissions: "" });
const employeeRoleDialog = ref(false);
const selectedEmployee = ref<Row>();
const selectedRoleCodes = ref<string[]>([]);

const employeeRoles = computed(() => workspace.roles.filter((item: Row) => item.portal === "WORKBENCH"));
const taskCount = computed(() => workspace.taskCounts.reduce((total: number, item: Row) => total + item._count._all, 0));

const statusLabels: Record<string, string> = {
  OPEN: "待领取",
  ACCEPTED: "待开始",
  IN_PROGRESS: "执行中",
  REVIEW: "待审核",
  RETURNED: "需修改",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};
const roleLabels: Record<string, string> = {
  CONTENT_OPERATOR: "运营",
  VIDEO_SPECIALIST: "视频专员",
  ASSET_CURATOR: "知识素材整理员",
  DESIGNER: "设计",
  CUSTOMER_SERVICE: "客服",
  LIVE_HOST: "主播",
};

function time(value?: string) {
  if (!value) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function statusType(value: string) {
  if (value === "COMPLETED") return "success";
  if (value === "REVIEW") return "warning";
  if (value === "RETURNED") return "danger";
  if (value === "IN_PROGRESS") return "primary";
  return "info";
}

async function reload() {
  loading.value = true;
  try {
    const query = activeStatus.value ? `?status=${activeStatus.value}` : "";
    const [workspaceResult, taskResult] = await Promise.all([
      api<Row>("/api/v1/admin/workspace"),
      api<Row[]>(`/api/v1/admin/tasks${query}`),
    ]);
    Object.assign(workspace, workspaceResult);
    tasks.value = taskResult;
  } finally {
    loading.value = false;
  }
}

function openTaskDialog() {
  Object.assign(taskForm, {
    title: "",
    description: "",
    category: "VIDEO",
    priority: "MEDIUM",
    requiredRoleCode: "VIDEO_SPECIALIST",
    assigneeEmployeeId: "",
    dueAt: "",
    expectedResult: "",
    taskTemplateId: "",
  });
  taskDialog.value = true;
}

function applyTemplate(id: string) {
  const template = workspace.templates.find((item: Row) => item.id === id);
  if (!template) return;
  taskForm.title = template.name;
  taskForm.description = template.description || "";
  taskForm.category = template.category;
  taskForm.priority = template.defaultPriority;
  taskForm.requiredRoleCode = template.requiredRoleCode;
  const due = new Date(Date.now() + template.defaultDueHours * 60 * 60 * 1000);
  taskForm.dueAt = due.toISOString().slice(0, 16);
}

async function createTask() {
  if (!taskForm.title.trim()) {
    ElMessage.warning("请填写任务标题");
    return;
  }
  await post("/api/v1/admin/tasks", taskForm);
  taskDialog.value = false;
  ElMessage.success("任务已创建");
  await reload();
}

function openAssign(task: Row) {
  selectedTask.value = task;
  assignForm.employeeId = task.assigneeEmployeeId || "";
  assignForm.dueAt = task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 16) : "";
  assignDialog.value = true;
}

async function assignTask() {
  if (!selectedTask.value || !assignForm.employeeId) {
    ElMessage.warning("请选择执行员工");
    return;
  }
  await patch(`/api/v1/admin/tasks/${selectedTask.value.id}/assign`, assignForm);
  assignDialog.value = false;
  ElMessage.success("任务已分配");
  await reload();
}

function openReview(task: Row) {
  selectedTask.value = task;
  reviewForm.action = "APPROVE";
  reviewForm.note = "";
  reviewDialog.value = true;
}

async function reviewTask() {
  if (!selectedTask.value) return;
  if (reviewForm.action === "RETURN" && !reviewForm.note.trim()) {
    ElMessage.warning("请填写退回修改要求");
    return;
  }
  await post(`/api/v1/admin/tasks/${selectedTask.value.id}/review`, reviewForm);
  reviewDialog.value = false;
  ElMessage.success(reviewForm.action === "APPROVE" ? "任务已通过" : "任务已退回");
  await reload();
}

function openRole() {
  Object.assign(roleForm, { code: "", name: "", portal: "WORKBENCH", dataScope: "SELF", permissions: "" });
  roleDialog.value = true;
}

async function saveRole() {
  await post("/api/v1/admin/roles", {
    ...roleForm,
    permissions: roleForm.permissions.split(/[，,、\s]+/u).filter(Boolean),
  });
  roleDialog.value = false;
  ElMessage.success("角色已保存");
  await reload();
}

function openEmployeeRoles(employee: Row) {
  selectedEmployee.value = employee;
  selectedRoleCodes.value = (employee.roles || []).map((item: Row) => item.role.code);
  employeeRoleDialog.value = true;
}

async function saveEmployeeRoles() {
  if (!selectedEmployee.value) return;
  await patch(`/api/v1/admin/employees/${selectedEmployee.value.id}/roles`, { roleCodes: selectedRoleCodes.value });
  employeeRoleDialog.value = false;
  ElMessage.success("员工岗位权限已更新");
  await reload();
}

defineExpose({ reload });
onMounted(() => void reload());
</script>

<template>
  <section class="task-command" v-loading="loading">
    <div class="command-hero">
      <div>
        <p>OPERATIONS COMMAND</p>
        <h2>任务指挥台</h2>
        <span>系统建议、爆款仿拍、内容制作、知识整理、客服与直播工作统一分配和验收。</span>
      </div>
      <div class="hero-actions">
        <el-button type="primary" size="large" @click="openTaskDialog">创建任务</el-button>
        <el-button size="large" @click="openRole">新增角色</el-button>
      </div>
    </div>

    <div class="summary-grid">
      <article><span>全部任务</span><strong>{{ taskCount }}</strong></article>
      <article><span>待领取</span><strong>{{ workspace.taskCounts.find((i: Row) => i.status === 'OPEN')?._count._all || 0 }}</strong></article>
      <article><span>执行中</span><strong>{{ (workspace.taskCounts.find((i: Row) => i.status === 'IN_PROGRESS')?._count._all || 0) + (workspace.taskCounts.find((i: Row) => i.status === 'ACCEPTED')?._count._all || 0) }}</strong></article>
      <article><span>待审核</span><strong>{{ workspace.taskCounts.find((i: Row) => i.status === 'REVIEW')?._count._all || 0 }}</strong></article>
      <article class="danger"><span>需修改</span><strong>{{ workspace.taskCounts.find((i: Row) => i.status === 'RETURNED')?._count._all || 0 }}</strong></article>
    </div>

    <el-tabs class="command-tabs">
      <el-tab-pane label="任务管理">
        <div class="filter-row">
          <el-radio-group v-model="activeStatus" @change="reload">
            <el-radio-button label="">全部</el-radio-button>
            <el-radio-button v-for="(label, key) in statusLabels" :key="key" :label="key">{{ label }}</el-radio-button>
          </el-radio-group>
          <el-button @click="reload">刷新</el-button>
        </div>
        <el-table :data="tasks" stripe>
          <el-table-column prop="taskNo" label="任务编号" width="190" />
          <el-table-column label="任务" min-width="280">
            <template #default="{ row }">
              <strong>{{ row.title }}</strong>
              <small class="cell-note">{{ row.description || row.expectedResult || '未填写说明' }}</small>
            </template>
          </el-table-column>
          <el-table-column label="岗位" width="150"><template #default="{ row }">{{ roleLabels[row.requiredRoleCode] || row.requiredRoleCode || "通用" }}</template></el-table-column>
          <el-table-column label="执行人" width="130"><template #default="{ row }">{{ row.assignee?.name || row.owner || "待领取" }}</template></el-table-column>
          <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabels[row.status] || row.status }}</el-tag></template></el-table-column>
          <el-table-column label="截止" width="150"><template #default="{ row }">{{ time(row.dueAt) }}</template></el-table-column>
          <el-table-column label="最近成果" min-width="220"><template #default="{ row }">{{ row.submissions?.[0]?.summary || row.result || "未提交" }}</template></el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openAssign(row)">分配</el-button>
              <el-button v-if="row.status === 'REVIEW'" link type="warning" @click="openReview(row)">审核</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="员工岗位">
        <el-table :data="workspace.employees" stripe>
          <el-table-column prop="name" label="员工" width="150" />
          <el-table-column label="部门" width="170"><template #default="{ row }">{{ row.department?.name || "未分配" }}</template></el-table-column>
          <el-table-column prop="role" label="原岗位" width="160" />
          <el-table-column label="员工端角色" min-width="360">
            <template #default="{ row }">
              <el-tag v-for="item in row.roles" :key="item.role.id" class="role-tag">{{ item.role.name }}</el-tag>
              <span v-if="!row.roles?.length">待分配</span>
            </template>
          </el-table-column>
          <el-table-column prop="wecomUserId" label="企业微信身份" min-width="190"><template #default="{ row }">{{ row.wecomUserId || "未配置" }}</template></el-table-column>
          <el-table-column label="操作" width="120"><template #default="{ row }"><el-button link type="primary" @click="openEmployeeRoles(row)">设置岗位</el-button></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="角色权限">
        <el-table :data="workspace.roles" stripe>
          <el-table-column prop="name" label="角色" width="170" />
          <el-table-column prop="code" label="编码" width="190" />
          <el-table-column prop="portal" label="使用端" width="130" />
          <el-table-column prop="dataScope" label="数据范围" width="130" />
          <el-table-column label="权限" min-width="420"><template #default="{ row }">{{ row.permissions.join("、") || "无" }}</template></el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="任务模板">
        <el-table :data="workspace.templates" stripe>
          <el-table-column prop="name" label="模板" min-width="220" />
          <el-table-column prop="category" label="分类" width="140" />
          <el-table-column label="岗位" width="170"><template #default="{ row }">{{ roleLabels[row.requiredRoleCode] || row.requiredRoleCode }}</template></el-table-column>
          <el-table-column label="检查项" min-width="360"><template #default="{ row }">{{ row.checklist.join(" → ") }}</template></el-table-column>
          <el-table-column prop="defaultDueHours" label="默认时限(小时)" width="140" />
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </section>

  <el-dialog v-model="taskDialog" title="创建任务" width="min(720px, 92vw)">
    <el-form label-position="top" class="two-column-form">
      <el-form-item label="从模板创建"><el-select v-model="taskForm.taskTemplateId" clearable @change="applyTemplate"><el-option v-for="item in workspace.templates" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
      <el-form-item label="任务标题" required><el-input v-model="taskForm.title" /></el-form-item>
      <el-form-item label="任务分类"><el-input v-model="taskForm.category" /></el-form-item>
      <el-form-item label="执行岗位"><el-select v-model="taskForm.requiredRoleCode" clearable><el-option v-for="role in employeeRoles" :key="role.code" :label="role.name" :value="role.code" /></el-select></el-form-item>
      <el-form-item label="直接分配员工"><el-select v-model="taskForm.assigneeEmployeeId" clearable filterable><el-option v-for="employee in workspace.employees" :key="employee.id" :label="employee.name" :value="employee.id" /></el-select></el-form-item>
      <el-form-item label="优先级"><el-select v-model="taskForm.priority"><el-option label="紧急" value="URGENT" /><el-option label="高" value="HIGH" /><el-option label="普通" value="MEDIUM" /><el-option label="低" value="LOW" /></el-select></el-form-item>
      <el-form-item label="截止时间"><el-date-picker v-model="taskForm.dueAt" type="datetime" value-format="YYYY-MM-DDTHH:mm" /></el-form-item>
      <el-form-item label="任务说明" class="full"><el-input v-model="taskForm.description" type="textarea" :rows="4" /></el-form-item>
      <el-form-item label="验收结果" class="full"><el-input v-model="taskForm.expectedResult" type="textarea" :rows="3" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="taskDialog = false">取消</el-button><el-button type="primary" @click="createTask">创建并通知</el-button></template>
  </el-dialog>

  <el-dialog v-model="assignDialog" title="分配任务" width="480px">
    <el-form label-position="top">
      <el-form-item label="执行员工"><el-select v-model="assignForm.employeeId" filterable><el-option v-for="employee in workspace.employees" :key="employee.id" :label="`${employee.name} · ${employee.role}`" :value="employee.id" /></el-select></el-form-item>
      <el-form-item label="截止时间"><el-date-picker v-model="assignForm.dueAt" type="datetime" value-format="YYYY-MM-DDTHH:mm" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="assignDialog = false">取消</el-button><el-button type="primary" @click="assignTask">确认分配</el-button></template>
  </el-dialog>

  <el-dialog v-model="reviewDialog" title="审核任务成果" width="560px">
    <el-alert v-if="selectedTask?.submissions?.[0]" :title="selectedTask.submissions[0].summary" type="info" :closable="false" />
    <el-form label-position="top" class="review-form">
      <el-form-item label="审核结果"><el-radio-group v-model="reviewForm.action"><el-radio-button label="APPROVE">通过完成</el-radio-button><el-radio-button label="RETURN">退回修改</el-radio-button></el-radio-group></el-form-item>
      <el-form-item label="审核说明"><el-input v-model="reviewForm.note" type="textarea" :rows="4" :placeholder="reviewForm.action === 'RETURN' ? '必须填写具体修改要求' : '可填写验收说明'" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="reviewDialog = false">取消</el-button><el-button type="primary" @click="reviewTask">确认审核</el-button></template>
  </el-dialog>

  <el-dialog v-model="roleDialog" title="新增或更新角色" width="560px">
    <el-form label-position="top">
      <el-form-item label="角色编码" required><el-input v-model="roleForm.code" placeholder="例如 PRODUCT_OPERATOR" /></el-form-item>
      <el-form-item label="角色名称" required><el-input v-model="roleForm.name" /></el-form-item>
      <el-form-item label="使用端"><el-select v-model="roleForm.portal"><el-option label="员工端" value="WORKBENCH" /><el-option label="管理后台" value="ADMIN" /></el-select></el-form-item>
      <el-form-item label="数据范围"><el-select v-model="roleForm.dataScope"><el-option label="本人" value="SELF" /><el-option label="本部门" value="DEPARTMENT" /><el-option label="全部" value="ALL" /></el-select></el-form-item>
      <el-form-item label="权限编码"><el-input v-model="roleForm.permissions" type="textarea" :rows="3" placeholder="多个权限以逗号分隔" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="roleDialog = false">取消</el-button><el-button type="primary" @click="saveRole">保存</el-button></template>
  </el-dialog>

  <el-dialog v-model="employeeRoleDialog" :title="`设置 ${selectedEmployee?.name || ''} 的岗位`" width="560px">
    <el-checkbox-group v-model="selectedRoleCodes" class="role-options">
      <el-checkbox v-for="role in employeeRoles" :key="role.code" :label="role.code" border>{{ role.name }}</el-checkbox>
    </el-checkbox-group>
    <template #footer><el-button @click="employeeRoleDialog = false">取消</el-button><el-button type="primary" @click="saveEmployeeRoles">保存岗位</el-button></template>
  </el-dialog>
</template>

<style scoped>
.task-command { display: grid; gap: 18px; }
.command-hero { display: flex; align-items: end; justify-content: space-between; gap: 24px; padding: 32px; border-radius: 24px; color: #f8faf9; background: radial-gradient(circle at 85% 10%, #db6b5d55, transparent 30%), linear-gradient(135deg, #183b3a, #17211f); }
.command-hero p { margin: 0 0 8px; color: #f19b8a; font-size: 12px; font-weight: 800; letter-spacing: .18em; }
.command-hero h2 { margin: 0 0 8px; font-size: 34px; }
.command-hero span { color: #cbd6d3; }
.summary-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.summary-grid article { padding: 18px 20px; border: 1px solid #ebe6dd; border-radius: 18px; background: #fff; }
.summary-grid span, .summary-grid strong { display: block; }
.summary-grid span { color: #7d8582; }
.summary-grid strong { margin-top: 7px; font-size: 30px; }
.summary-grid .danger strong { color: #b52b26; }
.command-tabs { padding: 20px; border: 1px solid #ebe6dd; border-radius: 20px; background: #fff; }
.filter-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; overflow-x: auto; }
.cell-note { display: block; margin-top: 5px; color: #8a918e; font-weight: 400; }
.role-tag { margin: 3px 6px 3px 0; }
.two-column-form { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
.two-column-form .full { grid-column: 1 / -1; }
.review-form { margin-top: 18px; }
.role-options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.role-options .el-checkbox { margin: 0; }
@media (max-width: 760px) {
  .command-hero { display: block; padding: 24px; }
  .hero-actions { margin-top: 18px; }
  .summary-grid { grid-template-columns: 1fr 1fr; }
  .two-column-form { display: block; }
  .role-options { grid-template-columns: 1fr; }
}
</style>
