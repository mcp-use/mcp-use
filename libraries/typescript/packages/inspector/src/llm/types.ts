/**
 * Provider-agnostic LLM types used by the inspector.
 *
 * These replace the langchain BaseMessage / StreamEvent types that the
 * inspector previously depended on. The goal is to keep the inspector free
 * of any @langchain/* or langchain runtime imports so that consumers of
 * @mcp-use/inspector (and, transitively, of mcp-use) do not need to install
 * langchain to bundle their apps.
 */

export type ProviderName = "openai" | "anthropic" | "google";

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ImageContentPart {
  type: "image";
  /** Full data URL (`data:image/png;base64,...`) or raw https URL. */
  url: string;
  /** Extracted mime type; filled in by `messageFormat` when converting. */
  mimeType?: string;
  /** Base64 payload without the data-URL prefix (when available). */
  data?: string;
}

export interface TextContentPart {
  type: "text";
  text: string;
}

export type ContentPart = TextContentPart | ImageContentPart;

/**
 * Provider-neutral message shape. Each provider module is responsible for
 * mapping this into its wire format (OpenAI chat.completions, Anthropic
 * messages, Gemini generateContent).
 */
export interface ProviderMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** Text content, OR a list of rich content parts (for multimodal input). */
  content: string | ContentPart[];
  /** Tool calls emitted by the assistant (assistant messages only). */
  toolCalls?: ProviderToolCall[];
  /** Tool result payload (tool messages only). */
  toolCallId?: string;
  toolName?: string;
  toolResult?: unknown;
  toolIsError?: boolean;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ProviderTool {
  name: string;
  description?: string;
  /** JSON Schema object describing the tool's input. */
  inputSchema: Record<string, unknown>;
}

/**
 * Stream events emitted by the tool loop. These replace LangChain's
 * `on_chat_model_stream`, `on_tool_start`, `on_tool_end` events. The shape
 * is deliberately narrow and tailored to what the inspector UI needs.
 */
export type LlmStreamEvent =
  | { type: "text-delta"; delta: string }
  | {
      type: "tool-call-start";
      /** Stable per-turn index so multiple parallel calls can be tracked. */
      index: number;
      toolCallId: string;
      toolName: string;
    }
  | {
      type: "tool-call-args-delta";
      index: number;
      toolCallId: string;
      toolName: string;
      /** Partial JSON fragment. Concatenate across deltas, then parse. */
      argsDelta: string;
    }
  | {
      type: "tool-call-ready";
      index: number;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | { type: "error"; message: string }
  | { type: "done" };
