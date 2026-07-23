/**
 * ModelContext: React component and module-level API for annotating view UI
 * with contextual information the model can see.
 */

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
} from "react";

import type { ModelContextStore } from "../runtime/model-context-store.js";
import {
  _resetModelContextUnsupportedWarnedForTesting,
  type ModelContextParams,
} from "../runtime/model-context-store.js";
import { useViewRuntime } from "../runtime/view-runtime-context.js";
import { getActiveRuntime } from "../runtime/view-runtime.js";

const ParentIdContext = createContext<string | null>(null);

interface ModelContextProps {
  /** Text describing what the user is currently seeing. */
  content: string;
  /** Optional children — acts as a scope boundary for nested context nodes. */
  children?: ReactNode;
}

/**
 * Resolve the active runtime's {@link ModelContextStore}.
 *
 * @throws When no view runtime is mounted.
 */
function requireActiveModelContextStore(): ModelContextStore {
  const runtime = getActiveRuntime();
  if (!runtime) {
    throw new Error(
      "modelContext requires a browser view mounted by bootstrapView"
    );
  }
  return runtime.modelContextStore;
}

/**
 * Annotate a portion of the view UI with a description the model can see.
 *
 * Registers `content` in a hierarchical tree that serializes into an indented
 * markdown list under `_uiContext`. The store merges that field with
 * `useViewState` and sends the complete snapshot through ChatGPT widget state
 * or MCP Apps `ui/update-model-context`. Updates batch per microtask. Failed
 * requests stay dirty and retry after the next mutation.
 *
 * An empty `content` (trimmed) does not register a node and does not orphan
 * children — nested {@link ModelContext} nodes re-parent to the nearest
 * registered ancestor (or root).
 *
 * On the MCP Apps path, a host without the `updateModelContext` capability
 * skips pushes and receives a one-time `console.warn`.
 *
 * @param props - Component props.
 * @param props.content - Text describing what the user is currently seeing.
 * @param props.children - Optional nested UI; nested {@link ModelContext}
 *   nodes serialize as indented children of this node when this node has
 *   non-empty content.
 *
 * @example
 * ```tsx
 * <ModelContext content={`Selected: ${item.name}`} />
 *
 * <ModelContext content="Dashboard">
 *   <ModelContext content="Revenue section" />
 * </ModelContext>
 * ```
 */
export function ModelContext({ content, children }: ModelContextProps) {
  const runtime = useViewRuntime();
  const store = runtime.modelContextStore;
  const parentId = useContext(ParentIdContext);
  const id = useId();
  const hasContent = content.trim().length > 0;
  const childParentId = hasContent ? id : parentId;

  useEffect(() => {
    if (hasContent) {
      store.setNode({ id, parentId, content });
    }
    return () => {
      store.removeNode(id);
    };
  }, [store, id, parentId, content, hasContent]);

  if (children === undefined || children === null) {
    return null;
  }

  return (
    <ParentIdContext.Provider value={childParentId}>
      {children}
    </ParentIdContext.Provider>
  );
}

/**
 * Imperative model-context API for non-React call sites (event handlers,
 * stores).
 *
 * Delegates to the active document runtime's {@link ModelContextStore}.
 * Strings register as root-level nodes in the same tree {@link ModelContext}
 * builds. Every push merges the complete tree under `_uiContext` beside the
 * current `useViewState` object. Updates batch per microtask and use the same
 * async flush pump as the component API.
 *
 * @throws When no view runtime is mounted (`bootstrapView` has not activated a
 *   runtime, or it has been disposed).
 *
 * @example
 * ```ts
 * modelContext.set("active-item", `Viewing ${item.name}`);
 * modelContext.remove("active-item");
 * modelContext.clear();
 * ```
 */
export const modelContext = {
  /**
   * Register or update a named root-level text context entry.
   *
   * @param key - Stable key for this entry (replaces any prior value under the same key).
   * @param content - Text describing what the user is seeing.
   * @throws When no view runtime is mounted.
   */
  set(key: string, content: string): void {
    requireActiveModelContextStore().setNode({
      id: key,
      parentId: null,
      content,
    });
  },

  /**
   * Remove the entry registered under `key`.
   *
   * @param key - Key previously passed to {@link modelContext.set}.
   * @throws When no view runtime is mounted.
   */
  remove(key: string): void {
    requireActiveModelContextStore().removeNode(key);
  },

  /**
   * Remove all context entries.
   *
   * @throws When no view runtime is mounted.
   */
  clear(): void {
    requireActiveModelContextStore().clear();
  },
} as const;

/**
 * @internal Reset model-context warn-once flag and the active runtime's store
 * between tests.
 */
export function _resetModelContextForTesting(): void {
  _resetModelContextUnsupportedWarnedForTesting();
  const runtime = getActiveRuntime();
  if (runtime) {
    runtime.modelContextStore.resetForTesting();
  }
}

/** @internal Serialized tree for the active runtime's store (tests). */
export function _getDescriptionForTesting(): string {
  return getActiveRuntime()?.modelContextStore.getDescriptionForTesting() ?? "";
}

/**
 * @internal Serialize the active runtime's model-context tree.
 *
 * @returns Description string, or `""` when no runtime is mounted.
 */
export function buildDescriptionString(): string {
  return getActiveRuntime()?.modelContextStore.buildDescriptionString() ?? "";
}

/**
 * @internal Build `ui/update-model-context` params from the active store.
 *
 * @returns Empty content when no runtime is mounted or nothing is registered.
 */
export function buildModelContextParams(): ModelContextParams {
  return (
    getActiveRuntime()?.modelContextStore.buildModelContextParams() ?? {
      structuredContent: { _uiContext: "" },
      content: [{ type: "text", text: '{"_uiContext":""}' }],
    }
  );
}
