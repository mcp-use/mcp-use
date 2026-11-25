/**
 * Canonical JSON for the static registry (catalog and schema hashes). The
 * same algorithm as `canonicalJson` in `@mcp-use/events-core`; kept local so
 * the root entry does not pull the events-core bundle into its static graph.
 * `tests/events/canonical-json.test.ts` locks the two together.
 *
 * @internal
 */

function serialize(json: unknown): string {
  if (Array.isArray(json)) return `[${json.map(serialize).join(",")}]`;
  if (typeof json !== "object" || json === null) return JSON.stringify(json);
  const record = json as Record<string, unknown>;
  const members = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`);
  return `{${members.join(",")}}`;
}

/**
 * Serialize with object keys sorted by UTF-16 code unit at every depth.
 *
 * @throws TypeError when the value has no JSON text.
 */
export function canonicalJson(value: unknown): string {
  const text = JSON.stringify(value) as string | undefined;
  if (text === undefined) {
    throw new TypeError("canonicalJson: the value has no JSON text");
  }
  return serialize(JSON.parse(text));
}
