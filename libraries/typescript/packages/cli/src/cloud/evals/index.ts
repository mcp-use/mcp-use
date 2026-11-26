import { readdir, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

import { cloudHelp } from "../help.js";
import { parseCommandArgs, runCommand } from "../../core/command.js";
import { CommandError, UsageError } from "../../core/errors.js";
import { fields, plain } from "../../core/format.js";
import { confirm } from "../../core/prompt.js";
import { withProgress } from "../../core/progress.js";
import { cloudWebUrl } from "../cloud-api.js";
import { connectProject, PROJECT_OPTIONS } from "../project/resolve.js";
import { startRuns, type UnstartedSuite } from "./start.js";
import {
  HARNESSES,
  readEvalSuiteFile,
  suiteBody,
  suiteFile,
  toYaml,
  type EvalSuiteFile,
} from "./config.js";
import {
  createLiveReport,
  duration,
  finished,
  formatReport,
  formatRunList,
  formatRunsMarkdown,
  formatRunsStarted,
  formatRuntimeOptions,
  formatSuite,
  formatSuiteList,
  selectRuntimeOptions,
  verdict,
  type Run,
  type Suite,
} from "./output.js";

const USAGE =
  "mcp-use evals <push|list|get|export|create|update|rm|run|runs|report|cancel|options|models> [options]";
const COMMANDS = [
  "push",
  "list",
  "get",
  "export",
  "create",
  "update",
  "rm",
  "run",
  "runs",
  "report",
  "cancel",
  "options",
  "models",
];
const SUITE_FILE_EXTENSIONS = new Set([".yaml", ".yml", ".json"]);
/** Default `--wait` limit, in seconds. */
const WAIT_TIMEOUT = 1800;

type Connected = Awaited<ReturnType<typeof connectProject>>;
type Cloud = Connected["cloud"];

/** Define eval suites as files, run them on Cloud, and read results. */
export async function runEvals(argv: readonly string[]): Promise<number> {
  const help = cloudHelp("evals", argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  // Set when a command prints its result but must still exit 1: a file that
  // failed to push, or a run that did not pass under --wait.
  let failed = false;
  const code = await runCommand(argv, help, async (output) => {
    const command = argv[0] === "remove" ? "rm" : argv[0];
    if (!COMMANDS.includes(command ?? ""))
      throw new UsageError(`Usage: ${USAGE}`);
    const args = argv.slice(1);
    if (command === "models") return output.result(...(await models(args)));

    const { values, positionals } = parse(command!, args);
    const limit = Number(values.limit ?? 30),
      skip = Number(values.skip ?? 0);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(skip) ||
      skip < 0
    )
      throw new UsageError(
        "Pass --limit between 1 and 100 and a non-negative --skip."
      );
    const timeout = Number(values.timeout ?? WAIT_TIMEOUT);
    if (!Number.isSafeInteger(timeout) || timeout < 1)
      throw new UsageError("Pass --timeout as a positive number of seconds.");
    const harness =
      typeof values.harness === "string" ? values.harness : undefined;
    if (
      harness !== undefined &&
      !(HARNESSES as readonly string[]).includes(harness)
    )
      throw new UsageError(
        `Pass --harness as one of: ${HARNESSES.join(", ")}.`
      );
    if (command === "run" && (values.all === true) === positionals.length > 0)
      throw new UsageError(
        "Pass suites or --all, not both.\nUsage: mcp-use evals run <suite...>|--all"
      );
    const jsonFile =
      typeof values["json-file"] === "string" ? values["json-file"] : undefined;
    const markdownFile =
      typeof values["markdown-file"] === "string"
        ? values["markdown-file"]
        : undefined;
    if (markdownFile !== undefined && values.wait !== true)
      throw new UsageError("--markdown-file needs --wait.");
    const profile =
      typeof values.profile === "string" ? values.profile.trim() : undefined;
    if (profile === "") throw new UsageError("Pass --profile as a profile ID.");
    if (markdownFile !== undefined && markdownFile === jsonFile)
      throw new UsageError(
        "--json-file and --markdown-file must use different paths."
      );
    if (
      (command === "create" || command === "update") &&
      typeof values.file !== "string"
    )
      throw new UsageError("Pass --file <suite.yaml>.");

    // Read every file before connecting, so a usage error never reaches Cloud.
    const files =
      command === "push"
        ? await Promise.all(
            (await suiteFiles(positionals)).map(async (path) => {
              try {
                return { path, file: await readEvalSuiteFile(path) };
              } catch (error) {
                return { path, error: messageOf(error) };
              }
            })
          )
        : [];
    // Suites named on the command line: IDs, names, or suite files.
    const refs = ["get", "export", "update", "rm", "run"].includes(command!)
      ? await suiteRefs(positionals, command === "run")
      : typeof values.suite === "string"
        ? await suiteRefs([values.suite], false)
        : [];
    const file =
      typeof values.file === "string"
        ? await readEvalSuiteFile(values.file)
        : undefined;
    if (
      (command === "rm" &&
        !(await confirm(
          `Delete eval suite “${refs[0]!.label}” and all of its runs?`,
          {
            yes: values.yes === true,
            json: output.json,
          }
        ))) ||
      (command === "cancel" &&
        !(await confirm(
          `Cancel the remaining executions of run ${positionals[0]}?`,
          {
            yes: values.yes === true,
            json: output.json,
          }
        )))
    )
      return;

    const project = await connectProject(values);
    const { cloud } = project;
    const found = await cloud.call(
      cloud.client.GET("/api/v1/servers/{id}", {
        params: { path: { id: project.server } },
      })
    );
    const serverId = found.id;
    const serverName = found.name ?? found.slug ?? serverId;
    const dashboardUrl = `${cloudWebUrl()}/cloud/${encodeURIComponent(cloud.organization.slug ?? cloud.organization.id)}/servers/${encodeURIComponent(serverId)}/evals/suites`;
    const api = evalApi(cloud, serverId);
    const suites = refs.length > 0 ? await resolveSuites(api, refs) : [];

    if (command === "push") {
      const results = await push(api, files);
      failed = results.some((result) => "error" in result);
      return output.result(
        { results, dashboardUrl },
        results
          .map((result) =>
            "error" in result
              ? `✗ ${plain(result.path)}\n  ${plain(result.error)}`
              : `✓ ${result.action === "created" ? "Created" : "Updated"} “${plain(result.name)}” from ${plain(result.path)}\n  ${result.suiteId}`
          )
          .join("\n")
      );
    }
    if (command === "list") {
      const suites = await api.suites();
      return output.result(
        { suites: suites.map(publicSuite), dashboardUrl },
        formatSuiteList(suites, serverName)
      );
    }
    if (command === "get" || command === "export") {
      const suite = suites[0]!;
      const yaml = toYaml(suiteFile(suite));
      if (command === "get")
        return output.result(
          { suite: publicSuite(suite), dashboardUrl },
          formatSuite(suite, yaml)
        );
      if (typeof values.out !== "string")
        return output.result({ id: suite.id, yaml }, yaml.trimEnd());
      try {
        await writeFile(values.out, yaml);
      } catch (error) {
        throw new CommandError(
          "write_failed",
          `Could not write ${values.out}: ${(error as NodeJS.ErrnoException).code ?? messageOf(error)}.`
        );
      }
      return output.result(
        { id: suite.id, path: values.out },
        `✓ Wrote ${plain(values.out)}`
      );
    }
    if (command === "create") {
      const existing = (await api.suites()).find(
        (suite) => suite.name === file!.name
      );
      if (existing)
        throw new CommandError(
          "eval_suite_exists",
          `An eval suite named “${file!.name}” already exists (${existing.id}).`,
          undefined,
          [
            {
              description: "Replace it",
              command: `mcp-use evals update ${existing.id} --file ${String(values.file)}`,
            },
          ]
        );
      const created = await api.save(file!, undefined);
      return output.result(
        { id: created.id, name: created.name, dashboardUrl },
        `✓ Created eval suite “${plain(created.name)}”\n${fields([["ID", created.id]])}`
      );
    }
    if (command === "update") {
      const updated = await api.save(file!, suites[0]);
      return output.result(
        { id: updated.id, name: updated.name, dashboardUrl },
        `✓ Updated eval suite “${plain(updated.name)}”\n${fields([["ID", updated.id]])}`
      );
    }
    if (command === "rm") {
      const { id, name } = suites[0]!;
      await api.remove(id);
      return output.result(
        { id, name, deleted: true },
        `✓ Deleted eval suite “${plain(name)}”\n${fields([["ID", id]])}`
      );
    }
    if (command === "run") {
      const selected =
        values.all === true
          ? (await api.suites()).filter((suite) => suite.enabled)
          : suites;
      const ids = [...new Set(selected.map((suite) => suite.id))];
      if (ids.length === 0)
        throw new CommandError(
          "no_eval_suites",
          "No enabled eval suites to run.",
          undefined,
          [
            {
              description: "Create a suite",
              command: "mcp-use evals push <suite.yaml>",
            },
          ]
        );
      const branch =
        typeof values.branch === "string" ? values.branch : undefined;
      const names = new Map(selected.map((suite) => [suite.id, suite.name]));
      // Named in every output, so a log says which account the results are for.
      const runProfile =
        profile === undefined
          ? undefined
          : { id: profile, name: await api.profileName(profile) };
      // One suite that can't start doesn't stop the others; see start.ts.
      const { started, notStarted, firstError } = await startRuns(api, ids, {
        branch,
        profile,
        names,
      });
      // Lets CI read the result while the log keeps the readable report.
      const writeJson = async (value: unknown) => {
        if (jsonFile !== undefined)
          await writeFile(jsonFile, `${JSON.stringify(value)}\n`);
      };
      const writeMarkdown = async (runs: readonly Run[]) => {
        if (markdownFile !== undefined)
          await writeFile(
            markdownFile,
            `${formatRunsMarkdown(runs, { serverName, dashboardUrl, branch, names, profile: runProfile?.name, notStarted })}\n`
          );
      };
      if (started.length === 0) {
        // The files still list every suite, so a CI report shows why none ran.
        await writeJson({
          runs: [],
          notStarted,
          dashboardUrl,
          ...(runProfile ? { profile: runProfile } : {}),
        });
        if (values.wait === true) await writeMarkdown([]);
        // One error accounts for every suite when the first failure stopped the rest.
        const single =
          firstError !== undefined &&
          notStarted.slice(1).every((suite) => suite.attempts === 0);
        throw new CommandError(
          firstError?.code ?? "eval_start_failed",
          single
            ? firstError.message
            : `Could not start any of the ${notStarted.length} eval suites:\n${formatNotStarted(notStarted)}`,
          undefined,
          single ? firstError.nextSteps : []
        );
      }
      // Suites that didn't start fail the command once the started runs are reported.
      if (notStarted.length > 0) failed = true;
      const notStartedField = notStarted.length > 0 ? { notStarted } : {};
      if (values.wait !== true) {
        await writeJson({
          runs: started,
          ...notStartedField,
          dashboardUrl,
          ...(runProfile ? { profile: runProfile } : {}),
        });
        return output.result(
          {
            runs: started,
            ...notStartedField,
            dashboardUrl,
            ...(runProfile ? { profile: runProfile } : {}),
          },
          [
            ...started.map(
              (run) =>
                `✓ Started run ${run.id} (${plain(names.get(run.suiteId) ?? run.suiteId)})`
            ),
            ...(runProfile ? [`  Profile: ${plain(runProfile.name)}`] : []),
            ...(notStarted.length > 0
              ? [
                  "",
                  notStartedHeading(notStarted),
                  formatNotStarted(notStarted),
                ]
              : []),
            "",
            `Results: mcp-use evals report ${started.map((run) => run.id).join(" ")}`,
          ].join("\n")
        );
      }
      // The readable output streams: run links now, then a line per finished
      // execution, so a CI log shows progress while the runs go on.
      const startedAt = Date.now();
      const live = createLiveReport({ names, dashboardUrl, startedAt });
      let printedEvents = false;
      if (!output.json)
        process.stdout.write(
          `${formatRunsStarted(started, { serverName, dashboardUrl, branch, names, profile: runProfile?.name })}\n\n`
        );
      // Stopping the command (Ctrl+C, or a cancelled CI job) cancels the runs it started.
      let polledRuns: readonly Run[] = [];
      const stopCancellingOnSignal = cancelRunsOnSignal(api, () =>
        started
          .filter(
            (run) =>
              !polledRuns.some(
                (polled) => polled.id === run.id && finished(polled)
              )
          )
          .map((run) => ({
            id: run.id,
            name: names.get(run.suiteId) ?? run.suiteId,
          }))
      );
      const runs = await withProgress(
        `Waiting for ${started.length} eval run${started.length === 1 ? "" : "s"}`,
        output.json,
        (progress) =>
          waitForRuns(
            api,
            started.map((run) => run.id),
            timeout * 1000,
            (polled) => {
              polledRuns = polled;
              if (output.json) return;
              const now = Date.now();
              for (const line of live.update(polled, now)) {
                progress.print(line);
                printedEvents = true;
              }
              const done = polled.filter(finished).length;
              progress.update(
                `${done} of ${polled.length} suite${polled.length === 1 ? "" : "s"} done · ${duration(now - startedAt)}`
              );
            }
          )
      );
      stopCancellingOnSignal();
      if (!output.json)
        process.stdout.write(
          `${printedEvents ? "\n" : ""}${live.summary(runs, Date.now())}\n\n`
        );
      // On a timeout the files still get the runs as they stand.
      await writeJson({
        runs,
        ...notStartedField,
        dashboardUrl,
        ...(runProfile ? { profile: runProfile } : {}),
      });
      await writeMarkdown(runs);
      const pending = runs.filter((run) => !finished(run));
      if (pending.length > 0)
        throw new CommandError(
          "eval_wait_timeout",
          `Timed out waiting for ${pending.length} eval run(s): ${pending.map(verdict).join(", ")}. They keep running on Cloud.`,
          undefined,
          [
            {
              description: "Check the results later",
              command: `mcp-use evals report ${pending.map((run) => run.id).join(" ")}`,
            },
          ]
        );
      failed = failed || !runs.every((run) => run.pass === true);
      return output.result(
        {
          runs,
          ...notStartedField,
          dashboardUrl,
          ...(runProfile ? { profile: runProfile } : {}),
        },
        [
          ...runs.map((run) => formatReport(run, { names, dashboardUrl })),
          ...(notStarted.length > 0
            ? [
                `${notStartedHeading(notStarted)}\n${formatNotStarted(notStarted)}`,
              ]
            : []),
        ].join("\n")
      );
    }
    if (command === "runs") {
      const page = await api.runs({
        limit,
        skip,
        suiteId: suites[0]?.id,
      });
      // Human output names each suite; JSON keeps the API page as is.
      const names = output.json
        ? new Map<string, string>()
        : new Map((await api.suites()).map((item) => [item.id, item.name]));
      return output.result(page, formatRunList(page.items, page.total, names));
    }
    if (command === "report") {
      const runs: Run[] = [];
      for (const runId of new Set(positionals)) runs.push(await api.run(runId));
      // Human output names each suite; JSON keeps the runs as Cloud returns them.
      const names = output.json
        ? new Map<string, string>()
        : new Map((await api.suites()).map((item) => [item.id, item.name]));
      return output.result(
        { runs },
        runs.map((run) => formatReport(run, { names, dashboardUrl })).join("\n")
      );
    }
    if (command === "cancel") {
      const runId = positionals[0]!;
      const result = await api.cancel(runId);
      return output.result(
        { id: runId, ...result },
        `✓ Cancelled run\n${fields([["ID", runId]])}`
      );
    }
    const filter = {
      harness,
      query: typeof values.query === "string" ? values.query : undefined,
    };
    const options = selectRuntimeOptions(await api.options(), filter);
    return output.result(options, formatRuntimeOptions(options, filter));
  });
  return code === 0 && failed ? 1 : code;
}

/** Parse one subcommand's flags; push, run and report take several IDs or paths. */
function parse(command: string, argv: readonly string[]) {
  const options = {
    ...PROJECT_OPTIONS,
    json: { type: "boolean" },
    ...(command === "export" ? { out: { type: "string" as const } } : {}),
    ...(command === "create" || command === "update"
      ? { file: { type: "string" as const } }
      : {}),
    ...(command === "options"
      ? {
          harness: { type: "string" as const },
          query: { type: "string" as const },
        }
      : {}),
    ...(command === "rm" || command === "cancel"
      ? { yes: { type: "boolean" as const } }
      : {}),
    ...(command === "run"
      ? {
          all: { type: "boolean" as const },
          branch: { type: "string" as const },
          wait: { type: "boolean" as const },
          timeout: { type: "string" as const },
          "json-file": { type: "string" as const },
          "markdown-file": { type: "string" as const },
          profile: { type: "string" as const },
        }
      : {}),
    ...(command === "runs"
      ? {
          suite: { type: "string" as const },
          limit: { type: "string" as const },
          skip: { type: "string" as const },
        }
      : {}),
  } as const;
  const usage = `mcp-use evals ${command} --help`;
  if (command === "push" || command === "run" || command === "report") {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...argv],
        options,
        allowPositionals: true,
        strict: true,
      });
    } catch (error) {
      throw new UsageError(`${messageOf(error)}\nUsage: ${usage}`);
    }
    if (command !== "run" && parsed.positionals.length === 0)
      throw new UsageError(
        `Usage: mcp-use evals ${command} ${command === "push" ? "<path...>" : "<run-id...>"}`
      );
    return parsed;
  }
  return parseCommandArgs(argv, {
    options,
    positionals: ["get", "export", "update", "rm", "cancel"].includes(command)
      ? 1
      : 0,
    usage,
  });
}

