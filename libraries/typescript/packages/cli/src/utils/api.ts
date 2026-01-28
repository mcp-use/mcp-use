import { getApiKey, getApiUrl } from "./config.js";

export interface APIKeyCreateRequest {
  name: string;
}

export interface APIKeyCreateResponse {
  api_key: string;
  name: string;
}

export interface AuthTestResponse {
  message: string;
  user_id: string;
  email: string;
}

export interface GitHubSource {
  type: "github";
  repo: string;
  branch?: string;
  startCommand?: string;
  runtime?: "node" | "python";
  port?: number;
  env?: Record<string, string>;
  buildCommand?: string;
  baseImage?: string;
  githubCheckRunId?: number;
}

export interface UploadSource {
  type: "upload";
  startCommand?: string;
  runtime?: "node" | "python";
  port?: number;
  env?: Record<string, string>;
  buildCommand?: string;
  baseImage?: string;
}

export type DeploymentSource = GitHubSource | UploadSource;

export interface CreateDeploymentRequest {
  name: string;
  source: DeploymentSource;
  customDomain?: string;
  healthCheckPath?: string;
  serverId?: string;
}

export interface Deployment {
  id: string;
  userId: string;
  name: string;
  source: DeploymentSource;
  domain?: string;
  customDomain?: string;
  port: number;
  createdAt: string;
  updatedAt: string;
  status: "pending" | "building" | "running" | "stopped" | "failed";
  healthCheckPath?: string;
  provider?: string;
  appName?: string;
  error?: string;
  buildLogs?: string;
  buildStartedAt?: string;
  buildCompletedAt?: string;
  gitCommitSha?: string;
  gitBranch?: string;
  gitCommitMessage?: string;
  serverId?: string;
  serverSlug?: string; // Computed field from backend
}

export interface UpdateDeploymentRequest {
  name?: string;
  customDomain?: string;
  env?: Record<string, string>;
  status?: "running" | "stopped";
}
export interface RedeploymentConfig {
  buildCommand?: string;
  startCommand?: string;
  port?: number;
  env?: Record<string, string>;
}

export interface DeploymentListResponse {
  deployments: Deployment[];
  total: number;
}

export interface LogsResponse {
  success: boolean;
  data: {
    logs: string;
  };
}

export interface GitHubInstallation {
  id: string;
  installation_id: string;
}

export interface GitHubConnectionStatus {
  is_connected: boolean;
  installations?: GitHubInstallation[];
}

export interface GitHubAppNameResponse {
  app_name: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: {
    login: string;
  };
  branches?: Array<{
    name: string;
    commit: {
      sha: string;
    };
  }>;
}

export interface GitHubReposResponse {
  user: {
    login: string;
    id: number;
    avatar_url: string;
  };
  repos: GitHubRepo[];
}

/**
 * API client for mcp-use cloud
 */
