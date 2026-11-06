import { createServer } from "node:net";

import { describe, expect } from "vitest";

import { test } from "../helpers/cli-test.js";
import { deployment, organization } from "../helpers/cloud-fixtures.js";
import { SIGNED_IN, signIn } from "../helpers/cloud-auth.js";

describe("deployment human output", () => {
  test("lists deployment details, keeping only the first line of an error", async ({
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
    expect(result.stdout).toContain("Deployments");
    expect(result.stdout).toContain("failed");
    expect(result.stdout).toContain("12345678-abcd");
    expect(result.stdout).toContain("main");
    expect(result.stdout).toContain("Build failed");
    expect(result.stdout).not.toContain("very long build output");
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
    expect(result.json).toMatchObject({
      error: { code: "organization_not_found" },
    });
    expect(cloud.requestsTo("GET", "/api/v1/deployments")).toEqual([]);
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
    expect(result.stdout).toContain("Deployment failed");
    expect(result.stdout).toContain("ID       dep_1");
    expect(result.stdout).toContain("Source   main");
    expect(result.stdout).toContain("Error: Build failed");
    expect(result.stdout).toContain("Build logs: mcp-use logs dep_1 --build");
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
