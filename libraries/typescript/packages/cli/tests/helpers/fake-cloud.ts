/**
 * A local stand-in for Manufact Cloud's HTTP API.
 *
 * Cloud is the one real outside boundary for cloud commands, so tests fake it
 * at the network layer instead of mocking modules. Each test registers the
 * routes it needs; the server records every request it receives so the test
 * can assert on what the CLI sent, which is behaviour Cloud observes.
 *
 * Routes are typed from the generated Cloud client
 * (`tests/helpers/cloud-routes.gen.ts`):
 *
 * - `cloud.on("GET", "/api/v1/deployments/dep_1", reply)` only compiles when
 *   the path matches a Cloud route, and `reply.body` is typed as that route's
 *   response for `reply.status`. A fixture that no longer matches Cloud fails
 *   `typecheck` once the client is regenerated, so a fake can't drift from
 *   the real API unnoticed.
 * - `reply.status` defaults to the route's documented success status (201
 *   for a create, for example).
 * - `cloud.onUndocumented(...)` registers a route Cloud doesn't document,
 *   with no typing. Keep its uses rare and explain each one.
 *
 * Any request with no matching route gets a 501 and is kept in `unhandled`.
 * The `cloud` fixture in `cli-test.ts` fails the test if `unhandled` is not
 * empty, so an unexpected or duplicated call never passes silently.
 */
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

import { defaultStatus, routesMatching } from "./cloud-contract.js";
import type { CloudRoutes } from "./cloud-routes.gen.js";

/** One request the fake received, in arrival order. */
export interface RecordedRequest {
  /** Upper-case HTTP method. */
  method: string;
  /** Full pathname, without the query string, e.g. `/api/v1/deployments`. */
  path: string;
  /** Query string parameters. Repeated keys keep the last value. */
  query: Record<string, string>;
  /** Lower-cased request headers, as Node parsed them. */
  headers: IncomingHttpHeaders;
  /**
   * Request body: parsed JSON for JSON content types, a string for other
   * non-empty bodies, and `undefined` when there is no body.
   */
  body: unknown;
  /** The raw body bytes, for multipart or binary uploads. */
  rawBody: Buffer;
}

/** What a route sends back. */
export interface FakeResponse {
  /** HTTP status. Defaults to the route's documented success status. */
  status?: number;
  /** JSON-encoded as the response body. Omit for an empty body. */
  body?: unknown;
  /** Extra response headers. */
  headers?: Record<string, string>;
}

/** An untyped reply, for `onUndocumented`. */
export type RouteReply =
  | FakeResponse
  | ((request: RecordedRequest) => FakeResponse | Promise<FakeResponse>);

// ---------------------------------------------------------------------------
// Types derived from the spec.

type RouteKey = keyof CloudRoutes;

/** An HTTP method some spec route uses. */
export type CloudMethod = RouteKey extends `${infer M} ${string}` ? M : never;

type TemplatesFor<M extends string> = RouteKey extends infer K
  ? K extends `${M} ${infer P}`
    ? P
    : never
  : never;

type Split<P extends string> = P extends `${infer Head}/${infer Tail}`
  ? [Head, ...Split<Tail>]
  : [P];

type SegmentsMatch<
  Path extends readonly string[],
  Template extends readonly string[],
> = Path extends [infer P extends string, ...infer PathRest extends string[]]
  ? Template extends [
      infer T extends string,
      ...infer TemplateRest extends string[],
    ]
    ? T extends `{${string}}`
      ? P extends ""
        ? false
        : SegmentsMatch<PathRest, TemplateRest>
      : P extends T
        ? SegmentsMatch<PathRest, TemplateRest>
        : false
    : false
  : Template extends []
    ? true
    : false;

/** The spec route(s) a concrete `path` belongs to. */
export type RouteFor<M extends string, P extends string> =
  Split<P> extends infer Segments extends string[]
    ? TemplatesFor<M> extends infer T
      ? T extends string
        ? SegmentsMatch<Segments, Split<T>> extends true
          ? `${M} ${T}` & RouteKey
          : never
        : never
      : never
    : never;

/** `P` when it is a spec route, otherwise a readable type error. */
type CheckedPath<M extends string, P extends string> = [
  RouteFor<M, P>,
] extends [never]
  ? `${M} ${P} is not a route in the Cloud spec; see cloud.onUndocumented`
  : P;

