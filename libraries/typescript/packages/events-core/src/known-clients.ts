/**
 * The known-client table (D54, Appendix E): versioned data that picks a
 * delivery profile and per-client settings for clients whose behaviour is
 * known from evidence. Rows run before the generic resolution rules, so a
 * known client keeps its profile whatever it starts to send.
 *
 * @packageDocumentation
 */

import { invalidPartialAxes, type ProfileAxes } from "./axes.js";
import type { EventsSignals, ProtocolEra } from "./signals.js";

/** A preset id from the preset registry, such as `openai@1`; parsed as an open string (D53). */
export type PresetId = "openai@1" | "sep-3415@1" | (string & {});

/** Which capability keys a modern-era `server/discover` advertises for a matched client (D8). */
export type AdvertiseKeys = "both" | "top" | "extension";

/** How a client should be emulated by the Inspector and by `@mcp-use/client`'s `dialect` option. */
export interface KnownClientEmulation {
  /** Whether to declare `extensions["io.modelcontextprotocol/events"]`. */
  declareExtension: boolean;
  /** Whether to send the `Mcp-Name` header on `events/*` requests. */
  sendMcpName: boolean;
  /** Whether to send the `Mcp-Method` header. */
  sendMcpMethod: boolean;
  /** The protocol eras the client uses. */
  eras: ReadonlyArray<ProtocolEra>;
  /** The `clientInfo` to send. */
  clientInfo: {
    /** `clientInfo.name`. */
    name: string;
    /** `clientInfo.version`. */
    version?: string;
  };
  /** The `User-Agent` to send. */
  userAgent?: string;
}

/**
 * One row of the known-client table. All present `match` fields must hold
 * (AND); alternatives are separate rows with unique ids.
 */
export interface KnownClientRule {
  /** Unique row id, for example `chatgpt`; reported as the resolution's `via` detail. */
  id: string;
  /** Conditions on the request signals; every present field must hold. */
  match: {
    /** Tested against `clientInfo.name`. */
    clientName?: RegExp;
    /** A semver range tested against `clientInfo.version` (`>=1.2 <2`, `^1.0.0`, `1.x || 2.x`). */
    clientVersion?: string;
    /** Tested against the `User-Agent` header. */
    userAgent?: RegExp;
    /** Tested against the callback URL's host (subscribe and unsubscribe only). */
    callbackHost?: RegExp;
    /** The request's protocol era. */
    era?: ProtocolEra;
    /** Whether the client declared the Events extension. */
    declaresExtension?: boolean;
    /** Whether the client sent an `Mcp-Method` header. */
    mcpMethodHeader?: boolean;
  };
  /** The preset this client gets. */
  preset: PresetId;
  /** Axis values that replace the preset's for this client. */
  overrides?: Partial<ProfileAxes>;
  /** Modern-era capability keys for this client (D8); default both. */
  advertise?: AdvertiseKeys;
  /** Default subscription lifetime when the client sends no `ttlMs` (D21). */
  ttlDefaultMs?: number;
  /** Webhook verification timeout for this client's callbacks (D29, D40). */
  verificationTimeoutMs?: number;
  /** What to do when a verification response echoes the whole body (D29). */
  antiReflection?: "warn" | "reject";
  /** Whether a missing `Mcp-Name` is accepted from this client (D9). */
  mcpName?: "lenient" | "strict";
  /** How emulators impersonate this client. */
  emulate?: KnownClientEmulation;
  /** Evidence for the row: a URL or document reference and the date it was read. */
  source: string;
}

/**
 * The built-in known-client rows, tried after `compatibility.knownClients`.
 * New evidence edits these rows; it never changes a global default.
 */
