/**
 * Runtime probes shared by every adapter. Nothing here runs at module
 * evaluation: Cloudflare Workers forbid timers, I/O and random values in the
 * global scope, so every helper is called lazily from a request or from
 * `instrument()`.
 */

interface ProcessLike {
  env?: Record<string, string | undefined>;
  versions?: Record<string, string | undefined>;
  pid?: number;
  on?: (event: string, listener: () => void) => unknown;
  prependListener?: (event: string, listener: () => void) => unknown;
  removeListener?: (event: string, listener: () => void) => unknown;
  listenerCount?: (event: string) => number;
  kill?: (pid: number, signal?: string) => unknown;
  exit?: (code?: number) => unknown;
  exitCode?: number | string | undefined;
}

interface DenoLike {
  version?: { deno?: string };
  env?: { get(name: string): string | undefined };
  unrefTimer?: (id: number) => void;
}

/** The globals the runtime probes read. */
interface RuntimeGlobals {
  process?: ProcessLike;
  Deno?: DenoLike;
  Bun?: { version?: string };
  EdgeRuntime?: unknown;
  navigator?: { userAgent?: string };
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
}

const runtimeGlobals = (): RuntimeGlobals => globalThis as RuntimeGlobals;

/** Read an environment variable from Node/Bun/Workers `process.env` or Deno. */
export function readEnv(name: string): string | undefined {
  const g = runtimeGlobals();
  try {
    const value = g.process?.env?.[name];
    if (value !== undefined) return value;
  } catch {
    // Some sandboxes expose a throwing `process.env` proxy.
  }
  try {
    return g.Deno?.env?.get(name);
  } catch {
    // Deno without --allow-env throws; treat as unset.
    return undefined;
  }
}

/** `"1"`, `"true"`, `"yes"` and `"on"` (any case) are truthy flags. */
export function isTruthyFlag(value: string | undefined): boolean {
  return value !== undefined && /^(1|true|yes|on)$/i.test(value.trim());
}

