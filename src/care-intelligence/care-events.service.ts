import { Injectable, Logger } from '@nestjs/common';
import { CareEventType, CarePrivacyClass } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface TrackCareEventInput {
  type: CareEventType;
  memberId?: string | null;
  occurredAt?: Date;
  sessionId?: string | null;
  conversationId?: string | null;
  source?: string | null;
  county?: string | null;
  subCounty?: string | null;
  metadata?: Record<string, unknown> | null;
  privacyClass?: CarePrivacyClass;
}

@Injectable()
export class CareEventsService {
  private readonly logger = new Logger(CareEventsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Fire-and-forget event write. Never throws to callers — operational
   * flows must not fail because analytics ingestion failed.
   */
  async track(input: TrackCareEventInput): Promise<void> {
    try {
      await this.prisma.careEvent.create({
        data: {
          type: input.type,
          memberId: input.memberId || null,
          occurredAt: input.occurredAt || new Date(),
          sessionId: input.sessionId || null,
          conversationId: input.conversationId || null,
          source: input.source || null,
          county: input.county || null,
          subCounty: input.subCounty || null,
          metadata: input.metadata ? (input.metadata as object) : undefined,
          privacyClass: input.privacyClass || CarePrivacyClass.ANALYTICS,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Failed to record care event ${input.type}: ${message}`);
    }
  }
}
