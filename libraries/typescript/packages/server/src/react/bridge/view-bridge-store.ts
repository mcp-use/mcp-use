import {
  App,
  PostMessageTransport,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { ContentBlock } from "@modelcontextprotocol/server";

import { TOOL_NAME_META_KEY } from "../../views/constants.js";

type ViewBridgeTransport = NonNullable<Parameters<App["connect"]>[0]>;

/** Snapshot of view data channels and host context delivered over the bridge. */
export interface ViewBridgeSnapshot {
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
   * `hostContext.toolInfo`, authoritatively updated from the framework's
   * `_meta["mcp-use/toolName"]` stamp on each tool result; `undefined` until
   * either source delivers.
   */
  toolName: string | undefined;
  /** Current host context (updated on `host-context-changed`). */
  hostContext: McpUiHostContext | undefined;
  /** Whether the bridge handshake completed. */
  isConnected: boolean;
}

const defaultSnapshot: ViewBridgeSnapshot = {
  toolOutput: undefined,
  content: undefined,
  hasToolResult: false,
  toolInput: undefined,
  isStreaming: false,
  cancelled: undefined,
  meta: undefined,
  toolName: undefined,
  hostContext: undefined,
  isConnected: false,
};

type Listener = () => void;

/**
 * Store contract consumed by the view bridge hooks: snapshot reads, change
 * subscription, and access to the shared guest {@link App}.
 *
 * @internal
 */
export interface ViewBridgeStore {
  /** Current {@link ViewBridgeSnapshot} (reference stable between emits). */
  getSnapshot: () => ViewBridgeSnapshot;
  /** Register a change listener; returns an unsubscribe function. */
  subscribe: (listener: Listener) => () => void;
  /** The shared guest `App` instance, or `null` before first connect. */
  getApp: () => App | null;
  /** Connect the bridge (idempotent) and resolve the shared `App`. */
  connect: () => Promise<App>;
}

let appInstance: App | null = null;
let connectPromise: Promise<App> | null = null;
let snapshot: ViewBridgeSnapshot = { ...defaultSnapshot };
const listeners = new Set<Listener>();

/** Guest `App` options applied before the first `App` is constructed. */
let bridgeAppOptions: { autoResize?: boolean } | undefined;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Immutably replace the snapshot. Fields omitted from `patch` keep their prior
 * references (notably `hostContext`), so narrow `useSyncExternalStore`
 * selectors stay stable across unrelated channel updates.
 */
function setSnapshot(patch: Partial<ViewBridgeSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  emit();
}

/**
 * Configure guest `App` options before the bridge constructs/`connect`s.
 *
 * Called by {@link McpUseProvider} during its first render (render precedes
 * all effects, so the value is set before any effect runs `connect()`).
 * Ignored (with a warning) if an `App` instance already exists — auto-resize
 * cannot be toggled after connect.
 *
 * @param options - Per-view guest options (currently `autoResize`).
 *
 * @internal
 */
export function setViewBridgeAppOptions(options: {
  autoResize?: boolean;
}): void {
  if (appInstance !== null) {
    console.warn(
      "[mcp-use] setViewBridgeAppOptions called after the view bridge App was already created; ignoring."
    );
    return;
  }
  bridgeAppOptions = options;
}

function getOrCreateApp(): App {
  if (!appInstance) {
    appInstance = new App(
      { name: "mcp-use-view", version: "2.0.0-alpha.0" },
      { tools: { listChanged: true } },
      { autoResize: bridgeAppOptions?.autoResize ?? true }
    );
    wireAppEvents(appInstance);
  }
  return appInstance;
}

function wireAppEvents(app: App): void {
  // Both tool-input and tool-input-partial clear `cancelled` (a new/continuing
  // call cycle). Result state is cleared on every partial (new stream = new
  // call). On complete tool-input, result state is cleared only when a prior
  // result already exists — that input belongs to a subsequent call; within a
  // single call, tool-input always precedes tool-result so hasToolResult is
  // still false and the mid-cycle pending→ready path is unchanged.
  app.ontoolinput = (params) => {
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
    const meta =
      params._meta !== undefined &&
      typeof params._meta === "object" &&
      params._meta !== null
        ? (params._meta as Record<string, unknown>)
        : undefined;
    const stamped = meta?.[TOOL_NAME_META_KEY];
    setSnapshot({
      toolOutput: params.structuredContent,
      content: Array.isArray(params.content)
        ? (params.content as ContentBlock[])
        : undefined,
      meta,
      hasToolResult: true,
      isStreaming: false,
      cancelled: undefined,
      ...(typeof stamped === "string" && { toolName: stamped }),
    });
  };

  app.ontoolcancelled = (params) => {
    setSnapshot({
      cancelled: {
        ...(params.reason !== undefined && { reason: params.reason }),
      },
      isStreaming: false,
    });
  };

  app.onhostcontextchanged = (params) => {
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

let injectedTransport: ViewBridgeTransport | null = null;

/**
 * Warn-once flag for hosts that omit the `updateModelContext` capability.
 * Owned here so {@link _resetViewBridgeForTesting} clears it with the rest of
 * the bridge singleton.
 */
let warnedModelContextUnsupported = false;

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
    const toolNameFromInfo = hostContext?.toolInfo?.tool?.name;
    setSnapshot({
      isConnected: true,
      ...(hostContext !== undefined && { hostContext }),
      ...(typeof toolNameFromInfo === "string" && {
        toolName: toolNameFromInfo,
      }),
    });
    return app;
  })();

  return connectPromise;
}

/**
 * Module-singleton store backing the view bridge hooks.
 *
 * @internal
 */
export const viewBridgeStore: ViewBridgeStore = {
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

/** @internal Reset bridge state between tests. */
export function _resetViewBridgeForTesting(): void {
  appInstance = null;
  connectPromise = null;
  injectedTransport = null;
  bridgeAppOptions = undefined;
  warnedModelContextUnsupported = false;
  snapshot = { ...defaultSnapshot };
  listeners.clear();
}

/** @internal Guest `App` singleton (bridge tests only). */
export function _getAppForTesting(): App | null {
  return appInstance;
}
