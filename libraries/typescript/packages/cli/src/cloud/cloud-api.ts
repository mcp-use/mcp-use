import { CommandError } from "../core/errors.js";
import {
  findOrganization,
  listOrganizations,
  defaultOrganizationId,
  type CloudOrganization,
} from "./auth/account.js";
import { callerFor, connectCloud, createCloudClient } from "./api/client.js";
import {
  readAuth,
  requireCredential,
  updateAuth,
  type StoredAuth,
} from "./auth/store.js";

/** Organizations and the dashboard default, for the `org` commands. */
interface CloudIdentity {
  /** Organization memberships. */
  organizations: CloudOrganization[];
  /** Account-default organization id. */
  defaultOrganizationId: string | null;
}

/** Cloud API base URL. */
export function cloudApiUrl(): string {
  const configured =
    process.env["MCP_USE_CLOUD_API_URL"] ?? process.env["MCP_API_URL"];
  const base = configured ?? "https://cloud.manufact.com/api/v1";
  return base.replace(/\/+$/, "").replace(/\/api\/v1$/, "") + "/api/v1";
}

/** Cloud web application URL. */
export function cloudWebUrl(): string {
  return (
    process.env["MCP_USE_CLOUD_WEB_URL"] ?? "https://manufact.com"
  ).replace(/\/+$/, "");
}

/** OAuth base URL hosting device authorization endpoints. */
export function cloudAuthUrl(): string {
  return cloudApiUrl().replace(/\/api\/v1$/, "");
}

/** Read cloud CLI state (`~/.manufact/auth.json`). */
export async function readCloudConfig(): Promise<StoredAuth> {
  return readAuth();
}

/** Merge `config` into the stored cloud CLI state. */
export async function writeCloudConfig(config: StoredAuth): Promise<void> {
  await updateAuth(config);
}

/** Resolve an organization id or slug from memberships. */
export const resolveOrganization = findOrganization;

/** Minimal authenticated cloud API client. */
export class CloudApi {
  readonly #apiKey: string;
  readonly #organizationId: string | undefined;

  private constructor(apiKey: string, organizationId?: string) {
    this.#apiKey = apiKey;
    this.#organizationId = organizationId;
  }

  /** Create a client from persisted credentials. */
  static async create(organizationId?: string): Promise<CloudApi> {
    const { apiKey } = await requireCredential();
    return new CloudApi(
      apiKey,
      organizationId ?? (await readCloudConfig()).orgId
    );
  }

  /** Create a client for validating a candidate API key. */
  static withApiKey(apiKey: string): CloudApi {
    return new CloudApi(apiKey);
  }

