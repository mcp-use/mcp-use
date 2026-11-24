import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test as unit } from "vitest";

import { createLiveReport, duration } from "../../src/cloud/evals/output.js";
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
const ROME_UUID = "0b9a3f0e-4c8d-4f6e-9a51-2f7d1c3e8a10";
const CHECKOUT_UUID = "7c2e1d4a-93b0-4b8e-8f2a-5d6c0e1b9f37";
const CART_UUID = "3f6a2b9c-1d4e-4a7b-8c5d-9e0f1a2b3c4d";
const SUITES = "/api/v1/server-evals/srv_1/suites";
const RUNS = "/api/v1/server-evals/srv_1/runs";

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
  // `evals run` lists a suite's runs before starting it, to find a run a lost start created.
  cloud.on("GET", RUNS, { body: { items: [], total: 0 } });
}

/** The organization's profiles, as `evals run --profile` looks them up for its output. */
function profiles(cloud: FakeCloud): void {
  cloud.on("GET", "/api/v1/organizations/org_1/profiles", {
    body: {
      items: [
        {
          id: "profile_free",
          label: "Free tier",
          account: {
            email: "free@evals.test",
            name: null,
            issuerHost: "auth.test",
          },
        },
      ],
    },
  });
}

/** A suite; its slug defaults to its ID with dashes for underscores. */
function suite(fields: Pick<Suite, "id" | "name"> & Partial<Suite>): Suite {
  return {
    slug: fields.id.replaceAll("_", "-"),
    enabled: true,
    threshold: 0.7,
    task: "Weather in Rome?",
    judge: null,
    requiredTools: [],
    clients: [{ client: "inspector", model: "openai/gpt-5" }],
    runs: [],
    ...fields,
  };
}

type Execution = NonNullable<
  NonNullable<Run["scenarios"]>[number]["executions"]
>[number];
/** An execution; fields the tests do not look at get neutral values. */
type ExecutionInput = Omit<
  Execution,
  "id" | "durationMs" | "toolCalls" | "agentResponse"
> &
  Partial<Pick<Execution, "id" | "durationMs" | "toolCalls" | "agentResponse">>;

/** The dashboard page of the test server's suites. */
const DASHBOARD =
  "https://manufact.com/cloud/org-one/servers/srv_1/evals/suites";

function run(
  fields: Pick<Run, "id" | "suiteId"> &
    Partial<Omit<Run, "scenarios">> & {
      scenarios?: Array<{ executions?: ExecutionInput[] }>;
    }
): Run {
  const { scenarios = [], ...rest } = fields;
  return {
    status: "complete",
    pass: true,
    score: 90,
    serverUrl: "https://weather.run.mcp-use.com/mcp",
    createdAt: "2026-11-17T00:00:00Z",
    prompt: null,
    messages: [],
    ...rest,
    scenarios: scenarios.map((scenario) =>
      scenario.executions === undefined
        ? {}
        : {
            executions: scenario.executions.map((execution, i) => ({
              id: `exec_${i + 1}`,
              durationMs: null,
              toolCalls: [],
              agentResponse: null,
              ...execution,
            })),
          }
    ),
  };
}

const ROME = `id: rome-weather
name: Rome weather
task: What's the weather in Rome?
required-tools:
  - name: get_weather
    args: { city: { contains: rome }, date: { any: true, require-present: true } }
clients:
  manufact-inspector: { model: openai/gpt-5 }
`;

const CHECKOUT = `id: checkout
name: Checkout
task: Buy a shirt
judge: Confirms the order.
threshold: 0.8
clients:
  manufact-inspector: { models: [anthropic/claude-sonnet-5.5] }
  claude-code: { model: anthropic/claude-sonnet-5.5, tool-search: true }
  claude-web: { model: default }
`;

const CART = `{ "id": "cart", "name": "Cart", "task": "Show my cart", "clients": { "codex": { "model": "openai/gpt-5" } } }\n`;

