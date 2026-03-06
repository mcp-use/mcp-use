/**
 * Tests for completion support in BaseConnector and MCPSession
 *
 * Tests the client-side completion functionality that allows requesting
 * autocomplete suggestions for prompt arguments and resource template URIs.
 *
 * Run with: pnpm test tests/unit/client/completion.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BaseConnector } from "../../../src/connectors/base.js";
import { MCPSession } from "../../../src/session.js";
import type {
  CompleteRequestParams,
  CompleteResult,
} from "@modelcontextprotocol/sdk/types.js";

describe("Completion Support", () => {
  describe("BaseConnector.complete()", () => {
    it("should throw when client is not connected", async () => {
      const connector = new BaseConnector();

      const params: CompleteRequestParams = {
        ref: { type: "ref/prompt", name: "test-prompt" },
        argument: { name: "language", value: "py" },
      };

      await expect(connector.complete(params)).rejects.toThrow(
        "MCP client is not connected"
      );
    });

    it("should call SDK client.complete() when connected", async () => {
      const connector = new BaseConnector();

      // Mock the SDK client
      const mockClient = {
        complete: vi.fn().mockResolvedValue({
          completion: {
            values: ["python", "pytorch"],
            total: 2,
            hasMore: false,
          },
        }),
      };

      // Inject the mock client
      (connector as any).client = mockClient;

      const params: CompleteRequestParams = {
        ref: { type: "ref/prompt", name: "test-prompt" },
        argument: { name: "language", value: "py" },
      };

      const result = await connector.complete(params);

      expect(mockClient.complete).toHaveBeenCalledWith(params, undefined);
      expect(result.completion.values).toEqual(["python", "pytorch"]);
      expect(result.completion.total).toBe(2);
    });

    it("should pass request options to SDK client", async () => {
      const connector = new BaseConnector();

      const mockClient = {
        complete: vi.fn().mockResolvedValue({
          completion: {
            values: ["value1"],
            total: 1,
            hasMore: false,
          },
        }),
      };

      (connector as any).client = mockClient;

      const params: CompleteRequestParams = {
        ref: { type: "ref/resource", uri: "file:///{path}" },
        argument: { name: "path", value: "/home" },
      };

      const options = { timeout: 5000 };

      await connector.complete(params, options);

      expect(mockClient.complete).toHaveBeenCalledWith(params, options);
    });
  });

  describe("MCPSession.complete()", () => {
    it("should have complete method that delegates to connector", () => {
      const connector = new BaseConnector();
      const session = new MCPSession("test-server", connector);

      // Verify the method exists on session
      expect(typeof session.complete).toBe("function");

      // MCPSession.complete() is a simple delegation method:
      // return this.connector.complete(params, options);
      // The actual behavior is tested in integration tests
    });
  });
});
