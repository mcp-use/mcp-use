/**
 * Tests for unified useCallTool hook
 * Tests both widget and MCP server contexts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCallTool, type McpServerLike } from "./useCallTool.js";
import type { CallToolResponse } from "../widget-types.js";

describe("useCallTool (unified)", () => {
  describe("Widget context", () => {
    const mockCallTool = vi.fn();

    beforeEach(() => {
      (global as any).window = {
        openai: {
          callTool: mockCallTool,
        },
      };
    });

    afterEach(() => {
      vi.clearAllMocks();
      delete (global as any).window;
    });

    it("should start in idle state", () => {
      const { result } = renderHook(() => useCallTool("test-tool"));

      expect(result.current.isIdle).toBe(true);
      expect(result.current.isPending).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.isError).toBe(false);
    });

    it("should handle successful tool call", async () => {
      const mockResponse: CallToolResponse = {
        content: [{ type: "text", text: "Success" }],
        isError: false,
      };
      mockCallTool.mockResolvedValue(mockResponse);

      const { result } = renderHook(() =>
        useCallTool<{ input: string }, CallToolResponse>("test-tool")
      );

      await act(async () => {
        await result.current.callTool({ input: "test" });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockResponse);
      expect(mockCallTool).toHaveBeenCalledWith("test-tool", { input: "test" });
    });

    it("should handle error response", async () => {
      const mockResponse: CallToolResponse = {
        content: [{ type: "text", text: "Tool execution failed" }],
        isError: true,
      };
      mockCallTool.mockResolvedValue(mockResponse);

      const { result } = renderHook(() =>
        useCallTool<{ input: string }, any>("test-tool")
      );

      await act(async () => {
        await result.current.callTool({ input: "test" });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe("Tool execution failed");
    });

    it("should call callbacks", async () => {
      const mockResponse: CallToolResponse = {
        content: [{ type: "text", text: "Success" }],
        isError: false,
      };
      mockCallTool.mockResolvedValue(mockResponse);

      const onSuccess = vi.fn();
      const onSettled = vi.fn();

      const { result } = renderHook(() =>
        useCallTool<{ input: string }, CallToolResponse>("test-tool", {
          onSuccess,
          onSettled,
        })
      );

      await act(async () => {
        await result.current.callTool({ input: "test" });
      });

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(mockResponse, { input: "test" });
        expect(onSettled).toHaveBeenCalledWith(mockResponse, undefined, {
          input: "test",
        });
      });
    });

    it("should handle callToolAsync", async () => {
      const mockResponse: CallToolResponse = {
        content: [{ type: "text", text: "Success" }],
        isError: false,
      };
      mockCallTool.mockResolvedValue(mockResponse);

      const { result } = renderHook(() =>
        useCallTool<{ input: string }, CallToolResponse>("test-tool")
      );

      let returnedData: CallToolResponse | undefined;
      await act(async () => {
        returnedData = await result.current.callToolAsync({ input: "test" });
      });

      expect(returnedData).toEqual(mockResponse);
      expect(result.current.isSuccess).toBe(true);
    });

    it("should reset state", async () => {
      const mockResponse: CallToolResponse = {
        content: [{ type: "text", text: "Success" }],
        isError: false,
      };
      mockCallTool.mockResolvedValue(mockResponse);

      const { result } = renderHook(() =>
        useCallTool<{ input: string }, CallToolResponse>("test-tool")
      );

      await act(async () => {
        await result.current.callTool({ input: "test" });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.isIdle).toBe(true);
      expect(result.current.data).toBeUndefined();
      expect(result.current.error).toBeUndefined();
    });
  });

  describe("MCP server context", () => {
    // Create a proper mock server object
    const mockCallToolFn = vi.fn();
    const createMockServer = (): McpServerLike => ({
      callTool: mockCallToolFn,
      state: "ready",
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it("should start in idle state", () => {
      const mockServer = createMockServer();
      const { result } = renderHook(() => useCallTool(mockServer, "test-tool"));

      expect(result.current.isIdle).toBe(true);
      expect(result.current.isPending).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.isError).toBe(false);
    });

    it("should handle successful tool call", async () => {
      const mockResponse = { result: "success" };
      mockCallToolFn.mockResolvedValue(mockResponse);

      const mockServer = createMockServer();
      const { result } = renderHook(() =>
        useCallTool<{ input: string }, { result: string }>(
          mockServer,
          "test-tool"
        )
      );

      await act(async () => {
        await result.current.callTool({ input: "test" });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockResponse);
      expect(mockCallToolFn).toHaveBeenCalledWith(
        "test-tool",
        { input: "test" },
        {
          timeout: undefined,
          maxTotalTimeout: undefined,
          resetTimeoutOnProgress: undefined,
        }
      );
    });

    it("should handle tool call with timeout options", async () => {
      const mockResponse = { result: "success" };
      mockCallToolFn.mockResolvedValue(mockResponse);

      const mockServer = createMockServer();
      const { result } = renderHook(() =>
        useCallTool<{ input: string }, { result: string }>(
          mockServer,
          "test-tool",
          {
            timeout: 30000,
            maxTotalTimeout: 120000,
            resetTimeoutOnProgress: true,
          }
        )
      );

      await act(async () => {
        await result.current.callTool({ input: "test" });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockCallToolFn).toHaveBeenCalledWith(
        "test-tool",
        { input: "test" },
        {
          timeout: 30000,
          maxTotalTimeout: 120000,
          resetTimeoutOnProgress: true,
        }
      );
    });

    it("should handle error", async () => {
      const mockError = new Error("Tool call failed");
      mockCallToolFn.mockRejectedValue(mockError);

      const mockServer = createMockServer();
      const { result } = renderHook(() =>
        useCallTool<{ input: string }, any>(mockServer, "test-tool")
      );

      await act(async () => {
        await result.current.callTool({ input: "test" });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toEqual(mockError);
    });

    it("should call callbacks", async () => {
      const mockResponse = { result: "success" };
      mockCallToolFn.mockResolvedValue(mockResponse);

      const onSuccess = vi.fn();
      const onError = vi.fn();
      const onSettled = vi.fn();

      const mockServer = createMockServer();
      const { result } = renderHook(() =>
        useCallTool<{ input: string }, { result: string }>(
          mockServer,
          "test-tool",
          {
            onSuccess,
            onError,
            onSettled,
          }
        )
      );

      await act(async () => {
        await result.current.callTool({ input: "test" });
      });

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(mockResponse, { input: "test" });
        expect(onSettled).toHaveBeenCalledWith(mockResponse, undefined, {
          input: "test",
        });
      });

      expect(onError).not.toHaveBeenCalled();
    });

    it("should handle callToolAsync", async () => {
      const mockResponse = { result: "success" };
      mockCallToolFn.mockResolvedValue(mockResponse);

      const mockServer = createMockServer();
      const { result } = renderHook(() =>
        useCallTool<{ input: string }, { result: string }>(
          mockServer,
          "test-tool"
        )
      );

      let returnedData: { result: string } | undefined;
      await act(async () => {
        returnedData = await result.current.callToolAsync({ input: "test" });
      });

      expect(returnedData).toEqual(mockResponse);
      expect(result.current.isSuccess).toBe(true);
    });

    it("should handle null server", async () => {
      const { result } = renderHook(() =>
        useCallTool<{ input: string }, any>(null, "test-tool")
      );

      await act(async () => {
        await result.current.callTool({ input: "test" });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe("MCP server is not connected");
    });
  });
});
