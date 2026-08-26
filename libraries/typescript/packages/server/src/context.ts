import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  type AuthInfo,
  type ClientCapabilities,
  type Implementation,
  type RequestStateAccessor,
  type ServerContext,
} from "@modelcontextprotocol/server";
import type { Context, Env, HonoRequest as HonoRequestType } from "hono";
import { HonoRequest } from "hono/request";

import { getRequestBag } from "./fetch-app.js";
import type { OAuthExtra } from "./oauth/provider.js";
import { supportsViews } from "./views/capabilities.js";

/**
 * OpenAI-specific end-user hints declared in request metadata.
 *
 * All fields are optional, client-reported, and unverified. Use
 * {@link OAuthAuth.user} for an authenticated identity.
 */
export interface UserContext {
  /** Requested BCP 47 locale from `openai/locale` or legacy `webplus/i18n`. */
  locale?: string;
  /** Best-effort browser or host identifier from `openai/userAgent`. */
  userAgent?: string;
  /** Coarse end-user location from `openai/userLocation`. */
  location?: {
    /** City name, when supplied. */
    city?: string;
    /** Region or state name, when supplied. */
    region?: string;
    /** Country identifier, when supplied. */
    country?: string;
    /** IANA timezone identifier, when supplied. */
    timezone?: string;
    /** Approximate latitude; clients may encode coordinates as strings or numbers. */
    latitude?: string | number;
    /** Approximate longitude; clients may encode coordinates as strings or numbers. */
    longitude?: string | number;
  };
  /** Client-reported subject hint from `openai/subject`. */
  subject?: string;
  /** Client-reported conversation hint from `openai/session`. */
  conversationId?: string;
  /** Client-reported organization hint from `openai/organization`. */
  organizationId?: string;
}

/**
 * Per-request client metadata and capability queries.
 *
 * Reads only the current request's metadata — never session state.
 */
export interface RequestClientContext {
  /**
   * Checks whether this request declares a top-level client capability.
   *
   * @param capability - Capability name such as `sampling`, `elicitation`,
   * `roots`, or `extensions`.
   * @returns `true` when the current request advertises the capability.
   *
   * @example
   * ```ts
   * if (ctx.client.can("elicitation")) {
   *   // Shape the result for an elicitation-capable client.
   * }
   * ```
   */
  can(capability: string): boolean;
  /**
   * Returns the capabilities declared by the client for this request.
   *
   * The returned object is a shallow copy. Requests without the modern
   * metadata envelope return an empty object.
   *
   * @example
   * ```ts
   * const capabilities = ctx.client.capabilities();
   * const supportsFormElicitation = capabilities.elicitation?.form !== undefined;
   * ```
   */
  capabilities(): ClientCapabilities;
  /**
   * Returns one extension settings object declared for this request.
   *
   * @param id - Namespaced extension identifier, such as
   * `io.modelcontextprotocol/ui`.
   * @returns A shallow copy of the extension settings, or `undefined` when the
   * current request does not advertise the extension.
   *
   * @example
   * ```ts
   * const ui = ctx.client.extension("io.modelcontextprotocol/ui");
   * ```
   */
  extension(
    id: string
  ): NonNullable<ClientCapabilities["extensions"]>[string] | undefined;
  /**
   * Returns the client implementation metadata declared for this request.
   *
   * Valid modern requests include `name` and `version`. The partial return
   * type preserves v1 ergonomics for legacy requests without an envelope.
   * The returned object is a shallow copy.
   *
   * @example
   * ```ts
   * const { name, version } = ctx.client.info();
   * ```
   */
  info(): Partial<Implementation>;
  /**
   * Returns normalized OpenAI-specific end-user hints for this request.
   *
   * The data comes from ordinary request `_meta`, not the MCP client-info
   * envelope. It is client-reported and must not be used for authentication
   * or authorization. Each call returns a fresh object, including a fresh
   * location object. Requests without recognized metadata return `undefined`.
   *
   * @example
   * ```ts
   * const caller = ctx.client.user();
   * const locale = caller?.locale ?? "en";
   * ```
   */
  user(): UserContext | undefined;
  /**
   * Whether this request's client advertises MCP Apps / UI support.
   *
   * True when the client declares the `io.modelcontextprotocol/ui` extension
   * with `text/html;profile=mcp-app` in `mimeTypes`. Legacy (non-envelope)
   * requests always return `false`.
   *
   * @example
   * ```ts
   * if (ctx.client.supportsViews()) {
   *   // Return a view-optimized result.
   * }
   * ```
   */
  supportsViews(): boolean;
}

