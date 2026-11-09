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
  }): Promise<{
    id: string;
    phoneNumber: string;
    whatsappId: string | null;
  } | null> {
    const fallbackE164 = params.phoneDigitsFallback
      ? this.normalizeToE164(params.phoneDigitsFallback)
      : '';
    const wid = params.whatsappId ?? fallbackE164 ?? '';

    if (wid && !this.isLid(wid)) {
      const byWid = await this.prisma.member.findUnique({
        where: { whatsappId: wid },
        select: { id: true, phoneNumber: true, whatsappId: true },
      });
      if (byWid) return byWid;
    }

    if (fallbackE164) {
      const byPhone = await this.prisma.member.findUnique({
        where: { phoneNumber: fallbackE164 },
        select: { id: true, phoneNumber: true, whatsappId: true },
      });
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
        return { ...byPhone, whatsappId: byPhone.whatsappId ?? wid ?? null };
      }
      // Unknown number → create unverified stub so leads/drafts have a FK.
      // Full OTP verification still happens via the backend auth flow.
      try {
        const created = await this.prisma.member.create({
          data: {
            phoneNumber: fallbackE164,
            fullName: params.contactName || null,
            whatsappId: wid && !this.isLid(wid) ? wid : null,
            whatsappLinkedAt: wid ? new Date() : null,
            isVerified: false,
          },
          select: { id: true, phoneNumber: true, whatsappId: true },
        });
        this.logger.log(
          `Created bot-stub Member for ${this.mask(fallbackE164)} (unverified, pending OTP)`,
        );
        return created;
      } catch (error) {
        // Race: two webhooks created concurrently — re-read by phone.
        this.logger.warn(
          `Stub create raced for ${this.mask(fallbackE164)}: ${
            error instanceof Error ? error.message : String(error)
          } — re-reading`,
        );
        return this.prisma.member.findUnique({
          where: { phoneNumber: fallbackE164 },
          select: { id: true, phoneNumber: true, whatsappId: true },
        });
      }
    }

    if (wid && this.isLid(wid)) {
      this.logger.warn('Ignoring unlinked WhatsApp LID (no phone fallback).');
    }
    return null;
  }

  private mask(phone: string): string {
    return `***${(phone || '').slice(-4)}`;
  }
}
