/** @internal Narrows unknown values to plain object records. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @internal Checks if a URL points to localhost or a loopback address. */
export function isLocalhost(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

/** @internal Parses and validates an absolute URL without credentials. */
export function parseAbsoluteUrl(value: string | URL, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (url.origin === "null" || url.username !== "" || url.password !== "") {
    throw new Error(`${name} must be an absolute URL without credentials`);
  }
  return url;
}

/** @internal Validates that a URL uses HTTPS, or HTTP for localhost. */
export function assertSecureHttpUrl(url: URL, name: string): void {
  if (url.protocol === "https:") {
    return;
  }
  if (url.protocol === "http:" && isLocalhost(url)) {
    return;
  }
  throw new Error(`${name} must use HTTPS, or HTTP for localhost`);
}
