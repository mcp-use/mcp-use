/**
 * Outbound webhooks for MCP Events: Standard Webhooks `v1` signing and an
 * SSRF-safe HTTPS sender (public addresses only, validated at connect time,
 * no redirects, 10 s timeout).
 *
 * @internal
 */

const encoder = new TextEncoder();

/** Largest event delivery body, in bytes (256 KiB). */
export const MAX_BODY_BYTES = 256 * 1024;

function fromBase64(value: string): Uint8Array | undefined {
  try {
    const bin = atob(value);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Decode a `whsec_` secret. Valid secrets decode to 24-64 bytes.
 *
 * @param secret - The `whsec_<base64>` secret.
 * @returns The key bytes, or `undefined` when the secret is invalid.
 */
export function parseWebhookSecret(secret: unknown): Uint8Array | undefined {
  if (typeof secret !== "string" || !secret.startsWith("whsec_")) return;
  const bytes = fromBase64(secret.slice(6));
  return bytes && bytes.length >= 24 && bytes.length <= 64 ? bytes : undefined;
}

/**
 * Compute a `webhook-signature` header value: one `v1,<base64>` entry per
 * secret, space-separated (two during a secret rotation).
 *
 * @param secrets - `whsec_` secrets, current first.
 * @param id - The `webhook-id`.
 * @param timestamp - The `webhook-timestamp`, Unix seconds.
 * @param body - The exact body sent.
 */
export async function signWebhook(
  secrets: readonly string[],
  id: string,
  timestamp: number,
  body: string
): Promise<string> {
  const content = encoder.encode(`${id}.${timestamp}.${body}`);
  const out: string[] = [];
  for (const secret of secrets) {
    const raw = parseWebhookSecret(secret);
    if (raw === undefined) continue;
    const key = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(raw),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, content);
    out.push(`v1,${toBase64(new Uint8Array(mac))}`);
  }
  return out.join(" ");
}

/** True for an IPv4/IPv6 literal that is not a public unicast address. */
function isPrivateAddress(address: string): boolean {
  const a = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) return isPrivateAddress(mapped[1]!);
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (v4) {
    const [x, y] = [Number(v4[1]), Number(v4[2])];
    return (
      x === 0 ||
      x === 10 ||
      x === 127 ||
      x >= 224 ||
      (x === 100 && y >= 64 && y <= 127) ||
      (x === 169 && y === 254) ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && (y === 168 || y === 0)) ||
      (x === 198 && (y === 18 || y === 19))
    );
  }
  if (!a.includes(":")) return false;
  return (
    a === "::" ||
    a === "::1" ||
    /^f[c-d]/.test(a) ||
    /^fe[89ab]/.test(a) ||
    a.startsWith("ff") ||
    a.startsWith("64:ff9b:") ||
    a.startsWith("2001:db8:")
  );
}

/** Outcome of one POST. `status` is 0 for a network failure. */
interface SendResult {
  status: number;
  body: string;
}

/** Options for {@link postWebhook}. */
interface PostOptions {
  /** Allow `http:` and private addresses (local development only). */
  allowInsecure: boolean;
  /** Custom transport; bypasses the address checks (tests, proxies). */
  fetch?: typeof fetch | undefined;
}

/**
 * POST a JSON body to a callback URL. On Node the connection dials only
 * addresses that passed the public-address check (no DNS rebinding); other
 * runtimes use `fetch` with redirects disabled and literal-address checks.
 *
 * @param url - The callback URL.
 * @param headers - Request headers.
 * @param body - The serialized body.
 * @param options - Insecure mode and custom fetch.
 */
export async function postWebhook(
  url: string,
  headers: Record<string, string>,
  body: string,
  options: PostOptions
): Promise<SendResult> {
  const target = new URL(url);
  const insecure = options.allowInsecure;
  if (
    target.protocol !== "https:" &&
    !(insecure && target.protocol === "http:")
  )
    throw new Error("callback URL must use https");
  if (!insecure && isPrivateAddress(target.hostname))
    throw new Error("callback URL resolves to a non-public address");
  const init = {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    redirect: "manual" as const,
    signal: AbortSignal.timeout(10_000),
  };
  try {
    if (options.fetch === undefined && !insecure && isNode()) {
      return await postNode(target, init.headers, body);
    }
    const res = await (options.fetch ?? fetch)(url, init);
    return { status: res.status, body: (await res.text()).slice(0, 4096) };
  } catch {
    return { status: 0, body: "" };
  }
}

function isNode(): boolean {
  return (
    typeof (globalThis as { process?: { versions?: { node?: string } } })
      .process?.versions?.node === "string"
  );
}

async function postNode(
  target: URL,
  headers: Record<string, string>,
  body: string
): Promise<SendResult> {
  const [https, dns] = await Promise.all([
    import("node:https"),
    import("node:dns"),
  ]);
  return await new Promise<SendResult>((resolve, reject) => {
    const req = https.request(
      target,
      {
        method: "POST",
        headers: { ...headers, "content-length": encoder.encode(body).length },
        timeout: 10_000,
        // Resolve, validate, then dial the validated address; TLS keeps the hostname.
        lookup: (host, opts, cb) => {
          dns.lookup(host, { all: true }, (err, addresses) => {
            if (err) return cb(err, "", 4);
            const bad = addresses.find((x) => isPrivateAddress(x.address));
            const first = addresses[0];
            if (bad !== undefined || first === undefined)
              return cb(new Error("non-public callback address"), "", 4);
            if ((opts as { all?: boolean }).all)
              return (cb as unknown as (e: null, a: unknown) => void)(
                null,
                addresses
              );
            cb(null, first.address, first.family);
          });
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (text.length < 4096) text += chunk;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: text })
        );
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}
