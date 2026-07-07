interface ModelContextNode {
  id: string;
  parentId: string | null;
  content: string;
}

const nodes = new Map<string, ModelContextNode>();

let flushScheduled = false;
let flushHandler: ((description: string) => void) | null = null;

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flush);
}

function flush(): void {
  flushScheduled = false;
  flushHandler?.(buildDescriptionString());
}

/**
 * Serialize the model-context node tree into an indented markdown-like string.
 */
export function buildDescriptionString(): string {
  const byParent = new Map<string | null, ModelContextNode[]>();

  for (const node of nodes.values()) {
    const key = node.parentId ?? null;
    const list = byParent.get(key);
    if (list) {
      list.push(node);
    } else {
      byParent.set(key, [node]);
    }
  }

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

function setNode(node: ModelContextNode): void {
  nodes.set(node.id, node);
  scheduleFlush();
}

function removeNode(id: string): void {
  nodes.delete(id);
  scheduleFlush();
}

/**
 * Register a handler that receives the serialized model-context description.
 *
 * @internal
 */
export function registerModelContextFlush(
  handler: (description: string) => void
): () => void {
  flushHandler = handler;
  handler(buildDescriptionString());
  return () => {
    if (flushHandler === handler) {
      flushHandler = null;
    }
  };
}

/** @internal Reset model-context state between tests. */
export function _resetModelContextForTesting(): void {
  nodes.clear();
  flushHandler = null;
  flushScheduled = false;
}

/** @internal Serialized tree for tests. */
export function _getDescriptionForTesting(): string {
  return buildDescriptionString();
}

export const modelContextNodes = {
  setNode,
  removeNode,
  clear(): void {
    nodes.clear();
    scheduleFlush();
  },
};
