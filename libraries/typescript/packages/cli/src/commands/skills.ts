import chalk from "chalk";
import { Command } from "commander";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extract } from "tar";

const REPO_OWNER = "mcp-use";
const REPO_NAME = "mcp-use";
const REPO_BRANCH = "main";

const TELEMETRY_URL = "https://add-skill.vercel.sh/t";
const SOURCE_REPO = `${REPO_OWNER}/${REPO_NAME}`;

// Telemetry data defined in https://github.com/vercel-labs/skills/blob/main/src/telemetry.ts
interface InstallTelemetryData {
  event: "install";
  source: string;
  skills: string;
  agents: string;
  global?: "1";
  skillFiles?: string;
  sourceType?: string;
}

/** Type-safe enum for IDE/agent presets */
type AgentPreset = "cursor" | "claude-code" | "codex";

const AGENT_PRESET_FOLDERS: Record<AgentPreset, string> = {
  cursor: ".cursor",
  "claude-code": ".claude",
  codex: ".agent",
};

const ALL_PRESETS: AgentPreset[] = ["cursor", "claude-code", "codex"];

/**
 * Send telemetry event for vercel skills.sh.
 * Fire-and-forget -- never throws.
 */
function sendInstallTelemetryEvent(agents: string, skills: string): void {
  const telemetryData: InstallTelemetryData = {
    event: "install",
    source: SOURCE_REPO,
    skills,
    agents,
    sourceType: "github",
  };
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(telemetryData)) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }
    fetch(`${TELEMETRY_URL}?${params.toString()}`).catch(() => {});
  } catch {
    // Silently fail - telemetry should never break the CLI
  }
}

/**
 * Download and extract skills from the mcp-use GitHub repository
 * and install them into the project's agent preset directories
 * (.cursor/skills, .claude/skills, .agent/skills).
 */
async function addSkillsToProject(projectPath: string): Promise<void> {
  const tarballUrl = `https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/${REPO_BRANCH}`;
  const tempDir = mkdtempSync(join(tmpdir(), "mcp-use-skills-"));

  try {
    const response = await fetch(tarballUrl);
    if (!response.ok) {
      throw new Error(`Failed to download tarball: ${response.statusText}`);
    }

    await pipeline(
      Readable.fromWeb(response.body as any),
      extract({
        cwd: tempDir,
        filter: (path) => path.includes("/skills/"),
        strip: 1,
      })
    );

    const skillsPath = join(tempDir, "skills");
    if (!existsSync(skillsPath)) {
      throw new Error("Skills folder not found in repository");
    }

    for (const preset of ALL_PRESETS) {
      const folderName = AGENT_PRESET_FOLDERS[preset];
      const outputPath = join(projectPath, folderName, "skills");
      cpSync(skillsPath, outputPath, { recursive: true });
    }

    const skillNames = readdirSync(skillsPath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    sendInstallTelemetryEvent(ALL_PRESETS.join(","), skillNames.join(","));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function createSkillsCommand(): Command {
  const skills = new Command("skills").description(
    "Manage mcp-use AI agent skills"
  );

  const installAction = async (options: { path: string }) => {
    const projectPath = resolve(options.path);

    if (!existsSync(projectPath)) {
      console.error(chalk.red(`Directory not found: ${projectPath}`));
      process.exit(1);
    }

    console.log(chalk.cyan("📚 Installing mcp-use skills..."));
    console.log(
      chalk.gray(
        "   Downloading from github.com/mcp-use/mcp-use → .cursor/skills, .claude/skills, .agent/skills"
      )
    );

    try {
      await addSkillsToProject(projectPath);
      console.log(chalk.green("✅ Skills installed successfully!"));
    } catch (error) {
      console.error(chalk.red("❌ Failed to install skills."));
      console.error(
        chalk.yellow(
          `   Error: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      console.error(
        chalk.yellow(
          "   You can also install manually: npx skills add mcp-use/mcp-use"
        )
      );
      process.exit(1);
    }
  };

  const pathOption = [
    "-p, --path <path>",
    "Path to project directory",
    process.cwd(),
  ] as const;

  skills
    .command("add")
    .description(
      "Install mcp-use skills for AI agents (Cursor, Claude Code, Codex)"
    )
    .option(...pathOption)
    .action(installAction);

  skills
    .command("install")
    .description("Install mcp-use skills for AI agents (alias for 'add')")
    .option(...pathOption)
    .action(installAction);

  return skills;
}
