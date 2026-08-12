/**
 * ModelContext: React component for annotating view UI with contextual
 * information the model can see.
 */

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
} from "react";

import { _resetModelContextUnsupportedWarnedForTesting } from "../runtime/model-context-store.js";
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
function _getDescriptionForTesting(): string {
  return getActiveRuntime()?.modelContextStore.getDescriptionForTesting() ?? "";
}
