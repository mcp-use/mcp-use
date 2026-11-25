/**
 * Canonical JSON with the semantics of the TypeScript SDK's Events extension
 * (PR #3209 `canonicalJson`), so subscription ids derived here equal the
 * SDK's. It is not RFC 8785 JCS: numbers and strings are serialized exactly as
 * `JSON.stringify` does.
 *
 * @packageDocumentation
 */

function serialize(json: unknown): string {
  if (Array.isArray(json)) return `[${json.map(serialize).join(",")}]`;
  if (typeof json !== "object" || json === null) return JSON.stringify(json);
  const record = json as Record<string, unknown>;
  // Default sort compares UTF-16 code units.
  const members = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`);
  return `{${members.join(",")}}`;
}

/**
 * Serializes a value as `JSON.stringify` would, with object keys sorted by
 * UTF-16 code unit at every depth. The value first goes through one
 * `JSON.parse(JSON.stringify(value))` pass, so every `JSON.stringify` rule
 * applies: `toJSON` is called, `undefined` and function members are dropped,
 * `NaN` and `Infinity` become `null`, and `-0` becomes `0`.
 *
 * @param value - Any value with a JSON text.
 * @returns The canonical JSON text.
 * @throws TypeError when the value has no JSON text (for example `undefined` or a function).
 */
export function canonicalJson(value: unknown): string {
  const text = JSON.stringify(value) as string | undefined;
  if (text === undefined) {
    throw new TypeError("canonicalJson: the value has no JSON text");
  }
  return serialize(JSON.parse(text));
}
