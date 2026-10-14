/**
 * OAuth proxy end to end against emulated GitHub and Google (the `emulate`
 * package). A fetch-based browser follows every redirect, posts the consent
 * form and the emulator's sign-in form, and keeps cookies per origin. The
 * MCP server runs through `server.fetch`; the emulators listen on loopback.
 *
 * emulate GitHub ignores PKCE and has no refresh grant, and emulate Google
 * always returns a refresh token; fetch wrappers on the proxy's upstream
 * requests cover those gaps.
 */
import { createEmulator, type Emulator } from "emulate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { isBuilding, MCPServer } from "../src/index.js";
import {
  github,
  google,
  memoryStorage,
  oauthProxy,
  upstreamToken,
  type OAuthProxyOptions,
  type OAuthProxyStorage,
  type UpstreamUser,
} from "../src/oauth/index.js";
import { upstashStorage } from "../src/oauth/storage.js";

const ORIGIN = "http://localhost:4319";
const RESOURCE = `${ORIGIN}/mcp`;
const CALLBACK = `${RESOURCE}/oauth/callback`;
const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const GITHUB_CLIENT_ID = "Iv1.proxytest";
const GITHUB_CLIENT_SECRET = "github-app-secret-never-leaves-the-server";
const GOOGLE_CLIENT_ID = "proxy-test.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "GOCSPX-google-secret-never-leaves";
const CLIENT_REDIRECT = "http://127.0.0.1:53682/callback";

let githubEmulator: Emulator;
let googleEmulator: Emulator;

beforeAll(async () => {
  githubEmulator = await createEmulator({
    service: "github",
    port: 0,
    seed: {
      github: {
        // emulate answers unknown tokens as the first user, so every test
        // signs in as the second one.
        users: [
          { login: "octocat", name: "The Octocat" },
          { login: "hubot", name: "Hubot" },
        ],
        oauth_apps: [
          {
            client_id: GITHUB_CLIENT_ID,
            client_secret: GITHUB_CLIENT_SECRET,
            name: "Acme MCP",
            redirect_uris: [CALLBACK],
          },
        ],
      },
    },
  });
  googleEmulator = await createEmulator({
    service: "google",
    port: 0,
    seed: {
      google: {
        users: [
          { email: "first@example.com", name: "First" },
          { email: "second@example.com", name: "Second" },
        ],
        oauth_clients: [
          {
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uris: [CALLBACK],
          },
        ],
      },
    },
  });
});

afterAll(async () => {
  await githubEmulator?.close();
  await googleEmulator?.close();
});

// ─── Harness ─────────────────────────────────────────────────────────────

/** Upstream token-endpoint responses, as the proxy's fetch saw them. */
class UpstreamSpy {
  readonly secrets = new Set<string>();
  readonly tokenRequests: URLSearchParams[] = [];
  /** Rewrites a parsed token response; return it (or a Response) to replace. */
  rewrite?: (
    body: Record<string, unknown>,
    request: URLSearchParams
  ) => Record<string, unknown> | Response;

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const isToken =
      url.endsWith("/login/oauth/access_token") ||
      url.endsWith("/oauth2/token");
    if (!isToken) return globalThis.fetch(input, init);
    const request = new URLSearchParams(String(init?.body ?? ""));
    this.tokenRequests.push(request);
    const response = await globalThis.fetch(input, init);
    let body = (await response.clone().json()) as Record<string, unknown>;
    const rewritten = this.rewrite?.(body, request);
    if (rewritten instanceof Response) return rewritten;
    let result = response;
    if (rewritten !== undefined) {
      body = rewritten;
      result = new Response(JSON.stringify(body), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }
    for (const field of ["access_token", "refresh_token", "id_token"]) {
      if (typeof body[field] === "string")
        this.secrets.add(body[field] as string);
    }
    return result;
  };
}

/** A fetch-based browser and MCP client with one transcript. */
class Browser {
  readonly jar = new Map<string, Map<string, string>>();
  readonly transcript: string[] = [];
  readonly visited: string[] = [];

  constructor(
    private readonly server: { fetch(request: Request): Promise<Response> }
  ) {}

  async request(url: string, init: RequestInit = {}): Promise<Response> {
    const target = new URL(url);
    const headers = new Headers(init.headers);
    const cookies = this.jar.get(target.origin);
    if (cookies !== undefined && cookies.size > 0) {
      headers.set(
        "cookie",
        [...cookies].map(([name, value]) => `${name}=${value}`).join("; ")
      );
    }
    this.visited.push(`${init.method ?? "GET"} ${target.href}`);
    const request = new Request(target, {
      ...init,
      headers,
      redirect: "manual",
    });
    const response =
      target.origin === ORIGIN
        ? await this.server.fetch(request)
        : await fetch(request);
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split(";");
      const index = pair!.indexOf("=");
      const name = pair!.slice(0, index).trim();
      const value = pair!.slice(index + 1).trim();
      const jar = this.jar.get(target.origin) ?? new Map<string, string>();
      this.jar.set(target.origin, jar);
      if (
        value === "" ||
        attributes.some((item) => /max-age=0\b/i.test(item.trim()))
      ) {
        jar.delete(name);
      } else {
        jar.set(name, value);
      }
    }
    const body = await response.clone().text();
    this.transcript.push(
      [
        `${init.method ?? "GET"} ${url} ${String(init.body ?? "")}`,
        `${response.status}`,
        ...[...response.headers].map(([name, value]) => `${name}: ${value}`),
        body,
      ].join("\n")
    );
    return response;
  }

  form(url: string, fields: Record<string, string>): Promise<Response> {
    return this.request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function hiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of html.matchAll(
    /<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g
  )) {
    fields[decodeHtml(match[1]!)] = decodeHtml(match[2]!);
  }
  return fields;
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const encode = (data: Uint8Array) =>
    btoa(String.fromCharCode(...data))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const verifier = encode(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  );
  return { verifier, challenge: encode(digest) };
}

interface SignInResult {
  code: string;
  verifier: string;
  redirect: URL;
}

/**
 * Runs /authorize until the browser lands on the client's redirect URI:
 * approves consent pages and picks `login` on the emulator's sign-in page.
 */
async function signIn(
  browser: Browser,
  client: { clientId: string; redirectUri: string },
  login: string,
  options: {
    decision?: "allow" | "deny";
    state?: string;
    scope?: string;
    /** `iss` to add to the upstream's redirect, as real GitHub sends one. */
    upstreamIssuer?: string;
    /** Edits the upstream's redirect to the proxy callback. */
    editCallback?: (url: URL) => void;
  } = {}
): Promise<SignInResult> {
  const { verifier, challenge } = await pkcePair();
  const authorize = new URL(`${RESOURCE}/oauth/authorize`);
  for (const [name, value] of Object.entries({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: options.state ?? "client-state-42",
    resource: RESOURCE,
    ...(options.scope !== undefined && { scope: options.scope }),
  })) {
    authorize.searchParams.set(name, value);
  }
  const follow = (response: Response, from: string): string => {
    const next = new URL(response.headers.get("location")!, from);
    if (next.href.startsWith(CALLBACK)) {
      if (options.upstreamIssuer !== undefined) {
        next.searchParams.set("iss", options.upstreamIssuer);
      }
      options.editCallback?.(next);
    }
    return next.href;
  };
  let url = authorize.href;
  for (let hop = 0; hop < 20; hop++) {
    const target = new URL(url);
    if (
      `${target.origin}${target.pathname}` === client.redirectUri.split("?")[0]
    ) {
      return {
        code: target.searchParams.get("code") ?? "",
        verifier,
        redirect: target,
      };
    }
    const response = await browser.request(url);
    if (response.status === 302) {
      url = follow(response, url);
      continue;
    }
    const html = await response.text();
    if (response.status === 200 && html.includes('name="decision"')) {
      const action = decodeHtml(html.match(/<form[^>]*action="([^"]+)"/)![1]!);
      const answer = await browser.form(new URL(action, url).href, {
        ...hiddenFields(html),
        decision: options.decision ?? "allow",
      });
      expect(answer.status).toBe(302);
      url = follow(answer, url);
      continue;
    }
    if (response.status === 200 && target.origin !== ORIGIN) {
      const form = html
        .split("<form")
        .find((part) => part.includes(`value="${login}"`));
      if (form === undefined) throw new Error(`no sign-in form for ${login}`);
      const action = decodeHtml(form.match(/action="([^"]+)"/)![1]!);
      const answer = await browser.form(
        new URL(action, url).href,
        hiddenFields(`<form${form}`)
      );
      expect(answer.status).toBe(302);
      url = follow(answer, url);
      continue;
    }
    throw new Error(
      `unexpected ${response.status} at ${url}: ${html.slice(0, 300)}`
    );
  }
  throw new Error("too many redirects");
}

