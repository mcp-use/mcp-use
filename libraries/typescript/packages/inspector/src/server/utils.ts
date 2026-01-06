// Validate URL format
export function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "ws:" ||
      url.protocol === "wss:"
    );
  } catch {
    return false;
  }
}

// Find available port starting from 8080
export async function findAvailablePort(
  startPort = 8080,
  maxAttempts = 100
): Promise<number> {
  const net = await import("node:net");

  for (let port = startPort; port < startPort + maxAttempts; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const server = net.createServer();
        server.listen(port, () => {
          server.close(() => resolve());
        });
        server.on("error", (err) => reject(err));
      });
      return port;
    } catch {
      // Port is in use, try next one
      continue;
    }
  }
  throw new Error(
    `No available port found after trying ${maxAttempts} ports starting from ${startPort}`
  );
}

/**
 * Determines whether the given TCP port is available for binding on the local machine.
 *
 * @param port - The port number to check (1–65535)
 * @returns `true` if the port can be bound (is available), `false` otherwise
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  const net = await import("node:net");

  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

/**
 * Parses a TCP port number from command-line arguments using the `--port` flag.
 *
 * If `--port` is present and followed by an integer between 1 and 65535, returns that port.
 *
 * @returns The parsed port number if valid, `null` if the flag is missing or the value is invalid.
 */
export function parsePortFromArgs(): number | null {
  const portArgIndex = process.argv.indexOf("--port");
  if (portArgIndex !== -1 && portArgIndex + 1 < process.argv.length) {
    const portValue = Number.parseInt(process.argv[portArgIndex + 1], 10);
    if (!Number.isNaN(portValue) && portValue >= 1 && portValue <= 65535) {
      return portValue;
    }
  }
  return null;
}

/**
 * Helper function to format error responses with context and timestamp
 */
export function formatErrorResponse(error: unknown, context: string) {
  const timestamp = new Date().toISOString();
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  const errorStack = error instanceof Error ? error.stack : undefined;

  // Log detailed error server-side for debugging
  console.error(`[${timestamp}] Error in ${context}:`, {
    message: errorMessage,
    stack: errorStack,
  });

  return {
    error: errorMessage,
    context,
    timestamp,
    // Only include stack in development mode
    ...(process.env.NODE_ENV === "development" && errorStack
      ? { stack: errorStack }
      : {}),
  };
}