export const KNOWN_CLIENTS: readonly KnownClientRule[] = [
  {
    id: "chatgpt",
    match: { clientName: /^openai-mcp/i },
    preset: "openai@1",
    advertise: "both",
    emulate: {
      declareExtension: false,
      sendMcpName: false,
      sendMcpMethod: false,
      eras: ["legacy", "modern"],
      clientInfo: { name: "openai-mcp/1.0" },
    },
    source:
      "Alpic serves 2026-07-28 only to openai-mcp* clients (plans/mcp-events/supporting/13-skybridge-and-frameworks.md:165); OpenAI MCP Events page, read 2026-11-24",
  },
  {
    id: "chatgpt-callback",
    match: { callbackHost: /(^|\.)openai\.com$/ },
    preset: "openai@1",
    advertise: "both",
    source:
      "Callback host connectors.api.openai.com (plans/mcp-events/supporting/14-clients.md:60); OpenAI MCP Events page, read 2026-11-24",
  },
  {
    id: "tanstack-ai",
    match: { clientName: /^tanstack-ai-mcp$/ },
    preset: "sep-3415@1",
    overrides: { webhookId: "eventId", eventIdNormalization: "headerSafe" },
    source:
      'clientInfo.name default "tanstack-ai-mcp" in @tanstack/ai-mcp@1.3.1 dist/esm/client.js:29 (npm, read 2026-11-25); rejects webhook-id != eventId: modelcontextprotocol/ext-triggers-events#17 (Hookdeck, tested 2026-10-27/28)',
  },
  {
    id: "ai-sdk",
    match: { clientName: /^ai-sdk-mcp-client$/ },
    preset: "openai@1",
    source:
      'clientInfo.name default "ai-sdk-mcp-client" in @ai-sdk/mcp@2.0.104 dist/index.js:2453 (npm, read 2026-11-25); reads the top-level capabilities.events key and expects webhook-id = eventId (@ai-sdk/mcp 2.0.70, 2026-10-07; plans/mcp-events/supporting/14-clients.md:34)',
  },
];

function testPattern(pattern: RegExp, value: string): boolean {
  // A global or sticky RegExp keeps `lastIndex` between calls; test a fresh copy.
  if (pattern.global || pattern.sticky) {
    return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, "")).test(
      value
    );
  }
  return pattern.test(value);
}

/**
 * Tests whether a row's `match` holds for a request: every present field must
 * hold. A field that needs a signal the request lacks (no `clientInfo.name`,
 * no callback host) does not hold.
 *
 * @param rule - The known-client row.
 * @param signals - The request signals.
 * @returns `true` when every present `match` field holds.
 */
export function matchesKnownClient(
  rule: KnownClientRule,
  signals: EventsSignals
): boolean {
  const m = rule.match;
  const name = signals.clientInfo?.name;
  const version = signals.clientInfo?.version;
  if (m.clientName && (name === undefined || !testPattern(m.clientName, name)))
    return false;
  if (
    m.clientVersion !== undefined &&
    (version === undefined || !satisfiesRange(version, m.clientVersion))
  )
    return false;
  if (
    m.userAgent &&
    (signals.userAgent === undefined ||
      !testPattern(m.userAgent, signals.userAgent))
  )
    return false;
  if (
    m.callbackHost &&
    (signals.callbackHost === undefined ||
      !testPattern(m.callbackHost, signals.callbackHost))
  )
    return false;
  if (m.era !== undefined && m.era !== signals.era) return false;
  if (
    m.declaresExtension !== undefined &&
    m.declaresExtension !== signals.declaresEventsExtension
  )
    return false;
  if (
    m.mcpMethodHeader !== undefined &&
    m.mcpMethodHeader !== (signals.mcpMethod ?? false)
  )
    return false;
  return true;
}

/**
 * Finds the first row that matches a request. Pass user rows first, then
 * {@link KNOWN_CLIENTS}.
 *
 * @param signals - The request signals.
 * @param rows - Rows in priority order; defaults to {@link KNOWN_CLIENTS}.
 * @returns The first matching row, or `undefined`.
 */
export function findKnownClient(
  signals: EventsSignals,
  rows: readonly KnownClientRule[] = KNOWN_CLIENTS
): KnownClientRule | undefined {
  return rows.find((row) => matchesKnownClient(row, signals));
}

