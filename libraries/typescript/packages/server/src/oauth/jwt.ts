import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { createRemoteJWKSet, jwtVerify, errors, type JWTPayload } from "jose";

import type { OAuthResourceOptions } from "./provider.js";

/** @internal Record of claims extracted from a verified JWT. */
export type VerifiedPayload = Record<string, unknown>;

/** @internal Configures issuer, keys, and claims enforced by a JWT verifier. */
export interface JwtVerifierOptions {
  issuer: string;
  jwksUrl: URL;
  audience?: string;
  resource?: OAuthResourceOptions["resource"];
  algorithms?: readonly string[];
  key?: Uint8Array;
}

/** @internal Creates a verifier that rejects JWTs with invalid signatures or required claims. */
export function createJwtVerifier(
  options: JwtVerifierOptions
): OAuthTokenVerifier {
  let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  if (options.key === undefined) {
    jwks = createRemoteJWKSet(options.jwksUrl);
  }

  let configuredResource: URL | undefined;
  if (options.resource !== undefined) {
    configuredResource = canonicalUrl(options.resource);
  }

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      try {
        const verificationOptions = {
          issuer: options.issuer,
          ...(options.audience !== undefined && { audience: options.audience }),
          ...(options.algorithms !== undefined && {
            algorithms: [...options.algorithms],
          }),
          requiredClaims: ["exp", "sub"],
        };
        const { payload } =
          options.key !== undefined
            ? await jwtVerify(token, options.key, verificationOptions)
            : jwks !== undefined
              ? await jwtVerify(token, jwks, verificationOptions)
              : (() => {
                  throw new Error("JWT verification key is unavailable");
                })();
        const claims = payloadRecord(payload);
        // clientId is only the OAuth client (client_id / azp), never sub.
        // SDK AuthInfo requires a string, but many IdPs (WorkOS AuthKit,
        // Supabase) issue tokens without client claims; empty string is mapped
        // to undefined at the mcp-use context layer.
        const clientId =
          requiredString(claims, "client_id") ?? requiredString(claims, "azp");
        const expiresAt = requiredFutureNumber(claims, "exp");
        const resource = verifiedResource(claims, configuredResource);

        return {
          token,
          clientId: clientId ?? "",
          scopes: normalizedStrings(claims["scope"]),
          expiresAt,
          extra: { payload: claims },
          ...(resource !== undefined && { resource }),
        };
      } catch (error) {
        if (error instanceof OAuthError) {
          throw error;
        }
        if (isCredentialFailure(error)) {
          if (process.env["MCP_USE_OAUTH_DEBUG"]) {
            logJwtFailure(token, error);
          }
          throw invalidToken("JWT verification failed", error);
        }
        throw error;
      }
    },
  };
}

