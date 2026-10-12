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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MCPServer } from "../src/index.js";
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
  options: { decision?: "allow" | "deny"; state?: string; scope?: string } = {}
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
      url = new URL(response.headers.get("location")!, url).href;
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
      url = new URL(answer.headers.get("location")!, url).href;
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
      url = new URL(answer.headers.get("location")!, url).href;
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
  refreshToken: string
): Promise<{ status: number; body: TokenResponse }> {
  const response = await browser.form(`${RESOURCE}/oauth/token`, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
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

interface GitHubSetup {
  server: MCPServer<UpstreamUser>;
  spy: UpstreamSpy;
  toolTokens: string[];
}

function githubServer(
  overrides: Partial<OAuthProxyOptions<UpstreamUser>> = {}
): GitHubSetup {
  const spy = new UpstreamSpy();
  const toolTokens: string[] = [];
  const server = new MCPServer({
    name: "acme",
    version: "1.0.0",
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
  return { server, spy, toolTokens };
}

// ─── GitHub ──────────────────────────────────────────────────────────────

describe("oauthProxy with emulated GitHub", () => {
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
    // Any local app can claim a custom scheme, so the page warns.
    expect(await consent.text()).toContain("This app runs on your computer");
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

  it("identifies a client by its metadata document and skips consent for trusted ones", async () => {
    const clientId = "https://client.example/oauth/metadata.json";
    const document = {
      client_id: clientId,
      client_name: "Metadata Client",
      redirect_uris: ["https://client.example/callback", CLIENT_REDIRECT],
      token_endpoint_auth_method: "none",
    };
    const spy = new UpstreamSpy();
    const cimdFetch: typeof globalThis.fetch = async (input, init) =>
      String(input) === clientId
        ? Response.json(document)
        : spy.fetch(input, init);

    const consentFor = async (
      trusted: boolean,
      redirectUri = "https://client.example/callback"
    ) => {
      const { server } = githubServer({
        fetch: cimdFetch,
        ...(trusted && { trustedClients: [clientId] }),
      });
      const browser = new Browser(server);
      const { code, verifier } = await signIn(
        browser,
        { clientId, redirectUri },
        "hubot"
      );
      const consent = browser.transcript.find((entry) =>
        entry.includes('name="decision"')
      );
      const tokens = await exchange(
        browser,
        { clientId, redirectUri },
        code,
        verifier
      );
      expect(tokens.status).toBe(200);
      return consent;
    };

    const page = await consentFor(false);
    expect(page).toContain("Metadata Client");
    expect(page).toContain("client.example");
    expect(page).not.toContain("Unverified");
    expect(await consentFor(true)).toBeUndefined();
    // Trust never skips consent for a loopback redirect.
    expect(await consentFor(true, CLIENT_REDIRECT)).toContain(
      "This app runs on your computer"
    );
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

function googleServer(spy: UpstreamSpy): {
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
  });

  it("validates options when the provider is created", () => {
    expect(() =>
      oauthProxy({ upstream: upstreamConfig(), secret: "short" })
    ).toThrow("at least 32 characters");
    expect(() =>
      oauthProxy({
        upstream: upstreamConfig(),
        preRegisteredClients: [
          {
            clientId: "app",
            redirectUris: ["http://127.0.0.1/cb"],
            trusted: true,
          },
        ],
      })
    ).toThrow("only with HTTPS redirect URIs");
    expect(() =>
      oauthProxy({
        upstream: upstreamConfig(),
        trustedClients: ["http://client.example/meta"],
      })
    ).toThrow("trustedClients");
    expect(() =>
      oauthProxy({
        upstream: {
          kind: "in-page",
          id: "firebase",
          name: "Firebase",
          page: () => null,
          verify: async () => ({ user: { subject: "u", profile: {} } }),
        },
      })
    ).toThrow("in-page upstreams");
    expect(() =>
      github({
        clientId: "a",
        clientSecret: "b",
        baseUrl: "http://github.example",
      })
    ).toThrow("HTTPS");
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
        preRegisteredClients: [
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
    expect(cookie).toMatch(/^__Host-mcp-oauth-csrf=/);
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    const html = await response.text();
    expect(html).toContain("This app runs on your computer");
  });
});
