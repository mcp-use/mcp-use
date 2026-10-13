/**
 * OAuth proxy building blocks: key derivation and value encryption,
 * redirect-URI and client rules, SSRF address checks, upstream error
 * reports, and storage adapters.
 */
import { describe, expect, it, vi } from "vitest";

import {
  assertPublicHost,
  createCimdFetcher,
  defaultHostResolver,
  hostResolverFrom,
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
import { github } from "../src/oauth/proxy/providers.js";
import { describe as describeError } from "../src/oauth/proxy/runtime.js";
import { SecureStore } from "../src/oauth/proxy/storage.js";
import {
  refreshUpstreamTokens,
  UpstreamError,
} from "../src/oauth/proxy/upstream.js";
import {
  cloudflareStorage,
  firestoreStorage,
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

describe("oauth proxy metadata-document host check", () => {
  const resolving =
    (...addresses: string[]) =>
    async () =>
      addresses;

  it("refuses a hostname when the runtime has no resolver", async () => {
    await expect(assertPublicHost("client.example", undefined)).rejects.toThrow(
      "cannot be checked"
    );
    // IP literals need no resolver.
    await expect(
      assertPublicHost("140.82.112.3", undefined)
    ).resolves.toBeUndefined();
    await expect(assertPublicHost("10.0.0.1", undefined)).rejects.toThrow(
      "not public"
    );

    const fetchImpl = vi.fn(async () => Response.json({}));
    const fetchCimd = createCimdFetcher(fetchImpl, async () => undefined);
    await expect(
      fetchCimd("https://client.example/oauth/metadata.json")
    ).rejects.toThrow("cannot be checked");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses hosts that resolve to private addresses or not at all", async () => {
    await expect(
      assertPublicHost("client.example", resolving("140.82.112.3"))
    ).resolves.toBeUndefined();
    await expect(
      assertPublicHost(
        "client.example",
        resolving("140.82.112.3", "169.254.169.254")
      )
    ).rejects.toThrow("not public");
    await expect(
      assertPublicHost("client.example", resolving())
    ).rejects.toThrow("not public");
    await expect(
      assertPublicHost("client.example", async () => {
        throw new Error("ENOTFOUND");
      })
    ).rejects.toThrow("does not resolve");
  });

  it("resolves with lookup, or with resolve4 and resolve6 on Cloudflare Workers", async () => {
    const lookup = vi.fn(async () => [
      { address: "140.82.112.3" },
      { address: "::1" },
    ]);
    const notImplemented = async () => {
      throw new Error("Not implemented");
    };
    const node = hostResolverFrom({ promises: { lookup } }, "Node.js/22");
    expect(await node!("client.example")).toEqual(["140.82.112.3", "::1"]);
    expect(lookup).toHaveBeenCalledWith("client.example", {
      all: true,
      verbatim: true,
    });

    const workers = hostResolverFrom(
      {
        default: {
          promises: {
            lookup: notImplemented,
            resolve4: async () => ["140.82.112.3"],
            resolve6: async () => {
              throw new Error("ENODATA");
            },
          },
        },
      },
      "Cloudflare-Workers"
    );
    expect(await workers!("client.example")).toEqual(["140.82.112.3"]);
    const unresolvable = hostResolverFrom(
      {
        promises: { resolve4: notImplemented, resolve6: notImplemented },
      },
      "Cloudflare-Workers"
    );
    await expect(unresolvable!("client.example")).rejects.toThrow();

    expect(hostResolverFrom({}, "Node.js/22")).toBeUndefined();
    expect(
      hostResolverFrom({ promises: { lookup } }, "Cloudflare-Workers")
    ).toBeUndefined();
    expect(typeof (await defaultHostResolver())).toBe("function");
  });
});

describe("oauth proxy upstream errors", () => {
  const provider = github({
    clientId: "client-id",
    clientSecret: "client-secret",
    baseUrl: "https://github.example",
  });

  /** Refreshes against a token endpoint that answers with `answer`. */
  async function refreshError(
    answer: () => Response | Promise<Response>
  ): Promise<UpstreamError> {
    const error = await refreshUpstreamTokens(
      provider,
      async () => answer(),
      "refresh-token-value"
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UpstreamError);
    return error as UpstreamError;
  }

  it("keeps GitHub's own code and HTTP status for a refused refresh token", async () => {
    const error = await refreshError(() =>
      Response.json({
        error: "bad_refresh_token",
        error_description: "The refresh token passed is incorrect or expired.",
      })
    );
    // invalid_grant ends the user's sign-ins; GitHub's code is kept for logs.
    expect(error.code).toBe("invalid_grant");
    expect(error.transient).toBe(false);
    expect(error.upstreamCode).toBe("bad_refresh_token");
    expect(describeError(error)).toBe(
      "GitHub token endpoint returned bad_refresh_token: The refresh token passed is incorrect or expired. (HTTP 200)"
    );
  });

  it("names the fields of an unusable token response, never their values", async () => {
    const error = await refreshError(() =>
      Response.json({ refresh_token: "leaked-refresh-token", scope: "user" })
    );
    expect(error.code).toBe("server_error");
    expect(error.transient).toBe(false);
    const text = describeError(error);
    expect(text).toContain("fields refresh_token, scope");
    expect(text).not.toContain("leaked-refresh-token");
  });

  it("reports the status and content type of a non-JSON answer", async () => {
    const error = await refreshError(
      () =>
        new Response("<html>Bad gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        })
    );
    expect(error.transient).toBe(true);
    expect(describeError(error)).toContain("HTTP 502, content-type text/html");
  });

  it("treats a 401 challenge as refused client credentials, not a revoked grant", async () => {
    const error = await refreshError(
      () =>
        new Response(null, {
          status: 401,
          headers: { "www-authenticate": 'Basic realm="github"' },
        })
    );
    expect(error.code).toBe("invalid_client");
    expect(error.transient).toBe(false);
    expect(describeError(error)).toContain("HTTP 401, WWW-Authenticate basic");
  });

  it("names the network failure when the endpoint is unreachable", async () => {
    const error = await refreshError(() => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
          code: "ECONNREFUSED",
        }),
      });
    });
    expect(error.code).toBe("temporarily_unavailable");
    expect(error.transient).toBe(true);
    expect(error.message).toBe(
      "GitHub token endpoint is unreachable: ECONNREFUSED"
    );
  });

  it("logs records encrypted with another secret once", async () => {
    const storage = memoryStorage();
    const write = new SecureStore(storage, () => deriveKeyring([SECRET_A]));
    await write.set("up:github:1", { a: 1 }, 60);
    await write.set("up:github:2", { a: 2 }, 60);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const read = new SecureStore(storage, () => deriveKeyring([SECRET_B]));
      expect(await read.get("up:github:1")).toBeUndefined();
      expect(await read.get("up:github:2")).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain(
        "encrypted with a secret this server does not have"
      );
      // After rotation the old records read again, without a warning.
      const rotated = new SecureStore(storage, () =>
        deriveKeyring([SECRET_B, SECRET_A])
      );
      expect(await rotated.get("up:github:1")).toEqual({ a: 1 });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
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

/**
 * A tiny Firestore. Reads yield, so unsynchronized read-then-write code
 * races; transactions run one at a time and commit their writes at the end,
 * like the server SDK's locking transactions. Dates come back as
 * Timestamp-like objects.
 */
function miniFirestore() {
  const documents = new Map<string, Record<string, unknown>>();
  const ids: string[] = [];
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));
  const stored = (data: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(data).map(([field, value]) => [
        field,
        value instanceof Date
          ? { toMillis: () => value.getTime() }
          : (value as unknown),
      ])
    );
  const snapshot = (path: string) => {
    const data = documents.get(path);
    return { exists: data !== undefined, data: () => data };
  };
  let queue = Promise.resolve();
  const firestore = {
    collection: (name: string) => ({
      doc: (id: string) => {
        ids.push(id);
        const path = `${name}/${id}`;
        return {
          path,
          get: async () => {
            // The read sees the document as it is now; the reply comes later.
            const result = snapshot(path);
            await tick();
            return result;
          },
          set: async (data: Record<string, unknown>) => {
            documents.set(path, stored(data));
          },
          delete: async () => {
            documents.delete(path);
          },
        };
      },
    }),
    runTransaction: <T>(
      update: (transaction: {
        get(reference: { path: string }): Promise<ReturnType<typeof snapshot>>;
        set(reference: { path: string }, data: Record<string, unknown>): void;
        delete(reference: { path: string }): void;
      }) => Promise<T>
    ): Promise<T> => {
      const run = queue.then(async () => {
        const writes: (() => void)[] = [];
        const result = await update({
          get: async (reference) => {
            const result = snapshot(reference.path);
            await tick();
            return result;
          },
          set: (reference, data) => {
            writes.push(() => documents.set(reference.path, stored(data)));
          },
          delete: (reference) => {
            writes.push(() => documents.delete(reference.path));
          },
        });
        for (const write of writes) write();
        return result;
      });
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
  };
  return { firestore, documents, ids };
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
        call: async (command: string, ...args: string[]) =>
          ioredis([command, ...args]),
      })
    );
    expect(() => redisStorage({} as never)).toThrow("node-redis or ioredis");
  });

  it("redisStorage connects through a function on first use", async () => {
    const redis = miniRedis();
    let attempts = 0;
    let reachable = false;
    const storage = redisStorage(async () => {
      attempts += 1;
      await Promise.resolve();
      if (!reachable) throw new Error("connect ECONNREFUSED");
      return { sendCommand: async (args: string[]) => redis(args) };
    });
    expect(attempts).toBe(0);
    // A failed connection is not cached: the next call tries again.
    await expect(storage.get("a")).rejects.toThrow("ECONNREFUSED");
    reachable = true;
    // Concurrent first calls share one connection attempt.
    await Promise.all([storage.get("x"), storage.get("y"), storage.get("z")]);
    expect(attempts).toBe(2);
    await exerciseStorage(storage);
    expect(attempts).toBe(2);
    await expect(redisStorage(() => ({}) as never).get("a")).rejects.toThrow(
      "node-redis or ioredis"
    );
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

  it("firestoreStorage keeps one document per key and runs take and add in transactions", async () => {
    const { firestore, documents, ids } = miniFirestore();
    const storage = firestoreStorage({
      firestore: firestore as unknown as Parameters<
        typeof firestoreStorage
      >[0]["firestore"],
      collection: "oauth_state",
    });
    await exerciseStorage(storage);

    // Any key works as a document ID, including one with a slash.
    await storage.set("up:custom:https://id.example/u/1", "v", 60);
    expect(await storage.get("up:custom:https://id.example/u/1")).toBe("v");
    expect(ids.every((id) => !id.includes("/"))).toBe(true);
    expect([...documents.keys()][0]).toMatch(/^oauth_state\//);

    // Only one of many concurrent takes or adds wins.
    await storage.set("code", "c", 60);
    const taken = await Promise.all(
      Array.from({ length: 10 }, () => storage.take("code"))
    );
    expect(taken.filter((value) => value === "c")).toHaveLength(1);
    const added = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        storage.add("lock", String(index), 60)
      )
    );
    expect(added.filter(Boolean)).toHaveLength(1);

    // An expired document reads as absent, and add replaces it.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await storage.set("ttl", "x", 1);
      vi.setSystemTime(Date.now() + 1500);
      expect(await storage.get("ttl")).toBeUndefined();
      expect(await storage.take("ttl")).toBeUndefined();
      await storage.set("ttl", "x", 1);
      vi.setSystemTime(Date.now() + 1500);
      expect(await storage.add("ttl", "y", 60)).toBe(true);
      expect(await storage.get("ttl")).toBe("y");
    } finally {
      vi.useRealTimers();
    }

    expect(() => firestoreStorage({} as never)).toThrow("Firestore database");
    expect(() =>
      firestoreStorage({
        firestore: firestore as never,
        collection: "a/b",
      })
    ).toThrow("without slashes");
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
