import { createServer, type Server } from "node:http";

import type { FetchHandler } from "../../src/fetch-app.js";
import { toNodeHandler } from "../../src/node-bridge.js";

export interface ListenFetchResult {
  readonly server: Server;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

/** Bind a fetch handler on an ephemeral loopback port for e2e tests. */
export async function listenFetch(
  fetch: FetchHandler,
  hostname = "127.0.0.1"
): Promise<ListenFetchResult> {
  const listener = toNodeHandler({ fetch });
  const server = createServer((req, res) => {
    void listener(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, hostname, () => resolve());
    server.once("error", reject);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not expose a TCP address");
  }

  return {
    server,
    port: address.port,
    url: `http://${hostname}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
