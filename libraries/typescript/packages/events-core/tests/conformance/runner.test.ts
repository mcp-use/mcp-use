import { afterEach, describe, expect, it } from "vitest";
import {
  CATALOG,
  runConformance,
  type ConformanceProfile,
  type ConformanceReport,
} from "../../src/conformance/index.js";
import { runConformanceWith } from "../../src/conformance/runner.js";
import { startFakeServer, type Fault, type FakeServer } from "./fake-server.js";

const TIMING = {
  requestMs: 3_000,
  eventWaitMs: 3_000,
  quietMs: 300,
  streamObserveMs: 1_500,
  heartbeatRequestMs: 300,
};

let server: FakeServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function run(
  faults: Fault[],
  dialects: ConformanceProfile[],
  only?: string[],
  mcpName: "lenient" | "strict" = "lenient"
): Promise<ConformanceReport> {
  server = await startFakeServer(faults);
  return runConformanceWith(
    {
      url: server.url,
      dialects,
      auth: { bearer: server.bearer },
      mcpName,
      ...(only ? { only } : {}),
    },
    { timing: TIMING }
  );
}

const outcomes = (r: ConformanceReport) =>
  Object.fromEntries(r.results.map((x) => [`${x.dialect} ${x.id}`, x.outcome]));

describe("runConformance against a correct server", () => {
  it("passes every automated check of both profiles", async () => {
    const r = await run([], ["openai", "sep-3415"]);
    expect(outcomes(r)).toEqual({
      "openai CAP-TOP": "pass",
      "openai LIST-SHAPE": "pass",
      "openai LIST-SIGNED-OUT": "pass",
      "openai LIST-OPENAI-MODES": "pass",
      "openai SUB-AUTH": "pass",
      "openai SUB-VERIFY-FIRST": "pass",
      "openai SUB-ANTI-REFLECTION": "pass",
      "openai SUB-ID-STABLE": "pass",
      "openai SUB-NO-REVERIFY": "pass",
      "openai SUB-TTL": "pass",
      "openai SUB-CODES": "pass",
      "openai VERIFY-WELLKNOWN": "skip",
      "openai DEL-WEBHOOK-ID": "pass",
      "openai DEL-RETRY": "skip",
      "openai DEL-NO-REDIRECT": "skip",
      "openai DEL-SIZE": "pass",
      "openai DEL-ROTATION": "skip",
      "openai UNS-MISSING": "pass",
      "openai CTL-ENVELOPES": "skip",
      "openai NONREPLAY-TRUNCATED": "pass",
      "openai DESC-QUALITY": "pass",
      "openai SCOPE-REQUESTED": "skip",
      "openai ANON-WEBHOOK": "skip",
      "openai PAYLOAD-SCHEMA": "pass",
      "openai HOST-BINDING": "skip",
      "openai HOST-SENDER": "skip",
      "openai HOST-TICK": "skip",
      "sep-3415 CAP-EXT": "pass",
      "sep-3415 CAP-EXT-LEGACY": "pass",
      "sep-3415 LIST-CHANGED": "skip",
      "sep-3415 LIST-SHAPE": "pass",
      "sep-3415 SUB-AUTH": "pass",
      "sep-3415 SUB-VERIFY-FIRST": "pass",
      "sep-3415 SUB-ANTI-REFLECTION": "pass",
      "sep-3415 SUB-ID-STABLE": "pass",
      "sep-3415 SUB-NO-REVERIFY": "pass",
      "sep-3415 SUB-TTL": "pass",
      "sep-3415 SUB-CODES": "pass",
      "sep-3415 HDR-MCPNAME-MISMATCH": "pass",
      "sep-3415 HDR-MCPNAME-MISSING": "pass",
      "sep-3415 HDR-MCPPARAM": "pass",
      "sep-3415 VERIFY-WELLKNOWN": "skip",
      "sep-3415 DEL-WEBHOOK-ID": "pass",
      "sep-3415 DEL-RETRY": "skip",
      "sep-3415 DEL-NO-REDIRECT": "skip",
      "sep-3415 DEL-SIZE": "pass",
      "sep-3415 DEL-ROTATION": "skip",
      "sep-3415 UNS-MISSING": "pass",
      "sep-3415 CTL-ENVELOPES": "skip",
      "sep-3415 NONREPLAY-TRUNCATED": "skip",
      "sep-3415 POLL-NULL": "pass",
      "sep-3415 POLL-ADVANCE": "pass",
      "sep-3415 POLL-HASMORE": "pass",
      "sep-3415 POLL-TRUNCATED-NOT-ERROR": "pass",
      "sep-3415 POLL-NEXTPOLLMS": "pass",
      "sep-3415 POLL-NO-EVENT-CURSOR": "pass",
      "sep-3415 STREAM-ACTIVE-FIRST": "pass",
      "sep-3415 STREAM-META-ID": "pass",
      "sep-3415 STREAM-HEARTBEAT-DATA": "pass",
      "sep-3415 STREAM-HEARTBEAT-GRANT": "pass",
      "sep-3415 STREAM-ERROR-PRE-OPEN": "pass",
      "sep-3415 CURSOR-CONSISTENT": "pass",
      "sep-3415 WEBHOOK-WATERMARK-SAFE": "skip",
      "sep-3415 WEBHOOK-REPLAY-LAPSED": "skip",
      "sep-3415 PAYLOAD-SCHEMA": "pass",
    });
    expect(r.summary.mustFailed).toBe(0);
    expect(r.summary.shouldFailed).toBe(0);
    expect(r.dialects).toEqual(["openai", "sep-3415"]);
    expect(r.target).toBe(server!.url);
  }, 60_000);
});

