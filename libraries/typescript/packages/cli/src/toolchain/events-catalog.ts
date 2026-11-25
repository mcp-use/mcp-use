/**
 * The build manifest's Events catalog and its diff (PLAN.md §11.5). The
 * shape is restated structurally from `mcp-use`'s `catalog-snapshot.ts`
 * because the CLI does not depend on `mcp-use` (CODE-B1).
 *
 * @internal
 */

/** One event of {@link EventsCatalogSnapshot}. */
export interface EventsCatalogSnapshotEvent {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  payloadSchema: Record<string, unknown>;
  schemaHash: string;
  delivery: { webhook: boolean; push: boolean; poll: boolean };
  partitioned: boolean;
  scopes?: string[];
  replay: false | { maxAge: string; maxEvents: number };
  hooks: { onSubscribe: boolean; onUnsubscribe: boolean };
}

/** `BuildManifest.events`. */
export interface EventsCatalogSnapshot {
  version: 1;
  hash: string;
  events: EventsCatalogSnapshotEvent[];
}

/** One line of the build catalog diff. */
export interface BuildCatalogDiffLine {
  kind:
    | "removed"
    | "input_tightened"
    | "payload_incompatible"
    | "replay_disabled"
    | "added";
  name: string;
  detail?: string;
}

/** Whether `value` looks like a snapshot. */
export function isEventsCatalogSnapshot(
  value: unknown
): value is EventsCatalogSnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    Array.isArray((value as { events?: unknown }).events)
  );
}

type Schema = Record<string, unknown>;

function props(schema: Schema): Record<string, Schema> {
  const p = schema["properties"];
  return typeof p === "object" && p !== null
    ? (p as Record<string, Schema>)
    : {};
}
function required(schema: Schema): Set<string> {
  const r: unknown = schema["required"];
  return new Set(
    Array.isArray(r) ? r.filter((x): x is string => typeof x === "string") : []
  );
}
function typeOf(schema: Schema | undefined): string | undefined {
  const t: unknown = schema?.["type"];
  return Array.isArray(t)
    ? (t as unknown[]).map(String).sort().join("|")
    : typeof t === "string"
      ? t
      : undefined;
}

/**
 * Input tightening: a subscription valid before may be rejected now. Checks
 * newly required keys, removed keys when extra keys are forbidden, and
 * changed property types.
 */
function inputTightened(before: Schema, after: Schema): string | undefined {
  const req0 = required(before);
  for (const key of required(after))
    if (!req0.has(key)) return `"${key}" is now required`;
  const p0 = props(before);
  const p1 = props(after);
  if (after["additionalProperties"] === false)
    for (const key of Object.keys(p0))
      if (!(key in p1)) return `"${key}" is no longer accepted`;
  for (const [key, schema] of Object.entries(p1)) {
    const t0 = typeOf(p0[key]);
    const t1 = typeOf(schema);
    if (t0 !== undefined && t1 !== undefined && t0 !== t1)
      return `"${key}" changed type from ${t0} to ${t1}`;
  }
  return undefined;
}

/**
 * Payload incompatibility: an existing receiver may not accept the new
 * payloads. Checks removed or newly optional keys and changed types.
 */
function payloadIncompatible(
  before: Schema,
  after: Schema
): string | undefined {
  const p0 = props(before);
  const p1 = props(after);
  const req1 = required(after);
  for (const key of required(before)) {
    if (!(key in p1)) return `"${key}" was removed`;
    if (!req1.has(key)) return `"${key}" is no longer always present`;
  }
  for (const [key, schema] of Object.entries(p0)) {
    const t0 = typeOf(schema);
    const t1 = typeOf(p1[key]);
    if (t0 !== undefined && t1 !== undefined && t0 !== t1)
      return `"${key}" changed type from ${t0} to ${t1}`;
  }
  return undefined;
}

/**
 * Diff two snapshots. Lines are sorted by name, then kind. Unchanged events
 * produce no line.
 *
 * @param previous - The previous build's snapshot, if any.
 * @param next - This build's snapshot, if any.
 */
export function diffEventsCatalog(
  previous: EventsCatalogSnapshot | undefined,
  next: EventsCatalogSnapshot | undefined
): BuildCatalogDiffLine[] {
  const before = new Map((previous?.events ?? []).map((e) => [e.name, e]));
  const after = new Map((next?.events ?? []).map((e) => [e.name, e]));
  const lines: BuildCatalogDiffLine[] = [];
  for (const [name] of before)
    if (!after.has(name)) lines.push({ kind: "removed", name });
  for (const [name, event] of after) {
    const old = before.get(name);
    if (old === undefined) {
      lines.push({ kind: "added", name });
      continue;
    }
    const input = inputTightened(old.inputSchema, event.inputSchema);
    if (input !== undefined)
      lines.push({ kind: "input_tightened", name, detail: input });
    const payload = payloadIncompatible(old.payloadSchema, event.payloadSchema);
    if (payload !== undefined)
      lines.push({ kind: "payload_incompatible", name, detail: payload });
    if (old.replay !== false && event.replay === false)
      lines.push({
        kind: "replay_disabled",
        name,
        detail: "poll is no longer offered",
      });
  }
  return lines.sort((a, b) =>
    a.name === b.name ? a.kind.localeCompare(b.kind) : a.name < b.name ? -1 : 1
  );
}

const ADVICE: Record<BuildCatalogDiffLine["kind"], string> = {
  removed: "removed; existing subscriptions stop receiving events",
  input_tightened: "input schema tightened",
  payload_incompatible: "payload schema incompatible; use a new event name",
  replay_disabled: "replay turned off",
  added: "added",
};

/**
 * Human lines for `mcp-use build`. Non-additive changes are flagged with
 * `!`; the diff never fails the build.
 */
export function formatEventsCatalogDiff(
  lines: BuildCatalogDiffLine[]
): string[] {
  return lines.map(
    (line) =>
      `[mcp-use] events: ${line.kind === "added" ? "+" : "!"} ${line.name} ${ADVICE[line.kind]}${line.detail ? ` (${line.detail})` : ""}`
  );
}
