/**
 * Client identification for the OAuth proxy: redirect-URI rules, dynamic
 * client registration (RFC 7591), client ID metadata documents (CIMD), and
 * configured clients.
 *
 * @internal
 */
import { OAuthClientMetadataSchema } from "@modelcontextprotocol/core";

import { isRecord } from "../guards.js";
import { randomToken } from "./crypto.js";
import { keys, type ClientRecord } from "./records.js";
import type { SecureStore } from "./storage.js";
import { printable } from "./upstream.js";

/**
 * A client defined on the server, for clients that can use neither a client
 * ID metadata document nor dynamic client registration.
 */
export interface OAuthProxyClient {
  /** Client identifier that the client sends to `/authorize` and `/token`. */
  clientId: string;
  /** Exact redirect URIs. On loopback (`http://127.0.0.1`) any port matches. */
  redirectUris: readonly string[];
  /** Name shown on the consent page. */
  clientName?: string;
}

const BLOCKED_SCHEMES = new Set([
  // eslint-disable-next-line no-script-url -- a scheme to refuse, not a URL to run
  "javascript:",
  "data:",
  "file:",
  "vbscript:",
  "blob:",
  "about:",
  "ftp:",
  "ws:",
  "wss:",
]);

const DCR_CLIENT_TTL = 365 * 24 * 60 * 60;
const MAX_REDIRECT_URIS = 20;
const MAX_NAME_LENGTH = 200;

/** @internal Whether a redirect URI is an HTTP loopback URI (RFC 8252 7.3). */
export function isLoopbackRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === "http:" && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "localhost"
  );
}

/**
 * @internal Checks one redirect URI against the proxy's rules: HTTPS, HTTP
 * only on loopback, or a private-use scheme for native apps. Returns an
 * error message, or `undefined` when the URI is acceptable.
 */
export function redirectUriProblem(uri: unknown): string | undefined {
  if (typeof uri !== "string" || uri.length > 2000) {
    return "redirect_uris must be strings";
  }
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return `redirect URI is not an absolute URI: ${uri}`;
  }
  if (url.hash !== "") return "redirect URIs must not have a fragment";
  if (url.username !== "" || url.password !== "") {
    return "redirect URIs must not contain credentials";
  }
  if (url.protocol === "https:") return undefined;
  if (url.protocol === "http:") {
    return isLoopbackHost(url.hostname)
      ? undefined
      : "HTTP redirect URIs are allowed only on loopback addresses";
  }
  if (BLOCKED_SCHEMES.has(url.protocol)) {
    return `redirect URI scheme ${url.protocol} is not allowed`;
  }
  return undefined;
}

/**
 * @internal Matches a requested redirect URI against registered ones:
 * exactly, except that a loopback URI may use any port (RFC 8252 7.3).
 */
export function matchRedirectUri(
  requested: string,
  registered: readonly string[]
): boolean {
  if (registered.includes(requested)) return true;
  if (!isLoopbackRedirect(requested)) return false;
  const withoutPort = (uri: string): string => {
    const url = new URL(uri);
    url.port = "";
    return url.href;
  };
  const target = withoutPort(requested);
  return registered.some(
    (uri) => isLoopbackRedirect(uri) && withoutPort(uri) === target
  );
}

/**
 * @internal Metadata-document clients that may connect: exact document URLs
 * and whole origins. `undefined` lets any client connect.
 */
export interface ClientAllowlist {
  urls: Set<string>;
  origins: Set<string>;
}

/**
 * @internal Validates the `clients` option: metadata-document URLs and
 * origins go to the allowlist, and client objects become configured clients.
 */
