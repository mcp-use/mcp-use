import type { Message } from "@/client/components/chat/types";

/** Chat session kind from the chats API. */
export type ChatType = string;

export type ChatSession = {
  id: string;
  title: string;
  agent_id: string;
  /** Omitted on some API rows — treat as regular chat unless `"agent_execution"`. */
  type?: ChatType;
  agent_name: string;
  created_at: string;
  updated_at: string;
};

export interface ListChatsParams {
  agentId?: string;
  take?: number;
  skip?: number;
}

export interface ChatStorageProvider {
  listChats(
    params: ListChatsParams
  ): Promise<{ items: ChatSession[]; total: number }>;
  getMessages(chatId: string): Promise<Message[]>;
  createChat(params: {
    agentId: string;
    title?: string;
    agentName?: string;
  }): Promise<ChatSession>;
  updateChat(
    chatId: string,
    patch: { title?: string }
  ): Promise<ChatSession>;
  deleteChat(chatId: string): Promise<void>;
  /** Optional — local provider implements; cloud relies on /stream event writes */
  saveMessages?(chatId: string, messages: Message[]): Promise<void>;
  /** Optional — cloud uses API; standalone may use built-in LLM fallback in ChatTab */
  generateTitle?(chatId: string): Promise<string | null>;
}
