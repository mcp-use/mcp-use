import type { ContentBlock } from "@modelcontextprotocol/server";

/** One explicitly selected, runtime-local attachment. @internal */
export interface ContextAttachment {
  /** Opaque application key, separate from description node IDs. */
  readonly key: string;
  /** Native content preserved without flattening it into JSON text. */
  readonly block: ContentBlock;
}

/** Outcome of an individual context mutation. @internal */
export interface ContextOperationResult {
  /** Whether this effect was acknowledged or replaced before acknowledgment. */
  readonly status: "synced" | "superseded";
}

/** Shared observable synchronization state. @internal */
export interface ContextSnapshot {
  /** Effective selection; retained failed entries are not proof of delivery. */
  readonly attachments: readonly ContextAttachment[];
  /** A write is queued or in flight, including initialization. */
  readonly pending: boolean;
  /** Last synchronization failure; input errors do not change it. */
  readonly error: Error | null;
}

/** Complete replacement payload. @internal */
export interface ContextPayload {
  /** Native blocks, including the generated background projection. */
  content: ContentBlock[];
  /** Model-visible structured background state. */
  structuredContent?: Record<string, unknown>;
}

/** Immutable publication and its local attachment identities. @internal */
export interface ContextPublication {
  /** Local contribution revision, never an OpenAI updateId. */
  readonly revision: number;
  /** Detached payload captured before dispatch. */
  readonly payload: ContextPayload;
  /** Canonical value used only for equality, not host revision ordering. */
  readonly serialized: string;
  /** Key generations actually represented in this publication. */
  readonly entries: ReadonlyMap<string, number>;
}

/** Compare complete JSON values, preserving array order. @internal */
export function canonicalContext(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item).sort(([left], [right]) =>
          left.localeCompare(right)
        )
      );
    }
    return item;
  });
}

/** Detach and recursively freeze JSON data at the ownership boundary. @internal */
export function copyContext<T>(value: T): T {
  const copy = JSON.parse(JSON.stringify(value)) as T;
  const freeze = (item: unknown): void => {
    if (item && typeof item === "object") {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy;
}

/** Aggregate the legacy projection and native attachment namespace. @internal */
export function buildContextPayload(
  state: Record<string, unknown> | null,
  description: string,
  attachments: Iterable<ContextAttachment>,
  backgroundOnly = false
): ContextPayload {
  const structuredContent = { ...(state ?? {}), _uiContext: description };
  return {
    structuredContent,
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent),
        ...(backgroundOnly && {
          annotations: { audience: ["assistant" as const] },
        }),
      },
      ...Array.from(attachments, ({ block }) => block),
    ],
  };
}