export function configuredClients(
  clients: readonly (string | OAuthProxyClient)[] | undefined
): { byId: Map<string, ClientRecord>; allow: ClientAllowlist | undefined } {
  const byId = new Map<string, ClientRecord>();
  if (clients === undefined) return { byId, allow: undefined };
  // Cast so that Array.isArray does not widen the entries to any.
  if (!Array.isArray(clients as unknown) || clients.length === 0) {
    throw new TypeError(
      "oauthProxy clients must list at least one client; leave it unset to let any client connect"
    );
  }
  const allow: ClientAllowlist = { urls: new Set(), origins: new Set() };
  for (const client of clients) {
    if (typeof client === "string") {
      const origin = httpsOrigin(client);
      if (isCimdClientId(client)) allow.urls.add(client);
      else if (origin !== undefined) allow.origins.add(origin);
      else {
        throw new TypeError(
          `oauthProxy clients: ${client} is neither a client ID metadata document URL (https with a path) nor an https origin`
        );
      }
      continue;
    }
    const redirectUris: unknown = client?.redirectUris;
    if (
      client === null ||
      typeof client !== "object" ||
      typeof client.clientId !== "string" ||
      client.clientId.length === 0 ||
      !isStringArray(redirectUris) ||
      redirectUris.length === 0
    ) {
      throw new TypeError(
        "oauthProxy clients entries must be a URL or an object with a clientId and redirectUris"
      );
    }
    if (
      client.clientId.startsWith("https://") ||
      client.clientId.startsWith("mcp_client_")
    ) {
      throw new TypeError(
        `oauthProxy clients: client ${client.clientId} must not look like a metadata document URL or a registered client_id; list metadata documents as strings`
      );
    }
    if (byId.has(client.clientId)) {
      throw new TypeError(
        `oauthProxy clients: client ${client.clientId} is listed twice`
      );
    }
    for (const uri of redirectUris) {
      const problem = redirectUriProblem(uri);
      if (problem !== undefined) {
        throw new TypeError(`oauthProxy clients: ${problem}`);
      }
    }
    byId.set(client.clientId, {
      clientId: client.clientId,
      redirectUris: [...redirectUris],
      ...(client.clientName !== undefined && { clientName: client.clientName }),
      source: "pre-registered",
    });
  }
  return { byId, allow };
}

