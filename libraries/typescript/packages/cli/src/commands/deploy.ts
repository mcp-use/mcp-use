import chalk from "chalk";
import { promises as fs } from "node:fs";
import path from "node:path";
import open from "open";
import type { GitHubConnectionStatus, OrgInfo } from "../utils/api.js";
import {
  ApiUnauthorizedError,
  GitHubAuthRequiredError,
  McpUseAPI,
} from "../utils/api.js";
import {
  getWebUrl,
  isLoggedIn,
  readConfig,
  writeConfig,
} from "../utils/config.js";
import {
  getGitInfo,
  gitInit,
  gitAddRemoteAndPush,
  gitCommitAndPush,
  GitCommandError,
  hasUncommittedChanges,
  isGitHubUrl,
} from "../utils/git.js";
import { getMcpServerUrl } from "../utils/cloud-urls.js";
import { getProjectLink, saveProjectLink } from "../utils/project-link.js";
import {
  loginCommand,
  promptOrgSelection,
  resolveOrgFromOption,
} from "./auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function parseEnvFile(filePath: string): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const envVars: Record<string, string> = {};
    const lines = content.split("\n");
    let currentKey: string | null = null;
    let currentValue = "";

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith("#")) continue;
      if (currentKey && !line.includes("=")) {
        currentValue += "\n" + line;
        continue;
      }
      if (currentKey) {
        envVars[currentKey] = currentValue.replace(/^["']|["']$/g, "");
        currentKey = null;
        currentValue = "";
      }
      const equalIndex = line.indexOf("=");
      if (equalIndex === -1) continue;
      const key = line.substring(0, equalIndex).trim();
      const value = line.substring(equalIndex + 1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        console.log(chalk.yellow(`⚠️  Skipping invalid env key: ${key}`));
        continue;
      }
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        envVars[key] = value.slice(1, -1);
      } else if (value.startsWith('"') || value.startsWith("'")) {
        currentKey = key;
        currentValue = value.slice(1);
      } else {
        envVars[key] = value;
      }
    }
    if (currentKey) {
      envVars[currentKey] = currentValue.replace(/^["']|["']$/g, "");
    }
    return envVars;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Environment file not found: ${filePath}`);
    }
    throw new Error(
      `Failed to parse environment file: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

function parseEnvVar(envStr: string): { key: string; value: string } {
  const equalIndex = envStr.indexOf("=");
  if (equalIndex === -1) {
    throw new Error(`Invalid env format: "${envStr}". Expected KEY=VALUE`);
  }
  const key = envStr.substring(0, equalIndex).trim();
  const value = envStr.substring(equalIndex + 1);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Invalid env key: "${key}".`);
  }
  return { key, value };
}

async function buildEnvVars(
  options: DeployOptions
): Promise<Record<string, string>> {
  const envVars: Record<string, string> = {};
  if (options.envFile) {
    try {
      const fileEnv = await parseEnvFile(options.envFile);
      Object.assign(envVars, fileEnv);
      console.log(
        chalk.gray(
          `Loaded ${Object.keys(fileEnv).length} variable(s) from ${options.envFile}`
        )
      );
    } catch (error) {
      console.log(
        chalk.red(
          `✗ ${error instanceof Error ? error.message : "Failed to load env file"}`
        )
      );
      process.exit(1);
    }
  }
  if (options.env && options.env.length > 0) {
    for (const envStr of options.env) {
      try {
        const { key, value } = parseEnvVar(envStr);
        envVars[key] = value;
      } catch (error) {
        console.log(
          chalk.red(
            `✗ ${error instanceof Error ? error.message : "Invalid env variable"}`
          )
        );
        process.exit(1);
      }
    }
  }
  return envVars;
}

interface DeployOptions {
  open?: boolean;
  name?: string;
  port?: number;
  runtime?: "node" | "python";
  new?: boolean;
  env?: string[];
  envFile?: string;
  rootDir?: string;
  org?: string;
  yes?: boolean;
  region?: "US" | "EU" | "APAC";
  buildCommand?: string;
  startCommand?: string;
}

async function isMcpProject(cwd: string = process.cwd()): Promise<boolean> {
  try {
    const content = await fs.readFile(path.join(cwd, "package.json"), "utf-8");
    const pkg = JSON.parse(content);
    return !!(
      pkg.dependencies?.["mcp-use"] ||
      pkg.dependencies?.["@modelcontextprotocol/sdk"] ||
      pkg.devDependencies?.["mcp-use"] ||
      pkg.devDependencies?.["@modelcontextprotocol/sdk"]
    );
  } catch {
    return false;
  }
}

async function getProjectName(cwd: string = process.cwd()): Promise<string> {
  try {
    const content = await fs.readFile(path.join(cwd, "package.json"), "utf-8");
    const pkg = JSON.parse(content);
    if (pkg.name) return pkg.name;
  } catch {
    // fall through
  }
  return path.basename(cwd);
}

async function detectBuildCommand(cwd: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(path.join(cwd, "package.json"), "utf-8");
    if (JSON.parse(content).scripts?.build) return "npm run build";
  } catch {
    // noop
  }
  return undefined;
}

async function detectStartCommand(cwd: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(path.join(cwd, "package.json"), "utf-8");
    const pkg = JSON.parse(content);
    if (pkg.scripts?.start) return "npm start";
    if (pkg.main) return `node ${pkg.main}`;
  } catch {
    // noop
  }
  return undefined;
}

async function detectRuntime(cwd: string): Promise<"node" | "python"> {
  for (const f of ["requirements.txt", "pyproject.toml", "setup.py"]) {
    try {
      await fs.access(path.join(cwd, f));
      return "python";
    } catch {
      continue;
    }
  }
  return "node";
}

async function prompt(
  question: string,
  defaultValue: "y" | "n" = "n"
): Promise<boolean> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const indicator = defaultValue === "y" ? "Y/n" : "y/N";
  const q = question.replace(/(\(y\/n\):)/, `(${indicator}):`);
  return new Promise((resolve) => {
    rl.question(q, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === "") resolve(defaultValue === "y");
      else resolve(a === "y" || a === "yes");
    });
  });
}

async function promptText(
  question: string,
  defaultValue?: string
): Promise<string> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const suffix = defaultValue ? chalk.gray(` [${defaultValue}]`) : "";
  return new Promise((resolve) => {
    rl.question(question + suffix + " ", (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

// ---------------------------------------------------------------------------
// .gitignore management
// ---------------------------------------------------------------------------

const REQUIRED_IGNORES = [
  "node_modules",
  "dist",
  ".env",
  ".env.local",
  ".mcp-use",
];

async function ensureGitignore(cwd: string): Promise<void> {
  const gitignorePath = path.join(cwd, ".gitignore");
  let content = "";
  try {
    content = await fs.readFile(gitignorePath, "utf-8");
  } catch {
    // file doesn't exist yet
  }
  const missing = REQUIRED_IGNORES.filter((entry) => !content.includes(entry));
  if (missing.length > 0) {
    const additions = missing.join("\n");
    const newContent =
      content + (content.endsWith("\n") ? "" : "\n") + additions + "\n";
    await fs.writeFile(gitignorePath, newContent, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Deployment progress (poll build-logs)
// ---------------------------------------------------------------------------

async function displayDeploymentProgress(
  api: McpUseAPI,
  deploymentId: string,
  progressOptions?: { yes?: boolean }
): Promise<void> {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIndex = 0;
  let spinnerInterval: NodeJS.Timeout | null = null;

  const startSpinner = (message: string) => {
    if (spinnerInterval) clearInterval(spinnerInterval);
    process.stdout.write("\r\x1b[K");
    spinnerInterval = setInterval(() => {
      process.stdout.write(
        "\r" + chalk.cyan(frames[frameIndex]) + " " + chalk.gray(message)
      );
      frameIndex = (frameIndex + 1) % frames.length;
    }, 80);
  };

  const stopSpinner = () => {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
      process.stdout.write("\r\x1b[K");
    }
  };

  console.log();
  startSpinner("Deploying...");

  let checkCount = 0;
  const maxChecks = 120;
  let delay = 2000;
  const maxDelay = 10000;
  let buildLogOffset = 0;

  while (checkCount < maxChecks) {
    const waitMs = delay;
    await new Promise<void>((r) => setTimeout(r, waitMs));
    checkCount++;

    try {
      const resp = await api.getDeploymentBuildLogs(
        deploymentId,
        buildLogOffset
      );
      if (resp.logs.length > 0) {
        for (const line of resp.logs.split("\n").filter((l) => l.trim())) {
          try {
            const d = JSON.parse(line);
            if (d.line) {
              stopSpinner();
              const color =
                d.level === "error"
                  ? chalk.red
                  : d.level === "warn"
                    ? chalk.yellow
                    : chalk.gray;
              const prefix = d.step ? chalk.cyan(`[${d.step}]`) + " " : "";
              console.log(prefix + color(d.line));
            }
          } catch {
            stopSpinner();
            console.log(chalk.gray(line));
          }
        }
        buildLogOffset = resp.offset;
      }
    } catch {
      // not ready yet
    }

    const dep = await api.getDeployment(deploymentId);

    if (dep.status === "running") {
      stopSpinner();
      const mcpUrl = getMcpServerUrl(dep);
      const webUrl = (await getWebUrl()).replace(/\/$/, "");
      const config = await readConfig();
      let dashboardUrl: string | null = null;
      if (dep.serverId) {
        dashboardUrl = config.orgSlug
          ? `${webUrl}/cloud/${config.orgSlug}/servers/${dep.serverId}`
          : `${webUrl}/cloud/servers/${dep.serverId}`;
      }
      const inspectorUrl = `https://inspector.manufact.com/inspector?autoConnect=${encodeURIComponent(mcpUrl)}`;

      console.log(chalk.green.bold("✓ Deployment successful!\n"));
      if (mcpUrl) {
        console.log(chalk.white("🌐 MCP Server URL:"));
        console.log(chalk.cyan.bold(`   ${mcpUrl}\n`));
      }
      if (dashboardUrl) {
        console.log(chalk.white("📊 Dashboard:"));
        console.log(chalk.cyan.bold(`   ${dashboardUrl}\n`));
      }
      console.log(chalk.white("🔍 Inspector URL:"));
      console.log(chalk.cyan.bold(`   ${inspectorUrl}\n`));
      console.log(chalk.gray("Deployment ID: ") + chalk.white(dep.id));
      return;
    } else if (dep.status === "failed") {
      stopSpinner();
      console.log(chalk.red.bold("✗ Deployment failed\n"));
      if (dep.error) {
        const internalPatterns = [
          "GraphQL",
          "authenticated",
          "INTERNAL",
          "Fly API",
          "token validation",
          "context deadline",
          "Bad gateway",
          "502",
          "503",
        ];
        const isInternalError = internalPatterns.some((p) =>
          dep.error!.includes(p)
        );
        if (isInternalError) {
          console.log(
            chalk.red("Error: ") +
              "An internal infrastructure error occurred. Please try again."
          );
          console.log(chalk.gray("  Details: " + dep.error));
        } else {
          console.log(chalk.red("Error: ") + dep.error);
        }
      }
      process.exit(1);
    } else if (dep.status === "building" || dep.status === "pending") {
      startSpinner("Building and deploying...");
      delay = Math.min(delay * 1.2, maxDelay);
    } else {
      stopSpinner();
      console.log(chalk.yellow("⚠️  Deployment status: ") + dep.status);
      return;
    }
  }

  stopSpinner();
  console.log(chalk.yellow("⚠️  Deployment is taking longer than expected."));
  console.log(
    chalk.gray("Check status with: ") +
      chalk.white(`mcp-use deployments get ${deploymentId}`)
  );
}

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

