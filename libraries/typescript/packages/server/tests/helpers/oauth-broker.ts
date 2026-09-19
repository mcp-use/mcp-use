import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  calculateJwkThumbprint,
  decodeJwt,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";

import { MCPServer } from "../../src/index.js";
import type {
  NativeMcpAuth,
  NativeMcpAuthOptions,
} from "../../src/oauth/better-auth-mcp.js";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { listenFetch } from "./listen-fetch.js";

type EngineOptions = Omit<NativeMcpAuthOptions, "providers" | "sessionPolicy">;

/** Real HTTP MCP server, authorization engine and disposable SQLite storage. */
export async function startBroker<T extends NativeMcpAuth>(
  create: (options: EngineOptions) => Promise<T>,
  sharedDatabase?: DatabaseSync
) {
  const db = sharedDatabase ?? new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  let dispatch = async (_request: Request): Promise<Response> =>
    new Response("starting", { status: 503 });
  const listener = await listenFetch((request) => dispatch(request));
  const resource = `${listener.url}/mcp`;
  const secret = randomBytes(32).toString("hex");
  let server: { close(): Promise<void> } | undefined;
  try {
    const auth = await create({
      resource,
      secret,
      database: db,
      scopes: ["mcp:read", "offline_access"],
      requiredScopes: ["mcp:read"],
      sessionExpiresIn: 600,
      accessTokenExpiresIn: 60,
      allowDynamicClientRegistration: true,
      fetchClientMetadataResource,
    });
    await (await auth.getMigrations()).runMigrations();
    const integration = await auth.connect();
    const mcp = new MCPServer({
      name: "broker-integration",
      version: "1.0.0",
      logging: { enabled: false },
      requestAuth: integration.requestAuth,
    });
    server = mcp;
    let executions = 0;
    mcp.tool({ name: "identity" }, (_args, ctx) => {
      executions++;
      return {
        content: [{ type: "text", text: JSON.stringify(ctx.auth.user) }],
      };
    });
    dispatch = async (request) =>
      (await integration.handle(request)) ?? mcp.fetch(request);
    const base = `${listener.url}${auth.basePath}`;
    const prefix = `mcp_${auth.basePath.split("/")[2]}_`;
    return {
      auth,
      integration,
      db,
      secret,
      base,
      resource,
      origin: listener.url,
      get executions() {
        return executions;
      },
      refreshRows: () =>
        db
          .prepare(`SELECT * FROM "${prefix}oauthRefreshToken" ORDER BY id`)
          .all(),
      session: (token: string) =>
        db
          .prepare(`SELECT * FROM "${prefix}session" WHERE id = ?`)
          .get(String(decodeJwt(token).sid)),
      token: (fields: Record<string, string>, dpop?: string) =>
        fetch(`${base}/oauth2/token`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            ...(dpop ? { DPoP: dpop } : {}),
          },
          body: new URLSearchParams({ resource, ...fields }),
        }),
      tool: (token: string, dpop?: string, scheme = "Bearer") =>
        fetch(resource, {
          method: "POST",
          headers: {
            authorization: `${scheme} ${token}`,
            ...(dpop ? { DPoP: dpop } : {}),
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2026-07-28",
            "mcp-method": "tools/call",
            "mcp-name": "identity",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "identity",
              arguments: {},
              _meta: {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientInfo": {
                  name: "broker-test",
                  version: "1.0.0",
                },
                "io.modelcontextprotocol/clientCapabilities": {},
              },
            },
          }),
        }),
      async close() {
        await mcp.close();
        await listener.close();
        if (!sharedDatabase) db.close();
      },
    };
  } catch (error) {
    await server?.close();
    await listener.close();
    if (!sharedDatabase) db.close();
    throw error;
  }
}

/** Separate cookie jar for each browser login; redirects are followed explicitly. */
export class OAuthBrowser {
  private readonly jars = new Map<string, Map<string, string>>();

  /** Only these fixture origins may receive cookies or authorization requests. */
  constructor(private readonly origins: readonly string[]) {}

