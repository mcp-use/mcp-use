import {
  CLIENT_CAPABILITIES_META_KEY,
  inputRequired,
  inputResponse,
  type AuthInfo,
  type InputRequest,
  type InputRequiredResult,
  type RequestStateAccessor,
  type ServerContext,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";

import type { OAuthExtra } from "./oauth/provider.js";
import { supportsViews } from "./views/capabilities.js";

/**
 * Per-request client capability queries.
 *
 * Reads the modern per-request envelope only — never session state.
 */
export interface RequestClientContext {
  /**
   * Whether this request's client advertises MCP Apps / UI support.
   *
   * True when the client declares the `io.modelcontextprotocol/ui` extension
   * with `text/html;profile=mcp-app` in `mimeTypes`. Legacy (non-envelope)
   * requests always return `false`.
   */
  supportsViews(): boolean;
}

/**
 * Result of a {@link Elicit} call.
 *
 * `required` means the callback must return `result`; the client then gathers
 * input and retries the tool. Accepted form results carry schema-validated,
 * inferred `data`. URL acceptances and declined/cancelled results carry no
 * data.
 */
export type ElicitationResult<T = never> =
  | { status: "required"; result: InputRequiredResult }
  | { status: "decline" | "cancel" }
  | ([T] extends [never]
      ? { status: "accept" }
      : { status: "accept"; data: T });

/**
 * Requests or reads one keyed elicitation in a multi-round-trip tool callback.
 *
 * The explicit key correlates the request with the client's response on
 * re-entry. On the first entry, or after an invalid form response, this returns
 * `{ status: "required", result }`; return that result from the tool. On
 * re-entry it returns `accept`, `decline`, or `cancel` and validates accepted
 * Standard Schema form data before exposing it. Validation may be synchronous
 * or asynchronous.
 *
 * @example
 * ```ts
 * const confirmation = await ctx.elicit(
 *   "confirm",
 *   "Deploy to production?",
 *   schema,
 * );
 * if (confirmation.status === "required") {
 *   return confirmation.result;
 * }
 * ```
 */
export interface Elicit {
  /** Request or read a typed form-mode elicitation. */
  <S extends StandardSchemaWithJSON>(
    key: string,
    message: string,
    schema: S
  ): Promise<ElicitationResult<StandardSchemaWithJSON.InferOutput<S>>>;
  /** Request or read a URL-mode elicitation. */
  (key: string, message: string, url: string): Promise<ElicitationResult>;
}

/**
 * Per-request context passed to tool/resource/prompt callbacks.
 */
export type OAuthAuth<TUser> = {
  user: TUser;
  payload: Record<string, unknown>;
  accessToken: string;
  scopes: string[];
  permissions: string[];
  /**
   * The OAuth client identifier from the token's `client_id` or `azp` claim;
   * undefined when the identity provider's access tokens carry no client claim
   * (e.g. WorkOS AuthKit, Supabase).
   */
  clientId?: string;
  expiresAt: number;
  resource?: URL;
};

type RequestContextBase = {
  /** Aborted when the client cancels the request or the connection drops. */
  signal: AbortSignal;
  /** The originating HTTP request, when served over HTTP. */
  request?: Request;
  /** Per-request client capability queries. */
  client: RequestClientContext;
  /** Request or read a keyed form- or URL-mode elicitation. */
  elicit: Elicit;
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
> = HasOAuth extends true
  ? RequestContextBase & { auth: OAuthAuth<TUser> }
  : RequestContextBase & { auth?: never };

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

function toClientContext(ctx: ServerContext): RequestClientContext {
  const envelopeCaps = ctx.mcpReq.envelope?.[CLIENT_CAPABILITIES_META_KEY];
  return {
    supportsViews(): boolean {
      return supportsViews(envelopeCaps);
    },
  };
}

function createElicit(
  inputResponses: ServerContext["mcpReq"]["inputResponses"]
): Elicit {
  return async function elicit(
    key: string,
    message: string,
    schemaOrUrl?: StandardSchemaWithJSON | string
  ): Promise<ElicitationResult<unknown> | ElicitationResult> {
    let request: InputRequest;
    let formSchema: StandardSchemaWithJSON | undefined;

    if (typeof schemaOrUrl === "string") {
      request = inputRequired.elicitUrl({
        message,
        url: schemaOrUrl,
      });
    } else if (schemaOrUrl !== undefined) {
      formSchema = schemaOrUrl;
      request = inputRequired.elicit({
        message,
        requestedSchema: schemaOrUrl,
      });
    } else {
      throw new TypeError(
        "ctx.elicit(key, message, value) requires a form schema or URL string"
      );
    }

    const response = inputResponse(inputResponses, key);
    if (response.kind === "elicit") {
      if (response.action !== "accept") {
        return { status: response.action };
      }
      if (formSchema === undefined) {
        return { status: "accept" };
      }
      if (response.content !== undefined) {
        const outcome = await formSchema["~standard"].validate(
          response.content
        );
        if (outcome.issues === undefined) {
          return { status: "accept", data: outcome.value };
        }
      }
    }

    return {
      status: "required",
      result: inputRequired({ inputRequests: { [key]: request } }),
    };
  } as Elicit;
}

/**
 * Derive the callback-facing {@link RequestContext} from the SDK's
 * per-request `ServerContext`.
 *
 * @internal
 */
export function toRequestContext(
  ctx: ServerContext
): RequestContext<never, false> {
  const request = ctx.http?.req;
  return {
    signal: ctx.mcpReq.signal,
    ...(request !== undefined && { request }),
    ...(ctx.mcpReq.inputResponses !== undefined && {
      inputResponses: ctx.mcpReq.inputResponses,
    }),
    client: toClientContext(ctx),
    elicit: createElicit(ctx.mcpReq.inputResponses),
    requestState: <T = unknown>() => ctx.mcpReq.requestState<T>(),
    async reportProgress(progress, total, message): Promise<boolean> {
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
    async sendLog(level, data, logger): Promise<void> {
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
}

/** @internal Projects mapped OAuth auth information into callback context. */
export function toAuthenticatedRequestContext<TUser>(
  ctx: ServerContext
): RequestContext<TUser, true> {
  const authInfo = ctx.http?.authInfo;
  requireOAuthAuthInfo<TUser>(authInfo);
  return {
    ...toRequestContext(ctx),
    auth: {
      user: authInfo.extra.user,
      payload: authInfo.extra.payload,
      accessToken: authInfo.token,
      scopes: [...authInfo.scopes],
      permissions: [...authInfo.extra.permissions],
      ...(authInfo.clientId.length > 0 && { clientId: authInfo.clientId }),
      expiresAt: authInfo.expiresAt,
      ...(authInfo.resource !== undefined && { resource: authInfo.resource }),
    },
  };
}