/** Validates and canonicalizes an authorization-server URL before JWKS setup. */
export function normalizedProviderUrl(value: URL | string, name: string): URL {
  const raw =
    typeof value === "string" && !value.includes("://")
      ? `https://${value}`
      : value;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`${name} must be an absolute HTTP(S) URL`);
  }
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol === "http:" && !isLocalhost(url))
  ) {
    throw new TypeError(
      `${name} must use HTTPS, or HTTP for localhost, without credentials, query, or fragment`
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url;
}

/** @internal Resolves a provider endpoint without losing an issuer path prefix. */
export function providerEndpoint(issuer: string | URL, path: string): string {
  const base = typeof issuer === "string" ? new URL(issuer) : new URL(issuer);
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/`;
  return new URL(path.replace(/^\/+/, ""), base).href;
}

/** @internal Reads the verified JWT payload from SDK auth information. */
export function payloadFromAuthInfo(authInfo: AuthInfo): VerifiedPayload {
  const payload = authInfo.extra?.["payload"];
  if (!isRecord(payload)) {
    throw invalidToken("Verified token payload is missing");
  }
  return payload;
}

/** @internal Returns a non-blank string claim when present. */
export function requiredString(
  claims: VerifiedPayload,
  name: string
): string | undefined {
  const value = claims[name];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

/** @internal Returns a string claim without coercion. */
export function stringValue(
  claims: VerifiedPayload,
  name: string
): string | undefined {
  const value = claims[name];
  return typeof value === "string" ? value : undefined;
}

/** @internal Returns a boolean claim without coercion. */
export function booleanValue(
  claims: VerifiedPayload,
  name: string
): boolean | undefined {
  const value = claims[name];
  return typeof value === "boolean" ? value : undefined;
}

/** @internal Returns a finite numeric claim without coercion. */
export function numberValue(
  claims: VerifiedPayload,
  name: string
): number | undefined {
  const value = claims[name];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** @internal Returns an object claim and excludes arrays. */
export function recordValue(
  claims: VerifiedPayload,
  name: string
): Record<string, unknown> | undefined {
  const value = claims[name];
  return isRecord(value) ? value : undefined;
}

/** @internal Normalizes scope-like strings or arrays into non-empty strings. */
export function normalizedStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(/\s+/).filter(Boolean);
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );
}

/** @internal Returns a future numeric claim or raises an invalid-token error. */
export function requiredFutureNumber(
  claims: VerifiedPayload,
  name: string
): number {
  const value = numberValue(claims, name);
  if (value === undefined || value <= Date.now() / 1000) {
    throw invalidToken(`Missing or expired ${name} claim`);
  }
  return value;
}

/** @internal Creates an OAuth invalid-token error with an optional cause. */
export function invalidToken(message: string, cause?: unknown): OAuthError {
  const error = new OAuthError(OAuthErrorCode.InvalidToken, message);
  if (cause !== undefined) {
    error.cause = cause;
  }
  return error;
}

function verifiedResource(
  claims: VerifiedPayload,
  configuredResource: URL | undefined
): URL | undefined {
  const value = claims["resource"];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw invalidToken("Token resource claim must be an absolute URL");
  }
  const resource = canonicalUrl(value);
  if (
    configuredResource !== undefined &&
    resource.href !== configuredResource.href
  ) {
    throw invalidToken(
      "Token resource claim does not match configured resource"
    );
  }
  return resource;
}

function canonicalUrl(value: URL | string): URL {
  try {
    const url = new URL(value);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol === "http:" && !isLocalhost(url))
    ) {
      throw new TypeError();
    }
    url.pathname =
      url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
    return url;
  } catch {
    throw invalidToken(
      "Token resource claim must be an absolute HTTPS URL, or HTTP URL for localhost"
    );
  }
}

function isCredentialFailure(error: unknown): boolean {
  return (
    error instanceof errors.JWTClaimValidationFailed ||
    error instanceof errors.JWTExpired ||
    error instanceof errors.JOSEAlgNotAllowed ||
    error instanceof errors.JOSENotSupported ||
    error instanceof errors.JWSInvalid ||
    error instanceof errors.JWTInvalid ||
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JWKSNoMatchingKey
  );
}

function isLocalhost(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

function payloadRecord(payload: JWTPayload): VerifiedPayload {
  return { ...payload };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const JWT_DEBUG_CLAIMS = [
  "iss",
  "aud",
  "azp",
  "sub",
  "exp",
  "iat",
  "nbf",
  "client_id",
  "scope",
  "typ",
  "jti",
] as const;

function logJwtFailure(token: string, error: unknown): void {
  try {
    const name =
      error instanceof Error ? error.constructor.name : typeof error;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[oauth-debug] JWT verify failed: ${name}: ${message}`);
    if (error instanceof errors.JWTClaimValidationFailed) {
      console.error(
        `[oauth-debug] claim=${error.claim} reason=${error.reason}`
      );
    }

    const segments = token.split(".");
    console.error(`[oauth-debug] token segments: ${segments.length}`);
    if (segments.length !== 3) {
      const preview =
        token.length > 12 ? `${token.slice(0, 12)}…` : token;
      console.error(
        `[oauth-debug] non-JWT token preview=${preview} length=${token.length}`
      );
      return;
    }

    try {
      const headerJson = Buffer.from(segments[0]!, "base64url").toString(
        "utf8"
      );
      console.error(`[oauth-debug] header=${headerJson}`);
    } catch (decodeError) {
      console.error(
        `[oauth-debug] header decode failed: ${
          decodeError instanceof Error
            ? decodeError.message
            : String(decodeError)
        }`
      );
    }

    try {
      const payloadJson = Buffer.from(segments[1]!, "base64url").toString(
        "utf8"
      );
      const payload = JSON.parse(payloadJson) as Record<string, unknown>;
      const selected: Record<string, unknown> = {};
      for (const claim of JWT_DEBUG_CLAIMS) {
        if (claim in payload) {
          selected[claim] = payload[claim];
        }
      }
      selected["now"] = Math.floor(Date.now() / 1000);
      console.error(`[oauth-debug] payload=${JSON.stringify(selected)}`);
    } catch (decodeError) {
      console.error(
        `[oauth-debug] payload decode failed: ${
          decodeError instanceof Error
            ? decodeError.message
            : String(decodeError)
        }`
      );
    }
  } catch {
    // never throw from debug logging
  }
}
