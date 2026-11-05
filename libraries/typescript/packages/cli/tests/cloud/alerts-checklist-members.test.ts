import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { test } from "../helpers/cli-test.js";
import { signIn, SIGNED_IN } from "../helpers/cloud-auth.js";
import { server as serverFixture } from "../helpers/cloud-fixtures.js";
import type { FakeCloud } from "../helpers/fake-cloud.js";

function server(cloud: FakeCloud): void {
  signIn(cloud);
  cloud.on("GET", "/api/v1/servers/weather", {
    body: serverFixture({ id: "srv_1", slug: "weather", name: "Weather", organizationId: "org_1" }),
  });
}
const SCOPE = ["--server", "weather", "--json"];
const CONFIG = {
  name: "Deployment failure",
  enabled: true,
  trigger: {
    when: {
      metric: "deployment.failedCount" as const,
      op: "gt" as const,
      value: 0,
    },
    for: "0s",
  },
  recover: {
    when: {
      metric: "deployment.failedCount" as const,
      op: "eq" as const,
      value: 0,
    },
    for: "0s",
  },
  notify: [{ type: "email" as const }],
};
const YAML = `name: Deployment failure
trigger:
  when:
    metric: deployment.failedCount
    op: gt
    value: 0
  for: 0s
recover:
  when:
    metric: deployment.failedCount
    op: eq
    value: 0
  for: 0s
notify:
  - type: email
`;
const INVITE = {
  id: "invite_1",
  organizationId: "org_1",
  email: "teammate@example.com",
  role: "member",
  status: "pending",
  inviterId: "user_1",
  expiresAt: "2026-12-01T00:00:00Z",
  createdAt: "2026-11-05T00:00:00Z",
};

test("org members lists the selected organization with pagination", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/organizations/org_1/members", {
    body: {
      items: [
        {
          id: "member_1",
          organizationId: "org_1",
          userId: "user_1",
          role: "owner",
          createdAt: "2026-11-05T00:00:00Z",
          user: {
            id: "user_1",
            name: "Example",
            email: "owner@example.com",
            image: null,
          },
        },
      ],
      total: 1,
      limit: 10,
      skip: 0,
    },
  });
  const result = await cli.run(["org", "members", "--limit", "10", "--json"], {
    env: SIGNED_IN,
  });
  expect(result.exitCode).toBe(0);
  expect(result.json).toMatchObject({
    items: [{ user: { email: "owner@example.com" } }],
    total: 1,
  });
  expect(
    cloud.requestsTo("GET", "/api/v1/organizations/org_1/members")
  ).toMatchObject([{ query: { limit: "10", skip: "0" } }]);
});

test("org invites sends and cancels an invitation with the selected role", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  cloud.on("POST", "/api/v1/organizations/org_1/invitations", { body: INVITE });
  const sent = await cli.run(
    [
      "org",
      "invites",
      "send",
      "teammate@example.com",
      "--role",
      "member",
      "--json",
    ],
    { env: SIGNED_IN }
  );
  expect(sent.exitCode).toBe(0);
  expect(
    cloud.requestsTo("POST", "/api/v1/organizations/org_1/invitations")
  ).toMatchObject([
    { body: { email: "teammate@example.com", role: "member" } },
  ]);
  cloud.on("POST", "/api/v1/organizations/org_1/invitations/invite_1/cancel", {
    body: { ...INVITE, status: "canceled" },
  });
  const canceled = await cli.run(
    ["org", "invites", "cancel", "invite_1", "--json"],
    { env: SIGNED_IN }
  );
  expect(canceled.exitCode).toBe(0);
  expect(canceled.json).toMatchObject({ status: "canceled" });
});

test("org invites rejects an unsupported role before any Cloud request", async ({
  cloud,
  cli,
}) => {
  const rejected = await cli.run(
    [
      "org",
      "invites",
      "send",
      "teammate@example.com",
      "--role",
      "owner",
      "--json",
    ],
    { env: SIGNED_IN }
  );
  expect(rejected.exitCode).toBe(2);
  expect(cloud.requests).toEqual([]);
  signIn(cloud);
  cloud.on("GET", "/api/v1/organizations/org_1/invitations", {
    body: { invitations: [INVITE] },
  });
  const listed = await cli.run(["org", "invites", "list", "--json"], {
    env: SIGNED_IN,
  });
  expect(listed.exitCode).toBe(0);
  expect(listed.json).toMatchObject({ invitations: [{ id: "invite_1" }] });
});

