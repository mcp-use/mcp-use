import { runToolLoop } from "@mcp-use/inspector/llm/toolLoop";
import type { ProviderMessage, ProviderTool } from "@mcp-use/inspector/llm/types";
import type { AgentFlow, EvalScenario } from "./schema/suite.v1.js";
import type { CapturedToolCall } from "./toolTrace.js";
import { extractStructuredFromResult } from "./toolTrace.js";
import {
  runToolTraceAssertions,
  runResultAssertions,
  assertForbiddenTools,
  getStructuredFromCall,
} from "./scenarioAsserts.js";
import { matchWidgetFields } from "./argMatchers.js";
import { runLlmJudge, buildTranscript } from "./judge.js";
import {
  captureWidgetScreenshot,
  judgeWidgetScreenshot,
} from "./widgetScreenshot.js";
import type { ConnectedMcp } from "./mcpConnection.js";
import { addUsage, emptyUsage, type TokenUsage } from "./usage.js";

export type ScenarioRunResult = {
  scenarioId: string;
  client: string;
  model: string;
  systemPrompt: string;
  success: boolean;
  toolTracePassed: boolean;
  resultPassed: boolean;
  widgetPassed: boolean;
  judgePassed: boolean | null;
  judgeScore?: number;
  judgeReason?: string;
  toolCalls: CapturedToolCall[];
  durationMs: number;
  agentSteps: number;
  /** Combined token usage for the agent calls and any LLM judge in this scenario. */
  usage: TokenUsage;
  errors: string[];
};

function createOpenRouterConfig(modelId: string) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY required for agent scenarios");
  }
  return {
    provider: "openrouter" as const,
    model: modelId,
    apiKey,
    temperature: 0,
  };
}

