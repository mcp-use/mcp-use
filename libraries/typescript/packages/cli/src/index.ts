#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import "dotenv/config";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import open from "open";
import { viteSingleFile } from "vite-plugin-singlefile";
import { toJSONSchema } from "zod";
import { loginCommand, logoutCommand, whoamiCommand } from "./commands/auth.js";
import { createClientCommand } from "./commands/client.js";
import { deployCommand } from "./commands/deploy.js";
import { createDeploymentsCommand } from "./commands/deployments.js";
import { createServersCommand } from "./commands/servers.js";
import {
  orgCurrentCommand,
  orgListCommand,
  orgSwitchCommand,
} from "./commands/org.js";
import { createSkillsCommand } from "./commands/skills.js";
import {
  detectNextJsProject,
  loadNextJsEnvFiles,
  registerNextShimsInProcess,
  withNextShimsEnv,
} from "./utils/next-shims.js";
import { notifyIfUpdateAvailable } from "./utils/update-check.js";
const program = new Command();

const packageContent = readFileSync(
  path.join(__dirname, "../package.json"),
  "utf-8"
);
const packageJson = JSON.parse(packageContent);
const packageVersion = packageJson.version || "unknown";

program
  .name("mcp-use")
  .description("Create and run MCP servers with ui resources widgets")
  .version(packageVersion);

/**
 * Helper to display all package versions
 *
 * @param projectPath - Optional path to user's project directory.
 *                      When provided, resolves packages from the project's node_modules (standalone installation).
 *                      When omitted, falls back to relative paths (monorepo development).
 */
function displayPackageVersions(projectPath?: string) {
  const packages = [
    { name: "@mcp-use/cli", relativePath: "../package.json" },
    {
      name: "@mcp-use/inspector",
      relativePath: "../../inspector/package.json",
    },
    {
      name: "create-mcp-use-app",
      relativePath: "../../create-mcp-use-app/package.json",
    },
    {
      name: "mcp-use",
      relativePath: "../../mcp-use/package.json",
      highlight: true,
    },
  ];

  console.log(chalk.gray("mcp-use packages:"));

  for (const pkg of packages) {
    const paddedName = pkg.name.padEnd(22);

    try {
      let pkgPath: string;

      if (projectPath) {
        // Standalone installation: Try to resolve from user's project node_modules
        try {
          const projectRequire = createRequire(
            path.join(projectPath, "package.json")
          );
          pkgPath = projectRequire.resolve(`${pkg.name}/package.json`);
        } catch (resolveError) {
          // Package not found in project node_modules, try relative path as fallback
          pkgPath = path.join(__dirname, pkg.relativePath);
        }
      } else {
        // Monorepo development: Use relative paths
        pkgPath = path.join(__dirname, pkg.relativePath);
      }

      const pkgContent = readFileSync(pkgPath, "utf-8");
      const pkgJson = JSON.parse(pkgContent);
      const version = pkgJson.version || "unknown";

      if (pkg.highlight) {
        console.log(
          `  ${chalk.cyan.bold(paddedName)} ${chalk.cyan.bold(`v${version}`)}`
        );
      } else {
        console.log(chalk.gray(`  ${paddedName} v${version}`));
      }
    } catch (error) {
      // Log debug message when package is not found (aids troubleshooting)
      if (process.env.DEBUG || process.env.VERBOSE) {
        console.log(chalk.dim(`  ${paddedName} (not found)`));
      }
    }
  }
}

// Helper to check if port is available
async function isPortAvailable(
  port: number,
  host: string = "localhost"
): Promise<boolean> {
  try {
    await fetch(`http://${host}:${port}`);
    return false; // Port is in use
  } catch {
    return true; // Port is available
  }
}

// Helper to find an available port
async function findAvailablePort(
  startPort: number,
  host: string = "localhost"
): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port, host)) {
      return port;
    }
  }
  throw new Error("No available ports found");
}

// Helper to check if server is ready
async function waitForServer(
  port: number,
  host: string = "localhost",
  maxAttempts = 30
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const controller = new AbortController();
    try {
      // Use /inspector/health endpoint for cleaner health checks
      // This avoids 400 errors from the MCP endpoint which requires session headers
      const response = await fetch(`http://${host}:${port}/inspector/health`, {
        signal: controller.signal,
      });

      if (response.ok) {
        return true;
      }
    } catch {
      // Server not ready yet
    } finally {
      controller.abort();
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

// Helper to normalize host for browser connections
// 0.0.0.0 is valid for server binding but browsers cannot connect to it
function normalizeBrowserHost(host: string): string {
  return host === "0.0.0.0" ? "localhost" : host;
}

// Helper to run a command
function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
  filterStderr: boolean = false
): { promise: Promise<void>; process: any } {
  const proc = spawn(command, args, {
    cwd,
    stdio: filterStderr ? (["inherit", "inherit", "pipe"] as const) : "inherit",
    shell: process.platform === "win32",
    env: env ? { ...process.env, ...env } : process.env,
  });

  // Filter stderr to suppress tsx's "Force killing" messages
  if (filterStderr && proc.stderr) {
    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      // Filter out tsx's force killing message
      if (
        !text.includes("Previous process hasn't exited yet") &&
        !text.includes("Force killing")
      ) {
        process.stderr.write(data);
      }
    });
  }

  const promise = new Promise<void>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("exit", (code: number | null) => {
      if (code === 0 || code === 130 || code === 143) {
        // Exit codes: 0 = normal, 130 = SIGINT/SIGTERM, 143 = SIGTERM (alternative)
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
  });

  return { promise, process: proc };
}

