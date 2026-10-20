/**
 * Actor identity, computed exactly like the Manufact gateway
 * (`gateway.mcp-use/src/utils/mcp-classify.ts`) so a caller keeps the same
 * actor whether a request went through the gateway or was recorded here.
 * Changing anything below splits actors between the two sources.
 */

let nodeSubtle: Promise<SubtleCrypto | undefined> | undefined;

/**
 * Web Crypto's `subtle`. Node 18 exposes it only as `node:crypto`'s
 * `webcrypto` (the global arrived in Node 19); the specifier is held in a
 * variable so bundlers for edge runtimes do not try to resolve it.
 */
async function subtleCrypto(): Promise<SubtleCrypto> {
  const global = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto
    ?.subtle;
  if (global !== undefined) return global;
  nodeSubtle ??= (async () => {
    try {
      const specifier = "node:crypto";
      const mod = (await import(/* @vite-ignore */ specifier)) as {
        webcrypto?: { subtle?: SubtleCrypto };
      };
      return mod.webcrypto?.subtle;
    } catch {
      return undefined;
    }
  })();
  const fallback = await nodeSubtle;
  if (fallback === undefined) throw new Error("Web Crypto is unavailable");
  return fallback;
}

/** One-way SHA-256 hex of a string, via Web Crypto. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await (await subtleCrypto()).digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Decode a JWT payload without verifying the signature (identity correlation only). */
function jwtClaims(
  token: string,
  utf8 = false
): Record<string, unknown> | null {
  const seg = token.split(".");
  if (seg.length !== 3 || !seg[1]) return null;
  try {
    const b64 = seg[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
    const binary = atob(padded);
    // The gateway decodes identity claims as a binary string (not UTF-8) so
    // existing actor ids stay stable; display claims are decoded as UTF-8.
    const json = utf8
      ? new TextDecoder().decode(
          Uint8Array.from(binary, (c) => c.charCodeAt(0))
        )
      : binary;
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Stable identity hash for a Bearer token: `sha256(iss \0 sub)` when the
 * token is a JWT carrying both claims (one user stays one actor across
 * re-issued tokens), otherwise `sha256(token)`.
 */
export async function tokenIdentityHash(token: string): Promise<string> {
  const claims = jwtClaims(token);
  const iss = claims?.iss;
  const sub = claims?.sub;
  if (typeof iss === "string" && typeof sub === "string" && sub) {
    return sha256Hex(`${iss}\u0000${sub}`);
  }
  return sha256Hex(token);
}

/** A display claim without control characters, or undefined when empty or longer than `max`. */
export function displayClaim(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned && cleaned.length <= max ? cleaned : undefined;
}

/** Allowlisted display claims (`name`, `email`) from an unverified JWT. */
export function tokenDisplayMetadata(token: string): {
  name?: string;
  email?: string;
} {
  const claims = jwtClaims(token, true);
  const name = displayClaim(claims?.["name"], 256);
  const email = displayClaim(claims?.["email"], 320);
  return {
    ...(name !== undefined && { name }),
    ...(email !== undefined && { email }),
  };
}

/**
 * The end-user token worth hashing: a Bearer token from the Authorization
 * header, else the verified `authInfo.token`. Manufact API keys (`mcp_`) are
 * skipped like the gateway does: they identify the platform, not a user.
 */
export function bearerTokenOf(
  authorization: string | undefined,
  authInfoToken: unknown
): string | undefined {
  const fromHeader =
    authorization !== undefined && authorization.startsWith("Bearer ")
      ? authorization.substring(7)
      : undefined;
  const token =
    fromHeader ??
    (typeof authInfoToken === "string" && authInfoToken.length > 0
      ? authInfoToken
      : undefined);
  if (token === undefined || token.length === 0 || token.startsWith("mcp_")) {
    return undefined;
  }
  return token;
}
