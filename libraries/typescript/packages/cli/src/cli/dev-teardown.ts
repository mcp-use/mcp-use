import type { Server } from "node:http";

/** Resources registered immediately after each dev startup step succeeds. */
export interface DevResources {
  httpServer?: Pick<Server, "close" | "closeAllConnections">;
  runner?: { close(): Promise<void> };
  vite?: { close(): Promise<void> };
  stopWatching?: readonly (() => void)[];
  stopTunnel?: () => Promise<void>;
}

/**
 * Own one shared dev teardown, including resources from partial startup.
 *
 * Every close is attempted despite another failure. HTTP close starts before
 * runner/Vite teardown, but is awaited afterwards: Vite owns upgraded HMR
 * connections that can otherwise prevent the HTTP close callback from firing.
 *
 * @internal
 */
export function createDevTeardown(
  resources: DevResources
): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return () => {
    closing ??= Promise.resolve().then(async () => {
      const errors: unknown[] = [];
      const attempt = async (
        cleanup: (() => void | Promise<void>) | undefined
      ): Promise<void> => {
        try {
          await cleanup?.();
        } catch (error) {
          errors.push(error);
        }
      };

      for (const stop of resources.stopWatching ?? []) await attempt(stop);
      await attempt(resources.stopTunnel);

      const httpServer = resources.httpServer;
      const httpClosed =
        httpServer === undefined
          ? undefined
          : new Promise<void>((resolve) => {
              try {
                httpServer.close((error) => {
                  // Partial startup may never bind, or may already be closed.
                  if (
                    error !== undefined &&
                    (error as NodeJS.ErrnoException).code !==
                      "ERR_SERVER_NOT_RUNNING"
                  ) {
                    errors.push(error);
                  }
                  resolve();
                });
              } catch (error) {
                errors.push(error);
                resolve();
              }
            });
      await attempt(() => httpServer?.closeAllConnections());
      await attempt(() => resources.runner?.close());
      await attempt(() => resources.vite?.close());
      await httpClosed;

      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, "Dev resource cleanup failed.");
      }
    });
    return closing;
  };
}
