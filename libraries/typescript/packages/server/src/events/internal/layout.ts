/**
 * Layout-1 key families as data (PLAN.md Appendix B). Locked by
 * `contracts/events/layout-1.json`. Every key is `{prefix}ev:{<ns16>}:<family>…`;
 * the key codec (WP-12) builds keys from these templates.
 *
 * Placeholders: `{ns}` hash tag, `{n}` percent-encoded name, `{id}`
 * subscription id, `{did}` direct id, `{h}` `h(…)` digest, `{jobId}`,
 * `{host}`, `{minute}`.
 *
 * @internal
 */

/** Storage primitive a family uses. */
export type LayoutKind = "kv" | "idx" | "log" | "signal";

/** One key family. */
export interface LayoutFamily {
  family: string;
  kind: LayoutKind;
  template: string;
  /** Human expiry rule. */
  expiry: string;
}

/** The layout version these families define. */
export const LAYOUT_VERSION = 1 as const;

/** Every layout-1 key family. */
export const LAYOUT_1: readonly LayoutFamily[] = [
  { family: "meta", kind: "kv", template: "ev:{ns}:meta", expiry: "none" },
  {
    family: "closed",
    kind: "kv",
    template: "ev:{ns}:closed",
    expiry: "none; 7d after purge",
  },
  {
    family: "catalog",
    kind: "kv",
    template: "ev:{ns}:catalog",
    expiry: "none",
  },
  {
    family: "catalog-missing",
    kind: "kv",
    template: "ev:{ns}:catalog:missing",
    expiry: "none",
  },
  {
    family: "lock-sweep",
    kind: "kv",
    template: "ev:{ns}:lock:sweep",
    expiry: "55s",
  },
  {
    family: "log",
    kind: "log",
    template: "ev:{ns}:log:{n}",
    expiry: "D49 retention",
  },
  {
    family: "emit-dedupe",
    kind: "kv",
    template: "ev:{ns}:emit:{n}:{h}",
    expiry: "24h",
  },
  {
    family: "fanout-due",
    kind: "idx",
    template: "ev:{ns}:fanout-due",
    expiry: "-",
  },
  {
    family: "fanout",
    kind: "kv",
    template: "ev:{ns}:fanout:{n}",
    expiry: "deleted with the log",
  },
  {
    family: "lock-fanout",
    kind: "kv",
    template: "ev:{ns}:lock:fanout:{n}",
    expiry: "30s",
  },
  {
    family: "sub",
    kind: "kv",
    template: "ev:{ns}:sub:{id}",
    expiry: "expiresAt + 7d",
  },
  {
    family: "status",
    kind: "kv",
    template: "ev:{ns}:status:{id}",
    expiry: "as the record",
  },
  { family: "op", kind: "kv", template: "ev:{ns}:op:{id}", expiry: "60s" },
  {
    family: "by-name",
    kind: "idx",
    template: "ev:{ns}:by-name:{n}",
    expiry: "swept",
  },
  {
    family: "by-name-partition",
    kind: "idx",
    template: "ev:{ns}:by-name:{n}:p:{h}",
    expiry: "swept",
  },
  {
    family: "by-name-unpartitioned",
    kind: "idx",
    template: "ev:{ns}:by-name:{n}:p:*",
    expiry: "swept",
  },
  {
    family: "by-principal",
    kind: "idx",
    template: "ev:{ns}:by-principal:{h}",
    expiry: "swept",
  },
  {
    family: "expiry",
    kind: "idx",
    template: "ev:{ns}:expiry",
    expiry: "swept",
  },
  {
    family: "inflight",
    kind: "idx",
    template: "ev:{ns}:inflight:{id}",
    expiry: "with the subscription",
  },
  {
    family: "tomb",
    kind: "kv",
    template: "ev:{ns}:tomb:{id}",
    expiry: "old refreshBefore",
  },
  {
    family: "anon-url",
    kind: "kv",
    template: "ev:{ns}:anon:{h}",
    expiry: "swept",
  },
  {
    family: "anon-count",
    kind: "kv",
    template: "ev:{ns}:anon:count",
    expiry: "swept",
  },
  {
    family: "verified",
    kind: "kv",
    template: "ev:{ns}:verified:{h}",
    expiry: "24h",
  },
  {
    family: "verifyfail",
    kind: "kv",
    template: "ev:{ns}:verifyfail:{h}",
    expiry: "60s",
  },
  {
    family: "rl-verify-principal",
    kind: "kv",
    template: "ev:{ns}:rl:verify:{h}:{host}:{minute}",
    expiry: "60-120s",
  },
  {
    family: "rl-verify-host",
    kind: "kv",
    template: "ev:{ns}:rl:verify:{host}:{minute}",
    expiry: "60-120s",
  },
  {
    family: "inflight-verify",
    kind: "kv",
    template: "ev:{ns}:inflight-verify:{host}",
    expiry: "60-120s",
  },
  { family: "cb", kind: "kv", template: "ev:{ns}:cb:{host}", expiry: "10min" },
  {
    family: "attempts",
    kind: "log",
    template: "ev:{ns}:attempts:{id}",
    expiry: "maxEvents 20",
  },
  {
    family: "job",
    kind: "kv",
    template: "ev:{ns}:job:{jobId}",
    expiry: "7d safety",
  },
  { family: "due", kind: "idx", template: "ev:{ns}:due", expiry: "-" },
  {
    family: "dead",
    kind: "kv",
    template: "ev:{ns}:dead:{jobId}",
    expiry: "retry.deadLetterTtl",
  },
  {
    family: "dead-idx",
    kind: "idx",
    template: "ev:{ns}:dead",
    expiry: "swept",
  },
  {
    family: "lease",
    kind: "kv",
    template: "ev:{ns}:lease:{did}",
    expiry: "expiresAt + 7d",
  },
  {
    family: "lease-expiry",
    kind: "idx",
    template: "ev:{ns}:lease-expiry",
    expiry: "swept",
  },
  {
    family: "lease-by-name",
    kind: "idx",
    template: "ev:{ns}:lease-by-name:{n}",
    expiry: "swept",
  },
  { family: "wake", kind: "signal", template: "ev:{ns}:wake", expiry: "-" },
];

/** Job id prefixes: deliver, control, hook, replay. */
export const JOB_ID_PREFIXES = {
  deliver: "d.",
  control: "c.",
  hook: "h.",
  replay: "r.",
} as const;

/** Score used for "no expiry" in indexes. */
export const NO_EXPIRY_SCORE = 9e15;
