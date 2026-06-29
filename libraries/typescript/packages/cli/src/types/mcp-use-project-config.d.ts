declare module "mcp-use/project-config" {
  export interface McpUseProjectConfig {
    $schema?: string;
    version: 1;
    name?: string;
    entry: string;
    mcpDir?: string;
    viewsDir: string;
    publicDir: string;
    outDir: string;
    dev: {
      port: number;
      openInspector: boolean;
      tunnel: boolean;
    };
    build: {
      command: string;
      startCommand: string;
      port: number;
    };
    cloud: {
      serverSlug?: string;
      organization?: string | null;
      region: "AUTO" | "US" | "EU" | "APAC";
      productionBranch: string;
      watchPaths: string[];
      deployBranchPatterns: string[];
      waitForCi: boolean;
      serverId?: string;
    };
    env: {
      files: string[];
      syncOnDeploy: string[];
    };
    eval: {
      specs: string[];
      defaultRunner: "local" | "cloud" | "chatgpt";
      baselineDir: string;
      outputDir: string;
      reporters: string[];
      trace: "always" | "on-failure" | "never";
      includeRawModelOutputs: boolean;
      redactSecrets: boolean;
      cloud: {
        writePointer: boolean;
      };
      ci: {
        junit: boolean;
        html: boolean;
        retentionDays: number;
      };
    };
  }

  export interface LoadedMcpUseProjectConfig {
    config: McpUseProjectConfig;
    path: string;
    source: "file" | "defaults";
  }

  export interface McpUseProjectConfigValidationIssue {
    path: string;
    message: string;
  }

  export interface McpUseProjectConfigValidationResult {
    ok: boolean;
    path: string;
    source: "file" | "defaults";
    issues: McpUseProjectConfigValidationIssue[];
    config?: McpUseProjectConfig;
  }

  export interface McpUseWorkspacePaths {
    workspaceDir: string;
    buildDir: string;
    serverBuildDir: string;
    viewsBuildDir: string;
    manifestPath: string;
    generatedDir: string;
    toolRegistryPath: string;
    cacheDir: string;
    viewsCacheDir: string;
    metadataCacheDir: string;
    viteCacheDir: string;
    stateDir: string;
    tunnelStatePath: string;
    sessionsPath: string;
    cloudDir: string;
    cloudLinkPath: string;
    evalRunsDir: string;
    screenshotsDir: string;
    logsDir: string;
    legacyManifestPath: string;
  }

  export interface McpUseProjectConfigLocalDiff {
    mode: "local";
    project: {
      path: string;
      source: "file" | "defaults";
      name?: string;
      cloud: McpUseProjectConfig["cloud"];
    };
    link: {
      path: string;
      exists: boolean;
      serverId?: string;
      deploymentId?: string;
      deploymentName?: string;
      deploymentUrl?: string;
      linkedAt?: string;
    };
    env: Record<
      "MCP_USE_API_KEY" | "MCP_USE_ORG_ID" | "MCP_USE_SERVER_ID",
      { present: boolean; description: string }
    >;
    differences: Array<{
      field: string;
      config?: unknown;
      link?: unknown;
      env?: unknown;
    }>;
  }

  export function loadMcpUseProjectConfig(
    projectRoot?: string
  ): Promise<LoadedMcpUseProjectConfig>;

  export function validateMcpUseProjectConfig(
    projectRoot?: string
  ): Promise<McpUseProjectConfigValidationResult>;

  export function diffMcpUseProjectConfigLocal(
    projectRoot?: string,
    env?: NodeJS.ProcessEnv
  ): Promise<McpUseProjectConfigLocalDiff>;

  export function resolveMcpUseWorkspacePaths(
    projectRoot?: string,
    config?: Pick<McpUseProjectConfig, "outDir" | "eval">
  ): McpUseWorkspacePaths;
}
