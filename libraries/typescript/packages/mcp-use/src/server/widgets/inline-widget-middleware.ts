/**
 * Inline Widget Middleware
 *
 * Auto-registered `tools/list` middleware that conditionally enriches
 * tool metadata with widget information based on client capabilities.
 *
 * Instead of statically injecting `widget: { name }` into tool definitions,
 * this middleware checks `ctx.client.supportsApps()` at list-time and only
 * adds `_meta.ui.resourceUri` (and dual-protocol fields) for MCP-Apps-capable clients.
 *
 * This naturally handles conditional widget returns: tools always exist in the
 * list, but widget metadata only appears for clients that can render them.
 */

import { supportsApps } from "../tools/tool-execution-helpers.js";
import { buildDualProtocolMetadata } from "./protocol-helpers.js";

/**
 * Registry entry for an inline widget tool.
 */
export interface InlineWidgetManifestEntry {
  /** Tool name that returns this widget. */
  toolName: string;
  /** Widget name (derived from component name, used for resource URI). */
  widgetName: string;
  /** Absolute path to the component source file. */
  componentPath: string;
  /** Status text while tool is running. */
  invoking?: string;
  /** Status text after tool completes. */
  invoked?: string;
  /** Visibility: who can call this tool. */
  visibility?: Array<"model" | "app">;
  /** File params (Apps SDK). */
  fileParams?: string[];
  /** CSP configuration. */
  csp?: Record<string, any>;
  /** Visual border preference. */
  prefersBorder?: boolean;
  /** Dedicated sandbox domain. */
  domain?: string;
  /** Sandbox permissions. */
  permissions?: Record<string, any>;
}

/**
 * In-memory registry mapping tool names to their inline widget metadata.
 * Populated by the transform plugin, read by the middleware.
 */
export class InlineWidgetRegistry {
  private entries = new Map<string, InlineWidgetManifestEntry>();

  set(toolName: string, entry: InlineWidgetManifestEntry): void {
    this.entries.set(toolName, entry);
  }

  get(toolName: string): InlineWidgetManifestEntry | undefined {
    return this.entries.get(toolName);
  }

  delete(toolName: string): boolean {
    return this.entries.delete(toolName);
  }

  has(toolName: string): boolean {
    return this.entries.has(toolName);
  }

  getAll(): Map<string, InlineWidgetManifestEntry> {
    return new Map(this.entries);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Create a tools/list middleware handler that enriches tool metadata
 * with inline widget information for capable clients.
 *
 * @param registry - The inline widget registry populated by the transform plugin
 * @param buildId - Optional build ID for resource URI generation
 * @returns Middleware function for use with `server.use("mcp:tools/list", ...)`
 */
export function createInlineWidgetMiddleware(
  registry: InlineWidgetRegistry,
  buildId?: string
) {
  return async (
    ctx: { session?: { clientCapabilities?: Record<string, any> } },
    next: () => Promise<unknown>
  ): Promise<unknown> => {
    const result = await next();

    if (registry.size === 0) return result;

    const clientCaps = (ctx.session as any)?.clientCapabilities;
    if (!supportsApps(clientCaps)) {
      return result;
    }

    const tools: any[] = Array.isArray(result)
      ? result
      : (result as any)?.tools ?? [];

    for (const tool of tools) {
      const entry = registry.get(tool.name);
      if (!entry) continue;

      const buildIdPart = buildId ? `-${buildId}` : "";
      const resourceUri = `ui://widget/${entry.widgetName}${buildIdPart}.html`;

      const widgetDef = {
        type: "mcpApps" as const,
        name: entry.widgetName,
        metadata: {},
      };

      const dualMeta = buildDualProtocolMetadata(
        widgetDef as any,
        resourceUri,
        tool._meta
      );

      tool._meta = {
        ...dualMeta,
        "openai/toolInvocation/invoking":
          entry.invoking ?? `Loading ${entry.widgetName}...`,
        "openai/toolInvocation/invoked":
          entry.invoked ?? `${entry.widgetName} ready`,
      };

      if (entry.visibility) {
        tool._meta.ui = {
          ...(tool._meta.ui as Record<string, unknown>),
          visibility: entry.visibility,
        };
      }

      if (entry.fileParams) {
        tool._meta["openai/fileParams"] = entry.fileParams;
      }
    }

    return result;
  };
}
