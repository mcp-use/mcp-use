import { describe, expect, it } from "vitest";
import { resolveStoreBinding } from "../../src/events/binding/resolve.js";
import {
  ns16,
  nsKey,
  resolveUserNamespace,
} from "../../src/events/binding/namespace.js";
import { formatStartupLine } from "../../src/events/log/startup.js";
import type { StorageUrlTarget } from "../../src/storage/url.js";
import { ReferenceDatabase } from "../storage/reference-storage.js";

const opened: StorageUrlTarget[] = [];
const open = async (t: StorageUrlTarget) => {
  opened.push(t);
  return new ReferenceDatabase().store(t.prefix);
};

describe("store binding resolution (D16)", () => {
  it("is inert in the build phase", async () => {
    const r = await resolveStoreBinding({
      env: { MCP_USE_PHASE: "build" },
      serverName: "s",
      open,
    });
    expect(r).toEqual({ state: "inert" });
  });

  it("uses ServerConfig.storage with the env namespace and keyring", async () => {
    const storage = new ReferenceDatabase().store();
    const r = await resolveStoreBinding({
      env: { MCP_USE_EVENTS_NAMESPACE: "srv:prod", MCP_USE_SECRET: "k1,k2" },
      serverStorage: storage,
      serverName: "s",
      open,
    });
    expect(
      r.state === "active" && [r.kind, r.namespace, r.keyring, r.unsealed]
    ).toEqual(["user", "srv:prod", ["k1", "k2"], false]);
  });

  it("prefers the user binding over the platform binding", async () => {
    const r = await resolveStoreBinding({
      env: {
        MCP_USE_STORAGE_URL: "memory",
        MCP_USE_EVENTS_NAMESPACE: "mine",
        MCP_USE_PLATFORM_STORAGE_URL: "https://x.upstash.io",
        MCP_USE_PLATFORM_STORAGE_TOKEN: "t",
        MCP_USE_PLATFORM_NAMESPACE: "srv_1:production",
        MCP_USE_PLATFORM_SECRET: "p",
      },
      serverName: "s",
      open,
    });
    expect(r.state === "active" && r.kind).toBe("user");
  });

  it("uses the platform binding as one unit and ignores user keyring values", async () => {
    const r = await resolveStoreBinding({
      env: {
        MCP_USE_PLATFORM_STORAGE_URL: "https://x.upstash.io",
        MCP_USE_PLATFORM_STORAGE_TOKEN: "t",
        MCP_USE_PLATFORM_STORAGE_PREFIX: "t/srv_1/prod/",
        MCP_USE_PLATFORM_NAMESPACE: "srv_1:production",
        MCP_USE_PLATFORM_SECRET: "p1,p2",
        MCP_USE_PLATFORM_NAME: "manufact",
        MCP_USE_SECRET: "user",
      },
      serverName: "s",
      open,
    });
    expect(
      r.state === "active" && [
        r.kind,
        r.namespace,
        r.keyring,
        r.platformName,
        r.warnings.length,
      ]
    ).toEqual(["platform", "srv_1:production", ["p1", "p2"], "manufact", 1]);
    expect(opened.at(-1)).toEqual({
      kind: "upstash",
      url: "https://x.upstash.io",
      token: "t",
      prefix: "t/srv_1/prod/",
    });
  });

  it("fails closed on an incomplete platform binding", async () => {
    await expect(
      resolveStoreBinding({
        env: { MCP_USE_PLATFORM_NAMESPACE: "srv_1:production" },
        serverName: "s",
        open,
      })
    ).rejects.toMatchObject({
      code: "EVENTS_PLATFORM_BINDING_INCOMPLETE",
      data: {
        missing: [
          "MCP_USE_PLATFORM_STORAGE_URL",
          "MCP_USE_PLATFORM_STORAGE_TOKEN",
          "MCP_USE_PLATFORM_SECRET",
        ],
      },
    });
  });

  it("puts the dev runtime above the platform binding", async () => {
    const r = await resolveStoreBinding({
      env: { MCP_USE_PLATFORM_NAMESPACE: "leaked" },
      devRuntime: { stateDir: "/w/.mcp-use/state", workspace: "w1" },
      serverName: "s",
      open,
    });
    expect(r.state === "active" && [r.kind, r.namespace, r.unsealed]).toEqual([
      "dev",
      "dev:w1",
      true,
    ]);
    expect(opened.at(-1)).toEqual({
      kind: "file",
      path: "/w/.mcp-use/state/events",
      prefix: "",
    });
  });

  it("falls back to memory under NODE_ENV=test and is unconfigured otherwise", async () => {
    const t = await resolveStoreBinding({
      env: { NODE_ENV: "test" },
      serverName: "s",
      open,
    });
    expect(t.state === "active" && t.kind).toBe("memory");
    const u = await resolveStoreBinding({
      env: { NODE_ENV: "production" },
      serverName: "s",
      open,
    });
    expect(u.state).toBe("unconfigured");
  });

  it("requires a keyring for a durable production store", async () => {
    const db = new ReferenceDatabase().store();
    const durable = Object.assign(Object.create(db), { durable: true });
    await expect(
      resolveStoreBinding({
        env: { NODE_ENV: "production" },
        serverStorage: durable,
        serverName: "s",
        open,
      })
    ).rejects.toMatchObject({ code: "EVENTS_SECRET_REQUIRED" });
  });
});

describe("namespace (D24)", () => {
  it("falls back to MCP_URL origin plus basePath, then server name with a warning", () => {
    expect(
      resolveUserNamespace({
        mcpUrl: "https://a.example/x?y",
        basePath: "/mcp/",
        serverName: "s",
      })
    ).toEqual({
      namespace: "https://a.example/mcp",
      source: "MCP_URL",
    });
    expect(resolveUserNamespace({ serverName: "s" }).source).toBe(
      "server-name"
    );
  });

  it("hashes to 16 base64url characters and isolates keys", async () => {
    const a = await ns16("srv:a");
    const b = await ns16("srv:b");
    expect(a).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(a).not.toBe(b);
    expect(nsKey(a, "due")).toBe(`ev:{${a}}:due`);
  });
});

describe("startup line", () => {
  it("prints the binding and knobs", () => {
    expect(
      formatStartupLine({
        binding: "platform",
        platformName: "manufact",
        kind: "upstash",
        layout: 1,
        sender: "node-pinned",
        worker: "pump",
        push: "on(1h)",
        pollIntervalMs: 10_000,
        mcpName: "lenient",
        sdkBundled: "2.3.1",
      })
    ).toBe(
      "events: binding=platform(manufact) kind=upstash layout=1 sender=node-pinned worker=pump push=on(1h) poll=10s mcpName=lenient sdk.bundled=2.3.1 sdk.external=-"
    );
  });
});