/**
 * Per-request context passed to tool/resource/prompt callbacks.
 */
export type OAuthAuth<TUser> = {
  /** Authenticated application user mapped by the OAuth provider. */
  user: TUser;
  /** Verified access-token claims or introspection data. */
  payload: Record<string, unknown>;
  /** Raw bearer token for authenticated downstream requests. */
  accessToken: string;
  /**
   * Upstream provider access token when authentication is mediated by
   * `oauthProxy()`. Never contains an upstream refresh or ID token.
   */
  providerAccessToken?: string;
  /** OAuth scopes granted to the access token. */
  scopes: string[];
  /** Provider-normalized permissions granted to the user. */
  permissions: string[];
  /**
   * The OAuth client identifier from the token's `client_id` or `azp` claim;
   * undefined when the identity provider's access tokens carry no client claim
   * (e.g. WorkOS AuthKit, Supabase).
   */
  clientId?: string;
  /** Access-token expiration as Unix time in seconds. */
  expiresAt: number;
  /** Resource audience the access token authorizes, when supplied. */
  resource?: URL;
};

type RequestContextBase<TEnv extends Env> = Omit<Context<TEnv>, "req"> & {
  /** Aborted when the client cancels the request or the connection drops. */
  signal: AbortSignal;
  /** Hono request for the originating HTTP exchange. Its raw Web Request is available as `request.raw`. */
  request?: HonoRequestType;
  /**
   * Deprecated v1-compatible alias for {@link RequestContext.request}.
   *
   * @deprecated Use `request` instead.
   */
  req?: HonoRequestType;
  /** Per-request client capability queries. */
  client: RequestClientContext;
  /**
   * Bare responses supplied when the client retries an `input_required`
   * round. Values are client input; validate them before use.
   */
  inputResponses?: ServerContext["mcpReq"]["inputResponses"];
  /**
   * Read opaque state echoed by the client for this `input_required` round.
   * The generic is only a type assertion. Configure `requestState.verify`
   * when state affects authorization or business logic.
   */
  requestState: RequestStateAccessor;
  /**
   * Sends a one-way notification related to the current MCP request.
   *
   * The notification is delivered on the originating request's response
   * stream and must be sent before the callback returns. Use the
   * `server.notifyToolsChanged()` and related server helpers for
   * cross-request list or resource invalidations.
   *
   * @param method - Application-defined notification method.
   * @param params - Optional JSON-serializable notification parameters.
   * @returns A promise that resolves after the notification is sent.
   *
   * @example
   * ```ts
   * await ctx.sendNotification("com.example/import-status", {
   *   status: "started",
   * });
   * ```
   */
  sendNotification(
    method: string,
    params?: Record<string, unknown>
  ): Promise<void>;
  /**
   * Report request-scoped progress when the caller supplied a progress token.
   *
   * @returns `true` when a notification was sent, `false` when the caller did
   * not request progress.
   */
  reportProgress(
    progress: number,
    total?: number,
    message?: string
  ): Promise<boolean>;
  /** Send a log message notification to the client during tool execution. */
  sendLog(
    level:
      | "debug"
      | "info"
      | "notice"
      | "warning"
      | "error"
      | "critical"
      | "alert"
      | "emergency",
    data: unknown,
    logger?: string
  ): Promise<void>;
};

/**
 * Per-request callback context, authenticated when OAuth is configured.
 */
export type RequestContext<
  TUser = never,
  HasOAuth extends boolean = false,
  TEnv extends Env = Env,
> = HasOAuth extends true
  ? RequestContextBase<TEnv> & { auth: OAuthAuth<TUser> }
  : RequestContextBase<TEnv> & { auth?: never };