/** The outcome of {@link validateKnownClientRule}. */
export type KnownClientRuleCheck =
  | {
      /** The row is valid. */
      ok: true;
    }
  | {
      /** The row is invalid. */
      ok: false;
      /** The offending field path, for example `match.clientVersion`. */
      field: string;
      /** Why it is invalid. */
      reason: string;
    };

const MATCH_REGEXP_FIELDS = ["clientName", "userAgent", "callbackHost"];
const MATCH_BOOLEAN_FIELDS = ["declaresExtension", "mcpMethodHeader"];

function isPositiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Validates a known-client row from configuration (`compatibility.knownClients`):
 * field types, a non-empty `match`, a parseable `clientVersion` range, known
 * enum values and positive integer durations. The preset id is not checked
 * against the registry here (preset ids are open strings).
 *
 * @param rule - The row to validate, typically user configuration.
 * @returns `{ ok: true }`, or the first offending field and the reason.
 */
export function validateKnownClientRule(rule: unknown): KnownClientRuleCheck {
  const fail = (field: string, reason: string): KnownClientRuleCheck => ({
    ok: false,
    field,
    reason,
  });
  if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
    return fail("<root>", "a known-client row must be an object");
  }
  const row = rule as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id.length === 0) {
    return fail("id", "must be a non-empty string");
  }
  if (typeof row.preset !== "string" || row.preset.length === 0) {
    return fail("preset", "must be a non-empty preset id string");
  }
  if (typeof row.source !== "string" || row.source.length === 0) {
    return fail("source", "must name the evidence for the row");
  }
  const match = row.match;
  if (match === null || typeof match !== "object" || Array.isArray(match)) {
    return fail("match", "must be an object");
  }
  const matchRecord = match as Record<string, unknown>;
  const matchKeys = Object.keys(matchRecord).filter(
    (k) => matchRecord[k] !== undefined
  );
  if (matchKeys.length === 0) {
    return fail("match", "must contain at least one condition");
  }
  for (const key of matchKeys) {
    const value = matchRecord[key];
    if (MATCH_REGEXP_FIELDS.includes(key)) {
      if (!(value instanceof RegExp))
        return fail(`match.${key}`, "must be a RegExp");
    } else if (MATCH_BOOLEAN_FIELDS.includes(key)) {
      if (typeof value !== "boolean")
        return fail(`match.${key}`, "must be a boolean");
    } else if (key === "era") {
      if (value !== "legacy" && value !== "modern")
        return fail("match.era", 'must be "legacy" or "modern"');
    } else if (key === "clientVersion") {
      if (typeof value !== "string" || parseRange(value) === undefined)
        return fail("match.clientVersion", "must be a valid semver range");
    } else {
      return fail(`match.${key}`, "is not a known match field");
    }
  }
  if (row.overrides !== undefined) {
    const bad = invalidPartialAxes(row.overrides);
    if (bad !== undefined)
      return fail(
        bad === "<root>" ? "overrides" : `overrides.${bad}`,
        "must be a known axis with a value of the right type"
      );
  }
  if (
    row.advertise !== undefined &&
    row.advertise !== "both" &&
    row.advertise !== "top" &&
    row.advertise !== "extension"
  ) {
    return fail("advertise", 'must be "both", "top" or "extension"');
  }
  for (const key of ["ttlDefaultMs", "verificationTimeoutMs"]) {
    if (row[key] !== undefined && !isPositiveInteger(row[key]))
      return fail(key, "must be a positive integer of milliseconds");
  }
  if (
    row.antiReflection !== undefined &&
    row.antiReflection !== "warn" &&
    row.antiReflection !== "reject"
  ) {
    return fail("antiReflection", 'must be "warn" or "reject"');
  }
  if (
    row.mcpName !== undefined &&
    row.mcpName !== "lenient" &&
    row.mcpName !== "strict"
  ) {
    return fail("mcpName", 'must be "lenient" or "strict"');
  }
  if (row.emulate !== undefined) {
    const e = row.emulate as Record<string, unknown> | null;
    if (e === null || typeof e !== "object")
      return fail("emulate", "must be an object");
    for (const key of ["declareExtension", "sendMcpName", "sendMcpMethod"]) {
      if (typeof e[key] !== "boolean")
        return fail(`emulate.${key}`, "must be a boolean");
    }
    if (
      !Array.isArray(e.eras) ||
      e.eras.length === 0 ||
      !e.eras.every((era) => era === "legacy" || era === "modern")
    )
      return fail("emulate.eras", 'must list "legacy" and/or "modern"');
    const info = e.clientInfo as Record<string, unknown> | null | undefined;
    if (
      info === null ||
      typeof info !== "object" ||
      typeof info.name !== "string" ||
      info.name.length === 0
    )
      return fail("emulate.clientInfo", "must have a non-empty name");
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Minimal semver range matching for `match.clientVersion` (no dependency).
// Supports comparators (<, <=, >, >=, =), x-ranges (1.x, 1.2.*, *), caret,
// tilde, hyphen ranges (1.2 - 2.3) and `||` alternatives. Versions compare by
// semver precedence; a prerelease is lower than its release.
// ---------------------------------------------------------------------------

type Version = [number, number, number, string[]];
type Comparator = { op: "<" | "<=" | ">" | ">=" | "="; v: Version };

const VERSION_RE =
  /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const PARTIAL_RE =
  /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(text: string): Version | undefined {
  const m = VERSION_RE.exec(text.trim());
  if (!m) return undefined;
  return [
    Number(m[1]),
    Number(m[2] ?? 0),
    Number(m[3] ?? 0),
    m[4] ? m[4].split(".") : [],
  ];
}

function compareIdentifiers(a: string, b: string): number {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return Number(a) - Number(b);
  if (an) return -1;
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) return d;
  }
  const pa = a[3];
  const pb = b[3];
  if (pa.length === 0 || pb.length === 0) return pb.length - pa.length;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const d = compareIdentifiers(pa[i] as string, pb[i] as string);
    if (d !== 0) return d;
  }
  return 0;
}

