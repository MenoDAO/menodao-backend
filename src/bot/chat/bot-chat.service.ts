import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { BotChatMessage, BotChatThread } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_RETENTION_DAYS = 730; // 24 months
const INSTANCE_CACHE_TTL_MS = 60_000;

export interface RecordMessageInput {
  /** Normalised WhatsApp identity: digits, or "<id>@lid". */
  contactId: string;
  contactName?: string | null;
  memberId?: string | null;
  content: string;
  providerMessageId?: string | null;
  /** FlareSend instance id from the webhook payload, when present. */
  instanceProviderId?: string | null;
  contentType?: string;
  deliveryStatus?: string;
  sentAt?: Date;
  metadata?: Record<string, unknown> | null;
}

export interface ThreadSummary extends BotChatThread {
  messageCount: number;
}

/**
 * Durable, retention-aware conversation store for the WhatsApp bot.
 *
 * Every inbound and outbound message lands in a thread so a conversation can be
 * reviewed later (support, disputes, quality) without scraping logs. Retention
 * is a property of the thread, not a cron-only convention: each thread carries
 * its own deadline, and a daily job deletes whatever has expired.
 */
@Injectable()
export class BotChatService {
  private readonly logger = new Logger(BotChatService.name);
  private readonly retentionDays: number;
  private readonly instanceCache = new Map<
    string,
    { at: number; id: string | null }
  >();

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    const configured = Number(
      configService.get<string>('BOT_CHAT_RETENTION_DAYS'),
    );
    this.retentionDays =
      Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_RETENTION_DAYS;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Write path (bot hot path — must never break a reply)
  // ───────────────────────────────────────────────────────────────────────────

  async recordInbound(input: RecordMessageInput): Promise<void> {
    await this.record('INBOUND', {
      ...input,
      deliveryStatus: input.deliveryStatus ?? 'RECEIVED',
    });
  }

  async recordOutbound(input: RecordMessageInput): Promise<void> {
    await this.record('OUTBOUND', {
      ...input,
      deliveryStatus: input.deliveryStatus ?? 'SENT',
    });
  }

  async latestSentReply(input: {
    contactId: string;
    memberId: string;
    instanceProviderId?: string;
  }): Promise<string | null> {
    const instanceId = await this.resolveInstanceRowId(input.instanceProviderId);
    const message = await this.prisma.botChatMessage.findFirst({
      where: {
        thread: { contactId: input.contactId, memberId: input.memberId, instanceId, status: 'OPEN' },
        direction: 'OUTBOUND',
        deliveryStatus: 'SENT',
        sentAt: { gte: new Date(Date.now() - 15 * 60_000) },
      },
      orderBy: { sentAt: 'desc' },
      select: { content: true },
    });
    return message?.content ?? null;
  }

