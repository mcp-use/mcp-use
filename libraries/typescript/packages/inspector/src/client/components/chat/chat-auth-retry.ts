import type { PromptResult } from "../../hooks/useMCPPrompts";
import type { Message, MessageAttachment } from "./types";

const PENDING_CHAT_TURN_STORAGE_KEY = "__mcpUseInspectorPendingChatTurn";
const ACTIVE_PENDING_CHAT_SESSION_STORAGE_KEY =
  "__mcpUseInspectorActivePendingChatSession";
const PENDING_CHAT_TURN_MAX_AGE_MS = 15 * 60_000;

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Serializable chat turn retained across a full-page OAuth redirect. */
export interface PendingChatTurn {
  serverId: string;
  /** Chat session that owns the interrupted turn. */
  sessionId: string;
  /** Persisted id when the storage backend minted one instead of adopting the session id. */
  persistedChatId?: string;
  userInput: string;
  promptResults: PromptResult[];
  attachments: MessageAttachment[];
  /** Conversation through the user turn, excluding the interrupted assistant. */
  baseMessages: Message[];
  savedAt: number;
}

function defaultSessionStorage(): SessionStorageLike | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

function storageKey(serverId: string, sessionId: string): string {
  return `${PENDING_CHAT_TURN_STORAGE_KEY}:${encodeURIComponent(serverId)}:${encodeURIComponent(sessionId)}`;
}

function activeSessionStorageKey(serverId: string): string {
  return `${ACTIVE_PENDING_CHAT_SESSION_STORAGE_KEY}:${encodeURIComponent(serverId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPendingChatTurn(value: unknown): value is PendingChatTurn {
  if (!isRecord(value)) return false;
  return (
    typeof value.serverId === "string" &&
    typeof value.sessionId === "string" &&
    (value.persistedChatId === undefined ||
      typeof value.persistedChatId === "string") &&
    typeof value.userInput === "string" &&
    Array.isArray(value.promptResults) &&
    Array.isArray(value.attachments) &&
    Array.isArray(value.baseMessages) &&
    typeof value.savedAt === "number" &&
    Number.isFinite(value.savedAt)
  );
}

function removePendingChatTurn(
  serverId: string,
  sessionId: string,
  storage: SessionStorageLike
): void {
  storage.removeItem(storageKey(serverId, sessionId));
  const activeKey = activeSessionStorageKey(serverId);
  if (storage.getItem(activeKey) === sessionId) {
    storage.removeItem(activeKey);
  }
}

export function readPendingChatTurn(
  serverId: string,
  sessionId: string,
  storage: SessionStorageLike | undefined = defaultSessionStorage()
): PendingChatTurn | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(serverId, sessionId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !isPendingChatTurn(parsed) ||
      parsed.serverId !== serverId ||
      parsed.sessionId !== sessionId ||
      Date.now() - parsed.savedAt > PENDING_CHAT_TURN_MAX_AGE_MS
    ) {
      removePendingChatTurn(serverId, sessionId, storage);
      return null;
    }
    return parsed;
  } catch {
    try {
      removePendingChatTurn(serverId, sessionId, storage);
    } catch {
      // Storage is best-effort.
    }
    return null;
  }
}

/**
 * Reads the turn that initiated the current full-page OAuth flow. A redirect
 * discards in-memory state, so the session id has to come back from storage
 * for the reloaded tab to reopen the chat the user left.
 */
export function readPendingChatTurnForServer(
  serverId: string,
  storage: SessionStorageLike | undefined = defaultSessionStorage()
): PendingChatTurn | null {
  if (!storage) return null;
  const activeKey = activeSessionStorageKey(serverId);
  try {
    const sessionId = storage.getItem(activeKey);
    if (!sessionId) return null;
    const pendingTurn = readPendingChatTurn(serverId, sessionId, storage);
    if (!pendingTurn) storage.removeItem(activeKey);
    return pendingTurn;
  } catch {
    try {
      storage.removeItem(activeKey);
    } catch {
      // Storage is best-effort.
    }
    return null;
  }
}

export function savePendingChatTurn(
  turn: Omit<PendingChatTurn, "savedAt">,
  storage: SessionStorageLike | undefined = defaultSessionStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(
      storageKey(turn.serverId, turn.sessionId),
      JSON.stringify({ ...turn, savedAt: Date.now() } satisfies PendingChatTurn)
    );
    storage.setItem(activeSessionStorageKey(turn.serverId), turn.sessionId);
  } catch {
    // Storage is best-effort; popup OAuth can still resume in memory.
  }
}

export function clearPendingChatTurn(
  serverId: string,
  sessionId: string,
  storage: SessionStorageLike | undefined = defaultSessionStorage()
): void {
  if (!storage) return;
  try {
    removePendingChatTurn(serverId, sessionId, storage);
  } catch {
    // Storage is best-effort.
  }
}
