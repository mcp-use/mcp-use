import type { App } from "@modelcontextprotocol/ext-apps";
import type { ModelContextBlock } from "../types/model-context.js";
import {
  assertContextSupport,
  contextUpdateId,
  MODEL_CONTEXT_EXTENSION,
  normalizeContextInput,
  presentContextBlock,
  readContextObservation,
  type ContextObservation,
} from "./model-context-wire.js";
import { fetchContextImage } from "./model-context-image.js";
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

interface ImagePreparation {
  controller: AbortController;
  cancel(error?: Error): void;
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

function isGeneratedProjection(
  block: ContentBlock,
  state: ViewState | undefined
): boolean {
  if (!state || typeof state[UI_CONTEXT_KEY] !== "string") return false;
  const text = { type: "text", text: JSON.stringify(state) };
  return (
    canonicalContext(block) === canonicalContext(text) ||
    canonicalContext(block) ===
      canonicalContext({ ...text, annotations: { audience: ["assistant"] } })
  );
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

// The development entrypoint opts in to bounded diagnostics. Production views
// do not initialize this trace or retain protocol events.
function getContextDiagnosticTrace() {
  if (typeof window === "undefined") return undefined;
  return (
    window as unknown as {
      __mcpContextTrace?: { events: unknown[]; sequence: number };
    }
  ).__mcpContextTrace;
}
function contextDebugPayload(payload: ContextPayload | undefined) {
  if (!payload || !getContextDiagnosticTrace()) return null;
  return {
    content: payload.content.map((block) => ({
      type: block.type,
    })),
    structured: payload.structuredContent !== undefined,
  };
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
  #rich = false;
  #activationBarrier: Promise<void> | null = null;
  #activationError: Error | null = null;
  #legacyWidgetDispatched = false;
  #legacyNativeAcknowledged = false;
  #legacyFailure: Error | null = null;
  #legacyStateIntent: ViewState | null = null;
  #deliveryError: Error | null = null;
  #backgroundAssistantOnly = false;
  #app: App | null = null;
  #preparing: Promise<App> | null = null;
  #cancelInitialization!: (reason: Error) => void;
  readonly #disposal = new Promise<never>((_, reject) => {
    this.#cancelInitialization = reject;
  });
  #initialized = false;
  #queued = 0;
  readonly #images = new Map<string, ImagePreparation>();
  #defaultState: ViewState | null = null;
  #earlyStateUpdates: Array<(previous: ViewState | null) => ViewState> = [];
  #restoredBackground: ContentBlock[] = [];
  #restoredStructured: ViewState | undefined;
  #backgroundSuppressed = false;
  #blocked: Error | null = null;
  #openai = false;
  #observations: Array<ContextObservation | null> = [];
  #history = new Map<string, ContextPublication>();
  #hostBaseline: ContextPublication | null = null;
  readonly #nodes = new Map<string, StoredModelContextNode>();
  readonly #viewStateListeners = new Set<() => void>();
  #nextOrder = 0;
  #viewState: ViewState | null = null;
  #firstDefaultSerialized: string | null = null;
  #flushScheduled = false;
  #disposed = false;
  /** Bumped on disposal or test reset so late in-flight completions are ignored. */
  #epoch = 0;
  /** Latest complete payload, or null until state/context is first registered. */
  #desired: ContextPublication | null = null;
  #revision = 0;
  readonly #attachments = new Map<string, Attachment>();
  // Unique across keys and removals, without retaining historical key strings.
  #nextGeneration = 0;
  readonly #contextListeners = new Set<() => void>();
  readonly #operations = new Set<Operation>();
  #snapshot: ContextSnapshot = { attachments: [], pending: false, error: null };
  /** Last successfully delivered payload. */
  #acknowledged: ContextPublication | null = null;
  #sending: ContextPublication | null = null;
  #inFlight: Promise<void> | null = null;
  #removeOpenAiListener: (() => void) | null = null;

