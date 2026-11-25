// Internal byte and base64 helpers on WebCrypto, btoa and atob only (no Node
// built-ins), so the package runs on Node, Bun, Deno, workerd and browsers.

const encoder = new TextEncoder();

/** UTF-8 bytes of a string. @internal */
export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text);
}

/** Standard base64 with padding. @internal */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Unpadded base64url. @internal */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decodes standard base64 (padding required when `padded`); `undefined` when malformed. @internal */
export function fromBase64(text: string): Uint8Array | undefined {
  try {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
}

/** SHA-256 digest. @internal */
export async function sha256(
  bytes: Uint8Array<ArrayBuffer>
): Promise<Uint8Array> {
  return new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bytes)
  );
}

/** `count` bytes from the platform CSPRNG. @internal */
export function randomBytes(count: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(count);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Constant-time comparison of two strings of possibly different lengths. @internal */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = utf8(a);
  const bb = utf8(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}
