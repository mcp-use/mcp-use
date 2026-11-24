/** A node of a parsed or created YAML document. Maps and sequences have `items`. */
export interface YamlNode {
  /** Write a map or sequence on one line, `{ a: 1 }` or `[a, b]`. */
  flow?: boolean;
  /** Map pairs (`{ key, value }`) or sequence items. */
  items?: unknown[];
}

/** Minimal result surface consumed from the vendored YAML parser. */
export interface ParsedYamlDocument {
  errors: Array<{ message: string }>;
  /** The document's root node; set it to `createNode(value)` to write `value`. */
  contents: unknown;
  toJSON(): unknown;
  /** A node for `value`, in this document's schema. */
  createNode(value: unknown): YamlNode;
  /** The document as YAML text. */
  toString(options?: { lineWidth?: number }): string;
}

/** Parse one YAML document without throwing for ordinary syntax errors. */
export function parseDocument(
  source: string,
  options?: { prettyErrors?: boolean }
): ParsedYamlDocument;