async function promptReauthenticateOn401(
  options: DeployOptions,
  orgIdToRestore: string | undefined
): Promise<McpUseAPI> {
  console.log(chalk.red("\n✗ Session expired or API key invalid."));
  if (options.yes) {
    console.log(
      chalk.gray("  Run mcp-use login to re-authenticate, then retry.")
    );
    process.exit(1);
  }
  const should = await prompt(chalk.white("Log in again? (Y/n): "), "y");
  if (!should) {
    process.exit(1);
  }
  await loginCommand({ silent: false });
  if (!(await isLoggedIn())) {
    console.log(chalk.red("✗ Login failed. Please try again."));
    process.exit(1);
  }
  const fresh = await McpUseAPI.create();
  if (orgIdToRestore) {
    fresh.setOrgId(orgIdToRestore);
  }
  return fresh;
}

async function ensureApiSessionForDeploy(
  api: McpUseAPI,
  options: DeployOptions,
  orgIdToRestore: string | undefined
): Promise<McpUseAPI> {
  let client = api;
  for (;;) {
    try {
      await client.testAuth();
      return client;
    } catch (e) {
      if (!(e instanceof ApiUnauthorizedError)) throw e;
      client = await promptReauthenticateOn401(options, orgIdToRestore);
    }
  }
}

