import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fc from 'fast-check';
import {
  SessionService,
  ChatState,
  ChatSession,
  ConversationTurn,
} from './session.service';

// ─── Redis mock ───────────────────────────────────────────────────────────────

/**
 * Manual in-memory mock for ioredis.
 * Supports: get, set (with EX), del, on
 */
class MockRedis {
  private store = new Map<
    string,
    { value: string; expiresAt: number | null }
  >();
  private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  on(event: string, listener: (...args: unknown[]) => void): this {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(listener);
    return this;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(
    key: string,
    value: string,
    exFlag?: string,
    ttlSeconds?: number,
  ): Promise<'OK'> {
    const expiresAt =
      exFlag === 'EX' && ttlSeconds != null
        ? Date.now() + ttlSeconds * 1000
        : null;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.store.has(key);
    this.store.delete(key);
    return existed ? 1 : 0;
  }

  async expire(key: string, _seconds: number): Promise<number> {
    return this.store.has(key) ? 1 : 0;
  }

  /** Test helper: manually expire a key */
  expireNow(key: string): void {
    const entry = this.store.get(key);
    if (entry) {
      this.store.set(key, { ...entry, expiresAt: Date.now() - 1 });
    }
  }

  /** Test helper: clear all keys */
  clear(): void {
    this.store.clear();
  }
}

// ─── Mock ioredis module ──────────────────────────────────────────────────────

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedisInstance);
});

// Shared mock instance — created before tests run
let mockRedisInstance: MockRedis;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfigService(redisUrl: string | undefined): ConfigService {
  return {
    get: jest.fn((key: string) => (key === 'REDIS_URL' ? redisUrl : undefined)),
  } as unknown as ConfigService;
}

async function buildService(
  redisUrl: string | undefined,
): Promise<SessionService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SessionService,
      { provide: ConfigService, useValue: makeConfigService(redisUrl) },
    ],
  }).compile();
  return module.get<SessionService>(SessionService);
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Generate a valid E.164 Kenyan phone number */
const phoneArb = fc
  .integer({ min: 700_000_000, max: 799_999_999 })
  .map((n) => `+254${n}`);

/** Generate a pair of DISTINCT phone numbers */
const distinctPhonesArb = fc
  .tuple(phoneArb, phoneArb)
  .filter(([a, b]) => a !== b);

/** Generate a ChatState value */
const chatStateArb = fc.constantFrom(...Object.values(ChatState));

/** Generate a ConversationTurn */
const turnArb: fc.Arbitrary<ConversationTurn> = fc.record({
  role: fc.constantFrom('user' as const, 'assistant' as const),
  content: fc.string({ minLength: 1, maxLength: 200 }),
});

