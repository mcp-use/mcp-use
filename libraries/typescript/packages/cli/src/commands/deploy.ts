import chalk from "chalk";
import { promises as fs } from "node:fs";
import path from "node:path";
import { McpUseAPI, CreateDeploymentRequest, Deployment } from "../utils/api.js";
import { isLoggedIn } from "../utils/config.js";
import { getGitInfo, isGitHubUrl } from "../utils/git.js";
import open from "open";

interface DeployOptions {
  open?: boolean;
  name?: string;
  port?: number;
  runtime?: "node" | "python";
}

/**
 * Check if directory looks like an MCP server project
 */
async function isMcpProject(cwd: string = process.cwd()): Promise<boolean> {
  try {
    const packageJsonPath = path.join(cwd, "package.json");
    const content = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);

    // Check for common MCP indicators
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

/**
 * Get project name from package.json or directory name
 */
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

/**
 * Detect build command from package.json
 */
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

/**
 * Detect start command from package.json
 */
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

    // Look for main entry point
    if (packageJson.main) {
      return `node ${packageJson.main}`;
    }
  } catch {
    // No start command found
  }

  return undefined;
}

/**
 * Detect runtime from project files
 */
async function detectRuntime(
  cwd: string = process.cwd()
): Promise<"node" | "python"> {
  try {
    // Check for Python indicators
    const pythonFiles = ["requirements.txt", "pyproject.toml", "setup.py"];
    for (const file of pythonFiles) {
      try {
        await fs.access(path.join(cwd, file));
        return "python";
      } catch {
        continue;
      }
    }

    // Check for Node indicators (package.json)
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

/**
 * Prompt user for confirmation
 */
async function prompt(question: string): Promise<boolean> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

/**
 * Display deployment progress
 */
async function displayDeploymentProgress(
  api: McpUseAPI,
  deployment: Deployment
): Promise<void> {
  console.log(chalk.gray("\nStreaming deployment logs...\n"));

  try {
    for await (const log of api.streamDeploymentLogs(deployment.id)) {
      // Parse structured logs if they're JSON
      try {
        const logData = JSON.parse(log);
        if (logData.step) {
          console.log(chalk.cyan(`[${logData.step}]`), logData.message || "");
        } else if (logData.message) {
          console.log(chalk.gray(logData.message));
        } else {
          console.log(chalk.gray(log));
        }
      } catch {
        // Not JSON, just print as-is
        console.log(chalk.gray(log));
      }
    }
  } catch (error) {
    console.log(
      chalk.yellow(
        "\n⚠️  Log streaming ended. Checking final deployment status..."
      )
    );
  }

  // Check final status
  const finalDeployment = await api.getDeployment(deployment.id);

  console.log();
  if (finalDeployment.status === "running") {
    console.log(chalk.green.bold("✓ Deployment successful!"));
    console.log();
    console.log(
      chalk.white("Deployment URL: ") +
        chalk.cyan(`https://${finalDeployment.domain}`)
    );
    if (finalDeployment.customDomain) {
      console.log(
        chalk.white("Custom Domain:  ") +
          chalk.cyan(`https://${finalDeployment.customDomain}`)
      );
    }
    console.log(
      chalk.white("Status:         ") + chalk.green(finalDeployment.status)
    );
    console.log(
      chalk.white("Deployment ID:  ") + chalk.gray(finalDeployment.id)
    );
  } else if (finalDeployment.status === "failed") {
    console.log(chalk.red.bold("✗ Deployment failed"));
    if (finalDeployment.error) {
      console.log(chalk.red("\nError: ") + finalDeployment.error);
    }
    process.exit(1);
  } else {
    console.log(
      chalk.yellow("⚠️  Deployment status: ") + finalDeployment.status
    );
  }
}

/**
 * Deploy command - deploys MCP server to mcp-use cloud
 */
export async function deployCommand(options: DeployOptions): Promise<void> {
  try {
    const cwd = process.cwd();

    // Check if logged in
    if (!(await isLoggedIn())) {
      console.log(chalk.red("✗ You are not logged in."));
      console.log(
        chalk.gray("Run " + chalk.white("mcp-use login") + " to get started.")
      );
      process.exit(1);
    }

    console.log(chalk.cyan.bold("🚀 Deploying to mcp-use cloud...\n"));

    // Check if this is an MCP project
    const isMcp = await isMcpProject(cwd);
    if (!isMcp) {
      console.log(
        chalk.yellow(
          "⚠️  This doesn't appear to be an MCP server project (no mcp-use or @modelcontextprotocol/sdk dependency found)."
        )
      );
      const shouldContinue = await prompt(
        chalk.white("Continue anyway? (y/n): ")
      );
      if (!shouldContinue) {
        console.log(chalk.gray("Deployment cancelled."));
        process.exit(0);
      }
      console.log();
    }

    // Get git info
    const gitInfo = await getGitInfo(cwd);

    if (gitInfo.isGitRepo && gitInfo.remoteUrl && isGitHubUrl(gitInfo.remoteUrl)) {
      // GitHub repo detected
      if (!gitInfo.owner || !gitInfo.repo) {
        console.log(
          chalk.red(
            "✗ Could not parse GitHub repository information from remote URL."
          )
        );
        process.exit(1);
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

      // Confirm deployment
      const shouldDeploy = await prompt(
        chalk.white(
          `Deploy from GitHub repository ${gitInfo.owner}/${gitInfo.repo}? (y/n): `
        )
      );

      if (!shouldDeploy) {
        console.log(chalk.gray("Deployment cancelled."));
        process.exit(0);
      }

      // Detect project settings
      const projectName =
        options.name || (await getProjectName(cwd));
      const runtime = options.runtime || (await detectRuntime(cwd));
      const port = options.port || 3000;
      const buildCommand = await detectBuildCommand(cwd);
      const startCommand = await detectStartCommand(cwd);

      console.log();
      console.log(chalk.white("Deployment configuration:"));
      console.log(chalk.gray(`  Name:          `) + chalk.cyan(projectName));
      console.log(chalk.gray(`  Runtime:       `) + chalk.cyan(runtime));
      console.log(chalk.gray(`  Port:          `) + chalk.cyan(port));
      if (buildCommand) {
        console.log(
          chalk.gray(`  Build command: `) + chalk.cyan(buildCommand)
        );
      }
      if (startCommand) {
        console.log(
          chalk.gray(`  Start command: `) + chalk.cyan(startCommand)
        );
      }
      console.log();

      // Create deployment request
      const deploymentRequest: CreateDeploymentRequest = {
        name: projectName,
        source: {
          type: "github",
          repo: `${gitInfo.owner}/${gitInfo.repo}`,
          branch: gitInfo.branch || "main",
          runtime,
          port,
          buildCommand,
          startCommand,
        },
        healthCheckPath: "/healthz",
      };

      // Create deployment
      console.log(chalk.gray("Creating deployment..."));
      const api = await McpUseAPI.create();
      const deployment = await api.createDeployment(deploymentRequest);

      console.log(
        chalk.green("✓ Deployment created: ") + chalk.gray(deployment.id)
      );

      // Display progress
      await displayDeploymentProgress(api, deployment);

      // Open in browser if requested
      if (options.open && deployment.domain) {
        console.log();
        console.log(chalk.gray("Opening deployment in browser..."));
        await open(`https://${deployment.domain}`);
      }
    } else {
      // Not a GitHub repo
      console.log(
        chalk.yellow(
          "⚠️  This is not a GitHub repository or no remote is configured."
        )
      );
      console.log();
      console.log(
        chalk.white(
          "To deploy to mcp-use cloud, you need to push your code to GitHub first:"
        )
      );
      console.log();
      console.log(chalk.gray("  1. Initialize a git repository:"));
      console.log(chalk.cyan("     git init"));
      console.log();
      console.log(chalk.gray("  2. Create a repository on GitHub"));
      console.log();
      console.log(chalk.gray("  3. Add the remote and push:"));
      console.log(chalk.cyan("     git remote add origin <your-repo-url>"));
      console.log(chalk.cyan("     git add ."));
      console.log(chalk.cyan('     git commit -m "Initial commit"'));
      console.log(chalk.cyan("     git push -u origin main"));
      console.log();
      console.log(chalk.gray("  4. Run mcp-use deploy again"));
      console.log();
      console.log(
        chalk.gray(
          "Note: Direct artifact upload is not yet supported. All deployments must come from GitHub repositories."
        )
      );
      process.exit(1);
    }
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Deployment failed:"),
      chalk.red(
        error instanceof Error ? error.message : "Unknown error"
      )
    );
    process.exit(1);
  }
}

