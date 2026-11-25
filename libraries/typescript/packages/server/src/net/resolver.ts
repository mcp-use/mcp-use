/**
 * Host resolution with special-purpose address checks, shared by the OAuth
 * proxy and the Events webhook senders. Lifted from `oauth/proxy/clients.ts`.
 *
 * @internal
 */

import { isIpLiteral, isPrivateAddress } from "./address.js";

/** @internal Resolves a hostname to the IP addresses it points to. */
export type HostResolver = (hostname: string) => Promise<string[]>;

/**
 * @internal Outcome of {@link checkHost}: the checked addresses, or why the
 * host was refused.
 */
export type HostCheck =
  | { addresses: string[] }
  | {
      /**
       * `blocked_address`: localhost or a special-purpose address;
       * `dns_failure`: resolution failed;
       * `no_addresses`: resolution returned no address;
       * `no_resolver`: a hostname but no resolver to check it with.
       */
      refused:
        | "blocked_address"
        | "dns_failure"
        | "no_addresses"
        | "no_resolver";
    };

/**
 * @internal Resolves `hostname` and refuses it when it is localhost or when
 * any of its addresses is special-purpose. An IP literal is checked as is.
 * Without a resolver only IP literals can be checked, so hostnames are
 * refused (fail closed).
 */
export async function checkHost(
  hostname: string,
  resolve: HostResolver | undefined
): Promise<HostCheck> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    return { refused: "blocked_address" };
  }
  if (isIpLiteral(host)) {
    return isPrivateAddress(host)
      ? { refused: "blocked_address" }
      : { addresses: [host] };
  }
  if (resolve === undefined) return { refused: "no_resolver" };
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { refused: "dns_failure" };
  }
  if (addresses.length === 0) return { refused: "no_addresses" };
  if (addresses.some((address) => isPrivateAddress(address))) {
    return { refused: "blocked_address" };
  }
  return { addresses };
}

/** The parts of `node:dns` promises that the resolvers use. */
interface DnsPromises {
  lookup?: (
    hostname: string,
    options: { all: true; verbatim: boolean }
  ) => Promise<{ address: string }[]>;
  resolve4?: (hostname: string) => Promise<string[]>;
  resolve6?: (hostname: string) => Promise<string[]>;
}

/**
 * @internal Picks a resolver from a loaded `node:dns` module, or returns
 * `undefined` when it has none.
 *
 * Node.js, Bun, and Deno use `lookup`, which resolves as `fetch` does
 * (getaddrinfo, including the hosts file). Cloudflare Workers is the
 * exception: its `node:dns` (with `nodejs_compat`) implements `resolve4`
 * and `resolve6` over DNS over HTTPS but throws "Not implemented" from
 * `lookup`, and a Worker has no hosts file for `lookup` to honor, so its A
 * and AAAA records are the addresses to check.
 *
 * @param dns - The `node:dns` module namespace.
 * @param userAgent - The runtime's `navigator.userAgent`.
 */
export function hostResolverFrom(
  dns: unknown,
  userAgent: string | undefined
): HostResolver | undefined {
  const namespace = dns as
    | { promises?: DnsPromises; default?: { promises?: DnsPromises } }
    | undefined;
  const promises = namespace?.promises ?? namespace?.default?.promises;
  if (promises === undefined) return undefined;
  if (userAgent === "Cloudflare-Workers") {
    const { resolve4, resolve6 } = promises;
    if (typeof resolve4 !== "function" || typeof resolve6 !== "function") {
      return undefined;
    }
    return async (hostname) => {
      const results = await Promise.allSettled([
        resolve4(hostname),
        resolve6(hostname),
      ]);
      if (results.every((result) => result.status === "rejected")) {
        throw new Error("host does not resolve");
      }
      return results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : []
      );
    };
  }
  const lookup = promises.lookup;
  if (typeof lookup !== "function") return undefined;
  return async (hostname) =>
    (await lookup(hostname, { all: true, verbatim: true })).map(
      (entry) => entry.address
    );
}

let defaultResolver: Promise<HostResolver | undefined> | undefined;

/**
 * @internal Loads the runtime's resolver once: from `node:dns` where the
 * runtime has it, else `undefined`.
 */
export function defaultHostResolver(): Promise<HostResolver | undefined> {
  defaultResolver ??= (async () => {
    // A computed specifier keeps edge bundlers from resolving the builtin.
    const specifier = ["node", "dns"].join(":");
    let dns: unknown;
    try {
      dns = await import(/* @vite-ignore */ specifier);
    } catch {
      return undefined;
    }
    const userAgent = (globalThis as { navigator?: { userAgent?: unknown } })
      .navigator?.userAgent;
    return hostResolverFrom(
      dns,
      typeof userAgent === "string" ? userAgent : undefined
    );
  })();
  return defaultResolver;
}
