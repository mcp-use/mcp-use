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
 * shape of the MCP Apps spec: `content` blocks plus optional
 * `structuredContent`. Each push carries the full current state (the spec's
 * overwrite semantics).
 *
 * @internal
 */
export interface ModelContextParams {
  /** Content blocks: the serialized text tree first, then registered block entries in insertion order. */
  content: ContentBlock[];
  /** Merge of all registered structured entries, in insertion order; omitted when none exist. */
  structuredContent?: Record<string, unknown>;
}

// Three channels, one push. Text nodes form the serialized tree; block
// entries carry non-text ContentBlocks; structured entries merge into
// `structuredContent`. `nodes` and `blockEntries` share a keyspace (a key is
// either text or blocks); structured entries are an independent channel, so
// one key may carry text/blocks *and* a structured record.
const nodes = new Map<string, StoredModelContextNode>();
const blockEntries = new Map<string, { blocks: ContentBlock[]; order: number }>();
const structuredEntries = new Map<
  string,
  { value: Record<string, unknown>; order: number }
>();
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
 * Build the complete `ui/update-model-context` params from the current store
 * state: the serialized text tree as a leading text block, registered block
 * entries appended in insertion order, and structured entries merged (spread
 * in insertion order, later registrations winning key collisions).
 *
 * @internal
 */
export function buildModelContextParams(): ModelContextParams {
  const content: ContentBlock[] = [];

  const description = buildDescriptionString();
  if (description.length > 0) {
    content.push({ type: "text", text: description });
  }

  const orderedBlocks = [...blockEntries.values()].sort(
    (a, b) => a.order - b.order
  );
  for (const entry of orderedBlocks) {
    content.push(...entry.blocks);
  }

  if (structuredEntries.size === 0) {
    return { content };
  }

  const orderedStructured = [...structuredEntries.values()].sort(
    (a, b) => a.order - b.order
  );
  const structuredContent: Record<string, unknown> = {};
  for (const entry of orderedStructured) {
    Object.assign(structuredContent, entry.value);
  }
  return { content, structuredContent };
}

function setNode(node: ModelContextNode): void {
  // Content updates keep the key's original position; text replaces a prior
  // block entry under the same key.
  const order =
    nodes.get(node.id)?.order ?? blockEntries.get(node.id)?.order ?? nextOrder++;
  blockEntries.delete(node.id);
  nodes.set(node.id, { ...node, order });
  scheduleFlush();
}

function setBlocks(id: string, blocks: ContentBlock[]): void {
  const order =
    blockEntries.get(id)?.order ?? nodes.get(id)?.order ?? nextOrder++;
  nodes.delete(id);
  blockEntries.set(id, { blocks, order });
  scheduleFlush();
}

function setStructured(id: string, value: Record<string, unknown>): void {
  const order = structuredEntries.get(id)?.order ?? nextOrder++;
  structuredEntries.set(id, { value, order });
  scheduleFlush();
}

function removeNode(id: string): void {
  nodes.delete(id);
  blockEntries.delete(id);
  structuredEntries.delete(id);
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
  blockEntries.clear();
  structuredEntries.clear();
  nextOrder = 0;
  flushHandler = null;
  flushScheduled = false;
  lastDelivered = EMPTY_SERIALIZED;
}

/** @internal Serialized tree for tests. */
export function _getDescriptionForTesting(): string {
  return buildDescriptionString();
}

export const modelContextNodes = {
  setNode,
  setBlocks,
  setStructured,
  removeNode,
  clear(): void {
    nodes.clear();
    blockEntries.clear();
    structuredEntries.clear();
    scheduleFlush();
  },
};
