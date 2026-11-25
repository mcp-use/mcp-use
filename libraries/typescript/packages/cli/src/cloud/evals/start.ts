/**
 * Starting the runs of `evals run`. Cloud starts one suite per request, so
 * one failed request must not cost the rest of the batch:
 *
 * - A suite whose start fails for its own reasons (a validation error, a
 *   missing suite) is reported and the next suite starts.
 * - A failure every later start would repeat (signed out, no access, out of
 *   credits or plan, `--profile` ignored) stops starting; the remaining
 *   suites are reported as not started.
 * - A dropped connection, a timeout or a 5xx may have reached Cloud, and a
 *   start is not idempotent. Before sending it again, the suite's runs are
 *   checked for one Cloud created after the first attempt (with the
 *   `--profile` asked for, when one was), and that run is used instead. This
 *   is best effort until Cloud takes an idempotency key: a run someone else
 *   starts for the same suite in that window would be taken for this one, and
 *   a start is sent again when Cloud can't be read or the run shows up late.
 * - A 429 never reached the handler, so it is retried after `Retry-After`.
 *
 * A suite gets {@link MAX_ATTEMPTS} attempts in all.
 */
import { setTimeout as delay } from "node:timers/promises";

import { CloudResponseError } from "../api/client.js";
import { CommandError } from "../../core/errors.js";

/** Attempts per suite, the first included. */
export const MAX_ATTEMPTS = 3;
/** Waits before the second and third attempt. */
const BACKOFF_MS = [1000, 3000] as const;
/** How long to look for a run a dropped start may have created. A start takes about 10s. */
const ADOPT_POLLS = 10;
const ADOPT_POLL_MS = 3000;
/** Runs of a suite remembered before its first start, newest first. */
const KNOWN_RUNS = 20;
/** Newest runs of a suite checked for one this command created. */
const RECENT_RUNS = 5;

/** The calls starting needs, from `evalApi`. */
export interface StartApi {
  start(
    suiteId: string,
    branch: string | undefined,
    profileId: string | undefined
  ): Promise<{ id: string; status: string; profileId?: string | null }>;
  runs(query: {
    limit: number;
    skip: number;
    suiteId?: string | undefined;
  }): Promise<{
    // Cloud returns each run's `profileId` too, though the spec leaves it out.
    items: ReadonlyArray<{ id: string; status: string; profileId?: unknown }>;
  }>;
  cancel(runId: string): Promise<unknown>;
}

/** A run this command started, or found after a start whose answer was lost. */
export interface StartedRun {
  id: string;
  suiteId: string;
  status: string;
}

/** A suite that has no run from this command. */
export interface UnstartedSuite {
  suiteId: string;
  name: string;
  /** Stable error code, e.g. `validation_error` or `cloud_unreachable`. */
  code: string;
  /** Why, as Cloud or the CLI said it. */
  error: string;
  /** Start requests sent for it: 0 when starting had already stopped. */
  attempts: number;
}

/** What a failed start means for this suite and the ones after it. */
type Outcome =
  /** The request may have reached Cloud: look for its run, then retry. */
  | "unknown"
  /** Cloud refused before starting anything: retry. */
  | "retry"
  /** This suite can't start: report it and go on. */
  | "skip"
  /** No suite can start: report this one and the rest. */
  | "stop";

/** Whether a failed start is retried, skipped, or stops the remaining starts. */
export function classifyStartError(error: CommandError): Outcome {
  if (error.code === "cloud_unreachable" || error.code === "cloud_timeout")
    return "unknown";
  if (error.code === "eval_profile_unsupported") return "stop";
  if (error instanceof CloudResponseError) {
    if (error.status === 429) return "retry";
    if (error.status >= 500) return "unknown";
    // Signed out, no permission, or the plan's evals or credits ran out.
    if (error.status === 401 || error.status === 403) return "stop";
  }
  return "skip";
}

/**
 * Start a run of each suite, in order. Resolves with the runs that started
 * and the suites that did not; it throws only on an unexpected error. When
 * nothing started, `firstError` is the error to report for the command.
 */
