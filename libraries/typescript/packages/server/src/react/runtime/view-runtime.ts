import {
  App,
  PostMessageTransport,
  type McpUiHostContext,
  type RegisteredAppTool,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/server";

import type { DisplayMode } from "../types/host-types.js";
import {
  toolContextErrorMessage,
  type ToolContextError,
} from "../types/result-types.js";
import { ModelContextStore } from "./model-context-store.js";
import type { NormalizedViewConfig } from "./view-config.js";

/** Transport accepted by {@link App.connect}. */
export type ViewRuntimeTransport = NonNullable<Parameters<App["connect"]>[0]>;

type Listener = () => void;

/**
 * Tool-channel snapshot: inbound tool input, result, cancel, and errors.
 *
 * `hasToolResult` is true only for a non-error result with `structuredContent`
 * (the `"ready"` branch). Tool errors and invalid results set `error` instead.
 *
 * @internal
 */
export interface ToolSnapshot {
  /** Model-visible tool output from the last ready result's `structuredContent`. */
  toolOutput: unknown;
  /** Model-visible content blocks from the last tool result (ready or error). */
  content: ContentBlock[] | undefined;
  /**
   * Whether a ready (non-error, with `structuredContent`) tool result has
   * arrived for the current call cycle.
   */
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
   * Tool or invalid-result error for the current call cycle; cleared on a new
   * input/streaming cycle or a ready result.
   */
  error: ToolContextError | undefined;
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
 * Display-channel snapshot: current mode and negotiated available modes.
 *
 * @internal
 */
export interface DisplaySnapshot {
  /** How the host is currently displaying the view. */
  displayMode: DisplayMode;
  /**
   * Negotiated modes: intersection of normalized
   * {@link NormalizedViewConfig.displayModes} and
   * `hostContext.availableDisplayModes`. When the host omits available modes,
   * only `"inline"`.
   */
  availableDisplayModes: readonly DisplayMode[];
}

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
 * generations, tool-handler handoff, narrow external-store channels, one
 * {@link ModelContextStore}, and disposal.
 *
 * Created by {@link createMcpAppRuntime} / {@link bootstrapView}. Hooks obtain
 * the instance from {@link ViewRuntimeContext}.
 *
 * @internal
 */
export interface McpAppRuntime {
  /** Normalized immutable view configuration fixed at construction. */
  readonly config: NormalizedViewConfig;

  /**
   * Per-runtime model-context node tree and async flush pump.
   *
   * Constructed with this runtime and disposed with it. React components obtain
   * it via {@link useViewRuntime}; the imperative `modelContext` API delegates
   * to the active document runtime's store.
   */
  readonly modelContextStore: ModelContextStore;

  /** Connect (or return the connected / in-flight App). Idempotent per generation. */
  connect(): Promise<App>;
  /**
   * Invalidate the active generation, dispose the model-context store (so late
   * in-flight completions are ignored), prevent late event delivery, clear
   * listeners and snapshots, and close the App/transport.
   *
   * Callers should unmount the view tree first (see `disposeView`) so hook
   * cleanup can run while the App connection still exists.
   */
  dispose(): Promise<void>;

  /** Subscribe to tool-channel changes. */
  subscribeTool(listener: Listener): () => void;
  /** Current tool-channel snapshot (stable until a tool field changes). */
  getToolSnapshot(): ToolSnapshot;

  /** Subscribe to host-channel changes. */
  subscribeHost(listener: Listener): () => void;
  /** Current host-channel snapshot (stable until host/connection fields change). */
  getHostSnapshot(): HostSnapshot;

  /** Subscribe to theme-channel changes. */
  subscribeTheme(listener: Listener): () => void;
  /** Current theme (`"light"` until the host reports otherwise). Primitive; stable until theme changes. */
  getThemeSnapshot(): "light" | "dark";

  /** Subscribe to display-channel changes. */
  subscribeDisplay(listener: Listener): () => void;
  /**
   * Current display-channel snapshot (stable until `displayMode` or
   * negotiated `availableDisplayModes` change).
   */
  getDisplaySnapshot(): DisplaySnapshot;

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
  error: undefined,
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

function resolveTheme(
  hostContext: McpUiHostContext | undefined
): "light" | "dark" {
  return hostContext?.theme === "dark" ? "dark" : "light";
}

function sameDisplayModes(
  a: readonly DisplayMode[],
  b: readonly DisplayMode[]
): boolean {
  return a.length === b.length && a.every((mode, index) => mode === b[index]);
}

/**
 * Negotiated display modes: view modes ∩ host modes.
 *
 * When the host omits `availableDisplayModes`, only `"inline"` is requestable.
 */
function resolveAvailableDisplayModes(
  viewModes: readonly DisplayMode[],
  hostContext: McpUiHostContext | undefined
): readonly DisplayMode[] {
  const hostModes = hostContext?.availableDisplayModes;
  if (hostModes === undefined) {
    return ["inline"];
  }
  return viewModes.filter((mode) => hostModes.includes(mode));
}

function installEmptyToolHandlers(app: App): void {
  app.onlisttools = async () => ({ tools: [] });
  app.oncalltool = async ({ name }) => {
    throw new Error(`View tool "${name}" is not registered`);
  };
}

function createChannelStore(): {
  subscribe: (listener: Listener) => () => void;
  emit: () => void;
  clear: () => void;
} {
  const listeners = new Set<Listener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit() {
      for (const listener of listeners) {
        listener();
      }
    },
    clear() {
      listeners.clear();
    },
  };
}

function toolSnapshotChanged(
  prev: ToolSnapshot,
  patch: Partial<ToolSnapshot>
): boolean {
  for (const key of Object.keys(patch) as (keyof ToolSnapshot)[]) {
    if (prev[key] !== patch[key]) {
      return true;
    }
  }
  return false;
}

function hostSnapshotChanged(
  prev: HostSnapshot,
  patch: Partial<HostSnapshot>
): boolean {
  for (const key of Object.keys(patch) as (keyof HostSnapshot)[]) {
    if (prev[key] !== patch[key]) {
      return true;
    }
  }
  return false;
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

  let toolSnapshot: ToolSnapshot = { ...defaultToolSnapshot };
  let hostSnapshot: HostSnapshot = { ...defaultHostSnapshot };
  let themeSnapshot: "light" | "dark" = "light";
  // Host has not reported modes yet → treat as omitted → only "inline".
  let displaySnapshot: DisplaySnapshot = {
    displayMode: "inline",
    availableDisplayModes: ["inline"],
  };

  const toolChannel = createChannelStore();
  const hostChannel = createChannelStore();
  const themeChannel = createChannelStore();
  const displayChannel = createChannelStore();

  // Declared before connect so the store host can close over it; connect is a
  // function declaration and is initialized before any store method runs.
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

  const modelContextStore = new ModelContextStore({ connect });

  function patchTool(patch: Partial<ToolSnapshot>): void {
    if (!toolSnapshotChanged(toolSnapshot, patch)) {
      return;
    }
    toolSnapshot = { ...toolSnapshot, ...patch };
    toolChannel.emit();
  }

  function patchHost(patch: Partial<HostSnapshot>): void {
    if (!hostSnapshotChanged(hostSnapshot, patch)) {
      return;
    }
    hostSnapshot = { ...hostSnapshot, ...patch };
    hostChannel.emit();
  }

  function syncThemeFromHost(
    hostContext: McpUiHostContext | undefined
  ): void {
    const next = resolveTheme(hostContext);
    if (next === themeSnapshot) {
      return;
    }
    themeSnapshot = next;
    themeChannel.emit();
  }

  function syncDisplayFromHost(
    hostContext: McpUiHostContext | undefined
  ): void {
    const nextMode = resolveDisplayMode(hostContext);
    const nextAvailable = resolveAvailableDisplayModes(
      config.displayModes,
      hostContext
    );
    if (
      nextMode === displaySnapshot.displayMode &&
      sameDisplayModes(nextAvailable, displaySnapshot.availableDisplayModes)
    ) {
      return;
    }
    displaySnapshot = {
      displayMode: nextMode,
      availableDisplayModes: nextAvailable,
    };
    displayChannel.emit();
  }

  /**
   * Apply a host-context update and fan out to host / theme / display
   * channels that actually changed.
   */
  function applyHostContext(nextHostContext: McpUiHostContext): void {
    patchHost({ hostContext: nextHostContext });
    syncThemeFromHost(nextHostContext);
    syncDisplayFromHost(nextHostContext);
  }

  /** Clear ready/error result fields shared by new call-cycle transitions. */
  const clearResultPatch = {
    hasToolResult: false,
    toolOutput: undefined,
    content: undefined,
    meta: undefined,
    error: undefined,
  } as const satisfies Partial<ToolSnapshot>;

  function installRuntimeEventHandlers(app: App): void {
    // Both tool-input and tool-input-partial clear `cancelled` (a new/continuing
    // call cycle). Result/error state is cleared on every partial (new stream =
    // new call). On complete tool-input, result state is cleared only when a
    // prior result or error already exists — that input belongs to a subsequent
    // call; within a single call, tool-input always precedes tool-result so
    // hasToolResult/error are still unset and the mid-cycle pending→ready path
    // is unchanged.
    app.ontoolinput = (params) => {
      if (app !== currentApp) return;
      const clearResult =
        toolSnapshot.hasToolResult || toolSnapshot.error !== undefined;
      patchTool({
        toolInput: params.arguments ?? {},
        isStreaming: false,
        cancelled: undefined,
        ...(clearResult && clearResultPatch),
      });
    };

    app.ontoolinputpartial = (params) => {
      if (app !== currentApp) return;
      patchTool({
        toolInput: params.arguments ?? {},
        isStreaming: true,
        cancelled: undefined,
        ...clearResultPatch,
      });
    };

    app.ontoolresult = (params) => {
      if (app !== currentApp) return;
      const content = Array.isArray(params.content)
        ? (params.content as ContentBlock[])
        : undefined;
      const meta =
        params._meta !== undefined &&
        typeof params._meta === "object" &&
        params._meta !== null
          ? (params._meta as Record<string, unknown>)
          : undefined;

      if (params.isError === true) {
        const result = params as CallToolResult & { isError: true };
        patchTool({
          error: {
            kind: "tool",
            message: toolContextErrorMessage(result),
            result,
          },
          hasToolResult: false,
          toolOutput: undefined,
          content,
          meta,
          isStreaming: false,
          cancelled: undefined,
        });
        return;
      }

      if (params.structuredContent === undefined) {
        patchTool({
          error: {
            kind: "invalid-result",
            message:
              "View-bound tool returned a non-error result without structuredContent",
            result: params,
          },
          hasToolResult: false,
          toolOutput: undefined,
          content,
          meta,
          isStreaming: false,
          cancelled: undefined,
        });
        return;
      }

      patchTool({
        error: undefined,
        toolOutput: params.structuredContent,
        content,
        meta,
        hasToolResult: true,
        isStreaming: false,
        cancelled: undefined,
      });
    };

    app.ontoolcancelled = (params) => {
      if (app !== currentApp) return;
      patchTool({
        cancelled: {
          ...(params.reason !== undefined && { reason: params.reason }),
        },
        isStreaming: false,
      });
    };

    app.onhostcontextchanged = (params) => {
      if (app !== currentApp) return;
      applyHostContext({
        ...(hostSnapshot.hostContext ?? {}),
        ...params,
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
      connectedApp = app;
      patchHost({
        isConnected: true,
        connectionError: undefined,
        ...(hostContext !== undefined && { hostContext }),
      });
      // Always re-derive display (host omitting modes → ["inline"]).
      syncThemeFromHost(hostContext);
      syncDisplayFromHost(hostContext);
      // Retry a dirty model-context payload after a successful (re)connect.
      modelContextStore.notifyConnected();
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
        patchHost({
          isConnected: false,
          connectionError: failure,
        });
      }
      await closeAppQuietly(app);
      throw error;
    }
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
    modelContextStore.dispose();
    const app = currentApp;
    currentApp = null;
    connectedApp = null;
    connectPromise = null;
    toolRegistryActivated = false;
    toolChannel.clear();
    hostChannel.clear();
    themeChannel.clear();
    displayChannel.clear();
    toolSnapshot = { ...defaultToolSnapshot };
    hostSnapshot = { ...defaultHostSnapshot };
    themeSnapshot = "light";
    displaySnapshot = {
      displayMode: "inline",
      availableDisplayModes: ["inline"],
    };
    if (activeRuntime === runtime) {
      activeRuntime = null;
    }
    if (app) {
      await closeAppQuietly(app);
    }
  }

  async function callServerTool(
    params: CallToolParams
  ): Promise<CallToolResult> {
    const app = await connect();
    if (app.getHostCapabilities()?.serverTools === undefined) {
      throw new Error(
        "Host does not advertise the serverTools capability required to call server tools"
      );
    }
    return app.callServerTool(params);
  }

  async function sendMessage(params: SendMessageParams): Promise<void> {
    const app = await connect();
    if (app.getHostCapabilities()?.message === undefined) {
      throw new Error(
        "Host does not advertise the message capability required to send follow-up messages"
      );
    }
    await app.sendMessage(params);
  }

  async function openLink(params: OpenLinkParams): Promise<void> {
    const app = await connect();
    if (app.getHostCapabilities()?.openLinks === undefined) {
      throw new Error(
        "Host does not advertise the openLinks capability required to open external links"
      );
    }
    await app.openLink(params);
  }

  async function requestDisplayMode(
    params: RequestDisplayModeParams
  ): Promise<void> {
    const app = await connect();
    // Re-derive from the latest host context so a race with host-context
    // updates cannot approve a mode the snapshot has not yet published.
    const negotiated = resolveAvailableDisplayModes(
      config.displayModes,
      app.getHostContext() ?? hostSnapshot.hostContext
    );
    if (!negotiated.includes(params.mode as DisplayMode)) {
      throw new Error(
        `Display mode "${params.mode}" is not in the negotiated available modes [${negotiated.join(", ")}]`
      );
    }
    await app.requestDisplayMode(params);
  }

  async function sendSizeChanged(params: SizeChangedParams): Promise<void> {
    const app = await connect();
    await app.sendSizeChanged(params);
  }

  const runtime: McpAppRuntime = {
    config,
    modelContextStore,
    connect,
    dispose,
    subscribeTool: toolChannel.subscribe,
    getToolSnapshot: () => toolSnapshot,
    subscribeHost: hostChannel.subscribe,
    getHostSnapshot: () => hostSnapshot,
    subscribeTheme: themeChannel.subscribe,
    getThemeSnapshot: () => themeSnapshot,
    subscribeDisplay: displayChannel.subscribe,
    getDisplaySnapshot: () => displaySnapshot,
    getApp: () => currentApp,
    setTransport(transport) {
      nextTransport = transport;
    },
    callServerTool,
    sendMessage,
    openLink,
    requestDisplayMode,
    sendSizeChanged,
    registerViewTool,
  };

  return runtime;
}

/**
 * Document-level active runtime used by the imperative {@link modelContext}
 * API and test seams.
 *
 * Set by {@link bootstrapView}; cleared on {@link McpAppRuntime.dispose}.
 */
let activeRuntime: McpAppRuntime | null = null;

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

/**
 * Optional disposer registered by bootstrap-view so test reset can run the
 * real unmount-then-close path without a circular static import.
 */
let registeredDisposeView: (() => Promise<void>) | null = null;

/**
 * Register {@link disposeView} for {@link _resetViewBridgeForTesting}.
 *
 * @param disposer - The document dispose function from bootstrap-view.
 *
 * @internal
 */
export function _registerDisposeViewForTesting(
  disposer: () => Promise<void>
): void {
  registeredDisposeView = disposer;
}

/**
 * @internal Reset runtime module seams between tests.
 *
 * Uses the real {@link disposeView} path when bootstrap has registered it
 * (unmount React, then close the App). Falls back to disposing an orphaned
 * active runtime when nothing is mounted through bootstrap.
 */
export function _resetViewBridgeForTesting(): void {
  pendingTestTransport = null;
  if (registeredDisposeView) {
    void registeredDisposeView();
    return;
  }
  const runtime = activeRuntime;
  activeRuntime = null;
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
