import { chat, streamChat } from "./providers";
import type {
  LlmStreamEvent,
  ProviderConfig,
  ProviderMessage,
  ProviderTool,
} from "./types";

export interface ToolCallFn {
  (name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface ToolLoopParams {
  config: ProviderConfig;
  /** Initial conversation history + the user turn that triggers the run. */
  messages: ProviderMessage[];
  /** Tools available to the LLM (already filtered by the caller). */
  tools: ProviderTool[];
  /** Executes an MCP tool and returns its raw result. */
  callTool: ToolCallFn;
  /** Cap on assistant↔tool turns. */
  maxSteps?: number;
  signal?: AbortSignal;
}

/**
 * Provider-agnostic tool loop. Streams the assistant response, executes any
 * tool calls via `callTool`, appends their results, and continues until the
 * assistant produces a response with no more tool calls, or `maxSteps` is
 * exhausted.
 *
 * This replaces MCPAgent.streamEvents() without pulling in langchain.
 */
export async function* runToolLoop(
  params: ToolLoopParams
): AsyncGenerator<LlmStreamEvent, void, unknown> {
  const { config, tools, callTool, signal } = params;
  const maxSteps = params.maxSteps ?? 10;
  const messages: ProviderMessage[] = [...params.messages];

  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) return;

    // Buffer tool calls from this turn and assistant text so we can append
    // them to the running transcript before dispatching tools.
    const pendingToolCalls: {
      id: string;
      name: string;
      args: Record<string, unknown>;
    }[] = [];
    let assistantText = "";

    try {
      for await (const ev of streamChat({
        config,
        messages,
        tools,
        signal,
      })) {
        if (ev.type === "text-delta") {
          assistantText += ev.delta;
        } else if (ev.type === "tool-call-ready") {
          pendingToolCalls.push({
            id: ev.toolCallId,
            name: ev.toolName,
            args: ev.args,
          });
        }
        yield ev;
      }
    } catch (err) {
      yield {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    if (pendingToolCalls.length === 0) {
      // Assistant produced a final answer; we've already yielded `done`.
      return;
    }

    // Record assistant turn (text + tool calls) in conversation history.
    messages.push({
      role: "assistant",
      content: assistantText,
      toolCalls: pendingToolCalls,
    });

    // Dispatch tool calls sequentially. Sequential keeps ordering
    // deterministic and avoids provider-specific parallel-call quirks.
    for (const tc of pendingToolCalls) {
      if (signal?.aborted) return;
      let result: unknown;
      let isError = false;
      try {
        result = await callTool(tc.name, tc.args);
      } catch (err) {
        isError = true;
        result = {
          error: err instanceof Error ? err.message : String(err),
        };
      }
      // Normalize result for transmission back to the model. We strip `_meta`
      // (inspector-specific) while preserving `content` / `structuredContent`.
      const normalized = stripMeta(result);
      const payloadText =
        typeof normalized === "string"
          ? normalized
          : JSON.stringify(normalized);
      messages.push({
        role: "tool",
        content: payloadText,
        toolCallId: tc.id,
        toolName: tc.name,
        toolResult: result,
        toolIsError: isError,
      });
      yield {
        type: "tool-result",
        toolCallId: tc.id,
        toolName: tc.name,
        result,
        isError,
      };
    }
  }
}

function stripMeta(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const { _meta: _ignored, ...rest } = value as Record<string, unknown>;
    return rest;
  }
  return value;
}

/**
 * Non-streaming helper used by the server-side `handleChatRequest` path.
 * Runs the same tool loop but collects the final assistant text and tool
 * invocations into a result object.
 */
export async function runToolLoopNonStreaming(params: ToolLoopParams): Promise<{
  content: string;
  toolCalls: {
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
  }[];
}> {
  const { config, tools, callTool, signal } = params;
  const maxSteps = params.maxSteps ?? 10;
  const messages: ProviderMessage[] = [...params.messages];
  const transcriptToolCalls: {
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
  }[] = [];
  let finalText = "";

  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) break;
    const { text, toolCalls } = await chat({ config, messages, tools, signal });
    if (toolCalls.length === 0) {
      finalText = text;
      break;
    }
    messages.push({
      role: "assistant",
      content: text,
      toolCalls,
    });
    for (const tc of toolCalls) {
      let result: unknown;
      let isError = false;
      try {
        result = await callTool(tc.name, tc.args);
      } catch (err) {
        isError = true;
        result = {
          error: err instanceof Error ? err.message : String(err),
        };
      }
      transcriptToolCalls.push({
        toolName: tc.name,
        args: tc.args,
        result,
      });
      const payloadText =
        typeof result === "string" ? result : JSON.stringify(stripMeta(result));
      messages.push({
        role: "tool",
        content: payloadText,
        toolCallId: tc.id,
        toolName: tc.name,
        toolResult: result,
        toolIsError: isError,
      });
    }
  }

  return { content: finalText, toolCalls: transcriptToolCalls };
}
