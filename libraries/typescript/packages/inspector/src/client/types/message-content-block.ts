/** SEP-1865 `ui/message` content block (follow-up messages from MCP Apps). */
export type MessageContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; [key: string]: unknown } }
  | { type: string; [key: string]: unknown };