/** Typed eval routes for one server. */
function evalApi(cloud: Cloud, serverId: string) {
  const path = { serverId };
  const suiteNotFound = {
    notFound: {
      code: "eval_suite_not_found",
      nextSteps: [
        { description: "List eval suites", command: "mcp-use evals list" },
      ],
    },
  };
  const runNotFound = {
    notFound: {
      code: "eval_run_not_found",
      nextSteps: [
        { description: "List eval runs", command: "mcp-use evals runs" },
      ],
    },
  };
  let defaultModel: string | undefined;
  const api = {
    suites: () =>
      cloud.call(
        cloud.client.GET("/api/v1/server-evals/{serverId}/suites", {
          params: { path },
        })
      ),
    /**
     * Store `file` as a suite's whole definition: create a suite, or
     * replace `existing`. Omitted fields reset to their defaults.
     */
    async save(file: EvalSuiteFile, existing: Suite | undefined) {
      if (file.clients === undefined && defaultModel === undefined)
        defaultModel = (await cloud.call(cloud.client.GET("/api/v1/models")))
          .defaultModelId;
      const body = suiteBody(file, {
        defaultModel: defaultModel ?? "",
        existingClientSettings: existing?.clientSettings,
      });
      if (existing !== undefined)
        return cloud.call(
          cloud.client.PATCH(
            "/api/v1/server-evals/{serverId}/suites/{suiteId}",
            {
              params: { path: { ...path, suiteId: existing.id } },
              body: {
                ...body,
                rubric: file.rubric ?? null,
                enabled: file.enabled,
              },
            }
          ),
          suiteNotFound
        );
      const created = await cloud.call(
        cloud.client.POST("/api/v1/server-evals/{serverId}/suites", {
          params: { path },
          body: { ...body, ...(file.rubric ? { rubric: file.rubric } : {}) },
        })
      );
      // Cloud creates suites enabled; the create body has no `enabled`.
      if (!file.enabled)
        await cloud.call(
          cloud.client.PATCH(
            "/api/v1/server-evals/{serverId}/suites/{suiteId}",
            {
              params: { path: { ...path, suiteId: created.id } },
              body: { enabled: false },
            }
          )
        );
      return created;
    },
    remove: (suiteId: string) =>
      cloud.call(
        cloud.client.DELETE(
          "/api/v1/server-evals/{serverId}/suites/{suiteId}",
          {
            params: { path: { ...path, suiteId } },
          }
        ),
        suiteNotFound
      ),
    start: (
      suiteId: string,
      branch: string | undefined,
      profileId: string | undefined
    ) =>
      cloud.call(
        cloud.client.POST(
          "/api/v1/server-evals/{serverId}/suites/{suiteId}/runs",
          {
            params: {
              path: { ...path, suiteId },
              ...(branch === undefined && profileId === undefined
                ? {}
                : {
                    query: {
                      ...(branch === undefined ? {} : { branch }),
                      ...(profileId === undefined ? {} : { profileId }),
                    },
                  }),
            },
          }
        ),
        suiteNotFound
      ),
    runs: (query: {
      limit: number;
      skip: number;
      suiteId?: string | undefined;
    }) =>
      cloud.call(
        cloud.client.GET("/api/v1/server-evals/{serverId}/runs", {
          params: {
            path,
            query: {
              limit: query.limit,
              skip: query.skip,
              ...(query.suiteId === undefined
                ? {}
                : { suiteId: query.suiteId }),
            },
          },
        })
      ),
    run: (runId: string) =>
      cloud.call(
        cloud.client.GET("/api/v1/server-evals/{serverId}/runs/{runId}", {
          params: { path: { ...path, runId } },
        }),
        runNotFound
      ),
    cancel: (runId: string) =>
      cloud.call(
        cloud.client.POST(
          "/api/v1/server-evals/{serverId}/runs/{runId}/cancel",
          {
            params: { path: { ...path, runId } },
          }
        ),
        runNotFound
      ),
    options: () =>
      cloud.call(
        cloud.client.GET("/api/v1/server-evals/{serverId}/runtime-options", {
          params: { path },
        })
      ),
    /**
     * How outputs name a profile: its label or account name, with the
     * account's email. Falls back to the ID when the profile can't be read
     * (another organization's, or no permission): naming it is best effort.
     */
    profileName: async (profileId: string): Promise<string> => {
      try {
        const { items } = await cloud.call(
          cloud.client.GET("/api/v1/organizations/{id}/profiles", {
            params: { path: { id: cloud.organization.id } },
          })
        );
        const found = items.find((item) => item.id === profileId);
        const name = found?.label || found?.account?.name || "";
        const email = found?.account?.email || "";
        if (name && email && name !== email) return `${name} (${email})`;
        return name || email || profileId;
      } catch {
        return profileId;
      }
    },
  };
  return api;
}
type EvalApi = ReturnType<typeof evalApi>;

