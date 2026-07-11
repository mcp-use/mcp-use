import { createRoot, type Root } from "react-dom/client";
import type { ComponentType } from "react";

import { ErrorBoundary } from "../components/error-boundary.js";
import {
  normalizeViewConfig,
  type NormalizedViewConfig,
  type ViewConfig,
} from "./view-config.js";
import { ViewRuntimeProvider } from "./view-runtime-context.js";
import {
  createMcpAppRuntime,
  setActiveRuntime,
  takePendingTestTransport,
  type McpAppRuntime,
  type ViewRuntimeTransport,
} from "./view-runtime.js";

interface MountedRoot {
  root: Root;
  runtime: McpAppRuntime;
  config: NormalizedViewConfig;
}

const mountedRoots = new Map<string, MountedRoot>();

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
 * Mount options for {@link bootstrapView}.
 *
 * @internal
 */
export interface BootstrapViewOptions {
  /** DOM id of the mount container; created if missing. @defaultValue `"root"` */
  rootId?: string;
  /**
   * Guest transport injected for tests. When omitted, consumes any transport
   * queued by `_setTransportForTesting`, otherwise uses postMessage.
   *
   * @internal
   */
  transport?: ViewRuntimeTransport;
}

/**
 * Mount a view module into the iframe document: normalizes
 * {@link ViewModule.viewConfig}, creates a {@link McpAppRuntime}, starts
 * `connect()` (declaring `tools: { listChanged: true }` and normalized
 * `availableDisplayModes`), renders the default export immediately (the
 * component reads {@link useToolContext} and related hooks), re-renders as
 * runtime notifications arrive, and wraps everything in an error boundary.
 *
 * Auto-resize is on by default. Opt out with
 * `viewConfig.autoResize: false` and report size via
 * {@link useSendSizeChanged}.
 *
 * Repeated bootstrap for the same `rootId` reuses the mounted root and runtime
 * (HMR). Full mount-record / second-root / dispose contracts are Phase 6.
 *
 * @param module - The view module (`default` component and optional
 *   `viewConfig`).
 * @param options - Mount options.
 * @throws When `viewConfig.displayModes` is empty, duplicated, missing
 *   `"inline"`, or contains an unknown mode.
 *
 * @internal
 */
export function bootstrapView(
  module: ViewModule,
  options?: BootstrapViewOptions
): void {
  if (typeof document === "undefined") {
    throw new Error("bootstrapView requires a browser document");
  }

  const normalized = normalizeViewConfig(module.viewConfig);
  const rootId = options?.rootId ?? "root";
  let container = document.getElementById(rootId);
  if (!container) {
    container = document.createElement("div");
    container.id = rootId;
    document.body.appendChild(container);
  }

  let mounted = mountedRoots.get(rootId);
  if (!mounted) {
    const transport =
      options?.transport ?? takePendingTestTransport();
    const runtime = createMcpAppRuntime(normalized, {
      ...(transport !== undefined && { transport }),
    });
    setActiveRuntime(runtime);
    void runtime.connect().catch((error: unknown) => {
      console.error("[mcp-use] Failed to connect view runtime:", error);
    });

    const root = createRoot(container);
    mounted = { root, runtime, config: normalized };
    mountedRoots.set(rootId, mounted);
  }

  const View = module.default;
  mounted.root.render(
    <ErrorBoundary>
      <ViewRuntimeProvider runtime={mounted.runtime}>
        <View />
      </ViewRuntimeProvider>
    </ErrorBoundary>
  );
}

/** @internal Clear bootstrap roots between tests. */
export function _resetBootstrapRootsForTesting(): void {
  const entries = [...mountedRoots.values()];
  mountedRoots.clear();
  for (const mounted of entries) {
    try {
      mounted.root.unmount();
    } catch {
      // Container may already be detached by test teardown.
    }
    void mounted.runtime.dispose();
  }
}
