export interface InspectorTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
}

interface TraceEventBase {
  id: string;
  timestamp: number;
  raw?: unknown;
}

export type InspectorTraceEvent =
  | (TraceEventBase & { type: "request"; request: unknown })
  | (TraceEventBase & { type: "text-delta"; delta: string })
  | (TraceEventBase & {
      type: "tool-call-start";
      toolCallId: string;
      toolName: string;
    })
  | (TraceEventBase & {
      type: "tool-call-args";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    })
  | (TraceEventBase & {
      type: "tool-result";
      toolCallId?: string;
      toolName: string;
      result: unknown;
      isError?: boolean;
    })
  | (TraceEventBase & { type: "usage"; usage: InspectorTokenUsage })
  | (TraceEventBase & { type: "error"; message: string })
  | (TraceEventBase & { type: "done" });

export type InspectorTraceEventInput = InspectorTraceEvent extends infer Event
  ? Event extends InspectorTraceEvent
    ? Omit<Event, "id" | "timestamp">
    : never
  : never;

export interface InspectorTraceSpan {
  id: string;
  kind: "llm" | "tool";
  name: string;
  status: "running" | "success" | "error";
  startedAt: number;
  endedAt?: number;
  preview?: string;
  usage?: InspectorTokenUsage;
}

export interface InspectorTraceState {
  events: InspectorTraceEvent[];
  spans: InspectorTraceSpan[];
  usage?: InspectorTokenUsage;
}

export const EMPTY_TRACE_STATE: InspectorTraceState = {
  events: [],
  spans: [],
};

export function inspectorTokenUsageFromUnknown(
  raw: unknown
): InspectorTokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const number = (...keys: string[]) => {
    for (const key of keys) {
      if (typeof value[key] === "number") return value[key] as number;
    }
    return undefined;
  };
  const inputTokens = number("inputTokens", "input_tokens", "promptTokens");
  const outputTokens = number(
    "outputTokens",
    "output_tokens",
    "completionTokens"
  );
  // Anthropic reports these alongside input_tokens and bills all of them, so a total of
  // input + output understates what the call cost. OpenAI's cached_tokens sits inside
  // prompt_tokens, so only the Anthropic-shaped keys are added here.
  const cachedInputTokens = number(
    "cachedInputTokens",
    "cache_read_input_tokens"
  );
  const cacheCreationInputTokens = number(
    "cacheCreationInputTokens",
    "cache_creation_input_tokens"
  );
  const reasoningTokens = number("reasoningTokens", "thoughtsTokenCount");
  // Only the Anthropic-shaped keys sit OUTSIDE inputTokens and must be added back into the
  // total. cachedInputTokens is provider-neutral, and on OpenAI those tokens are already
  // inside inputTokens, so adding it here would double count. It is still parsed above for
  // observability; the total is computed from cache_read_input_tokens only, mirroring the
  // provider-safe behaviour in agent/src/llm/usage.ts.
  const cacheReadOutsideInput = number("cache_read_input_tokens");
  const uncountedCache =
    (cacheReadOutsideInput ?? 0) + (cacheCreationInputTokens ?? 0);
  const totalTokens =
    number("totalTokens", "total_tokens") ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens + uncountedCache
      : undefined);
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    cachedInputTokens === undefined &&
    cacheCreationInputTokens === undefined &&
    reasoningTokens === undefined
  ) {
    return undefined;
  }
  // cachedInputTokens and reasoningTokens were declared on InspectorTokenUsage and read by
  // the trace view, but this function never returned them, so both have always rendered as
  // absent no matter what the provider sent.
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    reasoningTokens,
  };
}

const SECRET_REQUEST_KEYS = new Set([
  "apikey",
  "authorization",
  "accesstoken",
  "refreshtoken",
  "password",
  "cookie",
  "secret",
]);

export function redactSensitiveRequestFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveRequestFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      SECRET_REQUEST_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""))
        ? "[REDACTED]"
        : redactSensitiveRequestFields(child),
    ])
  );
}

