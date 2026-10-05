import type { ContentBlock } from "@modelcontextprotocol/server";
import { ContentBlockSchema, IconSchema } from "@modelcontextprotocol/core";
import type { App } from "@modelcontextprotocol/ext-apps";
import { publicAsset } from "../public-assets.js";
import type { ModelContextBlock } from "../types/model-context.js";
import {
  canonicalContext,
  copyContext,
  type ContextPayload,
} from "./model-context.js";

/** OpenAI extension key shared by capability, result metadata and readback. @internal */
export const MODEL_CONTEXT_EXTENSION = "openai/modelContext";

const RESOURCE_TITLE = "mcp-use/title";
const presentationCache = new WeakMap<
  ContentBlock,
  ModelContextBlock & ContentBlock
>();

/** Decode friendly presentation without changing the canonical wire block. @internal */
export function presentContextBlock(
  block: ContentBlock
): ModelContextBlock & ContentBlock {
  const cached = presentationCache.get(block);
  if (cached) return cached;
  const meta = block._meta;
  // A resource-link title is native. Unrelated metadata never overrides it.
  const title =
    block.type === "resource_link"
      ? block.title
      : meta?.[block.type === "resource" ? RESOURCE_TITLE : "openai/title"];
  const presented = copyContext({
    ...block,
    ...(typeof title === "string" && { title }),
    ...(block.annotations?.audience && {
      audience: block.annotations.audience,
    }),
    ...(block.type === "text" &&
      meta?.["openai/thumbnail"] !== undefined && {
        thumbnail: meta["openai/thumbnail"],
      }),
  }) as ModelContextBlock & ContentBlock;
  presentationCache.set(block, presented);
  return presented;
}

/** Validated whole-context observation, with opaque revision identity. @internal */
export interface ContextObservation {
  /** Identifies a whole host revision; never sortable or per-item identity. */
  updateId: string;
  /** Whether this observation supplied content, rather than only a revision. */
  contentProvided: boolean;
  /** Whether this observation supplied structured background. */
  structuredProvided: boolean;
  /** Complete host context, including background state. */
  payload: ContextPayload;
}

/** Normalize author input separately from strict native host readback. @internal */
export function normalizeContextInput(input: ModelContextBlock): {
  /** Validated native presentation; source image bytes are filled after fetching. */
  block: ContentBlock;
  /** Resolved image URL, when conversion is required. */
  source?: string;
} {
  if (input.type === "image" && "src" in input) {
    if (typeof input.src !== "string" || !input.src.trim())
      throw new TypeError("Image src must be a nonempty string");
    if ("data" in input || "mimeType" in input)
      throw new TypeError("Image src and data/mimeType are mutually exclusive");
    const { src, ...fields } = input;
    return {
      source: publicAsset(src),
      block: normalizeContextBlock({
        ...fields,
        data: "AA==",
        mimeType: "image/png",
      }),
    };
  }
  const block =
    input.type === "text" && input.thumbnail
      ? {
          ...input,
          thumbnail: {
            ...input.thumbnail,
            src: publicAsset(input.thumbnail.src),
          },
        }
      : input;
  return { block: normalizeContextBlock(block) };
}

