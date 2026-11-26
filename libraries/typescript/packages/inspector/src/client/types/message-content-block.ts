/** MCP content annotations. `audience` without `"user"` marks model-only content. */
export interface MessageContentAnnotations {
  audience?: unknown;
  [key: string]: unknown;
}

/** SEP-1865 `ui/message` content block (follow-up messages from MCP Apps). */
export type MessageContentBlock =
  | { type: "text"; text: string; annotations?: MessageContentAnnotations }
  | {
      type: "image";
      data: string;
      mimeType: string;
      annotations?: MessageContentAnnotations;
    }
  | { type: "resource"; resource: { uri: string; [key: string]: unknown } }
  | { type: string; [key: string]: unknown };