async function register(
  browser: Browser,
  redirectUris: string[] = [CLIENT_REDIRECT]
): Promise<{ clientId: string; redirectUri: string }> {
  const response = await browser.request(`${RESOURCE}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Test Client",
      redirect_uris: redirectUris,
    }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body["client_secret"]).toBeUndefined();
  expect(body["token_endpoint_auth_method"]).toBe("none");
  return {
    clientId: body["client_id"] as string,
    redirectUri: redirectUris[0]!,
  };
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

async function exchange(
  browser: Browser,
  client: { clientId: string; redirectUri: string },
  code: string,
  verifier: string
): Promise<{ status: number; body: TokenResponse }> {
  const response = await browser.form(`${RESOURCE}/oauth/token`, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    resource: RESOURCE,
  });
  return {
    status: response.status,
    body: (await response.json()) as TokenResponse,
  };
}

async function refresh(
  browser: Browser,
  clientId: string,
  refreshToken: string,
  extra: Record<string, string> = {}
): Promise<{ status: number; body: TokenResponse }> {
  const response = await browser.form(`${RESOURCE}/oauth/token`, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    ...extra,
  });
  return {
    status: response.status,
    body: (await response.json()) as TokenResponse,
  };
}

const ENVELOPE = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

async function callTool(
  browser: Browser,
  name: string,
  accessToken?: string
): Promise<Response> {
  return browser.request(RESOURCE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": name,
      ...(accessToken !== undefined && {
        authorization: `Bearer ${accessToken}`,
      }),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: {}, _meta: ENVELOPE },
    }),
  });
}

async function toolText(response: Response): Promise<string> {
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result: { content: Array<{ text: string }> };
  };
  return body.result.content[0]!.text;
}

/** Records what the code under test writes to one console method. */
function captureConsole(method: "error" | "warn" | "info") {
  const calls: unknown[][] = [];
  const spy = vi.spyOn(console, method).mockImplementation((...args) => {
    calls.push(args);
  });
  return {
    calls,
    text: () => calls.map((args) => args.join(" ")).join("\n"),
    restore: () => spy.mockRestore(),
  };
}

/** A Map-backed store whose contents the tests can inspect. */
function inspectableStorage(): OAuthProxyStorage & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    get: async (key) => values.get(key),
    set: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => {
      values.delete(key);
    },
    take: async (key) => {
      const value = values.get(key);
      values.delete(key);
      return value;
    },
    add: async (key, value) => {
      if (values.has(key)) return false;
      values.set(key, value);
      return true;
    },
  };
}

/**
 * A memoryStorage (values expire) that remembers which keys were written,
 * so tests can see whether a lock or record is present.
 */
function trackedStorage(): OAuthProxyStorage & {
  live(prefix: string): Promise<string[]>;
} {
  const inner = memoryStorage();
  const written = new Set<string>();
  return {
    get: (key) => inner.get(key),
    set: async (key, value, ttlSeconds) => {
      written.add(key);
      await inner.set(key, value, ttlSeconds);
    },
    delete: (key) => inner.delete(key),
    take: (key) => inner.take(key),
    add: async (key, value, ttlSeconds) => {
      const added = await inner.add(key, value, ttlSeconds);
      if (added) written.add(key);
      return added;
    },
    live: async (prefix) => {
      const found: string[] = [];
      for (const key of written) {
        // Keys are `mcp-use:oauth:<hash of the resource>:<record key>`.
        if (
          key.split(":").slice(3).join(":").startsWith(prefix) &&
          (await inner.get(key)) !== undefined
        ) {
          found.push(key);
        }
      }
      return found;
    },
  };
}

/**
 * Holds upstream refresh requests at the token endpoint. `hold()` arms one
 * gate: the next upstream refresh waits on it until `release()`.
 */
function upstreamRefreshGate(inner: typeof globalThis.fetch) {
  const armed: { entered: () => void; released: Promise<void> }[] = [];
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = new URLSearchParams(String(init?.body ?? ""));
    if (
      url.endsWith("/oauth2/token") &&
      body.get("grant_type") === "refresh_token"
    ) {
      const gate = armed.shift();
      if (gate !== undefined) {
        gate.entered();
        await gate.released;
      }
    }
    return inner(input, init);
  };
  const hold = () => {
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    armed.push({ entered, released });
    return { reached, release };
  };
  return { fetch: fetchImpl, hold };
}

interface GitHubSetup {
  server: MCPServer<UpstreamUser>;
  spy: UpstreamSpy;
  toolTokens: string[];
}

function githubServer(
  overrides: Partial<OAuthProxyOptions<UpstreamUser>> = {},
  serverOptions: { title?: string } = {}
): GitHubSetup {
  const spy = new UpstreamSpy();
  const toolTokens: string[] = [];
  const server = new MCPServer({
    name: "acme",
    version: "1.0.0",
    ...(serverOptions.title !== undefined && { title: serverOptions.title }),
    logging: { enabled: false },
    oauth: oauthProxy({
      resource: RESOURCE,
      upstream: github({
        clientId: GITHUB_CLIENT_ID,
        clientSecret: GITHUB_CLIENT_SECRET,
        scopes: ["read:user"],
        baseUrl: githubEmulator.url,
      }),
      secret: SECRET,
      storage: memoryStorage(),
      fetch: spy.fetch,
      ...overrides,
    }),
  });
  server.tool({ name: "whoami" }, async (_input, ctx) => {
    const token = upstreamToken(ctx);
    toolTokens.push(token);
    const response = await fetch(`${githubEmulator.url}/user`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const user = (await response.json()) as { login: string };
    return {
      content: [
        {
          type: "text",
          text: `${user.login} ${ctx.auth.user.subject} ${ctx.auth.accessToken.slice(0, 7)}`,
        },
      ],
    };
  });
  server.tool({ name: "scopes" }, async (_input, ctx) => ({
    content: [{ type: "text", text: ctx.auth.scopes.join(" ") }],
  }));
  return { server, spy, toolTokens };
}

// ─── GitHub ──────────────────────────────────────────────────────────────

describe("oauthProxy with emulated GitHub", () => {
  it("checks the iss parameter that GitHub adds to its redirect", async () => {
    // github.com sends iss=https://github.com/login/oauth; the emulator sends
    // none, so the test adds it.
    const { server } = githubServer();
    const browser = new Browser(server);
    const client = await register(browser);
    const signedIn = await signIn(browser, client, "hubot", {
      upstreamIssuer: `${githubEmulator.url}/login/oauth`,
    });
    expect(signedIn.redirect.searchParams.get("error")).toBeNull();
    const tokens = await exchange(
      browser,
      client,
      signedIn.code,
      signedIn.verifier
    );
    expect(tokens.status).toBe(200);

    // A response from another issuer is refused (mix-up attack defense),
    // and the log says which issuer was expected.
    const logged = captureConsole("error");
    let upstreamCode = "";
    const mixedUp = await signIn(browser, client, "hubot", {
      upstreamIssuer: "https://attacker.example",
      editCallback: (url) => {
        upstreamCode = url.searchParams.get("code")!;
      },
    }).finally(logged.restore);
    expect(mixedUp.redirect.searchParams.get("error")).toBe("server_error");
    expect(mixedUp.code).toBe("");
    expect(mixedUp.redirect.searchParams.get("error_description")).toBe(
      "GitHub sign-in failed"
    );
    expect(logged.text()).toContain(
      `GitHub callback failed validation: OperationProcessingError: unexpected "iss" (issuer) response parameter value [OAUTH_INVALID_RESPONSE] (expected "${githubEmulator.url}/login/oauth", got "https://attacker.example")`
    );
    expect(upstreamCode).not.toBe("");
    expect(logged.text()).not.toContain(upstreamCode);
  });

  it("explains a failed GitHub token exchange in the log and to the client", async () => {
    const { server, spy } = githubServer();
    // GitHub answers token errors with HTTP 200.
    spy.rewrite = () =>
      Response.json({
        error: "bad_verification_code",
        error_description: "The code passed is incorrect or expired.",
      });
    const browser = new Browser(server);
    const client = await register(browser);
    const logged = captureConsole("error");
    const failed = await signIn(browser, client, "hubot").finally(
      logged.restore
    );
    expect(failed.redirect.searchParams.get("error")).toBe("server_error");
    expect(failed.redirect.searchParams.get("error_description")).toBe(
      "GitHub sign-in failed (bad_verification_code): The code passed is incorrect or expired."
    );
    expect(failed.redirect.searchParams.get("state")).toBe("client-state-42");
    expect(logged.text()).toContain(
      "GitHub sign-in failed: GitHub token endpoint returned bad_verification_code: The code passed is incorrect or expired. (HTTP 200)"
    );
  });

  it("logs an error that GitHub returns to the callback, without line breaks", async () => {
    const { server } = githubServer();
    const browser = new Browser(server);
    const client = await register(browser);
    const logged = captureConsole("error");
    const failed = await signIn(browser, client, "hubot", {
      editCallback: (url) => {
        url.searchParams.delete("code");
        url.searchParams.set("error", "application_suspended");
        url.searchParams.set(
          "error_description",
          "Your application has been suspended.\n[mcp-use] forged line"
        );
      },
    }).finally(logged.restore);
    expect(failed.redirect.searchParams.get("error")).toBe("server_error");
    expect(failed.redirect.searchParams.get("error_description")).toBe(
      "GitHub sign-in did not complete (application_suspended)"
    );
    expect(logged.calls).toEqual([
      [
        "[mcp-use] oauthProxy: sign-in failed. GitHub returned application_suspended: Your application has been suspended. [mcp-use] forged line",
      ],
    ]);
  });

  it("signs a client in without a GitHub app and keeps GitHub secrets on the server", async () => {
    const { server, spy, toolTokens } = githubServer();
    const browser = new Browser(server);

    // Discovery: 401 → protected resource metadata → the server itself.
    const challenge = await callTool(browser, "whoami");
    expect(challenge.status).toBe(401);
    const metadataUrl = challenge.headers
      .get("www-authenticate")!
      .match(/resource_metadata="([^"]+)"/)![1]!;
    const prm = (await (await browser.request(metadataUrl)).json()) as {
      authorization_servers: string[];
    };
    expect(prm.authorization_servers).toEqual([ORIGIN]);
    const metadata = (await (
      await browser.request(`${ORIGIN}/.well-known/oauth-authorization-server`)
    ).json()) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${RESOURCE}/oauth/authorize`,
      token_endpoint: `${RESOURCE}/oauth/token`,
      registration_endpoint: `${RESOURCE}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });

    const client = await register(browser);
    const { code, verifier, redirect } = await signIn(browser, client, "hubot");
    expect(redirect.searchParams.get("state")).toBe("client-state-42");
    expect(redirect.searchParams.get("iss")).toBe(ORIGIN);

    // The browser went to GitHub as the server's app, with the server's PKCE.
    const upstreamAuthorize = browser.visited.find((entry) =>
      entry.includes("/login/oauth/authorize")
    )!;
    const upstreamUrl = new URL(upstreamAuthorize.split(" ")[1]!);
    expect(upstreamUrl.searchParams.get("client_id")).toBe(GITHUB_CLIENT_ID);
    expect(upstreamUrl.searchParams.get("redirect_uri")).toBe(CALLBACK);
    expect(upstreamUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(spy.tokenRequests[0]!.get("code_verifier")).toMatch(/^[\w-]{43}$/);
    expect(spy.tokenRequests[0]!.get("client_secret")).toBe(
      GITHUB_CLIENT_SECRET
    );

    const tokens = await exchange(browser, client, code, verifier);
    expect(tokens.status).toBe(200);
    expect(tokens.body.access_token).toMatch(/^mcp_at_/);
    expect(tokens.body.refresh_token).toMatch(/^mcp_rt_/);
    expect(tokens.body.expires_in).toBe(3600);

    const text = await toolText(
      await callTool(browser, "whoami", tokens.body.access_token)
    );
    const [login, subject, prefix] = text.split(" ");
    expect(login).toBe("hubot");
    expect(subject).toMatch(/^\d+$/);
    expect(prefix).toBe("mcp_at_");

    // The tool held the real GitHub token; the client never saw it.
    expect(spy.secrets.size).toBeGreaterThan(0);
    expect(spy.secrets.has(toolTokens[0]!)).toBe(true);
    const transcript = browser.transcript.join("\n");
    for (const secret of [...spy.secrets, GITHUB_CLIENT_SECRET, SECRET]) {
      expect(transcript).not.toContain(secret);
    }
  });

  it("stores only encrypted values under hashed keys", async () => {
    const storage = inspectableStorage();
    const { server, spy } = githubServer({ storage });
    const browser = new Browser(server);
    const client = await register(browser);
    const { code, verifier } = await signIn(browser, client, "hubot");
    const tokens = await exchange(browser, client, code, verifier);
    await callTool(browser, "whoami", tokens.body.access_token);

    const dump = [...storage.values].flat().join("\n");
    expect(storage.values.size).toBeGreaterThan(0);
    for (const secret of [
      ...spy.secrets,
      tokens.body.access_token!,
      tokens.body.refresh_token!,
      "hubot",
    ]) {
      expect(dump).not.toContain(secret);
    }
    for (const value of storage.values.values()) {
      expect(value).toMatch(/^v1\.[0-9a-f]{16}\.[\w-]+\.[\w-]+$/);
    }
  });

  it("refuses a callback from a browser without the binding cookie", async () => {
    const { server } = githubServer();
    const victim = new Browser(server);
    const attacker = new Browser(server);
    const client = await register(attacker);

    // The attacker starts a sign-in and stops at the callback URL.
    const { challenge } = await pkcePair();
    let url = `${RESOURCE}/oauth/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
    })}`;
    let callbackUrl: string | undefined;
    for (let hop = 0; hop < 10 && callbackUrl === undefined; hop++) {
      const response = await attacker.request(url);
      const html = response.status === 200 ? await response.text() : "";
      let next: Response = response;
      if (html.includes('name="decision"')) {
        const action = decodeHtml(html.match(/action="([^"]+)"/)![1]!);
        next = await attacker.form(new URL(action, url).href, {
          ...hiddenFields(html),
          decision: "allow",
        });
      } else if (html !== "") {
        const form = html
          .split("<form")
          .find((part) => part.includes('value="hubot"'))!;
        next = await attacker.form(
          new URL("/login/oauth/callback", githubEmulator.url).href,
          hiddenFields(`<form${form}`)
        );
      }
      const location = new URL(next.headers.get("location")!, url).href;
      if (location.startsWith(CALLBACK)) callbackUrl = location;
      url = location;
    }

    const forced = await victim.request(callbackUrl!);
    expect(forced.status).toBe(403);
    // The state is spent, so the attacker cannot finish either.
    const replay = await attacker.request(callbackUrl!);
    expect(replay.status).toBe(400);
  });

  it("finishes two sign-ins started in one browser that return in reverse order", async () => {
    const { server } = githubServer();
    const browser = new Browser(server);
    const client = await register(browser);

    /** Runs /authorize and the consent page, up to GitHub's sign-in page. */
    const start = async () => {
      const { verifier, challenge } = await pkcePair();
      let url = `${RESOURCE}/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: client.redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: RESOURCE,
      })}`;
      for (let hop = 0; hop < 10; hop++) {
        const response = await browser.request(url);
        if (response.status === 302) {
          url = new URL(response.headers.get("location")!, url).href;
          continue;
        }
        const html = await response.text();
        expect(response.status).toBe(200);
        if (new URL(url).origin !== ORIGIN) return { url, html, verifier };
        const action = decodeHtml(html.match(/action="([^"]+)"/)![1]!);
        const answer = await browser.form(new URL(action, url).href, {
          ...hiddenFields(html),
          decision: "allow",
        });
        url = new URL(answer.headers.get("location")!, url).href;
      }
      throw new Error("never reached the GitHub sign-in page");
    };
    /** Signs in on GitHub's page and follows the callback to the client. */
    const finish = async (flow: Awaited<ReturnType<typeof start>>) => {
      const form = flow.html
        .split("<form")
        .find((part) => part.includes('value="hubot"'))!;
      const action = decodeHtml(form.match(/action="([^"]+)"/)![1]!);
      const answer = await browser.form(
        new URL(action, flow.url).href,
        hiddenFields(`<form${form}`)
      );
      const callback = new URL(answer.headers.get("location")!, flow.url);
      expect(callback.href.startsWith(CALLBACK)).toBe(true);
      const response = await browser.request(callback.href);
      expect(response.status).toBe(302);
      const code = new URL(response.headers.get("location")!).searchParams.get(
        "code"
      );
      expect(code).toBeTruthy();
      return exchange(browser, client, code!, flow.verifier);
    };

    // The second sign-in starts before the first one returns from GitHub,
    // then they return in reverse order.
    const first = await start();
    const second = await start();
    const secondTokens = await finish(second);
    const firstTokens = await finish(first);
    expect(secondTokens.status).toBe(200);
    expect(firstTokens.status).toBe(200);
  });

  describe("sign-ins started at once in one browser", () => {
    /** Opens the consent page of a new sign-in (a native client always gets one). */
    async function consentPage(
      browser: Browser,
      client: { clientId: string; redirectUri: string }
    ): Promise<{ url: string; html: string }> {
      const { challenge } = await pkcePair();
      const url = `${RESOURCE}/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: client.redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })}`;
      const response = await browser.request(url);
      expect(response.status).toBe(200);
      return { url, html: await response.text() };
    }

    /** Approves a consent page and returns the upstream `state`. */
    async function approve(
      browser: Browser,
      page: { url: string; html: string }
    ): Promise<string> {
      const action = decodeHtml(page.html.match(/action="([^"]+)"/)![1]!);
      const answer = await browser.form(new URL(action, page.url).href, {
        ...hiddenFields(page.html),
        decision: "allow",
      });
      expect(answer.status).toBe(302);
      const location = new URL(answer.headers.get("location")!);
      expect(location.origin).toBe(githubEmulator.url);
      return location.searchParams.get("state")!;
    }

    function cookieNames(browser: Browser, prefix: string): string[] {
      return [...(browser.jar.get(ORIGIN)?.keys() ?? [])].filter((name) =>
        name.startsWith(prefix)
      );
    }

    it("approves the first of two consent pages open in one browser", async () => {
      const { server } = githubServer();
      const browser = new Browser(server);
      const client = await register(browser);

      const first = await consentPage(browser, client);
      await consentPage(browser, client);
      await approve(browser, first);
    });

    it("keeps at most five binding and CSRF cookies, dropping the oldest", async () => {
      const { server } = githubServer();
      const browser = new Browser(server);
      const client = await register(browser);

      const pages = [];
      for (let index = 0; index < 6; index++) {
        pages.push(await consentPage(browser, client));
      }
      expect(cookieNames(browser, "mcp-oauth-csrf-")).toHaveLength(5);
      // The oldest consent page lost its cookie; the newest still works.
      const stale = pages[0]!;
      const action = decodeHtml(stale.html.match(/action="([^"]+)"/)![1]!);
      const refused = await browser.form(new URL(action, stale.url).href, {
        ...hiddenFields(stale.html),
        decision: "allow",
      });
      expect(refused.status).toBe(403);

      const states = [];
      for (const page of pages.slice(1)) {
        states.push(await approve(browser, page));
      }
      states.push(await approve(browser, await consentPage(browser, client)));
      expect(cookieNames(browser, "mcp-oauth-bind-")).toHaveLength(5);
      // The oldest round lost its cookie, so its callback is refused.
      const callback = await browser.request(
        `${CALLBACK}?${new URLSearchParams({ state: states[0]!, code: "x" })}`
      );
      expect(callback.status).toBe(403);
    });
  });

  it("spends a code on first use and revokes the grant when it is replayed", async () => {
    const { server } = githubServer();
    const browser = new Browser(server);
    const client = await register(browser);

    const wrong = await signIn(browser, client, "hubot");
    const { verifier: otherVerifier } = await pkcePair();
    expect(
      (await exchange(browser, client, wrong.code, otherVerifier)).body.error
    ).toBe("invalid_grant");
    // The wrong verifier burned the code.
    expect(
      (await exchange(browser, client, wrong.code, wrong.verifier)).body.error
    ).toBe("invalid_grant");

    const { code, verifier } = await signIn(browser, client, "hubot");
    const first = await exchange(browser, client, code, verifier);
    expect(first.status).toBe(200);
    const replay = await exchange(browser, client, code, verifier);
    expect(replay.body.error).toBe("invalid_grant");
    expect(
      (await callTool(browser, "whoami", first.body.access_token)).status
    ).toBe(401);
  });

  it("rotates refresh tokens with one grace use and revokes on a later replay", async () => {
    const { server } = githubServer();
    const browser = new Browser(server);
    const client = await register(browser);
    const { code, verifier } = await signIn(browser, client, "hubot");
    const initial = (await exchange(browser, client, code, verifier)).body;

    const rotated = await refresh(
      browser,
      client.clientId,
      initial.refresh_token!
    );
    expect(rotated.status).toBe(200);
    expect(rotated.body.refresh_token).not.toBe(initial.refresh_token);
    expect(
      await toolText(
        await callTool(browser, "whoami", rotated.body.access_token)
      )
    ).toMatch(/^hubot /);

    // A lost response: the client retries the old token once.
    const grace = await refresh(
      browser,
      client.clientId,
      initial.refresh_token!
    );
    expect(grace.status).toBe(200);

    const replay = await refresh(
      browser,
      client.clientId,
      initial.refresh_token!
    );
    expect(replay.body.error).toBe("invalid_grant");
    expect(
      (await callTool(browser, "whoami", rotated.body.access_token)).status
    ).toBe(401);
    expect(
      (await refresh(browser, client.clientId, rotated.body.refresh_token!))
        .body.error
    ).toBe("invalid_grant");
  });

  it("refuses refresh tokens of another client", async () => {
    const { server } = githubServer();
    const browser = new Browser(server);
    const client = await register(browser);
    const other = await register(browser);
    const { code, verifier } = await signIn(browser, client, "hubot");
    const tokens = (await exchange(browser, client, code, verifier)).body;
    expect(
      (await refresh(browser, other.clientId, tokens.refresh_token!)).body.error
    ).toBe("invalid_grant");
  });

  it("returns access_denied with the client state when the user denies", async () => {
    const { server, spy } = githubServer();
    const browser = new Browser(server);
    const client = await register(browser);
    const { redirect } = await signIn(browser, client, "hubot", {
      decision: "deny",
    });
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("state")).toBe("client-state-42");
    expect(redirect.searchParams.get("iss")).toBe(ORIGIN);
    expect(spy.tokenRequests).toHaveLength(0);
  });

  it("answers an unknown client or redirect with an error page, not a redirect", async () => {
    const { server } = githubServer();
    const browser = new Browser(server);
    const client = await register(browser);
    const { challenge } = await pkcePair();
    const authorize = (params: Record<string, string>) =>
      browser.request(
        `${RESOURCE}/oauth/authorize?${new URLSearchParams({
          response_type: "code",
          code_challenge: challenge,
          code_challenge_method: "S256",
          ...params,
        })}`
      );

    const unknown = await authorize({
      client_id: "mcp_client_nope",
      redirect_uri: CLIENT_REDIRECT,
    });
    expect(unknown.status).toBe(400);
    expect(unknown.headers.get("location")).toBeNull();
    const evil = await authorize({
      client_id: client.clientId,
      redirect_uri: "https://evil.example/callback",
    });
    expect(evil.status).toBe(400);
    expect(evil.headers.get("location")).toBeNull();
    expect(evil.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'"
    );

    // A loopback redirect may use another port (RFC 8252).
    const otherPort = await authorize({
      client_id: client.clientId,
      redirect_uri: "http://127.0.0.1:61000/callback",
    });
    expect(otherPort.status).toBe(200);

    const noPkce = await browser.request(
      `${RESOURCE}/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: CLIENT_REDIRECT,
        state: "s",
      })}`
    );
    const location = new URL(noPkce.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("invalid_request");
    expect(location.searchParams.get("state")).toBe("s");

    const wrongResource = await authorize({
      client_id: client.clientId,
      redirect_uri: CLIENT_REDIRECT,
      resource: "https://other.example/mcp",
    });
    expect(
      new URL(wrongResource.headers.get("location")!).searchParams.get("error")
    ).toBe("invalid_target");
  });

  it("signs in a client from the 1.x proxy, which registered with the GitHub client ID", async () => {
    const { server } = githubServer();
    const browser = new Browser(server);
    const v1Client = {
      clientId: GITHUB_CLIENT_ID,
      redirectUri: CLIENT_REDIRECT,
    };
    const { code, verifier } = await signIn(browser, v1Client, "hubot");
    const tokens = await exchange(browser, v1Client, code, verifier);
    expect(tokens.status).toBe(200);
    expect(
      (await refresh(browser, GITHUB_CLIENT_ID, tokens.body.refresh_token!))
        .status
    ).toBe(200);

    const { challenge } = await pkcePair();
    const authorize = (params: Record<string, string>) =>
      browser.request(
        `${RESOURCE}/oauth/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: GITHUB_CLIENT_ID,
          code_challenge: challenge,
          code_challenge_method: "S256",
          ...params,
        })}`
      );
    // The 1.x proxy named the bare origin as its resource.
    expect(
      (await authorize({ redirect_uri: CLIENT_REDIRECT, resource: ORIGIN }))
        .status
    ).toBe(200);
    // With no stored record, the request must name a safe redirect URI.
    const noRedirect = await authorize({});
    expect(noRedirect.status).toBe(400);
    expect(noRedirect.headers.get("location")).toBeNull();
    const unsafe = await authorize({ redirect_uri: "http://evil.example/cb" });
    expect(unsafe.status).toBe(400);
    expect(unsafe.headers.get("location")).toBeNull();

    // With registration off, the GitHub client ID is an unknown client.
    const listed = new Browser(
      githubServer({
        clients: [{ clientId: "acme-cli", redirectUris: [CLIENT_REDIRECT] }],
      }).server
    );
    const refused = await listed.request(
      `${RESOURCE}/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: GITHUB_CLIENT_ID,
        redirect_uri: CLIENT_REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })}`
    );
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("unknown client_id");
  });

  it("rejects registrations with unsafe redirect URIs", async () => {
    const { server } = githubServer();
    const browser = new Browser(server);
    for (const uri of [
      "http://evil.example/cb",
      // eslint-disable-next-line no-script-url -- an unsafe redirect URI to refuse
      "javascript:alert(1)",
      "https://a.example/cb#x",
    ]) {
      const response = await browser.request(`${RESOURCE}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: [uri] }),
      });
      expect(response.status).toBe(400);
    }
    // Native apps register private-use schemes.
    const native = await register(browser, [
      "cursor://anysphere.cursor-mcp/oauth/callback",
    ]);
    const { challenge } = await pkcePair();
    const consent = await browser.request(
      `${RESOURCE}/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: native.clientId,
        redirect_uri: native.redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })}`
    );
    expect(consent.status).toBe(200);
    // The page names where the sign-in returns to.
    expect(await consent.text()).toContain(
      "you return to <b>anysphere.cursor-mcp</b>"
    );
  });

  it("narrows requested scopes instead of failing the sign-in", async () => {
    // Clients often send upstream scopes. They are dropped.
    const plain = githubServer();
    const browser = new Browser(plain.server);
    const client = await register(browser);
    const first = await signIn(browser, client, "hubot", {
      scope: "read:user repo",
    });
    const tokens = await exchange(browser, client, first.code, first.verifier);
    expect(tokens.status).toBe(200);
    expect(tokens.body.scope).toBeUndefined();

    const scoped = githubServer({ scopesSupported: ["mcp:read", "mcp:write"] });
    const other = new Browser(scoped.server);
    const otherClient = await register(other);
    const narrowed = await signIn(other, otherClient, "hubot", {
      scope: "read:user mcp:read",
    });
    const narrowedTokens = await exchange(
      other,
      otherClient,
      narrowed.code,
      narrowed.verifier
    );
    expect(narrowedTokens.body.scope).toBe("mcp:read");
    const defaults = await signIn(other, otherClient, "hubot", {
      scope: "repo",
    });
    const defaultTokens = await exchange(
      other,
      otherClient,
      defaults.code,
      defaults.verifier
    );
    expect(defaultTokens.body.scope).toBe("mcp:read mcp:write");
  });

  it("issues the narrower scope a refresh asks for and keeps the grant's scopes", async () => {
    const { server } = githubServer({
      scopesSupported: ["mcp:read", "mcp:write"],
    });
    const browser = new Browser(server);
    const client = await register(browser);
    const { code, verifier } = await signIn(browser, client, "hubot", {
      scope: "mcp:read mcp:write",
    });
    const tokens = (await exchange(browser, client, code, verifier)).body;
    expect(tokens.scope).toBe("mcp:read mcp:write");

    const narrowed = await refresh(
      browser,
      client.clientId,
      tokens.refresh_token!,
      { scope: "mcp:read" }
    );
    expect(narrowed.body.scope).toBe("mcp:read");
    expect(
      await toolText(
        await callTool(browser, "scopes", narrowed.body.access_token)
      )
    ).toBe("mcp:read");

    // The new refresh token still carries the whole grant (RFC 6749 §6).
    const full = await refresh(
      browser,
      client.clientId,
      narrowed.body.refresh_token!
    );
    expect(full.body.scope).toBe("mcp:read mcp:write");
    expect(
      await toolText(await callTool(browser, "scopes", full.body.access_token))
    ).toBe("mcp:read mcp:write");

    const wider = await refresh(
      browser,
      client.clientId,
      full.body.refresh_token!,
      { scope: "mcp:read mcp:admin" }
    );
    expect(wider.body.error).toBe("invalid_scope");
  });

  it("revokes a grant at the revocation endpoint", async () => {
    const { server } = githubServer();
    const browser = new Browser(server);
    const client = await register(browser);
    const { code, verifier } = await signIn(browser, client, "hubot");
    const tokens = (await exchange(browser, client, code, verifier)).body;
    const response = await browser.form(`${RESOURCE}/oauth/revoke`, {
      token: tokens.refresh_token!,
      client_id: client.clientId,
    });
    expect(response.status).toBe(200);
    expect(
      (await callTool(browser, "whoami", tokens.access_token)).status
    ).toBe(401);
  });

  it("remembers consent per browser for HTTPS redirect URIs", async () => {
    const { server } = githubServer({ consent: { mode: "remember" } });
    const browser = new Browser(server);
    const client = await register(browser, ["https://client.example/callback"]);
    await signIn(browser, client, "hubot");
    const consentPages = () =>
      browser.transcript.filter((entry) => entry.includes('name="decision"'))
        .length;
    expect(consentPages()).toBe(1);
    await signIn(browser, client, "hubot");
    expect(consentPages()).toBe(1);

    // Loopback redirects always ask.
    const local = await register(browser);
    await signIn(browser, local, "hubot");
    await signIn(browser, local, "hubot");
    expect(consentPages()).toBe(3);
  });

  it("identifies a client by its metadata document", async () => {
    const clientId = "https://client.example/oauth/metadata.json";
    const document = {
      client_id: clientId,
      client_name: "Metadata Client",
      redirect_uris: ["https://client.example/callback", CLIENT_REDIRECT],
      token_endpoint_auth_method: "none",
    };
    const spy = new UpstreamSpy();
    const { server } = githubServer({
      fetch: async (input, init) =>
        String(input) === clientId
          ? Response.json(document)
          : spy.fetch(input, init),
    });
    const browser = new Browser(server);
    const client = { clientId, redirectUri: "https://client.example/callback" };
    const { code, verifier } = await signIn(browser, client, "hubot");
    const page = browser.transcript.find((entry) =>
      entry.includes('name="decision"')
    );
    expect(page).toContain("Metadata Client");
    expect(page).toContain("client.example");
    expect(page).not.toContain("Unverified");
    expect((await exchange(browser, client, code, verifier)).status).toBe(200);
  });

  it("lets only the listed clients connect when clients is set", async () => {
    const listed = "https://listed.example/oauth/client.json";
    const onOrigin = "https://chatgpt.example/oauth/cb_123/client.json";
    const unlisted = "https://unlisted.example/oauth/client.json";
    const documentFor = (clientId: string) => ({
      client_id: clientId,
      redirect_uris: [`${new URL(clientId).origin}/callback`],
    });
    const fetched: string[] = [];
    const spy = new UpstreamSpy();
    const { server } = githubServer({
      clients: [
        listed,
        "https://chatgpt.example",
        { clientId: "acme-cli", redirectUris: [CLIENT_REDIRECT] },
      ],
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes("/oauth/client.json") || url.includes("/cb_")) {
          fetched.push(url);
          return Response.json(documentFor(url));
        }
        return spy.fetch(input, init);
      },
    });
    const browser = new Browser(server);

    // Registration is off and advertised as off; metadata documents are on.
    const metadata = (await (
      await browser.request(`${ORIGIN}/.well-known/oauth-authorization-server`)
    ).json()) as Record<string, unknown>;
    expect(metadata["registration_endpoint"]).toBeUndefined();
    expect(metadata["client_id_metadata_document_supported"]).toBe(true);
    const registration = await browser.request(`${RESOURCE}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [CLIENT_REDIRECT] }),
    });
    expect(registration.status).toBe(404);

    // An exact URL, a document on a listed origin, and a hand-defined client.
    for (const client of [
      { clientId: listed, redirectUri: "https://listed.example/callback" },
      { clientId: onOrigin, redirectUri: "https://chatgpt.example/callback" },
      { clientId: "acme-cli", redirectUri: CLIENT_REDIRECT },
    ]) {
      const { code, verifier } = await signIn(browser, client, "hubot");
      expect((await exchange(browser, client, code, verifier)).status).toBe(
        200
      );
    }

    // An unlisted client is refused before its document is fetched.
    const refused = await browser.request(
      `${RESOURCE}/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: unlisted,
        redirect_uri: "https://unlisted.example/callback",
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        code_challenge_method: "S256",
      })}`
    );
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("not allowed to connect");
    expect(fetched).toEqual([listed, onOrigin]);
  });

  it("ends existing sign-ins of a client that is no longer allowed", async () => {
    const storage = memoryStorage();
    const before = new Browser(githubServer({ storage }).server);
    const client = await register(before);
    const tokensFor = async () => {
      const { code, verifier } = await signIn(before, client, "hubot");
      return (await exchange(before, client, code, verifier)).body;
    };
    const refreshed = await tokensFor();
    const called = await tokensFor();

    // The same store and secret, now with registration off.
    const after = new Browser(githubServer({ storage, dcr: false }).server);
    const refresh1 = await refresh(
      after,
      client.clientId,
      refreshed.refresh_token!
    );
    expect(refresh1.status).toBe(400);
    expect(refresh1.body.error).toBe("invalid_client");
    expect((await callTool(after, "whoami", called.access_token)).status).toBe(
      401
    );

    // Both grants are gone: turning registration back on does not revive them.
    expect(
      (await refresh(before, client.clientId, refreshed.refresh_token!)).body
        .error
    ).toBe("invalid_grant");
    expect((await callTool(before, "whoami", called.access_token)).status).toBe(
      401
    );
  });

  it("ends sign-ins and refuses codes of a client removed from clients", async () => {
    const storage = memoryStorage();
    const acme = { clientId: "acme-cli", redirectUri: CLIENT_REDIRECT };
    const listed = githubServer({
      storage,
      clients: [{ clientId: "acme-cli", redirectUris: [CLIENT_REDIRECT] }],
    });
    const browser = new Browser(listed.server);
    const first = await signIn(browser, acme, "hubot");
    const tokens = (await exchange(browser, acme, first.code, first.verifier))
      .body;
    const second = await signIn(browser, acme, "hubot");

    const removed = new Browser(
      githubServer({
        storage,
        clients: [{ clientId: "other-cli", redirectUris: [CLIENT_REDIRECT] }],
      }).server
    );
    const exchanged = await exchange(
      removed,
      acme,
      second.code,
      second.verifier
    );
    expect(exchanged.status).toBe(400);
    expect(exchanged.body.error).toBe("invalid_client");
    const refreshed = await refresh(
      removed,
      acme.clientId,
      tokens.refresh_token!
    );
    expect(refreshed.body.error).toBe("invalid_client");

    // Listing the client again does not bring the tokens back.
    expect(
      (await callTool(browser, "whoami", tokens.access_token)).status
    ).toBe(401);
    expect(
      (await refresh(browser, acme.clientId, tokens.refresh_token!)).body.error
    ).toBe("invalid_grant");
  });

  it("advertises no metadata documents when clients lists none", async () => {
    const { server } = githubServer({
      clients: [{ clientId: "acme-cli", redirectUris: [CLIENT_REDIRECT] }],
    });
    const metadata = (await (
      await new Browser(server).request(
        `${ORIGIN}/.well-known/oauth-authorization-server`
      )
    ).json()) as Record<string, unknown>;
    expect(metadata["client_id_metadata_document_supported"]).toBe(false);
    expect(metadata["registration_endpoint"]).toBeUndefined();
  });

  it("signs in ChatGPT, whose metadata document prefers private_key_jwt but also lists none", async () => {
    // ChatGPT's production document, as served at its client_id URL.
    const clientId = "https://chatgpt.com/oauth/client.json";
    const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
    const chatgpt = {
      client_id: clientId,
      client_uri: "https://chatgpt.com/",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "ChatGPT",
      logo_uri: "https://persistent.oaistatic.com/sonic/misc/openai-logo.png",
      token_endpoint_auth_signing_alg: "RS256",
      jwks_uri: "https://chatgpt.com/oauth/jwks.json",
    };
    const serve =
      (document: unknown): typeof globalThis.fetch =>
      async (input, init) =>
        String(input) === clientId
          ? Response.json(document)
          : new UpstreamSpy().fetch(input, init);

    const { server } = githubServer({ fetch: serve(chatgpt) });
    const browser = new Browser(server);
    const metadata = (await (
      await browser.request(`${ORIGIN}/.well-known/oauth-authorization-server`)
    ).json()) as { token_endpoint_auth_methods_supported: string[] };
    // The proxy advertises only none, so none is the method ChatGPT picks.
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(["none"]);
    const { code, verifier } = await signIn(
      browser,
      { clientId, redirectUri },
      "hubot"
    );
    const tokens = await exchange(
      browser,
      { clientId, redirectUri },
      code,
      verifier
    );
    expect(tokens.status).toBe(200);

    // A client that can only authenticate with private_key_jwt is refused.
    for (const document of [
      {
        ...chatgpt,
        token_endpoint_auth_methods_supported: ["private_key_jwt"],
      },
      { ...chatgpt, token_endpoint_auth_methods_supported: undefined },
      {
        ...chatgpt,
        token_endpoint_auth_method: undefined,
        token_endpoint_auth_methods_supported: ["private_key_jwt"],
      },
    ]) {
      const strict = githubServer({ fetch: serve(document) }).server;
      const response = await new Browser(strict).request(
        `${RESOURCE}/oauth/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
          code_challenge_method: "S256",
          state: "s",
        })}`
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("only public clients");
    }
  });

  it("logs why a metadata document could not be loaded, without showing it on the page", async () => {
    const clientId = "https://client.example/oauth/metadata.json";
    const { server } = githubServer({
      fetch: async (input, init) =>
        String(input) === clientId
          ? new Response("internal", { status: 503 })
          : new UpstreamSpy().fetch(input, init),
    });
    const logged = captureConsole("warn");
    try {
      const response = await new Browser(server).request(
        `${RESOURCE}/oauth/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: "https://client.example/callback",
          code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
          code_challenge_method: "S256",
          state: "s",
        })}`
      );
      expect(response.status).toBe(400);
      const page = await response.text();
      expect(page).not.toContain("503");
      expect(page).toContain("could not be loaded");
      expect(logged.text()).toContain("HTTP 503");
    } finally {
      logged.restore();
    }
  });

  describe("names the server on the consent page", () => {
    async function consentPage(server: MCPServer<UpstreamUser>) {
      const browser = new Browser(server);
      const client = await register(browser);
      const { challenge } = await pkcePair();
      const response = await browser.request(
        `${RESOURCE}/oauth/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: client.clientId,
          redirect_uri: client.redirectUri,
          code_challenge: challenge,
          code_challenge_method: "S256",
        })}`
      );
      expect(response.status).toBe(200);
      return response.text();
    }

    it("by the host of the MCP server URL", async () => {
      const { server } = githubServer();
      expect(await consentPage(server)).toContain(
        "to connect to localhost:4319?</h1>"
      );
    });

    it("by the host, not the server title or resourceName, which only goes in the resource metadata", async () => {
      const { server } = githubServer(
        { resourceName: "Acme API" },
        { title: "Acme Tools" }
      );
      const html = await consentPage(server);
      expect(html).toContain("to connect to localhost:4319?</h1>");
      expect(html).not.toContain("Acme API");
      expect(html).not.toContain("Acme Tools");
      const metadata = await server.fetch(
        new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`)
      );
      expect(metadata.status).toBe(200);
      expect(
        ((await metadata.json()) as Record<string, unknown>)["resource_name"]
      ).toBe("Acme API");
    });

    it("by the host in a custom consent page", async () => {
      const { createElement } = await import("react");
      const { server } = githubServer({
        consent: {
          page: (props) =>
            createElement("p", null, `Custom page for ${props.serverHost}`),
        },
      });
      expect(await consentPage(server)).toContain(
        "Custom page for localhost:4319"
      );
    });
  });

  it("renders a custom consent page component", async () => {
    const { createElement } = await import("react");
    const { server } = githubServer({
      consent: {
        page: (props) =>
          createElement(
            "form",
            { method: "post", action: props.form.action },
            createElement("p", null, `Custom page for ${props.client.name}`),
            createElement("input", {
              type: "hidden",
              name: "csrf",
              value: props.form.csrf,
            }),
            createElement(
              "button",
              { name: "decision", value: "allow" },
              "Allow"
            )
          ),
      },
    });
    const browser = new Browser(server);
    const client = await register(browser);
    const { code, verifier } = await signIn(browser, client, "hubot");
    expect(
      browser.transcript.some((entry) =>
        entry.includes("Custom page for Test Client")
      )
    ).toBe(true);
    expect((await exchange(browser, client, code, verifier)).status).toBe(200);
  });
});

