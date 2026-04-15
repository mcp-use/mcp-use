import chalk from "chalk";
import { promises as fs } from "node:fs";
import path from "node:path";
import open from "open";
import type { Deployment } from "../utils/api.js";
import { McpUseAPI } from "../utils/api.js";
import { getWebUrl, isLoggedIn, readConfig } from "../utils/config.js";
import { getGitInfo, isGitHubUrl } from "../utils/git.js";
import { getProjectLink, saveProjectLink } from "../utils/project-link.js";
import { loginCommand } from "./auth.js";

// Gateway domain configuration - single source of truth
const GATEWAY_DOMAIN = "run.mcp-use.com";

function buildGatewayUrl(slugOrId: string): string {
  return `https://${slugOrId}.${GATEWAY_DOMAIN}/mcp`;
}

async function parseEnvFile(filePath: string): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const envVars: Record<string, string> = {};
    const lines = content.split("\n");

    let currentKey: string | null = null;
    let currentValue = "";

    for (let line of lines) {
      line = line.trim();

      if (!line || line.startsWith("#")) {
        continue;
      }

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
      if (equalIndex === -1) {
        continue;
      }

      const key = line.substring(0, equalIndex).trim();
      let value = line.substring(equalIndex + 1).trim();

      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        console.log(
          chalk.yellow(`⚠️  Skipping invalid environment variable key: ${key}`)
        );
        continue;
      }

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
        envVars[key] = value;
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
    throw new Error(
      `Invalid environment variable format: "${envStr}". Expected KEY=VALUE`
    );
  }

  const key = envStr.substring(0, equalIndex).trim();
  const value = envStr.substring(equalIndex + 1);

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(
      `Invalid environment variable key: "${key}". Keys must start with a letter or underscore and contain only letters, numbers, and underscores.`
    );
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
}

async function isMcpProject(cwd: string = process.cwd()): Promise<boolean> {
  try {
    const packageJsonPath = path.join(cwd, "package.json");
    const content = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);

    const hasMcpDeps =
      packageJson.dependencies?.["mcp-use"] ||
      packageJson.dependencies?.["@modelcontextprotocol/sdk"] ||
      packageJson.devDependencies?.["mcp-use"] ||
      packageJson.devDependencies?.["@modelcontextprotocol/sdk"];

    const hasMcpScripts =
      packageJson.scripts?.mcp || packageJson.scripts?.["mcp:dev"];

    return !!(hasMcpDeps || hasMcpScripts);
  } catch {
    return false;
  }
}

async function getProjectName(cwd: string = process.cwd()): Promise<string> {
  try {
    const packageJsonPath = path.join(cwd, "package.json");
    const content = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    if (packageJson.name) {
      return packageJson.name;
    }
  } catch {
    // Fall through to directory name
  }

  return path.basename(cwd);
}

async function detectBuildCommand(
  cwd: string = process.cwd()
): Promise<string | undefined> {
  try {
    const packageJsonPath = path.join(cwd, "package.json");
    const content = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);

    if (packageJson.scripts?.build) {
      return "npm run build";
    }
  } catch {
    // No build command found
  }

  return undefined;
}

async function detectStartCommand(
  cwd: string = process.cwd()
): Promise<string | undefined> {
  try {
    const packageJsonPath = path.join(cwd, "package.json");
    const content = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);

    if (packageJson.scripts?.start) {
      return "npm start";
    }

    if (packageJson.main) {
      return `node ${packageJson.main}`;
    }
  } catch {
    // No start command found
  }

  return undefined;
}

