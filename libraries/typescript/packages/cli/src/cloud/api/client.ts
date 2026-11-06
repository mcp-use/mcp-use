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
import {
  cloudApiUrl,
  readCloudConfig,
  type CloudOrganization,
} from "../cloud-api.js";
import { CommandError, type NextStep } from "../../core/errors.js";

/** Cloud origin. Generated paths already start with `/api/...`. */
function cloudBaseUrl(): string {
  return cloudApiUrl().replace(/\/api\/v1$/, "");
}

/** What a failed call means for one command. */
interface CallContext {
  /** Error code and next steps for a 404, e.g. `deployment_not_found`. */
  notFound?: { code: string; nextSteps?: readonly NextStep[] };
}

/** The shape every typed fetch method resolves to. */
interface CloudResult<T> {
  data?: T | undefined;
  error?: unknown;
  response?: Response;
}

/** Awaits a typed fetch call; see {@link CloudConnection.call}. */
type Call = <T>(
  pending: Promise<CloudResult<T>>,
  context?: CallContext
) => Promise<Exclude<T, undefined>>;

/** A `call` that keeps `apiKey` out of error messages. */
function callerFor(apiKey: string): Call {
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
        error.message.replaceAll(apiKey, "[REDACTED]"),
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
    throw new CommandError("not_authenticated", message, undefined, [
      { description: "Log in to Manufact Cloud", command: "mcp-use login" },
    ]);
  }
  if (status === 403) throw new CommandError("forbidden", message);
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
  /** Pass as `{ client }` to typed fetch methods. */
  client: Client<paths>;
  /** The organization requests act on. */
  organization: CloudOrganization;
  /**
   * Await a typed fetch call and return its data, or throw a
   * `CommandError` with a stable code: `cloud_unreachable`,
   * `not_authenticated`, `forbidden`, `context.notFound.code` (default
   * `not_found`), `validation_error`, `rate_limited` or `cloud_api_error`.
   */
  call: Call;
}

interface AuthWireResponse {
  user_id: string;
  email: string;
  profiles: Array<{
    id: string;
    profile_name: string;
    slug: string | null;
    role: string;
  }>;
  default_profile_id: string | null;
}

/**
 * Connect with the saved or `MCP_USE_API_KEY` credentials, scoped to the
 * active organization, else the account default.
 */
export async function connectCloud(): Promise<CloudConnection> {
  const config = await readCloudConfig();
  const apiKey = process.env["MCP_USE_API_KEY"] ?? config.apiKey;
  if (apiKey === undefined || apiKey === "") {
    throw new CommandError(
      "not_authenticated",
      "Not logged in to Manufact Cloud.",
      undefined,
      [{ description: "Log in", command: "mcp-use login" }]
    );
  }
  const call = callerFor(apiKey);

  // `/api/v1/test-auth` is not in the OpenAPI document; the auth PR in the
  // CLI rewrite replaces this identity lookup.
  const identity = await call(
    fetch(`${cloudBaseUrl()}/api/v1/test-auth`, {
      headers: { Accept: "application/json", "x-api-key": apiKey },
    }).then(async (response) => {
      const body: unknown = await response.json();
      return response.ok
        ? { data: body as AuthWireResponse, response }
        : { error: body, response };
    })
  );
  const organizations = identity.profiles.map((profile) => ({
    id: profile.id,
    name: profile.profile_name,
    slug: profile.slug,
    role: profile.role,
  }));
  const activeId = config.orgId ?? identity.default_profile_id;
  const organization = organizations.find((item) => item.id === activeId);
  if (organization === undefined) {
    throw new CommandError(
      "organization_required",
      "No active organization.",
      undefined,
      [
        {
          description: "List your organizations",
          command: "mcp-use org list --json",
        },
      ]
    );
  }
  return {
    client: createCloudClient(apiKey, organization.id),
    organization,
    call,
  };
}

function createCloudClient(
  apiKey: string,
  organizationId?: string
): Client<paths> {
  return createClient<paths>({
    baseUrl: cloudBaseUrl(),
    headers: {
      Accept: "application/json",
      "x-api-key": apiKey,
      ...(organizationId !== undefined
        ? { "x-profile-id": organizationId }
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
