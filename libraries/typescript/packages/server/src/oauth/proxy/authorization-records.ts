import type { OAuthProxyStoreTransaction } from "./store.js";

const MAX_RECORD_BYTES = 256 * 1024;
const MAX_STRING_BYTES = 128 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 20_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** JSON data that can safely cross the OAuth proxy persistence boundary. */
export type OAuthProxyJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly OAuthProxyJsonValue[]
  | OAuthProxyJsonObject;

/** Persistable object payload returned by an upstream identity verifier. */
export interface OAuthProxyJsonObject {
  readonly [key: string]: OAuthProxyJsonValue;
}

/** @internal Metadata retained for a dynamically registered downstream public client. */
export interface LocalClientMetadata {
  readonly redirectUris: readonly string[];
  readonly clientName?: string;
  readonly scope?: string;
}

/** @internal Stored downstream client registration. */
export interface LocalClientRecord {
  readonly kind: "client";
  readonly metadata: LocalClientMetadata;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** @internal Browser transaction displayed on the local consent page. */
export interface ConsentTransactionRecord {
  readonly kind: "consent";
  readonly clientId: string;
  readonly redirectUri: string;
  readonly resource: string;
  readonly scopes: readonly string[];
  readonly downstreamState: string;
  readonly codeChallenge: string;
  readonly csrfHash: string;
  readonly browserBindingHash: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** @internal Upstream callback transaction, including upstream-only PKCE secrets. */
export interface UpstreamCallbackRecord {
  readonly kind: "upstream-callback";
  readonly clientId: string;
  readonly redirectUri: string;
  readonly resource: string;
  readonly scopes: readonly string[];
  readonly downstreamState: string;
  readonly downstreamCodeChallenge: string;
  readonly browserBindingHash: string;
  readonly upstreamCodeVerifier: string;
  readonly upstreamRedirectUri: string;
  readonly upstreamNonce?: string;
  readonly upstreamResource?: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** @internal Provider token material. It is only safe in a protected store boundary. */
export interface StoredUpstreamTokenSet {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly accessTokenExpiresAt?: number;
  readonly refreshToken?: string;
  readonly scope?: string;
  readonly idToken?: string;
}

/** @internal Upstream token grant and persistable verified identity payload. */
export interface UpstreamGrantRecord {
  readonly kind: "upstream-grant";
  readonly tokens: StoredUpstreamTokenSet;
  readonly userPayload: OAuthProxyJsonObject;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** @internal One-time downstream authorization code binding. */
export interface AuthorizationCodeRecord {
  readonly kind: "authorization-code";
  readonly clientId: string;
  readonly redirectUri: string;
  readonly resource: string;
  readonly scopes: readonly string[];
  readonly codeChallenge: string;
  readonly grantRef: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** @internal Downstream access-token lookup record. */
export interface AccessTokenRecord {
  readonly kind: "access-token";
  readonly clientId: string;
  readonly resource: string;
  readonly scopes: readonly string[];
  readonly grantRef: string;
  readonly familyRef: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** @internal Mutable status of a rotating downstream refresh-token family. */
export interface RefreshFamilyRecord {
  readonly kind: "refresh-family";
  readonly clientId: string;
  readonly resource: string;
  readonly scopes: readonly string[];
  readonly grantRef: string;
  readonly status: "active" | "refreshing" | "revoked";
  readonly refreshAttemptHash?: string;
  readonly refreshAttemptExpiresAt?: number;
  readonly createdAt: number;
  readonly absoluteExpiresAt: number;
}

/** @internal One-time downstream refresh-token record. */
export interface RefreshTokenRecord {
  readonly kind: "refresh-token";
  readonly familyRef: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** @internal Immutable token-owner index retained through the family lifetime. */
export interface RefreshOwnerRecord {
  readonly kind: "refresh-owner";
  readonly familyRef: string;
  readonly expiresAt: number;
}

/** @internal One-time handle that binds upstream refresh completion to a family. */
export interface RefreshAttemptRecord {
  readonly kind: "refresh-attempt";
  readonly familyRef: string;
  readonly attemptHash: string;
  readonly expiresAt: number;
}

/** @internal Closed union of records stored by the embedded authorization server. */
export type OAuthProxyRecord =
  | LocalClientRecord
  | ConsentTransactionRecord
  | UpstreamCallbackRecord
  | UpstreamGrantRecord
  | AuthorizationCodeRecord
  | AccessTokenRecord
  | RefreshFamilyRecord
  | RefreshTokenRecord
  | RefreshOwnerRecord
  | RefreshAttemptRecord;

/** @internal Encodes a validated record as a bounded UTF-8 JSON payload. */
export function encodeOAuthProxyRecord(record: OAuthProxyRecord): Uint8Array {
  validateOAuthProxyRecord(record, record.kind);
  const payload = encoder.encode(JSON.stringify(record));
  if (payload.byteLength > MAX_RECORD_BYTES) {
    throw new TypeError("OAuth proxy record exceeds the maximum encoded size");
  }
  return payload;
}

/** @internal Decodes and strictly validates one expected OAuth proxy record kind. */
export function decodeOAuthProxyRecord<K extends OAuthProxyRecord["kind"]>(
  payload: Uint8Array,
  expectedKind: K
): Extract<OAuthProxyRecord, { kind: K }> {
  if (
    !(payload instanceof Uint8Array) ||
    payload.byteLength > MAX_RECORD_BYTES
  ) {
    throw new OAuthProxyRecordError();
  }
  try {
    const value: unknown = JSON.parse(decoder.decode(payload));
    validateOAuthProxyRecord(value, expectedKind);
    return value as Extract<OAuthProxyRecord, { kind: K }>;
  } catch (error) {
    if (error instanceof OAuthProxyRecordError) {
      throw error;
    }
    throw new OAuthProxyRecordError();
  }
}

/** @internal Reads and validates one live record inside a store transaction. */
export async function readOAuthProxyRecord<K extends OAuthProxyRecord["kind"]>(
  transaction: OAuthProxyStoreTransaction,
  key: string,
  kind: K
): Promise<Extract<OAuthProxyRecord, { kind: K }> | undefined> {
  const result = await transaction.read(key);
  return result.status === "found"
    ? decodeOAuthProxyRecord(result.payload, kind)
    : undefined;
}

/** @internal Secret-safe indication that persisted state is malformed. */
export class OAuthProxyRecordError extends Error {
  constructor() {
    super("OAuth proxy state is invalid");
    this.name = "OAuthProxyRecordError";
  }
}

function validateOAuthProxyRecord(
  value: unknown,
  expectedKind: OAuthProxyRecord["kind"]
): asserts value is OAuthProxyRecord {
  const record = requireRecord(value);
  if (record.kind !== expectedKind) {
    throw new OAuthProxyRecordError();
  }
  switch (expectedKind) {
    case "client":
      exactKeys(record, ["kind", "metadata", "createdAt", "expiresAt"]);
      validateClientMetadata(record.metadata);
      timestamp(record.createdAt);
      timestamp(record.expiresAt);
      return;
    case "consent":
      exactKeys(record, [
        "kind",
        "clientId",
        "redirectUri",
        "resource",
        "scopes",
        "downstreamState",
        "codeChallenge",
        "csrfHash",
        "browserBindingHash",
        "createdAt",
        "expiresAt",
      ]);
      strings(record, [
        "clientId",
        "redirectUri",
        "resource",
        "downstreamState",
        "codeChallenge",
        "csrfHash",
        "browserBindingHash",
      ]);
      stringArray(record.scopes);
      timestamp(record.createdAt);
      timestamp(record.expiresAt);
      return;
    case "upstream-callback":
      exactKeys(record, [
        "kind",
        "clientId",
        "redirectUri",
        "resource",
        "scopes",
        "downstreamState",
        "downstreamCodeChallenge",
        "browserBindingHash",
        "upstreamCodeVerifier",
        "upstreamRedirectUri",
        "upstreamNonce?",
        "upstreamResource?",
        "createdAt",
        "expiresAt",
      ]);
      strings(record, [
        "clientId",
        "redirectUri",
        "resource",
        "downstreamState",
        "downstreamCodeChallenge",
        "browserBindingHash",
        "upstreamCodeVerifier",
        "upstreamRedirectUri",
      ]);
      optionalString(record.upstreamNonce);
      optionalString(record.upstreamResource);
      stringArray(record.scopes);
      timestamp(record.createdAt);
      timestamp(record.expiresAt);
      return;
    case "upstream-grant":
      exactKeys(record, [
        "kind",
        "tokens",
        "userPayload",
        "createdAt",
        "expiresAt",
      ]);
      validateUpstreamTokens(record.tokens);
      assertOAuthProxyJsonObject(record.userPayload);
      timestamp(record.createdAt);
      timestamp(record.expiresAt);
      return;
    case "authorization-code":
      exactKeys(record, [
        "kind",
        "clientId",
        "redirectUri",
        "resource",
        "scopes",
        "codeChallenge",
        "grantRef",
        "createdAt",
        "expiresAt",
      ]);
      strings(record, [
        "clientId",
        "redirectUri",
        "resource",
        "codeChallenge",
        "grantRef",
      ]);
      stringArray(record.scopes);
      timestamp(record.createdAt);
      timestamp(record.expiresAt);
      return;
    case "access-token":
      exactKeys(record, [
        "kind",
        "clientId",
        "resource",
        "scopes",
        "grantRef",
        "familyRef",
        "createdAt",
        "expiresAt",
      ]);
      strings(record, ["clientId", "resource", "grantRef", "familyRef"]);
      stringArray(record.scopes);
      timestamp(record.createdAt);
      timestamp(record.expiresAt);
      return;
    case "refresh-family":
      exactKeys(record, [
        "kind",
        "clientId",
        "resource",
        "scopes",
        "grantRef",
        "status",
        "refreshAttemptHash?",
        "refreshAttemptExpiresAt?",
        "createdAt",
        "absoluteExpiresAt",
      ]);
      strings(record, ["clientId", "resource", "grantRef"]);
      stringArray(record.scopes);
      if (
        record.status !== "active" &&
        record.status !== "refreshing" &&
        record.status !== "revoked"
      ) {
        throw new OAuthProxyRecordError();
      }
      optionalString(record.refreshAttemptHash);
      optionalTimestamp(record.refreshAttemptExpiresAt);
      if (
        (record.status === "refreshing") !==
          (record.refreshAttemptHash !== undefined) ||
        (record.status === "refreshing") !==
          (record.refreshAttemptExpiresAt !== undefined)
      ) {
        throw new OAuthProxyRecordError();
      }
      timestamp(record.createdAt);
      timestamp(record.absoluteExpiresAt);
      return;
    case "refresh-token":
      exactKeys(record, ["kind", "familyRef", "createdAt", "expiresAt"]);
      strings(record, ["familyRef"]);
      timestamp(record.createdAt);
      timestamp(record.expiresAt);
      return;
    case "refresh-owner":
      exactKeys(record, ["kind", "familyRef", "expiresAt"]);
      strings(record, ["familyRef"]);
      timestamp(record.expiresAt);
      return;
    case "refresh-attempt":
      exactKeys(record, ["kind", "familyRef", "attemptHash", "expiresAt"]);
      strings(record, ["familyRef", "attemptHash"]);
      timestamp(record.expiresAt);
      return;
    default:
      throw new OAuthProxyRecordError();
  }
}

function validateClientMetadata(value: unknown): void {
  const metadata = requireRecord(value);
  exactKeys(metadata, ["redirectUris", "clientName?", "scope?"]);
  stringArray(metadata.redirectUris);
  if (metadata.redirectUris.length === 0) {
    throw new OAuthProxyRecordError();
  }
  optionalString(metadata.clientName);
  optionalString(metadata.scope);
}

function validateUpstreamTokens(value: unknown): void {
  const tokens = requireRecord(value);
  exactKeys(tokens, [
    "accessToken",
    "tokenType",
    "accessTokenExpiresAt?",
    "refreshToken?",
    "scope?",
    "idToken?",
  ]);
  strings(tokens, ["accessToken", "tokenType"]);
  optionalTimestamp(tokens.accessTokenExpiresAt);
  optionalString(tokens.refreshToken);
  optionalString(tokens.scope);
  optionalString(tokens.idToken);
}

/** @internal Validates and clones an arbitrary persistable provider payload. */
export function cloneOAuthProxyJsonObject(
  value: unknown
): OAuthProxyJsonObject {
  assertOAuthProxyJsonObject(value);
  return JSON.parse(JSON.stringify(value)) as OAuthProxyJsonObject;
}

function assertOAuthProxyJsonObject(
  value: unknown
): asserts value is OAuthProxyJsonObject {
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      throw new OAuthProxyRecordError();
    }
    if (
      candidate === null ||
      typeof candidate === "boolean" ||
      typeof candidate === "string"
    ) {
      if (
        typeof candidate === "string" &&
        encoder.encode(candidate).byteLength > MAX_STRING_BYTES
      ) {
        throw new OAuthProxyRecordError();
      }
      return;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) {
        throw new OAuthProxyRecordError();
      }
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    const object = requireRecord(candidate);
    for (const [key, item] of Object.entries(object)) {
      nonEmptyString(key);
      visit(item, depth + 1);
    }
  };
  const root = requireRecord(value);
  visit(root, 0);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new OAuthProxyRecordError();
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  expected: readonly string[]
): void {
  const required = new Set(expected.filter((key) => !key.endsWith("?")));
  const allowed = new Set(expected.map((key) => key.replace(/\?$/, "")));
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new OAuthProxyRecordError();
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) throw new OAuthProxyRecordError();
  }
}

function strings(
  record: Record<string, unknown>,
  keys: readonly string[]
): void {
  for (const key of keys) nonEmptyString(record[key]);
}

function nonEmptyString(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    encoder.encode(value).byteLength > MAX_STRING_BYTES
  ) {
    throw new OAuthProxyRecordError();
  }
}

function optionalString(value: unknown): void {
  if (value !== undefined) nonEmptyString(value);
}

function stringArray(value: unknown): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length > 256) {
    throw new OAuthProxyRecordError();
  }
  for (const item of value as readonly unknown[]) nonEmptyString(item);
}

function timestamp(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new OAuthProxyRecordError();
  }
}

function optionalTimestamp(value: unknown): void {
  if (value !== undefined) timestamp(value);
}
