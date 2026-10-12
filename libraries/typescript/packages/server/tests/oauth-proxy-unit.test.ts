/**
 * OAuth proxy building blocks: key derivation and value encryption,
 * redirect-URI and client rules, SSRF address checks, and storage adapters.
 */
import { describe, expect, it, vi } from "vitest";

import {
  isCimdClientId,
  isPrivateAddress,
  matchRedirectUri,
  redirectUriProblem,
} from "../src/oauth/proxy/clients.js";
import {
  decryptValue,
  deriveKeyring,
  encryptValue,
  normalizeSecrets,
  pkceChallenge,
  timingSafeEqual,
} from "../src/oauth/proxy/crypto.js";
import {
  cloudflareStorage,
  memoryStorage,
  OAuthProxyDurableObject,
  postgresStorage,
  redisStorage,
  upstashStorage,
  type OAuthProxyStorage,
} from "../src/oauth/storage.js";

const SECRET_A = "secret-a-0123456789-abcdefghijklmnopqrstuv";
const SECRET_B = "secret-b-0123456789-abcdefghijklmnopqrstuv";

describe("oauth proxy keys and encryption", () => {
  it("round-trips a value bound to its storage key", async () => {
    const keyring = await deriveKeyring([SECRET_A]);
    const sealed = await encryptValue(
      keyring,
      "mcp-use:oauth:grant:1",
      "hello"
    );
    expect(sealed).not.toContain("hello");
    expect(await decryptValue(keyring, "mcp-use:oauth:grant:1", sealed)).toBe(
      "hello"
    );
    // A ciphertext moved to another key does not decrypt.
    expect(
      await decryptValue(keyring, "mcp-use:oauth:grant:2", sealed)
    ).toBeUndefined();
  });

  it("decrypts with previous secrets after rotation and refuses unknown keys", async () => {
    const old = await deriveKeyring([SECRET_A]);
    const sealed = await encryptValue(old, "k", "v");
    const rotated = await deriveKeyring([SECRET_B, SECRET_A]);
    expect(await decryptValue(rotated, "k", sealed)).toBe("v");
    const fresh = await encryptValue(rotated, "k", "v2");
    expect(fresh.split(".")[1]).toBe(rotated.current.kid);
    expect(
      await decryptValue(await deriveKeyring([SECRET_B]), "k", sealed)
    ).toBeUndefined();
  });

  it("rejects tampered ciphertexts", async () => {
    const keyring = await deriveKeyring([SECRET_A]);
    const sealed = await encryptValue(keyring, "k", "value");
    const parts = sealed.split(".");
    const flipped = parts[3]!.startsWith("A")
      ? `B${parts[3]!.slice(1)}`
      : `A${parts[3]!.slice(1)}`;
    expect(
      await decryptValue(
        keyring,
        "k",
        [...parts.slice(0, 3), flipped].join(".")
      )
    ).toBeUndefined();
    expect(await decryptValue(keyring, "k", "garbage")).toBeUndefined();
  });

  it("derives stable, distinct keys per secret", async () => {
    const [a1, a2, b] = await Promise.all([
      deriveKeyring([SECRET_A]),
      deriveKeyring([SECRET_A]),
      deriveKeyring([SECRET_B]),
    ]);
    expect(a1.current.kid).toBe(a2.current.kid);
    expect(a1.current.kid).not.toBe(b.current.kid);
    expect(a1.current.cookie).toEqual(a2.current.cookie);
  });

  it("validates secrets and computes RFC 7636 challenges", async () => {
    expect(() => normalizeSecrets("short")).toThrow("at least 32 characters");
    expect(() => normalizeSecrets([])).toThrow("empty array");
    expect(normalizeSecrets([SECRET_A, SECRET_B])).toHaveLength(2);
    // RFC 7636 appendix B.
    expect(
      await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("oauth proxy client rules", () => {
  it("accepts HTTPS, loopback HTTP, and private-use schemes only", () => {
    expect(redirectUriProblem("https://app.example/cb")).toBeUndefined();
    expect(redirectUriProblem("http://127.0.0.1:8080/cb")).toBeUndefined();
    expect(redirectUriProblem("http://localhost/cb")).toBeUndefined();
    expect(redirectUriProblem("http://[::1]:3000/cb")).toBeUndefined();
    expect(
      redirectUriProblem("cursor://anysphere.cursor-mcp/oauth/callback")
    ).toBeUndefined();
    expect(redirectUriProblem("http://app.example/cb")).toMatch(/loopback/);
    // eslint-disable-next-line no-script-url -- an unsafe redirect URI to refuse
    expect(redirectUriProblem("javascript:alert(1)")).toMatch(/not allowed/);
    expect(redirectUriProblem("data:text/html,x")).toMatch(/not allowed/);
    expect(redirectUriProblem("https://app.example/cb#frag")).toMatch(
      /fragment/
    );
    expect(redirectUriProblem("https://user:pw@app.example/cb")).toMatch(
      /credentials/
    );
  });

  it("matches redirect URIs exactly, except loopback ports", () => {
    const registered = ["https://app.example/cb", "http://127.0.0.1/callback"];
    expect(matchRedirectUri("https://app.example/cb", registered)).toBe(true);
    expect(matchRedirectUri("https://app.example/cb/", registered)).toBe(false);
    expect(matchRedirectUri("https://app.example:8443/cb", registered)).toBe(
      false
    );
    expect(
      matchRedirectUri("http://127.0.0.1:51234/callback", registered)
    ).toBe(true);
    expect(matchRedirectUri("http://127.0.0.1:51234/other", registered)).toBe(
      false
    );
    expect(
      matchRedirectUri("http://localhost:51234/callback", registered)
    ).toBe(false);
  });

  it("recognizes client ID metadata document URLs", () => {
    expect(
      isCimdClientId("https://claude.ai/oauth/mcp-client-metadata.json")
    ).toBe(true);
    expect(isCimdClientId("https://claude.ai/")).toBe(false);
    expect(isCimdClientId("http://claude.ai/meta.json")).toBe(false);
    expect(isCimdClientId("mcp_client_abc")).toBe(false);
  });

  it("classifies private and public addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ["8.8.8.8", "140.82.112.3", "2606:4700::1111"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});

/** Atomic semantics every adapter must provide. */
async function exerciseStorage(storage: OAuthProxyStorage): Promise<void> {
  expect(await storage.get("a")).toBeUndefined();
  await storage.set("a", "1", 60);
  expect(await storage.get("a")).toBe("1");
  expect(await storage.add("a", "2", 60)).toBe(false);
  expect(await storage.get("a")).toBe("1");
  expect(await storage.take("a")).toBe("1");
  expect(await storage.take("a")).toBeUndefined();
  expect(await storage.add("a", "3", 60)).toBe(true);
  await storage.delete("a");
  expect(await storage.get("a")).toBeUndefined();
}

/** A tiny Redis that understands the commands the adapters send. */
function miniRedis() {
  const values = new Map<string, string>();
  return (args: string[]): unknown => {
    const [command, key, value, ...flags] = args;
    switch (command) {
      case "GET":
        return values.get(key!) ?? null;
      case "SET":
        if (flags.includes("NX") && values.has(key!)) return null;
        values.set(key!, value!);
        return "OK";
      case "DEL":
        return values.delete(key!) ? 1 : 0;
      case "GETDEL": {
        const current = values.get(key!) ?? null;
        values.delete(key!);
        return current;
      }
      default:
        throw new Error(`unexpected command ${command}`);
    }
  };
}

describe("oauth proxy storage adapters", () => {
  it("memoryStorage expires values", async () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      await exerciseStorage(storage);
      await storage.set("ttl", "x", 1);
      vi.advanceTimersByTime(1500);
      expect(await storage.get("ttl")).toBeUndefined();
      expect(await storage.add("ttl", "y", 1)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("upstashStorage speaks the Upstash REST protocol", async () => {
    const redis = miniRedis();
    const requests: unknown[] = [];
    const storage = upstashStorage({
      url: "https://db.upstash.io/",
      token: "tok",
      fetch: async (input, init) => {
        expect(String(input)).toBe("https://db.upstash.io");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer tok"
        );
        const args = JSON.parse(String(init?.body)) as string[];
        requests.push(args);
        return Response.json({ result: redis(args) });
      },
    });
    await exerciseStorage(storage);
    expect(requests).toContainEqual(["SET", "a", "1", "EX", "60"]);
    expect(requests).toContainEqual(["SET", "a", "2", "NX", "EX", "60"]);
  });

  it("redisStorage works with node-redis and ioredis clients", async () => {
    const nodeRedis = miniRedis();
    await exerciseStorage(
      redisStorage({ sendCommand: async (args) => nodeRedis(args) })
    );
    const ioredis = miniRedis();
    await exerciseStorage(
      redisStorage({
        call: async (command, ...args) => ioredis([command, ...args]),
      })
    );
    expect(() => redisStorage({} as never)).toThrow("node-redis or ioredis");
  });

  it("postgresStorage creates its table and uses DELETE … RETURNING", async () => {
    const queries: string[] = [];
    const storage = postgresStorage({
      table: "oauth_state",
      client: {
        query: async (text) => {
          queries.push(text);
          if (
            text.startsWith("DELETE FROM oauth_state WHERE key = $1 RETURNING")
          ) {
            return { rows: [{ value: "v", live: true }] };
          }
          return { rows: [] };
        },
      },
    });
    expect(await storage.take("k")).toBe("v");
    expect(await storage.add("k", "v", 60)).toBe(false);
    expect(queries[0]).toContain("CREATE TABLE IF NOT EXISTS oauth_state");
    expect(
      queries.filter((query) => query.includes("CREATE TABLE"))
    ).toHaveLength(1);
    expect(queries.at(-1)).toContain(
      "WHERE oauth_state.expires_at <= now() RETURNING key"
    );
    expect(() =>
      postgresStorage({
        client: { query: async () => ({ rows: [] }) },
        table: "x; drop",
      })
    ).toThrow("plain SQL identifier");
  });

  it("cloudflareStorage works with the Durable Object class", async () => {
    const entries = new Map<string, unknown>();
    const object = new OAuthProxyDurableObject({
      storage: {
        get: async <T>(key: string) => entries.get(key) as T | undefined,
        put: async (key, value) => {
          entries.set(key, value);
        },
        delete: async (key) => entries.delete(key),
        list: async <T>() => new Map([...entries] as [string, T][]),
      },
    });
    const storage = cloudflareStorage({
      durableObject: {
        idFromName: (name) => name,
        get: () => ({
          fetch: (input, init) => object.fetch(new Request(input, init)),
        }),
      },
    });
    await exerciseStorage(storage);
  });
});