  /** Send a browser request and retain the real engine/provider cookies. */
  async request(url: string, body?: unknown): Promise<Response> {
    const origin = new URL(url).origin;
    assert.ok(this.origins.includes(origin), "Unexpected OAuth destination");
    const jar = this.jars.get(origin) ?? new Map<string, string>();
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      headers: {
        accept: "text/html",
        cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "),
        ...(body === undefined
          ? {}
          : { origin, "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0]!;
      const split = pair.indexOf("=");
      const key = pair.slice(0, split);
      if (/max-age=0/i.test(cookie)) jar.delete(key);
      else jar.set(key, pair.slice(split + 1));
    }
    this.jars.set(origin, jar);
    return response;
  }
}

/** Read the engine's actual redirect, accepting both HTTP and JSON continuations. */
export async function redirect(response: Response): Promise<string> {
  const location = response.headers.get("location");
  if (location) {
    await response.body?.cancel();
    return new URL(location, response.url).href;
  }
  const body = (await response.json()) as {
    url?: string;
    redirect_uri?: string;
  };
  const next = body.url ?? body.redirect_uri;
  assert.equal(
    typeof next,
    "string",
    `Missing OAuth continuation (${response.status})`
  );
  return new URL(next!, response.url).href;
}

/** Follow real authorization/callback routes, rendering only fixture login and consent. */
export async function followAuthorization(
  broker: Awaited<ReturnType<typeof startBroker>>,
  browser: OAuthBrowser,
  start: string,
  callback: string,
  login: (query: string) => Promise<Response>
): Promise<URL> {
  let next = start;
  for (let step = 0; step < 20; step++) {
    const url = new URL(next);
    if (`${url.origin}${url.pathname}` === callback) return url;
    let response: Response;
    if (
      url.origin === broker.origin &&
      url.pathname === broker.auth.loginPath
    ) {
      response = await login(url.search.slice(1));
    } else if (
      url.origin === broker.origin &&
      url.pathname === broker.auth.consentPath
    ) {
      response = await browser.request(`${broker.base}/oauth2/consent`, {
        accept: true,
        oauth_query: url.search.slice(1),
      });
    } else {
      response = await browser.request(next);
    }
    next = await redirect(response);
  }
  throw new Error("OAuth flow exceeded its redirect limit");
}

/** Register an MCP client and obtain a real one-use code with PKCE. */
export async function authorize(
  broker: Awaited<ReturnType<typeof startBroker>>,
  browser: OAuthBrowser,
  login: (query: string) => Promise<Response>,
  dpopThumbprint?: string
) {
  const callback = `${broker.origin}/client-callback`;
  const registration = await browser.request(`${broker.base}/oauth2/register`, {
    application_type: "native",
    redirect_uris: [callback],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "mcp:read offline_access",
    ...(dpopThumbprint ? { dpop_bound_access_tokens: true } : {}),
  });
  assert.equal(registration.status, 201);
  const { client_id: clientId } = (await registration.json()) as {
    client_id: string;
  };
  const verifier = randomBytes(32).toString("base64url");
  const state = randomUUID();
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: callback,
    scope: "mcp:read offline_access",
    resource: broker.resource,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    ...(dpopThumbprint ? { dpop_jkt: dpopThumbprint } : {}),
  });
  const returned = await followAuthorization(
    broker,
    browser,
    `${broker.base}/oauth2/authorize?${query}`,
    callback,
    login
  );
  assert.equal(returned.searchParams.get("state"), state);
  const code = returned.searchParams.get("code");
  assert.ok(code, "Authorization did not issue a code");
  return {
    clientId,
    fields: {
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: callback,
      code,
      code_verifier: verifier,
    },
  };
}

/** Parse actual engine-issued credentials; no substitute access token is generated. */
export async function tokens(response: Response) {
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
  };
  assert.ok(body.access_token && body.refresh_token);
  return body;
}

/** Generate a client proof key and signed RFC 9449 proofs for real engine tokens. */
export async function proofKey() {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  return {
    thumbprint: await calculateJwkThumbprint(jwk),
    sign: (url: string, token?: string, typ = "dpop+jwt") =>
      new SignJWT({
        htm: "POST",
        htu: url,
        ...(token
          ? { ath: createHash("sha256").update(token).digest("base64url") }
          : {}),
      })
        .setProtectedHeader({ alg: "ES256", typ, jwk })
        .setIssuedAt()
        .setJti(randomUUID())
        .sign(privateKey),
  };
}