describe("evals push", () => {
  test("creates suites for new slugs and updates the suites existing IDs name", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    const dir = join(cli.cwd, "evals");
    await mkdir(dir);
    await writeFile(join(dir, "rome.yaml"), ROME);
    await writeFile(join(dir, "checkout.yml"), CHECKOUT);
    await writeFile(join(dir, "cart.json"), CART);
    await writeFile(join(dir, "notes.txt"), "ignored");
    cloud.on("GET", SUITES, {
      body: [
        suite({
          id: CHECKOUT_UUID,
          slug: "checkout",
          name: "Old checkout",
          clients: [
            { client: "inspector", model: "openai/gpt-5" },
            { client: "cursor", model: "cursor/auto" },
            { client: "windows-codex", model: null },
          ],
        }),
        suite({
          id: CART_UUID,
          slug: "cart",
          name: "Cart",
          judge: "Old judge",
          requiredTools: [{ name: "show_cart" }],
          clients: [{ client: "codex", model: "openai/gpt-5" }],
        }),
      ],
    });
    cloud.on("POST", SUITES, {
      body: { id: ROME_UUID, slug: "rome-weather", name: "Rome weather" },
    });
    cloud.on("PATCH", `${SUITES}/${CHECKOUT_UUID}`, {
      body: { id: CHECKOUT_UUID, slug: "checkout", name: "Checkout" },
    });
    cloud.on("PATCH", `${SUITES}/${CART_UUID}`, {
      body: { id: CART_UUID, slug: "cart", name: "Cart" },
    });

    const result = await cli.run(["evals", "push", "evals", ...SCOPE], {
      env: SIGNED_IN,
    });

    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual({
      dryRun: false,
      dashboardUrl: DASHBOARD,
      results: [
        {
          path: join("evals", "cart.json"),
          action: "updated",
          suite: { id: CART_UUID, slug: "cart", name: "Cart" },
        },
        {
          path: join("evals", "checkout.yml"),
          action: "updated",
          suite: { id: CHECKOUT_UUID, slug: "checkout", name: "Checkout" },
        },
        {
          path: join("evals", "rome.yaml"),
          action: "created",
          suite: { id: ROME_UUID, slug: "rome-weather", name: "Rome weather" },
        },
      ],
    });
    // A new suite gets the file's id as its slug.
    expect(cloud.requestsTo("POST", SUITES).map((r) => r.body)).toEqual([
      {
        name: "Rome weather",
        slug: "rome-weather",
        task: "What's the weather in Rome?",
        judge: null,
        threshold: 0.7,
        requiredTools: [
          {
            name: "get_weather",
            args: {
              city: { contains: "rome" },
              date: { any: true, requirePresent: true },
            },
          },
        ],
        clients: [{ client: "inspector", model: "openai/gpt-5" }],
        enabled: true,
      },
    ]);
    // An update sends the whole definition, and keeps the experimental clients.
    expect(
      cloud.requestsTo("PATCH", `${SUITES}/${CHECKOUT_UUID}`).map((r) => r.body)
    ).toEqual([
      {
        name: "Checkout",
        task: "Buy a shirt",
        judge: "Confirms the order.",
        threshold: 0.8,
        requiredTools: [],
        clients: [
          { client: "inspector", model: "anthropic/claude-sonnet-5.5" },
          {
            client: "claude-code",
            model: "anthropic/claude-sonnet-5.5",
            toolSearch: true,
          },
          { client: "claude", model: null },
          { client: "cursor", model: "cursor/auto" },
          { client: "windows-codex", model: null },
        ],
        enabled: true,
      },
    ]);
    // Omitted fields are reset.
    expect(
      cloud.requestsTo("PATCH", `${SUITES}/${CART_UUID}`).map((r) => r.body)
    ).toEqual([
      {
        name: "Cart",
        task: "Show my cart",
        judge: null,
        threshold: 0.7,
        requiredTools: [],
        clients: [{ client: "codex", model: "openai/gpt-5" }],
        enabled: true,
      },
    ]);
  });

  test("prints Created or Updated with each file's suite ID", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    await writeFile(join(cli.cwd, "rome.yaml"), ROME);
    await writeFile(join(cli.cwd, "checkout.yaml"), CHECKOUT);
    cloud.on("GET", SUITES, {
      body: [suite({ id: ROME_UUID, slug: "rome-weather", name: "Rome" })],
    });
    cloud.on("PATCH", `${SUITES}/${ROME_UUID}`, {
      body: { id: ROME_UUID, slug: "rome-weather", name: "Rome weather" },
    });
    cloud.on("POST", SUITES, {
      body: { id: CHECKOUT_UUID, slug: "checkout", name: "Checkout" },
    });

    const result = await cli.run(
      ["evals", "push", "rome.yaml", "checkout.yaml", "--server", "weather"],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "✓ Updated rome-weather (“Rome weather”) from rome.yaml",
        "✓ Created checkout (“Checkout”) from checkout.yaml",
        "",
      ].join("\n")
    );
  });

  test("an id that is a UUID updates that suite", async ({ cloud, cli }) => {
    server(cloud);
    await writeFile(
      join(cli.cwd, "rome.yaml"),
      ROME.replace("id: rome-weather", `id: ${ROME_UUID}`)
    );
    cloud.on("GET", SUITES, {
      body: [suite({ id: ROME_UUID, slug: "rome", name: "Rome" })],
    });
    cloud.on("PATCH", `${SUITES}/${ROME_UUID}`, {
      body: { id: ROME_UUID, slug: "rome", name: "Rome weather" },
    });

    const result = await cli.run(["evals", "push", "rome.yaml", ...SCOPE], {
      env: SIGNED_IN,
    });

    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      results: [{ action: "updated", suite: { id: ROME_UUID, slug: "rome" } }],
    });
    // The slug stays the suite's own.
    expect(
      cloud.requestsTo("PATCH", `${SUITES}/${ROME_UUID}`)[0]?.body
    ).not.toHaveProperty("slug");
  });

  test("--dry-run checks every file and says what would change, writing nothing", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    await writeFile(join(cli.cwd, "rome.yaml"), ROME);
    await writeFile(join(cli.cwd, "checkout.yaml"), CHECKOUT);
    cloud.on("GET", SUITES, {
      body: [suite({ id: ROME_UUID, slug: "rome-weather", name: "Rome" })],
    });

    const human = await cli.run(
      [
        "evals",
        "push",
        "rome.yaml",
        "checkout.yaml",
        "--dry-run",
        "--server",
        "weather",
      ],
      { env: SIGNED_IN }
    );
    const json = await cli.run(
      ["evals", "push", "rome.yaml", "checkout.yaml", "--dry-run", ...SCOPE],
      { env: SIGNED_IN }
    );

    expect(human.exitCode).toBe(0);
    expect(human.stdout).toBe(
      [
        "✓ Would update rome-weather (“Rome weather”) from rome.yaml",
        "✓ Would create checkout (“Checkout”) from checkout.yaml",
        "",
      ].join("\n")
    );
    expect(json.json).toEqual({
      dryRun: true,
      dashboardUrl: DASHBOARD,
      results: [
        {
          path: "rome.yaml",
          action: "updated",
          suite: { id: ROME_UUID, slug: "rome-weather", name: "Rome weather" },
        },
        {
          path: "checkout.yaml",
          action: "created",
          suite: { id: null, slug: "checkout", name: "Checkout" },
        },
      ],
    });
    // Only the suite list was read; no POST or PATCH routes are registered.
    expect(cloud.requests.map((r) => r.method)).not.toContain("POST");
    expect(cloud.requests.map((r) => r.method)).not.toContain("PATCH");
  });

  test("reports every invalid file and writes nothing", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    await writeFile(join(cli.cwd, "a.yaml"), ROME);
    // The same suite by UUID: two files can't name one suite.
    await writeFile(
      join(cli.cwd, "b.yaml"),
      ROME.replace("id: rome-weather", `id: ${ROME_UUID}`)
    );
    await writeFile(join(cli.cwd, "c.yaml"), "name: No ID\ntask: Hi\n");
    await writeFile(
      join(cli.cwd, "d.yaml"),
      CART.replace('"cart"', `"${CHECKOUT_UUID}"`)
    );
    await writeFile(
      join(cli.cwd, "e.yaml"),
      CART.replace('"codex"', '"pi"').replace('"openai/gpt-5"', '"default"')
    );
    await writeFile(join(cli.cwd, "f.yaml"), CHECKOUT);
    // A file names its clients; Cloud's default model is never assumed.
    await writeFile(
      join(cli.cwd, "g.yaml"),
      "id: no-clients\nname: No clients\ntask: Hi\n"
    );
    cloud.on("GET", SUITES, {
      body: [suite({ id: ROME_UUID, slug: "rome-weather", name: "Rome" })],
    });

    const json = await cli.run(
      [
        "evals",
        "push",
        "a.yaml",
        "b.yaml",
        "c.yaml",
        "d.yaml",
        "e.yaml",
        "f.yaml",
        "g.yaml",
        ...SCOPE,
      ],
      { env: SIGNED_IN }
    );

    expect(json.exitCode).toBe(1);
    expect(json.json).toEqual({
      results: [
        { path: "b.yaml", message: "id: a.yaml already names this suite" },
        {
          path: "c.yaml",
          message:
            "add the suite's ID as a top-level `id:` (its slug, such as `id: rome-weather`, or its UUID)",
        },
        {
          path: "d.yaml",
          message: `id: no suite on this server has the UUID ${CHECKOUT_UUID}`,
        },
        {
          path: "e.yaml",
          message:
            "clients.pi: `default` is only for chatgpt-web and claude-web",
        },
        {
          path: "g.yaml",
          message:
            "clients: list at least one client, such as `manufact-inspector: { model: <model id> }`",
        },
      ],
      written: false,
      dashboardUrl: DASHBOARD,
    });
    expect(cloud.requests.map((r) => r.method)).not.toContain("POST");
    expect(cloud.requests.map((r) => r.method)).not.toContain("PATCH");
  });

  test("a suite Cloud rejects is reported, and the other files are still written", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    await writeFile(join(cli.cwd, "checkout.yaml"), CHECKOUT);
    await writeFile(join(cli.cwd, "rome.yaml"), ROME);
    cloud.on("GET", SUITES, { body: [] });
    cloud.sequence("POST", SUITES, [
      {
        status: 400,
        body: {
          error: "Unknown model anthropic/claude-sonnet-5.5",
          code: "VALIDATION_ERROR",
          details: null,
        },
      },
      { body: { id: ROME_UUID, slug: "rome-weather", name: "Rome weather" } },
    ]);

    const json = await cli.run(
      ["evals", "push", "checkout.yaml", "rome.yaml", ...SCOPE],
      { env: SIGNED_IN }
    );

    expect(json.exitCode).toBe(1);
    expect(json.json).toEqual({
      dryRun: false,
      dashboardUrl: DASHBOARD,
      results: [
        {
          path: "checkout.yaml",
          code: "validation_error",
          message: "Unknown model anthropic/claude-sonnet-5.5",
        },
        {
          path: "rome.yaml",
          action: "created",
          suite: { id: ROME_UUID, slug: "rome-weather", name: "Rome weather" },
        },
      ],
    });
    expect(cloud.requestsTo("POST", SUITES).map((r) => r.body)).toMatchObject([
      { slug: "checkout" },
      { slug: "rome-weather" },
    ]);
  });

  test("fails before contacting Cloud when a path is missing", async ({
    cloud,
    cli,
  }) => {
    const result = await cli.run(["evals", "push", "missing", ...SCOPE], {
      env: SIGNED_IN,
    });

    expect(result.exitCode).toBe(2);
    expect(result.json).toMatchObject({
      error: { message: "No such file or directory: missing" },
    });
    expect(cloud.requests).toEqual([]);
  });
});

