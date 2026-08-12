import { parseSSE } from "../sse.js";
import {
  partitionToolContent,
  toolImageFollowupHeader,
  toolResultToContent,
  isToolResultError,
} from "../toolResultParts.js";
import type {
  ContentPart,
  LlmStreamEvent,
  ProviderConfig,
  ProviderMessage,
  ProviderTool,
} from "../types.js";
import {
  buildEndpoint,
  buildHeaders,
  readOpenAIError,
} from "./openai-shared.js";
import { tokenUsageFromRecord } from "../usage.js";

interface ResponsesSeed {
  instructions?: string;
  input: unknown[];
}

interface ResponsesTurnParams {
  config: ProviderConfig;
  instructions?: string;
  input: unknown[];
  tools?: ProviderTool[];
  signal?: AbortSignal;
}

function toResponsesUserContent(content: string | ContentPart[]): unknown {
  if (typeof content === "string") return content;
  return content.map((p) => {
    if (p.type === "text") return { type: "input_text", text: p.text };
    return { type: "input_image", image_url: p.url };
  });
}

/** Seed Responses `input` from prior UI/history messages (once per tool-loop run). */
export function seedInputFromMessages(
  messages: ProviderMessage[]
): ResponsesSeed {
  const systemParts: string[] = [];
  const input: unknown[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      const text =
        typeof m.content === "string"
          ? m.content
          : m.content
              .filter((p) => p.type === "text")
              .map((p) => (p as { text: string }).text)
              .join("\n");
      if (text) systemParts.push(text);
      continue;
    }
    if (m.role === "user") {
      input.push({
        role: "user",
        content: toResponsesUserContent(m.content),
      });
      continue;
    }
    if (m.role === "assistant") {
      if (typeof m.content === "string" && m.content.length > 0) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: m.content }],
        });
      }
      for (const tc of m.toolCalls ?? []) {
        input.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.name,
          arguments: JSON.stringify(tc.args),
        });
      }
      continue;
    }
    if (m.role === "tool") {
      const { text, imageParts } = partitionToolContent(m.content);
      const fallback =
        imageParts.length > 0
          ? "[image content; see next message]"
          : "[no content]";
      input.push({
        type: "function_call_output",
        call_id: m.toolCallId,
        output: text || fallback,
      });
      if (imageParts.length > 0) {
        input.push({
          role: "user",
          content: [
            {
              type: "input_text",
              text: toolImageFollowupHeader(m.toolName, imageParts.length),
            },
            ...imageParts.map((p) => ({
              type: "input_image",
              image_url: p.url,
            })),
          ],
        });
      }
    }
  }

  return {
    instructions: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    input,
  };
}

function toResponsesTools(tools: ProviderTool[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
    strict: false,
  }));
}

export function appendToolOutputsToInput(
  input: unknown[],
  callId: string,
  toolName: string | undefined,
  result: unknown
): void {
  const content = toolResultToContent(result);
  if (typeof content === "string") {
    input.push({
      type: "function_call_output",
      call_id: callId,
      output: content,
    });
    return;
  }
  const { text, imageParts } = partitionToolContent(content);
  input.push({
    type: "function_call_output",
    call_id: callId,
    output: text || "[image content; see next message]",
  });
  if (imageParts.length > 0) {
    input.push({
      role: "user",
      content: [
        {
          type: "input_text",
          text: toolImageFollowupHeader(toolName, imageParts.length),
        },
        ...imageParts.map((p) => ({
          type: "input_image",
          image_url: p.url,
        })),
      ],
    });
  }
}

function responsesReasoningFields(
  config: ProviderConfig
): Record<string, unknown> {
  const effort = config.reasoningEffort;
  // ponytail: omit reasoning.* unless caller opts in — most chat models 400 on it
  if (!effort || effort === "none") return {};
  return {
    include: ["reasoning.encrypted_content"],
    reasoning: { effort },
  };
}

function buildResponsesBody(
  params: ResponsesTurnParams,
  stream: boolean
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.config.model,
    input: params.input,
    store: false,
    stream,
    ...responsesReasoningFields(params.config),
  };
  if (params.instructions) body.instructions = params.instructions;
  if (params.tools && params.tools.length > 0) {
    body.tools = toResponsesTools(params.tools);
  }
  if (params.config.maxTokens !== undefined) {
    body.max_output_tokens = params.config.maxTokens;
  }
  return body;
}

interface FunctionCallItem {
  call_id: string;
  name: string;
  arguments: string;
}

export function extractFunctionCalls(output: unknown[]): FunctionCallItem[] {
  const calls: FunctionCallItem[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.type !== "function_call") continue;
    if (typeof row.call_id !== "string" || typeof row.name !== "string") {
      continue;
    }
    calls.push({
      call_id: row.call_id,
      name: row.name,
      arguments: typeof row.arguments === "string" ? row.arguments : "{}",
    });
  }
  return calls;
}

