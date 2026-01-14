/**
 * Tests for useCallToolState hook
 */

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCallToolState } from "./useCallToolState.js";

describe("useCallToolState", () => {
  it("should start in idle state", () => {
    const { result } = renderHook(() => useCallToolState());

    expect(result.current.status).toBe("idle");
    expect(result.current.isIdle).toBe(true);
    expect(result.current.isPending).toBe(false);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it("should transition to pending state", () => {
    const { result } = renderHook(() => useCallToolState());

    act(() => {
      result.current.setState({
        status: "pending",
        data: undefined,
        error: undefined,
      });
    });

    expect(result.current.status).toBe("pending");
    expect(result.current.isPending).toBe(true);
    expect(result.current.isIdle).toBe(false);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it("should transition to success state with data", () => {
    const { result } = renderHook(() => useCallToolState<{ value: number }>());
    const testData = { value: 42 };

    act(() => {
      result.current.setState({
        status: "success",
        data: testData,
        error: undefined,
      });
    });

    expect(result.current.status).toBe("success");
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isPending).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual(testData);
    expect(result.current.error).toBeUndefined();
  });

  it("should transition to error state with error", () => {
    const { result } = renderHook(() => useCallToolState());
    const testError = new Error("Test error");

    act(() => {
      result.current.setState({
        status: "error",
        data: undefined,
        error: testError,
      });
    });

    expect(result.current.status).toBe("error");
    expect(result.current.isError).toBe(true);
    expect(result.current.isPending).toBe(false);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBe(testError);
  });

  it("should reset to idle state", () => {
    const { result } = renderHook(() => useCallToolState<{ value: number }>());

    // First, set to success
    act(() => {
      result.current.setState({
        status: "success",
        data: { value: 42 },
        error: undefined,
      });
    });

    expect(result.current.isSuccess).toBe(true);

    // Then reset
    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.isIdle).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it("should handle state updates via function", () => {
    const { result } = renderHook(() => useCallToolState<{ count: number }>());

    // Set initial state
    act(() => {
      result.current.setState({
        status: "success",
        data: { count: 1 },
        error: undefined,
      });
    });

    // Update via function
    act(() => {
      result.current.setState((prev) => ({
        ...prev,
        data: { count: (prev.data?.count || 0) + 1 },
      }));
    });

    expect(result.current.data).toEqual({ count: 2 });
  });
});
