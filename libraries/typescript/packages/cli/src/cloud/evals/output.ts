import { age, fields, plain, record, table } from "../../core/format.js";
import type { operations } from "../api/generated/types.gen.js";

type Json<O extends keyof operations, S extends number> =
  operations[O]["responses"] extends Record<
    S,
    { content: { "application/json": infer T } }
  >
    ? T
    : never;

/** A suite as Cloud returns it, with its latest run. */
export type Suite = Json<"getApiV1ServerEvalsByServerIdSuites", 200>[number];
/** A run with its executions. */
export type Run = Json<"getApiV1ServerEvalsByServerIdRunsByRunId", 200>;
type RunListItem = Json<
  "getApiV1ServerEvalsByServerIdRuns",
  200
>["items"][number];
type RuntimeOptions = Json<"getApiV1ServerEvalsByServerIdRuntimeOptions", 200>;

/** Statuses that never change again, as Cloud defines them; "cancelled" is a stopped run. */
const FINISHED = new Set(["complete", "failed", "cancelled"]);
const WEB_CLIENTS = new Set(["chatgpt", "claude"]);
/** Runtime models listed per harness when `evals options` is unfiltered. */
const MODELS_SHOWN = 10;

/** Whether a run has stopped changing. */
export function finished(run: { status: string }): boolean {
  return FINISHED.has(run.status);
}

/** A run's state in a few words: its status until it finishes, then its verdict. */
export function verdict(run: {
  status: string;
  pass: boolean | null;
  score: number | null;
}): string {
  if (!finished(run)) return plain(run.status);
  if (run.status === "cancelled") return "Cancelled";
  const result =
    run.pass === true
      ? "Passed"
      : run.pass === false
        ? "Failed"
        : plain(run.status);
  return run.score === null ? result : `${result} (${run.score})`;
}

/** The suites table for `evals list`. */
export function formatSuiteList(
  suites: readonly Suite[],
  serverName: string
): string {
  if (suites.length === 0)
    return `Evals · ${plain(serverName)}\n\nNo eval suites.\nCreate one: mcp-use evals push <suite.yaml>`;
  return [
    `Evals · ${plain(serverName)}`,
    "",
    table(
      ["NAME", "ENABLED", "LATEST RUN", "ID"],
      suites.map((suite) => {
        const latest = suite.runs?.[0];
        return [
          suite.name,
          suite.enabled ? "Yes" : "No",
          latest
            ? `${verdict(latest)} · ${age(latest.createdAt) ?? ""}`
            : "Never run",
          suite.id,
        ];
      })
    ),
  ].join("\n");
}

/** A suite as YAML followed by its latest run, for `evals get`. */
export function formatSuite(suite: Suite, yaml: string): string {
  const latest = suite.runs?.[0];
  return [
    yaml.trimEnd(),
    "",
    fields([
      [
        "Latest run",
        latest ? `${verdict(latest)} (${latest.id})` : "Never run",
      ],
      ["ID", suite.id],
    ]),
  ].join("\n");
}

/** The runs table for `evals runs`. */
export function formatRunList(
  runs: readonly RunListItem[],
  total: number,
  suiteNames: ReadonlyMap<string, string>
): string {
  if (runs.length === 0) return `No eval runs${total ? " on this page" : ""}.`;
  return [
    table(
      ["RESULT", "SUITE", "STARTED", "ID"],
      runs.map((run) => [
        verdict(run),
        suiteNames.get(run.suiteId) ?? run.suiteId,
        age(run.createdAt),
        run.id,
      ])
    ),
    "",
    `${runs.length} shown · ${total} total`,
  ].join("\n");
}

/** One run with a line per client and model, and why each failure failed. */
export function formatReport(run: Run): string {
  const executions = (run.scenarios ?? []).flatMap(
    (scenario) => scenario.executions ?? []
  );
  const lines = [`Run ${plain(run.id)}: ${verdict(run)}`];
  if (run.serverUrl) lines.push(`Target: ${plain(run.serverUrl)}`);
  for (const execution of executions) {
    const model =
      WEB_CLIENTS.has(execution.client) || !execution.modelName
        ? ""
        : ` ${plain(execution.modelName)}`;
    const result = !finished(execution)
      ? plain(execution.status)
      : execution.status === "cancelled"
        ? "cancelled"
        : execution.pass === true
          ? "pass"
          : "FAIL";
    const score = execution.score === null ? "" : ` ${execution.score}`;
    lines.push(`  ${result}${score}  ${plain(execution.client)}${model}`);
    if (execution.pass !== true)
      lines.push(...reasons(execution).map((reason) => `    ${reason}`));
  }
  return lines.join("\n");
}

/** What `evals options` narrows the runtimes to. */
export interface RuntimeFilter {
  /** Only this harness. */
  harness?: string | undefined;
  /** Only models whose ID or label contains this, case-insensitively. */
  query?: string | undefined;
}

