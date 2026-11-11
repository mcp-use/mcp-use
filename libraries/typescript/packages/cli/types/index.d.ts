/** Options supplied by the public framework binary. @internal */
export interface CliMainOptions {
  /** Version reported by the binary that owns the CLI invocation. */
  frameworkVersion: string;
}

/**
 * Run the prebuilt mcp-use command dispatcher without process side effects.
 *
 * @param argv - Command-line arguments excluding the executable and script.
 * @param options - Invocation metadata owned by the calling package.
 * @returns The process exit code.
 * @internal
 */
export declare function main(
  argv: readonly string[],
  options: CliMainOptions
): Promise<number>;

/**
 * Run the CLI as a process: set the exit code from {@link main}, and end the
 * process after commands that finish rather than serve.
 *
 * @param argv - Command-line arguments excluding the executable and script.
 * @param options - Invocation metadata owned by the calling package.
 * @internal
 */
export declare function runBin(
  argv: readonly string[],
  options: CliMainOptions
): void;
