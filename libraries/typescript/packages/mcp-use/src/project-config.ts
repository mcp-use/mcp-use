import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const MCP_USE_CONFIG_FILENAME = "mcp-use.json";
export const MCP_USE_WORKSPACE_DIR = ".mcp-use";
export const MCP_USE_SCHEMA_URL = "https://schema.mcp-use.dev/mcp-use.v1.json";

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

export const DEFAULT_MCP_USE_PROJECT_CONFIG: McpUseProjectConfig = {
  $schema: MCP_USE_SCHEMA_URL,
  version: 1,
  entry: "src/index.ts",
  mcpDir: "src/mcp",
  viewsDir: "resources",
  publicDir: "public",
  outDir: ".mcp-use/build",
  dev: {
    port: 3000,
    openInspector: true,
    tunnel: false,
  },
  build: {
    command: "mcp-use build",
    startCommand: "mcp-use start",
    port: 3000,
  },
  cloud: {
    organization: null,
    region: "AUTO",
    productionBranch: "main",
    watchPaths: ["src/**", "resources/**"],
    deployBranchPatterns: ["feature/*"],
    waitForCi: false,
  },
  env: {
    files: [".env"],
    syncOnDeploy: [],
  },
  eval: {
    specs: ["evals/**/*.yaml"],
    defaultRunner: "local",
    baselineDir: "evals/baselines",
    outputDir: ".mcp-use/eval/runs",
    reporters: ["summary"],
    trace: "on-failure",
    includeRawModelOutputs: false,
    redactSecrets: true,
    cloud: {
      writePointer: true,
    },
    ci: {
      junit: false,
      html: false,
      retentionDays: 14,
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function optionalStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function optionalStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : fallback;
}

function addIssue(
  issues: McpUseProjectConfigValidationIssue[],
  path: string,
  message: string
) {
  issues.push({ path, message });
}

function validateOptionalString(
  issues: McpUseProjectConfigValidationIssue[],
  value: unknown,
  path: string
) {
  if (value !== undefined && typeof value !== "string") {
    addIssue(issues, path, "must be a string.");
  }
}

function validateOptionalObject(
  issues: McpUseProjectConfigValidationIssue[],
  value: unknown,
  path: string
): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    addIssue(issues, path, "must be an object.");
    return {};
  }
  return value;
}

function validateOptionalBoolean(
  issues: McpUseProjectConfigValidationIssue[],
  value: unknown,
  path: string
) {
  if (value !== undefined && typeof value !== "boolean") {
    addIssue(issues, path, "must be a boolean.");
  }
}

function validateOptionalNumber(
  issues: McpUseProjectConfigValidationIssue[],
  value: unknown,
  path: string
) {
  if (value !== undefined && typeof value !== "number") {
    addIssue(issues, path, "must be a number.");
  }
}

