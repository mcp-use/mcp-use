import { EventsError, type EventsSignals } from "@mcp-use/events-core";
import { describe, expect, it } from "vitest";
import { reserveAnonymousSlot } from "../../../src/events/engine/anonymous.js";
import { resolvePrincipal } from "../../../src/events/engine/principal.js";
import {
  advertiseKeys,
  classifyStoredProfile,
  pinProfile,
  resolveRequestProfile,
} from "../../../src/events/engine/profile.js";
import {
  collectSignals,
  projectSignals,
} from "../../../src/events/engine/signals.js";
import {
  checkRequestHeaders,
  HeaderMismatchError,
  validateArguments,
} from "../../../src/events/engine/validate.js";
import { createEventsKeys } from "../../../src/events/store/keys.js";
import { ReferenceDatabase } from "../../storage/reference-storage.js";

const modern = (o: Partial<EventsSignals> = {}): EventsSignals => ({
  era: "modern",
  declaresEventsExtension: false,
  mcpName: { present: false },
  ...o,
});

describe("profile resolution (D7)", () => {
  const via = (
    s: EventsSignals,
    c?: Parameters<typeof resolveRequestProfile>[1],
    m?: string
  ) => pinProfile(resolveRequestProfile(s, c, m));

  it("forced", () =>
    expect(via(modern(), { dialect: "sep-3415" }).via).toBe("forced"));
  it("hook", () =>
    expect(via(modern(), { resolveDialect: () => "sep-3415" })).toMatchObject({
      preset: "sep-3415",
      via: "hook",
    }));
  it("user known-client row first", () => {
    const p = via(modern({ clientInfo: { name: "acme" } }), {
      knownClients: [
        {
          id: "acme",
          match: { clientName: /^acme$/ },
          preset: "sep-3415@1",
          source: "test",
        },
      ],
    });
    expect(p).toMatchObject({
      preset: "sep-3415",
      revision: 1,
      via: "known-client:acme",
    });
  });
  it("events/poll ⇒ sep-3415", () =>
    expect(via(modern(), undefined, "events/poll")).toMatchObject({
      preset: "sep-3415",
      via: "method",
    }));
  it("legacy era ⇒ openai", () =>
    expect(via(modern({ era: "legacy" }))).toMatchObject({
      preset: "openai",
      via: "era",
    }));
  it("declaration ⇒ sep-3415", () =>
    expect(via(modern({ declaresEventsExtension: true })).via).toBe(
      "declaration"
    ));
  it("Mcp-Name ⇒ sep-3415", () =>
    expect(
      via(
        modern({ mcpName: { present: true, value: "x" } }),
        undefined,
        "events/subscribe"
      ).via
    ).toBe("mcp-name"));
  it("openai:false ⇒ sep-3415", () =>
    expect(via(modern(), { openai: false })).toMatchObject({
      preset: "sep-3415",
      via: "openai-disabled",
    }));
  it("ambiguous ⇒ openai", () =>
    expect(via(modern())).toMatchObject({
      preset: "openai",
      via: "ambiguous",
    }));
  it("config axes apply last", () =>
    expect(
      via(modern(), { axes: { replayCursors: false } as never }).axes
    ).toMatchObject({ replayCursors: false }));
  it("advertise follows openai:false", () => {
    expect(
      advertiseKeys(resolveRequestProfile(modern(), { openai: false }), {
        openai: false,
      })
    ).toBe("extension");
    expect(
      advertiseKeys(resolveRequestProfile(modern(), undefined), undefined)
    ).toBe("both");
  });
});

describe("stored profiles (D53)", () => {
  const pin = pinProfile(resolveRequestProfile(modern(), undefined));
  it("known, deliverable, unknown, broken", () => {
    expect(classifyStoredProfile(pin).status).toBe("known");
    expect(classifyStoredProfile({ ...pin, revision: 9 }).status).toBe(
      "deliverable"
    );
    expect(classifyStoredProfile({ ...pin, preset: "future" }).status).toBe(
      "unknown"
    );
    expect(classifyStoredProfile({ preset: 1 }).status).toBe("broken");
  });
});

describe("signals", () => {
  it("collects headers, extension declaration and callback host", () => {
    const headers = new Headers({ "Mcp-Name": "ev", "user-agent": "UA/1" });
    const s = collectSignals({
      era: "modern",
      headers,
      capabilities: { extensions: { "io.modelcontextprotocol/events": {} } },
      clientInfo: { name: "c", version: "1" },
      callbackUrl: "https://hooks.example:8443/x",
    });
    expect(s).toEqual({
      era: "modern",
      declaresEventsExtension: true,
      mcpName: { present: true, value: "ev" },
      mcpMethod: false,
      clientInfo: { name: "c", version: "1" },
      userAgent: "UA/1",
      callbackHost: "hooks.example:8443",
    });
    expect(projectSignals(s, { anonymous: true })).toEqual({
      era: "modern",
      declared: true,
      mcpName: "present",
      clientName: "c",
      clientVersion: "1",
      userAgent: "UA/1",
      mcpMethod: false,
      anonymous: true,
    });
  });
});

