#!/usr/bin/env node
// Live-validation recorder (PLAN.md D73, §20, WP-40).
//
//   node e2e/live/record.mjs <observations.json> [--write] [--matrix <path>]
//
// Turns the observations captured while running e2e/live/checklist.md into
//   1. rows for packages/events-core/src/data/signal-matrix.json (§20.2), one
//      per client and profile, each carrying `source` evidence, and
//   2. proposed KNOWN_CLIENTS edits derived from the V1-V18 answers (§20.1).
//
// TODO(events): align the row shape with the signal-matrix schema WP-01 ships
// in events-core (field names in SIGNAL_FIELDS mirror §20.2).
//
// Rule: results change data files only, never code. Without --write it prints
// the merged matrix diff and the proposals; with --write it updates the matrix
// file. KNOWN_CLIENTS edits are always printed for review, never applied.
//
// observations.json:
// {
//   "source": { "run": "live-2026-11-25-chatgpt", "url": "https://...", "date": "2026-11-25" },
//   "observations": [
//     { "client": "chatgpt", "profile": "web-work-chat",
//       "signals": { "era": "legacy", "declaration": false, "mcpName": false, ... },
//       "answers": { "V1": false, "V5": { "ttlMs": 86400000 }, ... } }
//   ]
// }
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MATRIX = join(
  HERE,
  "..",
  "..",
  "packages",
  "events-core",
  "src",
  "data",
  "signal-matrix.json"
);

/** Signal fields recorded per client (§20.2). Unknown keys are rejected. */
export const SIGNAL_FIELDS = [
  "era",
  "declaration",
  "mcpName",
  "mcpMethod",
  "mcpParam",
  "clientInfo",
  "userAgent",
  "callbackHost",
  "pathShape",
  "ttlMs",
  "refreshCadenceMs",
  "acceptsMsgIds",
  "errorCodes",
  "echoStyle",
  "modes",
  "sendsCursor",
  "honoursTruncated",
  "subscribeTimeoutMs",
  "dedupeByWebhookId",
  "unsubscribeOnPause",
  "notes",
];

export const QUESTIONS = Array.from({ length: 18 }, (_, i) => `V${i + 1}`);

function fail(msg) {
  throw new Error(msg);
}

export function validate(input) {
  const src = input?.source;
  if (!src || !(src.run || src.url))
    fail("source.run or source.url is required (evidence)");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(src.date ?? ""))
    fail("source.date must be YYYY-MM-DD");
  if (!Array.isArray(input.observations) || !input.observations.length)
    fail("observations must be a non-empty array");
  for (const [i, o] of input.observations.entries()) {
    if (typeof o.client !== "string" || !o.client)
      fail(`observations[${i}].client is required`);
    for (const k of Object.keys(o.signals ?? {}))
      if (!SIGNAL_FIELDS.includes(k))
        fail(`observations[${i}].signals.${k} is not a signal-matrix field`);
    for (const k of Object.keys(o.answers ?? {}))
      if (!QUESTIONS.includes(k))
        fail(`observations[${i}].answers.${k} is not one of V1-V18`);
  }
  return input;
}

const rowKey = (r) => `${r.client}\u0000${r.profile ?? ""}`;

/** Upsert observations into matrix rows; signals merge over the old row. */
export function mergeRows(matrix, input) {
  const rows = new Map((matrix.rows ?? []).map((r) => [rowKey(r), r]));
  const source = {
    ...(input.source.run ? { run: input.source.run } : {}),
    ...(input.source.url ? { url: input.source.url } : {}),
    date: input.source.date,
  };
  for (const o of input.observations) {
    const key = rowKey(o);
    const prev = rows.get(key);
    const row = {
      client: o.client,
      ...(o.profile ? { profile: o.profile } : {}),
      signals: { ...(prev?.signals ?? {}), ...(o.signals ?? {}) },
      answers: { ...(prev?.answers ?? {}), ...(o.answers ?? {}) },
      source,
    };
    rows.set(key, row);
  }
  const sorted = [...rows.values()].sort((a, b) =>
    rowKey(a) < rowKey(b) ? -1 : rowKey(a) > rowKey(b) ? 1 : 0
  );
  return { ...matrix, rows: sorted };
}

/**
 * Proposed KNOWN_CLIENTS edits from V answers (§20.1 "absorbed by" column).
 * Each proposal names the row, the field path and the value; `null` answers
 * (not observed) propose nothing.
 */
export function proposeKnownClientEdits(o) {
  const a = o.answers ?? {};
  const out = [];
  const add = (field, value, because) =>
    out.push({ client: o.client, field, value, because });
  // V1/V9: ChatGPT accepts webhook-id != eventId -> random ids are safe.
  if (a.V1 === false) add("overrides.webhookId", "random", "V1");
  if (a.V9 === false && a.V1 !== false)
    add("overrides.webhookId", "random", "V9");
  // V3: events not seen with only `extensions` -> keep both keys (no edit);
  // V15: both keys change behaviour -> advertise the top-level key only.
  if (a.V15 === true) add("advertise", "top", "V15");
  // V5: observed TTL.
  if (typeof a.V5?.ttlMs === "number") add("ttlDefaultMs", a.V5.ttlMs, "V5");
  // V6: rejects the sketch numbering -> documented codes.
  if (a.V6 === false) add("overrides.errorCodes", "documented", "V6");
  // V7: observed subscribe timeout.
  if (typeof a.V7?.timeoutMs === "number")
    add("verificationTimeoutMs", a.V7.timeoutMs, "V7");
  // V13/V17: honours truncated or persists cursors -> replay cursors on.
  if (a.V13 === true || a.V17 === true)
    add("overrides.replayCursors", true, a.V17 === true ? "V17" : "V13");
  // V18: the client uses poll or push -> list every servable mode.
  if (a.V18 === true) add("overrides.listedModes", "servable", "V18");
  // V2/V8: observed identity feeds the row's match fields.
  const s = o.signals ?? {};
  if (a.V2 !== undefined || a.V8 !== undefined) {
    if (s.clientInfo) add("match.clientInfoName", s.clientInfo, "V2/V8");
    if (s.callbackHost) add("match.callbackHost", s.callbackHost, "V2/V8");
  }
  return out;
}

function main(argv) {
  const file = argv.find((x) => !x.startsWith("--"));
  if (!file) {
    console.error(
      "usage: record.mjs <observations.json> [--write] [--matrix <path>]"
    );
    return 2;
  }
  const mi = argv.indexOf("--matrix");
  const matrixPath = mi >= 0 ? resolve(argv[mi + 1]) : DEFAULT_MATRIX;
  const input = validate(JSON.parse(readFileSync(file, "utf8")));
  const matrix = existsSync(matrixPath)
    ? JSON.parse(readFileSync(matrixPath, "utf8"))
    : { rows: [] };
  const merged = mergeRows(matrix, input);
  const proposals = input.observations.flatMap(proposeKnownClientEdits);
  if (argv.includes("--write")) {
    writeFileSync(matrixPath, JSON.stringify(merged, null, 2) + "\n");
    console.log(`updated ${matrixPath} (${merged.rows.length} rows)`);
  } else {
    console.log(JSON.stringify(merged, null, 2));
  }
  console.log("\nProposed KNOWN_CLIENTS edits (review, then edit the data):");
  console.log(proposals.length ? JSON.stringify(proposals, null, 2) : "none");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