/** Create or replace one suite per file, matched by name. Every file is attempted. */
async function push(
  api: EvalApi,
  files: ReadonlyArray<{ path: string; file?: EvalSuiteFile; error?: string }>
) {
  const suites = files.some((item) => item.file) ? await api.suites() : [];
  const results: Array<
    | {
        path: string;
        action: "created" | "updated";
        suiteId: string;
        name: string;
      }
    | { path: string; error: string }
  > = [];
  for (const { path, file, error } of files) {
    if (file === undefined) {
      results.push({ path, error: error ?? "Invalid suite file." });
      continue;
    }
    const matches = suites.filter((suite) => suite.name === file.name);
    if (matches.length > 1) {
      results.push({
        path,
        error: `${matches.length} suites are named “${file.name}”. Replace one by ID: mcp-use evals update <suite-id> --file ${path}`,
      });
      continue;
    }
    try {
      const saved = await api.save(file, matches[0]);
      results.push({
        path,
        action: matches[0] ? "updated" : "created",
        suiteId: saved.id,
        name: saved.name,
      });
    } catch (failure) {
      results.push({ path, error: messageOf(failure) });
    }
  }
  return results;
}

/** A suite named on the command line: by the name in a suite file, or by ID or name. */
interface SuiteRef {
  /** What the user typed, for messages. */
  label: string;
  /** The suite name read from a suite file. */
  fileName?: string;
}

