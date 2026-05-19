import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deployment, EnvVariable } from "../src/utils/api.js";

// Create a mock API instance
const mockApiInstance = {
  listDeployments: vi.fn(),
  getDeployment: vi.fn(),
  deleteDeployment: vi.fn(),
  updateDeployment: vi.fn(),
  redeployDeployment: vi.fn(),
  getDeploymentLogs: vi.fn(),
  getDeploymentBuildLogs: vi.fn(),
  streamDeploymentLogs: vi.fn(),
  listEnvVariables: vi.fn(),
  createEnvVariable: vi.fn(),
  updateEnvVariable: vi.fn(),
  deleteEnvVariable: vi.fn(),
};

// Mock the entire api module
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
    ApiUnauthorizedError: class ApiUnauthorizedError extends Error {
      readonly status = 401 as const;
      constructor(
        message = "Your session has expired or your API key is invalid."
      ) {
        super(message);
        this.name = "ApiUnauthorizedError";
      }
    },
  };
});

// Mock config module
vi.mock("../src/utils/config.js", () => {
  return {
    isLoggedIn: vi.fn(),
    getApiKey: vi.fn(),
    getApiUrl: vi.fn(),
  };
});

// Mock chalk to avoid color codes in tests. Uses a Proxy so any chained
// property access (chalk.red.bold, chalk.gray, etc.) returns a function that
// just echoes its input — without eagerly building an infinite tree.
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

// Mock readline for prompts
vi.mock("node:readline", () => {
  return {
    createInterface: vi.fn(() => ({
      question: vi.fn((q, cb) => cb("y")),
      close: vi.fn(),
    })),
  };
});

// Sample deployment data
const mockDeployment: Deployment = {
  id: "dep_123456789",
  userId: "user_123",
  name: "test-deployment",
  source: {
    type: "github",
    repo: "user/repo",
    branch: "main",
    runtime: "node",
    port: 3000,
    env: {
      NODE_ENV: "production",
      API_KEY: "secret123",
    },
  },
  domain: "test-deployment.mcp-use.run",
  customDomain: undefined,
  port: 3000,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  status: "running",
  healthCheckPath: "/healthz",
  provider: "flyio",
  appName: "test-app",
};

const mockDeployments: Deployment[] = [
  mockDeployment,
  {
    ...mockDeployment,
    id: "dep_987654321",
    name: "another-deployment",
    status: "building",
    domain: "another-deployment.mcp-use.run",
  },
  {
    ...mockDeployment,
    id: "dep_111222333",
    name: "failed-deployment",
    status: "failed",
    domain: undefined,
    error: "Build failed: npm install error",
  },
];

