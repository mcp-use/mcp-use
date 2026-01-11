import type { JSONSchema } from "../utils/json-schema-to-zod/index.js";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type {
  CallToolResult,
  Tool as MCPTool,
  Resource,
  Prompt,
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

  /**
   * Convert a single MCP resource into a LangChainJS structured tool.
   * Each resource becomes an async tool that returns its content when called.
   */
  protected convertResource(
    mcpResource: Resource,
    connector: BaseConnector
  ): StructuredToolInterface | null {
    const sanitizeName = (name: string): string => {
      return name
        .replace(/[^A-Za-z0-9_]+/g, "_")
        .toLowerCase()
        .replace(/^_+|_+$/g, "");
    };

    const resourceName = sanitizeName(
      mcpResource.name || `resource_${mcpResource.uri}`
    );
    const resourceUri = mcpResource.uri;

    const tool = new DynamicStructuredTool({
      name: resourceName,
      description:
        mcpResource.description ||
        `Return the content of the resource located at URI ${resourceUri}.`,
      schema: z.object({}).optional(), // Resources take no arguments
      func: async (): Promise<string> => {
        logger.debug(`Resource tool: "${resourceName}" called`);
        try {
          const result = await connector.readResource(resourceUri);
          if (result.contents && result.contents.length > 0) {
            return result.contents
              .map((content: any) => {
                if (typeof content === "string") {
                  return content;
                }
                if (content.text) {
                  return content.text;
                }
                if (content.uri) {
                  return content.uri;
                }
                return JSON.stringify(content);
              })
              .join("\n");
          }
          return "Resource is empty or unavailable";
        } catch (err: any) {
          logger.error(`Error reading resource: ${err.message}`);
          return `Error reading resource: ${String(err)}`;
        }
      },
    });

    return tool;
  }

  /**
   * Convert a single MCP prompt into a LangChainJS structured tool.
   * The resulting tool executes getPrompt on the connector with the prompt's name
   * and the user-provided arguments (if any).
   */
  protected convertPrompt(
    mcpPrompt: Prompt,
    connector: BaseConnector
  ): StructuredToolInterface | null {
    // Build Zod schema from prompt arguments
    let argsSchema: ZodTypeAny = z.object({}).optional();

    if (mcpPrompt.arguments && mcpPrompt.arguments.length > 0) {
      const schemaFields: Record<string, ZodTypeAny> = {};
      for (const arg of mcpPrompt.arguments) {
        // All arguments default to string type since type is not available in Prompt definition
        // (Note: MCP spec includes type, but SDK TypeScript types don't)
        const zodType: ZodTypeAny = z.string();

        if (arg.required !== false) {
          schemaFields[arg.name] = zodType;
        } else {
          schemaFields[arg.name] = zodType.optional();
        }
      }
      argsSchema =
        Object.keys(schemaFields).length > 0
          ? z.object(schemaFields)
          : z.object({}).optional();
    }

    const tool = new DynamicStructuredTool({
      name: mcpPrompt.name,
      description: mcpPrompt.description || "",
      schema: argsSchema,
      func: async (input: Record<string, any>): Promise<string> => {
        logger.debug(
          `Prompt tool: "${mcpPrompt.name}" called with args: ${JSON.stringify(input)}`
        );
        try {
          const result = await connector.getPrompt(mcpPrompt.name, input);
          if (result.messages && result.messages.length > 0) {
            return result.messages
              .map((msg: any) => {
                if (typeof msg === "string") {
                  return msg;
                }
                if (msg.content) {
                  return typeof msg.content === "string"
                    ? msg.content
                    : JSON.stringify(msg.content);
                }
                return JSON.stringify(msg);
              })
              .join("\n");
          }
          return "Prompt returned no messages";
        } catch (err: any) {
          logger.error(`Error getting prompt: ${err.message}`);
          return `Error getting prompt: ${String(err)}`;
        }
      },
    });

    return tool;
  }
}
