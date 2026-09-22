import type { OAuthProviderExtension } from "@better-auth/oauth-provider";
import type { AuthContext } from "better-auth";
import { APIError } from "better-auth/api";
import { stripAccessTokenAuthorizationScheme } from "better-auth/oauth2";
import type { JWTPayload } from "jose";

import { isRecord } from "./guards.js";
import type { BetterAuthMcpInstance } from "./better-auth-mcp.js";

interface RefreshGrant {
  clientId: string;
  userId: string;
  sessionId: string;
  authorizationCodeId: string;
}

interface GrantContext {
  adapter: Pick<AuthContext["adapter"], "findOne">;
  internalAdapter: Pick<
    AuthContext["internalAdapter"],
    "findVerificationValue"
  >;
}

/** @internal Explicit SHA-256 token storage, shared with the private OAuth engine. */
export async function hashMcpToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function refreshGrant(context: GrantContext, token: string) {
  return context.adapter.findOne<RefreshGrant>({
    model: "oauthRefreshToken",
    where: [{ field: "token", value: await hashMcpToken(token) }],
  });
}

/** @internal Bind JWTs to the engine's existing refresh grant across rotations. */
export const mcpGrantExtension: OAuthProviderExtension = {
  claims: {
    async accessToken({ ctx, grantType, client, user, sessionId, scopes }) {
      const body: unknown = ctx.body;
      if (!isRecord(body))
        throw new APIError("BAD_REQUEST", { error: "invalid_grant" });
      if (grantType === "authorization_code") {
        // Better Auth permits refresh for authorization-code clients even when
        // their registration omits refresh_token from grant_types.
        if (!scopes.includes("offline_access")) return { mcp_grant: null };
        if (typeof body["code"] === "string")
          return { mcp_grant: await hashMcpToken(body["code"]) };
      } else if (
        grantType === "refresh_token" &&
        typeof body["refresh_token"] === "string"
      ) {
        const grant = await refreshGrant(ctx.context, body["refresh_token"]);
        if (
          grant?.authorizationCodeId &&
          grant.clientId === client.clientId &&
          grant.userId === user?.id &&
          grant.sessionId === sessionId
        ) {
          return { mcp_grant: grant.authorizationCodeId };
        }
      }
      throw new APIError("BAD_REQUEST", { error: "invalid_grant" });
    },
  },
};

type RunOperation = (
  key: string,
  operation: () => Promise<Response>,
  request?: Request
) => Promise<Response>;

