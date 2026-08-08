import type { App } from "@modelcontextprotocol/ext-apps";
import type { ContentBlock } from "@modelcontextprotocol/server";

/** Model-visible state owned by one mounted view runtime. */
export type ViewState = Record<string, unknown>;

/** Reserved field carrying the serialized {@link ModelContext} tree. */
export const UI_CONTEXT_KEY = "_uiContext" as const;

interface ModelContextNode {
  id: string;
  parentId: string | null;
  content: string;
}

interface StoredModelContextNode extends ModelContextNode {
  /** Insertion sequence — preserves registration order across flushes. */
  order: number;
}

interface OpenAiWidgetState {
  modelContent?: ViewState;
  privateContent?: ViewState;
  imageIds?: string[];
  [key: string]: unknown;
}

interface ChatGptWidgetApi {
  widgetState?: OpenAiWidgetState | null;
  setWidgetState(state: OpenAiWidgetState): Promise<void>;
}

interface OpenAiSetGlobalsEvent extends Event {
  detail?: {
    globals?: {
      widgetState?: OpenAiWidgetState | null;
    };
  };
}

/** Complete model-visible snapshot sent on every update. */
export interface ModelContextParams {
  structuredContent: ViewState & { [UI_CONTEXT_KEY]: string };
  content: ContentBlock[];
}

/** Narrow runtime surface used by the shared state/context flush pump. */
export interface ModelContextStoreHost {
  /** Connect once, or return the cached in-flight / settled connection promise. */
  connect(): Promise<App>;
}

/** Warn-once flag for hosts that omit the `updateModelContext` capability. */
let warnedModelContextUnsupported = false;

/** Mark that the missing-capability warning has been emitted. */
export function markModelContextUnsupportedWarned(): boolean {
  if (warnedModelContextUnsupported) {
    return false;
  }
  warnedModelContextUnsupported = true;
  return true;
}

/** Reset the missing-capability warn-once flag between tests. */
export function _resetModelContextForTesting(): void {
  warnedModelContextUnsupported = false;
}

/** Reset the missing-capability warn-once flag between tests. */
export function _resetModelContextUnsupportedWarnedForTesting(): void {
  warnedModelContextUnsupported = false;
}

function getChatGptWidgetApi(): ChatGptWidgetApi | undefined {
  if (typeof window === "undefined") return undefined;
  const api = (window as unknown as { openai?: Partial<ChatGptWidgetApi> })
    .openai;
  return typeof api?.setWidgetState === "function"
    ? (api as ChatGptWidgetApi)
    : undefined;
}

function filterUiContext(state: ViewState): ViewState {
  const { [UI_CONTEXT_KEY]: _, ...viewState } = state;
  return viewState;
}

function assertValidViewState(state: ViewState): string {
  if (state === null || Array.isArray(state) || typeof state !== "object") {
    throw new TypeError("useViewState state must be a plain object");
  }
  if (Object.prototype.hasOwnProperty.call(state, UI_CONTEXT_KEY)) {
    throw new TypeError(
      `useViewState state cannot contain the reserved key "${UI_CONTEXT_KEY}"`
    );
  }

  try {
    const serialized = JSON.stringify(state);
    if (serialized === undefined) {
      throw new TypeError("serialization returned undefined");
    }
    return serialized;
  } catch (error: unknown) {
    const reason = error instanceof Error ? `: ${error.message}` : "";
    throw new TypeError(
      `useViewState state must be JSON-serializable${reason}`
    );
  }
}

/**
 * Per-runtime view-state document, model-context tree, and async flush pump.
 *
 * `useViewState` and `ModelContext` mutate this single owner. Each delivery
 * contains the complete merged snapshot because `ui/update-model-context` has
 * overwrite semantics.
 *
 * @internal
 */
export class ModelContextStore {
  readonly #host: ModelContextStoreHost;
  readonly #nodes = new Map<string, StoredModelContextNode>();
  readonly #viewStateListeners = new Set<() => void>();
  #nextOrder = 0;
  #viewState: ViewState | null = null;
  #firstDefaultSerialized: string | null = null;
  #flushScheduled = false;
  #disposed = false;
  /** Bumped on {@link dispose} so late in-flight completions are ignored. */
  #epoch = 0;
  /** Latest complete payload, or null until state/context is first registered. */
  #desiredSerialized: string | null = null;
  /** Last successfully delivered payload. */
  #acknowledgedSerialized: string | null = null;
  #inFlight: Promise<void> | null = null;
  #removeOpenAiListener: (() => void) | null = null;

