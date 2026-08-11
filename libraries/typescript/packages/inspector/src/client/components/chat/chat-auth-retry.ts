import type { PromptResult } from "../../hooks/useMCPPrompts";
import type { Message, MessageAttachment } from "./types";

const PENDING_CHAT_TURN_STORAGE_KEY = "__mcpUseInspectorPendingChatTurn";
const PENDING_CHAT_TURN_MAX_AGE_MS = 15 * 60_000;

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Serializable chat turn retained across a full-page OAuth redirect. */
export interface PendingChatTurn {
  serverId: string;
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

function storageKey(serverId: string): string {
  return `${PENDING_CHAT_TURN_STORAGE_KEY}:${encodeURIComponent(serverId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPendingChatTurn(value: unknown): value is PendingChatTurn {
  if (!isRecord(value)) return false;
  return (
    typeof value.serverId === "string" &&
    typeof value.userInput === "string" &&
    Array.isArray(value.promptResults) &&
    Array.isArray(value.attachments) &&
    Array.isArray(value.baseMessages) &&
    typeof value.savedAt === "number" &&
    Number.isFinite(value.savedAt)
  );
}

export function readPendingChatTurn(
  serverId: string,
  storage: SessionStorageLike | undefined = defaultSessionStorage()
): PendingChatTurn | null {
  if (!storage) return null;
  const key = storageKey(serverId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !isPendingChatTurn(parsed) ||
      parsed.serverId !== serverId ||
      Date.now() - parsed.savedAt > PENDING_CHAT_TURN_MAX_AGE_MS
    ) {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    try {
      storage.removeItem(key);
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
      storageKey(turn.serverId),
      JSON.stringify({ ...turn, savedAt: Date.now() } satisfies PendingChatTurn)
    );
  } catch {
    // Storage is best-effort; popup OAuth can still resume in memory.
  }
}

export function clearPendingChatTurn(
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