  private async record(
    direction: 'INBOUND' | 'OUTBOUND',
    input: RecordMessageInput,
  ): Promise<void> {
    if (!input.contactId || !input.content) return;
    try {
      // A retried webhook delivery must not duplicate the transcript.
      if (input.providerMessageId) {
        const duplicate = await this.prisma.botChatMessage.findFirst({
          where: { providerMessageId: input.providerMessageId },
          select: { id: true },
        });
        if (duplicate) return;
      }

      const thread = await this.resolveThread(input);
      const sentAt = input.sentAt ?? new Date();

      await this.prisma.$transaction([
        this.prisma.botChatMessage.create({
          data: {
            threadId: thread.id,
            direction,
            content: input.content,
            contentType: input.contentType ?? 'TEXT',
            deliveryStatus: input.deliveryStatus ?? 'RECEIVED',
            providerMessageId: input.providerMessageId ?? null,
            sentAt,
            metadata:
              (input.metadata as Prisma.InputJsonValue | undefined) ??
              undefined,
          },
        }),
        this.prisma.botChatThread.update({
          where: { id: thread.id },
          data: {
            lastMessageAt: sentAt,
            messageCount: { increment: 1 },
            retentionUntil: this.deadlineFrom(sentAt),
            ...(input.memberId && !thread.memberId
              ? { memberId: input.memberId }
              : {}),
            ...(input.contactName && !thread.contactName
              ? { contactName: input.contactName }
              : {}),
          },
        }),
      ]);
    } catch (error) {
      // Losing the transcript must never cost the member their reply.
      this.logger.error(
        `Failed to record ${direction.toLowerCase()} message for contact ${input.contactId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async resolveThread(
    input: RecordMessageInput,
  ): Promise<BotChatThread> {
    const instanceId = await this.resolveInstanceRowId(
      input.instanceProviderId ?? undefined,
    );

    const existing = await this.prisma.botChatThread.findFirst({
      where: {
        contactId: input.contactId,
        instanceId: instanceId ?? null,
        status: 'OPEN',
      },
      orderBy: { lastMessageAt: 'desc' },
    });
    if (existing) return existing;

    return this.prisma.botChatThread.create({
      data: {
        contactId: input.contactId,
        contactName: input.contactName ?? null,
        memberId: input.memberId ?? null,
        instanceId: instanceId ?? null,
        consentBasis: 'SERVICE_DELIVERY',
        retentionUntil: this.deadlineFrom(new Date()),
      },
    });
  }

  private async resolveInstanceRowId(
    providerId?: string,
  ): Promise<string | null> {
    const key = providerId ?? '__active__';
    const cached = this.instanceCache.get(key);
    if (cached && Date.now() - cached.at < INSTANCE_CACHE_TTL_MS) {
      return cached.id;
    }

    const row = providerId
      ? await this.prisma.botWhatsappInstance.findFirst({
          where: { provider: 'flaresend', providerId },
          select: { id: true },
        })
      : await this.prisma.botWhatsappInstance.findFirst({
          where: { isActive: true },
          select: { id: true },
        });

    const id = row?.id ?? null;
    this.instanceCache.set(key, { at: Date.now(), id });
    return id;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Read path (admin)
  // ───────────────────────────────────────────────────────────────────────────

  async listThreads(filter: {
    instanceId?: string;
    memberId?: string;
    contactId?: string;
    status?: string;
    limit?: number;
  }): Promise<BotChatThread[]> {
    return this.prisma.botChatThread.findMany({
      where: {
        ...(filter.instanceId ? { instanceId: filter.instanceId } : {}),
        ...(filter.memberId ? { memberId: filter.memberId } : {}),
        ...(filter.contactId ? { contactId: filter.contactId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      take: Math.min(Math.max(filter.limit ?? 50, 1), 200),
    });
  }

  async getThread(id: string): Promise<BotChatThread> {
    const thread = await this.prisma.botChatThread.findUnique({
      where: { id },
    });
    if (!thread) throw new NotFoundException(`Chat thread ${id} not found`);
    return thread;
  }

  async listMessages(
    threadId: string,
    options: { limit?: number; before?: Date } = {},
  ): Promise<BotChatMessage[]> {
    await this.getThread(threadId);
    const rows = await this.prisma.botChatMessage.findMany({
      where: {
        threadId,
        ...(options.before ? { sentAt: { lt: options.before } } : {}),
      },
      orderBy: { sentAt: 'desc' },
      take: Math.min(Math.max(options.limit ?? 50, 1), 500),
    });
    return rows.reverse();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Data protection
  // ───────────────────────────────────────────────────────────────────────────

  retentionPolicy(): {
    retentionDays: number;
    description: string;
  } {
    return {
      retentionDays: this.retentionDays,
      description:
        `Conversations are kept for ${this.retentionDays} days after the last ` +
        'message, then deleted by the daily purge. Erasure on request is ' +
        'available to SUPER_ADMIN and removes threads, messages and AI call logs.',
    };
  }

  /**
   * Right to erasure: removes every conversation artefact we hold for a member,
   * including the AI history and the prompt/response logs (which contain the
   * member's own words). Returns what was removed so the operator can record it.
   */
  async eraseMember(memberId: string): Promise<{
    threads: number;
    messages: number;
    aiHistoryEntries: number;
    llmCallLogs: number;
  }> {
    const threads = await this.prisma.botChatThread.findMany({
      where: { memberId },
      select: { id: true },
    });
    const threadIds = threads.map((thread) => thread.id);

    const messages = threadIds.length
      ? await this.prisma.botChatMessage.count({
          where: { threadId: { in: threadIds } },
        })
      : 0;

    if (threadIds.length) {
      // Messages go with the thread (ON DELETE CASCADE).
      await this.prisma.botChatThread.deleteMany({
        where: { id: { in: threadIds } },
      });
    }

    const aiHistory = await this.prisma.botMessageLog.deleteMany({
      where: { memberId },
    });
    const llmLogs = await this.prisma.botLlmCallLog.deleteMany({
      where: { memberId },
    });

    this.logger.warn(
      `Erased chat data for member ${memberId}: ${threadIds.length} thread(s), ` +
        `${messages} message(s), ${aiHistory.count} AI history entr(ies), ` +
        `${llmLogs.count} LLM log(s).`,
    );

    return {
      threads: threadIds.length,
      messages,
      aiHistoryEntries: aiHistory.count,
      llmCallLogs: llmLogs.count,
    };
  }

  /** Right to access / portability: everything we hold, in one JSON document. */
  async exportMember(memberId: string): Promise<{
    memberId: string;
    generatedAt: string;
    retention: { retentionDays: number };
    threads: Array<BotChatThread & { messages: BotChatMessage[] }>;
  }> {
    const threads = await this.prisma.botChatThread.findMany({
      where: { memberId },
      orderBy: { startedAt: 'asc' },
      include: {
        messages: { orderBy: { sentAt: 'asc' } },
      },
    });

    return {
      memberId,
      generatedAt: new Date().toISOString(),
      retention: { retentionDays: this.retentionDays },
      threads,
    };
  }

  /** Deletes threads whose retention deadline has passed. */
  async purgeExpired(now: Date = new Date()): Promise<{
    threads: number;
    messages: number;
  }> {
    const expired = await this.prisma.botChatThread.findMany({
      where: { retentionUntil: { lt: now } },
      select: { id: true },
    });
    if (expired.length === 0) return { threads: 0, messages: 0 };

    const threadIds = expired.map((thread) => thread.id);
    const messages = await this.prisma.botChatMessage.count({
      where: { threadId: { in: threadIds } },
    });
    await this.prisma.botChatThread.deleteMany({
      where: { id: { in: threadIds } },
    });

    this.logger.log(
      `Retention purge removed ${threadIds.length} thread(s) and ${messages} message(s).`,
    );
    return { threads: threadIds.length, messages };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runScheduledPurge(): Promise<void> {
    try {
      await this.purgeExpired();
    } catch (error) {
      this.logger.error(
        `Scheduled retention purge failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private deadlineFrom(from: Date): Date {
    return new Date(from.getTime() + this.retentionDays * 24 * 60 * 60 * 1000);
  }
}
