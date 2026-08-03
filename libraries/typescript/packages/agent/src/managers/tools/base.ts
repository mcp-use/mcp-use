import type { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import type { ToolRunnableConfig, ToolSchemaBase } from "@langchain/core/tools";
import type { JSONSchema } from "@langchain/core/utils/json_schema";
import type z from "zod";
import type { IServerManager } from "../types.js";
import { StructuredTool } from "@langchain/core/tools";

type ToolOutputT = any;
export type SchemaOutputT<T extends ToolSchemaBase> = T extends z.ZodSchema
  ? z.output<T>
  : T extends JSONSchema
    ? unknown
    : never;

export class MCPServerTool<
  SchemaT extends ToolSchemaBase,
> extends StructuredTool<SchemaT, SchemaOutputT<SchemaT>> {
  /** Default tool name. Subclasses replace this value. */
  override name: string = "mcp_server_tool";
  /** Default tool description. Subclasses replace this value. */
  override description: string = "Base tool for MCP server operations.";
  /** Input schema supplied by the concrete management tool. */
  override schema!: SchemaT;

  private readonly _manager: IServerManager;

  /**
   * @param manager - Server manager operated by this tool.
   */
  constructor(manager: IServerManager) {
    super();
    this._manager = manager;
  }

  protected async _call(
    _arg: SchemaOutputT<SchemaT>,
    _runManager?: CallbackManagerForToolRun,
    _parentConfig?: ToolRunnableConfig
  ): Promise<ToolOutputT> {
    throw new Error("Method not implemented.");
  }

  /** @returns The server manager operated by this tool. */
  get manager(): IServerManager {
    return this._manager;
  }
}