function compactJson(value: unknown, maxLength = 120): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function traceEventPreview(event: InspectorTraceEvent): string {
  switch (event.type) {
    case "request":
      return "LLM request";
    case "text-delta":
      return event.delta.trim() || "Text delta";
    case "tool-call-start":
      return event.toolName;
    case "tool-call-args":
      return compactJson(event.args);
    case "tool-result":
      return compactJson(event.result);
    case "usage":
      return `${event.usage.totalTokens ?? "?"} tokens`;
    case "error":
      return event.message;
    case "done":
      return "Completed";
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function addUsage(
  current: InspectorTokenUsage | undefined,
  next: InspectorTokenUsage
): InspectorTokenUsage {
  const sum = (
    a: number | undefined,
    b: number | undefined
  ): number | undefined =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  return {
    inputTokens: sum(current?.inputTokens, next.inputTokens),
    outputTokens: sum(current?.outputTokens, next.outputTokens),
    totalTokens: sum(current?.totalTokens, next.totalTokens),
    cachedInputTokens: sum(current?.cachedInputTokens, next.cachedInputTokens),
    cacheCreationInputTokens: sum(
      current?.cacheCreationInputTokens,
      next.cacheCreationInputTokens
    ),
    reasoningTokens: sum(current?.reasoningTokens, next.reasoningTokens),
  };
}

export function appendTraceEvent(
  state: InspectorTraceState,
  event: InspectorTraceEvent
): InspectorTraceState {
  const spans = state.spans.map((span) => ({ ...span }));
  let usage = state.usage;
  let activeLlm = [...spans]
    .reverse()
    .find((span) => span.kind === "llm" && span.status === "running");

  if (event.type === "request") {
    spans.push({
      id: `llm-${event.id}`,
      kind: "llm",
      name: "LLM",
      status: "running",
      startedAt: event.timestamp,
      preview: traceEventPreview(event),
    });
  } else if (
    (event.type === "text-delta" || event.type === "tool-call-start") &&
    !activeLlm
  ) {
    activeLlm = {
      id: `llm-${event.id}`,
      kind: "llm",
      name: "LLM",
      status: "running",
      startedAt: event.timestamp,
      preview:
        event.type === "text-delta" ? traceEventPreview(event) : "LLM response",
    };
    spans.push(activeLlm);
    if (event.type === "tool-call-start") {
      spans.push({
        id: event.toolCallId,
        kind: "tool",
        name: event.toolName,
        status: "running",
        startedAt: event.timestamp,
        preview: traceEventPreview(event),
      });
    }
  } else if (event.type === "tool-call-start") {
    spans.push({
      id: event.toolCallId,
      kind: "tool",
      name: event.toolName,
      status: "running",
      startedAt: event.timestamp,
      preview: traceEventPreview(event),
    });
  } else if (event.type === "tool-call-args") {
    const span = spans.find((item) => item.id === event.toolCallId);
    if (span) span.preview = traceEventPreview(event);
  } else if (event.type === "tool-result") {
    const span = event.toolCallId
      ? spans.find((item) => item.id === event.toolCallId)
      : [...spans]
          .reverse()
          .find(
            (item) =>
              item.kind === "tool" &&
              item.name === event.toolName &&
              item.status === "running"
          );
    if (span) {
      span.status = event.isError ? "error" : "success";
      span.endedAt = event.timestamp;
      span.preview = traceEventPreview(event);
    }
  } else if (event.type === "usage") {
    usage = addUsage(usage, event.usage);
    if (activeLlm) activeLlm.usage = addUsage(activeLlm.usage, event.usage);
  } else if (event.type === "error" || event.type === "done") {
    if (activeLlm) {
      activeLlm.status = event.type === "error" ? "error" : "success";
      activeLlm.endedAt = event.timestamp;
      activeLlm.preview = traceEventPreview(event);
    }
  }

  return { events: [...state.events, event], spans, usage };
}

export function buildRawChatPayload(
  events: InspectorTraceEvent[],
  usage?: InspectorTokenUsage
) {
  const turns: Array<{
    request: InspectorTraceEvent & { type: "request" };
    response: InspectorTraceEvent[];
  }> = [];

  let currentTurn: (typeof turns)[number] | null = null;
  for (const event of events) {
    if (event.type === "request") {
      if (currentTurn) turns.push(currentTurn);
      currentTurn = { request: event, response: [] };
    } else if (currentTurn) {
      currentTurn.response.push(event);
    }
  }
  if (currentTurn) turns.push(currentTurn);

  return { turns, tokenUsage: usage ?? null };
}

type MessageRef = { id: string; role: string };

type MessageTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

function usageFromTraceResponse(
  response: InspectorTraceEvent[]
): InspectorTokenUsage | undefined {
  let usage: InspectorTokenUsage | undefined;
  for (const event of response) {
    if (event.type === "usage") {
      usage = addUsage(usage, event.usage);
    }
  }
  return usage;
}

function buildMessageTurns(messages: MessageRef[]) {
  const turns: Array<{ userId: string; assistantId: string | null }> = [];
  let index = 0;
  while (index < messages.length) {
    if (messages[index]?.role !== "user") {
      index++;
      continue;
    }
    const userId = messages[index]!.id;
    index++;
    let assistantId: string | null = null;
    while (index < messages.length && messages[index]?.role === "assistant") {
      assistantId = messages[index]!.id;
      index++;
    }
    turns.push({ userId, assistantId });
  }
  return turns;
}

/** Map message ids to per-turn token counts derived from trace events. */
export function buildMessageTokenMap(
  messages: MessageRef[],
  events: InspectorTraceEvent[]
): Map<string, MessageTokenUsage> {
  const { turns: traceTurns } = buildRawChatPayload(events);
  const messageTurns = buildMessageTurns(messages);
  const map = new Map<string, MessageTokenUsage>();
  const pairCount = Math.min(traceTurns.length, messageTurns.length);

  for (let turn = 0; turn < pairCount; turn++) {
    const usage = usageFromTraceResponse(traceTurns[turn]!.response);
    if (!usage) continue;
    const { userId, assistantId } = messageTurns[turn]!;

    if (usage.inputTokens != null) {
      map.set(userId, {
        ...map.get(userId),
        inputTokens: usage.inputTokens,
      });
    }
    if (assistantId != null && usage.outputTokens != null) {
      map.set(assistantId, {
        ...map.get(assistantId),
        outputTokens: usage.outputTokens,
      });
    }
  }

  return map;
}
