import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  ReactNode,
} from "react";
import { get, set, del, createStore } from "idb-keyval";
import { toast } from "sonner";
import type { Message, LLMConfig } from "../components/chat/types";

export interface ChatSession {
  id: string;
  title: string;
  llmConfig: LLMConfig | null;
  createdAt: number;
  updatedAt: number;
}

export interface StorageEstimate {
  usage: number;
  quota: number;
}

export interface ChatSessionsContextType {
  sessions: ChatSession[];
  activeSessionId: string | null;
  activeMessages: Message[];
  setActiveSessionId: (id: string | null) => void;
  createSession: (title?: string, initialMessages?: Message[], config?: LLMConfig | null) => Promise<string>;
  deleteSession: (id: string) => Promise<void>;
  updateSessionMessages: (id: string, messages: Message[]) => Promise<void>;
  updateSessionLlmConfig: (id: string, config: LLMConfig | null) => Promise<void>;
  /** Renames a session. Used by auto-title logic after the first user message. */
  updateSessionTitle: (id: string, title: string) => Promise<void>;
  clearAllSessions: () => Promise<void>;
  isMessagesLoading: boolean;
  storageEstimate: StorageEstimate | null;
}

const ChatSessionsContext = createContext<ChatSessionsContextType | undefined>(
  undefined
);

// Create custom stores for normalized database (different DB names to avoid versioning conflicts)
const sessionsStore = createStore("mcp-inspector-sessions-db", "sessions");
const messagesStore = createStore("mcp-inspector-messages-db", "messages");

/**
 * Derives a safe storage key from a serverId (or "no-server" fallback).
 * We prefix with "sessions-" to namespace per-server session lists.
 */
function sessionListKey(serverId: string | null): string {
  return `sessions-${serverId ?? "no-server"}`;
}

