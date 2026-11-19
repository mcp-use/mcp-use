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

/**
 * One run as `evals report` and `evals run --wait` print it: the suite and
 * its score, then a line per client and model with its duration and tool
 * calls. Failed executions add why they failed, the judge's assessment and a
 * link to their report in the dashboard.
 */
export function formatReport(
  run: Run,
  options: { names: ReadonlyMap<string, string>; dashboardUrl: string }
): string {
  const lines = [
    `${mark(run)} ${plain(options.names.get(run.suiteId) ?? run.suiteId)} · ${outcome(run)}`,
  ];
  for (const execution of executionsOf(run)) {
    const ran = finished(execution) && execution.status !== "cancelled";
    lines.push(
      `   ${mark(execution)} ${[...executionParts(execution), ran ? toolSummary(execution) : undefined].filter(Boolean).join(" · ")}`
    );
    if (!ran || execution.pass === true) continue;
    const found = problems(execution);
    const judge = judgeSummary(execution);
    lines.push(
      ...found.map((problem) => `      ${problem}`),
      ...(judge && !found.includes(judge) ? [`      Judge: ${judge}`] : []),
      `      🔗 ${executionUrl(options.dashboardUrl, run.suiteId, execution.id)}`
    );
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
 * open; each failed execution lists why, the judge's assessment, a link to
 * its report and the conversation.
 */
export function formatRunsMarkdown(
  runs: readonly Run[],
  options: {
    serverName: string;
    dashboardUrl: string;
    branch: string | undefined;
    names: ReadonlyMap<string, string>;
    /** The profile the runs sign in with, when not the server's own. */
    profile?: string | undefined;
  }
): string {
  const count = (wanted: string) =>
    runs.filter((run) => mark(run) === wanted).length;
  const tally = [
    ["✅", "passed"],
    ["❌", "failed"],
    ["➖", "cancelled"],
    ["⏳", "still running"],
  ]
    .map(([icon, label]) => [count(icon!), icon, label] as const)
    .filter(([n]) => n > 0)
    .map(([n, icon, label]) => `${icon} ${n} ${label}`)
    .join(" · ");
  const pending = count("⏳");
  const suiteName = (run: Run) => options.names.get(run.suiteId) ?? run.suiteId;
  const suiteUrl = (run: Run) =>
    `${options.dashboardUrl}/${encodeURIComponent(run.suiteId)}`;

  const lines: string[] = [
    `## 🧪 Manufact Evals · ${cell(options.serverName)}`,
    "",
    `${options.branch ? `Branch ${code(options.branch)}` : "Production"}${options.profile ? ` · Profile ${cell(options.profile)}` : ""} · ${runs.length} suite${runs.length === 1 ? "" : "s"}${tally ? ` · ${tally}` : ""}`,
    "",
  ];
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
      `| [${cell(suiteName(run))}](${suiteUrl(run)}) | ${mark(run)} ${cell(verdict({ ...run, score: null }))} | ${run.score === null ? "—" : `${run.score}%`} | ${executions.length ? `${ok}/${executions.length} passed` : "—"} |`
    );
  }
  lines.push("");

  for (const run of runs) {
    const executions = executionsOf(run);
    if (executions.length === 0) continue;
    lines.push(
      // An HTML line: Markdown escapes would show as typed here.
      `<details${run.pass === true ? "" : " open"}><summary>${mark(run)} <b>${html(suiteName(run))}</b> · ${html(outcome(run))}</summary>`,
      "",
      "| Client | Model | Result | Score | Duration | Tool calls |",
      "| :-- | :-- | :-- | :-- | :-- | :-- |"
    );
    const failures: string[] = [];
    for (const execution of executions) {
      const ran = finished(execution) && execution.status !== "cancelled";
      const result = !finished(execution)
        ? `⏳ ${cell(execution.status)}`
        : execution.status === "cancelled"
          ? "➖ Cancelled"
          : execution.pass === true
            ? "✅ Pass"
            : "❌ Fail";
      lines.push(
        `| ${cell(clientName(execution.client))} | ${cell(modelOf(execution) ?? "—")} | ${result} | ${execution.score === null ? "—" : `${execution.score}%`} | ${execution.durationMs == null ? "—" : duration(execution.durationMs)} | ${ran ? cell(toolSummary(execution)) : "—"} |`
      );
      if (!ran || execution.pass === true) continue;
      const found = problems(execution);
      const judge = judgeSummary(execution);
      const model = modelOf(execution);
      failures.push(
        `**❌ ${cell(clientName(execution.client))}${model ? ` · ${cell(model)}` : ""}** · [Open the report](${executionUrl(options.dashboardUrl, run.suiteId, execution.id)})`,
        "",
        ...found.map((problem) => `- ${cell(problem)}`),
        ...(judge && !found.includes(judge)
          ? [`- **Judge:** ${cell(judge)}`]
          : []),
        "",
        ...conversation(run, execution),
        ""
      );
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

/** A collapsed transcript of one execution: the user's messages, its tool calls and its answer. */
function conversation(run: Run, execution: Execution): string[] {
  const messages = list(run.messages).filter(
    (message): message is string => typeof message === "string"
  );
  const calls = toolCallsOf(execution);
  const answer =
    typeof execution.agentResponse === "string"
      ? execution.agentResponse.trim()
      : "";
  if (messages.length === 0 && calls.length === 0 && !answer) return [];
  const clipped = answer.length > 1500 ? `${answer.slice(0, 1497)}...` : answer;
  return [
    "<details><summary>Conversation</summary>",
    "",
    ...messages.flatMap((message) => ["**User**", "", ...fenced(message), ""]),
    ...(calls.length
      ? [
          "**Tool calls**",
          "",
          ...calls.map(
            (call) =>
              `- ${code(call.tool)} ${code(JSON.stringify(call.args ?? {}))}${call.isError ? " ❌ error" : ""}`
          ),
          "",
        ]
      : ["**Tool calls:** none", ""]),
    ...(answer ? ["**Answer**", "", ...fenced(clipped), ""] : []),
    "</details>",
  ];
}

/** A text code block whose fence outgrows any backticks inside. */
function fenced(text: string): string[] {
  const body = plain(text);
  const longest = Math.max(
    0,
    ...[...body.matchAll(/`+/g)].map((match) => match[0].length)
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [`${fence}text`, body, fence];
}

function executionsOf(run: Run): Execution[] {
  return (run.scenarios ?? []).flatMap((scenario) => scenario.executions ?? []);
}

/** Client names as the dashboard shows them. */
const CLIENT_NAMES: Record<string, string> = {
  inspector: "Manufact Inspector",
  chatgpt: "chatgpt.com",
  claude: "claude.ai",
  pi: "Pi",
  codex: "Codex CLI",
  "claude-code": "Claude Code",
  cursor: "Cursor CLI",
  "windows-codex": "Codex Desktop (Windows)",
  "android-chatgpt": "ChatGPT (Android)",
  "windows-claude": "Claude Desktop (Windows)",
};

function clientName(client: string): string {
  return CLIENT_NAMES[client] ?? plain(client);
}

/** The model an execution used; web apps use the app's default. */
function modelOf(execution: Execution): string | undefined {
  return WEB_CLIENTS.has(execution.client) || !execution.modelName
    ? undefined
    : plain(execution.modelName);
}

/** ✅ passed, ❌ failed, ➖ cancelled, ⏳ not finished yet. */
function mark(item: { status: string; pass: boolean | null }): string {
  if (!finished(item)) return "⏳";
  if (item.status === "cancelled") return "➖";
  return item.pass === true ? "✅" : "❌";
}

/** A run's or execution's result: its score as a percentage, else its state. */
function outcome(item: {
  status: string;
  pass: boolean | null;
  score: number | null;
}): string {
  if (!finished(item)) return plain(item.status);
  if (item.status === "cancelled") return "cancelled";
  if (item.score !== null) return `${item.score}%`;
  return item.pass === true ? "passed" : "failed";
}

/** A duration in words: 45s, 1m 24s, 1h 02m. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60)
    return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Client, model, result and duration, as the dashboard's run table shows them. */
function executionParts(execution: Execution): string[] {
  return [
    clientName(execution.client),
    modelOf(execution),
    outcome(execution),
    execution.durationMs == null ? undefined : duration(execution.durationMs),
  ].filter((part): part is string => part !== undefined);
}

/** The MCP tool calls an execution made. */
function toolCallsOf(
  execution: Execution
): Array<{ tool: string; args: unknown; isError: boolean }> {
  return list(execution.toolCalls)
    .map(record)
    .filter((call) => typeof call.tool === "string")
    .map((call) => ({
      tool: plain(call.tool),
      args: call.args,
      isError: call.isError === true,
    }));
}

/** The tool calls in a few words: `get_weather ×2, get_forecast ×1 · 1 error`. */
function toolSummary(execution: Execution): string {
  const calls = toolCallsOf(execution);
  if (calls.length === 0) return "no tool calls";
  const counts = new Map<string, number>();
  for (const call of calls)
    counts.set(call.tool, (counts.get(call.tool) ?? 0) + 1);
  const errors = calls.filter((call) => call.isError).length;
  return `${[...counts].map(([tool, n]) => `${tool} ×${n}`).join(", ")}${errors ? ` · ${errors} error${errors === 1 ? "" : "s"}` : ""}`;
}

/** An execution's report in the dashboard; its suite's page when Cloud sent no execution ID. */
function executionUrl(
  dashboardUrl: string,
  suiteId: string,
  executionId: string | undefined
): string {
  const suite = `${dashboardUrl}/${encodeURIComponent(suiteId)}`;
  return executionId
    ? `${suite}?execution=${encodeURIComponent(executionId)}&tab=report`
    : suite;
}

/** The lines `evals run --wait` prints once its runs have started: each suite and its dashboard page. */
export function formatRunsStarted(
  runs: ReadonlyArray<{ suiteId: string }>,
  options: {
    serverName: string;
    dashboardUrl: string;
    branch: string | undefined;
    names: ReadonlyMap<string, string>;
    /** The profile the runs sign in with, when not the server's own. */
    profile?: string | undefined;
  }
): string {
  return [
    `🧪 Running ${runs.length} eval suite${runs.length === 1 ? "" : "s"} on ${plain(options.serverName)} (${options.branch ? `branch ${plain(options.branch)}` : "production"})${options.profile ? ` · profile ${plain(options.profile)}` : ""}`,
    ...runs.flatMap((run) => [
      "",
      `  ${plain(options.names.get(run.suiteId) ?? run.suiteId)}`,
      `  ${options.dashboardUrl}/${encodeURIComponent(run.suiteId)}`,
    ]),
  ].join("\n");
}

/**
 * Live progress for `evals run --wait`, fed every poll: a line as each
 * execution finishes (with why it failed and a link to its report), and a
 * line naming what is still running after `heartbeatMs` without one.
 */
export function createLiveReport(options: {
  names: ReadonlyMap<string, string>;
  dashboardUrl: string;
  startedAt: number;
  heartbeatMs?: number;
}) {
  const heartbeatMs = options.heartbeatMs ?? 60_000;
  const reported = new Set<string>();
  let lastLine = options.startedAt;
  const suiteName = (run: Run) =>
    plain(options.names.get(run.suiteId) ?? run.suiteId);

  return {
    /** Lines for what changed since the last poll. */
    update(runs: readonly Run[], now: number): string[] {
      const lines: string[] = [];
      for (const run of runs) {
        executionsOf(run).forEach((execution, index) => {
          // The execution's ID, else its place in the run.
          const key = `${run.id}:${execution.id || `#${index}`}`;
          if (!finished(execution) || reported.has(key)) return;
          reported.add(key);
          lines.push(
            `${mark(execution)} ${[suiteName(run), ...executionParts(execution)].join(" · ")}`
          );
          if (execution.status === "cancelled" || execution.pass === true)
            return;
          const why = reasons(execution)[0];
          if (why) lines.push(`   ${why}`);
          lines.push(
            `   🔗 ${executionUrl(options.dashboardUrl, run.suiteId, execution.id)}`
          );
        });
      }
      const pending = runs.filter((run) => !finished(run));
      if (lines.length > 0) {
        lastLine = now;
      } else if (pending.length > 0 && now - lastLine >= heartbeatMs) {
        lastLine = now;
        const shown = pending.slice(0, 3).map((run) => {
          const states = [
            ...new Set(
              executionsOf(run)
                .filter((execution) => !finished(execution))
                .map((execution) => plain(execution.status))
            ),
          ];
          return `${suiteName(run)} (${states.length ? states.join(", ") : plain(run.status)})`;
        });
        const more = pending.length - shown.length;
        lines.push(
          `⏳ ${pending.length} still running: ${shown.join(", ")}${more > 0 ? `, and ${more} more` : ""}`
        );
      }
      return lines;
    },
    /** The closing line: how long it took and how many suites passed. */
    summary(runs: readonly Run[], now: number): string {
      const passed = runs.filter((run) => run.pass === true).length;
      const pending = runs.filter((run) => !finished(run)).length;
      const took = duration(now - options.startedAt);
      const tally = `${passed} of ${runs.length} suite${runs.length === 1 ? "" : "s"} passed`;
      return pending > 0
        ? `⏱️ Stopped waiting after ${took} · ${tally}, ${pending} still running`
        : `🏁 Done in ${took} · ${tally}`;
    },
  };
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
 * What went wrong in an execution, most specific first: its error, the tool
 * checks it failed, then the judge's problem titles.
 */
function problems(execution: Execution): string[] {
  if (execution.error) return [firstLine(execution.error)];
  const tools = list(record(execution.toolAssertions).checks)
    .map(record)
    .filter((check) => check.passed === false && typeof check.name === "string")
    .map((check) =>
      check.kind === "forbidden"
        ? `Called disallowed tool ${String(check.name)}`
        : `Missing tool call: ${String(check.name)}`
    );
  const titles = list(record(execution.judgeVerdict).majorProblems)
    .map((problem) => record(problem).title)
    .filter(
      (title): title is string => typeof title === "string" && title !== ""
    )
    .map(firstLine);
  return [...tools, ...titles];
}

/**
 * The judge's assessment in one sentence: the first sentence of its report,
 * which is Markdown that usually opens with a heading.
 */
function judgeSummary(execution: Execution): string | undefined {
  const text = (execution.judgement ?? "")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim())
    .find((line) => line !== "");
  if (!text) return undefined;
  return firstLine(text.split(/(?<=[.!?])\s+/)[0] ?? text);
}

/** Why an execution did not pass: its problems, else the judge's assessment. */
function reasons(execution: Execution): string[] {
  const found = problems(execution);
  if (found.length > 0) return found;
  const judge = judgeSummary(execution);
  return judge ? [judge] : [];
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstLine(text: string): string {
  const line = plain(text).trim().split("\n")[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}
