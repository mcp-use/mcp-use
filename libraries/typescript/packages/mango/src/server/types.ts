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
  phase: 1 | 2 | "complete";
  mcpServerPort?: number;
  mcpServerRunning?: boolean;
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
  [key: string]: any;
}

export interface ChatRequest {
  messages: ChatMessage[];
  conversationId: string;
}
