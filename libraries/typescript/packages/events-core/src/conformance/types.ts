/**
 * Public types of `@mcp-use/events-core/conformance` (D27, §8 of the plan).
 * The API is final; additions are optional members only.
 *
 * @packageDocumentation
 */

/** A profile the conformance catalog checks a server against. */
export type ConformanceProfile = "openai" | "sep-3415";

/** How a check's failure counts. */
export type ConformanceLevel = "MUST" | "SHOULD" | "INFO" | "WARN";

/** The outcome of one check against one profile. */
export interface CheckResult {
  /** Pass, fail, or skip (not applicable to this server). */
  outcome: "pass" | "fail" | "skip";
  /** What was observed, for failures and skips. */
  detail?: string;
}

/** A webhook receiver the runner can direct deliveries to. */
export interface ReceiverHandle {
  /** The callback URL the server must be able to reach. */
  url: string;
  /** Waits for the next delivery matching `predicate`, or rejects after `timeoutMs`. */
  next(
    predicate: (delivery: ReceivedDelivery) => boolean,
    timeoutMs: number
  ): Promise<ReceivedDelivery>;
  /** Stops the receiver. */
  close(): Promise<void>;
}

/** One POST the receiver accepted. */
export interface ReceivedDelivery {
  /** The request headers. */
  headers: Headers;
  /** The raw body bytes. */
  body: Uint8Array;
  /** The body parsed as JSON. */
  json: unknown;
}

/** What a check runs against: the target, the profile under test and a raw JSON-RPC client. */
export interface Harness {
  /** The MCP endpoint under test. */
  url: URL;
  /** The profile being checked. */
  dialect: ConformanceProfile;
  /** Sends one raw JSON-RPC request and returns the HTTP response. */
  rpc(
    method: string,
    params: unknown,
    init?: {
      /** Extra request headers. */
      headers?: Record<string, string>;
    }
  ): Promise<Response>;
  /** The receiver used for webhook checks. */
  receiver: ReceiverHandle;
}

/** One check of the catalog. */
export interface ConformanceCheck {
  /** Stable check id, for example `SUB-ID-STABLE`. */
  id: string;
  /** Profiles the check applies to. */
  profiles: readonly ConformanceProfile[];
  /** How a failure counts (the default when {@link ConformanceCheck.levelFor} is absent). */
  level: ConformanceLevel;
  /** The requirement it checks: `events.mdx:N` or a plan row. */
  cite: string;
  /** The check family, for example `POLL` or `STREAM`. */
  family: string;
  /** Runs the check. */
  run(h: Harness): Promise<CheckResult>;
  /** The level for one profile and `mcpName` mode, when it differs from {@link ConformanceCheck.level}. */
  levelFor?(
    dialect: ConformanceProfile,
    mcpName: "lenient" | "strict"
  ): ConformanceLevel;
}

/** Options of {@link runConformance}. */
export interface ConformanceOptions {
  /** The MCP endpoint under test. */
  url: string | URL;
  /** Profiles to check. */
  dialects: readonly ConformanceProfile[];
  /** Bearer token for an OAuth-protected server. */
  auth?: {
    /** The access token. */
    bearer: string;
  };
  /** Extra headers on every request. */
  headers?: Record<string, string>;
  /** `strict` requires `Mcp-Name` (the official suites); default `lenient`. */
  mcpName?: "lenient" | "strict";
  /** Receiver for webhook checks; default: the runner's own signing receiver (needs a reachable URL). */
  receiver?: ReceiverHandle;
  /** Check ids or family prefixes to run (`POLL-`, `STREAM-`). */
  only?: readonly string[];
  /** The fetch implementation; default `globalThis.fetch`. */
  fetch?: typeof fetch;
}

/** One entry of {@link ConformanceReport.results}. */
export interface ConformanceResultEntry {
  /** The check id. */
  id: string;
  /** The profile. */
  dialect: string;
  /** The check level. */
  level: string;
  /** The outcome. */
  outcome: "pass" | "fail" | "skip";
  /** What was observed. */
  detail?: string;
  /** Duration in milliseconds. */
  ms: number;
}

/** The report of one conformance run. */
export interface ConformanceReport {
  /** The endpoint checked. */
  target: string;
  /** Start time, ISO 8601 UTC. */
  startedAt: string;
  /** Profiles checked. */
  dialects: string[];
  /** One entry per check and profile. */
  results: ConformanceResultEntry[];
  /** Totals. */
  summary: {
    /** MUST checks that failed. */
    mustFailed: number;
    /** SHOULD checks that failed. */
    shouldFailed: number;
    /** Checks that passed. */
    passed: number;
    /** Checks that were skipped. */
    skipped: number;
  };
}
