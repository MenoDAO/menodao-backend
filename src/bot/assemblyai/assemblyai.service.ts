import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssemblyAI } from 'assemblyai';

export interface TranscriptionResult {
  text: string;
  languageCode?: string;
  confidence?: number;
  duration?: number;
  words?: Array<{
    text: string;
    start: number;
    end: number;
    confidence: number;
  }>;
  raw?: any;
}

import axios from 'axios';

export interface TranscriptionOptions {
  /** Preferred member language: 'en' or 'sw'. Used as a hint, not a hard lock. */
  languageHint?: string | null;
  /** Extra domain vocabulary to boost for this clinic/member. */
  keyterms?: string[];
}

@Injectable()
export class AssemblyAiService {
  private readonly logger = new Logger(AssemblyAiService.name);
  private client: AssemblyAI | null = null;

  constructor(private readonly configService: ConfigService) {
    const apiKey =
      this.configService.get<string>('ASSEMBLY_AI_API_KEY') ||
      this.configService.get<string>('ASSEMBLYAI_API_KEY');

    if (!apiKey) {
      this.logger.warn(
        'ASSEMBLY_AI_API_KEY is not configured in .env. AssemblyAI calls will fail.',
      );
    } else {
      this.client = new AssemblyAI({ apiKey });
      this.logger.log('AssemblyAI client initialized successfully.');
    }
  }

  /**
   * Transcribes an audio file from a Buffer, readable stream, or public URL.
   */
  private static readonly DEFAULT_KEYTERMS = [
    'dental',
    'dentist',
    'tooth',
    'teeth',
    'cavity',
    'caries',
    'filling',
    'root canal',
    'extraction',
    'gum',
    'gums',
    'gingivitis',
    'periodontitis',
    'plaque',
    'tartar',
    'crown',
    'bridge',
    'implant',
    'denture',
    'orthodontics',
    'braces',
    'whitening',
    'bleeding',
    'swelling',
    'abscess',
    'x-ray',
    'molar',
    'incisor',
    'canine',
    'enamel',
    'fluoride',
    'checkup',
    'cleaning',
    'sensitivity',
    'MenoDAO',
    'Dr Papi',
    'clinic',
    'appointment',
    'booking',
    'insurance',
    'package',
    'bronze',
    'silver',
    'gold',
    'member',
    'meno',
    'daktari',
    'ugonjwa',
    'maumivu',
    'kliniki',
    'tiba',
  ];

  async transcribeAudio(
    audioSource: Buffer | string,
    options: TranscriptionOptions = {},
  ): Promise<TranscriptionResult> {
    if (!this.client) {
      throw new Error(
        'AssemblyAI client is not initialized. Please provide ASSEMBLY_AI_API_KEY.',
      );
    }

    const languageHint = this.normalizeLanguageHint(options.languageHint);
    const keyterms = Array.from(
      new Set([
        ...AssemblyAiService.DEFAULT_KEYTERMS,
        ...(options.keyterms ?? []),
      ]),
    )
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 200);

    let audioHead = '';
    if (Buffer.isBuffer(audioSource)) {
      audioHead = audioSource.subarray(0, 16).toString('hex');
      const head = audioHead;
      const looksText =
        audioSource
          .subarray(0, 64)
          .toString('utf8')
          .trimStart()
          .startsWith('{') ||
        audioSource
          .subarray(0, 64)
          .toString('utf8')
          .trimStart()
          .toLowerCase()
          .startsWith('<');
      const hasKnownAudioMagic =
        audioSource.length > 4 &&
        (head.startsWith('4f676753') || // Ogg
          head.startsWith('52494646') || // RIFF/WAV
          head.startsWith('494433') || // ID3
          head.startsWith('664c6143') || // fLaC
          head.startsWith('1a45dfa3') || // WEBM/EBML
          head.startsWith('2321414d52') || // #!AMR
          (audioSource[0] === 0xff && (audioSource[1] & 0xe0) === 0xe0) || // MP3/AAC frame sync
          audioSource.subarray(4, 8).toString('hex') === '66747970'); // ftyp
      if (looksText) {
        throw new Error(
          `Unsupported audio payload (bytes=${audioSource.length}, head=${head})`,
        );
      }
      if (!hasKnownAudioMagic) {
        this.logger.warn(
          `Unrecognized audio magic for transcription (bytes=${audioSource.length}, head=${head})`,
        );
      }
      this.logger.log(
        `Audio buffer accepted for transcription (bytes=${audioSource.length}, head=${head.slice(0, 8)})`,
      );
    }

