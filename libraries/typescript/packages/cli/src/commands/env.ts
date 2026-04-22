import chalk from "chalk";
import { Command } from "commander";
import type { EnvEnvironment, EnvVariable } from "../utils/api.js";
import { McpUseAPI } from "../utils/api.js";
import { isLoggedIn } from "../utils/config.js";
import { handleCommandError } from "../utils/errors.js";

const ALL_ENVS: EnvEnvironment[] = ["production", "preview", "development"];

function parseEnvironments(raw: string): EnvEnvironment[] {
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const valid: EnvEnvironment[] = [];
  for (const p of parts) {
    if (p === "production" || p === "preview" || p === "development") {
      valid.push(p);
    } else {
      console.error(
        chalk.red(
          `✗ Unknown environment "${p}". Valid values: production, preview, development`
        )
      );
      process.exit(1);
    }
  }

  if (valid.length === 0) {
    console.error(chalk.red("✗ At least one environment must be specified."));
    process.exit(1);
  }

  return valid;
}

function envBadge(env: EnvEnvironment): string {
  if (env === "production") return chalk.green("prod");
  if (env === "preview") return chalk.yellow("prev");
  return chalk.blue("dev");
}

function printEnvVar(v: EnvVariable, showValue = false): void {
  const envs = v.environments.map(envBadge).join(" ");
  const val = v.sensitive
    ? chalk.gray("<sensitive>")
    : showValue
      ? chalk.cyan(v.value)
      : chalk.gray("(hidden — use --show-values to reveal)");
  console.log(`  ${chalk.white.bold(v.key.padEnd(32))} ${val}`);
  console.log(
    `    ${chalk.gray("id:")} ${chalk.gray(v.id)}  ${envs}${v.sensitive ? "  " + chalk.yellow("🔒 sensitive") : ""}`
  );
}

async function requireLogin(): Promise<void> {
  if (!(await isLoggedIn())) {
    console.log(chalk.red("✗ You are not logged in."));
    console.log(
      chalk.gray("Run " + chalk.white("npx mcp-use login") + " to get started.")
    );
    process.exit(1);
  }
}

async function listEnvCommand(options: {
  server: string;
  showValues?: boolean;
}): Promise<void> {
  try {
    await requireLogin();

    const api = await McpUseAPI.create();
    const vars = await api.listEnvVariables(options.server);

    if (vars.length === 0) {
      console.log(
        chalk.yellow("\nNo environment variables set for this server.\n")
      );
      return;
    }

    console.log(chalk.cyan.bold(`\nEnvironment Variables (${vars.length})\n`));
    for (const v of vars) {
      printEnvVar(v, options.showValues);
      console.log();
    }
  } catch (error) {
    handleCommandError(error, "Failed to list environment variables");
  }
}

async function addEnvCommand(
  assignment: string,
  options: { server: string; env?: string; sensitive?: boolean }
): Promise<void> {
  try {
    await requireLogin();

    const eqIdx = assignment.indexOf("=");
    if (eqIdx === -1) {
      console.error(
        chalk.red(
          "✗ Expected KEY=VALUE format, e.g. mcp-use servers env add API_KEY=abc123"
        )
      );
      process.exit(1);
    }

    const key = assignment.substring(0, eqIdx).trim();
    const value = assignment.substring(eqIdx + 1);

    if (!key) {
      console.error(chalk.red("✗ Key must not be empty."));
      process.exit(1);
    }

    const environments = options.env
      ? parseEnvironments(options.env)
      : ALL_ENVS;

    const api = await McpUseAPI.create();
    const created = await api.createEnvVariable(options.server, {
      key,
      value,
      environments,
      sensitive: options.sensitive ?? false,
    });

    console.log(
      chalk.green(`\n✓ Environment variable "${created.key}" added.\n`)
    );
    printEnvVar(created, true);
    console.log();
  } catch (error) {
    handleCommandError(error, "Failed to add environment variable");
  }
}

async function updateEnvCommand(
  varId: string,
  options: { server: string; value?: string; env?: string; sensitive?: boolean }
): Promise<void> {
  try {
    await requireLogin();

    if (!options.value && !options.env && options.sensitive === undefined) {
      console.error(
        chalk.red(
          "✗ Nothing to update. Provide at least one of --value, --env, --sensitive."
        )
      );
      process.exit(1);
    }

    const body: {
      value?: string;
      environments?: EnvEnvironment[];
      sensitive?: boolean;
    } = {};
    if (options.value !== undefined) body.value = options.value;
    if (options.env) body.environments = parseEnvironments(options.env);
    if (options.sensitive !== undefined) body.sensitive = options.sensitive;

    const api = await McpUseAPI.create();
    const updated = await api.updateEnvVariable(options.server, varId, body);

    console.log(
      chalk.green(`\n✓ Environment variable "${updated.key}" updated.\n`)
    );
    printEnvVar(updated, !!options.value);
    console.log();
  } catch (error) {
    handleCommandError(error, "Failed to update environment variable");
  }
}

async function removeEnvCommand(
  varId: string,
  options: { server: string }
): Promise<void> {
  try {
    await requireLogin();

    const api = await McpUseAPI.create();
    await api.deleteEnvVariable(options.server, varId);

    console.log(chalk.green(`\n✓ Environment variable ${varId} removed.\n`));
  } catch (error) {
    handleCommandError(error, "Failed to remove environment variable");
  }
}

export function createEnvCommand(): Command {
  const envCommand = new Command("env").description(
    "Manage environment variables for a server"
  );

  envCommand
    .command("list")
    .alias("ls")
    .description("List environment variables for a server")
    .requiredOption("--server <id>", "Server UUID")
    .option("--show-values", "Reveal non-sensitive values in output")
    .action(listEnvCommand);

  envCommand
    .command("add")
    .argument("<KEY=VALUE>", "Variable assignment, e.g. API_KEY=abc123")
    .description("Add an environment variable to a server")
    .requiredOption("--server <id>", "Server UUID")
    .option(
      "--env <environments>",
      "Comma-separated environments: production,preview,development (default: all)"
    )
    .option(
      "--sensitive",
      "Mark the variable as sensitive (value masked in UI)"
    )
    .action(addEnvCommand);

  envCommand
    .command("update")
    .argument("<var-id>", "Environment variable UUID")
    .description("Update an existing environment variable")
    .requiredOption("--server <id>", "Server UUID")
    .option("--value <value>", "New value")
    .option(
      "--env <environments>",
      "New environments (comma-separated: production,preview,development)"
    )
    .option("--sensitive", "Mark as sensitive")
    .option("--no-sensitive", "Unmark as sensitive")
    .action(updateEnvCommand);

  envCommand
    .command("remove")
    .alias("rm")
    .argument("<var-id>", "Environment variable UUID")
    .description("Remove an environment variable from a server")
    .requiredOption("--server <id>", "Server UUID")
    .action(removeEnvCommand);

  return envCommand;
}