export async function runScenario(params: {
  conn: ConnectedMcp;
  flow: AgentFlow;
  scenario: EvalScenario;
  model: string;
  systemPromptKey: string;
  systemPromptText: string;
  serverBaseUrl?: string;
  maxSteps: number;
  judgeModel: string;
  defaultThreshold: number;
  timeoutMs: number;
}): Promise<ScenarioRunResult> {
  const start = Date.now();
  const errors: string[] = [];
  const allToolCalls: CapturedToolCall[] = [];
  const transcriptTurns: Array<{ user: string; assistant?: string }> = [];
  const usage = emptyUsage();
  let agentSteps = 0;
  let lastAssistant = "";

  const providerConfig = createOpenRouterConfig(params.model);
  const tools = await params.conn.session.listTools();
  const providerTools: ProviderTool[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: (tool.inputSchema as Record<string, unknown> | undefined) ?? { type: "object" },
  }));

  let history: ProviderMessage[] = [{ role: "system", content: params.systemPromptText }];

  for (let turnIndex = 0; turnIndex < params.scenario.turns.length; turnIndex++) {
    const turn = params.scenario.turns[turnIndex]!;
    const pendingForTurn: CapturedToolCall[] = [];
    const callsById = new Map<string, CapturedToolCall>();
    const assistantToolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];

    try {
      let assistantText = "";
      const messages: ProviderMessage[] = [...history, { role: "user", content: turn.user }];
      for await (const step of runToolLoop({
        config: providerConfig,
        messages,
        tools: providerTools,
        callTool: (name, args) => params.conn.session.callTool(name, args),
        maxSteps: params.maxSteps,
      })) {
        if (step.type === "usage") {
          addUsage(usage, {
            promptTokens: step.promptTokens,
            completionTokens: step.completionTokens,
            totalTokens: step.totalTokens,
            costUsd: step.costUsd,
          });
          continue;
        }
        agentSteps++;
        if (step.type === "text-delta") {
          assistantText += step.delta;
          lastAssistant = assistantText;
        } else if (step.type === "tool-call-ready") {
          const call: CapturedToolCall = {
            tool: step.toolName,
            args: step.args,
            turnIndex,
          };
          pendingForTurn.push(call);
          callsById.set(step.toolCallId, call);
          assistantToolCalls.push({ id: step.toolCallId, name: step.toolName, args: step.args });
        } else if (step.type === "tool-result") {
          const call = callsById.get(step.toolCallId);
          if (call) {
            call.result = step.result;
            call.structuredContent = extractStructuredFromResult(step.result);
          }
        } else if (step.type === "error") {
          errors.push(step.message);
          }
      }
      history = [
        ...messages,
        {
          role: "assistant",
          content: assistantText || "(no response)",
          ...(assistantToolCalls.length > 0 ? { toolCalls: assistantToolCalls } : {}),
        },
      ];
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    for (const call of pendingForTurn) {
      if (call.result) continue;
      try {
        call.result = await params.conn.session.callTool(call.tool, call.args);
        call.structuredContent = extractStructuredFromResult(call.result);
      } catch (err) {
        errors.push(
          `failed to hydrate tool result for ${call.tool}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    allToolCalls.push(...pendingForTurn);
    transcriptTurns.push({ user: turn.user, assistant: lastAssistant });

    if (turn.expect?.tools?.length) {
      const tr = runToolTraceAssertions(turn.expect.tools, allToolCalls);
      if (!tr.passed) {
        errors.push(...tr.checks.filter((c) => !c.passed).map((c) => c.reason));
      }
    }

    if (turn.expect?.result) {
      const rr = await runResultAssertions(
        params.conn.session,
        turn.expect.result,
        allToolCalls
      );
      if (!rr.passed) {
        errors.push(...rr.outcomes.filter((o) => !o.passed).map((o) => o.reason));
      }
    }

    if (turn.expect?.widget?.fields) {
      const call = allToolCalls.filter((c) => c.turnIndex === turnIndex).pop();
      const sc = getStructuredFromCall(call);
      const wf = matchWidgetFields(turn.expect.widget.fields, sc);
      if (!wf.passed) errors.push(wf.reason);
    }

    if (turn.expect?.widget?.screenshot && params.serverBaseUrl) {
      const ws = turn.expect.widget.screenshot;
      const call = allToolCalls.filter((c) => c.turnIndex === turnIndex).pop();
      if (call?.result) {
        try {
          const { dataUrl } = await captureWidgetScreenshot({
            session: params.conn.session,
            serverBaseUrl: params.serverBaseUrl,
            toolName: ws.tool ?? call.tool,
            toolArgs: ws.args ?? call.args,
            toolResult: call.result,
            timeoutMs: params.timeoutMs,
          });
          const vj = await judgeWidgetScreenshot({
            rubric: ws.rubric,
            screenshotDataUrl: dataUrl,
            threshold: ws.threshold ?? params.defaultThreshold,
            judgeModel: params.judgeModel,
          });
          addUsage(usage, vj.usage);
          if (!vj.passed) {
            errors.push(`widget screenshot judge: ${vj.reason} (score ${vj.score})`);
          }
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      } else {
        errors.push("widget screenshot: no tool result to capture");
      }
    }
  }

  if (params.scenario.expect?.tools?.forbidden?.length) {
    const fb = assertForbiddenTools(params.scenario.expect.tools.forbidden, allToolCalls);
    if (!fb.passed) errors.push(fb.reason);
  }

  let judgePassed: boolean | null = null;
  let judgeScore: number | undefined;
  let judgeReason: string | undefined;

  if (params.scenario.expect?.judge) {
    const j = params.scenario.expect.judge;
    let screenshotDataUrl: string | null = null;
    if (j.screenshot && params.serverBaseUrl) {
      const lastTool = allToolCalls[allToolCalls.length - 1];
      if (lastTool?.result) {
        try {
          const cap = await captureWidgetScreenshot({
            session: params.conn.session,
            serverBaseUrl: params.serverBaseUrl,
            toolName: lastTool.tool,
            toolArgs: lastTool.args,
            toolResult: lastTool.result,
            timeoutMs: params.timeoutMs,
          });
          screenshotDataUrl = cap.dataUrl;
        } catch {
          /* judge without screenshot */
        }
      }
    }
    const transcript = buildTranscript(
      transcriptTurns,
      allToolCalls.map((c) => ({ tool: c.tool, args: c.args, turnIndex: c.turnIndex }))
    );
    const jr = await runLlmJudge({
      rubric: j.rubric,
      threshold: j.threshold ?? params.defaultThreshold,
      transcript,
      screenshotDataUrl,
      judgeModel: params.judgeModel,
    });
    addUsage(usage, jr.usage);
    judgePassed = jr.passed;
    judgeScore = jr.score;
    judgeReason = jr.reason;
    if (!jr.passed) errors.push(`judge: ${jr.reason}`);
  }

  const toolTracePassed = !errors.some((e) => e.includes("tool") || e.includes("args"));
  const success = errors.length === 0;

  return {
    scenarioId: params.scenario.id,
    client: "mcp-use",
    model: params.model,
    systemPrompt: params.systemPromptKey,
    success,
    toolTracePassed,
    resultPassed: success,
    widgetPassed: success,
    judgePassed,
    judgeScore,
    judgeReason,
    toolCalls: allToolCalls,
    durationMs: Date.now() - start,
    agentSteps,
    usage,
    errors,
  };
}

export async function runAgentMatrix(params: {
  conn: ConnectedMcp;
  flow: AgentFlow;
  serverBaseUrl?: string;
  clientsFilter?: string[];
  /** Overrides each client's `models` list (e.g. CLI `--models`). */
  modelsOverride?: string[];
  skipAgent?: boolean;
  defaults: {
    maxAgentSteps: number;
    judgeModel: string;
    rubricThreshold: number;
    timeoutMs: number;
  };
}): Promise<ScenarioRunResult[]> {
  if (params.skipAgent) return [];
  const clients = (params.flow.clients ?? [{ target: "mcp-use" as const }]).filter(
    (c) =>
      c.target === "mcp-use" &&
      (!params.clientsFilter?.length || params.clientsFilter.includes("mcp-use"))
  );
  if (clients.length === 0) return [];

  const results: ScenarioRunResult[] = [];
  const systemPrompts = params.flow.systemPrompts ?? { default: "You are a helpful assistant with MCP tools." };

  for (const client of clients) {
    const models = params.modelsOverride?.length
      ? params.modelsOverride
      : client.models?.length
        ? client.models
        : ["openai/gpt-4o-mini"];
    for (const model of models) {
      for (const [spKey, spText] of Object.entries(systemPrompts)) {
        for (const scenario of params.flow.scenarios) {
          results.push(
            await runScenario({
              conn: params.conn,
              flow: params.flow,
              scenario,
              model,
              systemPromptKey: spKey,
              systemPromptText: spText,
              serverBaseUrl: params.serverBaseUrl,
              maxSteps: params.defaults.maxAgentSteps,
              judgeModel: params.defaults.judgeModel,
              defaultThreshold: params.defaults.rubricThreshold,
              timeoutMs: params.defaults.timeoutMs,
            })
          );
        }
      }
    }
  }
  return results;
}
