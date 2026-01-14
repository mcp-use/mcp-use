/**
 * Tests for widget useCallTool hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCallTool } from "./useCallTool.js";
import type { CallToolResponse } from "../../widget-types.js";

describe("useCallTool (widget)", () => {
  // Mock window.openai
  const mockCallTool = vi.fn();

  beforeEach(() => {
    // Setup window.openai mock
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
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
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

    expect(result.current.isPending).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual(mockResponse);
    expect(mockCallTool).toHaveBeenCalledWith("test-tool", { input: "test" });
  });

  it("should handle tool call error", async () => {
    const mockError = new Error("Tool call failed");
    mockCallTool.mockRejectedValue(mockError);

    const { result } = renderHook(() =>
      useCallTool<{ input: string }, any>("test-tool")
    );

    await act(async () => {
      await result.current.callTool({ input: "test" });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.error).toEqual(mockError);
    expect(result.current.data).toBeUndefined();
  });

  it("should handle error response from tool", async () => {
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

  it("should call onSuccess callback", async () => {
    const mockResponse: CallToolResponse = {
      content: [{ type: "text", text: "Success" }],
      isError: false,
    };
    mockCallTool.mockResolvedValue(mockResponse);

    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useCallTool<{ input: string }, CallToolResponse>("test-tool", {
        onSuccess,
      })
    );

    await act(async () => {
      await result.current.callTool({ input: "test" });
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(mockResponse, { input: "test" });
    });
  });

  it("should call onError callback", async () => {
    const mockError = new Error("Failed");
    mockCallTool.mockRejectedValue(mockError);

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useCallTool<{ input: string }, any>("test-tool", { onError })
    );

    await act(async () => {
      await result.current.callTool({ input: "test" });
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(mockError, { input: "test" });
    });
  });

  it("should call onSettled callback on success", async () => {
    const mockResponse: CallToolResponse = {
      content: [{ type: "text", text: "Success" }],
      isError: false,
    };
    mockCallTool.mockResolvedValue(mockResponse);

    const onSettled = vi.fn();
    const { result } = renderHook(() =>
      useCallTool<{ input: string }, CallToolResponse>("test-tool", {
        onSettled,
      })
    );

    await act(async () => {
      await result.current.callTool({ input: "test" });
    });

    await waitFor(() => {
      expect(onSettled).toHaveBeenCalledWith(mockResponse, undefined, {
        input: "test",
      });
    });
  });

  it("should call onSettled callback on error", async () => {
    const mockError = new Error("Failed");
    mockCallTool.mockRejectedValue(mockError);

    const onSettled = vi.fn();
    const { result } = renderHook(() =>
      useCallTool<{ input: string }, any>("test-tool", { onSettled })
    );

    await act(async () => {
      await result.current.callTool({ input: "test" });
    });

    await waitFor(() => {
      expect(onSettled).toHaveBeenCalledWith(undefined, mockError, {
        input: "test",
      });
    });
  });

  it("should handle callToolAsync and return data", async () => {
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
    expect(result.current.data).toEqual(mockResponse);
  });

  it("should handle callToolAsync error and throw", async () => {
    const mockError = new Error("Failed");
    mockCallTool.mockRejectedValue(mockError);

    const { result } = renderHook(() =>
      useCallTool<{ input: string }, any>("test-tool")
    );

    await expect(async () => {
      await act(async () => {
        await result.current.callToolAsync({ input: "test" });
      });
    }).rejects.toThrow("Failed");

    expect(result.current.isError).toBe(true);
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

    // Make a successful call
    await act(async () => {
      await result.current.callTool({ input: "test" });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Reset
    act(() => {
      result.current.reset();
    });

    expect(result.current.isIdle).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it("should handle window.openai not available", async () => {
    delete (global as any).window.openai;

    const { result } = renderHook(() =>
      useCallTool<{ input: string }, any>("test-tool")
    );

    await act(async () => {
      await result.current.callTool({ input: "test" });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe(
      "window.openai.callTool is not available"
    );
  });
});
