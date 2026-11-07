import { parseCloudArgs, integer, projectServer } from "../options.js";
import { cloudHelp } from "../help.js";
import { runCommand } from "../../core/command.js";
import { CommandError, UsageError } from "../../core/errors.js";
import { plain, table } from "../../core/format.js";
import type { operations } from "../api/generated/types.gen.js";
import type { Call } from "../api/client.js";

type SqlBody =
  operations["postApiV1ServersByIdAnalyticsSql"]["requestBody"]["content"]["application/json"];
type SqlResult =
  operations["postApiV1ServersByIdAnalyticsSql"]["responses"][200]["content"]["application/json"];
type Branches =
  operations["getApiV1ServersByIdAnalyticsCatalog"]["responses"][200]["content"]["application/json"]["branches"];
const PRESETS = ["1h", "24h", "7d", "30d", "90d"] as const;
const QUERY_ERRORS = new Set([
  "ANALYTICS_QUERY_INVALID",
  "ANALYTICS_SQL_REJECTED",
  "ANALYTICS_SQL_DISABLED",
  "ANALYTICS_QUERY_BUDGET",
  "ANALYTICS_RESULT_TOO_LARGE",
  "ANALYTICS_QUERY_TIMEOUT",
  "ANALYTICS_TIME_RANGE_UNAVAILABLE",
  "ANALYTICS_QUERY_RATE_LIMIT",
  "ANALYTICS_UNAVAILABLE",
]);

