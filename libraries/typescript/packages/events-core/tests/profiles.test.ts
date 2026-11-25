import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  findKnownClient,
  invalidPartialAxes,
  KNOWN_CLIENTS,
  parsePresetId,
  parseStoredProfile,
  presetById,
  PRESETS,
  resolveProfile,
  satisfiesRange,
  storedProfileStatus,
  UnknownPresetError,
  unknownAxes,
  validateKnownClientRule,
  type CompatibilityConfig,
  type EventsSignals,
  type KnownClientRule,
  type ProfileRequest,
} from "../src/index.js";
import { readVector } from "./vectors.js";

interface PresetVectors {
  presets: Record<
    string,
    { preset: string; revision: number; axes: Record<string, unknown> }
  >;
  storedProfiles: Array<{ profile: Record<string, unknown>; status: string }>;
}

const presetVectors = readVector<PresetVectors>("presets.json");

const OPENAI_AXES = presetVectors.presets["openai@1"]!.axes;
const SEP_AXES = presetVectors.presets["sep-3415@1"]!.axes;

/** Signals of a modern request that carries no hint at all. */
function bare(extra: Partial<EventsSignals> = {}): EventsSignals {
  return {
    era: "modern",
    declaresEventsExtension: false,
    mcpName: { present: false },
    ...extra,
  };
}

/** The `{preset, revision, via, row id}` summary of one resolution. */
function resolved(
  signals: EventsSignals,
  config?: CompatibilityConfig,
  request?: ProfileRequest
): [string, number, string, string | undefined] {
  const p = resolveProfile(signals, config, request);
  return [p.preset, p.revision, p.via, p.row?.id];
}