/** Normalize convenience fields, preserving raw metadata and annotations. @internal */
export function normalizeContextBlock(input: ModelContextBlock): ContentBlock {
  if ("src" in input)
    throw new TypeError(
      "Native model context requires image data and mimeType"
    );
  const block = { ...input } as Record<string, unknown>;
  const meta = { ...(input._meta ?? {}) };
  const annotations = { ...(input.annotations ?? {}) };
  const merge = (
    target: Record<string, unknown>,
    key: string,
    value: unknown
  ) => {
    if (value === undefined) return;
    if (
      target[key] !== undefined &&
      canonicalContext(target[key]) !== canonicalContext(value)
    ) {
      throw new TypeError(`Conflicting model context ${key}`);
    }
    target[key] = value;
  };
  if (!["text", "image", "resource_link", "resource"].includes(input.type)) {
    throw new TypeError(`Unsupported model context block type: ${input.type}`);
  }
  if (block.title !== undefined && input.type !== "resource_link") {
    if (typeof block.title !== "string" || !block.title.trim())
      throw new TypeError("Model context title must be a nonempty string");
    merge(
      meta,
      input.type === "resource" ? RESOURCE_TITLE : "openai/title",
      block.title
    );
    delete block.title;
  }
  if (block.thumbnail !== undefined) {
    if (input.type !== "text")
      throw new TypeError("Only text context supports thumbnail");
    IconSchema.parse(block.thumbnail);
    merge(meta, "openai/thumbnail", block.thumbnail);
    delete block.thumbnail;
  }
  merge(annotations, "audience", block.audience);
  delete block.audience;
  if (Object.keys(meta).length) block._meta = meta;
  if (Object.keys(annotations).length) block.annotations = annotations;
  if (
    meta["openai/title"] !== undefined &&
    (input.type === "text" || input.type === "image")
  ) {
    if (typeof meta["openai/title"] !== "string" || !meta["openai/title"])
      throw new TypeError(
        "OpenAI title requires a nonempty text or image title"
      );
  }
  if (
    input.type === "resource" &&
    meta[RESOURCE_TITLE] !== undefined &&
    (typeof meta[RESOURCE_TITLE] !== "string" || !meta[RESOURCE_TITLE].trim())
  ) {
    throw new TypeError("Embedded resource title must be a nonempty string");
  }
  if (meta["openai/thumbnail"] !== undefined) {
    if (input.type !== "text")
      throw new TypeError("Only text context supports thumbnail");
    IconSchema.parse(meta["openai/thumbnail"]);
  }
  // Validate without using the parsed output, which may strip extension fields.
  ContentBlockSchema.parse(block);
  return copyContext(block as ContentBlock);
}

/** Validate the entire replacement against negotiated modalities. @internal */
export function assertContextSupport(app: App, payload: ContextPayload): void {
  const support = app.getHostCapabilities()?.updateModelContext;
  if (!support) throw new Error("This host does not support model context");
  for (const block of payload.content) {
    const modality =
      block.type === "resource_link" ? "resourceLink" : block.type;
    if (!(support as Record<string, unknown>)[modality]) {
      throw new Error(`This host does not support ${block.type} context`);
    }
  }
  if (payload.structuredContent !== undefined && !support.structuredContent) {
    throw new Error("This host does not support structured model context");
  }
}

/** Distinguish absent, cleared, and malformed host state. @internal */
export function readContextObservation(
  value: unknown
): ContextObservation | null {
  if (value === null) return null;
  if (!value || typeof value !== "object")
    throw new Error("Malformed OpenAI model context readback");
  const state = value as Record<string, unknown>;
  if (typeof state.updateId !== "string" || !state.updateId)
    throw new Error("Missing OpenAI model context updateId");
  if (state.content !== undefined && !Array.isArray(state.content))
    throw new Error("Malformed model context content");
  const content = (state.content ?? []) as ModelContextBlock[];
  for (const block of content) normalizeContextBlock(block);
  if (
    state.structuredContent !== undefined &&
    (!state.structuredContent ||
      typeof state.structuredContent !== "object" ||
      Array.isArray(state.structuredContent))
  ) {
    throw new Error("Malformed structured model context");
  }
  return copyContext({
    updateId: state.updateId,
    contentProvided: state.content !== undefined,
    structuredProvided: state.structuredContent !== undefined,
    payload: {
      content: content as ContentBlock[],
      ...(state.structuredContent !== undefined && {
        structuredContent: state.structuredContent as Record<string, unknown>,
      }),
    },
  });
}

/** Read optional response correlation; successful RPCs need not return an ID. @internal */
export function contextUpdateId(result: unknown): string | undefined {
  const meta = (result as { _meta?: Record<string, unknown> } | undefined)
    ?._meta;
  const id = (
    meta?.[MODEL_CONTEXT_EXTENSION] as { updateId?: unknown } | undefined
  )?.updateId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}
