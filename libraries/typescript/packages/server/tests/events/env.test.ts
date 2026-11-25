import { describe, expect, it } from "vitest";
import {
  missingPlatformBinding,
  readEventsEnv,
  resolveKnobs,
} from "../../src/events/env.js";
import { EventsConfigError } from "../../src/events/errors.js";

describe("events env: knob precedence (code > MCP_USE_EVENTS_X > MCP_USE_PLATFORM_EVENTS_X > default)", () => {
  const both = {
    MCP_USE_EVENTS_PUSH: "off",
    MCP_USE_PLATFORM_EVENTS_PUSH: "on",
    MCP_USE_EVENTS_PUSH_MAX_DURATION_MS: "90000",
    MCP_USE_PLATFORM_EVENTS_PUSH_MAX_DURATION_MS: "120000",
    MCP_USE_EVENTS_HEARTBEAT_MAX_MS: "40000",
    MCP_USE_PLATFORM_EVENTS_HEARTBEAT_MAX_MS: "50000",
    MCP_USE_EVENTS_POLL_INTERVAL_MS: "20000",
    MCP_USE_PLATFORM_EVENTS_POLL_INTERVAL_MS: "30000",
    MCP_USE_EVENTS_EGRESS_PROXY: "http://user.proxy:3128",
    MCP_USE_PLATFORM_EVENTS_EGRESS_PROXY: "http://platform.proxy:3128",
    MCP_USE_EVENTS_LOG_FORMAT: "json",
    MCP_USE_PLATFORM_EVENTS_LOG_FORMAT: "text",
  };

  it("uses code values over every variable", () => {
    expect(
      resolveKnobs(both, {
        push: "on",
        pushMaxDurationMs: null,
        heartbeatMaxMs: 10000,
        pollIntervalMs: 5000,
        egressProxy: false,
        logFormat: "text",
      })
    ).toEqual({
      push: { value: "on", source: "code" },
      pushMaxDurationMs: { value: null, source: "code" },
      heartbeatMaxMs: { value: 10000, source: "code" },
      pollIntervalMs: { value: 5000, source: "code" },
      egressProxy: { value: null, source: "code" },
      logFormat: { value: "text", source: "code" },
    });
  });

  it("uses MCP_USE_EVENTS_X over the platform default", () => {
    expect(resolveKnobs(both)).toEqual({
      push: { value: "off", source: "env" },
      pushMaxDurationMs: { value: 90000, source: "env" },
      heartbeatMaxMs: { value: 40000, source: "env" },
      pollIntervalMs: { value: 20000, source: "env" },
      egressProxy: { value: "http://user.proxy:3128", source: "env" },
      logFormat: { value: "json", source: "env" },
    });
  });

  it("uses MCP_USE_PLATFORM_EVENTS_X when the user variable is unset or empty", () => {
    const platformOnly = Object.fromEntries(
      Object.entries(both).map(([k, v]) => [
        k,
        k.startsWith("MCP_USE_EVENTS_") ? "" : v,
      ])
    );
    expect(resolveKnobs(platformOnly)).toEqual({
      push: { value: "on", source: "platform" },
      pushMaxDurationMs: { value: 120000, source: "platform" },
      heartbeatMaxMs: { value: 50000, source: "platform" },
      pollIntervalMs: { value: 30000, source: "platform" },
      egressProxy: { value: "http://platform.proxy:3128", source: "platform" },
      logFormat: { value: "text", source: "platform" },
    });
  });

  it("falls back to the built-in defaults", () => {
    expect(resolveKnobs({})).toEqual({
      push: { value: "auto", source: "default" },
      pushMaxDurationMs: { value: undefined, source: "default" },
      heartbeatMaxMs: { value: 55000, source: "default" },
      pollIntervalMs: { value: 10000, source: "default" },
      egressProxy: { value: null, source: "default" },
      logFormat: { value: "text", source: "default" },
    });
  });

  it("reads PUSH_MAX_DURATION_MS=0 as unlimited", () => {
    expect(
      resolveKnobs({ MCP_USE_EVENTS_PUSH_MAX_DURATION_MS: "0" })
        .pushMaxDurationMs
    ).toEqual({ value: null, source: "env" });
  });

  it("rejects an invalid value with EVENTS_CONFIG_INVALID naming the variable", () => {
    let caught: unknown;
    try {
      resolveKnobs({ MCP_USE_PLATFORM_EVENTS_POLL_INTERVAL_MS: "500" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventsConfigError);
    expect((caught as EventsConfigError).code).toBe("EVENTS_CONFIG_INVALID");
    expect((caught as EventsConfigError).data).toEqual({
      field: "MCP_USE_PLATFORM_EVENTS_POLL_INTERVAL_MS",
    });
  });
});

describe("events env: bindings and secrets", () => {
  it("splits secret lists and picks the first keyring source", () => {
    const snap = readEventsEnv({
      MCP_USE_SECRET: "k2, k3",
      MCP_USE_OAUTH_SECRET: "oauth",
      MCP_USE_EVENTS_ADMIN_SECRET: "a1,a2,",
      CRON_SECRET: "cron",
    });
    expect(snap.user.keyring).toEqual({
      keys: ["k2", "k3"],
      source: "MCP_USE_SECRET",
    });
    expect(snap.adminSecrets).toEqual({ user: ["a1", "a2"] });
    expect(snap.tickSecrets).toEqual(["cron"]);
  });

  it("prefers MCP_USE_EVENTS_SECRET and MCP_USE_EVENTS_TICK_SECRET", () => {
    const snap = readEventsEnv({
      MCP_USE_EVENTS_SECRET: "e1",
      MCP_USE_SECRET: "g1",
      MCP_USE_EVENTS_TICK_SECRET: "t1,t2",
      CRON_SECRET: "cron",
    });
    expect(snap.user.keyring).toEqual({
      keys: ["e1"],
      source: "MCP_USE_EVENTS_SECRET",
    });
    expect(snap.tickSecrets).toEqual(["t1", "t2"]);
  });

  it("reports the missing platform-binding variables when the set is incomplete", () => {
    const snap = readEventsEnv({
      MCP_USE_PLATFORM_STORAGE_URL: "https://store.example",
      MCP_USE_PLATFORM_LABELS: "server=s1,deployment=d9",
    });
    expect(snap.platform.present).toBe(true);
    expect(missingPlatformBinding(snap.platform)).toEqual([
      "MCP_USE_PLATFORM_STORAGE_TOKEN",
      "MCP_USE_PLATFORM_NAMESPACE",
      "MCP_USE_PLATFORM_SECRET",
    ]);
    expect(snap.labels).toEqual({ server: "s1", deployment: "d9" });
  });

  it("reports nothing missing for a complete platform binding", () => {
    const snap = readEventsEnv({
      MCP_USE_PLATFORM_STORAGE_URL: "https://store.example",
      MCP_USE_PLATFORM_STORAGE_TOKEN: "tok",
      MCP_USE_PLATFORM_NAMESPACE: "srv:production",
      MCP_USE_PLATFORM_SECRET: "s1,s0",
    });
    expect(missingPlatformBinding(snap.platform)).toEqual([]);
    expect(snap.platform.secret).toEqual(["s1", "s0"]);
  });
});
