import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { test } from "../helpers/cli-test.js";
import { signIn, SIGNED_IN } from "../helpers/cloud-auth.js";
import { server } from "../helpers/cloud-fixtures.js";
import type { operations } from "../../src/cloud/api/generated/types.gen.js";

type Catalog =
  operations["getApiV1ServersByIdAnalyticsCatalog"]["responses"][200]["content"]["application/json"];
type SqlResult =
  operations["postApiV1ServersByIdAnalyticsSql"]["responses"][200]["content"]["application/json"];

const CATALOG: Catalog = {
  catalogVersion: "1",
  dialect: "clickhouse",
  relations: [
    {
      name: "clients_daily",
      description: "Daily client requests",
      grain: "client, day",
      timeColumn: "bucket",
      ttlDays: 400,
      rowBudget: null,
      columns: [
        {
          name: "events",
          type: "UInt64",
          kind: "sum",
          description: "Use sum(events)",
        },
      ],
    },
  ],
  measures: [],
  dimensions: [],
  segments: [],
  examples: [],
  branches: [{ branch: "feature", subdomain: "weather--br-feature" }],
  limits: { sqlMaxRows: 500 },
  retention: { days: 30, floor: "2026-01-01T00:00:00Z" },
  rawWindowHintDays: 1,
  freshness: null,
  notes: ["Merge stored sketches."],
};
const SQL_RESULT: SqlResult = {
  queryId: "query_1",
  columns: [
    { name: "client", type: "String" },
    { name: "requests", type: "UInt64" },
    { name: "latency", type: "Nullable(Float64)" },
  ],
  rows: [["Claude", "9007199254740993", null]],
  truncated: true,
  statistics: { elapsedMs: 12, rowsRead: 50, bytesRead: 1024 },
  meta: {
    catalogVersion: "1",
    retentionFloor: "2026-01-01T00:00:00Z",
    admissionClass: "light",
    rawWindowHintDays: 1,
    freshness: {
      maxIngestedAt: "2026-01-30T23:59:00Z",
      lagSeconds: 60,
      asOf: "2026-01-31T00:00:00Z",
    },
  },
};

test("catalog resolves a linked non-Node project and returns the full discovery contract", async ({
  cli,
  cloud,
}) => {
  await mkdir(join(cli.cwd, ".manufact"));
  await writeFile(
    join(cli.cwd, ".manufact", "project.json"),
    '{"orgId":"org_1","serverId":"srv_1"}'
  );
  await writeFile(join(cli.cwd, "main.py"), "# Python MCP server\n");
  signIn(cloud);
  cloud.on("GET", "/api/v1/servers/srv_1", { body: server({ id: "srv_1" }) });
  cloud.on("GET", "/api/v1/servers/srv_1/analytics/catalog", { body: CATALOG });
  const result = await cli.run(
    ["analytics", "catalog", "--branch", "feature", "--json"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.json).toEqual(CATALOG);
  expect(
    cloud.requestsTo("GET", "/api/v1/servers/srv_1/analytics/catalog")
  ).toMatchObject([
    {
      query: { branch: "feature" },
      headers: { "x-api-key": "test_key", "x-profile-id": "org_1" },
    },
  ]);
});

test("query resolves a slug and sends SQL with the default scope, preserving integer strings and metadata", async ({
  cli,
  cloud,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/servers/weather", {
    body: server({ id: "srv_1", slug: "weather" }),
  });
  cloud.on("POST", "/api/v1/servers/srv_1/analytics/sql", { body: SQL_RESULT });
  const result = await cli.run(
    [
      "analytics",
      "query",
      " SELECT sum(events) FROM clients_daily ",
      "--server",
      "weather",
      "--json",
    ],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.json).toEqual(SQL_RESULT);
  expect(
    cloud.requestsTo("POST", "/api/v1/servers/srv_1/analytics/sql")
  ).toMatchObject([
    {
      body: {
        sql: "SELECT sum(events) FROM clients_daily",
        timeRange: { preset: "7d" },
        maxRows: 100,
        includeInternal: false,
      },
      headers: { "x-api-key": "test_key", "x-profile-id": "org_1" },
    },
  ]);
  expect(
    cloud.requestsTo("POST", "/api/v1/servers/srv_1/analytics/sql")
  ).toHaveLength(1);
});

