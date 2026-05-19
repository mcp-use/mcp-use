/**
 * ModelContext: React component and module-level API for annotating widget UI
 * with contextual information the model can see.
 *
 * The component registers content in a parent-child tree that is serialized
 * into an indented markdown-like string and pushed to the host via
 * ui/update-model-context (MCP Apps) or setWidgetState (ChatGPT Apps SDK).
 *
 * Two complementary APIs:
 *
 * 1. <ModelContext content="..."> — React component, lifecycle-tied, tree-aware
 * 2. modelContext.set(key, value) — module-level imperative API, works anywhere
 */

import React, {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelContextNode {
  id: string;
  parentId: string | null;
  content: string;
}

// The reserved key injected into widget state / model context.
// Filtered from developer-facing state in useWidget.
export const MODEL_CONTEXT_KEY = "__model_context" as const;

// ---------------------------------------------------------------------------
// Global node registry
// ---------------------------------------------------------------------------

const nodes = new Map<string, ModelContextNode>();

function setNode(node: ModelContextNode): void {
  nodes.set(node.id, node);
  scheduleFlush();
}

function removeNode(id: string): void {
  nodes.delete(id);
  scheduleFlush();
}

// ---------------------------------------------------------------------------
// Batched flush via queueMicrotask
// ---------------------------------------------------------------------------

let flushScheduled = false;

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flush);
}

function flush(): void {
  flushScheduled = false;
  const description = buildDescriptionString();
  notifyHost(description);
}

// ---------------------------------------------------------------------------
// Tree serialization — indented markdown-like list
// ---------------------------------------------------------------------------

function buildDescriptionString(): string {
  const byParent = new Map<string | null, ModelContextNode[]>();

  for (const node of nodes.values()) {
    const key = node.parentId ?? null;
    if (!byParent.has(key)) {
      byParent.set(key, []);
    }
    byParent.get(key)!.push(node);
  }

  // Sort siblings deterministically
  for (const list of byParent.values()) {
    list.sort((a, b) => a.id.localeCompare(b.id));
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
 * Get the current serialized model-context string. For use in tests only.
 * @internal
 */
export function _getDescriptionForTesting(): string {
  return buildDescriptionString();
}

// ---------------------------------------------------------------------------
// Host notification
//
// The model-context module needs to notify the host without taking a hard
// dependency on the bridge (which creates a circular import). Instead, any
// code that wants model-context updates to flow to the host registers a
// flush handler via `registerModelContextFlush`. useWidget does this when it
// initialises, so annotations always reach the right channel.
//
// If no handler is registered yet (e.g. the widget hasn't mounted), updates
// are silently dropped — they will re-flow when the component tree registers
// a node on next mount.
// ---------------------------------------------------------------------------

type FlushHandler = (description: string) => void;

let flushHandler: FlushHandler | null = null;

/**
 * Register a handler that receives the serialized model-context description
 * whenever the node tree changes. Called internally by useWidget.
 * Returns a cleanup function that de-registers the handler.
 */
export function registerModelContextFlush(handler: FlushHandler): () => void {
  flushHandler = handler;
  // Immediately notify with current state so the host is in sync
  handler(buildDescriptionString());
  return () => {
    if (flushHandler === handler) {
      flushHandler = null;
    }
  };
}

function notifyHost(description: string): void {
  flushHandler?.(description);
}

// ---------------------------------------------------------------------------
// React context for parent-child tree tracking
// ---------------------------------------------------------------------------

const ParentIdContext = createContext<string | null>(null);

// ---------------------------------------------------------------------------
// <ModelContext> component
// ---------------------------------------------------------------------------

interface ModelContextProps {
  /** The text describing what the user is currently seeing. */
  content: string;
  /** Optional children — this component acts as a scope boundary for nesting. */
  children?: ReactNode;
}

/**
 * Annotate a portion of the widget UI with a description the model can see.
 *
 * Registers `content` in a hierarchical tree that is serialized into an
 * indented string and pushed to the host via `ui/update-model-context`
 * (MCP Apps) or `setWidgetState` (ChatGPT Apps SDK).
 *
 * - Supports empty children (self-closing `<ModelContext content="..." />`)
 * - Nested `<ModelContext>` components become child nodes in the tree
 * - Multiple siblings at the same level produce a flat list at that depth
 *
 * @example
 * ```tsx
 * // Leaf node (no children)
 * <ModelContext content={`Selected: ${item.name}`} />
 *
 * // Scope boundary
 * <ModelContext content="Dashboard">
 *   <ModelContext content="Revenue section" />
 *   <ModelContext content="Users section" />
 * </ModelContext>
 * // Produces:
 * // - Dashboard
 * //   - Revenue section
 * //   - Users section
 * ```
 */
export function ModelContext({ content, children }: ModelContextProps) {
  const parentId = useContext(ParentIdContext);
  const id = useId();

  useEffect(() => {
    if (content.trim()) {
      setNode({ id, parentId, content });
    }
    return () => {
      removeNode(id);
    };
  }, [id, parentId, content]);

  if (children === undefined || children === null) {
    return null;
  }

  return (
    <ParentIdContext.Provider value={id}>{children}</ParentIdContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// modelContext — module-level imperative API
// Works anywhere: event handlers, plain functions, outside React.
// Entries are always root-level (parentId: null).
// ---------------------------------------------------------------------------

/**
 * Module-level imperative API for setting model context outside React.
 *
 * Entries set via this API are always root-level nodes (no parent).
 * Use a stable `key` so updates overwrite the previous value.
 *
 * @example
 * ```ts
 * import { modelContext } from "mcp-use/react";
 *
 * function onItemClick(item: Item) {
 *   modelContext.set("active-item", `Viewing details for ${item.name}`);
 * }
 *
 * function onDrawerClose() {
 *   modelContext.remove("active-item");
 * }
 * ```
 */
/**
 * Reset all internal state. For use in tests only.
 * @internal
 */
export function _resetModelContextForTesting(): void {
  nodes.clear();
  flushHandler = null;
  flushScheduled = false;
}

export const modelContext = {
  /**
   * Register or update a named context entry.
   * The `key` acts as a stable identifier — calling `set` with the same key
   * overwrites the previous content.
   */
  set(key: string, content: string): void {
    setNode({ id: key, parentId: null, content });
  },

  /**
   * Remove a previously registered context entry by key.
   */
  remove(key: string): void {
    removeNode(key);
  },

  /**
   * Remove all context entries (both component-based and imperative).
   * Useful for cleanup on unmount of a top-level widget.
   */
  clear(): void {
    nodes.clear();
    scheduleFlush();
  },
} as const;
