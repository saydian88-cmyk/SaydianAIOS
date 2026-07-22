import { Injectable, UnauthorizedException } from "@nestjs/common";
import { opsConfig } from "./config";

@Injectable()
export class AuthService {
  requireAdmin(authorization?: string, requestedActor?: string): string {
    const token = String(authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!token || token !== opsConfig.adminToken) {
      throw new UnauthorizedException("运营中台登录已失效");
    }
    if (!requestedActor?.trim()) return opsConfig.defaultActor;
    try {
      return decodeURIComponent(requestedActor).trim() || opsConfig.defaultActor;
    } catch {
      return requestedActor.trim();
    }
  }
}
