import { chat, streamChat } from "./providers/index.js";
import type {
  LlmStreamEvent,
  ProviderConfig,
  ProviderMessage,
  ProviderTool,
  ProviderToolCall,
} from "./types.js";

export interface LlmDriverStreamParams {
  messages: ProviderMessage[];
  tools: ProviderTool[];
  signal?: AbortSignal;
}

export interface LlmDriverCompleteParams extends LlmDriverStreamParams {
  messages: ProviderMessage[];
  tools: ProviderTool[];
  signal?: AbortSignal;
}

export interface LlmDriverCompleteResult {
  text: string;
  toolCalls: ProviderToolCall[];
}

/** Pluggable LLM backend for the native tool loop. */
export interface LlmDriver {
  stream(
    params: LlmDriverStreamParams
  ): AsyncGenerator<LlmStreamEvent, void, unknown>;
  complete(params: LlmDriverCompleteParams): Promise<LlmDriverCompleteResult>;
}

/** Raw fetch + SSE/NDJSON providers (default path). */
export class RestLlmDriver implements LlmDriver {
  constructor(private readonly config: ProviderConfig) {}

  stream(
    params: LlmDriverStreamParams
  ): AsyncGenerator<LlmStreamEvent, void, unknown> {
    return streamChat({
      config: this.config,
      messages: params.messages,
      tools: params.tools,
      signal: params.signal,
    });
  }

  async complete(
    params: LlmDriverCompleteParams
  ): Promise<LlmDriverCompleteResult> {
    const result = await chat({
      config: this.config,
      messages: params.messages,
      tools: params.tools,
      signal: params.signal,
    });
    return { text: result.text, toolCalls: result.toolCalls };
  }
}
