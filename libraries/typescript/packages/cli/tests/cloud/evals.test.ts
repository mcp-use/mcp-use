import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test as unit } from "vitest";

import {
  parseEvalSuiteFile,
  suiteBody,
  suiteFile,
  toYaml,
} from "../../src/cloud/evals/config.js";
import { createLiveReport, elapsed } from "../../src/cloud/evals/output.js";
import type { operations } from "../../src/cloud/api/generated/types.gen.js";
import { test } from "../helpers/cli-test.js";
import { signIn, SIGNED_IN } from "../helpers/cloud-auth.js";
import { server as serverFixture } from "../helpers/cloud-fixtures.js";
import type { FakeCloud } from "../helpers/fake-cloud.js";

type Suite =
  operations["getApiV1ServerEvalsByServerIdSuites"]["responses"][200]["content"]["application/json"][number];
type Run =
  operations["getApiV1ServerEvalsByServerIdRunsByRunId"]["responses"][200]["content"]["application/json"];

const SCOPE = ["--server", "weather", "--json"];
const SUITES = "/api/v1/server-evals/srv_1/suites";

function server(cloud: FakeCloud): void {
  signIn(cloud);
  cloud.on("GET", "/api/v1/servers/weather", {
    body: serverFixture({
      id: "srv_1",
      slug: "weather",
      name: "Weather",
      organizationId: "org_1",
    }),
  });
}

function suite(fields: Pick<Suite, "id" | "name"> & Partial<Suite>): Suite {
  return {
    enabled: true,
    threshold: 0.7,
    prompt: null,
    flow: [{ kind: "user", content: "Weather in Rome?" }],
    requiredTools: [],
    rubric: null,
    models: ["openai/gpt-5"],
    disallowedTools: [],
    clientTargets: ["inspector"],
    clientSettings: {},
    runs: [],
    ...fields,
  };
}

function run(fields: Pick<Run, "id" | "suiteId"> & Partial<Run>): Run {
  return {
    status: "complete",
    pass: true,
    score: 90,
    serverUrl: "https://weather.run.mcp-use.com/mcp",
    createdAt: "2026-11-17T00:00:00Z",
    scenarios: [],
    ...fields,
  };
}

const ROME = `name: Rome weather
flow:
  - kind: user
    content: What's the weather in Rome?
  - kind: tool_call
    name: get_weather
    args: { city: { contains: rome } }
`;

const CHECKOUT = `name: Checkout
flow:
  - kind: user
    content: Buy a shirt
rubric: Confirms the order.
threshold: 0.8
clients:
  inspector: { models: [anthropic/claude-sonnet-5.5] }
  runtimes: [{ harness: claude-code, model: anthropic/claude-sonnet-5.5 }]
  claude: true
disallowedTools: [delete_account]
`;

describe("evals push", () => {
  test("creates new suites, replaces suites matched by name, and reports invalid files", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    const dir = join(cli.cwd, "evals");
    await mkdir(dir);
    await writeFile(join(dir, "rome.yaml"), ROME);
    await writeFile(join(dir, "checkout.yml"), CHECKOUT);
    await writeFile(join(dir, "broken.yaml"), "name: Broken\nflow: []\n");
    await writeFile(join(dir, "notes.txt"), "ignored");
    cloud.on("GET", SUITES, {
      body: [
        suite({
          id: "suite_checkout",
          name: "Checkout",
          rubric: "Old rubric",
          clientSettings: { lifecycle: { kind: "plugin" }, judge: {} },
        }),
      ],
    });
    cloud.on("GET", "/api/v1/models", {
      body: {
        defaultModelId: "openai/gpt-5",
        models: [{ id: "openai/gpt-5", name: "GPT-5", provider: "openai" }],
      },
    });
    cloud.on("POST", SUITES, {
      body: { id: "suite_rome", name: "Rome weather" },
    });
    cloud.on("PATCH", `${SUITES}/suite_checkout`, {
      body: { id: "suite_checkout", name: "Checkout" },
    });

    const result = await cli.run(["evals", "push", "evals", ...SCOPE], {
      env: SIGNED_IN,
    });

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      dashboardUrl: expect.stringMatching(
        /\/cloud\/org-one\/servers\/srv_1\/evals\/suites$/
      ),
      results: [
        {
          path: join("evals", "broken.yaml"),
          error: expect.stringContaining("flow"),
        },
        {
          path: join("evals", "checkout.yml"),
          action: "updated",
          suiteId: "suite_checkout",
        },
        {
          path: join("evals", "rome.yaml"),
          action: "created",
          suiteId: "suite_rome",
        },
      ],
    });
    expect(cloud.requestsTo("POST", SUITES).map((r) => r.body)).toEqual([
      {
        name: "Rome weather",
        flow: [
          { kind: "user", content: "What's the weather in Rome?" },
          {
            kind: "tool_call",
            name: "get_weather",
            args: { city: { contains: "rome" } },
          },
        ],
        threshold: 0.7,
        disallowedTools: [],
        models: ["openai/gpt-5"],
        clientTargets: ["inspector"],
        clientSettings: {
          inspector: { modelIds: ["openai/gpt-5"], disallowedToolNames: [] },
        },
      },
    ]);
    // A file is the whole definition: the old rubric is cleared, and settings
    // a file cannot express (lifecycle) are kept.
    expect(
      cloud.requestsTo("PATCH", `${SUITES}/suite_checkout`).map((r) => r.body)
    ).toEqual([
      {
        name: "Checkout",
        flow: [{ kind: "user", content: "Buy a shirt" }],
        rubric: "Confirms the order.",
        threshold: 0.8,
        enabled: true,
        disallowedTools: ["delete_account"],
        models: ["anthropic/claude-sonnet-5.5"],
        clientTargets: ["inspector", "claude", "claude-code"],
        clientSettings: {
          lifecycle: { kind: "plugin" },
          judge: {},
          inspector: {
            modelIds: ["anthropic/claude-sonnet-5.5"],
            disallowedToolNames: ["delete_account"],
          },
          runtime: {
            executors: [
              { harness: "claude-code", model: "anthropic/claude-sonnet-5.5" },
            ],
          },
        },
      },
    ]);
  });

  test("clears an omitted rubric and disables a new suite marked disabled", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    await writeFile(
      join(cli.cwd, "a.yaml"),
      `${CHECKOUT.replace("rubric: Confirms the order.\n", "")}enabled: false\n`
    );
    cloud.on("GET", SUITES, { body: [] });
    cloud.on("POST", SUITES, { body: { id: "suite_new", name: "Checkout" } });
    cloud.on("PATCH", `${SUITES}/suite_new`, {
      body: { id: "suite_new", name: "Checkout" },
    });

    const result = await cli.run(["evals", "push", "a.yaml", ...SCOPE], {
      env: SIGNED_IN,
    });

    expect(result.exitCode).toBe(0);
    expect(cloud.requestsTo("POST", SUITES)[0]?.body).not.toHaveProperty(
      "rubric"
    );
    expect(
      cloud.requestsTo("PATCH", `${SUITES}/suite_new`).map((r) => r.body)
    ).toEqual([{ enabled: false }]);
  });

  test("refuses to guess between suites that share a name", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    await writeFile(join(cli.cwd, "rome.yaml"), ROME);
    cloud.on("GET", SUITES, {
      body: [
        suite({ id: "suite_1", name: "Rome weather" }),
        suite({ id: "suite_2", name: "Rome weather" }),
      ],
    });

    const result = await cli.run(["evals", "push", "rome.yaml", ...SCOPE], {
      env: SIGNED_IN,
    });

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      results: [{ error: expect.stringContaining("evals update <suite-id>") }],
    });
  });

  test("fails before contacting Cloud when a path is missing", async ({
    cli,
  }) => {
    const result = await cli.run(["evals", "push", "missing", ...SCOPE], {
      env: SIGNED_IN,
    });

    expect(result.exitCode).toBe(2);
    expect(result.json).toMatchObject({
      error: { message: "No such file or directory: missing" },
    });
  });
});

