/**
 * A fetch-based browser and MCP client for `oauthProxy` tests: registers a
 * client, opens the consent page, posts the decision, exchanges the code,
 * and calls tools with the access token. Used by the Firebase stub test.
 */
import { expect } from "vitest";

/** A fetch-based browser that keeps cookies for the MCP server's origin. */
export class Browser {
  readonly cookies = new Map<string, string>();

  constructor(
    private readonly server: { fetch(request: Request): Promise<Response> }
  ) {}

  async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0 && !headers.has("cookie")) {
      headers.set("cookie", this.cookieHeader());
    }
    const response = await this.server.fetch(
      new Request(url, { ...init, headers, redirect: "manual" })
    );
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split(";");
      const index = pair!.indexOf("=");
      const name = pair!.slice(0, index).trim();
      const value = pair!.slice(index + 1).trim();
      if (
        value === "" ||
        attributes.some((item) => /max-age=0\b/i.test(item.trim()))
      ) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
    return response;
  }

  cookieHeader(): string {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  form(
    url: string,
    fields: Record<string, string>,
    headers: Record<string, string> = {}
  ): Promise<Response> {
    return this.request(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(fields).toString(),
    });
  }
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function hiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of html.matchAll(
    /<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g
  )) {
    fields[decodeHtml(match[1]!)] = decodeHtml(match[2]!);
  }
  return fields;
}

export async function pkcePair(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const encode = (data: Uint8Array) =>
    btoa(String.fromCharCode(...data))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  );
  return { verifier, challenge: encode(digest) };
}

export interface Client {
  clientId: string;
  redirectUri: string;
}

export interface ConsentPage {
  response: Response;
  html: string;
  /** Absolute URL of the form's action. */
  action: string;
  fields: Record<string, string>;
  verifier: string;
}

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
}

const ENVELOPE = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

/** Reads the text of a tool result, expecting a 200. */
export async function toolText(response: Response): Promise<string> {
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result: { content: Array<{ text: string }> };
  };
  return body.result.content[0]!.text;
}

/**
 * The OAuth steps of an MCP client against the proxy mounted at `resource`,
 * with a loopback `redirectUri`. The proxy's routes are under
 * `<resource>/oauth`.
 */
export function oauthFlow({
  resource,
  redirectUri,
}: {
  resource: string;
  redirectUri: string;
}) {
  async function register(browser: Browser): Promise<Client> {
    const response = await browser.request(`${resource}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Test Client",
        redirect_uris: [redirectUri],
      }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { client_id: string };
    return { clientId: body.client_id, redirectUri };
  }

  /** Opens /authorize and reads the consent page that it shows. */
  async function openConsent(
    browser: Browser,
    client: Client
  ): Promise<ConsentPage> {
    const { verifier, challenge } = await pkcePair();
    const authorize = new URL(`${resource}/oauth/authorize`);
    for (const [name, value] of Object.entries({
      response_type: "code",
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "client-state-42",
      resource,
    })) {
      authorize.searchParams.set(name, value);
    }
    const response = await browser.request(authorize.href);
    expect(response.status).toBe(200);
    const html = await response.text();
    const action = decodeHtml(html.match(/<form[^>]*action="([^"]+)"/)![1]!);
    return {
      response,
      html,
      action: new URL(action, resource).href,
      fields: hiddenFields(html),
      verifier,
    };
  }

  /** Clicks Allow: posts the decision with the proof, as the page script does. */
  async function allow(
    browser: Browser,
    page: ConsentPage,
    posted: string
  ): Promise<URL> {
    const answer = await browser.form(page.action, {
      ...page.fields,
      decision: "allow",
      proof: posted,
    });
    expect(answer.status).toBe(302);
    const location = new URL(answer.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(redirectUri);
    expect(location.searchParams.get("state")).toBe("client-state-42");
    return location;
  }

  async function exchange(
    browser: Browser,
    client: Client,
    code: string,
    verifier: string
  ): Promise<{ status: number; body: TokenResponse }> {
    const response = await browser.form(`${resource}/oauth/token`, {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      resource,
    });
    return {
      status: response.status,
      body: (await response.json()) as TokenResponse,
    };
  }

  /** Signs in through the consent page and exchanges the code. */
  async function signIn(
    browser: Browser,
    client: Client,
    posted: string
  ): Promise<TokenResponse> {
    const page = await openConsent(browser, client);
    const location = await allow(browser, page, posted);
    const code = location.searchParams.get("code");
    expect(code).toBeTruthy();
    const tokens = await exchange(browser, client, code!, page.verifier);
    expect(tokens.status).toBe(200);
    return tokens.body;
  }

  /** Calls a tool without arguments with the MCP access token. */
  function callTool(
    browser: Browser,
    name: string,
    accessToken: string
  ): Promise<Response> {
    return browser.request(resource, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": name,
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: {}, _meta: ENVELOPE },
      }),
    });
  }

  /** Uses the MCP refresh token. */
  async function refresh(
    browser: Browser,
    client: Client,
    refreshToken: string
  ): Promise<{ status: number; body: TokenResponse }> {
    const response = await browser.form(`${resource}/oauth/token`, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: client.clientId,
    });
    return {
      status: response.status,
      body: (await response.json()) as TokenResponse,
    };
  }

  return {
    register,
    openConsent,
    allow,
    exchange,
    signIn,
    callTool,
    refresh,
  };
}
