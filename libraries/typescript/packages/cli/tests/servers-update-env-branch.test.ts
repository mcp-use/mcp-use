import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the MCP-1794 / `servers update` CLI work:
 *  - `servers update` field mapping (branch -> productionBranch, build/start
 *    commands nested under config)
 *  - env-var branch scoping + resolving a variable by KEY
 *  - deploy-time env sync honoring a branch scope
 */

const mockApiInstance = {
  updateServer: vi.fn(),
  listEnvVariables: vi.fn(),
  createEnvVariable: vi.fn(),
  updateEnvVariable: vi.fn(),
  deleteEnvVariable: vi.fn(),
  testAuth: vi.fn(),
};

vi.mock("../src/utils/api.js", () => {
  return {
    McpUseAPI: class {
      static async create() {
        return mockApiInstance;
      }
      constructor() {
        return mockApiInstance;
      }
    },
    ApiUnauthorizedError: class ApiUnauthorizedError extends Error {},
  };
});

vi.mock("../src/utils/config.js", () => {
  return {
    isLoggedIn: vi.fn(async () => true),
    getApiKey: vi.fn(),
    getApiUrl: vi.fn(),
    getOrgId: vi.fn(),
    getWebUrl: vi.fn(async () => "https://mcp-use.com"),
    readConfig: vi.fn(async () => ({})),
  };
});

// Record handled errors instead of exiting the process.
const handleCommandError = vi.fn();
vi.mock("../src/utils/errors.js", () => ({ handleCommandError }));

vi.mock("chalk", () => {
  const passthrough: any = new Proxy(
    function passthrough(s: string) {
      return s;
    },
    {
      get: () => passthrough,
      apply: (_t, _this, args) => args[0],
    }
  );
  return { default: passthrough };
});

vi.mock("node:readline", () => {
  return {
    createInterface: vi.fn(() => ({
      question: vi.fn((_q, cb) => cb("y")),
      close: vi.fn(),
    })),
  };
});

