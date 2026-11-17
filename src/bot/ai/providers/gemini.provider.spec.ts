import type { ConfigService } from '@nestjs/config';
import { GeminiProvider } from './gemini.provider';

interface GenerateArgs {
  model: string;
  contents?: unknown;
  config?: unknown;
}

type GenerateResult = { text?: string };

function providerError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function build(env: Record<string, string> = {}) {
  const config = {
    get: (name: string) => env[name],
  } as unknown as ConfigService;
  const provider = new GeminiProvider(config);
  const generateContent = jest.fn<Promise<GenerateResult>, [GenerateArgs]>();
  // Skip the real SDK client; the provider only needs models.generateContent.
  (provider as unknown as { client: unknown }).client = {
    models: { generateContent },
  };
  return { provider, generateContent };
}

const options = {
  systemPrompt: 'be helpful',
  userPrompt: 'hello',
};

describe('GeminiProvider resilience', () => {
  it('retries once on an overloaded model before answering', async () => {
    const { provider, generateContent } = build({ GEMINI_MODEL: 'm1' });
    generateContent
      .mockRejectedValueOnce(providerError(503, 'high demand'))
      .mockResolvedValueOnce({ text: '  OK  ' });

    await expect(provider.generateCompletion(options)).resolves.toBe('OK');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('moves to the next model when one stays overloaded', async () => {
    const { provider, generateContent } = build({
      GEMINI_MODEL: 'm1',
      GEMINI_FALLBACK_MODELS: 'm2',
    });
    generateContent.mockImplementation((args) =>
      args.model === 'm2'
        ? Promise.resolve({ text: 'from m2' })
        : Promise.reject(providerError(503, 'high demand')),
    );

    await expect(provider.generateCompletion(options)).resolves.toBe('from m2');
    expect(generateContent.mock.calls.map(([args]) => args.model)).toEqual([
      'm1',
      'm1',
      'm2',
    ]);
  });

  it('stops waiting on a hung model and uses the fallback', async () => {
    const { provider, generateContent } = build({
      GEMINI_MODEL: 'm1',
      GEMINI_FALLBACK_MODELS: 'm2',
      BOT_LLM_TIMEOUT_MS: '50',
    });
    generateContent.mockImplementation((args) =>
      args.model === 'm2'
        ? Promise.resolve({ text: 'from m2' })
        : new Promise<GenerateResult>(() => undefined),
    );

    await expect(provider.generateCompletion(options)).resolves.toBe('from m2');
  });

  it('does not burn fallbacks on a request the model rejected outright', async () => {
    const { provider, generateContent } = build({
      GEMINI_MODEL: 'm1',
      GEMINI_FALLBACK_MODELS: 'm2',
    });
    generateContent.mockRejectedValue(providerError(400, 'bad request'));

    await expect(provider.generateCompletion(options)).rejects.toThrow(
      'bad request',
    );
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
