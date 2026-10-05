import type { App } from "@modelcontextprotocol/ext-apps";
import type { ContentBlock } from "@modelcontextprotocol/server";
import {
  buildContextPayload,
  canonicalContext,
  copyContext,
  type ContextAttachment,
  type ContextOperationResult,
  type ContextPayload,
  type ContextPublication,
  type ContextSnapshot,
} from "./model-context.js";

/** Model-visible state owned by one mounted view runtime. */
type ViewState = Record<string, unknown>;

/** Reserved field carrying the serialized {@link ModelContext} tree. */
const UI_CONTEXT_KEY = "_uiContext" as const;

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
  setWidgetState(state: OpenAiWidgetState): void | Promise<void>;
}

interface OpenAiSetGlobalsEvent extends Event {
  detail?: {
    globals?: {
      widgetState?: OpenAiWidgetState | null;
    };
  };
}

interface Attachment extends ContextAttachment {
  generation: number;
}

interface Operation {
  revision: number;
  effects: Map<string, number | null>;
  resolve(result: ContextOperationResult): void;
  reject(error: Error): void;
}

/** Narrow runtime surface used by the shared state/context flush pump. */
interface ModelContextStoreHost {
  /** Connect once, or return the cached in-flight / settled connection promise. */
  connect(): Promise<App>;
}

/** Warn-once flag for hosts that omit the `updateModelContext` capability. */
let warnedModelContextUnsupported = false;

/** Mark that the missing-capability warning has been emitted. */
function markModelContextUnsupportedWarned(): boolean {
  if (warnedModelContextUnsupported) {
    return false;
  }
  warnedModelContextUnsupported = true;
  return true;
}