/** `node/22.11.0`, `bun/1.3.0`, `deno/2.5.0`, `workerd` or `edge-light`. */
export function runtimeName(): string {
  const g = runtimeGlobals();
  if (typeof g.Bun?.version === "string") return `bun/${g.Bun.version}`;
  if (typeof g.Deno?.version?.deno === "string") {
    return `deno/${g.Deno.version.deno}`;
  }
  if (typeof g.EdgeRuntime === "string") return g.EdgeRuntime;
  if (g.navigator?.userAgent === "Cloudflare-Workers") return "workerd";
  const node = g.process?.versions?.node;
  if (typeof node === "string") return `node/${node}`;
  return "unknown";
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/**
 * Time-ordered UUIDv7, the event idempotency key. Ordered ids keep rows from
 * one process close together in the ingest table's primary key.
 */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  let ms = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = hex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Monotonic milliseconds for durations, falling back to the wall clock. */
export function monotonicNow(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Schedule a timer that never keeps the process alive: queued events are
 * flushed on `beforeExit` instead.
 */
export function unrefTimeout(callback: () => void, ms: number): TimerHandle {
  const handle = setTimeout(callback, ms);
  try {
    const timer = handle as unknown as { unref?: () => void };
    if (typeof timer.unref === "function") {
      timer.unref();
    } else if (typeof handle === "number") {
      runtimeGlobals().Deno?.unrefTimer?.(handle);
    }
  } catch {
    // Unref is best effort.
  }
  return handle;
}

/** A function that extends a serverless invocation until a promise settles. */
export type WaitUntil = (promise: Promise<unknown>) => void;

const VERCEL_REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

interface VercelRequestContext {
  get?: () => { waitUntil?: WaitUntil } | undefined;
}

/**
 * The current request's `waitUntil` on Vercel (Node and Edge functions), read
 * from the request context Vercel installs on `globalThis`.
 */
export function vercelWaitUntil(): WaitUntil | undefined {
  try {
    const context = (globalThis as Record<symbol, unknown>)[
      VERCEL_REQUEST_CONTEXT
    ] as VercelRequestContext | undefined;
    const waitUntil = context?.get?.()?.waitUntil;
    return typeof waitUntil === "function" ? waitUntil : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run `listener` each time the process is about to exit because its event
 * loop is empty (Node and Bun `beforeExit`, Deno `beforeunload`). Work the
 * listener starts keeps the process alive until it settles. This never fires
 * on `process.exit()` or signals; see {@link onTerminationSignal}.
 */
export function onBeforeExit(listener: () => void): void {
  const g = runtimeGlobals();
  try {
    if (typeof g.process?.on === "function" && g.Deno === undefined) {
      g.process.on("beforeExit", listener);
      return;
    }
    if (g.Deno !== undefined && typeof g.addEventListener === "function") {
      g.addEventListener("beforeunload", () => listener());
    }
  } catch {
    // Exit hooks are best effort.
  }
}

/** The signals a terminal (Ctrl+C) or a process manager (deploy, restart) sends to stop a server. */
const TERMINATION_SIGNALS = { SIGINT: 2, SIGTERM: 15 } as const;

/**
 * A Node or Bun process that can take signal listeners; never Deno, Workers
 * (even with `nodejs_compat`) or an edge runtime.
 */
function signalProcess(
  g: RuntimeGlobals
): (Required<Omit<ProcessLike, "exit">> & ProcessLike) | undefined {
  const proc = g.process;
  if (
    proc === undefined ||
    g.Deno !== undefined ||
    g.EdgeRuntime !== undefined ||
    g.navigator?.userAgent === "Cloudflare-Workers" ||
    (typeof g.Bun?.version !== "string" &&
      typeof proc.versions?.node !== "string") ||
    typeof proc.pid !== "number" ||
    typeof proc.prependListener !== "function" ||
    typeof proc.removeListener !== "function" ||
    typeof proc.listenerCount !== "function" ||
    typeof proc.kill !== "function"
  ) {
    return undefined;
  }
  return proc as Required<Omit<ProcessLike, "exit">> & ProcessLike;
}

/**
 * Hold the `process.exit()` calls made until `until` settles, then exit with
 * the code last asked for. `until` must settle on its own (it is bounded by
 * the caller); the process is kept alive meanwhile.
 */
function holdExit(
  proc: ProcessLike,
  until: Promise<void>,
  boundMs: number
): void {
  const exit = proc.exit;
  if (typeof exit !== "function") return;
  let requested = false;
  let code: number | undefined;
  let keepAlive: ReturnType<typeof setTimeout> | undefined;
  const held = function exit(next?: number): void {
    requested = true;
    if (next !== undefined) {
      code = next;
      proc.exitCode = next;
    }
    keepAlive ??= setTimeout(() => undefined, boundMs);
  };
  try {
    proc.exit = held;
  } catch {
    return;
  }
  void until.then(() => {
    if (keepAlive !== undefined) clearTimeout(keepAlive);
    try {
      if (proc.exit === held) proc.exit = exit;
    } catch {
      // Best effort.
    }
    if (requested) exit.call(proc, code);
  });
}

/**
 * Flush on SIGINT and SIGTERM in Node and Bun without changing what the
 * signal does. `flush` starts synchronously when the signal arrives and is
 * waited for at most `boundMs`:
 *
 * - when nothing else listens for the signal (counted as it arrives), the
 *   process would have died at once: after the flush, the listener removes
 *   itself and raises the signal again, so the process still dies by it
 *   (exit code 130 / 143). A second signal during the flush raises it at
 *   once;
 * - when the application or its framework listens, it owns shutdown: the
 *   flush runs in the background and never exits the process. A
 *   `process.exit()` the application calls while it runs (Skybridge exits as
 *   soon as its HTTP server closed, often within milliseconds) is held until
 *   the flush ends, at most `boundMs`, then exits with the same code.
 *
 * Installs nothing elsewhere (Deno, Workers, edge runtimes). Returns whether
 * listeners were installed.
 *
 * @param flush - Called with `final`: true when the process exits right after.
 * @param boundMs - Longest wait for `flush` before the signal is raised again.
 * @param g - The globals to use (tests pass a fake process).
 */
export function onTerminationSignal(
  flush: (final: boolean) => Promise<void>,
  boundMs: number,
  g: RuntimeGlobals = runtimeGlobals()
): boolean {
  const proc = signalProcess(g);
  if (proc === undefined) return false;
  try {
    for (const [signal, number] of Object.entries(TERMINATION_SIGNALS)) {
      let flushing: Promise<void> | undefined;
      const start = (final: boolean): Promise<void> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const bound = new Promise<void>((resolve) => {
          // Only a final flush holds the process: the signal is raised
          // again once it ends.
          timer = final
            ? setTimeout(resolve, boundMs)
            : unrefTimeout(resolve, boundMs);
        });
        let work: Promise<void>;
        try {
          work = flush(final).catch(() => undefined);
        } catch {
          work = Promise.resolve();
        }
        return Promise.race([work, bound]).then(() => clearTimeout(timer));
      };
      const raise = (): void => {
        try {
          proc.removeListener(signal, listener);
          proc.kill(proc.pid, signal);
        } catch {
          try {
            proc.exit?.(128 + number);
          } catch {
            // Nothing else to do.
          }
        }
      };
      const listener = (): void => {
        // Prepended, so this runs first and sees every other listener.
        const alone = proc.listenerCount(signal) <= 1;
        if (!alone) {
          if (flushing === undefined) {
            const work = start(false);
            flushing = work.finally(() => {
              flushing = undefined;
            });
            holdExit(proc, work, boundMs);
          }
          return;
        }
        if (flushing !== undefined) {
          raise();
          return;
        }
        flushing = start(true);
        void flushing.then(raise);
      };
      proc.prependListener(signal, listener);
    }
    return true;
  } catch {
    // Signal hooks are best effort.
    return false;
  }
}
