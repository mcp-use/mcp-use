import chalk from "chalk";
import { ApiUnauthorizedError } from "./api.js";

/**
 * Treats `ApiUnauthorizedError` (401) as a "please re-authenticate" hint
 * instead of surfacing the raw API response.
 */
export function handleCommandError(error: unknown, context: string): never {
  if (error instanceof ApiUnauthorizedError) {
    console.error(
      chalk.red("\n✗ Your session has expired or your API key is invalid.")
    );
    console.error(
      chalk.gray(
        `Run ${chalk.white("npx mcp-use login")} to re-authenticate.\n`
      )
    );
    process.exit(1);
  }
  console.error(
    chalk.red.bold(`\n✗ ${context}:`),
    chalk.red(error instanceof Error ? error.message : "Unknown error")
  );
  process.exit(1);
}
