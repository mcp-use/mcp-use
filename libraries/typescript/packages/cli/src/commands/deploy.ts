import chalk from "chalk";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { McpUseAPI, CreateDeploymentRequest, Deployment } from "../utils/api.js";
import { isLoggedIn } from "../utils/config.js";
import { getGitInfo, isGitHubUrl } from "../utils/git.js";
import open from "open";

const execAsync = promisify(exec);

interface DeployOptions {
  open?: boolean;
  name?: string;
  port?: number;
  runtime?: "node" | "python";
  fromSource?: boolean;
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
 * Create a tarball of the project, excluding common build artifacts and dependencies
 */
async function createTarball(cwd: string): Promise<string> {
  const tmpDir = os.tmpdir();
  const tarballPath = path.join(tmpDir, `mcp-deploy-${Date.now()}.tar.gz`);

  // Common patterns to exclude
  const excludePatterns = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".venv",
    "__pycache__",
    "*.pyc",
    ".DS_Store",
    ".env",
    ".env.local",
    "*.log",
  ];

  // Build tar exclude flags
  const excludeFlags = excludePatterns
    .map((pattern) => `--exclude='${pattern}'`)
    .join(" ");

  // Create tarball
  const command = `tar ${excludeFlags} -czf "${tarballPath}" -C "${cwd}" .`;

  try {
    await execAsync(command);
    return tarballPath;
  } catch (error) {
    throw new Error(
      `Failed to create tarball: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Get file size in human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Display deployment progress with spinner
 */
async function displayDeploymentProgress(
  api: McpUseAPI,
  deployment: Deployment
): Promise<void> {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIndex = 0;
  let spinnerInterval: NodeJS.Timeout | null = null;
  let lastStep = "";
  
  const startSpinner = (message: string) => {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
    }
    
    // Clear the line
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

  let lastLogLength = 0;
  let previousBuildLogs = "";

  try {
    for await (const log of api.streamDeploymentLogs(deployment.id)) {
      try {
        const logData = JSON.parse(log);
        if (logData.step && logData.step !== lastStep) {
          lastStep = logData.step;
          const stepMessages: Record<string, string> = {
            clone: "Preparing source code...",
            analyze: "Analyzing project...",
            build: "Building container image...",
            deploy: "Deploying to cloud...",
          };
          const message = stepMessages[logData.step] || "Deploying...";
          startSpinner(message);
        }
        
        // Display the log line
        if (logData.line) {
          stopSpinner();
          const levelColor = logData.level === "error" ? chalk.red : 
                            logData.level === "warn" ? chalk.yellow : chalk.gray;
          const stepPrefix = logData.step ? chalk.cyan(`[${logData.step}]`) + " " : "";
          console.log(stepPrefix + levelColor(logData.line));
        }
      } catch {
        // Ignore non-JSON logs
      }
    }
  } catch (error) {
    // Stream ended or error occurred
    stopSpinner();
  }

  // Poll for final status with exponential backoff
  let checkCount = 0;
  const maxChecks = 60; // Max 60 checks
  let delay = 3000; // Start with 3 seconds
  const maxDelay = 10000; // Max 10 seconds between checks
  let lastDisplayedLogLength = 0;
  
  while (checkCount < maxChecks) {
    await new Promise(resolve => setTimeout(resolve, delay));
    
    const finalDeployment = await api.getDeployment(deployment.id);
    
    // Display new build logs if available
    if (finalDeployment.buildLogs && finalDeployment.buildLogs.length > lastDisplayedLogLength) {
      const newLogs = finalDeployment.buildLogs.substring(lastDisplayedLogLength);
      const logLines = newLogs.split('\n').filter(l => l.trim());
      
      for (const line of logLines) {
        try {
          const logData = JSON.parse(line);
          if (logData.line) {
            stopSpinner();
            const levelColor = logData.level === "error" ? chalk.red : 
                              logData.level === "warn" ? chalk.yellow : chalk.gray;
            const stepPrefix = logData.step ? chalk.cyan(`[${logData.step}]`) + " " : "";
            console.log(stepPrefix + levelColor(logData.line));
          }
        } catch {
          // Skip invalid JSON
        }
      }
      
      lastDisplayedLogLength = finalDeployment.buildLogs.length;
    }
    
    if (finalDeployment.status === "running") {
      const mcpUrl = `https://${finalDeployment.domain}/mcp`;
      const inspectorUrl = `https://inspector.mcp-use.com/inspect?autoConnect=${encodeURIComponent(mcpUrl)}`;
      
      console.log(chalk.green.bold("✓ Deployment successful!\n"));
      console.log(chalk.white("🌐 MCP Server URL:"));
      console.log(chalk.cyan.bold(`   ${mcpUrl}\n`));
      
      console.log(chalk.white("🔍 Inspector URL:"));
      console.log(chalk.cyan.bold(`   ${inspectorUrl}\n`));
      
      if (finalDeployment.customDomain) {
        const customMcpUrl = `https://${finalDeployment.customDomain}/mcp`;
        const customInspectorUrl = `https://inspector.mcp-use.com/inspect?autoConnect=${encodeURIComponent(customMcpUrl)}`;
        
        console.log(chalk.white("🔗 Custom Domain:"));
        console.log(chalk.cyan.bold(`   ${customMcpUrl}\n`));
        console.log(chalk.white("🔍 Custom Inspector:"));
        console.log(chalk.cyan.bold(`   ${customInspectorUrl}\n`));
      }
      
      console.log(chalk.gray("Deployment ID: ") + chalk.white(finalDeployment.id));
      return;
    } else if (finalDeployment.status === "failed") {
      console.log(chalk.red.bold("✗ Deployment failed\n"));
      if (finalDeployment.error) {
        console.log(chalk.red("Error: ") + finalDeployment.error);
      }
      if (finalDeployment.buildLogs) {
        console.log(chalk.gray("\nBuild logs:"));
        // Parse and display build logs nicely
        try {
          const logs = finalDeployment.buildLogs.split('\n').filter(l => l.trim());
          for (const log of logs) {
            try {
              const logData = JSON.parse(log);
              if (logData.line) {
                console.log(chalk.gray(`  ${logData.line}`));
              }
            } catch {
              console.log(chalk.gray(`  ${log}`));
            }
          }
        } catch {
          console.log(chalk.gray(finalDeployment.buildLogs));
        }
      }
      process.exit(1);
    } else if (finalDeployment.status === "building") {
      // Still building, wait and check again with exponential backoff
      startSpinner("Building and deploying...");
      checkCount++;
      // Exponential backoff: increase delay up to maxDelay
      delay = Math.min(delay * 1.2, maxDelay);
    } else {
      console.log(
        chalk.yellow("⚠️  Deployment status: ") + finalDeployment.status
      );
      return;
    }
  }
  
