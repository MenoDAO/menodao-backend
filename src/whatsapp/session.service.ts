import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// ─── State Machine ────────────────────────────────────────────────────────────

export enum ChatState {
  WELCOME = 'WELCOME',
  MAIN_MENU = 'MAIN_MENU',

  // Subscription flow
  SUBSCRIPTION_VIEW = 'SUBSCRIPTION_VIEW',
  SUBSCRIPTION_SELECT_TIER = 'SUBSCRIPTION_SELECT_TIER',
  SUBSCRIPTION_SELECT_FREQUENCY = 'SUBSCRIPTION_SELECT_FREQUENCY',
  SUBSCRIPTION_AWAITING_PAYMENT = 'SUBSCRIPTION_AWAITING_PAYMENT',

  // Clinic flow
  CLINIC_PROMPT_LOCATION = 'CLINIC_PROMPT_LOCATION',
  CLINIC_RESULTS = 'CLINIC_RESULTS',

  // Claims flow
  CLAIMS_CHECK = 'CLAIMS_CHECK',
  CLAIMS_STATUS = 'CLAIMS_STATUS',

  // Dental AI
  DENTAL_AI_CHAT = 'DENTAL_AI_CHAT',

  // Escalation
  ESCALATION_OPTIONS = 'ESCALATION_OPTIONS',

  // Visit history
  VISIT_HISTORY = 'VISIT_HISTORY',

  // Referrals
  REFERRALS_VIEW = 'REFERRALS_VIEW',

  // Blockchain
  BLOCKCHAIN_VIEW = 'BLOCKCHAIN_VIEW',

  // Account settings
  ACCOUNT_SETTINGS = 'ACCOUNT_SETTINGS',
  ACCOUNT_PROFILE = 'ACCOUNT_PROFILE',
  ACCOUNT_LANGUAGE = 'ACCOUNT_LANGUAGE',
  ACCOUNT_PAYMENT_HISTORY = 'ACCOUNT_PAYMENT_HISTORY',
}

// ─── Session Interfaces ───────────────────────────────────────────────────────

export interface PendingPayment {
  contributionId: string;
  amount: number;
  /** 'BRONZE' | 'SILVER' | 'GOLD' */
  tier: string;
  isUpgrade: boolean;
  /** Incremented each poll cycle, max 12 */
  pollCount: number;
  /** Not persisted to Redis */
  pollIntervalId?: NodeJS.Timeout;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSession {
  /** E.164 format, e.g. +254712345678 */
  phoneNumber: string;
  /** null until phone lookup succeeds */
  memberId: string | null;
  state: ChatState;
  previousState: ChatState | null;
  language: 'en' | 'sw';
  /** Capped at 10 turns */
  conversationHistory: ConversationTurn[];
  pendingPayment: Omit<PendingPayment, 'pollIntervalId'> | null;
  /** Reset to 0 on any recognised input */
  unrecognisedCount: number;
  /** Unix timestamp ms */
  lastActivityAt: number;
  /** Last 50 message IDs for deduplication */
  processedMessageIds: string[];
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly redis: Redis | null;
  private readonly memoryStore = new Map<string, ChatSession>();
  private readonly SESSION_TTL = 1800; // 30 minutes
  private readonly KEY_PREFIX = 'whatsapp:session:';

  constructor(private readonly configService: ConfigService) {
    const redisUrl = configService.get<string>('REDIS_URL');
    if (redisUrl) {
      this.redis = new Redis(redisUrl);
      this.redis.on('error', (err) =>
        this.logger.error(`Redis error: ${err.message}`),
      );
    } else {
      this.redis = null;
      this.logger.warn(
        'REDIS_URL not set — using in-memory session store (not suitable for production)',
      );
    }
  }

  async get(phoneNumber: string): Promise<ChatSession | null> {
    const key = this.KEY_PREFIX + phoneNumber;
    if (this.redis) {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as ChatSession) : null;
    }
    return this.memoryStore.get(key) ?? null;
  }

  async set(phoneNumber: string, session: ChatSession): Promise<void> {
    const key = this.KEY_PREFIX + phoneNumber;
    // pollIntervalId is a runtime handle — never serialise it
    const { pendingPayment, ...rest } = session;
    const serialisable: ChatSession = {
      ...rest,
      pendingPayment: pendingPayment
        ? (({ pollIntervalId: _drop, ...p }) => p)(
            pendingPayment as PendingPayment,
          )
        : null,
    };

    if (this.redis) {
      await this.redis.set(
        key,
        JSON.stringify(serialisable),
        'EX',
        this.SESSION_TTL,
      );
    } else {
      this.memoryStore.set(key, serialisable);
      // Simulate TTL expiry for in-memory store
      setTimeout(() => {
        const current = this.memoryStore.get(key);
        if (current && current.lastActivityAt === serialisable.lastActivityAt) {
          this.memoryStore.delete(key);
        }
      }, this.SESSION_TTL * 1000);
    }
  }

  async delete(phoneNumber: string): Promise<void> {
    const key = this.KEY_PREFIX + phoneNumber;
    if (this.redis) {
      await this.redis.del(key);
    } else {
      this.memoryStore.delete(key);
    }
  }

  createFreshSession(phoneNumber: string): ChatSession {
    return {
      phoneNumber,
      memberId: null,
      state: ChatState.WELCOME,
      previousState: null,
      language: 'en',
      conversationHistory: [],
      pendingPayment: null,
      unrecognisedCount: 0,
      lastActivityAt: Date.now(),
      processedMessageIds: [],
    };
  }
}