type Partial3 = { parts: (number | undefined)[]; pre: string[] };

function parsePartial(text: string): Partial3 | undefined {
  const m = PARTIAL_RE.exec(text);
  if (!m) return undefined;
  const parts: (number | undefined)[] = [];
  for (const raw of [m[1], m[2], m[3]]) {
    if (raw === undefined || /^[xX*]$/.test(raw)) break;
    parts.push(Number(raw));
  }
  return { parts, pre: m[4] ? m[4].split(".") : [] };
}

function lower(p: Partial3): Version {
  return [p.parts[0] ?? 0, p.parts[1] ?? 0, p.parts[2] ?? 0, p.pre];
}

// The exclusive upper bound of a partial version ("1.2" → 1.3.0, "1" → 2.0.0).
function nextAfterPartial(p: Partial3): Version | undefined {
  const [a, b] = p.parts;
  if (p.parts.length === 0) return undefined;
  if (p.parts.length === 1) return [(a as number) + 1, 0, 0, []];
  if (p.parts.length === 2) return [a as number, (b as number) + 1, 0, []];
  return undefined;
}

function desugar(token: string): Comparator[] | undefined {
  const m = /^(<=|>=|<|>|=|\^|~)?\s*(.*)$/.exec(token);
  if (!m) return undefined;
  const op = m[1] ?? "";
  const p = parsePartial(m[2] as string);
  if (!p) return undefined;
  const n = p.parts.length;
  const lo = lower(p);
  const out: Comparator[] = [];
  switch (op) {
    case "":
    case "=": {
      if (n === 3) return [{ op: "=", v: lo }];
      if (n === 0) return [];
      out.push({ op: ">=", v: lo });
      out.push({ op: "<", v: nextAfterPartial(p) as Version });
      return out;
    }
    case "^": {
      const [a = 0, b = 0, c = 0] = p.parts;
      out.push({ op: ">=", v: lo });
      if (n === 0) return [];
      if (a > 0 || n === 1) out.push({ op: "<", v: [a + 1, 0, 0, []] });
      else if (b > 0 || n === 2) out.push({ op: "<", v: [0, b + 1, 0, []] });
      else out.push({ op: "<", v: [0, 0, c + 1, []] });
      return out;
    }
    case "~": {
      const [a = 0, b = 0] = p.parts;
      if (n === 0) return [];
      out.push({ op: ">=", v: lo });
      out.push({ op: "<", v: n === 1 ? [a + 1, 0, 0, []] : [a, b + 1, 0, []] });
      return out;
    }
    case ">":
      if (n === 0) return [{ op: "<", v: [0, 0, 0, []] }];
      return n === 3
        ? [{ op: ">", v: lo }]
        : [{ op: ">=", v: nextAfterPartial(p) as Version }];
    case ">=":
      return n === 0 ? [] : [{ op: ">=", v: lo }];
    case "<":
      return n === 0 ? [{ op: "<", v: [0, 0, 0, []] }] : [{ op: "<", v: lo }];
    case "<=":
      if (n === 0) return [];
      return n === 3
        ? [{ op: "<=", v: lo }]
        : [{ op: "<", v: nextAfterPartial(p) as Version }];
    default:
      return undefined;
  }
}