test("evals create refuses a name that already exists", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  await writeFile(join(cli.cwd, "rome.yaml"), ROME);
  cloud.on("GET", SUITES, {
    body: [suite({ id: "suite_1", name: "Rome weather" })],
  });

  const result = await cli.run(
    ["evals", "create", "--file", "rome.yaml", ...SCOPE],
    { env: SIGNED_IN }
  );

  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    error: {
      code: "eval_suite_exists",
      nextSteps: [{ command: "mcp-use evals update suite_1 --file rome.yaml" }],
    },
  });
});

test("evals update replaces the suite it names, including its name", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  await writeFile(join(cli.cwd, "rome.yaml"), ROME);
  cloud.on("GET", SUITES, {
    body: [suite({ id: "suite_1", name: "Old name" })],
  });
  cloud.on("GET", "/api/v1/models", {
    body: { defaultModelId: "openai/gpt-5", models: [] },
  });
  cloud.on("PATCH", `${SUITES}/suite_1`, {
    body: { id: "suite_1", name: "Rome weather" },
  });

  const result = await cli.run(
    ["evals", "update", "old NAME", "--file", "rome.yaml", ...SCOPE],
    { env: SIGNED_IN }
  );

  expect(result.exitCode).toBe(0);
  expect(result.json).toMatchObject({ id: "suite_1", name: "Rome weather" });
  expect(cloud.requestsTo("PATCH", `${SUITES}/suite_1`)[0]?.body).toMatchObject(
    { name: "Rome weather", rubric: null }
  );
});

test("evals export writes a file that push accepts", async ({ cloud, cli }) => {
  server(cloud);
  cloud.on("GET", SUITES, {
    body: [
      suite({
        id: "suite_1",
        name: "Legacy",
        // Saved before flows existed: one prompt and its required tools.
        flow: [],
        prompt: "Weather in Rome?",
        requiredTools: [{ name: "get_weather", args: { city: "Rome" } }],
        clientTargets: ["inspector", "chatgpt", "claude", "pi"],
        clientSettings: {
          inspector: { modelIds: ["openai/gpt-5"], disallowedToolNames: ["x"] },
          web: {
            claude: {
              models: [
                { id: "claude-sonnet-5.5", name: "Sonnet" },
                { id: "claude-opus-5.5", name: "Opus" },
              ],
            },
          },
          runtime: {
            executors: [
              { harness: "pi", model: "openai/gpt-5", provider: "openrouter" },
            ],
          },
        },
        enabled: false,
      }),
    ],
  });

  const result = await cli.run(
    ["evals", "export", "suite_1", "--out", "legacy.yaml", ...SCOPE],
    { env: SIGNED_IN }
  );

  expect(result.exitCode).toBe(0);
  const yaml = await readFile(join(cli.cwd, "legacy.yaml"), "utf8");
  expect(yaml).toBe(`name: Legacy
flow:
  - kind: user
    content: Weather in Rome?
  - kind: tool_call
    name: get_weather
    args:
      city: Rome
threshold: 0.7
clients:
  inspector:
    models:
      - openai/gpt-5
  runtimes:
    - harness: pi
      model: openai/gpt-5
      provider: openrouter
  chatgpt: true
  claude:
    models:
      - claude-sonnet-5.5
      - claude-opus-5.5
disallowedTools:
  - x
enabled: false
`);
  expect(parseEvalSuiteFile(yaml, "legacy.yaml")).toMatchObject({
    name: "Legacy",
    enabled: false,
  });
});

