/**
 * Small helpers shared by the check modules.
 *
 * @packageDocumentation
 */

import type { Ctx } from "../context.js";
import { describe, type RpcExchange } from "../http.js";
import type {
  CheckResult,
  ConformanceCheck,
  ConformanceLevel,
  ConformanceProfile,
  Harness,
} from "../types.js";

/** A passing result. */
export const pass = (detail?: string): CheckResult =>
  detail === undefined ? { outcome: "pass" } : { outcome: "pass", detail };
/** A failing result. */
export const fail = (detail: string): CheckResult => ({
  outcome: "fail",
  detail,
});
/** A skipped result. */
export const skip = (detail: string): CheckResult => ({
  outcome: "skip",
  detail,
});

/** Thrown inside a check to end it with a result. */
export class Outcome extends Error {
  /** @param result - The result the check ends with. */
  constructor(readonly result: CheckResult) {
    super(result.detail ?? result.outcome);
  }
}

/** The internal harness, or an error when a foreign harness is passed. */
export function ctx(h: Harness): Ctx {
  if (typeof (h as Partial<Ctx>).call !== "function") {
    throw new Outcome(skip("check needs the runner's harness"));
  }
  return h as Ctx;
}

/** Definition shape: `run` receives the internal harness. */
export interface CheckDef {
  id: string;
  profiles: readonly ConformanceProfile[];
  level: ConformanceLevel;
  cite: string;
  levelFor?: ConformanceCheck["levelFor"];
  run(c: Ctx): Promise<CheckResult>;
}

/** Turns a definition into a catalog entry; the family is the id's first segment. */
export function check(d: CheckDef): ConformanceCheck {
  const out: ConformanceCheck = {
    id: d.id,
    profiles: d.profiles,
    level: d.level,
    cite: d.cite,
    family: d.id.split("-")[0] ?? d.id,
    run: async (h) => {
      try {
        return await d.run(ctx(h));
      } catch (e) {
        if (e instanceof Outcome) return e.result;
        throw e;
      }
    },
  };
  if (d.levelFor) out.levelFor = d.levelFor;
  return out;
}

/** Ends the check unless `x` carries a result. */
export function resultOf(
  x: RpcExchange,
  what: string
): Record<string, unknown> {
  const r = x.response?.result;
  if (!r)
    throw new Outcome(fail(`${what}: expected a result, got ${describe(x)}`));
  return r;
}

/** Whether `x` is a JSON-RPC error with `code` (and HTTP `status`, when given). */
export function isError(
  x: RpcExchange,
  code: number,
  status?: number
): boolean {
  if (status !== undefined && x.status !== status) return false;
  return x.response?.error?.code === code;
}

/** A mismatch detail for an expected error. */
export function expectedError(
  x: RpcExchange,
  code: number,
  status?: number
): string {
  return `expected ${status === undefined ? "" : `HTTP ${status}, `}error ${code}; got ${describe(x)}`;
}
