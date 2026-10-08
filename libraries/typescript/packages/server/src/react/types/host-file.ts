/** Preferred host resource representation. Unspecified reads accept either form. */
export type ResourceRepresentation = "text" | "blob";

/** Replacement contents, preserved as text or base64 without conversion. */
export type HostFileContent =
  | {
      /** Text replacement, including an empty string. */ text: string;
      /** Cannot accompany text. */ blob?: never;
    }
  | {
      /** Base64 replacement, including an empty string. */ blob: string;
      /** Cannot accompany a blob. */ text?: never;
    };

/** Contents and matching-item metadata returned for the opened opaque URI. */
export type HostFileData = {
  /** Exact host-provided resource identity. Never a filesystem path. */
  uri: string;
  /** MIME type supplied by the host, when available. */
  mimeType?: string;
  /** True only when the content item's metadata explicitly permits writes. */
  writable: boolean;
  /** Opaque version token for these contents, when supplied. */
  etag?: string;
} & (
  | {
      /** Text returned by the host, preserved without conversion. */
      text: string;
    }
  | {
      /** Base64 returned by the host, preserved without conversion. */
      blob: string;
    }
);

/** Verified host response to a guarded resource write. */
export type ResourceWriteResult =
  | {
      /** Replacement saved. */ outcome: "saved";
      /** Token for the saved contents. */ etag: string;
    }
  | {
      /** Replacement rejected because the file changed. */ outcome: "conflict";
      /** Current host token, without corresponding contents. */ etag: string;
    }
  | {
      /** Replacement exceeded the host limit. */ outcome: "too-large";
      /** Limit in UTF-8 text bytes or decoded blob bytes. */ maxBytes: number;
    };

/** Options for reading the file that opened the current View. */
export interface HostFileOptions {
  /** Preferred wire representation. Omitted by default. */
  representation?: ResourceRepresentation;
  /** Subscribe to host updates. Defaults to true; manual refresh remains available. */
  subscribe?: boolean;
}

/** Read and guarded-write handle bound to the file that opened this View. */
export interface HostFileHandle {
  /** Pending negotiation/input, unsupported host/input, or current read state. */
  status: "pending" | "unsupported" | "loading" | "ready" | "error";
  /** Complete opening input; later ambient invocations cannot replace it. */
  file?: {
    /** Host-provided display name. */
    name: string;
    /** Non-blank opaque resource identity supplied by the host. */
    resourceUri: string;
  };
  /** Last valid contents, retained during refreshes and conflicts. */
  data?: HostFileData;
  /** Last read or write failure. Transport errors are preserved. */
  error?: Error;
  /** Whether a read is in flight. */
  isRefreshing: boolean;
  /** Whether the shared host subscription is established. */
  isSubscribed: boolean;
  /** Subscription failure; manual reads remain usable. */
  subscriptionError?: Error;
  /** Valid read, explicit write permission, and a non-empty opaque ETag. */
  canWrite: boolean;
  /** Read current contents/version explicitly, retaining previous data on failure. */
  refresh(): Promise<HostFileData>;
  /**
   * Replace the opened file's contents using an explicit draft base token.
   * Conflict tokens are never attached to old contents; refresh to reconcile.
   * @param content - Exactly one of text or base64 blob.
   * @param options - Required non-empty opaque ETag in `ifMatch`.
   * @returns The verified host outcome, without automatic retries.
   */
  write(
    content: HostFileContent,
    options: { /** Draft's base ETag. */ ifMatch: string }
  ): Promise<ResourceWriteResult>;
}
