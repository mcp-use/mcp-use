import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfigFile, createConnectorFromConfig } from "../../src/config.js";
import { StdioConnector } from "../../src/connectors/stdio.js";
import { HttpConnector } from "../../src/connectors/http.js";
import { WebSocketConnector } from "../../src/connectors/websocket.js";

describe("loadConfigFile", () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = tmpdir();
    tempFile = join(tempDir, `test-config-${Date.now()}.json`);
  });

  afterEach(() => {
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  });

  it("should load valid JSON config file", () => {
    const config = { name: "test", version: "1.0.0" };
    writeFileSync(tempFile, JSON.stringify(config), "utf-8");

    const result = loadConfigFile(tempFile);
    expect(result).toEqual(config);
  });

  it("should load config with nested objects", () => {
    const config = {
      server: {
        name: "test-server",
        command: "node",
        args: ["server.js"],
      },
    };
    writeFileSync(tempFile, JSON.stringify(config), "utf-8");

    const result = loadConfigFile(tempFile);
    expect(result).toEqual(config);
    expect(result.server.name).toBe("test-server");
  });

  it("should load config with arrays", () => {
    const config = {
      servers: [
        { name: "server1", url: "http://localhost:3000" },
        { name: "server2", url: "http://localhost:3001" },
      ],
    };
    writeFileSync(tempFile, JSON.stringify(config), "utf-8");

    const result = loadConfigFile(tempFile);
    expect(result).toEqual(config);
    expect(Array.isArray(result.servers)).toBe(true);
    expect(result.servers.length).toBe(2);
  });

  it("should handle empty config object", () => {
    const config = {};
    writeFileSync(tempFile, JSON.stringify(config), "utf-8");

    const result = loadConfigFile(tempFile);
    expect(result).toEqual({});
  });

  it("should throw error for non-existent file", () => {
    const nonExistentFile = join(tempDir, "non-existent-config.json");
    expect(() => loadConfigFile(nonExistentFile)).toThrow();
  });

  it("should throw error for invalid JSON", () => {
    writeFileSync(tempFile, "{ invalid json }", "utf-8");
    expect(() => loadConfigFile(tempFile)).toThrow();
  });

  it("should handle config with special characters", () => {
    const config = {
      name: "test-server",
      description: "Test server with special chars: @#$%",
    };
    writeFileSync(tempFile, JSON.stringify(config), "utf-8");

    const result = loadConfigFile(tempFile);
    expect(result.description).toBe("Test server with special chars: @#$%");
  });

  it("should handle config with unicode characters", () => {
    const config = {
      name: "测试服务器",
      description: "Test server with unicode: 测试",
    };
    writeFileSync(tempFile, JSON.stringify(config), "utf-8");

    const result = loadConfigFile(tempFile);
    expect(result.name).toBe("测试服务器");
  });
});

