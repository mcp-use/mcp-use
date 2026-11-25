// R1 functional webhook receiver (PLAN.md §18.8.3). The same code runs locally
// (E2E_TARGET=local, in-memory store) and as `ev-e2e-recv` on Manufact.
//
// Routes (all but POST /b/:bucket and GET /healthz need `Authorization: Bearer <token>`):
//   GET    /healthz
//   POST   /b/:bucket          record {receivedAt, headers, rawBody, signatureValid}; answer per config
//   PUT    /b/:bucket/config   {statuses?: number[], delayMs?, secret?, verification?: "echo"|"reject"}
//   GET    /b/:bucket?after=n  records with seq > n
//   DELETE /b/:bucket
//
// TODO(events): signature checks and SEP verification answers move to
// `createWebhookHandler` from `@mcp-use/client/webhooks` (WP-29) once it exists;
// the hosted R1 keeps its store in Upstash with a 3-day TTL.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

/** Standard Webhooks v1 signature check over `${id}.${timestamp}.${body}`. */
export function verifySignature(secret, headers, rawBody) {
  const id = headers["webhook-id"];
  const ts = headers["webhook-timestamp"];
  const sig = headers["webhook-signature"];
  if (!secret || !id || !ts || !sig) return false;
  const key = secret.startsWith("whsec_")
    ? decodeKey(secret.slice(6))
    : Buffer.from(secret);
  const want = createHmac("sha256", key)
    .update(`${id}.${ts}.${rawBody}`)
    .digest();
  return String(sig)
    .split(" ")
    .some((part) => {
      const [version, value] = part.split(",");
      if (version !== "v1" || !value) return false;
      const got = Buffer.from(value, "base64");
      return got.length === want.length && timingSafeEqual(got, want);
    });
}

function decodeKey(rest) {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(rest) && rest.length % 4 === 0
    ? Buffer.from(rest, "base64")
    : Buffer.from(rest);
}

/**
 * Starts R1 on `port` (0 = ephemeral). Returns `{url, close}`.
 * Records are kept in memory and deduplicated counts are left to the caller.
 */
export async function startReceiver({
  port = 0,
  token = "",
  host = "127.0.0.1",
} = {}) {
  const buckets = new Map();
  const bucket = (name) => {
    if (!buckets.has(name))
      buckets.set(name, { config: {}, records: [], seq: 0, served: 0 });
    return buckets.get(name);
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://receiver");
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    if (url.pathname === "/healthz") return send(200, { ok: true });
    const m = url.pathname.match(/^\/b\/([A-Za-z0-9._-]+)(\/config)?$/);
    if (!m) return send(404, { error: "not_found" });
    const b = bucket(m[1]);
    if (req.method === "POST" && !m[2]) {
      const record = {
        seq: ++b.seq,
        receivedAt: Date.now(),
        headers: req.headers,
        rawBody,
        signatureValid: verifySignature(b.config.secret, req.headers, rawBody),
      };
      b.records.push(record);
      if (b.config.delayMs)
        await new Promise((r) => setTimeout(r, b.config.delayMs));
      const statuses = b.config.statuses ?? [];
      const status = b.served < statuses.length ? statuses[b.served] : 200;
      b.served++;
      if (b.config.verification === "reject")
        return send(403, { error: "rejected" });
      let parsed;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        parsed = undefined;
      }
      // Echo a verification challenge when one is present.
      if (parsed && typeof parsed.challenge === "string")
        return send(status, { challenge: parsed.challenge });
      return send(status, {});
    }
    if (token && req.headers.authorization !== `Bearer ${token}`)
      return send(401, { error: "unauthorized" });
    if (req.method === "PUT" && m[2]) {
      b.config = JSON.parse(rawBody || "{}");
      b.served = 0;
      return send(200, b.config);
    }
    if (req.method === "GET" && !m[2]) {
      const after = Number(url.searchParams.get("after") ?? 0);
      return send(200, { records: b.records.filter((r) => r.seq > after) });
    }
    if (req.method === "DELETE" && !m[2]) {
      buckets.delete(m[1]);
      return send(204);
    }
    return send(405, { error: "method_not_allowed" });
  });
  await new Promise((r) => server.listen(port, host, r));
  const address = server.address();
  return {
    url: `http://${host}:${address.port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await startReceiver({
    port: Number(process.env.PORT ?? 8787),
    token: process.env.E2E_RECEIVER_TOKEN ?? "",
    host: "0.0.0.0",
  });
  console.log(`R1 listening on ${r.url}`);
}