  // Timeout
  stopSpinner();
  console.log(chalk.yellow("⚠️  Deployment is taking longer than expected."));
  console.log(chalk.gray("Check status with: ") + chalk.white(`mcp-use status ${deployment.id}`));
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

    if (
      !options.fromSource &&
      gitInfo.isGitRepo &&
      gitInfo.remoteUrl &&
      isGitHubUrl(gitInfo.remoteUrl)
    ) {
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
      // Not a GitHub repo or --from-source flag - deploy from source upload
      if (options.fromSource) {
        console.log(
          chalk.white("📦 Deploying from local source code (--from-source)...")
        );
      } else {
        console.log(
          chalk.yellow(
            "⚠️  This is not a GitHub repository or no remote is configured."
          )
        );
        console.log(
          chalk.white("Deploying from local source code instead...")
        );
      }
      console.log();

      // Detect project settings
      const projectName = options.name || (await getProjectName(cwd));
      const runtime = options.runtime || (await detectRuntime(cwd));
      const port = options.port || 3000;
      const buildCommand = await detectBuildCommand(cwd);
      const startCommand = await detectStartCommand(cwd);

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

      // Confirm deployment
      const shouldDeploy = await prompt(
        chalk.white("Deploy from local source? (y/n): ")
      );

      if (!shouldDeploy) {
        console.log(chalk.gray("Deployment cancelled."));
        process.exit(0);
      }

      // Create tarball
      console.log();
      console.log(chalk.gray("Packaging source code..."));
      const tarballPath = await createTarball(cwd);
      const stats = await fs.stat(tarballPath);
      console.log(
        chalk.green("✓ Packaged: ") + chalk.gray(formatFileSize(stats.size))
      );

      // Upload source
      console.log(chalk.gray("Uploading source code..."));
      const api = await McpUseAPI.create();
      const uploadResponse = await api.uploadSource(tarballPath);
      console.log(
        chalk.green("✓ Uploaded: ") + chalk.gray(uploadResponse.uploadId)
      );

      // Clean up tarball
      await fs.unlink(tarballPath);

      // Create deployment request
      const deploymentRequest: CreateDeploymentRequest = {
        name: projectName,
        source: {
          type: "upload",
          uploadId: uploadResponse.uploadId,
          runtime,
          port,
          buildCommand,
          startCommand,
        },
        healthCheckPath: "/healthz",
      };

      // Create deployment
      console.log(chalk.gray("Creating deployment..."));
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

