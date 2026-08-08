import type {
  Prompt,
  Resource,
  Tool as MCPTool,
} from "@modelcontextprotocol/client";
import type { BaseConnector } from "@mcp-use/client";
import { logger } from "@mcp-use/client";
import type { ProviderTool } from "../llm/types.js";
import { BaseAdapter } from "./base.js";

function sanitizeToolName(name: string): string {
  return name
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "");
}

/** Native tool definition paired with its internal dispatch route. */
export interface NativeToolEntry extends ProviderTool {
  /** Internal dispatch key (may differ from MCP name after dedup). */
  dispatchKey: string;
}

/** Invokes a native adapter tool by its exposed name. */
export type NativeCallToolFn = (
  name: string,
  args: Record<string, unknown>
) => Promise<unknown>;

interface ToolHandler {
  connector: BaseConnector;
  kind: "tool" | "resource" | "prompt";
  mcpName: string;
  resourceUri?: string;
}

/**
 * Converts MCP tools, resources, and prompts into provider-neutral tools.
 *
 * The adapter also creates a dispatcher that routes model tool calls back to
 * the connector that supplied each tool.
 */
export class NativeAdapter extends BaseAdapter<NativeToolEntry> {
  private usedToolNames = new Set<string>();
  private handlers = new Map<string, ToolHandler>();

  /**
   * @param disallowedTools - MCP tool names to omit during conversion.
   */
  constructor(disallowedTools: string[] = []) {
    super(disallowedTools);
  }

  /**
   * Converts MCP tools from all connectors and resets the dispatch table.
   *
   * @param connectors - Connected MCP connectors.
   * @returns Provider-neutral tool entries.
   */
  public override async createToolsFromConnectors(
    connectors: BaseConnector[]
  ): Promise<NativeToolEntry[]> {
    this.usedToolNames.clear();
    this.handlers.clear();
    return super.createToolsFromConnectors(connectors);
  }

  /**
   * Creates a dispatcher for the entries loaded by this adapter.
   *
   * @returns A function that invokes tools, reads resources, or gets prompts.
   * @throws Error if the requested exposed tool name is unknown.
   */
  createCallTool(): NativeCallToolFn {
    const handlers = this.handlers;
    return async (name, args) => {
      const handler = handlers.get(name);
      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }
      try {
        if (handler.kind === "tool") {
          return await handler.connector.callTool(handler.mcpName, args);
        }
        if (handler.kind === "resource") {
          const uri = handler.resourceUri ?? handler.mcpName;
          return await handler.connector.readResource(uri);
        }
        return await handler.connector.getPrompt(handler.mcpName, args);
      } catch (err) {
        logger.error(`Error executing native MCP tool ${name}: ${err}`);
        throw err;
      }
    };
  }

  /**
   * Removes internal dispatch metadata from native tool entries.
   *
   * @param entries - Entries created by this adapter.
   * @returns Provider-neutral definitions safe to send to an LLM provider.
   */
  toProviderTools(entries: NativeToolEntry[]): ProviderTool[] {
    return entries.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  private reserveName(name: string, kind?: "resource" | "prompt"): string {
    if (!this.usedToolNames.has(name)) {
      this.usedToolNames.add(name);
      return name;
    }
    if (kind) {
      const prefixed = `${kind}_${name}`;
      if (!this.usedToolNames.has(prefixed)) {
        this.usedToolNames.add(prefixed);
        return prefixed;
      }
      let i = 2;
      while (this.usedToolNames.has(`${prefixed}_${i}`)) i++;
      const fallback = `${prefixed}_${i}`;
      this.usedToolNames.add(fallback);
      return fallback;
    }
    let i = 2;
    while (this.usedToolNames.has(`${name}_${i}`)) i++;
    const fallback = `${name}_${i}`;
    this.usedToolNames.add(fallback);
    return fallback;
  }

  private register(
    entry: NativeToolEntry,
    handler: ToolHandler
  ): NativeToolEntry {
    this.handlers.set(entry.name, handler);
    return entry;
  }

  protected convertTool(
    mcpTool: MCPTool,
    connector: BaseConnector
  ): NativeToolEntry | null {
    if (this.disallowedTools.includes(mcpTool.name)) return null;

    const toolName = this.reserveName(mcpTool.name ?? "tool");
    const entry: NativeToolEntry = {
      name: toolName,
      dispatchKey: toolName,
      description: mcpTool.description ?? "",
      inputSchema: (mcpTool.inputSchema as Record<string, unknown>) ?? {
        type: "object",
        properties: {},
      },
    };
    return this.register(entry, {
      connector,
      kind: "tool",
      mcpName: mcpTool.name,
    });
  }

  protected convertResource(
    mcpResource: Resource,
    connector: BaseConnector
  ): NativeToolEntry | null {
    const resourceBaseName =
      sanitizeToolName(mcpResource.name || mcpResource.uri) || "resource";
    const resourceName = this.reserveName(resourceBaseName, "resource");
    const entry: NativeToolEntry = {
      name: resourceName,
      dispatchKey: resourceName,
      description:
        mcpResource.description ||
        `Return the content of the resource located at URI ${mcpResource.uri}.`,
      inputSchema: { type: "object", properties: {} },
    };
    return this.register(entry, {
      connector,
      kind: "resource",
      mcpName: mcpResource.uri,
      resourceUri: mcpResource.uri,
    });
  }

  protected convertPrompt(
    mcpPrompt: Prompt,
    connector: BaseConnector
  ): NativeToolEntry | null {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    if (mcpPrompt.arguments?.length) {
      for (const arg of mcpPrompt.arguments) {
        properties[arg.name] = { type: "string", description: arg.description };
        if (arg.required !== false) required.push(arg.name);
      }
    }

    const promptBaseName =
      sanitizeToolName(mcpPrompt.name || "prompt") || "prompt";
    const promptName = this.reserveName(promptBaseName, "prompt");
    const entry: NativeToolEntry = {
      name: promptName,
      dispatchKey: promptName,
      description: mcpPrompt.description || "",
      inputSchema: {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    };
    return this.register(entry, {
      connector,
      kind: "prompt",
      mcpName: mcpPrompt.name,
    });
  }
}
