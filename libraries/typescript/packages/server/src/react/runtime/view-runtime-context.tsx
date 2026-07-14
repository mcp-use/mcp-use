import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { McpAppRuntime } from "./view-runtime.js";

/**
 * React context holding the document's {@link McpAppRuntime}.
 *
 * `null` outside bootstrap — hooks throw via {@link useViewRuntime}.
 *
 * @internal
 */
export const ViewRuntimeContext = createContext<McpAppRuntime | null>(null);

/**
 * Provide a {@link McpAppRuntime} to the view tree.
 *
 * Connection is started by {@link bootstrapView} before render. Model-context
 * delivery is owned by the runtime's {@link McpAppRuntime.modelContextStore};
 * this provider only exposes the runtime through context.
 *
 * @param props - Provider props.
 * @param props.runtime - Runtime created by bootstrap for this mount.
 * @param props.children - View tree.
 *
 * @internal
 */
export function ViewRuntimeProvider({
  runtime,
  children,
}: {
  runtime: McpAppRuntime;
  children: ReactNode;
}) {
  return (
    <ViewRuntimeContext.Provider value={runtime}>
      {children}
    </ViewRuntimeContext.Provider>
  );
}

/**
 * Read the current {@link McpAppRuntime} from context.
 *
 * @throws When called outside a {@link bootstrapView}-mounted tree.
 *
 * @internal
 */
export function useViewRuntime(): McpAppRuntime {
  const runtime = useContext(ViewRuntimeContext);
  if (!runtime) {
    throw new Error(
      "@mcp-use/server/react hooks require a browser view mounted by bootstrapView"
    );
  }
  return runtime;
}

/**
 * Subscribe to host context only — re-renders when `hostContext` identity
 * changes (connection-only updates that keep the same context object do not).
 *
 * Used by {@link ThemeProvider} for theme, style variables, and fonts.
 *
 * @internal
 */
export function useHostContextSubscription(): McpUiHostContext | undefined {
  const runtime = useViewRuntime();
  return useSyncExternalStore(
    runtime.subscribeHost,
    () => runtime.getHostSnapshot().hostContext
  );
}
