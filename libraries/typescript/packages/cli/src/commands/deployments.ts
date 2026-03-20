import chalk from "chalk";
import { Command } from "commander";
import { McpUseAPI } from "../utils/api.js";
import { isLoggedIn } from "../utils/config.js";
import { formatRelativeTime } from "../utils/format.js";

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
      const trimmedAnswer = answer.trim().toLowerCase();
      resolve(trimmedAnswer === "y" || trimmedAnswer === "yes");
    });
  });
}

/**
 * Get status color based on deployment status
 */
function getStatusColor(status: string): (text: string) => string {
  switch (status) {
    case "running":
      return chalk.green;
    case "building":
    case "pending":
      return chalk.yellow;
    case "failed":
    case "stopped":
      return chalk.red;
    default:
      return chalk.gray;
  }
}

/**
 * Format deployment ID for display (show full ID)
 */
function formatId(id: string): string {
  return id;
}

/**
 * List deployments command
 */
async function listDeploymentsCommand(): Promise<void> {
  try {
    if (!(await isLoggedIn())) {
      console.log(chalk.red("✗ You are not logged in."));
      console.log(
        chalk.gray(
          "Run " + chalk.white("npx mcp-use login") + " to get started."
        )
      );
      process.exit(1);
    }

    const api = await McpUseAPI.create();
    const deployments = await api.listDeployments();

    // Sort deployments by created date (newest first)
    const sortedDeployments = [...deployments].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    if (sortedDeployments.length === 0) {
      console.log(chalk.yellow("No deployments found."));
      console.log(
        chalk.gray(
          "\nDeploy your first MCP server with " + chalk.white("mcp-use deploy")
        )
      );
      return;
    }

    console.log(
      chalk.cyan.bold(`\n📦 Deployments (${sortedDeployments.length})\n`)
    );

    // Print table header
    console.log(
      chalk.white.bold(
        `${"ID".padEnd(40)} ${"NAME".padEnd(25)} ${"STATUS".padEnd(12)} ${"DOMAIN".padEnd(35)} ${"CREATED"}`
      )
    );
    console.log(chalk.gray("─".repeat(130)));

    // Print each deployment
    for (const deployment of sortedDeployments) {
      const id = formatId(deployment.id).padEnd(40);
      const name = deployment.name.substring(0, 24).padEnd(25);
      const statusColor = getStatusColor(deployment.status);
      const status = statusColor(deployment.status.padEnd(12));
      const domain = (deployment.domain || "-").substring(0, 34).padEnd(35);
      const created = formatRelativeTime(deployment.createdAt);

      console.log(
        `${chalk.gray(id)} ${name} ${status} ${chalk.cyan(domain)} ${chalk.gray(created)}`
      );
    }

    console.log();
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Failed to list deployments:"),
      chalk.red(error instanceof Error ? error.message : "Unknown error")
    );
    process.exit(1);
  }
}

/**
 * Get deployment details command
 */
async function getDeploymentCommand(deploymentId: string): Promise<void> {
  try {
    if (!(await isLoggedIn())) {
      console.log(chalk.red("✗ You are not logged in."));
      console.log(
        chalk.gray(
          "Run " + chalk.white("npx mcp-use login") + " to get started."
        )
      );
      process.exit(1);
    }

    const api = await McpUseAPI.create();
    const deployment = await api.getDeployment(deploymentId);

    console.log(chalk.cyan.bold("\n📦 Deployment Details\n"));

    console.log(chalk.white("ID:            ") + chalk.gray(deployment.id));
    console.log(chalk.white("Name:          ") + chalk.cyan(deployment.name));

    const statusColor = getStatusColor(deployment.status);
    console.log(
      chalk.white("Status:        ") + statusColor(deployment.status)
    );

    if (deployment.domain) {
      console.log(
        chalk.white("Domain:        ") +
          chalk.cyan(`https://${deployment.domain}`)
      );
    }
    if (deployment.customDomain) {
      console.log(
        chalk.white("Custom Domain: ") +
          chalk.cyan(`https://${deployment.customDomain}`)
      );
    }

    console.log(
      chalk.white("Source:        ") + chalk.gray(deployment.source.type)
    );

    if (deployment.source.type === "github") {
      console.log(
        chalk.white("Repository:    ") + chalk.gray(deployment.source.repo)
      );
      console.log(
        chalk.white("Branch:        ") +
          chalk.gray(deployment.source.branch || "main")
      );
    }

    console.log(chalk.white("Port:          ") + chalk.gray(deployment.port));
    console.log(
      chalk.white("Runtime:       ") +
        chalk.gray(deployment.source.runtime || "node")
    );

    if (deployment.provider) {
      console.log(
        chalk.white("Provider:      ") + chalk.gray(deployment.provider)
      );
    }

    console.log(
      chalk.white("Created:       ") +
        chalk.gray(formatRelativeTime(deployment.createdAt))
    );
    console.log(
      chalk.white("Updated:       ") +
        chalk.gray(formatRelativeTime(deployment.updatedAt))
    );

    // Show environment variables if any
    if (
      deployment.source.env &&
      Object.keys(deployment.source.env).length > 0
    ) {
      console.log(chalk.white("\nEnvironment Variables:"));
      for (const [key, value] of Object.entries(deployment.source.env)) {
        // Mask sensitive values
        const displayValue =
          key.toLowerCase().includes("key") ||
          key.toLowerCase().includes("secret") ||
          key.toLowerCase().includes("password") ||
          key.toLowerCase().includes("token")
            ? "***"
            : value;
        console.log(chalk.gray(`  ${key}=`) + chalk.white(displayValue));
      }
    }

    // Show error if failed
    if (deployment.status === "failed" && deployment.error) {
      console.log(chalk.red("\nError:"));
      console.log(chalk.red(`  ${deployment.error}`));
    }

    console.log();
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Failed to get deployment:"),
      chalk.red(error instanceof Error ? error.message : "Unknown error")
    );
    process.exit(1);
  }
}

