import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

export type Cleanup = (signal: AbortSignal) => void | Promise<void>;

/** Per-test ownership, independent of project contents or the resource being tested. */
export class TestScope {
  private readonly cleanups: (() => Promise<void>)[] = [];
  private readonly restorations: (() => void)[] = [];
  private readonly directories: string[] = [];
  private readonly controller = new AbortController();
  private disposal: Promise<void> | undefined;
  private closing = false;
  private unsafe = false;

  constructor(
    readonly root: string,
    private readonly options: { timeout?: number; grace?: number } = {}
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  directory(prefix = "project-", root = this.root): string {
    this.assertOpen();
    const directory = mkdtempSync(join(root, prefix));
    this.directories.push(directory);
    return directory;
  }

  /** The returned close function is idempotent, including explicit closes in tests. */
  defer(cleanup: Cleanup, label = "test resource"): () => Promise<void> {
    this.assertOpen();
    let done: Promise<void> | undefined;
    const close = () => (done ??= this.closeResource(cleanup, label));
    this.cleanups.push(close);
    return close;
  }

  /** Global state is restored even when resource shutdown fails or stalls. */
  restore(cleanup: () => void): void {
    this.assertOpen();
    this.restorations.push(cleanup);
  }

  preserveEnv(...names: string[]): void {
    for (const name of names) {
      const previous = process.env[name];
      this.restore(() => {
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
      });
    }
  }

  preserveProperty(target: object, name: PropertyKey): void {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    this.restore(() => {
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else Reflect.deleteProperty(target, name);
    });
  }

  preserveSignals(...signals: NodeJS.Signals[]): void {
    for (const signal of signals) {
      const before = new Set(process.listeners(signal));
      this.restore(() => {
        for (const listener of process.listeners(signal)) {
          if (!before.has(listener)) process.off(signal, listener);
        }
      });
    }
  }

  dispose(): Promise<void> {
    if (!this.disposal) {
      this.closing = true;
      this.disposal = this.disposeAll();
    }
    return this.disposal;
  }

  private assertOpen(): void {
    if (this.closing)
      throw new Error(
        "Cannot acquire resources after test teardown has started"
      );
  }

  private async closeResource(cleanup: Cleanup, label: string): Promise<void> {
    const controller = new AbortController();
    const timeout = this.options.timeout ?? 5_000;
    const grace = this.options.grace ?? 1_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = Promise.resolve().then(() => cleanup(controller.signal));
    const expired = Symbol("expired");
    const wait = (ms: number) =>
      new Promise<typeof expired>((resolve) => {
        timer = setTimeout(() => resolve(expired), ms);
      });
    try {
      if ((await Promise.race([work, wait(timeout)])) !== expired) return;
      controller.abort(new Error(`${label} shutdown exceeded ${timeout}ms`));
      if ((await Promise.race([work, wait(grace)])) === expired) {
        this.unsafe = true;
        // The runner must not sweep files still in use by non-cooperative work.
        writeFileSync(
          join(this.root, ".cleanup-incomplete"),
          `${label} did not stop\n`
        );
        throw new Error(
          `${label} did not stop after ${timeout}ms + ${grace}ms cancellation grace; retained files in ${this.root}`
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async disposeAll(): Promise<void> {
    this.controller.abort(new Error("Test finished"));
    const errors: unknown[] = [];
    for (const close of this.cleanups.reverse()) {
      try {
        await close();
      } catch (error) {
        errors.push(error);
      }
    }
    for (const restore of this.restorations.reverse()) {
      try {
        restore();
      } catch (error) {
        errors.push(error);
      }
    }
    if (!this.unsafe && process.env.KEEP_TEST_PROJECTS !== "1") {
      for (const directory of this.directories) {
        try {
          await rm(directory, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 100,
          });
        } catch (error) {
          errors.push(
            new Error(`Could not remove test directory: ${directory}`, {
              cause: error,
            })
          );
        }
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "CLI test cleanup failed");
  }
}
