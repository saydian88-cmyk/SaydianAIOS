import { BadRequestException, Injectable } from "@nestjs/common";
import { AssetKind, BusinessSnapshotType, IntegrationKind, Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { safeJson, stringValue, toDate } from "./utils";

const snapshotTypes = new Set<string>([
  "PRODUCT", "INVENTORY", "ORDER", "SHIPMENT", "AFTER_SALE", "REFUND", "CUSTOMER_SERVICE", "WORK_ORDER",
]);

function csvCells(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value.trim());
  return cells;
}

export function parseCsvRecords(csv: string): Array<Record<string, unknown>> {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = csvCells(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, csvCells(line)[index] ?? ""])));
}

function first(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (row[key] !== undefined && row[key] !== "") return row[key];
  return undefined;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return stringValue(value).split(/[|；;]/).map((item) => item.trim()).filter(Boolean);
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const [departments, employees, products, accounts, stores, imports, snapshots, attributions, sourceHealth] = await Promise.all([
      this.prisma.department.findMany({ orderBy: { name: "asc" } }),
      this.prisma.employee.findMany({ include: { department: true }, orderBy: [{ status: "asc" }, { name: "asc" }] }),
      this.prisma.product.findMany({ include: { skus: true }, orderBy: { modelCode: "asc" } }),
      this.prisma.platformAccount.findMany({ include: { integration: true, ownerEmployee: true }, orderBy: [{ region: "asc" }, { accountName: "asc" }] }),
      this.prisma.store.findMany({ include: { platformAccount: { include: { integration: true } }, ownerEmployee: true }, orderBy: [{ region: "asc" }, { name: "asc" }] }),
      this.prisma.importBatch.findMany({ include: { integration: true, platformAccount: true }, orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.businessSnapshot.findMany({ include: { integration: true, platformAccount: true, store: true, ownerEmployee: true }, orderBy: { capturedAt: "desc" }, take: 300 }),
      this.prisma.attributionTouch.findMany({ include: { integration: true, platformAccount: true, employee: true }, orderBy: { occurredAt: "desc" }, take: 200 }),
      this.prisma.dataSourceHealth.findMany({ include: { integration: true, platformAccount: true }, orderBy: { checkedAt: "desc" }, take: 100 }),
    ]);
    return { departments, employees, products, accounts, stores, imports, snapshots, attributions, sourceHealth };
  }

  async createDepartment(body: Record<string, unknown>, actor: string) {
    const name = stringValue(body.name);
    if (!name) throw new BadRequestException("部门名称不能为空");
    const department = await this.prisma.department.upsert({ where: { name }, create: { name }, update: { active: body.active !== false } });
    await this.audit(actor, "DEPARTMENT_UPSERT", "Department", department.id, department);
    return department;
  }

  async createEmployee(body: Record<string, unknown>, actor: string) {
    const name = stringValue(body.name);
    if (!name) throw new BadRequestException("员工姓名不能为空");
    const employee = await this.prisma.employee.create({
      data: {
        name,
        employeeNo: stringValue(body.employeeNo) || undefined,
        departmentId: stringValue(body.departmentId) || undefined,
        role: stringValue(body.role) || "运营",
        wecomUserId: stringValue(body.wecomUserId) || undefined,
        mobileMasked: stringValue(body.mobileMasked) || undefined,
        isSuperAdmin: body.isSuperAdmin === true,
      },
    });
    await this.audit(actor, "EMPLOYEE_CREATE", "Employee", employee.id, employee);
    return employee;
  }

  async createProduct(body: Record<string, unknown>, actor: string) {
    const name = stringValue(body.name);
    const modelCode = stringValue(body.modelCode);
    if (!name || !modelCode) throw new BadRequestException("产品名称和型号不能为空");
    const skuRows = Array.isArray(body.skus) ? body.skus.map(safeJson) : [];
    const product = await this.prisma.product.upsert({
      where: { modelCode },
      create: {
        name, modelCode, category: stringValue(body.category) || "智能健康穿戴", evidenceIds: stringList(body.evidenceIds),
        metadata: safeJson(body.metadata) as Prisma.InputJsonValue,
      },
      update: {
        name, category: stringValue(body.category) || "智能健康穿戴", evidenceIds: stringList(body.evidenceIds),
        metadata: safeJson(body.metadata) as Prisma.InputJsonValue,
      },
    });
    for (const row of skuRows) {
      const skuCode = stringValue(row.skuCode);
      if (!skuCode) continue;
      await this.prisma.productSku.upsert({
        where: { skuCode },
        create: { productId: product.id, skuCode, name: stringValue(row.name) || skuCode, attributes: safeJson(row.attributes) as Prisma.InputJsonValue, externalMappings: safeJson(row.externalMappings) as Prisma.InputJsonValue },
        update: { productId: product.id, name: stringValue(row.name) || skuCode, attributes: safeJson(row.attributes) as Prisma.InputJsonValue, externalMappings: safeJson(row.externalMappings) as Prisma.InputJsonValue },
      });
    }
    await this.audit(actor, "PRODUCT_UPSERT", "Product", product.id, product);
    return this.prisma.product.findUnique({ where: { id: product.id }, include: { skus: true } });
  }

  async createAccount(body: Record<string, unknown>, actor: string) {
    const kind = stringValue(body.integrationKind) as IntegrationKind;
    const accountName = stringValue(body.accountName);
    const externalAccountId = stringValue(body.externalAccountId);
    if (!kind || !accountName || !externalAccountId) throw new BadRequestException("平台、账号名称和外部账号编号不能为空");
    const integration = await this.prisma.integration.findUnique({ where: { kind } });
    if (!integration) throw new BadRequestException("平台连接不存在，请先执行初始化数据");
    const account = await this.prisma.platformAccount.upsert({
      where: { integrationId_externalAccountId: { integrationId: integration.id, externalAccountId } },
      create: { integrationId: integration.id, accountName, externalAccountId, region: stringValue(body.region) || integration.region, ownerEmployeeId: stringValue(body.ownerEmployeeId) || undefined },
      update: { accountName, region: stringValue(body.region) || integration.region, ownerEmployeeId: stringValue(body.ownerEmployeeId) || undefined },
    });
    await this.audit(actor, "PLATFORM_ACCOUNT_UPSERT", "PlatformAccount", account.id, account);
    return account;
  }

  async createStore(body: Record<string, unknown>, actor: string) {
    const platformAccountId = stringValue(body.platformAccountId);
    const name = stringValue(body.name);
    const externalStoreId = stringValue(body.externalStoreId);
    if (!platformAccountId || !name || !externalStoreId) throw new BadRequestException("账号、店铺名称和外部店铺编号不能为空");
    const account = await this.prisma.platformAccount.findUnique({ where: { id: platformAccountId } });
    if (!account) throw new BadRequestException("平台账号不存在");
    const store = await this.prisma.store.upsert({
      where: { platformAccountId_externalStoreId: { platformAccountId, externalStoreId } },
      create: { platformAccountId, name, externalStoreId, region: stringValue(body.region) || account.region, ownerEmployeeId: stringValue(body.ownerEmployeeId) || undefined, metadata: safeJson(body.metadata) as Prisma.InputJsonValue },
      update: { name, region: stringValue(body.region) || account.region, ownerEmployeeId: stringValue(body.ownerEmployeeId) || undefined, metadata: safeJson(body.metadata) as Prisma.InputJsonValue },
    });
    await this.audit(actor, "STORE_UPSERT", "Store", store.id, store);
    return store;
  }

  async importSnapshots(body: Record<string, unknown>, actor: string) {
    const kind = stringValue(body.integrationKind) as IntegrationKind;
    const integration = await this.prisma.integration.findUnique({ where: { kind } });
    if (!integration) throw new BadRequestException("导入平台不存在");
    const format = stringValue(body.format).toUpperCase() || "JSON";
    const rows = format === "CSV" ? parseCsvRecords(stringValue(body.csv)) : Array.isArray(body.records) ? body.records.map(safeJson) : [];
    if (!rows.length) throw new BadRequestException("没有可导入的数据");
    const accountId = stringValue(body.platformAccountId) || undefined;
    const storeId = stringValue(body.storeId) || undefined;
    const account = accountId ? await this.prisma.platformAccount.findFirst({ where: { id: accountId, integrationId: integration.id } }) : null;
    if (accountId && !account) throw new BadRequestException("平台账号与所选平台不匹配");
    const store = storeId ? await this.prisma.store.findFirst({ where: { id: storeId, ...(accountId ? { platformAccountId: accountId } : { platformAccount: { integrationId: integration.id } }) } }) : null;
    if (storeId && !store) throw new BadRequestException("店铺与所选平台账号不匹配");
    const employee = await this.prisma.employee.findFirst({ where: { name: actor, status: "ACTIVE" } });
    const batch = await this.prisma.importBatch.create({
      data: {
        integrationId: integration.id, platformAccountId: accountId, kind: stringValue(body.kind) || "BUSINESS_SNAPSHOT",
        format, sourceName: stringValue(body.sourceName) || "人工导入", status: "RUNNING", importedBy: actor,
        importedByEmployeeId: employee?.id, recordsReceived: rows.length, unavailableFields: stringList(body.unavailableFields),
      },
    });
    const errors: Array<{ row: number; message: string }> = [];
    let imported = 0;
    for (const [index, row] of rows.entries()) {
      const type = stringValue(first(row, "type", "类型") ?? body.snapshotType).toUpperCase();
      const sourceId = stringValue(first(row, "sourceId", "外部编号", "订单号", "编号"));
      const status = stringValue(first(row, "status", "状态")) || "UNKNOWN";
      const occurredAt = toDate(first(row, "occurredAt", "发生时间", "创建时间"));
      if (!snapshotTypes.has(type) || !sourceId || !occurredAt) {
        errors.push({ row: index + 2, message: "类型、外部编号或发生时间无效" });
        continue;
      }
      const amountValue = Number(first(row, "amount", "金额"));
      await this.prisma.businessSnapshot.upsert({
        where: {
          integrationId_type_sourceId_sourceVersion: {
            integrationId: integration.id, type: type as BusinessSnapshotType, sourceId,
            sourceVersion: stringValue(first(row, "sourceVersion", "数据版本")) || "current",
          },
        },
        create: {
          integrationId: integration.id, platformAccountId: accountId, storeId, importBatchId: batch.id,
          type: type as BusinessSnapshotType, sourceId, sourceVersion: stringValue(first(row, "sourceVersion", "数据版本")) || "current",
          status, occurredAt, dueAt: toDate(first(row, "dueAt", "截止时间")), ownerEmployeeId: stringValue(first(row, "ownerEmployeeId", "负责人编号")) || undefined,
          amount: Number.isFinite(amountValue) ? amountValue : undefined, currency: stringValue(first(row, "currency", "币种")) || undefined,
          sourceUrl: stringValue(first(row, "sourceUrl", "来源链接")) || undefined,
          unavailableFields: Array.from(new Set([...stringList(body.unavailableFields), ...stringList(first(row, "unavailableFields", "未获取字段"))])),
          payload: row as Prisma.InputJsonValue,
        },
        update: {
          platformAccountId: accountId, storeId, importBatchId: batch.id, status, occurredAt,
          dueAt: toDate(first(row, "dueAt", "截止时间")), amount: Number.isFinite(amountValue) ? amountValue : null,
          currency: stringValue(first(row, "currency", "币种")) || null, sourceUrl: stringValue(first(row, "sourceUrl", "来源链接")) || null,
          unavailableFields: Array.from(new Set([...stringList(body.unavailableFields), ...stringList(first(row, "unavailableFields", "未获取字段"))])),
          payload: row as Prisma.InputJsonValue, capturedAt: new Date(),
        },
      });
      imported += 1;
    }
    const status = imported === rows.length ? "SUCCEEDED" : imported ? "PARTIAL" : "FAILED";
    const result = await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { status, recordsImported: imported, recordsRejected: errors.length, errors, completedAt: new Date() },
    });
    const capabilityStatus = { ...safeJson(integration.capabilityStatus), import: imported ? "HEALTHY" : "ERROR" };
    const capabilities = Array.from(new Set([...integration.capabilities, "import"]));
    await this.prisma.$transaction([
      this.prisma.integration.update({ where: { id: integration.id }, data: { capabilities, capabilityStatus, lastCheckedAt: new Date(), ...(imported ? { lastSuccessAt: new Date() } : {}) } }),
      this.prisma.dataSourceHealth.create({ data: { integrationId: integration.id, platformAccountId: accountId, state: imported ? (errors.length ? "DEGRADED" : "HEALTHY") : "ERROR", capabilities: capabilityStatus, message: `导入${imported}条，拒绝${errors.length}条`, unavailableFields: stringList(body.unavailableFields) } }),
      this.prisma.auditLog.create({ data: { actor, action: "BUSINESS_SNAPSHOT_IMPORT", entityType: "ImportBatch", entityId: batch.id, after: { imported, rejected: errors.length, sourceName: result.sourceName } } }),
    ]);
    if (account) {
      await this.prisma.platformAccount.update({
        where: { id: account.id },
        data: {
          state: "CONFIGURED",
          capabilityStatus: { ...safeJson(account.capabilityStatus), import: imported ? "HEALTHY" : "ERROR" },
          message: imported ? "文件/人工导入已验证，平台API能力待逐项验证" : "最近一次数据导入失败",
          lastCheckedAt: new Date(),
          ...(imported ? { lastSuccessAt: new Date() } : {}),
        },
      });
    }
    return result;
  }

  async createAttribution(body: Record<string, unknown>, actor: string) {
    const attributionCode = stringValue(body.attributionCode);
    const eventType = stringValue(body.eventType);
    const occurredAt = toDate(body.occurredAt) ?? new Date();
    if (!attributionCode || !eventType) throw new BadRequestException("归因码和事件类型不能为空");
    const revenue = Number(body.revenue);
    const touch = await this.prisma.attributionTouch.create({
      data: {
        attributionCode, eventType, contentPlanId: stringValue(body.contentPlanId) || undefined, publishJobId: stringValue(body.publishJobId) || undefined,
        integrationId: stringValue(body.integrationId) || undefined, platformAccountId: stringValue(body.platformAccountId) || undefined,
        employeeId: stringValue(body.employeeId) || undefined, externalEventId: stringValue(body.externalEventId) || undefined,
        source: stringValue(body.source) || "未获取", medium: stringValue(body.medium) || undefined, campaign: stringValue(body.campaign) || undefined,
        consultations: Number(body.consultations) || 0, orders: Number(body.orders) || 0,
        revenue: Number.isFinite(revenue) ? revenue : undefined, currency: stringValue(body.currency) || undefined, occurredAt,
        metadata: safeJson(body.metadata) as Prisma.InputJsonValue,
      },
    });
    await this.audit(actor, "ATTRIBUTION_CREATE", "AttributionTouch", touch.id, touch);
    return touch;
  }

  async importAssetManifest(body: Record<string, unknown>, actor: string) {
    const rows = Array.isArray(body.records) ? body.records.map(safeJson) : [];
    if (!rows.length) throw new BadRequestException("素材清单不能为空");
    let created = 0;
    let updated = 0;
    let duplicates = 0;
    const assetIds: string[] = [];
    const errors: Array<{ row: number; message: string }> = [];
    const employee = await this.prisma.employee.findFirst({ where: { name: actor, status: "ACTIVE" } });
    for (const [index, row] of rows.entries()) {
      const sourceKey = stringValue(row.sourceKey);
      const sourcePath = stringValue(row.sourcePath);
      const sha256 = stringValue(row.sha256);
      const fileName = stringValue(row.fileName);
      const modifiedAt = toDate(row.modifiedAt);
      const sizeBytes = Number(row.sizeBytes);
      if (!sourceKey || !sourcePath || !sha256 || !fileName || !modifiedAt || !Number.isFinite(sizeBytes)) {
        errors.push({ row: index + 1, message: "素材编号、路径、哈希、文件名、大小或修改时间无效" });
        continue;
      }
      const existing = await this.prisma.asset.findUnique({ where: { sourceKey } });
      const duplicate = existing ? null : await this.prisma.asset.findFirst({ where: { sha256 }, orderBy: { createdAt: "asc" } });
      if (duplicate) {
        duplicates += 1;
        assetIds.push(duplicate.id);
        await this.audit(actor, "ASSET_EXACT_DUPLICATE", "Asset", duplicate.id, { sourceKey, sourcePath, fileName, sha256 });
        continue;
      }
      const kind = (["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"].includes(stringValue(row.mediaType).toUpperCase())
        ? stringValue(row.mediaType).toUpperCase()
        : "DOCUMENT") as AssetKind;
      const importedModel = stringValue(row.model) || undefined;
      const asset = await this.prisma.asset.upsert({
        where: { sourceKey },
        create: {
          sourceKey, sourceType: stringValue(row.sourceType) || "LOCAL_AGENT", sourcePath, fileName,
          extension: stringValue(row.extension), mediaType: kind, kind, sha256,
          sizeBytes: BigInt(sizeBytes), modifiedAt, width: Number(row.width) || undefined, height: Number(row.height) || undefined,
          durationSeconds: Number(row.durationSeconds) || undefined, aspectRatio: stringValue(row.aspectRatio) || undefined,
          assetNo: `SD-${kind}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${sha256.slice(0, 12).toUpperCase()}`,
          displayName: fileName.replace(/\.[^.]+$/u, ""),
          level: "ORIGINAL", productScope: importedModel ? "MODEL" : "UNKNOWN", processingStatus: "STORED",
          reviewStatus: "PENDING", availabilityStatus: "INACTIVE", rightsStatus: "EDIT_ONLY",
          originalFileName: fileName, isOriginal: true, model: importedModel, scene: stringValue(row.scene) || undefined, evidenceIds: stringList(row.evidenceIds),
          qualityScore: Number(row.qualityScore) || 0, discoveredBy: actor, storageProvider: "ALIYUN_OSS",
          objectKey: stringValue(row.objectKey) || undefined, objectVersionId: stringValue(row.objectVersionId) || undefined,
          etag: stringValue(row.etag) || undefined, storageUrl: stringValue(row.storageUrl) || undefined,
          storageSyncedAt: toDate(row.storageSyncedAt) ?? new Date(), sourceSnapshot: row as Prisma.InputJsonValue,
        },
        update: {
          sha256, sizeBytes: BigInt(sizeBytes), modifiedAt, width: Number(row.width) || undefined, height: Number(row.height) || undefined,
          durationSeconds: Number(row.durationSeconds) || undefined, aspectRatio: stringValue(row.aspectRatio) || undefined,
          model: stringValue(row.model) || undefined, scene: stringValue(row.scene) || undefined, qualityScore: Number(row.qualityScore) || 0,
          storageProvider: "ALIYUN_OSS", objectKey: stringValue(row.objectKey) || undefined, objectVersionId: stringValue(row.objectVersionId) || undefined,
          etag: stringValue(row.etag) || undefined, storageUrl: stringValue(row.storageUrl) || undefined,
          storageSyncedAt: toDate(row.storageSyncedAt) ?? new Date(), storageError: null, sourceSnapshot: row as Prisma.InputJsonValue,
        },
      });
      const latest = await this.prisma.assetVersion.findFirst({ where: { assetId: asset.id }, orderBy: { version: "desc" } });
      if (!latest || latest.sha256 !== asset.sha256 || latest.objectVersionId !== asset.objectVersionId) {
        await this.prisma.assetVersion.create({ data: { assetId: asset.id, version: (latest?.version ?? 0) + 1, sha256: asset.sha256, sourcePath: asset.sourcePath, objectKey: asset.objectKey, objectVersionId: asset.objectVersionId, etag: asset.etag, storageUrl: asset.storageUrl, createdByEmployeeId: employee?.id, createdBy: actor } });
      }
      if (importedModel) {
        const product = await this.prisma.product.findFirst({ where: { modelCode: { equals: importedModel, mode: "insensitive" } } });
        if (product) {
          await this.prisma.assetProduct.upsert({
            where: { assetId_productId: { assetId: asset.id, productId: product.id } },
            update: { scope: "MODEL", confidence: 1, confirmed: true },
            create: { assetId: asset.id, productId: product.id, scope: "MODEL", confidence: 1, confirmed: true },
          });
        }
      }
      assetIds.push(asset.id);
      await this.audit(actor, existing ? "ASSET_UPDATED" : "ASSET_ADDED", "Asset", asset.id, { fileName: asset.fileName, sourceType: asset.sourceType, mediaType: asset.mediaType, model: asset.model, sha256: asset.sha256, qualityScore: asset.qualityScore, storageProvider: asset.storageProvider, objectKey: asset.objectKey, storageSyncedAt: asset.storageSyncedAt?.toISOString() });
      if (existing) updated += 1;
      else created += 1;
    }
    return { received: rows.length, created, updated, duplicates, rejected: errors.length, errors, assetIds: Array.from(new Set(assetIds)) };
  }

  private async audit(actor: string, action: string, entityType: string, entityId: string, after: unknown) {
    await this.prisma.auditLog.create({ data: { actor, action, entityType, entityId, after: after as Prisma.InputJsonValue } });
  }
}
