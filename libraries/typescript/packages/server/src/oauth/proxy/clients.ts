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

/** A client configured on the server instead of registered at runtime. */
export interface OAuthProxyClient {
  /** Client identifier that the client sends to `/authorize` and `/token`. */
  clientId: string;
  /** Exact redirect URIs. On loopback (`http://127.0.0.1`) any port matches. */
  redirectUris: readonly string[];
  /** Name shown on the consent page. */
  clientName?: string;
  /**
   * Skip the consent page for this client. Allowed only when every redirect
   * URI is HTTPS, because a loopback or custom-scheme redirect can be
   * claimed by any local app.
   *
   * @defaultValue `false`
   */
  trusted?: boolean;
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

/** @internal Validates configured clients and returns client records. */
export function configuredClients(
  clients: readonly OAuthProxyClient[] | undefined,
  trustedCimd: readonly string[] | undefined
): { byId: Map<string, ClientRecord>; trustedCimd: Set<string> } {
  const byId = new Map<string, ClientRecord>();
  for (const client of clients ?? []) {
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
        "oauthProxy preRegisteredClients entries need a clientId and redirectUris"
      );
    }
    if (isCimdClientId(client.clientId)) {
      throw new TypeError(
        "oauthProxy preRegisteredClients clientId must not be an https URL; list CIMD clients in trustedClients"
      );
    }
    for (const uri of redirectUris) {
      const problem = redirectUriProblem(uri);
      if (problem !== undefined) {
        throw new TypeError(`oauthProxy preRegisteredClients: ${problem}`);
      }
    }
    if (
      client.trusted === true &&
      !redirectUris.every((uri) => uri.startsWith("https://"))
    ) {
      throw new TypeError(
        `oauthProxy preRegisteredClients: client ${client.clientId} can be trusted only with HTTPS redirect URIs`
      );
    }
    byId.set(client.clientId, {
      clientId: client.clientId,
      redirectUris: [...redirectUris],
      ...(client.clientName !== undefined && { clientName: client.clientName }),
      source: "pre-registered",
      trusted: client.trusted === true,
    });
  }
  const trusted = new Set<string>();
  for (const clientId of trustedCimd ?? []) {
    if (typeof clientId !== "string" || !isCimdClientId(clientId)) {
      throw new TypeError(
        "oauthProxy trustedClients entries must be client ID metadata document URLs (https with a path)"
      );
    }
    trusted.add(clientId);
  }
  return { byId, trustedCimd: trusted };
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
    trusted: false,
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
  trustedCimd: Set<string>;
  cimd: boolean;
  dcr: boolean;
  fetchCimd: (url: string) => Promise<ClientRecord>;
}

/**
 * @internal Resolves a client_id: a CIMD URL first, then a registered
 * client, then a configured one. Returns an error message when unknown.
 */
export async function resolveClient(
  resolver: ClientResolver,
  clientId: string
): Promise<ClientRecord | string> {
  if (isCimdClientId(clientId)) {
    if (!resolver.cimd) {
      return "client ID metadata documents are disabled on this server";
    }
    try {
      const client = await resolver.fetchCimd(clientId);
      return { ...client, trusted: resolver.trustedCimd.has(clientId) };
    } catch (error) {
      return `client metadata document could not be used: ${
        error instanceof Error ? error.message : String(error)
      }`;
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

/**
 * @internal Creates a CIMD fetcher with a small in-process cache. When
 * `checkHost` is set, the host must resolve only to public addresses.
 */
export function createCimdFetcher(
  fetchImpl: typeof globalThis.fetch,
  checkHost: boolean
): (url: string) => Promise<ClientRecord> {
  const cache = new Map<string, { client: ClientRecord; expiresAt: number }>();
  return async (clientId) => {
    const cached = cache.get(clientId);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return cached.client;
    }
    const url = new URL(clientId);
    if (checkHost) await assertPublicHost(url.hostname);
    const response = await fetchImpl(url.href, {
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      throw new Error(`metadata document returned HTTP ${response.status}`);
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
    if (
      document["client_secret"] !== undefined ||
      (parsed.data.token_endpoint_auth_method !== undefined &&
        parsed.data.token_endpoint_auth_method !== "none")
    ) {
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
      trusted: false,
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

/**
 * @internal Refuses hosts that resolve to private, loopback, link-local, or
 * otherwise non-public addresses (SSRF). On runtimes without `node:dns`
 * (Workers), only IP literals are checked; the platform's outbound network
 * cannot reach private ranges.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("metadata document host is not public");
  }
  if (isIpLiteral(host)) {
    if (isPrivateAddress(host)) {
      throw new Error("metadata document host is not public");
    }
    return;
  }
  const lookup = await nodeLookup();
  if (lookup === undefined) return;
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("metadata document host does not resolve");
  }
  if (
    addresses.length === 0 ||
    addresses.some((entry) => isPrivateAddress(entry.address))
  ) {
    throw new Error("metadata document host is not public");
  }
}

type Lookup = (
  hostname: string,
  options: { all: true; verbatim: boolean }
) => Promise<{ address: string }[]>;

async function nodeLookup(): Promise<Lookup | undefined> {
  if (typeof process === "undefined" || process.versions?.node === undefined) {
    return undefined;
  }
  // A computed specifier keeps edge bundlers from resolving the builtin.
  const specifier = ["node:dns", "promises"].join("/");
  try {
    const dns = (await import(/* @vite-ignore */ specifier)) as {
      lookup: Lookup;
    };
    return dns.lookup;
  } catch {
    return undefined;
  }
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
    /^fe[89ab]/.test(ipv6) ||
    ipv6.startsWith("ff") ||
    ipv6.startsWith("64:ff9b:") ||
    ipv6.startsWith("::ffff:")
  );
}
