import { createRoot, type Root } from "react-dom/client";
import type { ComponentType } from "react";

import { ErrorBoundary } from "../components/error-boundary.js";
import { setViewBridgeAppOptions } from "./view-bridge-store.js";
import { ViewBridgeProvider } from "./view-bridge.js";

const mountedRoots = new Map<string, Root>();

/**
 * Guest-runtime options for a view, exported from `view.tsx` as
 * `viewOptions`.
 *
 * These control iframe bridge behavior only — they are never wire metadata.
 * Resource facts (description, CSP, permissions, …) stay on the server-side
 * `view:` tool config.
 */
export interface ViewOptions {
  /**
   * When `true`, the ext-apps guest `App` measures the document under
   * `height: max-content` and notifies the host on size changes.
   *
   * Disable when the view's height derives from its width (for example a
   * fixed aspect-ratio container sized via `ResizeObserver`): auto-resize
   * then measures ~0 and the host collapses the iframe. Report size
   * manually with {@link useSendSizeChanged}.
   *
   * @defaultValue true
   */
  autoResize?: boolean;
}

/** @internal Module shape of a `view.tsx` file. */
export interface ViewModule {
  /** Default view component — reads data via hooks. */
  default: ComponentType;
  /**
   * Optional guest-runtime options (currently {@link ViewOptions.autoResize}).
   * Applied synchronously before the bridge connects.
   */
  viewOptions?: ViewOptions;
}

/**
 * Mount a view module into the iframe document: connects the bridge
 * (declaring `tools: { listChanged: true }`), renders the default export
 * immediately (the component reads {@link useToolContext} and related hooks),
 * re-renders as bridge notifications arrive, and wraps everything in an
 * error boundary.
 *
 * Auto-resize is on by default. Pass `viewOptions: { autoResize: false }`
 * on the module (the `viewOptions` named export from `view.tsx`) to opt out
 * and report size via {@link useSendSizeChanged}.
 *
 * @param module - The view module (`default` component plus optional
 *   `viewOptions`).
 * @param options - Mount options.
 * @param options.rootId - DOM id of the mount container; created if missing.
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

  if (module.viewOptions !== undefined) {
    setViewBridgeAppOptions(module.viewOptions);
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

  const View = module.default;
  root.render(
    <ErrorBoundary>
      <ViewBridgeProvider>
        <View />
      </ViewBridgeProvider>
    </ErrorBoundary>
  );
}

/** @internal Clear bootstrap roots between tests. */
export function _resetBootstrapRootsForTesting(): void {
  mountedRoots.clear();
}
