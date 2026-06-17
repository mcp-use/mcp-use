import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { get, set, del, clear, createStore, UseStore } from "idb-keyval";
import { toast } from "sonner";
import type { Message, LLMConfig } from "../components/chat/types";

export interface ChatSession {
  id: string;
  title: string;
  llmConfig: LLMConfig | null;
  createdAt: number;
  updatedAt: number;
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
  updateSessionTitle: (id: string, title: string) => Promise<void>;
  clearAllSessions: () => Promise<void>;
  isLoading: boolean;
  isMessagesLoading: boolean;
}

const ChatSessionsContext = createContext<ChatSessionsContextType | undefined>(
  undefined
);

// Create custom stores for normalized database (different DB names to avoid versioning conflicts)
const sessionsStore = createStore("mcp-inspector-sessions-db", "sessions");
const messagesStore = createStore("mcp-inspector-messages-db", "messages");

export const ChatSessionsProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(
    null
  );
  const [activeMessages, setActiveMessages] = useState<Message[]>([]);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load all sessions metadata on mount
  useEffect(() => {
    const loadSessions = async () => {
      try {
        const storedSessions = await get<ChatSession[]>("all-sessions", sessionsStore);
        if (storedSessions && storedSessions.length > 0) {
          // Sort by updated descending
          const sorted = storedSessions.sort((a, b) => b.updatedAt - a.updatedAt);
          setSessions(sorted);
          setActiveSessionIdState(sorted[0].id);
        } else {
          // If no sessions exist, we can start with an empty state
          setSessions([]);
        }
      } catch (error) {
        console.error("Failed to load chat sessions:", error);
      } finally {
        setIsLoading(false);
      }
    };
    loadSessions();
  }, []);

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

  // Helper to persist sessions array
  const persistSessions = async (newSessions: ChatSession[]) => {
    setSessions(newSessions);
    await set("all-sessions", newSessions, sessionsStore);
  };

  const createSession = useCallback(
    async (title = "New Chat", initialMessages: Message[] = [], config: LLMConfig | null = null) => {
      const id = crypto.randomUUID();
      const newSession: ChatSession = {
        id,
        title,
        llmConfig: config,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const newSessions = [newSession, ...sessions];
      await persistSessions(newSessions);
      await set(id, initialMessages, messagesStore);
      
      setActiveSessionIdState(id);
      return id;
    },
    [sessions]
  );

  const deleteSession = useCallback(
    async (id: string) => {
      const newSessions = sessions.filter((s) => s.id !== id);
      await persistSessions(newSessions);
      await del(id, messagesStore);

      if (activeSessionId === id) {
        if (newSessions.length > 0) {
          setActiveSessionIdState(newSessions[0].id);
        } else {
          // If we deleted the very last session, auto-create a new empty one
          const newId = crypto.randomUUID();
          const newSession: ChatSession = {
            id: newId,
            title: "New Chat",
            llmConfig: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await persistSessions([newSession]);
          await set(newId, [], messagesStore);
          setActiveSessionIdState(newId);
        }
      }
    },
    [sessions, activeSessionId]
  );

  const updateSessionMessages = useCallback(
    async (id: string, messages: Message[]) => {
      setSessions((prevSessions) => {
        const newSessions = prevSessions.map((s) => {
          if (s.id === id) {
            let updatedTitle = s.title;
            if (
              s.title === "New Chat" &&
              messages.length > 0 &&
              messages[0].role === "user"
            ) {
              const firstContent = messages[0].content;
              if (typeof firstContent === "string") {
                updatedTitle =
                  firstContent.slice(0, 30) +
                  (firstContent.length > 30 ? "..." : "");
              }
            }
            return { ...s, title: updatedTitle, updatedAt: Date.now() };
          }
          return s;
        });

        // Save messages without awaiting in the state updater
        set(id, messages, messagesStore).catch((error: any) => {
          if (error.name === "QuotaExceededError" || error.message?.includes("quota")) {
            toast.error("Storage limit reached. Please delete old chats to free up space.");
          } else {
            console.error("Failed to save messages:", error);
          }
        });
        
        // Also save the session list
        set("all-sessions", newSessions, sessionsStore).catch(console.error);

        return newSessions;
      });

      if (id === activeSessionId) {
        setActiveMessages(messages);
      }
    },
    [activeSessionId]
  );

  const updateSessionLlmConfig = useCallback(
    async (id: string, config: LLMConfig | null) => {
      setSessions((prev) => {
        const newSessions = prev.map((s) =>
          s.id === id ? { ...s, llmConfig: config, updatedAt: Date.now() } : s
        );
        set("all-sessions", newSessions, sessionsStore).catch(console.error);
        return newSessions;
      });
    },
    []
  );

  const updateSessionTitle = useCallback(
    async (id: string, title: string) => {
      setSessions((prev) => {
        const newSessions = prev.map((s) =>
          s.id === id ? { ...s, title, updatedAt: Date.now() } : s
        );
        set("all-sessions", newSessions, sessionsStore).catch(console.error);
        return newSessions;
      });
    },
    []
  );

  const clearAllSessions = useCallback(async () => {
    await clear(sessionsStore);
    await clear(messagesStore);
    
    // Auto-create a fresh new chat after clearing
    const newId = crypto.randomUUID();
    const newSession: ChatSession = {
      id: newId,
      title: "New Chat",
      llmConfig: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await set("all-sessions", [newSession], sessionsStore);
    await set(newId, [], messagesStore);
    
    setSessions([newSession]);
    setActiveSessionIdState(newId);
    setActiveMessages([]);
  }, []);

  const setActiveSessionId = useCallback((id: string | null) => {
    setActiveSessionIdState(id);
  }, []);

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
        isLoading,
        isMessagesLoading,
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
