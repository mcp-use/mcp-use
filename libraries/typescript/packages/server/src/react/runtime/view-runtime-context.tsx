import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { registerModelContextFlush } from "./model-context-store.js";
import {
  markModelContextUnsupportedWarned,
  type McpAppRuntime,
  type ViewRuntimeSnapshot,
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
 * @deprecated Prefer {@link useViewRuntime}. Alias kept for Phase 5 hook
 * adaptations that still name the store.
 *
 * @internal
 */
export function useViewBridgeStore(): McpAppRuntime {
  return useViewRuntime();
}

/**
 * Subscribe to the full runtime snapshot via {@link useSyncExternalStore}.
 *
 * Re-renders on any snapshot change. Prefer narrow subscriptions
 * ({@link useHostContextSubscription}) when only one channel is needed.
 *
 * @internal
 */
export function useViewBridgeSnapshot(): ViewRuntimeSnapshot {
  const runtime = useViewRuntime();
  return useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
}

/**
 * Subscribe to host context only — re-renders when `hostContext` identity
 * changes, not on tool-input / result / cancel updates.
 *
 * Phase 7 will isolate the host channel; today any snapshot change notifies.
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

/**
 * Stable action callbacks backed by the {@link McpAppRuntime}.
 *
 * Phase 7 removes this aggregate hook in favor of per-action hooks that return
 * runtime-owned methods directly.
 *
 * @internal
 */
export function useViewActions() {
  const runtime = useViewRuntime();
  const appRef = useRef<App | null>(null);

  useEffect(() => {
    void runtime.connect().then((app) => {
      appRef.current = app;
    }).catch(() => {
      // Bootstrap already logs connection failures; ignore disposed/superseded.
    });
  }, [runtime]);

  const callTool = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      return runtime.callServerTool({ name, arguments: args });
    },
    [runtime]
  );

  const sendFollowUpMessage = useCallback(
    async (args: { prompt: string }) => {
      await runtime.sendMessage({
        role: "user",
        content: [{ type: "text", text: args.prompt }],
      });
    },
    [runtime]
  );

  const openExternal = useCallback(
    (args: { url: string }) => {
      void runtime.openLink({ url: args.url });
    },
    [runtime]
  );

  const requestDisplayMode = useCallback(
    async (args: { mode: "inline" | "fullscreen" | "pip" }) => {
      await runtime.requestDisplayMode({ mode: args.mode });
    },
    [runtime]
  );

  const sendSizeChanged = useCallback(
    async (size: { width?: number; height?: number }) => {
      await runtime.sendSizeChanged(size);
    },
    [runtime]
  );

  return {
    callTool,
    sendFollowUpMessage,
    openExternal,
    requestDisplayMode,
    sendSizeChanged,
  };
}