type BodyOf<B> = [B] extends [void]
  ? { body?: undefined }
  : unknown extends B
    ? { body?: unknown }
    : { body: B };

type StatusUnion<R> = keyof R & number;

type SuccessReply<K extends RouteKey> = {
  [S in StatusUnion<CloudRoutes[K]["responses"]>]: {
    status?: S;
  } & BodyOf<CloudRoutes[K]["responses"][S]>;
}[StatusUnion<CloudRoutes[K]["responses"]>];

type DocumentedErrorReply<K extends RouteKey> = {
  [S in StatusUnion<CloudRoutes[K]["errors"]>]: {
    status: S;
  } & BodyOf<CloudRoutes[K]["errors"][S]>;
}[StatusUnion<CloudRoutes[K]["errors"]>];

/** Failures any route can return, even when the spec does not list them. */
type AnyRouteError = 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503 | 504;

type UndocumentedErrorReply<K extends RouteKey> = {
  status: Exclude<AnyRouteError, StatusUnion<CloudRoutes[K]["errors"]>>;
  body?: unknown;
};

/** A reply the spec allows for route `K`. */
export type CloudReply<K extends RouteKey> = (
  | SuccessReply<K>
  | DocumentedErrorReply<K>
  | UndocumentedErrorReply<K>
) & { headers?: Record<string, string> };

type PathParams<K extends RouteKey> = CloudRoutes[K]["data"] extends {
  path: infer P;
}
  ? P
  : Record<string, never>;

/** A request to route `K`, as a reply function receives it. */
export interface CloudRequest<K extends RouteKey> extends RecordedRequest {
  /** The spec route, e.g. `GET /api/v1/deployments/{id}`. */
  route: K;
  /** Path parameters, e.g. `{ id: "dep_1" }`. */
  params: PathParams<K>;
}

/** A fixed reply, or a function of the request that returns one. */
export type CloudRouteReply<K extends RouteKey> = K extends RouteKey
  ?
      | CloudReply<K>
      | ((request: CloudRequest<K>) => CloudReply<K> | Promise<CloudReply<K>>)
  : never;

// ---------------------------------------------------------------------------

/** A running fake Cloud. */
export interface FakeCloud {
  /** Origin, e.g. `http://127.0.0.1:53211`. */
  readonly origin: string;
  /** Value for `MCP_USE_CLOUD_API_URL`: the origin plus `/api/v1`. */
  readonly apiUrl: string;
  /** Every request received, matched or not, in arrival order. */
  readonly requests: readonly RecordedRequest[];
  /** Requests that matched no route. They were answered with a 501. */
  readonly unhandled: readonly RecordedRequest[];
  /**
   * Answer `method path` with `reply` every time it is called.
   *
   * `path` is the full concrete pathname with no query string, such as
   * `/api/v1/deployments/dep_1`, and must belong to a Cloud route.
   * Registering the same method and path again replaces the route.
   */
  on<M extends CloudMethod, P extends string>(
    method: M,
    path: CheckedPath<M, P>,
    reply: CloudRouteReply<RouteFor<M, P>>
  ): void;
  /**
   * Answer `method path` with each reply in turn, one per call.
   *
   * A call after the last reply is treated as unhandled, so a test that
   * registers two replies also proves the CLI made no third call.
   */
  sequence<M extends CloudMethod, P extends string>(
    method: M,
    path: CheckedPath<M, P>,
    replies: readonly CloudRouteReply<RouteFor<M, P>>[]
  ): void;
  /**
   * Answer a route Cloud does not document, with no typing. Throws when the
   * path is a Cloud route; use `on` for those.
   */
  onUndocumented(method: string, path: string, reply: RouteReply): void;
  /** Requests received for one method and path, in arrival order. */
  requestsTo(method: string, path: string): RecordedRequest[];
  /** Stop the server and drop open connections. */
  close(): Promise<void>;
}

interface Route {
  /** The spec route, or `undefined` for `onUndocumented`. */
  spec: RouteKey | undefined;
  next: () => RouteReply | undefined;
}

