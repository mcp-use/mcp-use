import { expect } from "vitest";
import { test } from "../helpers/cli-test.js";
import { signIn, SIGNED_IN } from "../helpers/cloud-auth.js";
import { server as serverFixture } from "../helpers/cloud-fixtures.js";
import type { FakeCloud } from "../helpers/fake-cloud.js";

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

const DOMAIN = {
  domain: "weather.example.com",
  verified: false,
  hostnameId: "host_1",
  status: "pending",
  sslStatus: "pending",
  cnameTarget: "domains.example.com",
  configuredAt: null,
  verificationErrors: null,
};

test("domains get resolves a server slug and returns domain verification records", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  cloud.on("GET", "/api/v1/servers/srv_1/domain/status", { body: DOMAIN });
  const result = await cli.run(
    ["domains", "get", "--server", "weather", "--json"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.json).toMatchObject({
    domain: "weather.example.com",
    cnameTarget: "domains.example.com",
    verified: false,
  });
  expect(
    cloud.requestsTo("GET", "/api/v1/servers/srv_1/domain/status")
  ).toMatchObject([
    { headers: { "x-profile-id": "org_1", "x-api-key": "test_key" } },
  ]);
});

test("domains add sends the branch and prints the CNAME target", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  cloud.on("POST", "/api/v1/servers/srv_1/domain/request", {
    body: {
      success: true,
      domain: "weather.example.com",
      hostnameId: "host_1",
      status: "pending",
      sslStatus: "pending",
      cnameTarget: "domains.example.com",
      dnsInstructions: "Create the DNS record.",
    },
  });
  const result = await cli.run(
    [
      "domains",
      "add",
      "weather.example.com",
      "--server",
      "weather",
      "--branch",
      "preview",
    ],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(
    "CNAME weather.example.com → domains.example.com"
  );
  expect(
    cloud.requestsTo("POST", "/api/v1/servers/srv_1/domain/request")
  ).toMatchObject([
    { body: { domain: "weather.example.com", branch: "preview" } },
  ]);
});

test("domains set-subdomain updates only the server slug", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  cloud.on("PATCH", "/api/v1/servers/srv_1", {
    body: serverFixture({ id: "srv_1", slug: "new-weather" }),
  });
  const result = await cli.run(
    [
      "domains",
      "set-subdomain",
      "new-weather",
      "--server",
      "weather",
      "--json",
    ],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toMatchObject({
    serverId: "srv_1",
    subdomain: "new-weather",
  });
  expect(
    cloud
      .requestsTo("PATCH", "/api/v1/servers/srv_1")
      .map((request) => request.body)
  ).toEqual([{ slug: "new-weather" }]);
});

test("domains verify scopes the request to the selected domain", async ({
  cloud,
  cli,
}) => {
  server(cloud);
  cloud.on("POST", "/api/v1/servers/srv_1/domain/verify", {
    body: { success: true, verified: true },
  });
  const result = await cli.run(
    [
      "domains",
      "verify",
      "--server",
      "weather",
      "--domain-id",
      "dom_1",
      "--json",
    ],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toMatchObject({ verified: true });
  expect(
    cloud.requestsTo("POST", "/api/v1/servers/srv_1/domain/verify")
  ).toMatchObject([{ query: { domainId: "dom_1" } }]);
});

test("domains rm requires confirmation and remove accepts --yes", async ({
  cloud,
  cli,
}) => {
  const rejected = await cli.run(
    ["domains", "rm", "--server", "weather", "--json"],
    { env: SIGNED_IN }
  );
  expect(rejected.exitCode).toBe(2);
  expect(cloud.requests).toEqual([]);
  server(cloud);
  cloud.on("DELETE", "/api/v1/servers/srv_1/domain", {
    body: { success: true, message: "Domain removed." },
  });
  const result = await cli.run(
    ["domains", "remove", "--server", "weather", "--yes", "--json"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toMatchObject({ success: true });
  expect(
    cloud.requestsTo("DELETE", "/api/v1/servers/srv_1/domain")
  ).toHaveLength(1);
});

test("github connect returns the installation URL scoped to the organization", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/github/connect-url", {
    body: {
      url: "https://github.com/apps/example/installations/new",
      expiresInSeconds: 600,
    },
  });
  const result = await cli.run(["github", "connect", "--json"], {
    env: SIGNED_IN,
  });
  expect(result.exitCode).toBe(0);
  expect(result.json).toEqual({
    url: "https://github.com/apps/example/installations/new",
    expiresInSeconds: 600,
  });
  expect(cloud.requestsTo("GET", "/api/v1/github/connect-url")).toMatchObject([
    { query: { organizationId: "org_1" } },
  ]);
});

test("github repos auto-selects a unique active installation and preserves pagination", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/github/installations", {
    body: {
      installations: [
        {
          id: "link_1",
          installationId: "123",
          organizationId: "org_1",
          isActive: true,
          account: { login: "example", type: "Organization" },
        },
      ],
    },
  });
  cloud.on("GET", "/api/v1/github/installations/123/repos", {
    body: {
      repos: [
        {
          id: 1,
          name: "weather",
          fullName: "example/weather",
          private: true,
          htmlUrl: "https://github.com/example/weather",
          defaultBranch: "main",
          pushedAt: null,
          ownerAvatarUrl: null,
        },
      ],
      page: 2,
      perPage: 10,
      totalCount: 11,
      hasMore: false,
      mode: "browse",
    },
  });
  const result = await cli.run(
    ["github", "repos", "--page", "2", "--limit", "10", "--json"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toMatchObject({
    repos: [{ fullName: "example/weather" }],
    page: 2,
    hasMore: false,
  });
  expect(
    cloud.requestsTo("GET", "/api/v1/github/installations/123/repos")
  ).toMatchObject([{ query: { page: "2", perPage: "10" } }]);
});

test("github repos requires an installation when selection is ambiguous", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/github/installations", {
    body: { installations: [] },
  });
  const rejected = await cli.run(["github", "repos", "--json"], {
    env: SIGNED_IN,
  });
  expect(rejected.exitCode).toBe(2);
  expect(rejected.json).toMatchObject({ error: { code: "usage_error" } });
  cloud.on("GET", "/api/v1/github/installations/123/repos", {
    body: {
      repos: [],
      page: 1,
      perPage: 50,
      totalCount: 0,
      hasMore: false,
      mode: "browse",
    },
  });
  const accepted = await cli.run(
    ["github", "repos", "--installation", "123", "--json"],
    { env: SIGNED_IN }
  );
  expect(accepted.exitCode).toBe(0);
  expect(
    cloud.requestsTo("GET", "/api/v1/github/installations/123/repos")
  ).toHaveLength(1);
});