test("checklist run waits for completion and emits one public result", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  cloud.onUndocumented("POST", "/api/v1/server-audits/srv_1/audits", {
    status: 201,
    body: { id: "run_1", status: "pending" },
  });
  let polls = 0;
  cloud.onUndocumented(
    "GET",
    "/api/v1/server-audits/srv_1/audits/run_1",
    () => ({
      body: {
        id: "run_1",
        status: ++polls === 1 ? "running" : "completed",
        isReadyForChatgpt: true,
        hidden: "must not appear",
      },
    })
  );
  const result = await cli.run(
    ["checklist", "run", "--branch", "preview", ...SCOPE],
    { env: { ...SIGNED_IN, MCP_USE_POLL_INTERVAL_MS: "0" } }
  );
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.json).toMatchObject({
    id: "run_1",
    status: "completed",
    isReadyForChatgpt: true,
  });
  expect(result.stdout).not.toContain("must not appear");
  expect(
    cloud.requestsTo("POST", "/api/v1/server-audits/srv_1/audits")
  ).toMatchObject([
    { body: { branch: "preview" }, headers: { "x-profile-id": "org_1" } },
  ]);
  expect(
    cloud.requestsTo("GET", "/api/v1/server-audits/srv_1/audits/run_1")
  ).toHaveLength(2);
});

test("checklist --no-wait returns immediately and cancel sends the selected run", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  cloud.onUndocumented("POST", "/api/v1/server-audits/srv_1/audits", {
    status: 201,
    body: { id: "run_1", status: "pending" },
  });
  const pending = await cli.run(["checklist", "run", "--no-wait", ...SCOPE], {
    env: SIGNED_IN,
  });
  expect(pending.exitCode).toBe(0);
  expect(pending.json).toMatchObject({ id: "run_1", status: "pending" });
  expect(
    cloud.requestsTo("GET", "/api/v1/server-audits/srv_1/audits/run_1")
  ).toEqual([]);
  cloud.onUndocumented(
    "POST",
    "/api/v1/server-audits/srv_1/audits/run_1/cancel",
    { body: { id: "run_1", status: "failed" } }
  );
  const canceled = await cli.run(["checklist", "cancel", "run_1", ...SCOPE], {
    env: SIGNED_IN,
  });
  expect(canceled.exitCode).toBe(0);
  expect(
    cloud.requestsTo("POST", "/api/v1/server-audits/srv_1/audits/run_1/cancel")
  ).toHaveLength(1);
});

test("alerts create accepts dashboard YAML and sends public config fields", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  const path = join(cli.cwd, "rule.yaml");
  await writeFile(path, YAML);
  cloud.on("POST", "/api/v1/servers/srv_1/alerts/rules", {
    body: { rule: { id: "rule_1", revision: 1, config: CONFIG } },
  });
  const result = await cli.run(["alerts", "create", "--file", path, ...SCOPE], {
    env: SIGNED_IN,
  });
  expect(result.exitCode).toBe(0);
  expect(result.json).toMatchObject({
    rule: { id: "rule_1", revision: 1, config: { name: "Deployment failure" } },
  });
  expect(
    cloud
      .requestsTo("POST", "/api/v1/servers/srv_1/alerts/rules")
      .map((request) => request.body)
  ).toEqual([{ config: CONFIG, reason: "Updated using the CLI" }]);
});

test("alerts update preserves pause state and sends the current revision", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  const path = join(cli.cwd, "rule.yaml");
  await writeFile(path, YAML);
  cloud.on("GET", "/api/v1/servers/srv_1/alerts/rules/rule_1", {
    body: {
      rule: {
        id: "rule_1",
        revision: 7,
        config: { ...CONFIG, enabled: false },
      },
    },
  });
  cloud.on("PUT", "/api/v1/servers/srv_1/alerts/rules/rule_1", {
    body: {
      rule: {
        id: "rule_1",
        revision: 8,
        config: { ...CONFIG, enabled: false },
      },
    },
  });
  const result = await cli.run(
    [
      "alerts",
      "update",
      "rule_1",
      "--file",
      path,
      "--reason",
      "Tune deployment alerts",
      ...SCOPE,
    ],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toMatchObject({ rule: { revision: 8 } });
  expect(
    cloud.requestsTo("PUT", "/api/v1/servers/srv_1/alerts/rules/rule_1")
  ).toMatchObject([
    {
      body: {
        config: { id: "rule_1", enabled: false },
        expectedRevision: 7,
        reason: "Tune deployment alerts",
      },
    },
  ]);
});

test("alerts rejects unknown YAML fields before contacting Cloud", async ({
  cloud,
  cli,
}) => {
  const path = join(cli.cwd, "rule.yaml");
  await writeFile(path, `${YAML}unknownOption: true\n`);
  const rejected = await cli.run(
    ["alerts", "create", "--file", path, ...SCOPE],
    { env: SIGNED_IN }
  );
  expect(rejected.exitCode).toBe(2);
  expect(rejected.json).toMatchObject({ error: { code: "usage_error" } });
  expect(cloud.requests).toEqual([]);
  server(cloud);
  cloud.on("GET", "/api/v1/servers/srv_1/alerts/options", {
    body: {
      metrics: [{ name: "tool.calls", description: "Tool call count" }],
      evaluationIntervalMs: 60000,
      maxDurationMs: 3600000,
    },
  });
  const options = await cli.run(["alerts", "options", ...SCOPE], {
    env: SIGNED_IN,
  });
  expect(options.exitCode).toBe(0);
  expect(options.json).toMatchObject({ metrics: [{ name: "tool.calls" }] });
});

