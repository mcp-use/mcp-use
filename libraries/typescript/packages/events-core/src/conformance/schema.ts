/**
 * A small JSON Schema subset validator for PAYLOAD-SCHEMA: `type`, `enum`,
 * `const`, `properties`, `required`, `additionalProperties: false`, `items`.
 * Other keywords are ignored (the check is SHOULD-level and never a false fail).
 *
 * @packageDocumentation
 */

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

/**
 * Validates `value` against `schema`.
 *
 * @returns `undefined` when valid, else the first problem with its path.
 */
export function validateJsonSchema(
  schema: unknown,
  value: unknown,
  path = "data"
): string | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  const s = schema as Record<string, unknown>;
  if (s.type !== undefined) {
    const types = Array.isArray(s.type)
      ? (s.type as string[])
      : [s.type as string];
    const t = typeOf(value);
    const ok = types.some(
      (x) => x === t || (x === "number" && t === "integer")
    );
    if (!ok) return `${path}: expected ${types.join("|")}, got ${t}`;
  }
  if ("const" in s && JSON.stringify(s.const) !== JSON.stringify(value)) {
    return `${path}: expected const ${JSON.stringify(s.const)}`;
  }
  if (
    Array.isArray(s.enum) &&
    !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))
  ) {
    return `${path}: not in enum`;
  }
  if (typeOf(value) === "object") {
    const obj = value as Record<string, unknown>;
    const props = (s.properties ?? {}) as Record<string, unknown>;
    for (const r of Array.isArray(s.required) ? (s.required as string[]) : []) {
      if (!(r in obj)) return `${path}.${r}: required`;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k in props) {
        const p = validateJsonSchema(props[k], v, `${path}.${k}`);
        if (p) return p;
      } else if (s.additionalProperties === false) {
        return `${path}.${k}: additional property`;
      }
    }
  }
  if (typeOf(value) === "array" && s.items && typeof s.items === "object") {
    const arr = value as unknown[];
    for (let i = 0; i < arr.length; i++) {
      const p = validateJsonSchema(s.items, arr[i], `${path}[${i}]`);
      if (p) return p;
    }
  }
  return undefined;
}
