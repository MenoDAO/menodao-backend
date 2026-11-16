/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- jest mock introspection */
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import { BotChatService } from './bot-chat.service';

const DAY_MS = 24 * 60 * 60 * 1000;

function buildPrisma() {
  const prisma = {
    botWhatsappInstance: {
      findFirst: jest.fn().mockResolvedValue({ id: 'instance-row-1' }),
    },
    botChatThread: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    botChatMessage: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    botMessageLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    botLlmCallLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
  };
  return prisma;
}

function buildService(
  prisma: ReturnType<typeof buildPrisma>,
  retentionDays = 730,
): BotChatService {
  const config = {
    get: (name: string) =>
      name === 'BOT_CHAT_RETENTION_DAYS' ? String(retentionDays) : undefined,
  } as unknown as ConfigService;
  return new BotChatService(prisma as unknown as PrismaService, config);
}

describe('BotChatService', () => {
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(() => {
    prisma = buildPrisma();
    prisma.botChatThread.create.mockResolvedValue({
      id: 'thread-1',
      contactId: '254713278107',
      status: 'OPEN',
      memberId: null,
      contactName: null,
    });
  });

  describe('recording', () => {
    it('opens a thread and stores the first inbound message', async () => {
      const svc = buildService(prisma);

      await svc.recordInbound({
        contactId: '254713278107',
        contactName: 'Amina',
        memberId: 'member-1',
        content: 'hello',
        providerMessageId: 'msg-1',
        instanceProviderId: 'provider-instance',
      });

      expect(prisma.botChatThread.create).toHaveBeenCalledTimes(1);
      expect(prisma.botChatMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          threadId: 'thread-1',
          direction: 'INBOUND',
          content: 'hello',
          providerMessageId: 'msg-1',
        }),
      });
      expect(prisma.botChatThread.update).toHaveBeenCalledWith({
        where: { id: 'thread-1' },
        data: expect.objectContaining({
          messageCount: { increment: 1 },
        }),
      });
    });

    it('reuses the open thread for the next message', async () => {
      prisma.botChatThread.findFirst.mockResolvedValue({
        id: 'thread-1',
        memberId: 'member-1',
        contactName: 'Amina',
      });
      const svc = buildService(prisma);

      await svc.recordOutbound({
        contactId: '254713278107',
        memberId: 'member-1',
        content: 'hi back',
      });

      expect(prisma.botChatThread.create).not.toHaveBeenCalled();
      expect(prisma.botChatMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          direction: 'OUTBOUND',
          deliveryStatus: 'SENT',
        }),
      });
    });

    it('drops a retried webhook delivery instead of duplicating it', async () => {
      prisma.botChatMessage.findFirst.mockResolvedValue({ id: 'existing' });
      const svc = buildService(prisma);

      await svc.recordInbound({
        contactId: '254713278107',
        content: 'hello',
        providerMessageId: 'msg-1',
      });

      expect(prisma.botChatMessage.create).not.toHaveBeenCalled();
      expect(prisma.botChatThread.create).not.toHaveBeenCalled();
    });

    it('sets the retention deadline from the message time', async () => {
      const svc = buildService(prisma, 30);
      const sentAt = new Date('2026-01-01T00:00:00.000Z');

      await svc.recordInbound({
        contactId: '254713278107',
        content: 'hello',
        sentAt,
      });

      const update = prisma.botChatThread.update.mock.calls[0][0];
      expect(update.data.retentionUntil.getTime()).toBe(
        sentAt.getTime() + 30 * DAY_MS,
      );
    });

    it('never throws when persistence fails', async () => {
      prisma.botChatMessage.create.mockRejectedValue(new Error('db down'));
      const svc = buildService(prisma);

      await expect(
        svc.recordInbound({ contactId: '254713278107', content: 'hello' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('retention purge', () => {
    it('deletes expired threads and reports what went', async () => {
      prisma.botChatThread.findMany.mockResolvedValue([
        { id: 'thread-a' },
        { id: 'thread-b' },
      ]);
      prisma.botChatMessage.count.mockResolvedValue(7);
      const svc = buildService(prisma);

      const result = await svc.purgeExpired(new Date('2027-01-01'));

      expect(result).toEqual({ threads: 2, messages: 7 });
      expect(prisma.botChatThread.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['thread-a', 'thread-b'] } },
      });
    });

    it('does nothing when nothing has expired', async () => {
      const svc = buildService(prisma);
      const result = await svc.purgeExpired();
      expect(result).toEqual({ threads: 0, messages: 0 });
      expect(prisma.botChatThread.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('data protection', () => {
    it('erases conversations, AI history and LLM logs for a member', async () => {
      prisma.botChatThread.findMany.mockResolvedValue([{ id: 'thread-1' }]);
      prisma.botChatMessage.count.mockResolvedValue(4);
      prisma.botMessageLog.deleteMany.mockResolvedValue({ count: 12 });
      prisma.botLlmCallLog.deleteMany.mockResolvedValue({ count: 3 });
      const svc = buildService(prisma);

      const result = await svc.eraseMember('member-1');

      expect(result).toEqual({
        threads: 1,
        messages: 4,
        aiHistoryEntries: 12,
        llmCallLogs: 3,
      });
      expect(prisma.botChatThread.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['thread-1'] } },
      });
      expect(prisma.botMessageLog.deleteMany).toHaveBeenCalledWith({
        where: { memberId: 'member-1' },
      });
      expect(prisma.botLlmCallLog.deleteMany).toHaveBeenCalledWith({
        where: { memberId: 'member-1' },
      });
    });

    it('exports a member’s conversations as one document', async () => {
      prisma.botChatThread.findMany.mockResolvedValue([
        { id: 'thread-1', messages: [{ id: 'm1' }] },
      ]);
      const svc = buildService(prisma);

      const result = await svc.exportMember('member-1');

      expect(result.memberId).toBe('member-1');
      expect(result.retention.retentionDays).toBe(730);
      expect(result.threads).toHaveLength(1);
      expect(result.generatedAt).toBeTruthy();
    });

    it('reports the retention policy in force', () => {
      const svc = buildService(prisma, 90);
      expect(svc.retentionPolicy().retentionDays).toBe(90);
    });
  });

  describe('reads', () => {
    it('returns messages oldest first', async () => {
      prisma.botChatThread.findUnique.mockResolvedValue({ id: 'thread-1' });
      prisma.botChatMessage.findMany.mockResolvedValue([
        { id: 'newest' },
        { id: 'oldest' },
      ]);
      const svc = buildService(prisma);

      const messages = await svc.listMessages('thread-1');
      expect(messages.map((m) => m.id)).toEqual(['oldest', 'newest']);
    });

    it('caps the page size', async () => {
      prisma.botChatThread.findUnique.mockResolvedValue({ id: 'thread-1' });
      const svc = buildService(prisma);

      await svc.listMessages('thread-1', { limit: 10_000 });
      expect(prisma.botChatMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 500 }),
      );
    });
  });
});