export class McpUseAPI {
  private baseUrl: string;
  private apiKey: string | undefined;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl || "";
    this.apiKey = apiKey;
  }

  /**
   * Initialize API client with config
   */
  static async create(): Promise<McpUseAPI> {
    const baseUrl = await getApiUrl();
    const apiKey = await getApiKey();
    return new McpUseAPI(baseUrl, apiKey ?? undefined);
  }

  /**
   * Make authenticated request
   */
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

    // Add timeout support (default 30 seconds)
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

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API request failed: ${response.status} ${error}`);
      }

      return response.json() as Promise<T>;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        throw new Error(
          `Request timeout after ${timeout / 1000}s. Try using --follow flag to stream logs instead.`
        );
      }
      throw error;
    }
  }

  /**
   * Create API key using JWT token
   */
  async createApiKey(
    jwtToken: string,
    name: string = "CLI"
  ): Promise<APIKeyCreateResponse> {
    const url = `${this.baseUrl}/api-key`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create API key: ${response.status} ${error}`);
    }

    return response.json() as Promise<APIKeyCreateResponse>;
  }

  /**
   * Test authentication
   */
  async testAuth(): Promise<AuthTestResponse> {
    return this.request<AuthTestResponse>("/test-auth");
  }

  /**
   * Create deployment
   */
  async createDeployment(
    request: CreateDeploymentRequest
  ): Promise<Deployment> {
    return this.request<Deployment>("/deployments", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /**
   * Get deployment by ID
   */
  async getDeployment(deploymentId: string): Promise<Deployment> {
    return this.request<Deployment>(`/deployments/${deploymentId}`);
  }

  /**
   * Stream deployment logs
   */
  async *streamDeploymentLogs(
    deploymentId: string
  ): AsyncGenerator<string, void, unknown> {
    const url = `${this.baseUrl}/deployments/${deploymentId}/logs/stream`;
    const headers: Record<string, string> = {};

    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`Failed to stream logs: ${response.status}`);
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (parsed.log) {
                yield parsed.log;
              } else if (parsed.error) {
                throw new Error(parsed.error);
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Create deployment with source code upload
   */
  async createDeploymentWithUpload(
    request: CreateDeploymentRequest,
    filePath: string
  ): Promise<Deployment> {
    const { readFile } = await import("node:fs/promises");
    const { basename } = await import("node:path");
    const { stat } = await import("node:fs/promises");

    // Check file size (2MB max)
    const stats = await stat(filePath);
    const maxSize = 2 * 1024 * 1024; // 2MB
    if (stats.size > maxSize) {
      throw new Error(
        `File size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum of 2MB`
      );
    }

    const fileBuffer = await readFile(filePath);
    const filename = basename(filePath);

    // Build form data with deployment request and file
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: "application/gzip" });
    formData.append("source_file", blob, filename);
    formData.append("name", request.name);
    formData.append("source_type", "upload");

    if (request.source.type === "upload") {
      formData.append("runtime", request.source.runtime || "node");
      formData.append("port", String(request.source.port || 3000));
      if (request.source.startCommand) {
        formData.append("startCommand", request.source.startCommand);
      }
      if (request.source.buildCommand) {
        formData.append("buildCommand", request.source.buildCommand);
      }
      if (request.source.env && Object.keys(request.source.env).length > 0) {
        formData.append("env", JSON.stringify(request.source.env));
      }
    }

    if (request.customDomain) {
      formData.append("customDomain", request.customDomain);
    }
    if (request.healthCheckPath) {
      formData.append("healthCheckPath", request.healthCheckPath);
    }

    const url = `${this.baseUrl}/deployments`;
    const headers: Record<string, string> = {};

    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Deployment failed: ${error}`);
    }

    return response.json() as Promise<Deployment>;
  }

  /**
   * List all deployments
   */
  async listDeployments(): Promise<Deployment[]> {
    const response = await this.request<DeploymentListResponse>("/deployments");
    return response.deployments;
  }

  /**
   * Delete deployment
   */
  async deleteDeployment(deploymentId: string): Promise<void> {
    await this.request(`/deployments/${deploymentId}`, {
      method: "DELETE",
    });
  }

  /**
   * Update deployment
   */
  async updateDeployment(
    deploymentId: string,
    updates: UpdateDeploymentRequest
  ): Promise<Deployment> {
    return this.request<Deployment>(`/deployments/${deploymentId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  /**
   * Redeploy deployment
   *
   * @param deploymentId - The deployment ID to redeploy
   * @param configOrFilePath - Either a RedeploymentConfig object with updated settings,
   *                           or a file path string for source code upload
   */
  async redeployDeployment(
    deploymentId: string,
    configOrFilePath?: RedeploymentConfig | string
  ): Promise<Deployment> {
    // If it's a string, treat it as a file path (backward compatibility)
    if (typeof configOrFilePath === "string") {
      const filePath = configOrFilePath;

      // Redeploy with file upload (for local source)
      const { readFile } = await import("node:fs/promises");
      const { basename } = await import("node:path");
      const { stat } = await import("node:fs/promises");

      // Check file size
      const stats = await stat(filePath);
      const maxSize = 2 * 1024 * 1024;
      if (stats.size > maxSize) {
        throw new Error(
          `File size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum of 2MB`
        );
      }

      const fileBuffer = await readFile(filePath);
      const formData = new FormData();
      const blob = new Blob([fileBuffer], { type: "application/gzip" });
      formData.append("source_file", blob, basename(filePath));

      const headers: Record<string, string> = {};
      if (this.apiKey) headers["x-api-key"] = this.apiKey;

      const response = await fetch(
        `${this.baseUrl}/deployments/${deploymentId}/redeploy`,
        {
          method: "POST",
          headers,
          body: formData,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Redeploy failed: ${error}`);
      }
      return response.json();
    }

    // If it's a config object or undefined, use JSON body
    const config = configOrFilePath as RedeploymentConfig | undefined;

    return this.request<Deployment>(`/deployments/${deploymentId}/redeploy`, {
      method: "POST",
      body: config ? JSON.stringify(config) : undefined,
    });
  }

  /**
   * Get deployment logs
   */
  async getDeploymentLogs(deploymentId: string): Promise<string> {
    const response = await this.request<LogsResponse>(
      `/deployments/${deploymentId}/logs`,
      { timeout: 60000 } // 60 second timeout for logs
    );
    return response.data.logs;
  }

  /**
   * Get deployment build logs
   */
  async getDeploymentBuildLogs(deploymentId: string): Promise<string> {
    const response = await this.request<LogsResponse>(
      `/deployments/${deploymentId}/logs/build`,
      { timeout: 60000 } // 60 second timeout for logs
    );
    return response.data.logs;
  }

  /**
   * Get GitHub connection status
   */
  async getGitHubConnectionStatus(): Promise<GitHubConnectionStatus> {
    return this.request<GitHubConnectionStatus>("/github/connection");
  }

  /**
   * Get GitHub app name
   */
  async getGitHubAppName(): Promise<string> {
    const response =
      await this.request<GitHubAppNameResponse>("/github/appname");
    return response.app_name;
  }

  /**
   * Get accessible GitHub repositories
   */
  async getGitHubRepos(refresh: boolean = false): Promise<GitHubReposResponse> {
    return this.request<GitHubReposResponse>(
      `/github/repos${refresh ? "?refresh=true" : ""}`
    );
  }
}
