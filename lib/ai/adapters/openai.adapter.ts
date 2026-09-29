import { createOpenAI } from '@ai-sdk/openai';
import { generateText as aiGenerateText } from 'ai';
import { AIAdapter, AIResponse, ModelOptions } from './base.adapter';

export class OpenAIAdapter implements AIAdapter {
  private openai: ReturnType<typeof createOpenAI>;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not defined in the environment.');
    }
    
    this.openai = createOpenAI({
      apiKey,
    });
  }

  async generateText(prompt: string, options: ModelOptions): Promise<AIResponse> {
    try {
      const model = this.openai(options.modelSlug);

      const aiOptions: Record<string, unknown> = {
        model,
        prompt,
        temperature: options.temperature,
      };
      
      if (options.maxTokens) {
        aiOptions.maxTokens = options.maxTokens;
      }

      const { text, usage } = await aiGenerateText(aiOptions as Parameters<typeof aiGenerateText>[0]);

      const u = usage as unknown as Record<string, number>;
      const promptTokens = u?.promptTokens ?? u?.inputTokens ?? 0;
      const completionTokens = u?.completionTokens ?? u?.outputTokens ?? 0;
      const totalTokens = u?.totalTokens ?? (promptTokens + completionTokens);

      return {
        text,
        usage: usage ? {
          promptTokens,
          completionTokens,
          totalTokens,
        } : undefined
      };
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  async transcribeAudio(audioBuffer: ArrayBuffer | Buffer): Promise<string> {
    throw new Error('transcribeAudio not implemented for OpenAI adapter yet.');
  }

  async textToSpeech(text: string, voiceId: string = 'alloy'): Promise<ArrayBuffer> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not defined in the environment.');
    }
    
    try {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: text,
          voice: voiceId,
          response_format: 'ogg'
        })
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`OpenAI TTS Error (${response.status}): ${errorBody}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return arrayBuffer;
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  async analyzeDocument(documentBuffer: ArrayBuffer | Buffer, prompt: string): Promise<AIResponse> {
    throw new Error('analyzeDocument not implemented for OpenAI adapter yet.');
  }

  private handleError(error: unknown): never {
    const e = error as Record<string, unknown>;
    const status = e?.statusCode ?? e?.status;
    const message = e?.message || 'Unknown provider error';
    
    if (status === 404) {
      throw new Error(`AI Provider Route Not Found (404): ${message}`);
    }
    if (status === 429) {
      throw new Error(`AI Provider Rate Limit Exceeded (429): ${message}`);
    }
    
    throw new Error(`AI Provider Error: ${message}`);
  }
}