// One deliberate defect per row; the named check must fail on that profile.
const FAULTS: Array<[Fault, ConformanceProfile, string]> = [
  ["cap-top-missing", "openai", "CAP-TOP"],
  ["cap-ext-missing", "sep-3415", "CAP-EXT"],
  ["ext-on-legacy", "sep-3415", "CAP-EXT-LEGACY"],
  ["list-no-payload-schema", "sep-3415", "LIST-SHAPE"],
  ["list-signed-out-empty", "openai", "LIST-SIGNED-OUT"],
  ["openai-all-modes", "openai", "LIST-OPENAI-MODES"],
  ["short-description", "openai", "DESC-QUALITY"],
  ["sub-auth-open", "sep-3415", "SUB-AUTH"],
  ["sub-auth-open", "openai", "SUB-AUTH"],
  ["verify-unsigned", "sep-3415", "SUB-VERIFY-FIRST"],
  ["event-before-verify", "openai", "SUB-VERIFY-FIRST"],
  ["id-random", "sep-3415", "SUB-ID-STABLE"],
  ["reverify", "openai", "SUB-NO-REVERIFY"],
  ["ttl-long", "sep-3415", "SUB-TTL"],
  ["codes-wrong", "openai", "SUB-CODES"],
  ["callback-error-accepted", "sep-3415", "SUB-CODES"],
  ["uns-wrong", "sep-3415", "UNS-MISSING"],
  ["nonreplay-truncated", "openai", "NONREPLAY-TRUNCATED"],
  ["webhook-id-wrong", "openai", "DEL-WEBHOOK-ID"],
  ["webhook-id-wrong", "sep-3415", "DEL-WEBHOOK-ID"],
  ["del-type", "sep-3415", "DEL-SIZE"],
  ["hdr-name-mismatch-accepted", "sep-3415", "HDR-MCPNAME-MISMATCH"],
  ["hdr-name-missing-accepted", "sep-3415", "HDR-MCPNAME-MISSING"],
  ["hdr-param-accepted", "sep-3415", "HDR-MCPPARAM"],
  ["poll-null-events", "sep-3415", "POLL-NULL"],
  ["poll-no-advance", "sep-3415", "POLL-ADVANCE"],
  ["poll-ignore-max", "sep-3415", "POLL-HASMORE"],
  ["poll-stale-error", "sep-3415", "POLL-TRUNCATED-NOT-ERROR"],
  ["nextpoll-small", "sep-3415", "POLL-NEXTPOLLMS"],
  ["poll-event-cursor", "sep-3415", "POLL-NO-EVENT-CURSOR"],
  ["stream-heartbeat-first", "sep-3415", "STREAM-ACTIVE-FIRST"],
  ["stream-meta-wrong", "sep-3415", "STREAM-META-ID"],
  ["heartbeat-no-cursor", "sep-3415", "STREAM-HEARTBEAT-DATA"],
  ["stream-silent", "sep-3415", "STREAM-HEARTBEAT-GRANT"],
  ["stream-open-then-error", "sep-3415", "STREAM-ERROR-PRE-OPEN"],
  ["cursor-inconsistent", "sep-3415", "CURSOR-CONSISTENT"],
];