/** Discover the live analytics schema or execute scoped, read-only SQL. */
export async function runAnalytics(argv: readonly string[]): Promise<number> {
  const help = cloudHelp("analytics", argv);
  const separator = argv.indexOf("--");
  const optionArgs = separator < 0 ? argv : argv.slice(0, separator);
  if (optionArgs.includes("--help") || optionArgs.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  return runCommand(optionArgs, help, async (output) => {
    const command = argv[0];
    if (command !== "catalog" && command !== "query")
      throw new UsageError(
        "Usage: mcp-use analytics <catalog|query> [options]"
      );
    const querying = command === "query";
    const { values, body } = querying
      ? queryArgs(argv.slice(1))
      : {
          values: parseCloudArgs(
            argv.slice(1),
            { branch: { type: "string" } },
            "mcp-use analytics catalog [options]"
          ).values,
          body: undefined,
        };
    const branch = values.branch?.trim();
    if (branch !== undefined && (branch.length === 0 || branch.length > 255))
      throw new UsageError("--branch must contain 1–255 characters.");
    // Validate all query inputs before resolving credentials or contacting Cloud.
    const { cloud, server } = await projectServer(values);
    const organization = cloud.organization.id;
    const catalogRequest = (branch?: string) =>
      cloud.call(
        cloud.client.GET("/api/v1/servers/{id}/analytics/catalog", {
          params: {
            path: { id: server },
            query: branch === undefined ? {} : { branch },
          },
          signal: AbortSignal.timeout(30_000),
        })
      );
    if (body === undefined) {
      const catalog = await catalogRequest(branch);
      if (branch !== undefined)
        requireBranch(branch, catalog.branches, server, organization);
      // The complete catalog is useful in both modes: columns, SQL expressions,
      // examples, limits, and notes are the query-writing contract.
      output.result(catalog, plain(JSON.stringify(catalog, null, 2)));
      return;
    }
    // Cloud scopes an unknown branch to no rows instead of rejecting it, so a
    // typo would read as zero traffic. Check the catalog's branch list
    // alongside the query; if the lookup itself fails, let the query decide.
    const knownBranches =
      branch === undefined
        ? undefined
        : catalogRequest().then(
            (catalog) => catalog.branches,
            () => undefined
          );
    const pending = queryResult(
      cloud.call,
      cloud.client.POST("/api/v1/servers/{id}/analytics/sql", {
        params: { path: { id: server } },
        body: { ...body, ...(branch === undefined ? {} : { branch }) },
        signal: AbortSignal.timeout(30_000),
      }),
      server,
      organization
    );
    const branches = await knownBranches;
    if (branch !== undefined && branches !== undefined) {
      // The branch error is the root cause, so it wins over a query failure.
      pending.catch(() => {});
      requireBranch(branch, branches, server, organization);
    }
    const result = await pending;
    output.result(result, formatQuery(result));
  });
}

/** Reject a branch that has no analytics, naming the branches that do. */
function requireBranch(
  branch: string,
  branches: Branches,
  server: string,
  organization: string
): void {
  if (branches.some((known) => known.branch === branch)) return;
  const names = branches.map((known) => known.branch);
  throw new CommandError(
    "ANALYTICS_BRANCH_NOT_FOUND",
    `Server ${server} has no analytics for branch "${branch}". ${
      names.length
        ? `Branches with analytics: ${names.join(", ")}.`
        : "No branch has analytics yet."
    } Omit --branch to include all environments.`,
    { branch, branches: names },
    [
      {
        description: "List the branches with analytics",
        command: `mcp-use analytics catalog --server ${server} --org ${organization} --json`,
      },
    ]
  );
}

/** Retain actionable analytics codes while sharing auth/network redaction. */
async function queryResult<T>(
  call: Call,
  pending: Promise<{ data?: T; error?: unknown; response: Response }>,
  server: string,
  organization: string
) {
  let queryCode: string | undefined;
  try {
    return await call(
      pending.then((result) => {
        const error = result.error;
        if (
          !result.response.ok &&
          error !== null &&
          typeof error === "object" &&
          "code" in error &&
          typeof error.code === "string" &&
          QUERY_ERRORS.has(error.code)
        )
          queryCode = error.code;
        return result;
      })
    );
  } catch (error) {
    if (!(error instanceof CommandError)) throw error;
    const nextSteps = error.nextSteps.length
      ? error.nextSteps
      : [
          {
            description:
              "Inspect analytics relations, examples, retention, and query limits",
            command: `mcp-use analytics catalog --server ${server} --org ${organization} --json`,
          },
        ];
    throw new CommandError(
      queryCode ?? error.code,
      error.message,
      undefined,
      nextSteps
    );
  }
}

function queryArgs(argv: readonly string[]) {
  const { values, positionals } = parseCloudArgs(
    argv,
    {
      branch: { type: "string" },
      "time-range": { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      "max-rows": { type: "string" },
      "include-internal": { type: "boolean" },
    },
    'mcp-use analytics query "<sql>" [options]',
    1
  );
  return { values, body: queryBody(positionals[0]!, values) };
}

function queryBody(
  sql: string,
  values: {
    "time-range"?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    "max-rows"?: string | undefined;
    "include-internal"?: boolean | undefined;
  }
): SqlBody {
  sql = sql.trim();
  if (!sql || sql.length > 16_384 || Buffer.byteLength(sql, "utf8") > 16_384)
    throw new UsageError("Pass one quoted SQL query of 1–16384 UTF-8 bytes.");
  const maxRows = integer(values["max-rows"], "--max-rows", 100, 1, 500);
  let timeRange: NonNullable<SqlBody["timeRange"]>;
  if (values.from !== undefined || values.to !== undefined) {
    if (
      values["time-range"] !== undefined ||
      values.from === undefined ||
      values.to === undefined
    )
      throw new UsageError(
        "Pass --from and --to together, without --time-range."
      );
    const from = timestamp(values.from, "--from");
    const to = timestamp(values.to, "--to");
    if (Date.parse(from) >= Date.parse(to) || Date.parse(to) > Date.now())
      throw new UsageError(
        "--from must precede --to, and --to cannot be in the future."
      );
    timeRange = { from, to };
  } else {
    const preset = values["time-range"] ?? "7d";
    if (!PRESETS.includes(preset as (typeof PRESETS)[number]))
      throw new UsageError("--time-range must be 1h, 24h, 7d, 30d, or 90d.");
    timeRange = { preset: preset as (typeof PRESETS)[number] };
  }
  return {
    sql,
    timeRange,
    maxRows,
    includeInternal: values["include-internal"] ?? false,
  };
}

/** Require an unambiguous ISO timestamp and reject normalized invalid dates. */
function timestamp(value: string, flag: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value
    );
  const date = Date.parse(value);
  if (!match || !Number.isFinite(date))
    throw new UsageError(
      `${flag} must be an ISO timestamp with Z or a UTC offset.`
    );
  const [, year, month, day, hour, minute, second = "0", offset] = match;
  const monthEnd = new Date(0);
  monthEnd.setUTCFullYear(Number(year), Number(month), 0);
  const days = monthEnd.getUTCDate();
  if (
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > days ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (offset !== "Z" &&
      (Number(offset!.slice(1, 3)) > 23 || Number(offset!.slice(4)) > 59))
  )
    throw new UsageError(`${flag} must be a valid ISO timestamp.`);
  return new Date(date).toISOString();
}

function formatQuery(result: SqlResult): string {
  const rows = result.rows.map((row) =>
    row.map((cell) =>
      typeof cell === "object" && cell !== null
        ? JSON.stringify(cell)
        : cell === null
          ? "null"
          : cell
    )
  );
  const data = rows.length
    ? table(
        result.columns.map((column) => plain(column.name)),
        rows
      )
    : "No matching retained data.";
  const { rows: _rows, columns: _columns, ...metadata } = result;
  return `${data}\n\n${result.truncated ? "Results truncated. Narrow the query or raise --max-rows (up to 500).\n\n" : ""}${plain(JSON.stringify(metadata, null, 2))}`;
}
