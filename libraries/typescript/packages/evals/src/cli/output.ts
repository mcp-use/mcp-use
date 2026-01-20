import fs from "node:fs/promises";
import clipboard from "clipboardy";
import { CliExitError } from "../shared/errors.js";

/**
 * Output destination modes for generated code.
 */
export type OutputMode = "file" | "stdout" | "clipboard" | "all";

/**
 * Options for writing generated output.
 */
export interface OutputOptions {
  /** Where to write the output */
  mode: OutputMode;
  /** Filename for file mode */
  filename: string;
}

/**
 * Write generated code to specified output destination(s).
 *
 * @param code - Generated test code to write
 * @param options - Output configuration
 * @throws {CliExitError} If clipboard write fails
 *
 * @internal
 */
export async function writeOutput(
  code: string,
  options: OutputOptions
): Promise<void> {
  const { mode, filename } = options;

  if (mode === "file" || mode === "all") {
    await fs.writeFile(filename, code);
  }

  if (mode === "clipboard" || mode === "all") {
    try {
      await clipboard.write(code);
    } catch (error) {
      throw new CliExitError("Failed to copy output to clipboard", 5, error);
    }
  }

  if (mode === "stdout" || mode === "all") {
    process.stdout.write(`${code}\n`);
  }
}
