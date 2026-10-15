import {
  createMcpHandler,
  type CreateMcpHandlerOptions,
  type McpHttpHandler,
  type McpServerFactory,
  type ServerEvent,
  type ServerEventBus,
  type Transport,
} from "@modelcontextprotocol/server";

import { getRequestBag } from "./fetch-app.js";
import {
  extractClientCapabilitiesFromBody,
  stashClientCapabilities,
} from "./views/capabilities.js";

type Product = Awaited<ReturnType<McpServerFactory>>;
type EventListener = (event: ServerEvent) => void;

// This closure must only retain the indirection cell. A backend that retains a
// callback after failed unsubscribe must not retain the SDK listener/stream.
function forwardEvents(state: {
  target: EventListener | undefined;
}): EventListener {
  return (event) => state.target?.(event);
}

function manageBus(
  bus: ServerEventBus,
  reportError: (error: unknown) => void,
  isClosed: () => boolean
): { bus: ServerEventBus; close: () => void } {
  const subscriptions = new Set<() => void>();
  return {
    bus: {
      publish: (event) => bus.publish(event),
      subscribe(listener) {
        if (isClosed()) throw new Error("This MCP handler has been closed");
        const state: { target: EventListener | undefined } = {
          target: listener,
        };
        let unsubscribe: () => void;
        try {
          unsubscribe = bus.subscribe(forwardEvents(state));
        } catch (error) {
          state.target = undefined;
          throw error;
        }
        const cleanup = () => {
          state.target = undefined;
          // Keep a failed backend handle for the next close() attempt.
          unsubscribe();
          subscriptions.delete(cleanup);
        };
        subscriptions.add(cleanup);
        if (isClosed()) {
          try {
            cleanup();
          } catch (error) {
            reportError(error);
          }
          throw new Error("This MCP handler has been closed");
        }
        return cleanup;
      },
    },
    close() {
      for (const cleanup of [...subscriptions]) {
        try {
          cleanup();
        } catch (error) {
          reportError(error);
        }
      }
    },
  };
}

/**
 * Own request, stream, and factory-product lifetimes across both SDK eras.
 *
 * The external SDK remains external in portable builds. These safeguards must
 * therefore work with the unpatched, published upstream handler as well.
 *
 * @internal
 */