  /** Record a bounded local trace without retaining attachment contents. */
  #trace(event: string, detail: Record<string, unknown> = {}): void {
    const trace = getContextDiagnosticTrace();
    if (!trace) return;
    trace.events.push({
      seq: ++trace.sequence,
      ms: Math.round(performance.now()),
      event,
      queued: this.#queued,
      selected: this.#attachments.size,
      sending: this.#sending?.revision ?? null,
      desired: this.#desired?.revision ?? null,
      acknowledged: contextDebugPayload(this.#acknowledged?.payload),
      ...detail,
    });
    if (trace.events.length > 80) trace.events.shift();
  }

  /** Create a store backed by the owning view runtime's connection boundary. */
  constructor(host: ModelContextStoreHost) {
    this.#host = host;
    this.#trace("constructed");
    void this.#disposal.catch(() => {});
    this.#hydrateFromChatGpt();
  }

  /** Reserve native delivery synchronously, without network or listener effects. */
  readonly activateAttachments = (): void => {
    if (this.#rich || this.#disposed) return;
    this.#rich = true;
    this.#activationBarrier = this.#inFlight;
    this.#desired = null;
    const widgetState = getChatGptWidgetApi()?.widgetState;
    const persistedModel = widgetState?.modelContent;
    if (
      this.#legacyWidgetDispatched ||
      (persistedModel !== undefined &&
        persistedModel !== null &&
        (typeof persistedModel !== "object" ||
          Object.keys(persistedModel).length > 0)) ||
      widgetState?.imageIds?.length
    ) {
      this.#activationError = new Error(
        "Cannot activate native model context alongside existing model-visible widget state. Use a view without persisted modelContent/imageIds; the SDK will not clear them automatically."
      );
    }
  };

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

