/** Conservative allowance for production server and tunnel cleanup. */
const PRODUCTION_SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * Await production cleanup without letting a stalled close keep the CLI alive.
 *
 * The timer remains referenced so it still reports failure if close removes
 * every other active handle before its promise settles. Synchronous throws and
 * rejected closes retain their original error.
 *
 * @internal
 */
export async function withProductionShutdownDeadline(
  close: () => Promise<void>
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(close),
      new Promise<void>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error("Production server shutdown timed out after 30 seconds.")
          );
        }, PRODUCTION_SHUTDOWN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
