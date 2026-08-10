const PENDING_TOOL_EXECUTION_STORAGE_KEY =
  "__mcpUseInspectorPendingToolExecution";
const PENDING_TOOL_EXECUTION_MAX_AGE_MS = 15 * 60_000;

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
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

function storageKey(serverId: string): string {
  return `${PENDING_TOOL_EXECUTION_STORAGE_KEY}:${encodeURIComponent(serverId)}`;
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

interface StoredPendingToolExecution {
  savedAt: number;
  execution: PendingToolExecution;
}

function isStoredPendingToolExecution(
  value: unknown
): value is StoredPendingToolExecution {
  return (
    isRecord(value) &&
    typeof value.savedAt === "number" &&
    Number.isFinite(value.savedAt) &&
    isPendingToolExecution(value.execution)
  );
}

/** Load the pending tool request for `serverId`, if one is available. */
export function readPendingToolExecution(
  serverId: string,
  storage: SessionStorageLike | undefined = defaultSessionStorage()
): PendingToolExecution | null {
  if (!storage) return null;
  const key = storageKey(serverId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !isStoredPendingToolExecution(parsed) ||
      parsed.execution.serverId !== serverId ||
      Date.now() - parsed.savedAt > PENDING_TOOL_EXECUTION_MAX_AGE_MS
    ) {
      storage.removeItem(key);
      return null;
    }
    return parsed.execution;
  } catch {
    try {
      storage.removeItem(key);
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
      storageKey(execution.serverId),
      JSON.stringify({
        savedAt: Date.now(),
        execution,
      } satisfies StoredPendingToolExecution)
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
  try {
    storage.removeItem(storageKey(serverId));
  } catch {
    // Storage is best-effort.
  }
}
