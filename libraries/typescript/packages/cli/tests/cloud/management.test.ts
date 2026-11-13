import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { test } from "../helpers/cli-test.js";
import { signIn, SIGNED_IN } from "../helpers/cloud-auth.js";
import { deployment, server } from "../helpers/cloud-fixtures.js";

const variable = {
  id: "var_1",
  serverId: "srv_1",
  key: "TOKEN",
  environments: ["production"],
  phase: "both",
  sensitive: true,
  branch: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

test("env rotates a sensitive value without clearing its flag or printing the secret", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/servers/srv_1", { body: server({ id: "srv_1" }) });
  const withValue = { ...variable, value: "old-secret" };
  cloud.on("GET", "/api/v1/servers/srv_1/env-variables", { body: [withValue] });
  cloud.on("PATCH", "/api/v1/servers/srv_1/env-variables/var_1", {
    body: { ...variable },
  });
  const result = await cli.run(
    ["env", "set", "TOKEN=new-secret", "--server", "srv_1", "--json"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain("new-secret");
  expect(result.stdout).not.toContain("old-secret");
  expect(result.json).toMatchObject({
    variables: [{ key: "TOKEN", sensitive: true }],
  });
  expect(
    cloud.requestsTo("PATCH", "/api/v1/servers/srv_1/env-variables/var_1")[0]
      ?.body
  ).toEqual({
    value: "new-secret",
    environments: ["production"],
    phase: "both",
    sensitive: true,
    branch: null,
  });
});

test("env reads a secret from stdin and scopes it to one preview branch", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/servers/srv_1", { body: server({ id: "srv_1" }) });
  cloud.on("GET", "/api/v1/servers/srv_1/env-variables", { body: [] });
  cloud.on("POST", "/api/v1/servers/srv_1/env-variables", {
    body: {
      ...variable,
      environments: ["preview"],
      branch: "feature",
      phase: "runtime",
    },
  });
  const result = await cli.run(
    [
      "env",
      "set",
      "TOKEN",
      "--sensitive",
      "--branch",
      "feature",
      "--phase",
      "runtime",
      "--server",
      "srv_1",
      "--json",
    ],
    { env: SIGNED_IN, input: "piped-secret\n" }
  );
  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain("piped-secret");
  expect(
    cloud.requestsTo("GET", "/api/v1/servers/srv_1/env-variables")[0]?.query
  ).toEqual({ branch: "feature" });
  expect(
    cloud.requestsTo("POST", "/api/v1/servers/srv_1/env-variables")[0]?.body
  ).toEqual({
    key: "TOKEN",
    value: "piped-secret",
    environments: ["preview"],
    phase: "runtime",
    sensitive: true,
    branch: "feature",
  });
});

test("env list strips values even when Cloud returns them", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/servers/srv_1", { body: server({ id: "srv_1" }) });
  const value = { ...variable, value: "must-never-appear" };
  cloud.on("GET", "/api/v1/servers/srv_1/env-variables", { body: [value] });
  const result = await cli.run(["env", "list", "--server", "srv_1", "--json"], {
    env: SIGNED_IN,
  });
  expect(result.exitCode).toBe(0);
  expect(result.json).toEqual([variable]);
  expect(result.stdout).not.toContain("must-never-appear");
});

test("env validates scope before making requests", async ({ cloud, cli }) => {
  const result = await cli.run(
    [
      "env",
      "set",
      "TOKEN=value",
      "--environment",
      "production",
      "--branch",
      "feature",
      "--json",
    ],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(2);
  expect(result.json).toMatchObject({ error: { code: "usage_error" } });
  expect(cloud.requests).toEqual([]);
});

test("logs passes duration and deployment filters to the log API", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/deployments/dep_1", {
    body: deployment({ id: "dep_1", serverId: "srv_1" }),
  });
  const line = {
    time: "2026-01-01T00:00:00Z",
    message: "ready",
    logType: "runtime" as const,
    deploymentId: "dep_1",
    appName: null,
    level: null,
    region: null,
    instanceId: null,
  };
  cloud.on("GET", "/api/v1/servers/srv_1/logs", {
    body: {
      logs: [line],
      window: { start: "2026-01-01T00:00:00Z", end: "2026-01-01T00:01:00Z" },
    },
  });
  const result = await cli.run(
    ["logs", "dep_1", "--since", "5m", "--limit", "20", "--json"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toEqual({
    serverId: "srv_1",
    deploymentId: "dep_1",
    logs: [line],
  });
  expect(
    cloud.requestsTo("GET", "/api/v1/servers/srv_1/logs")[0]?.query
  ).toMatchObject({
    type: "runtime",
    deploymentId: "dep_1",
    limit: "20",
    order: "asc",
  });
  expect(
    Number.isNaN(
      Date.parse(
        cloud.requestsTo("GET", "/api/v1/servers/srv_1/logs")[0]!.query.start!
      )
    )
  ).toBe(false);
});

