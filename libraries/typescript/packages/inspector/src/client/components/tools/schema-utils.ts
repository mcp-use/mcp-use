type JsonSchema = Record<string, any>;

function resolveRef(schema: JsonSchema, rootSchema: JsonSchema): JsonSchema {
  if (!schema?.$ref) return schema;

  const ref = schema.$ref;
  if (!ref.startsWith("#/")) {
    return schema;
  }

  const path = ref.substring(2).split("/");
  let current: any = rootSchema;

  for (const segment of path) {
    if (current && typeof current === "object" && segment in current) {
      current = current[segment];
    } else {
      return schema;
    }
  }

  return current;
}

function normalizeUnionType(
  schema: JsonSchema,
  rootSchema: JsonSchema
): JsonSchema {
  if (schema?.anyOf && Array.isArray(schema.anyOf)) {
    const nonNullOption = schema.anyOf.find((opt: JsonSchema) => {
      const resolved = resolveRef(opt, rootSchema);
      return resolved?.type !== "null";
    });

    if (nonNullOption) {
      const resolved = resolveRef(nonNullOption, rootSchema);
      return { ...resolved, nullable: true };
    }
  }

  return schema;
}

export function resolveToolPropertySchema(
  propertySchema: unknown,
  rootSchema: JsonSchema
): JsonSchema {
  let resolved = normalizeUnionType(
    (propertySchema || {}) as JsonSchema,
    rootSchema
  );
  resolved = resolveRef(resolved, rootSchema);
  return resolved;
}

export function getToolPropertyType(
  propertySchema: unknown,
  rootSchema: JsonSchema
): string | undefined {
  const resolved = resolveToolPropertySchema(propertySchema, rootSchema);

  if (typeof resolved.type === "string") {
    return resolved.type;
  }

  if (Array.isArray(resolved.type)) {
    const nonNullType = resolved.type.find((t) => t !== "null");
    return typeof nonNullType === "string" ? nonNullType : undefined;
  }

  return undefined;
}

export function extractEnumValues(propertySchema: unknown): string[] | null {
  const enumValues = (propertySchema as JsonSchema)?.enum;
  if (!Array.isArray(enumValues)) return null;
  if (enumValues.every((value) => typeof value === "string")) {
    return enumValues as string[];
  }
  return null;
}

function parseBoolean(value: string): boolean | string {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return value;
}

export function coerceTextInputValueByType(
  rawValue: string,
  expectedType?: string
): unknown {
  if (expectedType === "number" || expectedType === "integer") {
    const trimmed = rawValue.trim();
    if (!trimmed) return rawValue;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : rawValue;
  }

  if (expectedType === "boolean") {
    return parseBoolean(rawValue);
  }

  return rawValue;
}

export function coerceExecutionArgByType(
  value: unknown,
  expectedType?: string
): unknown {
  if (value === undefined) return value;

  if (expectedType === "object" || expectedType === "array") {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }

  if (expectedType === "number" || expectedType === "integer") {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return value;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  }

  if (expectedType === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return parseBoolean(value);
    return value;
  }

  return value;
}
