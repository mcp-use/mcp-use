import { createInterface } from "node:readline/promises";
import { UsageError } from "./errors.js";

/** Require confirmation for destructive operations. */
export async function confirm(
  message: string,
  options: { yes: boolean; json: boolean }
): Promise<boolean> {
  if (options.yes) return true;
  if (options.json || !process.stdin.isTTY) {
    throw new UsageError(`${message} Pass --yes to confirm.`);
  }
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question(`${message} [y/N] `);
    return answer.trim().toLowerCase() === "y";
  } finally {
    prompt.close();
  }
}
