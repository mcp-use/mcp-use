import chalk from "chalk";
import { Command } from "commander";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  loadMcpUseProjectConfig,
  resolveMcpUseWorkspacePaths,
  type LoadedMcpUseProjectConfig,
  type McpUseProjectConfig,
  type McpUseWorkspacePaths,
} from "mcp-use/project-config";

type DiagnosticStatus = "ok" | "warning" | "error" | "skipped" | "todo";

interface DiagnosticCheck {
  id: string;
  title: string;
  status: DiagnosticStatus;
  message: string;
  path?: string;
  details?: Record<string, unknown>;
}

interface DiagnosticSection {
  status: DiagnosticStatus;
  checks: DiagnosticCheck[];
}

interface DoctorReport {
  command: "doctor" | "inspect";
  ok: boolean;
  generatedAt: string;
  projectRoot: string;
  summary: Record<DiagnosticStatus, number>;
  sections: {
    config: DiagnosticSection;
    workspace: DiagnosticSection;
    packageDeps: DiagnosticSection;
    build: DiagnosticSection;
    inspector: DiagnosticSection;
    apps: DiagnosticSection;
    oauth: DiagnosticSection;
    schema: DiagnosticSection;
    security: DiagnosticSection;
  };
}

interface DoctorOptions {
  path?: string;
  json?: boolean;
  inspectorHealthUrl?: string;
  timeoutMs?: string | number;
}

interface CreateDoctorReportOptions {
  command?: "doctor" | "inspect";
  projectRoot: string;
  inspectorHealthUrl?: string;
  timeoutMs?: number;
  now?: () => Date;
}

type MutableSections = DoctorReport["sections"];

const PLACEHOLDER_SECTIONS = {
  apps: "Apps metadata validation is planned; this lightweight doctor only reports the placeholder.",
  oauth:
    "OAuth endpoint validation is planned; this lightweight doctor only reports the placeholder.",
  schema:
    "Schema hardening validation is planned; this lightweight doctor only reports the placeholder.",
  security:
    "Security linting is planned; this lightweight doctor only reports the placeholder.",
} as const;

function relativePath(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).replace(/\\/g, "/") || ".";
}

