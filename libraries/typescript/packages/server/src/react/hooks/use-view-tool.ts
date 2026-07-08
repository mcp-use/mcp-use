import type { ToolAnnotations } from "@modelcontextprotocol/server";
import { useEffect, useRef } from "react";

import type {
  InferToolInput,
  InferToolOutput,
  ToolDefinition,
  ToolResult,
} from "../../tools.js";
import { resolveToolInputSchema } from "../../tools.js";
import type { CallToolResult } from "../types/result-types.js";
import { useViewBridgeStore } from "../bridge/view-bridge.js";

/** View-tool definition — mirrors {@link ToolDefinition} plus `enabled`. */
export type ViewToolDefinition = Pick<
  ToolDefinition,
  | "name"
  | "title"
  | "description"
  | "inputSchema"
  | "schema"
  | "outputSchema"
  | "annotations"
> & {
  /** When `false`, the tool stays registered but is not listed or callable. */
  enabled?: boolean;
};

/** Handle returned by the ext-apps `App.registerTool`. */
type RegisteredViewTool = ReturnType<
  Awaited<ReturnType<ReturnType<typeof useViewBridgeStore>["connect"]>>["registerTool"]
>;

/**
 * Register an ephemeral tool the host/model can call while this component is mounted.
 *
 * Registration is keyed by `name`: the tool registers once per mounted name
 * and is removed on unmount. `title`, `description`, and `annotations`
 * changes are applied in place via the ext-apps handle's `update()`;
 * toggling `enabled` calls `enable()`/`disable()` without re-registering —
 * inline object literals in the definition never cause per-render
 * re-registration or `tools/list_changed` churn. `inputSchema` and `outputSchema`
 * are captured at registration time (ext-apps fixes handler arity at
 * registration); to change a tool's schema, register it under a new name.
 * `schema` is accepted as an alias for `inputSchema`.
 *
 * @example
 * ```tsx
 * useViewTool(
 *   { name: "highlight-fruit", inputSchema: z.object({ id: z.string() }) },
 *   async ({ id }) => {
 *     setSelected(id);
 *     return { content: [{ type: "text", text: `Highlighted ${id}` }] };
 *   }
 * );
 * ```
 */
export function useViewTool<
  const TDef extends ViewToolDefinition,
  TInput = InferToolInput<TDef>,
  TOutput = InferToolOutput<TDef>,
>(
  definition: TDef,
  handler: (args: TInput) => ToolResult<TOutput> | Promise<ToolResult<TOutput>>
): void {
  const store = useViewBridgeStore();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const definitionRef = useRef<ViewToolDefinition>(definition);
  definitionRef.current = definition;
  const registeredRef = useRef<RegisteredViewTool | null>(null);

  const { name, title, description, enabled = true } = definition;
  // Annotations are plain JSON data (MCP wire shape); serialize for change
  // detection so inline literals don't retrigger effects by identity.
  const annotationsJson =
    definition.annotations === undefined
      ? undefined
      : JSON.stringify(definition.annotations);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const app = await store.connect();
      if (cancelled) return;

      // Read the latest definition: config may have changed while connecting.
      const def = definitionRef.current;
      const config: {
        title?: string;
        description?: string;
        inputSchema?: NonNullable<ViewToolDefinition["inputSchema"]>;
        outputSchema?: NonNullable<ViewToolDefinition["outputSchema"]>;
        annotations?: ToolAnnotations;
      } = {};

      if (def.title !== undefined) config.title = def.title;
      if (def.description !== undefined) config.description = def.description;
      const inputSchema = resolveToolInputSchema(def);
      if (inputSchema !== undefined) config.inputSchema = inputSchema;
      if (def.outputSchema !== undefined) config.outputSchema = def.outputSchema;
      if (def.annotations !== undefined) config.annotations = def.annotations;

      // ToolResult (v2 SDK) is wire-compatible with ext-apps' CallToolResult handler.
      const callback = async (args: unknown) =>
        (await handlerRef.current(args as TInput)) as CallToolResult;

      const registered = app.registerTool(
        name,
        config,
        // v2 ToolResult matches ext-apps CallToolResult on the wire; SDK index signatures differ.
        callback as never
      );
      registeredRef.current = registered;

      if (def.enabled === false) {
        registered.disable();
      }
    })();

    return () => {
      cancelled = true;
      registeredRef.current?.remove();
      registeredRef.current = null;
    };
  }, [store, name]);

  useEffect(() => {
    const registered = registeredRef.current;
    // Pre-registration changes are picked up from definitionRef at
    // registration time; this effect only applies post-registration edits.
    if (!registered) return;
    const def = definitionRef.current;
    registered.update({
      ...(def.title !== undefined && { title: def.title }),
      ...(def.description !== undefined && { description: def.description }),
      ...(def.annotations !== undefined && { annotations: def.annotations }),
    });
  }, [title, description, annotationsJson]);

  useEffect(() => {
    const registered = registeredRef.current;
    if (!registered || registered.enabled === enabled) return;
    if (enabled) {
      registered.enable();
    } else {
      registered.disable();
    }
  }, [enabled]);
}