describe("validation", () => {
  const schema = {
    "~standard": {
      version: 1 as const,
      vendor: "test",
      validate: (v: unknown) =>
        typeof (v as { region?: unknown }).region === "string"
          ? { value: v }
          : { issues: [{ message: "region required", path: ["region"] }] },
    },
  };
  it("returns schema output or InvalidParams", async () => {
    expect(await validateArguments(schema, { region: "eu" })).toEqual({
      region: "eu",
    });
    await expect(validateArguments(schema, {})).rejects.toMatchObject({
      kind: "invalidParams",
      data: {
        field: "arguments",
        issues: [{ message: "region required", path: ["region"] }],
      },
    });
    expect(await validateArguments(undefined, null)).toEqual({});
    await expect(validateArguments(undefined, { a: 1 })).rejects.toBeInstanceOf(
      EventsError
    );
  });

  it("checks Mcp-Name and Mcp-Param headers", () => {
    const inputJsonSchema = {
      type: "object",
      properties: { region: { type: "string", "x-mcp-header": "Region" } },
    };
    const base = {
      inputJsonSchema,
      args: { region: "eu" },
      name: "ev",
      expectsMcpName: true,
    };
    const ok = new Headers({ "Mcp-Name": "ev", "Mcp-Param-Region": "eu" });
    expect(() =>
      checkRequestHeaders({
        ...base,
        headers: ok,
        signals: collectSignals({ era: "modern", headers: ok }),
        policy: "strict",
      })
    ).not.toThrow();
    const wrong = new Headers({
      "Mcp-Name": "other",
      "Mcp-Param-Region": "eu",
    });
    expect(() =>
      checkRequestHeaders({
        ...base,
        headers: wrong,
        signals: collectSignals({ era: "modern", headers: wrong }),
        policy: "lenient",
      })
    ).toThrow(HeaderMismatchError);
    const none = new Headers();
    expect(() =>
      checkRequestHeaders({
        ...base,
        headers: none,
        signals: collectSignals({ era: "modern", headers: none }),
        policy: "lenient",
      })
    ).not.toThrow();
    expect(() =>
      checkRequestHeaders({
        ...base,
        headers: none,
        signals: collectSignals({ era: "modern", headers: none }),
        policy: "strict",
      })
    ).toThrow("Mcp-Name missing");
  });
});

describe("principal (D13)", () => {
  const base = {
    oauthConfigured: false,
    devRuntime: false,
    viaTunnel: false,
    preset: "openai",
  } as const;
  it("auth principal, hook override, dev, anonymous, rejection", () => {
    expect(
      resolvePrincipal({
        ...base,
        oauthConfigured: true,
        auth: { principal: "iss|u" },
        mode: "webhook",
      }).principal
    ).toBe("iss|u");
    expect(
      resolvePrincipal({
        ...base,
        oauthConfigured: true,
        auth: { principal: "iss|u" },
        principalHook: () => "custom",
        mode: "poll",
      }).principal
    ).toBe("custom");
    expect(
      resolvePrincipal({
        ...base,
        devRuntime: true,
        mode: "webhook",
        preset: "sep-3415",
      })
    ).toEqual({ principal: "dev|local", anonymous: false, dev: true });
    expect(
      resolvePrincipal({
        ...base,
        devRuntime: true,
        viaTunnel: true,
        mode: "webhook",
      })
    ).toEqual({ principal: "anonymous", anonymous: true, dev: false });
    expect(
      resolvePrincipal({ ...base, mode: "push", preset: "sep-3415" }).principal
    ).toBe("anonymous");
    expect(() =>
      resolvePrincipal({ ...base, mode: "webhook", preset: "sep-3415" })
    ).toThrow(EventsError);
    expect(() =>
      resolvePrincipal({ ...base, anonymous: "reject", mode: "webhook" })
    ).toThrow("A principal is required");
  });

  it("anonymous quotas per URL", async () => {
    const storage = new ReferenceDatabase().store();
    const keys = await createEventsKeys({ namespace: "n" });
    const limits = { perUrl: 2, perNamespace: 3 };
    await reserveAnonymousSlot(storage, keys, "https://a/x", limits);
    await reserveAnonymousSlot(storage, keys, "https://a/x", limits);
    await expect(
      reserveAnonymousSlot(storage, keys, "https://a/x", limits)
    ).rejects.toMatchObject({
      data: {
        reason: "anonymous_quota",
        limit: "anonymousSubscriptionsPerUrl",
      },
    });
    await reserveAnonymousSlot(storage, keys, "https://b/x", limits);
    await expect(
      reserveAnonymousSlot(storage, keys, "https://c/x", limits)
    ).rejects.toMatchObject({
      data: { limit: "anonymousSubscriptionsPerNamespace" },
    });
  });
});
