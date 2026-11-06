/**
 * Cloud transport, authentication and error mapping. API declarations in
 * `./generated` come from `scripts/generate-cloud-client.mjs`.
 *
 * It owns the three things the generated code must not decide: the base URL
 * (`MCP_USE_CLOUD_API_URL`), the auth headers, and how a failed request maps
 * onto the CLI's error shape (`CommandError` with a stable `code`):
 *
 * ```ts
 * const cloud = await connectCloud();
 * const deployment = await cloud.call(
 *   cloud.client.GET("/api/v1/deployments/{id}", { params: { path: { id } } }),
 *   { notFound: { code: "deployment_not_found" } }
 * );
 * ```
 *
 * Only cloud commands import this module; `dev`, `build` and `start` never
 * load it.
 */
// Bundled into the CLI artifact, like the tunnel transport.
// eslint-disable-next-line import/no-extraneous-dependencies
import createClient, { type Client } from "openapi-fetch";

import type { paths } from "./generated/types.gen.js";
import { cloudApiUrl } from "../cloud-api.js";
import {
  chooseOrganization,
  listOrganizations,
  organizationRequired,
  type CloudOrganization,
} from "../auth/account.js";
import { readAuth, requireCredential, LOG_IN } from "../auth/store.js";
import { CommandError, type NextStep } from "../../core/errors.js";

/** Cloud origin. Generated paths already start with `/api/...`. */
function cloudBaseUrl(): string {
  return cloudApiUrl().replace(/\/api\/v1$/, "");
}

/** What a failed call means for one command. */
interface CallContext {
  /** Error code and next steps for a 404, e.g. `deployment_not_found`. */
  notFound?: { code: string; nextSteps?: readonly NextStep[] };
  /** Error code and next steps for a 403. Defaults to `forbidden`. */
  forbidden?: { code: string; nextSteps?: readonly NextStep[] };
}

/** The shape every typed fetch function resolves to. */
interface CloudResult<T> {
  data?: T | undefined;
  error?: unknown;
  response?: Response;
}

/** Awaits a typed fetch call; see {@link CloudConnection.call}. */
export type Call = <T>(
  pending: Promise<CloudResult<T>>,
  context?: CallContext
) => Promise<Exclude<T, undefined>>;

/** A `call` that keeps `secret` (an API key or token) out of error messages. */
export function callerFor(secret: string): Call {
  return async (pending, context = {}) => {
    try {
      const result = await pending.catch((error: unknown) => {
        throw new CommandError(
          "cloud_unreachable",
          `Could not reach Manufact Cloud at ${cloudBaseUrl()}: ${messageOf(error) ?? "network error"}.`
        );
      });
      return settle(result, context);
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      throw new CommandError(
        error.code,
        error.message.replaceAll(secret, "[REDACTED]"),
        undefined,
        error.nextSteps
      );
    }
  };
}

function settle<T>(
  result: CloudResult<T>,
  context: CallContext
): Exclude<T, undefined> {
  const { response } = result;
  if (response === undefined) {
    throw new CommandError(
      "cloud_unreachable",
      `Could not reach Manufact Cloud at ${cloudBaseUrl()}: ${messageOf(result.error) ?? "network error"}.`
    );
  }
  if (response.ok) return result.data as Exclude<T, undefined>;

  const status = response.status;
  const message =
    messageOf(result.error) ?? `Manufact Cloud request failed (${status}).`;
  if (status === 401) {
    throw new CommandError("not_authenticated", message, undefined, [LOG_IN]);
  }
  if (status === 403) {
    throw new CommandError(
      context.forbidden?.code ?? "forbidden",
      message,
      undefined,
      context.forbidden?.nextSteps
    );
  }
  if (status === 404) {
    throw new CommandError(
      context.notFound?.code ?? "not_found",
      message,
      undefined,
      context.notFound?.nextSteps
    );
  }
  if (status === 400 || status === 422) {
    throw new CommandError("validation_error", message);
  }
  if (status === 429) throw new CommandError("rate_limited", message);
  throw new CommandError("cloud_api_error", message);
}

/** An authenticated client scoped to one organization. */
interface CloudConnection {
  /** Calls infer parameters and responses from the route. */
  client: Client<paths>;
  /** The organization requests act on. */
  organization: CloudOrganization;
  /** The API key requests are signed with. */
  apiKey: string;
  /**
   * Await a typed fetch call and return its data, or throw a
   * `CommandError` with a stable code: `cloud_unreachable`,
   * `not_authenticated`, `forbidden` (or `context.forbidden.code`),
   * `context.notFound.code` (default `not_found`), `validation_error`,
   * `rate_limited` or `cloud_api_error`.
   */
  call: Call;
}

/**
 * Connect with the current credential (see `auth/store.ts`), scoped to
 * `options.organization` (an id or slug) when given, else the active
 * organization.
 */
export async function connectCloud(
  options: { organization?: string | undefined } = {}
): Promise<CloudConnection> {
  const { apiKey } = await requireCredential();
  const api = {
    client: createCloudClient({ apiKey }),
    call: callerFor(apiKey),
  };
  const organizations = await listOrganizations(api);
  const organization = await chooseOrganization(api, organizations, {
    selector: options.organization,
    storedId: (await readAuth()).orgId,
  });
  if (organization === undefined) throw organizationRequired();
  return {
    client: createCloudClient({ apiKey, organizationId: organization.id }),
    organization,
    apiKey,
    call: api.call,
  };
}

/**
 * A typed fetch client for Cloud. `apiKey` signs requests as the key's
 * user; `bearer` signs them with a short-lived login token instead.
 */
export function createCloudClient(auth: {
  apiKey?: string;
  bearer?: string;
  organizationId?: string;
}): Client<paths> {
  return createClient<paths>({
    baseUrl: cloudBaseUrl(),
    headers: {
      Accept: "application/json",
      ...(auth.apiKey !== undefined ? { "x-api-key": auth.apiKey } : {}),
      ...(auth.bearer !== undefined
        ? { Authorization: `Bearer ${auth.bearer}` }
        : {}),
      ...(auth.organizationId !== undefined
        ? { "x-profile-id": auth.organizationId }
        : {}),
    },
  });
}

/** The message in a Cloud error body (`{ error, code, details }`). */
function messageOf(error: unknown): string | undefined {
  if (typeof error === "string") return error === "" ? undefined : error;
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? error.cause.message : "";
    return cause === "" ? error.message : `${error.message} (${cause})`;
  }
  if (error === null || typeof error !== "object") return undefined;
  for (const key of ["error", "message", "detail"]) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}
