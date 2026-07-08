import { createRoot, type Root } from "react-dom/client";
import type { ComponentType } from "react";

import { ErrorBoundary } from "../components/error-boundary.js";
import { ViewBridgeProvider } from "./view-bridge.js";

const mountedRoots = new Map<string, Root>();

/** @internal Module shape of a `view.tsx` file. */
export interface ViewModule {
  /** Default view component — reads data via hooks. */
  default: ComponentType;
}

function ViewRoot({
  module,
}: {
  module: ViewModule;
}) {
  const View = module.default;
  return <View />;
}

/**
 * Mount a view module into the iframe document: connects the bridge
 * (declaring `tools: { listChanged: true }`), renders the default export
 * immediately (the component reads {@link useToolContext} and related hooks),
 * re-renders as bridge notifications arrive; wraps everything in an error
 * boundary and enables auto-resize.
 *
 * @internal
 */
export function bootstrapView(
  module: ViewModule,
  options?: { rootId?: string }
): void {
  if (typeof document === "undefined") {
    throw new Error("bootstrapView requires a browser document");
  }

  const rootId = options?.rootId ?? "root";
  let container = document.getElementById(rootId);
  if (!container) {
    container = document.createElement("div");
    container.id = rootId;
    document.body.appendChild(container);
  }

  let root = mountedRoots.get(rootId);
  if (!root) {
    root = createRoot(container);
    mountedRoots.set(rootId, root);
  }

  root.render(
    <ErrorBoundary>
      <ViewBridgeProvider>
        <ViewRoot module={module} />
      </ViewBridgeProvider>
    </ErrorBoundary>
  );
}

/** @internal Clear bootstrap roots between tests. */
export function _resetBootstrapRootsForTesting(): void {
  mountedRoots.clear();
}
