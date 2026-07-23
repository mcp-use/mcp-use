import {
  App,
  PostMessageTransport,
  type McpUiHostContext,
  type RegisteredAppTool,
} from "@modelcontextprotocol/ext-apps";
import type {
  CallToolResult,
  ContentBlock,
} from "@modelcontextprotocol/server";

import type { DisplayMode } from "../types/host-types.js";
import type { FileMetadata } from "../types/file-types.js";
import { ToolError, type ToolContextError } from "../types/result-types.js";
import { ModelContextStore } from "./model-context-store.js";
import type { NormalizedViewConfig } from "./view-config.js";

/** Transport accepted by {@link App.connect}. */
export type ViewRuntimeTransport = NonNullable<Parameters<App["connect"]>[0]>;

type Listener = () => void;

/**
 * Tool-channel snapshot for the invocation that rendered this View.
 *
 * Input notifications replace `toolInput` while the invocation is pending.
 * The first structured result or tool error latches a terminal state; all
 * later ambient lifecycle notifications are ignored.
 *
 * @internal
 */
export interface ToolSnapshot {
  /** Pending until the first structured result or tool error, then terminal. */
  status: "pending" | "ready" | "error";
  /** Model-visible tool output from the last ready result's `structuredContent`. */
  toolOutput: unknown;
  /** Model-visible content blocks from the last tool result (ready or error). */
  content: ContentBlock[] | undefined;
  /**
   * Latest progressive tool arguments from the host. Partial and complete
   * notifications replace the same snapshot; last write wins.
   */
  toolInput: Record<string, unknown> | undefined;
  /** View-only result `_meta` channel. */
  meta: Record<string, unknown> | undefined;
  /**
   * Tool error for the rendering invocation.
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
  /** Terminal connection failure for this mount, if any. */
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
 * ChatGPT file-extension channel snapshot.
 *
 * This channel deliberately represents only the optional file APIs used by
 * `useFiles`; the runtime does not mirror other `window.openai` globals.
 *
 * @internal
 */
export interface FilesSnapshot {
  /** Whether both upload and temporary-download-url helpers are available. */
  isSupported: boolean;
}

interface ChatGptFilesApi {
  uploadFile?: (file: File) => Promise<FileMetadata>;
  getFileDownloadUrl?: (file: FileMetadata) => Promise<{ downloadUrl: string }>;
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
 * Per-document MCP Apps runtime: owns one guest {@link App}, one cached
 * connection attempt, tool-handler handoff, narrow external-store channels,
 * one shared view-state/model-context store, and disposal.
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
   * Per-runtime structured view state, model-context tree, and async flush pump.
   *
   * Constructed with this runtime and disposed with it. React components obtain
   * it via {@link useViewRuntime}; the imperative `modelContext` API delegates
   * to the active document runtime's store.
   */
  readonly modelContextStore: ModelContextStore;

  /** Connect once, or return the cached in-flight / settled connection promise. */
  connect(): Promise<App>;
  /**
   * Dispose the model-context store (so late in-flight completions are
   * ignored), prevent late event delivery, clear listeners and snapshots, and
   * close the App/transport.
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

  /** Subscribe to ChatGPT file-extension availability changes. */
  subscribeFiles(listener: Listener): () => void;
  /** Current ChatGPT file-extension snapshot. */
  getFilesSnapshot(): FilesSnapshot;

  /** Runtime-owned guest {@link App}, or `null` after disposal. */
  getApp(): App | null;

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
  /** Upload a file through ChatGPT's optional file extension. */
  uploadFile(file: File): Promise<FileMetadata>;
  /** Request a temporary download URL through ChatGPT's file extension. */
  getFileDownloadUrl(file: FileMetadata): Promise<{ downloadUrl: string }>;

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
  status: "pending",
  toolOutput: undefined,
  content: undefined,
  toolInput: undefined,
  meta: undefined,
  error: undefined,
};

const defaultHostSnapshot: HostSnapshot = {
  hostContext: undefined,
  isConnected: false,
  connectionError: undefined,
};

const defaultFilesSnapshot: FilesSnapshot = {
  isSupported: false,
};

function getChatGptFilesApi(): ChatGptFilesApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { openai?: ChatGptFilesApi }).openai;
}

