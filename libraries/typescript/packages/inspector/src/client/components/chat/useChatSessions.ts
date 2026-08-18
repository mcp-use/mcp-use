import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatStorageProvider } from "../../chat-history/types";
import { readPendingChatTurnForServer } from "./chat-auth-retry";
import { createChatSessionId, type ChatSessionState } from "./chat-session";
import {
  useChatSessionStore,
  type ChatSessionStore,
} from "./chat-session-store";
import type { Message } from "./types";

export interface UseChatSessionsParams {
  /** Server identity the OAuth retry record is filed under. */
  retryServerId: string;
  /** Agent the created chats belong to. */
  agentId: string;
  agentName?: string;
  storage: ChatStorageProvider | null;
  /** Host-controlled chat id; when set, the host decides which chat is open. */
  activeChatId?: string;
  onActiveChatIdChange?: (chatId: string | null) => void;
  /** Replaces the active session's messages whenever the host swaps them. */
  initialMessages?: Message[];
  /** Called after a chat row appears, so history listings can refetch. */
  onChatCreated?: () => void;
}

export interface ChatSessions {
  store: ChatSessionStore;
  /** Session the UI is showing. Also the chat id, unless storage minted its own. */
  activeSessionId: string;
  activeChatId: string | null;
  /** Opens a chat from history, keeping a live session's in-flight state. */
  selectChat: (chatId: string) => Promise<ChatSessionState | null>;
  /** Switches to a brand new session; in-flight sessions keep running. */
  startNewChat: () => Promise<string>;
  /** Writes a session's messages to its own chat, whichever chat is on screen. */
  persistSessionMessages: (sessionId: string, messages: Message[]) => void;
}

/**
 * Owns the chat session lifecycle: identity, the store every session's state
 * lives in, and the mapping to persisted chat history.
 *
 * A session is created with one id and keeps it. That id is handed to
 * `ChatStorageProvider.createChat`, so the runtime session and the persisted
 * chat are the same thing; `persistedChatId` only diverges when a storage
 * backend insists on minting its own id.
 */