describe("evals run", () => {
  test("--all --wait runs enabled suites and exits 1 unless every run passes", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    cloud.on("GET", SUITES, {
      body: [
        suite({ id: "suite_1", name: "One" }),
        suite({ id: "suite_off", name: "Off", enabled: false }),
      ],
    });
    cloud.on("POST", `${SUITES}/suite_1/runs`, {
      body: {
        id: "run_1",
        suiteId: "suite_1",
        status: "pending",
        pass: null,
        score: null,
      },
    });
    let polls = 0;
    cloud.on("GET", "/api/v1/server-evals/srv_1/runs/run_1", () => ({
      body:
        ++polls === 1
          ? run({
              id: "run_1",
              suiteId: "suite_1",
              status: "running",
              pass: null,
              score: null,
            })
          : run({
              id: "run_1",
              suiteId: "suite_1",
              status: "complete",
              pass: false,
              score: 40,
              scenarios: [
                {
                  executions: [
                    {
                      client: "inspector",
                      modelName: "openai/gpt-5",
                      status: "complete",
                      pass: false,
                      score: 40,
                      error: null,
                      judgement: "Never called get_weather.",
                      judgeVerdict: null,
                      toolAssertions: null,
                    },
                  ],
                },
              ],
            }),
    }));

    const result = await cli.run(
      ["evals", "run", "--all", "--wait", "--branch", "preview", ...SCOPE],
      { env: { ...SIGNED_IN, MCP_USE_POLL_INTERVAL_MS: "0" } }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.json).toMatchObject({
      runs: [{ id: "run_1", pass: false, score: 40 }],
    });
    expect(cloud.requestsTo("POST", `${SUITES}/suite_1/runs`)).toMatchObject([
      { query: { branch: "preview" } },
    ]);
  });

  test("report prints each client's result and why it failed", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    cloud.on("GET", "/api/v1/server-evals/srv_1/runs/run_1", {
      body: run({
        id: "run_1",
        suiteId: "suite_1",
        pass: false,
        score: 40,
        scenarios: [
          {
            executions: [
              {
                client: "claude-code",
                modelName: "anthropic/claude-sonnet-5.5",
                status: "complete",
                pass: false,
                score: 40,
                error: null,
                judgement:
                  "# Weather task assessment\n\n## Outcome\n\nScore: 0.4.",
                judgeVerdict: {
                  score: 0.4,
                  majorProblems: [
                    { title: "Weather result contradicts the rubric" },
                  ],
                },
                toolAssertions: {
                  checks: [
                    { kind: "required", name: "get_weather", passed: false },
                    { kind: "forbidden", name: "delete_city", passed: false },
                  ],
                },
              },
              {
                client: "inspector",
                modelName: "openai/gpt-5",
                status: "complete",
                pass: false,
                score: 20,
                error: null,
                judgement: "# Assessment\n\n- The answer ignored the rubric.",
                judgeVerdict: null,
                toolAssertions: null,
              },
              {
                client: "chatgpt",
                modelName: null,
                status: "failed",
                pass: null,
                score: null,
                error: "Browser session expired\nstack…",
                judgement: null,
                judgeVerdict: null,
                toolAssertions: null,
              },
            ],
          },
        ],
      }),
    });

    const result = await cli.run(
      ["evals", "report", "run_1", "--server", "weather"],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "Run run_1: Failed (40)",
        "Target: https://weather.run.mcp-use.com/mcp",
        "  FAIL 40  claude-code anthropic/claude-sonnet-5.5",
        "    Missing tool call: get_weather",
        "    Called disallowed tool delete_city",
        "    Weather result contradicts the rubric",
        "  FAIL 20  inspector openai/gpt-5",
        "    The answer ignored the rubric.",
        "  FAIL  chatgpt",
        "    Browser session expired",
        "",
      ].join("\n")
    );
  });

  test("--wait stops at a cancelled run and does not count it as passing", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    cloud.on("GET", SUITES, {
      body: [suite({ id: "suite_1", name: "Rome weather" })],
    });
    cloud.on("POST", `${SUITES}/suite_1/runs`, {
      body: {
        id: "run_1",
        suiteId: "suite_1",
        status: "running",
        pass: null,
        score: null,
      },
    });
    cloud.on("GET", "/api/v1/server-evals/srv_1/runs/run_1", {
      body: run({
        id: "run_1",
        suiteId: "suite_1",
        status: "cancelled",
        pass: null,
        score: null,
        scenarios: [
          {
            executions: [
              {
                client: "inspector",
                modelName: "openai/gpt-5",
                status: "cancelled",
                pass: null,
                score: null,
                error: "Run cancelled",
                judgement: null,
                judgeVerdict: null,
                toolAssertions: null,
              },
            ],
          },
        ],
      }),
    });

    const result = await cli.run(
      ["evals", "run", "suite_1", "--wait", "--server", "weather"],
      { env: { ...SIGNED_IN, MCP_USE_POLL_INTERVAL_MS: "0" } }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Run run_1: Cancelled\n");
    expect(result.stdout).toContain(
      "  cancelled  inspector openai/gpt-5\n    Run cancelled"
    );
    expect(
      cloud.requestsTo("GET", "/api/v1/server-evals/srv_1/runs/run_1")
    ).toHaveLength(1);
  });

  test("needs suite IDs or --all", async ({ cli }) => {
    const result = await cli.run(["evals", "run", ...SCOPE], {
      env: SIGNED_IN,
    });
    expect(result.exitCode).toBe(2);
  });

  test("--json-file and --markdown-file write the results next to the readable report", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    cloud.on("GET", SUITES, {
      body: [
        suite({ id: "suite_1", name: "Rome weather" }),
        suite({ id: "suite_2", name: "Checkout | cart" }),
      ],
    });
    for (const id of ["1", "2"])
      cloud.on("POST", `${SUITES}/suite_${id}/runs`, {
        body: {
          id: `run_${id}`,
          suiteId: `suite_${id}`,
          status: "running",
          pass: null,
          score: null,
        },
      });
    cloud.on("GET", "/api/v1/server-evals/srv_1/runs/run_1", {
      body: run({
        id: "run_1",
        suiteId: "suite_1",
        score: 100,
        scenarios: [
          {
            executions: [
              {
                client: "inspector",
                modelName: "openai/gpt-5",
                status: "complete",
                pass: true,
                score: 100,
                error: null,
                judgement: null,
                judgeVerdict: null,
                toolAssertions: null,
              },
            ],
          },
        ],
      }),
    });
    cloud.on("GET", "/api/v1/server-evals/srv_1/runs/run_2", {
      body: run({
        id: "run_2",
        suiteId: "suite_2",
        pass: false,
        score: 0,
        scenarios: [
          {
            executions: [
              {
                client: "claude-code",
                modelName: "anthropic/claude-haiku-5.5",
                status: "complete",
                pass: false,
                score: 0,
                error: null,
                judgement: null,
                judgeVerdict: null,
                toolAssertions: {
                  checks: [
                    { kind: "required", name: "checkout", passed: false },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });

    const result = await cli.run(
      [
        "evals",
        "run",
        "--all",
        "--wait",
        "--branch",
        "feat/cart",
        "--json-file",
        "evals.json",
        "--markdown-file",
        "evals.md",
        "--server",
        "weather",
      ],
      { env: { ...SIGNED_IN, MCP_USE_POLL_INTERVAL_MS: "0" } }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Run run_2: Failed (0)");
    const json = JSON.parse(
      await readFile(join(cli.cwd, "evals.json"), "utf8")
    );
    expect(json).toMatchObject({
      runs: [
        { id: "run_1", pass: true },
        { id: "run_2", pass: false },
      ],
      dashboardUrl: expect.stringContaining("/servers/srv_1/evals/suites"),
    });
    const markdown = await readFile(join(cli.cwd, "evals.md"), "utf8");
    const suites = json.dashboardUrl as string;
    expect(markdown).toContain(
      [
        "## Manufact Evals · Weather",
        "",
        "Branch `feat/cart` · 2 suites · ✅ 1 passed · ❌ 1 failed",
        "",
        "Target `https://weather.run.mcp-use.com/mcp`",
        "",
        "| Suite | Result | Score | Executions |",
        "| :-- | :-- | :-- | :-- |",
        `| [Rome weather](${suites}/suite_1) | ✅ Passed | 100 | 1/1 passed |`,
        `| [Checkout \\| cart](${suites}/suite_2) | ❌ Failed | 0 | 0/1 passed |`,
      ].join("\n")
    );
    expect(markdown).toContain(
      "<details><summary>✅ <b>Rome weather</b> · Passed (100)</summary>"
    );
    expect(markdown).toContain(
      [
        "<details open><summary>❌ <b>Checkout | cart</b> · Failed (0)</summary>",
        "",
        "| Client | Model | Result | Score |",
        "| :-- | :-- | :-- | :-- |",
        "| claude-code | anthropic/claude-haiku-5.5 | ❌ Fail | 0 |",
        "",
        "**claude-code anthropic/claude-haiku-5.5**",
        "",
        "- Missing tool call: checkout",
      ].join("\n")
    );
  });

  test("--timeout still writes the files, then fails with the runs left", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    cloud.on("GET", SUITES, {
      body: [suite({ id: "suite_1", name: "Rome weather" })],
    });
    cloud.on("POST", `${SUITES}/suite_1/runs`, {
      body: {
        id: "run_1",
        suiteId: "suite_1",
        status: "running",
        pass: null,
        score: null,
      },
    });
    cloud.on("GET", "/api/v1/server-evals/srv_1/runs/run_1", {
      body: run({
        id: "run_1",
        suiteId: "suite_1",
        status: "running",
        pass: null,
        score: null,
      }),
    });

    const result = await cli.run(
      [
        "evals",
        "run",
        "suite_1",
        "--wait",
        "--timeout",
        "1",
        "--json-file",
        "evals.json",
        "--markdown-file",
        "evals.md",
        ...SCOPE,
      ],
      { env: { ...SIGNED_IN, MCP_USE_POLL_INTERVAL_MS: "300" } }
    );

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      error: { code: "eval_wait_timeout" },
    });
    expect(
      JSON.parse(await readFile(join(cli.cwd, "evals.json"), "utf8"))
    ).toMatchObject({ runs: [{ id: "run_1", status: "running" }] });
    const markdown = await readFile(join(cli.cwd, "evals.md"), "utf8");
    expect(markdown).toContain("Production · 1 suite · ⏳ 1 still running");
    expect(markdown).toContain("**Timed out waiting for 1 run.**");
  });

  test("--markdown-file needs --wait", async ({ cli }) => {
    const result = await cli.run(
      ["evals", "run", "--all", "--markdown-file", "evals.md", ...SCOPE],
      { env: SIGNED_IN }
    );
    expect(result.exitCode).toBe(2);
  });

  test("a failed start names the runs that already started", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    cloud.on("GET", SUITES, {
      body: [
        suite({ id: "suite_1", name: "Rome weather" }),
        suite({ id: "suite_2", name: "Checkout" }),
      ],
    });
    cloud.on("POST", `${SUITES}/suite_1/runs`, {
      body: {
        id: "run_1",
        suiteId: "suite_1",
        status: "running",
        pass: null,
        score: null,
      },
    });
    cloud.on("POST", `${SUITES}/suite_2/runs`, {
      status: 403,
      body: { error: "Out of eval credits", code: "INSUFFICIENT_CREDITS" },
    });

    const result = await cli.run(
      ["evals", "run", "--all", "--wait", ...SCOPE],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      error: {
        message: expect.stringMatching(
          /Could not start “Checkout”: .*Out of eval credits[\s\S]*Already started, still running on Cloud: run_1 \(Rome weather\)\./
        ),
        nextSteps: [{ command: "mcp-use evals report run_1" }],
      },
    });
  });
});

describe("evals run --wait live progress", () => {
  function execution(
    fields: Partial<
      NonNullable<NonNullable<Run["scenarios"]>[number]["executions"]>[number]
    >
  ) {
    return {
      client: "inspector",
      modelName: "openai/gpt-5",
      status: "running",
      pass: null,
      score: null,
      error: null,
      judgement: null,
      judgeVerdict: null,
      toolAssertions: null,
      ...fields,
    };
  }
  const names = new Map([
    ["suite_1", "Rome weather"],
    ["suite_2", "Paris forecast"],
  ]);

  unit("prints each execution once as it finishes, and why it failed", () => {
    const live = createLiveReport({ names, startedAt: 0 });
    const running = [
      run({
        id: "run_1",
        suiteId: "suite_1",
        status: "running",
        pass: null,
        score: null,
        scenarios: [
          {
            executions: [
              execution({}),
              execution({ client: "chatgpt", modelName: null }),
            ],
          },
        ],
      }),
    ];
    expect(live.update(running, 5_000)).toEqual([]);

    const later = [
      run({
        id: "run_1",
        suiteId: "suite_1",
        status: "running",
        pass: null,
        score: null,
        scenarios: [
          {
            executions: [
              execution({ status: "complete", pass: true, score: 100 }),
              execution({
                client: "chatgpt",
                modelName: null,
                status: "complete",
                pass: false,
                score: 40,
                toolAssertions: {
                  checks: [
                    { kind: "required", name: "get_weather", passed: false },
                  ],
                },
              }),
            ],
          },
        ],
      }),
    ];
    expect(live.update(later, 34_000)).toEqual([
      "[0:34] ✓ Rome weather · inspector openai/gpt-5 · pass 100",
      "[0:34] ✗ Rome weather · chatgpt · fail 40",
      "         Missing tool call: get_weather",
    ]);
    // Already reported: nothing new on the next poll.
    expect(live.update(later, 39_000)).toEqual([]);
  });

  unit("names what is still running after a quiet minute", () => {
    const live = createLiveReport({ names, startedAt: 0 });
    const runs = [
      run({
        id: "run_1",
        suiteId: "suite_1",
        status: "running",
        pass: null,
        score: null,
        scenarios: [{ executions: [execution({ status: "judging" })] }],
      }),
      run({
        id: "run_2",
        suiteId: "suite_2",
        status: "running",
        pass: null,
        score: null,
      }),
    ];
    expect(live.update(runs, 59_000)).toEqual([]);
    expect(live.update(runs, 60_000)).toEqual([
      "[1:00] … 2 running (Rome weather: judging; Paris forecast: running)",
    ]);
    expect(live.update(runs, 65_000)).toEqual([]);
    expect(live.summary(runs, 3_725_000)).toBe(
      "Stopped waiting after 1:02:05 · 0 of 2 suites passed, 2 still running"
    );
  });

  unit("formats elapsed time", () => {
    expect(elapsed(0)).toBe("0:00");
    expect(elapsed(72_400)).toBe("1:12");
    expect(elapsed(3_600_000)).toBe("1:00:00");
  });

  test("streams run links and results before the full report, and stays silent with --json", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    cloud.on("GET", SUITES, {
      body: [suite({ id: "suite_1", name: "Rome weather" })],
    });
    cloud.on("POST", `${SUITES}/suite_1/runs`, {
      body: {
        id: "run_1",
        suiteId: "suite_1",
        status: "running",
        pass: null,
        score: null,
      },
    });
    cloud.on("GET", "/api/v1/server-evals/srv_1/runs/run_1", {
      body: run({
        id: "run_1",
        suiteId: "suite_1",
        score: 100,
        scenarios: [
          {
            executions: [
              execution({ status: "complete", pass: true, score: 100 }),
            ],
          },
        ],
      }),
    });
    const env = { ...SIGNED_IN, MCP_USE_POLL_INTERVAL_MS: "0" };

    const human = await cli.run(
      ["evals", "run", "suite_1", "--wait", "--server", "weather"],
      { env }
    );

    expect(human.exitCode).toBe(0);
    const lines = human.stdout.split("\n");
    expect(lines[0]).toBe("Started 1 eval run on Weather (production)");
    expect(lines[1]).toMatch(
      /^ {2}Rome weather {2}https:\/\/.*\/servers\/srv_1\/evals\/suites\/suite_1$/
    );
    const event = lines.findIndex((line) =>
      /^\[0:0\d\] ✓ Rome weather · inspector openai\/gpt-5 · pass 100$/.test(
        line
      )
    );
    const done = lines.findIndex((line) =>
      /^Done in 0:0\d · 1 of 1 suite passed$/.test(line)
    );
    const report = lines.indexOf("Run run_1: Passed (100)");
    expect(event).toBeGreaterThan(1);
    expect(done).toBeGreaterThan(event);
    expect(report).toBeGreaterThan(done);

    const json = await cli.run(
      ["evals", "run", "suite_1", "--wait", ...SCOPE],
      { env }
    );
    expect(json.exitCode).toBe(0);
    expect(json.stdout.trim().split("\n")).toHaveLength(1);
    expect(json.json).toMatchObject({ runs: [{ id: "run_1", pass: true }] });
  });
});

