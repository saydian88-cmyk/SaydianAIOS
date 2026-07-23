import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { opsConfig } from "./config";
import { PrismaService } from "./prisma.service";

type SessionPayload = {
  employeeId: string;
  name: string;
  wecomUserId: string;
  isSuperAdmin: boolean;
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
    const token = String(authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!token) throw new UnauthorizedException("请从企业微信进入运营中台");
    if (token !== opsConfig.adminToken) return this.verifySession(token).name;
    if (!requestedActor?.trim()) return opsConfig.defaultActor;
    try {
      return decodeURIComponent(requestedActor).trim() || opsConfig.defaultActor;
    } catch {
      return requestedActor.trim();
    }
  }

  identity(authorization?: string) {
    const token = String(authorization ?? "").replace(/^Bearer\s+/i, "");
    if (token === opsConfig.adminToken) {
      return {
        employeeId: null,
        name: opsConfig.defaultActor,
        wecomUserId: null,
        isSuperAdmin: true,
        loginType: "ADMIN_TOKEN",
      };
    }
    return { ...this.verifySession(token), loginType: "WECOM" };
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

    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    const payload: SessionPayload = {
      employeeId: employee.id,
      name: employee.name,
      wecomUserId: profile.wecomUserId,
      isSuperAdmin: employee.isSuperAdmin,
      exp: Math.floor(expiresAt.getTime() / 1000),
    };
    const encoded = encode(payload);
    return {
      token: `${encoded}.${signature(encoded)}`,
      expiresAt,
      user: {
        id: employee.id,
        name: employee.name,
        wecomUserId: profile.wecomUserId,
        departmentNames: profile.departmentNames || [],
        isSuperAdmin: employee.isSuperAdmin,
      },
    };
  }

  private verifySession(token: string): SessionPayload {
    const [payload, providedSignature] = token.split(".");
    if (!payload || !providedSignature) throw new UnauthorizedException("运营中台登录已失效");
    const expected = signature(payload);
    const left = Buffer.from(providedSignature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new UnauthorizedException("运营中台登录已失效");
    }
    try {
      const result = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
      if (!result.employeeId || !result.wecomUserId || result.exp <= Math.floor(Date.now() / 1000)) {
        throw new Error("expired");
      }
      return result;
    } catch {
      throw new UnauthorizedException("运营中台登录已失效");
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
      throw new BadRequestException("企业微信回调地址不在运营中台目录");
    }
  }
}