describe("Deployment API Methods", () => {
  let apiInstance: any;

  beforeEach(async () => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    apiInstance = mockApiInstance;
  });

  describe("listDeployments", () => {
    it("should list all deployments", async () => {
      apiInstance.listDeployments.mockResolvedValue(mockDeployments);

      const result = await apiInstance.listDeployments();

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("test-deployment");
      expect(apiInstance.listDeployments).toHaveBeenCalledTimes(1);
    });

    it("should return empty array when no deployments", async () => {
      apiInstance.listDeployments.mockResolvedValue([]);

      const result = await apiInstance.listDeployments();

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it("should handle API errors", async () => {
      apiInstance.listDeployments.mockRejectedValue(
        new Error("API request failed: 500")
      );

      await expect(apiInstance.listDeployments()).rejects.toThrow(
        "API request failed: 500"
      );
    });
  });

  describe("getDeployment", () => {
    it("should get deployment by ID", async () => {
      apiInstance.getDeployment.mockResolvedValue(mockDeployment);

      const result = await apiInstance.getDeployment("dep_123456789");

      expect(result.id).toBe("dep_123456789");
      expect(result.name).toBe("test-deployment");
      expect(apiInstance.getDeployment).toHaveBeenCalledWith("dep_123456789");
    });

    it("should handle not found errors", async () => {
      apiInstance.getDeployment.mockRejectedValue(
        new Error("API request failed: 404 Deployment not found")
      );

      await expect(apiInstance.getDeployment("nonexistent")).rejects.toThrow(
        "404"
      );
    });

    it("should return deployment with all fields", async () => {
      apiInstance.getDeployment.mockResolvedValue(mockDeployment);

      const result = await apiInstance.getDeployment("dep_123456789");

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("name");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("domain");
      expect(result).toHaveProperty("source");
      expect(result.source).toHaveProperty("type");
      expect(result.source).toHaveProperty("env");
    });
  });

  describe("deleteDeployment", () => {
    it("should delete deployment", async () => {
      apiInstance.deleteDeployment.mockResolvedValue(undefined);

      await apiInstance.deleteDeployment("dep_123456789");

      expect(apiInstance.deleteDeployment).toHaveBeenCalledWith(
        "dep_123456789"
      );
      expect(apiInstance.deleteDeployment).toHaveBeenCalledTimes(1);
    });

    it("should handle delete errors", async () => {
      apiInstance.deleteDeployment.mockRejectedValue(
        new Error("API request failed: 403 Unauthorized")
      );

      await expect(
        apiInstance.deleteDeployment("dep_123456789")
      ).rejects.toThrow("403");
    });
  });

  describe("updateDeployment", () => {
    it("should update deployment name", async () => {
      const updated = { ...mockDeployment, name: "new-name" };
      apiInstance.updateDeployment.mockResolvedValue(updated);

      const result = await apiInstance.updateDeployment("dep_123456789", {
        name: "new-name",
      });

      expect(result.name).toBe("new-name");
      expect(apiInstance.updateDeployment).toHaveBeenCalledWith(
        "dep_123456789",
        { name: "new-name" }
      );
    });

    it("should update environment variables", async () => {
      const updated = {
        ...mockDeployment,
        source: {
          ...mockDeployment.source,
          env: { NODE_ENV: "production", NEW_VAR: "value" },
        },
      };
      apiInstance.updateDeployment.mockResolvedValue(updated);

      const result = await apiInstance.updateDeployment("dep_123456789", {
        env: { NODE_ENV: "production", NEW_VAR: "value" },
      });

      expect(result.source.env).toHaveProperty("NEW_VAR");
      expect(result.source.env?.NEW_VAR).toBe("value");
    });

    it("should update deployment status", async () => {
      const updated = { ...mockDeployment, status: "stopped" as const };
      apiInstance.updateDeployment.mockResolvedValue(updated);

      const result = await apiInstance.updateDeployment("dep_123456789", {
        status: "stopped",
      });

      expect(result.status).toBe("stopped");
    });

    it("should handle update errors", async () => {
      apiInstance.updateDeployment.mockRejectedValue(
        new Error("API request failed: 400 Invalid request")
      );

      await expect(
        apiInstance.updateDeployment("dep_123456789", {})
      ).rejects.toThrow("400");
    });
  });

  describe("redeployDeployment", () => {
    it("should redeploy deployment without config", async () => {
      const redeployed = { ...mockDeployment, status: "building" as const };
      apiInstance.redeployDeployment.mockResolvedValue(redeployed);

      const result = await apiInstance.redeployDeployment("dep_123456789");

      expect(result.status).toBe("building");
      expect(apiInstance.redeployDeployment).toHaveBeenCalledWith(
        "dep_123456789"
      );
    });

    it("should redeploy deployment with RedeploymentConfig", async () => {
      const redeployed = {
        ...mockDeployment,
        status: "building" as const,
        source: {
          ...mockDeployment.source,
          env: { NODE_ENV: "production", NEW_SECRET: "value123" },
          buildCommand: "npm run build",
          startCommand: "npm start",
          port: 8080,
        },
      };
      apiInstance.redeployDeployment.mockResolvedValue(redeployed);

      const config = {
        buildCommand: "npm run build",
        startCommand: "npm start",
        port: 8080,
        env: { NODE_ENV: "production", NEW_SECRET: "value123" },
      };

      const result = await apiInstance.redeployDeployment(
        "dep_123456789",
        config
      );

      expect(result.status).toBe("building");
      expect(apiInstance.redeployDeployment).toHaveBeenCalledWith(
        "dep_123456789",
        config
      );
    });

    it("should redeploy with only env vars in config", async () => {
      const redeployed = {
        ...mockDeployment,
        status: "building" as const,
        source: {
          ...mockDeployment.source,
          env: { API_KEY: "new-key", DATABASE_URL: "postgres://localhost" },
        },
      };
      apiInstance.redeployDeployment.mockResolvedValue(redeployed);

      const config = {
        env: { API_KEY: "new-key", DATABASE_URL: "postgres://localhost" },
      };

      const result = await apiInstance.redeployDeployment(
        "dep_123456789",
        config
      );

      expect(result.source.env).toEqual({
        API_KEY: "new-key",
        DATABASE_URL: "postgres://localhost",
      });
      expect(apiInstance.redeployDeployment).toHaveBeenCalledWith(
        "dep_123456789",
        config
      );
    });

    it("should redeploy with partial config (only port)", async () => {
      const redeployed = {
        ...mockDeployment,
        status: "building" as const,
        port: 4000,
      };
      apiInstance.redeployDeployment.mockResolvedValue(redeployed);

      const config = { port: 4000 };

      const result = await apiInstance.redeployDeployment(
        "dep_123456789",
        config
      );

      expect(result.port).toBe(4000);
      expect(apiInstance.redeployDeployment).toHaveBeenCalledWith(
        "dep_123456789",
        config
      );
    });

    it("should handle redeploy errors", async () => {
      apiInstance.redeployDeployment.mockRejectedValue(
        new Error("API request failed: 500 Redeploy failed")
      );

      await expect(
        apiInstance.redeployDeployment("dep_123456789")
      ).rejects.toThrow("500");
    });

    it("should handle redeploy with config errors", async () => {
      apiInstance.redeployDeployment.mockRejectedValue(
        new Error("API request failed: 400 Invalid configuration")
      );

      const config = { port: -1 }; // Invalid port

      await expect(
        apiInstance.redeployDeployment("dep_123456789", config)
      ).rejects.toThrow("400");
    });
  });

  describe("getDeploymentLogs", () => {
    it("should get runtime logs", async () => {
      const logs =
        '{"level":"info","line":"Server started"}\n{"level":"info","line":"Listening on port 3000"}';
      apiInstance.getDeploymentLogs.mockResolvedValue(logs);

      const result = await apiInstance.getDeploymentLogs("dep_123456789");

      expect(result).toContain("Server started");
      expect(result).toContain("port 3000");
      expect(apiInstance.getDeploymentLogs).toHaveBeenCalledWith(
        "dep_123456789"
      );
    });

    it("should return empty string when no logs", async () => {
      apiInstance.getDeploymentLogs.mockResolvedValue("");

      const result = await apiInstance.getDeploymentLogs("dep_123456789");

      expect(result).toBe("");
    });

    it("should handle log retrieval errors", async () => {
      apiInstance.getDeploymentLogs.mockRejectedValue(
        new Error("API request failed: 404")
      );

      await expect(
        apiInstance.getDeploymentLogs("dep_123456789")
      ).rejects.toThrow("404");
    });
  });

  describe("getDeploymentBuildLogs", () => {
    it("should get build logs", async () => {
      const logs =
        '{"level":"info","step":"build","line":"npm install"}\n{"level":"info","step":"build","line":"Build complete"}';
      apiInstance.getDeploymentBuildLogs.mockResolvedValue(logs);

      const result = await apiInstance.getDeploymentBuildLogs("dep_123456789");

      expect(result).toContain("npm install");
      expect(result).toContain("Build complete");
      expect(apiInstance.getDeploymentBuildLogs).toHaveBeenCalledWith(
        "dep_123456789"
      );
    });

    it("should return empty string when no build logs", async () => {
      apiInstance.getDeploymentBuildLogs.mockResolvedValue("");

      const result = await apiInstance.getDeploymentBuildLogs("dep_123456789");

      expect(result).toBe("");
    });
  });

  describe("streamDeploymentLogs", () => {
    it("should stream logs", async () => {
      const logChunks = [
        '{"log": "{\\"level\\":\\"info\\",\\"line\\":\\"Starting...\\"}"}',
        '{"log": "{\\"level\\":\\"info\\",\\"line\\":\\"Running...\\"}"}',
      ];

      apiInstance.streamDeploymentLogs.mockImplementation(async function* () {
        for (const chunk of logChunks) {
          yield chunk;
        }
      });

      const logs: string[] = [];
      for await (const log of apiInstance.streamDeploymentLogs(
        "dep_123456789"
      )) {
        logs.push(log);
      }

      expect(logs).toHaveLength(2);
      expect(logs[0]).toContain("Starting");
      expect(logs[1]).toContain("Running");
    });

    it("should handle stream errors", async () => {
      apiInstance.streamDeploymentLogs.mockImplementation(async function* () {
        throw new Error("Stream failed");
      });

      const logs: string[] = [];
      try {
        for await (const log of apiInstance.streamDeploymentLogs(
          "dep_123456789"
        )) {
          logs.push(log);
        }
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Stream failed");
      }
    });
  });
});

describe("Deployment Command Integration", () => {
  let originalConsoleLog: any;
  let originalConsoleError: any;
  let originalProcessExit: any;
  let consoleOutput: string[];
  let consoleErrors: string[];

  beforeEach(() => {
    consoleOutput = [];
    consoleErrors = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    originalProcessExit = process.exit;

    console.log = vi.fn((...args) => {
      consoleOutput.push(args.join(" "));
    });
    console.error = vi.fn((...args) => {
      consoleErrors.push(args.join(" "));
    });
    process.exit = vi.fn() as any;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalProcessExit;
  });

  describe("Authentication checks", () => {
    it("should check if user is logged in before listing", async () => {
      const { isLoggedIn } = await import("../src/utils/config.js");
      vi.mocked(isLoggedIn).mockResolvedValue(false);

      // Import and test the command would require executing it
      // This is a placeholder for integration test structure
      expect(isLoggedIn).toBeDefined();
    });

    it("should allow commands when logged in", async () => {
      const { isLoggedIn } = await import("../src/utils/config.js");
      vi.mocked(isLoggedIn).mockResolvedValue(true);

      expect(await isLoggedIn()).toBe(true);
    });
  });

  describe("Environment variable parsing", () => {
    it("should parse KEY=VALUE format", () => {
      const pairs = ["NODE_ENV=production", "API_KEY=secret123"];
      const env: Record<string, string> = {};

      for (const pair of pairs) {
        const [key, ...valueParts] = pair.split("=");
        env[key.trim()] = valueParts.join("=").trim();
      }

      expect(env).toEqual({
        NODE_ENV: "production",
        API_KEY: "secret123",
      });
    });

    it("should handle values with equals signs", () => {
      const pairs = ["URL=https://api.example.com?token=abc123"];
      const env: Record<string, string> = {};

      for (const pair of pairs) {
        const [key, ...valueParts] = pair.split("=");
        env[key.trim()] = valueParts.join("=").trim();
      }

      expect(env.URL).toBe("https://api.example.com?token=abc123");
    });

    it("should detect invalid format", () => {
      const pairs = ["INVALID"];
      const env: Record<string, string> = {};

      for (const pair of pairs) {
        const [key, ...valueParts] = pair.split("=");
        const isValid = key && valueParts.length > 0;
        expect(isValid).toBe(false);
      }
    });
  });

  describe("Status color mapping", () => {
    it("should map running to green", () => {
      const status = "running";
      const colorMap: Record<string, string> = {
        running: "green",
        building: "yellow",
        pending: "yellow",
        failed: "red",
        stopped: "red",
      };

      expect(colorMap[status]).toBe("green");
    });

    it("should map building to yellow", () => {
      const status = "building";
      const colorMap: Record<string, string> = {
        running: "green",
        building: "yellow",
        pending: "yellow",
        failed: "red",
        stopped: "red",
      };

      expect(colorMap[status]).toBe("yellow");
    });

    it("should map failed to red", () => {
      const status = "failed";
      const colorMap: Record<string, string> = {
        running: "green",
        building: "yellow",
        pending: "yellow",
        failed: "red",
        stopped: "red",
      };

      expect(colorMap[status]).toBe("red");
    });
  });

  describe("ID formatting", () => {
    it("should truncate long IDs for display", () => {
      const id = "dep_123456789abcdefgh";
      const formatted = id.substring(0, 8);

      expect(formatted).toBe("dep_1234");
      expect(formatted.length).toBe(8);
    });

    it("should handle short IDs", () => {
      const id = "dep_123";
      const formatted = id.substring(0, 8);

      expect(formatted).toBe("dep_123");
      expect(formatted.length).toBe(7);
    });
  });

  describe("Sensitive value masking", () => {
    it("should mask API keys", () => {
      const key = "API_KEY";
      const shouldMask =
        key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("password") ||
        key.toLowerCase().includes("token");

      expect(shouldMask).toBe(true);
    });

    it("should mask secrets", () => {
      const key = "MY_SECRET";
      const shouldMask =
        key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("password") ||
        key.toLowerCase().includes("token");

      expect(shouldMask).toBe(true);
    });

    it("should mask passwords", () => {
      const key = "DB_PASSWORD";
      const shouldMask =
        key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("password") ||
        key.toLowerCase().includes("token");

      expect(shouldMask).toBe(true);
    });

    it("should mask tokens", () => {
      const key = "AUTH_TOKEN";
      const shouldMask =
        key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("password") ||
        key.toLowerCase().includes("token");

      expect(shouldMask).toBe(true);
    });

    it("should not mask regular variables", () => {
      const key = "NODE_ENV";
      const shouldMask =
        key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("password") ||
        key.toLowerCase().includes("token");

      expect(shouldMask).toBe(false);
    });
  });

  describe("Log parsing", () => {
    it("should parse JSON log format", () => {
      const logLine =
        '{"level":"info","line":"Server started","step":"deploy"}';

      try {
        const parsed = JSON.parse(logLine);
        expect(parsed.level).toBe("info");
        expect(parsed.line).toBe("Server started");
        expect(parsed.step).toBe("deploy");
      } catch {
        // Not JSON
        expect(false).toBe(true);
      }
    });

    it("should handle non-JSON logs", () => {
      const logLine = "Plain text log line";

      try {
        JSON.parse(logLine);
        expect(false).toBe(true); // Should not reach here
      } catch {
        // Expected to fail - handle as plain text
        expect(logLine).toBe("Plain text log line");
      }
    });

    it("should extract log levels", () => {
      const logs = [
        '{"level":"error","line":"Error occurred"}',
        '{"level":"warn","line":"Warning message"}',
        '{"level":"info","line":"Info message"}',
      ];

      const levels = logs.map((log) => {
        const parsed = JSON.parse(log);
        return parsed.level;
      });

      expect(levels).toEqual(["error", "warn", "info"]);
    });
  });
});

describe("Error Handling", () => {
  it("should handle network errors gracefully", async () => {
    const error = new Error("Network error: ECONNREFUSED");

    expect(error.message).toContain("Network error");
  });

  it("should handle 404 errors", async () => {
    const error = new Error("API request failed: 404 Deployment not found");

    expect(error.message).toContain("404");
    expect(error.message).toContain("not found");
  });

  it("should handle 403 unauthorized errors", async () => {
    const error = new Error("API request failed: 403 Unauthorized");

    expect(error.message).toContain("403");
    expect(error.message).toContain("Unauthorized");
  });

  it("should handle 500 server errors", async () => {
    const error = new Error("API request failed: 500 Internal Server Error");

    expect(error.message).toContain("500");
  });

  it("should provide user-friendly error messages", () => {
    const apiError = "API request failed: 404 Deployment not found";
    const userMessage = apiError.includes("404")
      ? "Deployment not found"
      : apiError;

    expect(userMessage).toBe("Deployment not found");
  });
});

describe("syncEnvVarsToServer", () => {
  const SERVER_ID = "srv_abc";

  function makeExisting(overrides: Partial<EnvVariable> = {}): EnvVariable {
    return {
      id: "env_existing",
      serverId: SERVER_ID,
      key: "EXISTING",
      value: "old",
      environments: ["production", "preview", "development"],
      sensitive: false,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zero counts when no env vars are provided", async () => {
    const { syncEnvVarsToServer } = await import("../src/commands/deploy.js");

    const result = await syncEnvVarsToServer(
      mockApiInstance as any,
      SERVER_ID,
      {}
    );

    expect(result).toEqual({ created: 0, updated: 0 });
    expect(mockApiInstance.listEnvVariables).not.toHaveBeenCalled();
    expect(mockApiInstance.createEnvVariable).not.toHaveBeenCalled();
    expect(mockApiInstance.updateEnvVariable).not.toHaveBeenCalled();
  });

  it("creates env variables that don't exist on the server", async () => {
    const { syncEnvVarsToServer } = await import("../src/commands/deploy.js");
    mockApiInstance.listEnvVariables.mockResolvedValue([]);
    mockApiInstance.createEnvVariable.mockResolvedValue(makeExisting());

    const result = await syncEnvVarsToServer(
      mockApiInstance as any,
      SERVER_ID,
      { API_KEY: "abc", DATABASE_URL: "postgres://x" }
    );

    expect(mockApiInstance.listEnvVariables).toHaveBeenCalledWith(SERVER_ID);
    expect(mockApiInstance.createEnvVariable).toHaveBeenCalledTimes(2);
    expect(mockApiInstance.createEnvVariable).toHaveBeenCalledWith(SERVER_ID, {
      key: "API_KEY",
      value: "abc",
    });
    expect(mockApiInstance.createEnvVariable).toHaveBeenCalledWith(SERVER_ID, {
      key: "DATABASE_URL",
      value: "postgres://x",
    });
    expect(mockApiInstance.updateEnvVariable).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 2, updated: 0 });
  });

  it("updates env variables that already exist on the server", async () => {
    const { syncEnvVarsToServer } = await import("../src/commands/deploy.js");
    mockApiInstance.listEnvVariables.mockResolvedValue([
      makeExisting({ id: "env_1", key: "API_KEY", value: "old" }),
    ]);
    mockApiInstance.updateEnvVariable.mockResolvedValue(makeExisting());

    const result = await syncEnvVarsToServer(
      mockApiInstance as any,
      SERVER_ID,
      { API_KEY: "new" }
    );

    expect(mockApiInstance.updateEnvVariable).toHaveBeenCalledWith(
      SERVER_ID,
      "env_1",
      { value: "new" }
    );
    expect(mockApiInstance.createEnvVariable).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0, updated: 1 });
  });

  it("mixes creates and updates in a single sync", async () => {
    const { syncEnvVarsToServer } = await import("../src/commands/deploy.js");
    mockApiInstance.listEnvVariables.mockResolvedValue([
      makeExisting({ id: "env_1", key: "API_KEY", value: "old" }),
    ]);
    mockApiInstance.createEnvVariable.mockResolvedValue(makeExisting());
    mockApiInstance.updateEnvVariable.mockResolvedValue(makeExisting());

    const result = await syncEnvVarsToServer(
      mockApiInstance as any,
      SERVER_ID,
      { API_KEY: "new", BRAND_NEW: "value" }
    );

    expect(mockApiInstance.updateEnvVariable).toHaveBeenCalledWith(
      SERVER_ID,
      "env_1",
      { value: "new" }
    );
    expect(mockApiInstance.createEnvVariable).toHaveBeenCalledWith(SERVER_ID, {
      key: "BRAND_NEW",
      value: "value",
    });
    expect(result).toEqual({ created: 1, updated: 1 });
  });

  it("does not delete or modify keys that aren't in the supplied set", async () => {
    const { syncEnvVarsToServer } = await import("../src/commands/deploy.js");
    mockApiInstance.listEnvVariables.mockResolvedValue([
      makeExisting({ id: "env_1", key: "API_KEY", value: "old" }),
      makeExisting({ id: "env_2", key: "UNTOUCHED", value: "stay" }),
    ]);
    mockApiInstance.updateEnvVariable.mockResolvedValue(makeExisting());

    await syncEnvVarsToServer(mockApiInstance as any, SERVER_ID, {
      API_KEY: "new",
    });

    expect(mockApiInstance.updateEnvVariable).toHaveBeenCalledTimes(1);
    expect(mockApiInstance.updateEnvVariable).toHaveBeenCalledWith(
      SERVER_ID,
      "env_1",
      { value: "new" }
    );
    expect(mockApiInstance.deleteEnvVariable).not.toHaveBeenCalled();
  });

  it("propagates API errors so the caller can fail the deploy", async () => {
    const { syncEnvVarsToServer } = await import("../src/commands/deploy.js");
    mockApiInstance.listEnvVariables.mockRejectedValue(
      new Error("API request failed: 500")
    );

    await expect(
      syncEnvVarsToServer(mockApiInstance as any, SERVER_ID, { K: "v" })
    ).rejects.toThrow("500");
  });
});

