import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BookingService } from '../booking/booking.service';
import { BotIdentityService } from '../identity/bot-identity.service';
import { BotMemberDataService } from '../account/bot-member-data.service';
import { AdminWhatsappAccessService } from '../admin/admin-whatsapp-access.service';
import { BotPrivilegeService } from './bot-privileges.service';
import { detectScope } from '../intents/intent-fallback';
import {
  BOT_ACTION_DEFINITIONS,
  type BotActionContext,
  type BotActionResult,
} from './bot-action.types';
import type { BotActionName, IntentDataScope } from '../intents/intent.types';

const MAX_LOOKUPS_PER_HOUR = 20;
const MAX_MEMBER_LOOKUPS_PER_HOUR = 10;

/**
 * The only place a bot action can actually run.
 *
 * Security properties:
 *  - the action name is validated against a closed registry;
 *  - the required capability is checked server-side against the resolved actor;
 *  - privileged lookups additionally require a verified admin session *bound to
 *    the requested member*;
 *  - scope is checked against the role matrix before any row is read;
 *  - every privileged read/denial is written to SensitiveDataAccessLog.
 *
 * The LLM never sees a database handle and can never name a tool that is not
 * declared here.
 */
@Injectable()
export class BotActionRegistryService {
  private readonly logger = new Logger(BotActionRegistryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly booking: BookingService,
    private readonly identity: BotIdentityService,
    private readonly memberData: BotMemberDataService,
    private readonly adminAccess: AdminWhatsappAccessService,
    private readonly privileges: BotPrivilegeService,
  ) {}

  isKnown(name: string | null | undefined): name is BotActionName {
    return Boolean(name && name in BOT_ACTION_DEFINITIONS);
  }

  async execute(
    action: BotActionName,
    ctx: BotActionContext,
  ): Promise<BotActionResult> {
    const definition = BOT_ACTION_DEFINITIONS[action];
    if (!definition) {
      return {
        ok: false,
        action,
        reply: '',
        metadata: { unknownAction: true },
      };
    }

    if (
      definition.requiresVerifiedAdmin &&
      ctx.actor.kind === 'ADMIN' &&
      !ctx.actor.adminSessionVerified
    ) {
      await this.audit(ctx, action, 'DENIED', {
        reason: 'unverified_admin',
        actor: this.privileges.describeActor(ctx.actor),
      });
      return {
        ok: false,
        action,
        denied: true,
        requiresVerification: true,
        reply: this.adminVerificationPrompt(ctx.language),
      };
    }

    if (!this.privileges.can(ctx.actor, definition.capability)) {
      await this.audit(ctx, action, 'DENIED', {
        reason: 'missing_capability',
        capability: definition.capability,
        actor: this.privileges.describeActor(ctx.actor),
      });
      return this.denied(action, ctx);
    }

    if (definition.requiresVerifiedAdmin && !ctx.actor.adminSessionVerified) {
      return {
        ok: false,
        action,
        denied: true,
        requiresVerification: true,
        reply: this.adminVerificationPrompt(ctx.language),
      };
    }

    switch (action) {
      case 'GET_AVAILABILITY':
        return this.getAvailability(ctx);
      case 'START_BOOKING':
        return { ok: true, action, reply: '', route: 'BOOKING' };
      case 'GET_MY_RECORDS':
        return this.getMyRecords(ctx);
      case 'GET_MEMBER_RECORDS':
        return this.getMemberRecords(ctx);
      case 'ESCALATE_TO_HUMAN':
        return this.escalate(ctx);
      case 'LOG_FEEDBACK':
        return this.logFeedback(ctx);
      default:
        return { ok: false, action, reply: '' };
    }
  }

  private async getAvailability(
    ctx: BotActionContext,
  ): Promise<BotActionResult> {
    const reply = await this.booking.describeAvailability(
      ctx.message,
      ctx.language,
    );
    return { ok: true, action: 'GET_AVAILABILITY', reply };
  }

