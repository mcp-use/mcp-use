/**
 * Custom JSX runtime for mcp-use server files.
 *
 * When a server file uses `jsxImportSource: "mcp-use/jsx"` (or the
 * `@jsxImportSource mcp-use/jsx` pragma), this runtime intercepts JSX calls
 * and converts widget component returns into `widget()` CallToolResult objects.
 *
 * Detection: If the JSX element type is a function (not a string like "div")
 * AND any prop has a `_` prefix (like `_output`, `_invoking`), it's treated
 * as an inline widget return and converted to a `widget()` call.
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

import { widget as widgetHelper } from "../server/utils/response-helpers.js";
import { isStreamable } from "../server/utils/streamable.js";

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
  return key.startsWith("_") && (WIDGET_META_PREFIXES.has(key) || key.startsWith("_"));
}

/**
 * Convert a component JSX call into a widget() CallToolResult.
 *
 * Separates regular props (component data → structuredContent) from
 * _-prefixed props (protocol metadata).
 */
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
  csp?: Record<string, any>;
  prefersBorder?: boolean;
  fileParams?: string[];
  visibility?: string[];
  closeWidget?: boolean;
  domain?: string;
  permissions?: Record<string, any>;
}

export interface StreamablePropRef {
  key: string;
  streamable: any; // Streamable<T>
}

function serverWidgetJsx(type: any, allProps: Record<string, any>): any {
  const dataProps: Record<string, any> = {};
  const streamableRefs: StreamablePropRef[] = [];
  let output: any;
  let metadata: any;
  const widgetMeta: Partial<InlineWidgetMeta> = {};

  for (const [key, value] of Object.entries(allProps || {})) {
    if (key === "_output") {
      output = value;
    } else if (key === "_meta") {
      metadata = value;
    } else if (key === "_invoking") {
      widgetMeta.invoking = value;
    } else if (key === "_invoked") {
      widgetMeta.invoked = value;
    } else if (key === "_csp") {
      widgetMeta.csp = value;
    } else if (key === "_prefersBorder") {
      widgetMeta.prefersBorder = value;
    } else if (key === "_fileParams") {
      widgetMeta.fileParams = value;
    } else if (key === "_visibility") {
      widgetMeta.visibility = value;
    } else if (key === "_closeWidget") {
      widgetMeta.closeWidget = value;
    } else if (key === "_domain") {
      widgetMeta.domain = value;
    } else if (key === "_permissions") {
      widgetMeta.permissions = value;
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
  const componentConfig = type.config as Record<string, any> | undefined;
  (result as any)[INLINE_WIDGET_MARKER] = {
    componentName,
    ...widgetMeta,
    csp: widgetMeta.csp ?? componentConfig?.csp,
    prefersBorder: widgetMeta.prefersBorder ?? componentConfig?.prefersBorder,
    domain: widgetMeta.domain ?? componentConfig?.domain,
    permissions: widgetMeta.permissions ?? componentConfig?.permissions,
  } satisfies InlineWidgetMeta;

  // Attach streamable refs so the tool wrapper auto-wires notifications
  if (streamableRefs.length > 0) {
    (result as any)[STREAMABLE_PROPS_MARKER] = streamableRefs;
  }

  return result;
}

/**
 * Custom jsx factory. Intercepts component calls with _-prefixed widget props
 * and converts them to widget() results. Falls through to plain objects for
 * regular React elements (which shouldn't appear in server tool handlers).
 */
export function jsx(type: any, props: any, key?: any): any {
  // Component function (not a string like "div") with widget metadata props
  if (typeof type === "function") {
    const propKeys = Object.keys(props || {});
    const hasWidgetMeta = propKeys.some((k) => k.startsWith("_"));
    if (hasWidgetMeta) {
      return serverWidgetJsx(type, props);
    }
  }

  // For non-widget JSX (shouldn't happen in tool handlers, but handle gracefully)
  // Return a simple representation — not a real React element since we're on the server
  return { $$typeof: Symbol.for("react.element"), type, props, key: key ?? null };
}

export function jsxs(type: any, props: any, key?: any): any {
  return jsx(type, props, key);
}

export const Fragment = Symbol.for("react.fragment");

// ── JSX namespace for TypeScript type checking ──────────────────────────────
// When @jsxImportSource mcp-use/jsx is used, TypeScript reads this namespace
// to type-check JSX expressions. LibraryManagedAttributes widens component
// props to accept _-prefixed protocol metadata and Streamable<T> values.

import type { Streamable } from "../server/utils/streamable.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface WidgetMetaProps {
  _output?: CallToolResult | { content: any[]; structuredContent?: any; [key: string]: any };
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
  [K in keyof P]: P[K] | Streamable<P[K]>;
};

export namespace JSX {
  export type Element = any;
  export type ElementType = any;
  export interface ElementChildrenAttribute {
    children: {};
  }
  export type LibraryManagedAttributes<C, P> = C extends (props: infer CP) => any
    ? StreamableProps<CP> & WidgetMetaProps & { key?: string | number }
    : C extends new (props: infer CP) => any
      ? StreamableProps<CP> & WidgetMetaProps & { key?: string | number }
      : P & WidgetMetaProps & { key?: string | number };
  export interface IntrinsicElements {
    [elemName: string]: any;
  }
}
