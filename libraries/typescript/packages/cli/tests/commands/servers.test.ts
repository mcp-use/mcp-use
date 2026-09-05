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

  it("clears an existing sensitive flag when --secret is not repeated on update, and warns", async () => {
    api.request
      .mockResolvedValueOnce([{ id: "env_1", key: "TOKEN", sensitive: true }])
      .mockResolvedValueOnce({
        id: "env_1",
        key: "TOKEN",
        value: "rotated",
      });
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await expect(
      runServers(["env", "set", "server_1", "TOKEN=rotated", "--json"])
    ).resolves.toBe(0);

    expect(api.request).toHaveBeenLastCalledWith(
      "/servers/server_1/env-variables/env_1",
      {
        method: "PATCH",
        body: JSON.stringify({
          key: "TOKEN",
          value: "rotated",
          branch: null,
          environments: ["production"],
          sensitive: false,
        }),
      }
    );

    const output = stdout.mock.calls.flat().join("");
    expect(JSON.parse(output)).toMatchObject({
      secret: false,
    });
  });

  it("prints a human-readable warning when a write downgrades an existing secret", async () => {
    api.request
      .mockResolvedValueOnce([{ id: "env_1", key: "TOKEN", sensitive: true }])
      .mockResolvedValueOnce({
        id: "env_1",
        key: "TOKEN",
        value: "rotated",
      });
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await expect(
      runServers(["env", "set", "server_1", "TOKEN=rotated"])
    ).resolves.toBe(0);

    const output = stdout.mock.calls.flat().join("");
    expect(output).toContain("is no longer write-only");
  });

  it("does not mark a brand-new variable sensitive by default", async () => {
    api.request.mockResolvedValueOnce([]).mockResolvedValueOnce({
      id: "env_2",
      key: "NEW_VAR",
      value: "value",
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runServers(["env", "set", "server_1", "NEW_VAR=value", "--json"])
    ).resolves.toBe(0);

    expect(api.request).toHaveBeenLastCalledWith(
      "/servers/server_1/env-variables",
      {
        method: "POST",
        body: JSON.stringify({
          key: "NEW_VAR",
          value: "value",
          branch: null,
          environments: ["production"],
          sensitive: false,
        }),
      }
    );
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
