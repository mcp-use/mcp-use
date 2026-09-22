import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair } from "jose";
import Provider, { type Adapter, type ClientMetadata } from "oidc-provider";

/** Independent local issuer: real codes, PKCE, signing, introspection and revocation. */
export async function startOidcProvider(
  authentication: "basic" | "post" = "post",
  accessTokenSeconds?: number
) {
  let handle = async (_request: IncomingMessage, response: ServerResponse) => {
    response.writeHead(503).end();
  };
  const errors: unknown[] = [];
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      errors.push(error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const signingKey = await exportJWK(privateKey);
  const clientId = "upstream-test-client";
  const clientSecret = randomBytes(32).toString("hex");
  const provider = new Provider(origin, {
    clients: [],
    jwks: {
      keys: [{ ...signingKey, kid: randomUUID(), alg: "RS256", use: "sig" }],
    },
    cookies: { keys: [randomBytes(32).toString("hex")] },
    features: {
      registration: { enabled: false },
      devInteractions: { enabled: false },
      introspection: {
        enabled: true,
        allowedPolicy: (_ctx, client, token) =>
          token.clientId === client.clientId,
      },
      revocation: {
        enabled: true,
        allowedPolicy: (_ctx, client, token) =>
          token.clientId === client.clientId,
      },
    },
    responseTypes: ["code"],
    rotateRefreshToken: true,
    ...(accessTokenSeconds === undefined
      ? {}
      : { ttl: { AccessToken: accessTokenSeconds } }),
    pkce: { required: () => true },
    claims: {
      openid: ["sub"],
      profile: ["name"],
      email: ["email", "email_verified"],
    },
    findAccount: async (_ctx, id) =>
      id === "upstream-user"
        ? {
            accountId: id,
            claims: async () => ({
              sub: id,
              name: "Upstream fixture",
              email: "upstream@example.test",
              email_verified: true,
            }),
          }
        : undefined,
  });
  const callback = provider.callback();
  const control = {
    fault: "none" as "none" | "unavailable" | "unauthorized" | "malformed",
    tokenFault: "none" as "none" | "unavailable" | "invalid_grant",
    tokenWait: undefined as Promise<void> | undefined,
    failIntrospectionAfterToken: false,
  };
  let introspectionCalls = 0;
  let tokenCalls = 0;
  handle = async (request, response) => {
    const url = new URL(request.url!, origin);
    if (url.pathname === "/token") {
      tokenCalls++;
      const fault = control.tokenFault;
      if (control.tokenWait) await control.tokenWait;
      if (control.failIntrospectionAfterToken) control.fault = "unavailable";
      if (fault !== "none") {
        response
          .writeHead(fault === "unavailable" ? 503 : 400, {
            "content-type": "application/json",
          })
          .end(JSON.stringify({ error: fault }));
        return;
      }
    }
    if (url.pathname === "/token/introspection") {
      introspectionCalls++;
      if (control.fault !== "none") {
        response
          .writeHead(
            control.fault === "unavailable"
              ? 503
              : control.fault === "unauthorized"
                ? 401
                : 200,
            {
              "content-type": "application/json",
            }
          )
          .end("{}");
        return;
      }
    }
    if (url.pathname.startsWith("/interaction/")) {
      const interaction = await provider.interactionDetails(request, response);
      // Fixture users replace the human login UI; the issuer still performs
      // its actual protocol, grant and credential checks on every endpoint.
      if (interaction.prompt.name === "login") {
        await provider.interactionFinished(
          request,
          response,
          {
            login: { accountId: "upstream-user" },
          },
          { mergeWithLastSubmission: false }
        );
        return;
      }
      assert.equal(interaction.prompt.name, "consent");
      const grant = interaction.grantId
        ? await provider.Grant.find(interaction.grantId)
        : new provider.Grant({
            accountId: "upstream-user",
            clientId: String(interaction.params.client_id),
          });
      assert.ok(grant);
      grant.addOIDCScope(
        (interaction.prompt.details.missingOIDCScope ?? []) as string[]
      );
      grant.addOIDCClaims(
        (interaction.prompt.details.missingOIDCClaims ?? []) as string[]
      );
      await provider.interactionFinished(
        request,
        response,
        {
          consent: { grantId: await grant.save() },
        },
        { mergeWithLastSubmission: true }
      );
      return;
    }
    await callback(request, response);
  };
  return {
    origin,
    clientId,
    clientSecret,
    control,
    errors,
    get introspectionCalls() {
      return introspectionCalls;
    },
    get tokenCalls() {
      return tokenCalls;
    },
    async register(callbackUrl: string) {
      const metadata: ClientMetadata = {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uris: [callbackUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        application_type: "native",
        token_endpoint_auth_method: `client_secret_${authentication}`,
        introspection_endpoint_auth_method: `client_secret_${authentication}`,
        revocation_endpoint_auth_method: `client_secret_${authentication}`,
      };
      await provider.Client.validate(metadata);
      // DCR stays disabled. Provision the client in the issuer's own memory
      // adapter once the broker has supplied its real callback URL.
      const Client = provider.Client as typeof provider.Client & {
        adapter: Adapter;
      };
      await Client.adapter.upsert(clientId, metadata, 600);
    },
    revoke(token: string, type: "access_token" | "refresh_token") {
      const body = new URLSearchParams({ token, token_type_hint: type });
      const headers = new Headers({
        "content-type": "application/x-www-form-urlencoded",
      });
      if (authentication === "basic") {
        headers.set(
          "authorization",
          `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
        );
      } else {
        body.set("client_id", clientId);
        body.set("client_secret", clientSecret);
      }
      return fetch(`${origin}/token/revocation`, {
        method: "POST",
        headers,
        body,
      });
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