/** The origin of a bare `https://host[:port]` string, or `undefined`. */
function httpsOrigin(value: string): string | undefined {
  if (!value.startsWith("https://")) return undefined;
  try {
    const url = new URL(value);
    return url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === "" &&
      value.replace(/\/$/, "") === url.origin
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

/** @internal Whether a client_id is a CIMD URL: https with a non-root path. */
export function isCimdClientId(clientId: string): boolean {
  if (!clientId.startsWith("https://")) return false;
  try {
    const url = new URL(clientId);
    return (
      url.pathname !== "/" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

/** @internal Result of a registration request. */
export type RegistrationResult =
  | { ok: true; client: ClientRecord; response: Record<string, unknown> }
  | { ok: false; error: string; description: string };

/**
 * @internal Registers a public client (RFC 7591). The proxy issues no client
 * secret: every client authenticates with PKCE only.
 */
export async function registerClient(
  store: SecureStore,
  body: unknown
): Promise<RegistrationResult> {
  const parsed = OAuthClientMetadataSchema.safeParse(body);
  if (!parsed.success) {
    return invalidMetadata(
      parsed.error.issues[0]?.message ?? "invalid metadata"
    );
  }
  const metadata = parsed.data;
  if (
    metadata.redirect_uris.length === 0 ||
    metadata.redirect_uris.length > MAX_REDIRECT_URIS
  ) {
    return {
      ok: false,
      error: "invalid_redirect_uri",
      description: `register 1 to ${MAX_REDIRECT_URIS} redirect URIs`,
    };
  }
  for (const uri of metadata.redirect_uris) {
    const problem = redirectUriProblem(uri);
    if (problem !== undefined) {
      return { ok: false, error: "invalid_redirect_uri", description: problem };
    }
  }
  const grantTypes = metadata.grant_types ?? [
    "authorization_code",
    "refresh_token",
  ];
  if (
    !grantTypes.includes("authorization_code") ||
    grantTypes.some(
      (grant) => grant !== "authorization_code" && grant !== "refresh_token"
    )
  ) {
    return invalidMetadata(
      "grant_types must be authorization_code, optionally with refresh_token"
    );
  }
  const responseTypes = metadata.response_types ?? ["code"];
  if (responseTypes.some((type) => type !== "code")) {
    return invalidMetadata("response_types must be code");
  }
  const clientName =
    typeof metadata.client_name === "string"
      ? metadata.client_name.slice(0, MAX_NAME_LENGTH)
      : undefined;

  const client: ClientRecord = {
    clientId: `mcp_client_${randomToken(16)}`,
    redirectUris: [...metadata.redirect_uris],
    ...(clientName !== undefined && { clientName }),
    source: "dcr",
  };
  await store.set(keys.client(client.clientId), client, DCR_CLIENT_TTL);
  return {
    ok: true,
    client,
    response: {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: client.redirectUris,
      grant_types: grantTypes,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(clientName !== undefined && { client_name: clientName }),
      ...(metadata.scope !== undefined && { scope: metadata.scope }),
    },
  };
}

function invalidMetadata(description: string): RegistrationResult {
  return { ok: false, error: "invalid_client_metadata", description };
}

/** @internal Lookup settings for {@link resolveClient}. */
export interface ClientResolver {
  store: SecureStore;
  configured: Map<string, ClientRecord>;
  allow: ClientAllowlist | undefined;
  dcr: boolean;
  fetchCimd: (url: string) => Promise<ClientRecord>;
}

/**
 * @internal Whether a client_id may connect under the current settings,
 * without fetching or reading anything. Token requests and access-token
 * checks use it, so that removing a client from `clients` or turning off
 * registration ends its existing sign-ins too.
 */
export function isClientAdmitted(
  resolver: Pick<ClientResolver, "configured" | "allow" | "dcr">,
  clientId: string
): boolean {
  if (isCimdClientId(clientId)) {
    const allow = resolver.allow;
    return (
      allow === undefined ||
      allow.urls.has(clientId) ||
      allow.origins.has(new URL(clientId).origin)
    );
  }
  if (resolver.configured.has(clientId)) return true;
  return resolver.dcr && clientId.startsWith("mcp_client_");
}

/**
 * @internal Resolves a client_id: a CIMD URL first, then a configured
 * client, then a registered one. Returns an error message when the client
 * is unknown or not allowed.
 */
export async function resolveClient(
  resolver: ClientResolver,
  clientId: string
): Promise<ClientRecord | string> {
  if (isCimdClientId(clientId)) {
    // Check the allowlist before fetching, so an unlisted client never
    // makes the server request its URL.
    if (!isClientAdmitted(resolver, clientId)) {
      return "this app is not allowed to connect to this server";
    }
    try {
      return await resolver.fetchCimd(clientId);
    } catch (error) {
      const reason = `client metadata document could not be used: ${
        error instanceof Error ? error.message : String(error)
      }`;
      // Only the log gets the cause of a failed request (an HTTP status or
      // a network error): on the page, it would let a caller probe hosts.
      const cause =
        error instanceof Error && error.cause !== undefined
          ? ` (${error.cause instanceof Error ? error.cause.message : String(error.cause)})`
          : "";
      console.warn(
        `[mcp-use] oauthProxy: refused ${printable(clientId)}: ${printable(reason + cause)}`
      );
      return reason;
    }
  }
  const configured = resolver.configured.get(clientId);
  if (configured !== undefined) return configured;
  if (resolver.dcr && clientId.startsWith("mcp_client_")) {
    const registered = await resolver.store.get<ClientRecord>(
      keys.client(clientId)
    );
    if (isClientRecord(registered)) return registered;
  }
  return "unknown client_id";
}

function isClientRecord(value: unknown): value is ClientRecord {
  return (
    isRecord(value) &&
    typeof value["clientId"] === "string" &&
    Array.isArray(value["redirectUris"])
  );
}

const CIMD_MAX_BYTES = 5 * 1024;
const CIMD_TIMEOUT_MS = 10_000;
const CIMD_CACHE_MS = 5 * 60 * 1000;
const CIMD_CACHE_SIZE = 256;
// The page shows only this for a failed request; the log adds the cause.
const CIMD_UNAVAILABLE = "metadata document could not be loaded";
// Both request paths send these. Some CDNs and WAFs refuse a request with no
// User-Agent, and `node:https` sends none by default.
const CIMD_HEADERS = {
  accept: "application/json",
  "user-agent": "mcp-use-oauth-proxy",
};

/**
 * @internal Creates a CIMD fetcher with a small in-process cache. With a
 * `resolver` loader, the host must resolve only to public addresses, and a
 * runtime without a resolver refuses every document. `false` skips the
 * check, for a custom `fetch` that enforces its own network policy.
 *
 * When the host is checked and `transport` loads one (Node.js and Bun), the
 * request connects only to the checked addresses. Elsewhere `fetchImpl`
 * resolves the host again, which leaves a small DNS-rebinding window.
 */
export function createCimdFetcher(
  fetchImpl: typeof globalThis.fetch,
  resolver: (() => Promise<HostResolver | undefined>) | false,
  transport: () => Promise<PinnedTransport | undefined> = defaultPinnedTransport
): (url: string) => Promise<ClientRecord> {
  const cache = new Map<string, { client: ClientRecord; expiresAt: number }>();
  return async (clientId) => {
    const cached = cache.get(clientId);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return cached.client;
    }
    const url = new URL(clientId);
    const pinned =
      resolver === false
        ? undefined
        : {
            addresses: await resolvePublicAddresses(
              url.hostname,
              await resolver()
            ),
            transport: await transport(),
          };
    const signal = AbortSignal.timeout(CIMD_TIMEOUT_MS);
    let response: Response;
    try {
      response =
        pinned?.transport === undefined
          ? await fetchImpl(url.href, {
              redirect: "manual",
              headers: { ...CIMD_HEADERS },
              signal,
            })
          : await requestPinned(
              pinned.transport,
              url,
              pinned.addresses,
              signal
            );
    } catch (error) {
      throw new Error(CIMD_UNAVAILABLE, { cause: error });
    }
    if (response.status !== 200) {
      throw new Error(CIMD_UNAVAILABLE, {
        cause: new Error(`HTTP ${response.status}`),
      });
    }
    const text = await readLimited(response, CIMD_MAX_BYTES);
    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch {
      throw new Error("metadata document is not JSON");
    }
    if (!isRecord(document) || document["client_id"] !== clientId) {
      throw new Error("metadata document client_id does not match its URL");
    }
    const parsed = OAuthClientMetadataSchema.safeParse(document);
    if (!parsed.success || parsed.data.redirect_uris.length === 0) {
      throw new Error("metadata document has no valid redirect_uris");
    }
    // When the document lists the methods it can use, the singular method
    // is only a preference (ChatGPT prefers private_key_jwt but lists none),
    // so the list decides. The schema strips the list; read the document.
    const methods = document["token_endpoint_auth_methods_supported"];
    const supportsNone = Array.isArray(methods)
      ? methods.includes("none")
      : parsed.data.token_endpoint_auth_method === undefined ||
        parsed.data.token_endpoint_auth_method === "none";
    if (document["client_secret"] !== undefined || !supportsNone) {
      throw new Error(
        "only public clients (token_endpoint_auth_method none) are supported"
      );
    }
    for (const uri of parsed.data.redirect_uris) {
      const problem = redirectUriProblem(uri);
      if (problem !== undefined) throw new Error(problem);
    }
    const client: ClientRecord = {
      clientId,
      redirectUris: [...parsed.data.redirect_uris],
      ...(typeof parsed.data.client_name === "string" && {
        clientName: parsed.data.client_name.slice(0, MAX_NAME_LENGTH),
      }),
      source: "cimd",
    };
    if (cache.size >= CIMD_CACHE_SIZE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(clientId, { client, expiresAt: Date.now() + CIMD_CACHE_MS });
    return client;
  };
}

async function readLimited(response: Response, limit: number): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > limit) throw new Error("metadata document is too large");
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("metadata document is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

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

/** The parts of a `node:http` response that {@link requestPinned} uses. */
interface PinnedResponse {
  statusCode?: number | undefined;
  headers: Record<string, string | string[] | undefined>;
  destroy(): unknown;
}

/**
 * @internal The parts of `node:https` and `node:stream` that
 * {@link createCimdFetcher} uses to connect to checked addresses only.
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

/**
 * GETs `url` over `node:https`, connecting only to `addresses` (already
 * checked) instead of resolving the host again, which would let a host
 * that answers DNS differently the second time reach a private address.
 * TLS and the Host header still use the URL's hostname. Like the `fetch`
 * call it replaces, it does not follow redirects.
 */
function requestPinned(
  transport: PinnedTransport,
  url: URL,
  addresses: readonly string[],
  signal: AbortSignal
): Promise<Response> {
  const entries = addresses.map((address) => ({
    address,
    family: address.includes(":") ? 6 : 4,
  }));
  const lookup: PinnedLookup = (_hostname, options, callback) => {
    const first = entries[0];
    if (options.all === true) callback(null, entries);
    else if (first !== undefined) callback(null, first.address, first.family);
    else callback(new Error("no checked address"), "");
  };
  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      { headers: { ...CIMD_HEADERS }, signal, lookup },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status !== 200) {
          response.destroy();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (typeof value === "string") headers.set(name, value);
        }
        resolve(
          new Response(transport.toWeb(response), { status: 200, headers })
        );
      }
    );
    request.on("error", reject);
    request.end();
  });
}

