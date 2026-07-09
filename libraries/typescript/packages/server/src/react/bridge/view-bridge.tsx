import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { registerModelContextFlush } from "./model-context-store.js";
import {
  markModelContextUnsupportedWarned,
  viewBridgeStore,
  type ViewBridgeSnapshot,
  type ViewBridgeStore,
} from "./view-bridge-store.js";

const ViewBridgeContext = createContext<ViewBridgeStore>(viewBridgeStore);

/**
 * Connect the MCP Apps bridge and provide view state to descendants.
 *
 * @internal
 */
export function ViewBridgeProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => viewBridgeStore, []);

  useEffect(() => {
    void store.connect().catch((error: unknown) => {
      console.error("[mcp-use] Failed to connect view bridge:", error);
    });

    const unregister = registerModelContextFlush((params) => {
      void (async () => {
        try {
          const app = await store.connect();
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
  }, [store]);

  return (
    <ViewBridgeContext.Provider value={store}>{children}</ViewBridgeContext.Provider>
  );
}

/** Read the current view bridge store. */
export function useViewBridgeStore(): ViewBridgeStore {
  return use(ViewBridgeContext);
}

/**
 * Subscribe to the full view bridge snapshot via {@link useSyncExternalStore}.
 *
 * Re-renders on any snapshot change. Prefer narrow subscriptions
 * ({@link useHostContextSubscription}) when only one channel is needed.
 */
export function useViewBridgeSnapshot(): ViewBridgeSnapshot {
  const store = useViewBridgeStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/**
 * Subscribe to host context only — re-renders when `hostContext` identity
 * changes, not on tool-input / result / cancel updates.
 */
export function useHostContextSubscription(): McpUiHostContext | undefined {
  const store = useViewBridgeStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().hostContext
  );
}

/** Stable action callbacks backed by the shared {@link App} instance. */
export function useViewActions() {
  const store = useViewBridgeStore();
  const appRef = useRef<App | null>(null);

  useEffect(() => {
    void store.connect().then((app) => {
      appRef.current = app;
    });
  }, [store]);

  const callTool = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      const app = appRef.current ?? (await store.connect());
      return app.callServerTool({ name, arguments: args });
    },
    [store]
  );

  const sendFollowUpMessage = useCallback(
    async (args: { prompt: string }) => {
      const app = appRef.current ?? (await store.connect());
      await app.sendMessage({
        role: "user",
        content: [{ type: "text", text: args.prompt }],
      });
    },
    [store]
  );

  const openExternal = useCallback(
    (args: { url: string }) => {
      void (async () => {
        const app = appRef.current ?? (await store.connect());
        await app.openLink({ url: args.url });
      })();
    },
    [store]
  );

  const requestDisplayMode = useCallback(
    async (args: { mode: "inline" | "fullscreen" | "pip" }) => {
      const app = appRef.current ?? (await store.connect());
      await app.requestDisplayMode({ mode: args.mode });
    },
    [store]
  );

  const sendSizeChanged = useCallback(
    async (size: { width?: number; height?: number }) => {
      const app = appRef.current ?? (await store.connect());
      await app.sendSizeChanged(size);
    },
    [store]
  );

  return {
    callTool,
    sendFollowUpMessage,
    openExternal,
    requestDisplayMode,
    sendSizeChanged,
  };
}