const SERVER_ID = "11111111-1111-1111-1111-111111111111";
const VAR_ID = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("servers update field mapping", () => {
  it("maps --branch to productionBranch and build/start commands into config", async () => {
    const { createServersCommand } = await import("../src/commands/servers.js");
    mockApiInstance.updateServer.mockResolvedValue({
      id: SERVER_ID,
      name: "my-server",
      slug: "my-server",
      connectedRepository: { productionBranch: "dev" },
    });

    const cmd = createServersCommand();
    await cmd.parseAsync(
      [
        "update",
        SERVER_ID,
        "--branch",
        "dev",
        "--build-command",
        "npm run build",
        "--start-command",
        "npm start",
        "--name",
        "renamed",
      ],
      { from: "user" }
    );

    expect(mockApiInstance.updateServer).toHaveBeenCalledTimes(1);
    expect(mockApiInstance.updateServer).toHaveBeenCalledWith(SERVER_ID, {
      name: "renamed",
      productionBranch: "dev",
      config: { buildCommand: "npm run build", startCommand: "npm start" },
    });
  });

  it("maps empty --build-command / --start-command to null (clear override)", async () => {
    const { createServersCommand } = await import("../src/commands/servers.js");
    mockApiInstance.updateServer.mockResolvedValue({
      id: SERVER_ID,
      name: "my-server",
      slug: "my-server",
    });

    const cmd = createServersCommand();
    await cmd.parseAsync(
      ["update", SERVER_ID, "--build-command", "", "--start-command", ""],
      { from: "user" }
    );

    expect(mockApiInstance.updateServer).toHaveBeenCalledWith(SERVER_ID, {
      config: { buildCommand: null, startCommand: null },
    });
  });

  it("maps watch paths / deploy branches / wait-for-ci / root-dir", async () => {
    const { createServersCommand } = await import("../src/commands/servers.js");
    mockApiInstance.updateServer.mockResolvedValue({
      id: SERVER_ID,
      name: "my-server",
      slug: "my-server",
    });

    const cmd = createServersCommand();
    await cmd.parseAsync(
      [
        "update",
        SERVER_ID,
        "--watch-paths",
        "apps/foo/**",
        "packages/shared/**",
        "--deploy-branches",
        "release/*",
        "--wait-for-ci",
        "--root-dir",
        "apps/foo",
      ],
      { from: "user" }
    );

    expect(mockApiInstance.updateServer).toHaveBeenCalledWith(SERVER_ID, {
      watchPaths: ["apps/foo/**", "packages/shared/**"],
      deployBranchPatterns: ["release/*"],
      waitForCi: true,
      config: { rootDir: "apps/foo" },
    });
  });

  it("clears watch paths / deploy branches and resets root dir with empty values", async () => {
    const { createServersCommand } = await import("../src/commands/servers.js");
    mockApiInstance.updateServer.mockResolvedValue({
      id: SERVER_ID,
      name: "my-server",
      slug: "my-server",
    });

    const cmd = createServersCommand();
    await cmd.parseAsync(
      [
        "update",
        SERVER_ID,
        "--watch-paths",
        "",
        "--deploy-branches",
        "",
        "--no-wait-for-ci",
        "--root-dir",
        "",
      ],
      { from: "user" }
    );

    expect(mockApiInstance.updateServer).toHaveBeenCalledWith(SERVER_ID, {
      watchPaths: [],
      deployBranchPatterns: [],
      waitForCi: false,
      config: { rootDir: null },
    });
  });

  it("omits waitForCi when neither --wait-for-ci flag is passed", async () => {
    const { createServersCommand } = await import("../src/commands/servers.js");
    mockApiInstance.updateServer.mockResolvedValue({
      id: SERVER_ID,
      name: "my-server",
      slug: "my-server",
    });

    const cmd = createServersCommand();
    await cmd.parseAsync(["update", SERVER_ID, "--name", "renamed"], {
      from: "user",
    });

    expect(mockApiInstance.updateServer).toHaveBeenCalledWith(SERVER_ID, {
      name: "renamed",
    });
  });

  it("does not call the API when no fields are provided", async () => {
    const { createServersCommand } = await import("../src/commands/servers.js");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: number
    ) => {
      throw new Error(`exit:${code}`);
    }) as never);

    const cmd = createServersCommand();
    await cmd.parseAsync(["update", SERVER_ID], { from: "user" });

    expect(mockApiInstance.updateServer).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe("env-var branch scoping + resolve-by-key", () => {
  it("add --branch pins the variable to the branch scope (body field)", async () => {
    const { createEnvCommand } = await import("../src/commands/env.js");
    mockApiInstance.createEnvVariable.mockResolvedValue({
      id: VAR_ID,
      key: "FOO",
      value: "bar",
      environments: ["preview"],
      branch: "dev",
      sensitive: false,
    });

    const cmd = createEnvCommand();
    await cmd.parseAsync(
      [
        "add",
        "FOO=bar",
        "--server",
        SERVER_ID,
        "--branch",
        "dev",
        "--env",
        "preview",
      ],
      { from: "user" }
    );

    expect(mockApiInstance.createEnvVariable).toHaveBeenCalledWith(
      SERVER_ID,
      expect.objectContaining({
        key: "FOO",
        value: "bar",
        environments: ["preview"],
        branch: "dev",
      })
    );
  });

  it("update by KEY resolves the id within the branch scope", async () => {
    const { createEnvCommand } = await import("../src/commands/env.js");
    mockApiInstance.listEnvVariables.mockResolvedValue([
      {
        id: VAR_ID,
        key: "API_KEY",
        value: "old",
        environments: ["production"],
        branch: "dev",
        sensitive: false,
      },
    ]);
    mockApiInstance.updateEnvVariable.mockResolvedValue({
      id: VAR_ID,
      key: "API_KEY",
      value: "new",
      environments: ["production"],
      branch: "dev",
      sensitive: false,
    });

    const cmd = createEnvCommand();
    await cmd.parseAsync(
      [
        "update",
        "API_KEY",
        "--server",
        SERVER_ID,
        "--branch",
        "dev",
        "--value",
        "new",
      ],
      { from: "user" }
    );

    expect(mockApiInstance.listEnvVariables).toHaveBeenCalledWith(SERVER_ID, {
      branch: "dev",
    });
    expect(mockApiInstance.updateEnvVariable).toHaveBeenCalledWith(
      SERVER_ID,
      VAR_ID,
      expect.objectContaining({ value: "new" })
    );
  });

  it("allows updating an env var value to an empty string", async () => {
    const { createEnvCommand } = await import("../src/commands/env.js");
    mockApiInstance.listEnvVariables.mockResolvedValue([
      {
        id: VAR_ID,
        key: "API_KEY",
        value: "old",
        environments: ["production"],
        branch: null,
        sensitive: false,
      },
    ]);
    mockApiInstance.updateEnvVariable.mockResolvedValue({
      id: VAR_ID,
      key: "API_KEY",
      value: "",
      environments: ["production"],
      branch: null,
      sensitive: false,
    });

    const cmd = createEnvCommand();
    await cmd.parseAsync(
      ["update", "API_KEY", "--server", SERVER_ID, "--value", ""],
      { from: "user" }
    );

    expect(mockApiInstance.updateEnvVariable).toHaveBeenCalledWith(
      SERVER_ID,
      VAR_ID,
      expect.objectContaining({ value: "" })
    );
  });

  it("remove by UUID skips the key lookup", async () => {
    const { createEnvCommand } = await import("../src/commands/env.js");
    mockApiInstance.deleteEnvVariable.mockResolvedValue(undefined);

    const cmd = createEnvCommand();
    await cmd.parseAsync(["remove", VAR_ID, "--server", SERVER_ID], {
      from: "user",
    });

    expect(mockApiInstance.listEnvVariables).not.toHaveBeenCalled();
    expect(mockApiInstance.deleteEnvVariable).toHaveBeenCalledWith(
      SERVER_ID,
      VAR_ID
    );
  });

  it("list --branch scopes the query", async () => {
    const { createEnvCommand } = await import("../src/commands/env.js");
    mockApiInstance.listEnvVariables.mockResolvedValue([]);

    const cmd = createEnvCommand();
    await cmd.parseAsync(["list", "--server", SERVER_ID, "--branch", "dev"], {
      from: "user",
    });

    expect(mockApiInstance.listEnvVariables).toHaveBeenCalledWith(SERVER_ID, {
      branch: "dev",
    });
  });
});

describe("syncEnvVarsToServer branch scoping", () => {
  it("scopes the list query and create body to the given branch", async () => {
    const { syncEnvVarsToServer } = await import("../src/commands/deploy.js");
    mockApiInstance.listEnvVariables.mockResolvedValue([]);
    mockApiInstance.createEnvVariable.mockResolvedValue({ id: VAR_ID });

    const result = await syncEnvVarsToServer(
      mockApiInstance as never,
      SERVER_ID,
      { API_KEY: "abc" },
      { branch: "dev" }
    );

    expect(mockApiInstance.listEnvVariables).toHaveBeenCalledWith(SERVER_ID, {
      branch: "dev",
    });
    expect(mockApiInstance.createEnvVariable).toHaveBeenCalledWith(
      SERVER_ID,
      expect.objectContaining({ key: "API_KEY", value: "abc", branch: "dev" })
    );
    expect(result).toEqual({ created: 1, updated: 0 });
  });
});
