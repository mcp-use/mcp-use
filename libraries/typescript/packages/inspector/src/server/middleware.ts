import type { Express, NextFunction, Request, Response } from "express";
import { Hono } from "hono";
import { Readable } from "node:stream";
import { registerInspectorShell } from "./inspector-shell.js";
import {
  registerInspectorProxyRoutes,
  type InspectorProxyRoutesConfig,
} from "./proxy-routes.js";

/** Web-standard handler returned by {@link mountInspector}. */
export type InspectorFetchHandler = (
  request: globalThis.Request
) => Promise<globalThis.Response>;

/** Configuration shared by framework-neutral and framework-mounted inspectors. */
export interface MountInspectorOptions {
  /**
   * MCP URL passed to the client for automatic connection. For the returned
   * Fetch handler, omission derives `${request.origin}${basePath}` so localhost
   * and public tunnel URLs both target the listener the browser actually used.
   * Pass `null` to disable auto-connect.
   */
  autoConnectUrl?: string | null;
  manufactChatUrl?: string | null;
  /** Whether to enable the same-origin development sandbox (default `true`). */
  devMode?: boolean;
  /** Override the sandbox origin for MCP Apps widgets. */
  sandboxOrigin?: string | null;
  /** Explicit cross-origin callers of the OAuth BFF. Same-origin is implicit. */
  oauthProxyAllowedOrigins?: readonly string[];
  /** Allow OAuth and MCP proxy requests to loopback targets (default `true`). */
  oauthProxyAllowLoopback?: boolean;
  /** Optional source label for logs when Inspector shares a dev server process. */
  logPrefix?: string;
  /**
   * Server-wide MCP path prefix (default `/mcp`; `""` = root). The Inspector
   * is served from `${basePath}/inspector` and its API from
   * `${basePath}/inspector/api/*`.
   */
  basePath?: string;
}

/**
 * Create or mount the local MCP Inspector.
 *
 * With options (or no arguments), this returns a framework-neutral Fetch
 * handler. A development server can dispatch Inspector requests to this
 * handler on its existing listener without starting a child process or a
 * second port.
 *
 * Passing an Express or Hono app preserves the v1 mounting API. Hono routes
 * are registered directly; Express receives a narrowly scoped adapter.
 *
 * The UI bundle is always served from this installed package. The same Hono
 * route implementation owns the UI, MCP proxy, OAuth BFF, callback, health,
 * and config routes in every integration.
 *
 * @example Framework-neutral, same-listener use
 * ```typescript
 * const inspector = mountInspector({
 *   basePath: "/mcp",
 *   autoConnectUrl: "http://localhost:3000/mcp",
 * });
 *
 * const response = await inspector(request);
 * ```
 *
 * @example Legacy Hono or Express mounting
 * ```typescript
 * mountInspector(app, {
 *   basePath: "/mcp",
 *   autoConnectUrl: "http://localhost:3000/mcp",
 * });
 * ```
 */
export function mountInspector(
  options?: MountInspectorOptions
): InspectorFetchHandler;
// eslint-disable-next-line no-redeclare -- legacy app overload
export function mountInspector(
  app: Express | Hono,
  options?: MountInspectorOptions
): void;
// eslint-disable-next-line no-redeclare -- implementation signature
export function mountInspector(
  appOrOptions?: Express | Hono | MountInspectorOptions,
  maybeOptions?: MountInspectorOptions
): InspectorFetchHandler | void {
  if (isMountableApp(appOrOptions)) {
    const app = appOrOptions;
    const options = maybeOptions;
    const basePath = normalizeInspectorBasePath(options?.basePath);

    if (isHonoApp(app)) {
      registerInspectorRoutes(app, options, basePath);
      return;
    }

    const inspectorApp = createInspectorApp(options, basePath);
    const inspectorFetch = toInspectorFetchHandler(inspectorApp);
    app.use(
      createExpressInspectorMiddleware(
        inspectorFetch,
        inspectorApp.routes.map((route) => route.path)
      )
    );
    return;
  }

  const options = appOrOptions;
  const basePath = normalizeInspectorBasePath(options?.basePath);
  return toInspectorFetchHandler(createInspectorApp(options, basePath));
}

function createInspectorApp(
  options: MountInspectorOptions | undefined,
  basePath: string
): Hono {
  const app = new Hono();
  registerInspectorRoutes(app, options, basePath);
  return app;
}

function registerInspectorRoutes(
  app: Hono,
  options: MountInspectorOptions | undefined,
  basePath: string
): void {
  const routesConfig: InspectorProxyRoutesConfig = {
    oauthProxyAllowedOrigins: options?.oauthProxyAllowedOrigins ?? [],
    // A mounted inspector can end up publicly reachable (hosted deployments),
    // where loopback proxying is SSRF into the host's own services. Default to
    // blocking loopback; local dev tooling opts in explicitly.
    oauthProxyAllowLoopback: options?.oauthProxyAllowLoopback ?? false,
    logPrefix: options?.logPrefix,
  };
  if (options?.autoConnectUrl !== undefined) {
    routesConfig.autoConnectUrl = options.autoConnectUrl;
  } else {
    app.get(`${basePath}/inspector/config.json`, (c) => {
      const requestUrl = new URL(c.req.url);
      return c.json({ autoConnectUrl: `${requestUrl.origin}${basePath}` });
    });
  }

  registerInspectorProxyRoutes(app, routesConfig, basePath);
  registerInspectorShell(
    app,
    {
      devMode: options?.devMode ?? true,
      sandboxOrigin: options?.sandboxOrigin,
      inspectorMode: "embedded",
      rootRedirect: false,
      basePath,
      proxyUrl: `${basePath}/inspector/api/proxy`,
      manufactChatUrl: options?.manufactChatUrl,
    },
    basePath
  );
}