function resolveFilesSnapshot(): FilesSnapshot {
  const api = getChatGptFilesApi();
  return {
    isSupported:
      typeof api?.uploadFile === "function" &&
      typeof api.getFileDownloadUrl === "function",
  };
}

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
   * Transport used by the runtime's single {@link McpAppRuntime.connect}
   * attempt (tests).
   * Defaults to {@link PostMessageTransport} against `window.parent`.
   */
  transport?: ViewRuntimeTransport;
}

/**
 * Create a fresh {@link McpAppRuntime} for one iframe document / view mount.
 *
 * Constructs and configures the guest {@link App} eagerly so event handlers
 * and view tools can be registered before or during initialization. The App is
 * connected at most once and remains owned by the runtime until disposal.
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
  let connectPromise: Promise<App> | null = null;
  let toolRegistryActivated = false;
  const configuredTransport = options?.transport;

  let toolSnapshot: ToolSnapshot = { ...defaultToolSnapshot };
  let hostSnapshot: HostSnapshot = { ...defaultHostSnapshot };
  let themeSnapshot: "light" | "dark" = "light";
  // Host has not reported modes yet → treat as omitted → only "inline".
  let displaySnapshot: DisplaySnapshot = {
    displayMode: "inline",
    availableDisplayModes: ["inline"],
  };
  let filesSnapshot: FilesSnapshot = resolveFilesSnapshot();

  const toolChannel = createChannelStore();
  const hostChannel = createChannelStore();
  const themeChannel = createChannelStore();
  const displayChannel = createChannelStore();
  const filesChannel = createChannelStore();

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

  function syncThemeFromHost(hostContext: McpUiHostContext | undefined): void {
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

  function installRuntimeEventHandlers(app: App): void {
    // The draft notification shape has no tool name or request id. While the
    // rendering invocation is pending, both complete and partial input replace
    // the same progressive snapshot. Once a result is latched, later ambient
    // lifecycle notifications must not mutate the View context.
    app.ontoolinput = (params) => {
      if (disposed || toolSnapshot.status !== "pending") return;
      patchTool({ toolInput: params.arguments ?? {} });
    };

    app.ontoolinputpartial = (params) => {
      if (disposed || toolSnapshot.status !== "pending") return;
      patchTool({ toolInput: params.arguments ?? {} });
    };

    app.ontoolresult = (params) => {
      if (disposed || toolSnapshot.status !== "pending") return;

      // Content-only successes are valid CallToolResults from ambient server
      // or View tools. Without correlation metadata they cannot be classified
      // as malformed rendering results, so leave the pending context alone.
      if (params.isError !== true && params.structuredContent === undefined) {
        return;
      }

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
          status: "error",
          error: new ToolError(result),
          toolOutput: undefined,
          content,
          meta,
        });
        return;
      }

      patchTool({
        status: "ready",
        error: undefined,
        toolOutput: params.structuredContent,
        content,
        meta,
      });
    };

    // Cancellation cannot be correlated either and has no public bound-state
    // branch. A cancelled rendering invocation therefore remains pending.
    app.ontoolcancelled = () => {};

    app.onhostcontextchanged = (params) => {
      if (disposed) return;
      applyHostContext({
        ...(hostSnapshot.hostContext ?? {}),
        ...params,
      });
    };
  }

  function createApp(): App {
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

  const app = createApp();

  async function closeAppQuietly(app: App): Promise<void> {
    try {
      await app.close();
    } catch {
      // Best-effort deterministic cleanup.
    }
  }

  async function connectApp(): Promise<App> {
    try {
      if (typeof window === "undefined" && configuredTransport === undefined) {
        throw new Error(
          "View runtime can only connect in a browser environment"
        );
      }
      const transport =
        configuredTransport ??
        new PostMessageTransport(window.parent, window.parent);
      await app.connect(transport);
      if (disposed) {
        await closeAppQuietly(app);
        throw new Error("View runtime was disposed during connection");
      }
      const hostContext = app.getHostContext();
      patchHost({
        isConnected: true,
        connectionError: undefined,
        ...(hostContext !== undefined && { hostContext }),
      });
      // Always re-derive display (host omitting modes → ["inline"]).
      syncThemeFromHost(hostContext);
      syncDisplayFromHost(hostContext);
      return app;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (!disposed) {
        patchHost({
          isConnected: false,
          connectionError: failure,
        });
      }
      throw failure;
    }
  }

  function connect(): Promise<App> {
    if (disposed) {
      return Promise.reject(new Error("View runtime has been disposed"));
    }
    connectPromise ??= connectApp();
    return connectPromise;
  }

  const modelContextStore = new ModelContextStore({ connect });

  function registerViewTool(
    name: string,
    toolConfig: ViewToolConfig,
    callback: ViewToolCallback
  ): RegisteredAppTool {
    if (disposed) {
      throw new Error("View runtime has been disposed");
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
    modelContextStore.dispose();
    toolRegistryActivated = false;
    toolChannel.clear();
    hostChannel.clear();
    themeChannel.clear();
    displayChannel.clear();
    filesChannel.clear();
    toolSnapshot = { ...defaultToolSnapshot };
    hostSnapshot = { ...defaultHostSnapshot };
    themeSnapshot = "light";
    displaySnapshot = {
      displayMode: "inline",
      availableDisplayModes: ["inline"],
    };
    filesSnapshot = { ...defaultFilesSnapshot };
    if (activeRuntime === runtime) {
      activeRuntime = null;
    }
    await closeAppQuietly(app);
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

  async function uploadFile(file: File): Promise<FileMetadata> {
    if (disposed) {
      throw new Error("View runtime has been disposed");
    }

    const api = getChatGptFilesApi();
    if (!filesSnapshot.isSupported || typeof api?.uploadFile !== "function") {
      throw new Error(
        "[useFiles] File upload is not supported in this host. " +
          "Check `isSupported` before calling `upload`. " +
          "File operations are only available in the ChatGPT Apps SDK environment."
      );
    }

    return api.uploadFile(file);
  }

  async function getFileDownloadUrl(
    file: FileMetadata
  ): Promise<{ downloadUrl: string }> {
    if (disposed) {
      throw new Error("View runtime has been disposed");
    }

    const api = getChatGptFilesApi();
    if (
      !filesSnapshot.isSupported ||
      typeof api?.getFileDownloadUrl !== "function"
    ) {
      throw new Error(
        "[useFiles] File download is not supported in this host. " +
          "Check `isSupported` before calling `getDownloadUrl`. " +
          "File operations are only available in the ChatGPT Apps SDK environment."
      );
    }
    return api.getFileDownloadUrl(file);
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
    subscribeFiles: filesChannel.subscribe,
    getFilesSnapshot: () => filesSnapshot,
    getApp: () => (disposed ? null : app),
    callServerTool,
    sendMessage,
    openLink,
    requestDisplayMode,
    sendSizeChanged,
    uploadFile,
    getFileDownloadUrl,
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
 * Inject a transport before the next bootstrap-created runtime.
 *
 * A mounted runtime has already started its sole connection attempt, so its
 * transport cannot be replaced.
 *
 * @param transport - Guest-side paired transport, or `null` to clear.
 *
 * @internal
 */
export function _setTransportForTesting(
  transport: ViewRuntimeTransport | null
): void {
  if (activeRuntime) {
    throw new Error(
      "Cannot replace the transport after a view runtime has been mounted"
    );
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
