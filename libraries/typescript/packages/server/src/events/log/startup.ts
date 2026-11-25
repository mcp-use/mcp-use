/**
 * The Events startup line (PLAN.md §8.5), printed once, also emitted as the
 * `{"type":"backend"}` log record.
 *
 * @internal
 */

/** Facts printed on the startup line. */
export interface StartupFacts {
  binding: "user" | "dev" | "platform" | "memory" | "inert";
  platformName?: string;
  kind: string;
  prefix?: string;
  namespace?: string;
  nsHash?: string;
  layout: 1 | null;
  sender: string;
  worker: "pump" | "lazy-pump" | "tick" | "scheduled" | "off";
  /** For example `"on(1h)"`. */
  push: string;
  pollIntervalMs: number;
  mcpName: "lenient" | "strict";
  sdkBundled: string;
  sdkExternal?: string;
}

function dur(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

/**
 * Format the push knob as on the startup line.
 *
 * @param push - Resolved push mode.
 * @param maxMs - Max stream duration; null unlimited.
 */
export function formatPush(
  push: "auto" | "on" | "off",
  maxMs: number | null | undefined
): string {
  if (push === "off") return "off";
  if (maxMs === null) return `${push}(unlimited)`;
  if (maxMs === undefined) return push;
  return `${push}(${dur(maxMs)})`;
}

/**
 * The startup line.
 *
 * @param f - Startup facts.
 */
export function formatStartupLine(f: StartupFacts): string {
  const binding =
    f.binding === "platform" && f.platformName !== undefined
      ? `platform(${f.platformName})`
      : f.binding;
  const parts = [`binding=${binding}`, `kind=${f.kind}`];
  if (f.prefix !== undefined && f.prefix !== "")
    parts.push(`prefix=${f.prefix}`);
  if (f.namespace !== undefined)
    parts.push(
      `ns=${f.namespace}${f.nsHash !== undefined ? `(${f.nsHash.slice(0, 4)}…)` : ""}`
    );
  parts.push(
    `layout=${f.layout ?? "-"}`,
    `sender=${f.sender}`,
    `worker=${f.worker}`,
    `push=${f.push}`,
    `poll=${dur(f.pollIntervalMs)}`,
    `mcpName=${f.mcpName}`,
    `sdk.bundled=${f.sdkBundled}`,
    `sdk.external=${f.sdkExternal ?? "-"}`
  );
  return `events: ${parts.join(" ")}`;
}
