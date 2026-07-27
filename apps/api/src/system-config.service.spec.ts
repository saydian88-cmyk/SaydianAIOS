import { describe, expect, it, vi } from "vitest";
import { readIntegrationSecret } from "./integration-secret";
import { SystemConfigService } from "./system-config.service";

function setup(existing: Record<string, unknown> | null = null) {
  const prisma = {
    integration: {
      findUnique: vi.fn().mockResolvedValue(existing),
      upsert: vi.fn().mockImplementation(async ({ create, update }: Record<string, any>) => existing ? update : create),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const service = new SystemConfigService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { prisma, service };
}

describe("SystemConfigService", () => {
  it("previews configuration names without returning plaintext values", async () => {
    const { service, prisma } = setup();
    const secret = "should-never-be-returned";
    const result = await service.previewImport(`企业微信\n企业ID：corp-001\nSecret：${secret}`, "测试管理员");

    expect(result.entries).toEqual([
      expect.objectContaining({ label: "企业ID", targetType: "PUBLIC", configured: true }),
      expect.objectContaining({ label: "Secret", targetType: "SECRET", configured: true }),
    ]);
    expect(JSON.stringify(result.entries)).not.toContain(secret);
    expect(result.importToken).toMatch(/^enc:/u);
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain(secret);
  });

  it("does not overwrite an existing non-empty value by default", async () => {
    const existing = {
      kind: "WECOM",
      publicConfig: { corpId: "existing-corp" },
      secretRef: null,
    };
    const { service, prisma } = setup(existing);
    const preview = await service.previewImport("企业微信\n企业ID：new-corp\nSecret：new-secret", "测试管理员");
    const result = await service.applyImport(preview.importToken, false, "测试管理员");
    const update = prisma.integration.upsert.mock.calls[0][0].update;

    expect(result).toEqual(expect.objectContaining({ applied: 1, skipped: 1 }));
    expect(update.publicConfig.corpId).toBe("existing-corp");
    expect(readIntegrationSecret(update.secretRef).wecomAppSecret).toBe("new-secret");
  });
});
