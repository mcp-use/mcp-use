import type { JSONSchema } from "../utils/json-schema-to-zod/index.js";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type {
  CallToolResult,
  Tool as MCPTool,
} from "@modelcontextprotocol/sdk/types.js";
import type { ZodTypeAny } from "zod";
import type { BaseConnector } from "../connectors/base.js";

import { JSONSchemaToZod } from "../utils/json-schema-to-zod/index.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logging.js";
import { BaseAdapter } from "./base.js";

function schemaToZod(schema: unknown): ZodTypeAny {
  try {
    return JSONSchemaToZod.convert(schema as JSONSchema);
  } catch (err) {
    logger.warn(`Failed to convert JSON schema to Zod: ${err}`);
    return z.any();
  }
}

export class LangChainAdapter extends BaseAdapter<StructuredToolInterface> {
  constructor(disallowedTools: string[] = []) {
    super(disallowedTools);
  }

  /**
   * Convert a single MCP tool specification into a LangChainJS structured tool.
   */
  protected convertTool(
    mcpTool: MCPTool,
    connector: BaseConnector
  ): StructuredToolInterface | null {
    // Filter out disallowed tools early.
    if (this.disallowedTools.includes(mcpTool.name)) {
      return null;
    }

    // Derive a strict Zod schema for the tool's arguments.
    const argsSchema: ZodTypeAny = mcpTool.inputSchema
      ? schemaToZod(mcpTool.inputSchema)
      : z.object({}).optional();

    const tool = new DynamicStructuredTool({
      name: mcpTool.name ?? "NO NAME",
      description: mcpTool.description ?? "", // Blank is acceptable but discouraged.
      schema: argsSchema,
      func: async (input: Record<string, any>): Promise<string> => {
        logger.debug(
          `MCP tool "${mcpTool.name}" received input: ${JSON.stringify(input)}`
        );
        try {
          const result: CallToolResult = await connector.callTool(
            mcpTool.name,
            input
          );
          return JSON.stringify(result);
        } catch (err: any) {
          logger.error(`Error executing MCP tool: ${err.message}`);
          return `Error executing MCP tool: ${String(err)}`;
        }
      },
    });

    return tool;
  }
}
