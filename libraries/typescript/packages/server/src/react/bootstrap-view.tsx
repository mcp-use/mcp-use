import { createRoot, type Root } from "react-dom/client";
import { useMemo, type ComponentType } from "react";

import { ErrorBoundary } from "./ErrorBoundary.js";
import type { ViewMetadata } from "./register.js";
import {
  ViewBridgeProvider,
  useViewBridgeSnapshot,
} from "./view-bridge.js";

const mountedRoots = new Map<string, Root>();

/** @internal Module shape of a `view.tsx` file. */
export interface ViewModule {
  default: ComponentType<Record<string, unknown>>;
  Loading?: ComponentType<{
    partialInput?: unknown;
    isStreaming: boolean;
  }>;
  metadata?: ViewMetadata;
}

function ViewRoot({
  module,
}: {
  module: ViewModule;
}) {
  const snap = useViewBridgeSnapshot();
  const View = module.default;
  const Loading = module.Loading;

  const loadingProps = useMemo(
    () => ({
      partialInput: snap.partialToolInput,
      isStreaming: snap.isStreaming,
    }),
    [snap.partialToolInput, snap.isStreaming]
  );

  if (snap.props === undefined) {
    if (Loading) {
      return <Loading {...loadingProps} />;
    }
    return null;
  }

  return <View {...snap.props} />;
}

/**
 * Mount a view module into the iframe document: connects the bridge
 * (declaring `tools: { listChanged: true }`), renders `Loading` (fed
 * `partialInput`/`isStreaming`) until the first tool result, then renders the
 * default export with the result's `structuredContent` spread as props;
 * re-renders on later results; wraps everything in an error boundary and
 * enables auto-resize.
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
