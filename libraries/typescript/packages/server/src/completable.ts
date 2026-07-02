import {
  completable as sdkCompletable,
  type StandardSchemaV1,
} from "@modelcontextprotocol/server";

/** Context passed to completion callbacks. */
export interface CompletionContext {
  /** Other argument values from the same prompt, for contextual suggestions. */
  arguments?: Record<string, unknown>;
}

/** Callback form: return suggestions for the current (partial) value. */
export type CompletionCallback = (
  value: string,
  context?: CompletionContext
) => string[] | Promise<string[]>;

/**
 * Make a schema field completable so clients can request autocomplete
 * suggestions via `completion/complete`.
 *
 * Pass an array of allowed values for case-insensitive prefix matching, or a
 * callback for dynamic/contextual suggestions.
 *
 * Accepts any Standard Schema field ({@link StandardSchemaV1}); zod shown in
 * the example. Apply refinements like `.describe()` to the schema *argument*,
 * not to the completable result: refinements that clone the schema (as zod's
 * do) silently drop the SDK's completion marker. `.optional()` is the one
 * exception — the SDK unwraps optionals when looking for completions.
 *
 * @example
 * ```ts
 * schema: z.object({
 *   language: completable(
 *     z.string().describe("The programming language"),
 *     ["python", "typescript", "go"]
 *   ),
 * })
 * ```
 */
export function completable<T extends StandardSchemaV1>(
  schema: T,
  complete: ReadonlyArray<string | number | boolean> | CompletionCallback
): ReturnType<typeof sdkCompletable<T>> {
  if (typeof complete === "function") {
    return sdkCompletable(schema, (value, context) =>
      complete(String(value ?? ""), context)
    );
  }
  const values = complete.map(String);
  return sdkCompletable(schema, (value) => {
    const prefix = String(value ?? "").toLowerCase();
    return values.filter((v) => v.toLowerCase().startsWith(prefix));
  });
}
