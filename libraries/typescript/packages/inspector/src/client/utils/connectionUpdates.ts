import { inspectorApi } from "@/client/utils/basePath";
import {
  isLocalhostServerUrl,
  isMcpUseTunnelUrl,
} from "@/client/utils/servers";
import {
  LocalStorageProvider,
  type McpServer,
  type McpServerConfig,
  type PersistedMcpServerConfig,
  toPersistedServerConfig,
} from "@mcp-use/client/react";

export interface OAuthStaticConfig {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
}

export type ConnectionMode = "auto" | "direct" | "proxy";

export const MODERN_MCP_PROTOCOL_VERSION = "2026-07-28";

export type InspectorProtocolMode = "auto" | "v1" | "v2";

type ProtocolNegotiation = NonNullable<McpServerConfig["protocolNegotiation"]>;

export function protocolNegotiationForMode(
  mode: InspectorProtocolMode
): ProtocolNegotiation {
  switch (mode) {
    case "v1":
      return "legacy";
    case "v2":
      return { pin: MODERN_MCP_PROTOCOL_VERSION };
    default:
      return "auto";
  }
}

export function protocolModeFromNegotiation(
  negotiation?: McpServerConfig["protocolNegotiation"]
): InspectorProtocolMode {
  if (negotiation === "legacy") return "v1";
  if (typeof negotiation === "object" && negotiation?.pin) return "v2";
  return "auto";
}

type InspectorWindow = Window & { __MCP_PROXY_URL__?: string | null };

export function getDefaultInspectorProxyAddress(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const injectedProxyPath = (window as InspectorWindow).__MCP_PROXY_URL__;
  if (injectedProxyPath === null) {
    return "";
  }

  return `${window.location.origin}${injectedProxyPath || inspectorApi("proxy")}`;
}

export function normalizeConnectionMode(
  mode?: string,
  legacyConnectionType?: string,
  hasProxyAddress = false
): ConnectionMode {
  if (mode === "auto" || mode === "direct" || mode === "proxy") {
    return mode;
  }
  if (legacyConnectionType === "Via Proxy") {
    return "proxy";
  }
  if (legacyConnectionType === "Direct") {
    return "auto";
  }
  return hasProxyAddress ? "proxy" : "auto";
}

export type AutoProxyFallbackConfig =
  | boolean
  | {
      enabled?: boolean;
      proxyAddress?: string;
    };

function getAutoProxyFallbackAddress(
  autoProxyFallback?: AutoProxyFallbackConfig
): string {
  if (!autoProxyFallback || typeof autoProxyFallback === "boolean") {
    return "";
  }

  return autoProxyFallback.proxyAddress?.trim() || "";
}

interface ConnectionLike {
  url?: string;
  name?: string;
  transportType?: "http" | "sse";
  connectionMode?: ConnectionMode;
  connectionType?: "Direct" | "Via Proxy";
  proxyConfig?: {
    proxyAddress?: string;
    headers?: Record<string, string>;
    customHeaders?: Record<string, string>;
  };
  headers?: Record<string, string>;
  customHeaders?: Record<string, string>;
  oauth?: OAuthStaticConfig;
  autoProxyFallback?: AutoProxyFallbackConfig;
  protocolNegotiation?: McpServerConfig["protocolNegotiation"];
}

export interface EditableConnectionConfig {
  url: string;
  name?: string;
  transportType: "http" | "sse";
  connectionMode?: ConnectionMode;
  connectionType?: "Direct" | "Via Proxy";
  proxyConfig?: {
    proxyAddress?: string;
    headers?: Record<string, string>;
    customHeaders?: Record<string, string>;
  };
  headers?: Record<string, string>;
  customHeaders?: Record<string, string>;
  oauth?: OAuthStaticConfig;
  autoProxyFallback?: AutoProxyFallbackConfig;
  protocolNegotiation?: McpServerConfig["protocolNegotiation"];
  /** Inspector UI: default tool-call request timeout (ms). */
  requestTimeout?: number;
  resetTimeoutOnProgress?: boolean;
  maxTotalTimeout?: number;
}

const INSPECTOR_CONNECTION_EXTRA_KEYS = [
  "requestTimeout",
  "resetTimeoutOnProgress",
  "maxTotalTimeout",
] as const;

