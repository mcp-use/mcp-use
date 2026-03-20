/**
 * Client-side helpers for MCP elicitation (form/URL mode).
 *
 * The server sends `requestedSchema` as JSON Schema. These helpers provide
 * defaults extraction, validation (via Zod and the package's JSON Schema → Zod
 * converter), and typed ElicitResult builders.
 */

import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { JSONSchema } from "../utils/json-schema-to-zod/Type.js";
import { JSONSchemaToZod } from "../utils/json-schema-to-zod/JSONSchemaToZod.js";

/** Content shape for ElicitResult when action is "accept". */
export type ElicitContent = Record<
  string,
  string | number | boolean | string[]
>;

/** Result of validate(params, content). */
export type ElicitValidationResult = {
  valid: boolean;
  errors?: string[];
};

export type ElicitParams = ElicitRequestFormParams | ElicitRequestURLParams;

function hasRequestedSchema(
  params: ElicitParams
): params is ElicitRequestFormParams & { requestedSchema: object } {
  return "requestedSchema" in params && params.requestedSchema != null;
}

/**
 * Get default values from the elicitation request's requestedSchema (form mode).
 * For URL mode or when no schema is present, returns an empty object.
 */
export function getDefaults(params: ElicitParams): ElicitContent {
  const content: ElicitContent = {};
  if (!hasRequestedSchema(params)) return content;
  const schema = params.requestedSchema as Record<string, unknown>;
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  for (const [fieldName, fieldSchema] of Object.entries(properties)) {
    const field = fieldSchema as Record<string, unknown>;
    if ("default" in field) {
      const v = field.default;
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean" ||
        (Array.isArray(v) && v.every((x) => typeof x === "string"))
      ) {
        content[fieldName] = v as string | number | boolean | string[];
      }
    }
  }
  return content;
}

/**
 * Merge partial content with schema defaults. Keys present in partial are kept;
 * missing keys are filled from requestedSchema.properties[*].default.
 */
export function applyDefaults(
  params: ElicitParams,
  partial?: ElicitContent
): ElicitContent {
  const defaults = getDefaults(params);
  if (partial == null) return defaults;
  return { ...defaults, ...partial };
}

/**
 * Return an ElicitResult that accepts with content built from schema defaults.
 */
export function acceptWithDefaults(params: ElicitParams): ElicitResult {
  return { action: "accept", content: getDefaults(params) };
}

/**
 * Return an ElicitResult that accepts with the given content.
 */
export function accept(content: ElicitContent): ElicitResult {
  return { action: "accept", content };
}

/**
 * Return an ElicitResult that declines the elicitation (user chose not to provide).
 * Optional reason is for logging; the SDK result is { action: "decline" }.
 */
export function decline(_reason?: string): ElicitResult {
  return { action: "decline" };
}

/**
 * Return an ElicitResult that cancels the elicitation (user cancelled the operation).
 */
export function cancel(): ElicitResult {
  return { action: "cancel" };
}

/**
 * Alias for decline(reason). Use when you want "reject" wording.
 */
export function reject(reason?: string): ElicitResult {
  return decline(reason);
}

/**
 * Validate content against the request's requestedSchema using Zod.
 * Converts requestedSchema (JSON Schema) to a Zod schema via JSONSchemaToZod,
 * then runs safeParse(content). If schema conversion fails, returns
 * { valid: false, errors: ["Unsupported or invalid schema"] }.
 */
export function validate(
  params: ElicitParams,
  content: ElicitContent
): ElicitValidationResult {
  if (!hasRequestedSchema(params)) {
    return { valid: true };
  }
  try {
    const zodSchema = JSONSchemaToZod.convert(
      params.requestedSchema as unknown as JSONSchema
    );
    const result = zodSchema.safeParse(content);
    if (result.success) {
      return { valid: true };
    }
    const messages = result.error.issues.map((i) =>
      i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message
    );
    return { valid: false, errors: messages };
  } catch {
    return { valid: false, errors: ["Unsupported or invalid schema"] };
  }
}