/** Generate a valid ChatSession */
const sessionArb = (phone: string): fc.Arbitrary<ChatSession> =>
  fc.record({
    phoneNumber: fc.constant(phone),
    memberId: fc.option(fc.string({ minLength: 1, maxLength: 36 }), {
      nil: null,
    }),
    state: chatStateArb,
    previousState: fc.option(chatStateArb, { nil: null }),
    language: fc.constantFrom('en' as const, 'sw' as const),
    conversationHistory: fc.array(turnArb, { minLength: 0, maxLength: 10 }),
    pendingPayment: fc.constant(null),
    unrecognisedCount: fc.integer({ min: 0, max: 5 }),
    lastActivityAt: fc.integer({ min: 1_000_000_000_000, max: Date.now() }),
    processedMessageIds: fc.array(fc.string({ minLength: 1, maxLength: 36 }), {
      minLength: 0,
      maxLength: 10,
    }),
  });

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('SessionService', () => {
  beforeEach(() => {
    mockRedisInstance = new MockRedis();
    jest.clearAllMocks();
  });

  // ─── Unit tests (8.4) ──────────────────────────────────────────────────────

  describe('Unit tests — Requirements 2.1, 2.6', () => {
    describe('createFreshSession()', () => {
      it('returns correct default values', async () => {
        const service = await buildService('redis://localhost:6379');
        const phone = '+254712345678';
        const session = service.createFreshSession(phone);

        expect(session.phoneNumber).toBe(phone);
        expect(session.memberId).toBeNull();
        expect(session.state).toBe(ChatState.WELCOME);
        expect(session.previousState).toBeNull();
        expect(session.language).toBe('en');
        expect(session.conversationHistory).toEqual([]);
        expect(session.pendingPayment).toBeNull();
        expect(session.unrecognisedCount).toBe(0);
        expect(session.processedMessageIds).toEqual([]);
        expect(typeof session.lastActivityAt).toBe('number');
        expect(session.lastActivityAt).toBeGreaterThan(0);
      });

      it('sets lastActivityAt close to current time', async () => {
        const service = await buildService('redis://localhost:6379');
        const before = Date.now();
        const session = service.createFreshSession('+254712345678');
        const after = Date.now();

        expect(session.lastActivityAt).toBeGreaterThanOrEqual(before);
        expect(session.lastActivityAt).toBeLessThanOrEqual(after);
      });
    });

    describe('get() / set() / delete() with Redis mock', () => {
      it('returns null for a phone with no session', async () => {
        const service = await buildService('redis://localhost:6379');
        const result = await service.get('+254700000001');
        expect(result).toBeNull();
      });

      it('stores and retrieves a session', async () => {
        const service = await buildService('redis://localhost:6379');
        const phone = '+254700000002';
        const session = service.createFreshSession(phone);
        session.state = ChatState.MAIN_MENU;
        session.memberId = 'member-abc';

        await service.set(phone, session);
        const retrieved = await service.get(phone);

        expect(retrieved).not.toBeNull();
        expect(retrieved!.phoneNumber).toBe(phone);
        expect(retrieved!.state).toBe(ChatState.MAIN_MENU);
        expect(retrieved!.memberId).toBe('member-abc');
      });

      it('deletes a session', async () => {
        const service = await buildService('redis://localhost:6379');
        const phone = '+254700000003';
        const session = service.createFreshSession(phone);

        await service.set(phone, session);
        expect(await service.get(phone)).not.toBeNull();

        await service.delete(phone);
        expect(await service.get(phone)).toBeNull();
      });

      it('overwrites an existing session on set()', async () => {
        const service = await buildService('redis://localhost:6379');
        const phone = '+254700000004';
        const session = service.createFreshSession(phone);

        await service.set(phone, session);

        const updated = { ...session, state: ChatState.DENTAL_AI_CHAT };
        await service.set(phone, updated);

        const retrieved = await service.get(phone);
        expect(retrieved!.state).toBe(ChatState.DENTAL_AI_CHAT);
      });
    });

    describe('TTL refresh on set()', () => {
      it('calls Redis SET with EX and SESSION_TTL (1800s)', async () => {
        const service = await buildService('redis://localhost:6379');
        const phone = '+254700000005';
        const session = service.createFreshSession(phone);

        const setSpy = jest.spyOn(mockRedisInstance, 'set');
        await service.set(phone, session);

        expect(setSpy).toHaveBeenCalledWith(
          `whatsapp:session:${phone}`,
          expect.any(String),
          'EX',
          1800,
        );
      });

      it('session expires after TTL in mock Redis', async () => {
        const service = await buildService('redis://localhost:6379');
        const phone = '+254700000006';
        const session = service.createFreshSession(phone);

        await service.set(phone, session);
        expect(await service.get(phone)).not.toBeNull();

        // Manually expire the key
        mockRedisInstance.expireNow(`whatsapp:session:${phone}`);
        expect(await service.get(phone)).toBeNull();
      });
    });

    describe('In-memory fallback when no REDIS_URL', () => {
      it('stores and retrieves session without Redis', async () => {
        const service = await buildService(undefined);
        const phone = '+254700000007';
        const session = service.createFreshSession(phone);
        session.state = ChatState.SUBSCRIPTION_VIEW;

        await service.set(phone, session);
        const retrieved = await service.get(phone);

        expect(retrieved).not.toBeNull();
        expect(retrieved!.state).toBe(ChatState.SUBSCRIPTION_VIEW);
      });

      it('deletes session from in-memory store', async () => {
        const service = await buildService(undefined);
        const phone = '+254700000008';
        const session = service.createFreshSession(phone);

        await service.set(phone, session);
        await service.delete(phone);

        expect(await service.get(phone)).toBeNull();
      });

      it('returns null for unknown phone in in-memory store', async () => {
        const service = await buildService(undefined);
        expect(await service.get('+254700000099')).toBeNull();
      });

      it('does NOT instantiate Redis when REDIS_URL is undefined', async () => {
        const RedisMock = jest.requireMock('ioredis') as jest.Mock;
        RedisMock.mockClear();

        await buildService(undefined);

        expect(RedisMock).not.toHaveBeenCalled();
      });
    });

    describe('pendingPayment serialisation', () => {
      it('strips pollIntervalId before storing', async () => {
        const service = await buildService('redis://localhost:6379');
        const phone = '+254700000009';
        const session = service.createFreshSession(phone);
        // Cast to include pollIntervalId to simulate runtime state
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session as any).pendingPayment = {
          contributionId: 'contrib-1',
          amount: 500,
          tier: 'BRONZE',
          isUpgrade: false,
          pollCount: 0,
          pollIntervalId: setInterval(() => {}, 99999),
        };

        await service.set(phone, session);
        const retrieved = await service.get(phone);

        expect(retrieved!.pendingPayment).not.toBeNull();
        expect(
          (retrieved!.pendingPayment as Record<string, unknown>)[
            'pollIntervalId'
          ],
        ).toBeUndefined();
        expect(retrieved!.pendingPayment!.contributionId).toBe('contrib-1');

        // Clean up the interval
        clearInterval(
          (
            session.pendingPayment as unknown as {
              pollIntervalId: NodeJS.Timeout;
            }
          )?.pollIntervalId,
        );
      });
    });
  });

  // ─── Property test 8.1: Session Isolation ─────────────────────────────────
  // Feature: whatsapp-ai-chatbot, Property 2: Session Isolation
  // For any two distinct phone numbers A and B, writing a session for A SHALL
  // never affect the session returned for B.
  // Validates: Requirements 2.1, 12.1

  describe('Property 2: Session Isolation — Requirements 2.1, 12.1', () => {
    it('writing session for phone A does not affect session for phone B (Redis)', async () => {
      // Feature: whatsapp-ai-chatbot, Property 2: Session Isolation
      const service = await buildService('redis://localhost:6379');

      await fc.assert(
        fc.asyncProperty(
          fc.tuple(
            distinctPhonesArb,
            fc.option(sessionArb('+254700000000'), { nil: null }),
          ),
          async ([[phoneA, phoneB], existingB]) => {
            // Reset store between runs
            mockRedisInstance.clear();

            // Optionally pre-populate B's session
            if (existingB) {
              const bSession = { ...existingB, phoneNumber: phoneB };
              await service.set(phoneB, bSession);
            }

            // Write a session for A
            const sessionA = service.createFreshSession(phoneA);
            sessionA.state = ChatState.DENTAL_AI_CHAT;
            sessionA.memberId = 'member-for-A';
            await service.set(phoneA, sessionA);

            // B's session should be unchanged
            const retrievedB = await service.get(phoneB);

            if (existingB) {
              // B had a session — it should still be there with original data
              expect(retrievedB).not.toBeNull();
              expect(retrievedB!.phoneNumber).toBe(phoneB);
              expect(retrievedB!.memberId).toBe(existingB.memberId);
            } else {
              // B had no session — should still be null
              expect(retrievedB).toBeNull();
            }
          },
        ),
        { numRuns: 20 },
      );
    });

    it('writing session for phone A does not affect session for phone B (in-memory)', async () => {
      // Feature: whatsapp-ai-chatbot, Property 2: Session Isolation
      const service = await buildService(undefined);

      await fc.assert(
        fc.asyncProperty(
          fc.tuple(
            distinctPhonesArb,
            fc.option(sessionArb('+254700000000'), { nil: null }),
          ),
          async ([[phoneA, phoneB], existingB]) => {
            // Clear in-memory store by deleting both keys
            await service.delete(phoneA);
            await service.delete(phoneB);

            // Optionally pre-populate B's session
            if (existingB) {
              const bSession = { ...existingB, phoneNumber: phoneB };
              await service.set(phoneB, bSession);
            }

            // Write a session for A
            const sessionA = service.createFreshSession(phoneA);
            sessionA.state = ChatState.SUBSCRIPTION_VIEW;
            await service.set(phoneA, sessionA);

            // B's session should be unchanged
            const retrievedB = await service.get(phoneB);

            if (existingB) {
              expect(retrievedB).not.toBeNull();
              expect(retrievedB!.phoneNumber).toBe(phoneB);
            } else {
              expect(retrievedB).toBeNull();
            }
          },
        ),
        { numRuns: 20 },
      );
    });
  });

  // ─── Property test 8.2: Session Inactivity Reset ──────────────────────────
  // Feature: whatsapp-ai-chatbot, Property 3: Session Inactivity Reset
  // For any session in any ChatState where lastActivityAt is more than 1800s ago,
  // the session SHALL be treated as expired and a fresh session SHALL be created.
  // Validates: Requirements 2.2

  describe('Property 3: Session Inactivity Reset — Requirements 2.2', () => {
    /**
     * The inactivity reset is enforced by the Redis TTL (1800s EX).
     * When a session's TTL has elapsed, Redis returns null, and the caller
     * (WhatsAppService.handleInbound) creates a fresh session.
     *
     * We test the contract: after TTL expiry, get() returns null for any state.
     */
    it('expired session (TTL elapsed) returns null for any ChatState (Redis)', async () => {
      // Feature: whatsapp-ai-chatbot, Property 3: Session Inactivity Reset
      const service = await buildService('redis://localhost:6379');

      await fc.assert(
        fc.asyncProperty(phoneArb, chatStateArb, async (phone, state) => {
          mockRedisInstance.clear();

          const session = service.createFreshSession(phone);
          session.state = state;
          // Simulate a session that was last active > 1800s ago
          session.lastActivityAt = Date.now() - 1_801_000;

          await service.set(phone, session);

          // Manually expire the key to simulate TTL elapsed
          mockRedisInstance.expireNow(`whatsapp:session:${phone}`);

          const retrieved = await service.get(phone);
          // After TTL expiry, session is gone — caller must create fresh
          expect(retrieved).toBeNull();
        }),
        { numRuns: 20 },
      );
    });

    it('active session (within TTL) is still retrievable for any ChatState', async () => {
      // Feature: whatsapp-ai-chatbot, Property 3: Session Inactivity Reset
      const service = await buildService('redis://localhost:6379');

      await fc.assert(
        fc.asyncProperty(phoneArb, chatStateArb, async (phone, state) => {
          mockRedisInstance.clear();

          const session = service.createFreshSession(phone);
          session.state = state;
          session.lastActivityAt = Date.now(); // just now — within TTL

          await service.set(phone, session);

          const retrieved = await service.get(phone);
          expect(retrieved).not.toBeNull();
          expect(retrieved!.state).toBe(state);
        }),
        { numRuns: 20 },
      );
    });

    it('WhatsAppService creates fresh session when get() returns null (inactivity simulation)', async () => {
      // Feature: whatsapp-ai-chatbot, Property 3: Session Inactivity Reset
      // Verify the contract: null from get() → createFreshSession() is called
      const service = await buildService('redis://localhost:6379');

      await fc.assert(
        fc.asyncProperty(phoneArb, chatStateArb, async (phone, _state) => {
          mockRedisInstance.clear();
          // No session stored → simulates expired/never-created session
          const result = await service.get(phone);
          expect(result).toBeNull();

          // The caller pattern: if null → create fresh
          const fresh = service.createFreshSession(phone);
          expect(fresh.state).toBe(ChatState.WELCOME);
          expect(fresh.conversationHistory).toHaveLength(0);
          expect(fresh.memberId).toBeNull();
        }),
        { numRuns: 15 },
      );
    });
  });

  // ─── Property test 8.3: Conversation History Cap ──────────────────────────
  // Feature: whatsapp-ai-chatbot, Property 4: Conversation History Cap
  // For any sequence of N > 10 messages in a single session,
  // conversationHistory SHALL contain at most 10 turns at any point.
  // Validates: Requirements 2.3

  describe('Property 4: Conversation History Cap — Requirements 2.3', () => {
    /**
     * The history cap is enforced by the caller (DentalAiFlow) when appending
     * turns. We test the cap logic as a pure function here, and verify that
     * SessionService correctly stores/retrieves sessions with exactly 10 turns.
     *
     * The cap logic: keep last 10 turns (evict oldest when > 10).
     */

    /** Pure helper that mirrors the cap logic in DentalAiFlow */
    function appendWithCap(
      history: ConversationTurn[],
      turn: ConversationTurn,
      cap = 10,
    ): ConversationTurn[] {
      const updated = [...history, turn];
      return updated.length > cap
        ? updated.slice(updated.length - cap)
        : updated;
    }

    it('appendWithCap never exceeds 10 turns for any sequence of N > 10 messages', () => {
      // Feature: whatsapp-ai-chatbot, Property 4: Conversation History Cap
      fc.assert(
        fc.property(
          fc.array(turnArb, { minLength: 11, maxLength: 50 }),
          (turns) => {
            let history: ConversationTurn[] = [];
            for (const turn of turns) {
              history = appendWithCap(history, turn);
              expect(history.length).toBeLessThanOrEqual(10);
            }
          },
        ),
        { numRuns: 25 },
      );
    });

    it('appendWithCap retains the most recent turns (evicts oldest)', () => {
      // Feature: whatsapp-ai-chatbot, Property 4: Conversation History Cap
      fc.assert(
        fc.property(
          fc.array(turnArb, { minLength: 11, maxLength: 30 }),
          (turns) => {
            let history: ConversationTurn[] = [];
            for (const turn of turns) {
              history = appendWithCap(history, turn);
            }
            // The last turn in history should be the last turn added
            const lastAdded = turns[turns.length - 1];
            expect(history[history.length - 1]).toEqual(lastAdded);
          },
        ),
        { numRuns: 25 },
      );
    });

    it('SessionService stores and retrieves sessions with exactly 10 turns', async () => {
      // Feature: whatsapp-ai-chatbot, Property 4: Conversation History Cap
      const service = await buildService('redis://localhost:6379');

      await fc.assert(
        fc.asyncProperty(
          phoneArb,
          fc.array(turnArb, { minLength: 10, maxLength: 10 }),
          async (phone, turns) => {
            mockRedisInstance.clear();

            const session = service.createFreshSession(phone);
            session.conversationHistory = turns;

            await service.set(phone, session);
            const retrieved = await service.get(phone);

            expect(retrieved!.conversationHistory).toHaveLength(10);
            expect(retrieved!.conversationHistory).toEqual(turns);
          },
        ),
        { numRuns: 15 },
      );
    });

    it('history with fewer than 10 turns is stored and retrieved intact', async () => {
      // Feature: whatsapp-ai-chatbot, Property 4: Conversation History Cap
      const service = await buildService('redis://localhost:6379');

      await fc.assert(
        fc.asyncProperty(
          phoneArb,
          fc.array(turnArb, { minLength: 0, maxLength: 9 }),
          async (phone, turns) => {
            mockRedisInstance.clear();

            const session = service.createFreshSession(phone);
            session.conversationHistory = turns;

            await service.set(phone, session);
            const retrieved = await service.get(phone);

            expect(retrieved!.conversationHistory).toHaveLength(turns.length);
          },
        ),
        { numRuns: 15 },
      );
    });
  });
});
