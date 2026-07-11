import { createRoot, type Root } from "react-dom/client";
import type { ComponentType } from "react";

import { ErrorBoundary } from "../components/error-boundary.js";
import { ViewBridgeProvider } from "./view-bridge.js";
import { setViewBridgeConfig } from "./view-bridge-store.js";
import {
  normalizeViewConfig,
  type ViewConfig,
} from "./view-config.js";

const mountedRoots = new Map<string, Root>();

/** @internal Module shape of a `view.tsx` file. */
export interface ViewModule {
  /** Default view component — reads data via hooks. */
  default: ComponentType;
  /**
   * Optional immutable pre-render runtime configuration.
   *
   * Normalized before the guest `App` is constructed. See {@link ViewConfig}.
   */
  viewConfig?: ViewConfig;
}

/**
 * Mount a view module into the iframe document: normalizes
 * {@link ViewModule.viewConfig}, connects the bridge (declaring
 * `tools: { listChanged: true }` and normalized `availableDisplayModes`),
 * renders the default export immediately (the component reads
 * {@link useToolContext} and related hooks), re-renders as bridge
 * notifications arrive, and wraps everything in an error boundary.
 *
 * Auto-resize is on by default. Opt out with
 * `viewConfig.autoResize: false` and report size via
 * {@link useSendSizeChanged}.
 *
 * @param module - The view module (`default` component and optional
 *   `viewConfig`).
 * @param options - Mount options.
 * @param options.rootId - DOM id of the mount container; created if missing.
 * @throws When `viewConfig.displayModes` is empty, duplicated, missing
 *   `"inline"`, or contains an unknown mode.
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

  const normalized = normalizeViewConfig(module.viewConfig);
  setViewBridgeConfig(normalized);

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
