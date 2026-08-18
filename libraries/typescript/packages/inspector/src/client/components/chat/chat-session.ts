import type { PendingChatTurn } from "./chat-auth-retry";
import type { ManagedChatNotice } from "./managedChatNotice";
import { EMPTY_TRACE_STATE, type InspectorTraceState } from "./trace";
import type { Message, MessageAttachment } from "./types";

/** Holds a tool call open while the user completes an interactive OAuth flow. */
export interface ChatAuthorizationGate {
  toolCallId: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

export interface PendingAuthorization {
  toolCallId: string;
  replay: Omit<PendingChatTurn, "savedAt">;
}

export interface McpServerAuthRequired {
  mcpServerUrl: string;
  message?: string;
}

/** Turn machinery that must survive re-renders without triggering them. */
export interface ChatSessionRuntime {
  abortController: AbortController | null;
  sendInProgress: boolean;
  traceId: number;
  authorizationGate: ChatAuthorizationGate | null;
  /** Set once the turn restored from an OAuth redirect has replayed. */
  pendingTurnResumed: boolean;
}

/**
 * Everything one chat session owns.
 *
 * `id` is the session's only identity: it is minted when the session is created
 * and handed to `ChatStorageProvider.createChat`, so runtime state, persistence
 * and OAuth recovery all name the same chat. `persistedChatId` differs from
 * `id` only when a storage backend insists on minting its own id.
 */
export interface ChatSessionState {
  readonly id: string;
  messages: Message[];
  attachments: MessageAttachment[];
  isLoading: boolean;
  trace: InspectorTraceState;
  managedChatNotice: ManagedChatNotice | null;
  pendingAuthorization: PendingAuthorization | null;
  authenticatingToolCallId: string | null;
  toolAuthorizationError: string | null;
  mcpServerAuthRequired: McpServerAuthRequired | null;
  persistedChatId: string | null;
  /** In-flight `createChat` call, so concurrent writes persist to one chat. */
  creation: Promise<string | null> | null;
  readonly runtime: ChatSessionRuntime;
}

export function createChatSession(
  id: string,
  messages: Message[] = []
): ChatSessionState {
  return {
    id,
    messages,
    attachments: [],
    isLoading: false,
    trace: EMPTY_TRACE_STATE,
    managedChatNotice: null,
    pendingAuthorization: null,
    authenticatingToolCallId: null,
    toolAuthorizationError: null,
    mcpServerAuthRequired: null,
    persistedChatId: null,
    creation: null,
    runtime: {
      abortController: null,
      sendInProgress: false,
      traceId: 0,
      authorizationGate: null,
      pendingTurnResumed: false,
    },
  };
}

/** Mints the identity a session keeps for its whole lifetime. */
export function createChatSessionId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  // randomUUID is unavailable outside secure contexts; ids only need to be
  // unique within this tab, so a timestamp plus randomness is enough.
  const suffix = Math.random().toString(36).slice(2, 10);
  return `chat-${Date.now().toString(36)}-${suffix}`;
}