let defaultTransport: Promise<PinnedTransport | undefined> | undefined;

/**
 * @internal Loads `node:https` once on Node.js and Bun, where its `lookup`
 * option is honored, else `undefined`. Deno and Cloudflare Workers also
 * have `node:https`, but are not known to honor `lookup`.
 */
export function defaultPinnedTransport(): Promise<PinnedTransport | undefined> {
  defaultTransport ??= (async () => {
    const versions = (
      globalThis as { process?: { versions?: Record<string, unknown> } }
    ).process?.versions;
    const userAgent = (globalThis as { navigator?: { userAgent?: unknown } })
      .navigator?.userAgent;
    const nodeOrBun =
      typeof versions?.["bun"] === "string" ||
      (typeof versions?.["node"] === "string" &&
        !("Deno" in globalThis) &&
        userAgent !== "Cloudflare-Workers");
    if (!nodeOrBun) return undefined;
    try {
      // Computed specifiers keep edge bundlers from resolving the builtins.
      type Https = { request?: PinnedTransport["request"] };
      type Stream = {
        Readable?: { toWeb?: PinnedTransport["toWeb"] };
      };
      const [https, stream] = (await Promise.all([
        import(/* @vite-ignore */ ["node", "https"].join(":")),
        import(/* @vite-ignore */ ["node", "stream"].join(":")),
      ])) as [Https & { default?: Https }, Stream & { default?: Stream }];
      const request = https.request ?? https.default?.request;
      const readable = stream.Readable ?? stream.default?.Readable;
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

/** @internal Resolves a hostname to the IP addresses it points to. */
export type HostResolver = (hostname: string) => Promise<string[]>;

/**
 * @internal Refuses hosts that resolve to private, loopback, link-local, or
 * otherwise non-public addresses (SSRF). Without a `resolve`, only an IP
 * literal can be checked, so any other host is refused: failing open would
 * let a metadata-document URL reach the server's private network.
 */
export async function assertPublicHost(
  hostname: string,
  resolve: HostResolver | undefined
): Promise<void> {
  await resolvePublicAddresses(hostname, resolve);
}

/**
 * @internal {@link assertPublicHost}, returning the checked addresses (the
 * address itself for an IP literal) so the request can connect to them.
 */
export async function resolvePublicAddresses(
  hostname: string,
  resolve: HostResolver | undefined
): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("metadata document host is not public");
  }
  if (isIpLiteral(host)) {
    if (isPrivateAddress(host)) {
      throw new Error("metadata document host is not public");
    }
    return [host];
  }
  if (resolve === undefined) {
    throw new Error(
      "metadata document host cannot be checked: this runtime has no node:dns to resolve it. Enable node:dns (nodejs_compat on Cloudflare Workers), or pass oauthProxy a fetch that enforces your own network policy"
    );
  }
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new Error("metadata document host does not resolve");
  }
  if (
    addresses.length === 0 ||
    addresses.some((address) => isPrivateAddress(address))
  ) {
    throw new Error("metadata document host is not public");
  }
  return addresses;
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
 * runtime has it, else `undefined`, which refuses metadata documents.
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

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/** @internal Whether an IP address is not publicly routable. */
export function isPrivateAddress(address: string): boolean {
  const ipv4 = address.match(
    /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i
  );
  if (ipv4 !== null) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && Number(ipv4[3]) === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const ipv6 = address.toLowerCase();
  return (
    ipv6 === "::" ||
    ipv6 === "::1" ||
    /^f[cd]/.test(ipv6) ||
    // fe80::/10 link-local and fec0::/10 (deprecated) site-local.
    /^fe[89a-f]/.test(ipv6) ||
    ipv6.startsWith("ff") ||
    ipv6.startsWith("64:ff9b:") ||
    ipv6.startsWith("::ffff:")
  );
}
