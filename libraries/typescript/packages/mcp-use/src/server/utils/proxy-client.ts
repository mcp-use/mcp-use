import type { MCPSession } from "../../session.js";
import type { MCPServer } from "../mcp-server.js";
import { z } from "zod";

// Add a helper to convert JSON Schema to Zod Schema
function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") return z.any();

  if (schema.type === "object") {
    const shape: Record<string, z.ZodTypeAny> = {};
    if (schema.properties) {
      for (const [key, prop] of Object.entries<any>(schema.properties)) {
        let propSchema = jsonSchemaToZod(prop);
        if (prop.description) {
          propSchema = propSchema.describe(prop.description);
        }
        if (!schema.required?.includes(key)) {
          propSchema = propSchema.optional();
        }
        shape[key] = propSchema;
      }
    }
    return z.object(shape);
  }

  if (schema.type === "string") return z.string();
  if (schema.type === "number" || schema.type === "integer") return z.number();
  if (schema.type === "boolean") return z.boolean();
  if (schema.type === "array") {
    return schema.items
      ? z.array(jsonSchemaToZod(schema.items))
      : z.array(z.any());
  }

  return z.any();
}

/**
 * Mounts an MCPSession onto an MCPServer, exposing the child server's tools,
 * resources, and prompts under the given namespace.
 *
 * @param parentServer - The parent MCPServer instance
 * @param childSession - The active MCPSession connected to the child server
 * @param namespace - Optional namespace prefix for tools, resources, and prompts
 */
export async function mountSession(
  parentServer: MCPServer<boolean>,
  childSession: MCPSession,
  namespace?: string
): Promise<void> {
  const prefix = namespace ? `${namespace}_` : "";

  // Helper to safely prefix names
  const prefixName = (name: string) => `${prefix}${name}`;

  // 1. Introspect and mount tools
  try {
    const tools = await childSession.listTools();
    for (const tool of tools) {
      const toolName = prefixName(tool.name);

      // We use a passthrough raw zod schema
      // Since the child server already validates, we just pass the raw inputSchema through
      // MCP Server registerTool handles custom schema shapes if we are careful,
      // but the easiest way is to use a Zod schema that accepts anything and validate on the child.
      parentServer.tool(
        {
          name: toolName,
          description: tool.description,
          // Convert raw JSON Schema from the child server to a Zod schema.
          // This ensures compatibility with the underlying MCP SDK which expects Zod.
          schema: jsonSchemaToZod(tool.inputSchema),
        },
        async (params: any, ctx: any) => {
          // Forward the call to the child session
          const result = await childSession.callTool(tool.name, params as any, {
            // Forward progress tokens if they exist
            ...(ctx?._meta?.progressToken && {
              progressToken: ctx._meta.progressToken,
            }),
            onProgress: async (progress: any) => {
              if (ctx?.reportProgress) {
                await ctx.reportProgress(
                  progress.progress,
                  progress.total,
                  progress.message
                );
              }
            },
          });

          if (result.isError) {
            throw new Error(
              result.content[0]?.type === "text"
                ? result.content[0].text
                : "Tool error"
            );
          }

          // Return the full result as text content for now (can map properly)
          return { content: result.content, _meta: result._meta };
        }
      );
    }
  } catch (error) {
    console.warn(
      `[Proxy] Failed to mount tools for ${namespace || "unnamed"}:`,
      error
    );
  }

  // 2. Introspect and mount resources
  try {
    const result = await childSession.listResources();
    for (const res of result.resources) {
      const resName = prefixName(res.name);
      // We'll map the URI directly to the resource URI, but note that the SDK
      // allows registering resources by URI template or exact URI.
      // Since the child URI might conflict if another server has the same URI,
      // The MCP SDK requires resource URIs to be valid URLs (having a protocol).
      // We use the namespace as the protocol or prepend it to the existing protocol.
      const proxyUri = namespace
        ? `${namespace}://${encodeURIComponent(res.uri)}`
        : res.uri;

      parentServer.resource(
        {
          name: resName,
          uri: proxyUri,
          title: res.title,
          description: res.description,
          mimeType: res.mimeType,
        },
        async () => {
          // The proxyUri is statically known for this resource
          const originalUri = res.uri;
          const readResult = await childSession.readResource(originalUri);

          return { contents: readResult.contents };
        }
      );
    }
  } catch (error) {
    console.warn(
      `[Proxy] Failed to mount resources for ${namespace || "unnamed"}:`,
      error
    );
  }

  // 3. Introspect and mount prompts
  try {
    const result = await childSession.listPrompts();
    for (const prompt of result.prompts) {
      const promptName = prefixName(prompt.name);

      parentServer.prompt(
        {
          name: promptName,
          description: prompt.description,
          schema: z.object(
            prompt.arguments?.reduce(
              (acc, arg) => {
                let propSchema: z.ZodTypeAny = z.string();
                if (arg.description) {
                  propSchema = propSchema.describe(arg.description);
                }
                acc[arg.name] = arg.required
                  ? propSchema
                  : propSchema.optional();
                return acc;
              },
              {} as Record<string, z.ZodTypeAny>
            ) || {}
          ),
        },
        async (params: any) => {
          const promptResult = await childSession.getPrompt(
            prompt.name,
            params || {}
          );
          return {
            messages: promptResult.messages,
            description: promptResult.description,
            _meta: promptResult._meta,
          };
        }
      );
    }
  } catch (error) {
    console.warn(
      `[Proxy] Failed to mount prompts for ${namespace || "unnamed"}:`,
      error
    );
  }

  // 4. Setup notifications
  // Forward list_changed notifications from the child session to the parent server
  childSession.on("notification", (notification) => {
    switch (notification.method) {
      case "notifications/tools/list_changed":
        parentServer.nativeServer.server
          .sendToolListChanged()
          .catch(console.error);
        break;
      case "notifications/resources/list_changed":
        parentServer.nativeServer.server
          .sendResourceListChanged()
          .catch(console.error);
        break;
      case "notifications/prompts/list_changed":
        parentServer.nativeServer.server
          .sendPromptListChanged()
          .catch(console.error);
        break;
      default:
        // Ignore other notification types - only forward list_changed
        break;
    }
  });
}
