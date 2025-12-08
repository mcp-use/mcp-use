/**
 * Tests for telemetry event classes
 *
 * These tests verify:
 * - Each event class constructs proper name and properties
 * - createServerRunEventData() helper function
 * - All event property mappings are correct
 */

import { describe, expect, it } from "vitest";
import {
  MCPAgentExecutionEvent,
  ServerRunEvent,
  ServerInitializeEvent,
  ServerToolCallEvent,
  ServerResourceCallEvent,
  ServerPromptCallEvent,
  ServerContextEvent,
  MCPClientInitEvent,
  ConnectorInitEvent,
  createServerRunEventData,
  type MCPServerTelemetryInfo,
} from "../../../src/telemetry/events.js";

describe("Telemetry Event Classes", () => {
  describe("MCPAgentExecutionEvent", () => {
    it("should have correct event name", () => {
      const event = new MCPAgentExecutionEvent({
        executionMethod: "run",
        query: "test query",
        success: true,
        modelProvider: "openai",
        modelName: "gpt-4",
        serverCount: 1,
        serverIdentifiers: [],
        totalToolsAvailable: 5,
        toolsAvailableNames: ["tool1"],
        maxStepsConfigured: 10,
        memoryEnabled: true,
        useServerManager: false,
        maxStepsUsed: 3,
        manageConnector: true,
        externalHistoryUsed: false,
      });

      expect(event.name).toBe("mcp_agent_execution");
    });

    it("should map all properties correctly", () => {
      const event = new MCPAgentExecutionEvent({
        executionMethod: "stream",
        query: "What is the weather?",
        success: true,
        modelProvider: "anthropic",
        modelName: "claude-3",
        serverCount: 2,
        serverIdentifiers: [{ name: "server1" }],
        totalToolsAvailable: 10,
        toolsAvailableNames: ["tool1", "tool2"],
        maxStepsConfigured: 5,
        memoryEnabled: false,
        useServerManager: true,
        maxStepsUsed: 2,
        manageConnector: false,
        externalHistoryUsed: true,
        stepsTaken: 3,
        toolsUsedCount: 2,
        toolsUsedNames: ["tool1", "tool2"],
        response: "The weather is sunny",
        executionTimeMs: 1500,
        errorType: null,
        conversationHistoryLength: 5,
      });

      const props = event.properties;

      expect(props.execution_method).toBe("stream");
      expect(props.query).toBe("What is the weather?");
      expect(props.query_length).toBe(20);
      expect(props.success).toBe(true);
      expect(props.model_provider).toBe("anthropic");
      expect(props.model_name).toBe("claude-3");
      expect(props.server_count).toBe(2);
      expect(props.total_tools_available).toBe(10);
      expect(props.max_steps_configured).toBe(5);
      expect(props.memory_enabled).toBe(false);
      expect(props.use_server_manager).toBe(true);
      expect(props.max_steps_used).toBe(2);
      expect(props.manage_connector).toBe(false);
      expect(props.external_history_used).toBe(true);
      expect(props.steps_taken).toBe(3);
      expect(props.tools_used_count).toBe(2);
      expect(props.response_length).toBe(20);
      expect(props.execution_time_ms).toBe(1500);
      expect(props.conversation_history_length).toBe(5);
    });

    it("should handle null optional fields", () => {
      const event = new MCPAgentExecutionEvent({
        executionMethod: "run",
        query: "test",
        success: false,
        modelProvider: "openai",
        modelName: "gpt-4",
        serverCount: 0,
        serverIdentifiers: [],
        totalToolsAvailable: 0,
        toolsAvailableNames: [],
        maxStepsConfigured: 5,
        memoryEnabled: true,
        useServerManager: false,
        maxStepsUsed: null,
        manageConnector: true,
        externalHistoryUsed: false,
      });

      const props = event.properties;

      expect(props.steps_taken).toBeNull();
      expect(props.tools_used_count).toBeNull();
      expect(props.tools_used_names).toBeNull();
      expect(props.response).toBeNull();
      expect(props.response_length).toBeNull();
      expect(props.execution_time_ms).toBeNull();
      expect(props.error_type).toBeNull();
    });
  });

  describe("ServerRunEvent", () => {
    it("should have correct event name", () => {
      const event = new ServerRunEvent({
        transport: "http",
        toolsNumber: 5,
        resourcesNumber: 2,
        promptsNumber: 1,
        auth: false,
        name: "test-server",
      });

      expect(event.name).toBe("server_run");
    });

    it("should map all properties correctly", () => {
      const event = new ServerRunEvent({
        transport: "http",
        toolsNumber: 5,
        resourcesNumber: 2,
        promptsNumber: 1,
        auth: true,
        name: "my-server",
        description: "A test server",
        baseUrl: "http://localhost:3000",
        toolNames: ["tool1", "tool2"],
        resourceNames: ["resource1"],
        promptNames: ["prompt1"],
        tools: [{ name: "tool1", description: "A tool" }],
        resources: [{ name: "resource1", uri: "file://test" }],
        prompts: [{ name: "prompt1", description: "A prompt" }],
        capabilities: { logging: true },
      });

      const props = event.properties;

      expect(props.transport).toBe("http");
      expect(props.tools_number).toBe(5);
      expect(props.resources_number).toBe(2);
      expect(props.prompts_number).toBe(1);
      expect(props.auth).toBe(true);
      expect(props.name).toBe("my-server");
      expect(props.description).toBe("A test server");
      expect(props.base_url).toBe("http://localhost:3000");
      expect(props.tool_names).toEqual(["tool1", "tool2"]);
      expect(props.resource_names).toEqual(["resource1"]);
      expect(props.prompt_names).toEqual(["prompt1"]);
    });

    it("should handle null optional fields", () => {
      const event = new ServerRunEvent({
        transport: "stdio",
        toolsNumber: 0,
        resourcesNumber: 0,
        promptsNumber: 0,
        auth: false,
        name: "minimal-server",
      });

      const props = event.properties;

      expect(props.description).toBeNull();
      expect(props.base_url).toBeNull();
      expect(props.tool_names).toBeNull();
      expect(props.resource_names).toBeNull();
      expect(props.prompt_names).toBeNull();
    });
  });

  describe("ServerInitializeEvent", () => {
    it("should have correct event name", () => {
      const event = new ServerInitializeEvent({
        protocolVersion: "2024-11-05",
        clientInfo: { name: "test-client" },
        clientCapabilities: {},
      });

      expect(event.name).toBe("server_initialize_call");
    });

    it("should map all properties correctly", () => {
      const event = new ServerInitializeEvent({
        protocolVersion: "2024-11-05",
        clientInfo: { name: "test-client", version: "1.0.0" },
        clientCapabilities: { tools: { listChanged: true } },
        sessionId: "session-123",
      });

      const props = event.properties;

      expect(props.protocol_version).toBe("2024-11-05");
      expect(props.client_info).toBe(
        JSON.stringify({ name: "test-client", version: "1.0.0" })
      );
      expect(props.client_capabilities).toBe(
        JSON.stringify({ tools: { listChanged: true } })
      );
      expect(props.session_id).toBe("session-123");
    });
  });

  describe("ServerToolCallEvent", () => {
    it("should have correct event name", () => {
      const event = new ServerToolCallEvent({
        toolName: "test_tool",
        lengthInputArgument: 50,
        success: true,
      });

      expect(event.name).toBe("server_tool_call");
    });

    it("should map all properties correctly", () => {
      const event = new ServerToolCallEvent({
        toolName: "my_tool",
        lengthInputArgument: 150,
        success: true,
        errorType: null,
        executionTimeMs: 250,
      });

      const props = event.properties;

      expect(props.tool_name).toBe("my_tool");
      expect(props.length_input_argument).toBe(150);
      expect(props.success).toBe(true);
      expect(props.error_type).toBeNull();
      expect(props.execution_time_ms).toBe(250);
    });

    it("should handle error case", () => {
      const event = new ServerToolCallEvent({
        toolName: "failing_tool",
        lengthInputArgument: 50,
        success: false,
        errorType: "ValidationError",
        executionTimeMs: 10,
      });

      const props = event.properties;

      expect(props.success).toBe(false);
      expect(props.error_type).toBe("ValidationError");
    });
  });

  describe("ServerResourceCallEvent", () => {
    it("should have correct event name", () => {
      const event = new ServerResourceCallEvent({
        name: "test_resource",
        description: null,
        contents: [],
        success: true,
      });

      expect(event.name).toBe("server_resource_call");
    });

    it("should map all properties correctly", () => {
      const event = new ServerResourceCallEvent({
        name: "my_resource",
        description: "A test resource",
        contents: [
          { mime_type: "text/plain", text: "[text: 100 chars]" },
          { mime_type: "application/octet-stream", blob: "[blob: 50 bytes]" },
        ],
        success: true,
        errorType: null,
      });

      const props = event.properties;

      expect(props.name).toBe("my_resource");
      expect(props.description).toBe("A test resource");
      expect(props.contents).toHaveLength(2);
      expect(props.success).toBe(true);
      expect(props.error_type).toBeNull();
    });
  });

  describe("ServerPromptCallEvent", () => {
    it("should have correct event name", () => {
      const event = new ServerPromptCallEvent({
        name: "test_prompt",
        description: null,
        success: true,
      });

      expect(event.name).toBe("server_prompt_call");
    });

    it("should map all properties correctly", () => {
      const event = new ServerPromptCallEvent({
        name: "my_prompt",
        description: "A helpful prompt",
        success: false,
        errorType: "RuntimeError",
      });

      const props = event.properties;

      expect(props.name).toBe("my_prompt");
      expect(props.description).toBe("A helpful prompt");
      expect(props.success).toBe(false);
      expect(props.error_type).toBe("RuntimeError");
    });
  });

  describe("ServerContextEvent", () => {
    it("should have correct event name for sample context", () => {
      const event = new ServerContextEvent({
        contextType: "sample",
      });

      expect(event.name).toBe("server_context_sample");
    });

    it("should have correct event name for elicit context", () => {
      const event = new ServerContextEvent({
        contextType: "elicit",
      });

      expect(event.name).toBe("server_context_elicit");
    });

    it("should have correct event name for notification context", () => {
      const event = new ServerContextEvent({
        contextType: "notification",
        notificationType: "message",
      });

      expect(event.name).toBe("server_context_notification");
    });

    it("should map all properties correctly", () => {
      const event = new ServerContextEvent({
        contextType: "notification",
        notificationType: "progress",
      });

      const props = event.properties;

      expect(props.context_type).toBe("notification");
      expect(props.notification_type).toBe("progress");
    });
  });

  describe("MCPClientInitEvent", () => {
    it("should have correct event name", () => {
      const event = new MCPClientInitEvent({
        codeMode: false,
        sandbox: false,
        allCallbacks: false,
        verify: false,
        servers: [],
        numServers: 0,
      });

      expect(event.name).toBe("mcpclient_init");
    });

    it("should map all properties correctly", () => {
      const event = new MCPClientInitEvent({
        codeMode: true,
        sandbox: true,
        allCallbacks: true,
        verify: true,
        servers: ["server1", "server2", "server3"],
        numServers: 3,
      });

      const props = event.properties;

      expect(props.code_mode).toBe(true);
      expect(props.sandbox).toBe(true);
      expect(props.all_callbacks).toBe(true);
      expect(props.verify).toBe(true);
      expect(props.servers).toEqual(["server1", "server2", "server3"]);
      expect(props.num_servers).toBe(3);
    });
  });

  describe("ConnectorInitEvent", () => {
    it("should have correct event name", () => {
      const event = new ConnectorInitEvent({
        connectorType: "HttpConnector",
      });

      expect(event.name).toBe("connector_init");
    });

    it("should map all properties correctly for HTTP connector", () => {
      const event = new ConnectorInitEvent({
        connectorType: "HttpConnector",
        serverUrl: "http://localhost:3000",
        publicIdentifier: "http://localhost:3000 (streamable-http)",
      });

      const props = event.properties;

      expect(props.connector_type).toBe("HttpConnector");
      expect(props.server_url).toBe("http://localhost:3000");
      expect(props.public_identifier).toBe(
        "http://localhost:3000 (streamable-http)"
      );
      expect(props.server_command).toBeNull();
      expect(props.server_args).toBeNull();
    });

    it("should map all properties correctly for Stdio connector", () => {
      const event = new ConnectorInitEvent({
        connectorType: "StdioConnector",
        serverCommand: "node",
        serverArgs: ["server.js", "--port", "3000"],
        publicIdentifier: "node server.js --port 3000",
      });

      const props = event.properties;

      expect(props.connector_type).toBe("StdioConnector");
      expect(props.server_command).toBe("node");
      expect(props.server_args).toEqual(["server.js", "--port", "3000"]);
      expect(props.public_identifier).toBe("node server.js --port 3000");
      expect(props.server_url).toBeNull();
    });
  });

  describe("createServerRunEventData helper", () => {
    it("should create event data from MCPServer-like object", () => {
      const mockServer: MCPServerTelemetryInfo = {
        registeredTools: ["tool1", "tool2"],
        registeredPrompts: ["prompt1"],
        registeredResources: ["resource1"],
        config: { name: "test-server", description: "A test server" },
        serverBaseUrl: "http://localhost:3000",
        oauthProvider: undefined,
        registrations: {
          tools: new Map([
            [
              "tool1",
              {
                config: { name: "tool1", description: "Tool 1" },
                handler: () => {},
              },
            ],
            [
              "tool2",
              {
                config: { name: "tool2", title: "Tool 2" },
                handler: () => {},
              },
            ],
          ]),
          prompts: new Map([
            [
              "prompt1",
              {
                config: { name: "prompt1", description: "Prompt 1" },
                handler: () => {},
              },
            ],
          ]),
          resources: new Map([
            [
              "resource1",
              {
                config: {
                  name: "resource1",
                  uri: "file://test",
                  mimeType: "text/plain",
                },
                handler: () => {},
              },
            ],
          ]),
          resourceTemplates: new Map(),
        },
      };

      const eventData = createServerRunEventData(mockServer, "http");

      expect(eventData.transport).toBe("http");
      expect(eventData.toolsNumber).toBe(2);
      expect(eventData.resourcesNumber).toBe(1);
      expect(eventData.promptsNumber).toBe(1);
      expect(eventData.auth).toBe(false);
      expect(eventData.name).toBe("test-server");
      expect(eventData.description).toBe("A test server");
      expect(eventData.baseUrl).toBe("http://localhost:3000");
      expect(eventData.toolNames).toEqual(["tool1", "tool2"]);
      expect(eventData.resourceNames).toEqual(["resource1"]);
      expect(eventData.promptNames).toEqual(["prompt1"]);
    });

    it("should set auth to true when oauthProvider is present", () => {
      const mockServer: MCPServerTelemetryInfo = {
        registeredTools: [],
        registeredPrompts: [],
        registeredResources: [],
        config: { name: "auth-server" },
        oauthProvider: { name: "github" }, // Truthy value
        registrations: {
          tools: new Map(),
          prompts: new Map(),
          resources: new Map(),
          resourceTemplates: new Map(),
        },
      };

      const eventData = createServerRunEventData(mockServer, "http");

      expect(eventData.auth).toBe(true);
    });

    it("should handle empty registrations", () => {
      const mockServer: MCPServerTelemetryInfo = {
        registeredTools: [],
        registeredPrompts: [],
        registeredResources: [],
        config: { name: "empty-server" },
        registrations: {
          tools: new Map(),
          prompts: new Map(),
          resources: new Map(),
          resourceTemplates: new Map(),
        },
      };

      const eventData = createServerRunEventData(mockServer, "stdio");

      expect(eventData.toolsNumber).toBe(0);
      expect(eventData.resourcesNumber).toBe(0);
      expect(eventData.promptsNumber).toBe(0);
      expect(eventData.toolNames).toBeNull();
      expect(eventData.resourceNames).toBeNull();
      expect(eventData.promptNames).toBeNull();
      expect(eventData.tools).toBeNull();
      expect(eventData.resources).toBeNull();
      expect(eventData.prompts).toBeNull();
    });

    it("should filter resources by mime_type for appsSdkResources (text/html+skybridge)", () => {
      const mockServer: MCPServerTelemetryInfo = {
        registeredTools: [],
        registeredPrompts: [],
        registeredResources: ["config", "display-weather", "kanban-board"],
        config: { name: "widget-server" },
        registrations: {
          tools: new Map(),
          prompts: new Map(),
          resources: new Map([
            [
              "config",
              {
                config: {
                  name: "config",
                  description: "Server configuration",
                  uri: "config://settings",
                  mimeType: "application/json",
                },
                handler: () => {},
              },
            ],
            [
              "display-weather",
              {
                config: {
                  name: "display-weather",
                  title: "display-weather",
                  description: "Display weather for a city",
                  uri: "ui://widget/display-weather.html",
                  mimeType: "text/html+skybridge",
                },
                handler: () => {},
              },
            ],
            [
              "kanban-board",
              {
                config: {
                  name: "kanban-board",
                  title: "kanban-board",
                  description: "Widget: kanban-board",
                  uri: "ui://widget/kanban-board.html",
                  mimeType: "text/html+skybridge",
                },
                handler: () => {},
              },
            ],
          ]),
          resourceTemplates: new Map(),
        },
      };

      const eventData = createServerRunEventData(mockServer, "http");

      // Should have 2 appsSdkResources (text/html+skybridge)
      expect(eventData.appsSdkResources).toHaveLength(2);
      expect(eventData.appsSdkResourcesNumber).toBe(2);
      expect(eventData.appsSdkResources?.[0].name).toBe("display-weather");
      expect(eventData.appsSdkResources?.[1].name).toBe("kanban-board");
    });

    it("should filter resources by mime_type for mcpUiResources (text/uri-list or text/html)", () => {
      const mockServer: MCPServerTelemetryInfo = {
        registeredTools: [],
        registeredPrompts: [],
        registeredResources: ["links", "page", "config"],
        config: { name: "ui-server" },
        registrations: {
          tools: new Map(),
          prompts: new Map(),
          resources: new Map([
            [
              "links",
              {
                config: {
                  name: "links",
                  description: "List of links",
                  uri: "ui://links",
                  mimeType: "text/uri-list",
                },
                handler: () => {},
              },
            ],
            [
              "page",
              {
                config: {
                  name: "page",
                  description: "HTML page",
                  uri: "ui://page.html",
                  mimeType: "text/html",
                },
                handler: () => {},
              },
            ],
            [
              "config",
              {
                config: {
                  name: "config",
                  description: "JSON config",
                  uri: "config://settings",
                  mimeType: "application/json",
                },
                handler: () => {},
              },
            ],
          ]),
          resourceTemplates: new Map(),
        },
      };

      const eventData = createServerRunEventData(mockServer, "http");

      // Should have 2 mcpUiResources (text/uri-list or text/html)
      expect(eventData.mcpUiResources).toHaveLength(2);
      expect(eventData.mcpUiResourcesNumber).toBe(2);
      expect(eventData.mcpUiResources?.map((r) => r.name)).toContain("links");
      expect(eventData.mcpUiResources?.map((r) => r.name)).toContain("page");
    });

    it("should filter resources by mime_type for mcpAppsResources (text/html+mcp)", () => {
      const mockServer: MCPServerTelemetryInfo = {
        registeredTools: [],
        registeredPrompts: [],
        registeredResources: ["mcp-app", "config"],
        config: { name: "mcp-apps-server" },
        registrations: {
          tools: new Map(),
          prompts: new Map(),
          resources: new Map([
            [
              "mcp-app",
              {
                config: {
                  name: "mcp-app",
                  description: "MCP Application",
                  uri: "app://mcp-app.html",
                  mimeType: "text/html+mcp",
                },
                handler: () => {},
              },
            ],
            [
              "config",
              {
                config: {
                  name: "config",
                  description: "JSON config",
                  uri: "config://settings",
                  mimeType: "application/json",
                },
                handler: () => {},
              },
            ],
          ]),
          resourceTemplates: new Map(),
        },
      };

      const eventData = createServerRunEventData(mockServer, "http");

      // Should have 1 mcpAppsResource (text/html+mcp)
      expect(eventData.mcpAppsResources).toHaveLength(1);
      expect(eventData.mcpAppsResourcesNumber).toBe(1);
      expect(eventData.mcpAppsResources?.[0].name).toBe("mcp-app");
    });

    it("should return null for filtered resources when no matches", () => {
      const mockServer: MCPServerTelemetryInfo = {
        registeredTools: [],
        registeredPrompts: [],
        registeredResources: ["config"],
        config: { name: "json-only-server" },
        registrations: {
          tools: new Map(),
          prompts: new Map(),
          resources: new Map([
            [
              "config",
              {
                config: {
                  name: "config",
                  description: "JSON config",
                  uri: "config://settings",
                  mimeType: "application/json",
                },
                handler: () => {},
              },
            ],
          ]),
          resourceTemplates: new Map(),
        },
      };

      const eventData = createServerRunEventData(mockServer, "http");

      expect(eventData.appsSdkResources).toBeNull();
      expect(eventData.appsSdkResourcesNumber).toBe(0);
      expect(eventData.mcpUiResources).toBeNull();
      expect(eventData.mcpUiResourcesNumber).toBe(0);
      expect(eventData.mcpAppsResources).toBeNull();
      expect(eventData.mcpAppsResourcesNumber).toBe(0);
    });
  });
});