describe("createConnectorFromConfig", () => {
  describe("stdio connector", () => {
    it("should create StdioConnector from config with command and args", () => {
      const config = {
        command: "node",
        args: ["server.js"],
      };

      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(StdioConnector);
    });

    it("should create StdioConnector with env variables", () => {
      const config = {
        command: "node",
        args: ["server.js"],
        env: {
          NODE_ENV: "test",
          PORT: "3000",
        },
      };

      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(StdioConnector);
    });

    it("should merge connectorOptions with config", () => {
      const config = {
        command: "node",
        args: ["server.js"],
      };

      const connectorOptions = {
        clientOptions: {
          name: "test-client",
          version: "1.0.0",
        },
      };

      const connector = createConnectorFromConfig(config, connectorOptions);
      expect(connector).toBeInstanceOf(StdioConnector);
      expect(connector.opts.clientOptions).toEqual(connectorOptions.clientOptions);
    });
  });

  describe("http connector", () => {
    it("should create HttpConnector from config with url", () => {
      const config = {
        url: "http://localhost:3000",
      };

      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(HttpConnector);
    });

    it("should create HttpConnector with https url", () => {
      const config = {
        url: "https://api.example.com",
      };

      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(HttpConnector);
    });

    it("should create HttpConnector with headers", () => {
      const config = {
        url: "http://localhost:3000",
        headers: {
          "X-API-Key": "secret-key",
          "Content-Type": "application/json",
        },
      };

      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(HttpConnector);
    });

    it("should create HttpConnector with auth_token", () => {
      const config = {
        url: "http://localhost:3000",
        auth_token: "bearer-token-123",
      };

      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(HttpConnector);
    });

    it("should create HttpConnector with authToken (camelCase)", () => {
      const config = {
        url: "http://localhost:3000",
        authToken: "bearer-token-123",
      };

      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(HttpConnector);
    });

    it("should create HttpConnector with preferSse", () => {
      const config = {
        url: "http://localhost:3000",
        preferSse: true,
      };

      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(HttpConnector);
    });

    it("should create HttpConnector with transport=sse", () => {
      const config = {
        url: "http://localhost:3000",
        transport: "sse",
      };

      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(HttpConnector);
    });

    it("should create HttpConnector with transport=http", () => {
      const config = {
        url: "http://localhost:3000",
        transport: "http",
      };

      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(HttpConnector);
    });
  });

  describe("websocket connector", () => {
    it("should create WebSocketConnector from config with ws_url", () => {
      const config = {
        ws_url: "ws://localhost:3000",
      };

      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(WebSocketConnector);
    });

    it("should create WebSocketConnector with wss url", () => {
      const config = {
        ws_url: "wss://api.example.com",
      };

      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(WebSocketConnector);
    });

    it("should create WebSocketConnector with headers", () => {
      const config = {
        ws_url: "ws://localhost:3000",
        headers: {
          "X-API-Key": "secret-key",
        },
      };

      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(WebSocketConnector);
    });

    it("should create WebSocketConnector with auth_token", () => {
      const config = {
        ws_url: "ws://localhost:3000",
        auth_token: "bearer-token-123",
      };

      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(WebSocketConnector);
    });
  });

  describe("error handling", () => {
    it("should throw error for config without connector fields", () => {
      const config = {
        name: "test-server",
        // Missing command/args, url, and ws_url
      };

      expect(() => createConnectorFromConfig(config)).toThrow(
        "Cannot determine connector type from config"
      );
    });

    it("should throw error for empty config", () => {
      const config = {};

      expect(() => createConnectorFromConfig(config)).toThrow(
        "Cannot determine connector type from config"
      );
    });

    it("should prioritize stdio over http when both are present", () => {
      const config = {
        command: "node",
        args: ["server.js"],
        url: "http://localhost:3000",
      };

      // Stdio connector should be created because it checks command/args first
      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(StdioConnector);
    });

    it("should prioritize http over websocket when both are present", () => {
      const config = {
        url: "http://localhost:3000",
        ws_url: "ws://localhost:3000",
      };

      // Http connector should be created because it checks url before ws_url
      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(HttpConnector);
    });
  });

  describe("edge cases", () => {
    it("should handle config with empty args array", () => {
      const config = {
        command: "node",
        args: [],
      };

      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(StdioConnector);
    });

    it("should handle config with empty headers object", () => {
      const config = {
        url: "http://localhost:3000",
        headers: {},
      };

      const connector = createConnectorFromConfig(config);
      expect(connector).toBeInstanceOf(HttpConnector);
    });

    it("should handle config with undefined connectorOptions", () => {
      const config = {
        command: "node",
        args: ["server.js"],
      };

      const connector = createConnectorFromConfig(config, undefined);
      expect(connector).toBeInstanceOf(StdioConnector);
    });

    it("should handle config with partial connectorOptions", () => {
      const config = {
        url: "http://localhost:3000",
      };

      const connectorOptions = {
        clientOptions: {
          name: "test-client",
        },
      };

      const connector = createConnectorFromConfig(config, connectorOptions);
      expect(connector).toBeInstanceOf(HttpConnector);
      expect(connector.opts.clientOptions?.name).toBe("test-client");
    });
  });
});
