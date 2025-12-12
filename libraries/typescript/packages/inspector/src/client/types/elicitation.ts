import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
} from "@mcp-use/modelcontextprotocol-sdk/types.js";

export interface PendingElicitationRequest {
  id: string;
  request: ElicitRequestFormParams | ElicitRequestURLParams;
  timestamp: number;
  serverName: string;
  toolName?: string; // Track which tool triggered this elicitation request
}

export interface ElicitationRequestWithHandlers extends PendingElicitationRequest {
  resolve: (result: ElicitResult) => void;
  reject: (error: Error) => void;
}

// Default elicitation response for quick acceptance (cancel action)
export const DEFAULT_ELICITATION_CANCEL: ElicitResult = {
  action: "cancel",
};
