/**
 * ModelContext: React component and module-level API for annotating view UI
 * with contextual information the model can see.
 */

import type { ContentBlock } from "@modelcontextprotocol/server";
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
  /**
   * Machine-readable context data, merged into the push's
   * `structuredContent` (spec param). Later registrations win top-level key
   * collisions.
   */
  structuredContent?: Record<string, unknown>;
  /** Optional children — acts as a scope boundary for nested context nodes. */
  children?: ReactNode;
}

/**
 * Annotate a portion of the view UI with a description the model can see.
 *
 * Registers `content` in a hierarchical tree serialized into an indented list
 * and pushed to the host via `ui/update-model-context`; `structuredContent`
 * entries merge into the push's spec-level `structuredContent` param. Updates
 * batch per microtask, and each push carries the complete current context
 * (the spec's overwrite semantics).
 *
 * @example
 * ```tsx
 * <ModelContext content={`Selected: ${item.name}`} />
 *
 * <ModelContext content="Dashboard" structuredContent={{ revenue }}>
 *   <ModelContext content="Revenue section" />
 * </ModelContext>
 * ```
 */
export function ModelContext({
  content,
  structuredContent,
  children,
}: ModelContextProps) {
  const parentId = useContext(ParentIdContext);
  const id = useId();

  useEffect(() => {
    if (content.trim()) {
      modelContextNodes.setNode({ id, parentId, content });
    }
    if (structuredContent !== undefined) {
      modelContextNodes.setStructured(id, structuredContent);
    }
    return () => {
      modelContextNodes.removeNode(id);
    };
  }, [id, parentId, content, structuredContent]);

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
 * Covers the full `ui/update-model-context` params surface: text entries
 * serialize into the leading text block, {@link ContentBlock} entries append
 * as-is (any modality the host accepts), and structured entries merge into
 * the push's `structuredContent`.
 *
 * @example
 * ```ts
 * modelContext.set("active-item", `Viewing ${item.name}`);
 * modelContext.set("chart", [{ type: "image", data, mimeType: "image/png" }]);
 * modelContext.setStructured("cart", { items, totalCost });
 * modelContext.remove("active-item");
 * ```
 */
export const modelContext = {
  /**
   * Register or update a named root-level context entry: a string joins the
   * serialized text tree; {@link ContentBlock}s append to the push's
   * `content` after it.
   */
  set(key: string, content: string | ContentBlock[]): void {
    if (typeof content === "string") {
      modelContextNodes.setNode({ id: key, parentId: null, content });
    } else {
      modelContextNodes.setBlocks(key, content);
    }
  },

  /**
   * Register or update a named structured entry, merged into the push's
   * `structuredContent` in registration order (later keys win collisions).
   */
  setStructured(key: string, value: Record<string, unknown>): void {
    modelContextNodes.setStructured(key, value);
  },

  /** Remove everything registered under a key (text, blocks, structured). */
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
