/** Install the agent skills shipped with this CLI version. */
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCommandArgs, runCommand } from "../core/command.js";
import { CommandError, UsageError } from "../core/errors.js";

const AGENTS = [".cursor", ".claude", ".agents"];
const HELP = `Usage: mcp-use skills install [--path <directory>] [--json]

Install version-matched agent skills, including Manufact Cloud CLI guidance,
into .cursor/skills, .claude/skills, and .agents/skills in the project.
Existing unrelated skills are preserved. The bundled skills work offline.

Commands:
  install              Install the bundled skills
  add                  Alias for install

Options:
  -p, --path <directory> Project root (default: current directory)
  --json                Emit one JSON result or error
  -h, --help            Show this help`;

/** Run the existing skills install/add command family. */
export async function runSkills(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  return runCommand(argv, HELP, async (output) => {
    const { positionals, values } = parseCommandArgs(argv, {
      options: {
        path: { type: "string", short: "p" },
        json: { type: "boolean" },
      },
      positionals: 1,
      usage: "mcp-use skills install [--path <directory>] [--json]",
    });
    if (positionals[0] !== "install" && positionals[0] !== "add") {
      throw new UsageError("Use mcp-use skills install.");
    }
    const project = resolve(values.path ?? process.cwd());
    try {
      if (!(await stat(project)).isDirectory())
        throw new Error("Not a directory");
    } catch {
      throw new CommandError(
        "project_not_found",
        `Project directory not found: ${project}`
      );
    }
    const bundled = fileURLToPath(new URL("../agent-skills/", import.meta.url));
    const skills = (await readdir(bundled, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const agent of AGENTS) {
      const target = join(project, agent, "skills");
      await mkdir(target, { recursive: true });
      for (const skill of skills) {
        await cp(join(bundled, skill), join(target, skill), {
          recursive: true,
        });
      }
    }
    output.result(
      {
        path: project,
        skills,
        directories: AGENTS.map((agent) => join(project, agent, "skills")),
      },
      `Installed ${skills.join(", ")} into ${AGENTS.join(", ")}.`
    );
  });
}
