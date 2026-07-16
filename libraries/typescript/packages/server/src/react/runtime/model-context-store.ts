import type { App } from "@modelcontextprotocol/ext-apps";
import type { ContentBlock } from "@modelcontextprotocol/server";

interface ModelContextNode {
  id: string;
  parentId: string | null;
  content: string;
}

interface StoredModelContextNode extends ModelContextNode {
  /** Insertion sequence — preserves registration order across flushes. */
  order: number;
}

/**
 * Complete `ui/update-model-context` params built from the store — the wire
 * shape of the MCP Apps spec's `content` blocks. Each push carries the full
 * current state (the spec's overwrite semantics).
 *
 * @internal
 */
export interface ModelContextParams {
  /**
   * Content blocks: empty, or a single text block with the serialized
   * description tree.
   */
  content: ContentBlock[];
}

/**
 * Narrow runtime surface the flush pump needs to connect and send.
 *
 * @internal
 */
export interface ModelContextStoreHost {
  /** Connect once, or return the cached in-flight / settled connection promise. */
  connect(): Promise<App>;
}

const EMPTY_SERIALIZED = JSON.stringify({ content: [] });

/**
 * Warn-once flag for hosts that omit the `updateModelContext` capability.
 * Document-scoped so HMR / rebootstrap do not spam the console.
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

/**
 * @internal Reset the missing-capability warn-once flag between tests.
 *
 * Prefer {@link _resetModelContextForTesting} from `model-context.tsx` when the
 * active runtime's store must also be cleared; this seam only resets the
 * document-level warn flag (dispose already drops the store).
 */
export function _resetModelContextForTesting(): void {
  warnedModelContextUnsupported = false;
}

/**
 * @internal Reset the missing-capability warn-once flag between tests.
 */
export function _resetModelContextUnsupportedWarnedForTesting(): void {
  warnedModelContextUnsupported = false;
}

/**
 * Per-runtime model-context node tree and async flush pump.
 *
 * Owned by one {@link McpAppRuntime}: constructed with it, disposed with it.
 * Mutations update desired state and schedule a microtask-batched pump that
 * acknowledges a payload only after a successful `updateModelContext` send.
 *
 * @internal
 */
export class ModelContextStore {
  readonly #host: ModelContextStoreHost;
  readonly #nodes = new Map<string, StoredModelContextNode>();
  #nextOrder = 0;
  #flushScheduled = false;
  #disposed = false;
  /** Bumped on {@link dispose} so late in-flight completions are ignored. */
  #epoch = 0;
  /**
   * Serialized form of the latest tree. Starts empty so views that never
   * register context are not dirty.
   */
  #desiredSerialized = EMPTY_SERIALIZED;
  /**
   * Last successfully delivered payload. Starts empty so an empty push is
   * sent only as a clear after non-empty context existed.
   */
  #acknowledgedSerialized = EMPTY_SERIALIZED;
  #inFlight: Promise<void> | null = null;

  /**
   * @param host - Runtime bridge used to `connect` and send updates.
   */
  constructor(host: ModelContextStoreHost) {
    this.#host = host;
  }

