import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth.service";

describe("AuthService portal isolation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("issues an admin session that can access admin endpoints", async () => {
    const service = new AuthService({
      adminUser: {
        count: vi.fn().mockResolvedValue(1),
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
    } as never);
    const passwordHash = await service.hashPassword("correct-password");
    (service as any).prisma.adminUser.findUnique.mockResolvedValue({
      id: "admin-1",
      username: "admin",
      displayName: "总管理员",
      status: "ACTIVE",
      passwordHash,
      roles: [{
        role: {
          code: "SUPER_ADMIN",
          active: true,
          permissions: ["*"],
          dataScope: "ALL",
        },
      }],
    });

    const login = await service.loginAdmin("admin", "correct-password");
    expect(service.requireAdmin(`Bearer ${login.token}`)).toBe("总管理员");
    expect(service.identity(`Bearer ${login.token}`).portal).toBe("ADMIN_CONSOLE");
  });

  it("keeps enterprise-WeChat employees out of admin endpoints", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: "mall-employee",
        name: "主播甲",
        wecomUserId: "wecom-1",
        departmentNames: ["直播部"],
        active: true,
      }),
    }));
    const service = new AuthService({
      department: { upsert: vi.fn().mockResolvedValue({ id: "department-1" }) },
      employee: {
        upsert: vi.fn().mockResolvedValue({
          id: "employee-1",
          name: "主播甲",
          isSuperAdmin: false,
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "employee-1",
          name: "主播甲",
          isSuperAdmin: false,
          roles: [{
            role: {
              code: "LIVE_HOST",
              active: true,
              permissions: ["TASK_EXECUTE", "LIVE_EXECUTE"],
              dataScope: "SELF",
            },
          }],
        }),
      },
    } as never);

    const login = await service.loginWithMallSession("mall-token");
    expect(service.requireEmployee(`Bearer ${login.token}`).roles).toContain("LIVE_HOST");
    expect(() => service.requireAdmin(`Bearer ${login.token}`)).toThrow("当前账号无管理后台权限");
  });
});