/**
 * Narrow runtime options to `filter`. `--harness` keeps that harness only
 * (and no web apps); `--query` keeps matching models and drops harnesses and
 * web apps without one, unless the harness was asked for by name.
 */
export function selectRuntimeOptions(
  options: RuntimeOptions,
  filter: RuntimeFilter
): RuntimeOptions {
  const query = filter.query?.toLowerCase();
  const matches = (...texts: string[]) =>
    query === undefined ||
    texts.some((text) => text.toLowerCase().includes(query));
  const web = (models: RuntimeOptions["webModels"]["chatgpt"]) =>
    filter.harness === undefined
      ? models.filter((model) => matches(model.id, model.name))
      : [];
  return {
    ...options,
    webModels: {
      chatgpt: web(options.webModels.chatgpt),
      claude: web(options.webModels.claude),
    },
    harnesses: options.harnesses
      .filter(
        (item) => filter.harness === undefined || item.id === filter.harness
      )
      .map((item) => ({
        ...item,
        models: item.models.filter((model) =>
          matches(model.model, model.label)
        ),
      }))
      .filter(
        (item) =>
          query === undefined ||
          filter.harness !== undefined ||
          item.models.length > 0
      ),
  };
}

/**
 * Clients, web-app models and harnesses for `evals options`. Unfiltered,
 * each list shows its first models; a filter shows every match.
 */
export function formatRuntimeOptions(
  options: RuntimeOptions,
  filter: RuntimeFilter
): string {
  const state = (item: { available: boolean; reason: string | null }) =>
    item.available
      ? "Ready"
      : `Unavailable${item.reason ? `: ${plain(item.reason)}` : ""}`;
  const filtered = filter.harness !== undefined || filter.query !== undefined;
  const shown = filtered ? Infinity : MODELS_SHOWN;
  const models = (lines: string[]) => [
    ...lines.slice(0, shown),
    ...(lines.length > shown
      ? [
          `    … ${lines.length - shown} more (filter with --harness or --query)`,
        ]
      : []),
  ];
  const web = [...WEB_CLIENTS].flatMap((id) => {
    const capture = options.captureClients.find((client) => client.id === id);
    const listed = options.webModels[id as "chatgpt" | "claude"];
    if (filtered && listed.length === 0) return [];
    return [
      `  ${id}  ${capture ? state(capture) : "Unavailable"}`,
      ...models(
        listed.map((model) => `    ${plain(model.id)}  ${plain(model.name)}`)
      ),
    ];
  });
  const harnesses = options.harnesses.flatMap((harness) => [
    `  ${harness.id}  ${state(harness)}`,
    ...models(
      harness.models.map(
        (model) =>
          `    ${plain(model.model)}  provider: ${plain(model.provider)}`
      )
    ),
  ]);
  const sections = [
    ...(filtered
      ? []
      : [
          [
            "Inspector (clients.inspector.models)",
            "  Ready (models: mcp-use evals models)",
          ],
        ]),
    ...(web.length > 0
      ? [["Web apps (clients.chatgpt, clients.claude)", ...web]]
      : []),
    ...(harnesses.length > 0
      ? [["Harnesses (clients.runtimes)", ...harnesses]]
      : []),
  ];
  return filtered && web.length === 0 && harnesses.length === 0
    ? `No models match “${plain(filter.query ?? "")}”.`
    : sections.map((section) => section.join("\n")).join("\n\n");
}

type Execution = NonNullable<
  NonNullable<Run["scenarios"]>[number]["executions"]
>[number];

/**
 * Render `evals run --wait` results as GitHub-flavored Markdown, for pull
 * request comments and job summaries: a table of suites, then one section
 * per suite with a row per client and model. Suites that did not pass start
 * open and list why each execution failed.
 */
