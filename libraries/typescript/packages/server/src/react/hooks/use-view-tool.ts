import type {
  InputRequiredResult,
  ToolAnnotations,
} from "@modelcontextprotocol/server";
import { useEffect, useRef } from "react";

import type {
  InferToolInput,
  InferToolOutput,
  ToolDefinition,
  ToolResult,
} from "../../tools.js";
import { resolveToolInputSchema } from "../../tools.js";
import { useViewRuntime } from "../runtime/view-runtime-context.js";
import type { McpAppRuntime } from "../runtime/view-runtime.js";

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

/** Internal registration handle retained while a view tool is mounted. */
type RegisteredViewTool = ReturnType<McpAppRuntime["registerViewTool"]>;

/**
 * Register an ephemeral tool the host/model can call while this component is mounted.
 *
 * Registration is synchronous against the runtime-owned App and independent
 * of connection completion. It is keyed by `name` only (`[runtime, name]`):
 * the tool registers once per mounted name and is removed on unmount. Changing
 * `inputSchema` / `outputSchema` without changing `name` does **not**
 * re-register — schemas are captured at registration time (ext-apps fixes
 * handler arity at registration); to change a tool's schema, register it under
 * a new name. `schema` is accepted as an alias for `inputSchema`.
 *
 * `title`, `description`, and `annotations` changes are applied in place via
 * the ext-apps handle's `update()`, passing explicit `undefined` so omitted
 * fields are cleared. Toggling `enabled` calls `enable()` / `disable()`
 * without re-registering. The handler is kept in a ref so calls always see
 * current React state. Registration goes through the document runtime rather
 * than the guest App directly, allowing the runtime to perform the
 * empty-handler handoff on first registration.
 *
 * Cleanup captures the registration handle inside the effect so an older
 * cleanup cannot remove a newer registration (e.g. after a rapid `name`
 * change). Registration failures are reported with `console.error` and do not
 * leave half-registered state.
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
  handler: (
    args: TInput
  ) =>
    | Exclude<ToolResult<TOutput>, InputRequiredResult>
    | Promise<Exclude<ToolResult<TOutput>, InputRequiredResult>>
): void {
  const runtime = useViewRuntime();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const definitionRef = useRef<ViewToolDefinition>(definition);
  definitionRef.current = definition;
  // Shared only for post-registration metadata / enabled updates. Cleanup
  // never removes through this ref alone — each registering effect removes
  // only the handle it captured locally.
  const registeredRef = useRef<RegisteredViewTool | null>(null);
  const registeredMetadataRef = useRef<{
    registration: RegisteredViewTool;
    title: string | undefined;
    description: string | undefined;
    annotationsJson: string | undefined;
  } | null>(null);

  const { name, title, description, enabled = true } = definition;
  // Annotations are plain JSON data (MCP wire shape); serialize for change
  // detection so inline literals don't retrigger effects by identity.
  const annotationsJson =
    definition.annotations === undefined
      ? undefined
      : JSON.stringify(definition.annotations);

  useEffect(() => {
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
    if (def.outputSchema !== undefined) {
      config.outputSchema = def.outputSchema;
    }
    if (def.annotations !== undefined) {
      config.annotations = def.annotations;
    }

    // ext-apps fixes callback arity at registration: schema-backed tools call
    // `(parsedArgs, extra)`, while schema-less tools call `(extra)`. Adapt the
    // latter so the public handler receives an empty input object rather than
    // RequestHandlerExtra. Validation remains entirely owned by ext-apps.
    const callback =
      inputSchema !== undefined
        ? async (args: unknown) => handlerRef.current(args as TInput)
        : async (_extra: unknown) => handlerRef.current({} as TInput);

    let registration: RegisteredViewTool;
    try {
      registration = runtime.registerViewTool(name, config, callback);
    } catch (error: unknown) {
      console.error(
        `[mcp-use] useViewTool failed to register tool "${name}":`,
        error
      );
      return;
    }

    registeredRef.current = registration;
    registeredMetadataRef.current = {
      registration,
      title: def.title,
      description: def.description,
      annotationsJson:
        def.annotations === undefined
          ? undefined
          : JSON.stringify(def.annotations),
    };

    if (def.enabled === false) {
      registration.disable();
    }

    return () => {
      if (registeredRef.current === registration) {
        registeredRef.current = null;
      }
      if (registeredMetadataRef.current?.registration === registration) {
        registeredMetadataRef.current = null;
      }
      try {
        registration.remove();
      } catch {
        // App may already be closing during disposal. Swallow quietly.
      }
    };
  }, [runtime, name]);

  useEffect(() => {
    const registered = registeredRef.current;
    // Pre-registration changes are picked up from definitionRef at
    // registration time; this effect only applies post-registration edits.
    if (!registered) return;
    const applied = registeredMetadataRef.current;
    if (
      applied?.registration === registered &&
      applied.title === title &&
      applied.description === description &&
      applied.annotationsJson === annotationsJson
    ) {
      return;
    }
    const def = definitionRef.current;
    // Pass explicit undefined so Object.assign clears previously set fields.
    // Cast: exactOptionalPropertyTypes rejects `string | undefined` on
    // Partial<{ title?: string }>, but ext-apps' update uses Object.assign
    // and listing omits falsy/undefined metadata — explicit undefined is
    // required to clear.
    registered.update({
      title: def.title,
      description: def.description,
      annotations: def.annotations,
    } as Parameters<RegisteredViewTool["update"]>[0]);
    registeredMetadataRef.current = {
      registration: registered,
      title: def.title,
      description: def.description,
      annotationsJson:
        def.annotations === undefined
          ? undefined
          : JSON.stringify(def.annotations),
    };
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
