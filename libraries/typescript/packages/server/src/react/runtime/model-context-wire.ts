import type { ContentBlock } from "@modelcontextprotocol/server";
import { ContentBlockSchema, IconSchema } from "@modelcontextprotocol/core";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { ModelContextBlock } from "../types/model-context.js";
import {
  canonicalContext,
  copyContext,
  type ContextPayload,
} from "./model-context.js";

/** OpenAI extension key shared by capability, result metadata and readback. @internal */
export const MODEL_CONTEXT_EXTENSION = "openai/modelContext";

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

/** Normalize convenience fields, preserving raw metadata and annotations. @internal */
export function normalizeContextBlock(input: ModelContextBlock): ContentBlock {
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
    if (input.type !== "text" && input.type !== "image")
      throw new TypeError("Only text, image and resource_link support title");
    if (typeof block.title !== "string")
      throw new TypeError("Model context title must be a string");
    merge(meta, "openai/title", block.title);
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
  if (meta["openai/title"] !== undefined) {
    if (
      (input.type !== "text" && input.type !== "image") ||
      typeof meta["openai/title"] !== "string" ||
      !meta["openai/title"]
    )
      throw new TypeError(
        "OpenAI title requires a nonempty text or image title"
      );
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
      content,
      ...(state.structuredContent !== undefined && {
        structuredContent: state.structuredContent as Record<string, unknown>,
      }),
    },
  });
}

/** Parse the acknowledgment without treating updateId as a clock or CAS token. @internal */
export function contextUpdateId(result: unknown): string {
  const meta = (result as { _meta?: Record<string, unknown> } | undefined)
    ?._meta;
  const id = (
    meta?.[MODEL_CONTEXT_EXTENSION] as { updateId?: unknown } | undefined
  )?.updateId;
  if (typeof id !== "string" || !id)
    throw new Error(
      "Missing OpenAI model context acknowledgment updateId; publication outcome is uncertain"
    );
  return id;
}
