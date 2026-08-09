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

import { runDeployments } from "../../src/commands/deployments.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  api.request.mockReset();
});

describe("deployment human output", () => {
  it("renders a compact list and truncates multiline failures", async () => {
    api.request.mockResolvedValue({
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
    });
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await expect(runDeployments(["list"])).resolves.toBe(0);

    const output = stdout.mock.calls.flat().join("");
    expect(output).toContain(
      "DEPLOYMENT\tSERVER\tSTATUS\tTRIGGER\tBRANCH\tCREATED\tERROR"
    );
    expect(output).toContain(
      "12345678\tserver_1\tfailed\tmanual\tmain\t2026-07-24T00:00:00Z\tBuild failed"
    );
    expect(output).not.toContain("very long build output");
    expect(output).not.toContain('"providerInfo"');
  });
});

describe("deployment JSON output", () => {
  it("emits exactly one terminal document while following build logs", async () => {
    vi.useFakeTimers();
    api.request
      .mockResolvedValueOnce({
        logs: "building\n",
        offset: 9,
        totalLength: 9,
        status: "building",
      })
      .mockResolvedValueOnce({
        logs: "ready\n",
        offset: 15,
        totalLength: 15,
        status: "running",
      });
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const result = runDeployments([
      "logs",
      "deployment_1",
      "--build",
      "--follow",
      "--json",
    ]);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe(0);

    const output = stdout.mock.calls.flat().join("");
    expect(output.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(output)).toEqual({
      deploymentId: "deployment_1",
      offset: 15,
      logs: "building\nready\n",
      status: "running",
    });
  });

  it("emits one document when a build log page is empty", async () => {
    api.request.mockResolvedValue({
      logs: "",
      offset: 0,
      totalLength: 0,
      status: "failed",
    });
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await expect(
      runDeployments(["logs", "deployment_1", "--build", "--json"])
    ).resolves.toBe(0);

    expect(JSON.parse(stdout.mock.calls.flat().join(""))).toEqual({
      deploymentId: "deployment_1",
      offset: 0,
      logs: "",
      status: "failed",
    });
  });
});
