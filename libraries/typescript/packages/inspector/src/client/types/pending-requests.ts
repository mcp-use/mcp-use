import type {
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequestFormParams,
  ElicitRequestURLParams,
} from "@mcp-use/client/react";

export interface PendingElicitationRequest {
  id: string;
  request: ElicitRequestFormParams | ElicitRequestURLParams;
  timestamp: number;
  serverName: string;
  toolName?: string;
}

export interface PendingSamplingRequest {
  id: string;
  request: CreateMessageRequest;
  timestamp: number;
  serverName: string;
  toolName?: string;
}

export const DEFAULT_SAMPLING_RESPONSE: CreateMessageResult = {
  model: "stub-model",
  stopReason: "endTurn",
  role: "assistant",
  content: {
    type: "text",
    text: "positive",
  },
};