  /**
   * Register or replace a node and schedule a flush.
   *
   * @param node - Node identity, parent link, and text content.
   */
  setNode(node: ModelContextNode): void {
    if (this.#disposed) return;
    const order = this.#nodes.get(node.id)?.order ?? this.#nextOrder++;
    this.#nodes.set(node.id, { ...node, order });
    this.#updateDesiredAndSchedule();
  }

  /**
   * Remove a node by id and schedule a flush.
   *
   * @param id - Node id previously passed to {@link setNode}.
   */
  removeNode(id: string): void {
    if (this.#disposed) return;
    if (!this.#nodes.delete(id)) return;
    this.#updateDesiredAndSchedule();
  }

  /** Remove every node and schedule a flush (empty clear when previously non-empty). */
  clear(): void {
    if (this.#disposed) return;
    if (this.#nodes.size === 0) return;
    this.#nodes.clear();
    this.#updateDesiredAndSchedule();
  }

  /**
   * Invalidate the store: ignore late in-flight completions and reject further
   * mutations. Does not send a final clear — the runtime is going away.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#epoch += 1;
    this.#flushScheduled = false;
    this.#inFlight = null;
    this.#nodes.clear();
    this.#nextOrder = 0;
    this.#desiredSerialized = EMPTY_SERIALIZED;
    this.#acknowledgedSerialized = EMPTY_SERIALIZED;
  }

  /**
   * Serialize the registered tree into an indented markdown-like string.
   *
   * @returns Description text, or `""` when nothing is registered.
   */
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

    // Sibling order = registration order. React runs effects in document order
    // for siblings, so this tracks on-screen order; sorting by `useId` strings
    // would not (`:r10:` sorts before `:r2:`).
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

  /**
   * Build the `ui/update-model-context` params from the current tree.
   *
   * @returns Empty `content` when nothing is registered; otherwise one text block.
   */
  buildModelContextParams(): ModelContextParams {
    const description = this.buildDescriptionString();
    if (description.length === 0) {
      return { content: [] };
    }
    return { content: [{ type: "text", text: description }] };
  }

  /**
   * @internal Clear nodes and pump state between tests without disposing the
   * owning runtime (warn-once flag is reset separately).
   */
  resetForTesting(): void {
    this.#nodes.clear();
    this.#nextOrder = 0;
    this.#flushScheduled = false;
    this.#inFlight = null;
    this.#desiredSerialized = EMPTY_SERIALIZED;
    this.#acknowledgedSerialized = EMPTY_SERIALIZED;
    // Keep #disposed / #epoch — a disposed store stays disposed.
  }

  /** @internal Serialized tree for tests. */
  getDescriptionForTesting(): string {
    return this.buildDescriptionString();
  }

  #updateDesiredAndSchedule(): void {
    this.#desiredSerialized = JSON.stringify(this.buildModelContextParams());
    this.#schedulePump();
  }

  #schedulePump(): void {
    if (this.#disposed) return;
    if (this.#flushScheduled) return;
    this.#flushScheduled = true;
    queueMicrotask(() => {
      this.#flushScheduled = false;
      this.#pump();
    });
  }

  #pump(): void {
    if (this.#disposed) return;
    if (this.#inFlight) return;
    if (this.#desiredSerialized === this.#acknowledgedSerialized) return;

    const params = this.buildModelContextParams();
    // Re-serialize from the live tree and track that exact form for ack.
    const serialized = JSON.stringify(params);
    this.#desiredSerialized = serialized;
    if (serialized === this.#acknowledgedSerialized) return;

    const sendEpoch = this.#epoch;
    let sendSucceeded = false;

    this.#inFlight = (async () => {
      try {
        const app = await this.#host.connect();
        if (this.#disposed || sendEpoch !== this.#epoch) return;

        if (app.getHostCapabilities()?.updateModelContext === undefined) {
          if (markModelContextUnsupportedWarned()) {
            console.warn(
              "[ModelContext] Host does not declare the updateModelContext capability; model-context updates are not sent."
            );
          }
          // Stay dirty — a later host/capability may accept updates.
          return;
        }

        await app.updateModelContext(
          params as Parameters<App["updateModelContext"]>[0]
        );
        if (this.#disposed || sendEpoch !== this.#epoch) return;

        // Acknowledge the exact payload that was sent. If desired moved on
        // mid-flight, the store stays dirty and the finally-block re-pumps.
        this.#acknowledgedSerialized = serialized;
        sendSucceeded = true;
      } catch (error: unknown) {
        if (this.#disposed || sendEpoch !== this.#epoch) return;
        console.warn("[ModelContext] Failed to update model context:", error);
      } finally {
        this.#inFlight = null;
        if (
          !this.#disposed &&
          sendEpoch === this.#epoch &&
          sendSucceeded &&
          this.#desiredSerialized !== this.#acknowledgedSerialized
        ) {
          // Coalesced mutations during the in-flight send — push the latest.
          this.#pump();
        }
      }
    })();
  }
}