test("alerts get filters response extras and remove uses optimistic concurrency", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  const raw = {
    rule: {
      id: "rule_1",
      revision: 7,
      config: { ...CONFIG, hidden: "must not appear" },
      hidden: "must not appear",
    },
  };
  cloud.on("GET", "/api/v1/servers/srv_1/alerts/rules/rule_1", { body: raw });
  const fetched = await cli.run(["alerts", "get", "rule_1", ...SCOPE], {
    env: SIGNED_IN,
  });
  expect(fetched.exitCode).toBe(0);
  expect(fetched.stdout).not.toContain("must not appear");
  cloud.on("DELETE", "/api/v1/servers/srv_1/alerts/rules/rule_1", {
    body: { deleted: true },
  });
  const result = await cli.run(
    ["alerts", "remove", "rule_1", "--yes", ...SCOPE],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toMatchObject({ deleted: true });
  expect(
    cloud.requestsTo("DELETE", "/api/v1/servers/srv_1/alerts/rules/rule_1")
  ).toMatchObject([{ body: { expectedRevision: 7 } }]);
});

test("checklist list and get preserve public fields and pagination", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  cloud.onUndocumented("GET", "/api/v1/server-audits/srv_1/audits", {
    body: {
      items: [{ id: "run_1", status: "completed", hidden: "must not appear" }],
      total: 1,
      limit: 10,
      skip: 5,
    },
  });
  const listed = await cli.run(
    [
      "checklist",
      "list",
      "--branch",
      "preview",
      "--limit",
      "10",
      "--skip",
      "5",
      ...SCOPE,
    ],
    { env: SIGNED_IN }
  );
  expect(listed.exitCode).toBe(0);
  expect(listed.json).toMatchObject({
    items: [{ id: "run_1", status: "completed" }],
    total: 1,
    limit: 10,
    skip: 5,
  });
  expect(listed.stdout).not.toContain("must not appear");
  expect(
    cloud.requestsTo("GET", "/api/v1/server-audits/srv_1/audits")
  ).toMatchObject([{ query: { branch: "preview", limit: "10", skip: "5" } }]);
  cloud.onUndocumented("GET", "/api/v1/server-audits/srv_1/audits/run_1", {
    body: {
      id: "run_1",
      status: "completed",
      checks: [
        {
          checkId: "connect",
          checkName: "Connectivity",
          status: "passed",
          hidden: "must not appear",
        },
      ],
    },
  });
  const fetched = await cli.run(["checklist", "get", "run_1", ...SCOPE], {
    env: SIGNED_IN,
  });
  expect(fetched.exitCode).toBe(0);
  expect(fetched.json).toMatchObject({
    checks: [{ checkId: "connect", status: "passed" }],
  });
  expect(fetched.stdout).not.toContain("must not appear");
});

test("alerts list returns public rule summaries and scopes pagination", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  const response = {
    total: 1,
    rules: [
      {
        id: "rule_1",
        revision: 7,
        config: { ...CONFIG, hidden: "must not appear" },
        status: "active" as const,
      },
    ],
  };
  cloud.on("GET", "/api/v1/servers/srv_1/alerts/rules", { body: response });
  const result = await cli.run(
    ["alerts", "list", "--limit", "10", "--skip", "5", ...SCOPE],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toMatchObject({
    total: 1,
    rules: [{ id: "rule_1", status: "active" }],
  });
  expect(result.stdout).not.toContain("must not appear");
  expect(
    cloud.requestsTo("GET", "/api/v1/servers/srv_1/alerts/rules")
  ).toMatchObject([{ query: { limit: "10", offset: "5" } }]);
});

test("alerts update reports revision conflicts without retrying or overwriting", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  const path = join(cli.cwd, "rule.yaml");
  await writeFile(path, YAML);
  cloud.on("GET", "/api/v1/servers/srv_1/alerts/rules/rule_1", {
    body: { rule: { id: "rule_1", revision: 7, config: CONFIG } },
  });
  cloud.on("PUT", "/api/v1/servers/srv_1/alerts/rules/rule_1", {
    status: 409,
    body: { error: "This rule changed. Reload it before saving." },
  });
  const result = await cli.run(
    ["alerts", "update", "rule_1", "--file", path, ...SCOPE],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({ error: { code: "cloud_api_error" } });
  expect(
    cloud.requestsTo("PUT", "/api/v1/servers/srv_1/alerts/rules/rule_1")
  ).toHaveLength(1);
});
