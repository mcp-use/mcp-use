import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { test } from "../helpers/cli-test.js";
import { signIn, SIGNED_IN } from "../helpers/cloud-auth.js";
import { server as serverFixture } from "../helpers/cloud-fixtures.js";
import type { FakeCloud } from "../helpers/fake-cloud.js";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/events/${name}`, import.meta.url), "utf8")
  );

const BASE = "/api/v1/servers/srv_1/events";

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

// The events routes are not in the generated Cloud spec until the platform
// ships them (PLAN.md §11.4), so they are registered as undocumented.
test("events status reads production by default and prints the response", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  cloud.onUndocumented("GET", `${BASE}/status`, {
    body: fixture("status.json"),
  });
  const result = await cli.run(
    ["events", "status", "--server", "weather", "--json"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toEqual(fixture("status.json"));
  const sent = cloud.requests.find((r) => r.path === `${BASE}/status`);
  expect(sent?.method).toBe("GET");
  expect(sent?.query).toEqual({});
});

test("events subscriptions sends filters and the branch as query parameters", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  cloud.onUndocumented("GET", `${BASE}/subscriptions`, {
    body: fixture("subscriptions.json"),
  });
  const result = await cli.run(
    [
      "events",
      "subscriptions",
      "--server",
      "weather",
      "--branch",
      "feature-x",
      "--event",
      "issue.opened",
      "--status",
      "active",
      "--limit",
      "10",
      "--json",
    ],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toEqual(fixture("subscriptions.json"));
  const sent = cloud.requests.find((r) => r.path === `${BASE}/subscriptions`);
  expect(sent?.query).toEqual({
    branch: "feature-x",
    event: "issue.opened",
    status: "active",
    limit: "10",
  });
});

test("events deliveries --dead-letters reads the dead-letter list", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  cloud.onUndocumented("GET", `${BASE}/dead-letters`, {
    body: fixture("dead-letters.json"),
  });
  const result = await cli.run(
    ["events", "deliveries", "--dead-letters", "--server", "weather", "--json"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toEqual(fixture("dead-letters.json"));
});

test("events redeliver posts the branch in the body", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  cloud.onUndocumented("POST", `${BASE}/dead-letters/d.abc:redeliver`, {
    body: fixture("redeliver.json"),
  });
  const result = await cli.run(
    [
      "events",
      "redeliver",
      "d.abc",
      "--server",
      "weather",
      "--branch",
      "main",
      "--json",
    ],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toEqual(fixture("redeliver.json"));
  const sent = cloud.requests.find((r) => r.method === "POST");
  expect(sent?.body).toEqual({ branch: "main" });
});

test("events revoke without a target environment is a usage error and sends nothing", async ({
  cloud,
  cli,
}) => {
  const result = await cli.run(
    [
      "events",
      "revoke",
      "--principal",
      "user_1",
      "--server",
      "weather",
      "--json",
    ],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(2);
  expect(result.json).toEqual({
    error: {
      code: "target_required",
      message:
        "events revoke changes state. Pass --branch <name>, or --production for production.",
      nextSteps: [],
    },
  });
  expect(cloud.requests).toEqual([]);
});

test("events emit --production posts name, data and production", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  cloud.onUndocumented("POST", `${BASE}/emit`, { body: fixture("emit.json") });
  const result = await cli.run(
    [
      "events",
      "emit",
      "issue.opened",
      "--data",
      '{"repo":"acme/web"}',
      "--event-id",
      "evt_1",
      "--production",
      "--yes",
      "--server",
      "weather",
      "--json",
    ],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toEqual(fixture("emit.json"));
  const sent = cloud.requests.find((r) => r.method === "POST");
  expect(sent?.body).toEqual({
    name: "issue.opened",
    data: { repo: "acme/web" },
    eventId: "evt_1",
    production: true,
  });
});

test("events purge on production is refused", async ({ cloud, cli }) => {
  const result = await cli.run(
    [
      "events",
      "purge",
      "--production",
      "--yes",
      "--server",
      "weather",
      "--json",
    ],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(2);
  expect(cloud.requests).toEqual([]);
});

test("events export in Cloud mode is refused because it carries secrets", async ({
  cli,
}) => {
  const result = await cli.run(
    ["events", "export", "--format", "sdk", "--server", "weather", "--json"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(2);
  expect((result.json as { error: { code: string } }).error.code).toBe(
    "local_only"
  );
});

test("events subscription maps a 404 to not_found", async ({ cloud, cli }) => {
  server(cloud);
  cloud.onUndocumented("GET", `${BASE}/subscriptions/sub_missing`, {
    status: 404,
    body: { code: "not_found" },
  });
  const result = await cli.run(
    ["events", "subscription", "sub_missing", "--server", "weather", "--json"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(1);
  expect((result.json as { error: { code: string } }).error.code).toBe(
    "not_found"
  );
});

test("events local mode without mcp-use installed reports MCP_USE_NOT_INSTALLED", async ({
  cli,
}) => {
  const result = await cli.run(
    ["events", "status", "--namespace", "ns_1", "--json"],
    {}
  );
  expect(result.exitCode).toBe(1);
  expect((result.json as { error: { code: string } }).error.code).toBe(
    "MCP_USE_NOT_INSTALLED"
  );
});