export function formatRunsMarkdown(
  runs: readonly Run[],
  options: {
    serverName: string;
    dashboardUrl: string;
    branch: string | undefined;
    names: ReadonlyMap<string, string>;
  }
): string {
  const icon = (item: { status: string; pass: boolean | null }) =>
    !finished(item)
      ? "⏳"
      : item.status === "cancelled"
        ? "➖"
        : item.pass === true
          ? "✅"
          : "❌";
  const count = (wanted: string) =>
    runs.filter((run) => icon(run) === wanted).length;
  const tally = [
    ["✅", "passed"],
    ["❌", "failed"],
    ["➖", "cancelled"],
    ["⏳", "still running"],
  ]
    .map(([mark, label]) => [count(mark!), mark, label] as const)
    .filter(([n]) => n > 0)
    .map(([n, mark, label]) => `${mark} ${n} ${label}`)
    .join(" · ");
  const pending = count("⏳");
  const targets = [
    ...new Set(runs.map((run) => run.serverUrl ?? "").filter(Boolean)),
  ];
  const suiteName = (run: Run) => options.names.get(run.suiteId) ?? run.suiteId;
  const suiteUrl = (run: Run) =>
    `${options.dashboardUrl}/${encodeURIComponent(run.suiteId)}`;

  const lines: string[] = [
    `## Manufact Evals · ${cell(options.serverName)}`,
    "",
    `${options.branch ? `Branch ${code(options.branch)}` : "Production"} · ${runs.length} suite${runs.length === 1 ? "" : "s"}${tally ? ` · ${tally}` : ""}`,
    "",
  ];
  if (targets.length === 1) lines.push(`Target ${code(targets[0]!)}`, "");
  if (pending)
    lines.push(
      "> [!CAUTION]",
      `> **Timed out waiting for ${pending} run${pending === 1 ? "" : "s"}.** They keep running on Cloud; open the dashboard for their results.`,
      ""
    );

  lines.push(
    "| Suite | Result | Score | Executions |",
    "| :-- | :-- | :-- | :-- |"
  );
  for (const run of runs) {
    const executions = executionsOf(run);
    const ok = executions.filter((execution) => execution.pass === true).length;
    lines.push(
      `| [${cell(suiteName(run))}](${suiteUrl(run)}) | ${icon(run)} ${cell(verdict({ ...run, score: null }))} | ${run.score ?? "—"} | ${executions.length ? `${ok}/${executions.length} passed` : "—"} |`
    );
  }
  lines.push("");

  for (const run of runs) {
    const executions = executionsOf(run);
    if (executions.length === 0) continue;
    lines.push(
      // An HTML line: Markdown escapes would show as typed here.
      `<details${run.pass === true ? "" : " open"}><summary>${icon(run)} <b>${html(suiteName(run))}</b> · ${html(verdict(run))}</summary>`,
      "",
      "| Client | Model | Result | Score |",
      "| :-- | :-- | :-- | :-- |"
    );
    const failures: string[] = [];
    for (const execution of executions) {
      const model =
        WEB_CLIENTS.has(execution.client) || !execution.modelName
          ? ""
          : cell(execution.modelName);
      const result = !finished(execution)
        ? `⏳ ${cell(execution.status)}`
        : execution.status === "cancelled"
          ? "➖ Cancelled"
          : execution.pass === true
            ? "✅ Pass"
            : "❌ Fail";
      lines.push(
        `| ${cell(execution.client)} | ${model || "—"} | ${result} | ${execution.score ?? "—"} |`
      );
      if (finished(execution) && execution.status !== "cancelled") {
        const why = execution.pass === true ? [] : reasons(execution);
        if (why.length)
          failures.push(
            `**${cell(execution.client)}${model ? ` ${model}` : ""}**`,
            "",
            ...why.map((reason) => `- ${cell(reason)}`),
            ""
          );
      }
    }
    lines.push("", ...failures);
    lines.push(
      `[Open in the dashboard](${suiteUrl(run)})`,
      "",
      "</details>",
      ""
    );
  }

  lines.push(`[All eval suites](${options.dashboardUrl})`);
  return lines.join("\n");
}

function executionsOf(run: Run): Execution[] {
  return (run.scenarios ?? []).flatMap((scenario) => scenario.executions ?? []);
}

/** Escape text for one line of raw HTML. */
function html(value: string): string {
  return plain(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, " ");
}

/** Escape text for GitHub-flavored Markdown, including table cells. */
function cell(value: string): string {
  return plain(value)
    .replace(/\\/g, "\\\\")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/[`*_[\]]/g, "\\$&")
    .replace(/\r?\n/g, "<br>");
}

/** A one-line code span outside tables, with a fence longer than any backticks inside. */
function code(value: string): string {
  const text = plain(value).replace(/\r?\n/g, " ");
  const longest = Math.max(
    0,
    ...[...text.matchAll(/`+/g)].map((match) => match[0].length)
  );
  const fence = "`".repeat(longest + 1);
  return longest ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

/**
 * Why an execution did not pass, most specific first: its error, the tool
 * checks it failed, the judge's problem titles, else the first sentence of
 * the judgement (which is Markdown, usually opening with a heading).
 */
function reasons(execution: Execution): string[] {
  if (execution.error) return [firstLine(execution.error)];
  const tools = list(record(execution.toolAssertions).checks)
    .map(record)
    .filter((check) => check.passed === false && typeof check.name === "string")
    .map((check) =>
      check.kind === "forbidden"
        ? `Called disallowed tool ${String(check.name)}`
        : `Missing tool call: ${String(check.name)}`
    );
  const problems = list(record(execution.judgeVerdict).majorProblems)
    .map((problem) => record(problem).title)
    .filter(
      (title): title is string => typeof title === "string" && title !== ""
    )
    .map(firstLine);
  if (tools.length > 0 || problems.length > 0) return [...tools, ...problems];
  const text = (execution.judgement ?? "")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim())
    .find((line) => line !== "");
  return text ? [firstLine(text)] : [];
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstLine(text: string): string {
  const line = plain(text).trim().split("\n")[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}