export async function startRuns(
  api: StartApi,
  suiteIds: readonly string[],
  options: {
    branch: string | undefined;
    profile: string | undefined;
    names: ReadonlyMap<string, string>;
  }
): Promise<{
  started: StartedRun[];
  notStarted: UnstartedSuite[];
  firstError: CommandError | undefined;
}> {
  const started: StartedRun[] = [];
  const notStarted: UnstartedSuite[] = [];
  let firstError: CommandError | undefined;
  let stoppedBy: CommandError | undefined;
  for (const suiteId of suiteIds) {
    const name = options.names.get(suiteId) ?? suiteId;
    if (stoppedBy !== undefined) {
      notStarted.push({
        suiteId,
        name,
        code: stoppedBy.code,
        error: `Not attempted: ${stoppedBy.message}`,
        attempts: 0,
      });
      continue;
    }
    const result = await startSuite(api, suiteId, name, options);
    if ("run" in result) {
      started.push(result.run);
      continue;
    }
    firstError ??= result.error;
    notStarted.push({
      suiteId,
      name,
      code: result.error.code,
      error: result.error.message,
      attempts: result.attempts,
    });
    if (result.stop) stoppedBy = result.error;
  }
  return { started, notStarted, firstError };
}

async function startSuite(
  api: StartApi,
  suiteId: string,
  name: string,
  options: { branch: string | undefined; profile: string | undefined }
): Promise<
  { run: StartedRun } | { error: CommandError; attempts: number; stop: boolean }
> {
  const waits = waitsFromEnvironment();
  // Run IDs from before the first start: a run missing here was started by this command.
  let known: ReadonlySet<string> | undefined;
  let lastError: CommandError | undefined;
  let sent = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      known ??= new Set(
        (await api.runs({ limit: KNOWN_RUNS, skip: 0, suiteId })).items.map(
          (run) => run.id
        )
      );
      sent++;
      const run = await api.start(suiteId, options.branch, options.profile);
      // Cloud without run profiles drops the parameter and starts the run with the
      // server's own profile: stop it rather than report results for the wrong account.
      if (options.profile !== undefined && run.profileId !== options.profile) {
        await api.cancel(run.id).catch(() => undefined);
        throw new CommandError(
          "eval_profile_unsupported",
          `Manufact Cloud did not apply --profile to the run of “${name}”, so it was cancelled. This Cloud does not support profiles for eval runs yet.`
        );
      }
      return { run: { id: run.id, suiteId, status: run.status } };
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      lastError = error;
      const outcome = classifyStartError(error);
      if (outcome === "skip" || outcome === "stop")
        return { error, attempts: sent, stop: outcome === "stop" };
      // `known` is unset when the run list itself failed: no start was sent.
      if (outcome === "unknown" && known !== undefined) {
        const found = await findStartedRun(
          api,
          suiteId,
          known,
          options.profile,
          waits.adoptPollMs
        );
        if (found)
          return { run: { id: found.id, suiteId, status: found.status } };
      }
      if (attempt < MAX_ATTEMPTS) await delay(waits.backoff(attempt, error));
    }
  }
  return {
    error: new CommandError(
      lastError!.code,
      `${lastError!.message} (gave up after ${sent} start attempt${sent === 1 ? "" : "s"})`
    ),
    attempts: sent,
    stop: false,
  };
}

/**
 * A run of `suiteId` missing from `known`, polled for while a lost start may
 * still be creating it. With `profile`, only a run with that profile counts:
 * a run without it is someone else's, or one a Cloud without run profiles
 * started, and neither may report results for the wrong account or be
 * cancelled by this command.
 */
async function findStartedRun(
  api: StartApi,
  suiteId: string,
  known: ReadonlySet<string>,
  profile: string | undefined,
  pollMs: number
): Promise<{ id: string; status: string } | undefined> {
  for (let poll = 0; poll < ADOPT_POLLS; poll++) {
    if (poll > 0) await delay(pollMs);
    try {
      const { items } = await api.runs({
        limit: RECENT_RUNS,
        skip: 0,
        suiteId,
      });
      const found = items.find(
        (run) =>
          !known.has(run.id) &&
          (profile === undefined || run.profileId === profile)
      );
      if (found) return found;
    } catch {
      // Cloud is still unreachable: keep looking until the window ends.
    }
  }
  return undefined;
}

/**
 * Waits between attempts and polls. `MCP_USE_POLL_INTERVAL_MS`, the CLI's
 * polling override, replaces every one of them, so tests run without delays.
 */
function waitsFromEnvironment(): {
  backoff: (attempt: number, error: CommandError) => number;
  adoptPollMs: number;
} {
  const configured = process.env["MCP_USE_POLL_INTERVAL_MS"];
  if (configured !== undefined) {
    const ms = Math.max(0, Number(configured) || 0);
    return { backoff: () => ms, adoptPollMs: ms };
  }
  return {
    backoff: (attempt, error) => {
      const fallback = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length) - 1]!;
      return error instanceof CloudResponseError &&
        error.retryAfterSec !== undefined
        ? Math.max(fallback, error.retryAfterSec * 1000)
        : fallback;
    },
    adoptPollMs: ADOPT_POLL_MS,
  };
}
