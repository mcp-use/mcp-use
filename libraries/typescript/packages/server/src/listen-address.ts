/** Default bind address for Node listeners. */
export const DEFAULT_LISTEN_HOST = "127.0.0.1";

/** Default TCP port for Node listeners. */
export const DEFAULT_LISTEN_PORT = 3000;

/** Resolve an explicit value, then `HOST`, then configured value, then default. */
export function resolveListenHost(
  explicitHost: string | undefined,
  configuredHost: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env
): string {
  if (explicitHost !== undefined) return explicitHost;
  const envHost = env.HOST?.trim();
  if (envHost !== undefined && envHost !== "") return envHost;
  return configuredHost ?? DEFAULT_LISTEN_HOST;
}

/** Resolve an explicit value, then `PORT`, then configured value, then default. */
export function resolveListenPort(
  explicitPort: number | undefined,
  configuredPort: number | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env
): number {
  if (explicitPort !== undefined) return explicitPort;
  const envPort = parsePort(env.PORT);
  if (envPort !== undefined) return envPort;
  return configuredPort ?? DEFAULT_LISTEN_PORT;
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const port = Number(value);
  return Number.isInteger(port) && port >= 0 && port <= 65535
    ? port
    : undefined;
}
