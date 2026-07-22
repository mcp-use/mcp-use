import type { ToolRef } from "../../tools.js";

/** Augmented by the project's `mcp-env.d.ts`; empty by default. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentional augmentation target
export interface Register {}

type RegisteredToolsModule = Register extends { tools: infer M }
  ? M
  : undefined;

type ToolsFromModule<M> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ToolRef conditional inference requires `any` in the constraint position (spec)
  [K in keyof M as M[K] extends ToolRef<infer N, any, any>
    ? N
    : never]: M[K] extends ToolRef<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- paired with the constraint above
    any,
    infer I,
    infer O
  >
    ? { input: I; output: O }
    : never;
};

/**
 * Map of registered tool names to their inferred input/output types, derived
 * from exported {@link ToolRef} values in the augmented {@link Register} module.
 *
 * Projects without an `mcp-env.d.ts` registration retain a loose string map so
 * existing non-scaffolded applications keep compiling. Once the module is
 * registered, only exported tool refs are accepted by typed React hooks; an
 * empty registered module therefore exposes no tool names.
 */
export type RegisteredTools = RegisteredToolsModule extends undefined
  ? Record<string, { input: Record<string, unknown>; output: unknown }>
  : ToolsFromModule<RegisteredToolsModule>;

/**
 * Recursive partial for streamed JSON: every field optional at every depth.
 *
 * Arrays may be shorter than final; string values may be truncated mid-token.
 * Provisional, render-only data — never act on it.
 */
export type DeepPartial<T> = T extends (infer E)[]
  ? DeepPartial<E>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