async function detectRuntime(
  cwd: string = process.cwd()
): Promise<"node" | "python"> {
  try {
    const pythonFiles = ["requirements.txt", "pyproject.toml", "setup.py"];
    for (const file of pythonFiles) {
      try {
        await fs.access(path.join(cwd, file));
        return "python";
      } catch {
        continue;
      }
    }

    try {
      await fs.access(path.join(cwd, "package.json"));
      return "node";
    } catch {
      // Default to node
    }
  } catch {
    // Default to node
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

  const defaultIndicator = defaultValue === "y" ? "Y/n" : "y/N";
  const questionWithDefault = question.replace(
    /(\(y\/n\):)/,
    `(${defaultIndicator}):`
  );

  return new Promise((resolve) => {
    rl.question(questionWithDefault, (answer) => {
      rl.close();
      const trimmedAnswer = answer.trim().toLowerCase();
      if (trimmedAnswer === "") {
        resolve(defaultValue === "y");
      } else {
        resolve(trimmedAnswer === "y" || trimmedAnswer === "yes");
      }
    });
  });
}

function getMcpServerUrl(deployment: Deployment): string {
  if (deployment.mcpUrl) {
    return deployment.mcpUrl;
  }
  if (deployment.serverId) {
    return buildGatewayUrl(deployment.serverId);
  }
  return "";
}

/**
 * Poll build-logs with offset tailing until deployment reaches a terminal status.
 */
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
      const frame = frames[frameIndex];
      frameIndex = (frameIndex + 1) % frames.length;
      process.stdout.write(
        "\r" + chalk.cyan(frame) + " " + chalk.gray(message)
      );
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

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  while (checkCount < maxChecks) {
    await sleep(delay);
    checkCount++;

    try {
      const buildLogsResp = await api.getDeploymentBuildLogs(
        deploymentId,
        buildLogOffset
      );
      if (buildLogsResp.logs.length > 0) {
        const logLines = buildLogsResp.logs.split("\n").filter((l) => l.trim());
        for (const line of logLines) {
          try {
            const logData = JSON.parse(line);
            if (logData.line) {
              stopSpinner();
              const levelColor =
                logData.level === "error"
                  ? chalk.red
                  : logData.level === "warn"
                    ? chalk.yellow
                    : chalk.gray;
              const stepPrefix = logData.step
                ? chalk.cyan(`[${logData.step}]`) + " "
                : "";
              console.log(stepPrefix + levelColor(logData.line));
            }
          } catch {
            stopSpinner();
            console.log(chalk.gray(line));
          }
        }
        buildLogOffset = buildLogsResp.offset;
      }
    } catch {
      // Build logs endpoint may not be ready yet
    }

    const deployment = await api.getDeployment(deploymentId);

    if (deployment.status === "running") {
      stopSpinner();
      const mcpServerUrl = getMcpServerUrl(deployment);

      let dashboardUrl: string | null = null;
      const webUrl = (await getWebUrl()).replace(/\/$/, "");
      const config = await readConfig();
      const orgSlug = config.orgSlug;
      if (deployment.serverId) {
        if (orgSlug) {
          dashboardUrl = `${webUrl}/cloud/${orgSlug}/servers/${deployment.serverId}`;
        } else {
          dashboardUrl = `${webUrl}/cloud/servers/${deployment.serverId}`;
        }
      }

      const inspectorUrl = `https://inspector.manufact.com/inspector?autoConnect=${encodeURIComponent(
        mcpServerUrl
      )}`;

      console.log(chalk.green.bold("✓ Deployment successful!\n"));
      if (mcpServerUrl) {
        console.log(chalk.white("🌐 MCP Server URL:"));
        console.log(chalk.cyan.bold(`   ${mcpServerUrl}\n`));
      }

      if (dashboardUrl) {
        console.log(chalk.white("📊 Dashboard:"));
        console.log(chalk.cyan.bold(`   ${dashboardUrl}\n`));
      }

      console.log(chalk.white("🔍 Inspector URL:"));
      console.log(chalk.cyan.bold(`   ${inspectorUrl}\n`));

      console.log(chalk.gray("Deployment ID: ") + chalk.white(deployment.id));
      return;
    } else if (deployment.status === "failed") {
      stopSpinner();
      console.log(chalk.red.bold("✗ Deployment failed\n"));

      if (deployment.error) {
        console.log(chalk.red("Error: ") + deployment.error);

        if (deployment.error.includes("No GitHub installations found")) {
          console.log();
          const retry = await promptGitHubInstallation(
            api,
            "not_connected",
            undefined,
            { yes: progressOptions?.yes }
          );
          if (retry && deployment.serverId) {
            console.log(chalk.cyan("\n🔄 Retrying deployment...\n"));
            const newDep = await api.createDeployment({
              serverId: deployment.serverId,
              trigger: "redeploy",
            });
            await displayDeploymentProgress(api, newDep.id, progressOptions);
            return;
          }
        }
      }

      process.exit(1);
    } else if (
      deployment.status === "building" ||
      deployment.status === "pending"
    ) {
      startSpinner("Building and deploying...");
      delay = Math.min(delay * 1.2, maxDelay);
    } else {
      stopSpinner();
      console.log(chalk.yellow("⚠️  Deployment status: ") + deployment.status);
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

async function checkRepoAccess(
  api: McpUseAPI,
  owner: string,
  repo: string
): Promise<boolean> {
  try {
    const reposResponse = await api.getGitHubRepos(true);
    const repoFullName = `${owner}/${repo}`;
    return reposResponse.repos.some((r) => r.full_name === repoFullName);
  } catch (error) {
    console.log(chalk.gray("Could not verify repository access"));
    return false;
  }
}

const GITHUB_SETUP_POLL_INTERVAL_MS = 2000;
const GITHUB_SETUP_POLL_MAX_MS = 120_000;

async function waitForGitHubSetupAfterBrowser(
  api: McpUseAPI,
  repoName: string | undefined,
  yes: boolean
): Promise<void> {
  if (!yes) {
    console.log(chalk.gray("Waiting for GitHub configuration..."));
    await prompt(
      chalk.white("Press Enter when you've completed the GitHub setup..."),
      "y"
    );
    return;
  }

  console.log(
    chalk.gray(
      "Waiting for GitHub configuration (polling every 2s, up to 2 min)..."
    )
  );
  const deadline = Date.now() + GITHUB_SETUP_POLL_MAX_MS;

  while (Date.now() < deadline) {
    try {
      const status = await api.getGitHubConnectionStatus();
      if (!status.is_connected) {
        await new Promise((r) => setTimeout(r, GITHUB_SETUP_POLL_INTERVAL_MS));
        continue;
      }
      if (repoName) {
        const parts = repoName.split("/");
        const owner = parts[0];
        const repo = parts[1];
        if (owner && repo && (await checkRepoAccess(api, owner, repo))) {
          return;
        }
      } else {
        return;
      }
    } catch {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, GITHUB_SETUP_POLL_INTERVAL_MS));
  }

  console.log(
    chalk.yellow(
      "⚠️  Timed out waiting for GitHub setup. Continuing with verification..."
    )
  );
}

async function promptGitHubInstallation(
  api: McpUseAPI,
  reason: "not_connected" | "no_access",
  repoName?: string,
  opts?: { yes?: boolean }
): Promise<boolean> {
  const yes = !!opts?.yes;
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

  if (!shouldInstall) {
    return false;
  }

  try {
    const appName = await api.getGitHubAppName();

    const installUrl =
      reason === "not_connected"
        ? `https://github.com/apps/${appName}/installations/new`
        : `https://github.com/settings/installations`;

    console.log(
      chalk.cyan(
        `\nOpening browser to ${reason === "not_connected" ? "install" : "configure"} GitHub App...`
      )
    );
    console.log(chalk.gray(`URL: ${installUrl}\n`));

    if (reason === "no_access") {
      console.log(chalk.white("Please:"));
      console.log(
        chalk.cyan("  1. Find the 'mcp-use' (or similar) GitHub App")
      );
      console.log(chalk.cyan("  2. Click 'Configure'"));
      console.log(
        chalk.cyan(
          `  3. Grant access to ${chalk.bold(repoName || "your repository")}`
        )
      );
      console.log(chalk.cyan("  4. Save your changes"));
      console.log(chalk.cyan("  5. Return here when done\n"));
    } else {
      console.log(chalk.white("Please:"));
      console.log(chalk.cyan("  1. Select the repositories to grant access"));
      if (repoName) {
        console.log(
          chalk.cyan(`  2. Make sure to include ${chalk.bold(repoName)}`)
        );
        console.log(chalk.cyan("  3. Complete the installation"));
      } else {
        console.log(chalk.cyan("  2. Complete the installation"));
      }
      console.log();
    }

    await open(installUrl);

    await waitForGitHubSetupAfterBrowser(api, repoName, yes);

    console.log(chalk.gray("Verifying GitHub connection..."));

    let verified = false;
    try {
      const status = await api.getGitHubConnectionStatus();

      if (!status.is_connected) {
        console.log(chalk.yellow("⚠️  GitHub connection not detected."));
      } else if (repoName) {
        const [owner, repo] = repoName.split("/");
        console.log(chalk.gray(`Checking access to ${repoName}...`));

        const hasAccess = await checkRepoAccess(api, owner, repo);

        if (!hasAccess) {
          console.log(
            chalk.yellow(
              `⚠️  The GitHub App may not have access to ${chalk.cyan(repoName)} yet`
            )
          );
        } else {
          console.log(chalk.green(`✓ Repository ${repoName} is accessible!\n`));
          verified = true;
        }
      } else {
        console.log(chalk.green("✓ GitHub connected successfully!\n"));
        verified = true;
      }
    } catch (error) {
      console.log(
        chalk.yellow("⚠️  Could not verify GitHub connection (API issue)")
      );
    }

    if (!verified) {
      console.log(
        chalk.gray(
          "\nNote: If you completed the GitHub setup, the deployment may work now.\n"
        )
      );
    }

    return true;
  } catch (error) {
    console.log(
      chalk.yellow("\n⚠️  Unable to open GitHub installation automatically")
    );
    console.log(
      chalk.white("Please visit: ") +
        chalk.cyan("https://manufact.com/cloud/settings")
    );
    console.log(
      chalk.gray("Then connect your GitHub account and try again.\n")
    );
    return false;
  }
}

/**
 * Deploy command - deploys MCP server to Manufact cloud
 */
export async function deployCommand(options: DeployOptions): Promise<void> {
  try {
    const cwd = process.cwd();

    if (!(await isLoggedIn())) {
      console.log(chalk.red("✗ You are not logged in."));
      if (options.yes) {
        console.log(
          chalk.gray(
            "Run " +
              chalk.white("npx mcp-use login") +
              " first. Non-interactive deploy requires an existing session."
          )
        );
        process.exit(1);
      }

      const shouldLogin = await prompt(
        chalk.white("Would you like to login now? (Y/n): "),
        "y"
      );

      if (shouldLogin) {
        try {
          await loginCommand({ silent: false });

          if (!(await isLoggedIn())) {
            console.log(
              chalk.red("✗ Login verification failed. Please try again.")
            );
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
      } else {
        console.log(
          chalk.gray(
            "Run " + chalk.white("npx mcp-use login") + " to get started."
          )
        );
        console.log(chalk.gray("Deployment cancelled."));
        process.exit(0);
      }
    }

    console.log(chalk.cyan.bold("🚀 Deploying to Manufact cloud...\n"));

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
      console.log(chalk.gray(`  Root dir:   `) + chalk.cyan(options.rootDir));
    }

    const isMcp = await isMcpProject(projectDir);
    if (!isMcp) {
      console.log(
        chalk.yellow(
          "⚠️  This doesn't appear to be an MCP server project (no mcp-use or @modelcontextprotocol/sdk dependency found)."
        )
      );
      if (!options.yes) {
        const shouldContinue = await prompt(
          chalk.white("Continue anyway? (y/n): ")
        );
        if (!shouldContinue) {
          console.log(chalk.gray("Deployment cancelled."));
          process.exit(0);
        }
      }
      console.log();
    }

    const gitInfo = await getGitInfo(cwd);

    if (!gitInfo.isGitRepo) {
      console.log(chalk.red("✗ Not a git repository\n"));
      console.log(chalk.white("To deploy, initialize git and push to GitHub:"));
      console.log(chalk.gray("  1. Initialize git:"));
      console.log(chalk.cyan("     git init\n"));
      console.log(chalk.gray("  2. Create a GitHub repository at:"));
      console.log(chalk.cyan("     https://github.com/new\n"));
      console.log(chalk.gray("  3. Add the remote and push:"));
      console.log(chalk.cyan("     git remote add origin <your-github-url>"));
      console.log(chalk.cyan("     git add ."));
      console.log(chalk.cyan("     git commit -m 'Initial commit'"));
      console.log(chalk.cyan("     git push -u origin main\n"));
      process.exit(1);
    }

    if (!gitInfo.remoteUrl) {
      console.log(chalk.red("✗ No git remote configured\n"));
      console.log(chalk.white("Add a GitHub remote:"));
      console.log(chalk.cyan("  git remote add origin <your-github-url>\n"));
      process.exit(1);
    }

    if (!isGitHubUrl(gitInfo.remoteUrl)) {
      console.log(chalk.red("✗ Remote is not a GitHub repository"));
      console.log(chalk.yellow(`   Current remote: ${gitInfo.remoteUrl}\n`));
      console.log(chalk.white("Please add a GitHub remote to deploy."));
      process.exit(1);
    }

    if (!gitInfo.owner || !gitInfo.repo) {
      console.log(chalk.red("✗ Could not parse GitHub repository information"));
      process.exit(1);
    }

    if (gitInfo.hasUncommittedChanges) {
      console.log(chalk.yellow("⚠️  You have uncommitted changes\n"));
      console.log(chalk.white("Deployments use the code pushed to GitHub."));
      console.log(
        chalk.white(
          "Local changes will not be included until you commit and push.\n"
        )
      );

      if (!options.yes) {
        const shouldContinue = await prompt(
          chalk.white("Continue with deployment from GitHub? (y/n): ")
        );

        if (!shouldContinue) {
          console.log(chalk.gray("Deployment cancelled."));
          process.exit(0);
        }
      }
      console.log();
    }

    console.log(chalk.white("GitHub repository detected:"));
    console.log(
      chalk.gray(`  Repository: `) +
        chalk.cyan(`${gitInfo.owner}/${gitInfo.repo}`)
    );
    console.log(
      chalk.gray(`  Branch:     `) + chalk.cyan(gitInfo.branch || "main")
    );
    if (gitInfo.commitSha) {
      console.log(
        chalk.gray(`  Commit:     `) +
          chalk.gray(gitInfo.commitSha.substring(0, 7))
      );
    }
    if (gitInfo.commitMessage) {
      console.log(
        chalk.gray(`  Message:    `) +
          chalk.gray(gitInfo.commitMessage.split("\n")[0])
      );
    }
    console.log();

    if (!options.yes) {
      const shouldDeploy = await prompt(
        chalk.white(
          `Deploy from GitHub repository ${gitInfo.owner}/${gitInfo.repo}? (Y/n): `
        ),
        "y"
      );

      if (!shouldDeploy) {
        console.log(chalk.gray("Deployment cancelled."));
        process.exit(0);
      }
    }

    const projectName = options.name || (await getProjectName(projectDir));
    const runtime = options.runtime || (await detectRuntime(projectDir));
    const port = options.port || 3000;
    const buildCommand = await detectBuildCommand(projectDir);
    const startCommand = await detectStartCommand(projectDir);

    const envVars = await buildEnvVars(options);

    console.log();
    console.log(chalk.white("Deployment configuration:"));
    console.log(chalk.gray(`  Name:          `) + chalk.cyan(projectName));
    console.log(chalk.gray(`  Runtime:       `) + chalk.cyan(runtime));
    console.log(chalk.gray(`  Port:          `) + chalk.cyan(port));
    if (options.rootDir) {
      console.log(
        chalk.gray(`  Root dir:      `) + chalk.cyan(options.rootDir)
      );
    }
    if (buildCommand) {
      console.log(chalk.gray(`  Build command: `) + chalk.cyan(buildCommand));
    }
    if (startCommand) {
      console.log(chalk.gray(`  Start command: `) + chalk.cyan(startCommand));
    }
    if (envVars && Object.keys(envVars).length > 0) {
      console.log(
        chalk.gray(`  Environment:   `) +
          chalk.cyan(`${Object.keys(envVars).length} variable(s)`)
      );
      console.log(
        chalk.gray(`                 `) +
          chalk.gray(Object.keys(envVars).join(", "))
      );
    }
    console.log();

    const api = await McpUseAPI.create();

    // Resolve --org flag
    if (options.org) {
      try {
        const authInfo = await api.testAuth();
        const match = (authInfo.orgs ?? []).find(
          (o) =>
            o.slug === options.org ||
            o.id === options.org ||
            o.name.toLowerCase() === options.org!.toLowerCase()
        );
        if (match) {
          api.setOrgId(match.id);
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
      } catch (error) {
        console.error(
          chalk.red("✗ Failed to resolve organization:"),
          chalk.red(error instanceof Error ? error.message : "Unknown error")
        );
        process.exit(1);
      }
    }

    // Pre-flight GitHub connection check
    let githubVerified = false;
    let installationDbId: string | undefined;
    try {
      console.log(chalk.gray(`[DEBUG] API URL: ${(api as any).baseUrl}`));
      const connectionStatus = await api.getGitHubConnectionStatus();

      if (!connectionStatus.is_connected) {
        const repoFullName = `${gitInfo.owner}/${gitInfo.repo}`;
        const installed = await promptGitHubInstallation(
          api,
          "not_connected",
          repoFullName,
          { yes: options.yes }
        );
        if (!installed) {
          console.log(chalk.gray("Deployment cancelled."));
          process.exit(0);
        }
        const retryStatus = await api.getGitHubConnectionStatus();
        if (!retryStatus.is_connected) {
          console.log(
            chalk.red("\n✗ GitHub connection could not be verified.")
          );
          console.log(
            chalk.gray("Please try connecting GitHub from the web UI:")
          );
          console.log(chalk.cyan("  https://manufact.com/cloud/settings\n"));
          process.exit(1);
        }
        installationDbId = retryStatus.installations?.[0]?.id;
        githubVerified = true;
      } else if (gitInfo.owner && gitInfo.repo) {
        installationDbId = connectionStatus.installations?.[0]?.id;
        console.log(chalk.gray("Checking repository access..."));
        const hasAccess = await checkRepoAccess(
          api,
          gitInfo.owner,
          gitInfo.repo
        );

        if (!hasAccess) {
          const repoFullName = `${gitInfo.owner}/${gitInfo.repo}`;
          console.log(
            chalk.yellow(
              `⚠️  GitHub App doesn't have access to ${chalk.cyan(repoFullName)}`
            )
          );

          const configured = await promptGitHubInstallation(
            api,
            "no_access",
            repoFullName,
            { yes: options.yes }
          );
          if (!configured) {
            console.log(chalk.gray("Deployment cancelled."));
            process.exit(0);
          }
          const hasAccessRetry = await checkRepoAccess(
            api,
            gitInfo.owner,
            gitInfo.repo
          );
          if (!hasAccessRetry) {
            console.log(
              chalk.red(
                `\n✗ Repository ${chalk.cyan(repoFullName)} is still not accessible.`
              )
            );
            console.log(
              chalk.gray(
                "Please make sure the GitHub App has access to this repository."
              )
            );
            console.log(
              chalk.cyan("  https://github.com/settings/installations\n")
            );
            process.exit(1);
          }
          githubVerified = true;
        } else {
          console.log(chalk.green("✓ Repository access confirmed"));
          githubVerified = true;
        }
      }
    } catch (error) {
      console.log(chalk.red("✗ Could not verify GitHub connection"));
      console.log(
        chalk.gray(
          "Error: " + (error instanceof Error ? error.message : "Unknown error")
        )
      );
      console.log(chalk.gray("\nPlease ensure:"));
      console.log(
        chalk.cyan(
          "  1. You have connected GitHub at https://manufact.com/cloud/settings"
        )
      );
      console.log(
        chalk.cyan("  2. The GitHub App has access to your repository")
      );
      console.log(chalk.cyan("  3. Your internet connection is stable\n"));
      process.exit(1);
    }

    if (!githubVerified) {
      console.log(
        chalk.red("\n✗ GitHub verification required for this deployment")
      );
      process.exit(1);
    }

    const existingLink = !options.new ? await getProjectLink(cwd) : null;
    const serverId = existingLink?.serverId;

    if (existingLink && serverId) {
      try {
        const existingDeployment = await api.getDeployment(
          existingLink.deploymentId
        );

        if (existingDeployment && existingDeployment.status !== "failed") {
          console.log(chalk.green(`✓ Found linked deployment`));
          console.log(chalk.gray(`  Redeploying to maintain the same URL...`));
          console.log(
            chalk.cyan(`  URL: ${getMcpServerUrl(existingDeployment)}\n`)
          );

          const newDep = await api.createDeployment({
            serverId,
            branch: gitInfo.branch || "main",
            trigger: "redeploy",
          });

          await saveProjectLink(cwd, {
            ...existingLink,
            linkedAt: new Date().toISOString(),
            deploymentId: newDep.id,
          });

          await displayDeploymentProgress(api, newDep.id, {
            yes: options.yes,
          });

          return;
        } else {
          console.log(
            chalk.yellow(
              `⚠️  Linked deployment not found or failed, creating new one...`
            )
          );
          console.log(chalk.gray(`  Will reuse existing server: ${serverId}`));
        }
      } catch (error) {
        console.log(
          chalk.yellow(`⚠️  Linked deployment not found, creating new one...`)
        );
        console.log(chalk.gray(`  Will reuse existing server: ${serverId}`));
      }
    }

    // Show target organization if not already shown by --org flag
    if (!options.org) {
      try {
        const config = await readConfig();
        if (config.orgName) {
          const slug = config.orgSlug ? chalk.gray(` (${config.orgSlug})`) : "";
          console.log(
            chalk.gray("Organization: ") + chalk.cyan(config.orgName) + slug
          );
        }
      } catch {
        // Non-fatal
      }
    }

    let deploymentId: string;

    if (serverId) {
      // Existing server — just trigger a new deployment
      console.log(chalk.gray("Creating deployment..."));
      const result = await api.createDeployment({
        serverId,
        branch: gitInfo.branch || "main",
        trigger: "manual",
      });
      deploymentId = result.id;
    } else {
      // New server + first deployment
      if (!installationDbId) {
        console.log(chalk.red("✗ Could not determine GitHub installation ID."));
        console.log(
          chalk.gray(
            "Please ensure your GitHub App is installed and try again."
          )
        );
        process.exit(1);
      }

      const orgId = await api.resolveOrganizationId();

      console.log(chalk.gray("Creating server and deployment..."));
      const serverResult = await api.createServer({
        type: "github",
        organizationId: orgId,
        installationId: installationDbId,
        name: projectName,
        repoFullName: `${gitInfo.owner}/${gitInfo.repo}`,
        branch: gitInfo.branch || "main",
        rootDir: options.rootDir,
        port,
        env: Object.keys(envVars).length > 0 ? envVars : undefined,
      });

      deploymentId = serverResult.deploymentId ?? "";
      if (!deploymentId) {
        console.log(
          chalk.green("✓ Server created: ") + chalk.gray(serverResult.server.id)
        );
        console.log(
          chalk.yellow(
            "⚠️  No deployment was triggered. You may need to trigger one manually."
          )
        );
        return;
      }

      // Save project link
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

    console.log(
      chalk.green("✓ Deployment created: ") + chalk.gray(deploymentId)
    );

    await displayDeploymentProgress(api, deploymentId, { yes: options.yes });
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Deployment failed:"),
      chalk.red(error instanceof Error ? error.message : "Unknown error")
    );
    process.exit(1);
  }
}
