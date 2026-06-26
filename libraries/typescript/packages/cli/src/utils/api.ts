import { getApiKey, getApiUrl, getAuthBaseUrl, getOrgId } from "./config.js";

export class GitHubAuthRequiredError extends Error {
  readonly authorizeUrl: string;
  constructor(message: string, authorizeUrl: string) {
    super(message);
    this.name = "GitHubAuthRequiredError";
    this.authorizeUrl = authorizeUrl;
  }
}

/** Thrown when the API returns 401 (invalid or expired API key for this backend). */
export class ApiUnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(
    message = "Your session has expired or your API key is invalid."
  ) {
    super(message);
    this.name = "ApiUnauthorizedError";
  }
}

export interface OrgInfo {
  id: string;
  name: string;
  slug: string | null;
  role: string;
}

export interface AuthTestResponse {
  message: string;
  user_id: string;
  email: string;
  orgs: OrgInfo[];
  default_org_id: string | null;
}

/** Wire format returned by GET /test-auth (cli-compat route). */
interface AuthTestWireResponse {
  message: string;
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

// ── Server creation ────────────────────────────────────────────────

interface CreateServerBody {
  type: "github";
  organizationId: string;
  installationId: string;
  name: string;
  repoFullName: string;
  branch?: string;
  rootDir?: string;
  port?: number;
  buildCommand?: string;
  startCommand?: string;
  /** Path to a non-default Dockerfile, relative to rootDir (or repo root). */
  dockerfilePath?: string;
  env?: Record<string, string>;
  description?: string;
  tags?: string[];
  region?: string;
  /** Glob patterns; only matching repo changes trigger auto-deploy. Empty = all changes. */
  watchPaths?: string[];
  /** When true, GitHub auto-deploy waits for other check runs to succeed. */
  waitForCi?: boolean;
}

interface CreateServerResponse {
  server: { id: string; slug: string | null };
  deploymentId: string | null;
}

// ── Server update ──────────────────────────────────────────────────

/**
 * Body for `PATCH /servers/:id`. Field names mirror the backend
 * `UpdateServerBody` exactly. `productionBranch` controls which branch
 * triggers production deploys; build/start command overrides live nested
 * under `config` (the backend merges `config` shallowly with the existing
 * value, so only the provided keys change).
 */
export interface UpdateServerBody {
  name?: string;
  description?: string;
  productionBranch?: string;
  tags?: string[];
  /** Glob patterns; only matching repo changes trigger auto-deploy. Empty array = all changes. */
  watchPaths?: string[];
  /** Branch globs for webhook auto-deploys; empty array allows all branches. */
  deployBranchPatterns?: string[];
  /** When true, GitHub auto-deploy waits for other check runs to succeed. */
  waitForCi?: boolean;
  config?: Record<string, unknown>;
}

/** Connected GitHub repository (subset of OpenAPI server payload). */
interface CloudServerConnectedRepository {
  id: string;
  /** Null for platform-managed repos — the API never exposes the managed repo path. */
  repoFullName: string | null;
  productionBranch: string;
  /** Glob patterns limiting which repo changes trigger auto-deploy. Empty = all changes. */
  watchPaths?: string[];
  /** Branch globs for webhook auto-deploys. Empty = all branches. */
  deployBranchPatterns?: string[];
  /** When true, GitHub auto-deploy waits for other check runs to succeed. */
  waitForCi?: boolean;
  isActive: boolean;
  /** True when deployed via the platform-managed org (no user GitHub). */
  isManaged?: boolean;
  userId: string;
  githubInstallationId: string;
  createdAt: string;
  updatedAt: string;
}

/** Server record from `GET /servers` or `GET /servers/{id}` (fields used by CLI). */
interface CloudServer {
  id: string;
  slug: string | null;
  organizationId: string;
  userId: string | null;
  connectedRepositoryId: string;
  connectedRepository?: CloudServerConnectedRepository;
  name: string | null;
  description: string | null;
  tags?: string[];
  config?: unknown;
  createdAt: string;
  updatedAt: string;
  displayPreferences?: { icon?: string; color?: string };
  status: string;
  latestDeploymentStatus: string | null;
  activeDeploymentId: string | null;
  previousDeploymentId: string | null;
  region: string;
  providerRegion?: string;
  runProvider?: string;
  buildProvider?: string;
  /** Public MCP endpoint when provisioned (preferred over synthesizing from id/slug). */
  mcpUrl?: string | null;
  domains?: unknown[];
  deployments?: unknown[];
  _count?: { deployments?: number };
}

// ── Deployments ────────────────────────────────────────────────────

interface CreateDeploymentInput {
  serverId: string;
  name?: string;
  branch?: string;
  commitSha?: string;
  commitMessage?: string;
  trigger?: "manual" | "webhook" | "redeploy" | "rollback";
  prNumber?: number;
}

interface CreateDeploymentResponse {
  id: string;
}

export interface Deployment {
  id: string;
  userId: string;
  name: string;
  source: unknown;
  status: "pending" | "building" | "running" | "stopped" | "failed";
  port: number | null;
  healthCheckPath: string | null;
  provider: string;
  appName: string;
  error: string | null;
  gitCommitSha: string | null;
  gitBranch: string | null;
  gitCommitMessage: string | null;
  isProductionDeployment: boolean | null;
  deploymentTrigger: string | null;
  serverId: string | null;
  createdAt: string;
  updatedAt: string;
  buildStartedAt: string | null;
  buildCompletedAt: string | null;
  archivedAt: string | null;
  mcpUrl?: string;
}

interface BuildLogsResponse {
  logs: string;
  offset: number;
  totalLength: number;
  status: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  skip: number;
}

interface PaginationParams {
  limit?: number;
  skip?: number;
}

interface SortablePaginationParams extends PaginationParams {
  sort?: string;
}

function normalizePaginatedResponse<T>(
  response: PaginatedResponse<T> | T[],
  params?: PaginationParams
): PaginatedResponse<T> {
  if (Array.isArray(response)) {
    return {
      items: response,
      total: response.length,
      limit: params?.limit ?? response.length,
      skip: params?.skip ?? 0,
    };
  }

  return {
    items: response.items,
    total: response.total,
    limit: response.limit,
    skip: response.skip,
  };
}

function buildPaginationQuery(
  params?: SortablePaginationParams & { organizationId?: string }
): string {
  const search = new URLSearchParams();
  if (params?.organizationId) {
    search.set("organizationId", params.organizationId);
  }
  if (params?.limit != null) {
    search.set("limit", String(params.limit));
  }
  if (params?.skip != null) {
    search.set("skip", String(params.skip));
  }
  if (params?.sort) {
    search.set("sort", params.sort);
  }
  const q = search.toString();
  return q ? `?${q}` : "";
}

// ── GitHub ──────────────────────────────────────────────────────────

interface GitHubInstallation {
  id: string;
  installation_id: string;
  account_login: string;
  account_type: string;
}

export interface GitHubConnectionStatus {
  is_connected: boolean;
  installations?: GitHubInstallation[];
}

// ── Env Variables ───────────────────────────────────────────────────

export type EnvEnvironment = "production" | "preview" | "development";

export interface EnvVariable {
  id: string;
  serverId: string;
  key: string;
  /** `null` for write-only `sensitive` rows — the API withholds the stored value. */
  value: string | null;
  environments: EnvEnvironment[];
  /** Branch pin: null/omitted = production scope; a branch name = that branch's preview. */
  branch?: string | null;
  sensitive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CreateEnvVariableBody {
  key: string;
  value: string;
  environments?: EnvEnvironment[];
  /** Branch pin (body field). Null/omitted = production scope. */
  branch?: string | null;
  sensitive?: boolean;
}

interface UpdateEnvVariableBody {
  value?: string;
  environments?: EnvEnvironment[];
  /** Branch pin (body field). Null/omitted = production scope. */
  branch?: string | null;
  sensitive?: boolean;
}

// ── API client ─────────────────────────────────────────────────────

export class McpUseAPI {
  private baseUrl: string;
  private apiKey: string | undefined;
  private orgId: string | undefined;

