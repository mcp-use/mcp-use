import { describe, expect } from "vitest";

import { test } from "../helpers/cli-test.js";
import type { FakeCloud } from "../helpers/fake-cloud.js";

const SIGNED_IN = { MCP_USE_API_KEY: "test_key" };

/** Answer today's identity call with one organization, the account default. */
function signInToOrg1(cloud: FakeCloud): void {
  cloud.on("GET", "/api/v1/test-auth", {
    body: {
      user_id: "user_1",
      email: "dev@example.com",
      profiles: [
        {
          id: "org_1",
          profile_name: "Org One",
          slug: "org-one",
          role: "admin",
        },
      ],
      default_profile_id: "org_1",
    },
  });
}

describe("deployment human output", () => {
  test("lists one tab-separated row per deployment, keeping only the first line of an error", async ({
    cloud,
    cli,
  }) => {
    signInToOrg1(cloud);
    cloud.on("GET", "/api/v1/deployments", {
      body: {
        items: [
          {
            id: "12345678-abcd",
            serverId: "server_1",
            status: "failed",
            deploymentTrigger: "manual",
            gitBranch: "main",
            createdAt: "2026-07-24T00:00:00Z",
            error: "Build failed\nvery long build output",
            providerInfo: { noisy: true },
          },
        ],
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

describe("deployment JSON output", () => {
  test("follows build logs until a terminal status and emits exactly one document", async ({
    cloud,
    cli,
  }) => {
    signInToOrg1(cloud);
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
    signInToOrg1(cloud);
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