/**
 * Turn command-line suite references into refs. An existing file is read
 * for its suite name; a directory, where `directories` allows it, stands
 * for every suite file in it. Anything else is an ID or a name.
 */
async function suiteRefs(
  args: readonly string[],
  directories: boolean
): Promise<SuiteRef[]> {
  const refs: SuiteRef[] = [];
  for (const arg of args) {
    const info = await stat(arg).catch(() => undefined);
    if (info === undefined) {
      refs.push({ label: arg });
      continue;
    }
    if (info.isDirectory() && !directories)
      throw new UsageError(`${arg} is a directory; name one suite.`);
    for (const path of await suiteFiles([arg]))
      refs.push({
        label: path,
        fileName: (await readEvalSuiteFile(path)).name,
      });
  }
  return refs;
}

/**
 * The suites `refs` name, in order: a file by its suite name; otherwise an
 * ID, then an exact name, then a name ignoring case. Fails on no match or
 * on a name several suites share.
 */
async function resolveSuites(
  api: EvalApi,
  refs: readonly SuiteRef[]
): Promise<Suite[]> {
  const suites = await api.suites();
  return refs.map((ref) => {
    const name = ref.fileName ?? ref.label;
    const lower = name.toLowerCase();
    const candidates = [
      ref.fileName === undefined
        ? suites.filter((suite) => suite.id === ref.label)
        : [],
      suites.filter((suite) => suite.name === name),
      suites.filter((suite) => suite.name.toLowerCase() === lower),
    ];
    const matches = candidates.find((list) => list.length > 0) ?? [];
    if (matches.length === 1) return matches[0]!;
    if (matches.length === 0)
      throw new CommandError(
        "eval_suite_not_found",
        ref.fileName === undefined
          ? `No eval suite matches “${ref.label}”.`
          : `No eval suite is named “${name}” (from ${ref.label}).`,
        undefined,
        [
          ref.fileName === undefined
            ? { description: "List eval suites", command: "mcp-use evals list" }
            : {
                description: "Create it",
                command: `mcp-use evals push ${ref.label}`,
              },
        ]
      );
    throw new CommandError(
      "eval_suite_ambiguous",
      `${matches.length} eval suites are named “${name}”: ${matches.map((suite) => suite.id).join(", ")}. Pass an ID instead.`
    );
  });
}

