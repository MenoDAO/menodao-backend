export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Inline image sent with a completion. Base64 must be raw bytes (no data URL). */
export interface LlmImageAttachment {
  mimeType: string;
  base64: string;
}

export interface GenerateResponseOptions {
  systemPrompt: string;
  userPrompt: string;
  history?: ChatHistoryMessage[];
  /** Identifies the workflow that issued this completion. */
  operation?: string;
  /** If 'json', both providers will request structured JSON output. */
  responseFormat?: 'json';
  /** Vision-capable providers attach these to the user turn. */
  images?: LlmImageAttachment[];
}

export interface ILlmProvider {
  generateCompletion(options: GenerateResponseOptions): Promise<string>;
}

export const LLM_PROVIDER = 'LLM_PROVIDER';
