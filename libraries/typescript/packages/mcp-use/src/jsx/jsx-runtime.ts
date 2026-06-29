/**
 * Custom JSX runtime for mcp-use server files.
 *
 * When a server file uses `jsxImportSource: "mcp-use/jsx"` (or the
 * `@jsxImportSource mcp-use/jsx` pragma), this runtime intercepts JSX calls
 * and converts view component returns into `widget()` CallToolResult objects.
 *
 * Detection: If the JSX element type is a function (not a string like "div")
 * AND a prop has a `_` prefix (like `_output`, `_invoking`), it's treated
 * as an inline view return and converted to a `widget()` call.
 *
 * @example
 * ```tsx
 * // @jsxImportSource mcp-use/jsx
 * import AnalysisView from "./components/AnalysisView";
 * import { text } from "mcp-use/server";
 *
 * // This JSX:
 * return <AnalysisView text={input} analysis={result} _output={text("Done")} />;
 *
 * // Is equivalent to:
 * return widget({ props: { text: input, analysis: result }, output: text("Done") });
 * ```
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import { widget as widgetHelper } from "../server/utils/response-helpers.js";
import { isStreamable } from "../server/utils/streamable.js";
import type { Streamable } from "../server/utils/streamable.js";

const WIDGET_META_PREFIXES = new Set([
  "_output",
  "_invoking",
  "_invoked",
  "_meta",
  "_visibility",
  "_fileParams",
  "_closeWidget",
  "_csp",
  "_prefersBorder",
  "_domain",
  "_permissions",
]);

function isWidgetMetaProp(key: string): boolean {
  return (
    key.startsWith("_") &&
    (WIDGET_META_PREFIXES.has(key) || key.startsWith("_"))
  );
}

/**
 * Symbol used by the SDK to detect that a tool result came from the
 * mcp-use/jsx runtime (i.e., an inline `<Component />` return).
 */
export const INLINE_WIDGET_MARKER = Symbol.for("mcp-use:inline-widget");
export const STREAMABLE_PROPS_MARKER = Symbol.for("mcp-use:streamable-props");

export interface InlineWidgetMeta {
  componentName: string;
  invoking?: string;
  invoked?: string;
  csp?: Record<string, unknown>;
  prefersBorder?: boolean;
  fileParams?: string[];
  visibility?: string[];
  closeWidget?: boolean;
  domain?: string;
  permissions?: Record<string, unknown>;
}

export interface StreamablePropRef {
  key: string;
  streamable: Streamable<unknown>;
}

interface ComponentWithInlineConfig {
  name?: string;
  displayName?: string;
  config?: Partial<InlineWidgetMeta>;
}

interface MarkedToolResult extends CallToolResult {
  [INLINE_WIDGET_MARKER]?: InlineWidgetMeta;
  [STREAMABLE_PROPS_MARKER]?: StreamablePropRef[];
}