/** @internal Reuses engine grant rows for revocation and client/user serialization. */
export function createMcpGrantGuard(context: GrantContext, run: RunOperation) {
  const key = (clientId: string, userId: string) =>
    JSON.stringify(["grant", clientId, userId]);
  return {
    async run(
      clientId: string,
      operation: () => Promise<Response>,
      request?: Request
    ): Promise<Response> {
      if (!request) return run(clientId, operation);
      let body: unknown;
      if (
        request.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase() === "application/json"
      ) {
        body = await request.clone().json();
      } else {
        const form = new URLSearchParams(await request.clone().text());
        if (
          ["grant_type", "code", "refresh_token", "token"].some(
            (field) => form.getAll(field).length > 1
          )
        )
          return invalidGrant();
        body = Object.fromEntries(form);
      }
      if (!isRecord(body)) return invalidGrant();
      const tokenEndpoint = new URL(request.url).pathname
        .replace(/\/+$/, "")
        .endsWith("/oauth2/token");
      let grant: { clientId: string; userId: string } | null = null;
      try {
        if (
          tokenEndpoint &&
          body["grant_type"] === "authorization_code" &&
          typeof body["code"] === "string"
        ) {
          const code = await hashMcpToken(body["code"]);
          const verification =
            await context.internalAdapter.findVerificationValue(code);
          if (verification) {
            let value: unknown;
            try {
              value = JSON.parse(verification.value);
            } catch {
              return invalidGrant();
            }
            if (
              isRecord(value) &&
              typeof value["userId"] === "string" &&
              isRecord(value["query"]) &&
              typeof value["query"]["client_id"] === "string"
            ) {
              grant = {
                clientId: value["query"]["client_id"],
                userId: value["userId"],
              };
            }
          } else {
            // A consumed code can still revoke its previously issued grant on replay.
            grant = await context.adapter.findOne<RefreshGrant>({
              model: "oauthRefreshToken",
              where: [{ field: "authorizationCodeId", value: code }],
            });
          }
          // No code or issued grant exists to mutate. Do not race replay cleanup
          // against an in-flight first issuance whose code was already consumed.
          if (!grant) return invalidGrant();
        } else {
          const token = tokenEndpoint
            ? body["grant_type"] === "refresh_token"
              ? body["refresh_token"]
              : undefined
            : typeof body["token"] === "string"
              ? stripAccessTokenAuthorizationScheme(body["token"])
              : undefined;
          if (typeof token === "string")
            grant = await refreshGrant(context, token);
        }
      } catch {
        // Resolution is read-only and the engine has not consumed any credential.
        return Response.json(
          { error: "temporarily_unavailable" },
          {
            status: 503,
            headers: { "Cache-Control": "no-store", "Retry-After": "1" },
          }
        );
      }
      if (grant && grant.clientId !== clientId) return invalidGrant();
      return run(
        grant ? key(grant.clientId, grant.userId) : clientId,
        operation,
        request
      );
    },
    async check(
      claims: JWTPayload,
      request: Request
    ): Promise<"valid" | "invalid" | "unavailable"> {
      if (claims["mcp_grant"] === null) return "valid";
      if (
        typeof claims["mcp_grant"] !== "string" ||
        typeof claims["client_id"] !== "string" ||
        typeof claims.sub !== "string" ||
        typeof claims.sid !== "string"
      )
        return "invalid";
      const response = await run(
        key(claims["client_id"], claims.sub),
        async () => {
          const active = await context.adapter.findOne({
            model: "oauthRefreshToken",
            where: [
              {
                field: "authorizationCodeId",
                value: claims["mcp_grant"] as string,
              },
              { field: "clientId", value: claims["client_id"] as string },
              { field: "userId", value: claims.sub! },
              { field: "sessionId", value: claims.sid as string },
              { field: "revoked", value: null },
              { field: "expiresAt", operator: "gt", value: new Date() },
            ],
          });
          return new Response(null, { status: active ? 204 : 401 });
        },
        request
      );
      return response.status === 204
        ? "valid"
        : response.status === 401
          ? "invalid"
          : "unavailable";
    },
  };
}

function invalidGrant(): Response {
  return Response.json(
    { error: "invalid_grant" },
    { status: 400, headers: { "Cache-Control": "no-store" } }
  );
}

const activeTokenClients = new WeakMap<
  BetterAuthMcpInstance,
  Map<string, Promise<void>>
>();

/** @internal Shared process-local guard for engine token operations and grant checks. */
export async function runLocalTokenOperation(
  auth: BetterAuthMcpInstance,
  clientId: string,
  operation: () => Promise<Response>
): Promise<Response> {
  let active = activeTokenClients.get(auth);
  if (!active) {
    active = new Map();
    activeTokenClients.set(auth, active);
  }
  const deadline = performance.now() + 1_000;
  while (active.has(clientId)) {
    const remaining = deadline - performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const available =
      remaining > 0 &&
      (await Promise.race([
        active.get(clientId)!.then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), remaining);
        }),
      ]));
    clearTimeout(timer);
    if (!available || performance.now() >= deadline) {
      return Response.json(
        { error: "temporarily_unavailable" },
        {
          status: 503,
          headers: { "Cache-Control": "no-store", "Retry-After": "1" },
        }
      );
    }
  }
  let release!: () => void;
  active.set(clientId, new Promise<void>((resolve) => (release = resolve)));
  try {
    return await operation();
  } finally {
    active.delete(clientId);
    release();
  }
}