export function useChatSessions({
  retryServerId,
  agentId,
  agentName,
  storage,
  activeChatId: controlledActiveChatId,
  onActiveChatIdChange,
  initialMessages,
  onChatCreated,
}: UseChatSessionsParams): ChatSessions {
  const store = useChatSessionStore();
  const isControlled =
    controlledActiveChatId !== undefined || onActiveChatIdChange !== undefined;
  const [pendingTurnOnMount] = useState(() =>
    readPendingChatTurnForServer(retryServerId)
  );

  // A full-page OAuth redirect drops everything in memory, so the session that
  // was interrupted is read back from storage and reopened here.
  const [activeSessionId, setActiveSessionId] = useState(() => {
    const resumable =
      pendingTurnOnMount != null &&
      (!controlledActiveChatId ||
        pendingTurnOnMount.sessionId === controlledActiveChatId);
    const sessionId =
      controlledActiveChatId ??
      (resumable ? pendingTurnOnMount.sessionId : createChatSessionId());
    const seed = resumable ? pendingTurnOnMount.baseMessages : initialMessages;
    store.seed(sessionId, seed ?? []);
    const persistedChatId =
      controlledActiveChatId ??
      (resumable ? pendingTurnOnMount.persistedChatId : undefined);
    if (persistedChatId) store.update(sessionId, { persistedChatId });
    return sessionId;
  });
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  const [internalActiveChatId, setInternalActiveChatId] = useState<
    string | null
  >(() =>
    isControlled ? null : (pendingTurnOnMount?.persistedChatId ?? null)
  );
  const activeChatId = isControlled
    ? (controlledActiveChatId ?? null)
    : internalActiveChatId;

  const setActiveChatId = useCallback(
    (chatId: string | null) => {
      if (isControlled) {
        onActiveChatIdChange?.(chatId);
      } else {
        setInternalActiveChatId(chatId);
      }
    },
    [isControlled, onActiveChatIdChange]
  );

  // Under host control the chat id names the session; clearing it leaves the
  // session that was just started alone.
  useEffect(() => {
    if (!controlledActiveChatId) return;
    const session =
      store.findByPersistedChatId(controlledActiveChatId) ??
      store.update(controlledActiveChatId, {
        persistedChatId: controlledActiveChatId,
      });
    activeSessionIdRef.current = session.id;
    setActiveSessionId(session.id);
  }, [controlledActiveChatId, store]);

  const hostStateRef = useRef({
    activeChatId: controlledActiveChatId,
    messages: initialMessages,
  });
  useEffect(() => {
    const previous = hostStateRef.current;
    if (
      previous.activeChatId === controlledActiveChatId &&
      previous.messages === initialMessages
    ) {
      return;
    }
    hostStateRef.current = {
      activeChatId: controlledActiveChatId,
      messages: initialMessages,
    };
    if (initialMessages === undefined) return;
    const sessionId = controlledActiveChatId
      ? (store.findByPersistedChatId(controlledActiveChatId)?.id ??
        controlledActiveChatId)
      : activeSessionIdRef.current;
    store.update(sessionId, { messages: initialMessages });
  }, [controlledActiveChatId, initialMessages, store]);

  const getOrCreatePersistedChat = useCallback(
    (sessionId: string): Promise<string | null> => {
      if (!storage) return Promise.resolve(null);
      const session = store.get(sessionId);
      if (session.persistedChatId) {
        return Promise.resolve(session.persistedChatId);
      }
      if (session.creation) return session.creation;

      const creation = storage
        .createChat({ id: sessionId, agentId, agentName })
        .then((chat) => {
          store.update(sessionId, {
            persistedChatId: chat.id,
            creation: null,
          });
          if (activeSessionIdRef.current === sessionId)
            setActiveChatId(chat.id);
          onChatCreated?.();
          return chat.id;
        })
        .catch((error: unknown) => {
          // History is a convenience — a storage failure must not block chatting.
          store.update(sessionId, { creation: null });
          console.error("Failed to create chat history entry:", error);
          return null;
        });

      store.update(sessionId, { creation });
      return creation;
    },
    [agentId, agentName, onChatCreated, setActiveChatId, storage, store]
  );

  const persistSessionMessages = useCallback(
    (sessionId: string, messages: Message[]) => {
      const saveMessages = storage?.saveMessages?.bind(storage);
      if (!saveMessages) return;
      const session = store.get(sessionId);
      if (
        messages.length === 0 &&
        !session.persistedChatId &&
        !session.creation
      ) {
        return;
      }
      void getOrCreatePersistedChat(sessionId).then((chatId) => {
        if (chatId) void saveMessages(chatId, messages);
      });
    },
    [getOrCreatePersistedChat, storage, store]
  );

  const selectChat = useCallback(
    async (chatId: string): Promise<ChatSessionState | null> => {
      if (!storage) return null;
      // A session still in memory may be mid-stream; reactivate it as it stands
      // rather than overwrite it with the last persisted snapshot.
      let session = store.findByPersistedChatId(chatId);
      if (!session) {
        const messages = await storage.getMessages(chatId);
        store.seed(chatId, messages);
        session = store.update(chatId, { persistedChatId: chatId });
      }
      setActiveSessionId(session.id);
      activeSessionIdRef.current = session.id;
      setActiveChatId(chatId);
      return session;
    },
    [setActiveChatId, storage, store]
  );

  const startNewChat = useCallback(async () => {
    const previous = store.get(activeSessionIdRef.current);
    const sessionId = createChatSessionId();
    setActiveSessionId(sessionId);
    activeSessionIdRef.current = sessionId;
    setActiveChatId(null);
    // Nothing ever went into the chat being left, so drop its record instead of
    // accumulating empty sessions. Anything in flight keeps its own record.
    if (
      previous.messages.length === 0 &&
      !previous.isLoading &&
      !previous.persistedChatId &&
      !previous.creation
    ) {
      store.delete(previous.id);
    }
    await getOrCreatePersistedChat(sessionId);
    return sessionId;
  }, [getOrCreatePersistedChat, setActiveChatId, store]);

  return {
    store,
    activeSessionId,
    activeChatId,
    selectChat,
    startNewChat,
    persistSessionMessages,
  };
}