function parseRange(range: string): Comparator[][] | undefined {
  const sets: Comparator[][] = [];
  for (const alternative of range.split("||")) {
    const text = alternative.trim();
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(text);
    if (hyphen) {
      const from = parsePartial(hyphen[1] as string);
      const to = parsePartial(hyphen[2] as string);
      if (!from || !to) return undefined;
      const set: Comparator[] = [{ op: ">=", v: lower(from) }];
      const upper = nextAfterPartial(to);
      if (to.parts.length === 3) set.push({ op: "<=", v: lower(to) });
      else if (upper) set.push({ op: "<", v: upper });
      sets.push(set);
      continue;
    }
    const tokens =
      text === ""
        ? []
        : text.replace(/(<=|>=|<|>|=|\^|~)\s+/g, "$1").split(/\s+/);
    const set: Comparator[] = [];
    for (const token of tokens) {
      const comparators = desugar(token);
      if (!comparators) return undefined;
      set.push(...comparators);
    }
    sets.push(set);
  }
  return sets;
}

function holds(c: Comparator, v: Version): boolean {
  const d = compareVersions(v, c.v);
  switch (c.op) {
    case "<":
      return d < 0;
    case "<=":
      return d <= 0;
    case ">":
      return d > 0;
    case ">=":
      return d >= 0;
    default:
      return d === 0;
  }
}

/**
 * Tests a version against a semver range. Missing minor or patch parts of the
 * version count as `0` (`"1.4"` is `1.4.0`); an unparseable version or range
 * never satisfies. As in node-semver, a prerelease version (`2.0.0-beta.1`)
 * satisfies only a range that names a prerelease of the same `major.minor.patch`.
 *
 * @param version - The version, typically `clientInfo.version`.
 * @param range - A semver range such as `>=1.2.0 <2`, `^1.0.0`, `~2.1` or `1.x || 3.x`.
 * @returns `true` when the version is inside the range.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const v = parseVersion(version);
  const sets = parseRange(range);
  if (!v || !sets) return false;
  return sets.some(
    (set) =>
      set.every((c) => holds(c, v)) &&
      // node-semver: a prerelease version satisfies a comparator set only when
      // some comparator in it is a prerelease of the same major.minor.patch.
      (v[3].length === 0 ||
        set.some(
          (c) =>
            c.v[3].length > 0 &&
            c.v[0] === v[0] &&
            c.v[1] === v[1] &&
            c.v[2] === v[2]
        ))
  );
}
