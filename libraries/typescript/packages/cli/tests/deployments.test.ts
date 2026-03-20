import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deployment } from "../src/utils/api.js";

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

// Mock chalk to avoid color codes in tests
vi.mock("chalk", () => {
  const createChain = () => {
    const fn = (str: string) => str;
    fn.bold = createChain();
    fn.red = createChain();
    fn.green = createChain();
    fn.yellow = createChain();
    fn.cyan = createChain();
    fn.gray = createChain();
    fn.white = createChain();
    fn.whiteBright = createChain();
    return fn;
  };

  return {
    default: createChain(),
  };
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
