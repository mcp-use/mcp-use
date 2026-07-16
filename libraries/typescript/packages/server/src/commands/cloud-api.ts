import { join } from "node:path";

import {
  CommandError,
  GLOBAL_STATE_DIR,
  readJson,
  removeFile,
  writePrivateJson,
} from "./shared.js";

/** Organization returned by the cloud authentication endpoint. */
export interface CloudOrganization {
  /** Organization id. */
  id: string;
  /** Human-readable organization name. */
  name: string;
  /** URL-safe organization slug. */
  slug: string | null;
  /** Current member's role. */
  role: string;
}

/** Persisted cloud CLI state. */
export interface CloudConfig {
  /** Cloud API key. */
  apiKey?: string;
  /** Active organization id. */
  orgId?: string;
  /** Active organization name. */
  orgName?: string;
  /** Active organization slug. */
  orgSlug?: string;
}

/** Authentication response normalized for CLI consumers. */
export interface CloudIdentity {
  /** User id. */
  userId: string;
  /** User email address. */
  email: string;
  /** Organization memberships. */
  organizations: CloudOrganization[];
  /** Account-default organization id. */
  defaultOrganizationId: string | null;
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

const CONFIG_PATH = join(GLOBAL_STATE_DIR, "config.json");

/** Cloud API base URL. */
export function cloudApiUrl(): string {
  const configured = process.env["MCP_USE_CLOUD_API_URL"];
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

/** Read cloud CLI state. */
export async function readCloudConfig(): Promise<CloudConfig> {
  return readJson(CONFIG_PATH, {});
}

/** Persist cloud CLI state. */
export async function writeCloudConfig(config: CloudConfig): Promise<void> {
  await writePrivateJson(CONFIG_PATH, config);
}

/** Delete cloud CLI state. */
export async function clearCloudConfig(): Promise<void> {
  await removeFile(CONFIG_PATH);
}

/** Resolve an organization id or slug from memberships. */
export function resolveOrganization(
  organizations: readonly CloudOrganization[],
  selector: string
): CloudOrganization {
  const matches = organizations.filter(
    (organization) =>
      organization.id === selector || organization.slug === selector
  );
  if (matches.length !== 1) {
    throw new CommandError(
      matches.length === 0
        ? "organization_not_found"
        : "organization_ambiguous",
      `Organization not found: ${selector}`
    );
  }
  return matches[0]!;
}

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
    const config = await readCloudConfig();
    const apiKey = process.env["MCP_USE_API_KEY"] ?? config.apiKey;
    if (apiKey === undefined || apiKey === "") {
      throw new CommandError(
        "not_authenticated",
        "Not logged in. Run `mcp-use login`."
      );
    }
    return new CloudApi(apiKey, organizationId ?? config.orgId);
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
      throw new CommandError(
        response.status === 401
          ? "not_authenticated"
          : response.status === 403
            ? "forbidden"
            : "cloud_api_error",
        messageFrom(body) ?? `Cloud API request failed (${response.status}).`,
        { status: response.status }
      );
    }
    return body as T;
  }

  /** Verify credentials and return the current identity. */
  async identity(): Promise<CloudIdentity> {
    const response = await this.request<AuthWireResponse>("/test-auth");
    return {
      userId: response.user_id,
      email: response.email,
      organizations: response.profiles.map((profile) => ({
        id: profile.id,
        name: profile.profile_name,
        slug: profile.slug,
        role: profile.role,
      })),
      defaultOrganizationId: response.default_profile_id,
    };
  }

  /** Update the account-default organization. */
  async setDefaultOrganization(organizationId: string): Promise<void> {
    await this.request(`/organizations/${organizationId}/set-default`, {
      method: "POST",
    });
  }
}

/** Create a cloud client for an optional organization id or slug. */
export async function cloudApiForOrganization(
  selector?: string
): Promise<{ api: CloudApi; organizationId: string }> {
  const config = await readCloudConfig();
  const identity = await (await CloudApi.create()).identity();
  const organization =
    selector !== undefined
      ? resolveOrganization(identity.organizations, selector)
      : identity.organizations.find(
          (item) => item.id === (config.orgId ?? identity.defaultOrganizationId)
        );
  if (organization === undefined) {
    throw new CommandError(
      "organization_required",
      "No active organization. Run `mcp-use org use <id-or-slug>`."
    );
  }
  return {
    api: await CloudApi.create(organization.id),
    organizationId: organization.id,
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
