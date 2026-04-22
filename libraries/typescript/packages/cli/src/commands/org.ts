import chalk from "chalk";
import { McpUseAPI } from "../utils/api.js";
import { isLoggedIn, readConfig, writeConfig } from "../utils/config.js";
import { handleCommandError } from "../utils/errors.js";
import { promptOrgSelection } from "./auth.js";

async function ensureLoggedIn(): Promise<boolean> {
  if (!(await isLoggedIn())) {
    console.log(chalk.yellow("⚠️  You are not logged in."));
    console.log(
      chalk.gray("Run " + chalk.white("npx mcp-use login") + " to get started.")
    );
    return false;
  }
  return true;
}

/**
 * List all organizations the user belongs to
 */
export async function orgListCommand(): Promise<void> {
  try {
    if (!(await ensureLoggedIn())) return;

    const api = await McpUseAPI.create();
    const authInfo = await api.testAuth();
    const config = await readConfig();

    const orgs = authInfo.orgs ?? [];
    const activeId = config.orgId || authInfo.default_org_id;

    if (orgs.length === 0) {
      console.log(chalk.yellow("No organizations found."));
      return;
    }

    console.log(chalk.cyan.bold("🏢 Your organizations:\n"));

    for (const o of orgs) {
      const isActive = o.id === activeId;
      const marker = isActive ? chalk.green(" ← active") : "";
      const slug = o.slug ? chalk.gray(` (${o.slug})`) : "";
      const role = chalk.gray(` [${o.role}]`);
      const name = isActive ? chalk.cyan.bold(o.name) : chalk.white(o.name);
      console.log(`  ${name}${slug}${role}${marker}`);
    }

    if (orgs.length > 1) {
      console.log(
        chalk.gray("\nSwitch with " + chalk.white("npx mcp-use org switch"))
      );
    }
  } catch (error) {
    handleCommandError(error, "Failed to list organizations");
  }
}

/**
 * Switch the active organization
 */
export async function orgSwitchCommand(): Promise<void> {
  try {
    if (!(await ensureLoggedIn())) return;

    const api = await McpUseAPI.create();
    const authInfo = await api.testAuth();
    const config = await readConfig();
    const orgs = authInfo.orgs ?? [];

    if (orgs.length === 0) {
      console.log(chalk.yellow("No organizations found."));
      return;
    }

    if (orgs.length === 1) {
      const o = orgs[0];
      const slug = o.slug ? chalk.gray(` (${o.slug})`) : "";
      console.log(
        chalk.yellow(
          `You only have one organization: ${chalk.cyan(o.name)}${slug}`
        )
      );
      return;
    }

    const activeId = config.orgId || authInfo.default_org_id;
    const selected = await promptOrgSelection(orgs, activeId);

    if (!selected) {
      console.log(chalk.yellow("No organization selected."));
      return;
    }

    await writeConfig({
      ...config,
      orgId: selected.id,
      orgName: selected.name,
      orgSlug: selected.slug ?? undefined,
    });

    try {
      await api.setDefaultOrg(selected.id);
    } catch {
      // Non-fatal: the local config is what matters for CLI operations
    }

    const slug = selected.slug ? chalk.gray(` (${selected.slug})`) : "";
    console.log(
      chalk.green.bold("\n✓ Switched to ") +
        chalk.cyan.bold(selected.name) +
        slug
    );
  } catch (error) {
    handleCommandError(error, "Failed to switch organization");
  }
}

/**
 * Show the currently active organization
 */
export async function orgCurrentCommand(): Promise<void> {
  try {
    if (!(await ensureLoggedIn())) return;

    const config = await readConfig();

    if (!config.orgId) {
      console.log(
        chalk.yellow(
          "No organization selected. Run " +
            chalk.white("npx mcp-use org switch") +
            " to pick one."
        )
      );
      return;
    }

    const slug = config.orgSlug ? chalk.gray(` (${config.orgSlug})`) : "";
    console.log(
      chalk.cyan.bold("🏢 Active organization: ") +
        chalk.white(config.orgName || config.orgId) +
        slug
    );
  } catch (error) {
    handleCommandError(error, "Failed to get organization");
  }
}
