import { AIAdapter } from './base.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { OpenAIAdapter } from './openai.adapter';

export type SupportedProvider = 'google' | 'openai' | 'anthropic' | 'openrouter' | 'elevenlabs';

export class AIRouter {
  static getAdapter(provider: SupportedProvider): AIAdapter {
    switch (provider) {
      case 'google':
        return new GeminiAdapter();
      case 'openai':
        return new OpenAIAdapter();
      case 'anthropic':
        throw new Error(`Adapter for provider '${provider}' is not fully implemented yet.`);
      case 'openrouter':
        throw new Error(`Adapter for provider '${provider}' is not fully implemented yet.`);
      case 'elevenlabs':
        throw new Error(`Adapter for provider '${provider}' is not fully implemented yet.`);
      default:
        throw new Error(`Unsupported AI Provider: ${provider}`);
    }
  }
}
