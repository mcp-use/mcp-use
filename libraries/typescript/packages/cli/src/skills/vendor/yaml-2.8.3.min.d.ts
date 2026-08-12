/** Minimal result surface consumed from the vendored YAML parser. */
export interface ParsedYamlDocument {
  errors: Array<{ message: string }>;
  toJSON(): unknown;
}

/** Parse one YAML document without throwing for ordinary syntax errors. */
export function parseDocument(
  source: string,
  options?: { prettyErrors?: boolean }
): ParsedYamlDocument;
