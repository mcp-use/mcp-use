import {
  App,
  PostMessageTransport,
  type McpUiHostContext,
  type RegisteredAppTool,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/server";

import type { DisplayMode } from "../types/host-types.js";
import type { NormalizedViewConfig } from "./view-config.js";

/** Transport accepted by {@link App.connect}. */
export type ViewRuntimeTransport = NonNullable<Parameters<App["connect"]>[0]>;

type Listener = () => void;

/**
 * Tool-channel snapshot: inbound tool input, result, cancel, and identity.
 *
 * @internal
 */
export interface ToolSnapshot {
  /** Model-visible tool output from the last result's `structuredContent`. */
  toolOutput: unknown;
  /** Model-visible content blocks from the last tool result. */
  content: ContentBlock[] | undefined;
  /** Whether a tool result notification has arrived. */
  hasToolResult: boolean;
  /**
   * Latest tool arguments from the host — partial while streaming, complete
   * after `ui/notifications/tool-input`. Last write wins.
   */
  toolInput: Record<string, unknown> | undefined;
  /** Whether an argument stream is in progress. */
  isStreaming: boolean;
  /**
   * Set when the host sends `ui/notifications/tool-cancelled`; `reason` is the
   * optional spec-provided string.
   */
  cancelled: { reason?: string } | undefined;
  /** View-only result `_meta` channel. */
  meta: Record<string, unknown> | undefined;
  /**
   * Name of the tool for the current call cycle — seeded from
   * `hostContext.toolInfo`; `undefined` until the host delivers it.
   */
  toolName: string | undefined;
}

/**
 * Host-channel snapshot: negotiated host context and connection status.
 *
 * @internal
 */
export interface HostSnapshot {
  /** Current host context (updated on `host-context-changed`). */
  hostContext: McpUiHostContext | undefined;
  /** Whether the App handshake completed. */
  isConnected: boolean;
  /** Last connection failure, if any; cleared on a successful connect. */
  connectionError: Error | undefined;
}

/**
 * Display-channel snapshot: current mode and modes this view declared.
 *
 * @internal
 */
export interface DisplaySnapshot {
  /** How the host is currently displaying the view. */
  displayMode: DisplayMode;
  /** Modes declared by normalized {@link NormalizedViewConfig.displayModes}. */
  availableDisplayModes: readonly DisplayMode[];
}

/**
 * Combined internal snapshot used until Phase 7 splits channel caching.
 *
 * @internal
 */
export interface ViewRuntimeSnapshot extends ToolSnapshot, HostSnapshot {}

/**
 * Parameters for {@link McpAppRuntime.callServerTool}.
 *
 * @internal
 */
export type CallToolParams = Parameters<App["callServerTool"]>[0];

/**
 * Parameters for {@link McpAppRuntime.sendMessage}.
 *
 * @internal
 */
export type SendMessageParams = Parameters<App["sendMessage"]>[0];

/**
 * Parameters for {@link McpAppRuntime.openLink}.
 *
 * @internal
 */
export type OpenLinkParams = Parameters<App["openLink"]>[0];

/**
 * Parameters for {@link McpAppRuntime.requestDisplayMode}.
 *
 * @internal
 */
export type RequestDisplayModeParams = Parameters<App["requestDisplayMode"]>[0];

/**
 * Parameters for {@link McpAppRuntime.sendSizeChanged}.
 *
 * @internal
 */
export type SizeChangedParams = Parameters<App["sendSizeChanged"]>[0];

/**
 * Config passed to {@link McpAppRuntime.registerViewTool} (ext-apps shape).
 *
 * @internal
 */
export type ViewToolConfig = Parameters<App["registerTool"]>[1];

/**
 * Callback passed to {@link McpAppRuntime.registerViewTool}.
 *
 * @internal
 */
export type ViewToolCallback = Parameters<App["registerTool"]>[2];

/**
 * Per-document MCP Apps runtime: owns the guest {@link App}, connection retry
 * generations, tool-handler handoff, snapshots, and disposal.
 *
 * Created by {@link createMcpAppRuntime} / {@link bootstrapView}. Hooks obtain
 * the instance from {@link ViewRuntimeContext}.
 *
 * @internal
 */
export interface McpAppRuntime {
  /** Normalized immutable view configuration fixed at construction. */
  readonly config: NormalizedViewConfig;

  /** Connect (or return the connected / in-flight App). Idempotent per generation. */
  connect(): Promise<App>;
  /** Invalidate the generation, clear listeners/snapshots, and close the App. */
  dispose(): Promise<void>;

  /** Subscribe to tool-channel changes. */
  subscribeTool(listener: Listener): () => void;
  /** Current tool-channel snapshot. */
  getToolSnapshot(): ToolSnapshot;

  /** Subscribe to host-channel changes. */
  subscribeHost(listener: Listener): () => void;
  /** Current host-channel snapshot. */
  getHostSnapshot(): HostSnapshot;

  /** Subscribe to theme-channel changes. */
  subscribeTheme(listener: Listener): () => void;
  /** Current theme (`"light"` until the host reports otherwise). */
  getThemeSnapshot(): "light" | "dark";

  /** Subscribe to display-channel changes. */
  subscribeDisplay(listener: Listener): () => void;
  /** Current display-channel snapshot. */
  getDisplaySnapshot(): DisplaySnapshot;

  /**
   * Combined snapshot subscription used by hooks until Phase 7 splits
   * rerender isolation. Notifies on any channel change.
   */
  subscribe(listener: Listener): () => void;
  /** Combined snapshot (tool + host fields). */
  getSnapshot(): ViewRuntimeSnapshot;

  /** Guest {@link App} for the current generation, or `null` before connect starts. */
  getApp(): App | null;

  /**
   * Replace the transport used by the next {@link connect} generation.
   *
   * @internal
   */
  setTransport(transport: ViewRuntimeTransport | undefined): void;

  /** Call a server tool through the host. */
  callServerTool(params: CallToolParams): Promise<CallToolResult>;
  /** Send a follow-up message through the host. */
  sendMessage(params: SendMessageParams): Promise<void>;
  /** Ask the host to open an external link. */
  openLink(params: OpenLinkParams): Promise<void>;
  /** Request a display-mode change from the host. */
  requestDisplayMode(params: RequestDisplayModeParams): Promise<void>;
  /** Notify the host of a size change. */
  sendSizeChanged(params: SizeChangedParams): Promise<void>;

  /**
   * Register a view tool, performing the empty-handler → registry handoff on
   * the first call. Must remain synchronous relative to the handoff.
   */
  registerViewTool(
    name: string,
    config: ViewToolConfig,
    callback: ViewToolCallback
  ): RegisteredAppTool;
}

const APP_VERSION = "2.0.0-alpha.0";

const defaultToolSnapshot: ToolSnapshot = {
  toolOutput: undefined,
  content: undefined,
  hasToolResult: false,
  toolInput: undefined,
  isStreaming: false,
  cancelled: undefined,
  meta: undefined,
  toolName: undefined,
};

const defaultHostSnapshot: HostSnapshot = {
  hostContext: undefined,
  isConnected: false,
  connectionError: undefined,
};

function resolveDisplayMode(
  hostContext: McpUiHostContext | undefined
): DisplayMode {
  return hostContext?.displayMode === "fullscreen" ||
    hostContext?.displayMode === "pip"
    ? hostContext.displayMode
    : "inline";
}

function installEmptyToolHandlers(app: App): void {
  app.onlisttools = async () => ({ tools: [] });
  app.oncalltool = async ({ name }) => {
    throw new Error(`View tool "${name}" is not registered`);
  };
}

/**
 * Options for {@link createMcpAppRuntime}.
 *
 * @internal
 */
export interface CreateMcpAppRuntimeOptions {
  /**
   * Transport injected before {@link McpAppRuntime.connect} (tests).
   * Defaults to {@link PostMessageTransport} against `window.parent`.
   */
  transport?: ViewRuntimeTransport;
}

/**
 * Create a fresh {@link McpAppRuntime} for one iframe document / view mount.
 *
 * Does not construct the guest {@link App} until {@link McpAppRuntime.connect}
 * runs — keep App creation off the React render path.
 *
 * @param config - Normalized {@link NormalizedViewConfig} from bootstrap.
 * @param options - Optional transport injection for tests.
 * @returns A runtime owning connection, snapshots, and view-tool registration.
 *
 * @internal
 */
export function createMcpAppRuntime(
  config: NormalizedViewConfig,
  options?: CreateMcpAppRuntimeOptions
): McpAppRuntime {
  let disposed = false;
  let currentGeneration = 0;
  let currentApp: App | null = null;
  let connectedApp: App | null = null;
  let connectPromise: Promise<App> | null = null;
  let toolRegistryActivated = false;
  let nextTransport: ViewRuntimeTransport | undefined = options?.transport;

  let snapshot: ViewRuntimeSnapshot = {
    ...defaultToolSnapshot,
    ...defaultHostSnapshot,
  };

  const listeners = new Set<Listener>();

  function emit(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function setSnapshot(patch: Partial<ViewRuntimeSnapshot>): void {
    snapshot = { ...snapshot, ...patch };
    emit();
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getToolSnapshot(): ToolSnapshot {
    return {
      toolOutput: snapshot.toolOutput,
      content: snapshot.content,
      hasToolResult: snapshot.hasToolResult,
      toolInput: snapshot.toolInput,
      isStreaming: snapshot.isStreaming,
      cancelled: snapshot.cancelled,
      meta: snapshot.meta,
      toolName: snapshot.toolName,
    };
  }

  function getHostSnapshot(): HostSnapshot {
    return {
      hostContext: snapshot.hostContext,
      isConnected: snapshot.isConnected,
      connectionError: snapshot.connectionError,
    };
  }

  function getThemeSnapshot(): "light" | "dark" {
    return snapshot.hostContext?.theme === "dark" ? "dark" : "light";
  }

  function getDisplaySnapshot(): DisplaySnapshot {
    return {
      displayMode: resolveDisplayMode(snapshot.hostContext),
      availableDisplayModes: config.displayModes,
    };
  }

  function installRuntimeEventHandlers(app: App): void {
    // Both tool-input and tool-input-partial clear `cancelled` (a new/continuing
    // call cycle). Result state is cleared on every partial (new stream = new
    // call). On complete tool-input, result state is cleared only when a prior
    // result already exists — that input belongs to a subsequent call; within a
    // single call, tool-input always precedes tool-result so hasToolResult is
    // still false and the mid-cycle pending→ready path is unchanged.
    app.ontoolinput = (params) => {
      if (app !== currentApp) return;
      const clearResult = snapshot.hasToolResult;
      setSnapshot({
        toolInput: params.arguments ?? {},
        isStreaming: false,
        cancelled: undefined,
        ...(clearResult && {
          hasToolResult: false,
          toolOutput: undefined,
          content: undefined,
          meta: undefined,
        }),
      });
    };

    app.ontoolinputpartial = (params) => {
      if (app !== currentApp) return;
      setSnapshot({
        toolInput: params.arguments ?? {},
        isStreaming: true,
        cancelled: undefined,
        hasToolResult: false,
        toolOutput: undefined,
        content: undefined,
        meta: undefined,
      });
    };

    app.ontoolresult = (params) => {
      if (app !== currentApp) return;
      const meta =
        params._meta !== undefined &&
        typeof params._meta === "object" &&
        params._meta !== null
          ? (params._meta as Record<string, unknown>)
          : undefined;
      setSnapshot({
        toolOutput: params.structuredContent,
        content: Array.isArray(params.content)
          ? (params.content as ContentBlock[])
          : undefined,
        meta,
        hasToolResult: true,
        isStreaming: false,
        cancelled: undefined,
      });
    };

    app.ontoolcancelled = (params) => {
      if (app !== currentApp) return;
      setSnapshot({
        cancelled: {
          ...(params.reason !== undefined && { reason: params.reason }),
        },
        isStreaming: false,
      });
    };

    app.onhostcontextchanged = (params) => {
      if (app !== currentApp) return;
      const toolNameFromInfo = params.toolInfo?.tool?.name;
      setSnapshot({
        hostContext: {
          ...(snapshot.hostContext ?? {}),
          ...params,
        },
        ...(typeof toolNameFromInfo === "string" && {
          toolName: toolNameFromInfo,
        }),
      });
    };
  }

  function createAppGeneration(): App {
    const app = new App(
      { name: "mcp-use-view", version: APP_VERSION },
      {
        tools: { listChanged: true },
        availableDisplayModes: [...config.displayModes],
      },
      { autoResize: config.autoResize }
    );
    installEmptyToolHandlers(app);
    installRuntimeEventHandlers(app);
    return app;
  }

  async function closeAppQuietly(app: App): Promise<void> {
    try {
      await app.close();
    } catch {
      // Best-effort cleanup after a failed or superseded generation.
    }
  }

  async function connectGeneration(
    app: App,
    generation: number
  ): Promise<App> {
    try {
      if (typeof window === "undefined" && nextTransport === undefined) {
        throw new Error("View runtime can only connect in a browser environment");
      }
      const transport =
        nextTransport ?? new PostMessageTransport(window.parent, window.parent);
      // One-shot: a retry must supply a fresh transport via setTransport /
      // bootstrap options, otherwise postMessage is used.
      nextTransport = undefined;
      await app.connect(transport);
      if (generation !== currentGeneration || disposed) {
        await closeAppQuietly(app);
        throw new Error("View runtime connection superseded");
      }
      const hostContext = app.getHostContext();
      const toolNameFromInfo = hostContext?.toolInfo?.tool?.name;
      connectedApp = app;
      setSnapshot({
        isConnected: true,
        connectionError: undefined,
        ...(hostContext !== undefined && { hostContext }),
        ...(typeof toolNameFromInfo === "string" && {
          toolName: toolNameFromInfo,
        }),
      });
      return app;
    } catch (error) {
      const failure =
        error instanceof Error ? error : new Error(String(error));
      // Clear the rejected promise before awaiting cleanup so a retry can
      // start a new generation while the old App finishes closing.
      if (generation === currentGeneration && !disposed) {
        currentApp = null;
        connectedApp = null;
        connectPromise = null;
        toolRegistryActivated = false;
        setSnapshot({
          isConnected: false,
          connectionError: failure,
        });
      }
      await closeAppQuietly(app);
      throw error;
    }
  }

  async function connect(): Promise<App> {
    if (disposed) {
      throw new Error("View runtime has been disposed");
    }
    if (connectedApp) return connectedApp;
    if (connectPromise) return connectPromise;

    const generation = ++currentGeneration;
    const app = createAppGeneration();
    currentApp = app;
    toolRegistryActivated = false;

    connectPromise = connectGeneration(app, generation);
    return connectPromise;
  }

  function registerViewTool(
    name: string,
    toolConfig: ViewToolConfig,
    callback: ViewToolCallback
  ): RegisteredAppTool {
    if (disposed) {
      throw new Error("View runtime has been disposed");
    }
    const app = currentApp;
    if (!app) {
      throw new Error(
        "registerViewTool requires connect() to have started so an App exists"
      );
    }

    if (toolRegistryActivated) {
      return app.registerTool(name, toolConfig, callback);
    }

    // Clear temporary handlers first so ensureToolHandlersInitialized does not
    // warn about replacing them. Clear + register must stay in one turn.
    app.onlisttools = undefined;
    app.oncalltool = undefined;

    try {
      const registration = app.registerTool(name, toolConfig, callback);
      toolRegistryActivated = true;
      return registration;
    } catch (error) {
      installEmptyToolHandlers(app);
      throw error;
    }
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    currentGeneration += 1;
    const app = currentApp;
    currentApp = null;
    connectedApp = null;
    connectPromise = null;
    toolRegistryActivated = false;
    listeners.clear();
    snapshot = {
      ...defaultToolSnapshot,
      ...defaultHostSnapshot,
    };
    if (activeRuntime === runtime) {
      activeRuntime = null;
    }
    if (app) {
      await closeAppQuietly(app);
    }
  }

  const runtime: McpAppRuntime = {
    config,
    connect,
    dispose,
    subscribeTool: subscribe,
    getToolSnapshot,
    subscribeHost: subscribe,
    getHostSnapshot,
    subscribeTheme: subscribe,
    getThemeSnapshot,
    subscribeDisplay: subscribe,
    getDisplaySnapshot,
    subscribe,
    getSnapshot: () => snapshot,
    getApp: () => currentApp,
    setTransport(transport) {
      nextTransport = transport;
    },
    async callServerTool(params) {
      const app = await connect();
      return app.callServerTool(params);
    },
    async sendMessage(params) {
      const app = await connect();
      await app.sendMessage(params);
    },
    async openLink(params) {
      const app = await connect();
      await app.openLink(params);
    },
    async requestDisplayMode(params) {
      const app = await connect();
      await app.requestDisplayMode(params);
    },
    async sendSizeChanged(params) {
      const app = await connect();
      await app.sendSizeChanged(params);
    },
    registerViewTool,
  };

  return runtime;
}

/**
 * Document-level active runtime used by the imperative model-context flush
 * path until Phase 11 owns a per-runtime store.
 *
 * Set by {@link bootstrapView} / {@link ViewRuntimeProvider}; cleared on
 * {@link McpAppRuntime.dispose}.
 */
let activeRuntime: McpAppRuntime | null = null;

/**
 * Warn-once flag for hosts that omit the `updateModelContext` capability.
 */
let warnedModelContextUnsupported = false;

/** Transport queued for the next bootstrap when set before the runtime exists. */
let pendingTestTransport: ViewRuntimeTransport | null = null;

/**
 * Register `runtime` as the document-active instance for imperative APIs.
 *
 * @param runtime - Runtime to activate, or `null` to clear.
 *
 * @internal
 */
export function setActiveRuntime(runtime: McpAppRuntime | null): void {
  activeRuntime = runtime;
}

/**
 * Return the document-active runtime, if any.
 *
 * @internal
 */
export function getActiveRuntime(): McpAppRuntime | null {
  return activeRuntime;
}

/**
 * Mark that the missing-`updateModelContext` warning has been emitted.
 *
 * @returns `true` if this call should emit the warning (first time only).
 *
 * @internal
 */
export function markModelContextUnsupportedWarned(): boolean {
  if (warnedModelContextUnsupported) {
    return false;
  }
  warnedModelContextUnsupported = true;
  return true;
}

/**
 * Inject a transport before the next connect.
 *
 * When an active runtime exists, updates that runtime. Otherwise queues the
 * transport for the next {@link createMcpAppRuntime} via bootstrap.
 *
 * @param transport - Guest-side paired transport, or `null` to clear.
 *
 * @internal
 */
export function _setTransportForTesting(
  transport: ViewRuntimeTransport | null
): void {
  if (activeRuntime) {
    activeRuntime.setTransport(transport ?? undefined);
    return;
  }
  pendingTestTransport = transport;
}

/**
 * Consume and clear any transport queued by {@link _setTransportForTesting}.
 *
 * @internal
 */
export function takePendingTestTransport(): ViewRuntimeTransport | undefined {
  const transport = pendingTestTransport ?? undefined;
  pendingTestTransport = null;
  return transport;
}

/** @internal Reset runtime module seams between tests. */
export function _resetViewBridgeForTesting(): void {
  const runtime = activeRuntime;
  activeRuntime = null;
  pendingTestTransport = null;
  warnedModelContextUnsupported = false;
  if (runtime) {
    void runtime.dispose();
  }
}

/** @internal Guest `App` for the active runtime (bridge tests only). */
export function _getAppForTesting(): App | null {
  return activeRuntime?.getApp() ?? null;
}

/** @internal Active runtime instance (Phase 5 runtime tests). */
export function _getRuntimeForTesting(): McpAppRuntime | null {
  return activeRuntime;
}