test("evals create refuses an ID that already exists", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  await writeFile(join(cli.cwd, "rome.yaml"), ROME);
  cloud.on("GET", SUITES, {
    body: [suite({ id: ROME_UUID, slug: "rome-weather", name: "Rome" })],
  });

  const result = await cli.run(
    ["evals", "create", "--file", "rome.yaml", ...SCOPE],
    { env: SIGNED_IN }
  );

  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    error: {
      code: "eval_suite_exists",
      nextSteps: [
        { command: "mcp-use evals update rome-weather --file rome.yaml" },
      ],
    },
  });
  expect(cloud.requests.map((r) => r.method)).not.toContain("POST");
});

test("evals create creates a suite with the file's id as its slug", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  await writeFile(join(cli.cwd, "checkout.yaml"), CHECKOUT);
  cloud.on("GET", SUITES, { body: [] });
  cloud.on("POST", SUITES, {
    body: { id: CHECKOUT_UUID, slug: "checkout", name: "Checkout" },
  });

  const result = await cli.run(
    ["evals", "create", "--file", "checkout.yaml", ...SCOPE],
    { env: SIGNED_IN }
  );

  expect(result.exitCode).toBe(0);
  expect(result.json).toEqual({
    id: CHECKOUT_UUID,
    slug: "checkout",
    name: "Checkout",
    dashboardUrl: DASHBOARD,
  });
  expect(cloud.requestsTo("POST", SUITES).map((r) => r.body)).toEqual([
    {
      name: "Checkout",
      slug: "checkout",
      task: "Buy a shirt",
      judge: "Confirms the order.",
      threshold: 0.8,
      requiredTools: [],
      clients: [
        { client: "inspector", model: "anthropic/claude-sonnet-5.5" },
        {
          client: "claude-code",
          model: "anthropic/claude-sonnet-5.5",
          toolSearch: true,
        },
        { client: "claude", model: null },
      ],
      enabled: true,
    },
  ]);
});

test("evals create reports an invalid file before contacting Cloud", async ({
  cloud,
  cli,
}) => {
  await writeFile(
    join(cli.cwd, "rome.yaml"),
    ROME.replace(
      "manufact-inspector: { model: openai/gpt-5 }",
      "manufact-inspector: { model: a, models: [b] }"
    )
  );

  const result = await cli.run(
    ["evals", "create", "--file", "rome.yaml", ...SCOPE],
    { env: SIGNED_IN }
  );

  expect(result.exitCode).toBe(2);
  expect(result.json).toMatchObject({ error: { code: "usage_error" } });
  expect(cloud.requests).toEqual([]);
});

test("evals update replaces the suite the file's ID names", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  await writeFile(join(cli.cwd, "rome.yaml"), ROME);
  cloud.on("GET", SUITES, {
    body: [suite({ id: ROME_UUID, slug: "rome-weather", name: "Old name" })],
  });
  cloud.on("PATCH", `${SUITES}/${ROME_UUID}`, {
    body: { id: ROME_UUID, slug: "rome-weather", name: "Rome weather" },
  });

  const result = await cli.run(
    ["evals", "update", ROME_UUID, "--file", "rome.yaml", ...SCOPE],
    { env: SIGNED_IN }
  );

  expect(result.exitCode).toBe(0);
  expect(result.json).toEqual({
    id: ROME_UUID,
    slug: "rome-weather",
    name: "Rome weather",
    dashboardUrl: DASHBOARD,
  });
  expect(
    cloud.requestsTo("PATCH", `${SUITES}/${ROME_UUID}`).map((r) => r.body)
  ).toMatchObject([
    { name: "Rome weather", task: "What's the weather in Rome?" },
  ]);
});

test("evals update refuses a file whose ID names another suite", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  await writeFile(join(cli.cwd, "rome.yaml"), ROME);
  cloud.on("GET", SUITES, {
    body: [
      suite({ id: ROME_UUID, slug: "rome-weather", name: "Rome" }),
      suite({ id: CHECKOUT_UUID, slug: "checkout", name: "Checkout" }),
    ],
  });

  const result = await cli.run(
    ["evals", "update", "checkout", "--file", "rome.yaml", ...SCOPE],
    { env: SIGNED_IN }
  );

  expect(result.exitCode).toBe(2);
  expect(result.json).toMatchObject({ error: { code: "usage_error" } });
  expect(cloud.requests.map((r) => r.method)).not.toContain("PATCH");
});

test("evals list shows each suite's slug next to its UUID", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  cloud.on("GET", SUITES, {
    body: [
      suite({
        id: ROME_UUID,
        slug: "rome-weather",
        name: "Rome weather",
        requiredTools: [{ name: "get_weather" }],
        clients: [
          { client: "inspector", model: "openai/gpt-5" },
          { client: "claude-code", model: null, toolSearch: true },
        ],
      }),
    ],
  });

  const json = await cli.run(["evals", "list", ...SCOPE], { env: SIGNED_IN });
  const human = await cli.run(["evals", "list", "--server", "weather"], {
    env: SIGNED_IN,
  });

  expect(json.exitCode).toBe(0);
  expect(json.json).toEqual({
    suites: [
      {
        id: ROME_UUID,
        slug: "rome-weather",
        name: "Rome weather",
        task: "Weather in Rome?",
        judge: null,
        threshold: 0.7,
        requiredTools: [{ name: "get_weather" }],
        clients: [
          { client: "inspector", model: "openai/gpt-5" },
          { client: "claude-code", model: null, toolSearch: true },
        ],
        enabled: true,
        latestRun: null,
      },
    ],
    dashboardUrl: DASHBOARD,
  });
  expect(human.stdout).toContain("rome-weather");
  expect(human.stdout).not.toContain(ROME_UUID);
});