// Helper to start tunnel and get the URL
async function startTunnel(
  port: number,
  subdomain?: string
): Promise<{ url: string; subdomain: string; process: any }> {
  return new Promise((resolve, reject) => {
    console.log(chalk.gray(`Starting tunnel for port ${port}...`));

    const tunnelArgs = ["--yes", "@mcp-use/tunnel", String(port)];

    // Pass subdomain as CLI flag if provided
    if (subdomain) {
      tunnelArgs.push("--subdomain", subdomain);
    }

    const proc = spawn("npx", tunnelArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let resolved = false;
    let isShuttingDown = false;

    proc.stdout?.on("data", (data) => {
      const text = data.toString();
      const isShutdownMessage =
        text.includes("Shutting down") || text.includes("🛑");
      const isErrorMessage = text.includes("✖") || text.includes("Error:");

      if (!isShuttingDown && !isShutdownMessage && !isErrorMessage) {
        process.stdout.write(text);
      }

      // Look for the tunnel URL in the output
      // Expected format: https://subdomain.tunnel-domain.com
      const urlMatch = text.match(/https?:\/\/([a-z0-9-]+\.[a-z0-9.-]+)/i);
      if (urlMatch && !resolved) {
        const url = urlMatch[0];
        // Extract subdomain from URL (e.g., "happy-cat.local.mcp-use.run" -> "happy-cat")
        const fullDomain = urlMatch[1];
        // Try to extract the subdomain using a case-insensitive regex.
        // If the regex fails, fallback to splitting by '.' and taking the first label.
        // Validate that the extracted subdomain matches the expected format (letters, numbers, hyphens).
        const subdomainMatch = fullDomain.match(/^([a-z0-9-]+)\./i);
        let extractedSubdomain = subdomainMatch
          ? subdomainMatch[1]
          : fullDomain.split(".")[0];
        if (!/^[a-z0-9-]+$/i.test(extractedSubdomain)) {
          console.warn(
            chalk.yellow(
              `Warning: Extracted subdomain "${extractedSubdomain}" does not match expected format.`
            )
          );
          extractedSubdomain = "";
        }
        resolved = true;
        clearTimeout(setupTimeout);
        console.log(chalk.green.bold(`✓ Tunnel established: ${url}/mcp`));
        resolve({ url, subdomain: extractedSubdomain, process: proc });
      }
    });

    proc.stderr?.on("data", (data) => {
      const text = data.toString();
      // Filter out bore debug logs and shutdown messages
      if (
        !isShuttingDown &&
        !text.includes("INFO") &&
        !text.includes("bore_cli") &&
        !text.includes("Shutting down")
      ) {
        process.stderr.write(data);
      }
    });

    proc.on("error", (error) => {
      if (!resolved) {
        clearTimeout(setupTimeout);
        reject(new Error(`Failed to start tunnel: ${error.message}`));
      }
    });

    proc.on("exit", (code) => {
      if (code !== 0 && !resolved) {
        clearTimeout(setupTimeout);
        reject(new Error(`Tunnel process exited with code ${code}`));
      }
    });

    // Add method to mark shutdown state
    (proc as any).markShutdown = () => {
      isShuttingDown = true;
    };

    // Timeout after 30 seconds - only for initial setup
    const setupTimeout = setTimeout(() => {
      if (!resolved) {
        proc.kill();
        reject(new Error("Tunnel setup timed out"));
      }
    }, 30000);
  });
}

/**
 * Resolve the entry file for an MCP server.
 * Priority: --entry flag > <mcpDir>/{index,server}.{ts,tsx} > top-level defaults.
 */
async function resolveEntryFile(
  projectPath: string,
  cliEntry?: string,
  mcpDir?: string
): Promise<string> {
  if (cliEntry) {
    await access(path.join(projectPath, cliEntry)).catch(() => {
      throw new Error(`File not found: ${cliEntry}`);
    });
    return cliEntry;
  }

  if (mcpDir) {
    const mcpCandidates = [
      path.join(mcpDir, "index.ts"),
      path.join(mcpDir, "index.tsx"),
      path.join(mcpDir, "server.ts"),
      path.join(mcpDir, "server.tsx"),
    ];
    for (const candidate of mcpCandidates) {
      try {
        await access(path.join(projectPath, candidate));
        return candidate;
      } catch {
        continue;
      }
    }
    throw new Error(
      `No entry file found inside ${mcpDir}.\n\n` +
        `Expected one of: ${mcpCandidates.map((c) => path.relative(projectPath, path.join(projectPath, c))).join(", ")}\n\n` +
        `Fix this by either:\n` +
        `  1. Creating ${path.join(mcpDir, "index.ts")}, or\n` +
        `  2. Passing --entry <file> on the command line`
    );
  }

  const candidates = ["index.ts", "src/index.ts", "server.ts", "src/server.ts"];
  for (const candidate of candidates) {
    try {
      await access(path.join(projectPath, candidate));
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    `No entry file found.\n\n` +
      `Expected one of: ${candidates.join(", ")}\n\n` +
      `Fix this by either:\n` +
      `  1. Creating one of the default entry files above, or\n` +
      `  2. Passing --entry <file> or --mcp-dir <dir> on the command line`
  );
}

/**
 * Resolve the widgets directory.
 * Priority: --widgets-dir flag > <mcpDir>/resources > "resources".
 */
function resolveWidgetsDir(cliWidgetsDir?: string, mcpDir?: string): string {
  if (cliWidgetsDir) return cliWidgetsDir;
  if (mcpDir) return path.join(mcpDir, "resources");
  return "resources";
}

/**
 * Vite plugin that fails the widget build with a clear, actionable error when
 * a widget transitively imports a Next.js server-runtime module.
 *
 * The MCP server process silently shims these specifiers (see
 * src/shims/next-shims-*) because server-side code is supposed to work
 * there. Widgets run in a browser iframe, so the same import is almost
 * always a mistake — fetch server data through a tool call instead.
 *
 * Keep the rejection list aligned with src/shims/next-shims-registry.json;
 * we duplicate the array here (rather than reading the JSON) so this file
 * stays import-free for the source-mode tests that load it via tsx.
 */
function makeWidgetServerOnlyGuard(widgetName: string) {
  const rejected = new Set([
    "server-only",
    "client-only",
    "next/cache",
    "next/headers",
    "next/navigation",
    "next/server",
  ]);
  return {
    name: "mcp-use-widget-server-only-guard",
    enforce: "pre" as const,
    resolveId(id: string, importer: string | undefined) {
      if (!rejected.has(id)) return null;
      const from = importer ? ` (imported from ${importer})` : "";
      throw new Error(
        `Widget "${widgetName}" imports "${id}"${from}, which is a Next.js ` +
          `server-only module. Widgets run in a browser iframe and cannot ` +
          `use server APIs.\n\n` +
          `To fix:\n` +
          `  • Remove the import from the widget (or from any module the ` +
          `widget transitively imports)\n` +
          `  • If the widget needs data from ${id}, read it inside an MCP ` +
          `tool in your server and pass the result through the widget's ` +
          `props`
      );
    },
  };
}

async function findServerFile(
  projectPath: string,
  cliEntry?: string,
  cliMcpDir?: string
): Promise<string> {
  return resolveEntryFile(projectPath, cliEntry, cliMcpDir);
}

async function generateToolRegistryTypesForServer(
  projectPath: string,
  serverFileRelative: string
): Promise<boolean> {
  const serverFile = path.join(projectPath, serverFileRelative);
  const serverFileExists = await access(serverFile)
    .then(() => true)
    .catch(() => false);

  if (!serverFileExists) {
    throw new Error(`Server file not found: ${serverFile}`);
  }

  const previousHmrMode = (globalThis as any).__mcpUseHmrMode;

  try {
    // Prevent server startup side effects while importing registrations.
    (globalThis as any).__mcpUseHmrMode = true;
    (globalThis as any).__mcpUseLastServer = undefined;

    // Detect Next.js projects and install the server-runtime shim loaders
    // BEFORE tsx registers — otherwise transitive imports of `server-only`,
    // `next/cache`, etc. from the user entry throw during module evaluation.
    if (await detectNextJsProject(projectPath)) {
      await loadNextJsEnvFiles(projectPath);
      await registerNextShimsInProcess();
    }

    // Register tsx's loader hooks namespace-less + globally. We deliberately
    // do NOT use `tsImport` here: tsImport wraps tsx in a generated
    // namespace, and tsx's resolver bails via `return nextResolve(...)` for
    // any specifier whose parent URL doesn't carry that namespace — which
    // means transitive `@/lib/...` imports from the user entry never reach
    // tsx's tsconfig-paths resolver and fail with
    // `Cannot find package '@/lib'`. Namespace-less registration makes
    // tsx's resolver run uniformly on every specifier.
    //
    // Paired with tsx/cjs/api.register() because tsx compiles `.ts` to CJS
    // by default in non-`"type": "module"` packages (i.e. every Next.js
    // app), and the resulting `require()` chain needs the same tsconfig-
    // paths treatment applied on the CJS side.
    const projectTsconfigPath = path.join(projectPath, "tsconfig.json");
    const hasTsconfig = await access(projectTsconfigPath)
      .then(() => true)
      .catch(() => false);
    if (hasTsconfig) {
      process.env.TSX_TSCONFIG_PATH = projectTsconfigPath;
    }
    const previousCwd = process.cwd();
    if (previousCwd !== projectPath) process.chdir(projectPath);

    try {
      const projectRequire = createRequire(
        path.join(projectPath, "package.json")
      );

      // ESM side
      const tsxEsmApiPath = projectRequire.resolve("tsx/esm/api");
      const tsxEsmApi = await import(pathToFileURL(tsxEsmApiPath).href);
      if (typeof tsxEsmApi.register === "function") {
        tsxEsmApi.register({
          tsconfig: hasTsconfig ? projectTsconfigPath : undefined,
        });
      }

      // CJS side (optional — tsx 4.x ships both entry points)
      try {
        const tsxCjsApiPath = projectRequire.resolve("tsx/cjs/api");
        const tsxCjsApi = await import(pathToFileURL(tsxCjsApiPath).href);
        if (typeof tsxCjsApi.register === "function") {
          tsxCjsApi.register();
        }
      } catch {
        // tsx/cjs unavailable on this tsx version — ESM-only mode is fine
        // for projects that compile to ESM.
      }

      // Native dynamic import with a cache-buster. With tsx registered
      // globally and without a namespace, the whole dependency tree (user
      // entry + transitive `@/lib/...` imports + `mcp-use/server`) resolves
      // through tsx's tsconfig-aware resolver.
      await import(`${pathToFileURL(serverFile).href}?t=${Date.now()}`);
    } finally {
      if (process.cwd() !== previousCwd) process.chdir(previousCwd);
    }

    const server = (globalThis as any).__mcpUseLastServer;
    if (!server) {
      throw new Error(
        "No MCPServer instance found. Make sure your server file creates an MCPServer instance."
      );
    }

    const mcpUsePath = path.join(projectPath, "node_modules", "mcp-use");
    const { generateToolRegistryTypes } = await import(
      pathToFileURL(path.join(mcpUsePath, "dist", "src", "server", "index.js"))
        .href
    ).then((mod) => mod);

    if (!generateToolRegistryTypes) {
      throw new Error("generateToolRegistryTypes not found in mcp-use package");
    }

    const success = await generateToolRegistryTypes(
      server.registrations.tools,
      projectPath
    );
    return success;
  } finally {
    (globalThis as any).__mcpUseHmrMode = previousHmrMode ?? false;
  }
}

async function buildWidgets(
  projectPath: string,
  options: {
    inline?: boolean;
    widgetsDir?: string;
  } = {}
): Promise<Array<{ name: string; metadata: any }>> {
  const { inline = true } = options; // Default to true for VS Code compatibility
  const { promises: fs } = await import("node:fs");
  const { build } = await import("vite");

  // Resolve the widgets directory. Callers pass a relative path via
  // `widgetsDir` (from config / --widgets-dir / --mcp-dir); default is "resources".
  const widgetsDirRelative = options.widgetsDir ?? "resources";
  const resourcesDir = path.resolve(projectPath, widgetsDirRelative);

  // Get base URL from environment or use default
  const mcpUrl = process.env.MCP_URL;

  // Check if resources directory exists
  try {
    await access(resourcesDir);
  } catch {
    console.log(
      chalk.gray(
        `No ${widgetsDirRelative}/ directory found - skipping widget build`
      )
    );
    return [];
  }

  // Find all TSX widget files and folders with widget.tsx
  const entries: Array<{ name: string; path: string }> = [];
  try {
    const files = await fs.readdir(resourcesDir, { withFileTypes: true });
    for (const dirent of files) {
      // Exclude macOS resource fork files and other hidden/system files
      if (dirent.name.startsWith("._") || dirent.name.startsWith(".DS_Store")) {
        continue;
      }

      if (
        dirent.isFile() &&
        (dirent.name.endsWith(".tsx") || dirent.name.endsWith(".ts"))
      ) {
        // Single file widget
        entries.push({
          name: dirent.name.replace(/\.tsx?$/, ""),
          path: path.join(resourcesDir, dirent.name),
        });
      } else if (dirent.isDirectory()) {
        // Check for widget.tsx in folder
        const widgetPath = path.join(resourcesDir, dirent.name, "widget.tsx");
        try {
          await fs.access(widgetPath);
          entries.push({
            name: dirent.name,
            path: widgetPath,
          });
        } catch {
          // widget.tsx doesn't exist in this folder, skip it
        }
      }
    }
  } catch (error) {
    console.log(
      chalk.gray(`No widgets found in ${widgetsDirRelative}/ directory`)
    );
    return [];
  }

  if (entries.length === 0) {
    console.log(
      chalk.gray(`No widgets found in ${widgetsDirRelative}/ directory`)
    );
    return [];
  }

  console.log(
    chalk.gray(
      `Building ${entries.length} widget(s)${inline ? " (inline mode for VS Code compatibility)" : ""}...`
    )
  );

  const react = (await import("@vitejs/plugin-react")).default;
  // @ts-ignore - @tailwindcss/vite may not have type declarations
  const tailwindcss = (await import("@tailwindcss/vite")).default;

  // Check whether the project has a tsconfig.json. When present, we enable
  // Vite's native `resolve.tsconfigPaths` so widgets that `import '@/components/...'`
  // resolve through the project's own path aliases (e.g. a Next.js app where
  // `@/*` → `src/*`). When absent, we fall back to a hardcoded `@` → resourcesDir
  // alias below.
  const projectTsconfigPath = path.join(projectPath, "tsconfig.json");
  let hasProjectTsconfig = false;
  try {
    await access(projectTsconfigPath);
    hasProjectTsconfig = true;
  } catch {
    // No tsconfig — fall back to the legacy "@" → resourcesDir alias
  }

  // Read favicon config from package.json
  const packageJsonPath = path.join(projectPath, "package.json");
  let favicon = "";
  try {
    const pkgContent = await fs.readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(pkgContent);
    favicon = pkg.mcpUse?.favicon || "";
  } catch {
    // No package.json or no mcpUse config, that's fine
  }

  // Helper function to build a single widget
  const buildSingleWidget = async (entry: { name: string; path: string }) => {
    const widgetName = entry.name;
    const entryPath = entry.path.replace(/\\/g, "/");

    console.log(chalk.gray(`  - Building ${widgetName}...`));

    // Create temp directory for build artifacts
    const tempDir = path.join(projectPath, ".mcp-use", widgetName);
    await fs.mkdir(tempDir, { recursive: true });

    // Create CSS file with Tailwind directives
    const relativeResourcesPath = path
      .relative(tempDir, resourcesDir)
      .replace(/\\/g, "/");

    // Calculate relative path to mcp-use package dynamically
    const mcpUsePath = path.join(projectPath, "node_modules", "mcp-use");
    const relativeMcpUsePath = path
      .relative(tempDir, mcpUsePath)
      .replace(/\\/g, "/");

    // When the project has a `src/` tree (typical for Next.js apps), tell
    // Tailwind to scan it too — otherwise classes used inside shared
    // components imported via `@/components/...` would be missing from the
    // widget bundle.
    const projectSrcDir = path.join(projectPath, "src");
    let projectSrcSourceLine = "";
    try {
      await access(projectSrcDir);
      const relativeProjectSrcPath = path
        .relative(tempDir, projectSrcDir)
        .replace(/\\/g, "/");
      projectSrcSourceLine = `@source "${relativeProjectSrcPath}";\n`;
    } catch {
      // No src/ directory at the project root, skip
    }

    const cssContent = `@import "tailwindcss";\n\n/* Configure Tailwind to scan the resources directory and mcp-use package */\n@source "${relativeResourcesPath}";\n@source "${relativeMcpUsePath}/**/*.{ts,tsx,js,jsx}";\n${projectSrcSourceLine}`;
    await fs.writeFile(path.join(tempDir, "styles.css"), cssContent, "utf8");

    // Create entry file
    const entryContent = `import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import Component from '${entryPath}'

const container = document.getElementById('widget-root')
if (container && Component) {
  const root = createRoot(container)
  root.render(<Component />)
}
`;

    // Create HTML template
    const htmlContent = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${widgetName} Widget</title>${
      favicon
        ? `
    <link rel="icon" href="/mcp-use/public/${favicon}" />`
        : ""
    }
  </head>
  <body>
    <div id="widget-root"></div>
    <script type="module" src="/entry.tsx"></script>
  </body>
</html>`;

    await fs.writeFile(path.join(tempDir, "entry.tsx"), entryContent, "utf8");
    await fs.writeFile(path.join(tempDir, "index.html"), htmlContent, "utf8");

    // Build with Vite
    const outDir = path.join(
      projectPath,
      "dist",
      "resources",
      "widgets",
      widgetName
    );

    // Set base URL: use MCP_URL if set, otherwise relative path
    const baseUrl = mcpUrl
      ? `${mcpUrl}/${widgetName}/`
      : `/mcp-use/widgets/${widgetName}/`;

    // Extract metadata from widget before building
    let widgetMetadata: any = {};
    try {
      // Use a completely isolated temp directory for metadata extraction to avoid conflicts
      const metadataTempDir = path.join(
        projectPath,
        ".mcp-use",
        `${widgetName}-metadata`
      );
      await fs.mkdir(metadataTempDir, { recursive: true });

      const { createServer } = await import("vite");

      // Plugin to provide browser stubs for Node.js-only packages
      const nodeStubsPlugin = {
        name: "node-stubs",
        enforce: "pre" as const,
        resolveId(id: string) {
          if (id === "posthog-node" || id.startsWith("posthog-node/")) {
            return "\0virtual:posthog-node-stub";
          }
          return null;
        },
        load(id: string) {
          if (id === "\0virtual:posthog-node-stub") {
            return `
export class PostHog {
  constructor() {}
  capture() {}
  identify() {}
  alias() {}
  flush() { return Promise.resolve(); }
  shutdown() { return Promise.resolve(); }
}
export default PostHog;
`;
          }
          return null;
        },
      };

      const serverOnlyGuard = makeWidgetServerOnlyGuard(widgetName);

      const metadataServer = await createServer({
        root: metadataTempDir,
        cacheDir: path.join(metadataTempDir, ".vite-cache"),
        plugins: [serverOnlyGuard, nodeStubsPlugin, tailwindcss(), react()],
        // When the project has a tsconfig, enable Vite's native tsconfig-paths
        // resolver so `@/*` (or any custom alias) resolves through the
        // project's own paths config. Without a tsconfig, fall back to the
        // legacy hardcoded alias.
        resolve: hasProjectTsconfig
          ? { tsconfigPaths: true }
          : { alias: { "@": resourcesDir } },
        server: {
          middlewareMode: true,
        },
        optimizeDeps: {
          // Exclude Node.js-only packages from browser bundling
          exclude: ["posthog-node"],
        },
        ssr: {
          // Force Vite to transform these packages in SSR instead of using external requires
          noExternal: ["@openai/apps-sdk-ui", "react-router"],
          // Mark Node.js-only packages as external in SSR mode
          external: ["posthog-node"],
        },
        define: {
          // Define process.env for SSR context
          "process.env.NODE_ENV": JSON.stringify(
            process.env.NODE_ENV || "development"
          ),
          "import.meta.env.DEV": true,
          "import.meta.env.PROD": false,
          "import.meta.env.MODE": JSON.stringify("development"),
          "import.meta.env.SSR": true,
        },
        clearScreen: false,
        logLevel: "silent",
        customLogger: {
          info: () => {},
          warn: () => {},
          error: () => {},
          clearScreen: () => {},
          hasErrorLogged: () => false,
          hasWarned: false,
          warnOnce: () => {},
        },
      });

      try {
        const mod = await metadataServer.ssrLoadModule(entryPath);
        if (mod.widgetMetadata) {
          // Handle props (preferred) or inputs (deprecated) field
          const schemaField =
            mod.widgetMetadata.props || mod.widgetMetadata.inputs;

          // Check if schemaField is a Zod v4 schema (has ~standard property from Standard Schema)
          // and convert to JSON Schema for serialization using Zod v4's built-in toJsonSchema
          let inputsValue = schemaField || {};
          if (
            schemaField &&
            typeof schemaField === "object" &&
            "~standard" in schemaField
          ) {
            // Convert Zod schema to JSON Schema for manifest serialization
            try {
              inputsValue = toJSONSchema(schemaField);
            } catch (conversionError) {
              console.warn(
                chalk.yellow(
                  `    ⚠ Could not convert schema for ${widgetName}, using raw schema`
                )
              );
            }
          }

          // Destructure to exclude props (raw Zod schema) from being serialized
          const {
            props: _rawProps,
            inputs: _rawInputs,
            ...restMetadata
          } = mod.widgetMetadata;

          widgetMetadata = {
            ...restMetadata,
            title: mod.widgetMetadata.title || widgetName,
            description: mod.widgetMetadata.description,
            // Store the converted JSON Schema (props field is used by production mount)
            props: inputsValue,
            inputs: inputsValue,
          };
        }
        // Give a moment for any background esbuild operations to complete
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (error) {
        console.warn(
          chalk.yellow(`    ⚠ Could not extract metadata for ${widgetName}`)
        );
      } finally {
        await metadataServer.close();
        // Clean up metadata temp directory
        try {
          await fs.rm(metadataTempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      // Silently skip metadata extraction if it fails
    }

    try {
      // Enhanced plugin to stub Node.js-only packages and built-ins
      const buildNodeStubsPlugin = {
        name: "node-stubs-build",
        enforce: "pre" as const,
        resolveId(id: string) {
          // Stub posthog-node
          if (id === "posthog-node" || id.startsWith("posthog-node/")) {
            return "\0virtual:posthog-node-stub";
          }
          // Stub path module for browser builds
          if (id === "path" || id === "node:path") {
            return "\0virtual:path-stub";
          }
          return null;
        },
        load(id: string) {
          if (id === "\0virtual:posthog-node-stub") {
            return `
export class PostHog {
  constructor() {}
  capture() {}
  identify() {}
  alias() {}
  flush() { return Promise.resolve(); }
  shutdown() { return Promise.resolve(); }
}
export default PostHog;
`;
          }
          if (id === "\0virtual:path-stub") {
            return `
export function join(...paths) {
  return paths.filter(Boolean).join("/").replace(/\\/\\//g, "/").replace(/\\/$/, "");
}
export function resolve(...paths) {
  return join(...paths);
}
export function dirname(filepath) {
  const parts = filepath.split("/");
  parts.pop();
  return parts.join("/") || "/";
}
export function basename(filepath, ext) {
  const parts = filepath.split("/");
  let name = parts[parts.length - 1] || "";
  if (ext && name.endsWith(ext)) {
    name = name.slice(0, -ext.length);
  }
  return name;
}
export function extname(filepath) {
  const name = basename(filepath);
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index) : "";
}
export function normalize(filepath) {
  return filepath.replace(/\\/\\//g, "/");
}
export function isAbsolute(filepath) {
  return filepath.startsWith("/");
}
export const sep = "/";
export const delimiter = ":";
export const posix = {
  join,
  resolve,
  dirname,
  basename,
  extname,
  normalize,
  isAbsolute,
  sep,
  delimiter,
};
export default {
  join,
  resolve,
  dirname,
  basename,
  extname,
  normalize,
  isAbsolute,
  sep,
  delimiter,
  posix,
};
`;
          }
          return null;
        },
      };

      // Build plugins array - add viteSingleFile when inlining for VS Code compatibility.
      // `@/*` aliases are resolved via Vite's native `resolve.tsconfigPaths`
      // below (when the project has a tsconfig.json at the root); this is what
      // lets a widget inside a Next.js app `import '@/components/ui/card'`
      // and resolve it through the app's own paths config.
      const buildServerOnlyGuard = makeWidgetServerOnlyGuard(widgetName);
      const buildPlugins = inline
        ? [
            buildServerOnlyGuard,
            buildNodeStubsPlugin,
            tailwindcss(),
            react(),
            viteSingleFile({ removeViteModuleLoader: true }),
          ]
        : [buildServerOnlyGuard, buildNodeStubsPlugin, tailwindcss(), react()];

      await build({
        root: tempDir,
        base: baseUrl,
        plugins: buildPlugins,
        // Only use renderBuiltUrl for non-inline builds (external assets need runtime URL resolution)
        ...(inline
          ? {}
          : {
              experimental: {
                renderBuiltUrl: (
                  filename: string,
                  { hostType }: { hostType: string }
                ) => {
                  if (["js", "css"].includes(hostType)) {
                    return {
                      runtime: `window.__getFile(${JSON.stringify(filename)})`,
                    };
                  } else {
                    return { relative: true };
                  }
                },
              },
            }),
        // When a tsconfig exists, enable Vite's native `resolve.tsconfigPaths`
        // so the project's path aliases resolve naturally. Otherwise fall
        // back to the legacy `@` → resourcesDir alias.
        resolve: hasProjectTsconfig
          ? { tsconfigPaths: true }
          : { alias: { "@": resourcesDir } },
        optimizeDeps: {
          // Exclude Node.js-only packages from browser bundling
          exclude: ["posthog-node"],
        },
        build: {
          outDir,
          emptyOutDir: true,
          // Disable source maps to avoid CSP eval violations
          // Source maps can use eval-based mappings which break strict CSP policies
          sourcemap: false,
          // Minify for smaller bundle size
          minify: true,
          // Widgets bundle React+Zod; suppress expected chunk size warning
          chunkSizeWarningLimit: 1024,
          // For inline builds, disable CSS code splitting and inline all assets
          ...(inline
            ? {
                cssCodeSplit: false,
                assetsInlineLimit: 100000000, // Inline all assets under 100MB (effectively all)
              }
            : {}),
          rolldownOptions: {
            input: path.join(tempDir, "index.html"),
            external: (id) => {
              return false;
            },
          },
        },
      });

      // Post-process JS bundles to patch Zod's JIT compilation
      // This prevents CSP eval violations in sandboxed iframes (MCP Apps hosts)
      // See: https://github.com/colinhacks/zod/issues/4461
      try {
        const assetsDir = path.join(outDir, "assets");
        const assetFiles = await fs.readdir(assetsDir);
        const jsFiles = assetFiles.filter((f) => f.endsWith(".js"));

        for (const jsFile of jsFiles) {
          const jsPath = path.join(assetsDir, jsFile);
          let content = await fs.readFile(jsPath, "utf8");

          // Patch Zod's globalConfig to disable JIT compilation
          // Zod 4.x uses: const globalConfig={};function config(o){return globalConfig}
          // After minification: const X={};function Y(o){return X}
          // We match the pattern where an empty object const is followed by a function returning it
          const zodConfigPatterns = [
            // Non-minified: export const globalConfig = {}
            /export\s+const\s+globalConfig\s*=\s*\{\s*\}/g,
            // Minified pattern: ZodEncodeError"}}const X={};function followed by return X
            // This is the unique signature of Zod's globalConfig
            /ZodEncodeError[^}]*\}\}const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\{\s*\}/g,
          ];

          let patched = false;
          for (const pattern of zodConfigPatterns) {
            if (pattern.test(content)) {
              // Reset lastIndex for global regex
              pattern.lastIndex = 0;
              content = content.replace(pattern, (match) => {
                return match.replace(/=\s*\{\s*\}/, "={jitless:true}");
              });
              patched = true;
            }
          }

          if (patched) {
            await fs.writeFile(jsPath, content, "utf8");
            console.log(chalk.gray(`    → Patched Zod JIT in ${jsFile}`));
          }
        }
      } catch (error) {
        // Assets directory might not exist for some builds, that's okay
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(chalk.yellow(`    ⚠ Failed to patch Zod JIT: ${error}`));
        }
      }

      // Post-process HTML for static deployments (e.g., Supabase)
      // If MCP_SERVER_URL is set, inject window globals at build time
      const mcpServerUrl = process.env.MCP_SERVER_URL;
      if (mcpServerUrl) {
        try {
          const htmlPath = path.join(outDir, "index.html");
          let html = await fs.readFile(htmlPath, "utf8");

          // Inject window.__mcpPublicUrl and window.__getFile into <head>
          // Note: __mcpPublicUrl uses standard format for useWidget to derive mcp_url
          // __mcpPublicAssetsUrl points to where public files are actually stored
          const injectionScript = `<script>window.__getFile = (filename) => { return "${mcpUrl}/${widgetName}/"+filename }; window.__mcpPublicUrl = "${mcpServerUrl}/mcp-use/public"; window.__mcpPublicAssetsUrl = "${mcpUrl}/public";</script>`;

          // Check if script tag already exists in head
          if (!html.includes("window.__mcpPublicUrl")) {
            html = html.replace(
              /<head[^>]*>/i,
              `<head>\n    ${injectionScript}`
            );
          }

          // Update base href if it exists, or inject it
          if (/<base\s+[^>]*\/?>/i.test(html)) {
            // Replace existing base tag
            html = html.replace(
              /<base\s+[^>]*\/?>/i,
              `<base href="${mcpServerUrl}">`
            );
          } else {
            // Inject base tag after the injection script
            html = html.replace(
              injectionScript,
              `${injectionScript}\n    <base href="${mcpServerUrl}">`
            );
          }

          await fs.writeFile(htmlPath, html, "utf8");
          console.log(
            chalk.gray(`    → Injected MCP_SERVER_URL into ${widgetName}`)
          );
        } catch (error) {
          console.warn(
            chalk.yellow(
              `    ⚠ Failed to post-process HTML for ${widgetName}:`,
              error
            )
          );
        }
      }

      console.log(chalk.green(`    ✓ Built ${widgetName}`));
      return {
        status: "built" as const,
        name: widgetName,
        metadata: widgetMetadata,
      };
    } catch (error) {
      console.error(chalk.red(`    ✗ Failed to build ${widgetName}:`), error);
      return { status: "failed" as const, name: widgetName };
    }
  };

  // Build all widgets in parallel
  const buildResults = await Promise.all(
    entries.map((entry) => buildSingleWidget(entry))
  );

  const failed = buildResults.filter((r) => r.status === "failed");
  if (failed.length > 0) {
    // A failed widget build must fail the whole `mcp-use build`. Silently
    // dropping failures produced a manifest that looked healthy but shipped
    // zero widgets at runtime — indistinguishable from a project that
    // intentionally has none. Throw so the outer try/catch exits non-zero.
    const names = failed.map((f) => f.name).join(", ");
    throw new Error(
      `${failed.length} widget(s) failed to build: ${names}. See errors above.`
    );
  }

  return buildResults.flatMap((r) =>
    r.status === "built" ? [{ name: r.name, metadata: r.metadata }] : []
  );
}

/**
 * Collect TypeScript files from tsconfig include/exclude patterns using only
 * Node.js built-ins (no globby/fast-glob, which break in ESM bundles).
 */
async function collectTsFiles(
  projectPath: string,
  includePatterns: string[],
  excludePatterns: string[]
): Promise<string[]> {
  const { promises: fs } = await import("node:fs");

  // Separate literal files from directory globs
  const literalFiles: string[] = [];
  const dirPrefixes: string[] = [];

  for (const pattern of includePatterns) {
    if (pattern.includes("*")) {
      // Extract directory prefix before the first wildcard
      const prefix = pattern.split("*")[0].replace(/\/+$/, "") || ".";
      dirPrefixes.push(prefix);
    } else {
      literalFiles.push(pattern);
    }
  }

  const files: string[] = [];

  // Add literal files that exist and are .ts/.tsx (not .d.ts)
  for (const file of literalFiles) {
    if (/\.tsx?$/.test(file) && !file.endsWith(".d.ts")) {
      try {
        await access(path.join(projectPath, file));
        files.push(file);
      } catch {
        // File doesn't exist, skip
      }
    }
  }

  // Recursively scan directories
  const excludeSet = new Set(excludePatterns.map((e) => e.replace(/\*+/g, "")));
  for (const prefix of dirPrefixes) {
    const dirPath = path.join(projectPath, prefix);
    try {
      const entries = await fs.readdir(dirPath, { recursive: true });
      for (const entry of entries) {
        const entryStr = String(entry);
        const rel = path.join(prefix, entryStr);
        if (
          /\.tsx?$/.test(entryStr) &&
          !entryStr.endsWith(".d.ts") &&
          !excludeSet.has(rel.split(path.sep)[0])
        ) {
          files.push(rel);
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return files;
}

/**
 * Transpile TypeScript files using esbuild instead of tsc.
 * esbuild strips types without analyzing them, so it cannot OOM on complex types.
 * Reads the project's tsconfig.json to determine source files, outDir, and compiler options.
 */
async function transpileWithEsbuild(projectPath: string): Promise<void> {
  const esbuild = await import("esbuild");
  const { promises: fs } = await import("node:fs");

  const tsconfigPath = path.join(projectPath, "tsconfig.json");
  let tsconfig: any = {};
  try {
    const raw = await fs.readFile(tsconfigPath, "utf-8");
    tsconfig = JSON.parse(raw);
  } catch {
    // No tsconfig — use defaults
  }

  const compilerOptions = tsconfig.compilerOptions || {};
  const outDir = compilerOptions.outDir || "./dist";
  const includePatterns = tsconfig.include || ["**/*.ts", "**/*.tsx"];
  const excludePatterns = tsconfig.exclude || ["node_modules", "dist"];

  const files = await collectTsFiles(
    projectPath,
    includePatterns,
    excludePatterns
  );

  if (files.length === 0) {
    console.log(chalk.yellow("  No TypeScript files found to transpile."));
    return;
  }

  // Map tsconfig jsx setting to esbuild equivalent
  const jsxMap: Record<string, "automatic" | "transform" | "preserve"> = {
    "react-jsx": "automatic",
    "react-jsxdev": "automatic",
    react: "transform",
    preserve: "preserve",
  };
  const jsx = jsxMap[compilerOptions.jsx] || undefined;

  const target = (compilerOptions.target || "ES2022").toLowerCase();

  const moduleStr = (compilerOptions.module || "ESNext").toLowerCase();
  const format: "esm" | "cjs" = moduleStr.includes("commonjs") ? "cjs" : "esm";

  // Match tsc's rootDir behavior: when set, esbuild's outbase should map to it
  // so that `src/index.ts` → `dist/index.js` (not `dist/src/index.js`).
  const outbase = compilerOptions.rootDir
    ? path.resolve(projectPath, compilerOptions.rootDir)
    : projectPath;

  await esbuild.build({
    entryPoints: files.map((f) => path.join(projectPath, f)),
    outdir: path.join(projectPath, outDir),
    outbase,
    bundle: false,
    format,
    target,
    jsx,
    sourcemap: compilerOptions.sourceMap ?? true,
    tsconfig: tsconfigPath,
    platform: "node",
    logLevel: "warning",
  });
}

program
  .command("build")
  .description("Build TypeScript and MCP UI widgets")
  .option("-p, --path <path>", "Path to project directory", process.cwd())
  .option(
    "--entry <file>",
    "Path to MCP server entry file (relative to project)"
  )
  .option(
    "--widgets-dir <dir>",
    "Path to widgets directory (relative to project)"
  )
  .option(
    "--mcp-dir <dir>",
    "Folder holding the MCP entry + resources (e.g. 'src/mcp' for Next.js apps)"
  )
  .option("--with-inspector", "Include inspector in production build")
  .option(
    "--inline",
    "Inline all JS/CSS into HTML (required for VS Code MCP Apps)"
  )
  .option("--no-inline", "Keep JS/CSS as separate files (default)")
  .option("--no-typecheck", "Skip TypeScript type checking (faster builds)")
  .action(async (options) => {
    try {
      const projectPath = path.resolve(options.path);
      const { promises: fs } = await import("node:fs");

      displayPackageVersions(projectPath);

      // Resolve mcpDir for widgets + server entry
      const mcpDir = options.mcpDir as string | undefined;
      const widgetsDir = resolveWidgetsDir(options.widgetsDir, mcpDir);

      // Build widgets first (this generates schemas)
      // Use --inline flag for VS Code compatibility (VS Code's CSP blocks external scripts)
      const builtWidgets = await buildWidgets(projectPath, {
        inline: options.inline ?? false,
        widgetsDir,
      });

      // Find the source server file before building
      let sourceServerFile: string | undefined;
      try {
        sourceServerFile = await findServerFile(
          projectPath,
          options.entry,
          options.mcpDir
        );
      } catch (err) {
        // No server file found. Widget-only projects hit this on purpose,
        // but a misconfigured --mcp-dir is a user error worth surfacing so
        // it doesn't cascade into a manifest without an entryPoint and an
        // unclear start-time failure.
        console.log(
          chalk.yellow(
            `⚠ Could not locate a server entry file: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }

      if (sourceServerFile) {
        console.log(chalk.gray("Generating tool registry types..."));
        const typeGenOk = await generateToolRegistryTypesForServer(
          projectPath,
          sourceServerFile
        );
        if (typeGenOk) {
          console.log(chalk.green("✓ Tool registry types generated"));
        } else {
          console.log(
            chalk.yellow(
              "⚠ Tool registry type generation had errors (non-blocking)"
            )
          );
        }
      }

      // Transpile TypeScript with esbuild (fast, no OOM on complex types).
      // Type checking is a separate step via tsc --noEmit (skippable with --no-typecheck).
      //
      // SKIPPED when --mcp-dir is set (drop-in Next.js layout). The host app
      // (Next.js) owns its own build; trying to transpile every .ts/.tsx in
      // a Next.js project chokes on files like `tailwind.config.ts` that are
      // never meant to be runtime-compiled and on RSC-only files that
      // esbuild doesn't understand. In --mcp-dir mode, `mcp-use start` runs
      // the TypeScript source directly via tsx (same setup as `mcp-use dev`,
      // minus HMR), so there's nothing to transpile ahead of time. The
      // manifest written below still records the .ts source as the entry.
      if (!mcpDir) {
        console.log(chalk.gray("Building TypeScript..."));
        await transpileWithEsbuild(projectPath);
        console.log(chalk.green("✓ TypeScript build complete!"));
      } else {
        console.log(
          chalk.gray(
            "Skipping TypeScript transpile (--mcp-dir mode runs source via tsx at start time)"
          )
        );
      }

      // Type-check with tsc --noEmit (separate from transpilation).
      // Uses the locally installed typescript binary directly rather than npx to
      // prevent npx from auto-installing the unrelated `tsc@2.0.4` package.
      // Also skipped in --mcp-dir mode — the host Next.js app is responsible
      // for type-checking its own tree during `next build`.
      if (options.typecheck !== false && !mcpDir) {
        console.log(chalk.gray("Type checking..."));
        try {
          await runCommand(
            "node",
            [
              "--max-old-space-size=4096",
              path.join(
                projectPath,
                "node_modules",
                "typescript",
                "bin",
                "tsc"
              ),
              "--noEmit",
            ],
            projectPath
          ).promise;
          console.log(chalk.green("✓ Type check passed!"));
        } catch {
          console.error(
            chalk.red("✗ Type check failed.") +
              chalk.gray(" Use --no-typecheck to skip.")
          );
          process.exit(1);
        }
      }

      // Determine the entry point `mcp-use start` should run.
      //   - Legacy layout: the file was transpiled to dist/ above; record
      //     the compiled .js path.
      //   - --mcp-dir layout: no transpile step ran, so point the manifest
      //     at the .ts source. `mcp-use start` loads it via tsx (same setup
      //     as `mcp-use dev`, minus HMR).
      let entryPoint: string | undefined;
      if (sourceServerFile) {
        if (mcpDir) {
          entryPoint = sourceServerFile;
        } else {
          // Check possible output locations based on common tsconfig patterns
          // tsc may or may not preserve the src/ prefix depending on rootDir setting
          const baseName = path.basename(sourceServerFile, ".ts") + ".js";
          const possibleOutputs = [
            `dist/${baseName}`, // rootDir set to project root or src
            `dist/src/${baseName}`, // no rootDir, source in src/
            `dist/${sourceServerFile.replace(/\.ts$/, ".js")}`, // exact path preserved
          ];
          for (const candidate of possibleOutputs) {
            try {
              await access(path.join(projectPath, candidate));
              entryPoint = candidate;
              break;
            } catch {
              continue;
            }
          }
        }
      }

      // Copy public folder if it exists
      const publicDir = path.join(projectPath, "public");
      try {
        await fs.access(publicDir);
        console.log(chalk.gray("Copying public assets..."));
        await fs.cp(publicDir, path.join(projectPath, "dist", "public"), {
          recursive: true,
        });
        console.log(chalk.green("✓ Public assets copied"));
      } catch {
        // Public folder doesn't exist, skip
      }

      // Create build manifest
      const manifestPath = path.join(projectPath, "dist", "mcp-use.json");

      // Read existing manifest to preserve tunnel subdomain and other fields
      let existingManifest: any = {};
      try {
        const existingContent = await fs.readFile(manifestPath, "utf-8");
        existingManifest = JSON.parse(existingContent);
      } catch {
        // File doesn't exist, that's okay
      }

      // Transform builtWidgets array into widgets object with metadata
      const widgetsData: Record<string, any> = {};
      for (const widget of builtWidgets) {
        widgetsData[widget.name] = widget.metadata;
      }

      // Convert to boolean: true if flag is present, false otherwise
      const includeInspector = !!options.withInspector;

      // Generate a build ID (hash of build time + random component for uniqueness)
      const buildTime = new Date().toISOString();
      const { createHash } = await import("node:crypto");
      const buildId = createHash("sha256")
        .update(buildTime + Math.random().toString())
        .digest("hex")
        .substring(0, 16); // Use first 16 chars for shorter IDs

      // Merge with existing manifest, preserving tunnel and other fields
      const manifest = {
        ...existingManifest, // Preserve existing fields like tunnel
        includeInspector,
        buildTime,
        buildId,
        entryPoint, // Server entry point for `mcp-use start`
        widgets: widgetsData,
      };

      await fs.mkdir(path.dirname(manifestPath), { recursive: true });
      await fs.writeFile(
        manifestPath,
        JSON.stringify(manifest, null, 2),
        "utf8"
      );
      console.log(chalk.green("✓ Build manifest created"));

      console.log(chalk.green.bold(`\n✓ Build complete!`));
      if (builtWidgets.length > 0) {
        console.log(chalk.gray(`  ${builtWidgets.length} widget(s) built`));
      }
      if (options.withInspector) {
        console.log(chalk.gray("  Inspector included"));
      }
      process.exit(0);
    } catch (error) {
      console.error(chalk.red("Build failed:"), error);
      process.exit(1);
    }
  });

program
  .command("dev")
  .description("Run development server with auto-reload and inspector")
  .option("-p, --path <path>", "Path to project directory", process.cwd())
  .option(
    "--entry <file>",
    "Path to MCP server entry file (relative to project)"
  )
  .option(
    "--widgets-dir <dir>",
    "Path to widgets directory (relative to project)"
  )
  .option(
    "--mcp-dir <dir>",
    "Folder holding the MCP entry + resources (e.g. 'src/mcp' for Next.js apps)"
  )
  .option("--port <port>", "Server port", "3000")
  .option(
    "--host <host>",
    "Server host (use 0.0.0.0 to listen on all interfaces)",
    "0.0.0.0"
  )
  .option("--no-open", "Do not auto-open inspector")
  .option("--no-hmr", "Disable hot module reloading (use tsx watch instead)")
  .option("--tunnel", "Expose server through a tunnel")
  .action(async (options) => {
    try {
      process.env.MCP_USE_CLI_DEV = "1";
      const projectPath = path.resolve(options.path);
      let port = parseInt(options.port, 10);
      const host = options.host;
      const useHmr = options.hmr !== false;

      displayPackageVersions(projectPath);

      // Check if port is available, find alternative if needed
      if (!(await isPortAvailable(port, host))) {
        console.log(chalk.yellow.bold(`⚠️  Port ${port} is already in use`));
        const availablePort = await findAvailablePort(port, host);
        console.log(chalk.green.bold(`✓ Using port ${availablePort} instead`));
        port = availablePort;
      }

      // Find the main source file (honors --entry / --mcp-dir flags and mcp-use.config.json)
      const serverFile = await findServerFile(
        projectPath,
        options.entry,
        options.mcpDir
      );

      // Resolve the widgets directory and expose it via an env var so the
      // running MCPServer (which picks `resources/` by default) discovers
      // widgets at `<mcpDir>/resources` when the developer used --mcp-dir.
      // The env var is the contract: mcp-use/server reads it when no
      // explicit `resourcesDir` is passed to mountWidgets.
      {
        const devMcpDir = options.mcpDir as string | undefined;
        const devWidgetsDir = resolveWidgetsDir(options.widgetsDir, devMcpDir);
        if (devWidgetsDir !== "resources") {
          process.env.MCP_USE_WIDGETS_DIR = devWidgetsDir;
        }
      }

      // Start tunnel if requested
      let tunnelProcess: any = undefined;
      let tunnelSubdomain: string | undefined = undefined;
      let tunnelUrl: string | undefined = undefined;

      if (options.tunnel) {
        try {
          const manifestPath = path.join(projectPath, "dist", "mcp-use.json");
          let existingSubdomain: string | undefined;

          try {
            const manifestContent = await readFile(manifestPath, "utf-8");
            const manifest = JSON.parse(manifestContent);
            existingSubdomain = manifest.tunnel?.subdomain;
            if (existingSubdomain) {
              console.log(
                chalk.gray(`Found existing subdomain: ${existingSubdomain}`)
              );
              const apiBase =
                process.env.MCP_USE_TUNNEL_API || "https://local.mcp-use.run";
              try {
                await fetch(`${apiBase}/api/tunnels/${existingSubdomain}`, {
                  method: "DELETE",
                });
              } catch {
                // Best-effort cleanup; ignore DELETE failures
              }
            }
          } catch {
            // Manifest doesn't exist or is invalid, that's okay
          }

          let tunnelInfo: Awaited<ReturnType<typeof startTunnel>>;
          try {
            tunnelInfo = await startTunnel(port, existingSubdomain);
          } catch (e) {
            if (existingSubdomain) {
              console.log(
                chalk.yellow(
                  `Subdomain "${existingSubdomain}" unavailable, requesting a new one…`
                )
              );
              tunnelInfo = await startTunnel(port);
            } else {
              throw e;
            }
          }
          tunnelUrl = tunnelInfo.url;
          tunnelProcess = tunnelInfo.process;
          tunnelSubdomain = tunnelInfo.subdomain;

          // Persist subdomain for reuse across restarts
          try {
            let manifest: any = {};
            try {
              const manifestContent = await readFile(manifestPath, "utf-8");
              manifest = JSON.parse(manifestContent);
            } catch {
              // File doesn't exist, create new manifest
            }

            if (!manifest.tunnel) {
              manifest.tunnel = {};
            }
            manifest.tunnel.subdomain = tunnelSubdomain;

            await mkdir(path.dirname(manifestPath), { recursive: true });
            await writeFile(
              manifestPath,
              JSON.stringify(manifest, null, 2),
              "utf-8"
            );
          } catch (error) {
            console.warn(
              chalk.yellow(
                `⚠️  Failed to save subdomain to mcp-use.json: ${error instanceof Error ? error.message : "Unknown error"}`
              )
            );
          }
        } catch (error) {
          console.error(chalk.red("Failed to start tunnel:"), error);
          process.exit(1);
        }
      }

      // Set environment variables for the server
      const mcpUrl = `http://${host}:${port}`;
      process.env.PORT = String(port);
      process.env.HOST = host;
      process.env.NODE_ENV = "development";
      // Tunnel URL takes priority; otherwise preserve user-provided MCP_URL (e.g., for reverse proxy setups)
      if (tunnelUrl) {
        process.env.MCP_URL = tunnelUrl;
      } else if (!process.env.MCP_URL) {
        process.env.MCP_URL = mcpUrl;
      }
      // Detect Next.js projects so we can install shims for server-only /
      // next/cache / next/headers / next/navigation / next/server — all of
      // which throw or misbehave outside a Next.js request context. We also
      // mirror Next.js's .env cascade so tools imported from the app find
      // the variables they expect (DB URLs, feature-flag keys, etc.).
      const isNextJsProject = await detectNextJsProject(projectPath);
      if (isNextJsProject) {
        console.log(
          chalk.gray(
            "Next.js detected — installing server-runtime shims (server-only, next/cache, next/headers, next/navigation, next/server)"
          )
        );
        await loadNextJsEnvFiles(projectPath);
      }

      if (!useHmr) {
        // Fallback: Use tsx watch (restarts process on changes)
        console.log(chalk.gray("HMR disabled, using tsx watch (full restart)"));

        const processes: any[] = [];
        const baseEnv: NodeJS.ProcessEnv = {
          // Inherit parent env (PATH, HOME, etc.) — without it, tsx can't
          // resolve its own tooling in some setups.
          ...process.env,
          PORT: String(port),
          HOST: host,
          NODE_ENV: "development",
          // Preserve user-provided MCP_URL (e.g., for reverse proxy setups)
          MCP_URL: process.env.MCP_URL || mcpUrl,
        };
        const env = isNextJsProject ? withNextShimsEnv(baseEnv) : baseEnv;

        // Use local tsx if available, otherwise fall back to npx
        const { createRequire } = await import("node:module");
        let cmd: string;
        let args: string[];
        try {
          const projectRequire = createRequire(
            path.join(projectPath, "package.json")
          );
          // Resolve tsx bin from package.json instead of hardcoding internal path
          const tsxPkgPath = projectRequire.resolve("tsx/package.json");
          const tsxPkg = JSON.parse(await readFile(tsxPkgPath, "utf-8"));
          // Handle both string and object forms of the bin field
          let binPath: string;
          if (typeof tsxPkg.bin === "string") {
            binPath = tsxPkg.bin;
          } else if (tsxPkg.bin && typeof tsxPkg.bin === "object") {
            // Use 'tsx' entry or the first entry
            binPath = tsxPkg.bin.tsx || Object.values(tsxPkg.bin)[0];
          } else {
            throw new Error("No bin field found in tsx package.json");
          }
          const tsxBin = path.resolve(path.dirname(tsxPkgPath), binPath);
          cmd = "node";
          args = [tsxBin, "watch", serverFile];
        } catch (error) {
          // tsx not found locally or bin resolution failed, use npx
          console.log(
            chalk.yellow(
              `Could not resolve local tsx: ${error instanceof Error ? error.message : "unknown error"}`
            )
          );
          cmd = "npx";
          args = ["tsx", "watch", serverFile];
        }

        const serverCommand = runCommand(cmd, args, projectPath, env, true);
        processes.push(serverCommand.process);

        // Auto-open inspector if enabled
        if (options.open !== false) {
          const startTime = Date.now();
          const browserHost = normalizeBrowserHost(host);
          const ready = await waitForServer(port, browserHost);
          if (ready) {
            const mcpEndpoint = `http://${browserHost}:${port}/mcp`;
            const autoConnectEndpoint = tunnelUrl
              ? `${tunnelUrl}/mcp`
              : mcpEndpoint;
            const inspectorUrl = `http://${browserHost}:${port}/inspector?autoConnect=${encodeURIComponent(autoConnectEndpoint)}`;

            const readyTime = Date.now() - startTime;
            console.log(chalk.green.bold(`✓ Ready in ${readyTime}ms`));
            console.log(
              chalk.whiteBright(`Local:    http://${browserHost}:${port}`)
            );
            console.log(chalk.whiteBright(`Network:  http://${host}:${port}`));
            console.log(chalk.whiteBright(`MCP:      ${mcpEndpoint}`));
            if (tunnelUrl) {
              console.log(chalk.whiteBright(`Tunnel:   ${tunnelUrl}/mcp`));
            }
            console.log(chalk.whiteBright(`Inspector: ${inspectorUrl}\n`));
            await open(inspectorUrl);
          }
        }

        // Handle cleanup
        let noHmrCleanupInProgress = false;
        const cleanup = async () => {
          if (noHmrCleanupInProgress) return;
          noHmrCleanupInProgress = true;

          console.log(chalk.gray("\n\nShutting down..."));

          if (
            tunnelProcess &&
            typeof (tunnelProcess as any).markShutdown === "function"
          ) {
            (tunnelProcess as any).markShutdown();
          }

          if (tunnelSubdomain) {
            try {
              const apiBase =
                process.env.MCP_USE_API || "https://local.mcp-use.run";
              await fetch(`${apiBase}/api/tunnels/${tunnelSubdomain}`, {
                method: "DELETE",
              });
            } catch {
              // Ignore cleanup errors
            }
          }

          processes.forEach((proc) => {
            if (proc && typeof proc.kill === "function") {
              proc.kill("SIGINT");
            }
          });

          if (tunnelProcess && typeof tunnelProcess.kill === "function") {
            tunnelProcess.kill("SIGINT");
          }

          setTimeout(() => process.exit(0), 2000);
        };

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

        await new Promise(() => {});
        return;
      }

      // HMR mode: Use chokidar to watch files and sync registrations
      console.log(
        chalk.gray(
          "HMR enabled - changes will hot reload without dropping connections"
        )
      );

      // Register Next.js server-runtime shims in-process. The HMR path calls
      // `tsImport` in this process (no child) so the loader has to be
      // registered here, before the first import of the user's server entry.
      if (isNextJsProject) {
        const registered = await registerNextShimsInProcess();
        if (!registered) {
          console.warn(
            chalk.yellow(
              "[HMR] Warning: Next.js shim loader could not be found on disk. " +
                "Importing server-only / next/cache / etc. will throw. " +
                "Reinstall @mcp-use/cli to fix."
            )
          );
        }
      }

      const chokidarModule = await import("chokidar");
      const chokidar = (chokidarModule as any).default || chokidarModule;
      const { fileURLToPath } = await import("node:url");
      const { createRequire } = await import("node:module");

      // Resolve the user's tsconfig up front — the server load path below
      // depends on tsx picking it up so `@/*` aliases resolve.
      const projectTsconfigPath = path.join(projectPath, "tsconfig.json");
      let tsconfigAvailable = false;
      try {
        await access(projectTsconfigPath);
        tsconfigAvailable = true;
        // Belt-and-braces: tsx also consults TSX_TSCONFIG_PATH and walks up
        // from cwd for auto-discovery. Setting both covers every tsx code
        // path (initialize hook, globalPreload hook, CJS require path).
        process.env.TSX_TSCONFIG_PATH = projectTsconfigPath;
        if (process.cwd() !== projectPath) process.chdir(projectPath);
      } catch {
        // No tsconfig at the project root — path aliases won't resolve.
      }

      // Install tsx's loader hooks globally (no namespace). We deliberately
      // do NOT use tsx's `tsImport` here: tsImport registers tsx with a
      // generated namespace, which causes tsx's resolver to bail for any
      // specifier whose URL doesn't carry that namespace — including all
      // transitive imports like `@/lib/...`. Registering without a namespace
      // means tsx's resolver runs for every specifier and always consults
      // the tsconfig paths matcher.
      //
      // We also need tsx's CJS register: a Next.js app's package.json has no
      // `"type": "module"`, so tsx compiles .ts to CJS, and the user entry's
      // `require()` chain needs tsx's CJS `.ts` compilation + tsconfig-paths
      // rewriting. Without tsx/cjs, require("@/lib/...") throws.
      //
      // After register, we use native dynamic `import()` with a ?t= cache
      // buster on each reload (same technique tsImport uses internally).
      let tsxLoaderActive = false;
      try {
        const projectRequire = createRequire(
          path.join(projectPath, "package.json")
        );

        // ESM side — tsx/esm/api.register()
        const tsxEsmApiPath = projectRequire.resolve("tsx/esm/api");
        const tsxEsmApi = await import(pathToFileURL(tsxEsmApiPath).href);
        if (typeof tsxEsmApi.register === "function") {
          tsxEsmApi.register({
            tsconfig: tsconfigAvailable ? projectTsconfigPath : undefined,
            onImport: (url: string) => {
              // `fileURLToPath` is in scope from the outer destructure above.
              const filePath = url.startsWith("file://")
                ? fileURLToPath(url)
                : url;
              if (
                !filePath.includes("node_modules") &&
                filePath.startsWith(projectPath)
              ) {
                console.debug(`[HMR] Loaded: ${url}`);
              }
            },
          });
          tsxLoaderActive = true;
        }

        // CJS side — tsx/cjs/api.register(). Handles require() of .ts files
        // and tsconfig-paths rewriting inside CJS-compiled modules.
        try {
          const tsxCjsApiPath = projectRequire.resolve("tsx/cjs/api");
          const tsxCjsApi = await import(pathToFileURL(tsxCjsApiPath).href);
          if (typeof tsxCjsApi.register === "function") {
            tsxCjsApi.register();
          }
        } catch {
          // tsx/cjs isn't exposed in some tsx minor versions; skipping is OK
          // as long as the ESM side is up. In practice tsx 4.x ships both.
        }
      } catch {
        console.log(
          chalk.yellow(
            "Warning: tsx not found in project dependencies. TypeScript HMR may not work.\n" +
              "Add tsx to your devDependencies: npm install -D tsx"
          )
        );
      }

      const serverFilePath = path.join(projectPath, serverFile);
      const serverFileUrl = pathToFileURL(serverFilePath).href;

      // Set HMR mode flag - this tells MCPServer.listen() to skip during imports
      // CLI manages the server lifecycle instead
      (globalThis as any).__mcpUseHmrMode = true;

      // Helper to import server module with cache busting
      const importServerModule = async () => {
        // Clear the global reference so we can detect if a new instance was created
        const previousServer = (globalThis as any).__mcpUseLastServer;
        (globalThis as any).__mcpUseLastServer = null;

        // Native dynamic import is the reload mechanism. tsx's resolver/
        // loader is registered globally above (no namespace), so TS files
        // and tsconfig `@/*` paths resolve automatically. The ?t= query
        // busts Node's module cache on every reload; transitive modules
        // also re-evaluate because their specifiers include the cache-busted
        // parent URL in the resolve chain.
        //
        // When tsx isn't available we still do native import — it'll only
        // work for JS files, which matches the old fallback behavior.
        if (!tsxLoaderActive) {
          // Unused: log already printed during register. Kept as a guard
          // so type-checkers can see the branch is intentional.
        }
        await import(`${serverFileUrl}?t=${Date.now()}`);

        // Get the server instance from the global registry
        // No export required - MCPServer tracks itself when created via globalThis
        const instance = (globalThis as any).__mcpUseLastServer;

        if (!instance) {
          // No new instance was created - restore the previous one
          (globalThis as any).__mcpUseLastServer = previousServer;
          console.warn(
            chalk.yellow(
              "[HMR] Warning: Module re-import did not create a new MCPServer instance. " +
                "The module may be cached. Check that your server file creates an MCPServer."
            )
          );
          return null;
        }

        if (instance === previousServer) {
          // Same instance reference - the module was cached and not re-evaluated
          console.warn(
            chalk.yellow(
              "[HMR] Warning: Module re-import returned the same server instance. " +
                "The module may not have been re-evaluated. " +
                (!tsxLoaderActive
                  ? "Install tsx as a devDependency for reliable TypeScript HMR."
                  : "This may be a module cache issue.")
            )
          );
          return null;
        }

        return instance;
      };

      // Initial import
      console.log(chalk.gray(`Loading server from ${serverFile}...`));
      let runningServer: any;

      try {
        runningServer = await importServerModule();

        if (!runningServer) {
          console.error(
            chalk.red(
              "Error: Could not find MCPServer instance.\n" +
                "Make sure your server file creates an MCPServer:\n" +
                "  const server = new MCPServer({ name: 'my-server', version: '1.0.0' });"
            )
          );
          process.exit(1);
        }

        // Check if it has the required methods
        if (typeof runningServer.listen !== "function") {
          console.error(
            chalk.red("Error: MCPServer instance must have a listen() method")
          );
          process.exit(1);
        }

        // Start the server - temporarily disable HMR flag so listen() works
        const startTime = Date.now();
        (globalThis as any).__mcpUseHmrMode = false;
        await runningServer.listen(port);
        (globalThis as any).__mcpUseHmrMode = true;

        // Auto-open inspector if enabled
        if (options.open !== false) {
          const browserHost = normalizeBrowserHost(host);
          const ready = await waitForServer(port, browserHost);
          if (ready) {
            const mcpEndpoint = `http://${browserHost}:${port}/mcp`;
            const autoConnectEndpoint = tunnelUrl
              ? `${tunnelUrl}/mcp`
              : mcpEndpoint;
            const inspectorUrl = `http://${browserHost}:${port}/inspector?autoConnect=${encodeURIComponent(autoConnectEndpoint)}`;

            const readyTime = Date.now() - startTime;
            console.log(chalk.green.bold(`✓ Ready in ${readyTime}ms`));
            console.log(
              chalk.whiteBright(`Local:    http://${browserHost}:${port}`)
            );
            console.log(chalk.whiteBright(`Network:  http://${host}:${port}`));
            console.log(chalk.whiteBright(`MCP:      ${mcpEndpoint}`));
            if (tunnelUrl) {
              console.log(chalk.whiteBright(`Tunnel:   ${tunnelUrl}/mcp`));
            }
            console.log(chalk.whiteBright(`Inspector: ${inspectorUrl}`));
            console.log(chalk.gray(`Watching for changes...\n`));
            await open(inspectorUrl);
          }
        }
      } catch (error: any) {
        console.error(
          chalk.red("Failed to start server:"),
          error?.message || error
        );
        if (error?.stack) {
          console.error(chalk.gray(error.stack));
        }
        process.exit(1);
      }

      // Log success when --no-open is used
      if (options.open === false) {
        const mcpEndpoint = `http://${host}:${port}/mcp`;
        console.log(chalk.green.bold(`✓ Server ready`));
        console.log(chalk.whiteBright(`Local:    http://${host}:${port}`));
        console.log(chalk.whiteBright(`MCP:      ${mcpEndpoint}`));
        if (tunnelUrl) {
          console.log(chalk.whiteBright(`Tunnel:   ${tunnelUrl}/mcp`));
        }
        console.log(chalk.gray(`Watching for changes...\n`));
      }

      // Watch for file changes - watch .ts/.tsx files in project directory
      let watcher = chokidar.watch(".", {
        cwd: projectPath,
        ignored: (path: string, stats?: any) => {
          // Normalize path separators for cross-platform compatibility
          const normalizedPath = path.replace(/\\/g, "/");

          // Ignore dotfiles and dot directories (hidden files)
          if (/(^|\/)\.[^/]/.test(normalizedPath)) {
            return true;
          }

          // Ignore node_modules directory and all its contents
          if (
            normalizedPath.includes("/node_modules/") ||
            normalizedPath.endsWith("/node_modules")
          ) {
            return true;
          }

          // Ignore dist directory and all its contents
          if (
            normalizedPath.includes("/dist/") ||
            normalizedPath.endsWith("/dist")
          ) {
            return true;
          }

          // Ignore resources directory (widgets watched separately by vite)
          if (
            normalizedPath.includes("/resources/") ||
            normalizedPath.endsWith("/resources")
          ) {
            return true;
          }

          // Ignore .d.ts files (TypeScript declaration files)
          if (stats?.isFile() && normalizedPath.endsWith(".d.ts")) {
            return true;
          }

          return false;
        },
        persistent: true,
        ignoreInitial: true,
        depth: 3, // Limit depth to avoid watching too many files
      });

      watcher
        .on("ready", () => {
          const watched = watcher.getWatched();
          const dirs = Object.keys(watched);
          console.log(
            chalk.gray(`[HMR] Watcher ready, watching ${dirs.length} paths`)
          );
        })
        .on("error", (error: unknown) => {
          console.error(
            chalk.red(
              `[HMR] Watcher error: ${error instanceof Error ? error.message : String(error)}`
            )
          );
        });

      // Debounce rapid changes
      let reloadTimeout: NodeJS.Timeout | null = null;
      let isReloading = false;

      const hmrOnChange = async (filePath: string) => {
        // Only handle .ts and .tsx files (not .d.ts)
        if (
          (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) ||
          filePath.endsWith(".d.ts")
        ) {
          return;
        }
        if (isReloading) return;

        // Debounce multiple rapid changes
        if (reloadTimeout) {
          clearTimeout(reloadTimeout);
        }

        reloadTimeout = setTimeout(async () => {
          isReloading = true;
          // filePath is already relative due to cwd option
          console.log(chalk.yellow(`\n[HMR] File changed: ${filePath}`));

          try {
            // Re-import the server module (this creates a new MCPServer instance)
            const newServer = await importServerModule();

            if (!newServer) {
              console.warn(
                chalk.yellow(
                  "[HMR] Warning: No MCPServer instance found after reload, skipping"
                )
              );
              isReloading = false;
              return;
            }

            // Check if the running server has syncRegistrationsFrom
            if (typeof runningServer.syncRegistrationsFrom !== "function") {
              console.warn(
                chalk.yellow(
                  "[HMR] Warning: Server does not support hot reload (missing syncRegistrationsFrom)"
                )
              );
              isReloading = false;
              return;
            }

            // Sync registrations from the new server to the running server
            const syncResult = runningServer.syncRegistrationsFrom(newServer);

            if (syncResult && syncResult.totalChanges > 0) {
              const parts: string[] = [];
              if (
                syncResult.tools.updated > 0 ||
                syncResult.tools.added > 0 ||
                syncResult.tools.removed > 0
              ) {
                const details: string[] = [];
                if (syncResult.tools.updated > 0)
                  details.push(`${syncResult.tools.updated} updated`);
                if (syncResult.tools.added > 0)
                  details.push(`${syncResult.tools.added} added`);
                if (syncResult.tools.removed > 0)
                  details.push(`${syncResult.tools.removed} removed`);
                parts.push(`tools (${details.join(", ")})`);
              }
              if (
                syncResult.prompts.updated > 0 ||
                syncResult.prompts.added > 0 ||
                syncResult.prompts.removed > 0
              ) {
                const details: string[] = [];
                if (syncResult.prompts.updated > 0)
                  details.push(`${syncResult.prompts.updated} updated`);
                if (syncResult.prompts.added > 0)
                  details.push(`${syncResult.prompts.added} added`);
                if (syncResult.prompts.removed > 0)
                  details.push(`${syncResult.prompts.removed} removed`);
                parts.push(`prompts (${details.join(", ")})`);
              }
              if (
                syncResult.resources.updated > 0 ||
                syncResult.resources.added > 0 ||
                syncResult.resources.removed > 0
              ) {
                const details: string[] = [];
                if (syncResult.resources.updated > 0)
                  details.push(`${syncResult.resources.updated} updated`);
                if (syncResult.resources.added > 0)
                  details.push(`${syncResult.resources.added} added`);
                if (syncResult.resources.removed > 0)
                  details.push(`${syncResult.resources.removed} removed`);
                parts.push(`resources (${details.join(", ")})`);
              }
              console.log(chalk.green(`[HMR] ✓ Reloaded: ${parts.join(", ")}`));
            } else {
              console.log(
                chalk.gray(
                  `[HMR] No changes detected (${runningServer.registeredTools?.length || 0} tools, ` +
                    `${runningServer.registeredPrompts?.length || 0} prompts, ` +
                    `${runningServer.registeredResources?.length || 0} resources registered)`
                )
              );
            }
          } catch (error: any) {
            console.error(chalk.red(`[HMR] Reload failed: ${error.message}`));
            // Keep running with old registrations
          }

          isReloading = false;
        }, 100);
      };
      watcher.on("change", hmrOnChange);

      // Expose project path so tunnel.ts can read the manifest for subdomain reuse
      process.env.MCP_USE_PROJECT_PATH = projectPath;

      // Expose in-process restart hook for the inspector tunnel toggle.
      // Tears down the running server and re-sets up everything as if
      // `mcp-use dev` was called with or without --tunnel.
      (globalThis as any).__mcpUseDevRestart = async (withTunnel: boolean) => {
        console.log(
          chalk.yellow(
            `\n[DEV] Restarting ${withTunnel ? "with" : "without"} tunnel…`
          )
        );

        // Suppress noise from in-flight requests terminated during teardown
        const origStderrWrite = process.stderr.write.bind(process.stderr);
        const stderrFilter = (chunk: any, ...args: any[]) => {
          const str =
            typeof chunk === "string" ? chunk : (chunk?.toString?.() ?? "");
          if (
            str.includes("TypeError: terminated") ||
            str.includes("SocketError") ||
            str.includes("UND_ERR_SOCKET")
          ) {
            return true;
          }
          return origStderrWrite(chunk, ...args);
        };
        process.stderr.write = stderrFilter as typeof process.stderr.write;

        // 1. Tear down
        watcher.close();
        if (tunnelProcess && typeof tunnelProcess.kill === "function") {
          if (typeof (tunnelProcess as any).markShutdown === "function") {
            (tunnelProcess as any).markShutdown();
          }
          const dyingProc = tunnelProcess;
          tunnelProcess = undefined;
          dyingProc.kill("SIGINT");
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              try {
                dyingProc.kill("SIGKILL");
              } catch {
                /* ignore */
              }
              resolve();
            }, 5000);
            dyingProc.on("exit", () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        }
        if (tunnelSubdomain) {
          const apiBase =
            process.env.MCP_USE_API || "https://local.mcp-use.run";
          try {
            await fetch(`${apiBase}/api/tunnels/${tunnelSubdomain}`, {
              method: "DELETE",
            });
          } catch {
            /* ignore */
          }
          tunnelSubdomain = undefined;
        }
        if (runningServer && typeof runningServer.forceClose === "function") {
          await runningServer.forceClose();
        } else if (runningServer && typeof runningServer.close === "function") {
          await runningServer.close();
        }

        // 2. Start tunnel if requested
        tunnelUrl = undefined;
        if (withTunnel) {
          const manifestPath = path.join(projectPath, "dist", "mcp-use.json");
          let existingSubdomain: string | undefined;
          try {
            const manifestContent = await readFile(manifestPath, "utf-8");
            const manifest = JSON.parse(manifestContent);
            existingSubdomain = manifest.tunnel?.subdomain;
            if (existingSubdomain) {
              const apiBase =
                process.env.MCP_USE_API || "https://local.mcp-use.run";
              try {
                await fetch(`${apiBase}/api/tunnels/${existingSubdomain}`, {
                  method: "DELETE",
                });
              } catch {
                /* ignore */
              }
            }
          } catch {
            /* ignore */
          }
          let tunnelInfo: Awaited<ReturnType<typeof startTunnel>>;
          try {
            tunnelInfo = await startTunnel(port, existingSubdomain);
          } catch {
            if (existingSubdomain) {
              console.log(
                chalk.yellow(
                  `Subdomain "${existingSubdomain}" unavailable, requesting a new one…`
                )
              );
              tunnelInfo = await startTunnel(port);
            } else {
              throw new Error("Failed to start tunnel");
            }
          }
          tunnelUrl = tunnelInfo.url;
          tunnelProcess = tunnelInfo.process;
          tunnelSubdomain = tunnelInfo.subdomain;
          process.env.MCP_URL = tunnelUrl;

          // Persist subdomain
          try {
            const mPath = path.join(projectPath, "dist", "mcp-use.json");
            let manifest: any = {};
            try {
              manifest = JSON.parse(await readFile(mPath, "utf-8"));
            } catch {
              /* ignore */
            }
            if (!manifest.tunnel) manifest.tunnel = {};
            manifest.tunnel.subdomain = tunnelSubdomain;
            await mkdir(path.dirname(mPath), { recursive: true });
            await writeFile(mPath, JSON.stringify(manifest, null, 2), "utf-8");
          } catch {
            /* ignore */
          }
        } else {
          process.env.MCP_URL = `http://${host}:${port}`;
        }

        // 3. Re-import server module (HMR mode stays true so user's listen() is a no-op)
        console.log(chalk.gray(`Loading server from ${serverFile}...`));
        runningServer = await importServerModule();
        if (!runningServer) {
          console.error(
            chalk.red("Error: Could not find MCPServer instance after restart.")
          );
          return;
        }
        // Temporarily disable HMR flag so our listen() actually starts the server
        (globalThis as any).__mcpUseHmrMode = false;
        await runningServer.listen(port);
        (globalThis as any).__mcpUseHmrMode = true;

        const browserHost = normalizeBrowserHost(host);
        const mcpEndpoint = `http://${browserHost}:${port}/mcp`;
        const autoConnectEndpoint = tunnelUrl
          ? `${tunnelUrl}/mcp`
          : mcpEndpoint;
        console.log(chalk.green.bold(`✓ Restarted`));
        console.log(chalk.whiteBright(`MCP:      ${mcpEndpoint}`));
        if (tunnelUrl) {
          console.log(chalk.whiteBright(`Tunnel:   ${tunnelUrl}/mcp`));
        }
        console.log(
          chalk.whiteBright(
            `Inspector: http://${browserHost}:${port}/inspector?autoConnect=${encodeURIComponent(autoConnectEndpoint)}`
          )
        );
        console.log(chalk.gray(`Watching for changes...\n`));

        // 4. Re-create watcher (reuses same config)
        watcher = chokidar.watch(".", {
          cwd: projectPath,
          ignored: (p: string, stats?: any) => {
            const np = p.replace(/\\/g, "/");
            if (/(^|\/)\.[^/]/.test(np)) return true;
            if (np.includes("/node_modules/") || np.endsWith("/node_modules"))
              return true;
            if (np.includes("/dist/") || np.endsWith("/dist")) return true;
            if (np.includes("/resources/") || np.endsWith("/resources"))
              return true;
            if (stats?.isFile() && np.endsWith(".d.ts")) return true;
            return false;
          },
          persistent: true,
          ignoreInitial: true,
          depth: 3,
        });
        watcher
          .on("ready", () => console.log(chalk.gray(`[HMR] Watcher ready`)))
          .on("error", (err: unknown) =>
            console.error(
              chalk.red(
                `[HMR] Watcher error: ${err instanceof Error ? err.message : String(err)}`
              )
            )
          )
          .on("change", hmrOnChange);

        // Restore stderr once the new server is stable
        setTimeout(() => {
          process.stderr.write = origStderrWrite;
        }, 2000);
      };

      // Handle cleanup
      let hmrCleanupInProgress = false;
      const cleanup = async () => {
        if (hmrCleanupInProgress) return;
        hmrCleanupInProgress = true;

        console.log(chalk.gray("\n\nShutting down..."));
        watcher.close();

        if (
          tunnelProcess &&
          typeof (tunnelProcess as any).markShutdown === "function"
        ) {
          (tunnelProcess as any).markShutdown();
        }

        if (tunnelSubdomain) {
          try {
            const apiBase =
              process.env.MCP_USE_API || "https://local.mcp-use.run";
            await fetch(`${apiBase}/api/tunnels/${tunnelSubdomain}`, {
              method: "DELETE",
            });
          } catch {
            // Ignore cleanup errors
          }
        }

        if (tunnelProcess && typeof tunnelProcess.kill === "function") {
          tunnelProcess.kill("SIGINT");
          setTimeout(() => process.exit(0), 2000);
        } else {
          process.exit(0);
        }
      };

      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      // Keep the process running
      await new Promise(() => {});
    } catch (error) {
      console.error(chalk.red("Dev mode failed:"), error);
      process.exit(1);
    }
  });

program
  .command("start")
  .description("Start production server")
  .option("-p, --path <path>", "Path to project directory", process.cwd())
  .option(
    "--entry <file>",
    "Path to MCP server entry file (relative to project)"
  )
  .option(
    "--mcp-dir <dir>",
    "Folder holding the MCP entry + resources (e.g. 'src/mcp' for Next.js apps)"
  )
  .option("--port <port>", "Server port", "3000")
  .option("--tunnel", "Expose server through a tunnel")
  .action(async (options) => {
    try {
      const projectPath = path.resolve(options.path);
      // Priority: --port flag > process.env.PORT > default
      // Check if --port or -p was explicitly provided in command line
      const portFlagProvided =
        process.argv.includes("--port") ||
        process.argv.includes("-p") ||
        process.argv.some((arg) => arg.startsWith("--port=")) ||
        process.argv.some((arg) => arg.startsWith("-p="));

      let port = portFlagProvided
        ? parseInt(options.port, 10) // Flag explicitly provided, use it
        : parseInt(process.env.PORT || options.port || "3000", 10); // Check env, then default

      // Check if port is available, find alternative if needed
      if (!(await isPortAvailable(port))) {
        console.log(chalk.yellow.bold(`⚠️  Port ${port} is already in use`));
        const availablePort = await findAvailablePort(port);
        console.log(chalk.green.bold(`✓ Using port ${availablePort} instead`));
        port = availablePort;
      }

      console.log(
        `\x1b[36m\x1b[1mmcp-use\x1b[0m \x1b[90mVersion: ${packageJson.version}\x1b[0m\n`
      );

      // Start tunnel if requested
      let mcpUrl: string | undefined;
      let tunnelProcess: any = undefined;
      let tunnelSubdomain: string | undefined = undefined;
      if (options.tunnel) {
        try {
          // Read existing subdomain from mcp-use.json if available
          const manifestPath = path.join(projectPath, "dist", "mcp-use.json");
          let existingSubdomain: string | undefined;

          try {
            const manifestContent = await readFile(manifestPath, "utf-8");
            const manifest = JSON.parse(manifestContent);
            existingSubdomain = manifest.tunnel?.subdomain;
            if (existingSubdomain) {
              console.log(
                chalk.gray(`Found existing subdomain: ${existingSubdomain}`)
              );
              // Release the stale subdomain so the first attempt can reclaim it
              const apiBase =
                process.env.MCP_USE_API || "https://local.mcp-use.run";
              try {
                await fetch(`${apiBase}/api/tunnels/${existingSubdomain}`, {
                  method: "DELETE",
                });
              } catch {
                // Best-effort cleanup; ignore DELETE failures
              }
            }
          } catch (error) {
            // Manifest doesn't exist or is invalid, that's okay
            console.debug(
              chalk.gray(
                `Debug: Failed to read or parse mcp-use.json: ${error instanceof Error ? error.message : String(error)}`
              )
            );
          }

          let tunnelInfo: Awaited<ReturnType<typeof startTunnel>>;
          try {
            tunnelInfo = await startTunnel(port, existingSubdomain);
          } catch (e) {
            if (existingSubdomain) {
              console.log(
                chalk.yellow(
                  `Subdomain "${existingSubdomain}" unavailable, requesting a new one…`
                )
              );
              tunnelInfo = await startTunnel(port);
            } else {
              throw e;
            }
          }
          mcpUrl = tunnelInfo.url;
          tunnelProcess = tunnelInfo.process;
          const subdomain = tunnelInfo.subdomain;
          tunnelSubdomain = subdomain;

          // Update mcp-use.json with the subdomain
          try {
            let manifest: any = {};
            try {
              const manifestContent = await readFile(manifestPath, "utf-8");
              manifest = JSON.parse(manifestContent);
            } catch {
              // File doesn't exist, create new manifest
            }

            // Update or add tunnel subdomain
            if (!manifest.tunnel) {
              manifest.tunnel = {};
            }
            manifest.tunnel.subdomain = subdomain;

            // Ensure dist directory exists
            await mkdir(path.dirname(manifestPath), { recursive: true });

            // Write updated manifest
            await writeFile(
              manifestPath,
              JSON.stringify(manifest, null, 2),
              "utf-8"
            );
          } catch (error) {
            console.warn(
              chalk.yellow(
                `⚠️  Failed to save subdomain to mcp-use.json: ${error instanceof Error ? error.message : "Unknown error"}`
              )
            );
          }
        } catch (error) {
          console.error(chalk.red("Failed to start tunnel:"), error);
          process.exit(1);
        }
      }

      // Find the built server file
      // First try to read from manifest (set during build)
      let serverFile: string | undefined;
      const manifestPath = path.join(projectPath, "dist", "mcp-use.json");

      try {
        const manifestContent = await readFile(manifestPath, "utf-8");
        const manifest = JSON.parse(manifestContent);
        if (manifest.entryPoint) {
          // Verify the entry point exists
          await access(path.join(projectPath, manifest.entryPoint));
          serverFile = manifest.entryPoint;
        }
      } catch {
        // Manifest doesn't exist or entryPoint not set, fall back to searching
      }

      // Fall back to checking common locations if manifest didn't help
      if (!serverFile) {
        // Resolve mcpDir from CLI flag so `--mcp-dir src/mcp` finds the
        // entry at dist/src/mcp/index.js (legacy transpile mode) or the TS
        // source at src/mcp/index.ts (drop-in mode — `build` skips transpile
        // and `start` runs the source via tsx).
        const startMcpDir = options.mcpDir as string | undefined;

        const serverCandidates = [
          ...(startMcpDir
            ? [
                `${startMcpDir}/index.ts`,
                `${startMcpDir}/index.tsx`,
                `dist/${startMcpDir}/index.js`,
                `dist/${startMcpDir}/server.js`,
              ]
            : []),
          "dist/index.js",
          "dist/server.js",
          "dist/src/index.js",
          "dist/src/server.js",
        ];

        for (const candidate of serverCandidates) {
          try {
            await access(path.join(projectPath, candidate));
            serverFile = candidate;
            break;
          } catch {
            continue;
          }
        }
      }

      if (!serverFile) {
        console.error(
          chalk.red(
            `No built server file found. Run 'mcp-use build' first.\n\nLooked for:\n  - dist/mcp-use.json (manifest with entryPoint)\n  - dist/index.js\n  - dist/server.js\n  - dist/src/index.js\n  - dist/src/server.js`
          )
        );
        process.exit(1);
      }

      console.log("Starting production server...");

      // Detect Next.js projects the same way `dev` does: when `next` is in
      // the user's package.json, install the server-runtime shims so any
      // transitive `server-only` / `next/cache` / `next/headers` imports
      // resolve to inert stubs instead of throwing, and load the Next.js
      // env-file cascade so tools find the env vars they expect.
      const isNextJsProject = await detectNextJsProject(projectPath);
      if (isNextJsProject) {
        console.log(
          chalk.gray(
            "Next.js detected — installing server-runtime shims for the production server"
          )
        );
        await loadNextJsEnvFiles(projectPath);
      }

      const baseEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PORT: String(port),
        NODE_ENV: "production",
      };

      if (mcpUrl) {
        baseEnv.MCP_URL = mcpUrl;
        console.log(chalk.whiteBright(`Tunnel:   ${mcpUrl}/mcp`));
      } else if (!baseEnv.MCP_URL) {
        baseEnv.MCP_URL = `http://localhost:${port}`;
      }
      const env = isNextJsProject ? withNextShimsEnv(baseEnv) : baseEnv;

      // If the recorded entry is a TypeScript source (the --mcp-dir mode,
      // where `build` deliberately skips full-project transpilation), run
      // it through tsx. Otherwise the legacy path of `node dist/index.js`.
      const isTsEntry = /\.(ts|tsx|mts|cts)$/.test(serverFile);
      let spawnCmd = "node";
      let spawnArgs: string[] = [serverFile];
      if (isTsEntry) {
        try {
          const projectRequire = createRequire(
            path.join(projectPath, "package.json")
          );
          const tsxPkgPath = projectRequire.resolve("tsx/package.json");
          const tsxPkg = JSON.parse(await readFile(tsxPkgPath, "utf-8"));
          const binField =
            typeof tsxPkg.bin === "string"
              ? tsxPkg.bin
              : (tsxPkg.bin?.tsx ?? Object.values(tsxPkg.bin ?? {})[0]);
          if (!binField) throw new Error("tsx bin entry not found");
          const tsxBin = path.resolve(path.dirname(tsxPkgPath), binField);
          spawnCmd = "node";
          spawnArgs = [tsxBin, serverFile];
        } catch (error) {
          console.log(
            chalk.yellow(
              `Could not resolve local tsx (${error instanceof Error ? error.message : String(error)}); falling back to npx`
            )
          );
          spawnCmd = "npx";
          spawnArgs = ["tsx", serverFile];
        }
      }

      const serverProc = spawn(spawnCmd, spawnArgs, {
        cwd: projectPath,
        stdio: "inherit",
        env,
      });

      // Handle cleanup
      let cleanupInProgress = false;
      const cleanup = async () => {
        if (cleanupInProgress) {
          return; // Prevent double cleanup
        }
        cleanupInProgress = true;

        console.log(chalk.gray("\n\nShutting down..."));

        // Mark tunnel as shutting down to suppress output
        if (
          tunnelProcess &&
          typeof (tunnelProcess as any).markShutdown === "function"
        ) {
          (tunnelProcess as any).markShutdown();
        }

        // Clean up tunnel via API if subdomain is available
        if (tunnelSubdomain) {
          try {
            const apiBase =
              process.env.MCP_USE_API || "https://local.mcp-use.run";
            await fetch(`${apiBase}/api/tunnels/${tunnelSubdomain}`, {
              method: "DELETE",
            });
          } catch (err) {
            // Ignore cleanup errors
          }
        }

        const processesToKill = 1 + (tunnelProcess ? 1 : 0);
        let killedCount = 0;

        const checkAndExit = () => {
          killedCount++;
          if (killedCount >= processesToKill) {
            process.exit(0);
          }
        };

        // Handle server process
        serverProc.on("exit", checkAndExit);
        serverProc.kill("SIGTERM");

        // Handle tunnel process if it exists
        if (tunnelProcess && typeof tunnelProcess.kill === "function") {
          tunnelProcess.on("exit", checkAndExit);
          // Use SIGINT for better cleanup of npx/node processes
          tunnelProcess.kill("SIGINT");
        } else {
          checkAndExit();
        }

        // Fallback timeout in case processes don't exit
        setTimeout(() => {
          if (serverProc.exitCode === null) {
            serverProc.kill("SIGKILL");
          }
          if (tunnelProcess && tunnelProcess.exitCode === null) {
            tunnelProcess.kill("SIGKILL");
          }
          process.exit(0);
        }, 2000); // Increase timeout to 2 seconds to allow graceful shutdown
      };

      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      serverProc.on("exit", async (code) => {
        // Server exited - cleanup tunnel before exiting CLI
        if (!cleanupInProgress) {
          await cleanup();
        }
        process.exit(code || 0);
      });
    } catch (error) {
      console.error("Start failed:", error);
      process.exit(1);
    }
  });

// Authentication commands
program
  .command("login")
  .description("Login to mcp-use cloud")
  .option(
    "--api-key <key>",
    "Login with an API key directly (non-interactive, for CI/CD)"
  )
  .option("--org <slug|id|name>", "Select an organization non-interactively")
  .action(async (opts: { apiKey?: string; org?: string }) => {
    try {
      await loginCommand({ apiKey: opts.apiKey, org: opts.org });
      process.exit(0);
    } catch (error) {
      console.error(
        chalk.red.bold("\n✗ Login failed:"),
        chalk.red(error instanceof Error ? error.message : "Unknown error")
      );
      process.exit(1);
    }
  });

program
  .command("logout")
  .description("Logout from Manufact cloud")
  .action(async () => {
    await logoutCommand();
  });

program
  .command("whoami")
  .description("Show current user information")
  .action(async () => {
    await whoamiCommand();
  });

// Organization commands
const orgCommand = program.command("org").description("Manage organizations");

orgCommand
  .command("list")
  .description("List your organizations")
  .action(async () => {
    await orgListCommand();
  });

orgCommand
  .command("switch")
  .description("Switch the active organization")
  .action(async () => {
    await orgSwitchCommand();
  });

orgCommand
  .command("current")
  .description("Show the currently active organization")
  .action(async () => {
    await orgCurrentCommand();
  });

// Deployment command
program
  .command("deploy")
  .description("Deploy MCP server from GitHub to Manufact cloud")
  .option("--open", "Open deployment in browser after successful deploy")
  .option("--name <name>", "Custom deployment name")
  .option("--port <port>", "Server port", "3000")
  .option("--runtime <runtime>", "Runtime (node or python)")
  .option(
    "--new",
    "Force creation of new deployment instead of reusing linked deployment"
  )
  .option(
    "--env <key=value...>",
    "Environment variables (can be used multiple times)"
  )
  .option("--env-file <path>", "Path to .env file with environment variables")
  .option(
    "--root-dir <path>",
    "Root directory within repo to deploy from (for monorepos)"
  )
  .option(
    "--org <slug-or-id>",
    "Deploy to a specific organization (by slug or ID)"
  )
  .option("-y, --yes", "Skip confirmation prompts")
  .option("--region <region>", "Deploy region: US, EU, or APAC (default: US)")
  .option(
    "--build-command <cmd>",
    "Custom build command (overrides auto-detection)"
  )
  .option(
    "--start-command <cmd>",
    "Custom start command (overrides auto-detection)"
  )
  .action(async (options) => {
    await deployCommand({
      open: options.open,
      name: options.name,
      port: options.port ? parseInt(options.port, 10) : undefined,
      runtime: options.runtime,
      new: options.new,
      env: options.env,
      envFile: options.envFile,
      rootDir: options.rootDir,
      org: options.org,
      yes: options.yes,
      region: options.region,
      buildCommand: options.buildCommand,
      startCommand: options.startCommand,
    });
  });

// Client command
program.addCommand(createClientCommand());

// Deployments command
program.addCommand(createDeploymentsCommand());

// Servers command
program.addCommand(createServersCommand());

// Skills command
program.addCommand(createSkillsCommand());

// Generate types command
program
  .command("generate-types")
  .description(
    "Generate TypeScript type definitions for tools (writes .mcp-use/tool-registry.d.ts)"
  )
  .option("-p, --path <path>", "Path to project directory", process.cwd())
  .option("--server <file>", "Server entry file", "index.ts")
  .action(async (options) => {
    const projectPath = path.resolve(options.path);

    try {
      console.log(chalk.blue("Generating tool registry types..."));
      const success = await generateToolRegistryTypesForServer(
        projectPath,
        options.server
      );
      if (success) {
        console.log(
          chalk.green("✓ Tool registry types generated successfully")
        );
      } else {
        console.log(chalk.yellow("⚠ Tool registry type generation had errors"));
      }
      process.exit(0);
    } catch (error) {
      console.error(
        chalk.red("Failed to generate types:"),
        error instanceof Error ? error.message : String(error)
      );
      if (error instanceof Error && error.stack) {
        console.error(chalk.gray(error.stack));
      }
      process.exit(1);
    }
  });

program.hook("preAction", async (_thisCommand, actionCommand) => {
  const projectPath = actionCommand.opts().path as string | undefined;
  await notifyIfUpdateAvailable(projectPath);
});

program.parse();
