import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";

type InputRow = Record<string, unknown>;

const ACTIVE_TASK_STATUSES = [
  "PENDING_CONFIRMATION", "PENDING_ASSIGNMENT", "OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_VERIFICATION", "REOPENED",
];

const PLATFORM_LABELS: Record<string, string> = { TMALL: "天猫", JD: "京东", DOUYIN: "抖音" };

const STORE_HEADER_MAP: Record<string, string[]> = {
  platform: ["platform", "平台", "渠道类型"],
  storeName: ["storeName", "店铺", "渠道名称", "店铺名称"],
  salesAmount: ["salesAmount", "销售金额"],
  salesOrders: ["salesOrders", "销售订单数"],
  salesItems: ["salesItems", "销售件数"],
  netSalesAmount: ["netSalesAmount", "净销售金额"],
  netOrders: ["netOrders", "净销售订单数"],
  netItems: ["netItems", "净销售件数"],
  discountAmount: ["discountAmount", "优惠金额"],
  productCost: ["productCost", "商品成本"],
  freightCost: ["freightCost", "运费成本"],
  refundCost: ["refundCost", "退款成本"],
  adSpend: ["adSpend", "广告费", "广告成本"],
  platformFees: ["platformFees", "平台扣点", "平台佣金"],
  taxCost: ["taxCost", "税费"],
  salesChangeRate: ["salesChangeRate", "销售变化率"],
  inventoryCoverDays: ["inventoryCoverDays", "库存覆盖天数"],
  dataCompleteness: ["dataCompleteness", "数据完整率"],
};

export function parseOperationCsv(csv: string): InputRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((value) => value.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function pick(row: InputRow, aliases: string[]) {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== "") return row[alias];
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const raw = String(value).replace(/[¥￥,\s]/g, "").trim();
  if (!raw || raw === "未获取" || raw === "-") return undefined;
  const percent = raw.endsWith("%");
  const parsed = Number(raw.replace("%", ""));
  if (!Number.isFinite(parsed)) return undefined;
  return percent ? parsed / 100 : parsed;
}

function integerValue(value: unknown) {
  const parsed = numberValue(value);
  return parsed === undefined ? undefined : Math.round(parsed);
}

function safeRatio(numerator?: number, denominator?: number) {
  return numerator === undefined || denominator === undefined || denominator === 0 ? undefined : numerator / denominator;
}

function normalizePlatform(value: unknown, storeName: string) {
  const raw = `${String(value ?? "")}${storeName}`.toLowerCase();
  if (raw.includes("京东") || raw.includes("jd")) return "JD";
  if (raw.includes("天猫") || raw.includes("tmall")) return "TMALL";
  if (raw.includes("抖") || raw.includes("douyin")) return "DOUYIN";
  return "";
}

function storeKey(platform: string, storeName: string) {
  return `${platform}-${createHash("sha1").update(storeName.trim()).digest("hex").slice(0, 12)}`;
}