test("deployments promote uses the activation endpoint", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  cloud.on("POST", "/api/v1/deployments/dep_1/activate", {
    body: deployment({
      id: "dep_1",
      serverId: "srv_1",
      isProductionDeployment: true,
    }),
  });
  const result = await cli.run(
    ["deployments", "promote", "dep_1", "--yes", "--json"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toMatchObject({
    id: "dep_1",
    isProductionDeployment: true,
  });
  expect(
    cloud.requestsTo("POST", "/api/v1/deployments/dep_1/activate")
  ).toHaveLength(1);
});

test("org use saves the active organization in the credential file", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  const result = await cli.run(["org", "use", "org-one", "--json"], {
    env: SIGNED_IN,
  });
  expect(result.exitCode).toBe(0);
  expect(
    JSON.parse(await readFile(join(cli.home, ".manufact", "auth.json"), "utf8"))
  ).toMatchObject({ orgId: "org_1", orgSlug: "org-one" });
});

test("org create derives a slug and sends a typed creation request", async ({
  cloud,
  cli,
}) => {
  cloud.on("POST", "/api/auth/organization/create", {
    body: { id: "org_2", name: "New Team", slug: "new-team" },
  });
  const result = await cli.run(["org", "create", "New Team", "--json"], {
    env: SIGNED_IN,
  });
  expect(result.exitCode).toBe(0);
  expect(result.json).toMatchObject({ id: "org_2", slug: "new-team" });
  expect(
    cloud.requestsTo("POST", "/api/auth/organization/create")[0]?.body
  ).toEqual({ name: "New Team", slug: "new-team" });
});