async function getGitHubConnectionStatusWith401Retry(
  api: McpUseAPI,
  options: DeployOptions,
  orgIdToRestore: string | undefined
): Promise<{ api: McpUseAPI; status: GitHubConnectionStatus }> {
  let client = api;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const status = await client.getGitHubConnectionStatus();
      return { api: client, status };
    } catch (e) {
      if (e instanceof ApiUnauthorizedError && attempt === 0) {
        client = await promptReauthenticateOn401(options, orgIdToRestore);
        await client.testAuth();
        continue;
      }
      throw e;
    }
  }
  throw new Error("Unreachable");
}

async function checkRepoAccess(
  api: McpUseAPI,
  owner: string,
  repo: string
): Promise<boolean> {
  try {
    const resp = await api.getGitHubRepos(true);
    return resp.repos.some((r) => r.full_name === `${owner}/${repo}`);
  } catch {
    return false;
  }
}

async function promptGitHubInstallation(
  api: McpUseAPI,
  reason: "not_connected" | "no_access",
  repoName?: string,
  opts?: {
    yes?: boolean;
    installationId?: string;
    reauth: () => Promise<McpUseAPI>;
  }
): Promise<{ ok: boolean; api: McpUseAPI }> {
  const yes = !!opts?.yes;
  const reauth = opts?.reauth;
  console.log();

  if (reason === "not_connected") {
    console.log(chalk.yellow("⚠️  GitHub account not connected"));
    console.log(
      chalk.white("Deployments require a connected GitHub account.\n")
    );
  } else {
    console.log(
      chalk.yellow("⚠️  GitHub App doesn't have access to this repository")
    );
    console.log(
      chalk.white(
        `The GitHub App needs permission to access ${chalk.cyan(repoName || "this repository")}.\n`
      )
    );
  }

  const shouldInstall = yes
    ? true
    : await prompt(
        chalk.white(
          `Would you like to ${reason === "not_connected" ? "connect" : "configure"} GitHub now? (Y/n): `
        ),
        "y"
      );
  if (!shouldInstall) return { ok: false, api };

  let client = api;

  try {
    let appName: string;
    for (;;) {
      try {
        appName = await client.getGitHubAppName();
        break;
      } catch (e) {
        if (e instanceof ApiUnauthorizedError && reauth) {
          client = await reauth();
          await client.testAuth();
          continue;
        }
        throw e;
      }
    }

    const installUrl = `https://github.com/apps/${appName}/installations/new`;

    console.log(chalk.cyan(`\nOpening browser...`));
    console.log(chalk.gray(`URL: ${installUrl}\n`));

    if (reason === "no_access") {
      console.log(
        chalk.white("Please add ") +
          chalk.cyan.bold(repoName || "your repository") +
          chalk.white(" to the app's repository access, then return here.\n")
      );
    } else {
      console.log(
        chalk.white("Complete the GitHub App installation, then return here.\n")
      );
    }

    await open(installUrl);

    if (!yes) {
      await prompt(chalk.white("Press Enter when done..."), "y");
    } else {
      console.log(chalk.gray("Waiting for GitHub configuration (polling)..."));
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const status = await client.getGitHubConnectionStatus();
          if (status.is_connected) {
            if (!repoName) return { ok: true, api: client };
            const [o, r] = repoName.split("/");
            if (o && r && (await checkRepoAccess(client, o, r))) {
              return { ok: true, api: client };
            }
          }
        } catch (e) {
          if (e instanceof ApiUnauthorizedError && reauth) {
            client = await reauth();
            await client.testAuth();
            continue;
          }
        }
      }
    }

    return { ok: true, api: client };
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      console.log(chalk.red("\n✗ Session expired or API key invalid."));
      process.exit(1);
    }
    console.log(chalk.yellow("\n⚠️  Unable to open browser automatically"));
    console.log(
      chalk.white("Please visit: ") +
        chalk.cyan("https://manufact.com/cloud/settings")
    );
    return { ok: false, api: client };
  }
}

