import {
  BadGatewayException,
  ConflictException,
  GatewayTimeoutException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { FlaresendApiClient } from '../../bot/whatsapp-clients/flaresend-api.client';
import type { BotInstanceStore } from '../../bot/instances/bot-instance.store';
import { AdminWhatsappService } from './whatsapp-instance.service';

function build() {
  const client = {
    getSubscription: jest.fn(),
    listInstances: jest.fn(),
    getInstanceStatus: jest.fn(),
    createInstance: jest.fn(),
    reconnectInstance: jest.fn().mockResolvedValue({}),
    resetInstanceSession: jest.fn().mockResolvedValue({}),
    deleteInstance: jest.fn().mockResolvedValue(undefined),
    requestPairingCode: jest.fn(),
    getInstanceQr: jest.fn(),
  };
  const store = {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn(),
    toView: jest.fn((row: unknown) => row),
    upsertFromProvider: jest.fn(),
    updateStatus: jest.fn(),
    storeApiKey: jest.fn().mockResolvedValue({}),
    activate: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
    setLabel: jest.fn(),
    setWebhookUrl: jest.fn(),
  };
  const config = {
    get: (name: string) => {
      if (name === 'FLARESEND_WEBHOOK_PATH_TOKEN') return 'webhook-token';
      if (name === 'API_BASE_URL') return 'https://dev-api.menodao.org';
      return undefined;
    },
  } as unknown as ConfigService;

  const service = new AdminWhatsappService(
    client as unknown as FlaresendApiClient,
    store as unknown as BotInstanceStore,
    config,
  );
  return { service, client, store };
}

function providerError(status: number, data: Record<string, unknown>) {
  const error = new Error(
    `Request failed with status code ${status}`,
  ) as Error & {
    isAxiosError: boolean;
    response: { status: number; data: Record<string, unknown> };
  };
  error.isAxiosError = true;
  error.response = { status, data };
  return error;
}

describe('AdminWhatsappService', () => {
  it('refuses to create an instance when the plan has no free slot', async () => {
    const { service, client, store } = build();
    store.list.mockResolvedValue([{ id: 'existing', isActive: true }]);
    client.getSubscription.mockResolvedValue({
      plan: { name: 'Basic', maxInstances: 1 },
    });

    await expect(service.create({ label: 'second' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(client.createInstance).not.toHaveBeenCalled();
  });

  it('creates, stores the key and activates the first instance', async () => {
    const { service, client, store } = build();
    store.list.mockResolvedValue([]);
    client.getSubscription.mockResolvedValue({
      plan: { name: 'Basic', maxInstances: 1 },
    });
    client.createInstance.mockResolvedValue({
      instanceId: 'prov-1',
      apiKey: 'instance-key-1234567890',
      raw: {},
    });
    store.upsertFromProvider.mockResolvedValue({ id: 'row-1' });
    store.get.mockResolvedValue({ id: 'row-1', providerId: 'prov-1' });

    await service.create({ label: 'main line' });

    expect(store.storeApiKey).toHaveBeenCalledWith(
      'row-1',
      'instance-key-1234567890',
    );
    expect(store.activate).toHaveBeenCalledWith('row-1');
  });

  it('relinks to a new number: reset, reconnect, then pairing code', async () => {
    const { service, client, store } = build();
    store.get.mockResolvedValue({ id: 'row-1', providerId: 'prov-1' });
    client.requestPairingCode.mockResolvedValue({ code: 'ABC123XY', raw: {} });
    store.updateStatus.mockResolvedValue({
      id: 'row-1',
      status: 'AWAITING_SCAN',
    });

    const result = await service.relink('row-1', '+254 713 278 107');

    expect(client.resetInstanceSession).toHaveBeenCalledWith('prov-1');
    expect(client.reconnectInstance).toHaveBeenCalledWith('prov-1');
    expect(client.requestPairingCode).toHaveBeenCalledWith(
      'prov-1',
      '254713278107',
    );
    expect(store.updateStatus).toHaveBeenCalledWith(
      'row-1',
      'AWAITING_SCAN',
      '254713278107',
    );
    expect(result.pairingCode).toBe('ABC123XY');
  });

  it('refuses to activate an instance with no stored key', async () => {
    const { service, store } = build();
    store.get.mockResolvedValue({
      id: 'row-1',
      providerId: 'prov-1',
      apiKeyCipher: null,
    });

    await expect(service.activate('row-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('surfaces the webhook URL the operator must paste into FlareSend', async () => {
    const { service, client, store } = build();
    store.list.mockResolvedValue([
      { id: 'row-1', isActive: true, providerId: 'prov-1' },
    ]);
    client.getSubscription.mockResolvedValue({
      plan: { name: 'Basic', maxInstances: 2, maxApiCalls: 5000 },
      status: 'active',
      endsAt: '2026-12-14T18:06:25+03:00',
    });

    const overview = await service.overview();

    expect(overview.webhookUrl).toBe(
      'https://dev-api.menodao.org/bot/webhook/flaresend/webhook-token',
    );
    expect(overview.slotsUsed).toBe(1);
    expect(overview.slotsRemaining).toBe(1);
    expect(overview.plan.name).toBe('Basic');
  });

  it('imports provider instances during a sync', async () => {
    const { service, client, store } = build();
    client.listInstances.mockResolvedValue([
      { id: 'prov-1', status: 'connected', whatsapp_user_id: '254713278107' },
      { id: 'prov-2', status: 'disconnected' },
    ]);
    store.list.mockResolvedValue([]);
    client.getSubscription.mockResolvedValue({ plan: { maxInstances: 2 } });

    await service.sync();

    expect(store.upsertFromProvider).toHaveBeenCalledTimes(2);
    expect(store.upsertFromProvider).toHaveBeenCalledWith({
      providerId: 'prov-1',
      status: 'CONNECTED',
      phoneNumber: '254713278107',
      label: null,
    });
  });

  it('deletes locally even when the provider delete fails', async () => {
    const { service, client, store } = build();
    store.get.mockResolvedValue({ id: 'row-1', providerId: 'prov-1' });
    client.deleteInstance.mockRejectedValue(new Error('404'));

    await service.remove('row-1');
    expect(store.remove).toHaveBeenCalledWith('row-1');
  });

  it('turns a dead provider session into an actionable error, not a 500', async () => {
    const { service, client, store } = build();
    store.get.mockResolvedValue({ id: 'row-1', providerId: 'prov-1' });
    client.requestPairingCode.mockRejectedValue(
      providerError(401, { error: 'Unauthorized' }),
    );

    await expect(
      service.pairingCode('row-1', '254765440035'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('explains that the instance disappeared upstream', async () => {
    const { service, client, store } = build();
    store.get.mockResolvedValue({ id: 'row-1', providerId: 'prov-1' });
    client.requestPairingCode.mockRejectedValue(
      providerError(404, { error: 'Instance not found' }),
    );

    await expect(
      service.pairingCode('row-1', '254765440035'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('passes our own validation errors through untouched', async () => {
    const { service, client, store } = build();
    store.get.mockResolvedValue({ id: 'row-1', providerId: 'prov-1' });

    await expect(service.pairingCode('row-1', '')).rejects.toBeInstanceOf(
      Error,
    );
    expect(client.requestPairingCode).not.toHaveBeenCalled();
  });

  it('turns a provider timeout into a retry-later message', async () => {
    const { service, client, store } = build();
    store.get.mockResolvedValue({ id: 'row-1', providerId: 'prov-1' });
    const timeout = new Error('timeout of 45000ms exceeded') as Error & {
      isAxiosError: boolean;
      code: string;
    };
    timeout.isAxiosError = true;
    timeout.code = 'ECONNABORTED';
    client.requestPairingCode.mockRejectedValue(timeout);

    await expect(
      service.pairingCode('row-1', '254765440035'),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('reads live provider status in the overview so a finished pairing shows up', async () => {
    const { service, client, store } = build();
    store.list.mockResolvedValue([
      {
        id: 'row-1',
        providerId: 'prov-1',
        status: 'INITIALIZING',
        isActive: true,
        lastCheckedAt: new Date(Date.now() - 60_000),
      },
    ]);
    client.getSubscription.mockResolvedValue({
      plan: { name: 'Basic', maxInstances: 1 },
    });
    client.getInstanceStatus.mockResolvedValue({
      status: 'connected',
      phoneNumber: '254765440035',
    });
    store.updateStatus.mockResolvedValue({
      id: 'row-1',
      providerId: 'prov-1',
      status: 'CONNECTED',
      isActive: true,
      phoneNumber: '254765440035',
      lastCheckedAt: new Date(),
    });

    const overview = await service.overview();

    expect(client.getInstanceStatus).toHaveBeenCalledWith('prov-1');
    expect(store.updateStatus).toHaveBeenCalledWith(
      'row-1',
      'CONNECTED',
      '254765440035',
    );
    expect(overview.instances[0].status).toBe('CONNECTED');
  });

  it('does not call the provider for a status checked seconds ago', async () => {
    const { service, client, store } = build();
    store.list.mockResolvedValue([
      {
        id: 'row-1',
        providerId: 'prov-1',
        status: 'CONNECTED',
        isActive: true,
        lastCheckedAt: new Date(),
      },
    ]);
    client.getSubscription.mockResolvedValue({ plan: { name: 'Basic' } });

    await service.overview();

    expect(client.getInstanceStatus).not.toHaveBeenCalled();
  });

  it('keeps the stored status when the live check fails', async () => {
    const { service, client, store } = build();
    store.list.mockResolvedValue([
      {
        id: 'row-1',
        providerId: 'prov-1',
        status: 'AWAITING_SCAN',
        isActive: true,
        lastCheckedAt: new Date(Date.now() - 60_000),
      },
    ]);
    client.getSubscription.mockResolvedValue({ plan: { name: 'Basic' } });
    client.getInstanceStatus.mockRejectedValue(new Error('ETIMEDOUT'));

    const overview = await service.overview();

    expect(store.updateStatus).not.toHaveBeenCalled();
    expect(overview.instances[0].status).toBe('AWAITING_SCAN');
  });
});
