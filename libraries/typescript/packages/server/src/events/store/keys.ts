/**
 * Layout-1 key codec (PLAN.md §12.2.2, Appendix B, D57). Every key is
 * `{prefix}ev:{<ns16>}:<family>…`; event names are percent-encoded, and
 * partitions, principals and URLs appear only hashed (D67 rule 6).
 *
 * @internal
 */

import { sha256, toBase64Url, utf8 } from "./keyring.js";

/**
 * `h(…)`: the first 22 characters of base64url(SHA-256(value)).
 *
 * @param value - The plaintext to hash (a principal, URL, partition value, …).
 * @returns The 22-character digest used in key segments.
 */
export async function hashSegment(value: string): Promise<string> {
  return toBase64Url(await sha256(utf8(value))).slice(0, 22);
}

/**
 * `<ns16>`: the first 16 characters of base64url(SHA-256(namespace)).
 *
 * @param namespace - The binding's namespace.
 * @returns The namespace hash used inside the `{…}` hash tag.
 */
export async function namespaceHash(namespace: string): Promise<string> {
  return toBase64Url(await sha256(utf8(namespace))).slice(0, 16);
}

/**
 * Percent-encodes an event name for a key segment (D57): `%`, `:`, `{`, `}`.
 *
 * @param name - The event name.
 * @returns The encoded segment.
 */
export function encodeName(name: string): string {
  return name
    .replace(/%/g, "%25")
    .replace(/:/g, "%3A")
    .replace(/\{/g, "%7B")
    .replace(/\}/g, "%7D");
}

/**
 * Reverses {@link encodeName}.
 *
 * @param segment - An encoded name segment (for example a `fanout-due` member).
 * @returns The event name.
 */
export function decodeName(segment: string): string {
  return segment
    .replace(/%7D/g, "}")
    .replace(/%7B/g, "{")
    .replace(/%3A/g, ":")
    .replace(/%25/g, "%");
}

/** Builds every layout-1 key of one namespace. */
export interface EventsKeys {
  /** `{prefix}ev:{<ns16>}:`; every key of the namespace starts with it. */
  readonly root: string;
  /** `<ns16>`. */
  readonly ns16: string;
  meta(): string;
  closed(): string;
  catalog(): string;
  catalogMissing(): string;
  lockSweep(): string;
  log(name: string): string;
  /** `ev:{ns}:emit:{n}:{h}`; `digest` is already `h(eventId ‖ JCS(to))`. */
  emitDedupe(name: string, digest: string): string;
  fanoutDue(): string;
  fanout(name: string): string;
  lockFanout(name: string): string;
  sub(id: string): string;
  status(id: string): string;
  op(id: string): string;
  byName(name: string): string;
  /** `ev:{ns}:by-name:{n}:p:{h(partition)}`. */
  byNamePartition(name: string, partition: string): Promise<string>;
  byNameUnpartitioned(name: string): string;
  /** `ev:{ns}:by-principal:{h(principal)}`. */
  byPrincipal(principal: string): Promise<string>;
  expiry(): string;
  inflight(id: string): string;
  tomb(id: string): string;
  /** `ev:{ns}:anon:{h(url)}`. */
  anonUrl(url: string): Promise<string>;
  anonCount(): string;
  /** `ev:{ns}:verified:{h}`; the caller passes the digest. */
  verified(digest: string): string;
  verifyFail(digest: string): string;
  rlVerifyPrincipal(
    principalDigest: string,
    host: string,
    minute: number
  ): string;
  rlVerifyHost(host: string, minute: number): string;
  inflightVerify(host: string): string;
  breaker(host: string): string;
  attempts(id: string): string;
  job(jobId: string): string;
  due(): string;
  dead(jobId: string): string;
  deadIndex(): string;
  lease(did: string): string;
  leaseExpiry(): string;
  leaseByName(name: string): string;
  wake(): string;
}

/** Inputs of {@link createEventsKeys}. */
export interface EventsKeysOptions {
  /** Opaque binding prefix; must not contain `{` or `}`. */
  prefix?: string;
  /** The namespace (hashed into `<ns16>`). */
  namespace: string;
}

/**
 * Creates the key codec of one namespace.
 *
 * @param o - Prefix and namespace.
 * @returns The key builder.
 * @throws TypeError when the prefix contains `{` or `}`.
 */
export async function createEventsKeys(
  o: EventsKeysOptions
): Promise<EventsKeys> {
  const prefix = o.prefix ?? "";
  if (/[{}]/.test(prefix)) {
    throw new TypeError("Events storage prefix must not contain { or }");
  }
  const ns16 = await namespaceHash(o.namespace);
  const root = `${prefix}ev:{${ns16}}:`;
  const k = (rest: string): string => root + rest;
  const n = encodeName;
  return {
    root,
    ns16,
    meta: () => k("meta"),
    closed: () => k("closed"),
    catalog: () => k("catalog"),
    catalogMissing: () => k("catalog:missing"),
    lockSweep: () => k("lock:sweep"),
    log: (name) => k(`log:${n(name)}`),
    emitDedupe: (name, digest) => k(`emit:${n(name)}:${digest}`),
    fanoutDue: () => k("fanout-due"),
    fanout: (name) => k(`fanout:${n(name)}`),
    lockFanout: (name) => k(`lock:fanout:${n(name)}`),
    sub: (id) => k(`sub:${id}`),
    status: (id) => k(`status:${id}`),
    op: (id) => k(`op:${id}`),
    byName: (name) => k(`by-name:${n(name)}`),
    byNamePartition: async (name, partition) =>
      k(`by-name:${n(name)}:p:${await hashSegment(partition)}`),
    byNameUnpartitioned: (name) => k(`by-name:${n(name)}:p:*`),
    byPrincipal: async (principal) =>
      k(`by-principal:${await hashSegment(principal)}`),
    expiry: () => k("expiry"),
    inflight: (id) => k(`inflight:${id}`),
    tomb: (id) => k(`tomb:${id}`),
    anonUrl: async (url) => k(`anon:${await hashSegment(url)}`),
    anonCount: () => k("anon:count"),
    verified: (digest) => k(`verified:${digest}`),
    verifyFail: (digest) => k(`verifyfail:${digest}`),
    rlVerifyPrincipal: (pd, host, minute) =>
      k(`rl:verify:${pd}:${host}:${minute}`),
    rlVerifyHost: (host, minute) => k(`rl:verify:${host}:${minute}`),
    inflightVerify: (host) => k(`inflight-verify:${host}`),
    breaker: (host) => k(`cb:${host}`),
    attempts: (id) => k(`attempts:${id}`),
    job: (jobId) => k(`job:${jobId}`),
    due: () => k("due"),
    dead: (jobId) => k(`dead:${jobId}`),
    deadIndex: () => k("dead"),
    lease: (did) => k(`lease:${did}`),
    leaseExpiry: () => k("lease-expiry"),
    leaseByName: (name) => k(`lease-by-name:${n(name)}`),
    wake: () => k("wake"),
  };
}
