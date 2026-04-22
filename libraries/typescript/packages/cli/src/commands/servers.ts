import chalk from "chalk";
import { Command } from "commander";
import { McpUseAPI } from "../utils/api.js";
import { getMcpServerUrlForCloudServer } from "../utils/cloud-urls.js";
import { getWebUrl, isLoggedIn, readConfig } from "../utils/config.js";
import { handleCommandError } from "../utils/errors.js";
import { formatRelativeTime } from "../utils/format.js";
import { resolveOrgFromOption } from "./auth.js";
import { createEnvCommand } from "./env.js";

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function pickStr(obj: unknown, key: string): string {
  if (!isRecord(obj)) return "-";
  const v = obj[key];
  if (typeof v === "string") return v;
  if (v != null && typeof v !== "object") return String(v);
  return "-";
}

async function applyOrgOption(api: McpUseAPI, org?: string): Promise<void> {
  if (!org) return;
  const authInfo = await api.testAuth();
  const match = resolveOrgFromOption(authInfo.orgs ?? [], org);
  if (!match) {
    console.error(
      chalk.red(
        `✗ Organization "${org}" not found. Run ${chalk.white("npx mcp-use org list")} to see available organizations.`
      )
    );
    process.exit(1);
  }
  api.setOrgId(match.id);
  const slug = match.slug ? chalk.gray(` (${match.slug})`) : "";
  console.log(chalk.gray("Organization: ") + chalk.cyan(match.name) + slug);
}

function getStatusColor(status: string): (text: string) => string {
  const s = status.toLowerCase();
  if (s.includes("run") || s === "active") return chalk.green;
  if (s.includes("fail") || s.includes("error")) return chalk.red;
  if (s.includes("build") || s.includes("pend")) return chalk.yellow;
  return chalk.gray;
}

async function listServersCommand(options: {
  org?: string;
  limit?: string;
  skip?: string;
  sort?: string;
}): Promise<void> {
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
    await applyOrgOption(api, options.org);
    if (options.org) console.log();

    const limit = options.limit ? parseInt(options.limit, 10) : undefined;
    const skip = options.skip ? parseInt(options.skip, 10) : undefined;
    if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
      console.log(chalk.red("✗ Invalid --limit"));
      process.exit(1);
    }
    if (skip !== undefined && (Number.isNaN(skip) || skip < 0)) {
      console.log(chalk.red("✗ Invalid --skip"));
      process.exit(1);
    }

    const servers = await api.listServers({
      limit,
      skip,
      sort: options.sort,
    });

    if (servers.length === 0) {
      console.log(chalk.yellow("No servers found."));
      console.log(
        chalk.gray(
          "\nCreate one by deploying with " + chalk.white("mcp-use deploy")
        )
      );
      return;
    }

    console.log(chalk.cyan.bold(`\n🖥  Servers (${servers.length})\n`));

    console.log(
      chalk.white.bold(
        `${"ID".padEnd(38)} ${"NAME".padEnd(22)} ${"STATUS".padEnd(14)} ${"REPO".padEnd(32)} ${"MCP URL".padEnd(52)}`
      )
    );
    console.log(chalk.gray("─".repeat(165)));

    for (const s of servers) {
      const id = s.id.substring(0, 37).padEnd(38);
      const name = (s.name || s.slug || "-").substring(0, 21).padEnd(22);
      const statusColor = getStatusColor(s.status);
      const status = statusColor(s.status.substring(0, 13).padEnd(14));
      const repo = (s.connectedRepository?.repoFullName ?? "-")
        .substring(0, 31)
        .padEnd(32);
      const mcp = getMcpServerUrlForCloudServer(s).substring(0, 51).padEnd(52);
      console.log(
        `${chalk.gray(id)} ${name} ${status} ${chalk.gray(repo)} ${chalk.cyan(mcp)}`
      );
    }

    console.log();
  } catch (error) {
    handleCommandError(error, "Failed to list servers");
  }
}

