import chalk from "chalk";
import { Command } from "commander";
import { McpUseAPI } from "../utils/api.js";
import { getMcpServerUrl } from "../utils/cloud-urls.js";
import { isLoggedIn } from "../utils/config.js";
import { handleCommandError } from "../utils/errors.js";
import { formatRelativeTime } from "../utils/format.js";

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

function formatId(id: string): string {
  return id;
}

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
    const [deployments, authResult] = await Promise.all([
      api.listDeployments(),
      api.testAuth(),
    ]);

    const orgMap = new Map(authResult.orgs.map((o) => [o.id, o.name]));

    const uniqueServerIds = [
      ...new Set(
        deployments
          .map((d) => d.serverId)
          .filter((id): id is string => id != null)
      ),
    ];

    const serverResults = await Promise.allSettled(
      uniqueServerIds.map((id) => api.getServer(id))
    );

    const serverOrgMap = new Map<string, string>();
    for (let i = 0; i < uniqueServerIds.length; i++) {
      const result = serverResults[i];
      if (result.status === "fulfilled") {
        const orgName =
          orgMap.get(result.value.organizationId) ??
          result.value.organizationId.substring(0, 19);
        serverOrgMap.set(uniqueServerIds[i], orgName);
      }
    }

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

    console.log(
      chalk.white.bold(
        `${"ID".padEnd(40)} ${"NAME".padEnd(25)} ${"ORG".padEnd(20)} ${"STATUS".padEnd(12)} ${"MCP URL".padEnd(45)} ${"CREATED"}`
      )
    );
    console.log(chalk.gray("─".repeat(155)));

    for (const deployment of sortedDeployments) {
      const id = formatId(deployment.id).padEnd(40);
      const name = deployment.name.substring(0, 24).padEnd(25);
      const orgName = deployment.serverId
        ? (serverOrgMap.get(deployment.serverId) ?? "-")
        : "-";
      const org = orgName.substring(0, 19).padEnd(20);
      const statusColor = getStatusColor(deployment.status);
      const status = statusColor(deployment.status.padEnd(12));
      const mcpUrl = (deployment.mcpUrl || "-").substring(0, 44).padEnd(45);
      const created = formatRelativeTime(deployment.createdAt);

      console.log(
        `${chalk.gray(id)} ${name} ${chalk.magenta(org)} ${status} ${chalk.cyan(mcpUrl)} ${chalk.gray(created)}`
      );
    }

    console.log();
  } catch (error) {
    handleCommandError(error, "Failed to list deployments");
  }
}

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

    if (deployment.serverId) {
      console.log(
        chalk.white("Server ID:     ") + chalk.gray(deployment.serverId)
      );
    }

    const mcpUrl = getMcpServerUrl(deployment);
    if (mcpUrl) {
      console.log(chalk.white("MCP URL:       ") + chalk.cyan(mcpUrl));
    }

    if (deployment.gitBranch) {
      console.log(
        chalk.white("Branch:        ") + chalk.gray(deployment.gitBranch)
      );
    }
    if (deployment.gitCommitSha) {
      console.log(
        chalk.white("Commit:        ") +
          chalk.gray(deployment.gitCommitSha.substring(0, 7))
      );
    }

    if (deployment.port) {
      console.log(chalk.white("Port:          ") + chalk.gray(deployment.port));
    }

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

    if (deployment.status === "failed" && deployment.error) {
      console.log(chalk.red("\nError:"));
      console.log(chalk.red(`  ${deployment.error}`));
    }

    console.log();
  } catch (error) {
    handleCommandError(error, "Failed to get deployment");
  }
}

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
    const deployment = await api.getDeployment(deploymentId);

    if (!deployment.serverId) {
      console.log(
        chalk.red("✗ Cannot restart: deployment has no linked server.")
      );
      process.exit(1);
    }

    console.log(
      chalk.cyan.bold(`\n🔄 Restarting deployment: ${deployment.name}\n`)
    );

    const newDep = await api.createDeployment({
      serverId: deployment.serverId,
      trigger: "redeploy",
    });

    console.log(chalk.green("✓ Restart initiated: ") + chalk.gray(newDep.id));

    if (options.follow) {
      console.log(chalk.gray("\nFollowing build logs...\n"));

      let offset = 0;
      let terminal = false;
      while (!terminal) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const resp = await api.getDeploymentBuildLogs(newDep.id, offset);
          if (resp.logs.length > 0) {
            const lines = resp.logs.split("\n").filter((l) => l.trim());
            for (const line of lines) {
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
                console.log(chalk.gray(line));
              }
            }
            offset = resp.offset;
          }
          if (
            resp.status === "running" ||
            resp.status === "failed" ||
            resp.status === "stopped"
          ) {
            terminal = true;
          }
        } catch {
          // Build logs not ready yet
        }
      }
    } else {
      console.log(
        chalk.gray(
          "\nCheck status with: " +
            chalk.white(`mcp-use deployments get ${newDep.id}`)
        )
      );
    }

    console.log();
  } catch (error) {
    handleCommandError(error, "Failed to restart deployment");
  }
}

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
    const deployment = await api.getDeployment(deploymentId);

    if (!options.yes) {
      console.log(
        chalk.yellow(
          `\n⚠️  You are about to delete deployment: ${chalk.white(deployment.name)}`
        )
      );
      console.log(chalk.gray(`   ID: ${deployment.id}`));
      if (deployment.mcpUrl) {
        console.log(chalk.gray(`   URL: ${deployment.mcpUrl}\n`));
      }

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
    handleCommandError(error, "Failed to delete deployment");
  }
}

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
      console.log(chalk.gray("Following build logs...\n"));

      let offset = 0;
      let terminal = false;
      while (!terminal) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const resp = await api.getDeploymentBuildLogs(deploymentId, offset);
          if (resp.logs.length > 0) {
            const lines = resp.logs.split("\n").filter((l) => l.trim());
            for (const line of lines) {
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
                console.log(chalk.gray(line));
              }
            }
            offset = resp.offset;
          }
          if (
            resp.status === "running" ||
            resp.status === "failed" ||
            resp.status === "stopped"
          ) {
            terminal = true;
          }
        } catch {
          // Build logs not ready yet
        }
      }
    } else if (options.build) {
      const resp = await api.getDeploymentBuildLogs(deploymentId);
      const logs = resp.logs;

      if (!logs || logs.trim() === "") {
        console.log(
          chalk.yellow("No build logs available for this deployment.")
        );
        return;
      }

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
          console.log(chalk.gray(line));
        }
      }
    } else {
      const logs = await api.getDeploymentLogs(deploymentId);

      if (!logs || logs.trim() === "") {
        console.log(chalk.yellow("No logs available for this deployment."));
        return;
      }

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
          console.log(chalk.gray(line));
        }
      }
    }

    console.log();
  } catch (error) {
    handleCommandError(error, "Failed to get logs");
  }
}

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
    await api.stopDeployment(deploymentId);

    console.log(chalk.green.bold(`\n✓ Deployment stopped\n`));
  } catch (error) {
    handleCommandError(error, "Failed to stop deployment");
  }
}

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

    console.log(
      chalk.yellow(
        "⚠️  Start is not supported in this version. Use `mcp-use deployments restart` to redeploy."
      )
    );
  } catch (error) {
    handleCommandError(error, "Failed to start deployment");
  }
}

