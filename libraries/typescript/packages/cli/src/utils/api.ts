import { getApiKey, getApiUrl, getAuthBaseUrl, getOrgId } from "./config.js";

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

export interface CreateServerBody {
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
  env?: Record<string, string>;
  description?: string;
  tags?: string[];
  region?: string;
}

export interface CreateServerResponse {
  server: { id: string; slug: string | null };
  deploymentId: string | null;
}

// ── Deployments ────────────────────────────────────────────────────

export interface CreateDeploymentInput {
  serverId: string;
  name?: string;
  branch?: string;
  commitSha?: string;
  commitMessage?: string;
  trigger?: "manual" | "webhook" | "redeploy" | "rollback";
  prNumber?: number;
}

export interface CreateDeploymentResponse {
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

export interface BuildLogsResponse {
  logs: string;
  offset: number;
  totalLength: number;
  status: string;
}

// ── GitHub ──────────────────────────────────────────────────────────

export interface GitHubInstallation {
  id: string;
  installation_id: string;
}

export interface GitHubConnectionStatus {
  is_connected: boolean;
  installations?: GitHubInstallation[];
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: {
    login: string;
  };
}

export interface GitHubReposResponse {
  user: {
    login: string;
    id: number;
    avatar_url: string;
  };
  repos: GitHubRepo[];
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
        const err = new Error(
          "Your session has expired or your API key is invalid."
        );
        (err as any).status = 401;
        throw err;
      }

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API request failed: ${response.status} ${error}`);
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

  private async resolveOrganizationId(): Promise<string> {
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

  async listDeployments(): Promise<Deployment[]> {
    return this.request<Deployment[]>("/deployments");
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
      })),
    };
  }

  async getGitHubRepos(_refresh?: boolean): Promise<GitHubReposResponse> {
    const orgId = await this.resolveOrganizationId();
    const installResp = await this.request<{
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

    if (installResp.installations.length === 0) {
      return { user: { login: "", id: 0, avatar_url: "" }, repos: [] };
    }

    const inst = installResp.installations[0];
    const reposResp = await this.request<{
      repos: Array<{
        id: number;
        name: string;
        fullName: string;
        private: boolean;
        ownerAvatarUrl: string | null;
      }>;
    }>(`/github/installations/${inst.installationId}/repos`);

    return {
      user: {
        login: inst.account?.login ?? "",
        id: 0,
        avatar_url: inst.account?.avatar_url ?? "",
      },
      repos: reposResp.repos.map((r) => ({
        id: r.id,
        name: r.name,
        full_name: r.fullName,
        private: r.private,
        owner: { login: r.fullName.split("/")[0] ?? "" },
      })),
    };
  }

  async getGitHubAppName(): Promise<string> {
    if (process.env.MCP_GITHUB_APP_NAME) return process.env.MCP_GITHUB_APP_NAME;
    return this.baseUrl.includes(".dev.") ? "mcp-use-dev" : "mcp-use";
  }
}