/**
 * Restart deployment command
 */
async function restartDeploymentCommand(
  deploymentId: string,
  options: { follow?: boolean }
): Promise<void> {
  try {
    if (!(await isLoggedIn())) {
      console.log(chalk.red("✗ You are not logged in."));
      console.log(
        chalk.gray(
          "Run " + chalk.white("npx mcp-use login") + " to get started."
        )
      );
      process.exit(1);
    }

    const api = await McpUseAPI.create();

    // Get deployment info first
    const deployment = await api.getDeployment(deploymentId);
    console.log(
      chalk.cyan.bold(`\n🔄 Restarting deployment: ${deployment.name}\n`)
    );

    const redeployedDeployment = await api.redeployDeployment(deploymentId);
    console.log(
      chalk.green("✓ Restart initiated: ") + chalk.gray(redeployedDeployment.id)
    );

    if (options.follow) {
      console.log(chalk.gray("\nFollowing deployment logs...\n"));

      // Stream logs
      try {
        for await (const log of api.streamDeploymentLogs(
          redeployedDeployment.id
        )) {
          try {
            const logData = JSON.parse(log);
            if (logData.line) {
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
            // Not JSON, print as-is
            console.log(chalk.gray(log));
          }
        }
      } catch (error) {
        // Stream ended or error
        console.log(
          chalk.gray(
            "\nLog stream ended. Use " +
              chalk.white(`mcp-use deployments get ${deploymentId}`) +
              " to check status."
          )
        );
      }
    } else {
      console.log(
        chalk.gray(
          "\nCheck status with: " +
            chalk.white(`mcp-use deployments get ${deploymentId}`)
        )
      );
    }

    console.log();
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Failed to restart deployment:"),
      chalk.red(error instanceof Error ? error.message : "Unknown error")
    );
    process.exit(1);
  }
}

/**
 * Delete deployment command
 */
async function deleteDeploymentCommand(
  deploymentId: string,
  options: { yes?: boolean }
): Promise<void> {
  try {
    if (!(await isLoggedIn())) {
      console.log(chalk.red("✗ You are not logged in."));
      console.log(
        chalk.gray(
          "Run " + chalk.white("npx mcp-use login") + " to get started."
        )
      );
      process.exit(1);
    }

    const api = await McpUseAPI.create();

    // Get deployment info first
    const deployment = await api.getDeployment(deploymentId);

    // Confirm deletion unless --yes flag is provided
    if (!options.yes) {
      console.log(
        chalk.yellow(
          `\n⚠️  You are about to delete deployment: ${chalk.white(deployment.name)}`
        )
      );
      console.log(chalk.gray(`   ID: ${deployment.id}`));
      console.log(chalk.gray(`   Domain: ${deployment.domain || "none"}\n`));

      const confirmed = await prompt(
        chalk.white("Are you sure you want to delete this deployment? (y/N): ")
      );

      if (!confirmed) {
        console.log(chalk.gray("Deletion cancelled."));
        return;
      }
    }

    await api.deleteDeployment(deploymentId);
    console.log(
      chalk.green.bold(`\n✓ Deployment deleted: ${deployment.name}\n`)
    );
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Failed to delete deployment:"),
      chalk.red(error instanceof Error ? error.message : "Unknown error")
    );
    process.exit(1);
  }
}

/**
 * Get deployment logs command
 */
