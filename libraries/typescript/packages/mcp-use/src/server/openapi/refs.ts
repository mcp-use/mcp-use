import type { OpenAPIDocument, OpenAPIReferenceObject } from "./types.js";

export function isReferenceObject(value: unknown): value is OpenAPIReferenceObject {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { $ref?: unknown }).$ref === "string"
  );
}

export function resolveRef<T>(spec: OpenAPIDocument, value: T | OpenAPIReferenceObject): T {
  if (!isReferenceObject(value)) {
    return value;
  }

  const ref = value.$ref;
  if (!ref.startsWith("#/")) {
    return {} as T;
  }

  const segments = ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current: unknown = spec;
  for (const segment of segments) {
    if (!current || typeof current !== "object") {
      return {} as T;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current as T;
}
