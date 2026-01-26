#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import "dotenv/config";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import open from "open";
import { viteSingleFile } from "vite-plugin-singlefile";
import { toJSONSchema } from "zod";
import { loginCommand, logoutCommand, whoamiCommand } from "./commands/auth.js";
import { createClientCommand } from "./commands/client.js";
import { deployCommand } from "./commands/deploy.js";
import { createDeploymentsCommand } from "./commands/deployments.js";

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
      // Filter out shutdown messages from tunnel package
      const isShutdownMessage =
        text.includes("Shutting down") || text.includes("🛑");

      // Suppress tunnel output during shutdown or if it's a shutdown message
      if (!isShuttingDown && !isShutdownMessage) {
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

async function findServerFile(projectPath: string): Promise<string> {
  const candidates = ["index.ts", "src/index.ts", "server.ts", "src/server.ts"];
  for (const candidate of candidates) {
    try {
      await access(path.join(projectPath, candidate));
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("No server file found");
}

async function buildWidgets(
  projectPath: string,
  options: { inline?: boolean } = {}
): Promise<Array<{ name: string; metadata: any }>> {
  const { inline = true } = options; // Default to true for VS Code compatibility
  const { promises: fs } = await import("node:fs");
  const { build } = await import("vite");
  const resourcesDir = path.join(projectPath, "resources");

  // Get base URL from environment or use default
  const mcpUrl = process.env.MCP_URL;

  // Check if resources directory exists
  try {
    await access(resourcesDir);
  } catch {
    console.log(
      chalk.gray("No resources/ directory found - skipping widget build")
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
    console.log(chalk.gray("No widgets found in resources/ directory"));
    return [];
  }

  if (entries.length === 0) {
    console.log(chalk.gray("No widgets found in resources/ directory"));
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

    const cssContent = `@import "tailwindcss";\n\n/* Configure Tailwind to scan the resources directory and mcp-use package */\n@source "${relativeResourcesPath}";\n@source "${relativeMcpUsePath}/**/*.{ts,tsx,js,jsx}";\n`;
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

      const metadataServer = await createServer({
        root: metadataTempDir,
        cacheDir: path.join(metadataTempDir, ".vite-cache"),
        plugins: [nodeStubsPlugin, tailwindcss(), react()],
        resolve: {
          alias: {
            "@": resourcesDir,
          },
        },
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

      // Build plugins array - add viteSingleFile when inlining for VS Code compatibility
      const buildPlugins = inline
        ? [
            buildNodeStubsPlugin,
            tailwindcss(),
            react(),
            viteSingleFile({ removeViteModuleLoader: true }),
          ]
        : [buildNodeStubsPlugin, tailwindcss(), react()];

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
        resolve: {
          alias: {
            "@": resourcesDir,
          },
        },
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
          minify: "esbuild",
          // For inline builds, disable CSS code splitting and inline all assets
          ...(inline
            ? {
                cssCodeSplit: false,
                assetsInlineLimit: 100000000, // Inline all assets under 100MB (effectively all)
              }
            : {}),
          rollupOptions: {
            input: path.join(tempDir, "index.html"),
            external: (id) => {
              // Don't externalize posthog-node or path - we're stubbing them
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
      return { name: widgetName, metadata: widgetMetadata };
    } catch (error) {
      console.error(chalk.red(`    ✗ Failed to build ${widgetName}:`), error);
      return null;
    }
  };

  // Build all widgets in parallel
  const buildResults = await Promise.all(
    entries.map((entry) => buildSingleWidget(entry))
  );

  // Filter out failed builds (null results)
  const builtWidgets = buildResults.filter(
    (result): result is { name: string; metadata: any } => result !== null
  );

  return builtWidgets;
}

program
  .command("build")
  .description("Build TypeScript and MCP UI widgets")
  .option("-p, --path <path>", "Path to project directory", process.cwd())
  .option("--with-inspector", "Include inspector in production build")
  .option(
    "--inline",
    "Inline all JS/CSS into HTML (required for VS Code MCP Apps)"
  )
  .option("--no-inline", "Keep JS/CSS as separate files (default)")
  .action(async (options) => {
    try {
      const projectPath = path.resolve(options.path);
      const { promises: fs } = await import("node:fs");

      displayPackageVersions(projectPath);

      // Build widgets first (this generates schemas)
      // Use --inline flag for VS Code compatibility (VS Code's CSP blocks external scripts)
      const builtWidgets = await buildWidgets(projectPath, {
        inline: options.inline ?? false,
      });

      // Then run tsc (now schemas are available for import)
      console.log(chalk.gray("Building TypeScript..."));
      await runCommand("npx", ["tsc"], projectPath);
      console.log(chalk.green("✓ TypeScript build complete!"));

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
    } catch (error) {
      console.error(chalk.red("Build failed:"), error);
      process.exit(1);
    }
  });

program
  .command("dev")
  .description("Run development server with auto-reload and inspector")
  .option("-p, --path <path>", "Path to project directory", process.cwd())
  .option("--port <port>", "Server port", "3000")
  .option(
    "--host <host>",
    "Server host (use 0.0.0.0 to listen on all interfaces)",
    "0.0.0.0"
  )
  .option("--no-open", "Do not auto-open inspector")
  .option("--no-hmr", "Disable hot module reloading (use tsx watch instead)")
  // .option('--tunnel', 'Expose server through a tunnel')
  .action(async (options) => {
    try {
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

      // Find the main source file
      const serverFile = await findServerFile(projectPath);

      // Set environment variables for the server
      const mcpUrl = `http://${host}:${port}`;
      process.env.PORT = String(port);
      process.env.HOST = host;
      process.env.NODE_ENV = "development";
      process.env.MCP_URL = mcpUrl;

      if (!useHmr) {
        // Fallback: Use tsx watch (restarts process on changes)
        console.log(chalk.gray("HMR disabled, using tsx watch (full restart)"));

        const processes: any[] = [];
        const mcpUrl = `http://${host}:${port}`;
        const env: NodeJS.ProcessEnv = {
          PORT: String(port),
          HOST: host,
          NODE_ENV: "development",
          MCP_URL: mcpUrl,
        };

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
          const ready = await waitForServer(port, host);
          if (ready) {
            const browserHost = normalizeBrowserHost(host);
            const mcpEndpoint = `http://${browserHost}:${port}/mcp`;
            const inspectorUrl = `http://${browserHost}:${port}/inspector?autoConnect=${encodeURIComponent(mcpEndpoint)}`;

            const readyTime = Date.now() - startTime;
            console.log(chalk.green.bold(`✓ Ready in ${readyTime}ms`));
            console.log(
              chalk.whiteBright(`Local:    http://${browserHost}:${port}`)
            );
            console.log(chalk.whiteBright(`Network:  http://${host}:${port}`));
            console.log(chalk.whiteBright(`MCP:      ${mcpEndpoint}`));
            console.log(chalk.whiteBright(`Inspector: ${inspectorUrl}\n`));
            await open(inspectorUrl);
          }
        }

        // Handle cleanup
        const cleanup = () => {
          console.log(chalk.gray("\n\nShutting down..."));
          processes.forEach((proc) => {
            if (proc && typeof proc.kill === "function") {
              proc.kill("SIGINT");
            }
          });
          setTimeout(() => process.exit(0), 1000);
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

      const chokidarModule = await import("chokidar");
      const chokidar = (chokidarModule as any).default || chokidarModule;
      const { pathToFileURL } = await import("node:url");
      const { createRequire } = await import("node:module");

      // Try to get tsx's tsImport function for TypeScript support
      let tsImport:
        | ((specifier: string, parentUrl: string) => Promise<any>)
        | null = null;
      try {
        const projectRequire = createRequire(
          path.join(projectPath, "package.json")
        );
        // Resolve tsx/esm/api from the user's project
        const tsxApiPath = projectRequire.resolve("tsx/esm/api");
        const tsxApi = await import(pathToFileURL(tsxApiPath).href);
        tsImport = tsxApi.tsImport;
      } catch {
        // tsx not found - continue without it (JS files only, or tsx might be globally available)
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
        // Use tsx's tsImport if available for TypeScript support
        // Otherwise fall back to native import (for JS files or if tsx is globally loaded)
        if (tsImport) {
          // tsImport handles TypeScript compilation
          // Add cache-busting timestamp to force re-import
          await tsImport(`${serverFilePath}?t=${Date.now()}`, import.meta.url);
        } else {
          // Native import - works for JS files or if tsx is already loaded via --import
          await import(`${serverFileUrl}?t=${Date.now()}`);
        }

        // Get the server instance from the global registry
        // No export required - MCPServer tracks itself when created via globalThis
        const instance = (globalThis as any).__mcpUseLastServer;
        return instance || null;
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
          const ready = await waitForServer(port, host);
          if (ready) {
            const browserHost = normalizeBrowserHost(host);
            const mcpEndpoint = `http://${browserHost}:${port}/mcp`;
            const inspectorUrl = `http://${browserHost}:${port}/inspector?autoConnect=${encodeURIComponent(mcpEndpoint)}`;

            const readyTime = Date.now() - startTime;
            console.log(chalk.green.bold(`✓ Ready in ${readyTime}ms`));
            console.log(
              chalk.whiteBright(`Local:    http://${browserHost}:${port}`)
            );
            console.log(chalk.whiteBright(`Network:  http://${host}:${port}`));
            console.log(chalk.whiteBright(`MCP:      ${mcpEndpoint}`));
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
        console.log(chalk.gray(`Watching for changes...\n`));
      }

      // Watch for file changes - watch .ts/.tsx files in project directory
      const watcher = chokidar.watch(".", {
        cwd: projectPath,
        ignored: [
          /(^|[/\\])\../, // dotfiles
          "**/node_modules/**",
          "**/dist/**",
          "**/resources/**", // widgets are watched separately by vite
          "**/*.d.ts", // type definitions
        ],
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

      watcher.on("change", async (filePath: string) => {
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
            runningServer.syncRegistrationsFrom(newServer);

            console.log(
              chalk.green(
                `[HMR] ✓ Reloaded: ${runningServer.registeredTools?.length || 0} tools, ` +
                  `${runningServer.registeredPrompts?.length || 0} prompts, ` +
                  `${runningServer.registeredResources?.length || 0} resources`
              )
            );
          } catch (error: any) {
            console.error(chalk.red(`[HMR] Reload failed: ${error.message}`));
            // Keep running with old registrations
          }

          isReloading = false;
        }, 100);
      });

      // Handle cleanup
      const cleanup = () => {
        console.log(chalk.gray("\n\nShutting down..."));
        watcher.close();
        process.exit(0);
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

      const port = portFlagProvided
        ? parseInt(options.port, 10) // Flag explicitly provided, use it
        : parseInt(process.env.PORT || options.port || "3000", 10); // Check env, then default

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
            }
          } catch (error) {
            // Manifest doesn't exist or is invalid, that's okay
            console.debug(
              chalk.gray(
                `Debug: Failed to read or parse mcp-use.json: ${error instanceof Error ? error.message : String(error)}`
              )
            );
          }

          const tunnelInfo = await startTunnel(port, existingSubdomain);
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
      let serverFile = "dist/index.js";
      try {
        await access(path.join(projectPath, serverFile));
      } catch {
        serverFile = "dist/server.js";
      }

      console.log("Starting production server...");

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PORT: String(port),
        NODE_ENV: "production",
      };

      if (mcpUrl) {
        env.MCP_URL = mcpUrl;
        console.log(chalk.whiteBright(`Tunnel:   ${mcpUrl}/mcp`));
      }

      const serverProc = spawn("node", [serverFile], {
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

      serverProc.on("exit", (code) => {
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
  .action(async () => {
    try {
      await loginCommand();
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
  .description("Logout from mcp-use cloud")
  .action(async () => {
    await logoutCommand();
  });

program
  .command("whoami")
  .description("Show current user information")
  .action(async () => {
    await whoamiCommand();
  });

// Deployment command
program
  .command("deploy")
  .description("Deploy MCP server from GitHub to mcp-use cloud")
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
  .action(async (options) => {
    await deployCommand({
      open: options.open,
      name: options.name,
      port: options.port ? parseInt(options.port, 10) : undefined,
      runtime: options.runtime,
      new: options.new,
      env: options.env,
      envFile: options.envFile,
    });
  });

// Client command
program.addCommand(createClientCommand());

// Deployments command
program.addCommand(createDeploymentsCommand());

program.parse();
