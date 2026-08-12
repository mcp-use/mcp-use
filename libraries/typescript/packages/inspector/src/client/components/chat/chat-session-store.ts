import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import { createChatSession, type ChatSessionState } from "./chat-session";

/** Fields a session update may touch — identity and runtime are fixed per record. */
export type ChatSessionPatch = Partial<
  Omit<ChatSessionState, "id" | "runtime">
>;

export type ChatSessionUpdate =
  | ChatSessionPatch
  | ((session: ChatSessionState) => ChatSessionPatch);

export function resolveStateAction<T>(
  previous: T,
  action: SetStateAction<T>
): T {
  return typeof action === "function"
    ? (action as (value: T) => T)(previous)
    : action;
}

/**
 * Owns one record per chat session and notifies only the subscribers of the
 * session that changed. A background turn therefore keeps streaming into its
 * own record without re-rendering the chat the user is currently looking at.
 */
export class ChatSessionStore {
  private readonly sessions = new Map<string, ChatSessionState>();
  private readonly listeners = new Map<string, Set<() => void>>();

  /** Returns the session record, creating an empty one on first access. */
  get(id: string): ChatSessionState {
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const created = createChatSession(id);
    this.sessions.set(id, created);
    return created;
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  /** Seeds a session that does not exist yet; live sessions are left alone. */
  seed(id: string, messages: ChatSessionState["messages"]): ChatSessionState {
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const created = createChatSession(id, messages);
    this.sessions.set(id, created);
    return created;
  }

  update(id: string, update: ChatSessionUpdate): ChatSessionState {
    const previous = this.get(id);
    const patch = typeof update === "function" ? update(previous) : update;
    const keys = Object.keys(patch) as (keyof ChatSessionPatch)[];
    if (keys.every((key) => Object.is(previous[key], patch[key]))) {
      return previous;
    }
    const next: ChatSessionState = { ...previous, ...patch };
    this.sessions.set(id, next);
    for (const listener of this.listeners.get(id) ?? []) listener();
    return next;
  }

  subscribe(id: string, listener: () => void): () => void {
    let listeners = this.listeners.get(id);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(id, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(id);
    };
  }

  /** Drops a session nobody can reach any more (e.g. an untouched draft). */
  delete(id: string): void {
    this.sessions.delete(id);
  }

  /** Session whose persisted chat is `chatId`, if that chat is already loaded. */
  findByPersistedChatId(chatId: string): ChatSessionState | undefined {
    for (const session of this.sessions.values()) {
      if ((session.persistedChatId ?? session.id) === chatId) return session;
    }
    return undefined;
  }
}

export function useChatSessionStore(): ChatSessionStore {
  const storeRef = useRef<ChatSessionStore | null>(null);
  if (!storeRef.current) storeRef.current = new ChatSessionStore();
  return storeRef.current;
}

/** Subscribes to one session; other sessions' updates never re-render here. */
export function useChatSession(
  store: ChatSessionStore,
  sessionId: string
): ChatSessionState {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(sessionId, onStoreChange),
    [store, sessionId]
  );
  const getSnapshot = useCallback(
    () => store.get(sessionId),
    [store, sessionId]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * `useState`-style setter bound to one field of one session. The session id is
 * captured, so an in-flight turn keeps writing to its own record after the user
 * has moved on to another chat.
 */
export function useChatSessionField<K extends keyof ChatSessionPatch>(
  store: ChatSessionStore,
  sessionId: string,
  field: K
): (action: SetStateAction<ChatSessionState[K]>) => void {
  return useCallback(
    (action: SetStateAction<ChatSessionState[K]>) => {
      store.update(
        sessionId,
        (session) =>
          ({
            [field]: resolveStateAction(session[field], action),
          }) as ChatSessionPatch
      );
    },
    [field, sessionId, store]
  );
}
