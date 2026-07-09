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

import {
  _getDescriptionForTesting,
  _resetModelContextForTesting,
  buildDescriptionString,
  buildModelContextParams,
  modelContextNodes,
} from "../bridge/model-context-store.js";

const ParentIdContext = createContext<string | null>(null);

interface ModelContextProps {
  /** Text describing what the user is currently seeing. */
  content: string;
  /** Optional children — acts as a scope boundary for nested context nodes. */
  children?: ReactNode;
}

/**
 * Annotate a portion of the view UI with a description the model can see.
 *
 * Registers `content` in a hierarchical tree that serializes into an indented
 * markdown list and is pushed to the host via `ui/update-model-context`
 * (ext-apps `App.updateModelContext`). Updates batch per microtask, and each
 * push carries the complete current context — the spec's overwrite semantics
 * (the host may defer delivery until the next model turn).
 *
 * When the host does not declare the `updateModelContext` capability, pushes
 * are skipped and a one-time `console.warn` names the gap.
 *
 * @param props - Component props.
 * @param props.content - Text describing what the user is currently seeing.
 * @param props.children - Optional nested UI; nested {@link ModelContext}
 *   nodes serialize as indented children of this node.
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
  const parentId = useContext(ParentIdContext);
  const id = useId();

  useEffect(() => {
    if (content.trim()) {
      modelContextNodes.setNode({ id, parentId, content });
    }
    return () => {
      modelContextNodes.removeNode(id);
    };
  }, [id, parentId, content]);

  if (children === undefined || children === null) {
    return null;
  }

  return (
    <ParentIdContext.Provider value={id}>{children}</ParentIdContext.Provider>
  );
}

/**
 * Imperative model-context API for non-React call sites (event handlers,
 * stores).
 *
 * Strings register as root-level nodes in the same tree {@link ModelContext}
 * builds; each push overwrites the previous context on the host (the host may
 * defer delivery until the next model turn). Updates batch per microtask.
 * When the host lacks the `updateModelContext` capability, pushes no-op with
 * a one-time `console.warn`.
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
   */
  set(key: string, content: string): void {
    modelContextNodes.setNode({ id: key, parentId: null, content });
  },

  /**
   * Remove the entry registered under `key`.
   *
   * @param key - Key previously passed to {@link modelContext.set}.
   */
  remove(key: string): void {
    modelContextNodes.removeNode(key);
  },

  /** Remove all context entries. */
  clear(): void {
    modelContextNodes.clear();
  },
} as const;

export {
  _getDescriptionForTesting,
  _resetModelContextForTesting,
  buildDescriptionString,
  buildModelContextParams,
};
