import type { CallbackManagerForToolRun } from '@langchain/core/callbacks/manager'
import type { ToolParams, ToolRunnableConfig, ToolSchemaBase } from '@langchain/core/tools'
import type { JSONSchema } from '@langchain/core/utils/json_schema'
import type z from 'zod'
import type { ServerManager } from '../server_manager.js'
import { StructuredTool } from '@langchain/core/tools'

export type ToolOutputT = any
export type SchemaOutputT<T extends ToolSchemaBase> = T extends z.ZodSchema
  ? z.output<T>
  : T extends JSONSchema
    ? unknown
    : never

export interface MCPServerToolOptions extends ToolParams {
  name?: string
  description?: string
  returnDirect?: boolean
  sandboxId?: string
}

export class MCPServerTool<SchemaT extends ToolSchemaBase> extends StructuredTool<SchemaT, SchemaOutputT<SchemaT>> {
  override name: string = 'mcp_server_tool'
  override description: string = 'Base tool for MCP server operations.'
  override schema!: SchemaT

  private readonly _manager: ServerManager

  constructor(manager: ServerManager) {
    super()
    this._manager = manager
  }

  protected async _call(
    _arg: SchemaOutputT<SchemaT>,
    _runManager?: CallbackManagerForToolRun,
    _parentConfig?: ToolRunnableConfig,
  ): Promise<ToolOutputT> {
    throw new Error('Method not implemented.')
  }

  get manager(): ServerManager {
    return this._manager
  }
}
