import { ResourceLinkSchema } from "@modelcontextprotocol/core";
import {
  fromJsonSchema,
  type MetaObject,
  type ResourceLink,
} from "@modelcontextprotocol/server";
import type { ToolDefinition } from "./tools.js";

/** Search text supplied by the composer; empty and whitespace queries are valid. */
export interface MentionSearchParams {
  /** Application-owned search text, passed through without normalization. */
  query: string;
}

/** App-owned resource identities suggested by a mention search. */
export interface MentionSearchResult {
  /** Authorized links in application-defined order; an empty list means no matches. */
  items: ResourceLink[];
}

/** Register an ordinary tool for native composer mention search. */
export interface MentionsRegistration<Ctx, Name extends string = string> {
  /** Non-blank tool name, unique among existing registrations. */
  name: Name;
  /** Optional human-readable tool title. */
  title?: string;
  /** Optional explanation of the searchable items. */
  description?: string;
  /** Tool icons, resolved by the ordinary tool pipeline. */
  icons?: NonNullable<ToolDefinition["icons"]>;
  /** Tool annotations; search is read-only by default. */
  annotations?: NonNullable<ToolDefinition["annotations"]>;
  /** Descriptor metadata; unrelated UI and extension fields are preserved. */
  _meta?: NonNullable<ToolDefinition["_meta"]>;
  /** Explicit visibility; app visibility is always included. */
  visibility?: NonNullable<ToolDefinition["visibility"]>;
  /** Authorize, rank, and limit results using the ordinary request context and signal. */
  search: (
    params: MentionSearchParams,
    ctx: Ctx
  ) => MentionSearchResult | Promise<MentionSearchResult>;
}

const inputSchema = fromJsonSchema<{ query: string }>({
  type: "object",
  properties: { query: { type: "string" } },
  required: ["query"],
});
const outputSchema = fromJsonSchema<MentionSearchResult>({
  type: "object",
  properties: {
    items: {
      type: "array",
      items: ResourceLinkSchema["~standard"].jsonSchema.output({
        target: "draft-2020-12",
      }),
    },
  },
  required: ["items"],
});

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Generate schemas and the owned mention marker without invoking search. @internal */
export function prepareMentions<Ctx, Name extends string>(
  options: MentionsRegistration<Ctx, Name>
) {
  if (typeof options.name !== "string" || !options.name.trim())
    throw new TypeError("Mention tool name must be a non-blank string");
  if (typeof options.search !== "function")
    throw new TypeError("Mention search must be a callback");
  const { search: _search, ...descriptor } = options;
  return {
    ...descriptor,
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: true, ...options.annotations },
    _meta: {
      ...options._meta,
      "openai/extensions": {
        ...record(options._meta?.["openai/extensions"]),
        "mentions/search": {},
      },
    },
  };
}

/** Restore mention visibility after ordinary view URI ownership is resolved. @internal */
export function finalizeMentionsMeta(
  definition: ToolDefinition,
  metadata: MetaObject | undefined
): MetaObject {
  const rawUi = record(definition._meta?.["ui"]);
  const visibility: readonly unknown[] =
    definition.visibility !== undefined
      ? [definition.visibility]
      : Array.isArray(rawUi["visibility"])
        ? rawUi["visibility"]
        : [];
  return {
    ...metadata,
    ui: {
      ...record(metadata?.["ui"]),
      visibility: [...new Set([...visibility, "app"])],
    },
  };
}