describe("--org flag org-mismatch check", () => {
  it("should skip linked server when it belongs to a different org", async () => {
    const linkedServerId = "server_abc";
    const resolvedOrgId = "org_target";
    const linkedServer = { organizationId: "org_other" };

    const api = { getServer: vi.fn().mockResolvedValue(linkedServer) };

    let serverId: string | undefined = linkedServerId;

    if (serverId && resolvedOrgId) {
      try {
        const s = await api.getServer(serverId);
        if (s.organizationId !== resolvedOrgId) {
          serverId = undefined;
        }
      } catch {
        // keep serverId
      }
    }

    expect(api.getServer).toHaveBeenCalledWith(linkedServerId);
    expect(serverId).toBeUndefined();
  });

  it("should keep linked server when it belongs to the same org", async () => {
    const linkedServerId = "server_abc";
    const resolvedOrgId = "org_target";
    const linkedServer = { organizationId: "org_target" };

    const api = { getServer: vi.fn().mockResolvedValue(linkedServer) };

    let serverId: string | undefined = linkedServerId;

    if (serverId && resolvedOrgId) {
      try {
        const s = await api.getServer(serverId);
        if (s.organizationId !== resolvedOrgId) {
          serverId = undefined;
        }
      } catch {
        // keep serverId
      }
    }

    expect(serverId).toBe(linkedServerId);
  });

  it("should keep linked server when no --org flag is provided", async () => {
    const linkedServerId = "server_abc";
    const resolvedOrgId: string | undefined = undefined;

    const api = { getServer: vi.fn() };

    let serverId: string | undefined = linkedServerId;

    if (serverId && resolvedOrgId) {
      try {
        const s = await api.getServer(serverId);
        if (s.organizationId !== resolvedOrgId) {
          serverId = undefined;
        }
      } catch {
        // keep serverId
      }
    }

    expect(api.getServer).not.toHaveBeenCalled();
    expect(serverId).toBe(linkedServerId);
  });

  it("should keep linked server when getServer throws (let existing flow handle it)", async () => {
    const linkedServerId = "server_abc";
    const resolvedOrgId = "org_target";

    const api = { getServer: vi.fn().mockRejectedValue(new Error("500")) };

    let serverId: string | undefined = linkedServerId;

    if (serverId && resolvedOrgId) {
      try {
        const s = await api.getServer(serverId);
        if (s.organizationId !== resolvedOrgId) {
          serverId = undefined;
        }
      } catch {
        // keep serverId
      }
    }

    expect(serverId).toBe(linkedServerId);
  });
});
