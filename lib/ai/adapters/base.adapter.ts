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
  transcribeAudio(audioBuffer: ArrayBuffer | Buffer): Promise<string>;
  textToSpeech(text: string, voiceId: string): Promise<ArrayBuffer>;
  analyzeDocument(documentBuffer: ArrayBuffer | Buffer, prompt: string): Promise<AIResponse>;
}