  /** Perform an authenticated JSON request. */
  async request<T>(
    path: string,
    init: RequestInit & { organizationId?: string } = {}
  ): Promise<T> {
    const sensitiveValues = requestSensitiveValues(this.#apiKey, init);
    const organizationId = init.organizationId ?? this.#organizationId;
    const response = await fetch(`${cloudApiUrl()}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "x-api-key": this.#apiKey,
        ...(organizationId !== undefined
          ? { "x-profile-id": organizationId }
          : {}),
        ...(init.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...init.headers,
      },
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = text === "" ? undefined : JSON.parse(text);
    } catch {
      body = text;
    }
    if (!response.ok) {
      throw cloudRequestError(
        path,
        response.status,
        redactSensitiveValues(body, sensitiveValues)
      );
    }
    return body as T;
  }

  /**
   * Perform an authenticated multipart request.
   *
   * The runtime supplies the multipart boundary; callers must not set a
   * `Content-Type` header manually.
   *
   * @param path - API path beginning with `/`.
   * @param form - Multipart fields and files to upload.
   * @param init - Optional method and timeout overrides.
   * @returns The decoded JSON response.
   */
  async multipartRequest<T>(
    path: string,
    form: FormData,
    init: { method?: string; timeoutMs?: number } = {}
  ): Promise<T> {
    const sensitiveValues = formSensitiveValues(this.#apiKey, form);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      init.timeoutMs ?? 120_000
    );
    try {
      const response = await fetch(`${cloudApiUrl()}${path}`, {
        method: init.method ?? "POST",
        headers: {
          Accept: "application/json",
          "x-api-key": this.#apiKey,
          ...(this.#organizationId !== undefined
            ? { "x-profile-id": this.#organizationId }
            : {}),
        },
        body: form,
        signal: controller.signal,
      });
      const text = await response.text();
      let body: unknown;
      try {
        body = text === "" ? undefined : JSON.parse(text);
      } catch {
        body = text;
      }
      if (!response.ok) {
        throw cloudRequestError(
          path,
          response.status,
          redactSensitiveValues(body, sensitiveValues)
        );
      }
      return body as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new CommandError(
          "cloud_api_timeout",
          `Cloud upload timed out after ${(init.timeoutMs ?? 120_000) / 1000} seconds.`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Verify credentials and return the user's organizations. */
  async identity(): Promise<CloudIdentity> {
    const api = {
      client: createCloudClient({ apiKey: this.#apiKey }),
      call: callerFor(this.#apiKey),
    };
    const [organizations, defaultId] = await Promise.all([
      listOrganizations(api),
      defaultOrganizationId(api),
    ]);
    return { organizations, defaultOrganizationId: defaultId };
  }

  /** Update the account-default organization. */
  async setDefaultOrganization(organizationId: string): Promise<void> {
    await this.request(`/organizations/${organizationId}/set-default`, {
      method: "POST",
    });
  }
}

/** Create a cloud client for an optional organization id or slug. */
export async function cloudApiForOrganization(selector?: string): Promise<{
  api: CloudApi;
  organizationId: string;
  organizationSlug: string | null;
}> {
  const { organization } = await connectCloud({ organization: selector });
  return {
    api: await CloudApi.create(organization.id),
    organizationId: organization.id,
    organizationSlug: organization.slug,
  };
}

function messageFrom(body: unknown): string | undefined {
  if (typeof body === "string" && body !== "") return body;
  if (body === null || typeof body !== "object") return undefined;
  for (const key of ["message", "error", "detail"]) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

function cloudRequestError(
  path: string,
  status: number,
  body: unknown
): CommandError {
  const message = messageFrom(body) ?? `Cloud API request failed (${status}).`;
  const details = {
    status,
    ...(apiValidationDetails(body) !== undefined
      ? { validation: apiValidationDetails(body) }
      : {}),
  };
  if (status === 401) {
    return new CommandError("not_authenticated", message, details);
  }
  if (status === 403) {
    return new CommandError("forbidden", message, details);
  }
  if (status === 404 && /^\/servers(?:\/|$)/.test(path)) {
    return new CommandError("server_not_found", message, details);
  }
  if (status === 404 && /^\/deployments(?:\/|$)/.test(path)) {
    return new CommandError("deployment_not_found", message, details);
  }
  const stop = path.match(/^\/deployments\/([^/]+)\/stop$/);
  if (stop !== null) {
    const id = decodeURIComponent(stop[1] ?? "");
    return new CommandError("deployment_stop_failed", message, {
      ...details,
      nextSteps: [
        {
          description: "Inspect the deployment state",
          command: `mcp-use deployments get ${id} --json`,
        },
        {
          description: "Delete the deployment instead",
          command: `mcp-use deployments delete ${id} --yes --json`,
        },
      ],
    });
  }
  if (status === 400 || status === 422) {
    return new CommandError("validation_error", message, details);
  }
  return new CommandError("cloud_api_error", message, details);
}

function apiValidationDetails(body: unknown): unknown {
  if (body === null || typeof body !== "object") return undefined;
  const details = (body as Record<string, unknown>)["details"];
  if (
    details === null ||
    (typeof details !== "object" && !Array.isArray(details))
  ) {
    return undefined;
  }
  return details;
}

function requestSensitiveValues(
  apiKey: string,
  init: RequestInit
): Set<string> {
  const values = new Set<string>([apiKey]);
  const headers = new Headers(init.headers);
  for (const name of ["authorization", "x-api-key"]) {
    const value = headers.get(name);
    if (value !== null) values.add(value);
  }
  if (typeof init.body === "string") {
    try {
      collectSensitiveFields(JSON.parse(init.body), values);
    } catch {
      // An opaque text body is not expected from this JSON client.
    }
  }
  return values;
}

function formSensitiveValues(apiKey: string, form: FormData): Set<string> {
  const values = new Set<string>([apiKey]);
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string") continue;
    if (/^(?:env|environment|environmentVariables)$/i.test(key)) {
      try {
        collectAllStrings(JSON.parse(value), values);
      } catch {
        values.add(value);
      }
    } else if (isSensitiveField(key)) {
      values.add(value);
    }
  }
  return values;
}

function collectSensitiveFields(
  value: unknown,
  output: Set<string>,
  sensitiveContext = false
): void {
  if (typeof value === "string") {
    if (sensitiveContext) output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSensitiveFields(item, output, sensitiveContext);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    const nestedSensitive =
      sensitiveContext ||
      isSensitiveField(key) ||
      /^(?:env|environment|environmentVariables)$/i.test(key);
    collectSensitiveFields(item, output, nestedSensitive);
  }
}

function collectAllStrings(value: unknown, output: Set<string>): void {
  if (typeof value === "string") {
    output.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectAllStrings(item, output);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) collectAllStrings(item, output);
  }
}

function isSensitiveField(key: string): boolean {
  return /(?:authorization|api[-_]?key|password|secret|token|value)/i.test(key);
}

function redactSensitiveValues(
  value: unknown,
  sensitiveValues: ReadonlySet<string>
): unknown {
  if (typeof value === "string") {
    let result = value;
    for (const secret of sensitiveValues) {
      if (secret !== "") result = result.replaceAll(secret, "[REDACTED]");
    }
    return result;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValues(item, sensitiveValues));
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      redactSensitiveValues(item, sensitiveValues),
    ])
  );
}
