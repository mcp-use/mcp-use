import { fromJsonSchema, type MetaObject } from "@modelcontextprotocol/server";

import { resolveToolInputSchema, type ToolDefinition } from "../tools.js";

const META_KEY = "openai/ui";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Check host launch payloads before registering a view binding. @internal */
export function validateEntrypointInput(definition: ToolDefinition): void {
  const entrypoints = definition.view?.entrypoints;
  if (!entrypoints?.length) return;
  const schema = resolveToolInputSchema(definition);
  // Use the input projection so optional/defaulted fields remain optional.
  // Application validators can be async or have side effects, and must only
  // run when the tool is invoked, not as a registration-time probe.
  const validate = schema
    ? fromJsonSchema(
        schema["~standard"].jsonSchema.input({ target: "draft-2020-12" })
      )["~standard"].validate
    : undefined;
  for (const entrypoint of entrypoints) {
    const payloads =
      entrypoint.type === "file"
        ? entrypoint.extensions.map((extension) => ({
            file: {
              name: `file${extension}`,
              resourceUri: "host-resource://opaque-handle",
            },
          }))
        : [{}];
    if (entrypoint.type === "file" && !validate) {
      throw new TypeError(
        `Tool "${definition.name}" file entrypoint requires an inputSchema accepting { file: { name, resourceUri } }.`
      );
    }
    for (const payload of payloads) {
      const result = validate?.(payload);
      if (result && ("then" in result || result.issues)) {
        throw new TypeError(
          `Tool "${definition.name}" ${entrypoint.type} entrypoint launch arguments do not satisfy its inputSchema.`
        );
      }
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