function dateValue(value: unknown, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

@Injectable()
export class OperationAnalysisService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureInitialBaseline();
  }

  async overview() {
    const latest = await this.prisma.operationAnalysisRun.findFirst({ orderBy: { periodEnd: "desc" } });
    const stores = await this.latestStoreMetrics();
    const [findingCounts, openTasks, overdueTasks, completedThisWeek] = await Promise.all([
      this.prisma.operationFinding.groupBy({ by: ["severity"], where: { status: "PENDING_CONFIRMATION" }, _count: true }),
      this.prisma.opsTask.count({ where: { category: "运营分析", status: { in: ACTIVE_TASK_STATUSES } } }),
      this.prisma.opsTask.count({ where: { category: "运营分析", status: { in: ACTIVE_TASK_STATUSES }, dueAt: { lt: new Date() } } }),
      this.prisma.opsTask.count({
        where: {
          category: "运营分析", status: "DONE",
          completedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);
    const sum = (key: "salesAmount" | "netSalesAmount" | "salesOrders") => stores.reduce((total, row) => total + Number(row[key] ?? 0), 0);
    return {
      latestRun: latest,
      metrics: {
        salesAmount: sum("salesAmount"),
        netSalesAmount: sum("netSalesAmount"),
        salesOrders: sum("salesOrders"),
        averageOrderValue: safeRatio(sum("netSalesAmount"), sum("salesOrders")),
        openTasks,
        overdueTasks,
        completedThisWeek,
      },
      findingCounts: Object.fromEntries(findingCounts.map((item) => [item.severity, item._count])),
      stores,
      scope: ["TMALL", "JD", "DOUYIN"],
      profitLabel: stores.some((item) => item.fullContribution === null) ? "基础贡献" : "完整经营利润",
    };
  }

  async products(query: Record<string, string>) {
    const where = {
      ...(query.platform ? { platform: query.platform } : {}),
      ...(query.storeKey ? { storeKey: query.storeKey } : {}),
      ...(query.modelCode ? { modelCode: { contains: query.modelCode, mode: "insensitive" as const } } : {}),
    };
    const [snapshots, products] = await Promise.all([
      this.prisma.productMetricSnapshot.findMany({ where, orderBy: { periodEnd: "desc" }, take: 500 }),
      this.prisma.product.findMany({ include: { skus: true }, orderBy: { modelCode: "asc" } }),
    ]);
    return { snapshots, products };
  }

  latestStoreMetrics() {
    return this.prisma.storeMetricSnapshot.findMany({
      distinct: ["platform", "storeKey"],
      orderBy: [{ platform: "asc" }, { storeKey: "asc" }, { periodEnd: "desc" }],
    });
  }

  stores() {
    return this.prisma.storeMetricSnapshot.findMany({ orderBy: [{ periodEnd: "desc" }, { salesAmount: "desc" }], take: 500 });
  }

  async competitors() {
    const [watchlist, snapshots] = await Promise.all([
      this.prisma.competitor.findMany({
        where: { platform: { in: ["TMALL", "JD", "DOUYIN"] } },
        orderBy: [{ platform: "asc" }, { name: "asc" }],
      }),
      this.prisma.competitorProductSnapshot.findMany({ orderBy: { capturedAt: "desc" }, take: 300 }),
    ]);
    return { watchlist, snapshots };
  }

  findings() {
    return this.prisma.operationFinding.findMany({
      orderBy: [{ status: "asc" }, { severity: "asc" }, { lastFoundAt: "desc" }],
      take: 500,
    });
  }

  tasks() {
    return this.prisma.opsTask.findMany({
      where: { category: "运营分析" },
      include: { history: { orderBy: { createdAt: "desc" } } },
      orderBy: [{ status: "asc" }, { priority: "asc" }, { dueAt: "asc" }],
      take: 500,
    });
  }

  analysisRuns() {
    return this.prisma.operationAnalysisRun.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  }

  async importData(body: Record<string, unknown>, actor: string) {
    const sourceName = String(body.sourceName ?? "聚水潭经营报表").trim();
    const format = String(body.format ?? (body.csv ? "CSV" : "JSON")).toUpperCase();
    const records = body.csv ? parseOperationCsv(String(body.csv)) : Array.isArray(body.records) ? body.records as InputRow[] : [];
    if (!records.length) throw new BadRequestException("导入内容为空");
    const rawForHash = body.csv ? String(body.csv) : JSON.stringify(records);
    const fileHash = createHash("sha256").update(`${sourceName}:${rawForHash}`).digest("hex");
    const existing = await this.prisma.operationAnalysisRun.findUnique({ where: { fileHash } });
    if (existing) return { duplicate: true, run: existing, message: "同一报表已导入，未重复生成数据" };

    const now = new Date();
    const periodStart = dateValue(body.periodStart, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
    const periodEnd = dateValue(body.periodEnd, now);
    const runNo = `RUN-${periodEnd.toISOString().slice(0, 10).replace(/-/g, "")}-${fileHash.slice(0, 8).toUpperCase()}`;
    const normalized = records.map((row) => this.normalizeStoreRow(row, periodStart, periodEnd, sourceName));
    const accepted = normalized.filter((row): row is NonNullable<typeof row> => Boolean(row));
    const rejected = records.length - accepted.length;
    const completeness = accepted.length ? accepted.reduce((total, row) => total + row.dataCompleteness, 0) / accepted.length : 0;

    const run = await this.prisma.operationAnalysisRun.create({
      data: {
        runNo, periodStart, periodEnd, source: String(body.source ?? "JUSHUITAN_EXPORT"), sourceName,
        fileHash, status: accepted.length ? (rejected ? "PARTIAL" : "SUCCEEDED") : "FAILED",
        importedCount: accepted.length, rejectedCount: rejected, completeness, createdBy: actor,
        errors: json(rejected ? [`${rejected}条记录缺少可识别的三平台店铺`] : []), completedAt: new Date(),
        storeMetrics: { create: accepted },
      },
      include: { storeMetrics: true },
    });
    await this.applyRules(run.storeMetrics);
    await this.audit(actor, "OPERATION_IMPORT", "OperationAnalysisRun", run.id, { sourceName, format, accepted: accepted.length, rejected });
    return { duplicate: false, run };
  }

  async runAnalysis(body: Record<string, unknown>, actor: string) {
    const runId = body.runId ? String(body.runId) : undefined;
    const snapshots = await this.prisma.storeMetricSnapshot.findMany({
      where: runId ? { runId } : {},
      orderBy: { periodEnd: "desc" },
      take: runId ? 500 : 50,
    });
    const findings = await this.applyRules(snapshots);
    await this.audit(actor, "OPERATION_ANALYSIS_RUN", "OperationAnalysisRun", runId ?? "LATEST", { snapshots: snapshots.length, findings: findings.length });
    return { snapshots: snapshots.length, findings };
  }

  async confirmFinding(id: string, body: Record<string, unknown>, actor: string) {
    const finding = await this.prisma.operationFinding.findUnique({ where: { id } });
    if (!finding) throw new NotFoundException("问题不存在");
    if (finding.taskId) {
      const task = await this.prisma.opsTask.findUnique({ where: { id: finding.taskId }, include: { history: true } });
      return { finding, task, duplicate: true };
    }
    const taskNo = `OPS-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${finding.findingNo.slice(-4)}`;
    const owner = String(body.owner ?? "").trim() || null;
    const task = await this.prisma.opsTask.create({
      data: {
        taskNo, findingId: finding.id, title: finding.title, description: finding.description,
        category: "运营分析", priority: finding.severity === "P0" ? "P0" : "P1",
        status: owner ? "ASSIGNED" : "PENDING_ASSIGNMENT", owner,
        platform: finding.platform, storeKey: finding.storeKey, storeName: finding.storeName,
        productId: finding.productId, skuCode: finding.skuCode, metricKey: finding.metricKey,
        currentValue: finding.currentValue, targetValue: numberValue(body.targetValue),
        expectedResult: String(body.expectedResult ?? (finding.suggestion as InputRow)?.expectedResult ?? "").trim() || null,
        evidence: finding.evidence as Prisma.InputJsonValue,
        dueAt: body.dueAt ? new Date(String(body.dueAt)) : new Date(Date.now() + (finding.severity === "P0" ? 2 : 5) * 24 * 60 * 60 * 1000),
        history: { create: { fromStatus: "PENDING_CONFIRMATION", toStatus: owner ? "ASSIGNED" : "PENDING_ASSIGNMENT", action: "CONFIRM", actor } },
      },
      include: { history: true },
    });
    await this.prisma.operationFinding.update({
      where: { id },
      data: { status: "CONFIRMED", taskId: task.id, confirmedAt: new Date(), confirmedBy: actor },
    });
    return { finding, task, duplicate: false };
  }

  async updateTask(id: string, body: Record<string, unknown>, actor: string) {
    const before = await this.prisma.opsTask.findUnique({ where: { id } });
    if (!before || before.category !== "运营分析") throw new NotFoundException("运营分析任务不存在");
    const status = body.status ? String(body.status) : before.status;
    const task = await this.prisma.opsTask.update({
      where: { id },
      data: {
        ...(body.owner !== undefined ? { owner: String(body.owner || "").trim() || null } : {}),
        ...(body.assigneeEmployeeId !== undefined ? { assigneeEmployeeId: String(body.assigneeEmployeeId || "") || null } : {}),
        ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(String(body.dueAt)) : null } : {}),
        ...(body.targetValue !== undefined ? { targetValue: numberValue(body.targetValue) ?? null } : {}),
        ...(body.expectedResult !== undefined ? { expectedResult: String(body.expectedResult || "") || null } : {}),
        status,
        ...(status === "REOPENED" ? { reopenedAt: new Date() } : {}),
        history: { create: { fromStatus: before.status, toStatus: status, action: "UPDATE", actor, note: String(body.note ?? "") || null, data: json(body) } },
      },
      include: { history: { orderBy: { createdAt: "desc" } } },
    });
    return task;
  }

  async submitTask(id: string, body: Record<string, unknown>, actor: string) {
    const before = await this.taskOrThrow(id);
    const result = String(body.result ?? "").trim();
    if (!result) throw new BadRequestException("请填写执行结果");
    return this.prisma.opsTask.update({
      where: { id },
      data: {
        status: "PENDING_VERIFICATION", result, submittedAt: new Date(),
        evidence: json(body.evidence ?? before.evidence),
        history: { create: { fromStatus: before.status, toStatus: "PENDING_VERIFICATION", action: "SUBMIT", actor, note: result } },
      },
      include: { history: { orderBy: { createdAt: "desc" } } },
    });
  }

  async verifyTask(id: string, body: Record<string, unknown>, actor: string) {
    const before = await this.taskOrThrow(id);
    const passed = body.passed === true;
    const note = String(body.note ?? "").trim();
    if (!note) throw new BadRequestException("请填写验收结论");
    const status = passed ? "DONE" : "REOPENED";
    const task = await this.prisma.opsTask.update({
      where: { id },
      data: {
        status, verifier: actor, verifiedAt: new Date(), verification: json({ passed, note }),
        ...(passed ? { completedAt: new Date(), completedBy: actor } : { reopenedAt: new Date(), completedAt: null, completedBy: null }),
        history: { create: { fromStatus: before.status, toStatus: status, action: "VERIFY", actor, note, data: json({ passed }) } },
      },
      include: { history: { orderBy: { createdAt: "desc" } } },
    });
    if (passed && task.findingId) {
      await this.prisma.operationFinding.update({ where: { id: task.findingId }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    }
    return task;
  }

  private async taskOrThrow(id: string) {
    const task = await this.prisma.opsTask.findUnique({ where: { id } });
    if (!task || task.category !== "运营分析") throw new NotFoundException("运营分析任务不存在");
    return task;
  }

  private normalizeStoreRow(row: InputRow, periodStart: Date, periodEnd: Date, sourceRef: string) {
    const get = (key: keyof typeof STORE_HEADER_MAP) => pick(row, STORE_HEADER_MAP[key]);
    const storeName = String(get("storeName") ?? "").trim();
    const platform = normalizePlatform(get("platform"), storeName);
    if (!storeName || !platform) return null;
    const salesAmount = numberValue(get("salesAmount"));
    const salesOrders = integerValue(get("salesOrders"));
    const netSalesAmount = numberValue(get("netSalesAmount"));
    const discountAmount = numberValue(get("discountAmount"));
    const productCost = numberValue(get("productCost"));
    const freightCost = numberValue(get("freightCost"));
    const refundCost = numberValue(get("refundCost"));
    const adSpend = numberValue(get("adSpend"));
    const platformFees = numberValue(get("platformFees"));
    const taxCost = numberValue(get("taxCost"));
    const baseInputs = [salesAmount, salesOrders, netSalesAmount, discountAmount, productCost, freightCost, refundCost];
    const calculatedCompleteness = baseInputs.filter((value) => value !== undefined).length / baseInputs.length;
    const dataCompleteness = numberValue(get("dataCompleteness")) ?? calculatedCompleteness;
    const unavailableFields = [
      ...(adSpend === undefined ? ["广告费"] : []),
      ...(platformFees === undefined ? ["平台佣金"] : []),
      ...(taxCost === undefined ? ["税费"] : []),
    ];
    const basicContribution = netSalesAmount && productCost !== undefined && freightCost !== undefined
      ? (netSalesAmount - productCost - freightCost) / netSalesAmount : undefined;
    const fullContribution = netSalesAmount && productCost !== undefined && freightCost !== undefined
      && adSpend !== undefined && platformFees !== undefined && taxCost !== undefined
      ? (netSalesAmount - productCost - freightCost - adSpend - platformFees - taxCost) / netSalesAmount : undefined;
    return {
      platform, storeKey: storeKey(platform, storeName), storeName, periodStart, periodEnd,
      salesAmount, salesOrders, salesItems: integerValue(get("salesItems")),
      netSalesAmount, netOrders: integerValue(get("netOrders")), netItems: integerValue(get("netItems")),
      discountAmount, productCost, freightCost, refundCost, adSpend, platformFees, taxCost,
      refundRate: safeRatio(refundCost, salesAmount), discountRate: safeRatio(discountAmount, salesAmount),
      basicContribution, fullContribution, averageOrderValue: safeRatio(netSalesAmount, salesOrders),
      salesChangeRate: numberValue(get("salesChangeRate")), inventoryCoverDays: numberValue(get("inventoryCoverDays")),
      dataCompleteness, sourceRef, unavailableFields, raw: json(row),
    };
  }

  private async applyRules(snapshots: Array<{
    platform: string; storeKey: string; storeName: string; periodStart: Date; periodEnd: Date;
    refundRate: number | null; discountRate: number | null; basicContribution: number | null;
    salesChangeRate: number | null; inventoryCoverDays: number | null; dataCompleteness: number;
    sourceRef: string; unavailableFields: string[];
  }>) {
    const output = [];
    for (const snapshot of snapshots) {
      const candidates: Array<{ type: string; severity: string; metricKey: string; currentValue: number; title: string; description: string; expectedResult: string }> = [];
      if (snapshot.refundRate !== null && snapshot.refundRate > 0.08) {
        candidates.push({
          type: "REFUND_RATE", severity: snapshot.refundRate > 0.12 ? "P0" : "P1", metricKey: "refundRate", currentValue: snapshot.refundRate,
          title: `${snapshot.storeName}退款率专项分析`,
          description: `本期退款率为${(snapshot.refundRate * 100).toFixed(1)}%，已超过8%提醒线。`,
          expectedResult: "输出TOP退款SKU、退款原因和至少3项整改动作",
        });
      }
      if (snapshot.basicContribution !== null && snapshot.basicContribution < 0.3) {
        candidates.push({
          type: "BASIC_CONTRIBUTION", severity: snapshot.basicContribution < 0.2 ? "P0" : "P1", metricKey: "basicContribution", currentValue: snapshot.basicContribution,
          title: `${snapshot.storeName}基础贡献专项分析`,
          description: `本期基础贡献率为${(snapshot.basicContribution * 100).toFixed(1)}%，低于30%提醒线。`,
          expectedResult: "核对成本、优惠和退款结构，形成可执行改善方案",
        });
      }
      if (snapshot.discountRate !== null && snapshot.discountRate > 0.15) {
        candidates.push({
          type: "DISCOUNT_RATE", severity: snapshot.discountRate > 0.25 && (snapshot.salesChangeRate ?? 0) <= 0 ? "P0" : "P1",
          metricKey: "discountRate", currentValue: snapshot.discountRate,
          title: `${snapshot.storeName}优惠依赖分析`,
          description: `本期优惠率为${(snapshot.discountRate * 100).toFixed(1)}%，超过15%提醒线。`,
          expectedResult: "核对促销投入、订单增长与毛利变化",
        });
      }
      if (snapshot.salesChangeRate !== null && snapshot.salesChangeRate < -0.15) {
        candidates.push({
          type: "SALES_DECLINE", severity: snapshot.salesChangeRate < -0.3 ? "P0" : "P1", metricKey: "salesChangeRate", currentValue: snapshot.salesChangeRate,
          title: `${snapshot.storeName}销售下降诊断`,
          description: `本期销售较基线下降${Math.abs(snapshot.salesChangeRate * 100).toFixed(1)}%。`,
          expectedResult: "定位流量、转化、价格和商品结构原因",
        });
      }
      if (snapshot.inventoryCoverDays !== null && (snapshot.inventoryCoverDays < 14 || snapshot.inventoryCoverDays > 60)) {
        const red = snapshot.inventoryCoverDays < 7 || snapshot.inventoryCoverDays > 90;
        candidates.push({
          type: "INVENTORY_COVER", severity: red ? "P0" : "P1", metricKey: "inventoryCoverDays", currentValue: snapshot.inventoryCoverDays,
          title: `${snapshot.storeName}库存覆盖异常`,
          description: `库存覆盖为${snapshot.inventoryCoverDays.toFixed(1)}天。`,
          expectedResult: "形成补货或去库存动作并指定复查日期",
        });
      }
      if (snapshot.dataCompleteness < 0.98) {
        candidates.push({
          type: "DATA_COMPLETENESS", severity: snapshot.dataCompleteness < 0.95 ? "P0" : "P1", metricKey: "dataCompleteness", currentValue: snapshot.dataCompleteness,
          title: `${snapshot.storeName}经营数据待补齐`,
          description: `数据完整率为${(snapshot.dataCompleteness * 100).toFixed(1)}%，缺失字段：${snapshot.unavailableFields.join("、") || "待核对"}。`,
          expectedResult: "补齐缺失字段并完成源数据对账",
        });
      }
      for (const candidate of candidates) output.push(await this.upsertFinding(snapshot, candidate));
    }
    return output;
  }

  private async upsertFinding(
    snapshot: { platform: string; storeKey: string; storeName: string; periodStart: Date; periodEnd: Date; sourceRef: string; unavailableFields: string[] },
    candidate: { type: string; severity: string; metricKey: string; currentValue: number; title: string; description: string; expectedResult: string },
  ) {
    const dedupeKey = `${snapshot.platform}:${snapshot.storeKey}:${candidate.type}`;
    const latest = await this.prisma.operationFinding.findFirst({
      where: { dedupeKey },
      orderBy: { lastFoundAt: "desc" },
    });
    if (latest?.status === "RESOLVED" && latest.periodEnd && latest.periodEnd >= snapshot.periodEnd) return latest;
    const existing = latest && ["PENDING_CONFIRMATION", "CONFIRMED"].includes(latest.status) ? latest : null;
    const evidence = {
      period: `${snapshot.periodStart.toISOString()} / ${snapshot.periodEnd.toISOString()}`,
      currentValue: candidate.currentValue, source: snapshot.sourceRef, rule: "operation-rules-v1",
    };
    if (existing) {
      return this.prisma.operationFinding.update({
        where: { id: existing.id },
        data: {
          severity: candidate.severity, description: candidate.description, currentValue: candidate.currentValue,
          lastFoundAt: new Date(), sourceRefs: Array.from(new Set([...existing.sourceRefs, snapshot.sourceRef])),
          missingFields: snapshot.unavailableFields, evidence: json(evidence),
          suggestion: json({ expectedResult: candidate.expectedResult }),
        },
      });
    }
    const findingNo = `FND-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    return this.prisma.operationFinding.create({
      data: {
        findingNo, dedupeKey, type: candidate.type, platform: snapshot.platform, storeKey: snapshot.storeKey, storeName: snapshot.storeName,
        severity: candidate.severity, title: candidate.title, description: candidate.description,
        periodStart: snapshot.periodStart, periodEnd: snapshot.periodEnd, metricKey: candidate.metricKey, currentValue: candidate.currentValue,
        sourceRefs: [snapshot.sourceRef], missingFields: snapshot.unavailableFields,
        evidence: json(evidence), suggestion: json({ expectedResult: candidate.expectedResult }),
      },
    });
  }

  private async ensureInitialBaseline() {
    const periodStart = new Date("2026-07-17T00:00:00+08:00");
    const periodEnd = new Date("2026-07-23T23:59:59+08:00");
    const run = await this.prisma.operationAnalysisRun.upsert({
      where: { runNo: "RUN-20260723-INITIAL" },
      create: {
        runNo: "RUN-20260723-INITIAL", periodStart, periodEnd, source: "USER_SCREENSHOT",
        sourceName: "聚水潭渠道销售统计截图（2026-07-17至23）", status: "PARTIAL", dataFreshness: "HISTORICAL",
        importedCount: 5, completeness: 0.71, createdBy: "系统初始化", completedAt: new Date(),
      },
      update: {},
    });
    const initialStores = [
      ["JD", "京东官方旗舰店-sx", 80797.68, 133, 138, 77191.14, 127, 132, 3613.92, 45410, 400, 1848],
      ["TMALL", "赛电天猫旗舰店-zy", 66058.43, 75, 5089, 54281.59, 63, 5075, 16437.83, 36660, 1318.5, 7420],
      ["DOUYIN", "赛电智能手表旗舰店-yy", 51758.48, 164, 189, 40874.43, 151, 176, 4930.7, 27910.4, 1515.5, 5976.8],
      ["JD", "京东医疗旗舰店-st", 27483.74, 30, 34, 21767.74, 26, 30, 1098, 13097, 234, 2720],
      ["TMALL", "天猫医疗旗舰店-yh", 11943.79, 11, 29, 10649.29, 10, 26, 284.21, 5320, 207, 680],
    ] as const;
    for (const [platform, name, sales, orders, items, netSales, netOrders, netItems, discount, cost, freight, refund] of initialStores) {
      await this.prisma.storeMetricSnapshot.upsert({
        where: { runId_platform_storeKey: { runId: run.id, platform, storeKey: storeKey(platform, name) } },
        create: {
          runId: run.id, platform, storeKey: storeKey(platform, name), storeName: name, periodStart, periodEnd,
          salesAmount: sales, salesOrders: orders, salesItems: items, netSalesAmount: netSales, netOrders, netItems,
          discountAmount: discount, productCost: cost, freightCost: freight, refundCost: refund,
          refundRate: refund / sales, discountRate: discount / sales,
          basicContribution: (netSales - cost - freight) / netSales, averageOrderValue: netSales / orders,
          dataCompleteness: 0.71, sourceRef: "聚水潭渠道销售统计截图 2026-07-17至23",
          unavailableFields: ["广告费", "平台佣金", "税费"], raw: { source: "user-supplied screenshot" },
        },
        update: {},
      });
    }
    for (const platform of ["TMALL", "JD", "DOUYIN"] as const) {
      for (const name of ["华为WATCH D系列", "dido", "YHE", "ABORNI", "杜颂"]) {
        await this.prisma.competitor.upsert({
          where: { platform_name: { platform, name } },
          create: { platform, name, active: true },
          update: { active: true },
        });
      }
    }
    const initialTasks = [
      ["OPS-20260724-001", "P0", "核对天猫75单、5089件统计口径", "数据负责人", 1, "确认组合商品拆分规则并修正分析口径"],
      ["OPS-20260724-002", "P0", "统一产品型号、别名和ERP编码", "商品负责人", 3, "29条编码完成标准化，18条无编码记录进入补码清单"],
      ["OPS-20260724-003", "P0", "补齐F3成本和有效状态", "商品负责人", 2, "成本、售价、状态都有来源记录"],
      ["OPS-20260724-004", "P0", "建立三平台店铺和SKU映射", "数据负责人", 4, "三平台在售SKU映射完整率达到98%"],
      ["OPS-20260724-005", "P1", "天猫旗舰店退款和优惠专项分析", "天猫运营", 5, "输出TOP退款SKU、原因和3项整改动作"],
      ["OPS-20260724-006", "P1", "抖音旗舰店退款及贡献专项分析", "抖音运营", 5, "输出内容、商品、售后三类原因"],
      ["OPS-20260724-007", "P1", "京东官方旗舰店优秀结构复盘", "京东运营", 7, "沉淀TOP商品、价格带和可复制动作"],
      ["OPS-20260724-008", "P1", "京东及天猫医疗店增长诊断", "医疗店负责人", 7, "明确流量、转化和商品结构短板"],
      ["OPS-20260724-009", "P1", "建立五品牌三平台竞品观察名单", "运营主管", 5, "每个平台至少10个有效竞品商品"],
      ["OPS-20260724-010", "P1", "补齐广告、佣金和税费口径", "财务/运营", 10, "能够计算店铺和SKU完整经营利润"],
    ] as const;
    for (const [taskNo, priority, title, owner, days, expectedResult] of initialTasks) {
      await this.prisma.opsTask.upsert({
        where: { taskNo },
        create: {
          taskNo, title, category: "运营分析", priority, status: "PENDING_CONFIRMATION", owner,
          sourceType: "INITIAL_ANALYSIS", expectedResult, dueAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
          history: { create: { toStatus: "PENDING_CONFIRMATION", action: "SEED", actor: "系统初始化", note: "首轮经营分析任务" } },
        },
        update: {},
      });
    }
    const snapshots = await this.prisma.storeMetricSnapshot.findMany({ where: { runId: run.id } });
    await this.applyRules(snapshots);
  }

  private audit(actor: string, action: string, entityType: string, entityId: string, after: unknown) {
    return this.prisma.auditLog.create({ data: { actor, action, entityType, entityId, after: json(after) } });
  }
}