test("evals models ignores an organization saved for another credential", async ({
  cloud,
  cli,
}) => {
  // A login saved for another account or Cloud, while MANUFACT_TOKEN supplies the key.
  await mkdir(join(cli.home, ".manufact"), { recursive: true });
  await writeFile(
    join(cli.home, ".manufact", "auth.json"),
    JSON.stringify({ apiKey: "mcp_saved", orgId: "org_elsewhere" })
  );
  signIn(cloud);
  cloud.on("GET", "/api/v1/models", {
    body: {
      defaultModelId: "openai/gpt-5",
      models: [{ id: "openai/gpt-5", name: "GPT-5", provider: "openai" }],
    },
  });

  const result = await cli.run(["evals", "models", "--json"], {
    env: SIGNED_IN,
  });

  expect(result.exitCode).toBe(0);
  expect(result.json).toMatchObject({ models: [{ id: "openai/gpt-5" }] });
  expect(cloud.requestsTo("GET", "/api/v1/models")).toMatchObject([
    { headers: { "x-api-key": "test_key", "x-profile-id": "org_1" } },
  ]);
});

test("evals export reports a path it cannot write", async ({ cloud, cli }) => {
  server(cloud);
  cloud.on("GET", SUITES, {
    body: [suite({ id: "suite_1", name: "Rome weather" })],
  });

  const result = await cli.run(
    ["evals", "export", "suite_1", "--out", "missing/dir/x.yaml", ...SCOPE],
    { env: SIGNED_IN }
  );

  expect(result.exitCode).toBe(1);
  expect(result.json).toEqual({
    error: {
      code: "write_failed",
      message: "Could not write missing/dir/x.yaml: ENOENT.",
      nextSteps: [],
    },
  });
});

