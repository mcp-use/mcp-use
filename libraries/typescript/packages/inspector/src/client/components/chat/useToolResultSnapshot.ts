import { useRef } from "react";

export interface ToolResultSnapshot<T> {
  fingerprint: string;
  value: T;
}

function fingerprintToolResult(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function cloneToolResult<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;

  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return value;
    }
  }
}

export function updateToolResultSnapshot<T>(
  previous: ToolResultSnapshot<T> | null,
  value: T
): ToolResultSnapshot<T> {
  const fingerprint = fingerprintToolResult(value);
  if (previous?.fingerprint === fingerprint) return previous;
  return { fingerprint, value: cloneToolResult(value) };
}

/**
 * Turn a streamed tool result into an immutable snapshot.
 *
 * Some streaming clients complete tool calls by mutating the existing result
 * object. React's dependency and memo checks cannot observe that mutation, so
 * the MCP Apps renderer would never forward the completed result to the View.
 */
export function useToolResultSnapshot<T>(value: T): T {
  const snapshotRef = useRef<ToolResultSnapshot<T> | null>(null);
  snapshotRef.current = updateToolResultSnapshot(snapshotRef.current, value);
  return snapshotRef.current.value;
}