  private async getMyRecords(ctx: BotActionContext): Promise<BotActionResult> {
    const scope = this.resolveScope(ctx);
    if (!this.privileges.canReadScope(ctx.actor, scope)) {
      return this.denied('GET_MY_RECORDS', ctx);
    }
    const reply = await this.memberData.handleRequest(
      { id: ctx.memberId, phoneNumber: ctx.memberPhone },
      scope,
    );
    return { ok: true, action: 'GET_MY_RECORDS', reply };
  }

  private async getMemberRecords(
    ctx: BotActionContext,
  ): Promise<BotActionResult> {
    const adminId = ctx.actor.adminId;
    if (!adminId) return this.denied('GET_MEMBER_RECORDS', ctx);

    const scope = this.resolveScope(ctx);
    if (!this.privileges.canReadScope(ctx.actor, scope)) {
      await this.audit(ctx, 'GET_MEMBER_RECORDS', 'DENIED', {
        reason: 'role_scope',
        scope,
      });
      return this.denied('GET_MEMBER_RECORDS', ctx);
    }

    const phone = this.extractPhone(ctx.entities?.memberPhone ?? ctx.message);
    if (!phone) {
      return {
        ok: false,
        action: 'GET_MEMBER_RECORDS',
        reply:
          'Send the member’s phone number (for example 0712 345 678) so I can match the record.',
      };
    }

    const member = await this.identity.lookupMemberByPhone(phone);
    if (!member) {
      await this.audit(ctx, 'GET_MEMBER_RECORDS', 'DENIED', {
        reason: 'member_not_found',
        scope,
        memberPhoneLast4: phone.slice(-4),
      });
      return {
        ok: false,
        action: 'GET_MEMBER_RECORDS',
        reply:
          'I could not find a member with that number. Check the number and try again, or use the admin dashboard.',
      };
    }

    // The verified session must be bound to this exact member. A session for a
    // different member cannot be reused just because the admin is verified.
    const boundMemberId = await this.adminAccess.getVerifiedMemberId(adminId);
    if (boundMemberId !== member.id) {
      await this.audit(ctx, 'GET_MEMBER_RECORDS', 'DENIED', {
        reason: 'session_member_mismatch',
        scope,
        memberId: member.id,
      });
      return {
        ok: false,
        action: 'GET_MEMBER_RECORDS',
        denied: true,
        requiresVerification: true,
        reply:
          'Your verified admin session is for a different member. Send the member’s phone number in admin mode to start a new verification, or EXIT and start again.',
      };
    }

    const rateLimited = await this.checkLookupRate(adminId, member.id);
    if (rateLimited) {
      await this.audit(ctx, 'GET_MEMBER_RECORDS', 'RATE_LIMITED', {
        reason: 'hourly_lookups',
        scope,
        memberId: member.id,
      });
      return {
        ok: false,
        action: 'GET_MEMBER_RECORDS',
        reply: rateLimited,
      };
    }

    const reply = await this.memberData.buildScopedReply(member.id, scope);
    const logged = await this.audit(ctx, 'GET_MEMBER_RECORDS', 'GRANTED', {
      scope,
      memberId: member.id,
      actor: this.privileges.describeActor(ctx.actor),
    });
    if (!logged) {
      return {
        ok: false,
        action: 'GET_MEMBER_RECORDS',
        reply: 'I cannot complete that lookup right now. Please try again.',
      };
    }
    return { ok: true, action: 'GET_MEMBER_RECORDS', reply };
  }

  private async escalate(ctx: BotActionContext): Promise<BotActionResult> {
    await this.prisma.botLead.create({
      data: {
        memberId: ctx.memberId,
        type: 'HUMAN_HANDOFF',
        status: 'NEW',
        notes: JSON.stringify({
          sessionId: ctx.sessionId,
          source: 'bot_action',
          message: ctx.message,
        }),
      },
    });
    const reply =
      ctx.language === 'sw'
        ? 'Nimeelewa. Nimewasilisha ombi lako kwa timu yetu ya huduma, na mtu atakufuata kwa nambari hii. Kama ni dharura, tafadhali nenda kliniki iliyo karibu mara moja.'
        : 'Understood — I have passed this to our service team and a person will follow up on this number. If this is urgent, please go to the nearest clinic right away.';
    return { ok: true, action: 'ESCALATE_TO_HUMAN', reply };
  }

