import net from "node:net";

export async function isPortAvailable(
  port: number,
  host: string = "localhost"
): Promise<boolean> {
  if (host === "localhost") {
    const loopbackResults = await Promise.all([
      canBindPort(port, "127.0.0.1", true),
      canBindPort(port, "::1", true),
    ]);
    return loopbackResults.every(Boolean);
  }

  return canBindPort(port, host);
}

async function canBindPort(
  port: number,
  host: string,
  ignoreUnsupportedHost = false
): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (
        ignoreUnsupportedHost &&
        (error.code === "EADDRNOTAVAIL" || error.code === "EINVAL")
      ) {
        resolve(true);
        return;
      }
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, host);
  });
}

export async function findAvailablePort(
  startPort: number,
  host: string = "localhost"
): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port, host)) {
      return port;
    }
  }
  throw new Error("No available ports found");
}