describe("evals export", () => {
  test("writes the suite as a file push accepts, without the experimental clients", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    cloud.on("GET", SUITES, {
      body: [
        suite({
          id: ROME_UUID,
          slug: "legacy",
          name: "Legacy",
          task: "Weather in Rome?",
          judge: "Gives the temperature.",
          threshold: 0.8,
          requiredTools: [
            {
              name: "get_weather",
              args: {
                city: "Rome",
                date: { any: true, requirePresent: true },
              },
            },
          ],
          clients: [
            { client: "inspector", model: "openai/gpt-5" },
            { client: "inspector", model: "anthropic/claude-sonnet-5.5" },
            { client: "claude-code", model: "anthropic/claude-sonnet-5.5" },
            { client: "chatgpt", model: null },
            { client: "cursor", model: "cursor/auto" },
          ],
          enabled: false,
        }),
      ],
    });

    const result = await cli.run(
      ["evals", "export", "legacy", "--out", "out.yaml", ...SCOPE],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual({ id: ROME_UUID, path: "out.yaml" });
    expect(await readFile(join(cli.cwd, "out.yaml"), "utf8")).toBe(
      `id: legacy
name: Legacy
task: Weather in Rome?
judge: Gives the temperature.
threshold: 0.8
required-tools:
  - name: get_weather
    args:
      city: Rome
      date: { any: true, require-present: true }
clients:
  manufact-inspector: { models: [ openai/gpt-5, anthropic/claude-sonnet-5.5 ] }
  claude-code: { model: anthropic/claude-sonnet-5.5 }
  chatgpt-web: { model: default }
enabled: false
`
    );
  });

  test("an exported file pushes back onto the same suite unchanged", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    const task = `Plan a trip to ${"Rome, Paris and Berlin. ".repeat(8).trim()}`;
    const exported = suite({
      id: ROME_UUID,
      slug: "rome-weather",
      name: "Rome weather",
      task,
      requiredTools: [
        { name: "get_weather", args: { city: { contains: "rome" } } },
      ],
      clients: [
        ...[
          "openai/gpt-5",
          "openai/gpt-5-mini",
          "anthropic/claude-sonnet-5.5",
          "anthropic/claude-haiku-5.5",
          "google/gemini-2.5-pro",
          "x-ai/grok-4",
        ].map((model) => ({ client: "inspector" as const, model })),
        {
          client: "claude-code",
          model: "anthropic/claude-sonnet-5.5",
          toolSearch: false,
        },
        { client: "cursor", model: "cursor/auto" },
      ],
    });
    cloud.on("GET", SUITES, { body: [exported] });
    cloud.on("PATCH", `${SUITES}/${ROME_UUID}`, {
      body: { id: ROME_UUID, slug: "rome-weather", name: "Rome weather" },
    });

    const exportResult = await cli.run(
      ["evals", "export", "rome-weather", "--out", "rome.yaml", ...SCOPE],
      { env: SIGNED_IN }
    );
    const text = await readFile(join(cli.cwd, "rome.yaml"), "utf8");
    const push = await cli.run(["evals", "push", "rome.yaml", ...SCOPE], {
      env: SIGNED_IN,
    });

    expect(exportResult.exitCode).toBe(0);
    // Long values stay on one line each.
    expect(text.split("\n")).toContain(`task: ${task}`);
    expect(push.exitCode).toBe(0);
    expect(
      cloud.requestsTo("PATCH", `${SUITES}/${ROME_UUID}`).map((r) => r.body)
    ).toEqual([
      {
        name: "Rome weather",
        task,
        judge: null,
        threshold: 0.7,
        requiredTools: [
          { name: "get_weather", args: { city: { contains: "rome" } } },
        ],
        clients: exported.clients,
        enabled: true,
      },
    ]);
  });

  test.for([
    ["an existing directory", "evals"],
    ["a path ending in a slash", "new-dir/"],
  ] as const)(
    "names the file <slug>.yaml when --out is %s",
    async ([, out], { cloud, cli }) => {
      server(cloud);
      await mkdir(join(cli.cwd, "evals"));
      cloud.on("GET", SUITES, {
        body: [
          suite({ id: ROME_UUID, slug: "rome-weather", name: "Rome weather" }),
        ],
      });

      const result = await cli.run(
        ["evals", "export", ROME_UUID, "--out", out, ...SCOPE],
        { env: SIGNED_IN }
      );

      const path = join(out, "rome-weather.yaml");
      expect(result.exitCode).toBe(0);
      expect(result.json).toEqual({ id: ROME_UUID, path });
      expect(await readFile(join(cli.cwd, path), "utf8")).toMatch(
        /^id: rome-weather\n/
      );
    }
  );
});

test("evals export flags a suite with only experimental clients, whose file push rejects", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  cloud.on("GET", SUITES, {
    body: [
      suite({
        id: ROME_UUID,
        slug: "native",
        name: "Native",
        clients: [
          { client: "windows-codex", model: null },
          { client: "cursor", model: "cursor/auto" },
        ],
      }),
    ],
  });

  const exported = await cli.run(
    ["evals", "export", "native", "--out", "native.yaml", ...SCOPE],
    { env: SIGNED_IN }
  );
  const text = await readFile(join(cli.cwd, "native.yaml"), "utf8");
  const push = await cli.run(["evals", "push", "native.yaml", ...SCOPE], {
    env: SIGNED_IN,
  });

  expect(exported.exitCode).toBe(0);
  expect(exported.json).toMatchObject({
    id: ROME_UUID,
    path: "native.yaml",
    warning: expect.stringContaining("push rejects it"),
  });
  expect(text).toMatch(/^# This suite runs only on clients a suite file/);
  expect(text).not.toContain("clients:");
  // The file needs a client first; the suite isn't touched.
  expect(push.exitCode).toBe(1);
  expect(push.json).toEqual({
    results: [
      {
        path: "native.yaml",
        message:
          "clients: list at least one client, such as `manufact-inspector: { model: <model id> }`",
      },
    ],
    written: false,
    dashboardUrl: DASHBOARD,
  });
  expect(cloud.requests.map((r) => r.method)).not.toContain("PATCH");
});

