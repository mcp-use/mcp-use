import { afterEach, describe, expect, it, vi } from "vitest";

const { api, cloudApiForOrganization } = vi.hoisted(() => {
  const api = { request: vi.fn() };
  return {
    api,
    cloudApiForOrganization: vi.fn(async () => ({
      api,
      organizationId: "org_1",
    })),
  };
});

vi.mock("../../src/commands/cloud-api.js", () => ({
  cloudApiForOrganization,
}));

import { runServers } from "../../src/commands/servers.js";

afterEach(() => {
  vi.restoreAllMocks();
  api.request.mockReset();
  cloudApiForOrganization.mockClear();
});

describe("server environment output safety", () => {
  it("never returns a newly created environment value", async () => {
    api.request.mockResolvedValueOnce([]).mockResolvedValueOnce({
      id: "env_1",
      key: "TOKEN",
      value: "must-not-appear",
    });
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await expect(
      runServers(["env", "set", "server_1", "TOKEN=must-not-appear", "--json"])
    ).resolves.toBe(0);

    const output = stdout.mock.calls.flat().join("");
    expect(output).not.toContain("must-not-appear");
    expect(JSON.parse(output)).toEqual({
      serverId: "server_1",
      key: "TOKEN",
      scope: "production",
      branch: null,
      secret: false,
      updated: false,
    });
  });

  it("never returns an updated preview environment value", async () => {
    api.request
      .mockResolvedValueOnce([{ id: "env_1", key: "TOKEN", branch: "feature" }])
      .mockResolvedValueOnce({
        id: "env_1",
        key: "TOKEN",
        value: "new-secret",
      });
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await expect(
      runServers([
        "env",
        "set",
        "server_1",
        "TOKEN=new-secret",
        "--branch",
        "feature",
        "--secret",
        "--json",
      ])
    ).resolves.toBe(0);

    const output = stdout.mock.calls.flat().join("");
    expect(output).not.toContain("new-secret");
    expect(JSON.parse(output)).toMatchObject({
      scope: "preview",
      branch: "feature",
      secret: true,
      updated: true,
    });
  });
});

describe("server environment deletion", () => {
  it("fails instead of reporting a delete that never happened", async () => {
    // The key exists in production, but the caller scoped the unset to a branch.
    api.request.mockResolvedValueOnce([
      { id: "env_1", key: "TOKEN", branch: null },
    ]);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(
      runServers([
        "env",
        "unset",
        "server_1",
        "TOKEN",
        "--branch",
        "feature",
        "--yes",
        "--json",
      ])
    ).resolves.toBe(1);

    // Only the lookup ran; nothing was deleted.
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toEqual({
      error: {
        code: "env_variable_not_found",
        message:
          "Environment variable not found on server_1 (branch feature): TOKEN",
      },
    });
  });
});

describe("server list argument validation", () => {
  it("rejects a bad page size before authenticating", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runServers(["list", "--limit", "0", "--json"])).resolves.toBe(
      2
    );

    // Nothing should reach the cloud for a command line that cannot run.
    expect(cloudApiForOrganization).not.toHaveBeenCalled();
    expect(api.request).not.toHaveBeenCalled();
    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toEqual({
      error: {
        code: "usage_error",
        message: "--limit must be an integer from 1 to 100.",
      },
    });
  });
});

describe("server human output", () => {
  it("renders a compact list instead of raw API JSON", async () => {
    api.request.mockResolvedValue({
      items: [
        {
          id: "server_1",
          name: "Demo",
          status: "running",
          region: "US",
          updatedAt: "2026-07-24T00:00:00Z",
          connectedRepository: { isManaged: true },
          config: { noisy: { deeply: "nested" } },
        },
      ],
    });
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await expect(runServers(["list"])).resolves.toBe(0);

    const output = stdout.mock.calls.flat().join("");
    expect(output).toContain("NAME\tSTATUS\tSOURCE\tREGION\tUPDATED");
    expect(output).toContain("Demo\trunning\tmanaged\tUS");
    expect(output).not.toContain('"config"');
  });

  it("shows effective GitHub trigger configuration in server detail", async () => {
    api.request.mockResolvedValue({
      id: "server_1",
      name: "Demo",
      connectedRepository: {
        isManaged: false,
        watchPaths: ["apps/api/**"],
        deployBranchPatterns: ["main", "release/*"],
        waitForCi: true,
      },
    });
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await expect(runServers(["get", "server_1"])).resolves.toBe(0);

    const output = stdout.mock.calls.flat().join("");
    expect(output).toContain("Watch paths: apps/api/**");
    expect(output).toContain("Deploy branches: main, release/*");
    expect(output).toContain("Wait for CI: yes");
  });
});

describe("server trigger configuration", () => {
  it("updates and clears documented GitHub trigger fields", async () => {
    api.request.mockResolvedValue({ id: "server_1" });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runServers([
        "update",
        "server_1",
        "--watch-paths",
        "apps/api/**",
        "--watch-paths",
        "packages/shared/**",
        "--deploy-branches",
        "release/*",
        "--wait-for-ci",
        "--json",
      ])
    ).resolves.toBe(0);

    expect(api.request).toHaveBeenCalledWith("/servers/server_1", {
      method: "PATCH",
      body: JSON.stringify({
        watchPaths: ["apps/api/**", "packages/shared/**"],
        deployBranchPatterns: ["release/*"],
        waitForCi: true,
      }),
    });

    api.request.mockClear();
    await expect(
      runServers([
        "update",
        "server_1",
        "--watch-paths",
        "",
        "--deploy-branches",
        "",
        "--no-wait-for-ci",
        "--json",
      ])
    ).resolves.toBe(0);

    expect(api.request).toHaveBeenCalledWith("/servers/server_1", {
      method: "PATCH",
      body: JSON.stringify({
        watchPaths: [],
        deployBranchPatterns: [],
        waitForCi: false,
      }),
    });
  });

  it("rejects conflicting wait-for-CI switches", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(
      runServers([
        "update",
        "server_1",
        "--wait-for-ci",
        "--no-wait-for-ci",
        "--json",
      ])
    ).resolves.toBe(2);

    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: { code: "usage_error" },
    });
    expect(api.request).not.toHaveBeenCalled();
  });
});
