export interface ModelOptions {
  modelSlug: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIResponse {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AIAdapter {
  generateText(prompt: string, options: ModelOptions): Promise<AIResponse>;
  transcribeAudio(audioBuffer: Buffer): Promise<string>;
  textToSpeech(text: string, voiceId: string): Promise<Buffer>;
  analyzeDocument(documentBuffer: Buffer, prompt: string): Promise<AIResponse>;
}
