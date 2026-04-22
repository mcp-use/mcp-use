import { extractSystem, parseDataUrl } from "../messageFormat";
import { parseSSE } from "../sse";
import type {
  ContentPart,
  LlmStreamEvent,
  ProviderConfig,
  ProviderMessage,
  ProviderTool,
} from "../types";

interface ChatParams {
  config: ProviderConfig;
  messages: ProviderMessage[];
  tools?: ProviderTool[];
  signal?: AbortSignal;
}

const DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

function buildImageBlock(p: ContentPart) {
  if (p.type !== "image") return null;
  if (p.data && p.mimeType) {
    return {
      type: "image",
      source: { type: "base64", media_type: p.mimeType, data: p.data },
    };
  }
  const parsed = parseDataUrl(p.url);
  if (parsed) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: parsed.mimeType,
        data: parsed.data,
      },
    };
  }
  // Assume it's a remote URL; Anthropic supports url sources too.
  return { type: "image", source: { type: "url", url: p.url } };
}

function toAnthropicContent(content: string | ContentPart[]): unknown {
  if (typeof content === "string") {
    return [{ type: "text", text: content || "[no content]" }];
  }
  const blocks: unknown[] = [];
  for (const p of content) {
    if (p.type === "text") {
      if (p.text) blocks.push({ type: "text", text: p.text });
    } else {
      const img = buildImageBlock(p);
      if (img) blocks.push(img);
    }
  }
  if (blocks.length === 0) blocks.push({ type: "text", text: "[no content]" });
  return blocks;
}

function toAnthropicMessages(messages: ProviderMessage[]): unknown[] {
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      // Anthropic packs tool results into a user message.
      const last = out[out.length - 1];
      const block = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content:
          typeof m.content === "string"
            ? m.content
            : JSON.stringify(m.toolResult ?? m.content),
        ...(m.toolIsError ? { is_error: true } : {}),
      };
      if (last && last.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }
    if (m.role === "assistant") {
      const blocks: any[] = [];
      const textContent =
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content.map((p) => (p.type === "text" ? p.text : "")).join("")
            : "";
      if (textContent) blocks.push({ type: "text", text: textContent });
      if (m.toolCalls?.length) {
        for (const tc of m.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.args ?? {},
          });
        }
      }
      if (blocks.length === 0) {
        blocks.push({ type: "text", text: "[no content]" });
      }
      out.push({ role: "assistant", content: blocks });
      continue;
    }
    out.push({ role: "user", content: toAnthropicContent(m.content) });
  }
  return out;
}

function buildBody(params: ChatParams, stream: boolean) {
  const { config, messages, tools } = params;
  const { system, rest } = extractSystem(messages);
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: toAnthropicMessages(rest),
    ...(stream ? { stream: true } : {}),
  };
  if (config.temperature !== undefined) body.temperature = config.temperature;
  if (system) body.system = system;
  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }
  return body;
}

export async function* streamChat(
  params: ChatParams
): AsyncGenerator<LlmStreamEvent, void, unknown> {
  const { config, signal } = params;
  const res = await fetch(DEFAULT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(buildBody(params, true)),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Anthropic request failed (${res.status} ${res.statusText}): ${text}`
    );
  }

  // Content block state by index.
  const blocks = new Map<
    number,
    {
      kind: "text" | "tool_use";
      id?: string;
      name?: string;
      argsJson: string;
      emittedStart: boolean;
    }
  >();

  for await (const ev of parseSSE(res.body, signal)) {
    let parsed: any;
    try {
      parsed = JSON.parse(ev.data);
    } catch {
      continue;
    }
    const t = parsed?.type;
    if (t === "content_block_start") {
      const idx = parsed.index as number;
      const cb = parsed.content_block ?? {};
      if (cb.type === "tool_use") {
        blocks.set(idx, {
          kind: "tool_use",
          id: cb.id,
          name: cb.name,
          argsJson: "",
          emittedStart: false,
        });
        yield {
          type: "tool-call-start",
          index: idx,
          toolCallId: cb.id,
          toolName: cb.name,
        };
        const entry = blocks.get(idx);
        if (entry) entry.emittedStart = true;
      } else {
        blocks.set(idx, {
          kind: "text",
          argsJson: "",
          emittedStart: false,
        });
      }
    } else if (t === "content_block_delta") {
      const idx = parsed.index as number;
      const d = parsed.delta ?? {};
      const entry = blocks.get(idx);
      if (!entry) continue;
      if (d.type === "text_delta" && typeof d.text === "string") {
        yield { type: "text-delta", delta: d.text };
      } else if (
        d.type === "input_json_delta" &&
        typeof d.partial_json === "string" &&
        entry.kind === "tool_use"
      ) {
        entry.argsJson += d.partial_json;
        yield {
          type: "tool-call-args-delta",
          index: idx,
          toolCallId: entry.id!,
          toolName: entry.name!,
          argsDelta: d.partial_json,
        };
      }
    } else if (t === "content_block_stop") {
      const idx = parsed.index as number;
      const entry = blocks.get(idx);
      if (entry && entry.kind === "tool_use" && entry.id && entry.name) {
        let args: Record<string, unknown> = {};
        if (entry.argsJson) {
          try {
            args = JSON.parse(entry.argsJson);
          } catch {
            args = {};
          }
        }
        yield {
          type: "tool-call-ready",
          index: idx,
          toolCallId: entry.id,
          toolName: entry.name,
          args,
        };
      }
    } else if (t === "message_stop") {
      // handled below after loop
    } else if (t === "error") {
      yield {
        type: "error",
        message: parsed?.error?.message ?? "Anthropic stream error",
      };
    }
  }
  yield { type: "done" };
}

export async function chat(params: ChatParams): Promise<{
  text: string;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
}> {
  const { config, signal } = params;
  const res = await fetch(DEFAULT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(buildBody(params, false)),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Anthropic request failed (${res.status} ${res.statusText}): ${text}`
    );
  }
  const json = await res.json();
  let text = "";
  const toolCalls: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  }[] = [];
  for (const block of json?.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        args:
          block.input && typeof block.input === "object"
            ? (block.input as Record<string, unknown>)
            : {},
      });
    }
  }
  return { text, toolCalls };
}
