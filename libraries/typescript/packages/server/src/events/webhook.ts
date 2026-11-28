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

/** Parse a dotted-quad IPv4 address into its four octets. */
function parseIPv4(a: string): number[] | undefined {
  const parts = a.split(".");
  if (parts.length !== 4) return;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return;
    out.push(Number(p));
  }
  return out;
}

/**
 * Parse an IPv6 address (any textual form: compressed, embedded dotted
 * IPv4, zone id) into eight 16-bit groups.
 */
function parseIPv6(input: string): number[] | undefined {
  let a = input;
  const zone = a.indexOf("%");
  if (zone !== -1) a = a.slice(0, zone);
  // A trailing dotted IPv4 is the last two groups; rewrite it as hex.
  const lastColon = a.lastIndexOf(":");
  if (lastColon !== -1 && a.slice(lastColon + 1).includes(".")) {
    const v4 = parseIPv4(a.slice(lastColon + 1));
    if (v4 === undefined) return;
    const hex = (hi: number, lo: number) => ((hi << 8) | lo).toString(16);
    a = `${a.slice(0, lastColon + 1)}${hex(v4[0]!, v4[1]!)}:${hex(v4[2]!, v4[3]!)}`;
  }
  const halves = a.split("::");
  if (halves.length > 2) return;
  const group = (h: string): number[] | undefined => {
    if (h === "") return [];
    const out: number[] = [];
    for (const g of h.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = group(halves[0]!);
  const rest = halves.length === 2 ? group(halves[1]!) : [];
  if (head === undefined || rest === undefined) return;
  let groups = head;
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  }
  return groups.length === 8 ? groups : undefined;
}

function isPrivateIPv4([x, y]: number[]): boolean {
  return (
    x === 0 ||
    x === 10 ||
    x === 127 ||
    x! >= 224 ||
    (x === 100 && y! >= 64 && y! <= 127) ||
    (x === 169 && y === 254) ||
    (x === 172 && y! >= 16 && y! <= 31) ||
    (x === 192 && (y === 168 || y === 0)) ||
    (x === 198 && (y === 18 || y === 19))
  );
}

/** The IPv4 address in the low 32 bits of IPv6 groups 6-7. */
function low32(g: number[]): number[] {
  return [g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255];
}

/**
 * True for an IPv4/IPv6 literal that is not a public unicast address.
 * IPv6 addresses that embed an IPv4 address (mapped, compatible, translated,
 * NAT64, 6to4) are judged by that IPv4 address. Unparseable IPv6 is private.
 *
 * @internal Exported for tests.
 */
export function isPrivateAddress(address: string): boolean {
  const a = address.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = parseIPv4(a);
  if (v4) return isPrivateIPv4(v4);
  if (!a.includes(":")) return false;
  const g = parseIPv6(a);
  if (g === undefined) return true;
  const zero = (from: number, to: number) =>
    g.slice(from, to).every((x) => x === 0);
  if (zero(0, 6)) return true; // ::, ::1, IPv4-compatible ::a.b.c.d
  if (zero(0, 5) && g[5] === 0xffff) return isPrivateIPv4(low32(g)); // ::ffff:a.b.c.d
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0)
    return isPrivateIPv4(low32(g)); // ::ffff:0:a.b.c.d (SIIT)
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (zero(2, 6)) return isPrivateIPv4(low32(g)); // 64:ff9b::/96 NAT64
    return true; // 64:ff9b:1::/48 local-use NAT64
  }
  if (g[0] === 0x2002)
    return isPrivateIPv4([g[1]! >> 8, g[1]! & 255, g[2]! >> 8, g[2]! & 255]); // 6to4
  return (
    (g[0]! & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (g[0]! & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (g[0]! & 0xffc0) === 0xfec0 || // fec0::/10 site-local
    (g[0]! & 0xff00) === 0xff00 || // ff00::/8 multicast
    (g[0] === 0x2001 && g[1] === 0) || // 2001::/32 Teredo
    (g[0] === 0x2001 && g[1] === 0xdb8) || // documentation
    (g[0] === 0x100 && zero(1, 4)) // 100::/64 discard
  );
}

/** Outcome of one POST. `status` is 0 for a network failure. */
interface SendResult {
  status: number;
  body: string;
  /** Network failure message when `status` is 0. */
  error?: string;
}

/** Options for {@link postWebhook}. */
interface PostOptions {
  /** Allow `http:` and private addresses (local development only). */
  allowInsecure: boolean;
  /**
   * Custom transport (tests, proxies). Skips the resolved-address check;
   * literal IP hosts are still rejected.
   */
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
    return { status: res.status, body: await readCapped(res, 4096) };
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return {
      status: 0,
      body: "",
      error: String(
        e?.code ?? e?.cause?.code ?? (err as Error)?.message ?? err
      ).slice(0, 120),
    };
  }
}

/** Read at most `max` characters of a response body, then cancel it. */
async function readCapped(res: Response, max: number): Promise<string> {
  if (res.body === null) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < max) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return text.slice(0, max);
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
        // Caps the whole exchange; `timeout` alone only catches idle sockets.
        signal: AbortSignal.timeout(10_000),
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
        // A body cut off mid-stream emits "error" or only "close"; settle
        // either way (a no-op after "end" resolved).
        res.on("error", reject);
        res.on("close", () => reject(new Error("response closed early")));
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}
