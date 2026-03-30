import chalk from "chalk";
import { McpUseAPI } from "../utils/api.js";
import { isLoggedIn, readConfig, writeConfig } from "../utils/config.js";
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

    const profiles = authInfo.profiles ?? [];
    const activeId = config.profileId || authInfo.default_profile_id;

    if (profiles.length === 0) {
      console.log(chalk.yellow("No organizations found."));
      return;
    }

    console.log(chalk.cyan.bold("🏢 Your organizations:\n"));

    for (const p of profiles) {
      const isActive = p.id === activeId;
      const marker = isActive ? chalk.green(" ← active") : "";
      const slug = p.slug ? chalk.gray(` (${p.slug})`) : "";
      const role = chalk.gray(` [${p.role}]`);
      const name = isActive
        ? chalk.cyan.bold(p.profile_name)
        : chalk.white(p.profile_name);
      console.log(`  ${name}${slug}${role}${marker}`);
    }

    if (profiles.length > 1) {
      console.log(
        chalk.gray("\nSwitch with " + chalk.white("npx mcp-use org switch"))
      );
    }
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Failed to list organizations:"),
      chalk.red(error instanceof Error ? error.message : "Unknown error")
    );
    process.exit(1);
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
    const profiles = authInfo.profiles ?? [];

    if (profiles.length === 0) {
      console.log(chalk.yellow("No organizations found."));
      return;
    }

    if (profiles.length === 1) {
      const p = profiles[0];
      const slug = p.slug ? chalk.gray(` (${p.slug})`) : "";
      console.log(
        chalk.yellow(
          `You only have one organization: ${chalk.cyan(p.profile_name)}${slug}`
        )
      );
      return;
    }

    const activeId = config.profileId || authInfo.default_profile_id;
    const selected = await promptOrgSelection(profiles, activeId);

    if (!selected) {
      console.log(chalk.yellow("No organization selected."));
      return;
    }

    // Update local config
    await writeConfig({
      ...config,
      profileId: selected.id,
      profileName: selected.profile_name,
      profileSlug: selected.slug ?? undefined,
    });

    // Sync to backend so the web dashboard reflects the same default
    try {
      await api.setDefaultProfile(selected.id);
    } catch {
      // Non-fatal: the local config is what matters for CLI operations
    }

    const slug = selected.slug ? chalk.gray(` (${selected.slug})`) : "";
    console.log(
      chalk.green.bold("\n✓ Switched to ") +
        chalk.cyan.bold(selected.profile_name) +
        slug
    );
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Failed to switch organization:"),
      chalk.red(error instanceof Error ? error.message : "Unknown error")
    );
    process.exit(1);
  }
}

/**
 * Show the currently active organization
 */
export async function orgCurrentCommand(): Promise<void> {
  try {
    if (!(await ensureLoggedIn())) return;

    const config = await readConfig();

    if (!config.profileId) {
      console.log(
        chalk.yellow(
          "No organization selected. Run " +
            chalk.white("npx mcp-use org switch") +
            " to pick one."
        )
      );
      return;
    }

    const slug = config.profileSlug
      ? chalk.gray(` (${config.profileSlug})`)
      : "";
    console.log(
      chalk.cyan.bold("🏢 Active organization: ") +
        chalk.white(config.profileName || config.profileId) +
        slug
    );
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Failed to get organization:"),
      chalk.red(error instanceof Error ? error.message : "Unknown error")
    );
    process.exit(1);
  }
}
