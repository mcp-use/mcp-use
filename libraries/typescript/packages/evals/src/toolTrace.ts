export type CapturedToolCall = {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  structuredContent?: Record<string, unknown>;
  turnIndex: number;
  observation?: string;
};

export function parseToolResultFromObservation(observation: string): unknown {
  const trimmed = observation.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return { text: observation };
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return { text: observation };
  }
}

export function extractStructuredFromResult(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") return undefined;
  const sc = (result as { structuredContent?: unknown }).structuredContent;
  if (sc && typeof sc === "object" && !Array.isArray(sc)) {
    return sc as Record<string, unknown>;
  }
  return undefined;
}
