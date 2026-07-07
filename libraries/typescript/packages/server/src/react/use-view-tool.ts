import type { ToolAnnotations } from "@modelcontextprotocol/server";
import { useEffect, useRef } from "react";

import type {
  InferToolInput,
  InferToolOutput,
  ToolDefinition,
  ToolResult,
} from "../tools.js";
import type { CallToolResult } from "./result-types.js";
import { useViewBridgeStore } from "./view-bridge.js";

/** View-tool definition — mirrors {@link ToolDefinition} plus `enabled`. */
export type ViewToolDefinition = Pick<
  ToolDefinition,
  "name" | "title" | "description" | "schema" | "outputSchema" | "annotations"
> & {
  /** When `false`, the tool stays registered but is not listed or callable. */
  enabled?: boolean;
};

/**
 * Register an ephemeral tool the host/model can call while this component is mounted.
 *
 * @example
 * ```tsx
 * useViewTool(
 *   { name: "highlight-fruit", schema: z.object({ id: z.string() }) },
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

  const { name, title, description, schema, outputSchema, annotations, enabled } =
    definition;

  useEffect(() => {
    let registered: ReturnType<
      Awaited<ReturnType<typeof store.connect>>["registerTool"]
    > | null = null;
    let cancelled = false;

    void (async () => {
      const app = await store.connect();
      if (cancelled) return;

      const config: {
        title?: string;
        description?: string;
        inputSchema?: NonNullable<ViewToolDefinition["schema"]>;
        outputSchema?: NonNullable<ViewToolDefinition["outputSchema"]>;
        annotations?: ToolAnnotations;
      } = {};

      if (title !== undefined) config.title = title;
      if (description !== undefined) config.description = description;
      if (schema !== undefined) config.inputSchema = schema;
      if (outputSchema !== undefined) config.outputSchema = outputSchema;
      if (annotations !== undefined) config.annotations = annotations;

      // ToolResult (v2 SDK) is wire-compatible with ext-apps' CallToolResult handler.
      const callback = async (args: unknown) =>
        (await handlerRef.current(args as TInput)) as CallToolResult;

      registered = app.registerTool(
        name,
        config,
        // v2 ToolResult matches ext-apps CallToolResult on the wire; SDK index signatures differ.
        callback as never
      );

      if (enabled === false) {
        registered.disable();
      }
    })();

    return () => {
      cancelled = true;
      registered?.remove();
    };
  }, [
    store,
    name,
    title,
    description,
    schema,
    outputSchema,
    annotations,
    enabled,
  ]);
}