    this.logger.log(
      `Submitting audio to AssemblyAI for transcription (hint=${languageHint ?? 'auto'}, keyterms=${keyterms.length})...`,
    );

    try {
      const transcript = await this.client.transcripts.transcribe({
        audio: audioSource,
        // API now expects `speech_models` (array); `speech_model` is rejected.
        speech_models: ['universal-3-5-pro', 'universal-2'],
        // AssemblyAI rejects language_detection when language_code is set.
        // Use a hint when known; otherwise auto-detect for mixed audio.
        ...(languageHint
          ? { language_code: languageHint }
          : { language_detection: true }),
        punctuate: true,
        format_text: true,
        // Drop filler words ("um", "uh") so the transcript reads naturally.
        disfluencies: false,
        // Domain vocabulary: AssemblyAI boosts these tokens, which is the
        // biggest single accuracy gain for dental/clinic conversations
        // without paying for a custom model or a second service.
        keyterms_prompt: keyterms,
      } as any);

      if (transcript.status === 'error') {
        this.logger.error(
          `AssemblyAI transcription error: ${transcript.error}`,
        );
        throw new Error(transcript.error || 'AssemblyAI transcription failed');
      }

      this.logger.log(
        `Transcription completed successfully (${transcript.language_code || 'auto'}): "${transcript.text?.substring(0, 80)}..."`,
      );

      return {
        text: transcript.text || '',
        languageCode: transcript.language_code || undefined,
        confidence: transcript.confidence || undefined,
        duration: transcript.audio_duration || undefined,
        words: transcript.words?.map((w) => ({
          text: w.text,
          start: w.start,
          end: w.end,
          confidence: w.confidence,
        })),
        raw: transcript,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to transcribe audio via AssemblyAI: ${msg}`);
      if (audioHead && /transcoding|file type|unsupported/i.test(msg)) {
        throw new Error(`${msg} [head=${audioHead}]`);
      }
      throw error;
    }
  }

  private normalizeLanguageHint(value?: string | null): string | null {
    const normalized = (value || '').trim().toLowerCase();
    if (
      normalized === 'sw' ||
      normalized === 'swahili' ||
      normalized === 'kiswahili'
    ) {
      return 'sw';
    }
    if (normalized === 'en' || normalized === 'english') {
      return 'en';
    }
    return null;
  }

  /**
   * Generates a temporary authentication token for real-time WebSocket streaming from the browser.
   */
  async createTemporaryToken(expiresInSeconds = 480): Promise<string> {
    if (!this.client) {
      throw new Error(
        'AssemblyAI client is not initialized. Please provide ASSEMBLY_AI_API_KEY.',
      );
    }

    this.logger.log(
      'Generating temporary AssemblyAI realtime streaming token...',
    );
    try {
      // Use v3 Streaming API token generation
      if (
        this.client.streaming &&
        typeof this.client.streaming.createTemporaryToken === 'function'
      ) {
        return await this.client.streaming.createTemporaryToken({
          expires_in_seconds: expiresInSeconds,
        });
      }
      // Fallback to legacy realtime if streaming is not available
      return await this.client.realtime.createTemporaryToken({
        expires_in: expiresInSeconds,
      });
    } catch (error) {
      this.logger.error(
        `Failed to generate temporary AssemblyAI token: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  /**
   * Generates a temporary authentication token for AssemblyAI Voice Agent API (wss://agents.assemblyai.com/v1/ws).
   */
  async createVoiceAgentToken(
    expiresInSeconds = 300,
    maxSessionDurationSeconds = 8640,
  ): Promise<string> {
    const apiKey =
      this.configService.get<string>('ASSEMBLY_AI_API_KEY') ||
      this.configService.get<string>('ASSEMBLYAI_API_KEY');

    if (!apiKey) {
      throw new Error('ASSEMBLY_AI_API_KEY is not configured in .env.');
    }

    this.logger.log('Generating AssemblyAI Voice Agent API token...');
    try {
      const response = await axios.get(
        `https://agents.assemblyai.com/v1/token?expires_in_seconds=${expiresInSeconds}&max_session_duration_seconds=${maxSessionDurationSeconds}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 10000,
        },
      );

      const token = (response.data as { token?: string } | undefined)?.token;
      if (!token) {
        throw new Error('No token returned in Voice Agent API response.');
      }
      return token;
    } catch (error) {
      const details = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : String(error);
      this.logger.error(`Failed to generate Voice Agent token: ${details}`);
      throw error;
    }
  }
}