export function createDeploymentsCommand(): Command {
  const deploymentsCommand = new Command("deployments").description(
    "Manage cloud deployments"
  );

  deploymentsCommand
    .command("list")
    .alias("ls")
    .description("List all deployments")
    .action(listDeploymentsCommand);

  deploymentsCommand
    .command("get")
    .argument("<deployment-id>", "Deployment ID")
    .description("Get deployment details")
    .action(getDeploymentCommand);

  deploymentsCommand
    .command("restart")
    .argument("<deployment-id>", "Deployment ID")
    .option("-f, --follow", "Follow build logs")
    .description(
      "Restart a deployment (triggers a new deployment on the same server)"
    )
    .action(restartDeploymentCommand);

  deploymentsCommand
    .command("delete")
    .alias("rm")
    .argument("<deployment-id>", "Deployment ID")
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Delete a deployment")
    .action(deleteDeploymentCommand);

  deploymentsCommand
    .command("logs")
    .argument("<deployment-id>", "Deployment ID")
    .option("-b, --build", "Show build logs instead of runtime logs")
    .option("-f, --follow", "Follow build logs in real-time")
    .description("View deployment logs")
    .action(logsCommand);

  deploymentsCommand
    .command("stop")
    .argument("<deployment-id>", "Deployment ID")
    .description("Stop a deployment")
    .action(stopDeploymentCommand);

  deploymentsCommand
    .command("start")
    .argument("<deployment-id>", "Deployment ID")
    .description("Start a stopped deployment")
    .action(startDeploymentCommand);

  return deploymentsCommand;
}
