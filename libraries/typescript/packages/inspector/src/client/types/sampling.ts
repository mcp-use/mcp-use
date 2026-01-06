import type {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";

export interface PendingSamplingRequest {
  id: string;
  request: CreateMessageRequest;
  timestamp: number;
  serverName: string;
  toolName?: string; // Track which tool triggered this sampling request
}

export interface SamplingRequestWithHandlers extends PendingSamplingRequest {
  resolve: (result: CreateMessageResult) => void;
  reject: (error: Error) => void;
}

// Default sampling response for quick approval
export const DEFAULT_SAMPLING_RESPONSE: CreateMessageResult = {
  model: "stub-model",
  stopReason: "endTurn",
  role: "assistant",
  content: {
    type: "text",
    text: "positive", // Generic positive response for sentiment/analysis tasks
  },
};