async function logsCommand(
  deploymentId: string,
  options: { build?: boolean; follow?: boolean }
): Promise<void> {
  try {
    if (!(await isLoggedIn())) {
      console.log(chalk.red("✗ You are not logged in."));
      console.log(
        chalk.gray(
          "Run " + chalk.white("npx mcp-use login") + " to get started."
        )
      );
      process.exit(1);
    }

    const api = await McpUseAPI.create();

    if (options.follow) {
      console.log(chalk.gray("Streaming logs...\n"));

      // Stream logs in real-time
      try {
        for await (const log of api.streamDeploymentLogs(deploymentId)) {
          try {
            const logData = JSON.parse(log);
            if (logData.line) {
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
            // Not JSON, print as-is
            console.log(chalk.gray(log));
          }
        }
      } catch (error) {
        console.log(chalk.gray("\nLog stream ended."));
      }
    } else {
      // Get static logs
      const logs = options.build
        ? await api.getDeploymentBuildLogs(deploymentId)
        : await api.getDeploymentLogs(deploymentId);

      if (!logs || logs.trim() === "") {
        console.log(
          chalk.yellow(
            `No ${options.build ? "build " : ""}logs available for this deployment.`
          )
        );
        return;
      }

      // Parse and display logs
      const logLines = logs.split("\n").filter((l) => l.trim());
      for (const line of logLines) {
        try {
          const logData = JSON.parse(line);
          if (logData.line) {
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
          // Not JSON, print as-is
          console.log(chalk.gray(line));
        }
      }
    }

    console.log();
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Failed to get logs:"),
      chalk.red(error instanceof Error ? error.message : "Unknown error")
    );
    process.exit(1);
  }
}

/**
 * List environment variables command
 */
async function listEnvCommand(deploymentId: string): Promise<void> {
  try {
    if (!(await isLoggedIn())) {
      console.log(chalk.red("✗ You are not logged in."));
      console.log(
        chalk.gray(
          "Run " + chalk.white("npx mcp-use login") + " to get started."
        )
      );
      process.exit(1);
    }

    const api = await McpUseAPI.create();
    const deployment = await api.getDeployment(deploymentId);

    console.log(
      chalk.cyan.bold(`\n🔐 Environment Variables: ${deployment.name}\n`)
    );

    if (
      !deployment.source.env ||
      Object.keys(deployment.source.env).length === 0
    ) {
      console.log(chalk.yellow("No environment variables set."));
      console.log();
      return;
    }

    for (const [key, value] of Object.entries(deployment.source.env)) {
      // Mask sensitive values
      const displayValue =
        key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("password") ||
        key.toLowerCase().includes("token")
          ? "***"
          : value;
      console.log(
        chalk.white(key) + chalk.gray("=") + chalk.cyan(displayValue)
      );
    }

    console.log();
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Failed to list environment variables:"),
      chalk.red(error instanceof Error ? error.message : "Unknown error")
    );
    process.exit(1);
  }
}

/**
 * Set environment variables command
 */
async function setEnvCommand(
  deploymentId: string,
  envPairs: string[]
): Promise<void> {
  try {
    if (!(await isLoggedIn())) {
      console.log(chalk.red("✗ You are not logged in."));
      console.log(
        chalk.gray(
          "Run " + chalk.white("npx mcp-use login") + " to get started."
        )
      );
      process.exit(1);
    }

    // Parse KEY=VALUE pairs
    const env: Record<string, string> = {};
    for (const pair of envPairs) {
      const [key, ...valueParts] = pair.split("=");
      if (!key || valueParts.length === 0) {
        console.log(chalk.red(`✗ Invalid format: ${pair}. Expected KEY=VALUE`));
        process.exit(1);
      }
      env[key.trim()] = valueParts.join("=").trim();
    }

    const api = await McpUseAPI.create();

    // Get current deployment to merge env vars
    const deployment = await api.getDeployment(deploymentId);
    const currentEnv = deployment.source.env || {};
    const mergedEnv = { ...currentEnv, ...env };

    const updated = await api.updateDeployment(deploymentId, {
      env: mergedEnv,
    });

    console.log(
      chalk.green.bold(`\n✓ Environment variables updated: ${updated.name}\n`)
    );

    // Show updated values
    for (const key of Object.keys(env)) {
      const displayValue =
        key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("password") ||
        key.toLowerCase().includes("token")
          ? "***"
          : env[key];
      console.log(
        chalk.white(key) + chalk.gray("=") + chalk.cyan(displayValue)
      );
    }

    console.log();
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Failed to set environment variables:"),
      chalk.red(error instanceof Error ? error.message : "Unknown error")
    );
    process.exit(1);
  }
}

/**
 * Unset environment variables command
 */