type MappedOAuthAuthInfo<TUser> = AuthInfo & {
  expiresAt: number;
  extra: OAuthExtra<TUser>;
};

function requireOAuthAuthInfo<TUser>(
  authInfo: AuthInfo | undefined
): asserts authInfo is MappedOAuthAuthInfo<TUser> {
  if (
    authInfo === undefined ||
    authInfo.extra === undefined ||
    authInfo.expiresAt === undefined
  ) {
    throw new Error("OAuth callback did not receive mapped AuthInfo.extra");
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function coordinateValue(value: unknown): string | number | undefined {
  if (typeof value === "string") return value;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeUserContext(
  meta: ServerContext["mcpReq"]["_meta"]
): UserContext | undefined {
  if (meta === undefined) return undefined;

  const locale =
    stringValue(meta["openai/locale"]) ?? stringValue(meta["webplus/i18n"]);
  const userAgent = stringValue(meta["openai/userAgent"]);
  const subject = stringValue(meta["openai/subject"]);
  const conversationId = stringValue(meta["openai/session"]);
  const organizationId = stringValue(meta["openai/organization"]);
  const rawLocation = meta["openai/userLocation"];
  let location: UserContext["location"];
  if (
    typeof rawLocation === "object" &&
    rawLocation !== null &&
    !Array.isArray(rawLocation)
  ) {
    const values = rawLocation as Record<string, unknown>;
    const normalized = {
      city: stringValue(values.city),
      region: stringValue(values.region),
      country: stringValue(values.country),
      timezone: stringValue(values.timezone),
      latitude: coordinateValue(values.latitude),
      longitude: coordinateValue(values.longitude),
    };
    const entries = Object.entries(normalized).filter(
      (entry): entry is [keyof typeof normalized, string | number] =>
        entry[1] !== undefined
    );
    if (entries.length > 0) {
      location = Object.fromEntries(entries) as UserContext["location"];
    }
  }

  if (
    locale === undefined &&
    userAgent === undefined &&
    location === undefined &&
    subject === undefined &&
    conversationId === undefined &&
    organizationId === undefined
  ) {
    return undefined;
  }

  return {
    ...(locale !== undefined && { locale }),
    ...(userAgent !== undefined && { userAgent }),
    ...(location !== undefined && { location }),
    ...(subject !== undefined && { subject }),
    ...(conversationId !== undefined && { conversationId }),
    ...(organizationId !== undefined && { organizationId }),
  };
}

/**
 * SDK beta.5 currently emits RequestMetaEnvelope as `{}` even though the
 * validated runtime envelope carries these required modern fields. Keep the
 * declaration workaround contained at this projection boundary.
 */
function requestEnvelope(ctx: ServerContext):
  | {
      [CLIENT_CAPABILITIES_META_KEY]?: ClientCapabilities;
      [CLIENT_INFO_META_KEY]?: Implementation;
    }
  | undefined {
  return ctx.mcpReq.envelope as
    | {
        [CLIENT_CAPABILITIES_META_KEY]?: ClientCapabilities;
        [CLIENT_INFO_META_KEY]?: Implementation;
      }
    | undefined;
}

/**
 * The requesting client's advertised identity for this request.
 *
 * Read from the per-request `_meta` envelope, so it is the identity of the
 * client that sent *this* request. Empty on 2025-era (legacy) traffic, which
 * carries no per-request envelope.
 *
 * @param ctx - SDK per-request server context.
 * @returns The declared `clientInfo`, or an empty object when the request
 * carried none.
 *
 * @internal
 */
export function requestClientInfo(ctx: ServerContext): Partial<Implementation> {
  return { ...(requestEnvelope(ctx)?.[CLIENT_INFO_META_KEY] ?? {}) };
}

function toClientContext(ctx: ServerContext): RequestClientContext {
  const envelope = requestEnvelope(ctx);
  const capabilities: ClientCapabilities = {
    ...(envelope?.[CLIENT_CAPABILITIES_META_KEY] ?? {}),
  };
  const info: Partial<Implementation> = requestClientInfo(ctx);
  const user = normalizeUserContext(ctx.mcpReq._meta);
  return {
    can(capability: string): boolean {
      return Object.hasOwn(capabilities, capability);
    },
    capabilities(): ClientCapabilities {
      return { ...capabilities };
    },
    extension(
      id: string
    ): NonNullable<ClientCapabilities["extensions"]>[string] | undefined {
      const settings = capabilities.extensions?.[id];
      return settings === undefined ? undefined : { ...settings };
    },
    info(): Partial<Implementation> {
      return { ...info };
    },
    user(): UserContext | undefined {
      return user === undefined
        ? undefined
        : {
            ...user,
            ...(user.location !== undefined && {
              location: { ...user.location },
            }),
          };
    },
    supportsViews(): boolean {
      return supportsViews(capabilities);
    },
  };
}

/**
 * Derive the callback-facing {@link RequestContext} from the SDK's
 * per-request `ServerContext`.
 *
 * @internal
 */
export function toRequestContext<TEnv extends Env = Env>(
  ctx: ServerContext
): RequestContext<never, false, TEnv> {
  const rawRequest = ctx.http?.req;
  const http =
    rawRequest === undefined
      ? undefined
      : (getRequestBag(rawRequest).honoContext as Context<TEnv> | undefined);
  const request: HonoRequestType | undefined =
    http?.req ??
    (rawRequest === undefined
      ? undefined
      : (new HonoRequest(rawRequest) as HonoRequestType));
  const additions = {
    signal: ctx.mcpReq.signal,
    ...(request !== undefined && { request }),
    ...(ctx.mcpReq.inputResponses !== undefined && {
      inputResponses: ctx.mcpReq.inputResponses,
    }),
    client: toClientContext(ctx),
    requestState: <T = unknown>() => ctx.mcpReq.requestState<T>(),
    async sendNotification(
      method: string,
      params?: Record<string, unknown>
    ): Promise<void> {
      await ctx.mcpReq.notify({
        method,
        ...(params !== undefined && { params }),
      });
    },
    async reportProgress(
      progress: number,
      total?: number,
      message?: string
    ): Promise<boolean> {
      const progressToken = ctx.mcpReq._meta?.progressToken;
      if (progressToken === undefined) return false;
      await ctx.mcpReq.notify({
        method: "notifications/progress",
        params: {
          progressToken,
          progress,
          ...(total !== undefined && { total }),
          ...(message !== undefined && { message }),
        },
      });
      return true;
    },
    async sendLog(
      level: Parameters<RequestContextBase<TEnv>["sendLog"]>[0],
      data: unknown,
      logger?: string
    ): Promise<void> {
      await ctx.mcpReq.notify({
        method: "notifications/message",
        params: {
          level,
          data,
          ...(logger !== undefined && { logger }),
        },
      });
    },
  };
  if (http !== undefined) {
    return Object.assign(http, additions) as RequestContext<never, false, TEnv>;
  }
  return {
    ...additions,
    ...(request !== undefined && { req: request }),
  } as RequestContext<never, false, TEnv>;
}

/** @internal Projects mapped OAuth auth information into callback context. */
export function toAuthenticatedRequestContext<TUser, TEnv extends Env = Env>(
  ctx: ServerContext
): RequestContext<TUser, true, TEnv> {
  const authInfo = ctx.http?.authInfo;
  requireOAuthAuthInfo<TUser>(authInfo);
  return Object.assign(toRequestContext<TEnv>(ctx), {
    auth: {
      user: authInfo.extra.user,
      payload: authInfo.extra.payload,
      accessToken: authInfo.token,
      ...(authInfo.extra.providerAccessToken !== undefined && {
        providerAccessToken: authInfo.extra.providerAccessToken,
      }),
      scopes: [...authInfo.scopes],
      permissions: [...authInfo.extra.permissions],
      ...(authInfo.clientId.length > 0 && { clientId: authInfo.clientId }),
      expiresAt: authInfo.expiresAt,
      ...(authInfo.resource !== undefined && { resource: authInfo.resource }),
    },
  });
}
