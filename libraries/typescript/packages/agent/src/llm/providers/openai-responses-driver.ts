import type { ToolLoopParams } from "../toolLoop.js";
import type {
  LlmDriver,
  LlmDriverCompleteParams,
  LlmDriverCompleteResult,
  LlmDriverStreamParams,
} from "../driver.js";
import type { LlmStreamEvent, ProviderConfig } from "../types.js";
import {
  appendToolOutputsToInput,
  completeResponsesTurn,
  extractFunctionCalls,
  isToolResultError,
  seedInputFromMessages,
  streamResponsesTurn,
} from "./openai-responses.js";

/** OpenAI direct provider — Responses API only. */
export class OpenAIResponsesDriver implements LlmDriver {
  readonly managesToolLoop = true;

  constructor(private readonly config: ProviderConfig) {}

  stream(
    params: LlmDriverStreamParams
  ): AsyncGenerator<LlmStreamEvent, void, unknown> {
    return this.streamSingleTurn(params);
  }

  async complete(
    params: LlmDriverCompleteParams
  ): Promise<LlmDriverCompleteResult> {
    const { instructions, input } = seedInputFromMessages(params.messages);
    const result = await completeResponsesTurn({
      config: this.config,
      instructions,
      input,
      tools: params.tools,
      signal: params.signal,
    });
    return { text: result.text, toolCalls: result.toolCalls };
  }

  async *streamToolLoop(
    params: ToolLoopParams
  ): AsyncGenerator<LlmStreamEvent, void, unknown> {
    const { instructions, input: seeded } = seedInputFromMessages(
      params.messages
    );
    const input: unknown[] = [...seeded];
    const maxSteps = params.maxSteps ?? 10;

    for (let step = 0; step < maxSteps; step++) {
      if (params.signal?.aborted) return;

      const turn = streamResponsesTurn({
        config: this.config,
        instructions,
        input,
        tools: params.tools,
        signal: params.signal,
      });

      let output: unknown[] = [];
      for (;;) {
        const next = await turn.next();
        if (next.done) {
          output = (next.value as unknown[]) ?? [];
          break;
        }
        yield next.value;
        if (next.value.type === "error") return;
      }

      input.push(...output);
      const functionCalls = extractFunctionCalls(output);
      if (functionCalls.length === 0) return;

      for (const call of functionCalls) {
        if (params.signal?.aborted) return;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }

        let result: unknown;
        let isError = false;
        try {
          result = await params.callTool(call.name, args);
          isError = isToolResultError(result);
        } catch (err) {
          isError = true;
          result = {
            isError: true,
            error: err instanceof Error ? err.message : String(err),
          };
        }

        appendToolOutputsToInput(input, call.call_id, call.name, result);
        yield {
          type: "tool-result",
          toolCallId: call.call_id,
          toolName: call.name,
          result,
          isError,
        };
      }
    }
  }

  async runToolLoopNonStreaming(params: ToolLoopParams): Promise<{
    content: string;
    toolCalls: {
      toolName: string;
      args: Record<string, unknown>;
      result: unknown;
    }[];
  }> {
    const { instructions, input: seeded } = seedInputFromMessages(
      params.messages
    );
    const input: unknown[] = [...seeded];
    const maxSteps = params.maxSteps ?? 10;
    const transcriptToolCalls: {
      toolName: string;
      args: Record<string, unknown>;
      result: unknown;
    }[] = [];
    let finalText = "";

    for (let step = 0; step < maxSteps; step++) {
      if (params.signal?.aborted) break;

      const turn = await completeResponsesTurn({
        config: this.config,
        instructions,
        input,
        tools: params.tools,
        signal: params.signal,
      });

      input.push(...turn.output);
      if (turn.toolCalls.length === 0) {
        finalText = turn.text;
        break;
      }

      for (const tc of turn.toolCalls) {
        let result: unknown;
        let isError = false;
        try {
          result = await params.callTool(tc.name, tc.args);
          isError = isToolResultError(result);
        } catch (err) {
          isError = true;
          result = {
            isError: true,
            error: err instanceof Error ? err.message : String(err),
          };
        }
        transcriptToolCalls.push({
          toolName: tc.name,
          args: tc.args,
          result,
        });
        appendToolOutputsToInput(input, tc.id, tc.name, result);
        void isError;
      }
    }

    return { content: finalText, toolCalls: transcriptToolCalls };
  }

  private async *streamSingleTurn(
    params: LlmDriverStreamParams
  ): AsyncGenerator<LlmStreamEvent, void, unknown> {
    const { instructions, input } = seedInputFromMessages(params.messages);
    const turn = streamResponsesTurn({
      config: this.config,
      instructions,
      input,
      tools: params.tools,
      signal: params.signal,
    });
    for (;;) {
      const next = await turn.next();
      if (next.done) return;
      yield next.value;
      if (next.value.type === "error") return;
    }
  }
}
