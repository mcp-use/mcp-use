/** A prepared MCP instance managed by the development integration. @internal */
export interface DevServerInstance {
  /** Serve an MCP request. */
  fetch(request: Request): Promise<Response>;
  /** Abort outstanding exchanges and release resources. */
  close(): Promise<void>;
}

/**
 * Serialize reloads and publish only the latest successfully prepared instance.
 * The previous instance stays usable while a candidate is loading or fails.
 * @internal
 */
export function createDevRuntime(
  load: () => Promise<DevServerInstance>,
  reportError: (error: unknown) => void
) {
  let active: { server: DevServerInstance; abort: AbortController } | undefined;
  let revision = 0;
  let closed = false;
  let pending: Promise<void> | undefined;
  let lastError: unknown;

  const dispose = async (instance: DevServerInstance) => {
    try {
      await instance.close();
    } catch (error) {
      reportError(error);
    }
  };

  const reconcile = async () => {
    let attempted: number;
    do {
      attempted = revision;
      try {
        const candidate = await load();
        if (closed || attempted !== revision) {
          await dispose(candidate);
          continue;
        }
        const previous = active;
        active = { server: candidate, abort: new AbortController() };
        lastError = undefined;
        if (previous) {
          previous.abort.abort(new Error("MCP server updated"));
          await dispose(previous.server);
        }
      } catch (error) {
        if (!closed && attempted === revision) {
          lastError = error;
          reportError(error);
        }
      }
    } while (!closed && attempted !== revision);
  };

  return {
    reload(): Promise<void> {
      if (closed) return Promise.resolve();
      revision++;
      pending ??= reconcile().finally(() => {
        pending = undefined;
      });
      return pending;
    },
    async fetch(request: Request): Promise<Response> {
      if (closed)
        return new Response("MCP development server closed", { status: 503 });
      if (!active) await pending;
      if (!active)
        throw (
          lastError ?? new Error("MCP development server is not initialized")
        );
      return active.server.fetch(
        new Request(request, {
          signal: AbortSignal.any([request.signal, active.abort.signal]),
        })
      );
    },
    async close(): Promise<void> {
      closed = true;
      const previous = active;
      active = undefined;
      previous?.abort.abort(new Error("MCP development server closed"));
      await Promise.all([pending, previous && dispose(previous.server)]);
    },
  };
}