describe("preset registry (vectors/presets.json)", () => {
  it("PRESETS holds exactly the vector's presets and axes", () => {
    const registry = Object.fromEntries(
      Object.entries(PRESETS).map(([id, def]) => [
        id,
        { preset: def.preset, revision: def.revision, axes: def.axes },
      ])
    );
    expect(registry).toEqual(presetVectors.presets);
  });

  it("parses preset ids as open strings", () => {
    expect([
      parsePresetId("openai@1"),
      parsePresetId("sep-3415@2"),
      parsePresetId("acme.push@12"),
      parsePresetId("sep-3415"),
      parsePresetId("sep-3415@0"),
      parsePresetId("@1"),
    ]).toEqual([
      { preset: "openai", revision: 1 },
      { preset: "sep-3415", revision: 2 },
      { preset: "acme.push", revision: 12 },
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("presetById takes full ids and bare family names, and rejects unknown ones", () => {
    expect(presetById("sep-3415@1").axes).toEqual(SEP_AXES);
    expect(presetById("openai").axes).toEqual(OPENAI_AXES);
    expect(() => presetById("sep-3415@2")).toThrow(UnknownPresetError);
    expect(() => presetById("acme")).toThrow('Unknown Events preset "acme"');
  });
});

describe("stored profiles (D53)", () => {
  for (const v of presetVectors.storedProfiles) {
    const p = v.profile;
    const label = `${String(p.preset)}@${String(p.revision)}`;
    it(`${label} with errorCodes ${JSON.stringify((p.axes as Record<string, unknown>).errorCodes)} is ${v.status}`, () => {
      const parsed = parseStoredProfile(p);
      expect(parsed).toBeDefined();
      expect(storedProfileStatus(parsed!)).toBe(v.status);
    });
  }

  it("an unknown sep-3415@2 and an unknown axis value round-trip unchanged", () => {
    const text = JSON.stringify(presetVectors.storedProfiles[2]!.profile);
    const parsed = parseStoredProfile(JSON.parse(text));
    expect(JSON.stringify(parsed)).toBe(text);
    expect(parsed).toEqual({
      preset: "sep-3415",
      revision: 2,
      axes: {
        webhookId: "random",
        eventIdNormalization: "none",
        errorCodes: "sep-v2",
        unsubscribeMissing: "notFound",
        controlEnvelopes: true,
        refreshDeliveryStatus: true,
        listedModes: "servable",
        replayCursors: true,
      },
      via: "declaration",
      verifier: "wev",
    });
  });

  it("rejects stored profiles with a broken shape", () => {
    const good = presetVectors.storedProfiles[0]!.profile;
    const axes = good.axes as Record<string, unknown>;
    expect([
      parseStoredProfile(null),
      parseStoredProfile([]),
      parseStoredProfile({ ...good, revision: "1" }),
      parseStoredProfile({ ...good, revision: 1.5 }),
      parseStoredProfile({ ...good, via: undefined }),
      parseStoredProfile({ ...good, axes: { ...axes, replayCursors: "yes" } }),
      parseStoredProfile({ ...good, axes: { ...axes, webhookId: undefined } }),
    ]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("unknownAxes names unknown, missing and mistyped axis values", () => {
    expect(unknownAxes(SEP_AXES)).toEqual([]);
    expect(
      unknownAxes({
        ...SEP_AXES,
        errorCodes: "sep-v2",
        replayCursors: "true",
        listedModes: undefined,
      })
    ).toEqual(["errorCodes", "listedModes", "replayCursors"]);
  });

  it("invalidPartialAxes accepts open string values and rejects unknown names and wrong types", () => {
    expect([
      invalidPartialAxes({ webhookId: "random" }),
      invalidPartialAxes({ errorCodes: "future" }),
      invalidPartialAxes({}),
      invalidPartialAxes({ webhookID: "random" }),
      invalidPartialAxes({ controlEnvelopes: "true" }),
      invalidPartialAxes({ webhookId: true }),
      invalidPartialAxes(null),
    ]).toEqual([
      undefined,
      undefined,
      undefined,
      "webhookID",
      "controlEnvelopes",
      "webhookId",
      "<root>",
    ]);
  });
});

describe("resolveProfile follows the D7 order", () => {
  it("1. a forced dialect wins over everything, and 'auto' does not force", () => {
    const chatgpt = bare({ clientInfo: { name: "openai-mcp/1.0" } });
    expect(resolved(chatgpt, { dialect: "sep-3415@1" })).toEqual([
      "sep-3415",
      1,
      "forced",
      undefined,
    ]);
    expect(resolved(chatgpt, { dialect: "sep-3415" })).toEqual([
      "sep-3415",
      1,
      "forced",
      undefined,
    ]);
    expect(resolved(chatgpt, { dialect: "auto" })).toEqual([
      "openai",
      1,
      "known-client",
      "chatgpt",
    ]);
  });

  it("2. the resolveDialect hook decides before the known-client rows; undefined falls through", () => {
    const chatgpt = bare({ clientInfo: { name: "openai-mcp/1.0" } });
    expect(resolved(chatgpt, { resolveDialect: () => "sep-3415@1" })).toEqual([
      "sep-3415",
      1,
      "hook",
      undefined,
    ]);
    const withOverrides = resolveProfile(chatgpt, {
      resolveDialect: () => ({
        preset: "sep-3415@1",
        overrides: { webhookId: "eventId" },
      }),
    });
    expect(withOverrides.axes).toEqual({ ...SEP_AXES, webhookId: "eventId" });
    expect(resolved(chatgpt, { resolveDialect: () => undefined })).toEqual([
      "openai",
      1,
      "known-client",
      "chatgpt",
    ]);
  });

  it("3. the chatgpt row keeps ChatGPT on openai even when it declares the extension", () => {
    const p = resolveProfile(
      bare({
        clientInfo: { name: "openai-mcp/1.0" },
        declaresEventsExtension: true,
        mcpName: { present: true, value: "note.created" },
      }),
      undefined,
      { method: "events/subscribe" }
    );
    expect([p.preset, p.via, p.row?.id, p.row?.advertise]).toEqual([
      "openai",
      "known-client",
      "chatgpt",
      "both",
    ]);
    expect(p.axes).toEqual(OPENAI_AXES);
  });

  it("3. the chatgpt-callback row matches openai.com callback hosts only", () => {
    expect(
      resolved(bare({ callbackHost: "connectors.api.openai.com" }))
    ).toEqual(["openai", 1, "known-client", "chatgpt-callback"]);
    expect(resolved(bare({ callbackHost: "openai.com" }))).toEqual([
      "openai",
      1,
      "known-client",
      "chatgpt-callback",
    ]);
    expect(
      resolved(
        bare({ callbackHost: "evilopenai.com", declaresEventsExtension: true })
      )
    ).toEqual(["sep-3415", 1, "declaration", undefined]);
  });

  it("3. tanstack-ai gets sep-3415 with eventId webhook ids; ai-sdk gets openai", () => {
    const tanstack = resolveProfile(
      bare({ clientInfo: { name: "tanstack-ai-mcp", version: "0.0.1" } })
    );
    expect([tanstack.preset, tanstack.row?.id]).toEqual([
      "sep-3415",
      "tanstack-ai",
    ]);
    expect(tanstack.axes).toEqual({
      ...SEP_AXES,
      webhookId: "eventId",
      eventIdNormalization: "headerSafe",
    });
    expect(
      resolved(bare({ clientInfo: { name: "ai-sdk-mcp-client" } }))
    ).toEqual(["openai", 1, "known-client", "ai-sdk"]);
  });

  it("3. user rows run before the built-in rows", () => {
    const row: KnownClientRule = {
      id: "acme",
      match: { clientName: /^openai-mcp/i, clientVersion: ">=2" },
      preset: "sep-3415@1",
      source: "test",
    };
    const config = { knownClients: [row] };
    expect(
      resolved(
        bare({ clientInfo: { name: "openai-mcp", version: "2.1.0" } }),
        config
      )
    ).toEqual(["sep-3415", 1, "known-client", "acme"]);
    expect(
      resolved(
        bare({ clientInfo: { name: "openai-mcp", version: "1.9.0" } }),
        config
      )
    ).toEqual(["openai", 1, "known-client", "chatgpt"]);
  });

  it("4. events/poll and events/stream resolve to sep-3415 before the era rule", () => {
    const legacy = bare({ era: "legacy" });
    expect(resolved(legacy, undefined, { method: "events/poll" })).toEqual([
      "sep-3415",
      1,
      "method",
      undefined,
    ]);
    expect(resolved(legacy, undefined, { method: "events/stream" })).toEqual([
      "sep-3415",
      1,
      "method",
      undefined,
    ]);
  });

  it("5. the legacy era resolves to openai, even with a declaration", () => {
    expect(
      resolved(
        bare({ era: "legacy", declaresEventsExtension: true }),
        undefined,
        {
          method: "events/subscribe",
        }
      )
    ).toEqual(["openai", 1, "era", undefined]);
  });

  it("6. a declared extension resolves to sep-3415", () => {
    expect(resolved(bare({ declaresEventsExtension: true }))).toEqual([
      "sep-3415",
      1,
      "declaration",
      undefined,
    ]);
  });

  it("7. Mcp-Name counts on subscribe and unsubscribe only", () => {
    const named = bare({ mcpName: { present: true, value: "note.created" } });
    expect(resolved(named, undefined, { method: "events/subscribe" })).toEqual([
      "sep-3415",
      1,
      "mcp-name",
      undefined,
    ]);
    expect(
      resolved(named, undefined, { method: "events/unsubscribe" })
    ).toEqual(["sep-3415", 1, "mcp-name", undefined]);
    expect(resolved(named, undefined, { method: "events/list" })).toEqual([
      "openai",
      1,
      "ambiguous",
      undefined,
    ]);
  });

  it("8. compatibility.openai: false resolves to sep-3415", () => {
    expect(resolved(bare(), { openai: false })).toEqual([
      "sep-3415",
      1,
      "openai-disabled",
      undefined,
    ]);
  });

  it("9. the ambiguous default is openai@1, configurable with a full id or a family", () => {
    expect(resolved(bare())).toEqual(["openai", 1, "ambiguous", undefined]);
    expect(resolved(bare(), { ambiguous: "sep-3415" })).toEqual([
      "sep-3415",
      1,
      "ambiguous",
      undefined,
    ]);
  });

  it("applies compatibility.axes last, after row overrides", () => {
    const p = resolveProfile(
      bare({ clientInfo: { name: "tanstack-ai-mcp" } }),
      {
        axes: { webhookId: "random", errorCodes: "documented" },
      }
    );
    expect(p.axes).toEqual({
      ...SEP_AXES,
      webhookId: "random",
      eventIdNormalization: "headerSafe",
      errorCodes: "documented",
    });
  });

  it("throws UnknownPresetError for a preset the registry does not hold", () => {
    expect(() => resolveProfile(bare(), { dialect: "sep-3415@2" })).toThrow(
      UnknownPresetError
    );
  });
});

describe("KNOWN_CLIENTS (Appendix E)", () => {
  it("has the four initial rows, in order, each with evidence", () => {
    expect(KNOWN_CLIENTS.map((r) => [r.id, r.preset])).toEqual([
      ["chatgpt", "openai@1"],
      ["chatgpt-callback", "openai@1"],
      ["tanstack-ai", "sep-3415@1"],
      ["ai-sdk", "openai@1"],
    ]);
    for (const row of KNOWN_CLIENTS) {
      expect([row.id, validateKnownClientRule(row)]).toEqual([
        row.id,
        { ok: true },
      ]);
      expect(row.source).toMatch(/20\d\d-\d\d-\d\d/);
    }
  });

  it("the client names are the published defaults (F6)", () => {
    expect(KNOWN_CLIENTS.map((r) => r.match.clientName?.source)).toEqual([
      "^openai-mcp",
      undefined,
      "^tanstack-ai-mcp$",
      "^ai-sdk-mcp-client$",
    ]);
  });

  it("the chatgpt row's emulation resolves back through the chatgpt row (K-O9)", () => {
    const chatgpt = KNOWN_CLIENTS[0]!;
    const emulate = chatgpt.emulate!;
    expect(emulate).toEqual({
      declareExtension: false,
      sendMcpName: false,
      sendMcpMethod: false,
      eras: ["legacy", "modern"],
      clientInfo: { name: "openai-mcp/1.0" },
    });
    for (const era of emulate.eras) {
      expect(
        resolved({
          era,
          declaresEventsExtension: emulate.declareExtension,
          clientInfo: emulate.clientInfo,
          mcpName: { present: emulate.sendMcpName },
          mcpMethod: emulate.sendMcpMethod,
        })
      ).toEqual(["openai", 1, "known-client", "chatgpt"]);
    }
  });

  it("the signal matrix has one row per KNOWN_CLIENTS row, in the same order", () => {
    const matrix = JSON.parse(
      readFileSync(
        new URL("../src/data/signal-matrix.json", import.meta.url),
        "utf8"
      )
    ) as { schema: string; rows: Array<{ id: string }> };
    expect(matrix.schema).toBe("mcp-use.events.signal-matrix/1");
    expect(matrix.rows.map((r) => r.id)).toEqual(
      KNOWN_CLIENTS.map((r) => r.id)
    );
  });

  it("every present match field must hold (AND)", () => {
    const row: KnownClientRule = {
      id: "and",
      match: {
        userAgent: /^Acme\//,
        era: "modern",
        declaresExtension: true,
        mcpMethodHeader: true,
      },
      preset: "sep-3415@1",
      source: "test",
    };
    const full = bare({
      userAgent: "Acme/3.2",
      declaresEventsExtension: true,
      mcpMethod: true,
    });
    expect(findKnownClient(full, [row])?.id).toBe("and");
    expect([
      findKnownClient({ ...full, userAgent: "Other/1" }, [row]),
      findKnownClient({ ...full, era: "legacy" }, [row]),
      findKnownClient({ ...full, declaresEventsExtension: false }, [row]),
      findKnownClient({ ...full, mcpMethod: false }, [row]),
      findKnownClient(
        bare({ declaresEventsExtension: true, mcpMethod: true }),
        [row]
      ),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("a global RegExp matches the same way on every call", () => {
    const row: KnownClientRule = {
      id: "g",
      match: { clientName: /acme/g },
      preset: "openai@1",
      source: "test",
    };
    const s = bare({ clientInfo: { name: "acme" } });
    expect([
      findKnownClient(s, [row])?.id,
      findKnownClient(s, [row])?.id,
    ]).toEqual(["g", "g"]);
  });
});

describe("validateKnownClientRule", () => {
  const valid = {
    id: "acme",
    match: { clientName: /^acme$/ },
    preset: "sep-3415@1",
    source: "https://example.com/acme, read 2026-11-25",
  };

  const cases: Array<[string, unknown, string]> = [
    ["not an object", "acme", "<root>"],
    ["empty id", { ...valid, id: "" }, "id"],
    ["missing preset", { ...valid, preset: undefined }, "preset"],
    ["missing source", { ...valid, source: "" }, "source"],
    ["empty match", { ...valid, match: {} }, "match"],
    [
      "string clientName",
      { ...valid, match: { clientName: "acme" } },
      "match.clientName",
    ],
    [
      "bad range",
      { ...valid, match: { clientVersion: ">=banana" } },
      "match.clientVersion",
    ],
    ["bad era", { ...valid, match: { era: "future" } }, "match.era"],
    ["unknown match field", { ...valid, match: { host: /x/ } }, "match.host"],
    [
      "unknown axis",
      { ...valid, overrides: { webhookID: "random" } },
      "overrides.webhookID",
    ],
    ["advertise", { ...valid, advertise: "none" }, "advertise"],
    ["ttl", { ...valid, ttlDefaultMs: 0 }, "ttlDefaultMs"],
    [
      "timeout",
      { ...valid, verificationTimeoutMs: 1.5 },
      "verificationTimeoutMs",
    ],
    ["antiReflection", { ...valid, antiReflection: "block" }, "antiReflection"],
    ["mcpName", { ...valid, mcpName: "loose" }, "mcpName"],
    [
      "emulate eras",
      {
        ...valid,
        emulate: {
          declareExtension: true,
          sendMcpName: true,
          sendMcpMethod: false,
          eras: [],
          clientInfo: { name: "acme" },
        },
      },
      "emulate.eras",
    ],
    [
      "emulate clientInfo",
      {
        ...valid,
        emulate: {
          declareExtension: true,
          sendMcpName: true,
          sendMcpMethod: false,
          eras: ["modern"],
          clientInfo: {},
        },
      },
      "emulate.clientInfo",
    ],
  ];

  it("accepts a minimal row", () => {
    expect(validateKnownClientRule(valid)).toEqual({ ok: true });
  });

  for (const [label, row, field] of cases) {
    it(`rejects ${label} at ${field}`, () => {
      const check = validateKnownClientRule(row);
      expect(check.ok ? "ok" : check.field).toBe(field);
    });
  }
});

describe("satisfiesRange (match.clientVersion)", () => {
  const table: Array<[string, string, boolean]> = [
    ["1.2.3", ">=1.2.0 <2", true],
    ["2.0.0", ">=1.2.0 <2", false],
    ["1.4", "^1.0.0", true],
    ["2.0.0", "^1.0.0", false],
    ["0.2.5", "^0.2.1", true],
    ["0.3.0", "^0.2.1", false],
    ["2.1.9", "~2.1", true],
    ["2.2.0", "~2.1", false],
    ["3.7.1", "1.x || 3.x", true],
    ["2.0.0", "1.x || 3.x", false],
    ["1.5.0", "1.2 - 2.3", true],
    ["2.3.9", "1.2 - 2.3", true],
    ["2.4.0", "1.2 - 2.3", false],
    ["1.0.0-beta.2", ">=1.0.0", false],
    ["1.0.0-beta.2", ">=1.0.0-beta.1", true],
    ["5.0.0", "*", true],
    ["1.2.3", "1.2.3", true],
    ["1.2.4", "1.2.3", false],
    ["v1.2.3", ">1.2.2", true],
    ["not-a-version", "*", false],
    ["1.0.0", "banana", false],
  ];
  for (const [version, range, expected] of table) {
    it(`${version} ${expected ? "satisfies" : "does not satisfy"} ${range}`, () => {
      expect(satisfiesRange(version, range)).toBe(expected);
    });
  }
});
