import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

export type GuardResult = {
  allowed: boolean;
  reasons: string[];
  evidenceIds: string[];
};

@Injectable()
export class ContentGuardService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(input: {
    title: string;
    body: string;
    productModel?: string;
    evidenceIds?: string[];
  }): Promise<GuardResult> {
    const reasons: string[] = [];
    const text = `${input.title}\n${input.body}`.toLowerCase();
    const rules = await this.prisma.phraseRule.findMany({ where: { active: true } });
    for (const rule of rules) {
      const blocked = rule.blockedText.trim().toLowerCase();
      if (blocked && text.includes(blocked)) reasons.push(`命中表述规则：${rule.blockedText}`);
    }

    const evidenceIds = Array.from(new Set(input.evidenceIds ?? []));
    if (evidenceIds.length) {
      const claims = await this.prisma.evidenceClaim.findMany({
        where: { id: { in: evidenceIds } },
      });
      const found = new Set(claims.map((claim) => claim.id));
      for (const id of evidenceIds) if (!found.has(id)) reasons.push(`证据不存在：${id}`);
      const now = new Date();
      for (const claim of claims) {
        if (claim.status === "BLOCKED" || claim.status === "ARCHIVED") {
          reasons.push(`证据不可用于发布：${claim.id}`);
        }
        if (claim.validUntil && claim.validUntil < now) reasons.push(`证据已过有效期：${claim.id}`);
      }
    }

    if (input.productModel) {
      const mapping = await this.prisma.productMapping.findUnique({
        where: { commercialName: input.productModel },
      });
      if (!mapping || mapping.status === "PENDING" || mapping.status === "BLOCKED") {
        reasons.push(`型号映射未完成：${input.productModel}`);
      }
    }

    return { allowed: reasons.length === 0, reasons, evidenceIds };
  }
}

