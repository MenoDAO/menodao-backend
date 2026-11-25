import { randomBytes } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import { BotInstanceSecretService } from './bot-instance-secret.service';
import { BotInstanceStore } from './bot-instance.store';

const KEY = randomBytes(32).toString('base64');
const INSTANCE_KEY = 'instance-scoped-key-1234567890';

function build(env: Record<string, string> = {}) {
  const prisma = {
    botWhatsappInstance: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const config = {
    get: (name: string) =>
      name === 'BOT_SECRET_ENCRYPTION_KEY' ? KEY : env[name],
  } as unknown as ConfigService;
  const secrets = new BotInstanceSecretService(config);
  const store = new BotInstanceStore(
    prisma as unknown as PrismaService,
    secrets,
    config,
  );
  return { store, prisma, secrets };
}

describe('BotInstanceStore', () => {
  describe('send credentials', () => {
    it('prefers the environment key for the environment-pinned instance', async () => {
      const { store, prisma, secrets } = build({
        FLARESEND_API_KEY: 'fresh-env-key',
        FLARESEND_INSTANCE_ID: 'prov-1',
      });
      prisma.botWhatsappInstance.findFirst.mockResolvedValue({
        id: 'row-1',
        providerId: 'prov-1',
        isActive: true,
        apiKeyCipher: secrets.encrypt('stale-db-key'),
      });

      const credentials = await store.getSendCredentials();
      expect(credentials).toEqual({
        providerId: 'prov-1',
        apiKey: 'fresh-env-key',
        source: 'env',
      });
    });

    it('uses the stored key for an instance added from the dashboard', async () => {
      const { store, prisma, secrets } = build({
        FLARESEND_API_KEY: 'env-key',
        FLARESEND_INSTANCE_ID: 'prov-1',
      });
      prisma.botWhatsappInstance.findFirst.mockResolvedValue({
        id: 'row-2',
        providerId: 'prov-2',
        isActive: true,
        apiKeyCipher: secrets.encrypt('dashboard-key'),
      });

      const credentials = await store.getSendCredentials();
      expect(credentials?.apiKey).toBe('dashboard-key');
      expect(credentials?.source).toBe('db');
    });

    it('falls back to the environment when nothing is active', async () => {
      const { store, prisma } = build({
        FLARESEND_API_KEY: 'env-key',
        FLARESEND_INSTANCE_ID: 'prov-1',
      });
      prisma.botWhatsappInstance.findFirst.mockResolvedValue(null);

      const credentials = await store.getSendCredentials();
      expect(credentials?.apiKey).toBe('env-key');
    });

    it('caches so a send does not query on every message', async () => {
      const { store, prisma } = build({ FLARESEND_API_KEY: 'env-key' });
      prisma.botWhatsappInstance.findFirst.mockResolvedValue(null);

      await store.getSendCredentials();
      await store.getSendCredentials();
      expect(prisma.botWhatsappInstance.findFirst).toHaveBeenCalledTimes(1);
    });

    it('returns null when neither a stored nor an environment key exists', async () => {
      const { store, prisma } = build();
      prisma.botWhatsappInstance.findFirst.mockResolvedValue(null);
      expect(await store.getSendCredentials()).toBeNull();
    });
  });

  describe('key storage', () => {
    it('stores the key encrypted, never in the clear', async () => {
      const { store, prisma } = build();
      prisma.botWhatsappInstance.update.mockResolvedValue({});

      await store.storeApiKey('row-1', INSTANCE_KEY);

      const calls = prisma.botWhatsappInstance.update.mock.calls as Array<
        [{ data: { apiKeyCipher: string } }]
      >;
      const data = calls[0][0].data;
      expect(data.apiKeyCipher).not.toContain(INSTANCE_KEY);
      expect(data.apiKeyCipher.startsWith('v1.')).toBe(true);
    });

    it('exposes a fingerprint instead of the key', () => {
      const { store, secrets } = build();
      const view = store.toView({
        id: 'row-1',
        provider: 'flaresend',
        providerId: 'prov-1',
        label: null,
        phoneNumber: null,
        status: 'CONNECTED',
        apiKeyCipher: secrets.encrypt(INSTANCE_KEY),
        webhookUrl: null,
        isActive: true,
        lastCheckedAt: null,
        lastConnectedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(view.hasStoredKey).toBe(true);
      expect(view.keyFingerprint).toHaveLength(12);
      expect(JSON.stringify(view)).not.toContain(INSTANCE_KEY);
      expect(JSON.stringify(view)).not.toContain('v1.');
    });
  });
});
