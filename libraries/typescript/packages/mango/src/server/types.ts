/**
 * TypeScript types for Mango Agent
 */

export interface StreamEvent {
  type: string;
  [key: string]: any;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface SandboxInfo {
  sandbox: any; // E2B Sandbox type
  agentReady: boolean;
  phase: 1 | "complete";
  devServerUrl?: string | null;
  isIdle?: boolean; // Whether this sandbox is in the warm pool
  conversationId?: string; // Which conversation is using this sandbox
}

export interface AgentEvent {
  type:
    | "status"
    | "assistant"
    | "tool_result"
    | "tool_use"
    | "stream_event"
    | "result"
    | "error"
    | "done"
    | "sandbox_status"
    | "phase_status"
    | "mcp_status"
    | "dev_server_status"
    | "transition"
    | "stream_complete"
    | "todo_update"
    | "token"
    | "server_ready";
  phase?: 1 | 2;
  status?: string;
  message?: string;
  error?: string;
  tool?: string;
  tool_use_id?: string;
  text?: string;
  url?: string;
  port?: number;
  [key: string]: any;
}

export interface ChatRequest {
  messages: ChatMessage[];
  conversationId: string;
}
