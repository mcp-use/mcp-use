import { createServer } from "node:net";

import { describe, expect } from "vitest";

import { test } from "../helpers/cli-test.js";
import { deployment, organization } from "../helpers/cloud-fixtures.js";
import { SIGNED_IN, signIn } from "../helpers/cloud-auth.js";

describe("deployment human output", () => {
  test("lists one tab-separated row per deployment, keeping only the first line of an error", async ({
    cloud,
    cli,
  }) => {
    signIn(cloud);
    cloud.on("GET", "/api/v1/deployments", {
      body: {
        items: [
          deployment({
            id: "12345678-abcd",
            serverId: "server_1",
            status: "failed",
            deploymentTrigger: "manual",
            gitBranch: "main",
            createdAt: "2026-07-24T00:00:00Z",
            error: "Build failed\nvery long build output",
          }),
        ],
        total: 1,
        limit: 30,
        skip: 0,
      },
    });

    const result = await cli.run(["deployments", "list"], { env: SIGNED_IN });

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "DEPLOYMENT\tSERVER\tSTATUS\tTRIGGER\tBRANCH\tCREATED\tERROR\n" +
        "12345678\tserver_1\tfailed\tmanual\tmain\t2026-07-24T00:00:00Z\tBuild failed\n"
    );
    expect(cloud.requestsTo("GET", "/api/v1/deployments")).toMatchObject([
      {
        query: { limit: "30", skip: "0" },
        headers: { "x-api-key": "test_key", "x-profile-id": "org_1" },
      },
    ]);
  });
});