  constructor(baseUrl?: string, apiKey?: string, orgId?: string) {
    this.baseUrl = baseUrl || "";
    this.apiKey = apiKey;
    this.orgId = orgId;
  }

  static async create(): Promise<McpUseAPI> {
    const baseUrl = await getApiUrl();
    const apiKey = await getApiKey();
    const orgId = await getOrgId();
    return new McpUseAPI(baseUrl, apiKey ?? undefined, orgId ?? undefined);
  }

  setOrgId(orgId: string): void {
    this.orgId = orgId;
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      timeout?: number;
    } = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }

    if (this.orgId) {
      headers["x-profile-id"] = this.orgId;
    }

    const timeout = options.timeout || 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 401) {
        throw new ApiUnauthorizedError();
      }

      if (!response.ok) {
        const errorText = await response.text();
        try {
          const parsed = JSON.parse(errorText);
          if (parsed.code === "GITHUB_AUTH_REQUIRED" && parsed.authorizeUrl) {
            throw new GitHubAuthRequiredError(
              parsed.error || "GitHub authorization required",
              parsed.authorizeUrl
            );
          }
        } catch (e) {
          if (e instanceof GitHubAuthRequiredError) throw e;
        }
        throw new Error(`API request failed: ${response.status} ${errorText}`);
      }