/** Expand files and directories (one level deep) into suite files, in a stable order. */
async function suiteFiles(paths: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const path of paths) {
    const info = await stat(path).catch(() => undefined);
    if (info === undefined)
      throw new UsageError(`No such file or directory: ${path}`);
    if (!info.isDirectory()) {
      files.push(path);
      continue;
    }
    const entries = (await readdir(path, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          SUITE_FILE_EXTENSIONS.has(extname(entry.name).toLowerCase())
      )
      .map((entry) => join(path, entry.name))
      .sort();
    if (entries.length === 0)
      throw new UsageError(`No .yaml, .yml, or .json files in ${path}.`);
    files.push(...entries);
  }
  return [...new Set(files)];
}

/** How long cancelling may take after a signal: CI sends SIGTERM 7.5 s after SIGINT. */
const CANCEL_TIMEOUT_MS = 5000;

/**
 * On SIGINT or SIGTERM (Ctrl+C, or a cancelled CI job), cancel the runs
 * `open` returns, report it on stderr, then exit 130 or 143. Signals that
 * arrive while cancelling are ignored: CI can deliver the same signal twice
 * (to the job's process group and through a wrapper), and cancelling is
 * capped at CANCEL_TIMEOUT_MS. Returns a function that removes the handlers.
 */
