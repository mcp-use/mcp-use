import type { ToolRef } from "../tools.js";
import type { UiPermissions, ViewMetadata } from "../views/types.js";

/** Augmented by the project's `register.d.ts`; empty by default. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentional augmentation target
export interface Register {}

type RegisteredToolsModule = Register extends { tools: infer M }
  ? M
  : Record<never, never>;

type ToolsFromModule<M> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ToolRef conditional inference requires `any` in the constraint position (spec)
  [K in keyof M as M[K] extends ToolRef<infer N, any, any> ? N : never]: M[K] extends ToolRef<
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
 */
export type RegisteredTools = ToolsFromModule<RegisteredToolsModule>;

/**
 * Props of the component bound to tool `Name`: the tool's inferred output type.
 */
export type ViewProps<Name extends keyof RegisteredTools> =
  RegisteredTools[Name]["output"];

/**
 * Props of the optional `Loading` export: the streaming pre-result window.
 */
export type LoadingProps<Name extends keyof RegisteredTools> = {
  partialInput?: DeepPartial<RegisteredTools[Name]["input"]>;
  isStreaming: boolean;
};

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

export type { UiPermissions, ViewMetadata };
