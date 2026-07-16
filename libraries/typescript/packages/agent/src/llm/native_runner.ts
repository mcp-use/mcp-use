import type { LlmDriver } from "./driver.js";
import { runToolLoop, runToolLoopNonStreaming } from "./toolLoop.js";
import type {
  LlmStreamEvent,
  ProviderMessage,
  ProviderTool,
} from "./types.js";

export interface NativeRunOptions {
  messages: ProviderMessage[];
  tools: ProviderTool[];
  callTool: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<unknown>;
  maxSteps?: number;
  signal?: AbortSignal;
}

export interface AgentStep {
  action: {
    tool: string;
    toolInput: Record<string, unknown>;
    log: string;
  };
  observation: string;
}

/** Internal native agent runtime: loop → fetch + callTool. */
export async function* streamNativeAgent(
  driver: LlmDriver,
  options: NativeRunOptions
): AsyncGenerator<LlmStreamEvent, void, unknown> {
  yield* runToolLoop({
    driver,
    messages: options.messages,
    tools: options.tools,
    callTool: options.callTool,
    maxSteps: options.maxSteps,
    signal: options.signal,
  });
}

/** Map LlmStreamEvent stream to legacy AgentStep yields for MCPAgent.stream(). */
export async function* streamNativeAgentSteps(
  driver: LlmDriver,
  options: NativeRunOptions
): AsyncGenerator<AgentStep, string, void> {
  let finalText = "";
  let pendingStep: AgentStep | null = null;

  for await (const ev of streamNativeAgent(driver, options)) {
    if (ev.type === "text-delta") {
      finalText += ev.delta;
    } else if (ev.type === "tool-call-ready") {
      pendingStep = {
        action: {
          tool: ev.toolName,
          toolInput: ev.args,
          log: `Calling tool ${ev.toolName}`,
        },
        observation: "",
      };
      yield pendingStep;
    } else if (ev.type === "tool-result" && pendingStep) {
      const observation =
        typeof ev.result === "string"
          ? ev.result
          : JSON.stringify(ev.result ?? "");
      yield {
        action: pendingStep.action,
        observation,
      };
      pendingStep = null;
    } else if (ev.type === "error") {
      throw new Error(ev.message);
    }
  }

  return finalText;
}

export async function runNativeAgent(
  driver: LlmDriver,
  options: NativeRunOptions
): Promise<string> {
  const result = await runToolLoopNonStreaming({
    driver,
    messages: options.messages,
    tools: options.tools,
    callTool: options.callTool,
    maxSteps: options.maxSteps,
    signal: options.signal,
  });
  return result.content;
}