function cancelRunsOnSignal(
  api: EvalApi,
  open: () => Array<{ id: string; name: string }>
): () => void {
  let stopping = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    const runs = open();
    const exit = () => process.exit(signal === "SIGINT" ? 130 : 143);
    if (runs.length === 0) return exit();
    process.stderr.write(
      `\nCancelling ${runs.length} eval run${runs.length === 1 ? "" : "s"}…\n`
    );
    // Each run's answer, kept as it arrives: one slow cancel doesn't hide the others.
    const results: Array<PromiseSettledResult<unknown> | undefined> = runs.map(
      () => undefined
    );
    const cancels = Promise.all(
      runs.map((run, i) =>
        api.cancel(run.id).then(
          (value) => (results[i] = { status: "fulfilled", value }),
          (reason: unknown) => (results[i] = { status: "rejected", reason })
        )
      )
    );
    const timeout = delay(CANCEL_TIMEOUT_MS);
    void Promise.race([cancels, timeout]).then(() => {
      const label = (run: { id: string; name: string }) =>
        `${run.id} (${plain(run.name)})`;
      const lines: string[] = [];
      const unanswered: Array<{ id: string; name: string }> = [];
      runs.forEach((run, i) => {
        const result = results[i];
        if (result === undefined) unanswered.push(run);
        else if (result.status === "fulfilled")
          lines.push(`Cancelled ${label(run)}.`);
        else
          lines.push(
            `Could not cancel ${label(run)}: ${messageOf(result.reason)}`
          );
      });
      // Cloud's cancel can take longer than CI waits after a signal. The
      // request was sent; it usually completes after the command exits.
      if (unanswered.length > 0)
        lines.push(
          `Cancel requested; Cloud hadn't answered before this command stopped waiting (cancelling can take several seconds, and usually completes anyway):`,
          ...unanswered.map((run) => `  ${label(run)}`),
          `To check: mcp-use evals report ${unanswered.map((run) => run.id).join(" ")}`
        );
      process.stderr.write(`${lines.join("\n")}\n`);
      exit();
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
}

/**
 * Poll runs until each finishes or the time runs out, and return them as
 * they stand; runs keep going on Cloud after a timeout.
 */
/** "2 eval suites did not start:" */
function notStartedHeading(notStarted: readonly UnstartedSuite[]): string {
  return `✗ ${notStarted.length} eval suite${notStarted.length === 1 ? "" : "s"} did not start:`;
}

/** One line per suite that did not start, with its error. */
function formatNotStarted(notStarted: readonly UnstartedSuite[]): string {
  return notStarted
    .map((suite) => `  ${plain(suite.name)}: ${plain(suite.error)}`)
    .join("\n");
}

async function waitForRuns(
  api: EvalApi,
  runIds: readonly string[],
  timeoutMs: number,
  onPoll: (runs: readonly Run[]) => void = () => {}
): Promise<Run[]> {
  const deadline = Date.now() + timeoutMs;
  const configured = process.env["MCP_USE_POLL_INTERVAL_MS"];
  const interval =
    configured === undefined ? 5000 : Math.max(0, Number(configured) || 0);
  for (;;) {
    const runs: Run[] = [];
    for (const runId of runIds) runs.push(await api.run(runId));
    onPoll(runs);
    if (runs.every(finished) || Date.now() >= deadline) return runs;
    await delay(interval);
  }
}

/** List model IDs for clients.inspector.models. Needs no server. */
async function models(argv: readonly string[]): Promise<[unknown, string]> {
  const { values } = parseCommandArgs(argv, {
    options: {
      org: { type: "string" },
      json: { type: "boolean" },
      query: { type: "string" },
      provider: { type: "string" },
      limit: { type: "string" },
      skip: { type: "string" },
    },
    positionals: 0,
    usage: "mcp-use evals models [options]",
  });
  const limit = Number(values.limit ?? 30),
    skip = Number(values.skip ?? 0);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(skip) ||
    skip < 0
  )
    throw new UsageError(
      "Pass --limit between 1 and 100 and a non-negative --skip."
    );
  const { connectCloud } = await import("../api/client.js");
  const cloud = await connectCloud({
    organization: values.org ?? process.env["MANUFACT_ORG"],
  });
  const catalog = await cloud.call(cloud.client.GET("/api/v1/models"));
  const query = values.query?.toLowerCase();
  const matching = catalog.models.filter(
    (model) =>
      (values.provider === undefined ||
        model.id.startsWith(`${values.provider}/`)) &&
      (query === undefined ||
        model.id.toLowerCase().includes(query) ||
        model.name.toLowerCase().includes(query))
  );
  const page = matching.slice(skip, skip + limit);
  return [
    {
      defaultModelId: catalog.defaultModelId,
      total: matching.length,
      models: page.map(({ id, name, provider }) => ({ id, name, provider })),
    },
    page.length === 0
      ? "No matching models."
      : page
          .map(
            (model) =>
              `${plain(model.id)}  ${plain(model.name)}${model.id === catalog.defaultModelId ? " (default)" : ""}`
          )
          .join("\n"),
  ];
}

/** A suite as a suite file plus the fields only Cloud knows. */
function publicSuite(suite: Suite) {
  return {
    id: suite.id,
    ...suiteFile(suite),
    enabled: suite.enabled,
    latestRun: suite.runs?.[0] ?? null,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
