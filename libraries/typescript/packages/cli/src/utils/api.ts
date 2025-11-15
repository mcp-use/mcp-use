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
  uploadId: string;
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
}

export interface UploadResponse {
  uploadId: string;
  size: number;
  filename: string;
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

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API request failed: ${response.status} ${error}`);
    }

    return response.json() as Promise<T>;
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
   * Upload source code tarball
   */
  async uploadSource(filePath: string): Promise<UploadResponse> {
    const { readFile } = await import("node:fs/promises");
    const { basename } = await import("node:path");
    const { FormData, Blob } = await import("node:stream/web");

    const fileBuffer = await readFile(filePath);
    const filename = basename(filePath);

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: "application/gzip" });
    formData.append("file", blob, filename);

    const url = `${this.baseUrl}/uploads`;
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
      throw new Error(`Upload failed: ${error}`);
    }

    return response.json() as Promise<UploadResponse>;
  }
}
