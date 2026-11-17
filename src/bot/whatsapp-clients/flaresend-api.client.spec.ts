import { ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import type { ConfigService } from '@nestjs/config';
import type { BotInstanceStore } from '../instances/bot-instance.store';
import { FlaresendApiClient } from './flaresend-api.client';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

/** Minimal shape axios.isAxiosError accepts in these tests. */
function httpError(status: number, data: Record<string, unknown> = {}) {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: { status, data },
  };
}

const env: Record<string, string> = {
  FLARESEND_BASE_URL: 'https://api.flaresend.com',
  FLARESEND_API_KEY: 'account-key',
  FLARESEND_EMAIL: 'bot@example.com',
  FLARESEND_PASSWORD: 'not-a-real-secret',
};

function build() {
  const http = {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  };
  const loginHttp = { post: jest.fn() };

  mockedAxios.create
    .mockReturnValueOnce(http as never)
    .mockReturnValueOnce(loginHttp as never);
  mockedAxios.isAxiosError.mockImplementation((error: unknown) =>
    Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
  );

  const config = {
    get: (name: string) => env[name],
  } as unknown as ConfigService;

  const client = new FlaresendApiClient(
    config,
    {} as unknown as BotInstanceStore,
  );
  return { client, http, loginHttp };
}

describe('FlaresendApiClient account session', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.create.mockReset();
    mockedAxios.isAxiosError.mockReset();
  });

  it('re-logs in and retries once when FlareSend rejects the cached session', async () => {
    const { client, http, loginHttp } = build();
    loginHttp.post
      .mockResolvedValueOnce({
        data: { apiKey: 'session-1', expires_in: 3600 },
      })
      .mockResolvedValueOnce({
        data: { apiKey: 'session-2', expires_in: 3600 },
      });
    http.get
      .mockRejectedValueOnce(httpError(401))
      .mockResolvedValueOnce({ data: { instances: [{ id: 'abc' }] } });

    await expect(client.listInstances()).resolves.toEqual([{ id: 'abc' }]);

    expect(loginHttp.post).toHaveBeenCalledTimes(2);
    expect(http.get).toHaveBeenCalledTimes(2);
    const [firstCall, retryCall] = http.get.mock.calls as unknown as [
      [string, { headers: Record<string, string> }],
      [string, { headers: Record<string, string> }],
    ];
    expect(firstCall[1].headers).toEqual({
      Authorization: 'Bearer session-1',
    });
    expect(retryCall[1].headers).toEqual({
      Authorization: 'Bearer session-2',
    });
  });

  it('retries the pairing-code call, so linking does not 500 on a dead session', async () => {
    const { client, http, loginHttp } = build();
    loginHttp.post.mockResolvedValue({
      data: { apiKey: 'session-1', expires_in: 3600 },
    });
    http.post
      .mockRejectedValueOnce(httpError(401))
      .mockResolvedValueOnce({ data: { success: true, code: 'ABCD1234' } });

    await expect(
      client.requestPairingCode('instance-1', '254765440035'),
    ).resolves.toMatchObject({ code: 'ABCD1234' });
    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it('reports an actionable error when the second login is rejected too', async () => {
    const { client, http, loginHttp } = build();
    loginHttp.post.mockResolvedValue({
      data: { apiKey: 'session-1', expires_in: 3600 },
    });
    http.get.mockRejectedValue(httpError(401));

    await expect(client.listInstances()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(loginHttp.post).toHaveBeenCalledTimes(2);
  });

  it('does not retry (or swallow) non-auth provider errors', async () => {
    const { client, http, loginHttp } = build();
    loginHttp.post.mockResolvedValue({
      data: { apiKey: 'session-1', expires_in: 3600 },
    });
    http.get.mockRejectedValueOnce(
      httpError(404, { error: 'Instance not found' }),
    );

    await expect(client.getInstance('missing')).rejects.toMatchObject({
      response: { status: 404 },
    });
    expect(loginHttp.post).toHaveBeenCalledTimes(1);
  });
});
