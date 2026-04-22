/**
 * JSON Schema sanitizer for Google Gemini `functionDeclarations`.
 *
 * Gemini rejects schemas that contain keywords it doesn't understand
 * (`$schema`, `$id`, `additionalProperties`, `$ref`, `definitions`, etc.)
 * and many advanced constructs (`oneOf`/`anyOf`/`allOf` on non-object roots,
 * `const`, `examples`, `default` on certain types). MCP servers often emit
 * schemas with these fields because they're valid JSON Schema, so we strip
 * them here. Tool semantics are preserved — only metadata keywords are
 * removed.
 */
const ALLOWED_KEYS = new Set([
  "type",
  "description",
  "enum",
  "properties",
  "required",
  "items",
  "format",
  "nullable",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "pattern",
]);

export function sanitizeSchemaForGemini(
  schema: unknown
): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "object" };
  }
  const cleaned = clean(schema as Record<string, unknown>);
  if (typeof cleaned !== "object" || cleaned === null) {
    return { type: "object" };
  }
  const out = cleaned as Record<string, unknown>;
  if (!out.type) out.type = "object";
  return out;
}

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;

  // Unwrap single-branch unions; drop unsupported composite keywords otherwise.
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    const arr = input[key];
    if (Array.isArray(arr) && arr.length === 1) {
      return clean(arr[0]);
    }
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    if (k === "properties" && v && typeof v === "object") {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        props[pk] = clean(pv);
      }
      out[k] = props;
    } else if (k === "items") {
      out[k] = clean(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
