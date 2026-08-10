const PENDING_TOOL_EXECUTION_STORAGE_KEY =
  "__mcpUseInspectorPendingToolExecution";

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Serializable tool request retained across a full-page OAuth redirect. */
export interface PendingToolExecution {
  serverId: string;
  toolName: string;
  args: Record<string, unknown>;
  displayArgs: Record<string, unknown>;
  timestamp: number;
  toolMeta?: Record<string, unknown>;
  widgetResourceUri?: string;
}

function defaultSessionStorage(): SessionStorageLike | undefined {
  return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPendingToolExecution(value: unknown): value is PendingToolExecution {
  if (!isRecord(value)) return false;
  return (
    typeof value.serverId === "string" &&
    typeof value.toolName === "string" &&
    value.toolName.length > 0 &&
    isRecord(value.args) &&
    isRecord(value.displayArgs) &&
    typeof value.timestamp === "number" &&
    Number.isFinite(value.timestamp) &&
    (value.toolMeta === undefined || isRecord(value.toolMeta)) &&
    (value.widgetResourceUri === undefined ||
      typeof value.widgetResourceUri === "string")
  );
}

/** Load the pending tool request for `serverId`, if one is available. */
export function readPendingToolExecution(
  serverId: string,
  storage: SessionStorageLike | undefined = defaultSessionStorage()
): PendingToolExecution | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PENDING_TOOL_EXECUTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isPendingToolExecution(parsed)) {
      storage.removeItem(PENDING_TOOL_EXECUTION_STORAGE_KEY);
      return null;
    }
    return parsed.serverId === serverId ? parsed : null;
  } catch {
    try {
      storage.removeItem(PENDING_TOOL_EXECUTION_STORAGE_KEY);
    } catch {
      // Storage is best-effort.
    }
    return null;
  }
}

/** Save a pending tool request before starting a full-page OAuth flow. */
export function savePendingToolExecution(
  execution: PendingToolExecution,
  storage: SessionStorageLike | undefined = defaultSessionStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(
      PENDING_TOOL_EXECUTION_STORAGE_KEY,
      JSON.stringify(execution)
    );
  } catch {
    // Storage is best-effort; popup OAuth can still resume in memory.
  }
}

/** Remove the pending tool request owned by `serverId`. */
export function clearPendingToolExecution(
  serverId: string,
  storage: SessionStorageLike | undefined = defaultSessionStorage()
): void {
  if (!storage) return;
  const pending = readPendingToolExecution(serverId, storage);
  if (!pending) return;
  try {
    storage.removeItem(PENDING_TOOL_EXECUTION_STORAGE_KEY);
  } catch {
    // Storage is best-effort.
  }
}
