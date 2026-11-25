/**
 * The `fetch` webhook sender for runtimes without the Node sender (workerd,
 * Deno Deploy, browsers): URL rules plus a DNS-over-HTTPS pre-check, no IP
 * pinning and no egress proxy (§8.15, D65).
 */

import { isIpLiteral } from "../../net/address.js";
import { checkHost, type HostResolver } from "../../net/resolver.js";
import {
  EventsSenderConfigError,
  SENDER_LIMITS,
  parseRetryAfter,
  type WebhookSendErrorCategory,
  type WebhookSender,
} from "./types.js";

/** Options for {@link fetchWebhookSender}. */
export interface FetchWebhookSenderOptions {
  /**
   * The resolved egress proxy setting. A proxy URL is a startup error
   * (`EVENTS_CONFIG_INVALID`, field `egressProxy`): this sender cannot use
   * one, and a user who needs static egress IPs must never silently send
   * from dynamic ones. `false` and `undefined` are accepted.
   */
  proxy?: string | false;
  /** @internal Test seam: the `fetch` used for deliveries and DoH. */
  fetch?: typeof globalThis.fetch;
  /** @internal Test seam: answers DNS instead of the DoH pre-check. */
  resolve?: HostResolver;
  /** @internal Test seam: total timeout in ms (default 10,000). */
  totalTimeoutMs?: number;
}

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";

/**
 * @internal A resolver over DNS-over-HTTPS JSON (A and AAAA), used as the
 * pre-check of the fetch sender.
 */
export function dohResolver(fetchImpl: typeof globalThis.fetch): HostResolver {
  const query = async (name: string, type: "A" | "AAAA") => {
    const response = await fetchImpl(
      `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}`,
      {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(SENDER_LIMITS.connectTimeoutMs),
      }
    );
    if (!response.ok) throw new Error(`DoH HTTP ${response.status}`);
    const json = (await response.json()) as {
      Answer?: { type?: number; data?: string }[];
    };
    const wanted = type === "A" ? 1 : 28;
    return (json.Answer ?? [])
      .filter((answer) => answer.type === wanted)
      .map((answer) => String(answer.data));
  };
  return async (hostname) => {
    const results = await Promise.allSettled([
      query(hostname, "A"),
      query(hostname, "AAAA"),
    ]);
    if (results.every((result) => result.status === "rejected")) {
      throw new Error("host does not resolve");
    }
    return results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : []
    );
  };
}

function urlProblem(url: URL): WebhookSendErrorCategory | undefined {
  if (url.protocol !== "https:") return "blocked_address";
  if (url.username !== "" || url.password !== "") return "blocked_address";
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIpLiteral(host)) return "blocked_address";
  if (
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return "blocked_address";
  }
  return undefined;
}

/**
 * Creates the `fetch` webhook sender (`info().sender` is `"fetch"`). It
 * accepts only `https:` URLs with a public-looking hostname (no IP
 * literals, single-label, `.local`, `.internal` or `localhost` hosts, no
 * credentials), pre-checks the host over DNS-over-HTTPS, sends with
 * `redirect: "manual"` (a redirect is reported as `redirect`), allows 10 s
 * in total and reads at most 4 KiB of body. It cannot pin the address, so
 * a DNS-rebinding window remains; prefer the Node sender where available.
 *
 * Trusted requests (dev trusted origins) skip the URL rules and the
 * pre-check.
 *
 * @param options - The resolved egress proxy setting.
 * @throws EventsSenderConfigError (`EVENTS_CONFIG_INVALID`, field
 * `egressProxy`) when a proxy URL is configured.
 */
export function fetchWebhookSender(
  options: FetchWebhookSenderOptions = {}
): WebhookSender {
  if (typeof options.proxy === "string") {
    throw new EventsSenderConfigError(
      "egressProxy",
      "egressProxy needs the Node.js or Bun webhook sender; this runtime only has the fetch sender, which cannot use a proxy"
    );
  }
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const resolve = options.resolve ?? dohResolver(fetchImpl);
  const totalTimeoutMs = options.totalTimeoutMs ?? SENDER_LIMITS.totalTimeoutMs;

  return async (request) => {
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(totalTimeoutMs),
    ]);
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return { error: "blocked_address" };
    }
    if (!request.trusted) {
      const problem = urlProblem(url);
      if (problem !== undefined) return { error: problem };
      const checked = await checkHost(url.hostname, resolve);
      if ("refused" in checked) {
        return {
          error:
            checked.refused === "blocked_address"
              ? "blocked_address"
              : "dns_failure",
        };
      }
    }
    let response: Response;
    try {
      response = await fetchImpl(url.href, {
        method: "POST",
        headers: { ...request.headers },
        body: request.body,
        redirect: "manual",
        signal,
      });
    } catch (error) {
      if (signal.aborted) return { error: "timeout" };
      const message = error instanceof Error ? String(error.cause ?? "") : "";
      return {
        error: /cert|tls|ssl/i.test(message)
          ? "tls_error"
          : "connection_refused",
      };
    }
    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    ) {
      await response.body?.cancel().catch(() => undefined);
      return { error: "redirect" };
    }
    let body = "";
    try {
      body = await readPrefix(response, SENDER_LIMITS.maxResponseBytes);
    } catch {
      if (signal.aborted) return { error: "timeout" };
    }
    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    return {
      status: response.status,
      body,
      ...(retryAfterMs !== undefined && { retryAfterMs }),
    };
  };
}

async function readPrefix(response: Response, limit: number): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const bytes = new Uint8Array(limit);
  let length = 0;
  while (length < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    const part = value.subarray(0, limit - length);
    bytes.set(part, length);
    length += part.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(bytes.subarray(0, length));
}
