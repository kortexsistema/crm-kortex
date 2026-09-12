import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText as aiGenerateText } from 'ai';
import { AIAdapter, AIResponse, ModelOptions } from './base.adapter';

export class GeminiAdapter implements AIAdapter {
  private google: ReturnType<typeof createGoogleGenerativeAI>;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined in the environment.');
    }
    
    this.google = createGoogleGenerativeAI({
      apiKey,
    });
  }

  async generateText(prompt: string, options: ModelOptions): Promise<AIResponse> {
    try {
      const model = this.google(options.modelSlug);

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

  async transcribeAudio(audioBuffer: Buffer): Promise<string> {
    throw new Error('transcribeAudio not implemented for Gemini adapter via Vercel AI SDK yet.');
  }

  async textToSpeech(text: string, voiceId: string): Promise<Buffer> {
    throw new Error('textToSpeech not implemented for Gemini adapter yet.');
  }

  async analyzeDocument(documentBuffer: Buffer, prompt: string): Promise<AIResponse> {
    throw new Error('analyzeDocument not implemented for Gemini adapter yet.');
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
