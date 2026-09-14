import { createServer } from "node:http";
import { expect } from "vitest";
import { it } from "./fixtures.js";
import { fetchWithTimeout, waitFor } from "./requests.js";

it("aborts an HTTP response body when the polling deadline expires", async ({
  scope,
}) => {
  let requestClosed = false;
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.write("unfinished response");
    res.on("close", () => {
      requestClosed = true;
    });
  });
  scope.defer(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error &&
          (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
            ? reject(error)
            : resolve()
        );
        server.closeAllConnections();
      }),
    "test HTTP server"
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("missing listener");
  await expect(
    waitFor(
      async () => {
        const response = await fetchWithTimeout(
          `http://127.0.0.1:${address.port}`
        );
        await response.text();
        return true;
      },
      { timeout: 200 }
    )
  ).rejects.toThrow("waitFor timed out after 200ms");
  await waitFor(async () => (requestClosed ? true : undefined), {
    timeout: 1_000,
    interval: 10,
  });
});

it("bounds a probe that ignores cancellation", async () => {
  await expect(
    waitFor(() => new Promise<undefined>(() => {}), { timeout: 20 })
  ).rejects.toThrow("waitFor timed out");
});
