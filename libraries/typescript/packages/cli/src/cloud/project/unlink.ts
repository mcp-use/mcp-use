/**
 * `mcp-use unlink`: remove a project's link to its Manufact Cloud server.
 * Works offline; it never contacts Cloud.
 */
import { parseCommandArgs, runCommand } from "../../core/command.js";
import { projectRoot, removeProjectLink } from "./link-file.js";

const USAGE = "mcp-use unlink [--path <dir>] [--json]";

const HELP = `Usage: ${USAGE}

Remove .manufact/project.json from the project root, and .manufact/ when it
is then empty. Unlinking a project that is not linked succeeds.

Options:
  --path <dir>  Project root (default: current directory)
  --json        Emit one JSON result or error
  -h, --help    Show this help

Exit codes:
  0  Unlinked or not linked, or help
  2  Invalid arguments`;

/** Run `mcp-use unlink`. */
export async function runUnlink(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  return runCommand(argv, async (output) => {
    const { values } = parseCommandArgs(argv, {
      options: { path: { type: "string" }, json: { type: "boolean" } },
      positionals: 0,
      usage: USAGE,
    });
    const unlinked = await removeProjectLink(projectRoot(values.path));
    output.result(
      { unlinked },
      unlinked ? "Unlinked this project." : "This project was not linked."
    );
  });
}