const INSPECTOR_CONNECTION_STORAGE_KEY = "mcp-inspector-connections";
const INSPECTOR_CONNECTION_STORAGE_VERSION = "3";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type PersistedInspectorConnectionConfig = PersistedMcpServerConfig &
  Pick<
    EditableConnectionConfig,
    "requestTimeout" | "resetTimeoutOnProgress" | "maxTotalTimeout"
  >;

function sanitizePersistedInspectorConfig(
  stored: Record<string, unknown>
): PersistedInspectorConnectionConfig {
  const normalized = normalizeStoredServerConfig(stored);
  return {
    ...toPersistedServerConfig(normalized),
    ...pickInspectorConnectionExtras(stored),
  };
}

function pickInspectorConnectionExtras(
  stored: Record<string, unknown> | null | undefined
): Pick<
  EditableConnectionConfig,
  "requestTimeout" | "resetTimeoutOnProgress" | "maxTotalTimeout"
> {
  if (!stored) return {};
  const out: Pick<
    EditableConnectionConfig,
    "requestTimeout" | "resetTimeoutOnProgress" | "maxTotalTimeout"
  > = {};
  for (const key of INSPECTOR_CONNECTION_EXTRA_KEYS) {
    const value = stored[key];
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/** Persist inspector-only connection fields alongside provider storage. */
export function saveStoredConnectionConfig(
  id: string,
  config: EditableConnectionConfig
): void {
  try {
    const stored = localStorage.getItem(INSPECTOR_CONNECTION_STORAGE_KEY);
    const allServers = stored
      ? (JSON.parse(stored) as Record<string, EditableConnectionConfig>)
      : {};
    const merged = {
      ...allServers[id],
      ...config,
    };
    const sanitizedServers = Object.fromEntries(
      Object.entries({ ...allServers, [id]: merged }).flatMap(
        ([serverId, value]) =>
          isRecord(value)
            ? [[serverId, sanitizePersistedInspectorConfig(value)]]
            : []
      )
    );
    localStorage.setItem(
      INSPECTOR_CONNECTION_STORAGE_KEY,
      JSON.stringify(sanitizedServers)
    );
  } catch {
    // ignore storage errors
  }
}

/**
 * Build an OAuth static-client config from raw form inputs, trimming whitespace
 * and dropping empty fields. clientSecret is only kept when clientId is also set
 * — a secret without a client_id has no meaning. Returns `undefined` when
 * neither a client_id nor a scope is provided.
 */
export function buildOAuthStaticConfig(
  clientId: string,
  clientSecret: string,
  scope: string
): OAuthStaticConfig | undefined {
  const trimmedClientId = clientId.trim();
  const trimmedClientSecret = clientSecret.trim();
  const trimmedScope = scope.trim();
  if (!trimmedClientId && !trimmedScope) return undefined;
  return {
    ...(trimmedClientId ? { clientId: trimmedClientId } : {}),
    ...(trimmedClientId && trimmedClientSecret
      ? { clientSecret: trimmedClientSecret }
      : {}),
    ...(trimmedScope ? { scope: trimmedScope } : {}),
  };
}

export function getServerHeaders(
  server: Pick<McpServer, "headers" | "proxyConfig">
): Record<string, string> | undefined {
  const headers =
    server.headers ||
    server.proxyConfig?.headers ||
    server.proxyConfig?.customHeaders;

  return headers && Object.keys(headers).length > 0 ? headers : undefined;
}

/** Map legacy stored fields to public `McpServerConfig` field names. */
function normalizeStoredServerConfig(
  stored: Record<string, unknown>
): McpServerConfig {
  const proxyConfig = stored.proxyConfig as
    | {
        proxyAddress?: string;
        headers?: Record<string, string>;
        customHeaders?: Record<string, string>;
      }
    | undefined;

  const legacyHeaders =
    (stored.headers as Record<string, string> | undefined) ||
    (stored.customHeaders as Record<string, string> | undefined);

  const proxyHeaders =
    proxyConfig?.headers || proxyConfig?.customHeaders || undefined;

  const headers = legacyHeaders || proxyHeaders;
  const normalizedProxyConfig = proxyConfig
    ? {
        ...proxyConfig,
        ...(proxyConfig.proxyAddress
          ? {
              proxyAddress: rebaseStoredInspectorProxyUrl(
                proxyConfig.proxyAddress
              ),
            }
          : {}),
        ...(proxyHeaders ? { headers: proxyHeaders } : {}),
        customHeaders: undefined,
      }
    : undefined;

  const autoProxyFallback = stored.autoProxyFallback;
  const normalizedAutoProxyFallback =
    isRecord(autoProxyFallback) &&
    typeof autoProxyFallback.proxyAddress === "string"
      ? {
          ...autoProxyFallback,
          proxyAddress: rebaseStoredInspectorProxyUrl(
            autoProxyFallback.proxyAddress
          ),
        }
      : autoProxyFallback;

  const {
    customHeaders: _customHeaders,
    connectionType: _connectionType,
    transportType: _transportType,
    // These are shell/runtime concerns. Persisting them makes an embedded
    // `/mcp/inspector` connection poison the standalone `/inspector` mode on
    // the same hostname.
    callbackUrl: _callbackUrl,
    oauthProxyUrl: _oauthProxyUrl,
    connectionUrl: _connectionUrl,
    storageKeyPrefix: _storageKeyPrefix,
    autoProxyFallback: _autoProxyFallback,
    ...rest
  } = stored;

  return {
    ...(rest as McpServerConfig),
    ...(headers && !normalizedProxyConfig?.proxyAddress ? { headers } : {}),
    ...(normalizedProxyConfig ? { proxyConfig: normalizedProxyConfig } : {}),
    ...(normalizedAutoProxyFallback !== undefined
      ? {
          autoProxyFallback:
            normalizedAutoProxyFallback as McpServerConfig["autoProxyFallback"],
        }
      : {}),
    connectionMode: normalizeConnectionMode(
      stored.connectionMode as string | undefined,
      stored.connectionType as string | undefined,
      !!normalizedProxyConfig?.proxyAddress
    ),
  };
}

function rebaseStoredInspectorProxyUrl(value: string): string {
  if (typeof window === "undefined") return value;
  try {
    const parsed = new URL(value, window.location.origin);
    if (
      parsed.origin === window.location.origin &&
      /\/inspector\/api\/proxy\/?$/.test(parsed.pathname)
    ) {
      return getDefaultInspectorProxyAddress();
    }
  } catch {
    // Preserve malformed values for the normal connection validation path.
  }
  return value;
}

export function toMcpServerConfig(
  config: EditableConnectionConfig
): McpServerConfig {
  const headers = getComparableHeaders(config);
  const proxyAddress =
    config.proxyConfig?.proxyAddress?.trim() ||
    getAutoProxyFallbackAddress(config.autoProxyFallback);
  const connectionMode = normalizeConnectionMode(
    config.connectionMode,
    config.connectionType,
    !!proxyAddress
  );

  const serverConfig: McpServerConfig = {
    url: config.url,
    displayName: config.name?.trim() || config.url,
    connectionMode,
    protocolNegotiation: config.protocolNegotiation ?? "auto",
    // These explicit resets matter when McpClientProvider shallow-merges an
    // edit into an existing connection. Omitting them would preserve a proxy
    // or fallback setting from the previous mode.
    proxyConfig: undefined,
    headers: undefined,
    autoProxyFallback: false,
    ...(config.oauth ? { oauth: config.oauth } : {}),
  };

  if (connectionMode === "proxy" && proxyAddress) {
    serverConfig.proxyConfig = {
      proxyAddress,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
  } else if (Object.keys(headers).length > 0) {
    serverConfig.headers = headers;
  }

  if (connectionMode === "auto") {
    serverConfig.autoProxyFallback =
      config.autoProxyFallback ??
      (proxyAddress ? { enabled: true, proxyAddress } : false);
  }

  return serverConfig;
}

export function toEditableConnectionConfig(
  server: McpServer,
  stored?: EditableConnectionConfig | null
): EditableConnectionConfig {
  const config = stored
    ? normalizeStoredServerConfig(stored as unknown as Record<string, unknown>)
    : server;
  const headers = getServerHeaders(server) || {};
  const proxyAddress =
    config.proxyConfig?.proxyAddress?.trim() ||
    getAutoProxyFallbackAddress(config.autoProxyFallback);

  return {
    url: server.url || "",
    name: server.displayName || server.url || "",
    transportType: "http",
    connectionMode: normalizeConnectionMode(
      config.connectionMode,
      undefined,
      !!proxyAddress
    ),
    connectionType: config.connectionMode === "proxy" ? "Via Proxy" : "Direct",
    proxyConfig:
      config.connectionMode === "proxy" && proxyAddress
        ? {
            proxyAddress,
            ...(Object.keys(headers).length > 0 ? { headers } : {}),
          }
        : undefined,
    headers,
    oauth: config.oauth,
    autoProxyFallback: config.autoProxyFallback,
    protocolNegotiation: config.protocolNegotiation ?? "auto",
    ...pickInspectorConnectionExtras(
      stored as unknown as Record<string, unknown> | null | undefined
    ),
  };
}

export function getStoredConnectionConfig<T>(id: string): T | null {
  try {
    const stored = localStorage.getItem("mcp-inspector-connections");
    if (!stored) {
      return null;
    }

    const allServers = JSON.parse(stored) as Record<string, T>;
    return allServers[id] || null;
  } catch {
    return null;
  }
}

function getComparableHeaders(
  connection: ConnectionLike | EditableConnectionConfig
): Record<string, string> {
  const headers =
    connection.proxyConfig?.headers ||
    connection.proxyConfig?.customHeaders ||
    connection.headers ||
    connection.customHeaders ||
    {};

  return Object.fromEntries(
    Object.entries(headers)
      .filter(([name, value]) => name && value)
      .map(([name, value]) => [name, String(value)])
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function normalizeConnection(
  connection: ConnectionLike | EditableConnectionConfig
): {
  url: string;
  name: string;
  transportType: "http" | "sse";
  proxyAddress: string;
  connectionMode: ConnectionMode;
  headers: Record<string, string>;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScope: string;
  requestTimeout: number | undefined;
  resetTimeoutOnProgress: boolean | undefined;
  maxTotalTimeout: number | undefined;
  protocolMode: InspectorProtocolMode;
} {
  const normalizedUrl = connection.url?.trim() || "";
  const proxyAddress =
    connection.proxyConfig?.proxyAddress?.trim() ||
    getAutoProxyFallbackAddress(connection.autoProxyFallback);

  return {
    url: normalizedUrl,
    name: connection.name?.trim() || normalizedUrl,
    transportType: connection.transportType || "http",
    proxyAddress,
    connectionMode: normalizeConnectionMode(
      connection.connectionMode,
      connection.connectionType,
      !!proxyAddress
    ),
    headers: getComparableHeaders(connection),
    oauthClientId: connection.oauth?.clientId?.trim() || "",
    oauthClientSecret: connection.oauth?.clientSecret?.trim() || "",
    oauthScope: connection.oauth?.scope?.trim() || "",
    requestTimeout:
      "requestTimeout" in connection ? connection.requestTimeout : undefined,
    resetTimeoutOnProgress:
      "resetTimeoutOnProgress" in connection
        ? connection.resetTimeoutOnProgress
        : undefined,
    maxTotalTimeout:
      "maxTotalTimeout" in connection ? connection.maxTotalTimeout : undefined,
    protocolMode: protocolModeFromNegotiation(connection.protocolNegotiation),
  };
}

export function isAliasOnlyConnectionUpdate(
  current: ConnectionLike,
  next: EditableConnectionConfig
): boolean {
  const currentConnection = normalizeConnection(current);
  const nextConnection = normalizeConnection(next);

  return (
    currentConnection.url === nextConnection.url &&
    currentConnection.transportType === nextConnection.transportType &&
    currentConnection.proxyAddress === nextConnection.proxyAddress &&
    currentConnection.connectionMode === nextConnection.connectionMode &&
    JSON.stringify(currentConnection.headers) ===
      JSON.stringify(nextConnection.headers) &&
    currentConnection.oauthClientId === nextConnection.oauthClientId &&
    currentConnection.oauthClientSecret === nextConnection.oauthClientSecret &&
    currentConnection.oauthScope === nextConnection.oauthScope &&
    currentConnection.requestTimeout === nextConnection.requestTimeout &&
    currentConnection.resetTimeoutOnProgress ===
      nextConnection.resetTimeoutOnProgress &&
    currentConnection.maxTotalTimeout === nextConnection.maxTotalTimeout &&
    currentConnection.protocolMode === nextConnection.protocolMode &&
    currentConnection.name !== nextConnection.name
  );
}

/** Keeps inspector-only persisted fields when the client provider rewrites storage. */
export class InspectorConnectionStorageProvider extends LocalStorageProvider {
  private readonly inspectorStorageVersionKey: string;

  constructor(
    private readonly inspectorStorageKey: string = INSPECTOR_CONNECTION_STORAGE_KEY
  ) {
    super(inspectorStorageKey);
    this.inspectorStorageVersionKey = `${inspectorStorageKey}-version`;
  }

  getServers(): Record<string, PersistedInspectorConnectionConfig> {
    const raw = this.readRawStoredServers();
    const migrated: Record<string, PersistedInspectorConnectionConfig> = {};
    let recoveredEntries = 0;

    for (const [id, value] of Object.entries(raw)) {
      if (!isRecord(value)) {
        recoveredEntries++;
        continue;
      }

      const normalized = sanitizePersistedInspectorConfig(value);
      const url =
        typeof normalized.url === "string" ? normalized.url.trim() : id.trim();
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          recoveredEntries++;
          continue;
        }
      } catch {
        recoveredEntries++;
        continue;
      }

      migrated[id] = { ...normalized, url };
      if (JSON.stringify(value) !== JSON.stringify(migrated[id])) {
        recoveredEntries++;
      }
    }

    if (
      recoveredEntries > 0 ||
      this.readStorageVersion() !== INSPECTOR_CONNECTION_STORAGE_VERSION
    ) {
      this.writeRecoveredStorage(migrated);
      if (recoveredEntries > 0) {
        console.info(
          `[Inspector] Recovered ${recoveredEntries} stale connection storage entr${recoveredEntries === 1 ? "y" : "ies"}.`
        );
      }
    }

    return migrated;
  }

  setServers(servers: Record<string, PersistedMcpServerConfig>): void {
    const prev = this.readRawStoredServers();
    const merged = Object.fromEntries(
      Object.entries(servers).map(([id, config]) => [
        id,
        sanitizePersistedInspectorConfig({
          ...pickInspectorConnectionExtras(prev[id]),
          ...config,
          // Recover connections written by the legacy tunnel-switching flow.
          // The mounted Inspector should always persist its stable localhost
          // endpoint rather than an ephemeral public tunnel URL.
          ...(isLocalhostServerUrl(id) &&
          typeof config.url === "string" &&
          isMcpUseTunnelUrl(config.url)
            ? { url: id }
            : {}),
        }),
      ])
    ) as Record<string, PersistedInspectorConnectionConfig>;
    super.setServers(merged);
    this.markStorageVersion();
  }

  setServer(id: string, config: PersistedMcpServerConfig): void {
    const servers = this.getServers();
    const prev = this.readRawStoredServers();
    servers[id] = {
      ...pickInspectorConnectionExtras(prev[id]),
      ...config,
    } as PersistedInspectorConnectionConfig;
    this.setServers(servers);
  }

  private readRawStoredServers(): Record<string, Record<string, unknown>> {
    try {
      const stored = localStorage.getItem(this.inspectorStorageKey);
      if (!stored) return {};
      const parsed: unknown = JSON.parse(stored);
      if (!isRecord(parsed)) {
        throw new TypeError("Inspector connection storage is not an object");
      }
      return parsed as Record<string, Record<string, unknown>>;
    } catch {
      try {
        localStorage.removeItem(this.inspectorStorageKey);
        this.markStorageVersion();
      } catch {
        // Storage can be disabled by browser privacy policy. Recovery remains
        // in-memory so the Inspector itself can still load.
      }
      console.info("[Inspector] Removed unreadable connection storage.");
      return {};
    }
  }

  private readStorageVersion(): string | null {
    try {
      return localStorage.getItem(this.inspectorStorageVersionKey);
    } catch {
      return null;
    }
  }

  private writeRecoveredStorage(
    servers: Record<string, PersistedInspectorConnectionConfig>
  ): void {
    try {
      localStorage.setItem(this.inspectorStorageKey, JSON.stringify(servers));
      this.markStorageVersion();
    } catch {
      // Best-effort migration: callers still receive the recovered value.
    }
  }

  private markStorageVersion(): void {
    try {
      localStorage.setItem(
        this.inspectorStorageVersionKey,
        INSPECTOR_CONNECTION_STORAGE_VERSION
      );
    } catch {
      // Best-effort marker when storage is unavailable or full.
    }
  }
}
