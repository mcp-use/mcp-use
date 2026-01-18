import { describe, it, expect } from "vitest";
import {
  AgentConfigSchema,
  EvalDefaultsSchema,
  EvalConfigSchema,
} from "../../../src/runtime/config.js";

describe("Config Schemas", () => {
  describe("AgentConfigSchema", () => {
    it("should validate valid agent config", () => {
      const validConfig = {
        provider: "openai",
        model: "gpt-4",
      };

      const result = AgentConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it("should validate agent config with baseUrl", () => {
      const validConfig = {
        provider: "openai",
        model: "gpt-4",
        baseUrl: "https://api.example.com",
      };

      const result = AgentConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it("should reject config without provider", () => {
      const invalidConfig = {
        model: "gpt-4",
      };

      const result = AgentConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it("should reject config without model", () => {
      const invalidConfig = {
        provider: "openai",
      };

      const result = AgentConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it("should reject config with empty strings", () => {
      const invalidConfig = {
        provider: "",
        model: "",
      };

      const result = AgentConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });
  });

  describe("EvalDefaultsSchema", () => {
    it("should validate valid defaults", () => {
      const validDefaults = {
        timeout: 30000,
        retries: 3,
        serverLifecycle: "suite" as const,
      };

      const result = EvalDefaultsSchema.safeParse(validDefaults);
      expect(result.success).toBe(true);
    });

    it("should validate defaults with additionalInstructions", () => {
      const validDefaults = {
        timeout: 30000,
        retries: 3,
        serverLifecycle: "suite" as const,
        additionalInstructions: "Be concise and direct",
      };

      const result = EvalDefaultsSchema.safeParse(validDefaults);
      expect(result.success).toBe(true);
    });

    it("should allow test serverLifecycle", () => {
      const validDefaults = {
        timeout: 30000,
        retries: 0,
        serverLifecycle: "test" as const,
      };

      const result = EvalDefaultsSchema.safeParse(validDefaults);
      expect(result.success).toBe(true);
    });

    it("should reject negative timeout", () => {
      const invalidDefaults = {
        timeout: -1000,
        retries: 0,
        serverLifecycle: "suite" as const,
      };

      const result = EvalDefaultsSchema.safeParse(invalidDefaults);
      expect(result.success).toBe(false);
    });

    it("should reject negative retries", () => {
      const invalidDefaults = {
        timeout: 30000,
        retries: -1,
        serverLifecycle: "suite" as const,
      };

      const result = EvalDefaultsSchema.safeParse(invalidDefaults);
      expect(result.success).toBe(false);
    });

    it("should reject invalid serverLifecycle", () => {
      const invalidDefaults = {
        timeout: 30000,
        retries: 0,
        serverLifecycle: "invalid",
      };

      const result = EvalDefaultsSchema.safeParse(invalidDefaults);
      expect(result.success).toBe(false);
    });
  });

  describe("EvalConfigSchema", () => {
    it("should validate complete config", () => {
      const validConfig = {
        default: {
          runAgent: "gpt",
          judgeAgent: "gpt",
        },
        agents: {
          gpt: {
            provider: "openai",
            model: "gpt-4",
          },
        },
        servers: {
          myServer: {
            type: "stdio",
            command: "node",
            args: ["server.js"],
          },
        },
        defaults: {
          timeout: 30000,
          retries: 0,
          serverLifecycle: "suite" as const,
        },
      };

      const result = EvalConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it("should validate config with multiple agents", () => {
      const validConfig = {
        default: {
          runAgent: "gpt",
          judgeAgent: "claude",
        },
        agents: {
          gpt: {
            provider: "openai",
            model: "gpt-4",
          },
          claude: {
            provider: "anthropic",
            model: "claude-3-5-sonnet-20241022",
          },
        },
        servers: {},
        defaults: {
          timeout: 30000,
          retries: 0,
          serverLifecycle: "suite" as const,
        },
      };

      const result = EvalConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it("should validate config with additionalInstructions", () => {
      const validConfig = {
        default: {
          runAgent: "gpt",
          judgeAgent: "gpt",
        },
        agents: {
          gpt: {
            provider: "openai",
            model: "gpt-4",
          },
        },
        servers: {},
        defaults: {
          timeout: 30000,
          retries: 0,
          serverLifecycle: "suite" as const,
          additionalInstructions: "Custom instructions for the agent",
        },
      };

      const result = EvalConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it("should reject config without default section", () => {
      const invalidConfig = {
        agents: {
          gpt: {
            provider: "openai",
            model: "gpt-4",
          },
        },
        servers: {},
        defaults: {
          timeout: 30000,
          retries: 0,
          serverLifecycle: "suite" as const,
        },
      };

      const result = EvalConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it("should reject config without agents section", () => {
      const invalidConfig = {
        default: {
          runAgent: "gpt",
          judgeAgent: "gpt",
        },
        servers: {},
        defaults: {
          timeout: 30000,
          retries: 0,
          serverLifecycle: "suite" as const,
        },
      };

      const result = EvalConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it("should reject config without defaults section", () => {
      const invalidConfig = {
        default: {
          runAgent: "gpt",
          judgeAgent: "gpt",
        },
        agents: {
          gpt: {
            provider: "openai",
            model: "gpt-4",
          },
        },
        servers: {},
      };

      const result = EvalConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });
  });
});