// ─── Google ──────────────────────────────────────────────────────────────

function googleServer(
  spy: UpstreamSpy,
  overrides: Partial<OAuthProxyOptions<UpstreamUser>> = {}
): {
  server: MCPServer<UpstreamUser>;
  toolTokens: string[];
} {
  const toolTokens: string[] = [];
  const server = new MCPServer({
    name: "acme",
    version: "1.0.0",
    logging: { enabled: false },
    oauth: oauthProxy({
      resource: RESOURCE,
      upstream: google({
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        baseUrl: googleEmulator.url,
      }),
      secret: SECRET,
      storage: memoryStorage(),
      fetch: spy.fetch,
      ...overrides,
    }),
  });
  server.tool({ name: "whoami" }, async (_input, ctx) => {
    const token = upstreamToken(ctx);
    toolTokens.push(token);
    const response = await fetch(`${googleEmulator.url}/oauth2/v2/userinfo`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return {
      content: [
        {
          type: "text",
          text: ((await response.json()) as { email: string }).email,
        },
      ],
    };
  });
  return { server, toolTokens };
}

describe("oauthProxy with emulated Google", () => {
  it("signs in with PKCE upstream and refreshes the Google token on the server", async () => {
    const spy = new UpstreamSpy();
    // Short-lived Google tokens make every use refresh first.
    spy.rewrite = (body) =>
      typeof body["access_token"] === "string"
        ? { ...body, expires_in: 30 }
        : body;
    const { server, toolTokens } = googleServer(spy);
    const browser = new Browser(server);
    const client = await register(browser);
    const { code, verifier } = await signIn(
      browser,
      client,
      "second@example.com"
    );
    const tokens = (await exchange(browser, client, code, verifier)).body;
    expect(tokens.access_token).toMatch(/^mcp_at_/);

    expect(
      await toolText(await callTool(browser, "whoami", tokens.access_token))
    ).toBe("second@example.com");
    const grants = spy.tokenRequests.map((request) =>
      request.get("grant_type")
    );
    expect(grants[0]).toBe("authorization_code");
    expect(grants).toContain("refresh_token");
    // The tool received a refreshed token, not the one from the code exchange.
    const codeExchangeToken = [...spy.secrets][0];
    expect(spy.secrets.has(toolTokens[0]!)).toBe(true);
    expect(toolTokens[0]).not.toBe(codeExchangeToken);

    const authorize = new URL(
      browser.visited
        .find((entry) => entry.includes("/o/oauth2/v2/auth"))!
        .split(" ")[1]!
    );
    expect(authorize.searchParams.get("access_type")).toBe("offline");
    expect(authorize.searchParams.get("prompt")).toBeNull();
    expect(authorize.searchParams.get("scope")).toContain("openid");

    const transcript = browser.transcript.join("\n");
    for (const secret of [...spy.secrets, GOOGLE_CLIENT_SECRET]) {
      expect(transcript).not.toContain(secret);
    }
  });

  it("ends every grant of the user when Google refuses the refresh token", async () => {
    const spy = new UpstreamSpy();
    let refuse = false;
    spy.rewrite = (body, request) => {
      if (refuse && request.get("grant_type") === "refresh_token") {
        return Response.json(
          {
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          },
          { status: 400 }
        );
      }
      return typeof body["access_token"] === "string"
        ? { ...body, expires_in: 30 }
        : body;
    };
    const { server } = googleServer(spy);
    const browser = new Browser(server);
    const client = await register(browser);
    const { code, verifier } = await signIn(
      browser,
      client,
      "second@example.com"
    );
    const tokens = (await exchange(browser, client, code, verifier)).body;
    expect(
      (await callTool(browser, "whoami", tokens.access_token)).status
    ).toBe(200);

    refuse = true;
    expect(
      (await callTool(browser, "whoami", tokens.access_token)).status
    ).toBe(401);
    expect(
      (await refresh(browser, client.clientId, tokens.refresh_token!)).body
        .error
    ).toBe("invalid_grant");
  });

  /**
   * A Google server whose tokens are short-lived, so every refresh and every
   * MCP request refreshes upstream, where the gate can hold it.
   */
  function gatedGoogle() {
    const spy = new UpstreamSpy();
    spy.rewrite = (body) =>
      typeof body["access_token"] === "string"
        ? { ...body, expires_in: 30 }
        : body;
    const gate = upstreamRefreshGate(spy.fetch);
    const storage = trackedStorage();
    const { server } = googleServer(spy, { fetch: gate.fetch, storage });
    return { server, gate, storage };
  }

  async function googleSignIn(server: MCPServer<UpstreamUser>) {
    const browser = new Browser(server);
    const client = await register(browser);
    const { code, verifier } = await signIn(
      browser,
      client,
      "second@example.com"
    );
    const tokens = (await exchange(browser, client, code, verifier)).body;
    expect(tokens.access_token).toMatch(/^mcp_at_/);
    return { browser, client, tokens };
  }

  it("does not restore a grant that is revoked while a refresh is in progress", async () => {
    const { server, gate } = gatedGoogle();
    const { browser, client, tokens } = await googleSignIn(server);

    const held = gate.hold();
    const pending = refresh(browser, client.clientId, tokens.refresh_token!);
    await held.reached;
    const revoked = await browser.form(`${RESOURCE}/oauth/revoke`, {
      token: tokens.refresh_token!,
      client_id: client.clientId,
    });
    expect(revoked.status).toBe(200);
    held.release();
    const result = await pending;

    expect(
      (await callTool(browser, "whoami", tokens.access_token)).status
    ).toBe(401);
    if (result.body.access_token !== undefined) {
      expect(
        (await callTool(browser, "whoami", result.body.access_token)).status
      ).toBe(401);
    }
    expect(result.body.error).toBe("invalid_grant");
  });

  it("does not restore an upstream sign-in that ends while it is refreshed", async () => {
    const { server, gate, storage } = gatedGoogle();
    const { browser, tokens } = await googleSignIn(server);
    const upstreamKeys = await storage.live("up:");
    expect(upstreamKeys).toHaveLength(1);

    const held = gate.hold();
    const pending = callTool(browser, "whoami", tokens.access_token);
    await held.reached;
    // The sign-in ends, as when another request finds it revoked upstream.
    await storage.delete(upstreamKeys[0]!);
    held.release();

    expect((await pending).status).toBe(401);
    expect(await storage.live("up:")).toEqual([]);
    expect(
      (await callTool(browser, "whoami", tokens.access_token)).status
    ).toBe(401);
  });

  it("rotates a refresh token once when a request outlives its lock", async () => {
    const { server, gate, storage } = gatedGoogle();
    const { browser, client, tokens } = await googleSignIn(server);
    const original = tokens.refresh_token!;

    const first = gate.hold();
    const slow = refresh(browser, client.clientId, original);
    await first.reached;
    // Only Date is faked: storage leases expire, timers still run.
    vi.useFakeTimers({ toFake: ["Date"] });
    let slowResult: Awaited<typeof slow>;
    let nextResult: Awaited<typeof slow>;
    try {
      vi.setSystemTime(Date.now() + 61_000);
      const second = gate.hold();
      const next = refresh(browser, client.clientId, original);
      await second.reached;
      first.release();
      slowResult = await slow;
      // The slow request must not release the lock the next one holds.
      expect(await storage.live("lock:rt:")).toHaveLength(1);
      second.release();
      nextResult = await next;
    } finally {
      vi.useRealTimers();
    }
    expect(nextResult.status).toBe(200);
    expect(slowResult.status).toBe(503);
    expect(slowResult.body.error).toBe("temporarily_unavailable");

    // Exactly one rotation happened: one grace use, then reuse detection.
    expect((await refresh(browser, client.clientId, original)).status).toBe(
      200
    );
    expect((await refresh(browser, client.clientId, original)).body.error).toBe(
      "invalid_grant"
    );
  });

  it("asks Google for consent again when it returns no refresh token", async () => {
    const spy = new UpstreamSpy();
    let dropped = false;
    spy.rewrite = (body) => {
      if (!dropped && typeof body["refresh_token"] === "string") {
        dropped = true;
        const { refresh_token: _dropped, ...rest } = body;
        return rest;
      }
      return body;
    };
    const { server } = googleServer(spy);
    const browser = new Browser(server);
    const client = await register(browser);
    const { code, verifier } = await signIn(
      browser,
      client,
      "second@example.com"
    );
    expect((await exchange(browser, client, code, verifier)).status).toBe(200);

    const rounds = browser.visited
      .filter((entry) => entry.includes("/o/oauth2/v2/auth?"))
      .map((entry) => new URL(entry.split(" ")[1]!));
    expect(rounds).toHaveLength(2);
    expect(rounds[0]!.searchParams.get("prompt")).toBeNull();
    expect(rounds[1]!.searchParams.get("prompt")).toBe("consent");
  });
});

// ─── Production guards ───────────────────────────────────────────────────

describe("oauthProxy production guards", () => {
  const upstreamConfig = () =>
    github({ clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET });
  const mount = (options: Partial<OAuthProxyOptions<UpstreamUser>>) =>
    new MCPServer({
      name: "acme",
      version: "1.0.0",
      logging: { enabled: false },
      oauth: oauthProxy({ upstream: upstreamConfig(), ...options }),
    }).fetch(new Request("https://api.example.com/mcp/oauth/authorize"));

  it("requires shared storage and a secret outside a localhost listen()", async () => {
    await expect(
      mount({ resource: "https://api.example.com/mcp", secret: SECRET })
    ).rejects.toThrow("needs storage");
    await expect(
      mount({
        resource: "https://api.example.com/mcp",
        secret: SECRET,
        storage: memoryStorage(),
      })
    ).rejects.toThrow("memoryStorage() works only on localhost");
    await expect(
      mount({
        resource: "https://api.example.com/mcp",
        storage: inspectableStorage(),
      })
    ).rejects.toThrow("needs a secret");
    await expect(
      mount({
        resource: "https://api.example.com/mcp",
        storage: inspectableStorage(),
        secret: SECRET,
        consent: false,
      })
    ).rejects.toThrow("consent: false");
    // Turning registration off does not make it safe: metadata documents
    // still let any client name its own redirect URI.
    await expect(
      mount({
        resource: "https://api.example.com/mcp",
        storage: inspectableStorage(),
        secret: SECRET,
        consent: false,
        dcr: false,
      })
    ).rejects.toThrow("consent: false is allowed only on localhost");
  });

  it("treats a localhost listen() beyond loopback like production", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const listen = async (
      host: string,
      options: Partial<OAuthProxyOptions<UpstreamUser>>
    ) => {
      const server = new MCPServer({
        name: "acme",
        version: "1.0.0",
        logging: { enabled: false },
        oauth: oauthProxy({
          upstream: upstreamConfig(),
          resource: RESOURCE,
          ...options,
        }),
      });
      try {
        await server.listen(0, { host });
      } finally {
        await server.close();
      }
    };
    try {
      // A localhost resource does not stop peers reaching a wildcard bind.
      await expect(listen("0.0.0.0", { secret: SECRET })).rejects.toThrow(
        "needs storage"
      );
      await expect(
        listen("0.0.0.0", { storage: inspectableStorage() })
      ).rejects.toThrow("needs a secret");
      await expect(
        listen("0.0.0.0", { storage: memoryStorage(), secret: SECRET })
      ).rejects.toThrow("memoryStorage() works only on localhost");
      await expect(
        listen("0.0.0.0", {
          storage: inspectableStorage(),
          secret: SECRET,
          consent: false,
        })
      ).rejects.toThrow("consent: false is allowed only on localhost");
      // A loopback bind keeps the development defaults.
      await expect(listen("127.0.0.1", {})).resolves.toBeUndefined();
      await expect(
        listen("127.0.0.1", { storage: memoryStorage(), consent: false })
      ).resolves.toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it("requires no secrets inside mcp-use build", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // What `mcp-use build` sets while it evaluates the entry.
    vi.stubEnv("MCP_USE_PHASE", "build");
    try {
      expect(isBuilding()).toBe(true);
      // A build with none of the runtime environment set, as in CI.
      const unset = process.env["MCP_USE_TEST_UNSET"]!;
      const response = await new MCPServer({
        name: "acme",
        version: "1.0.0",
        logging: { enabled: false },
        oauth: oauthProxy({
          upstream: github({ clientId: unset, clientSecret: unset }),
          resource: "https://api.example.com/mcp",
          storage: upstashStorage({ url: unset, token: unset }),
        }),
      }).fetch(new Request("https://api.example.com/mcp/oauth/authorize"));
      expect(response).toBeInstanceOf(Response);
      // A store chosen from the runtime environment may be memory at build.
      await expect(
        mount({
          resource: "https://api.example.com/mcp",
          storage: memoryStorage(),
        })
      ).resolves.toBeInstanceOf(Response);
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining("oauthProxy")
      );
      // Mistakes that no environment fixes still fail the build.
      await expect(
        mount({ resource: "https://api.example.com/mcp", consent: false })
      ).rejects.toThrow("consent: false is allowed only on localhost");
    } finally {
      vi.unstubAllEnvs();
      warn.mockRestore();
    }
    expect(isBuilding()).toBe(false);
    expect(() => github({ clientId: "", clientSecret: "" })).toThrow(
      "upstream.clientId must be a non-empty string"
    );
    expect(() => upstashStorage({} as never)).toThrow(
      "upstashStorage requires url and token"
    );
  });

  it("validates options when the provider is created", () => {
    expect(() =>
      oauthProxy({ upstream: upstreamConfig(), secret: "short" })
    ).toThrow("at least 32 characters");
    expect(() =>
      oauthProxy({ upstream: upstreamConfig(), clients: [] })
    ).toThrow("at least one client");
    for (const entry of [
      "http://client.example/meta",
      "https://client.example/meta#x",
      "https://client.example?x=1",
      "client.example",
    ]) {
      expect(() =>
        oauthProxy({ upstream: upstreamConfig(), clients: [entry] })
      ).toThrow("neither a client ID metadata document URL");
    }
    expect(() =>
      oauthProxy({
        upstream: upstreamConfig(),
        clients: ["https://claude.example"],
        dcr: true,
      })
    ).toThrow("dcr cannot be on while clients is set");
    expect(() =>
      oauthProxy({
        upstream: upstreamConfig(),
        clients: ["https://claude.example"],
        dcr: "true" as unknown as boolean,
      })
    ).toThrow("dcr must be a boolean");
    for (const clientId of ["https://app.example", "mcp_client_x"]) {
      expect(() =>
        oauthProxy({
          upstream: upstreamConfig(),
          clients: [{ clientId, redirectUris: ["http://127.0.0.1/cb"] }],
        })
      ).toThrow("must not look like");
    }
    expect(() =>
      oauthProxy({
        upstream: upstreamConfig(),
        clients: [
          { clientId: "app", redirectUris: ["http://127.0.0.1/cb"] },
          { clientId: "app", redirectUris: ["http://127.0.0.1/cb"] },
        ],
      })
    ).toThrow("listed twice");
    expect(() =>
      oauthProxy({
        upstream: upstreamConfig(),
        clients: [{ clientId: "app", redirectUris: ["data:text/html,hi"] }],
      })
    ).toThrow("oauthProxy clients:");
    expect(() =>
      github({
        clientId: "a",
        clientSecret: "b",
        baseUrl: "http://github.example",
      })
    ).toThrow("HTTPS");
    // The API receives the access token, so it follows the same rule.
    expect(() =>
      github({
        clientId: "a",
        clientSecret: "b",
        apiUrl: "http://api.github.example",
      })
    ).toThrow("oauthProxy github apiUrl must be an HTTPS URL");
    expect(() =>
      github({
        clientId: "a",
        clientSecret: "b",
        apiUrl: "http://localhost:8080/api",
      })
    ).not.toThrow();
  });

  it("serves secured responses on an HTTPS resource with __Host- cookies", async () => {
    const server = new MCPServer({
      name: "acme",
      version: "1.0.0",
      logging: { enabled: false },
      oauth: oauthProxy({
        resource: "https://api.example.com/mcp",
        upstream: upstreamConfig(),
        secret: SECRET,
        storage: inspectableStorage(),
        clients: [
          { clientId: "desktop", redirectUris: ["http://127.0.0.1/callback"] },
        ],
      }),
    });
    const { challenge } = await pkcePair();
    const response = await server.fetch(
      new Request(
        `https://api.example.com/mcp/oauth/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: "desktop",
          redirect_uri: "http://127.0.0.1:7777/callback",
          code_challenge: challenge,
          code_challenge_method: "S256",
        })}`
      )
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    const cookie = response.headers.getSetCookie()[0]!;
    expect(cookie).toMatch(/^__Host-mcp-oauth-csrf-[\w-]{16}=/);
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    const html = await response.text();
    expect(html).toContain("you return to <b>127.0.0.1:7777</b>");
  });
});
