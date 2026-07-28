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
  _registerDisposeViewForTesting,
  type McpAppRuntime,
  type ViewRuntimeTransport,
} from "./view-runtime.js";

/**
 * One mounted MCP App view per iframe document.
 *
 * Attached to `document` via a module-private symbol so HMR of the view
 * module reuses the same record without a module-level `Map` keyed by root id.
 */
interface MountedView {
  /** DOM id of the React mount container. */
  rootId: string;
  /** React root created for this mount. */
  root: Root;
  /** Document-owned {@link McpAppRuntime}. */
  runtime: McpAppRuntime;
  /** Normalized config fixed at first mount (HMR must not change it). */
  config: NormalizedViewConfig;
}

/**
 * Module-private symbol property key for the document mount record.
 *
 * A plain `Symbol` (not `Symbol.for`) keeps the key unforgeable from other
 * modules: only this bootstrap module can read or write the mount record.
 * View-module HMR re-enters {@link bootstrapView} without reloading this
 * module, so the symbol identity is stable for the iframe lifetime.
 */
const MOUNTED_VIEW: unique symbol = Symbol("mcp-use.mountedView");

type DocumentWithMount = Document & {
  [MOUNTED_VIEW]?: MountedView;
};

function readMountedView(): MountedView | undefined {
  return (document as DocumentWithMount)[MOUNTED_VIEW];
}

function writeMountedView(mounted: MountedView): void {
  (document as DocumentWithMount)[MOUNTED_VIEW] = mounted;
}

function clearMountedView(): void {
  delete (document as DocumentWithMount)[MOUNTED_VIEW];
}

function configsEqual(
  a: NormalizedViewConfig,
  b: NormalizedViewConfig
): boolean {
  if (a.autoResize !== b.autoResize) return false;
  if (a.displayModes.length !== b.displayModes.length) return false;
  return a.displayModes.every((mode, index) => mode === b.displayModes[index]);
}

function renderView(mounted: MountedView, View: ComponentType): void {
  document
    .getElementById(mounted.rootId)
    ?.removeAttribute("data-mcp-use-loading");
  mounted.root.render(
    <ErrorBoundary>
      <ViewRuntimeProvider runtime={mounted.runtime}>
        <View />
      </ViewRuntimeProvider>
    </ErrorBoundary>
  );
}

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
 * component reads data via hooks while the handshake is in progress), and
 * wraps everything in an error boundary.
 *
 * Auto-resize is on by default. Opt out with
 * `viewConfig.autoResize: false` and report size via
 * {@link useSendSizeChanged}.
 *
 * Repeated bootstrap for the same `rootId` reuses the mounted root and
 * runtime (HMR) without reconnecting. A second `rootId` while one view is
 * mounted throws. Call {@link disposeView} to unmount and allow a fresh
 * bootstrap.
 *
 * @param module - The view module (`default` component and optional
 *   `viewConfig`).
 * @param options - Mount options.
 * @throws When `viewConfig.displayModes` is empty, duplicated, missing
 *   `"inline"`, or contains an unknown mode.
 * @throws When a view is already mounted on a different `rootId` in this
 *   document.
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
  const existing = readMountedView();

  if (existing) {
    if (existing.rootId !== rootId) {
      throw new Error(
        `bootstrapView: a view is already mounted on "#${existing.rootId}"; cannot mount a second root "#${rootId}" in the same document`
      );
    }

    if (!configsEqual(existing.config, normalized)) {
      console.warn(
        "[mcp-use] viewConfig changed during HMR (autoResize / displayModes). " +
          "A full iframe reload is required for configuration changes to take effect; " +
          "the mounted runtime keeps the original configuration."
      );
    }

    renderView(existing, module.default);
    return;
  }

  let container = document.getElementById(rootId);
  if (!container) {
    container = document.createElement("div");
    container.id = rootId;
    document.body.appendChild(container);
  }

  const transport = options?.transport ?? takePendingTestTransport();
  const runtime = createMcpAppRuntime(normalized, {
    ...(transport !== undefined && { transport }),
  });
  setActiveRuntime(runtime);
  // Start connect before React mounts; attach rejection handling immediately
  // so a failed handshake is logged and does not become an unhandled rejection.
  void runtime.connect().catch((error: unknown) => {
    console.error("[mcp-use] Failed to connect view runtime:", error);
  });

  const root = createRoot(container);
  const mounted: MountedView = {
    rootId,
    root,
    runtime,
    config: normalized,
  };
  writeMountedView(mounted);
  renderView(mounted, module.default);
}

/**
 * Unmount the document's view and dispose its guest MCP App runtime.
 *
 * React unmounts first so hook cleanup (e.g. {@link useViewTool} removal) can
 * run while the App connection still exists; then the runtime closes the App
 * and transport. After this resolves, the view bootstrap can create a fresh
 * runtime.
 *
 * No-ops when nothing is mounted.
 *
 * @example
 * ```ts
 * await disposeView();
 * ```
 */
export async function disposeView(): Promise<void> {
  if (typeof document === "undefined") {
    return;
  }

  const mounted = readMountedView();
  if (!mounted) return;

  // Unmount React before closing the App so hook cleanup (view-tool remove)
  // runs while the connection still exists.
  try {
    mounted.root.unmount();
  } catch {
    // Container may already be detached by test teardown.
  }

  // Drop the mount record before awaiting App close so a subsequent
  // bootstrapView (or sync test reset) does not reuse a half-disposed runtime.
  clearMountedView();
  await mounted.runtime.dispose();
}

/**
 * @internal Clear the document mount via {@link disposeView} between tests.
 */
export function _resetBootstrapRootsForTesting(): void {
  void disposeView();
}

// Wire the real disposal path into the view-runtime test seam without a
// circular static import from view-runtime → bootstrap-view.
_registerDisposeViewForTesting(disposeView);
