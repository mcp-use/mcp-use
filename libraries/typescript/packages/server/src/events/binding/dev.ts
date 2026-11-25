/**
 * The dev binding (PLAN.md §8.5, D44): file storage under the CLI state
 * directory, the dev namespace, no record sealing. The CLI hands the dev
 * runtime plain data (WP-27); this module turns it into a storage target.
 *
 * @internal
 */

import type { StorageUrlTarget } from "../../storage/url.js";

/** What the CLI dev runtime provides. */
export interface DevRuntimeInfo {
  /** `.mcp-use/state` directory of the workspace. */
  stateDir: string;
  /** Dev workspace id, used as namespace. */
  workspace: string;
  /** Per-process dev token for the internal routes (D41). */
  token?: string;
}

/** A planned dev binding. */
export interface DevBindingPlan {
  target: StorageUrlTarget;
  namespace: string;
  /** Always true: the dev store is never sealed (D22). */
  unsealed: true;
}

/**
 * Plan the dev binding.
 *
 * @param info - Dev runtime data from the CLI.
 */
export function planDevBinding(info: DevRuntimeInfo): DevBindingPlan {
  const dir = info.stateDir.replace(/\/+$/, "");
  return {
    target: { kind: "file", path: `${dir}/events`, prefix: "" },
    namespace: `dev:${info.workspace}`,
    unsealed: true,
  };
}