async function unsetEnvCommand(
  deploymentId: string,
  keys: string[]
): Promise<void> {
  try {
    if (!(await isLoggedIn())) {
      console.log(chalk.red("✗ You are not logged in."));
      console.log(
        chalk.gray(
          "Run " + chalk.white("npx mcp-use login") + " to get started."
        )
      );
      process.exit(1);
    }

    const api = await McpUseAPI.create();

    // Get current deployment
    const deployment = await api.getDeployment(deploymentId);
    const currentEnv = { ...(deployment.source.env || {}) };

    // Remove specified keys
    for (const key of keys) {
      delete currentEnv[key];
    }

    const updated = await api.updateDeployment(deploymentId, {
      env: currentEnv,
    });

    console.log(
      chalk.green.bold(`\n✓ Environment variables removed: ${updated.name}\n`)
    );

    for (const key of keys) {
      console.log(chalk.gray(`  ${key}`));
    }

    console.log();
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Failed to unset environment variables:"),
      chalk.red(error instanceof Error ? error.message : "Unknown error")
    );
    process.exit(1);
  }
}

/**
 * Stop deployment command
 */
async function stopDeploymentCommand(deploymentId: string): Promise<void> {
  try {
    if (!(await isLoggedIn())) {
      console.log(chalk.red("✗ You are not logged in."));
      console.log(
        chalk.gray(
          "Run " + chalk.white("npx mcp-use login") + " to get started."
        )
      );
      process.exit(1);
    }

    const api = await McpUseAPI.create();
    const updated = await api.updateDeployment(deploymentId, {
      status: "stopped",
    });

    console.log(chalk.green.bold(`\n✓ Deployment stopped: ${updated.name}\n`));
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Failed to stop deployment:"),
      chalk.red(error instanceof Error ? error.message : "Unknown error")
    );
    process.exit(1);
  }
}

/**
 * Start deployment command
 */
async function startDeploymentCommand(deploymentId: string): Promise<void> {
  try {
    if (!(await isLoggedIn())) {
      console.log(chalk.red("✗ You are not logged in."));
      console.log(
        chalk.gray(
          "Run " + chalk.white("npx mcp-use login") + " to get started."
        )
      );
      process.exit(1);
    }

    const api = await McpUseAPI.create();
    const updated = await api.updateDeployment(deploymentId, {
      status: "running",
    });

    console.log(chalk.green.bold(`\n✓ Deployment started: ${updated.name}\n`));
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Failed to start deployment:"),
      chalk.red(error instanceof Error ? error.message : "Unknown error")
    );
    process.exit(1);
  }
}

/**
 * Create deployments command group
 */
export function createDeploymentsCommand(): Command {
  const deploymentsCommand = new Command("deployments").description(
    "Manage cloud deployments"
  );

  // List deployments
  deploymentsCommand
    .command("list")
    .alias("ls")
    .description("List all deployments")
    .action(listDeploymentsCommand);

  // Get deployment
  deploymentsCommand
    .command("get")
    .argument("<deployment-id>", "Deployment ID")
    .description("Get deployment details")
    .action(getDeploymentCommand);

  // Restart deployment
  deploymentsCommand
    .command("restart")
    .argument("<deployment-id>", "Deployment ID")
    .option("-f, --follow", "Follow deployment logs")
    .description("Restart a deployment")
    .action(restartDeploymentCommand);

  // Delete deployment
  deploymentsCommand
    .command("delete")
    .alias("rm")
    .argument("<deployment-id>", "Deployment ID")
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Delete a deployment")
    .action(deleteDeploymentCommand);

  // Logs command
  deploymentsCommand
    .command("logs")
    .argument("<deployment-id>", "Deployment ID")
    .option("-b, --build", "Show build logs instead of runtime logs")
    .option("-f, --follow", "Stream logs in real-time")
    .description("View deployment logs")
    .action(logsCommand);

  // Environment variables commands
  const envCommand = deploymentsCommand
    .command("env")
    .description("Manage environment variables");

  envCommand
    .command("list")
    .argument("<deployment-id>", "Deployment ID")
    .description("List environment variables")
    .action(listEnvCommand);

  envCommand
    .command("set")
    .argument("<deployment-id>", "Deployment ID")
    .argument("<pairs...>", "Environment variables in KEY=VALUE format")
    .description("Set environment variables")
    .action(setEnvCommand);

  envCommand
    .command("unset")
    .argument("<deployment-id>", "Deployment ID")
    .argument("<keys...>", "Environment variable keys to remove")
    .description("Unset environment variables")
    .action(unsetEnvCommand);

  // Stop deployment
  deploymentsCommand
    .command("stop")
    .argument("<deployment-id>", "Deployment ID")
    .description("Stop a deployment")
    .action(stopDeploymentCommand);

  // Start deployment
  deploymentsCommand
    .command("start")
    .argument("<deployment-id>", "Deployment ID")
    .description("Start a stopped deployment")
    .action(startDeploymentCommand);

  return deploymentsCommand;
}
