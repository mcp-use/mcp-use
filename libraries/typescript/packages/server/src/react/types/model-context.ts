import type {
  EmbeddedResource,
  Icon,
  ImageContent,
  ResourceLink,
  TextContent,
} from "@modelcontextprotocol/server";

/** Shared presentation on input and output; audience is not a privacy filter. */
export interface ModelContextPresentation {
  /** Optional display label. The SDK handles encoding and host restoration. */
  title?: string | undefined;
  /** Maps to MCP annotations.audience. All blocks still reach the model. */
  audience?: ("user" | "assistant")[];
}

/** Native text evidence with an optional composer thumbnail. */
export interface ModelContextText
  extends TextContent, ModelContextPresentation {
  /** Text icon; src resolves like Image public assets and stays a URL. iOS ignores it. */
  thumbnail?: Icon;
}

/** Native base64 image evidence, limited to 10 MiB of decoded bytes. */
export interface ModelContextImageData
  extends ImageContent, ModelContextPresentation {
  /** Use data plus mimeType instead of a source URL. */
  src?: never;
}

/** Image source resolved exactly like Image's public-folder paths. */
export interface ModelContextImageSource
  extends Omit<ImageContent, "data" | "mimeType">, ModelContextPresentation {
  /** Public-folder path or URL fetched up to 10 MiB and converted before selection changes. */
  src: string;
  /** Source images cannot also provide native bytes. */
  data?: never;
  /** The fetched response supplies the MIME type. */
  mimeType?: never;
}

/** Choose a source URL or native base64 bytes; returned images contain bytes. */
export type ModelContextImage = ModelContextImageData | ModelContextImageSource;

/** A linked resource. Its native title takes precedence over title metadata. */
export interface ModelContextResourceLink
  extends ResourceLink, ModelContextPresentation {}

/** Embedded text or binary resource; its title uses SDK metadata for restoration. */
export interface ModelContextResource
  extends EmbeddedResource, ModelContextPresentation {}

/** The four supported native context kinds, with consistent friendly presentation. */
export type ModelContextBlock =
  | ModelContextText
  | ModelContextImage
  | ModelContextResourceLink
  | ModelContextResource;

/** One selected attachment. Restored keys are runtime-local, not persistent IDs. */
export interface ModelContextAttachment {
  /** Opaque application key or a reserved key assigned during host restoration. */
  readonly key: string;
  /** Friendly block, including decoded title and presentation after host restoration. */
  readonly block: Exclude<ModelContextBlock, ModelContextImageSource>;
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
  /** True during initialization, image preparation, batching, or delivery; false is not proof of sync. */
  readonly pending: boolean;
  /** Shared delivery or reconciliation error; individual validation errors reject. */
  readonly error: Error | null;
  /** Add or replace one key after preparing its content, preserving other keys and background. */
  add(
    key: string,
    block: ModelContextBlock
  ): Promise<ModelContextOperationResult>;
  /** Remove a single selected key and send the remaining complete context. */
  remove(key: string): Promise<ModelContextOperationResult>;
  /** Clear selected attachments globally, preserving separately managed background. */
  clearAttachments(): Promise<ModelContextOperationResult>;
}
