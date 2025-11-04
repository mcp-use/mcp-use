import type { StructuredToolInterface } from "@langchain/core/tools";
import type { LangChainAdapter } from "../adapters/langchain_adapter.js";
import type { MCPClient } from "../client.js";

export interface IServerManager {
  readonly initializedServers: Record<string, boolean>;
  readonly serverTools: Record<string, StructuredToolInterface[]>;
  readonly client: MCPClient;
  readonly adapter: LangChainAdapter;
  activeServer: string | null;

  setManagementTools(tools: StructuredToolInterface[]): void;
  prefetchServerTools(): Promise<void>;
  get tools(): StructuredToolInterface[];
}
