import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { opsConfig } from "./config";
import { PrismaService } from "./prisma.service";

const scrypt = promisify(scryptCallback);

type Portal = "ADMIN_CONSOLE" | "EMPLOYEE_WORKBENCH";

export type SessionPayload = {
  audience: Portal;
  adminUserId?: string;
  employeeId?: string;
  name: string;
  wecomUserId?: string;
  isSuperAdmin: boolean;
  roles: string[];
  permissions: string[];
  dataScope: string;
  exp: number;
};

type MallEmployee = {
  id: string;
  name: string;
  wecomUserId: string;
  departmentNames?: string[];
  mobileMasked?: string;
  active?: boolean;
};

function encode(value: object) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signature(payload: string) {
  return createHmac("sha256", opsConfig.authSecret).update(payload).digest("base64url");
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  requireAdmin(authorization?: string, requestedActor?: string): string {
    const token = this.token(authorization);
    if (!token) throw new UnauthorizedException("请登录总管理后台");
    if (token !== opsConfig.adminToken) {
      const session = this.verifySession(token);
      if (session.audience !== "ADMIN_CONSOLE") throw new UnauthorizedException("当前账号无管理后台权限");
      return session.name;
    }
    if (!requestedActor?.trim()) return opsConfig.defaultActor;
    try {
      return decodeURIComponent(requestedActor).trim() || opsConfig.defaultActor;
    } catch {
      return requestedActor.trim();
    }
  }

  requireEmployee(authorization?: string): SessionPayload {
    const session = this.verifySession(this.token(authorization));
    if (session.audience !== "EMPLOYEE_WORKBENCH" || !session.employeeId) {
      throw new UnauthorizedException("请从企业微信进入员工工作台");
    }
    return session;
  }

  requirePermission(authorization: string | undefined, permission: string) {
    const token = this.token(authorization);
    if (token === opsConfig.adminToken) return;
    const session = this.verifySession(token);
    if (
      session.audience !== "ADMIN_CONSOLE" ||
      (!session.isSuperAdmin && !session.permissions.includes("*") && !session.permissions.includes(permission))
    ) {
      throw new UnauthorizedException("当前账号缺少此操作权限");
    }
  }

  identity(authorization?: string) {
    const token = this.token(authorization);
    if (token === opsConfig.adminToken) {
      return {
        employeeId: null,
        adminUserId: null,
        name: opsConfig.defaultActor,
        wecomUserId: null,
        isSuperAdmin: true,
        roles: ["SUPER_ADMIN"],
        permissions: ["*"],
        dataScope: "ALL",
        portal: "ADMIN_CONSOLE",
        loginType: "ADMIN_TOKEN",
      };
    }
    const session = this.verifySession(token);
    return {
      ...session,
      portal: session.audience,
      loginType: session.audience === "ADMIN_CONSOLE" ? "PASSWORD" : "WECOM",
    };
  }

  async loginAdmin(username: string, password: string) {
    if (!username.trim() || !password) throw new BadRequestException("请输入账号和密码");
    await this.ensureBootstrapAdmin(username.trim(), password);
    const admin = await this.prisma.adminUser.findUnique({
      where: { username: username.trim() },
      include: { roles: { include: { role: true } } },
    });
    if (!admin || admin.status !== "ACTIVE" || !(await this.verifyPassword(password, admin.passwordHash))) {
      throw new UnauthorizedException("账号或密码不正确");
    }
    const activeRoles = admin.roles.map((item) => item.role).filter((role) => role.active);
    const isSuperAdmin = activeRoles.some((role) => role.code === "SUPER_ADMIN");
    const payload: SessionPayload = {
      audience: "ADMIN_CONSOLE",
      adminUserId: admin.id,
      name: admin.displayName,
      isSuperAdmin,
      roles: activeRoles.map((role) => role.code),
      permissions: [...new Set(activeRoles.flatMap((role) => role.permissions))],
      dataScope: isSuperAdmin ? "ALL" : activeRoles.find((role) => role.dataScope === "ALL")?.dataScope || "DEPARTMENT",
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    };
    await this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    return this.issue(payload, {
      id: admin.id,
      username: admin.username,
      name: admin.displayName,
      roles: payload.roles,
      permissions: payload.permissions,
      isSuperAdmin,
    });
  }

  async hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const hash = (await scrypt(password, salt, 64)) as Buffer;
    return `scrypt$${salt}$${hash.toString("hex")}`;
  }

  async wecomAuthorizeUrl(redirectUri: string) {
    this.assertRedirectUri(redirectUri);
    const response = await fetch(
      `${opsConfig.mall.baseUrl}/wecom/authorize-url?redirectUri=${encodeURIComponent(redirectUri)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || !result.url) {
      throw new BadRequestException(String(result.message || "企业微信登录入口暂不可用"));
    }
    return { url: String(result.url) };
  }

  async wecomQrAuthorizeUrl(redirectUri: string) {
    this.assertRedirectUri(redirectUri);
    const response = await fetch(
      `${opsConfig.mall.baseUrl}/wecom/qr-authorize-url?redirectUri=${encodeURIComponent(redirectUri)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || !result.url) {
      throw new BadRequestException(String(result.message || "企业微信扫码登录入口暂不可用"));
    }
    return { url: String(result.url) };
  }

  async loginWithWecomCode(code: string) {
    if (!code.trim()) throw new BadRequestException("企业微信授权码缺失");
    const loginResponse = await fetch(`${opsConfig.mall.baseUrl}/wecom/oauth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
      signal: AbortSignal.timeout(15_000),
    });
    const login = await loginResponse.json().catch(() => ({})) as Record<string, unknown>;
    if (!loginResponse.ok || !login.token) {
      throw new UnauthorizedException(String(login.message || "企业微信登录失败"));
    }
    return this.loginWithMallSession(String(login.token));
  }

  async loginWithMallSession(mallToken: string) {
    if (!mallToken.trim()) throw new BadRequestException("商城员工登录凭据缺失");
    const profileResponse = await fetch(`${opsConfig.mall.baseUrl}/wecom/me/profile`, {
      headers: { authorization: `Bearer ${mallToken.trim()}` },
      signal: AbortSignal.timeout(15_000),
    });
    const profile = await profileResponse.json().catch(() => ({})) as MallEmployee & { message?: string };
    if (!profileResponse.ok || !profile.wecomUserId || profile.active === false) {
      throw new UnauthorizedException(String(profile.message || "企业微信员工资料不可用"));
    }

    const departmentName = profile.departmentNames?.find((item) => item.trim())?.trim();
    const department = departmentName
      ? await this.prisma.department.upsert({
          where: { name: departmentName },
          update: { active: true },
          create: { name: departmentName },
        })
      : null;
    const employee = await this.prisma.employee.upsert({
      where: { wecomUserId: profile.wecomUserId },
      update: {
        name: profile.name,
        departmentId: department?.id,
        mobileMasked: profile.mobileMasked,
        status: "ACTIVE",
      },
      create: {
        name: profile.name,
        departmentId: department?.id,
        wecomUserId: profile.wecomUserId,
        mobileMasked: profile.mobileMasked,
        status: "ACTIVE",
      },
    });
    const employeeWithRoles = await this.prisma.employee.findUniqueOrThrow({
      where: { id: employee.id },
      include: { roles: { include: { role: true } } },
    });
    const activeRoles = employeeWithRoles.roles.map((item) => item.role).filter((role) => role.active);
    const payload: SessionPayload = {
      audience: "EMPLOYEE_WORKBENCH",
      employeeId: employee.id,
      name: employee.name,
      wecomUserId: profile.wecomUserId,
      isSuperAdmin: employee.isSuperAdmin,
      roles: activeRoles.map((role) => role.code),
      permissions: [...new Set(activeRoles.flatMap((role) => role.permissions))],
      dataScope: activeRoles.find((role) => role.dataScope === "DEPARTMENT")?.dataScope || "SELF",
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    };
    return {
      ...this.issue(payload, {
      id: employee.id,
      name: employee.name,
      wecomUserId: profile.wecomUserId,
      departmentNames: profile.departmentNames || [],
      roles: payload.roles,
      permissions: payload.permissions,
      isSuperAdmin: employee.isSuperAdmin,
      }),
      mallToken: mallToken.trim(),
    };
  }

  private async ensureBootstrapAdmin(username: string, password: string) {
    const count = await this.prisma.adminUser.count();
    if (count > 0 || username !== opsConfig.adminUsername || !opsConfig.adminPassword || password !== opsConfig.adminPassword) {
      return;
    }
    const role = await this.prisma.role.upsert({
      where: { code: "SUPER_ADMIN" },
      update: { active: true, permissions: ["*"], dataScope: "ALL", portal: "ADMIN" },
      create: {
        code: "SUPER_ADMIN",
        name: "超级管理员",
        portal: "ADMIN",
        permissions: ["*"],
        dataScope: "ALL",
      },
    });
    const admin = await this.prisma.adminUser.create({
      data: {
        username,
        passwordHash: await this.hashPassword(password),
        displayName: opsConfig.defaultActor,
      },
    });
    await this.prisma.adminUserRole.create({ data: { adminUserId: admin.id, roleId: role.id } });
  }

  private async verifyPassword(password: string, stored: string) {
    const [scheme, salt, hex] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !hex) return false;
    const candidate = (await scrypt(password, salt, 64)) as Buffer;
    const expected = Buffer.from(hex, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }

  private issue(payload: SessionPayload, user: Record<string, unknown>) {
    const encoded = encode(payload);
    return {
      token: `${encoded}.${signature(encoded)}`,
      expiresAt: new Date(payload.exp * 1000),
      user,
    };
  }

  private token(authorization?: string) {
    return String(authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  }

  private verifySession(token: string): SessionPayload {
    const [payload, providedSignature] = token.split(".");
    if (!payload || !providedSignature) throw new UnauthorizedException("登录已失效");
    const expected = signature(payload);
    const left = Buffer.from(providedSignature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new UnauthorizedException("登录已失效");
    }
    try {
      const result = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
      if (!result.audience || !result.name || result.exp <= Math.floor(Date.now() / 1000)) throw new Error("expired");
      return result;
    } catch {
      throw new UnauthorizedException("登录已失效");
    }
  }

  private assertRedirectUri(value: string) {
    try {
      const redirect = new URL(value);
      const allowed = new URL(opsConfig.webBaseUrl);
      if (redirect.origin !== allowed.origin || !redirect.pathname.startsWith(allowed.pathname)) {
        throw new Error("not allowed");
      }
    } catch {
      throw new BadRequestException("企业微信回调地址不在员工工作台目录");
    }
  }
}