test("evals get shows the suite as a file with its latest run", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  cloud.on("GET", SUITES, {
    body: [suite({ id: ROME_UUID, slug: "rome-weather", name: "Rome" })],
  });

  const result = await cli.run(
    ["evals", "get", "rome-weather", "--server", "weather"],
    { env: SIGNED_IN }
  );

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(
    [
      "id: rome-weather",
      "name: Rome",
      "task: Weather in Rome?",
      "threshold: 0.7",
      "clients:",
      "  manufact-inspector: { model: openai/gpt-5 }",
      "enabled: true",
    ].join("\n")
  );
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
        profileId: null,
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

  test("report prints each client's result, duration and tool calls, and why it failed", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    cloud.on("GET", SUITES, {
      body: [suite({ id: "suite_1", name: "Rome weather" })],
    });
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
                durationMs: 84_400,
                error: null,
                judgement:
                  "# Weather task assessment\n\n## Outcome\n\nScore: 0.4. The answer was wrong.",
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
                toolCalls: [
                  {
                    tool: "delete_city",
                    args: { city: "Rome" },
                    isError: false,
                  },
                ],
              },
              {
                client: "inspector",
                modelName: "openai/gpt-5",
                status: "complete",
                pass: false,
                score: 20,
                durationMs: 45_046,
                error: null,
                judgement: "# Assessment\n\n- The answer ignored the rubric.",
                judgeVerdict: null,
                toolAssertions: null,
                toolCalls: [
                  {
                    tool: "get_weather",
                    args: { city: "Rome" },
                    isError: false,
                  },
                  {
                    tool: "get_weather",
                    args: { city: "rome" },
                    isError: true,
                  },
                ],
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
              {
                client: "codex",
                modelName: "openai/gpt-5",
                status: "complete",
                pass: true,
                score: 100,
                durationMs: 38_000,
                error: null,
                judgement: null,
                judgeVerdict: null,
                toolAssertions: null,
                toolCalls: [
                  {
                    tool: "get_weather",
                    args: { city: "Rome" },
                    isError: false,
                  },
                ],
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
        "❌ Rome weather · 40%",
        "   ❌ Claude Code · anthropic/claude-sonnet-5.5 · 40% · 1m 24s · delete_city ×1",
        "      Missing tool call: get_weather",
        "      Called disallowed tool delete_city",
        "      Weather result contradicts the rubric",
        "      Judge: Score: 0.4.",
        `      🔗 ${DASHBOARD}/suite_1?execution=exec_1&tab=report`,
        "   ❌ Manufact Inspector · openai/gpt-5 · 20% · 45s · get_weather ×2 · 1 error",
        "      Judge: The answer ignored the rubric.",
        `      🔗 ${DASHBOARD}/suite_1?execution=exec_2&tab=report`,
        "   ❌ chatgpt.com · failed · no tool calls",
        "      Browser session expired",
        `      🔗 ${DASHBOARD}/suite_1?execution=exec_3&tab=report`,
        "   ✅ Codex CLI · openai/gpt-5 · 100% · 38s · get_weather ×1",
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
        profileId: null,
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
    expect(result.stdout).toContain(
      "➖ Rome weather · Manufact Inspector · openai/gpt-5 · cancelled\n"
    );
    expect(result.stdout).toContain(
      "➖ Rome weather · cancelled\n   ➖ Manufact Inspector · openai/gpt-5 · cancelled\n"
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
          profileId: null,
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
        messages: ["Buy a shirt"],
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
                durationMs: 12_000,
                toolCalls: [
                  { tool: "search", args: { q: "shirt" }, isError: true },
                ],
                agentResponse: "I could not place the order.",
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
    expect(result.stdout).toContain("❌ Checkout | cart · 0%");
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
        "## 🧪 Manufact Evals · Weather",
        "",
        "Branch `feat/cart` · 2 suites · ✅ 1 passed · ❌ 1 failed",
        "",
        "| Suite | Result | Score | Executions |",
        "| :-- | :-- | :-- | :-- |",
        `| [Rome weather](${suites}/suite_1) | ✅ Passed | 100% | 1/1 passed |`,
        `| [Checkout \\| cart](${suites}/suite_2) | ❌ Failed | 0% | 0/1 passed |`,
      ].join("\n")
    );
    expect(markdown).not.toContain("Target");
    expect(markdown).toContain(
      "<details><summary>✅ <b>Rome weather</b> · 100%</summary>"
    );
    expect(markdown).toContain(
      [
        "<details open><summary>❌ <b>Checkout | cart</b> · 0%</summary>",
        "",
        "| Client | Model | Result | Score | Duration | Tool calls |",
        "| :-- | :-- | :-- | :-- | :-- | :-- |",
        "| Claude Code | anthropic/claude-haiku-5.5 | ❌ Fail | 0% | 12s | search ×1 · 1 error |",
        "",
        `**❌ Claude Code · anthropic/claude-haiku-5.5** · [Open the report](${suites}/suite_2?execution=exec_1&tab=report)`,
        "",
        "- Missing tool call: checkout",
        "",
        "<details><summary>Conversation</summary>",
        "",
        "**User**",
        "",
        "```text",
        "Buy a shirt",
        "```",
        "",
        "**Tool calls**",
        "",
        '- `search` `{"q":"shirt"}` ❌ error',
        "",
        "**Answer**",
        "",
        "```text",
        "I could not place the order.",
        "```",
        "",
        "</details>",
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
        profileId: null,
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

  // Windows has no POSIX signals: killing a child with one ends it at once,
  // so the handler under test can't run there.
  test.skipIf(process.platform === "win32").for([
    ["SIGINT", 130, 1],
    ["SIGTERM", 143, 1],
    // CI can deliver a cancel twice; the second must not cut cancelling short.
    ["SIGINT", 130, 2],
  ] as const)(
    "%s while waiting cancels the runs still going (sent %i×)",
    async ([signal, exitCode, times], { cloud, cli }) => {
      server(cloud);
      cloud.on("GET", SUITES, {
        body: [
          suite({ id: "suite_1", name: "Rome weather" }),
          suite({ id: "suite_2", name: "Paris forecast" }),
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
            profileId: null,
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
          status: "running",
          pass: null,
          score: null,
        }),
      });
      cloud.on("POST", "/api/v1/server-evals/srv_1/runs/run_2/cancel", {
        body: { success: true },
      });

      const result = await cli.run(
        ["evals", "run", "--all", "--wait", "--server", "weather"],
        {
          env: { ...SIGNED_IN, MCP_USE_POLL_INTERVAL_MS: "200" },
          // Once Rome weather has finished, so only Paris forecast is still going.
          signal: {
            name: signal,
            when: ({ stdout }) => stdout.includes("✅ Rome weather"),
            times,
          },
        }
      );

      expect(result.exitCode).toBe(exitCode);
      expect(result.stderr).toContain("Cancelling 1 eval run…");
      expect(result.stderr).toContain("Cancelled run_2 (Paris forecast).");
      expect(
        cloud.requestsTo("POST", "/api/v1/server-evals/srv_1/runs/run_2/cancel")
      ).toHaveLength(1);
      expect(
        cloud.requestsTo("POST", "/api/v1/server-evals/srv_1/runs/run_1/cancel")
      ).toHaveLength(0);
    }
  );

  test.skipIf(process.platform === "win32")(
    "a cancel Cloud is slow to answer is reported as requested, not failed, and doesn't hide the others",
    async ({ cloud, cli }) => {
      server(cloud);
      cloud.on("GET", SUITES, {
        body: [
          suite({ id: "suite_1", name: "Rome weather" }),
          suite({ id: "suite_2", name: "Paris forecast" }),
          suite({ id: "suite_3", name: "Oslo snow" }),
        ],
      });
      for (const id of ["1", "2", "3"]) {
        cloud.on("POST", `${SUITES}/suite_${id}/runs`, {
          body: {
            id: `run_${id}`,
            suiteId: `suite_${id}`,
            status: "running",
            pass: null,
            score: null,
            profileId: null,
          },
        });
        // Oslo snow finishes at once: its line shows the command is waiting.
        cloud.on("GET", `${RUNS}/run_${id}`, {
          body:
            id === "3"
              ? run({
                  id: "run_3",
                  suiteId: "suite_3",
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
                })
              : run({
                  id: `run_${id}`,
                  suiteId: `suite_${id}`,
                  status: "running",
                  pass: null,
                  score: null,
                }),
        });
      }
      cloud.on("POST", `${RUNS}/run_1/cancel`, { body: { success: true } });
      // Longer than the 5 s the command waits after a signal.
      cloud.on("POST", `${RUNS}/run_2/cancel`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 7000));
        return { body: { success: true } };
      });

      const result = await cli.run(
        ["evals", "run", "--all", "--wait", "--server", "weather"],
        {
          env: { ...SIGNED_IN, MCP_USE_POLL_INTERVAL_MS: "200" },
          signal: {
            name: "SIGINT",
            when: ({ stdout }) => stdout.includes("✅ Oslo snow"),
            times: 1,
          },
        }
      );

      expect(result.exitCode).toBe(130);
      expect(result.stderr).toContain("Cancelled run_1 (Rome weather).");
      expect(result.stderr).toContain(
        "Cancel requested; Cloud hadn't answered before this command stopped waiting"
      );
      expect(result.stderr).toContain(
        "  run_2 (Paris forecast)\nTo check: mcp-use evals report run_2"
      );
      expect(result.stderr).not.toContain("Could not");
    },
    20_000
  );
  test("--profile starts each run with that profile", async ({
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
        profileId: "profile_free",
      },
    });
    profiles(cloud);

    const result = await cli.run(
      ["evals", "run", "suite_1", "--profile", "profile_free", ...SCOPE],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      runs: [{ id: "run_1" }],
      profile: { id: "profile_free", name: "Free tier (free@evals.test)" },
    });
    expect(cloud.requestsTo("POST", `${SUITES}/suite_1/runs`)).toMatchObject([
      { query: { profileId: "profile_free" } },
    ]);
  });

  test("--profile cancels a run that Cloud started without the profile", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    cloud.on("GET", SUITES, {
      body: [suite({ id: "suite_1", name: "Rome weather" })],
    });
    // A Cloud without run profiles drops the parameter.
    cloud.on("POST", `${SUITES}/suite_1/runs`, {
      body: {
        id: "run_1",
        suiteId: "suite_1",
        status: "running",
        pass: null,
        score: null,
        profileId: null,
      },
    });
    profiles(cloud);
    cloud.on("POST", "/api/v1/server-evals/srv_1/runs/run_1/cancel", {
      body: { success: true },
    });

    const result = await cli.run(
      [
        "evals",
        "run",
        "suite_1",
        "--wait",
        "--profile",
        "profile_free",
        ...SCOPE,
      ],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      error: {
        code: "eval_profile_unsupported",
        message: expect.stringContaining("did not apply --profile"),
      },
    });
    expect(
      cloud.requestsTo("POST", "/api/v1/server-evals/srv_1/runs/run_1/cancel")
    ).toHaveLength(1);
    expect(
      cloud.requestsTo("GET", "/api/v1/server-evals/srv_1/runs/run_1")
    ).toHaveLength(0);
  });

  test("--profile names the profile in the live header and the Markdown report", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    profiles(cloud);
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
        profileId: "profile_free",
      },
    });
    cloud.on("GET", "/api/v1/server-evals/srv_1/runs/run_1", {
      body: run({ id: "run_1", suiteId: "suite_1", score: 100 }),
    });

    const result = await cli.run(
      [
        "evals",
        "run",
        "suite_1",
        "--wait",
        "--profile",
        "profile_free",
        "--markdown-file",
        "evals.md",
        "--server",
        "weather",
      ],
      { env: { ...SIGNED_IN, MCP_USE_POLL_INTERVAL_MS: "0" } }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n")[0]).toBe(
      "🧪 Running 1 eval suite on Weather (production) · profile Free tier (free@evals.test)"
    );
    expect(await readFile(join(cli.cwd, "evals.md"), "utf8")).toContain(
      "Production · Profile Free tier (free@evals.test) · 1 suite · ✅ 1 passed"
    );
  });

  test("--profile falls back to the profile ID when the profiles can't be read", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    cloud.on("GET", "/api/v1/organizations/org_1/profiles", {
      status: 403,
      body: { error: "Forbidden" },
    });
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
        profileId: "profile_free",
      },
    });

    const result = await cli.run(
      [
        "evals",
        "run",
        "suite_1",
        "--profile",
        "profile_free",
        "--server",
        "weather",
      ],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("  Profile: profile_free\n");
  });

  test("--profile needs a profile ID", async ({ cli }) => {
    const result = await cli.run(
      ["evals", "run", "--all", "--profile", " ", ...SCOPE],
      { env: SIGNED_IN }
    );
    expect(result.exitCode).toBe(2);
  });

  test("--markdown-file needs --wait", async ({ cli }) => {
    const result = await cli.run(
      ["evals", "run", "--all", "--markdown-file", "evals.md", ...SCOPE],
      { env: SIGNED_IN }
    );
    expect(result.exitCode).toBe(2);
  });
});