function validateOptionalStringArray(
  issues: McpUseProjectConfigValidationIssue[],
  value: unknown,
  path: string
) {
  if (
    value !== undefined &&
    (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
  ) {
    addIssue(issues, path, "must be an array of strings.");
  }
}

function validateProjectConfigShape(
  raw: Record<string, unknown>
): McpUseProjectConfigValidationIssue[] {
  const issues: McpUseProjectConfigValidationIssue[] = [];

  if (raw.version !== undefined && raw.version !== 1) {
    addIssue(issues, "version", "must be 1.");
  }

  validateOptionalString(issues, raw.$schema, "$schema");
  validateOptionalString(issues, raw.name, "name");
  validateOptionalString(issues, raw.entry, "entry");
  validateOptionalString(issues, raw.mcpDir, "mcpDir");
  validateOptionalString(issues, raw.viewsDir, "viewsDir");
  validateOptionalString(issues, raw.publicDir, "publicDir");
  validateOptionalString(issues, raw.outDir, "outDir");

  const dev = validateOptionalObject(issues, raw.dev, "dev");
  validateOptionalNumber(issues, dev.port, "dev.port");
  validateOptionalBoolean(issues, dev.openInspector, "dev.openInspector");
  validateOptionalBoolean(issues, dev.tunnel, "dev.tunnel");

  const build = validateOptionalObject(issues, raw.build, "build");
  validateOptionalString(issues, build.command, "build.command");
  validateOptionalString(issues, build.startCommand, "build.startCommand");
  validateOptionalNumber(issues, build.port, "build.port");

  const cloud = validateOptionalObject(issues, raw.cloud, "cloud");
  validateOptionalString(issues, cloud.serverSlug, "cloud.serverSlug");
  if (
    cloud.organization !== undefined &&
    cloud.organization !== null &&
    typeof cloud.organization !== "string"
  ) {
    addIssue(issues, "cloud.organization", "must be a string or null.");
  }
  if (
    cloud.region !== undefined &&
    cloud.region !== "AUTO" &&
    cloud.region !== "US" &&
    cloud.region !== "EU" &&
    cloud.region !== "APAC"
  ) {
    addIssue(issues, "cloud.region", "must be one of AUTO, US, EU, or APAC.");
  }
  validateOptionalString(
    issues,
    cloud.productionBranch,
    "cloud.productionBranch"
  );
  validateOptionalStringArray(issues, cloud.watchPaths, "cloud.watchPaths");
  validateOptionalStringArray(
    issues,
    cloud.deployBranchPatterns,
    "cloud.deployBranchPatterns"
  );
  validateOptionalBoolean(issues, cloud.waitForCi, "cloud.waitForCi");
  validateOptionalString(issues, cloud.serverId, "cloud.serverId");

  const env = validateOptionalObject(issues, raw.env, "env");
  validateOptionalStringArray(issues, env.files, "env.files");
  validateOptionalStringArray(issues, env.syncOnDeploy, "env.syncOnDeploy");

  const evalConfig = validateOptionalObject(issues, raw.eval, "eval");
  validateOptionalStringArray(issues, evalConfig.specs, "eval.specs");
  if (
    evalConfig.defaultRunner !== undefined &&
    evalConfig.defaultRunner !== "local" &&
    evalConfig.defaultRunner !== "cloud" &&
    evalConfig.defaultRunner !== "chatgpt"
  ) {
    addIssue(
      issues,
      "eval.defaultRunner",
      "must be one of local, cloud, or chatgpt."
    );
  }
  validateOptionalString(issues, evalConfig.baselineDir, "eval.baselineDir");
  validateOptionalString(issues, evalConfig.outputDir, "eval.outputDir");
  validateOptionalStringArray(issues, evalConfig.reporters, "eval.reporters");
  if (
    evalConfig.trace !== undefined &&
    evalConfig.trace !== "always" &&
    evalConfig.trace !== "on-failure" &&
    evalConfig.trace !== "never"
  ) {
    addIssue(
      issues,
      "eval.trace",
      "must be one of always, on-failure, or never."
    );
  }
  validateOptionalBoolean(
    issues,
    evalConfig.includeRawModelOutputs,
    "eval.includeRawModelOutputs"
  );
  validateOptionalBoolean(
    issues,
    evalConfig.redactSecrets,
    "eval.redactSecrets"
  );

  const evalCloud = validateOptionalObject(
    issues,
    evalConfig.cloud,
    "eval.cloud"
  );
  validateOptionalBoolean(
    issues,
    evalCloud.writePointer,
    "eval.cloud.writePointer"
  );

  const evalCi = validateOptionalObject(issues, evalConfig.ci, "eval.ci");
  validateOptionalBoolean(issues, evalCi.junit, "eval.ci.junit");
  validateOptionalBoolean(issues, evalCi.html, "eval.ci.html");
  validateOptionalNumber(issues, evalCi.retentionDays, "eval.ci.retentionDays");

  return issues;
}

function mergeProjectConfig(raw: Record<string, unknown>): McpUseProjectConfig {
  const defaults = DEFAULT_MCP_USE_PROJECT_CONFIG;
  const dev = isRecord(raw.dev) ? raw.dev : {};
  const build = isRecord(raw.build) ? raw.build : {};
  const cloud = isRecord(raw.cloud) ? raw.cloud : {};
  const env = isRecord(raw.env) ? raw.env : {};
  const evalConfig = isRecord(raw.eval) ? raw.eval : {};
  const evalCloud = isRecord(evalConfig.cloud) ? evalConfig.cloud : {};
  const evalCi = isRecord(evalConfig.ci) ? evalConfig.ci : {};

  if (raw.version !== undefined && raw.version !== 1) {
    throw new Error("mcp-use.json version must be 1.");
  }

  return {
    $schema: optionalStringOrUndefined(raw.$schema) ?? defaults.$schema,
    version: 1,
    name: optionalStringOrUndefined(raw.name),
    entry: optionalString(raw.entry, defaults.entry),
    mcpDir: optionalStringOrUndefined(raw.mcpDir) ?? defaults.mcpDir,
    viewsDir: optionalString(raw.viewsDir, defaults.viewsDir),
    publicDir: optionalString(raw.publicDir, defaults.publicDir),
    outDir: optionalString(raw.outDir, defaults.outDir),
    dev: {
      port: optionalNumber(dev.port, defaults.dev.port),
      openInspector: optionalBoolean(
        dev.openInspector,
        defaults.dev.openInspector
      ),
      tunnel: optionalBoolean(dev.tunnel, defaults.dev.tunnel),
    },
    build: {
      command: optionalString(build.command, defaults.build.command),
      startCommand: optionalString(
        build.startCommand,
        defaults.build.startCommand
      ),
      port: optionalNumber(build.port, defaults.build.port),
    },
    cloud: {
      serverSlug: optionalStringOrUndefined(cloud.serverSlug),
      organization:
        cloud.organization === null
          ? null
          : optionalStringOrUndefined(cloud.organization),
      region:
        cloud.region === "US" ||
        cloud.region === "EU" ||
        cloud.region === "APAC" ||
        cloud.region === "AUTO"
          ? cloud.region
          : defaults.cloud.region,
      productionBranch: optionalString(
        cloud.productionBranch,
        defaults.cloud.productionBranch
      ),
      watchPaths: optionalStringArray(
        cloud.watchPaths,
        defaults.cloud.watchPaths
      ),
      deployBranchPatterns: optionalStringArray(
        cloud.deployBranchPatterns,
        defaults.cloud.deployBranchPatterns
      ),
      waitForCi: optionalBoolean(cloud.waitForCi, defaults.cloud.waitForCi),
      serverId: optionalStringOrUndefined(cloud.serverId),
    },
    env: {
      files: optionalStringArray(env.files, defaults.env.files),
      syncOnDeploy: optionalStringArray(
        env.syncOnDeploy,
        defaults.env.syncOnDeploy
      ),
    },
    eval: {
      specs: optionalStringArray(evalConfig.specs, defaults.eval.specs),
      defaultRunner:
        evalConfig.defaultRunner === "cloud" ||
        evalConfig.defaultRunner === "chatgpt" ||
        evalConfig.defaultRunner === "local"
          ? evalConfig.defaultRunner
          : defaults.eval.defaultRunner,
      baselineDir: optionalString(
        evalConfig.baselineDir,
        defaults.eval.baselineDir
      ),
      outputDir: optionalString(evalConfig.outputDir, defaults.eval.outputDir),
      reporters: optionalStringArray(
        evalConfig.reporters,
        defaults.eval.reporters
      ),
      trace:
        evalConfig.trace === "always" ||
        evalConfig.trace === "never" ||
        evalConfig.trace === "on-failure"
          ? evalConfig.trace
          : defaults.eval.trace,
      includeRawModelOutputs: optionalBoolean(
        evalConfig.includeRawModelOutputs,
        defaults.eval.includeRawModelOutputs
      ),
      redactSecrets: optionalBoolean(
        evalConfig.redactSecrets,
        defaults.eval.redactSecrets
      ),
      cloud: {
        writePointer: optionalBoolean(
          evalCloud.writePointer,
          defaults.eval.cloud.writePointer
        ),
      },
      ci: {
        junit: optionalBoolean(evalCi.junit, defaults.eval.ci.junit),
        html: optionalBoolean(evalCi.html, defaults.eval.ci.html),
        retentionDays: optionalNumber(
          evalCi.retentionDays,
          defaults.eval.ci.retentionDays
        ),
      },
    },
  };
}

export async function loadMcpUseProjectConfig(
  projectRoot: string = process.cwd()
): Promise<LoadedMcpUseProjectConfig> {
  const configPath = path.join(projectRoot, MCP_USE_CONFIG_FILENAME);
  try {
    await access(configPath);
  } catch {
    return {
      config: DEFAULT_MCP_USE_PROJECT_CONFIG,
      path: configPath,
      source: "defaults",
    };
  }

  const raw = await readFile(configPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid ${MCP_USE_CONFIG_FILENAME}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(`${MCP_USE_CONFIG_FILENAME} must contain a JSON object.`);
  }

  return {
    config: mergeProjectConfig(parsed),
    path: configPath,
    source: "file",
  };
}

export async function validateMcpUseProjectConfig(
  projectRoot: string = process.cwd()
): Promise<McpUseProjectConfigValidationResult> {
  const configPath = path.join(projectRoot, MCP_USE_CONFIG_FILENAME);
  try {
    await access(configPath);
  } catch {
    return {
      ok: true,
      path: configPath,
      source: "defaults",
      issues: [],
      config: DEFAULT_MCP_USE_PROJECT_CONFIG,
    };
  }

  const raw = await readFile(configPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      path: configPath,
      source: "file",
      issues: [
        {
          path: "$",
          message: `invalid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      path: configPath,
      source: "file",
      issues: [{ path: "$", message: "must contain a JSON object." }],
    };
  }

  const issues = validateProjectConfigShape(parsed);
  return {
    ok: issues.length === 0,
    path: configPath,
    source: "file",
    issues,
    config: issues.length === 0 ? mergeProjectConfig(parsed) : undefined,
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function readLocalCloudLink(
  linkPath: string
): Promise<McpUseProjectConfigLocalDiff["link"]> {
  try {
    const raw = JSON.parse(await readFile(linkPath, "utf-8"));
    const link = isRecord(raw) ? raw : {};
    return {
      path: linkPath,
      exists: true,
      serverId: stringOrUndefined(link.serverId),
      deploymentId: stringOrUndefined(link.deploymentId),
      deploymentName: stringOrUndefined(link.deploymentName),
      deploymentUrl: stringOrUndefined(link.deploymentUrl),
      linkedAt: stringOrUndefined(link.linkedAt),
    };
  } catch {
    return { path: linkPath, exists: false };
  }
}

export async function diffMcpUseProjectConfigLocal(
  projectRoot: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): Promise<McpUseProjectConfigLocalDiff> {
  const loaded = await loadMcpUseProjectConfig(projectRoot);
  const workspacePaths = resolveMcpUseWorkspacePaths(
    projectRoot,
    loaded.config
  );
  const link = await readLocalCloudLink(workspacePaths.cloudLinkPath);
  const differences: McpUseProjectConfigLocalDiff["differences"] = [];

  if (
    loaded.config.cloud.serverId &&
    link.serverId &&
    loaded.config.cloud.serverId !== link.serverId
  ) {
    differences.push({
      field: "cloud.serverId",
      config: loaded.config.cloud.serverId,
      link: link.serverId,
    });
  }

  if (
    loaded.config.cloud.serverId &&
    env.MCP_USE_SERVER_ID &&
    loaded.config.cloud.serverId !== env.MCP_USE_SERVER_ID
  ) {
    differences.push({
      field: "cloud.serverId",
      config: loaded.config.cloud.serverId,
      env: env.MCP_USE_SERVER_ID,
    });
  }

  if (
    link.serverId &&
    env.MCP_USE_SERVER_ID &&
    link.serverId !== env.MCP_USE_SERVER_ID
  ) {
    differences.push({
      field: "link.serverId",
      link: link.serverId,
      env: env.MCP_USE_SERVER_ID,
    });
  }

  return {
    mode: "local",
    project: {
      path: loaded.path,
      source: loaded.source,
      name: loaded.config.name,
      cloud: loaded.config.cloud,
    },
    link,
    env: {
      MCP_USE_API_KEY: {
        present: !!env.MCP_USE_API_KEY,
        description:
          "Manufact Cloud API key used by `mcp-use login --api-key`.",
      },
      MCP_USE_ORG_ID: {
        present: !!env.MCP_USE_ORG_ID,
        description:
          "Organization id for CI when no local .mcp-use cloud link exists.",
      },
      MCP_USE_SERVER_ID: {
        present: !!env.MCP_USE_SERVER_ID,
        description:
          "Server id for CI when no local .mcp-use cloud link exists.",
      },
    },
    differences,
  };
}

export function resolveMcpUseWorkspacePaths(
  projectRoot: string = process.cwd(),
  config: Pick<
    McpUseProjectConfig,
    "outDir" | "eval"
  > = DEFAULT_MCP_USE_PROJECT_CONFIG
): McpUseWorkspacePaths {
  const workspaceDir = path.join(projectRoot, MCP_USE_WORKSPACE_DIR);
  const buildDir = path.resolve(projectRoot, config.outDir);
  const generatedDir = path.join(workspaceDir, "generated");
  const cacheDir = path.join(workspaceDir, "cache");
  const stateDir = path.join(workspaceDir, "state");
  const cloudDir = path.join(workspaceDir, "cloud");

  return {
    workspaceDir,
    buildDir,
    serverBuildDir: path.join(buildDir, "server"),
    viewsBuildDir: path.join(buildDir, "views"),
    manifestPath: path.join(buildDir, "manifest.json"),
    generatedDir,
    toolRegistryPath: path.join(generatedDir, "tool-registry.d.ts"),
    cacheDir,
    viewsCacheDir: path.join(cacheDir, "views"),
    metadataCacheDir: path.join(cacheDir, "metadata"),
    viteCacheDir: path.join(cacheDir, "vite"),
    stateDir,
    tunnelStatePath: path.join(stateDir, "tunnel.json"),
    sessionsPath: path.join(stateDir, "sessions.json"),
    cloudDir,
    cloudLinkPath: path.join(cloudDir, "link.json"),
    evalRunsDir: path.resolve(projectRoot, config.eval.outputDir),
    screenshotsDir: path.join(workspaceDir, "screenshots"),
    logsDir: path.join(workspaceDir, "logs"),
    legacyManifestPath: path.join(projectRoot, "dist", "mcp-use.json"),
  };
}
