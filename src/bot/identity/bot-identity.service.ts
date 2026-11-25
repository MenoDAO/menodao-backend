import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * BotIdentityService — port of menobot's phone→User linking, but backed by
 * the backend Member table so existing members/staff/admin never need a
 * separate bot signup.
 *
 * Rules:
 * - normalize to E.164 (+254…) for Member.phoneNumber lookups,
 * - if Member exists by phone → stamp whatsappId + whatsappLinkedAt,
 * - otherwise create a minimal Member (unverified) so history/leads have a FK.
 */
export interface ResolvedBotMember {
  id: string;
  phoneNumber: string;
  whatsappId: string | null;
  isVerified: boolean;
  preferredLanguage: string | null;
  fullName: string | null;
}

const MEMBER_SELECT = {
  id: true,
  phoneNumber: true,
  whatsappId: true,
  isVerified: true,
  preferredLanguage: true,
  fullName: true,
} as const;

@Injectable()
export class BotIdentityService {
  private readonly logger = new Logger(BotIdentityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** "254712345678@s.whatsapp.net" | "+254712345678" | "254712345678" → "+254712345678" */
  public normalizeToE164(input: string): string {
    const digits = (input || '').replace(/[^\d]/g, '');
    if (!digits) return '';
    // Local Kenyan format 07xx… → assume .ke (+254). Bare 254… → preprend +.
    if (digits.startsWith('0')) return '+254' + digits.slice(1);
    return '+' + digits;
  }

  public normalizeWhatsappIdentity(value: string): string {
    const v = (value || '').trim();
    if (v.toLowerCase().endsWith('@lid')) return v.toLowerCase();
    return this.normalizeToE164(v);
  }

  public isLid(identity: string): boolean {
    return identity.endsWith('@lid');
  }

  /** Find-or-create the Member row backing this WhatsApp sender. */
  async resolveMember(params: {
    phoneDigitsFallback?: string | null;
    whatsappId?: string | null;
    contactName?: string | null;
  }): Promise<ResolvedBotMember | null> {
    const fallbackE164 = params.phoneDigitsFallback
      ? this.normalizeToE164(params.phoneDigitsFallback)
      : '';
    const wid = params.whatsappId ?? fallbackE164 ?? '';

    if (wid && !this.isLid(wid)) {
      const byWid = await this.prisma.member.findUnique({
        where: { whatsappId: wid },
        select: MEMBER_SELECT,
      });
      if (byWid) return byWid;
    }

    if (fallbackE164) {
      const byPhone =
        (await this.prisma.member.findUnique({
          where: { phoneNumber: fallbackE164 },
          select: MEMBER_SELECT,
        })) ?? (await this.findByPhoneSuffix(fallbackE164));
      if (byPhone) {
        // Link existing member to this whatsappId on first message — no re-signup.
        if (wid && !this.isLid(wid) && !byPhone.whatsappId) {
          await this.prisma.member.update({
            where: { id: byPhone.id },
            data: {
              whatsappId: wid,
              whatsappLinkedAt: new Date(),
              ...(params.contactName && !byPhone.phoneNumber
                ? { fullName: params.contactName }
                : {}),
            },
          });
        }
        return {
          ...byPhone,
          whatsappId: byPhone.whatsappId ?? wid ?? null,
          isVerified: byPhone.isVerified,
        };
      }
      // Unregistered number: per v2 spec (Workstream 2 & 9), do NOT create
      // member stubs for unknown senders. Return null so no LLM call is made.
      this.logger.log(
        `Unmatched sender ${this.mask(fallbackE164)}: not registered in Member database.`,
      );
      return null;
    }

    if (wid && this.isLid(wid)) {
      this.logger.warn('Ignoring unlinked WhatsApp LID (no phone fallback).');
    }
    return null;
  }

  /**
   * Read-only lookup by phone for authorised staff. Unlike resolveMember this
   * never creates a stub or links a WhatsApp id; it returns null when there is
   * no exact or unambiguous suffix match.
   */
  async lookupMemberByPhone(phone: string): Promise<ResolvedBotMember | null> {
    const e164 = this.normalizeToE164(phone);
    if (!e164) return null;
    return (
      (await this.prisma.member.findUnique({
        where: { phoneNumber: e164 },
        select: MEMBER_SELECT,
      })) ?? (await this.findByPhoneSuffix(e164))
    );
  }

  /**
   * Last-resort phone match: a Member stored as "0712 345 678" or with a
   * different country-code formatting still has the same trailing digits as
   * the WhatsApp sender. Matching the last nine avoids telling a real member
   * that the bot cannot recognise their number.
   */
  private async findByPhoneSuffix(
    e164: string,
  ): Promise<ResolvedBotMember | null> {
    const digits = e164.replace(/[^\d]/g, '');
    if (digits.length < 9) return null;
    const suffix = digits.slice(-9);
    const matches = await this.prisma.member.findMany({
      where: { phoneNumber: { endsWith: suffix } },
      select: MEMBER_SELECT,
      take: 2,
    });
    if (matches.length === 1) {
      this.logger.warn(
        `Matched ${this.mask(e164)} to an existing member by phone suffix.`,
      );
      return matches[0];
    }
    return null;
  }

  private mask(phone: string): string {
    return `***${(phone || '').slice(-4)}`;
  }
}
