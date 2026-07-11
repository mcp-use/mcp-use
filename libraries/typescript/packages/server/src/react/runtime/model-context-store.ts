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

const nodes = new Map<string, StoredModelContextNode>();
let nextOrder = 0;

let flushScheduled = false;
let flushHandler: ((params: ModelContextParams) => void) | null = null;
// Serialized form of the last delivered params. Starts as the empty push so
// views that never register context deliver nothing, an empty state is
// delivered only as a clear after content existed, and identical consecutive
// pushes (e.g. registration-time delivery racing a scheduled flush) are
// deduped.
const EMPTY_SERIALIZED = JSON.stringify({ content: [] });
let lastDelivered = EMPTY_SERIALIZED;

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flush);
}

function deliver(handler: (params: ModelContextParams) => void): void {
  const params = buildModelContextParams();
  const serialized = JSON.stringify(params);
  if (serialized === lastDelivered) {
    return;
  }
  lastDelivered = serialized;
  handler(params);
}

function flush(): void {
  flushScheduled = false;
  if (flushHandler) {
    deliver(flushHandler);
  }
}

/**
 * Serialize the model-context node tree into an indented markdown-like string.
 */
export function buildDescriptionString(): string {
  const byParent = new Map<string | null, StoredModelContextNode[]>();

  for (const node of nodes.values()) {
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

  function traverseTree(parentId: string | null, depth: number): void {
    const children = byParent.get(parentId);
    if (!children) return;
    for (const child of children) {
      if (child.content.trim()) {
        lines.push(`${"  ".repeat(depth)}- ${child.content.trim()}`);
      }
      traverseTree(child.id, depth + 1);
    }
  }

  traverseTree(null, 0);
  return lines.join("\n");
}

/**
 * Build the `ui/update-model-context` params from the current store state: the
 * serialized text tree as a single text block, or an empty `content` array
 * when nothing is registered.
 *
 * @internal
 */
export function buildModelContextParams(): ModelContextParams {
  const description = buildDescriptionString();
  if (description.length === 0) {
    return { content: [] };
  }
  return { content: [{ type: "text", text: description }] };
}

function setNode(node: ModelContextNode): void {
  // Content updates keep the key's original position.
  const order = nodes.get(node.id)?.order ?? nextOrder++;
  nodes.set(node.id, { ...node, order });
  scheduleFlush();
}

function removeNode(id: string): void {
  nodes.delete(id);
  scheduleFlush();
}

/**
 * Register a handler that receives the built `ui/update-model-context` params.
 *
 * The handler is invoked immediately when context entries already exist
 * (imperative registrations before the bridge connected), and on every
 * batched change thereafter. Consecutive identical pushes are deduped; an
 * empty push is delivered only as a clear after non-empty context was
 * delivered — views that never register context send nothing.
 *
 * @param handler - Receives the full current params on each distinct push.
 * @returns Unregister function that clears the handler when it is still current.
 *
 * @internal
 */
export function registerModelContextFlush(
  handler: (params: ModelContextParams) => void
): () => void {
  flushHandler = handler;
  deliver(handler);
  return () => {
    if (flushHandler === handler) {
      flushHandler = null;
    }
  };
}

/** @internal Reset model-context state between tests. */
export function _resetModelContextForTesting(): void {
  nodes.clear();
  nextOrder = 0;
  flushHandler = null;
  flushScheduled = false;
  lastDelivered = EMPTY_SERIALIZED;
}

/** @internal Serialized tree for tests. */
export function _getDescriptionForTesting(): string {
  return buildDescriptionString();
}

/**
 * Mutable node registry used by {@link ModelContext} and the imperative
 * {@link modelContext} API.
 *
 * @internal
 */
export const modelContextNodes = {
  setNode,
  removeNode,
  clear(): void {
    nodes.clear();
    scheduleFlush();
  },
};
