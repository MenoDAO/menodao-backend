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
  async transcribeAudio(
    audioSource: Buffer | string,
  ): Promise<TranscriptionResult> {
    if (!this.client) {
      throw new Error(
        'AssemblyAI client is not initialized. Please provide ASSEMBLY_AI_API_KEY.',
      );
    }

    this.logger.log('Submitting audio to AssemblyAI for transcription...');

    try {
      const transcript = await this.client.transcripts.transcribe({
        audio: audioSource,
        language_detection: true,
        punctuate: true,
        format_text: true,
      });

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
      this.logger.error(
        `Failed to transcribe audio via AssemblyAI: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
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