export function createManagedMcpHandler(
  factory: McpServerFactory,
  options: CreateMcpHandlerOptions
): McpHttpHandler {
  let closed = false;
  const requests = new Set<() => void>();
  const products = new Set<() => Promise<void>>();
  const cleanups = new Set<Promise<void>>();
  const cancellationError = new Error("MCP request was cancelled");
  const reportError = (error: unknown) => {
    if (error === cancellationError) return;
    try {
      options.onerror?.(
        error instanceof Error ? error : new Error(String(error))
      );
    } catch {
      // Reporting cannot interrupt cleanup of other owned resources.
    }
  };
  const settle = async (action: () => void | Promise<void>) => {
    try {
      await action();
    } catch (error) {
      reportError(error);
    }
  };
  const managedBus =
    options.bus && manageBus(options.bus, reportError, () => closed);

  const managedFactory: McpServerFactory = async (context) => {
    const product: Product = await factory(context);
    const server = "server" in product ? product.server : product;
    const signal = context.requestInfo?.signal;
    let transport: Transport | undefined;
    let disposed = false;
    let disposal: Promise<void> | undefined;
    const previousOnClose = server.onclose;
    const release = () => {
      products.delete(dispose);
      signal?.removeEventListener("abort", onAbort);
      if (server.onclose === onClose) {
        if (previousOnClose === undefined) delete server.onclose;
        else server.onclose = previousOnClose;
      }
    };
    const onClose = () => {
      release();
      previousOnClose?.();
    };
    const closeTransport = async (incoming: Transport) => {
      await settle(() => incoming.close());
      // A delayed custom connect() can install protocol callbacks after an
      // idempotent transport was already closed. Reconcile that missed close.
      if (server.transport === incoming) {
        await settle(() => incoming.onclose?.());
      }
    };
    const dispose = (): Promise<void> => {
      if (disposal !== undefined) return disposal;
      disposed = true;
      release();
      // Transport ownership is independent of a caller's product.close().
      // A failure in either cleanup must not skip the other one.
      disposal = Promise.all([
        transport === undefined ? undefined : closeTransport(transport),
        settle(() => product.close()),
      ]).then(() => {});
      cleanups.add(disposal);
      void disposal.then(() => cleanups.delete(disposal!));
      return disposal;
    };
    const onAbort = () => void dispose();
    server.onclose = onClose;
    products.add(dispose);
    signal?.addEventListener("abort", onAbort, { once: true });

    if (closed || signal?.aborted) {
      await dispose();
      throw cancellationError;
    }

    const connect = async (incoming: Transport) => {
      transport = incoming;
      if (closed || disposed || signal?.aborted) {
        await closeTransport(incoming);
        await dispose();
        throw cancellationError;
      }
      try {
        await product.connect(incoming);
      } catch (error) {
        await closeTransport(incoming);
        await dispose();
        throw error;
      }
      if (closed || disposed || signal?.aborted) {
        await closeTransport(incoming);
        await dispose();
        throw cancellationError;
      }
    };

    // Preserve the external SDK's instanceof checks, and bind methods to their
    // original receiver so private fields work. Callback identity is retained.
    return new Proxy(product, {
      get(target, key) {
        if (key === "connect") return connect;
        if (key === "close") return dispose;
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" &&
          key !== "onclose" &&
          key !== "onerror" &&
          key !== "onmessage"
          ? (value.bind(target) as unknown)
          : value;
      },
      set: (target, key, value) => Reflect.set(target, key, value, target),
    });
  };

  const handler = createMcpHandler(managedFactory, {
    ...options,
    onerror: reportError,
    ...(managedBus !== undefined && { bus: managedBus.bus }),
  });

  return {
    bus: handler.bus,
    notify: handler.notify,
    async fetch(request, requestOptions) {
      if (closed) throw new Error("This MCP handler has been closed");
      if (request.signal.aborted) return new Response(null, { status: 499 });
      const controller = new AbortController();
      let ended = false;
      let cancelled = false;
      let resolveCancellation!: (response: Response) => void;
      const cancellation = new Promise<Response>((resolve) => {
        resolveCancellation = resolve;
      });
      const complete = () => {
        if (ended) return;
        ended = true;
        requests.delete(cancel);
        request.signal.removeEventListener("abort", cancel);
        controller.abort();
      };
      const cancel = () => {
        if (ended) return;
        cancelled = true;
        resolveCancellation(new Response(null, { status: 499 }));
        complete();
      };
      requests.add(cancel);
      request.signal.addEventListener("abort", cancel, { once: true });

      let managedRequest: Request;
      try {
        // A pre-parsed request can already have had its body consumed.
        managedRequest =
          request.bodyUsed && requestOptions?.parsedBody !== undefined
            ? new Request(request.url, {
                method: request.method,
                headers: request.headers,
                signal: controller.signal,
              })
            : new Request(request, { signal: controller.signal });
      } catch (error) {
        complete();
        throw error;
      }
      Object.assign(getRequestBag(managedRequest), getRequestBag(request));
      const capabilities = extractClientCapabilitiesFromBody(
        requestOptions?.parsedBody
      );
      if (capabilities !== undefined)
        stashClientCapabilities(managedRequest, capabilities);

      const response = handler.fetch(managedRequest, requestOptions).then(
        async (reply) => {
          if (cancelled) {
            await settle(() => reply.body?.cancel());
            return new Response(null, { status: 499 });
          }
          if (
            reply.body === null ||
            reply.headers
              .get("content-type")
              ?.split(";", 1)[0]
              ?.trim()
              .toLowerCase() !== "text/event-stream"
          ) {
            complete();
            return reply;
          }
          const reader = reply.body.getReader();
          let streamEnded = false;
          let streamController: ReadableStreamDefaultController<Uint8Array>;
          const finish = (reason?: unknown, error?: unknown) => {
            if (streamEnded) return Promise.resolve();
            streamEnded = true;
            controller.signal.removeEventListener("abort", onAbort);
            complete();
            try {
              if (error !== undefined) streamController.error(error);
              else streamController.close();
            } catch {
              // A consumer may already have cancelled this outer stream.
            }
            return settle(() => reader.cancel(reason)).then(() =>
              settle(() => reader.releaseLock())
            );
          };
          const onAbort = () => void finish(controller.signal.reason);
          const body = new ReadableStream<Uint8Array>({
            start(value) {
              streamController = value;
              controller.signal.addEventListener("abort", onAbort, {
                once: true,
              });
            },
            async pull(value) {
              try {
                const result = await reader.read();
                if (streamEnded) return;
                if (result.done) await finish();
                else value.enqueue(result.value);
              } catch (error) {
                await finish(error, error);
              }
            },
            cancel: (reason) => finish(reason),
          });
          return new Response(body, {
            status: reply.status,
            statusText: reply.statusText,
            headers: reply.headers,
          });
        },
        (error: unknown) => {
          complete();
          throw error;
        }
      );
      // The losing SDK promise stays observed; late factories are disposed by
      // managedFactory, without holding shutdown hostage to factory completion.
      return Promise.race([response, cancellation]);
    },
    async close() {
      closed = true;
      for (const cancel of [...requests]) cancel();
      await Promise.all([
        settle(() => handler.close()),
        ...[...products].map((dispose) => dispose()),
        ...cleanups,
      ]);
      managedBus?.close();
    },
  };
}
