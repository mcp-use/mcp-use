import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
} from "@modelcontextprotocol/client";

export interface PendingElicitationRequest {
  id: string;
  request: ElicitRequestFormParams | ElicitRequestURLParams;
  timestamp: number;
  serverName: string;
  toolName?: string; // Track which tool triggered this elicitation request
}
