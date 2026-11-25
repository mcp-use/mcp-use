/**
 * Namespace resolution and the `{<ns16>}` hash tag (PLAN.md §8.5, D24).
 * Resolution never throws; the last fallback is `serverInfo.name` with a
 * startup warning.
 *
 * @internal
 */

/** Where a resolved namespace came from. */
export type NamespaceSource =
  | "config"
  | "MCP_USE_EVENTS_NAMESPACE"
  | "dev-workspace"
  | "oauth-resource"
  | "MCP_URL"
  | "server-name"
  | "MCP_USE_PLATFORM_NAMESPACE";

/** A resolved namespace. */
export interface ResolvedNamespace {
  namespace: string;
  source: NamespaceSource;
  /** Set when the fallback was used. */
  warning?: string;
}

/** Inputs of the user-binding namespace chain. */
export interface UserNamespaceInput {
  /** `events.namespace`. */
  config?: string | undefined;
  /** `MCP_USE_EVENTS_NAMESPACE`. */
  env?: string | undefined;
  /** CLI dev workspace id. */
  devWorkspace?: string | undefined;
  /** OAuth protected-resource URL. */
  oauthResource?: string | undefined;
  /** `MCP_URL` (or the `MCP_USE_PLATFORM_PUBLIC_URL` default). */
  mcpUrl?: string | undefined;
  /** MCP base path, appended to the `MCP_URL` origin. */
  basePath?: string | undefined;
  /** `serverInfo.name`. */
  serverName: string;
}

function nonEmpty(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function originPlusBase(url: string, basePath: string | undefined): string {
  try {
    const u = new URL(url);
    const base = (basePath ?? "").replace(/\/+$/, "");
    return `${u.origin}${base}`;
  } catch {
    return url;
  }
}

/**
 * The user-binding namespace chain: `events.namespace` →
 * `MCP_USE_EVENTS_NAMESPACE` → dev workspace → OAuth resource or `MCP_URL`
 * (origin + basePath) → `serverInfo.name` with a warning.
 *
 * @param input - Candidate values in precedence order.
 */
export function resolveUserNamespace(
  input: UserNamespaceInput
): ResolvedNamespace {
  const c = nonEmpty(input.config);
  if (c !== undefined) return { namespace: c, source: "config" };
  const e = nonEmpty(input.env);
  if (e !== undefined)
    return { namespace: e, source: "MCP_USE_EVENTS_NAMESPACE" };
  const d = nonEmpty(input.devWorkspace);
  if (d !== undefined) return { namespace: d, source: "dev-workspace" };
  const r = nonEmpty(input.oauthResource);
  if (r !== undefined)
    return {
      namespace: originPlusBase(r, input.basePath),
      source: "oauth-resource",
    };
  const m = nonEmpty(input.mcpUrl);
  if (m !== undefined)
    return { namespace: originPlusBase(m, input.basePath), source: "MCP_URL" };
  return {
    namespace: input.serverName,
    source: "server-name",
    warning: `events: no namespace configured; using serverInfo.name "${input.serverName}". Set events.namespace or MCP_USE_EVENTS_NAMESPACE so environments sharing a store stay apart.`,
  };
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The 16-character namespace hash: base64url(SHA-256(namespace)), first 16
 * characters. Used as the key hash tag and as `nsHash` in health.
 *
 * @param namespace - The namespace string.
 */
export async function ns16(namespace: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(namespace)
  );
  return base64url(new Uint8Array(digest)).slice(0, 16);
}

/**
 * A layout-1 key for a namespace hash: `ev:{<ns16>}:<suffix>`. The storage
 * prefix is applied by the storage itself.
 *
 * @param hash - The {@link ns16} value.
 * @param suffix - Family suffix, for example `"due"` or `"sub:abc"`.
 */
export function nsKey(hash: string, suffix: string): string {
  return `ev:{${hash}}:${suffix}`;
}