async function getServerCommand(idOrSlug: string, options: { org?: string }) {
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
    await applyOrgOption(api, options.org);
    if (options.org) console.log();

    const server = await api.getServer(idOrSlug);

    console.log(chalk.cyan.bold("\n🖥  Server Details\n"));

    console.log(chalk.white("ID:            ") + chalk.gray(server.id));
    if (server.slug) {
      console.log(chalk.white("Slug:          ") + chalk.cyan(server.slug));
    }
    console.log(
      chalk.white("Name:          ") + chalk.cyan(server.name ?? "-")
    );
    const statusColor = getStatusColor(server.status);
    console.log(chalk.white("Status:        ") + statusColor(server.status));
    if (server.latestDeploymentStatus) {
      console.log(
        chalk.white("Last deploy:   ") +
          chalk.gray(server.latestDeploymentStatus)
      );
    }
    console.log(chalk.white("Region:        ") + chalk.gray(server.region));
    console.log(
      chalk.white("MCP URL:       ") +
        chalk.cyan(getMcpServerUrlForCloudServer(server))
    );

    if (server.connectedRepository) {
      const cr = server.connectedRepository;
      console.log(chalk.white("\nRepository"));
      console.log(chalk.white("  Full name:   ") + chalk.gray(cr.repoFullName));
      console.log(
        chalk.white("  Prod branch: ") + chalk.gray(cr.productionBranch)
      );
    }

    if (server.activeDeploymentId) {
      console.log(
        chalk.white("\nActive deployment: ") +
          chalk.cyan(server.activeDeploymentId)
      );
    }
    if (server.previousDeploymentId) {
      console.log(
        chalk.white("Previous deployment: ") +
          chalk.gray(server.previousDeploymentId)
      );
    }

    const depCount = server._count?.deployments;
    if (depCount != null) {
      console.log(
        chalk.white("Deployment count: ") + chalk.gray(String(depCount))
      );
    }

    console.log(
      chalk.white("Created:       ") +
        chalk.gray(formatRelativeTime(server.createdAt))
    );
    console.log(
      chalk.white("Updated:       ") +
        chalk.gray(formatRelativeTime(server.updatedAt))
    );

    const config = await readConfig();
    const base = (await getWebUrl()).replace(/\/$/, "");
    if (config.orgSlug) {
      console.log(
        chalk.white("\nDashboard:     ") +
          chalk.cyan(`${base}/cloud/${config.orgSlug}/servers/${server.id}`)
      );
    } else {
      console.log(
        chalk.white("\nDashboard:     ") +
          chalk.cyan(`${base}/cloud/servers/${server.id}`)
      );
    }

    if (Array.isArray(server.deployments) && server.deployments.length > 0) {
      console.log(chalk.cyan.bold("\nRecent deployments\n"));
      console.log(
        chalk.white.bold(
          `${"ID".padEnd(40)} ${"NAME".padEnd(24)} ${"STATUS".padEnd(12)} ${"UPDATED"}`
        )
      );
      console.log(chalk.gray("─".repeat(100)));
      for (const d of server.deployments) {
        const did = pickStr(d, "id").padEnd(40);
        const dname = pickStr(d, "name").substring(0, 23).padEnd(24);
        const dst = pickStr(d, "status").padEnd(12);
        const du = pickStr(d, "updatedAt");
        const updated = du !== "-" ? formatRelativeTime(du) : chalk.gray("-");
        const sc = getStatusColor(dst.trim());
        console.log(
          `${chalk.gray(did)} ${dname} ${sc(dst)} ${chalk.gray(updated)}`
        );
      }
    }

    console.log();
  } catch (error) {
    handleCommandError(error, "Failed to get server");
  }
}

async function deleteServerCommand(
  serverId: string,
  options: { yes?: boolean; org?: string }
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
    await applyOrgOption(api, options.org);
    if (options.org) console.log();

    const server = await api.getServer(serverId);

    if (!options.yes) {
      console.log(
        chalk.yellow(
          `\n⚠️  You are about to delete server: ${chalk.white(server.name || server.slug || server.id)}`
        )
      );
      console.log(chalk.gray(`   ID: ${server.id}`));
      if (server.connectedRepository?.repoFullName) {
        console.log(
          chalk.gray(`   Repo: ${server.connectedRepository.repoFullName}\n`)
        );
      } else {
        console.log();
      }

      const confirmed = await prompt(
        chalk.white(
          "This deletes the server and all its deployments. Continue? (y/N): "
        )
      );

      if (!confirmed) {
        console.log(chalk.gray("Deletion cancelled."));
        return;
      }
    }

    await api.deleteServer(server.id);
    console.log(
      chalk.green.bold(
        `\n✓ Server deleted: ${server.name || server.slug || server.id}\n`
      )
    );
  } catch (error) {
    handleCommandError(error, "Failed to delete server");
  }
}

export function createServersCommand(): Command {
  const serversCommand = new Command("servers").description(
    "Manage cloud servers (Git-backed deploy targets)"
  );

  serversCommand
    .command("list")
    .alias("ls")
    .description("List servers for the current organization")
    .option("--org <slug-or-id>", "Target organization (slug, id, or name)")
    .option("--limit <n>", "Page size (1–100, default 50)")
    .option("--skip <n>", "Offset for pagination")
    .option("--sort <field:asc|desc>", "Sort (e.g. updatedAt:desc)")
    .action(listServersCommand);

  serversCommand
    .command("get")
    .argument("<id-or-slug>", "Server UUID or slug")
    .option("--org <slug-or-id>", "Resolve org context before fetch")
    .description("Show server details and recent deployments")
    .action(getServerCommand);

  serversCommand
    .command("delete")
    .alias("rm")
    .argument("<server-id>", "Server UUID (or slug if API accepts it)")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--org <slug-or-id>", "Target organization")
    .description("Delete a server and all its deployments")
    .action(deleteServerCommand);

  serversCommand.addCommand(createEnvCommand());

  return serversCommand;
}