export const ChatSessionsProvider: React.FC<{
  children: ReactNode;
  /** The active MCP server ID. Sessions are scoped to this value. */
  serverId: string | null;
}> = ({ children, serverId }) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(
    null
  );
  const [activeMessages, setActiveMessages] = useState<Message[]>([]);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimate | null>(null);

  // Track the current serverId synchronously via a ref so that async callbacks
  // can guard against stale writes when the server switches mid-flight.
  const serverIdRef = useRef(serverId);
  serverIdRef.current = serverId;

  const updateStorageEstimate = useCallback(async () => {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        setStorageEstimate({
          usage: estimate.usage || 0,
          quota: estimate.quota || 0,
        });
      } catch (e) {
        console.error("Failed to estimate storage", e);
      }
    }
  }, []);

  // Load sessions for the current serverId whenever it changes.
  // This scopes the session list to the active MCP server.
  useEffect(() => {
    updateStorageEstimate();
    const interval = setInterval(updateStorageEstimate, 60000); // Every minute

    // Reset state immediately so we don't show stale sessions from the previous server
    setSessions([]);
    setActiveSessionIdState(null);
    setActiveMessages([]);

    const loadSessions = async () => {
      try {
        const key = sessionListKey(serverId);
        const storedSessions = await get<ChatSession[]>(key, sessionsStore);
        if (storedSessions && storedSessions.length > 0) {
          // Sort by updated descending
          const sorted = storedSessions.sort((a, b) => b.updatedAt - a.updatedAt);
          setSessions(sorted);
          setActiveSessionIdState(sorted[0].id);
        } else {
          // No sessions yet for this server — start with empty state
          setSessions([]);
        }
      } catch (error) {
        console.error("Failed to load chat sessions:", error);
      }
    };
    loadSessions();

    return () => clearInterval(interval);
  }, [serverId, updateStorageEstimate]);

  // Whenever activeSessionId changes, load its messages
  useEffect(() => {
    let isMounted = true;

    // Synchronously clear messages when session switches so UI doesn't show stale data
    setActiveMessages([]);
    setIsMessagesLoading(true);

    const loadMessages = async () => {
      if (!activeSessionId) {
        if (isMounted) setIsMessagesLoading(false);
        return;
      }
      try {
        const msgs = await get<Message[]>(activeSessionId, messagesStore);
        if (isMounted) {
          setActiveMessages(msgs || []);
          setIsMessagesLoading(false);
        }
      } catch (error) {
        console.error("Failed to load messages for session:", error);
        if (isMounted) {
          setActiveMessages([]);
          setIsMessagesLoading(false);
        }
      }
    };
    loadMessages();
    return () => {
      isMounted = false;
    };
  }, [activeSessionId]);

  // Helper to persist sessions array scoped to the current server.
  // Guarded: skips write if serverId has changed since the callback was created.
  const persistSessions = async (newSessions: ChatSession[], forServerId: string | null) => {
    if (serverIdRef.current !== forServerId) return; // stale — another server is now active
    setSessions(newSessions);
    await set(sessionListKey(forServerId), newSessions, sessionsStore);
  };

  const createSession = useCallback(
    async (title = "Untitled Session", initialMessages: Message[] = [], config: LLMConfig | null = null) => {
      const capturedServerId = serverIdRef.current;
      const id = crypto.randomUUID();
      const newSession: ChatSession = {
        id,
        title,
        llmConfig: config,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const newSessions = [newSession, ...sessions];
      await persistSessions(newSessions, capturedServerId);
      await set(id, initialMessages, messagesStore);

      setActiveMessages(initialMessages);
      setActiveSessionIdState(id);
      return id;
    },
    [sessions]
  );

  const deleteSession = useCallback(
    async (id: string) => {
      const capturedServerId = serverIdRef.current;
      const newSessions = sessions.filter((s) => s.id !== id);
      await persistSessions(newSessions, capturedServerId);
      await del(id, messagesStore);
      updateStorageEstimate();

      if (activeSessionId === id) {
        setActiveMessages([]); // Clear synchronously to prevent flash of old messages
        if (newSessions.length > 0) {
          setActiveSessionIdState(newSessions[0].id);
        } else {
          // If we deleted the very last session, auto-create a new empty one
          const newId = crypto.randomUUID();
          const newSession: ChatSession = {
            id: newId,
            title: "Untitled Session",
            llmConfig: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await persistSessions([newSession], capturedServerId);
          await set(newId, [], messagesStore);
          setActiveSessionIdState(newId);
        }
      }
    },
    [sessions, activeSessionId]
  );

  const updateSessionMessages = useCallback(
    async (id: string, messages: Message[]) => {
      const capturedServerId = serverIdRef.current;
      // Guard: do not write if the server has changed since this callback was scheduled
      if (capturedServerId !== serverId) return;

      setSessions((prevSessions) => {
        const newSessions = prevSessions.map((s) => {
          if (s.id === id) {
            return { ...s, updatedAt: Date.now() };
          }
          return s;
        });

        // Save messages without awaiting in the state updater
        set(id, messages, messagesStore).then(() => {
          updateStorageEstimate();
        }).catch((error: any) => {
          if (error.name === "QuotaExceededError" || error.message?.includes("quota")) {
            toast.error("Storage limit reached. Please delete old chats to free up space.");
          } else {
            console.error("Failed to save messages:", error);
          }
        });

        // Also save the session list scoped to the current server
        set(sessionListKey(capturedServerId), newSessions, sessionsStore).catch(console.error);

        return newSessions;
      });

      if (id === activeSessionId) {
        setActiveMessages(messages);
      }
    },
    [serverId, activeSessionId, updateStorageEstimate]
  );

  const updateSessionLlmConfig = useCallback(
    async (id: string, config: LLMConfig | null) => {
      const capturedServerId = serverIdRef.current;
      if (capturedServerId !== serverId) return; // stale
      setSessions((prev) => {
        const newSessions = prev.map((s) =>
          s.id === id ? { ...s, llmConfig: config, updatedAt: Date.now() } : s
        );
        set(sessionListKey(capturedServerId), newSessions, sessionsStore).catch(console.error);
        return newSessions;
      });
    },
    [serverId]
  );

  const updateSessionTitle = useCallback(
    async (id: string, title: string) => {
      const capturedServerId = serverIdRef.current;
      if (capturedServerId !== serverId) return; // stale
      setSessions((prev) => {
        const newSessions = prev.map((s) =>
          s.id === id ? { ...s, title, updatedAt: Date.now() } : s
        );
        set(sessionListKey(capturedServerId), newSessions, sessionsStore).catch(console.error);
        return newSessions;
      });
    },
    [serverId]
  );


  const clearAllSessions = useCallback(async () => {
    // Only clear sessions belonging to the current server
    const key = sessionListKey(serverId);
    const existingSessions = await get<ChatSession[]>(key, sessionsStore);
    if (existingSessions) {
      // Delete each session's messages from the messages store
      await Promise.all(existingSessions.map((s) => del(s.id, messagesStore)));
    }
    // Remove this server's session list entry
    await del(key, sessionsStore);

    // Auto-create a fresh new chat after clearing
    const newId = crypto.randomUUID();
    const newSession: ChatSession = {
      id: newId,
      title: "Untitled Session",
      llmConfig: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await set(key, [newSession], sessionsStore);
    await set(newId, [], messagesStore);

    setSessions([newSession]);
    setActiveSessionIdState(newId);
    setActiveMessages([]);
    updateStorageEstimate();
  }, [serverId, updateStorageEstimate]);

  const setActiveSessionId = useCallback((id: string | null) => {
    if (id !== activeSessionId) {
      setActiveMessages([]); // Clear synchronously so UI doesn't render old messages
    }
    setActiveSessionIdState(id);
  }, [activeSessionId]);

  return (
    <ChatSessionsContext.Provider
      value={{
        sessions,
        activeSessionId,
        activeMessages,
        setActiveSessionId,
        createSession,
        deleteSession,
        updateSessionMessages,
        updateSessionLlmConfig,
        updateSessionTitle,
        clearAllSessions,
        isMessagesLoading,
        storageEstimate,
      }}
    >
      {children}
    </ChatSessionsContext.Provider>
  );
};

export const useChatSessions = () => {
  const context = useContext(ChatSessionsContext);
  if (context === undefined) {
    throw new Error(
      "useChatSessions must be used within a ChatSessionsProvider"
    );
  }
  return context;
};