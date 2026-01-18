import { MCPClient } from "mcp-use";
import { loadEvalConfig } from "../runtime/loadEvalConfig.js";

/**
 * Simplified schema for a tool extracted from MCP server inspection.
 */
export interface ToolSchema {
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
  /** JSON Schema for tool input parameters */
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Simplified schema for a resource extracted from MCP server inspection.
 */
export interface ResourceSchema {
  /** Resource name */
  name: string;
  /** Resource URI pattern */
  uri: string;
  /** Optional resource description */
  description?: string;
  /** MIME type of resource content */
  mimeType?: string;
}

/**
 * Complete schema for an MCP server including its tools and resources.
 */
export interface ServerSchema {
  /** Server name from config */
  name: string;
  /** Available tools */
  tools: ToolSchema[];
  /** Available resources */
  resources: ResourceSchema[];
}

/**
 * Map MCP tool to simplified ToolSchema.
 *
 * @param tool - Tool object from MCP server
 * @returns Simplified tool schema
 * @internal
 */
export function mapTool(tool: {
  name: string;
  description?: string;
  inputSchema: unknown;
}): ToolSchema {
  return {
    name: tool.name,
    description: tool.description || "",
    inputSchema: tool.inputSchema as ToolSchema["inputSchema"],
  };
}

/**
 * Map MCP resource to simplified ResourceSchema.
 *
 * @param resource - Resource object from MCP server
 * @returns Simplified resource schema
 * @internal
 */
export function mapResource(resource: {
  name: string;
  uri: string;
  description?: string;
  mimeType?: string;
}): ResourceSchema {
  return {
    name: resource.name,
    uri: resource.uri,
    description: resource.description,
    mimeType: resource.mimeType,
  };
}

/**
 * Inspect MCP servers and extract their tool and resource schemas.
 *
 * Connects to configured MCP servers, queries their capabilities,
 * and returns simplified schemas suitable for test generation.
 *
 * @param options - Inspection options
 * @param options.configPath - Path to eval config file
 * @param options.servers - Server keys to inspect (defaults to all servers in config)
 * @returns Array of server schemas with tools and resources
 *
 * @example
 * ```typescript
 * const schemas = await inspectServers({ servers: ["weather"] });
 * console.log(schemas[0].tools); // [{ name: "get_weather", ... }]
 * ```
 */
export async function inspectServers(
  options: {
    configPath?: string;
    servers?: string[];
  } = {}
): Promise<ServerSchema[]> {
  const config = await loadEvalConfig(options.configPath);
  const client = new MCPClient({ mcpServers: config.servers });

  try {
    await client.createAllSessions();
  } catch (error) {
    console.error("Warning: Some servers failed to initialize fully:", error);
    // Continue anyway - some servers might have connected
  }

  const serverNames = options.servers ?? Object.keys(config.servers);
  const schemas: ServerSchema[] = [];

  for (const serverName of serverNames) {
    try {
      const session = client.requireSession(serverName);
      const tools = session.tools.map(mapTool);

      // Try to list resources, but gracefully handle if not supported
      let resources: ResourceSchema[] = [];
      try {
        const resourcesResult = await session.listResources();
        resources = (resourcesResult.resources || []).map(mapResource);
      } catch (error) {
        // Server doesn't support resources capability, that's ok
        console.log(`Note: Server "${serverName}" doesn't support resources`);
      }

      schemas.push({ name: serverName, tools, resources });
    } catch (error) {
      console.warn(`Warning: Failed to inspect server "${serverName}":`, error);
      // Continue with other servers
    }
  }

  await client.closeAllSessions().catch(() => {
    // Ignore cleanup errors
  });

  return schemas;
}