describe("organization selection", () => {
  test("--org picks the organization by slug, and requests carry its id", async ({
    cloud,
    cli,
  }) => {
    cloud.on("GET", "/api/v1/organizations", {
      body: {
        organizations: [
          organization({ id: "org_1", slug: "org-one" }),
          organization({ id: "org_2", slug: "org-two" }),
        ],
      },
    });
    cloud.on("GET", "/api/v1/deployments", {
      body: { items: [], total: 0, limit: 30, skip: 0 },
    });

    const result = await cli.run(
      ["deployments", "list", "--org", "org-two", "--json"],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(0);
    expect(cloud.requestsTo("GET", "/api/v1/deployments")).toMatchObject([
      { headers: { "x-profile-id": "org_2" } },
    ]);
  });

  test("an unknown --org is organization_not_found, and nothing is listed", async ({
    cloud,
    cli,
  }) => {
    signIn(cloud);

    const result = await cli.run(
      ["deployments", "list", "--org", "org-nine", "--json"],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(1);
    expect(result.errorJson).toMatchObject({
      error: { code: "organization_not_found" },
    });
    expect(cloud.requestsTo("GET", "/api/v1/deployments")).toEqual([]);
  });
});

describe("deployment JSON output", () => {
  test("follows build logs until a terminal status and emits exactly one document", async ({
    cloud,
    cli,
  }) => {
    signIn(cloud);
    // Two replies: a third poll after "running" would be unhandled and fail.
    cloud.sequence("GET", "/api/v1/deployments/deployment_1/build-logs", [
      {
        body: {
          logs: "building\n",
          offset: 9,
          totalLength: 9,
          status: "building",
        },
      },
      {
        body: {
          logs: "ready\n",
          offset: 15,
          totalLength: 15,
          status: "running",
        },
      },
    ]);

    const result = await cli.run(
      ["deployments", "logs", "deployment_1", "--build", "--follow", "--json"],
      { env: SIGNED_IN }
    );

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    // `json` is undefined unless stdout is a single JSON document.
    expect(result.json).toEqual({
      deploymentId: "deployment_1",
      offset: 15,
      logs: "building\nready\n",
      status: "running",
    });
    expect(
      cloud
        .requestsTo("GET", "/api/v1/deployments/deployment_1/build-logs")
        .map((request) => request.query)
    ).toEqual([{ offset: "0" }, { offset: "9" }]);
  });

  test("emits one document when a build log page is empty", async ({
    cloud,
    cli,
  }) => {
    signIn(cloud);
    // One reply: without --follow the CLI must not poll again.
    cloud.sequence("GET", "/api/v1/deployments/deployment_1/build-logs", [
      { body: { logs: "", offset: 0, totalLength: 0, status: "failed" } },
    ]);

    const result = await cli.run(
      ["deployments", "logs", "deployment_1", "--build", "--json"],
      { env: SIGNED_IN }
    );

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual({
      deploymentId: "deployment_1",
      offset: 0,
      logs: "",
      status: "failed",
    });
  });
});

describe("deployments get", () => {
  test("--json prints the deployment Cloud returned as the only output", async ({
    cloud,
    cli,
  }) => {
    signIn(cloud);
    const failed = deployment({
      id: "dep_1",
      status: "failed",
      error: "Build failed",
    });
    cloud.on("GET", "/api/v1/deployments/dep_1", { body: failed });

    const result = await cli.run(["deployments", "get", "dep_1", "--json"], {
      env: SIGNED_IN,
    });

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual(failed);
    expect(cloud.requestsTo("GET", "/api/v1/deployments/dep_1")).toMatchObject([
      { headers: { "x-api-key": "test_key", "x-profile-id": "org_1" } },
    ]);
  });

  test("prints one field per line, with the build logs command for a failed deployment", async ({
    cloud,
    cli,
  }) => {
    signIn(cloud);
    cloud.on("GET", "/api/v1/deployments/dep_1", {
      body: deployment({
        id: "dep_1",
        serverId: "server_1",
        status: "failed",
        deploymentTrigger: "manual",
        gitBranch: "main",
        createdAt: "2026-07-24T00:00:00Z",
        error: "Build failed\nvery long build output",
      }),
    });

    const result = await cli.run(["deployments", "get", "dep_1"], {
      env: SIGNED_IN,
    });

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "Deployment: dep_1",
        "Server: server_1",
        "Status: failed",
        "Trigger: manual",
        "Branch: main",
        "Created: 2026-07-24T00:00:00Z",
        "Error: Build failed",
        "Build logs: mcp-use deployments logs dep_1 --build",
        "",
      ].join("\n")
    );
  });

  test("an unknown deployment is a deployment_not_found error on stdout, exit 1", async ({
    cloud,
    cli,
  }) => {
    signIn(cloud);
    cloud.on("GET", "/api/v1/deployments/dep_missing", {
      status: 404,
      body: { error: "Deployment not found" },
    });

    const result = await cli.run(
      ["deployments", "get", "dep_missing", "--json"],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.json).toEqual({
      error: {
        code: "deployment_not_found",
        message: expect.any(String),
        nextSteps: [
          {
            description: "List deployments",
            command: "mcp-use deployments list --json",
          },
        ],
      },
    });
  });

  test("a missing deployment ID is a usage error, exit 2, and calls no Cloud API", async ({
    cloud,
    cli,
  }) => {
    const result = await cli.run(["deployments", "get", "--json"], {
      env: SIGNED_IN,
    });

    expect(result.exitCode).toBe(2);
    expect(result.json).toMatchObject({ error: { code: "usage_error" } });
    expect(cloud.requests).toEqual([]);
  });

  test("without credentials it is a not_authenticated error that suggests logging in", async ({
    cloud,
    cli,
  }) => {
    const result = await cli.run(["deployments", "get", "dep_1", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(result.json).toEqual({
      error: {
        code: "not_authenticated",
        message: expect.any(String),
        nextSteps: [
          { description: "Log in to Manufact Cloud", command: "mcp-use login" },
        ],
      },
    });
    expect(cloud.requests).toEqual([]);
  });

  test("an unreachable Cloud is a cloud_unreachable error, exit 1", async ({
    cli,
  }) => {
    const result = await cli.run(["deployments", "get", "dep_1", "--json"], {
      env: { ...SIGNED_IN, MCP_USE_CLOUD_API_URL: await closedOrigin() },
    });

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      error: { code: "cloud_unreachable", nextSteps: [] },
    });
  });
});

/** An origin on a localhost port nothing listens on. */
async function closedOrigin(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}
