import type { Spec } from "@json-render/core";
import {
  defineRegistry,
  JSONUIProvider,
  Renderer,
} from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { ThemeProvider, useToolContext } from "mcp-use/react";
import { useCallback, useState } from "react";

import { catalog } from "./catalog.js";
import "./view.css";

const { registry } = defineRegistry(catalog, {
  components: {
    ...shadcnComponents,
    Avatar: ({ props }: { props: Record<string, unknown> }) => {
      const name = (props.name as string) || (props.alt as string) || "?";
      const src = props.src as string | undefined;
      const initials = name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      const size = props.size === "lg" ? 48 : props.size === "sm" ? 32 : 40;
      const [imageFailed, setImageFailed] = useState(false);
      const onError = useCallback(() => setImageFailed(true), []);

      return (
        <div
          className="generative-avatar"
          style={{ width: size, height: size }}
        >
          {src && !imageFailed ? (
            <img
              src={src}
              alt={name}
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
              width={size}
              height={size}
              onError={onError}
            />
          ) : (
            <span style={{ fontSize: size * 0.4 }}>{initials}</span>
          )}
        </div>
      );
    },
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Convert a progressive `DeepPartial<Spec>` into the smallest safe renderer
 * input. Until both the root key and its element exist, json-render cannot
 * mount anything; once they do, `Renderer` can render the growing element map.
 */
function toRenderableSpec(value: unknown): Spec | null {
  if (!isRecord(value) || typeof value.root !== "string") return null;
  if (!isRecord(value.elements) || !isRecord(value.elements[value.root])) {
    return null;
  }

  const elements: Record<string, Record<string, unknown>> = {};
  for (const [key, element] of Object.entries(value.elements)) {
    if (isRecord(element)) elements[key] = element;
  }

  return {
    root: value.root,
    elements: Object.fromEntries(
      Object.entries(elements).map(([key, element]) => {
        if (element.type !== "Card" || !isRecord(element.props)) {
          return [key, element];
        }
        return [
          key,
          {
            ...element,
            props: { ...element.props, maxWidth: "full", centered: false },
          },
        ];
      })
    ) as unknown as Spec["elements"],
    ...(isRecord(value.state) ? { state: value.state } : {}),
  };
}

function LoadingState() {
  return (
    <div className="generative-ui-status" aria-busy="true">
      Waiting for a renderable UI spec…
    </div>
  );
}

function GenerativeUiContent() {
  const view = useToolContext<"render-ui">();

  if (view.status === "error") {
    return (
      <div className="generative-ui-status generative-ui-error" role="alert">
        {view.error.message}
      </div>
    );
  }

  // Keep the raw tool input after completion. json-render's generated Zod
  // schema deliberately describes component props, but does not retain every
  // renderer instruction (such as `on` actions and `repeat`). Rendering the
  // parsed tool output after it becomes ready would therefore turn an
  // interactive UI into a static one. The output remains a fallback for hosts
  // that provide a result without sending tool input.
  //
  // While pending, `toolInput` is a DeepPartial. The renderer only receives it
  // once its root element exists, and `loading` suppresses warnings for
  // still-streaming children.
  const spec = toRenderableSpec(
    view.toolInput?.spec ??
      (view.status === "ready" ? view.toolOutput.spec : undefined)
  );

  if (!spec) return <LoadingState />;

  return (
    <JSONUIProvider registry={registry} initialState={spec.state ?? {}}>
      <div className="generative-ui-canvas">
        <Renderer
          spec={spec}
          registry={registry}
          loading={view.status === "pending"}
        />
      </div>
    </JSONUIProvider>
  );
}

export default function GenerativeUi() {
  return (
    <ThemeProvider colorScheme>
      <GenerativeUiContent />
    </ThemeProvider>
  );
}