    if (this.#rich && !this.#initialized) {
      this.#defaultState ??= copyContext(defaultState);
      this.#publish(true, null);
      void this.prepare().catch(() => {});
      return;
    }
    if (this.#rich && (this.#viewState !== null || this.#backgroundSuppressed))
      return;
    if (this.#viewState === null) {
      if (this.#rich && this.#app)
        assertContextSupport(
          this.#app,
          this.buildModelContextParams(defaultState)
        );
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
    if (this.#rich && !this.#initialized) {
      this.#earlyStateUpdates.push(updater);
      this.#publish(true, null);
      void this.prepare().catch(() => {});
      return;
    }
    const nextState = updater(this.#viewState);
    assertValidViewState(nextState);
    if (!this.#rich) this.#legacyStateIntent = copyContext(nextState);
    if (this.#rich && this.#app)
      assertContextSupport(
        this.#app,
        this.buildModelContextParams(
          nextState,
          this.buildDescriptionString(),
          true
        )
      );
    this.#viewState = nextState;
    this.#backgroundSuppressed = false;
    this.#emitViewState();
    this.#updateDesiredAndSchedule();
  }

  /** Register or replace a model-context node and schedule a merged flush. */
  setNode(node: ModelContextNode): void {
    if (this.#disposed) return;
    const previous = this.#nodes.get(node.id);
    if (
      previous?.content === node.content &&
      previous.parentId === node.parentId
    )
      return;
    if (previous && previous.content !== node.content)
      this.#backgroundSuppressed = false;
    const order = previous?.order ?? this.#nextOrder++;
    this.#nodes.set(node.id, { ...node, order });
    if (this.#rich && this.#app) {
      try {
        assertContextSupport(this.#app, this.buildModelContextParams());
      } catch (error) {
        if (previous) this.#nodes.set(node.id, previous);
        else this.#nodes.delete(node.id);
        throw error;
      }
    }
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
    this.#cancelInitialization(
      new Error("Model context store has been disposed")
    );
    this.#epoch += 1;
    this.#flushScheduled = false;
    this.#inFlight = null;
    this.#nodes.clear();
    this.#earlyStateUpdates = [];
    this.#restoredBackground = [];
    this.#restoredStructured = undefined;
    this.#history.clear();
    this.#observations = [];
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
  buildModelContextParams(
    state = this.#viewState,
    description = this.buildDescriptionString(),
    includeBackground = !this.#backgroundSuppressed
  ): ContextPayload {
    if (!this.#rich)
      return buildContextPayload(
        state,
        description,
        this.#attachments.values()
      );
    const hasGenerated = state !== null || description.length > 0;
    if (this.#restoredStructured && state) {
      for (const [key, value] of Object.entries(state)) {
        if (
          Object.hasOwn(this.#restoredStructured, key) &&
          canonicalContext(this.#restoredStructured[key]) !==
            canonicalContext(value)
        )
          throw new Error("View state conflicts with restored model context");
      }
    }
    const background =
      hasGenerated && includeBackground
        ? buildContextPayload(
            { ...this.#restoredStructured, ...state },
            description,
            [],
            this.#backgroundAssistantOnly
          )
        : { content: [] as ContentBlock[] };
    return {
      ...(this.#restoredStructured !== undefined && {
        structuredContent: this.#restoredStructured,
      }),
      ...background,
      content: [
        ...background.content,
        ...this.#restoredBackground,
        ...Array.from(this.#attachments.values(), ({ block }) => block),
      ],
    };
  }

  /** Initialize attachment mode behind the runtime's shared connection barrier. */
  readonly prepare = (): Promise<App> => {
    this.activateAttachments();
    if (this.#disposed)
      return Promise.reject(new Error("Model context store has been disposed"));
    this.#removeOpenAiListener?.();
    this.#removeOpenAiListener = null;
    this.#preparing ??= Promise.race([
      (async () => {
        await this.#activationBarrier;
        if (this.#activationError) throw this.#activationError;
        if (this.#legacyFailure) throw this.#legacyFailure;
        if (this.#disposed)
          throw new Error("Model context store has been disposed");
        return this.#host.connect();
      })(),
      this.#disposal,
    ])
      .then((app) => {
        if (this.#disposed)
          throw new Error("Model context store has been disposed");
        this.#app = app;
        this.#openai =
          app.getHostCapabilities()?.experimental?.[MODEL_CONTEXT_EXTENSION] !==
          undefined;
        const host = app.getHostContext() as
          | Record<string, unknown>
          | undefined;
        const hasReadback =
          this.#openai && host && Object.hasOwn(host, MODEL_CONTEXT_EXTENSION);
        const observation = hasReadback
          ? readContextObservation(host[MODEL_CONTEXT_EXTENSION])
          : undefined;
        if (
          this.#openai &&
          this.#legacyNativeAcknowledged &&
          (!observation ||
            !observation.contentProvided ||
            canonicalContext(observation.payload) !==
              this.#acknowledged?.serialized)
        ) {
          throw new Error(
            "Cannot activate native context from cached host state that differs from the acknowledged legacy write. Initialize a fresh view after outstanding writes finish."
          );
        }
        if (observation !== undefined) this.#restore(observation);
        this.#initialized = true;
        let changed = !hasReadback && this.#viewState !== null;
        if (
          !hasReadback &&
          this.#viewState === null &&
          this.#defaultState !== null
        ) {
          assertContextSupport(
            app,
            this.buildModelContextParams(this.#defaultState)
          );
          this.#viewState = this.#defaultState;
          changed = true;
        }
        if (this.#legacyStateIntent !== null) {
          const intent = this.#legacyStateIntent;
          this.#earlyStateUpdates.unshift(() => intent);
          this.#legacyStateIntent = null;
        }
        for (const updater of this.#earlyStateUpdates) {
          const next = updater(this.#viewState);
          assertValidViewState(next);
          assertContextSupport(
            app,
            this.buildModelContextParams(
              next,
              this.buildDescriptionString(),
              true
            )
          );
          this.#viewState = next;
          this.#backgroundSuppressed = false;
          changed = true;
        }
        this.#earlyStateUpdates = [];
        this.#emitViewState();
        if (changed || (this.#nodes.size > 0 && !this.#backgroundSuppressed))
          this.#updateDesiredAndSchedule();
        else {
          this.#desired = null;
          this.#publish(this.#queued > 0, null);
        }
        return app;
      })
      .catch((error: unknown) => {
        const failure =
          error instanceof Error ? error : new Error(String(error));
        if (!this.#disposed) {
          this.#blocked = failure;
          this.#fail(failure);
        }
        throw failure;
      });
    return this.#preparing;
  };

  /** Queue an ergonomic attachment intent, then validate before committing it. */
  readonly add = (
    key: string,
    input: ModelContextBlock
  ): Promise<ContextOperationResult> => {
    let normalized: ReturnType<typeof normalizeContextInput>;
    try {
      if (!key || key.startsWith("@restored:"))
        throw new TypeError(
          "Attachment key is empty or uses the reserved @restored: namespace"
        );
      normalized = normalizeContextInput(input);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.#disposed)
      return Promise.reject(new Error("Model context store has been disposed"));
    this.#images.get(key)?.cancel();
    const commit = (block: ContentBlock) => {
      const payload = this.buildModelContextParams();
      const existing = this.#attachments.get(key)?.block;
      if (existing)
        payload.content = payload.content.filter((item) => item !== existing);
      payload.content.push(block);
      assertContextSupport(this.#app!, payload);
      return this.addAttachment(key, block);
    };
    if (normalized.source === undefined)
      return this.#enqueue(() => commit(normalized.block));

    const controller = new AbortController();
    let cancel!: ImagePreparation["cancel"];
    const cancelled = new Promise<ContextOperationResult>((resolve, reject) => {
      cancel = (error) => {
        if (this.#images.get(key) !== preparation) return;
        this.#images.delete(key);
        controller.abort();
        if (error) reject(error);
        else resolve({ status: "superseded" });
      };
    });
    const preparation = { controller, cancel };
    this.#images.set(key, preparation);
    this.#publish(true, this.#snapshot.error);
    const work = this.prepare().then(async () => {
      if (this.#images.get(key) !== preparation)
        return { status: "superseded" as const };
      if (this.#blocked) throw this.#blocked;
      // Negotiate before fetching, then validate the complete current payload again at commit.
      assertContextSupport(this.#app!, { content: [normalized.block] });
      const bytes = await fetchContextImage(
        normalized.source!,
        controller.signal
      );
      if (this.#images.get(key) !== preparation)
        return { status: "superseded" as const };
      return this.#enqueue(() => {
        if (this.#images.get(key) !== preparation)
          return Promise.resolve({ status: "superseded" });
        this.#images.delete(key);
        return commit(copyContext({ ...normalized.block, ...bytes }));
      });
    });
    return Promise.race([work, cancelled]).finally(() => {
      if (this.#images.get(key) === preparation) this.#images.delete(key);
      if (!this.#disposed)
        this.#publish(
          this.#queued > 0 || !!this.#inFlight || this.#flushScheduled,
          this.#snapshot.error
        );
    });
  };

  /** Queue removal of one key; attachment-hook lifetime does not own that key. */
  readonly remove = (key: string): Promise<ContextOperationResult> => {
    this.#trace("remove");
    this.#images.get(key)?.cancel();
    return this.#enqueue(() => {
      const payload = this.buildModelContextParams();
      const block = this.#attachments.get(key)?.block;
      payload.content = payload.content.filter((item) => item !== block);
      assertContextSupport(this.#app!, payload);
      return this.removeAttachment(key);
    });
  };

  /** Clear selected and preparing attachments, preserving background. */
  readonly clearSelection = (): Promise<ContextOperationResult> => {
    this.#trace("clear");
    for (const image of this.#images.values()) image.cancel();
    return this.#enqueue(() => {
      const blocks = new Set(
        Array.from(this.#attachments.values(), (entry) => entry.block)
      );
      const payload = this.buildModelContextParams();
      payload.content = payload.content.filter((block) => !blocks.has(block));
      assertContextSupport(this.#app!, payload);
      return this.clearAttachments();
    });
  };

  #enqueue(
    action: () => Promise<ContextOperationResult>
  ): Promise<ContextOperationResult> {
    this.activateAttachments();
    if (this.#disposed)
      return Promise.reject(new Error("Model context store has been disposed"));
    this.#queued++;
    this.#publish(true, this.#snapshot.error);
    return this.prepare()
      .then(() => {
        if (this.#disposed)
          throw new Error("Model context store has been disposed");
        if (this.#blocked) throw this.#blocked;
        return action();
      })
      .finally(() => {
        this.#queued--;
        if (!this.#disposed)
          this.#publish(
            this.#queued > 0 || !!this.#inFlight || this.#flushScheduled,
            this.#snapshot.error
          );
        if (
          !this.#queued &&
          !this.#blocked &&
          !this.#deliveryError &&
          this.#desired
        )
          this.#schedulePump();
      });
  }

  /** Consume only the model-context field of raw runtime host notifications. */
  receiveHostContext(params: Record<string, unknown>): void {
    if (
      !this.#rich ||
      !this.#initialized ||
      !this.#openai ||
      this.#disposed ||
      this.#blocked ||
      !Object.hasOwn(params, MODEL_CONTEXT_EXTENSION)
    )
      return;
    try {
      const observation = readContextObservation(
        params[MODEL_CONTEXT_EXTENSION]
      );
      this.#trace("host-notification", {
        updateId: observation?.updateId ?? null,
        contentProvided: observation?.contentProvided ?? false,
        payload: contextDebugPayload(observation?.payload),
      });
      if (this.#sending) {
        if (this.#observations.length >= 32)
          throw new Error(
            "Too many model context observations during a write; publication paused"
          );
        this.#observations.push(observation);
      } else
        this.#reconcile(observation, observation === null && this.#queued > 0);
    } catch (error) {
      this.#block(error);
    }
  }

  #block(error: unknown): void {
    this.#trace("blocked");
    this.#blocked = error instanceof Error ? error : new Error(String(error));
    this.#fail(this.#blocked);
  }

  #restore(observation: ContextObservation | null): void {
    this.#trace("restore", {
      updateId: observation?.updateId ?? null,
      payload: contextDebugPayload(observation?.payload),
    });
    this.#backgroundSuppressed = observation === null;
    if (observation === null) {
      this.#hostBaseline = {
        revision: this.#revision,
        payload: { content: [] },
        serialized: canonicalContext({ content: [] }),
        entries: new Map(),
      };
      this.#acknowledged = this.#hostBaseline;
      return;
    }
    const structured = observation.payload.structuredContent;
    const framework =
      structured && typeof structured[UI_CONTEXT_KEY] === "string";
    if (framework) this.#viewState = copyContext(filterUiContext(structured));
    else this.#restoredStructured = structured;
    let index = 0;
    for (const block of observation.payload.content) {
      const generated = framework && isGeneratedProjection(block, structured);
      if (generated)
        this.#backgroundAssistantOnly =
          block.annotations?.audience?.[0] === "assistant";
      if (
        generated ||
        (block.annotations?.audience?.length === 1 &&
          block.annotations.audience[0] === "assistant")
      ) {
        // Keep the exact restored projection until live state/descriptions replace it.
        this.#restoredBackground.push(block);
      } else {
        const key = `@restored:${index++}`;
        const generation = ++this.#nextGeneration;
        this.#attachments.set(key, { key, generation, block });
      }
    }
    // A recognized generated projection will be regenerated from state; opaque
    // background survives separately. Do not infer a mapping from titles or URIs.
    if (framework) {
      this.#restoredBackground = this.#restoredBackground.filter(
        (block) => !isGeneratedProjection(block, structured)
      );
    }
    this.#hostBaseline = {
      revision: this.#revision,
      payload: observation.payload,
      serialized: canonicalContext(observation.payload),
      entries: new Map(
        Array.from(this.#attachments, ([key, entry]) => [key, entry.generation])
      ),
    };
    this.#history.set(observation.updateId, this.#hostBaseline);
    this.#acknowledged = this.#hostBaseline;
  }

  #reconcile(
    observation: ContextObservation | null,
    duringWrite: boolean,
    preceding?: ContextPublication | null
  ): void {
    if (this.#blocked) return;
    this.#trace("reconcile", {
      duringWrite,
      updateId: observation?.updateId ?? null,
      knownUpdate: observation
        ? this.#history.has(observation.updateId)
        : false,
      payload: contextDebugPayload(observation?.payload),
      preceding: contextDebugPayload(preceding?.payload),
    });
    if (
      observation === null &&
      this.#acknowledged === this.#hostBaseline &&
      this.#acknowledged?.payload.content.length === 0 &&
      this.#acknowledged.payload.structuredContent === undefined
    ) {
      this.#trace("accepted-empty-readback");
      // Empty readback has no updateId. It agrees with an acknowledged empty
      // publication regardless of ordering, so there is no removed evidence
      // to resurrect. A clear racing a nonempty write still needs reconciliation.
      return;
    }
    if (observation && this.#history.has(observation.updateId)) {
      const sent = this.#history.get(observation.updateId)!;
      if (
        (observation.contentProvided &&
          canonicalContext(sent.payload.content) !==
            canonicalContext(observation.payload.content)) ||
        (observation.structuredProvided &&
          canonicalContext(sent.payload.structuredContent) !==
            canonicalContext(observation.payload.structuredContent))
      )
        this.#block(
          new Error(
            "Host changed the payload for a known model context revision"
          )
        );
      return; // A correlated echo never lifts suppression or re-adds entries.
    }
    if (observation && !observation.contentProvided) {
      this.#block(
        new Error(
          "Cannot reconcile a model context revision without its content"
        )
      );
      return;
    }
    if (
      observation &&
      this.#acknowledged === this.#hostBaseline &&
      canonicalContext(observation.payload) === this.#acknowledged?.serialized
    ) {
      // A successful RPC may omit response correlation metadata. Full readback
      // equal to that acknowledged payload establishes the same state without
      // inferring an order between revision IDs. Differing readback stays guarded.
      this.#remember(observation.updateId, this.#acknowledged);
      this.#trace("accepted-equal-readback");
      return;
    }
    const candidates = [
      this.#hostBaseline,
      ...(duringWrite ? [preceding, this.#acknowledged] : []),
    ].filter((item): item is ContextPublication => !!item);
    if (!candidates.length) {
      this.#block(
        new Error("Cannot reconcile model context without a published baseline")
      );
      return;
    }
    const removals: Set<string>[] = [];
    for (const candidate of candidates) {
      const remaining = new Map<string, number>();
      for (const block of observation?.payload.content ?? []) {
        const value = canonicalContext(block);
        remaining.set(value, (remaining.get(value) ?? 0) + 1);
      }
      const original = new Map<string, number>();
      for (const block of candidate.payload.content) {
        const value = canonicalContext(block);
        original.set(value, (original.get(value) ?? 0) + 1);
      }
      if (
        observation &&
        canonicalContext(observation.payload.structuredContent) !==
          canonicalContext(candidate.payload.structuredContent)
      ) {
        this.#block(
          new Error("Host changed structured model context; publication paused")
        );
        return;
      }
      for (const [value, count] of remaining)
        if (count > (original.get(value) ?? 0)) {
          this.#block(
            new Error("Host added or changed model context; publication paused")
          );
          return;
        }
      for (const [value, count] of original) {
        const retained = remaining.get(value) ?? 0;
        if (count > 1 && retained > 0 && retained < count) {
          this.#block(
            new Error("Ambiguous duplicate context removal; publication paused")
          );
          return;
        }
      }
      const removed = new Set<string>();
      for (const [key, generation] of candidate.entries) {
        const entry = this.#attachments.get(key);
        if (!entry || entry.generation !== generation) continue;
        const value = canonicalContext(entry.block);
        const count = remaining.get(value) ?? 0;
        if (count === 0) removed.add(`${key}\0${generation}`);
        else if (count !== original.get(value)) {
          this.#block(
            new Error(
              "Ambiguous duplicate attachment removal; publication paused"
            )
          );
          return;
        }
      }
      removals.push(removed);
    }
    const hadQueuedWork = this.#desired !== null && this.#snapshot.pending;
    const first = removals[0]!;
    const agree = removals.every(
      (set) =>
        set.size === first.size && [...set].every((value) => first.has(value))
    );
    // Suppress only removals agreed by every plausible published snapshot.
    for (const identity of first)
      if (removals.every((set) => set.has(identity))) {
        const separator = identity.lastIndexOf("\0");
        const key = identity.slice(0, separator);
        this.#attachments.delete(key);
        this.#images.get(key)?.cancel();
      }
    const survivingBlocks = new Set(
      (observation?.payload.content ?? []).map(canonicalContext)
    );
    this.#restoredBackground = this.#restoredBackground.filter((block) =>
      survivingBlocks.has(canonicalContext(block))
    );
    const generated = candidates[0]!.payload.content.filter(
      (block) =>
        isGeneratedProjection(
          block,
          candidates[0]!.payload.structuredContent
        ) ||
        (block.type === "text" &&
          block.annotations?.audience?.length === 1 &&
          block.annotations.audience[0] === "assistant")
    );
    if (
      generated.some((block) => !survivingBlocks.has(canonicalContext(block)))
    )
      this.#backgroundSuppressed = true;
    this.#settle();
    this.#acknowledged = null; // A prior local success no longer proves host equality.
    this.#desired = null;
    if (observation === null) {
      for (const image of this.#images.values()) image.cancel();
      this.#backgroundSuppressed = true;
      this.#restoredBackground = [];
      this.#restoredStructured = undefined;
    }
    if (!agree || duringWrite) {
      this.#block(
        new Error(
          "Model context changed during a write; ordering is unresolved. Reopen the view after outstanding writes finish."
        )
      );
      return;
    }
    const payload = observation?.payload ?? { content: [] };
    this.#hostBaseline = {
      revision: this.#revision,
      payload,
      serialized: canonicalContext(payload),
      entries: new Map(
        Array.from(candidates[0]!.entries).filter(
          ([key, generation]) =>
            this.#attachments.get(key)?.generation === generation
        )
      ),
    };
    this.#acknowledged = this.#hostBaseline;
    if (observation) this.#remember(observation.updateId, this.#hostBaseline);
    if (hadQueuedWork) this.#updateDesiredAndSchedule();
    else this.#publish(false, this.#deliveryError);
  }

  #remember(id: string, publication: ContextPublication): void {
    this.#history.set(id, publication);
    if (this.#history.size > 32)
      this.#history.delete(this.#history.keys().next().value!);
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
    const generation = ++this.#nextGeneration;
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
    this.#deliveryError = null;
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
          Object.freeze({
            key,
            block: this.#rich ? presentContextBlock(block) : block,
          })
        )
      ),
      pending: (pending || this.#images.size > 0) && !this.#blocked,
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

  #fail(error: Error, throughRevision = Infinity): void {
    for (const image of this.#images.values()) image.cancel(error);
    for (const operation of this.#operations) {
      if (operation.revision > throughRevision) continue;
      operation.reject(error);
      this.#operations.delete(operation);
    }
    this.#publish(false, error);
  }

  /** Clear state between tests without disposing the owning runtime. */
  resetForTesting(): void {
    this.#epoch += 1;
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
    this.#fail(new Error("Model context store has been disposed or reset"));
    // Keep #disposed — a disposed store stays disposed.
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
      if (this.#disposed || this.#rich) return;
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
    if (this.#rich && !this.#initialized) {
      this.#publish(true, null);
      void this.prepare().catch(() => {});
      return;
    }
    if (this.#blocked) {
      this.#fail(this.#blocked);
      return;
    }
    if (this.#rich && this.#deliveryError) {
      this.#publish(false, this.#deliveryError);
      return;
    }
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
    if (
      this.#disposed ||
      (this.#rich && !this.#initialized) ||
      (this.#rich && this.#queued > 0 && this.#operations.size === 0) ||
      this.#inFlight ||
      this.#sending ||
      this.#blocked ||
      !this.#desired
    )
      return;
    const publication = this.#desired;
    if (publication.serialized === this.#acknowledged?.serialized) {
      // Equality proves the payload; use the new local identities for equal upserts.
      this.#acknowledged = publication;
      if (this.#rich) this.#hostBaseline = publication;
      this.#settle(publication);
      this.#publish(this.#queued > 0, null);
      return;
    }
    const preceding = this.#hostBaseline;
    const rich = this.#rich;
    const chatGptApi = rich ? undefined : getChatGptWidgetApi();
    this.#publish(true, null);
    const sendEpoch = this.#epoch;
    this.#sending = publication;
    this.#inFlight = Promise.resolve().then(async () => {
      if (this.#disposed || sendEpoch !== this.#epoch) return;
      let failed = false;
      let dispatched = false;
      try {
        if (!rich && this.#rich) return; // Activation canceled a deferred legacy send.
        if (chatGptApi) {
          this.#legacyWidgetDispatched = true;
          dispatched = true;
          await chatGptApi.setWidgetState({
            privateContent: {},
            ...chatGptApi.widgetState,
            modelContent: publication.payload.structuredContent ?? {},
          });
        } else {
          const app = await this.#host.connect();
          if (this.#disposed || sendEpoch !== this.#epoch) return;
          if (!rich && this.#rich) return;
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
          if (rich) assertContextSupport(app, publication.payload);
          dispatched = true;
          this.#trace("write", {
            revision: publication.revision,
            payload: contextDebugPayload(publication.payload),
          });
          const result = await app.updateModelContext(
            publication.payload as Parameters<App["updateModelContext"]>[0]
          );
          if (this.#disposed || sendEpoch !== this.#epoch) return;
          if (!rich) this.#legacyNativeAcknowledged = true;
          if (rich && this.#openai) {
            const updateId = contextUpdateId(result);
            const extension = result._meta?.[MODEL_CONTEXT_EXTENSION];
            const rawId =
              extension && typeof extension === "object"
                ? (extension as { updateId?: unknown }).updateId
                : undefined;
            this.#trace("ack", {
              updateId: updateId ?? null,
              revision: publication.revision,
              metaPresent: result._meta !== undefined,
              extensionType: extension === null ? "null" : typeof extension,
              updateIdType: rawId === null ? "null" : typeof rawId,
              updateIdNonempty: typeof rawId === "string" && rawId.length > 0,
            });
            if (updateId) this.#remember(updateId, publication);
          }
        }
        if (this.#disposed || sendEpoch !== this.#epoch) return;
        this.#acknowledged = publication;
        if (
          !rich &&
          this.#legacyStateIntent !== null &&
          canonicalContext(this.#legacyStateIntent) ===
            canonicalContext(
              filterUiContext(publication.payload.structuredContent ?? {})
            )
        ) {
          this.#legacyStateIntent = null;
        }
        if (rich) {
          this.#hostBaseline = publication;
          const observations = this.#observations.splice(0);
          for (const observation of observations)
            this.#reconcile(observation, true, preceding);
        }
        if (!this.#blocked) this.#settle(publication);
      } catch (error: unknown) {
        if (this.#disposed || sendEpoch !== this.#epoch) return;
        failed = true;
        const failure =
          error instanceof Error ? error : new Error(String(error));
        if (rich) {
          // A rejected write can still race a user removal. Reconcile buffered
          // observations before another mutation can publish.
          for (const observation of this.#observations.splice(0)) {
            this.#reconcile(observation, true, preceding);
          }
        }
        const rejectedByHost =
          failure.name === "ProtocolError" &&
          typeof (failure as Error & { code?: unknown }).code === "number";
        if (!rich && dispatched && !rejectedByHost) {
          this.#legacyFailure = new Error(
            `Cannot activate native context after an uncertain legacy write: ${failure.message}`
          );
        }
        if (rich) this.#deliveryError = failure;
        if (this.#blocked) this.#fail(this.#blocked);
        else if (rich && dispatched && !rejectedByHost) {
          this.#block(
            new Error(
              `Model context publication outcome is uncertain: ${failure.message}. Reopen the view after outstanding writes finish.`
            )
          );
        } else
          this.#fail(failure, this.#rich ? undefined : publication.revision);
        console.warn("[mcp-use] Failed to update model context:", error);
      } finally {
        if (!this.#disposed && sendEpoch === this.#epoch) {
          this.#inFlight = null;
          this.#sending = null;
          if (
            !this.#blocked &&
            this.#desired !== publication &&
            (!rich || !failed)
          )
            this.#pump();
          else if (!failed && !this.#blocked)
            this.#publish(this.#queued > 0, null);
        }
      }
    });
  }
}
