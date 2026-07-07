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
  modelContextNodes,
} from "./model-context-store.js";

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
 * Registers `content` in a hierarchical tree serialized into an indented list
 * and pushed to the host via `ui/update-model-context`. Updates batch per
 * microtask.
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
 * Imperative model-context API for non-React call sites.
 *
 * @example
 * ```ts
 * modelContext.set("active-item", `Viewing ${item.name}`);
 * modelContext.remove("active-item");
 * ```
 */
export const modelContext = {
  /** Register or update a named root-level context entry. */
  set(key: string, content: string): void {
    modelContextNodes.setNode({ id: key, parentId: null, content });
  },

  /** Remove a previously registered context entry by key. */
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
};
