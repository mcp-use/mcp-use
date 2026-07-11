import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { registerModelContextFlush } from "./model-context-store.js";
import {
  markModelContextUnsupportedWarned,
  type McpAppRuntime,
} from "./view-runtime.js";

/**
 * React context holding the document's {@link McpAppRuntime}.
 *
 * `null` outside bootstrap — hooks throw via {@link useViewRuntime}.
 *
 * @internal
 */
export const ViewRuntimeContext = createContext<McpAppRuntime | null>(null);

/**
 * Provide a {@link McpAppRuntime} to the view tree and wire model-context flush.
 *
 * Connection is started by {@link bootstrapView} before render; this provider
 * only registers the model-context flush against the runtime.
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
  useEffect(() => {
    const unregister = registerModelContextFlush((params) => {
      void (async () => {
        try {
          const app = await runtime.connect();
          // Spec draft: hosts declare acceptance of ui/update-model-context
          // via the updateModelContext capability. Skip (once, loudly) when
          // the host does not accept context updates.
          if (app.getHostCapabilities()?.updateModelContext === undefined) {
            if (markModelContextUnsupportedWarned()) {
              console.warn(
                "[ModelContext] Host does not declare the updateModelContext capability; model-context updates are not sent."
              );
            }
            return;
          }
          await app.updateModelContext(
            params as Parameters<App["updateModelContext"]>[0]
          );
        } catch (error: unknown) {
          console.warn("[ModelContext] Failed to update model context:", error);
        }
      })();
    });

    return unregister;
  }, [runtime]);

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