  private async logFeedback(ctx: BotActionContext): Promise<BotActionResult> {
    await this.prisma.botLead.create({
      data: {
        memberId: ctx.memberId,
        type: 'FEEDBACK',
        status: 'NEW',
        notes: JSON.stringify({
          sessionId: ctx.sessionId,
          source: 'bot_action',
          message: ctx.message,
        }),
      },
    });
    const reply =
      ctx.language === 'sw'
        ? 'Asante kwa kutuambia. Nimeandika maoni yako na timu yetu itayapitia. Kama kuna jambo la haraka, niambie.'
        : 'Thank you for telling me — I have recorded this for the team to review. If there is something urgent you need right now, tell me and I will help.';
    return { ok: true, action: 'LOG_FEEDBACK', reply };
  }

  private resolveScope(ctx: BotActionContext): IntentDataScope {
    return (
      ctx.entities?.scope ??
      detectScope(ctx.message) ??
      (ctx.actor.adminSessionVerified ? 'ACCOUNT' : 'APPOINTMENTS')
    );
  }

  private async checkLookupRate(
    adminId: string,
    memberId: string,
  ): Promise<string | null> {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const total = await this.prisma.sensitiveDataAccessLog.count({
      where: {
        actorType: 'ADMIN',
        actorId: adminId,
        outcome: 'GRANTED',
        createdAt: { gte: hourAgo },
      },
    });
    if (total >= MAX_LOOKUPS_PER_HOUR) {
      return 'Hourly lookup limit reached. Please try again later.';
    }
    const perMember = await this.prisma.sensitiveDataAccessLog.count({
      where: {
        actorType: 'ADMIN',
        actorId: adminId,
        memberId,
        outcome: 'GRANTED',
        createdAt: { gte: hourAgo },
      },
    });
    if (perMember >= MAX_MEMBER_LOOKUPS_PER_HOUR) {
      return 'You have reached the lookup limit for this member. Please try again later.';
    }
    return null;
  }

  private async audit(
    ctx: BotActionContext,
    action: BotActionName,
    outcome: string,
    metadata: Record<string, unknown>,
  ): Promise<boolean> {
    const actorId = ctx.actor.adminId ?? ctx.actor.memberId;
    if (!actorId) return true;
    try {
      await this.prisma.sensitiveDataAccessLog.create({
        data: {
          actorType: ctx.actor.adminId ? 'ADMIN' : 'MEMBER',
          actorId,
          memberId:
            typeof metadata.memberId === 'string' ? metadata.memberId : null,
          scope: action,
          channel: 'WHATSAPP',
          outcome,
          metadata: {
            ...metadata,
            action,
            sessionId: ctx.sessionId,
            adminRole: ctx.actor.adminRole,
            adminSessionVerified: ctx.actor.adminSessionVerified ?? false,
          } as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to write bot action audit log: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private denied(
    action: BotActionName,
    ctx: BotActionContext,
  ): BotActionResult {
    const reply =
      ctx.language === 'sw'
        ? 'Samahani, sina ruhusa ya kufanya hivyo kwa akaunti hii. Kama wewe ni mfanyakazi, tumia hali ya admin kwa uthibitisho wa SMS.'
        : 'Sorry — I do not have permission to do that for this account. If you are a staff member, use admin mode with the SMS verification.';
    return {
      ok: false,
      action,
      denied: true,
      reply,
    };
  }

  private adminVerificationPrompt(language: 'en' | 'sw'): string {
    return language === 'sw'
      ? 'Ufikiaji wa rekodi za mwanachama mwingine unahitaji uthibitisho. Tuma ADMIN kuanza, kisha tuma nambari ya simu ya mwanachama na ujibu kwa msimbo wa SMS.'
      : 'Access to another member’s records needs verification. Send ADMIN to start, then send the member’s phone number and reply with the SMS code.';
  }

  private extractPhone(text: string): string | null {
    const digits = (text || '').replace(/[^\d]/g, '');
    if (digits.length < 9 || digits.length > 15) return null;
    if (digits.length === 6) return null;
    return digits;
  }
}