function toInspectorFetchHandler(app: Hono): InspectorFetchHandler {
  return (request) => Promise.resolve(app.fetch(request));
}

function createExpressInspectorMiddleware(
  fetch: InspectorFetchHandler,
  registeredPaths: readonly string[]
) {
  const exactPaths = new Set(
    registeredPaths.filter((path) => !path.includes("*"))
  );
  const prefixPaths = registeredPaths
    .filter((path) => path.endsWith("/*"))
    .map((path) => path.slice(0, -1));

  return (req: Request, res: Response, next: NextFunction): void => {
    const url = new URL(req.originalUrl || req.url || "", requestOrigin(req));
    if (
      !exactPaths.has(url.pathname) &&
      !prefixPaths.some((prefix) => url.pathname.startsWith(prefix))
    ) {
      next();
      return;
    }

    let finished = false;
    const abort = new AbortController();
    res.on("close", () => {
      if (!finished) {
        abort.abort();
      }
    });
    if (res.destroyed === true) {
      abort.abort();
    }

    const request = expressRequestToFetchRequest(req, url, abort.signal);
    void fetch(request)
      .then((fetchResponse) =>
        writeFetchResponse(res, fetchResponse, abort.signal)
      )
      .catch((error) => {
        // The client going away aborts the outbound fetch and the body
        // read. That is a completed request, not an Express error.
        if (abort.signal.aborted) {
          return;
        }
        next(error);
      })
      .finally(() => {
        finished = true;
      });
  };
}

function requestOrigin(req: Request): string {
  const forwardedProtocol = firstHeaderValue(req.headers["x-forwarded-proto"]);
  const protocol = forwardedProtocol || req.protocol || "http";
  const forwardedHost = firstHeaderValue(req.headers["x-forwarded-host"]);
  const host =
    forwardedHost || firstHeaderValue(req.headers.host) || "localhost";
  return `${protocol}://${host}`;
}

function firstHeaderValue(value: string | string[] | undefined): string {
  return Array.isArray(value)
    ? (value[0] ?? "")
    : (value ?? "").split(",")[0].trim();
}

function expressRequestToFetchRequest(
  req: Request,
  url: URL,
  signal: AbortSignal
): globalThis.Request {
  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers: req.headers as HeadersInit,
    signal,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    if (req.body !== undefined) {
      init.body = bodyToRequestBody(req.body);
    } else {
      init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
      init.duplex = "half";
    }
  }

  return new globalThis.Request(url, init);
}

function bodyToRequestBody(body: unknown): BodyInit {
  if (
    typeof body === "string" ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ReadableStream
  ) {
    return body as BodyInit;
  }
  return JSON.stringify(body);
}

async function writeFetchResponse(
  res: Response,
  fetchResponse: globalThis.Response,
  signal: AbortSignal
): Promise<void> {
  res.status(fetchResponse.status);
  fetchResponse.headers.forEach((value, key) => {
    if (key !== "set-cookie") res.setHeader(key, value);
  });
  const setCookies = fetchResponse.headers.getSetCookie();
  if (setCookies.length > 0) res.setHeader("set-cookie", setCookies);

  if (!fetchResponse.body) {
    res.end();
    return;
  }

  // The MCP proxy serves long-lived SSE responses. Without this, a client
  // disconnecting mid-stream (res "close") left this loop pumping the
  // upstream body into a dead socket forever, so the upstream response was
  // never released. Mirrors the abort wiring in packages/server/node-bridge.ts.
  const reader = fetchResponse.body.getReader();
  const cancelReader = () => {
    void reader.cancel().catch(() => {
      // Best-effort: the reader may already be closed or errored.
    });
  };
  if (signal.aborted) {
    cancelReader();
  } else {
    signal.addEventListener("abort", cancelReader, { once: true });
  }

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) break;
      res.write(value);
    }
  } finally {
    signal.removeEventListener("abort", cancelReader);
    res.end();
  }
}

function isMountableApp(
  value: Express | Hono | MountInspectorOptions | undefined
): value is Express | Hono {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  return (
    typeof (value as { use?: unknown }).use === "function" || isHonoApp(value)
  );
}

function isHonoApp(value: unknown): value is Hono {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { fetch?: unknown }).fetch === "function" &&
    typeof (value as { route?: unknown }).route === "function"
  );
}

function normalizeInspectorBasePath(raw: string | undefined): string {
  if (raw === undefined) return "/mcp";
  const trimmed = raw.trim();
  const normalized: string[] = [];
  let previousWasSlash = false;
  for (const character of trimmed) {
    if (character === "/") {
      if (!previousWasSlash) normalized.push(character);
      previousWasSlash = true;
    } else {
      normalized.push(character);
      previousWasSlash = false;
    }
  }
  while (normalized.length > 0 && normalized[normalized.length - 1] === "/") {
    normalized.pop();
  }
  let value = normalized.join("");
  if (value === "" || value === "/") return "";
  if (!value.startsWith("/")) value = `/${value}`;
  return value;
}