  /** Create a store backed by the owning view runtime's host connection. */
  constructor(host: ModelContextStoreHost) {
    this.#host = host;
    this.#hydrateFromChatGpt();
  }

  /** Stable external-store subscription used by `useViewState`. */
  readonly subscribeViewState = (listener: () => void): (() => void) => {
    this.#viewStateListeners.add(listener);
    return () => {
      this.#viewStateListeners.delete(listener);
    };
  };

  /** Current canonical view state, excluding the reserved UI-context field. */
  readonly getViewStateSnapshot = (): ViewState | null => this.#viewState;

  /**
   * Initialize view state from a hook default when ChatGPT restored no state.
   * The first hook default wins; later conflicting defaults warn in development.
   */
  initializeViewState(defaultState: ViewState): void {
    if (this.#disposed) return;
    const serializedDefault = assertValidViewState(defaultState);

    if (this.#firstDefaultSerialized === null) {
      this.#firstDefaultSerialized = serializedDefault;
    } else if (
      this.#firstDefaultSerialized !== serializedDefault &&
      (typeof process === "undefined" || process.env.NODE_ENV !== "production")
    ) {
      console.warn(
        "[useViewState] Multiple components supplied conflicting defaults; " +
          "the first initialized default wins."
      );
    }

    if (this.#viewState === null) {
      this.#viewState = defaultState;
      this.#emitViewState();
      this.#updateDesiredAndSchedule();
      return;
    }

    // A restored ChatGPT value still needs an initial delivery to merge the
    // currently rendered ModelContext tree and preserve the complete snapshot.
    this.#updateDesiredAndSchedule();
  }

  /** Resolve and apply a `useState`-style update synchronously. */
  updateViewState(updater: (previous: ViewState | null) => ViewState): void {
    if (this.#disposed) return;
    const nextState = updater(this.#viewState);
    assertValidViewState(nextState);
    this.#viewState = nextState;
    this.#emitViewState();
    this.#updateDesiredAndSchedule();
  }

  /** Register or replace a model-context node and schedule a merged flush. */
  setNode(node: ModelContextNode): void {
    if (this.#disposed) return;
    const order = this.#nodes.get(node.id)?.order ?? this.#nextOrder++;
    this.#nodes.set(node.id, { ...node, order });
    this.#updateDesiredAndSchedule();
  }

  /** Remove a model-context node and schedule a merged flush. */
  removeNode(id: string): void {
    if (this.#disposed) return;
    if (!this.#nodes.delete(id)) return;
    this.#updateDesiredAndSchedule();
  }

  /** Remove every model-context node. */
  clear(): void {
    if (this.#disposed || this.#nodes.size === 0) return;
    this.#nodes.clear();
    this.#updateDesiredAndSchedule();
  }

  /** Invalidate the store and ignore late in-flight completions. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#epoch += 1;
    this.#flushScheduled = false;
    this.#inFlight = null;
    this.#nodes.clear();
    this.#viewStateListeners.clear();
    this.#removeOpenAiListener?.();
    this.#removeOpenAiListener = null;
    this.#nextOrder = 0;
    this.#viewState = null;
    this.#firstDefaultSerialized = null;
    this.#desiredSerialized = null;
    this.#acknowledgedSerialized = null;
  }

  /** Serialize registered context nodes into an indented markdown list. */
  buildDescriptionString(): string {
    const byParent = new Map<string | null, StoredModelContextNode[]>();

    for (const node of this.#nodes.values()) {
      const key = node.parentId ?? null;
      const list = byParent.get(key);
      if (list) {
        list.push(node);
      } else {
        byParent.set(key, [node]);
      }
    }

    for (const list of byParent.values()) {
      list.sort((a, b) => a.order - b.order);
    }

    const lines: string[] = [];
    const traverseTree = (parentId: string | null, depth: number): void => {
      const children = byParent.get(parentId);
      if (!children) return;
      for (const child of children) {
        if (child.content.trim()) {
          lines.push(`${"  ".repeat(depth)}- ${child.content.trim()}`);
        }
        traverseTree(child.id, depth + 1);
      }
    };

    traverseTree(null, 0);
    return lines.join("\n");
  }

  /** Build the complete merged payload sent through either host transport. */
  buildModelContextParams(): ModelContextParams {
    const structuredContent = {
      ...(this.#viewState ?? {}),
      [UI_CONTEXT_KEY]: this.buildDescriptionString(),
    };
    return {
      structuredContent,
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    };
  }

  /** Clear state between tests without disposing the owning runtime. */
  resetForTesting(): void {
    this.#nodes.clear();
    this.#nextOrder = 0;
    this.#viewState = null;
    this.#firstDefaultSerialized = null;
    this.#flushScheduled = false;
    this.#inFlight = null;
    this.#desiredSerialized = null;
    this.#acknowledgedSerialized = null;
    // Keep #disposed / #epoch — a disposed store stays disposed.
  }

  /** Internal serialized tree for tests. */
  getDescriptionForTesting(): string {
    return this.buildDescriptionString();
  }

  #emitViewState(): void {
    for (const listener of this.#viewStateListeners) {
      listener();
    }
  }

  #hydrateFromChatGpt(): void {
    const api = getChatGptWidgetApi();
    if (!api) return;

    const applyWidgetState = (
      widgetState: OpenAiWidgetState | null | undefined,
      scheduleMergedWrite: boolean
    ) => {
      const modelContent = widgetState?.modelContent;
      if (
        modelContent === null ||
        Array.isArray(modelContent) ||
        typeof modelContent !== "object"
      ) {
        return;
      }
      const nextViewState = filterUiContext(modelContent);
      try {
        assertValidViewState(nextViewState);
      } catch {
        return;
      }
      this.#viewState = nextViewState;
      this.#emitViewState();
      if (scheduleMergedWrite) {
        this.#updateDesiredAndSchedule();
      }
    };

    applyWidgetState(api.widgetState, false);

    const handleSetGlobals = (event: Event): void => {
      if (this.#disposed) return;
      const widgetState = (event as OpenAiSetGlobalsEvent).detail?.globals
        ?.widgetState;
      if (widgetState !== undefined) {
        applyWidgetState(widgetState, true);
      }
    };
    window.addEventListener("openai:set_globals", handleSetGlobals);
    this.#removeOpenAiListener = () => {
      window.removeEventListener("openai:set_globals", handleSetGlobals);
    };
  }

  #updateDesiredAndSchedule(): void {
    this.#desiredSerialized = JSON.stringify(this.buildModelContextParams());
    this.#schedulePump();
  }

  #schedulePump(): void {
    if (this.#disposed || this.#flushScheduled) return;
    this.#flushScheduled = true;
    queueMicrotask(() => {
      this.#flushScheduled = false;
      this.#pump();
    });
  }

  #pump(): void {
    if (this.#disposed || this.#inFlight) return;
    if (
      this.#desiredSerialized === null ||
      this.#desiredSerialized === this.#acknowledgedSerialized
    ) {
      return;
    }

    const params = this.buildModelContextParams();
    const serialized = JSON.stringify(params);
    this.#desiredSerialized = serialized;
    if (serialized === this.#acknowledgedSerialized) return;

    const sendEpoch = this.#epoch;

    this.#inFlight = (async () => {
      try {
        const chatGptApi = getChatGptWidgetApi();
        if (chatGptApi) {
          await chatGptApi.setWidgetState({
            privateContent: {},
            ...chatGptApi.widgetState,
            modelContent: params.structuredContent,
          });
        } else {
          const app = await this.#host.connect();
          if (this.#disposed || sendEpoch !== this.#epoch) return;

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
        }

        if (this.#disposed || sendEpoch !== this.#epoch) return;
        this.#acknowledgedSerialized = serialized;
      } catch (error: unknown) {
        if (this.#disposed || sendEpoch !== this.#epoch) return;
        console.warn("[mcp-use] Failed to update model context:", error);
      } finally {
        this.#inFlight = null;
        if (
          !this.#disposed &&
          sendEpoch === this.#epoch &&
          this.#desiredSerialized !== serialized
        ) {
          this.#pump();
        }
      }
    })();
  }
}