describe("each check fails on its deliberate defect", () => {
  it.each(FAULTS)(
    "%s makes %s %s fail",
    async (fault, dialect, id) => {
      const only = id === "PAYLOAD-SCHEMA" ? ["POLL-ADVANCE", id] : [id];
      const r = await run([fault], [dialect], only);
      const entry = r.results.find((x) => x.id === id);
      expect(entry?.outcome).toBe("fail");
    },
    30_000
  );

  it("payload-bad makes PAYLOAD-SCHEMA fail after occurrences were observed", async () => {
    const r = await run(
      ["payload-bad"],
      ["sep-3415"],
      ["POLL-ADVANCE", "PAYLOAD-SCHEMA"]
    );
    expect(outcomes(r)).toEqual({
      "sep-3415 POLL-ADVANCE": "pass",
      "sep-3415 PAYLOAD-SCHEMA": "fail",
    });
  }, 30_000);
});

describe("levels and selection", () => {
  it("reports HDR-MCPNAME-MISSING as SHOULD when lenient and MUST when strict", async () => {
    const lenient = await run(
      ["hdr-name-missing-accepted"],
      ["sep-3415"],
      ["HDR-MCPNAME-MISSING"]
    );
    expect(lenient.summary).toEqual({
      mustFailed: 0,
      shouldFailed: 1,
      passed: 0,
      skipped: 0,
    });
    await server!.close();
    const strict = await run(
      ["hdr-name-missing-accepted"],
      ["sep-3415"],
      ["HDR-MCPNAME-MISSING"],
      "strict"
    );
    expect(strict.summary).toEqual({
      mustFailed: 1,
      shouldFailed: 0,
      passed: 0,
      skipped: 0,
    });
  }, 30_000);

  it("reports SUB-AUTH as SHOULD for openai and MUST for sep-3415", async () => {
    const r = await run(
      ["sub-auth-open"],
      ["openai", "sep-3415"],
      ["SUB-AUTH"]
    );
    expect(r.results.map((x) => [x.dialect, x.level, x.outcome])).toEqual([
      ["openai", "SHOULD", "fail"],
      ["sep-3415", "MUST", "fail"],
    ]);
  }, 30_000);

  it("runs a family prefix only", async () => {
    const r = await run([], ["sep-3415"], ["POLL-"]);
    expect(r.results.map((x) => x.id)).toEqual([
      "POLL-NULL",
      "POLL-ADVANCE",
      "POLL-HASMORE",
      "POLL-TRUNCATED-NOT-ERROR",
      "POLL-NEXTPOLLMS",
      "POLL-NO-EVENT-CURSOR",
    ]);
  }, 30_000);

  it("skips every non-capability check when the profile is not advertised", async () => {
    const r = await run(
      ["cap-ext-missing"],
      ["sep-3415"],
      ["CAP-EXT", "LIST-SHAPE", "POLL-NULL"]
    );
    expect(r.results.map((x) => [x.id, x.outcome, x.detail])).toEqual([
      [
        "CAP-EXT",
        "fail",
        'extensions["io.modelcontextprotocol/events"] missing on server/discover',
      ],
      [
        "LIST-SHAPE",
        "skip",
        "server does not advertise Events to this profile",
      ],
      ["POLL-NULL", "skip", "server does not advertise Events to this profile"],
    ]);
  }, 30_000);
});

describe("runConformance", () => {
  it("is the public entry and fails CAP checks against a server that is down", async () => {
    const r = await runConformance({
      url: "http://127.0.0.1:9/mcp",
      dialects: ["sep-3415"],
      only: ["CAP-EXT"],
    });
    expect(r.results).toMatchObject([
      { id: "CAP-EXT", outcome: "fail", level: "MUST" },
    ]);
  });

  it("has one entry per §18.4 row", () => {
    expect(CATALOG.map((c) => c.id)).toHaveLength(47);
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(47);
    expect(
      CATALOG.every((c) => c.cite.length > 0 && c.profiles.length > 0)
    ).toBe(true);
  });
});
