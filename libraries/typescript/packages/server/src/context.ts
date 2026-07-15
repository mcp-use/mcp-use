import {
  CLIENT_CAPABILITIES_META_KEY,
  inputRequired,
  inputResponse,
  type AuthInfo,
  type InputRequiredResult,
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

/** Options for a typed v2 form elicitation round. */
export interface FormInputOptions<
  TSchema extends StandardSchemaWithJSON = StandardSchemaWithJSON,
> {
  /** Stable key used to correlate this form across request rounds. */
  key: string;
  /** Human-readable question shown by the client. */
  message: string;
  /** Synchronously or asynchronously validating Standard Schema. */
  schema: TSchema;
  /** Optional opaque state echoed on the next round. Integrity-protect it if load-bearing. */
  requestState?: string;
}

/** Result of resolving a typed form elicitation round. */
export type FormInputResult<TValue> =
  | { status: "required"; result: InputRequiredResult }
  | { status: "accepted"; value: TValue }
  | { status: "declined" }
  | { status: "cancelled" }
  | { status: "invalid"; issues: readonly unknown[] };

/** High-level typed input helpers for v2 multi-round-trip requests. */
export interface RequestInputContext {
  /**
   * Resolve a form response or return the `input_required` result the handler
   * should return directly.
   */
  form<TSchema extends StandardSchemaWithJSON>(
    options: FormInputOptions<TSchema>
  ): Promise<FormInputResult<StandardSchemaWithJSON.InferOutput<TSchema>>>;
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
  /** Typed v2 multi-round-trip input helpers. */
  input: RequestInputContext;
  /** Responses supplied by the client during a v2 multi-round-trip request. */
  inputResponses?: ServerContext["mcpReq"]["inputResponses"];
  /** Opaque state echoed by the client during a v2 multi-round-trip request. */
  requestState?: ServerContext["mcpReq"]["requestState"];
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

function toInputContext(ctx: ServerContext): RequestInputContext {
  return {
    async form<TSchema extends StandardSchemaWithJSON>(
      options: FormInputOptions<TSchema>
    ): Promise<FormInputResult<StandardSchemaWithJSON.InferOutput<TSchema>>> {
      const response = inputResponse(ctx.mcpReq.inputResponses, options.key);
      if (response.kind === "missing") {
        return {
          status: "required",
          result: inputRequired({
            inputRequests: {
              [options.key]: inputRequired.elicit({
                message: options.message,
                requestedSchema: options.schema,
              }),
            },
            ...(options.requestState !== undefined && {
              requestState: options.requestState,
            }),
          }),
        };
      }
      if (response.kind !== "elicit") {
        return {
          status: "invalid",
          issues: [{ message: `Unexpected ${response.kind} input response` }],
        };
      }
      if (response.action === "decline") return { status: "declined" };
      if (response.action === "cancel") return { status: "cancelled" };
      if (response.content === undefined) {
        return {
          status: "invalid",
          issues: [{ message: "Accepted form response has no content" }],
        };
      }
      const outcome = await options.schema["~standard"].validate(
        response.content
      );
      return outcome.issues === undefined
        ? {
            status: "accepted",
            value: outcome.value as StandardSchemaWithJSON.InferOutput<TSchema>,
          }
        : { status: "invalid", issues: outcome.issues };
    },
  };
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
    ...(ctx.mcpReq.requestState !== undefined && {
      requestState: ctx.mcpReq.requestState,
    }),
    client: toClientContext(ctx),
    input: toInputContext(ctx),
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
