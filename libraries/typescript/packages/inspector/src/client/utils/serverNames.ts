interface ServerNameLike {
  name?: string;
  url?: string;
  serverInfo?: {
    title?: string;
    name?: string;
  } | null;
}

export function getConfiguredServerAlias(server: ServerNameLike): string {
  const configuredName = server.name?.trim();
  const url = server.url?.trim();

  if (!configuredName) {
    return "";
  }

  return configuredName !== url ? configuredName : "";
}

export function getServerDisplayName(server: ServerNameLike): string {
  return (
    getConfiguredServerAlias(server) ||
    server.serverInfo?.title?.trim() ||
    server.serverInfo?.name?.trim() ||
    server.name?.trim() ||
    server.url?.trim() ||
    "Unknown server"
  );
}