function extractMessageText(output: unknown[]): string {
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.type !== "message" || row.role !== "assistant") continue;
    const content = row.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "output_text" && typeof b.text === "string") {
        parts.push(b.text);
      }
    }
  }
  return parts.join("");
}

function parseArgs(argsJson: string): Record<string, unknown> {
  if (!argsJson) return {};
  try {
    return JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Map Responses SSE JSON events → LlmStreamEvent; returns output[] from response.completed. */
export async function* streamResponsesTurn(
  params: ResponsesTurnParams
): AsyncGenerator<LlmStreamEvent, unknown[], unknown> {
  const res = await fetch(buildEndpoint(params.config, "/responses"), {
    method: "POST",
    headers: buildHeaders(params.config),
    body: JSON.stringify(buildResponsesBody(params, true)),
    signal: params.signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(await readOpenAIError(res));
  }

  const callBuffers = new Map<
    string,
    { index: number; name: string; argsJson: string; started: boolean }
  >();
  let nextIndex = 0;
  let completedOutput: unknown[] = [];

  for await (const ev of parseSSE(res.body, params.signal)) {
    if (!ev.data || ev.data === "[DONE]") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(ev.data) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = typeof parsed.type === "string" ? parsed.type : ev.event;

    if (type === "response.output_text.delta") {
      const delta = parsed.delta;
      if (typeof delta === "string" && delta.length > 0) {
        yield { type: "text-delta", delta };
      }
      continue;
    }

    if (type === "response.output_item.added") {
      const item = parsed.item as Record<string, unknown> | undefined;
      if (item?.type === "function_call") {
        const callId =
          typeof item.call_id === "string" ? item.call_id : `call_${nextIndex}`;
        const name = typeof item.name === "string" ? item.name : "";
        const idx = nextIndex++;
        callBuffers.set(callId, {
          index: idx,
          name,
          argsJson: "",
          started: true,
        });
        yield {
          type: "tool-call-start",
          index: idx,
          toolCallId: callId,
          toolName: name,
        };
      }
      continue;
    }

    if (type === "response.function_call_arguments.delta") {
      const callId = typeof parsed.call_id === "string" ? parsed.call_id : "";
      const delta = typeof parsed.delta === "string" ? parsed.delta : "";
      const buf = callBuffers.get(callId);
      if (buf && delta.length > 0) {
        buf.argsJson += delta;
        yield {
          type: "tool-call-args-delta",
          index: buf.index,
          toolCallId: callId,
          toolName: buf.name,
          argsDelta: delta,
        };
      }
      continue;
    }

    if (type === "response.function_call_arguments.done") {
      const callId = typeof parsed.call_id === "string" ? parsed.call_id : "";
      const argsRaw =
        typeof parsed.arguments === "string" ? parsed.arguments : "";
      const buf = callBuffers.get(callId);
      if (buf) {
        if (argsRaw) buf.argsJson = argsRaw;
        yield {
          type: "tool-call-ready",
          index: buf.index,
          toolCallId: callId,
          toolName: buf.name,
          args: parseArgs(buf.argsJson || argsRaw),
        };
      }
      continue;
    }

    if (type === "response.completed") {
      const response = parsed.response as Record<string, unknown> | undefined;
      if (response && Array.isArray(response.output)) {
        completedOutput = response.output;
      }
      const usage = tokenUsageFromRecord(response?.usage);
      if (usage) {
        yield { type: "usage", usage };
      }
      continue;
    }

    if (type === "error") {
      const message =
        typeof parsed.message === "string"
          ? parsed.message
          : "OpenAI Responses stream error";
      yield { type: "error", message };
      return [];
    }
  }

  yield { type: "done" };
  return completedOutput;
}

export async function completeResponsesTurn(
  params: ResponsesTurnParams
): Promise<{
  text: string;
  output: unknown[];
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
}> {
  const res = await fetch(buildEndpoint(params.config, "/responses"), {
    method: "POST",
    headers: buildHeaders(params.config),
    body: JSON.stringify(buildResponsesBody(params, false)),
    signal: params.signal,
  });

  if (!res.ok) {
    throw new Error(await readOpenAIError(res));
  }

  const json = (await res.json()) as Record<string, unknown>;
  const status = json.status;
  if (status !== "completed" && status !== undefined) {
    throw new Error(`OpenAI response ended with status ${String(status)}`);
  }

  const output = Array.isArray(json.output) ? json.output : [];
  const fnCalls = extractFunctionCalls(output);
  const text =
    typeof json.output_text === "string"
      ? json.output_text
      : extractMessageText(output);

  return {
    text,
    output,
    toolCalls: fnCalls.map((c) => ({
      id: c.call_id,
      name: c.name,
      args: parseArgs(c.arguments),
    })),
  };
}

export { isToolResultError, responsesReasoningFields };
