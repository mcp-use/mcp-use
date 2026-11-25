/**
 * Connecting to already-checked addresses only (IP pinning), shared by the
 * OAuth proxy and the Events webhook senders. Lifted from
 * `oauth/proxy/clients.ts`.
 *
 * @internal
 */

/** @internal A `lookup` for `node:https` that answers from a fixed list. */
export type PinnedLookup = (
  hostname: string,
  options: { all?: boolean },
  callback: (
    error: Error | null,
    address: string | { address: string; family: number }[],
    family?: number
  ) => void
) => void;

/** @internal The parts of a `node:http` response that pinned requests use. */
export interface PinnedResponse {
  /** HTTP status code. */
  statusCode?: number | undefined;
  /** Response headers, lower-cased. */
  headers: Record<string, string | string[] | undefined>;
  /** Drops the connection. */
  destroy(): unknown;
}

/**
 * @internal The parts of `node:https` and `node:stream` that the CIMD
 * fetcher uses to connect to checked addresses only.
 */
export interface PinnedTransport {
  /** `https.request`. */
  request(
    url: URL,
    options: {
      headers: Record<string, string>;
      signal: AbortSignal;
      lookup: PinnedLookup;
    },
    onResponse: (response: PinnedResponse) => void
  ): {
    on(event: "error", listener: (error: Error) => void): unknown;
    end(): unknown;
  };
  /** `Readable.toWeb`. */
  toWeb(response: PinnedResponse): ReadableStream<Uint8Array>;
}

/** @internal IP family of an address literal. */
export function addressFamily(address: string): 4 | 6 {
  return address.includes(":") ? 6 : 4;
}

/**
 * @internal A `lookup` that answers only with `addresses` (already checked),
 * so the connection never resolves the host a second time (DNS rebinding).
 */
export function pinnedLookup(addresses: readonly string[]): PinnedLookup {
  const entries = addresses.map((address) => ({
    address,
    family: addressFamily(address),
  }));
  return (_hostname, options, callback) => {
    const first = entries[0];
    if (options.all === true) callback(null, entries);
    else if (first !== undefined) callback(null, first.address, first.family);
    else callback(new Error("no checked address"), "");
  };
}

/**
 * @internal Whether this runtime is Node.js or Bun, where `node:https`
 * honors `lookup` and `node:net`/`node:tls` sockets behave as documented.
 * Deno and Cloudflare Workers also expose `node:*` builtins but are not
 * known to honor them.
 */
export function isNodeOrBun(): boolean {
  const versions = (
    globalThis as { process?: { versions?: Record<string, unknown> } }
  ).process?.versions;
  const userAgent = (globalThis as { navigator?: { userAgent?: unknown } })
    .navigator?.userAgent;
  return (
    typeof versions?.["bun"] === "string" ||
    (typeof versions?.["node"] === "string" &&
      !("Deno" in globalThis) &&
      userAgent !== "Cloudflare-Workers")
  );
}

/**
 * @internal Imports a Node builtin through a computed specifier, which keeps
 * edge bundlers from resolving it. Returns the default export when present.
 */
export async function importNodeBuiltin<T>(name: string): Promise<T> {
  const module = (await import(
    /* @vite-ignore */ ["node", name].join(":")
  )) as T & { default?: T };
  return { ...(module.default ?? {}), ...module } as T;
}

let defaultTransport: Promise<PinnedTransport | undefined> | undefined;

/**
 * @internal Loads `node:https` once on Node.js and Bun, where its `lookup`
 * option is honored, else `undefined`.
 */
export function defaultPinnedTransport(): Promise<PinnedTransport | undefined> {
  defaultTransport ??= (async () => {
    if (!isNodeOrBun()) return undefined;
    try {
      type Https = { request?: PinnedTransport["request"] };
      type Stream = { Readable?: { toWeb?: PinnedTransport["toWeb"] } };
      const [https, stream] = await Promise.all([
        importNodeBuiltin<Https>("https"),
        importNodeBuiltin<Stream>("stream"),
      ]);
      const request = https.request;
      const readable = stream.Readable;
      const toWeb = readable?.toWeb?.bind(readable);
      if (typeof request !== "function" || typeof toWeb !== "function") {
        return undefined;
      }
      return {
        request: (url, options, onResponse) =>
          request(url, options, onResponse),
        toWeb,
      };
    } catch {
      return undefined;
    }
  })();
  return defaultTransport;
}
