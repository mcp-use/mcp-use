/**
 * Parse positional `key=value` arguments for `tools call` and `prompts get`.
 *
 * Forms accepted (per token):
 *   key=value      → string by default; coerced using the tool's input schema
 *                    (number/integer/boolean/array/object) when available
 *   key:=jsonvalue → value is parsed as JSON (httpie convention); use this for
 *                    nested objects/arrays or to force a non-string scalar
 *   --key=value    → leading `--` is accepted and stripped (forgiving for users
 *                    who reach for a flag-style habit)
 *
 * Backward-compatible fallback: a single token that starts with `{` is parsed
 * as a JSON object covering all arguments at once.
 */

type JsonSchemaLike = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
};

export function parseToolArgs(
  rawArgs: string[] | undefined,
  inputSchema?: JsonSchemaLike
): Record<string, unknown> {
  if (!rawArgs || rawArgs.length === 0) return {};

  // Backward-compat: single JSON object argument
  if (rawArgs.length === 1) {
    const trimmed = rawArgs[0].trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (
          parsed === null ||
          typeof parsed !== "object" ||
          Array.isArray(parsed)
        ) {
          throw new Error("expected a JSON object");
        }
        return parsed as Record<string, unknown>;
      } catch (err) {
        throw new Error(`Invalid JSON arguments: ${(err as Error).message}`);
      }
    }
  }

  const props = inputSchema?.properties ?? {};
  const result: Record<string, unknown> = {};

  for (const raw of rawArgs) {
    // Strip optional leading `--` to be forgiving for flag-style habits.
    const token = raw.startsWith("--") ? raw.slice(2) : raw;

    const jsonIdx = token.indexOf(":=");
    const eqIdx = token.indexOf("=");

    let key: string;
    let rawValue: string;
    let forceJson = false;

    if (jsonIdx !== -1 && (eqIdx === -1 || jsonIdx < eqIdx)) {
      key = token.slice(0, jsonIdx);
      rawValue = token.slice(jsonIdx + 2);
      forceJson = true;
    } else if (eqIdx !== -1) {
      key = token.slice(0, eqIdx);
      rawValue = token.slice(eqIdx + 1);
    } else {
      throw new Error(
        `Invalid argument '${raw}'. Use key=value or key:=jsonvalue.`
      );
    }

    if (!key) {
      throw new Error(`Empty key in argument '${raw}'`);
    }

    result[key] = coerceArgValue(rawValue, props[key], forceJson, key);
  }

  return result;
}

function coerceArgValue(
  value: string,
  propSchema: JsonSchemaLike | undefined,
  forceJson: boolean,
  key: string
): unknown {
  if (forceJson) {
    try {
      return JSON.parse(value);
    } catch (err) {
      throw new Error(
        `Invalid JSON value for '${key}': ${(err as Error).message}`
      );
    }
  }

  const types = Array.isArray(propSchema?.type)
    ? propSchema!.type
    : propSchema?.type
      ? [propSchema.type as string]
      : [];

  if (types.includes("null") && (value === "null" || value === "")) {
    return null;
  }

  if (types.includes("integer")) {
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(`Expected integer for '${key}', got '${value}'`);
    }
    return n;
  }

  if (types.includes("number")) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new Error(`Expected number for '${key}', got '${value}'`);
    }
    return n;
  }

  if (types.includes("boolean")) {
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
    throw new Error(
      `Expected boolean (true/false) for '${key}', got '${value}'`
    );
  }

  if (types.includes("array") || types.includes("object")) {
    try {
      return JSON.parse(value);
    } catch (err) {
      const wanted = types.includes("array") ? "array" : "object";
      throw new Error(
        `Expected JSON ${wanted} for '${key}'. Tip: use ${key}:=<json>. ${(err as Error).message}`
      );
    }
  }

  return value;
}

/**
 * Parse positional `key=value` arguments for prompts. Prompt arguments are
 * always strings per the MCP spec, so we skip type coercion entirely.
 */
export function parsePromptArgs(
  rawArgs: string[] | undefined
): Record<string, string> {
  if (!rawArgs || rawArgs.length === 0) return {};

  if (rawArgs.length === 1) {
    const trimmed = rawArgs[0].trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (
          parsed === null ||
          typeof parsed !== "object" ||
          Array.isArray(parsed)
        ) {
          throw new Error("expected a JSON object");
        }
        // Coerce all values to strings for prompt args.
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          out[k] = typeof v === "string" ? v : JSON.stringify(v);
        }
        return out;
      } catch (err) {
        throw new Error(`Invalid JSON arguments: ${(err as Error).message}`);
      }
    }
  }

  const result: Record<string, string> = {};
  for (const raw of rawArgs) {
    const token = raw.startsWith("--") ? raw.slice(2) : raw;
    const eqIdx = token.indexOf("=");
    if (eqIdx === -1) {
      throw new Error(`Invalid argument '${raw}'. Use key=value.`);
    }
    const key = token.slice(0, eqIdx);
    const value = token.slice(eqIdx + 1);
    if (!key) {
      throw new Error(`Empty key in argument '${raw}'`);
    }
    result[key] = value;
  }
  return result;
}