function serverWidgetJsx(
  type: ComponentWithInlineConfig,
  allProps: Record<string, unknown>
): MarkedToolResult {
  const dataProps: Record<string, unknown> = {};
  const streamableRefs: StreamablePropRef[] = [];
  let output: CallToolResult | undefined;
  let metadata: Record<string, unknown> | undefined;
  const widgetMeta: Partial<InlineWidgetMeta> = {};

  for (const [key, value] of Object.entries(allProps || {})) {
    if (key === "_output") {
      output = value as CallToolResult;
    } else if (key === "_meta") {
      metadata = value as Record<string, unknown>;
    } else if (key === "_invoking") {
      widgetMeta.invoking = value as string;
    } else if (key === "_invoked") {
      widgetMeta.invoked = value as string;
    } else if (key === "_csp") {
      widgetMeta.csp = value as Record<string, unknown>;
    } else if (key === "_prefersBorder") {
      widgetMeta.prefersBorder = value as boolean;
    } else if (key === "_fileParams") {
      widgetMeta.fileParams = value as string[];
    } else if (key === "_visibility") {
      widgetMeta.visibility = value as string[];
    } else if (key === "_closeWidget") {
      widgetMeta.closeWidget = value as boolean;
    } else if (key === "_domain") {
      widgetMeta.domain = value as string;
    } else if (key === "_permissions") {
      widgetMeta.permissions = value as Record<string, unknown>;
    } else if (key === "children") {
      // Skip
    } else if (isWidgetMetaProp(key)) {
      // Other unrecognized _ props — skip at runtime
    } else {
      if (isStreamable(value)) {
        dataProps[key] = value.current;
        streamableRefs.push({ key, streamable: value });
      } else {
        dataProps[key] = value;
      }
    }
  }

  const result = widgetHelper({
    props: dataProps,
    output,
    metadata,
  });

  const componentName: string =
    type.displayName || type.name || "UnknownWidget";
  const componentConfig = type.config;
  const markedResult = result as MarkedToolResult;
  markedResult[INLINE_WIDGET_MARKER] = {
    componentName,
    ...widgetMeta,
    csp: widgetMeta.csp ?? componentConfig?.csp,
    prefersBorder: widgetMeta.prefersBorder ?? componentConfig?.prefersBorder,
    domain: widgetMeta.domain ?? componentConfig?.domain,
    permissions: widgetMeta.permissions ?? componentConfig?.permissions,
  } satisfies InlineWidgetMeta;

  if (streamableRefs.length > 0) {
    markedResult[STREAMABLE_PROPS_MARKER] = streamableRefs;
  }

  return markedResult;
}

export function jsx(
  type: unknown,
  props: Record<string, unknown> | null,
  key?: string | number
): unknown {
  if (typeof type === "function") {
    const propKeys = Object.keys(props || {});
    const hasWidgetMeta = propKeys.some((k) => k.startsWith("_"));
    if (hasWidgetMeta) {
      return serverWidgetJsx(type, props ?? {});
    }
  }

  return {
    $$typeof: Symbol.for("react.element"),
    type,
    props,
    key: key ?? null,
  };
}

export function jsxs(
  type: unknown,
  props: Record<string, unknown> | null,
  key?: string | number
): unknown {
  return jsx(type, props, key);
}

export const Fragment = Symbol.for("react.fragment");

interface WidgetMetaProps {
  _output?:
    | CallToolResult
    | {
        content: CallToolResult["content"];
        structuredContent?: Record<string, unknown>;
        [key: string]: unknown;
      };
  _invoking?: string;
  _invoked?: string;
  _meta?: Record<string, unknown>;
  _visibility?: Array<"model" | "app">;
  _fileParams?: string[];
  _closeWidget?: boolean;
  _csp?: {
    connectDomains?: string[];
    resourceDomains?: string[];
    frameDomains?: string[];
    baseUriDomains?: string[];
    redirectDomains?: string[];
  };
  _prefersBorder?: boolean;
  _domain?: string;
  _permissions?: Record<string, Record<string, never>>;
}

type StreamableProps<P> = {
  [K in keyof P]: P[K] | Streamable<Exclude<P[K], undefined>>;
};

export namespace JSX {
  // ponytail: TypeScript's JSX runtime hook expects a permissive element alias;
  // upgrade path is a full React-compatible element model for server JSX.
  export type Element = any;
  // ponytail: JSX element constructors are intentionally open-ended here;
  // upgrade path is declaring the supported component constructor surface.
  export type ElementType = any;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
  export type LibraryManagedAttributes<C, P> = C extends (
    props: infer CP
  ) => unknown
    ? StreamableProps<CP> & WidgetMetaProps & { key?: string | number }
    : C extends new (props: infer CP) => unknown
      ? StreamableProps<CP> & WidgetMetaProps & { key?: string | number }
      : P & WidgetMetaProps & { key?: string | number };
  export interface IntrinsicElements {
    [elemName: string]: Record<string, unknown>;
  }
}