async function exists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(
  absolutePath: string
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    return {
      ok: true,
      value: JSON.parse(await readFile(absolutePath, "utf-8")),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function sectionStatus(checks: DiagnosticCheck[]): DiagnosticStatus {
  if (checks.some((check) => check.status === "error")) return "error";
  if (checks.some((check) => check.status === "warning")) return "warning";
  if (checks.some((check) => check.status === "todo")) return "todo";
  if (checks.every((check) => check.status === "skipped")) return "skipped";
  return "ok";
}

function makeSection(checks: DiagnosticCheck[]): DiagnosticSection {
  return {
    status: sectionStatus(checks),
    checks,
  };
}

function summarize(
  sections: MutableSections
): Record<DiagnosticStatus, number> {
  const summary: Record<DiagnosticStatus, number> = {
    ok: 0,
    warning: 0,
    error: 0,
    skipped: 0,
    todo: 0,
  };

  for (const section of Object.values(sections)) {
    for (const check of section.checks) {
      summary[check.status] += 1;
    }
  }

  return summary;
}

function createPlaceholderSection(
  id: keyof typeof PLACEHOLDER_SECTIONS
): DiagnosticSection {
  return makeSection([
    {
      id: `${id}.placeholder`,
      title: `${id} diagnostics`,
      status: "todo",
      message: PLACEHOLDER_SECTIONS[id],
    },
  ]);
}

async function checkConfig(projectRoot: string): Promise<{
  section: DiagnosticSection;
  loadedConfig?: LoadedMcpUseProjectConfig;
  workspacePaths: McpUseWorkspacePaths;
}> {
  try {
    const loadedConfig = await loadMcpUseProjectConfig(projectRoot);
    const workspacePaths = resolveMcpUseWorkspacePaths(
      projectRoot,
      loadedConfig.config
    );
    const configPath = relativePath(projectRoot, loadedConfig.path);
    return {
      loadedConfig,
      workspacePaths,
      section: makeSection([
        {
          id: "config.load",
          title: "Project config load",
          status: loadedConfig.source === "file" ? "ok" : "warning",
          path: configPath,
          message:
            loadedConfig.source === "file"
              ? "Loaded mcp-use.json."
              : "mcp-use.json was not found; using built-in defaults.",
          details: {
            source: loadedConfig.source,
            entry: loadedConfig.config.entry,
            outDir: loadedConfig.config.outDir,
          },
        },
      ]),
    };
  } catch (error) {
    const workspacePaths = resolveMcpUseWorkspacePaths(projectRoot);
    return {
      workspacePaths,
      section: makeSection([
        {
          id: "config.load",
          title: "Project config load",
          status: "error",
          path: "mcp-use.json",
          message:
            error instanceof Error
              ? error.message
              : `Failed to load mcp-use.json: ${String(error)}`,
        },
      ]),
    };
  }
}

async function checkWorkspace(
  projectRoot: string,
  paths: McpUseWorkspacePaths
): Promise<DiagnosticSection> {
  const checks: DiagnosticCheck[] = [];
  const workspaceExists = await exists(paths.workspaceDir);
  checks.push({
    id: "workspace.dir",
    title: ".mcp-use workspace",
    status: workspaceExists ? "ok" : "warning",
    path: relativePath(projectRoot, paths.workspaceDir),
    message: workspaceExists
      ? ".mcp-use workspace directory exists."
      : ".mcp-use workspace directory does not exist yet; run dev or build to create it.",
  });

  const pathChecks: Array<[string, string]> = [
    ["workspace.build", paths.buildDir],
    ["workspace.generated", paths.generatedDir],
    ["workspace.cache", paths.cacheDir],
    ["workspace.state", paths.stateDir],
    ["workspace.cloud", paths.cloudDir],
    ["workspace.eval", paths.evalRunsDir],
    ["workspace.screenshots", paths.screenshotsDir],
    ["workspace.logs", paths.logsDir],
  ];

  for (const [id, absolutePath] of pathChecks) {
    checks.push({
      id,
      title: id.replace("workspace.", "Workspace "),
      status: (await exists(absolutePath)) ? "ok" : "skipped",
      path: relativePath(projectRoot, absolutePath),
      message: (await exists(absolutePath))
        ? "Path exists."
        : "Path is configured but has not been created yet.",
    });
  }

  return makeSection(checks);
}

function hasDependency(
  packageJson: Record<string, unknown>,
  dependencyName: string
): boolean {
  return ["dependencies", "devDependencies", "peerDependencies"].some(
    (field) => {
      const deps = packageJson[field];
      return (
        deps !== null &&
        typeof deps === "object" &&
        !Array.isArray(deps) &&
        dependencyName in deps
      );
    }
  );
}

async function checkPackageDeps(
  projectRoot: string,
  config?: McpUseProjectConfig
): Promise<DiagnosticSection> {
  const packagePath = path.join(projectRoot, "package.json");
  const packageJson = await readJsonFile(packagePath);
  if (!packageJson.ok) {
    const missing = !(await exists(packagePath));
    return makeSection([
      {
        id: "package.load",
        title: "package.json load",
        status: missing ? "warning" : "error",
        path: "package.json",
        message: missing
          ? "package.json was not found; dependency checks were skipped."
          : `Could not parse package.json: ${packageJson.error}`,
      },
    ]);
  }

  if (
    packageJson.value === null ||
    typeof packageJson.value !== "object" ||
    Array.isArray(packageJson.value)
  ) {
    return makeSection([
      {
        id: "package.load",
        title: "package.json load",
        status: "error",
        path: "package.json",
        message: "package.json must contain a JSON object.",
      },
    ]);
  }

  const pkg = packageJson.value as Record<string, unknown>;
  const checks: DiagnosticCheck[] = [
    {
      id: "package.load",
      title: "package.json load",
      status: "ok",
      path: "package.json",
      message: "Loaded package.json.",
      details: {
        name: typeof pkg.name === "string" ? pkg.name : undefined,
      },
    },
    {
      id: "package.mcp-use",
      title: "mcp-use dependency",
      status: hasDependency(pkg, "mcp-use") ? "ok" : "warning",
      path: "package.json",
      message: hasDependency(pkg, "mcp-use")
        ? "Found mcp-use in package dependencies."
        : "mcp-use was not found in dependencies, devDependencies, or peerDependencies.",
    },
  ];

  const viewsDir = config?.viewsDir ?? "resources";
  if (await exists(path.join(projectRoot, viewsDir))) {
    for (const dependencyName of ["react", "react-dom"]) {
      checks.push({
        id: `package.${dependencyName}`,
        title: `${dependencyName} dependency`,
        status: hasDependency(pkg, dependencyName) ? "ok" : "warning",
        path: "package.json",
        message: hasDependency(pkg, dependencyName)
          ? `Found ${dependencyName} for view rendering.`
          : `${dependencyName} was not found, but ${viewsDir} exists.`,
      });
    }
  }

  return makeSection(checks);
}

async function checkBuildManifest(
  projectRoot: string,
  paths: McpUseWorkspacePaths
): Promise<DiagnosticSection> {
  const manifestCandidates = [
    { path: paths.manifestPath, legacy: false },
    { path: paths.legacyManifestPath, legacy: true },
  ];

  for (const candidate of manifestCandidates) {
    if (!(await exists(candidate.path))) continue;

    const manifestJson = await readJsonFile(candidate.path);
    if (!manifestJson.ok) {
      return makeSection([
        {
          id: "build.manifest",
          title: "Build manifest",
          status: "error",
          path: relativePath(projectRoot, candidate.path),
          message: `Build manifest exists but could not be parsed: ${manifestJson.error}`,
        },
      ]);
    }

    const manifest =
      manifestJson.value !== null &&
      typeof manifestJson.value === "object" &&
      !Array.isArray(manifestJson.value)
        ? (manifestJson.value as Record<string, unknown>)
        : {};
    return makeSection([
      {
        id: "build.manifest",
        title: "Build manifest",
        status: candidate.legacy ? "warning" : "ok",
        path: relativePath(projectRoot, candidate.path),
        message: candidate.legacy
          ? "Found legacy dist/mcp-use.json manifest; rebuild to write .mcp-use/build/manifest.json."
          : "Found .mcp-use build manifest.",
        details: {
          legacy: candidate.legacy,
          buildId:
            typeof manifest.buildId === "string" ? manifest.buildId : undefined,
          entryPoint:
            typeof manifest.entryPoint === "string"
              ? manifest.entryPoint
              : undefined,
          widgetCount:
            manifest.widgets &&
            typeof manifest.widgets === "object" &&
            !Array.isArray(manifest.widgets)
              ? Object.keys(manifest.widgets).length
              : 0,
        },
      },
    ]);
  }

  return makeSection([
    {
      id: "build.manifest",
      title: "Build manifest",
      status: "warning",
      path: relativePath(projectRoot, paths.manifestPath),
      message:
        "No build manifest found. Run mcp-use build to create .mcp-use/build/manifest.json.",
      details: {
        legacyPath: relativePath(projectRoot, paths.legacyManifestPath),
      },
    },
  ]);
}

async function checkInspector(
  inspectorHealthUrl: string | undefined,
  timeoutMs: number
): Promise<DiagnosticSection> {
  if (!inspectorHealthUrl) {
    return makeSection([
      {
        id: "inspector.health",
        title: "Inspector health",
        status: "skipped",
        message:
          "No inspector health URL provided. Pass --inspector-health-url to check it.",
      },
    ]);
  }

  let url: URL;
  try {
    url = new URL(inspectorHealthUrl);
  } catch {
    return makeSection([
      {
        id: "inspector.health",
        title: "Inspector health",
        status: "error",
        message: `Invalid inspector health URL: ${inspectorHealthUrl}`,
      },
    ]);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return makeSection([
      {
        id: "inspector.health",
        title: "Inspector health",
        status: response.ok ? "ok" : "error",
        message: response.ok
          ? "Inspector health endpoint responded successfully."
          : `Inspector health endpoint returned HTTP ${response.status}.`,
        details: {
          url: url.toString(),
          status: response.status,
        },
      },
    ]);
  } catch (error) {
    return makeSection([
      {
        id: "inspector.health",
        title: "Inspector health",
        status: "error",
        message:
          error instanceof Error
            ? `Inspector health check failed: ${error.message}`
            : `Inspector health check failed: ${String(error)}`,
        details: {
          url: url.toString(),
        },
      },
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function createDoctorReport(
  options: CreateDoctorReportOptions
): Promise<DoctorReport> {
  const projectRoot = path.resolve(options.projectRoot);
  const configResult = await checkConfig(projectRoot);
  const [workspace, packageDeps, build, inspector] = await Promise.all([
    checkWorkspace(projectRoot, configResult.workspacePaths),
    checkPackageDeps(projectRoot, configResult.loadedConfig?.config),
    checkBuildManifest(projectRoot, configResult.workspacePaths),
    checkInspector(options.inspectorHealthUrl, options.timeoutMs ?? 3000),
  ]);

  const sections: MutableSections = {
    config: configResult.section,
    workspace,
    packageDeps,
    build,
    inspector,
    apps: createPlaceholderSection("apps"),
    oauth: createPlaceholderSection("oauth"),
    schema: createPlaceholderSection("schema"),
    security: createPlaceholderSection("security"),
  };
  const summary = summarize(sections);

  return {
    command: options.command ?? "doctor",
    ok: summary.error === 0,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    projectRoot,
    summary,
    sections,
  };
}

function formatStatus(status: DiagnosticStatus): string {
  switch (status) {
    case "ok":
      return chalk.green("ok");
    case "warning":
      return chalk.yellow("warning");
    case "error":
      return chalk.red("error");
    case "todo":
      return chalk.cyan("todo");
    case "skipped":
      return chalk.gray("skipped");
    default:
      return status;
  }
}

function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    chalk.bold(`mcp-use ${report.command}`),
    chalk.gray(`Project: ${report.projectRoot}`),
    "",
  ];

  for (const [name, section] of Object.entries(report.sections)) {
    lines.push(`${chalk.bold(name)} ${formatStatus(section.status)}`);
    for (const check of section.checks) {
      const location = check.path ? chalk.gray(` (${check.path})`) : "";
      lines.push(
        `  - ${formatStatus(check.status)} ${check.message}${location}`
      );
    }
    lines.push("");
  }

  lines.push(
    report.ok
      ? chalk.green("Doctor completed without errors.")
      : chalk.red("Doctor found errors.")
  );
  return lines.join("\n");
}

async function runDoctorCommand(
  options: DoctorOptions,
  command: "doctor" | "inspect"
): Promise<void> {
  const timeoutMs = Number(options.timeoutMs ?? 3000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number.");
  }

  const report = await createDoctorReport({
    command,
    projectRoot: options.path ?? process.cwd(),
    inspectorHealthUrl: options.inspectorHealthUrl,
    timeoutMs,
  });

  if (options.json || command === "inspect") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDoctorReport(report));
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

export function createDoctorCommand(): Command {
  return new Command("doctor")
    .description("Run lightweight project diagnostics")
    .option("-p, --path <path>", "Path to project directory", process.cwd())
    .option("--json", "Print machine-readable diagnostics")
    .option(
      "--inspector-health-url <url>",
      "Inspector health endpoint to check, for example http://localhost:3000/inspector/health"
    )
    .option("--timeout-ms <ms>", "Inspector health timeout", "3000")
    .action(async (options: DoctorOptions) => {
      await runDoctorCommand(options, "doctor");
    });
}

export function createInspectCommand(): Command {
  return new Command("inspect")
    .description("Print lightweight project inspection JSON")
    .option("-p, --path <path>", "Path to project directory", process.cwd())
    .option("--json", "Print machine-readable diagnostics", true)
    .option(
      "--inspector-health-url <url>",
      "Inspector health endpoint to check, for example http://localhost:3000/inspector/health"
    )
    .option("--timeout-ms <ms>", "Inspector health timeout", "3000")
    .action(async (options: DoctorOptions) => {
      await runDoctorCommand(options, "inspect");
    });
}
