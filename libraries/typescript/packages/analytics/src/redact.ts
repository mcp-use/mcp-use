/**
 * Default payload redactor. Runs before the user's `redact` hook and before
 * anything leaves the process, on a copy: the payload the client receives is
 * never touched.
 */

/** Payloads larger than this (serialized characters) are replaced by a marker, like the gateway. */
const MAX_PAYLOAD_CHARS = 100_000;

/** Strings longer than this are cut. */
const MAX_STRING_CHARS = 10_000;

const MAX_DEPTH = 32;

/** Replacement for values under sensitive keys. */
const REDACTED = "[REDACTED]";

// Same rules as the Python SDK's `_redact.py`; both test suites check the
// vectors in libraries/python-analytics/tests/fixtures/redaction_vectors.json.
// Keys are matched lowercased with separators removed, so `api_key`,
// `X-Api-Key` and `apiKey` all match `apikey`. Suffixes catch `github_token`,
// `db_password` or `aws_secret_access_key`; plural counters such as
// `max_tokens` or `outputTokens` do not end in `token` and are kept. Short or
// ambiguous names only match exactly (`pin`, not `pinned`).
const SENSITIVE_SUFFIX =
  /(?:password|passwd|passphrase|secret|token|apikey|accesskey|privatekey|credential|credentials|cookie|cookies|authorization|signature)$/;
const SENSITIVE_EXACT = new Set([
  "auth",
  "pwd",
  "pin",
  "otp",
  "ssn",
  "cvv",
  "cvc",
  "cardnumber",
  "creditcard",
]);

// Strings that are credentials whatever key they sit under: a Bearer
// authorization value, a JWT, or a Manufact analytics key. The optional final
// newline matches Python's `$`.
const CREDENTIAL_VALUE =
  /^(?:Bearer\s+[A-Za-z0-9._~+/=-]{16,}|eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*|mfi_[A-Za-z0-9]{20,})\n?$/i;

/** Whether a property name holds a credential or secret. */
function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_EXACT.has(normalized) || SENSITIVE_SUFFIX.test(normalized);
}

/** Whether a string value looks like a credential (Bearer value, JWT, `mfi_` key). */
function isCredentialValue(value: string): boolean {
  return CREDENTIAL_VALUE.test(value);
}

function isBinary(value: object): number | undefined {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;
  return undefined;
}

/** Decoded size of a base64 string, without decoding it. */
function base64Bytes(value: string): number {
  return Math.floor((value.replace(/=+$/, "").length * 3) / 4);
}

function cutString(value: string): string {
  return value.length > MAX_STRING_CHARS
    ? `${value.slice(0, MAX_STRING_CHARS)}…[truncated ${value.length - MAX_STRING_CHARS} chars]`
    : value;
}

/**
 * Copy `value` into a JSON-safe tree, with the same rules as the Python SDK:
 * values under sensitive keys and credential-shaped strings become
 * `[REDACTED]`, binary data and base64 media (`blob`, `data` of image/audio
 * content) become `[binary N bytes]`, strings are cut at 10k characters,
 * nesting deeper than 32 levels becomes `[MaxDepth]` and cycles `[Circular]`,
 * and functions/symbols are dropped.
 */
export function redactValue(value: unknown): unknown {
  const ancestors = new Set<object>();

  const visit = (node: unknown, depth: number): unknown => {
    if (node === null) return null;
    switch (typeof node) {
      case "string":
        return isCredentialValue(node) ? REDACTED : cutString(node);
      case "number":
        return Number.isFinite(node) ? node : null;
      case "boolean":
        return node;
      case "bigint":
        return node.toString();
      case "object":
        break;
      default:
        // undefined, function, symbol
        return undefined;
    }
    const object = node as object;
    const binarySize = isBinary(object);
    if (binarySize !== undefined) return `[binary ${binarySize} bytes]`;
    if (depth >= MAX_DEPTH) return "[MaxDepth]";
    if (ancestors.has(object)) return "[Circular]";
    if (object instanceof Date) {
      return Number.isNaN(object.getTime()) ? null : object.toISOString();
    }

    ancestors.add(object);
    try {
      if (Array.isArray(object)) {
        return object.map((item) => {
          const copied = visit(item, depth + 1);
          return copied === undefined ? null : copied;
        });
      }
      const toJSON = (object as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === "function") {
        return visit((toJSON as () => unknown).call(object), depth + 1);
      }
      const record = object as Record<string, unknown>;
      const mediaContent =
        record["type"] === "image" || record["type"] === "audio";
      const out: Record<string, unknown> = {};
      for (const [childKey, child] of Object.entries(record)) {
        // A parsed `__proto__` key would replace the copy's prototype.
        if (childKey === "__proto__") continue;
        if (isSensitiveKey(childKey)) {
          out[childKey] = REDACTED;
          continue;
        }
        if (
          typeof child === "string" &&
          (childKey === "blob" || (mediaContent && childKey === "data"))
        ) {
          out[childKey] = `[binary ${base64Bytes(child)} bytes]`;
          continue;
        }
        const copied = visit(child, depth + 1);
        if (copied !== undefined) out[childKey] = copied;
      }
      return out;
    } finally {
      ancestors.delete(object);
    }
  };

  return visit(value, 0);
}

/**
 * Redact `value` and bound its serialized size. Returns the redacted copy and
 * its serialized length, or the gateway's truncation marker when the copy is
 * still over {@link MAX_PAYLOAD_CHARS}.
 */
export function boundedPayload(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    const copy = redactValue(value);
    const serialized = JSON.stringify(copy);
    if (serialized === undefined) return undefined;
    if (serialized.length > MAX_PAYLOAD_CHARS) {
      return {
        _truncated: true,
        _message: `Payload too large (${serialized.length} bytes)`,
      };
    }
    return copy;
  } catch {
    return { _truncated: true, _message: "Payload serialization failed" };
  }
}
