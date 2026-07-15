import type { Message } from "@/client/components/chat/types";
import type {
  ChatSession,
  ChatStorageProvider,
  ListChatsParams,
} from "../types";

const STORAGE_KEY = "mcp-inspector-chats";
const DEFAULT_TITLE = "New Chat";
const AUTO_TITLE_MAX = 40;

type StoredChats = {
  sessions: ChatSession[];
  messages: Record<string, Message[]>;
};

function readStore(): StoredChats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sessions: [], messages: {} };
    const parsed = JSON.parse(raw) as StoredChats;
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      messages:
        parsed.messages && typeof parsed.messages === "object"
          ? parsed.messages
          : {},
    };
  } catch {
    return { sessions: [], messages: {} };
  }
}

function writeStore(store: StoredChats): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function nowIso(): string {
  return new Date().toISOString();
}

function autoTitleFromMessages(messages: Message[]): string | undefined {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return undefined;
  const text =
    typeof firstUser.content === "string"
      ? firstUser.content.trim()
      : String(firstUser.content ?? "").trim();
  if (!text) return undefined;
  return text.length > AUTO_TITLE_MAX
    ? `${text.slice(0, AUTO_TITLE_MAX)}…`
    : text;
}

export class LocalChatStorageProvider implements ChatStorageProvider {
  // ponytail: single-key blob, O(n) list scan — fine for local dev ceiling
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async listChats(
    params: ListChatsParams
  ): Promise<{ items: ChatSession[]; total: number }> {
    const { sessions } = readStore();
    let filtered = sessions;
    if (params.agentId) {
      filtered = sessions.filter((s) => s.agent_id === params.agentId);
    }
    filtered = [...filtered].sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
    const total = filtered.length;
    const skip = params.skip ?? 0;
    const take = params.take ?? total;
    return { items: filtered.slice(skip, skip + take), total };
  }

  async getMessages(chatId: string): Promise<Message[]> {
    const { messages } = readStore();
    return messages[chatId] ?? [];
  }

  async createChat(params: {
    agentId: string;
    title?: string;
    agentName?: string;
  }): Promise<ChatSession> {
    const store = readStore();
    const ts = nowIso();
    const session: ChatSession = {
      id: crypto.randomUUID(),
      title: params.title ?? DEFAULT_TITLE,
      agent_id: params.agentId,
      agent_name: params.agentName ?? "MCP Server",
      created_at: ts,
      updated_at: ts,
    };
    store.sessions.push(session);
    store.messages[session.id] = [];
    writeStore(store);
    return session;
  }

  async updateChat(
    chatId: string,
    patch: { title?: string }
  ): Promise<ChatSession> {
    const store = readStore();
    const idx = store.sessions.findIndex((s) => s.id === chatId);
    if (idx === -1) throw new Error(`Chat not found: ${chatId}`);
    const session = store.sessions[idx]!;
    if (patch.title !== undefined) session.title = patch.title;
    session.updated_at = nowIso();
    store.sessions[idx] = session;
    writeStore(store);
    return session;
  }

  async deleteChat(chatId: string): Promise<void> {
    const store = readStore();
    store.sessions = store.sessions.filter((s) => s.id !== chatId);
    delete store.messages[chatId];
    writeStore(store);
  }

  async saveMessages(chatId: string, messages: Message[]): Promise<void> {
    const pending = this.saveTimers.get(chatId);
    if (pending) clearTimeout(pending);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.saveTimers.delete(chatId);
        const store = readStore();
        store.messages[chatId] = messages;
        const idx = store.sessions.findIndex((s) => s.id === chatId);
        if (idx !== -1) {
          const session = store.sessions[idx]!;
          session.updated_at = nowIso();
          if (session.title === DEFAULT_TITLE) {
            const title = autoTitleFromMessages(messages);
            if (title) session.title = title;
          }
          store.sessions[idx] = session;
        }
        writeStore(store);
        resolve();
      }, 500);
      this.saveTimers.set(chatId, timer);
    });
  }
}
