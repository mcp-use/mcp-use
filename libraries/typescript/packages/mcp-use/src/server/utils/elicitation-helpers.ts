/**
 * Elicitation schema helpers (SEP-1330)
 *
 * These helpers generate JSON Schema fragments for enum-style elicitation fields.
 * They are intended for use with the verbose `ctx.elicit({ requestedSchema })` API.
 */

export interface EnumOption {
  value: string;
  title: string;
}

export interface LegacyEnumOption {
  value: string;
  name: string;
}

export interface UntitledEnumSchema {
  type: "string";
  enum: string[];
}

export interface TitledEnumSchema {
  type: "string";
  oneOf: Array<{ const: string; title: string }>;
}

export interface LegacyEnumSchema {
  type: "string";
  enum: string[];
  enumNames: string[];
}

export interface UntitledMultiEnumSchema {
  type: "array";
  items: {
    type: "string";
    enum: string[];
  };
}

export interface TitledMultiEnumSchema {
  type: "array";
  items: {
    anyOf: Array<{ const: string; title: string }>;
  };
}

export type ElicitationEnumFieldSchema =
  | UntitledEnumSchema
  | TitledEnumSchema
  | LegacyEnumSchema
  | UntitledMultiEnumSchema
  | TitledMultiEnumSchema;

export interface ElicitationEnumObjectSchema {
  type: "object";
  properties: Record<string, ElicitationEnumFieldSchema>;
}

/**
 * Untitled single-select enum.
 * Example: { type: "string", enum: ["a", "b"] }
 */
export function untitledEnum(values: string[]): UntitledEnumSchema {
  return {
    type: "string",
    enum: [...values],
  };
}

/**
 * Titled single-select enum.
 * Example: { type: "string", oneOf: [{ const: "a", title: "Option A" }] }
 */
export function titledEnum(options: EnumOption[]): TitledEnumSchema {
  return {
    type: "string",
    oneOf: options.map((option) => ({
      const: option.value,
      title: option.title,
    })),
  };
}

/**
 * Legacy titled enum (deprecated in SEP-1330 but still supported).
 * Example: { type: "string", enum: ["a"], enumNames: ["Option A"] }
 */
export function legacyEnum(options: LegacyEnumOption[]): LegacyEnumSchema {
  return {
    type: "string",
    enum: options.map((option) => option.value),
    enumNames: options.map((option) => option.name),
  };
}

/**
 * Untitled multi-select enum.
 * Example: { type: "array", items: { type: "string", enum: ["a", "b"] } }
 */
export function untitledMultiEnum(values: string[]): UntitledMultiEnumSchema {
  return {
    type: "array",
    items: {
      type: "string",
      enum: [...values],
    },
  };
}

/**
 * Titled multi-select enum.
 * Example: { type: "array", items: { anyOf: [{ const: "a", title: "Option A" }] } }
 */
export function titledMultiEnum(options: EnumOption[]): TitledMultiEnumSchema {
  return {
    type: "array",
    items: {
      anyOf: options.map((option) => ({
        const: option.value,
        title: option.title,
      })),
    },
  };
}

/**
 * Build a top-level object schema for elicitation requestedSchema.
 */
export function enumSchema(
  fields: Record<string, ElicitationEnumFieldSchema>
): ElicitationEnumObjectSchema {
  return {
    type: "object",
    properties: fields,
  };
}
