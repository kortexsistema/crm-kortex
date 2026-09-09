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

      // @ts-ignore - maxTokens might not be in LanguageModelCallOptions in this SDK version
      const aiOptions: any = {
        model,
        prompt,
        temperature: options.temperature,
      };
      
      if (options.maxTokens) {
        aiOptions.maxTokens = options.maxTokens;
      }

      const { text, usage } = await aiGenerateText(aiOptions);

      const u = usage as any;
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
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async transcribeAudio(audioBuffer: Buffer): Promise<string> {
    throw new Error('transcribeAudio not implemented for OpenAI adapter yet.');
  }

  async textToSpeech(text: string, voiceId: string): Promise<Buffer> {
    throw new Error('textToSpeech not implemented for OpenAI adapter yet.');
  }

  async analyzeDocument(documentBuffer: Buffer, prompt: string): Promise<AIResponse> {
    throw new Error('analyzeDocument not implemented for OpenAI adapter yet.');
  }

  private handleError(error: any): never {
    const status = error?.statusCode ?? error?.status;
    const message = error?.message || 'Unknown provider error';
    
    if (status === 404) {
      throw new Error(`AI Provider Route Not Found (404): ${message}`);
    }
    if (status === 429) {
      throw new Error(`AI Provider Rate Limit Exceeded (429): ${message}`);
    }
    
    throw new Error(`AI Provider Error: ${message}`);
  }
}
