export interface InspectorTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
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

export type InspectorTraceEventInput =
  InspectorTraceEvent extends infer Event
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
  const totalTokens =
    number("totalTokens", "total_tokens") ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }
  return { inputTokens, outputTokens, totalTokens };
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
    cachedInputTokens: sum(
      current?.cachedInputTokens,
      next.cachedInputTokens
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
  let activeLlm = [...spans].reverse().find(
    (span) => span.kind === "llm" && span.status === "running"
  );

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
      preview: event.type === "text-delta" ? traceEventPreview(event) : "LLM response",
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
