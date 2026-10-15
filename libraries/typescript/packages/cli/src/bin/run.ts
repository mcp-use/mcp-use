import { main, type CliMainOptions } from "./main.js";

/**
 * Exit once stdout and stderr have flushed. `process.exit` alone can cut off
 * output that is still queued for a pipe.
 */
function exitAfterFlush(code: number): void {
  let pending = 2;
  const done = (): void => {
    pending -= 1;
    if (pending === 0) process.exit(code);
  };
  process.stdout.write("", done);
  process.stderr.write("", done);
}

/**
 * Run the CLI as a process: set the exit code from {@link main}, and end the
 * process after commands that finish rather than serve.
 *
 * @param argv - Command-line arguments excluding the executable and script.
 * @param options - Invocation metadata owned by the calling package.
 * @internal
 */
export function runBin(argv: readonly string[], options: CliMainOptions): void {
  // `build` evaluates the user's entry to validate views. Anything that entry
  // opens at module scope (a database connection, a timer) would otherwise
  // keep the process alive after the build is done, so a build exits
  // explicitly.
  const exitWhenDone = argv[0] === "build";
  main(argv, options).then(
    (code) => {
      process.exitCode = code;
      if (exitWhenDone) exitAfterFlush(code);
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      if (exitWhenDone) exitAfterFlush(1);
    }
  );
}
