import { describe, expect, it, vi } from "vitest";
import { ContentGuardService } from "./content-guard.service";

function serviceWith(data: { rules?: unknown[]; claims?: unknown[]; mapping?: unknown }) {
  const prisma = {
    phraseRule: { findMany: vi.fn().mockResolvedValue(data.rules ?? []) },
    evidenceClaim: { findMany: vi.fn().mockResolvedValue(data.claims ?? []) },
    productMapping: { findUnique: vi.fn().mockResolvedValue(data.mapping ?? null) },
  };
  return new ContentGuardService(prisma as never);
}

describe("发布前内容门禁", () => {
  it("拦截限制词、失效证据和未映射型号", async () => {
    const service = serviceWith({
      rules: [{ blockedText: "治疗疾病" }],
      claims: [{ id: "E-1", status: "BLOCKED", validUntil: null }],
    });
    const result = await service.evaluate({ title: "测试", body: "可以治疗疾病", productModel: "W9S", evidenceIds: ["E-1", "E-2"] });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      "命中表述规则：治疗疾病",
      "证据不可用于发布：E-1",
      "证据不存在：E-2",
      "型号映射未完成：W9S",
    ]));
  });

  it("允许规则、证据和型号均通过的内容", async () => {
    const service = serviceWith({
      claims: [{ id: "E-1", status: "READY", validUntil: null }],
      mapping: { status: "READY" },
    });
    const result = await service.evaluate({ title: "家庭健康管理", body: "数据用于日常监测参考", productModel: "W9S", evidenceIds: ["E-1"] });
    expect(result).toEqual({ allowed: true, reasons: [], evidenceIds: ["E-1"] });
  });

  it("普通发布门禁不套用仅限受限脚本的词和画面规则", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new ContentGuardService({
      phraseRule: { findMany },
      evidenceClaim: { findMany: vi.fn() },
      productMapping: { findUnique: vi.fn() },
    } as never);
    await service.evaluate({ title: "普通脚本", body: "血压功能介绍" });
    expect(findMany).toHaveBeenCalledWith({
      where: { active: true, category: { notIn: ["HEALTH_RESTRICTED_WORD", "HEALTH_RESTRICTED_VISUAL"] } },
    });
  });
});
