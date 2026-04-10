interface ConnectionLike {
  url?: string;
  name?: string;
  transportType?: "http" | "sse";
  proxyConfig?: {
    proxyAddress?: string;
    headers?: Record<string, string>;
    customHeaders?: Record<string, string>;
  };
  headers?: Record<string, string>;
  customHeaders?: Record<string, string>;
}

export interface EditableConnectionConfig {
  url: string;
  name?: string;
  transportType: "http" | "sse";
  proxyConfig?: {
    proxyAddress?: string;
    headers?: Record<string, string>;
    customHeaders?: Record<string, string>;
  };
  headers?: Record<string, string>;
  customHeaders?: Record<string, string>;
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
  headers: Record<string, string>;
} {
  const normalizedUrl = connection.url?.trim() || "";

  return {
    url: normalizedUrl,
    name: connection.name?.trim() || normalizedUrl,
    transportType: connection.transportType || "http",
    proxyAddress: connection.proxyConfig?.proxyAddress?.trim() || "",
    headers: getComparableHeaders(connection),
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
    JSON.stringify(currentConnection.headers) ===
      JSON.stringify(nextConnection.headers) &&
    currentConnection.name !== nextConnection.name
  );
}