describe("evals run when a start fails", () => {
  const FAST = { ...SIGNED_IN, MCP_USE_POLL_INTERVAL_MS: "0" };
  const started = (id: string, suiteId: string) => ({
    body: {
      id,
      suiteId,
      status: "running",
      pass: null,
      score: null,
      profileId: null,
    },
  });
  const listed = (id: string, suiteId: string) => ({
    id,
    suiteId,
    status: "running",
    pass: null,
    score: null,
    createdAt: "2026-11-20T20:05:00Z",
  });
  /** Suites `ids`, each finishing with a passing run `run_<n>` when polled. */
  function suites(cloud: FakeCloud, ids: readonly string[]): void {
    server(cloud);
    cloud.on("GET", SUITES, {
      body: ids.map((id) => suite({ id, name: `Suite ${id}` })),
    });
    for (const id of ids) {
      const runId = id.replace("suite", "run");
      cloud.on("GET", `${RUNS}/${runId}`, {
        body: run({ id: runId, suiteId: id }),
      });
    }
  }

  test("a suite that can't start doesn't stop the others; they are reported and the command fails", async ({
    cloud,
    cli,
  }) => {
    suites(cloud, ["suite_1", "suite_2"]);
    cloud.on("POST", `${SUITES}/suite_1/runs`, {
      status: 400,
      body: { error: "No reachable URL for this server" },
    });
    cloud.on("POST", `${SUITES}/suite_2/runs`, started("run_2", "suite_2"));

    const result = await cli.run(
      [
        "evals",
        "run",
        "--all",
        "--wait",
        "--json-file",
        "evals.json",
        "--markdown-file",
        "evals.md",
        ...SCOPE,
      ],
      { env: FAST }
    );

    expect(result.exitCode).toBe(1);
    const expected = {
      runs: [{ id: "run_2", pass: true }],
      notStarted: [
        {
          suiteId: "suite_1",
          name: "Suite suite_1",
          code: "validation_error",
          error: "No reachable URL for this server",
          attempts: 1,
        },
      ],
    };
    expect(result.json).toMatchObject(expected);
    expect(
      JSON.parse(await readFile(join(cli.cwd, "evals.json"), "utf8"))
    ).toMatchObject(expected);
    const markdown = await readFile(join(cli.cwd, "evals.md"), "utf8");
    expect(markdown).toContain("2 suites · ✅ 1 passed · ⛔ 1 not started");
    expect(markdown).toContain(
      "> **1 suite did not start**, so it has no results in this report:"
    );
    expect(markdown).toContain(
      `> - [Suite suite\\_1](${DASHBOARD}/suite_1): No reachable URL for this server`
    );
    // A suite's own error is not retried.
    expect(cloud.requestsTo("POST", `${SUITES}/suite_1/runs`)).toHaveLength(1);
  });

  test("without --wait, the started runs are listed and the command still fails", async ({
    cloud,
    cli,
  }) => {
    suites(cloud, ["suite_1", "suite_2"]);
    cloud.on("POST", `${SUITES}/suite_1/runs`, started("run_1", "suite_1"));
    cloud.on("POST", `${SUITES}/suite_2/runs`, {
      status: 400,
      body: { error: "Suite has no valid client configurations" },
    });

    const result = await cli.run(
      ["evals", "run", "--all", "--server", "weather"],
      {
        env: FAST,
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("✓ Started run run_1 (Suite suite_1)");
    expect(result.stdout).toContain(
      "✗ 1 eval suite did not start:\n  Suite suite_2: Suite has no valid client configurations"
    );
  });

  test("running out of credits stops starting; the remaining suites are listed as not attempted", async ({
    cloud,
    cli,
  }) => {
    suites(cloud, ["suite_1", "suite_2", "suite_3"]);
    cloud.on("POST", `${SUITES}/suite_1/runs`, started("run_1", "suite_1"));
    cloud.on("POST", `${SUITES}/suite_2/runs`, {
      status: 403,
      body: { error: "Out of eval credits", code: "INSUFFICIENT_CREDITS" },
    });
    // suite_3 has no start route: a request for it would fail the test.

    const result = await cli.run(
      ["evals", "run", "--all", "--wait", ...SCOPE],
      {
        env: FAST,
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      runs: [{ id: "run_1", pass: true }],
      notStarted: [
        {
          suiteId: "suite_2",
          code: "forbidden",
          error: "Out of eval credits",
          attempts: 1,
        },
        {
          suiteId: "suite_3",
          code: "forbidden",
          error: "Not attempted: Out of eval credits",
          attempts: 0,
        },
      ],
    });
  });

  test("a dropped start is sent again when Cloud shows no run for it", async ({
    cloud,
    cli,
  }) => {
    suites(cloud, ["suite_1"]);
    cloud.sequence("POST", `${SUITES}/suite_1/runs`, [
      { reset: true },
      started("run_1", "suite_1"),
    ]);

    const result = await cli.run(
      ["evals", "run", "--all", "--wait", ...SCOPE],
      {
        env: FAST,
      }
    );

    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({ runs: [{ id: "run_1", pass: true }] });
    expect(result.json).not.toHaveProperty("notStarted");
    // Before retrying, it looked for a run the lost start created.
    expect(
      cloud.requestsTo("GET", RUNS).map((request) => request.query)
    ).toContainEqual({ limit: "5", skip: "0", suiteId: "suite_1" });
  });

  test("a dropped start that Cloud did create is used, not sent again", async ({
    cloud,
    cli,
  }) => {
    suites(cloud, ["suite_1"]);
    // A run from before this command, then the one the lost start created.
    cloud.sequence("GET", RUNS, [
      { body: { items: [listed("run_old", "suite_1")], total: 1 } },
      { body: { items: [listed("run_old", "suite_1")], total: 1 } },
      {
        body: {
          items: [listed("run_1", "suite_1"), listed("run_old", "suite_1")],
          total: 2,
        },
      },
    ]);
    // One reply only: a second start would be unhandled and fail the test.
    cloud.sequence("POST", `${SUITES}/suite_1/runs`, [{ reset: true }]);

    const result = await cli.run(
      ["evals", "run", "--all", "--wait", ...SCOPE],
      {
        env: FAST,
      }
    );

    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({ runs: [{ id: "run_1", pass: true }] });
  });

  test("a suite whose start keeps dropping is given up after 3 attempts, and the next suite still starts", async ({
    cloud,
    cli,
  }) => {
    suites(cloud, ["suite_1", "suite_2"]);
    cloud.on("POST", `${SUITES}/suite_1/runs`, { reset: true });
    cloud.on("POST", `${SUITES}/suite_2/runs`, started("run_2", "suite_2"));

    const result = await cli.run(
      ["evals", "run", "--all", "--wait", ...SCOPE],
      {
        env: FAST,
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      runs: [{ id: "run_2" }],
      notStarted: [
        {
          suiteId: "suite_1",
          code: "cloud_unreachable",
          error: expect.stringContaining("(gave up after 3 start attempts)"),
          attempts: 3,
        },
      ],
    });
    expect(cloud.requestsTo("POST", `${SUITES}/suite_1/runs`)).toHaveLength(3);
  });

  test("a rate-limited start is retried without looking for a run", async ({
    cloud,
    cli,
  }) => {
    suites(cloud, ["suite_1"]);
    cloud.sequence("POST", `${SUITES}/suite_1/runs`, [
      {
        status: 429,
        headers: { "retry-after": "0" },
        body: { error: "Too many requests", retryAfterSec: 0 },
      },
      started("run_1", "suite_1"),
    ]);

    const result = await cli.run(
      ["evals", "run", "--all", "--wait", ...SCOPE],
      {
        env: FAST,
      }
    );

    expect(result.exitCode).toBe(0);
    // Only the list taken before the first start: a 429 never created a run.
    expect(cloud.requestsTo("GET", RUNS)).toHaveLength(1);
  });

  test("when no suite starts, the command fails with every suite's error", async ({
    cloud,
    cli,
  }) => {
    suites(cloud, ["suite_1", "suite_2"]);
    for (const id of ["suite_1", "suite_2"])
      cloud.on("POST", `${SUITES}/${id}/runs`, {
        status: 400,
        body: { error: `${id} has no clients` },
      });

    const result = await cli.run(
      [
        "evals",
        "run",
        "--all",
        "--wait",
        "--json-file",
        "evals.json",
        "--markdown-file",
        "evals.md",
        ...SCOPE,
      ],
      { env: FAST }
    );

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      error: {
        code: "validation_error",
        message:
          "Could not start any of the 2 eval suites:\n  Suite suite_1: suite_1 has no clients\n  Suite suite_2: suite_2 has no clients",
      },
    });
    // The files still say why, so a CI report shows it.
    expect(
      JSON.parse(await readFile(join(cli.cwd, "evals.json"), "utf8"))
    ).toMatchObject({
      runs: [],
      notStarted: [{ suiteId: "suite_1" }, { suiteId: "suite_2" }],
    });
    const markdown = await readFile(join(cli.cwd, "evals.md"), "utf8");
    expect(markdown).toContain("2 suites · ⛔ 2 not started");
    expect(markdown).toContain("suite\\_2 has no clients");
    expect(markdown).not.toContain("| Suite | Result |");
  });

  test("when the first start stops the rest, its error is the command's and the JSON file lists every suite", async ({
    cloud,
    cli,
  }) => {
    suites(cloud, ["suite_1", "suite_2"]);
    cloud.on("POST", `${SUITES}/suite_1/runs`, {
      status: 403,
      body: { error: "Out of eval credits" },
    });

    const result = await cli.run(
      ["evals", "run", "--all", "--json-file", "evals.json", ...SCOPE],
      { env: FAST }
    );

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      error: { code: "forbidden", message: "Out of eval credits" },
    });
    expect(
      JSON.parse(await readFile(join(cli.cwd, "evals.json"), "utf8"))
    ).toMatchObject({
      runs: [],
      notStarted: [
        { suiteId: "suite_1", attempts: 1 },
        {
          suiteId: "suite_2",
          attempts: 0,
          error: "Not attempted: Out of eval credits",
        },
      ],
    });
  });

  test("with --profile, a run with another profile isn't taken for the lost start", async ({
    cloud,
    cli,
  }) => {
    suites(cloud, ["suite_1"]);
    profiles(cloud);
    cloud.sequence("POST", `${SUITES}/suite_1/runs`, [
      { reset: true },
      {
        body: {
          ...started("run_1", "suite_1").body,
          profileId: "profile_free",
        },
      },
    ]);
    // Before the start, no runs. After the reset, someone else's run with the
    // server's own profile: new, but not this command's.
    let lists = 0;
    cloud.on("GET", RUNS, () => ({
      body:
        ++lists === 1
          ? { items: [], total: 0 }
          : {
              items: [{ ...listed("run_other", "suite_1"), profileId: null }],
              total: 1,
            },
    }));

    const result = await cli.run(
      [
        "evals",
        "run",
        "--all",
        "--wait",
        "--profile",
        "profile_free",
        ...SCOPE,
      ],
      { env: FAST }
    );

    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({ runs: [{ id: "run_1" }] });
    expect(cloud.requestsTo("POST", `${SUITES}/suite_1/runs`)).toHaveLength(2);
    expect(cloud.requestsTo("POST", `${RUNS}/run_other/cancel`)).toHaveLength(
      0
    );
  });

  test("Retry-After as an HTTP date is honored", async ({ cloud, cli }) => {
    suites(cloud, ["suite_1"]);
    cloud.sequence("POST", `${SUITES}/suite_1/runs`, [
      {
        status: 429,
        headers: { "retry-after": new Date(Date.now() + 2000).toUTCString() },
        body: { error: "Too many requests" },
      },
      started("run_1", "suite_1"),
    ]);

    const before = Date.now();
    // No MCP_USE_POLL_INTERVAL_MS: the real waits apply.
    const result = await cli.run(["evals", "run", "--all", ...SCOPE], {
      env: SIGNED_IN,
    });

    expect(result.exitCode).toBe(0);
    expect(Date.now() - before).toBeGreaterThanOrEqual(1000);
  });
});

