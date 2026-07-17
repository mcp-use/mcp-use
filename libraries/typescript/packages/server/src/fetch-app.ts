import {
  hostHeaderValidationResponse,
  originValidationResponse,
  type AuthInfo,
} from "@modelcontextprotocol/server";

/** Web-standard request handler. */
export type FetchHandler = (request: Request) => Promise<Response>;

/** Request shapes accepted by {@link toFrameworkHandler}. */
export type FrameworkRequestLike = Request | { req: { raw: Request } };

/**
 * Universal web handler mountable in Vercel, Hono, TanStack, and other
 * fetch-native frameworks without `c.req.raw` boilerplate.
 */
export type FrameworkHandler = (
  input: FrameworkRequestLike
) => Promise<Response>;

/**
 * Wrap a {@link FetchHandler} for framework duck-typing (Hono `Context`, etc.).
 *
 * @param fetch - Inner fetch handler produced by {@link MCPServer.getHandler}.
 */
export function toFrameworkHandler(fetch: FetchHandler): FrameworkHandler {
  return (input) => {
    const request = input instanceof Request ? input : input.req.raw;
    return fetch(request);
  };
}

/** Onion middleware over a {@link FetchHandler} terminal. */
export type FetchMiddleware = (
  request: Request,
  next: () => Promise<Response>
) => Promise<Response>;

/** Per-request values stashed before the MCP handler runs. */
export interface RequestBag {
  /** Parsed JSON body when the JSON middleware ran first. */
  parsedBody?: unknown;
  /** Verified OAuth identity forwarded to the SDK handler. */
  authInfo?: AuthInfo;
}

const requestBags = new WeakMap<Request, RequestBag>();

/**
 * Mutable per-request bag; created on first access.
 *
 * @param request - Incoming request whose bag to read or create.
 */
export function getRequestBag(request: Request): RequestBag {
  let bag = requestBags.get(request);
  if (bag === undefined) {
    bag = {};
    requestBags.set(request, bag);
  }
  return bag;
}

/**
 * Compose middleware around a terminal handler (first listed runs outermost).
 *
 * @param terminal - Fallback handler when no middleware short-circuits.
 * @param middlewares - Middleware chain executed before `terminal`.
 */
export function composeFetch(
  terminal: FetchHandler,
  ...middlewares: FetchMiddleware[]
): FetchHandler {
  return async (request: Request): Promise<Response> => {
    let index = 0;
    const dispatch = async (): Promise<Response> => {
      if (index < middlewares.length) {
        const middleware = middlewares[index]!;
        index += 1;
        return middleware(request, dispatch);
      }
      return terminal(request);
    };
    return dispatch();
  };
}

/**
 * Return the pathname of a request URL.
 *
 * @param request - Request whose pathname to read.
 */
export function pathnameOf(request: Request): string {
  return new URL(request.url).pathname;
}

/**
 * Match a request pathname exactly.
 *
 * @param request - Request to test.
 * @param path - Exact pathname (for example `/mcp`).
 */
export function matchesPath(request: Request, path: string): boolean {
  return pathnameOf(request) === path;
}

/**
 * Match a request pathname prefix (prefix or `prefix/...`).
 *
 * @param request - Request to test.
 * @param prefix - Path prefix without a trailing wildcard.
 */
export function matchesPathPrefix(request: Request, prefix: string): boolean {
  const pathname = pathnameOf(request);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Append a framework-owned child path beneath an MCP base path.
 *
 * Unlike string interpolation, this keeps the root base path from producing
 * a double slash: `pathUnderBase("/", "inspector")` is `"/inspector"`.
 *
 * @param basePath - Valid MCP base path, including the root path `/`.
 * @param childPath - Relative child path, with or without a leading slash.
 * @returns Absolute pathname beneath `basePath`.
 *
 * @internal
 */
export function pathUnderBase(basePath: string, childPath: string): string {
  const child = childPath.replace(/^\/+/, "");
  return basePath === "/" ? `/${child}` : `${basePath}/${child}`;
}

/**
 * Classify a request as explicit browser HTML navigation.
 *
 * Only GET and HEAD requests whose Accept header names `text/html` with a
 * non-zero quality value qualify. Wildcard-only and missing Accept headers
 * remain available to protocol and health probes.
 *
 * @param request - Incoming request to classify.
 * @returns Whether the request explicitly accepts HTML.
 *
 * @internal
 */
export function isHtmlNavigationRequest(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }
  const accept = request.headers.get("accept");
  if (accept === null) {
    return false;
  }
  return accept.split(",").some((range) => {
    const [mediaType, ...parameters] = range.split(";");
    if (mediaType?.trim().toLowerCase() !== "text/html") {
      return false;
    }
    return !parameters.some((parameter) => {
      const [name, value] = parameter.trim().toLowerCase().split("=");
      return name === "q" && Number(value) === 0;
    });
  });
}

/**
 * Dispatch to the first matching route handler.
 *
 * @param routes - Ordered route table; first match wins.
 * @param fallback - Handler when nothing matches.
 */
export function routeFetch(
  routes: Array<{
    match: (request: Request) => boolean;
    handler: FetchHandler;
  }>,
  fallback: FetchHandler = async () =>
    new Response("Not Found", { status: 404 })
): FetchHandler {
  return async (request: Request): Promise<Response> => {
    for (const route of routes) {
      if (route.match(request)) {
        return route.handler(request);
      }
    }
    return fallback(request);
  };
}

/**
 * Parse JSON bodies once and stash them in the request bag.
 */
export function jsonBodyMiddleware(): FetchMiddleware {
  return async (request, next) => {
    const bag = getRequestBag(request);
    if (bag.parsedBody !== undefined) {
      return next();
    }
    if (
      !(request.headers.get("content-type") ?? "").includes("application/json")
    ) {
      return next();
    }
    try {
      bag.parsedBody = await request.clone().json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    return next();
  };
}

/**
 * Reject requests whose `Host` header is not on the allowlist.
 *
 * @param hosts - Allowed hostnames (port-agnostic).
 */
export function hostValidationMiddleware(hosts: string[]): FetchMiddleware {
  return async (request, next) => {
    const rejected = hostHeaderValidationResponse(request, hosts);
    return rejected ?? next();
  };
}

/**
 * Reject requests whose `Origin` header is not on the allowlist.
 *
 * @param origins - Allowed origin hostnames (port-agnostic).
 * @param skipSafeMethods - When true, skip GET/HEAD (view asset GETs).
 */
export function originValidationMiddleware(
  origins: string[],
  skipSafeMethods = true
): FetchMiddleware {
  return async (request, next) => {
    if (
      skipSafeMethods &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return next();
    }
    const rejected = originValidationResponse(request, origins);
    return rejected ?? next();
  };
}
