/**
 * Resolve an OAuth token's absolute expiry. JWT `exp` is authoritative when
 * available; `expires_in` is only a fallback for opaque tokens.
 */
export function getOAuthTokenExpiry(tokens: {
  access_token?: string;
  expires_in?: unknown;
}): number | undefined {
  try {
    // JWTs are Base64URL; atob only accepts the standard Base64 alphabet.
    const segment = (tokens.access_token?.split(".")[1] ?? "")
      .replaceAll("-", "+")
      .replaceAll("_", "/");
    const payload = JSON.parse(atob(segment));
    if (typeof payload.exp === "number") return payload.exp * 1000;
  } catch {
    // Opaque tokens do not contain a JWT expiry claim.
  }
  return typeof tokens.expires_in === "number"
    ? Date.now() + tokens.expires_in * 1000
    : undefined;
}
