/**
 * Provider-agnostic LLM types used by the inspector.
 *
 * These replace the langchain BaseMessage / StreamEvent types that the
 * inspector previously depended on. The goal is to keep the inspector free
 * of any `@langchain/*` or langchain runtime imports so that consumers of
 * `@mcp-use/inspector` (and, transitively, of mcp-use) do not need to install
 * langchain to bundle their apps.
 */

/** LLM providers supported by the native agent runtime. */
export type ProviderName =
  | "openai"
  | "openai-compatible"
  | "anthropic"
  | "google"
  | "openrouter"
  | "ollama";

/** Provider-neutral model and HTTP request configuration. */
export interface ProviderConfig {
  /** Provider implementation used for requests. */
  provider: ProviderName;
  /** Provider-specific model identifier. */
  model: string;
  /** Provider API key. Ollama may use an empty string. */
  apiKey: string;
  /** Sampling temperature forwarded to the provider. */
  temperature?: number;
  /** Maximum number of output tokens requested from the provider. */
  maxTokens?: number;
  /** Provider API base URL override. */
  baseUrl?: string;
  /** Extra HTTP headers to merge into every request (e.g. OpenRouter's HTTP-Referer). */
  extraHeaders?: Record<string, string>;
  /** Fetch credentials (e.g. `include` for session-cookie auth against a proxy). */
  credentials?: RequestCredentials;
  /** Responses API reasoning effort (direct OpenAI provider). */
  reasoningEffort?: "none" | "low" | "medium" | "high";
}

/** Image content supplied to a multimodal model. */
export interface ImageContentPart {
  /** Content discriminator. */
  type: "image";
  /** Full data URL (`data:image/png;base64,...`) or raw https URL. */
  url: string;
  /** Extracted mime type; filled in by `messageFormat` when converting. */
  mimeType?: string;
  /** Base64 payload without the data-URL prefix (when available). */
  data?: string;
}

/** Text content supplied to a model. */
export interface TextContentPart {
  /** Content discriminator. */
  type: "text";
  /** Plain-text content. */
  text: string;
}

/** Text or image content in a provider message. */
export type ContentPart = TextContentPart | ImageContentPart;

/**
 * Provider-neutral message shape. Each provider module is responsible for
 * mapping this into its wire format (OpenAI chat.completions, Anthropic
 * messages, Gemini generateContent).
 */
export interface ProviderMessage {
  /** Message role in the provider-neutral conversation. */
  role: "system" | "user" | "assistant" | "tool";
  /** Text content, OR a list of rich content parts (for multimodal input). */
  content: string | ContentPart[];
  /** Tool calls emitted by the assistant (assistant messages only). */
  toolCalls?: ProviderToolCall[];
  /** Tool result payload (tool messages only). */
  toolCallId?: string;
  /** Tool name associated with a tool result. */
  toolName?: string;
  /** Raw result returned by the MCP tool. */
  toolResult?: unknown;
  /** Whether the MCP tool reported an error. */
  toolIsError?: boolean;
}

/** Tool call requested by a model. */
export interface ProviderToolCall {
  /** Provider-generated call identifier. */
  id: string;
  /** Tool name exposed to the model. */
  name: string;
  /** Parsed tool arguments. */
  args: Record<string, unknown>;
}

/** Provider-neutral tool definition supplied to a model. */
export interface ProviderTool {
  /** Tool name exposed to the model. */
  name: string;
  /** Human-readable tool description. */
  description?: string;
  /** JSON Schema object describing the tool's input. */
  inputSchema: Record<string, unknown>;
}

/** Token counts reported by an LLM provider. */
export interface TokenUsage {
  /** Tokens read from the request. */
  inputTokens?: number;
  /** Tokens generated in the response. */
  outputTokens?: number;
  /** Total input and output tokens. */
  totalTokens?: number;
  /** Input tokens served from a provider cache. */
  cachedInputTokens?: number;
  /** Input tokens written to a provider cache. Billed, and on Anthropic above base rate. */
  cacheCreationInputTokens?: number;
  /** Tokens used for model reasoning. */
  reasoningTokens?: number;
}

/** Text emitted by the model. */
export interface LlmTextDeltaEvent {
  /** Event discriminator. */
  type: "text-delta";
  /** Incremental text. */
  delta: string;
}

/** Start of a model-requested tool call. */
export interface LlmToolCallStartEvent {
  /** Event discriminator. */
  type: "tool-call-start";
  /** Stable per-turn index for tracking parallel calls. */
  index: number;
  /** Provider-generated tool call identifier. */
  toolCallId: string;
  /** Tool name exposed to the model. */
  toolName: string;
}

/** Incremental JSON arguments for a model-requested tool call. */
export interface LlmToolCallArgsDeltaEvent {
  /** Event discriminator. */
  type: "tool-call-args-delta";
  /** Stable per-turn index for tracking parallel calls. */
  index: number;
  /** Provider-generated tool call identifier. */
  toolCallId: string;
  /** Tool name exposed to the model. */
  toolName: string;
  /** Partial JSON fragment. Concatenate all fragments before parsing. */
  argsDelta: string;
}

/** A tool call with complete, parsed arguments. */
export interface LlmToolCallReadyEvent {
  /** Event discriminator. */
  type: "tool-call-ready";
  /** Stable per-turn index for tracking parallel calls. */
  index: number;
  /** Provider-generated tool call identifier. */
  toolCallId: string;
  /** Tool name exposed to the model. */
  toolName: string;
  /** Parsed tool arguments. */
  args: Record<string, unknown>;
}

/** Result of an MCP tool invocation. */
export interface LlmToolResultEvent {
  /** Event discriminator. */
  type: "tool-result";
  /** Provider-generated tool call identifier. */
  toolCallId: string;
  /** Invoked tool name. */
  toolName: string;
  /** Raw MCP tool result. */
  result: unknown;
  /** Whether the tool reported an error. */
  isError: boolean;
}

/** Token usage reported by the provider. */
export interface LlmUsageEvent {
  /** Event discriminator. */
  type: "usage";
  /** Provider-normalized token counts. */
  usage: TokenUsage;
}

/** Error emitted during streaming. */
export interface LlmErrorEvent {
  /** Event discriminator. */
  type: "error";
  /** Human-readable error message. */
  message: string;
}

/** Indicates that the tool loop finished. */
export interface LlmDoneEvent {
  /** Event discriminator. */
  type: "done";
}

/** Provider-neutral event emitted by the native agent tool loop. */
export type LlmStreamEvent =
  | LlmTextDeltaEvent
  | LlmToolCallStartEvent
  | LlmToolCallArgsDeltaEvent
  | LlmToolCallReadyEvent
  | LlmToolResultEvent
  | LlmUsageEvent
  | LlmErrorEvent
  | LlmDoneEvent;
