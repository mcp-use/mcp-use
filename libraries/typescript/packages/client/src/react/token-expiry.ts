/**
 * Decode a Base64URL string into a UTF-8 string according to RFC 7515 §2 & RFC 7519 §3.
 *
 * Converts URL-safe characters ('-' to '+', '_' to '/') and restores required '='
 * padding for `atob()`, then decodes raw byte values as UTF-8 code points using `TextDecoder`.
 */
function decodeBase64UrlToUtf8(base64Url: string): string {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (base64.length % 4)) % 4;
  const padded = base64.padEnd(base64.length + padLength, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Resolve an OAuth token's absolute expiry. JWT `exp` is authoritative when
 * available; `expires_in` is only a fallback for opaque tokens.
 */
export function getOAuthTokenExpiry(tokens: {
  access_token?: string;
  expires_in?: unknown;
}): number | undefined {
  if (typeof tokens.access_token === "string") {
    const parts = tokens.access_token.split(".");
    if (parts.length === 3 && parts[1]) {
      try {
        const payloadJson = decodeBase64UrlToUtf8(parts[1]);
        const payload = JSON.parse(payloadJson);
        if (
          typeof payload === "object" &&
          payload !== null &&
          typeof payload.exp === "number" &&
          Number.isFinite(payload.exp) &&
          payload.exp > 0
        ) {
          return payload.exp * 1000;
        }
      } catch {
        // Fall through to expires_in if token is opaque, malformed, or non-JSON.
      }
    }
  }

  return typeof tokens.expires_in === "number"
    ? Date.now() + tokens.expires_in * 1000
    : undefined;
}
