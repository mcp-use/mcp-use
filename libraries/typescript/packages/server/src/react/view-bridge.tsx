import {
  App,
  PostMessageTransport,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";

type ViewBridgeTransport = NonNullable<Parameters<App["connect"]>[0]>;
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { registerModelContextFlush } from "./model-context-store.js";

/** Snapshot of view data channels and host context delivered over the bridge. */
export interface ViewBridgeSnapshot {
  /** Last tool result `structuredContent` — same payload spread onto the component. */
  props: Record<string, unknown> | undefined;
  /** Complete tool arguments from the host. */
  toolInput: Record<string, unknown> | undefined;
  /** Progressive argument stream while the model is still generating the call. */
  partialToolInput: Record<string, unknown> | undefined;
  /** Whether an argument stream is in progress. */
  isStreaming: boolean;
  /** Tool input received but no result yet. */
  isPending: boolean;
  /** View-only result `_meta` channel. */
  meta: Record<string, unknown> | undefined;
  /** Current host context (updated on `host-context-changed`). */
  hostContext: McpUiHostContext | undefined;
  /** Whether the bridge handshake completed. */
  isConnected: boolean;
}

const defaultSnapshot: ViewBridgeSnapshot = {
  props: undefined,
  toolInput: undefined,
  partialToolInput: undefined,
  isStreaming: false,
  isPending: false,
  meta: undefined,
  hostContext: undefined,
  isConnected: false,
};

type Listener = () => void;

interface ViewBridgeStore {
  getSnapshot: () => ViewBridgeSnapshot;
  subscribe: (listener: Listener) => () => void;
  getApp: () => App | null;
  connect: () => Promise<App>;
}

let appInstance: App | null = null;
let connectPromise: Promise<App> | null = null;
let snapshot: ViewBridgeSnapshot = { ...defaultSnapshot };
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setSnapshot(patch: Partial<ViewBridgeSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  emit();
}

function getOrCreateApp(): App {
  if (!appInstance) {
    appInstance = new App(
      { name: "mcp-use-view", version: "2.0.0-alpha.0" },
      { tools: { listChanged: true } },
      { autoResize: true }
    );
    wireAppEvents(appInstance);
  }
  return appInstance;
}

function wireAppEvents(app: App): void {
  app.ontoolinput = (params) => {
    const toolInput = params.arguments ?? {};
    setSnapshot({
      toolInput,
      isPending: snapshot.props === undefined,
    });
  };

  app.ontoolinputpartial = (params) => {
    setSnapshot({
      partialToolInput: params.arguments ?? {},
      isStreaming: true,
      isPending: snapshot.props === undefined,
    });
  };

  app.ontoolresult = (params) => {
    const structured =
      params.structuredContent !== undefined &&
      typeof params.structuredContent === "object" &&
      params.structuredContent !== null
        ? (params.structuredContent as Record<string, unknown>)
        : undefined;
    setSnapshot({
      props: structured,
      meta:
        params._meta !== undefined &&
        typeof params._meta === "object" &&
        params._meta !== null
          ? (params._meta as Record<string, unknown>)
          : undefined,
      partialToolInput: undefined,
      isStreaming: false,
      isPending: false,
    });
  };

  app.onhostcontextchanged = (params) => {
    setSnapshot({
      hostContext: {
        ...(snapshot.hostContext ?? {}),
        ...params,
      },
    });
  };
}

let injectedTransport: ViewBridgeTransport | null = null;

/** @internal Inject a transport before connect (bridge tests only). */
export function _setTransportForTesting(
  transport: ViewBridgeTransport | null
): void {
  injectedTransport = transport;
}

async function connectBridge(): Promise<App> {
  const app = getOrCreateApp();
  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = (async () => {
    if (typeof window === "undefined" && injectedTransport === null) {
      throw new Error("View bridge can only connect in a browser environment");
    }
    const transport =
      injectedTransport ??
      new PostMessageTransport(window.parent, window.parent);
    await app.connect(transport);
    const hostContext = app.getHostContext();
    setSnapshot({
      isConnected: true,
      ...(hostContext !== undefined && { hostContext }),
    });
    return app;
  })();

  return connectPromise;
}

const viewBridgeStore: ViewBridgeStore = {
  getSnapshot: () => snapshot,
  subscribe: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getApp: () => appInstance,
  connect: connectBridge,
};

const ViewBridgeContext = createContext<ViewBridgeStore>(viewBridgeStore);

/**
 * Connect the MCP Apps bridge and provide view state to descendants.
 *
 * @internal
 */
export function ViewBridgeProvider({ children }: { children: ReactNode }) {
  const [, setTick] = useState(0);
  const store = useMemo(() => viewBridgeStore, []);

  useEffect(() => {
    return store.subscribe(() => {
      setTick((n) => n + 1);
    });
  }, [store]);

  useEffect(() => {
    void store.connect().catch((error: unknown) => {
      console.error("[mcp-use] Failed to connect view bridge:", error);
    });

    const unregister = registerModelContextFlush((description) => {
      void (async () => {
        try {
          const app = await store.connect();
          if (description.trim().length === 0) {
            await app.updateModelContext({ content: [] });
            return;
          }
          await app.updateModelContext({
            content: [{ type: "text", text: description }],
          });
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
  return useContext(ViewBridgeContext);
}

/** Subscribe to view bridge snapshot updates. */
export function useViewBridgeSnapshot(): ViewBridgeSnapshot {
  const store = useViewBridgeStore();
  const [, setTick] = useState(0);

  useEffect(() => {
    return store.subscribe(() => {
      setTick((n) => n + 1);
    });
  }, [store]);

  return store.getSnapshot();
}

/** Subscribe to host context changes without re-rendering on other channels. */
export function useHostContextSubscription(): McpUiHostContext | undefined {
  const store = useViewBridgeStore();
  const hostContextRef = useRef(store.getSnapshot().hostContext);
  const [, setTick] = useState(0);

  useEffect(() => {
    return store.subscribe(() => {
      const next = store.getSnapshot().hostContext;
      if (next !== hostContextRef.current) {
        hostContextRef.current = next;
        setTick((n) => n + 1);
      }
    });
  }, [store]);

  return hostContextRef.current;
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

  return {
    callTool,
    sendFollowUpMessage,
    openExternal,
    requestDisplayMode,
  };
}

/** @internal Reset bridge state between tests. */
export function _resetViewBridgeForTesting(): void {
  appInstance = null;
  connectPromise = null;
  injectedTransport = null;
  snapshot = { ...defaultSnapshot };
  listeners.clear();
}