      return response.json() as Promise<T>;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        throw new Error(`Request timeout after ${timeout / 1000}s.`);
      }
      throw error;
    }
  }

  /**
   * Create a persistent API key using a Better Auth access token.
   */
  async createApiKeyWithAccessToken(
    accessToken: string,
    name: string = "CLI"
  ): Promise<{ key: string }> {
    const authBase = await getAuthBaseUrl();
    const url = `${authBase}/api/auth/api-key/create`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name, prefix: "mcp_" }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create API key: ${response.status} ${error}`);
    }

    return response.json() as Promise<{ key: string }>;
  }

  // ── Auth ────────────────────────────────────────────────────────

  async testAuth(): Promise<AuthTestResponse> {
    const wire = await this.request<AuthTestWireResponse>("/test-auth");
    return {
      message: wire.message,
      user_id: wire.user_id,
      email: wire.email,
      default_org_id: wire.default_profile_id,
      orgs: (wire.profiles ?? []).map((p) => ({
        id: p.id,
        name: p.profile_name,
        slug: p.slug,
        role: p.role,
      })),
    };
  }

  async setDefaultOrg(orgId: string): Promise<void> {
    await this.request(`/organizations/${orgId}/set-default`, {
      method: "POST",
    });
  }

  // ── Organization ID resolution ──────────────────────────────────

  async resolveOrganizationId(): Promise<string> {
    if (this.orgId) return this.orgId;
    const auth = await this.testAuth();
    const id = auth.default_org_id;
    if (!id) {
      throw new Error(
        "No organization set. Run `mcp-use org switch` or use --org to specify one."
      );
    }
    return id;
  }

  // ── Servers ─────────────────────────────────────────────────────

  async createServer(body: CreateServerBody): Promise<CreateServerResponse> {
    return this.request<CreateServerResponse>("/servers", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /** Multipart helper: POST/PUT a tarball + fields without the JSON Content-Type. */
  private async uploadMultipart<T>(
    endpoint: string,
    form: FormData,
    timeout = 120000
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      "x-mcp-creation-location": "cli",
    };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    if (this.orgId) headers["x-profile-id"] = this.orgId;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.status === 401) throw new ApiUnauthorizedError();
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} ${errorText}`);
      }
      return response.json() as Promise<T>;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        throw new Error(`Request timeout after ${timeout / 1000}s.`);
      }
      throw error;
    }
  }

  /**
   * Create a server from a source tarball deployed into the platform-managed
   * GitHub org (no user GitHub connection required).
   */
  async createServerFromManagedUpload(input: {
    organizationId: string;
    name: string;
    repoName: string;
    tarball: Buffer;
    branch?: string;
    commitMessage?: string;
    port?: number;
    env?: Record<string, string>;
  }): Promise<CreateServerResponse> {
    const form = new FormData();
    form.set(
      "sourceFile",
      new Blob([new Uint8Array(input.tarball)], { type: "application/gzip" }),
      "source.tar.gz"
    );
    form.set("organizationId", input.organizationId);
    form.set("managed", "true");
    form.set("name", input.name);
    form.set("repoName", input.repoName);
    form.set("private", "true");
    form.set("branch", input.branch ?? "main");
    form.set("commitMessage", input.commitMessage ?? "Deploy from mcp-use CLI");
    if (input.port != null) form.set("port", String(input.port));
    if (input.env && Object.keys(input.env).length > 0) {
      form.set("env", JSON.stringify(input.env));
    }
    return this.uploadMultipart<CreateServerResponse>("/servers", form);
  }

  /** Push a new source tarball as a commit on an existing server's repo. */
  async pushSourceToServer(
    serverId: string,
    input: { tarball: Buffer; branch?: string; commitMessage?: string }
  ): Promise<{
    commitSha: string;
    repoFullName: string | null;
    branch: string;
  }> {
    const form = new FormData();
    form.set(
      "sourceFile",
      new Blob([new Uint8Array(input.tarball)], { type: "application/gzip" }),
      "source.tar.gz"
    );
    form.set("branch", input.branch ?? "main");
    form.set(
      "commitMessage",
      input.commitMessage ?? "Redeploy from mcp-use CLI"
    );
    return this.uploadMultipart(
      `/servers/${encodeURIComponent(serverId)}/source`,
      form
    );
  }

  async listServers(params?: {
    organizationId?: string;
    limit?: number;
    skip?: number;
    sort?: string;
  }): Promise<PaginatedResponse<CloudServer>> {
    const response = await this.request<
      PaginatedResponse<CloudServer> | CloudServer[]
    >(`/servers${buildPaginationQuery(params)}`);
    return normalizePaginatedResponse(response, params);
  }

  async getServer(idOrSlug: string): Promise<CloudServer> {
    const path = encodeURIComponent(idOrSlug);
    return this.request<CloudServer>(`/servers/${path}`);
  }

  async updateServer(
    idOrSlug: string,
    body: UpdateServerBody
  ): Promise<CloudServer> {
    return this.request<CloudServer>(
      `/servers/${encodeURIComponent(idOrSlug)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      }
    );
  }

  async deleteServer(id: string): Promise<void> {
    await this.request<{ success: boolean }>(
      `/servers/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      }
    );
  }

  // ── Env Variables ────────────────────────────────────────────────

  async listEnvVariables(
    serverId: string,
    opts?: { branch?: string }
  ): Promise<EnvVariable[]> {
    const q = opts?.branch ? `?branch=${encodeURIComponent(opts.branch)}` : "";
    return this.request<EnvVariable[]>(
      `/servers/${encodeURIComponent(serverId)}/env-variables${q}`
    );
  }

  async createEnvVariable(
    serverId: string,
    body: CreateEnvVariableBody
  ): Promise<EnvVariable> {
    return this.request<EnvVariable>(
      `/servers/${encodeURIComponent(serverId)}/env-variables`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
  }

  async updateEnvVariable(
    serverId: string,
    varId: string,
    body: UpdateEnvVariableBody
  ): Promise<EnvVariable> {
    return this.request<EnvVariable>(
      `/servers/${encodeURIComponent(serverId)}/env-variables/${encodeURIComponent(varId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      }
    );
  }

  async deleteEnvVariable(serverId: string, varId: string): Promise<void> {
    await this.request<{ success: boolean }>(
      `/servers/${encodeURIComponent(serverId)}/env-variables/${encodeURIComponent(varId)}`,
      { method: "DELETE" }
    );
  }

  // ── Deployments ─────────────────────────────────────────────────

  async createDeployment(
    input: CreateDeploymentInput
  ): Promise<CreateDeploymentResponse> {
    return this.request<CreateDeploymentResponse>("/deployments", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getDeployment(deploymentId: string): Promise<Deployment> {
    return this.request<Deployment>(`/deployments/${deploymentId}`);
  }

  async listDeployments(
    params?: SortablePaginationParams
  ): Promise<PaginatedResponse<Deployment>> {
    const response = await this.request<
      PaginatedResponse<Deployment> | Deployment[]
    >(`/deployments${buildPaginationQuery(params)}`);
    return normalizePaginatedResponse(response, params);
  }

  async deleteDeployment(deploymentId: string): Promise<void> {
    await this.request(`/deployments/${deploymentId}`, {
      method: "DELETE",
    });
  }

  async stopDeployment(deploymentId: string): Promise<void> {
    await this.request(`/deployments/${deploymentId}/stop`, {
      method: "POST",
    });
  }

  async getDeploymentLogs(
    deploymentId: string,
    lines: number = 500
  ): Promise<string> {
    const resp = await this.request<{ logs: string }>(
      `/deployments/${deploymentId}/logs?lines=${lines}`,
      { timeout: 60000 }
    );
    return resp.logs;
  }

  async getDeploymentBuildLogs(
    deploymentId: string,
    offset: number = 0
  ): Promise<BuildLogsResponse> {
    return this.request<BuildLogsResponse>(
      `/deployments/${deploymentId}/build-logs?offset=${offset}`,
      { timeout: 60000 }
    );
  }

  // ── GitHub ──────────────────────────────────────────────────────

  async getGitHubConnectionStatus(): Promise<GitHubConnectionStatus> {
    const orgId = await this.resolveOrganizationId();
    const resp = await this.request<{
      installations: Array<{
        id: string;
        installationId: string;
        account: {
          login: string;
          avatar_url: string | null;
          type: string;
        } | null;
      }>;
    }>(`/github/installations?organizationId=${orgId}`);
    return {
      is_connected: resp.installations.length > 0,
      installations: resp.installations.map((i) => ({
        id: i.id,
        installation_id: i.installationId,
        account_login: i.account?.login ?? "",
        account_type: i.account?.type ?? "User",
      })),
    };
  }

  /**
   * Returns true if the GitHub App can access `${owner}/${repo}` via any of the
   * organization's installations.
   *
   * An organization can have multiple GitHub installations (e.g. a personal
   * account and one or more GitHub orgs), so we check across all of them.
   *
   * Each check is a single authoritative backend call (`repos.get` with the
   * installation token) rather than listing repos. The old listing approach
   * only returned the first page — so a repo on a later page was wrongly
   * reported inaccessible — and fully paginating it hung on very large orgs.
   * We try the installation whose account matches the repo owner first to
   * minimize GitHub calls.
   */
  async checkGitHubRepoAccess(owner: string, repo: string): Promise<boolean> {
    const status = await this.getGitHubConnectionStatus();
    const installations = status.installations ?? [];
    if (installations.length === 0) return false;

    const ownerLower = owner.toLowerCase();
    const ordered = [...installations].sort((a, b) => {
      const aMatch = a.account_login.toLowerCase() === ownerLower ? 0 : 1;
      const bMatch = b.account_login.toLowerCase() === ownerLower ? 0 : 1;
      return aMatch - bMatch;
    });

    for (const installation of ordered) {
      const hasAccess = await this.installationCanAccessRepo(
        installation.installation_id,
        owner,
        repo
      );
      if (hasAccess) return true;
    }
    return false;
  }

  private async installationCanAccessRepo(
    installationId: string,
    owner: string,
    repo: string
  ): Promise<boolean> {
    try {
      const resp = await this.request<{ hasAccess: boolean }>(
        `/github/installations/${installationId}/repos/${encodeURIComponent(
          owner
        )}/${encodeURIComponent(repo)}/access`
      );
      return resp.hasAccess;
    } catch {
      return false;
    }
  }

  async getGitHubAppName(): Promise<string> {
    if (process.env.MCP_GITHUB_APP_NAME) return process.env.MCP_GITHUB_APP_NAME;
    if (this.baseUrl.includes("localhost")) return "mcp-use-local";
    if (this.baseUrl.includes(".dev.")) return "mcp-use-dev";
    return "mcp-use";
  }

  /**
   * Returns the GitHub numeric installation ID (not the DB UUID) for the org.
   * Used for building direct installation settings URLs.
   */
  async getGitHubInstallationId(): Promise<string | null> {
    const status = await this.getGitHubConnectionStatus();
    return status.installations?.[0]?.installation_id ?? null;
  }

  async createGitHubRepo(opts: {
    installationId: string;
    name: string;
    private?: boolean;
    org?: string;
  }): Promise<{ fullName: string; cloneUrl: string; htmlUrl: string }> {
    return this.request<{
      fullName: string;
      cloneUrl: string;
      htmlUrl: string;
    }>(`/github/installations/${opts.installationId}/repos`, {
      method: "POST",
      body: JSON.stringify({
        name: opts.name,
        private: opts.private ?? true,
        org: opts.org,
      }),
    });
  }

  async getGitHubOAuthUrl(): Promise<{ url: string; state: string }> {
    return this.request<{ url: string; state: string }>(
      "/github/oauth/authorize"
    );
  }

  async exchangeGitHubOAuthToken(
    code: string
  ): Promise<{ success: boolean; installationsUpdated: number }> {
    return this.request<{ success: boolean; installationsUpdated: number }>(
      "/github/oauth/token",
      {
        method: "POST",
        body: JSON.stringify({ code }),
      }
    );
  }
}
