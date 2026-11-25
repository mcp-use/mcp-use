import { describe, expect, it } from "vitest";
import { isMemoryStorage } from "../../src/oauth/proxy/storage.js";
import {
  openStorageUrl,
  parseStorageUrl,
  type StorageUrlTarget,
} from "../../src/storage/url.js";

/** A CI service endpoint: missing under CI=true is a failure, not a skip. */
function service(name: string): string | undefined {
  const value = process.env[name];
  if (!value && process.env["CI"] === "true") {
    throw new Error(`${name} must be set when CI=true`);
  }
  return value || undefined;
}

const REDIS_URL = service("MCP_USE_TEST_REDIS_URL");
const POSTGRES_URL = service("MCP_USE_TEST_POSTGRES_URL");
const UPSTASH_URL = service("MCP_USE_TEST_UPSTASH_URL");
const UPSTASH_TOKEN = service("MCP_USE_TEST_UPSTASH_TOKEN");

function codeOf(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return undefined;
}

async function codeOfAsync(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return undefined;
}

function uniqueKey(): string {
  return `wp02-url-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

describe("parseStorageUrl", () => {
  it("returns undefined when MCP_USE_STORAGE_URL is unset or blank", () => {
    expect(parseStorageUrl({})).toBeUndefined();
    expect(parseStorageUrl({ MCP_USE_STORAGE_URL: "  " })).toBeUndefined();
  });

  it("parses every scheme", () => {
    const cases: Array<[Record<string, string>, StorageUrlTarget]> = [
      [{ MCP_USE_STORAGE_URL: "memory" }, { kind: "memory", prefix: "" }],
      [
        {
          MCP_USE_STORAGE_URL: "upstash",
          UPSTASH_REDIS_REST_URL: "https://eu1.upstash.io",
          UPSTASH_REDIS_REST_TOKEN: "tok-up",
        },
        {
          kind: "upstash",
          url: "https://eu1.upstash.io",
          token: "tok-up",
          prefix: "",
        },
      ],
      [
        {
          MCP_USE_STORAGE_URL: "upstash",
          KV_REST_API_URL: "https://kv.vercel.example",
          KV_REST_API_TOKEN: "tok-kv",
        },
        {
          kind: "upstash",
          url: "https://kv.vercel.example",
          token: "tok-kv",
          prefix: "",
        },
      ],
      [
        {
          MCP_USE_STORAGE_URL: "https://store.example.com",
          MCP_USE_STORAGE_TOKEN: "tok-https",
          MCP_USE_STORAGE_PREFIX: "t/srv_8f/prod/",
        },
        {
          kind: "upstash",
          url: "https://store.example.com",
          token: "tok-https",
          prefix: "t/srv_8f/prod/",
        },
      ],
      [
        {
          MCP_USE_STORAGE_URL: "http://localhost:8079",
          MCP_USE_STORAGE_TOKEN: "tok-local",
        },
        {
          kind: "upstash",
          url: "http://localhost:8079",
          token: "tok-local",
          prefix: "",
        },
      ],
      [
        { MCP_USE_STORAGE_URL: "redis://cache:6379/0" },
        { kind: "redis", url: "redis://cache:6379/0", prefix: "" },
      ],
      [
        { MCP_USE_STORAGE_URL: "rediss://user:pw@cache:6380" },
        { kind: "redis", url: "rediss://user:pw@cache:6380", prefix: "" },
      ],
      [
        { MCP_USE_STORAGE_URL: "postgres://db/app" },
        { kind: "postgres", url: "postgres://db/app", prefix: "" },
      ],
      [
        { MCP_USE_STORAGE_URL: "postgresql://db/app" },
        { kind: "postgres", url: "postgresql://db/app", prefix: "" },
      ],
      [
        { MCP_USE_STORAGE_URL: "file:./.mcp-use/state" },
        { kind: "file", path: "./.mcp-use/state", prefix: "" },
      ],
      [
        { MCP_USE_STORAGE_URL: "file:///var/lib/my%20app" },
        { kind: "file", path: "/var/lib/my app", prefix: "" },
      ],
    ];
    for (const [env, expected] of cases) {
      expect(parseStorageUrl(env)).toEqual(expected);
    }
  });

  it("accepts only upstash, https:// and memory on edge runtimes", () => {
    const edge = { runtime: "edge" } as const;
    expect(parseStorageUrl({ MCP_USE_STORAGE_URL: "memory" }, edge)).toEqual({
      kind: "memory",
      prefix: "",
    });
    expect(
      parseStorageUrl(
        {
          MCP_USE_STORAGE_URL: "https://store.example.com",
          MCP_USE_STORAGE_TOKEN: "t",
        },
        edge
      )?.kind
    ).toBe("upstash");
    for (const url of [
      "redis://cache:6379",
      "rediss://cache:6380",
      "postgres://db/app",
      "postgresql://db/app",
      "file:./state",
    ]) {
      expect(
        codeOf(() => parseStorageUrl({ MCP_USE_STORAGE_URL: url }, edge))
      ).toBe("STORAGE_UNSUPPORTED");
    }
  });

  it("rejects malformed and incomplete values with STORAGE_URL_INVALID", () => {
    for (const env of [
      { MCP_USE_STORAGE_URL: "upstash" },
      { MCP_USE_STORAGE_URL: "https://store.example.com" },
      {
        MCP_USE_STORAGE_URL: "http://store.example.com",
        MCP_USE_STORAGE_TOKEN: "t",
      },
      { MCP_USE_STORAGE_URL: "mysql://db/app" },
      { MCP_USE_STORAGE_URL: "not a url" },
      { MCP_USE_STORAGE_URL: "file:" },
      { MCP_USE_STORAGE_URL: "memory", MCP_USE_STORAGE_PREFIX: "a{b}" },
    ]) {
      expect(codeOf(() => parseStorageUrl(env))).toBe("STORAGE_URL_INVALID");
    }
  });
});

describe("openStorageUrl", () => {
  it("opens a per-call memory store", async () => {
    const one = await openStorageUrl({ kind: "memory", prefix: "" });
    const two = await openStorageUrl({ kind: "memory", prefix: "" });
    expect(isMemoryStorage(one)).toBe(true);
    await one.set("k", "v", 60);
    expect([await one.get("k"), await two.get("k")]).toEqual(["v", undefined]);
  });

  it("reports STORAGE_DRIVER_MISSING when no Redis or Postgres driver loads", async () => {
    const importModule = async (specifier: string) => {
      throw new Error(`Cannot find package '${specifier}'`);
    };
    expect(
      await codeOfAsync(() =>
        openStorageUrl(
          { kind: "redis", url: "redis://cache:6379", prefix: "" },
          { importModule }
        )
      )
    ).toBe("STORAGE_DRIVER_MISSING");
    expect(
      await codeOfAsync(() =>
        openStorageUrl(
          { kind: "postgres", url: "postgres://db/app", prefix: "" },
          { importModule }
        )
      )
    ).toBe("STORAGE_DRIVER_MISSING");
  });

  it("falls back to node-redis when ioredis is not installed", async () => {
    const loaded: string[] = [];
    const sent: string[][] = [];
    const storage = await openStorageUrl(
      { kind: "redis", url: "redis://cache:6379", prefix: "app/" },
      {
        importModule: async (specifier) => {
          loaded.push(specifier);
          if (specifier !== "redis") throw new Error("missing");
          return {
            createClient: (options: { url: string }) => ({
              connect: async () => ({
                sendCommand: async (args: string[]) => {
                  sent.push([options.url, ...args]);
                  return "v";
                },
              }),
            }),
          };
        },
      }
    );
    expect(await storage.get("k")).toBe("v");
    expect(loaded).toEqual(["ioredis", "redis"]);
    expect(sent).toEqual([["redis://cache:6379", "GET", "app/k"]]);
  });

  it("opens the file store from mcp-use/storage/node with the path", async () => {
    const dirs: string[] = [];
    const loaded: string[] = [];
    await openStorageUrl(
      { kind: "file", path: "./.mcp-use/state", prefix: "" },
      {
        importModule: async (specifier) => {
          loaded.push(specifier);
          return {
            fileStorage: (dir: string) => {
              dirs.push(dir);
              return {};
            },
          };
        },
      }
    );
    expect([loaded, dirs]).toEqual([
      ["mcp-use/storage/node"],
      ["./.mcp-use/state"],
    ]);
  });

  it.skipIf(!REDIS_URL)(
    "opens redis:// through ioredis with the prefix applied",
    async () => {
      const target = parseStorageUrl({
        MCP_USE_STORAGE_URL: REDIS_URL,
        MCP_USE_STORAGE_PREFIX: "wp02-url/",
      })!;
      const storage = await openStorageUrl(target);
      const raw = await openStorageUrl({ ...target, prefix: "" });
      const key = uniqueKey();
      await storage.set(key, "via-url", 60);
      expect([
        await storage.get(key),
        await raw.get(`wp02-url/${key}`),
      ]).toEqual(["via-url", "via-url"]);
      await storage.delete(key);
      expect(await raw.get(`wp02-url/${key}`)).toBeUndefined();
    }
  );

  it.skipIf(!POSTGRES_URL)("opens postgres:// through pg", async () => {
    const storage = await openStorageUrl(
      parseStorageUrl({ MCP_USE_STORAGE_URL: POSTGRES_URL })!
    );
    const key = uniqueKey();
    expect(await storage.add(key, "once", 60)).toBe(true);
    expect(await storage.add(key, "twice", 60)).toBe(false);
    expect(await storage.take(key)).toBe("once");
    expect(await storage.get(key)).toBeUndefined();
  });

  it.skipIf(!UPSTASH_URL || !UPSTASH_TOKEN)(
    "opens an Upstash-REST endpoint from https:// (or loopback http://) and a token",
    async () => {
      const storage = await openStorageUrl(
        parseStorageUrl({
          MCP_USE_STORAGE_URL: UPSTASH_URL,
          MCP_USE_STORAGE_TOKEN: UPSTASH_TOKEN,
          MCP_USE_STORAGE_PREFIX: "wp02-rest/",
        })!
      );
      const key = uniqueKey();
      await storage.set(key, "rest", 60);
      const response = await fetch(UPSTASH_URL!, {
        method: "POST",
        headers: {
          authorization: `Bearer ${UPSTASH_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(["GET", `wp02-rest/${key}`]),
      });
      expect(await response.json()).toEqual({ result: "rest" });
      await storage.delete(key);
    }
  );
});
