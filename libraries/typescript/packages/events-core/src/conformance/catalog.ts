/**
 * The conformance catalog (§18.4): one list, consumed by the test suite, the
 * CLI `events check`, the Inspector conformance panel and the Manufact
 * checklist (D27, P11). Order is run order; PAYLOAD-SCHEMA runs after the
 * checks that observe occurrences.
 *
 * @packageDocumentation
 */

import { CAPABILITY_CHECKS } from "./checks/capabilities.js";
import { HOSTING_CHECKS, PENDING_CHECKS } from "./checks/pending.js";
import { POLL_CHECKS } from "./checks/poll.js";
import { STREAM_CHECKS } from "./checks/stream.js";
import { WEBHOOK_CHECKS } from "./checks/webhook.js";
import type { ConformanceCheck } from "./types.js";

const ALL = [
  ...CAPABILITY_CHECKS,
  ...WEBHOOK_CHECKS,
  ...POLL_CHECKS,
  ...STREAM_CHECKS,
  ...PENDING_CHECKS,
  ...HOSTING_CHECKS,
];

/** The catalog ids in run order (§18.4, PAYLOAD-SCHEMA moved after the observing checks). */
export const CATALOG_ORDER: readonly string[] = [
  "CAP-TOP",
  "CAP-EXT",
  "CAP-EXT-LEGACY",
  "LIST-CHANGED",
  "LIST-SHAPE",
  "LIST-SIGNED-OUT",
  "LIST-OPENAI-MODES",
  "SUB-AUTH",
  "SUB-VERIFY-FIRST",
  "SUB-ANTI-REFLECTION",
  "SUB-ID-STABLE",
  "SUB-NO-REVERIFY",
  "SUB-TTL",
  "SUB-CODES",
  "HDR-MCPNAME-MISMATCH",
  "HDR-MCPNAME-MISSING",
  "HDR-MCPPARAM",
  "VERIFY-WELLKNOWN",
  "DEL-WEBHOOK-ID",
  "DEL-RETRY",
  "DEL-NO-REDIRECT",
  "DEL-SIZE",
  "DEL-ROTATION",
  "UNS-MISSING",
  "CTL-ENVELOPES",
  "NONREPLAY-TRUNCATED",
  "DESC-QUALITY",
  "SCOPE-REQUESTED",
  "ANON-WEBHOOK",
  "POLL-NULL",
  "POLL-ADVANCE",
  "POLL-HASMORE",
  "POLL-TRUNCATED-NOT-ERROR",
  "POLL-NEXTPOLLMS",
  "POLL-NO-EVENT-CURSOR",
  "STREAM-ACTIVE-FIRST",
  "STREAM-META-ID",
  "STREAM-HEARTBEAT-DATA",
  "STREAM-HEARTBEAT-GRANT",
  "STREAM-ERROR-PRE-OPEN",
  "CURSOR-CONSISTENT",
  "WEBHOOK-WATERMARK-SAFE",
  "WEBHOOK-REPLAY-LAPSED",
  "PAYLOAD-SCHEMA",
  "HOST-BINDING",
  "HOST-SENDER",
  "HOST-TICK",
];

/** The conformance check catalog, in run order. */
export const CATALOG: readonly ConformanceCheck[] = Object.freeze(
  CATALOG_ORDER.map((id) => {
    const c = ALL.find((x) => x.id === id);
    if (!c) throw new Error(`conformance catalog: no check ${id}`);
    return c;
  })
);