// ---------------------------------------------------------------------------
// Main deploy command
// ---------------------------------------------------------------------------

export async function deployCommand(options: DeployOptions): Promise<void> {
  try {
    const cwd = process.cwd();

    // ── Step 1: Auth ──────────────────────────────────────────────
    if (!(await isLoggedIn())) {
      console.log(chalk.cyan.bold("Welcome to Manufact Cloud!\n"));
      if (options.yes) {
        console.log(
          chalk.red(
            "✗ Not logged in. Run " +
              chalk.white("npx mcp-use login") +
              " first."
          )
        );
        process.exit(1);
      }

      const shouldLogin = await prompt(
        chalk.white("You need to log in to deploy. Log in now? (Y/n): "),
        "y"
      );
      if (!shouldLogin) {
        console.log(
          chalk.gray(
            "Run " + chalk.white("npx mcp-use login") + " to get started."
          )
        );
        process.exit(0);
      }

      try {
        await loginCommand({ silent: false });
        if (!(await isLoggedIn())) {
          console.log(chalk.red("✗ Login failed. Please try again."));
          process.exit(1);
        }
        console.log(chalk.gray("\nContinuing with deployment...\n"));
      } catch (error) {
        console.error(
          chalk.red.bold("✗ Login failed:"),
          chalk.red(error instanceof Error ? error.message : "Unknown error")
        );
        process.exit(1);
      }
    }

    let api = await McpUseAPI.create();

    // ── Step 2: Org resolution ────────────────────────────────────
    let resolvedOrgId: string | undefined;
    let resolvedOrgName: string | undefined;
    let resolvedOrgSlug: string | undefined;

    if (options.org) {
      const authInfo = await api.testAuth();
      const match = resolveOrgFromOption(authInfo.orgs ?? [], options.org);
      if (match) {
        api.setOrgId(match.id);
        resolvedOrgId = match.id;
        resolvedOrgName = match.name;
        resolvedOrgSlug = match.slug ?? undefined;
        const slug = match.slug ? chalk.gray(` (${match.slug})`) : "";
        console.log(
          chalk.gray("Organization: ") + chalk.cyan(match.name) + slug
        );
      } else {
        console.error(
          chalk.red(
            `✗ Organization "${options.org}" not found. Run ${chalk.white("npx mcp-use org list")} to see available organizations.`
          )
        );
        process.exit(1);
      }
    } else {
      const config = await readConfig();
      if (!config.orgId) {
        const authInfo = await api.testAuth();
        if (authInfo.orgs.length === 0) {
          console.log(
            chalk.red(
              "✗ No organizations found. Please create one at manufact.com/cloud."
            )
          );
          process.exit(1);
        }
        let selectedOrg: OrgInfo | null;
        if (authInfo.orgs.length === 1) {
          selectedOrg = authInfo.orgs[0];
        } else {
          selectedOrg = await promptOrgSelection(
            authInfo.orgs,
            authInfo.default_org_id
          );
        }
        if (!selectedOrg) {
          console.log(chalk.red("✗ No organization selected."));
          process.exit(1);
        }
        api.setOrgId(selectedOrg.id);
        resolvedOrgId = selectedOrg.id;
        resolvedOrgName = selectedOrg.name;
        resolvedOrgSlug = selectedOrg.slug ?? undefined;
        await writeConfig({
          ...config,
          orgId: selectedOrg.id,
          orgName: selectedOrg.name,
          orgSlug: selectedOrg.slug ?? undefined,
        });
        console.log(
          chalk.gray("Organization: ") + chalk.cyan(selectedOrg.name)
        );
      } else {
        resolvedOrgId = config.orgId;
        resolvedOrgName = config.orgName;
        resolvedOrgSlug = config.orgSlug;
        api.setOrgId(config.orgId);
        if (config.orgName) {
          const slug = config.orgSlug ? chalk.gray(` (${config.orgSlug})`) : "";
          console.log(
            chalk.gray("Organization: ") + chalk.cyan(config.orgName) + slug
          );
        }
      }
    }

    api = await ensureApiSessionForDeploy(api, options, resolvedOrgId);

    console.log(chalk.cyan.bold("\n🚀 Deploying to Manufact cloud...\n"));

    // ── Step 3: GitHub connection ─────────────────────────────────
    const reauth = () => promptReauthenticateOn401(options, resolvedOrgId);

    let ghConn = await getGitHubConnectionStatusWith401Retry(
      api,
      options,
      resolvedOrgId
    );
    api = ghConn.api;
    let connectionStatus = ghConn.status;

    if (!connectionStatus.is_connected) {
      const installed = await promptGitHubInstallation(
        api,
        "not_connected",
        undefined,
        {
          yes: options.yes,
          reauth,
        }
      );
      if (!installed.ok) {
        console.log(chalk.gray("Deployment cancelled."));
        process.exit(0);
      }
      api = installed.api;
      ghConn = await getGitHubConnectionStatusWith401Retry(
        api,
        options,
        resolvedOrgId
      );
      api = ghConn.api;
      connectionStatus = ghConn.status;
      if (!connectionStatus.is_connected) {
        console.log(chalk.red("\n✗ GitHub connection could not be verified."));
        console.log(
          chalk.cyan(
            "  Visit https://manufact.com/cloud/settings to connect GitHub.\n"
          )
        );
        process.exit(1);
      }
    }

    const installations = connectionStatus.installations ?? [];
    if (installations.length === 0) {
      console.log(chalk.red("✗ No GitHub installations found."));
      process.exit(1);
    }

    console.log(chalk.green("✓ GitHub connected\n"));

    // Resolved later based on user selection or repo ownership.
    let installationDbId: string | undefined;
    let githubInstallationId: string | undefined;

    // ── Step 4: Project & Git ─────────────────────────────────────
    const projectDir = options.rootDir
      ? path.resolve(cwd, options.rootDir)
      : cwd;

    if (options.rootDir) {
      try {
        await fs.access(projectDir);
      } catch {
        console.log(
          chalk.red(`✗ Root directory not found: ${options.rootDir}`)
        );
        process.exit(1);
      }
    }

    const isMcp = await isMcpProject(projectDir);
    if (!isMcp && !options.yes) {
      console.log(
        chalk.yellow("⚠️  This doesn't look like an MCP server project.")
      );
      const shouldContinue = await prompt(
        chalk.white("Continue anyway? (y/n): ")
      );
      if (!shouldContinue) {
        process.exit(0);
      }
      console.log();
    }

    let gitInfo = await getGitInfo(cwd);
    let repoFullName: string | undefined;
    let branch: string = "main";

    if (!gitInfo.isGitRepo || !gitInfo.remoteUrl) {
      // No git repo or no remote — offer to create one
      const projectName = options.name || (await getProjectName(projectDir));

      console.log(chalk.yellow("⚠️  No GitHub remote found.\n"));
      if (options.yes) {
        console.log(chalk.gray("Creating GitHub repository automatically..."));
      } else {
        const shouldCreate = await prompt(
          chalk.white("Create a GitHub repository and push your code? (Y/n): "),
          "y"
        );
        if (!shouldCreate) {
          console.log(
            chalk.gray(
              "Deployment cancelled. Set up a GitHub remote and try again."
            )
          );
          process.exit(0);
        }
      }

      // Let the user pick which GitHub account to create the repo under.
      // Default to the first org-type installation (org accounts support auto-create).
      const defaultIdx = installations.findIndex(
        (i) => i.account_type === "Organization"
      );
      let selectedIdx = defaultIdx >= 0 ? defaultIdx : 0;

      if (installations.length > 1 && !options.yes) {
        console.log(
          chalk.cyan.bold("🐙 Select a GitHub account for the repository:\n")
        );
        for (let i = 0; i < installations.length; i++) {
          const inst = installations[i];
          const typeLabel =
            inst.account_type === "Organization"
              ? chalk.gray(" (org)")
              : chalk.gray(" (personal)");
          const marker = i === selectedIdx ? chalk.green(" ← default") : "";
          console.log(
            `  ${chalk.white(`${i + 1}.`)} ${inst.account_login}${typeLabel}${marker}`
          );
        }
        console.log();

        const readline = await import("node:readline");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await new Promise<string>((resolve) => {
          rl.question(
            chalk.gray(`Enter number [${selectedIdx + 1}]: `),
            (a) => {
              rl.close();
              resolve(a.trim());
            }
          );
        });
        const parsed = answer === "" ? selectedIdx : parseInt(answer, 10) - 1;
        if (parsed >= 0 && parsed < installations.length) {
          selectedIdx = parsed;
        }
      }

      const repoInstallation = installations[selectedIdx];
      installationDbId = repoInstallation.id;
      githubInstallationId = repoInstallation.installation_id;

      const repoName = options.yes
        ? projectName
        : await promptText(chalk.gray("Repository name:"), projectName);

      await ensureGitignore(cwd);

      console.log(
        chalk.gray(
          `Creating repository on ${repoInstallation.account_login}...`
        )
      );

      let repoResult: { fullName: string; cloneUrl: string; htmlUrl: string };
      try {
        repoResult = await api.createGitHubRepo({
          installationId: repoInstallation.installation_id,
          name: repoName,
          private: true,
          org: repoInstallation.account_login,
        });
      } catch (err) {
        if (err instanceof GitHubAuthRequiredError) {
          console.log(
            chalk.yellow(
              `\n  Personal accounts require a one-time GitHub authorization.\n`
            )
          );
          try {
            await open(err.authorizeUrl);
            console.log(
              chalk.gray("  Browser opened. Authorize and return here.\n")
            );
          } catch {
            console.log(
              chalk.gray(
                `  Open this URL in your browser:\n  ${err.authorizeUrl}\n`
              )
            );
          }
          const readline = await import("node:readline");
          await new Promise<void>((resolve) => {
            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            rl.question(
              chalk.gray("  Press Enter after authorizing..."),
              () => {
                rl.close();
                resolve();
              }
            );
          });
          console.log(chalk.gray("Retrying repository creation..."));
          repoResult = await api.createGitHubRepo({
            installationId: repoInstallation.installation_id,
            name: repoName,
            private: true,
            org: repoInstallation.account_login,
          });
        } else {
          throw err;
        }
      }
      console.log(chalk.green(`✓ Created ${chalk.cyan(repoResult.fullName)}`));

      try {
        if (!gitInfo.isGitRepo) {
          await ensureGitignore(cwd);
          console.log(chalk.gray("Initializing git..."));
          await gitInit(cwd, "Initial commit");
          console.log(chalk.gray("Pushing to GitHub..."));
          await gitAddRemoteAndPush(cwd, repoResult.cloneUrl, "main");
        } else {
          if (await hasUncommittedChanges(cwd)) {
            console.log(
              chalk.red(
                "✗ You have uncommitted changes. Commit and push before deploying."
              )
            );
            process.exit(1);
          }
          console.log(chalk.gray("Adding remote and pushing..."));
          await gitAddRemoteAndPush(
            cwd,
            repoResult.cloneUrl,
            gitInfo.branch || "main"
          );
        }
      } catch (err) {
        if (err instanceof GitCommandError) {
          console.log(chalk.red(`\n✗ Git step failed: \`${err.command}\``));
          const stderrTrimmed = (err.stderr || err.stdout).trim();
          if (stderrTrimmed) {
            console.log(chalk.gray(stderrTrimmed));
          }
          // Actionable hint for the most common failure: missing identity.
          if (/tell me who you are|user\.email|user\.name/i.test(err.stderr)) {
            console.log(
              chalk.yellow(
                "\n  Set your git identity for this project and retry:\n" +
                  `    git -C ${JSON.stringify(cwd)} config user.email "you@example.com"\n` +
                  `    git -C ${JSON.stringify(cwd)} config user.name  "Your Name"`
              )
            );
          } else if (
            /non-fast-forward|rejected|unrelated histories/i.test(err.stderr)
          ) {
            console.log(
              chalk.yellow(
                "\n  The remote branch already has commits. Either delete the empty GitHub repo and retry, " +
                  "or reconcile manually:\n" +
                  "    git pull --rebase origin main --allow-unrelated-histories\n" +
                  "    git push -u origin main"
              )
            );
          }
          process.exit(1);
        }
        throw err;
      }

      console.log(chalk.green("✓ Code pushed to GitHub\n"));

      gitInfo = await getGitInfo(cwd);
      repoFullName = repoResult.fullName;
      branch = gitInfo.branch || "main";
    } else if (!isGitHubUrl(gitInfo.remoteUrl!)) {
      console.log(chalk.red("✗ Remote is not a GitHub repository"));
      console.log(chalk.yellow(`   Current remote: ${gitInfo.remoteUrl}\n`));
      process.exit(1);
    } else if (!gitInfo.owner || !gitInfo.repo) {
      console.log(chalk.red("✗ Could not parse GitHub repository information"));
      process.exit(1);
    } else {
      repoFullName = `${gitInfo.owner}/${gitInfo.repo}`;
      branch = gitInfo.branch || "main";

      // Resolve installation matching the repo owner
      const ownerLower = gitInfo.owner!.toLowerCase();
      const matchingInst =
        installations.find(
          (i) => i.account_login.toLowerCase() === ownerLower
        ) ??
        installations.find((i) => i.account_type === "Organization") ??
        installations[0];
      installationDbId = matchingInst.id;
      githubInstallationId = matchingInst.installation_id;

      // Check for uncommitted changes
      if (gitInfo.hasUncommittedChanges) {
        if (options.yes) {
          console.log(
            chalk.red(
              "✗ You have uncommitted changes. Commit and push before deploying."
            )
          );
          process.exit(1);
        }
        console.log(chalk.yellow("⚠️  You have uncommitted changes.\n"));
        const shouldCommit = await prompt(
          chalk.white("Commit and push changes before deploying? (Y/n): "),
          "y"
        );
        if (shouldCommit) {
          await ensureGitignore(cwd);
          console.log(chalk.gray("Committing and pushing..."));
          await gitCommitAndPush(cwd, "Deploy changes", branch);
          gitInfo = await getGitInfo(cwd);
          console.log(chalk.green("✓ Changes pushed\n"));
        } else {
          console.log(chalk.gray("Deploying from last pushed commit.\n"));
        }
      }

      // Check repo access
      console.log(chalk.gray("Checking repository access..."));
      const hasAccess = await checkRepoAccess(
        api,
        gitInfo.owner!,
        gitInfo.repo!
      );
      if (!hasAccess) {
        console.log(
          chalk.yellow(
            `⚠️  GitHub App doesn't have access to ${chalk.cyan(repoFullName)}`
          )
        );
        const configured = await promptGitHubInstallation(
          api,
          "no_access",
          repoFullName,
          {
            yes: options.yes,
            installationId: githubInstallationId,
            reauth: () => promptReauthenticateOn401(options, resolvedOrgId),
          }
        );
        if (!configured.ok) {
          process.exit(0);
        }
        api = configured.api;
        const retry = await checkRepoAccess(api, gitInfo.owner!, gitInfo.repo!);
        if (!retry) {
          const appName = await api.getGitHubAppName();
          console.log(
            chalk.red(
              `\n✗ Repository ${chalk.cyan(repoFullName)} is still not accessible.`
            )
          );
          console.log(
            chalk.cyan(
              `  https://github.com/apps/${appName}/installations/new\n`
            )
          );
          process.exit(1);
        }
      }
      console.log(chalk.green("✓ Repository access confirmed"));
    }

    // ── Step 5: Display config ────────────────────────────────────
    const projectName = options.name || (await getProjectName(projectDir));
    const port = options.port || 3000;
    const buildCommand = await detectBuildCommand(projectDir);
    const startCommand = await detectStartCommand(projectDir);
    const runtime = options.runtime || (await detectRuntime(projectDir));
    const envVars = await buildEnvVars(options);

    console.log();
    console.log(chalk.white("Deployment configuration:"));
    console.log(chalk.gray(`  Repository:    `) + chalk.cyan(repoFullName));
    console.log(chalk.gray(`  Branch:        `) + chalk.cyan(branch));
    console.log(chalk.gray(`  Name:          `) + chalk.cyan(projectName));
    console.log(chalk.gray(`  Runtime:       `) + chalk.cyan(runtime));
    console.log(chalk.gray(`  Port:          `) + chalk.cyan(port));
    if (options.region)
      console.log(chalk.gray(`  Region:        `) + chalk.cyan(options.region));
    if (options.buildCommand)
      console.log(
        chalk.gray(`  Build command: `) + chalk.cyan(options.buildCommand)
      );
    else if (buildCommand)
      console.log(
        chalk.gray(`  Build command: `) +
          chalk.gray(buildCommand + " (auto-detected)")
      );
    if (options.startCommand)
      console.log(
        chalk.gray(`  Start command: `) + chalk.cyan(options.startCommand)
      );
    else if (startCommand)
      console.log(
        chalk.gray(`  Start command: `) +
          chalk.gray(startCommand + " (auto-detected)")
      );
    if (Object.keys(envVars).length > 0) {
      console.log(
        chalk.gray(`  Environment:   `) +
          chalk.cyan(`${Object.keys(envVars).length} variable(s)`)
      );
    }
    console.log();

    if (!options.yes) {
      const shouldDeploy = await prompt(chalk.white(`Deploy? (Y/n): `), "y");
      if (!shouldDeploy) {
        console.log(chalk.gray("Deployment cancelled."));
        process.exit(0);
      }
    }

    // ── Step 6: Deploy ────────────────────────────────────────────
    const existingLink = !options.new ? await getProjectLink(cwd) : null;
    let serverId = existingLink?.serverId;

    // When --org is specified, verify the linked server belongs to that org.
    // If not, ignore the link and create a new server in the specified org.
    if (serverId && resolvedOrgId) {
      try {
        const linkedServer = await api.getServer(serverId);
        if (linkedServer.organizationId !== resolvedOrgId) {
          const target = resolvedOrgName
            ? `${resolvedOrgName}${resolvedOrgSlug ? ` (${resolvedOrgSlug})` : ""}`
            : resolvedOrgId;
          console.log(
            chalk.yellow(
              `⚠️  Linked server belongs to a different organization. Creating a new server in ${target}...\n`
            )
          );
          serverId = undefined;
        }
      } catch {
        // If we can't fetch the server, let the existing flow handle it
      }
    }

    if (existingLink && serverId) {
      try {
        const existingDep = await api.getDeployment(existingLink.deploymentId);
        if (existingDep && existingDep.status !== "failed") {
          console.log(chalk.green(`✓ Found linked server`));
          console.log(chalk.gray(`  Redeploying to maintain the same URL...`));
          console.log(chalk.cyan(`  URL: ${getMcpServerUrl(existingDep)}\n`));

          const newDep = await api.createDeployment({
            serverId,
            branch,
            trigger: "redeploy",
          });

          await saveProjectLink(cwd, {
            ...existingLink,
            linkedAt: new Date().toISOString(),
            deploymentId: newDep.id,
          });

          console.log(
            chalk.green("✓ Deployment created: ") + chalk.gray(newDep.id)
          );
          await displayDeploymentProgress(api, newDep.id, { yes: options.yes });
          return;
        }
      } catch (err: any) {
        const is404 =
          err?.status === 404 || (err?.message ?? "").includes("404");
        if (is404) {
          console.log(
            chalk.yellow("⚠️  Previously linked server no longer exists.\n")
          );
          if (!options.yes) {
            const shouldRecreate = await prompt(
              chalk.white("Create a new server and deploy? (Y/n): "),
              "y"
            );
            if (!shouldRecreate) {
              console.log(chalk.gray("Deployment cancelled."));
              process.exit(0);
            }
          }
          serverId = undefined;
        }
      }
    }

    let deploymentId: string | undefined;

    if (serverId) {
      console.log(chalk.gray("Creating deployment..."));
      try {
        const result = await api.createDeployment({
          serverId,
          branch,
          trigger: "manual",
        });
        deploymentId = result.id;
      } catch (err: any) {
        const is404 =
          err?.status === 404 || (err?.message ?? "").includes("404");
        if (is404) {
          console.log(
            chalk.yellow(
              "⚠️  Linked server no longer exists. Creating a new one...\n"
            )
          );
          serverId = undefined;
        } else {
          throw err;
        }
      }
    }

    if (!serverId) {
      const orgId = await api.resolveOrganizationId();

      if (!installationDbId) {
        console.log(
          chalk.red(
            "✗ Could not determine GitHub installation for this repository."
          )
        );
        process.exit(1);
      }

      console.log(chalk.gray("Creating server and deployment..."));
      const serverResult = await api.createServer({
        type: "github",
        organizationId: orgId,
        installationId: installationDbId,
        name: projectName,
        repoFullName: repoFullName!,
        branch,
        rootDir: options.rootDir,
        port,
        env: Object.keys(envVars).length > 0 ? envVars : undefined,
        region: options.region,
        buildCommand: options.buildCommand,
        startCommand: options.startCommand,
      });

      deploymentId = serverResult.deploymentId ?? "";
      if (!deploymentId) {
        console.log(
          chalk.green("✓ Server created: ") + chalk.gray(serverResult.server.id)
        );
        console.log(chalk.yellow("⚠️  No deployment was triggered."));
        return;
      }

      await saveProjectLink(cwd, {
        deploymentId,
        deploymentName: projectName,
        linkedAt: new Date().toISOString(),
        serverId: serverResult.server.id,
      });
      console.log(
        chalk.gray(`  Linked to this project (stored in .mcp-use/project.json)`)
      );
      console.log(chalk.gray(`  Future deploys will reuse the same URL\n`));
    }

    if (!deploymentId) {
      console.log(chalk.red("✗ No deployment was created."));
      process.exit(1);
    }

    console.log(
      chalk.green("✓ Deployment created: ") + chalk.gray(deploymentId)
    );
    await displayDeploymentProgress(api, deploymentId, { yes: options.yes });

    if (options.open) {
      const dep = await api.getDeployment(deploymentId);
      const url = getMcpServerUrl(dep);
      if (url) {
        console.log(chalk.gray("\nOpening in browser..."));
        await open(url);
      }
    }
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Deployment failed:"),
      chalk.red(error instanceof Error ? error.message : "Unknown error")
    );
    process.exit(1);
  }
}
