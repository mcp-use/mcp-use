import { chat, streamChat, withOpenRouterConfig } from "./providers/index.js";
import type {
  LlmStreamEvent,
  ProviderConfig,
  ProviderMessage,
  ProviderTool,
  ProviderToolCall,
} from "./types.js";
import type { ToolLoopParams } from "./toolLoop.js";
import { OpenAIResponsesDriver } from "./providers/openai-responses-driver.js";

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

function isOpenRouterOpenAIModel(model: string): boolean {
  return /^~?openai\//i.test(model);
}

/** Pluggable LLM backend for the native tool loop. */
export interface LlmDriver {
  readonly managesToolLoop?: boolean;
  stream(
    params: LlmDriverStreamParams
  ): AsyncGenerator<LlmStreamEvent, void, unknown>;
  complete(params: LlmDriverCompleteParams): Promise<LlmDriverCompleteResult>;
  streamToolLoop?(
    params: ToolLoopParams
  ): AsyncGenerator<LlmStreamEvent, void, unknown>;
  runToolLoopNonStreaming?(params: ToolLoopParams): Promise<{
    content: string;
    toolCalls: {
      toolName: string;
      args: Record<string, unknown>;
      result: unknown;
    }[];
  }>;
}

export function createLlmDriver(config: ProviderConfig): LlmDriver {
  if (config.provider === "openai") {
    return new OpenAIResponsesDriver(config);
  }
  if (
    config.provider === "openrouter" &&
    isOpenRouterOpenAIModel(config.model)
  ) {
    return new OpenAIResponsesDriver(withOpenRouterConfig(config));
  }
  return new RestLlmDriver(config);
}

/** Raw fetch + SSE/NDJSON providers (non-OpenAI and legacy proxy paths). */
class RestLlmDriver implements LlmDriver {
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
