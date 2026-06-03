import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
} from "@modelcontextprotocol/sdk/types.js";

export interface PendingElicitationRequest {
  id: string;
  request: ElicitRequestFormParams | ElicitRequestURLParams;
  timestamp: number;
  serverName: string;
  toolName?: string; // Track which tool triggered this elicitation request
}