/** Reset the missing-capability warn-once flag between tests. */
function _resetModelContextForTesting(): void {
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
  #desired: ContextPublication | null = null;
  #revision = 0;
  readonly #attachments = new Map<string, Attachment>();
  readonly #generations = new Map<string, number>();
  readonly #contextListeners = new Set<() => void>();
  readonly #operations = new Set<Operation>();
  #snapshot: ContextSnapshot = { attachments: [], pending: false, error: null };
  /** Last successfully delivered payload. */
  #acknowledged: ContextPublication | null = null;
  #sending: ContextPublication | null = null;
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
    this.#contextListeners.clear();
    this.#removeOpenAiListener?.();
    this.#removeOpenAiListener = null;
    this.#nextOrder = 0;
    this.#viewState = null;
    this.#firstDefaultSerialized = null;
    this.#desired = null;
    this.#acknowledged = null;
    this.#sending = null;
    this.#attachments.clear();
    this.#generations.clear();
    this.#fail(new Error("Model context store has been disposed or reset"));
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

  /** Build one full replacement from all contribution namespaces. */
  buildModelContextParams(): ContextPayload {
    return buildContextPayload(
      this.#viewState,
      this.buildDescriptionString(),
      this.#attachments.values()
    );
  }

  /** Subscribe to shared selection and delivery status. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#contextListeners.add(listener);
    return () => {
      this.#contextListeners.delete(listener);
    };
  };

  /** Cached snapshot suitable for useSyncExternalStore. */
  readonly getSnapshot = (): ContextSnapshot => this.#snapshot;

  /** Upsert one native attachment; callers normalize and negotiate before entry. */
  readonly addAttachment = (
    key: string,
    block: ContentBlock
  ): Promise<ContextOperationResult> => {
    if (this.#disposed)
      return Promise.reject(new Error("Model context store has been disposed"));
    if (!key)
      return Promise.reject(new TypeError("Attachment key must not be empty"));
    const normalized = copyContext(block);
    const fingerprint = canonicalContext(normalized);
    for (const entry of this.#attachments.values()) {
      if (entry.key !== key && canonicalContext(entry.block) === fingerprint) {
        return Promise.reject(
          new Error("An identical attachment already exists under another key")
        );
      }
    }
    const generation = (this.#generations.get(key) ?? 0) + 1;
    this.#generations.set(key, generation);
    this.#attachments.set(key, { key, block: normalized, generation });
    return this.#mutate(new Map([[key, generation]]));
  };

  /** Remove one attachment without changing state or description contributions. */
  readonly removeAttachment = (
    key: string
  ): Promise<ContextOperationResult> => {
    this.#attachments.delete(key);
    return this.#mutate(new Map([[key, null]]));
  };

  /** Clear the explicit attachment namespace only. */
  readonly clearAttachments = (): Promise<ContextOperationResult> => {
    const effects = new Map<string, number | null>();
    for (const key of this.#attachments.keys()) effects.set(key, null);
    this.#attachments.clear();
    return this.#mutate(effects);
  };

  /** Explicitly retry the current desired state, never a saved failed payload. */
  readonly retry = (): Promise<ContextOperationResult> =>
    this.#mutate(
      new Map(
        Array.from(this.#attachments, ([key, entry]) => [key, entry.generation])
      )
    );

  #mutate(
    effects: Map<string, number | null>
  ): Promise<ContextOperationResult> {
    if (this.#disposed)
      return Promise.reject(new Error("Model context store has been disposed"));
    const result = new Promise<ContextOperationResult>((resolve, reject) => {
      this.#operations.add({
        effects,
        resolve,
        reject,
        revision: this.#revision + 1,
      });
    });
    this.#updateDesiredAndSchedule();
    return result;
  }

  #publish(pending: boolean, error: Error | null): void {
    this.#snapshot = {
      attachments: Object.freeze(
        Array.from(this.#attachments.values(), ({ key, block }) =>
          Object.freeze({ key, block })
        )
      ),
      pending,
      error,
    };
    for (const listener of this.#contextListeners) listener();
  }

  #settle(publication?: ContextPublication): void {
    for (const operation of this.#operations) {
      const matches = (entries: ReadonlyMap<string, number>): boolean =>
        [...operation.effects].every(
          ([key, generation]) => (entries.get(key) ?? null) === generation
        );
      if (
        !matches(
          new Map(
            Array.from(this.#attachments, ([key, entry]) => [
              key,
              entry.generation,
            ])
          )
        )
      ) {
        operation.resolve({ status: "superseded" });
      } else if (
        publication &&
        publication.revision >= operation.revision &&
        matches(publication.entries)
      ) {
        operation.resolve({ status: "synced" });
      } else continue;
      this.#operations.delete(operation);
    }
  }

  #fail(error: Error): void {
    for (const operation of this.#operations) operation.reject(error);
    this.#operations.clear();
    this.#publish(false, error);
  }

  /** Clear state between tests without disposing the owning runtime. */
  resetForTesting(): void {
    this.#nodes.clear();
    this.#nextOrder = 0;
    this.#viewState = null;
    this.#firstDefaultSerialized = null;
    this.#flushScheduled = false;
    this.#inFlight = null;
    this.#desired = null;
    this.#acknowledged = null;
    this.#sending = null;
    this.#attachments.clear();
    this.#generations.clear();
    this.#fail(new Error("Model context store has been disposed or reset"));
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
    if (this.#disposed) return;
    const payload = copyContext(this.buildModelContextParams());
    this.#desired = {
      revision: ++this.#revision,
      payload,
      serialized: canonicalContext(payload),
      entries: new Map(
        Array.from(this.#attachments, ([key, entry]) => [key, entry.generation])
      ),
    };
    this.#settle();
    this.#publish(true, null);
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
    if (this.#disposed || this.#inFlight || this.#sending || !this.#desired)
      return;
    const publication = this.#desired;
    if (publication.serialized === this.#acknowledged?.serialized) {
      // Equality proves the payload; use the new local identities for equal upserts.
      this.#settle(publication);
      this.#publish(false, null);
      return;
    }
    this.#publish(true, null);
    const sendEpoch = this.#epoch;
    this.#sending = publication;
    this.#inFlight = Promise.resolve().then(async () => {
      let failed = false;
      try {
        const chatGptApi = getChatGptWidgetApi();
        if (chatGptApi) {
          await chatGptApi.setWidgetState({
            privateContent: {},
            ...chatGptApi.widgetState,
            modelContent: publication.payload.structuredContent ?? {},
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
            failed = true;
            this.#fail(new Error("This host does not support model context"));
            return;
          }
          await app.updateModelContext(
            publication.payload as Parameters<App["updateModelContext"]>[0]
          );
        }
        if (this.#disposed || sendEpoch !== this.#epoch) return;
        this.#acknowledged = publication;
        this.#settle(publication);
      } catch (error: unknown) {
        if (this.#disposed || sendEpoch !== this.#epoch) return;
        failed = true;
        const failure =
          error instanceof Error ? error : new Error(String(error));
        this.#fail(failure);
        console.warn("[mcp-use] Failed to update model context:", error);
      } finally {
        if (!this.#disposed && sendEpoch === this.#epoch) {
          this.#inFlight = null;
          this.#sending = null;
          if (this.#desired !== publication) this.#pump();
          else if (!failed) this.#publish(false, null);
        }
      }
    });
  }
}
