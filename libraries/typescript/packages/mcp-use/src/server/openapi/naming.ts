import type { CollectedOpenAPIOperation } from "./types.js";

export function createToolNames(
  operations: CollectedOpenAPIOperation[]
): string[] {
  const seen = new Map<string, number>();
  const names: string[] = [];

  for (const operation of operations) {
    const baseName = slugifyToolName(
      operation.operation.operationId ??
        `${operation.method}_${operation.path
          .replace(/[{}]/g, "")
          .replace(/\//g, "_")}`
    );
    const count = seen.get(baseName) ?? 0;
    seen.set(baseName, count + 1);
    names.push(count === 0 ? baseName : `${baseName}_${count + 1}`);
  }

  return names;
}

export function createToolDescription(
  operation: CollectedOpenAPIOperation
): string {
  return [
    operation.operation.summary,
    operation.operation.description,
    `HTTP: ${operation.method.toUpperCase()} ${operation.path}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function slugifyToolName(value: string): string {
  const slug = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);

  return slug || "openapi_tool";
}
