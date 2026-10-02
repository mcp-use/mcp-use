import {
  INVALID_PARAMS,
  ProtocolError,
  type MetaObject,
} from "@modelcontextprotocol/server";

import { resolveToolInputSchema, type ToolDefinition } from "../tools.js";

const META_KEY = "openai/ui";
type JsonSchema = Record<string, unknown>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, i) => sameJson(item, right[i]))
    );
  }
  if (!record(left) || !record(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) => Object.hasOwn(right, key) && sameJson(left[key], right[key])
    )
  );
}

function resolveSchema(value: unknown, root: JsonSchema): JsonSchema {
  if (!record(value)) return {};
  let result = value;
  const visited = new Set<unknown>();
  while (typeof result["$ref"] === "string") {
    if (visited.has(result)) return {};
    visited.add(result);
    const ref = result["$ref"];
    if (!ref.startsWith("#/")) return {};
    let resolved: unknown = root;
    for (const key of ref.slice(2).split("/")) {
      resolved = record(resolved)
        ? resolved[key.replace(/~1/g, "/").replace(/~0/g, "~")]
        : undefined;
    }
    if (!record(resolved)) return {};
    result = resolved;
  }
  return result;
}

function required(schema: JsonSchema): string[] {
  const value = schema["required"];
  return Array.isArray(value)
    ? value.filter((key): key is string => typeof key === "string")
    : [];
}

/** Check entrypoint configuration before mutating the tool/view registry. @internal */
export function validateEntrypoints(definition: ToolDefinition): void {
  const entrypoints = definition.view?.entrypoints;
  if (entrypoints === undefined) return;
  const fail = (message: string): never => {
    throw new TypeError(`Tool "${definition.name}" entrypoints: ${message}`);
  };
  if (!Array.isArray(entrypoints) || entrypoints.length === 0) {
    fail("declare at least one entrypoint.");
  }
  const kinds = new Set<string>();
  const entries: readonly unknown[] = entrypoints;
  for (const entry of entries) {
    if (
      !record(entry) ||
      typeof entry.type !== "string" ||
      !["global", "thread", "file"].includes(entry.type)
    ) {
      return fail("type must be global, thread, or file.");
    }
    if (kinds.has(entry.type)) fail(`duplicate ${entry.type} entrypoint.`);
    kinds.add(entry.type);
    if (entry.type === "file") {
      if (
        !Array.isArray(entry.extensions) ||
        entry.extensions.length === 0 ||
        entry.extensions.some(
          (extension: unknown) =>
            typeof extension !== "string" ||
            !/^\.[^.,/\\\s]+(?:\.[^.,/\\\s]+)*$/.test(extension)
        )
      ) {
        fail(
          "file extensions must be non-empty HTML accept-style extensions beginning with a dot (for example .csv)."
        );
      }
    }
  }
  const existing = definition._meta?.[META_KEY];
  if (existing !== undefined && !record(existing)) {
    fail('raw _meta["openai/ui"] must be an object.');
  }
  if (
    record(existing) &&
    Object.hasOwn(existing, "entrypoints") &&
    !sameJson(existing["entrypoints"], entrypoints)
  ) {
    fail('view.entrypoints conflicts with raw _meta["openai/ui"].entrypoints.');
  }
  const input = resolveToolInputSchema(definition);
  const root = input?.["~standard"].jsonSchema.input({
    target: "draft-2020-12",
  }) ?? { type: "object" };
  const schema = resolveSchema(root, root);
  if (schema["type"] !== "object") fail("inputSchema must describe an object.");
  // Input JSON Schema preserves optional/defaulted fields. Output JSON Schema
  // may mark a defaulted field required, even though the host can omit it.
  const acceptsEmpty = kinds.has("global") || kinds.has("thread");
  if (acceptsEmpty && required(schema).length > 0) {
    fail(
      "global and thread launchers must accept {} (no required input fields)."
    );
  }
  if (kinds.has("file")) {
    const properties = record(schema["properties"]) ? schema["properties"] : {};
    const file = resolveSchema(properties["file"], root);
    const fileProperties = record(file["properties"]) ? file["properties"] : {};
    if (
      (!acceptsEmpty && !required(schema).includes("file")) ||
      required(schema).some((key) => key !== "file") ||
      file["type"] !== "object" ||
      required(file).some((key) => !["name", "resourceUri"].includes(key)) ||
      !["name", "resourceUri"].every(
        (key) =>
          required(file).includes(key) &&
          resolveSchema(fileProperties[key], root)["type"] === "string"
      )
    ) {
      fail(
        "file launchers require { file: { name: string, resourceUri: string } } with no other required fields; outer file may be optional when global/thread launchers are also declared."
      );
    }
  }
}

/** Merge typed entrypoints while preserving unrelated vendor metadata. @internal */
export function buildEntrypointMeta(
  definition: ToolDefinition
): MetaObject | undefined {
  const entrypoints = definition.view?.entrypoints;
  if (entrypoints === undefined) return definition._meta;
  const existing = definition._meta?.[META_KEY];
  return {
    ...definition._meta,
    [META_KEY]: {
      ...(record(existing) ? existing : {}),
      entrypoints: entrypoints.map((entry) =>
        entry.type === "file"
          ? { type: entry.type, extensions: [...entry.extensions] }
          : { type: entry.type }
      ),
    },
  };
}

/** Validate the host file contract before an entrypoint callback runs. @internal */
export function validateEntrypointInput(
  definition: ToolDefinition,
  args: Record<string, unknown>
): void {
  const entrypoints = definition.view?.entrypoints;
  if (!entrypoints?.some((entry) => entry.type === "file")) return;
  if (
    !Object.hasOwn(args, "file") &&
    entrypoints.some(
      (entry) => entry.type === "global" || entry.type === "thread"
    )
  )
    return;
  const file = args["file"];
  if (
    !record(file) ||
    typeof file["name"] !== "string" ||
    file["name"].length === 0 ||
    typeof file["resourceUri"] !== "string" ||
    file["resourceUri"].trim().length === 0
  ) {
    throw new ProtocolError(
      INVALID_PARAMS,
      "File entrypoint requires a non-empty file.name and non-blank file.resourceUri."
    );
  }
}