/** Start a fake Cloud on a free localhost port. */
export async function startFakeCloud(): Promise<FakeCloud> {
  const routes = new Map<string, Route>();
  const requests: RecordedRequest[] = [];
  const unhandled: RecordedRequest[] = [];

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        const recorded = record(req.method ?? "GET", req.url ?? "/", {
          headers: req.headers,
          rawBody: Buffer.concat(chunks),
        });
        requests.push(recorded);
        const route = routes.get(key(recorded.method, recorded.path));
        const reply = route?.next();
        let response: FakeResponse;
        if (route === undefined || reply === undefined) {
          unhandled.push(recorded);
          response = {
            status: 501,
            body: {
              error: `fake-cloud: no route for ${recorded.method} ${recorded.path}`,
            },
          };
        } else {
          try {
            response = await resolve(reply, recorded, route.spec);
          } catch (error) {
            response = {
              status: 500,
              body: {
                error: `fake-cloud: route handler threw: ${String(error)}`,
              },
            };
          }
        }
        const status =
          response.status ??
          (route?.spec === undefined ? 200 : defaultStatus(route.spec));
        const text =
          response.body === undefined ? "" : JSON.stringify(response.body);
        res.writeHead(status, {
          ...(text !== "" ? { "Content-Type": "application/json" } : {}),
          ...response.headers,
        });
        res.end(text);
      })();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  /** The Cloud route a path belongs to. */
  function specRoute(method: string, path: string): RouteKey {
    const spec = routesMatching(method, path)[0];
    if (spec === undefined) {
      throw new Error(
        `${method} ${path} is not a route in the Cloud spec. ` +
          "Use cloud.onUndocumented() for a route the spec leaves out."
      );
    }
    return spec;
  }

  return {
    origin,
    apiUrl: `${origin}/api/v1`,
    requests,
    unhandled,
    on(method, path, reply) {
      const spec = specRoute(method, path);
      routes.set(key(method, path), {
        spec,
        next: () => reply as RouteReply,
      });
    },
    sequence(method, path, replies) {
      const spec = specRoute(method, path);
      let next = 0;
      routes.set(key(method, path), {
        spec,
        next: () => replies[next++] as RouteReply | undefined,
      });
    },
    onUndocumented(method, path, reply) {
      if (routesMatching(method, path).length > 0) {
        throw new Error(
          `${method} ${path} is in the Cloud spec; register it with cloud.on().`
        );
      }
      routes.set(key(method, path), { spec: undefined, next: () => reply });
    },
    requestsTo(method, path) {
      return requests.filter(
        (request) =>
          request.method === method.toUpperCase() && request.path === path
      );
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function resolve(
  reply: RouteReply,
  request: RecordedRequest,
  spec: RouteKey | undefined
): Promise<FakeResponse> {
  if (typeof reply !== "function") return reply;
  if (spec === undefined) return reply(request);
  const cloudRequest = {
    ...request,
    route: spec,
    params: paramsOf(spec, request.path),
  };
  Object.defineProperty(cloudRequest, "rawBody", { value: request.rawBody });
  return (reply as (request: unknown) => FakeResponse | Promise<FakeResponse>)(
    cloudRequest
  );
}

function paramsOf(spec: RouteKey, path: string): Record<string, string> {
  const template = spec.slice(spec.indexOf(" ") + 1).split("/");
  const segments = path.split("/");
  const params: Record<string, string> = {};
  template.forEach((part, index) => {
    if (part.startsWith("{") && part.endsWith("}")) {
      params[part.slice(1, -1)] = decodeURIComponent(segments[index] ?? "");
    }
  });
  return params;
}

function key(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function record(
  method: string,
  url: string,
  raw: { headers: IncomingHttpHeaders; rawBody: Buffer }
): RecordedRequest {
  const parsed = new URL(url, "http://fake-cloud.invalid");
  const text = raw.rawBody.toString("utf8");
  let body: unknown;
  if (text !== "") {
    const isJson = /\bjson\b/i.test(raw.headers["content-type"] ?? "");
    try {
      body = isJson ? JSON.parse(text) : text;
    } catch {
      body = text;
    }
  }
  const recorded = {
    method: method.toUpperCase(),
    path: parsed.pathname,
    query: Object.fromEntries(parsed.searchParams),
    headers: raw.headers,
    body,
  } as RecordedRequest;
  // Non-enumerable so assertion diffs on requests don't print every byte.
  Object.defineProperty(recorded, "rawBody", { value: raw.rawBody });
  return recorded;
}
