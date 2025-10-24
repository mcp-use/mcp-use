import type { JSONSchema } from '@dmitryrechkin/json-schema-to-zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type {
  CallToolResult,
  Tool as MCPTool,
} from '@modelcontextprotocol/sdk/types.js'
import type { ZodTypeAny } from 'zod'
import type { BaseConnector } from '../connectors/base.js'

import { JSONSchemaToZod } from '@dmitryrechkin/json-schema-to-zod'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z, ZodError } from 'zod'
import { logger } from '../logging.js'
import { BaseAdapter } from './base.js'

function schemaToZod(schema: unknown): ZodTypeAny {
  try {
    return JSONSchemaToZod.convert(schema as JSONSchema)
  }
  catch (err) {
    logger.warn(`Failed to convert JSON schema to Zod: ${err}`)
    return z.any()
  }
}


export class LangChainAdapter extends BaseAdapter<StructuredToolInterface> {
  constructor(disallowedTools: string[] = []) {
    super(disallowedTools)
  }

  /**
   * Convert a single MCP tool specification into a LangChainJS structured tool.
   */
  protected convertTool(
    mcpTool: MCPTool,
    connector: BaseConnector,
  ): StructuredToolInterface | null {
    // Filter out disallowed tools early.
    if (this.disallowedTools.includes(mcpTool.name)) {
      return null
    }

    // Derive a strict Zod schema for the tool's arguments.
    let argsSchema: ZodTypeAny = mcpTool.inputSchema
      ? schemaToZod(mcpTool.inputSchema)
      : z.object({}).optional()

    // TEMPORARY HACK: Force schema validation errors for testing
    // TODO: Remove this hack after testing agent recovery behavior
    // Only apply to browser_navigate tool for testing
    if (mcpTool.name === 'browser_navigate' && argsSchema && typeof argsSchema === 'object' && '_def' in argsSchema) {
      // Replace the URL field with a strict pattern that will reject valid URLs
      // This creates a mismatch where LLM provides valid URLs but schema expects invalid pattern
      const originalSchema = argsSchema as z.ZodObject<any>
      const originalShape = originalSchema._def.shape() || {}
      argsSchema = z.object({
        ...originalShape,
        url: z.string().regex(/^INVALID_PATTERN$/).describe('URL must match pattern INVALID_PATTERN (impossible)')
      })
      logger.warn(`⚠️ HACK ACTIVE: Changed URL schema to impossible pattern for tool "${mcpTool.name}"`)
    }

    const tool = new DynamicStructuredTool({
      name: mcpTool.name ?? 'NO NAME',
      description: mcpTool.description ?? '', // Blank is acceptable but discouraged.
      schema: argsSchema,
      func: async (input: Record<string, any>): Promise<string> => {
        logger.debug(`MCP tool "${mcpTool.name}" received input: ${JSON.stringify(input)}`)
        try {
          // Remove the hack field before calling the actual tool
          const cleanInput = { ...input }
          delete cleanInput._FORCE_SCHEMA_ERROR

          const result: CallToolResult = await connector.callTool(mcpTool.name, cleanInput)
          return JSON.stringify(result)
        }
        catch (err: any) {
          logger.error(`Error executing MCP tool: ${err.message}`)
          return `Error executing MCP tool: ${String(err)}`
        }
      },
    })

    // Note: Schema validation errors from DynamicStructuredTool are handled
    // at the agent level to allow retry with corrected arguments
    return tool
  }
}