test("query normalizes explicit dates to UTC and sends branch, row cap, and internal traffic selection", async ({
  cli,
  cloud,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/servers/weather", { body: server({ id: "srv_1" }) });
  cloud.on("GET", "/api/v1/servers/srv_1/analytics/catalog", { body: CATALOG });
  cloud.on("POST", "/api/v1/servers/srv_1/analytics/sql", { body: SQL_RESULT });
  const result = await cli.run(
    [
      "analytics",
      "query",
      "SELECT 1",
      "--from",
      "2026-01-01T00:00:00-08:00",
      "--to",
      "2026-01-02T00:00:00-08:00",
      "--branch",
      " feature ",
      "--max-rows",
      "500",
      "--include-internal",
      "--json",
    ],
    { env: { ...SIGNED_IN, MANUFACT_SERVER: "weather" } }
  );
  expect(result.exitCode).toBe(0);
  expect(
    cloud.requestsTo("POST", "/api/v1/servers/srv_1/analytics/sql")[0]?.body
  ).toEqual({
    sql: "SELECT 1",
    timeRange: {
      from: "2026-01-01T08:00:00.000Z",
      to: "2026-01-02T08:00:00.000Z",
    },
    branch: "feature",
    maxRows: 500,
    includeInternal: true,
  });
});

test.for([
  ["catalog", "--branch", "featuer"],
  ["query", "SELECT 1", "--branch", "featuer"],
])(
  "an unknown branch fails with the branches that have analytics (%j)",
  async (args, { cli, cloud }) => {
    signIn(cloud);
    cloud.on("GET", "/api/v1/servers/weather", {
      body: server({ id: "srv_1" }),
    });
    cloud.on("GET", "/api/v1/servers/srv_1/analytics/catalog", {
      body: CATALOG,
    });
    cloud.on("POST", "/api/v1/servers/srv_1/analytics/sql", {
      body: { ...SQL_RESULT, rows: [] },
    });
    const result = await cli.run(
      ["analytics", ...args, "--server", "weather", "--json"],
      { env: SIGNED_IN }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.json).toMatchObject({
      error: {
        code: "ANALYTICS_BRANCH_NOT_FOUND",
        nextSteps: [
          {
            command:
              "mcp-use analytics catalog --server srv_1 --org org_1 --json",
          },
        ],
      },
    });
    expect(result.stdout).toContain("feature");
  }
);

test("query still runs when the branch lookup fails", async ({
  cli,
  cloud,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/servers/weather", { body: server({ id: "srv_1" }) });
  cloud.on("GET", "/api/v1/servers/srv_1/analytics/catalog", {
    status: 408,
    body: { error: "Catalog timed out", code: "ANALYTICS_QUERY_TIMEOUT" },
  });
  cloud.on("POST", "/api/v1/servers/srv_1/analytics/sql", { body: SQL_RESULT });
  const result = await cli.run(
    [
      "analytics",
      "query",
      "SELECT 1",
      "--branch",
      "feature",
      "--server",
      "weather",
      "--json",
    ],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toEqual(SQL_RESULT);
  expect(
    cloud.requestsTo("GET", "/api/v1/servers/srv_1/analytics/catalog")
  ).toHaveLength(1);
});

test("query passes a literal leading SQL comment and a chosen preset", async ({
  cli,
  cloud,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/servers/weather", { body: server({ id: "srv_1" }) });
  cloud.on("POST", "/api/v1/servers/srv_1/analytics/sql", { body: SQL_RESULT });
  const result = await cli.run(
    [
      "analytics",
      "query",
      "--server",
      "weather",
      "--time-range",
      "24h",
      "--max-rows",
      "1",
      "--json",
      "--",
      "-- comment\nSELECT 1",
    ],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toEqual(SQL_RESULT);
  expect(
    cloud.requestsTo("POST", "/api/v1/servers/srv_1/analytics/sql")[0]?.body
  ).toEqual({
    sql: "-- comment\nSELECT 1",
    timeRange: { preset: "24h" },
    maxRows: 1,
    includeInternal: false,
  });
});

test.for(["x".repeat(16384), "😀".repeat(4096)])(
  "query accepts the 16384-byte SQL boundary",
  async (sql, { cli, cloud }) => {
    signIn(cloud);
    cloud.on("GET", "/api/v1/servers/weather", {
      body: server({ id: "srv_1" }),
    });
    cloud.on("POST", "/api/v1/servers/srv_1/analytics/sql", {
      body: SQL_RESULT,
    });
    const result = await cli.run(
      ["analytics", "query", sql, "--server", "weather", "--json"],
      { env: SIGNED_IN }
    );
    expect(result.exitCode).toBe(0);
    expect(
      cloud.requestsTo("POST", "/api/v1/servers/srv_1/analytics/sql")[0]?.body
    ).toMatchObject({ sql });
  }
);

test.for([
  [],
  ["other"],
  ["catalog", "extra"],
  ["catalog", "--time-range", "7d"],
  ["catalog", "--branch", " "],
  ["query"],
  ["query", " "],
  ["query", "SELECT 1", "extra"],
  ["query", "SELECT 1", "--unknown"],
  ["query", "x".repeat(16385)],
  ["query", "😀".repeat(4097)],
  ["query", "SELECT 1", "--time-range", "2d"],
  ["query", "SELECT 1", "--max-rows", "0"],
  ["query", "SELECT 1", "--max-rows", "501"],
  ["query", "SELECT 1", "--max-rows", "1.5"],
  ["query", "SELECT 1", "--branch", "x".repeat(256)],
  ["query", "SELECT 1", "--from", "2026-01-01T00:00:00Z"],
  ["query", "SELECT 1", "--to", "2026-01-02T00:00:00Z"],
  [
    "query",
    "SELECT 1",
    "--from",
    "2026-01-01T00:00:00Z",
    "--to",
    "2026-01-02T00:00:00Z",
    "--time-range",
    "7d",
  ],
  ["query", "SELECT 1", "--from", "2026-01-01", "--to", "2026-01-02"],
  [
    "query",
    "SELECT 1",
    "--from",
    "2026-02-30T00:00:00Z",
    "--to",
    "2026-03-01T00:00:00Z",
  ],
  [
    "query",
    "SELECT 1",
    "--from",
    "2026-01-01T24:00:00Z",
    "--to",
    "2026-01-03T00:00:00Z",
  ],
  [
    "query",
    "SELECT 1",
    "--from",
    "2026-01-02T00:00:00Z",
    "--to",
    "2026-01-01T00:00:00Z",
  ],
  [
    "query",
    "SELECT 1",
    "--from",
    "2026-01-01T00:00:00Z",
    "--to",
    "2026-01-01T00:00:00Z",
  ],
  [
    "query",
    "SELECT 1",
    "--from",
    "2026-01-01T00:00:00Z",
    "--to",
    "9999-01-01T00:00:00Z",
  ],
])(
  "invalid analytics arguments fail before any Cloud request (%j)",
  async (args, { cli, cloud }) => {
    const result = await cli.run(
      ["analytics", ...args, "--server", "weather", "--json"],
      { env: SIGNED_IN }
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.json).toMatchObject({ error: { code: "usage_error" } });
    expect(cloud.requests).toEqual([]);
  }
);

test("query requires server context and Cloud authentication", async ({
  cli,
  cloud,
}) => {
  const unlinked = await cli.run(["analytics", "query", "SELECT 1", "--json"], {
    env: SIGNED_IN,
  });
  expect(unlinked.exitCode).toBe(2);
  expect(unlinked.json).toMatchObject({
    error: { code: "project_not_linked" },
  });
  const signedOut = await cli.run([
    "analytics",
    "catalog",
    "--server",
    "weather",
    "--json",
  ]);
  expect(signedOut.exitCode).toBe(1);
  expect(signedOut.json).toMatchObject({
    error: { code: "not_authenticated" },
  });
  expect(cloud.requests).toEqual([]);
});

test.for([
  [400, "validation_error"],
  [403, "forbidden"],
  [429, "rate_limited"],
  [503, "cloud_api_error"],
  [504, "cloud_timeout"],
] as const)(
  "query reports HTTP %s through the CLI error boundary without retrying",
  async ([status, code], { cli, cloud }) => {
    signIn(cloud);
    cloud.on("GET", "/api/v1/servers/weather", {
      body: server({ id: "srv_1" }),
    });
    cloud.sequence("POST", "/api/v1/servers/srv_1/analytics/sql", [
      { status, body: { error: "Query failed", code: "VALIDATION_ERROR" } },
    ]);
    const result = await cli.run(
      ["analytics", "query", "SELECT 1", "--server", "weather", "--json"],
      { env: SIGNED_IN }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.json).toMatchObject({
      error: {
        code,
        nextSteps: [
          {
            command:
              "mcp-use analytics catalog --server srv_1 --org org_1 --json",
          },
        ],
      },
    });
    expect(
      cloud.requestsTo("POST", "/api/v1/servers/srv_1/analytics/sql")
    ).toHaveLength(1);
  }
);

test.for([
  [400, "ANALYTICS_SQL_REJECTED"],
  [422, "ANALYTICS_QUERY_BUDGET"],
  [429, "ANALYTICS_QUERY_RATE_LIMIT"],
  [503, "ANALYTICS_UNAVAILABLE"],
] as const)(
  "query retains %s analytics errors and redacts credentials",
  async ([status, code], { cli, cloud }) => {
    signIn(cloud);
    cloud.on("GET", "/api/v1/servers/weather", {
      body: server({ id: "srv_1" }),
    });
    cloud.sequence("POST", "/api/v1/servers/srv_1/analytics/sql", [
      { status, body: { error: "Query failed for test_key", code } },
    ]);
    const result = await cli.run(
      ["analytics", "query", "SELECT 1", "--server", "weather", "--json"],
      { env: SIGNED_IN }
    );
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({ error: { code } });
    expect(result.stdout).not.toContain("test_key");
    expect(result.stdout).toContain("[REDACTED]");
    expect(
      cloud.requestsTo("POST", "/api/v1/servers/srv_1/analytics/sql")
    ).toHaveLength(1);
  }
);

test("human query output shows values, truncation, and query metadata", async ({
  cli,
  cloud,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/servers/weather", { body: server({ id: "srv_1" }) });
  cloud.on("POST", "/api/v1/servers/srv_1/analytics/sql", { body: SQL_RESULT });
  const result = await cli.run(
    ["analytics", "query", "SELECT 1", "--server", "weather"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  for (const text of [
    "Claude",
    "9007199254740993",
    "null",
    "Results truncated",
    "query_1",
    "retentionFloor",
    "lagSeconds",
  ])
    expect(result.stdout).toContain(text);
});