const RUNTIME_OPTIONS = {
  webModels: {
    chatgpt: [],
    claude: [
      { id: "claude-sonnet-5.5", name: "Sonnet 5.5" },
      { id: "claude-haiku-5.5", name: "Haiku 5.5" },
    ],
  },
  captureClients: [
    { id: "claude" as const, available: false, reason: "Enabled on request." },
  ],
  harnesses: [
    {
      id: "pi" as const,
      available: true,
      reason: null,
      models: [
        ...Array.from({ length: 11 }, (_, i) => ({
          provider: "openrouter" as const,
          model: `vendor/model-${i}`,
          label: `Model ${i}`,
        })),
        {
          provider: "openrouter" as const,
          model: "anthropic/claude-haiku-5.5",
          label: "Claude Haiku 5.5",
        },
      ],
    },
    {
      id: "codex" as const,
      available: true,
      reason: null,
      models: [
        {
          provider: "openrouter" as const,
          model: "openai/gpt-5",
          label: "GPT-5",
        },
      ],
    },
  ],
};

describe("evals options", () => {
  test("lists the first models of each runtime", async ({ cloud, cli }) => {
    server(cloud);
    cloud.on("GET", "/api/v1/server-evals/srv_1/runtime-options", {
      body: RUNTIME_OPTIONS,
    });

    const result = await cli.run(["evals", "options", "--server", "weather"], {
      env: SIGNED_IN,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "  claude  Unavailable: Enabled on request.\n    claude-sonnet-5.5  Sonnet 5.5"
    );
    expect(result.stdout).toContain("    vendor/model-9  provider: openrouter");
    expect(result.stdout).not.toContain("vendor/model-10");
    expect(result.stdout).toContain(
      "    … 2 more (filter with --harness or --query)"
    );
  });

  test("--harness and --query list every match", async ({ cloud, cli }) => {
    server(cloud);
    cloud.on("GET", "/api/v1/server-evals/srv_1/runtime-options", {
      body: RUNTIME_OPTIONS,
    });

    const all = await cli.run(
      ["evals", "options", "--harness", "pi", "--server", "weather"],
      { env: SIGNED_IN }
    );
    const query = await cli.run(
      ["evals", "options", "--query", "HAIKU", "--server", "weather"],
      { env: SIGNED_IN }
    );
    const json = await cli.run(
      ["evals", "options", "--query", "gpt", "--server", "weather", "--json"],
      { env: SIGNED_IN }
    );
    const none = await cli.run(
      ["evals", "options", "--query", "nothing", "--server", "weather"],
      { env: SIGNED_IN }
    );

    expect(all.stdout).toContain("    vendor/model-10  provider: openrouter");
    expect(all.stdout).not.toContain("codex");
    expect(all.stdout).not.toContain("Web apps");
    expect(all.stdout).not.toContain("Inspector");
    expect(query.stdout).toBe(
      [
        "Web apps (clients.chatgpt, clients.claude)",
        "  claude  Unavailable: Enabled on request.",
        "    claude-haiku-5.5  Haiku 5.5",
        "",
        "Harnesses (clients.runtimes)",
        "  pi  Ready",
        "    anthropic/claude-haiku-5.5  provider: openrouter",
        "",
      ].join("\n")
    );
    expect(json.json).toMatchObject({
      harnesses: [{ id: "codex", models: [{ model: "openai/gpt-5" }] }],
    });
    expect(none.stdout).toBe("No models match “nothing”.\n");
  });

  test("rejects an unknown --harness before contacting Cloud", async ({
    cli,
  }) => {
    const result = await cli.run(
      ["evals", "options", "--harness", "gemini", ...SCOPE],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(2);
    expect(result.json).toMatchObject({
      error: {
        message: "Pass --harness as one of: pi, codex, claude-code, cursor.",
      },
    });
  });
});

test("evals runs names each run's suite", async ({ cloud, cli }) => {
  server(cloud);
  cloud.on("GET", "/api/v1/server-evals/srv_1/runs", {
    body: {
      items: [
        {
          id: "run_1",
          suiteId: "suite_1",
          status: "running",
          pass: null,
          score: null,
          createdAt: "2026-11-17T00:00:00Z",
        },
        {
          id: "run_2",
          suiteId: "suite_gone",
          status: "complete",
          pass: true,
          score: 95,
          createdAt: "2026-11-17T00:00:00Z",
        },
      ],
      total: 2,
    },
  });
  cloud.on("GET", SUITES, {
    body: [suite({ id: "suite_1", name: "Rome weather" })],
  });

  const result = await cli.run(["evals", "runs", "--server", "weather"], {
    env: SIGNED_IN,
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toMatch(/^running\s+Rome weather\s.*run_1$/m);
  // A deleted suite's runs fall back to its ID.
  expect(result.stdout).toMatch(/^Passed \(95\)\s+suite_gone\s.*run_2$/m);
  expect(
    cloud.requestsTo("GET", "/api/v1/server-evals/srv_1/runs")
  ).toMatchObject([{ query: { limit: "30", skip: "0" } }]);
});

describe("suite references", () => {
  test("run accepts IDs, names, suite files and directories", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    await mkdir(join(cli.cwd, "evals"));
    await writeFile(join(cli.cwd, "evals", "rome.yaml"), ROME);
    await writeFile(join(cli.cwd, "checkout.yaml"), CHECKOUT);
    cloud.on("GET", SUITES, {
      body: [
        suite({ id: "suite_rome", name: "Rome weather" }),
        suite({ id: "suite_checkout", name: "Checkout" }),
        suite({ id: "suite_paris", name: "Paris weather" }),
      ],
    });
    for (const id of ["suite_rome", "suite_checkout", "suite_paris"])
      cloud.on("POST", `${SUITES}/${id}/runs`, {
        body: {
          id: `run_${id}`,
          suiteId: id,
          status: "pending",
          pass: null,
          score: null,
        },
      });

    const result = await cli.run(
      [
        "evals",
        "run",
        "evals",
        "checkout.yaml",
        "paris WEATHER",
        "suite_rome",
        "--server",
        "weather",
      ],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(0);
    // Duplicates collapse: the directory and the ID both name Rome.
    expect(result.stdout).toBe(
      [
        "✓ Started run run_suite_rome (Rome weather)",
        "✓ Started run run_suite_checkout (Checkout)",
        "✓ Started run run_suite_paris (Paris weather)",
        "",
        "Results: mcp-use evals report run_suite_rome run_suite_checkout run_suite_paris",
        "",
      ].join("\n")
    );
  });

  test("names what it cannot find or cannot tell apart, before writing", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    await writeFile(join(cli.cwd, "rome.yaml"), ROME);
    cloud.on("GET", SUITES, {
      body: [
        suite({ id: "suite_1", name: "Twin" }),
        suite({ id: "suite_2", name: "Twin" }),
      ],
    });

    const missing = await cli.run(["evals", "get", "Nope", ...SCOPE], {
      env: SIGNED_IN,
    });
    const file = await cli.run(
      ["evals", "rm", "rome.yaml", "--yes", ...SCOPE],
      {
        env: SIGNED_IN,
      }
    );
    const twins = await cli.run(["evals", "run", "Twin", ...SCOPE], {
      env: SIGNED_IN,
    });

    expect(missing.json).toEqual({
      error: {
        code: "eval_suite_not_found",
        message: "No eval suite matches “Nope”.",
        nextSteps: [
          { description: "List eval suites", command: "mcp-use evals list" },
        ],
      },
    });
    expect(file.json).toMatchObject({
      error: {
        code: "eval_suite_not_found",
        message: "No eval suite is named “Rome weather” (from rome.yaml).",
        nextSteps: [{ command: "mcp-use evals push rome.yaml" }],
      },
    });
    expect(twins.json).toMatchObject({
      error: {
        code: "eval_suite_ambiguous",
        message:
          "2 eval suites are named “Twin”: suite_1, suite_2. Pass an ID instead.",
      },
    });
    expect(twins.exitCode).toBe(1);
  });

  test("rm deletes the suite a name points to", async ({ cloud, cli }) => {
    server(cloud);
    cloud.on("GET", SUITES, {
      body: [suite({ id: "suite_1", name: "Rome weather" })],
    });
    cloud.on("DELETE", `${SUITES}/suite_1`, { body: { success: true } });

    const result = await cli.run(
      ["evals", "rm", "Rome weather", "--yes", "--server", "weather"],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "✓ Deleted eval suite “Rome weather”\nID  suite_1\n"
    );
  });
});

test("evals rm requires --yes without a terminal", async ({ cli }) => {
  const result = await cli.run(["evals", "rm", "suite_1", ...SCOPE], {
    env: SIGNED_IN,
  });
  expect(result.exitCode).toBe(2);
  expect(result.json).toMatchObject({
    error: { message: expect.stringContaining("--yes") },
  });
});

describe("suite files", () => {
  unit("rejects unknown fields and names the path", () => {
    expect(() =>
      parseEvalSuiteFile(`${ROME}treshold: 0.9\n`, "rome.yaml")
    ).toThrow(/rome\.yaml: invalid eval suite at file: .*treshold/);
    expect(() =>
      parseEvalSuiteFile(
        "name: x\nflow:\n  - kind: tool_call\n    name: t\n",
        "x.yaml"
      )
    ).toThrow(
      "x.yaml: invalid eval suite at flow: Add at least one user step."
    );
  });

  unit("names the step or client setting it cannot read", () => {
    const flow = "flow:\n  - kind: user\n    content: Hi\n";
    const parse = (clients: string) =>
      parseEvalSuiteFile(`name: x\n${flow}clients: ${clients}\n`, "x.yaml");
    expect(() =>
      parseEvalSuiteFile(
        `name: x\nflow:\n  - kind: tool_call\n    tool: t\n`,
        "x.yaml"
      )
    ).toThrow(/x\.yaml: invalid eval suite at flow\.0/);
    expect(() => parse("{}")).toThrow(
      "x.yaml: invalid eval suite at clients: Select at least one client."
    );
    expect(() =>
      parse("{ runtimes: [{ harness: inspector, model: a/b }] }")
    ).toThrow(/at clients\.runtimes\.0\.harness: /);
    expect(() =>
      parse("{ inspector: { models: [a/b], provider: openai } }")
    ).toThrow(/at clients\.inspector: .*provider/);
    expect(() => parse("{ claude: { models: [m, m] } }")).toThrow(
      "at clients.claude.models: Model IDs must be unique."
    );
    expect(() =>
      parse(
        "{ runtimes: [{ harness: pi, model: a/b }, { harness: pi, model: a/b }] }"
      )
    ).toThrow("at clients.runtimes: Runtimes must be unique.");
  });

  unit("maps clients onto Cloud's client fields", () => {
    const file = parseEvalSuiteFile(
      `name: x
flow:
  - kind: user
    content: Hi
  - kind: assistant_text
    note: Says hello.
clients:
  inspector: { models: [openai/gpt-5, anthropic/claude-haiku-5.5] }
  runtimes: [{ harness: codex, model: openai/gpt-5, provider: openai }]
  chatgpt: true
  claude: { models: [claude-sonnet-5.5] }
disallowedTools: [rm]
`,
      "x.yaml"
    );
    expect(
      suiteBody(file, {
        defaultModel: "unused/model",
        existingClientSettings: { lifecycle: { on: true }, web: { stale: 1 } },
      })
    ).toEqual({
      name: "x",
      flow: [
        { kind: "user", content: "Hi" },
        { kind: "assistant_text", note: "Says hello." },
      ],
      threshold: 0.7,
      disallowedTools: ["rm"],
      models: ["openai/gpt-5", "anthropic/claude-haiku-5.5"],
      clientTargets: ["inspector", "chatgpt", "claude", "codex"],
      clientSettings: {
        lifecycle: { on: true },
        inspector: {
          modelIds: ["openai/gpt-5", "anthropic/claude-haiku-5.5"],
          disallowedToolNames: ["rm"],
        },
        runtime: {
          executors: [
            { harness: "codex", model: "openai/gpt-5", provider: "openai" },
          ],
        },
        web: { claude: { models: [{ id: "claude-sonnet-5.5", name: "" }] } },
      },
    });
  });

  unit("toYaml round-trips strings YAML would otherwise retype", () => {
    const value = {
      name: "yes",
      flow: [
        { kind: "user", content: "Price: 10 # not a comment\nnext line" },
        {
          kind: "tool_call",
          name: "lookup",
          args: { id: "0123", flag: "true", empty: "", nested: [], obj: {} },
        },
        { kind: "assistant_text", note: "" },
      ],
      threshold: 0.5,
      clients: { inspector: { models: ["-dash", "a: b"] } },
    };
    expect(parseEvalSuiteFile(toYaml(value), "x.yaml")).toMatchObject(value);
  });

  unit("reads legacy columns when clientSettings is absent", () => {
    expect(
      suiteFile({
        name: "Old",
        enabled: true,
        threshold: 0.7,
        prompt: null,
        flow: [{ kind: "user", content: "Hi" }],
        requiredTools: [],
        rubric: null,
        models: ["openai/gpt-5"],
        disallowedTools: ["rm"],
        clientTargets: [],
        clientSettings: null,
      })
    ).toEqual({
      name: "Old",
      flow: [{ kind: "user", content: "Hi" }],
      threshold: 0.7,
      clients: { inspector: { models: ["openai/gpt-5"] } },
      disallowedTools: ["rm"],
    });
  });
});
