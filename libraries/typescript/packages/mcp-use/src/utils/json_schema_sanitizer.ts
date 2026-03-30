/**
 * Removes JSON Schema keywords that some LLM tool APIs reject (e.g. Google
 * GenAI function declarations do not accept `propertyNames`).
 */
export function stripJsonSchemaPropertyNames(schema: unknown): void {
  if (schema === null || typeof schema !== "object") {
    return;
  }
  if (Array.isArray(schema)) {
    for (const item of schema) {
      stripJsonSchemaPropertyNames(item);
    }
    return;
  }

  const obj = schema as Record<string, unknown>;
  delete obj.propertyNames;

  if (obj.properties && typeof obj.properties === "object") {
    for (const prop of Object.values(obj.properties as Record<string, unknown>)) {
      stripJsonSchemaPropertyNames(prop);
    }
  }
  if (obj.patternProperties && typeof obj.patternProperties === "object") {
    for (const prop of Object.values(
      obj.patternProperties as Record<string, unknown>
    )) {
      stripJsonSchemaPropertyNames(prop);
    }
  }
  if (obj.additionalProperties && typeof obj.additionalProperties === "object") {
    stripJsonSchemaPropertyNames(obj.additionalProperties);
  }
  if (obj.items) {
    stripJsonSchemaPropertyNames(obj.items);
  }
  if (Array.isArray(obj.prefixItems)) {
    stripJsonSchemaPropertyNames(obj.prefixItems);
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(obj[key])) {
      stripJsonSchemaPropertyNames(obj[key]);
    }
  }
  if (obj.not) {
    stripJsonSchemaPropertyNames(obj.not);
  }
  if (obj.if) {
    stripJsonSchemaPropertyNames(obj.if);
  }
  if (obj.then) {
    stripJsonSchemaPropertyNames(obj.then);
  }
  if (obj.else) {
    stripJsonSchemaPropertyNames(obj.else);
  }
}