describe("evals run --wait live progress", () => {
  function execution(fields: Partial<ExecutionInput>): ExecutionInput {
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
  const dashboardUrl = "https://manufact.test/suites";

  unit(
    "prints each execution once as it finishes, with why it failed and a link",
    () => {
      const live = createLiveReport({ names, dashboardUrl, startedAt: 0 });
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
                execution({
                  status: "complete",
                  pass: true,
                  score: 100,
                  durationMs: 41_000,
                }),
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
        "✅ Rome weather · Manufact Inspector · openai/gpt-5 · 100% · 41s",
        "❌ Rome weather · chatgpt.com · 40%",
        "   Missing tool call: get_weather",
        `   🔗 ${dashboardUrl}/suite_1?execution=exec_2&tab=report`,
      ]);
      // Already reported: nothing new on the next poll.
      expect(live.update(later, 39_000)).toEqual([]);
    }
  );

  unit("names what is still running after a quiet minute", () => {
    const live = createLiveReport({ names, dashboardUrl, startedAt: 0 });
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
      "⏳ 2 still running: Rome weather (judging), Paris forecast (running)",
    ]);
    expect(live.update(runs, 65_000)).toEqual([]);
    expect(live.summary(runs, 3_725_000)).toBe(
      "⏱️ Stopped waiting after 1h 02m · 0 of 2 suites passed, 2 still running"
    );
  });

  unit("formats durations", () => {
    expect(duration(0)).toBe("0s");
    expect(duration(45_046)).toBe("45s");
    expect(duration(84_400)).toBe("1m 24s");
    expect(duration(3_600_000)).toBe("1h 00m");
  });

  test("streams suite links and results before the full report, and stays silent with --json", async ({
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
        profileId: null,
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
              execution({
                status: "complete",
                pass: true,
                score: 100,
                durationMs: 38_000,
              }),
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
    expect(lines.slice(0, 4)).toEqual([
      "🧪 Running 1 eval suite on Weather (production)",
      "",
      "  Rome weather",
      `  ${DASHBOARD}/suite_1`,
    ]);
    const event = lines.indexOf(
      "✅ Rome weather · Manufact Inspector · openai/gpt-5 · 100% · 38s"
    );
    const done = lines.findIndex((line) =>
      /^🏁 Done in \d+s · 1 of 1 suite passed$/.test(line)
    );
    const report = lines.indexOf("✅ Rome weather · 100%");
    expect(event).toBeGreaterThan(3);
    expect(done).toBeGreaterThan(event);
    expect(report).toBeGreaterThan(done);
    expect(lines[report + 1]).toBe(
      "   ✅ Manufact Inspector · openai/gpt-5 · 100% · 38s · no tool calls"
    );

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
        "Web apps (clients.chatgpt-web, clients.claude-web)",
        "  claude  Unavailable: Enabled on request.",
        "    claude-haiku-5.5  Haiku 5.5",
        "",
        "Harnesses (clients.<harness>; cursor can't be set in files yet)",
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
  test("run selects suites by UUID or slug", async ({ cloud, cli }) => {
    server(cloud);
    cloud.on("GET", SUITES, {
      body: [
        suite({ id: ROME_UUID, slug: "rome-weather", name: "Rome weather" }),
        suite({ id: CHECKOUT_UUID, slug: "checkout", name: "Checkout" }),
      ],
    });
    for (const id of [ROME_UUID, CHECKOUT_UUID])
      cloud.on("POST", `${SUITES}/${id}/runs`, {
        body: {
          id: `run_${id}`,
          suiteId: id,
          status: "pending",
          pass: null,
          score: null,
          profileId: null,
        },
      });

    const result = await cli.run(
      [
        "evals",
        "run",
        "rome-weather",
        CHECKOUT_UUID,
        ROME_UUID,
        "--server",
        "weather",
      ],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(0);
    // A suite named twice, by slug and by UUID, runs once.
    expect(result.stdout).toBe(
      [
        `✓ Started run run_${ROME_UUID} (Rome weather)`,
        `✓ Started run run_${CHECKOUT_UUID} (Checkout)`,
        "",
        `Results: mcp-use evals report run_${ROME_UUID} run_${CHECKOUT_UUID}`,
        "",
      ].join("\n")
    );
    expect(
      cloud.requests
        .filter((request) => request.method === "POST")
        .map((request) => request.path)
    ).toEqual([
      `${SUITES}/${ROME_UUID}/runs`,
      `${SUITES}/${CHECKOUT_UUID}/runs`,
    ]);
  });

  test("a UUID wins over a slug that looks the same", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    cloud.on("GET", SUITES, {
      body: [
        suite({ id: "suite_other", slug: ROME_UUID, name: "Lookalike" }),
        suite({ id: ROME_UUID, slug: "rome-weather", name: "Rome weather" }),
      ],
    });
    cloud.on("POST", `${SUITES}/${ROME_UUID}/runs`, {
      body: {
        id: "run_1",
        suiteId: ROME_UUID,
        status: "pending",
        pass: null,
        score: null,
        profileId: null,
      },
    });

    const result = await cli.run(["evals", "run", ROME_UUID, ...SCOPE], {
      env: SIGNED_IN,
    });

    expect(result.exitCode).toBe(0);
    expect(
      cloud.requestsTo("POST", `${SUITES}/${ROME_UUID}/runs`)
    ).toHaveLength(1);
  });

  test.for([
    ["an exact name", "Rome weather"],
    ["a name in another case", "rome WEATHER"],
    ["a suite file named after the suite", "rome.yaml"],
    ["a directory of suite files", "evals"],
  ] as const)(
    "run rejects %s and starts nothing",
    async ([, arg], { cloud, cli }) => {
      server(cloud);
      await mkdir(join(cli.cwd, "evals"));
      await writeFile(join(cli.cwd, "evals", "rome.yaml"), ROME);
      await writeFile(join(cli.cwd, "rome.yaml"), ROME);
      cloud.on("GET", SUITES, {
        body: [suite({ id: "suite_rome", name: "Rome weather" })],
      });

      const result = await cli.run(["evals", "run", arg, ...SCOPE], {
        env: SIGNED_IN,
      });

      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        error: {
          code: "eval_suite_not_found",
          nextSteps: [
            { description: "List eval suites", command: "mcp-use evals list" },
          ],
        },
      });
      // The suite list was read, so a POST would have reached the fake too.
      expect(cloud.requestsTo("GET", SUITES)).toHaveLength(1);
      expect(cloud.requests.filter((r) => r.method === "POST")).toEqual([]);
    }
  );

  test.for([
    ["get", ["get", "Rome weather"]],
    ["export", ["export", "Rome weather"]],
    ["update", ["update", "Rome weather", "--file", "rome.yaml"]],
    ["rm", ["rm", "Rome weather", "--yes"]],
    ["runs --suite", ["runs", "--suite", "Rome weather"]],
    ["get with a suite file", ["get", "rome.yaml"]],
    ["rm with a suite file", ["rm", "rome.yaml", "--yes"]],
    ["runs --suite with a suite file", ["runs", "--suite", "rome.yaml"]],
  ] as const)(
    "%s doesn't select a suite by name or file",
    async ([, args], { cloud, cli }) => {
      server(cloud);
      await writeFile(join(cli.cwd, "rome.yaml"), ROME);
      cloud.on("GET", SUITES, {
        body: [suite({ id: "suite_rome", name: "Rome weather" })],
      });

      const result = await cli.run(["evals", ...args, ...SCOPE], {
        env: SIGNED_IN,
      });

      expect(result.exitCode).toBe(1);
      expect(result.json).toEqual({
        error: {
          code: "eval_suite_not_found",
          message: `No eval suite has the ID “${args[args[0] === "runs" ? 2 : 1]}”. Pass suite IDs (UUID or slug); names and files aren't accepted.`,
          nextSteps: [
            { description: "List eval suites", command: "mcp-use evals list" },
          ],
        },
      });
      // The suite list was read, and nothing after it: no runs listed,
      // no suite written or deleted.
      expect(cloud.requestsTo("GET", SUITES)).toHaveLength(1);
      expect(cloud.requestsTo("GET", RUNS)).toEqual([]);
      expect(cloud.requests.filter((r) => r.method !== "GET")).toEqual([]);
    }
  );

  test("runs --suite lists the runs of the suite with the given slug", async ({
    cloud,
    cli,
  }) => {
    server(cloud);
    cloud.on("GET", SUITES, {
      body: [
        suite({ id: "suite_rome", slug: "rome-weather", name: "Rome weather" }),
      ],
    });
    const result = await cli.run(
      ["evals", "runs", "--suite", "rome-weather", ...SCOPE],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual({ items: [], total: 0 });
    expect(cloud.requestsTo("GET", RUNS)).toMatchObject([
      { query: { suiteId: "suite_rome" } },
    ]);
  });

  test("rm deletes the suite with the given ID", async ({ cloud, cli }) => {
    server(cloud);
    cloud.on("GET", SUITES, {
      body: [suite({ id: "suite_1", name: "Rome weather" })],
    });
    cloud.on("DELETE", `${SUITES}/suite_1`, { body: { success: true } });

    const result = await cli.run(
      ["evals", "rm", "suite_1", "--yes", "--server", "weather"],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "✓ Deleted eval suite “Rome weather”\nID    suite-1\nUUID  suite_1\n"
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
