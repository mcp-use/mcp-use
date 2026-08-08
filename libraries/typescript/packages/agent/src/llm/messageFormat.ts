import { isToolResultError, toolResultToContent } from "./toolResultParts.js";
import type { ContentPart, ProviderMessage } from "./types.js";
import type { BaseMessage } from "../agents/types.js";

/** Attachment accepted by {@link convertMessagesToProvider}. */
export interface InspectorAttachment {
  /** Attachment kind. Files that are not images are ignored. */
  type: "image" | "file";
  /** Base64-encoded attachment bytes. */
  data: string;
  /** MIME type for the encoded bytes. */
  mimeType: string;
}

/** Text or completed tool invocation in an inspector message. */
export interface InspectorMessagePart {
  /** Message part kind. */
  type: "text" | "tool-invocation";
  /** Text content when `type` is `"text"`. */
  text?: string;
  /** Invocation details when `type` is `"tool-invocation"`. */
  toolInvocation?: {
    /** Tool name. */
    toolName: string;
    /** Tool arguments. */
    args: Record<string, unknown>;
    /** Completed result. Omit while the invocation is pending. */
    result?: unknown;
  };
}

/** Structural inspector message accepted by {@link convertMessagesToProvider}. */
export interface InspectorMessageLike {
  /** Author of the message. */
  role: "user" | "assistant";
  /** Plain text or framework-specific content. */
  content: unknown;
  /** Optional message attachments. */
  attachments?: InspectorAttachment[];
  /** Optional AI SDK-style message parts. */
  parts?: InspectorMessagePart[];
}

type LangChainMessageLike = BaseMessage & {
  _getType?: () => string;
  getType?: () => string;
  type?: string;
  tool_call_id?: string;
  name?: string;
  status?: "success" | "error";
  tool_calls?: Array<{
    id?: string;
    name: string;
    args?: Record<string, unknown>;
  }>;
};

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string"
          ? part.text
          : ""
      )
      .join("");
  }
  return JSON.stringify(content ?? "");
}

function langChainMessageType(message: LangChainMessageLike): string {
  try {
    if (typeof message._getType === "function") return message._getType();
    if (typeof message.getType === "function") return message.getType();
  } catch {
    // Fall through to structural type fields.
  }
  return message.type ?? "";
}

/**
 * Converts LangChain messages into provider-neutral history.
 *
 * @param messages - LangChain history in conversation order.
 * @returns Equivalent provider messages.
 * @throws TypeError if a message has an unsupported or unknown role.
 */
export function convertExternalHistoryToProvider(
  messages: BaseMessage[]
): ProviderMessage[] {
  return messages.map((raw, index) => {
    const message = raw as LangChainMessageLike;
    const type = langChainMessageType(message);
    const content = messageText(message.content);
    if (type === "human" || type === "user") {
      return { role: "user", content };
    }
    if (type === "system") {
      return { role: "system", content };
    }
    if (type === "ai" || type === "assistant") {
      const toolCalls = message.tool_calls?.map((call, callIndex) => ({
        id: call.id ?? `external_${index}_${callIndex}`,
        name: call.name,
        args: call.args ?? {},
      }));
      return {
        role: "assistant",
        content,
        ...(toolCalls?.length ? { toolCalls } : {}),
      };
    }
    if (type === "tool") {
      const toolIsError =
        message.status === "error" || isToolResultError(message.content);
      return {
        role: "tool",
        content,
        toolCallId: message.tool_call_id ?? `external_${index}`,
        ...(message.name ? { toolName: message.name } : {}),
        toolResult: message.content,
        ...(toolIsError ? { toolIsError: true } : {}),
      };
    }
    throw new TypeError(
      `Unsupported external history message type at index ${index}: ${type || "unknown"}`
    );
  });
}

function extractText(m: InspectorMessageLike): string {
  const raw =
    typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? (m.content as Array<{ text?: string }>)
            .map((x) => x?.text ?? "")
            .join("\n")
        : JSON.stringify(m.content ?? "");
  if (raw.trim()) return raw.trim();
  if (m.parts?.length) {
    return m.parts
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!)
      .join("")
      .trim();
  }
  return "";
}

/**
 * Convert inspector chat `Message[]` to provider-neutral `ProviderMessage[]`.
 *
 * Assistant messages with completed tool invocations are expanded into an
 * assistant message (bearing `toolCalls`) followed by one `tool` message per
 * invocation carrying the serialized result. This mirrors what the inspector
 * previously built using LangChain's AIMessage + ToolMessage pair.
 *
 * @param messages - Inspector messages in conversation order.
 * @returns Provider-neutral messages, including completed tool call/result
 * pairs.
 */
export function convertMessagesToProvider(
  messages: InspectorMessageLike[]
): ProviderMessage[] {
  const out: ProviderMessage[] = [];

  messages.forEach((m, mi) => {
    if (m.role === "user") {
      const text = extractText(m) || "[no content]";
      if (m.attachments?.length) {
        const parts: ContentPart[] = [{ type: "text", text }];
        for (const a of m.attachments) {
          if (a.type === "image") {
            parts.push({
              type: "image",
              url: `data:${a.mimeType};base64,${a.data}`,
              mimeType: a.mimeType,
              data: a.data,
            });
          }
        }
        out.push({ role: "user", content: parts });
      } else {
        out.push({ role: "user", content: text });
      }
      return;
    }

    // assistant
    const toolParts = (m.parts ?? []).filter(
      (p) =>
        p.type === "tool-invocation" &&
        p.toolInvocation &&
        p.toolInvocation.result !== undefined
    );

    if (toolParts.length === 0) {
      const text = extractText(m) || "[no content]";
      out.push({ role: "assistant", content: text });
      return;
    }

    const text = extractText(m);
    const toolCalls = toolParts.map((p, i) => ({
      id: `call_${mi}_${i}_${p.toolInvocation!.toolName}`,
      name: p.toolInvocation!.toolName,
      args: p.toolInvocation!.args,
    }));
    out.push({
      role: "assistant",
      content: text,
      toolCalls,
    });
    toolParts.forEach((p, i) => {
      const result = p.toolInvocation!.result;
      out.push({
        role: "tool",
        content: toolResultToContent(result),
        toolCallId: `call_${mi}_${i}_${p.toolInvocation!.toolName}`,
        toolName: p.toolInvocation!.toolName,
        toolResult: result,
        toolIsError: isToolResultError(result),
      });
    });
  });

  return out;
}

/**
 * Extract the top-level `system` instruction (if any) from a ProviderMessage
 * list and return both the system text and the messages without it.
 *
 * Anthropic and Google do not accept a `system` role inside their `messages`
 * array; they take it as a top-level field instead.
 */
export function extractSystem(messages: ProviderMessage[]): {
  system?: string;
  rest: ProviderMessage[];
} {
  const sys: string[] = [];
  const rest: ProviderMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      if (typeof m.content === "string") sys.push(m.content);
      else if (Array.isArray(m.content)) {
        for (const p of m.content) if (p.type === "text") sys.push(p.text);
      }
    } else {
      rest.push(m);
    }
  }
  return {
    system: sys.length > 0 ? sys.join("\n\n") : undefined,
    rest,
  };
}

/**
 * Parses a base64 data URL.
 *
 * @param url - URL in `data:<mime>;base64,<payload>` form.
 * @returns The MIME type and base64 payload, or `null` for another URL form.
 */
export function parseDataUrl(
  url: string
): { mimeType: string; data: string } | null {
  const m = url.match(/^data:([^;,]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}
