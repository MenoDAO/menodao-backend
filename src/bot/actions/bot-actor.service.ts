import { Injectable, Logger } from '@nestjs/common';
import { AdminWhatsappAccessService } from '../admin/admin-whatsapp-access.service';
import type { BotActor } from './bot-action.types';

/**
 * Resolves who is speaking. The default is always MEMBER — an admin phone only
 * becomes an ADMIN actor after the explicit `ADMIN` command and SMS OTP, so a
 * staff member chatting normally cannot accidentally read another member's file.
 */
@Injectable()
export class BotActorService {
  private readonly logger = new Logger(BotActorService.name);

  constructor(private readonly adminAccess: AdminWhatsappAccessService) {}

  async resolve(params: {
    memberId: string;
    memberPhone: string;
    senderId: string;
    memberName?: string | null;
  }): Promise<BotActor> {
    const { memberId, memberPhone, senderId, memberName } = params;
    try {
      const admin = await this.adminAccess.findAdminBySender(
        senderId,
        memberPhone,
      );
      if (admin) {
        const verified = await this.adminAccess.hasActiveSession(admin.id);
        return {
          kind: 'ADMIN',
          memberId,
          adminId: admin.id,
          adminUsername: admin.username,
          adminRole: admin.role,
          adminSessionVerified: verified,
          displayName: memberName ?? admin.username,
        };
      }
    } catch (error) {
      this.logger.warn(
        `Actor resolution fell back to MEMBER: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return {
      kind: 'MEMBER',
      memberId,
      displayName: memberName ?? undefined,
    };
  }
}
