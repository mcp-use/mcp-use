import { Command } from "commander";
import { generateCommand } from "./generate.js";

/**
 * Run the @mcp-use/evals CLI.
 * Entry point for the command-line interface.
 *
 * @internal
 */
export async function runCli(): Promise<void> {
  const program = new Command();
  program.name("@mcp-use/evals").description("MCP eval generator");

  program.addCommand(generateCommand());
  await program.parseAsync(process.argv);
}