test("env push reads a dotenv file and sends every assignment without printing values", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  await writeFile(
    join(cli.cwd, ".env"),
    "# App settings\nTOKEN='file-secret'\nexport MODE=live\n"
  );
  cloud.on("GET", "/api/v1/servers/srv_1", { body: server({ id: "srv_1" }) });
  cloud.on("GET", "/api/v1/servers/srv_1/env-variables", { body: [] });
  cloud.sequence("POST", "/api/v1/servers/srv_1/env-variables", [
    { body: variable },
    { body: { ...variable, id: "var_2", key: "MODE" } },
  ]);
  const result = await cli.run(
    ["env", "push", ".env", "--server", "srv_1", "--json"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain("file-secret");
  expect(
    cloud
      .requestsTo("POST", "/api/v1/servers/srv_1/env-variables")
      .map((request) => request.body)
  ).toEqual([
    {
      key: "TOKEN",
      value: "file-secret",
      environments: ["production"],
      phase: "both",
      sensitive: false,
      branch: null,
    },
    {
      key: "MODE",
      value: "live",
      environments: ["production"],
      phase: "both",
      sensitive: false,
      branch: null,
    },
  ]);
});

test("env push uploads the values Node loads from the same file", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  await writeFile(
    join(cli.cwd, ".env"),
    [
      'API_URL="https://api.example.com" # production',
      'PRIVATE_KEY="-----BEGIN KEY-----\\nabc\\n-----END KEY-----"',
      'CERT="line one',
      'line two"',
      "NAME = Weather",
      "",
    ].join("\n")
  );
  cloud.on("GET", "/api/v1/servers/srv_1", { body: server({ id: "srv_1" }) });
  cloud.on("GET", "/api/v1/servers/srv_1/env-variables", { body: [] });
  cloud.on("POST", "/api/v1/servers/srv_1/env-variables", { body: variable });
  const result = await cli.run(
    ["env", "push", ".env", "--server", "srv_1", "--json"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain("BEGIN KEY");
  expect(
    cloud
      .requestsTo("POST", "/api/v1/servers/srv_1/env-variables")
      .map((request) => [request.body.key, request.body.value])
  ).toEqual([
    ["API_URL", "https://api.example.com"],
    ["PRIVATE_KEY", "-----BEGIN KEY-----\nabc\n-----END KEY-----"],
    ["CERT", "line one\nline two"],
    ["NAME", "Weather"],
  ]);
});

test("env rm preserves a shared variable in its other environments", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/servers/srv_1", { body: server({ id: "srv_1" }) });
  cloud.on("GET", "/api/v1/servers/srv_1/env-variables", {
    body: [{ ...variable, environments: ["production", "development"] }],
  });
  cloud.on("PATCH", "/api/v1/servers/srv_1/env-variables/var_1", {
    body: { ...variable, environments: ["development"] },
  });
  const result = await cli.run(
    ["env", "rm", "TOKEN", "--server", "srv_1", "--yes", "--json"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toEqual({
    removed: "TOKEN",
    environment: "production",
    branch: null,
  });
  expect(
    cloud.requestsTo("PATCH", "/api/v1/servers/srv_1/env-variables/var_1")[0]
      ?.body
  ).toEqual({ environments: ["development"] });
  expect(
    cloud.requestsTo("DELETE", "/api/v1/servers/srv_1/env-variables/var_1")
  ).toHaveLength(0);
});

test("org update uploads the logo as multipart without sending a local path to Cloud", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  await writeFile(join(cli.cwd, "logo.png"), "logo-bytes");
  cloud.on("POST", "/api/v1/organizations/org_1/logo", {
    body: { url: "https://example.com/logo.png" },
  });
  const result = await cli.run(
    ["org", "update", "--logo", "logo.png", "--json"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toMatchObject({
    id: "org_1",
    logo: "https://example.com/logo.png",
  });
  const request = cloud.requestsTo(
    "POST",
    "/api/v1/organizations/org_1/logo"
  )[0]!;
  expect(request.headers["content-type"]).toContain(
    "multipart/form-data; boundary="
  );
  expect(request.rawBody.toString()).toContain("logo-bytes");
  expect(request.rawBody.toString()).not.toContain(cli.cwd);
});

test("servers repo auto-selection uses the provider id for access and the stored row id for connection", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/servers/weather", {
    body: server({ id: "srv_1", slug: "weather" }),
  });
  cloud.on("GET", "/api/v1/github/installations", {
    body: {
      installations: [
        {
          id: "installation_row_1",
          installationId: "12345678",
          account: null,
          organizationId: "org_1",
          isActive: true,
        },
      ],
    },
  });
  cloud.on(
    "GET",
    "/api/v1/github/installations/12345678/repos/acme/weather/access",
    { body: { hasAccess: true } }
  );
  cloud.on("PUT", "/api/v1/servers/srv_1/repository", {
    body: { server: { id: "srv_1", name: "Weather", slug: "weather" } },
  });

  const result = await cli.run(
    ["servers", "update", "weather", "--repo", "acme/weather", "--json"],
    { env: SIGNED_IN }
  );

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.json).toMatchObject({
    repository: { server: { id: "srv_1" } },
  });
  expect(
    cloud.requestsTo("GET", "/api/v1/github/installations")[0]?.query
  ).toEqual({
    organizationId: "org_1",
  });
  expect(
    cloud.requestsTo(
      "GET",
      "/api/v1/github/installations/12345678/repos/acme/weather/access"
    )
  ).toHaveLength(1);
  expect(
    cloud.requestsTo("PUT", "/api/v1/servers/srv_1/repository")[0]?.body
  ).toEqual({
    installationId: "installation_row_1",
    repoFullName: "acme/weather",
    productionBranch: "main",
  });
});
