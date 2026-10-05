import type { ContentBlock, Icon } from "@modelcontextprotocol/server";

/** Presentation hints for native model context; audience is not a privacy filter. */
export interface ModelContextPresentation {
  /** Maps to MCP annotations.audience. All blocks still reach the model. */
  audience?: ("user" | "assistant")[];
}

/** Text evidence with optional composer presentation. */
export type ModelContextText = Extract<
  ContentBlock,
  {
    /** Selects native text content from the MCP content union. */
    type: "text";
  }
> &
  ModelContextPresentation & {
    /** Composer label, serialized as OpenAI metadata. */
    title?: string;
    /** Text attachment icon; ChatGPT iOS currently ignores thumbnails. */
    thumbnail?: Icon;
  };

/** Native base64 image evidence. */
export type ModelContextImage = Extract<
  ContentBlock,
  {
    /** Selects native image content from the MCP content union. */
    type: "image";
  }
> &
  ModelContextPresentation & {
    /** Image alt text, serialized as OpenAI metadata. */
    title?: string;
  };

/** Supported native context blocks. Raw metadata and annotations are preserved. */
export type ModelContextBlock =
  | ModelContextText
  | ModelContextImage
  | (Extract<
      ContentBlock,
      {
        /** Selects linked and embedded resources from the MCP content union. */
        type: "resource_link" | "resource";
      }
    > &
      ModelContextPresentation);

/** One selected attachment. Restored keys are runtime-local, not persistent IDs. */
export interface ModelContextAttachment {
  /** Opaque application key or a reserved key assigned during host restoration. */
  readonly key: string;
  /** Normalized native block; convenience fields are serialized into wire fields. */
  readonly block: ModelContextBlock;
}

/** Acknowledgment of one mutation, without promising permanent attachment. */
export interface ModelContextOperationResult {
  /** Superseded means a newer action replaced this effect before acknowledgment. */
  readonly status: "synced" | "superseded";
}

/** Shared selection and synchronization API for one view runtime. */
export interface ModelContextHandle {
  /** Effective selection, which can include unsynced entries after a failure. */
  readonly attachments: readonly ModelContextAttachment[];
  /** True during initialization, batching, or delivery; false is not proof of sync. */
  readonly pending: boolean;
  /** Shared delivery or reconciliation error; individual validation errors reject. */
  readonly error: Error | null;
  /** Add or replace one opaque key, preserving other attachments and background. */
  add(
    key: string,
    block: ModelContextBlock
  ): Promise<ModelContextOperationResult>;
  /** Remove a single selected key and send the remaining complete context. */
  remove(key: string): Promise<ModelContextOperationResult>;
  /** Clear selected attachments globally, preserving separately managed background. */
  clearAttachments(): Promise<ModelContextOperationResult>;
  /** Retry current reconciled context. Unresolved host races remain blocked. */
  retry(): Promise<ModelContextOperationResult>;
}
