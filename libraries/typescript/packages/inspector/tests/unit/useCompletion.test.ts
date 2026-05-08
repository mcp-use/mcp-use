/**
 * Unit tests for useCompletion hook
 *
 * Verifies debounced completion requests for prompt arguments and resource
 * template URI variables, plus graceful degradation when `complete` is
 * undefined or when the server returns an error.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useCompletion } from "../../src/client/hooks/useCompletion";
import type {
  CompleteRequestParams,
  CompleteResult,
} from "@modelcontextprotocol/sdk/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCompleteFn(
  values: string[]
): (params: CompleteRequestParams) => Promise<CompleteResult> {
  return vi.fn().mockResolvedValue({
    completion: { values, total: values.length, hasMore: false },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useCompletion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── fetchPromptArgCompletion ───────────────────────────────────────────────

  describe("fetchPromptArgCompletion", () => {
    it("returns [] when complete is undefined", async () => {
      const { result } = renderHook(() =>
        useCompletion({ complete: undefined, isConnected: true })
      );

      let suggestions: string[] = [];
      await act(async () => {
        vi.advanceTimersByTime(400);
        suggestions = await result.current.fetchPromptArgCompletion(
          "my-prompt",
          "language",
          "py"
        );
      });

      expect(suggestions).toEqual([]);
    });

    it("returns [] when not connected", async () => {
      const completeFn = makeCompleteFn(["python"]);
      const { result } = renderHook(() =>
        useCompletion({ complete: completeFn, isConnected: false })
      );

      let suggestions: string[] = [];
      await act(async () => {
        const promise = result.current.fetchPromptArgCompletion(
          "my-prompt",
          "language",
          "py"
        );
        vi.advanceTimersByTime(400);
        suggestions = await promise;
      });

      expect(suggestions).toEqual([]);
      expect(completeFn).not.toHaveBeenCalled();
    });

    it("calls complete() with ref/prompt params and returns values", async () => {
      const completeFn = makeCompleteFn(["python", "typescript"]);
      const { result } = renderHook(() =>
        useCompletion({ complete: completeFn, isConnected: true })
      );

      let suggestions: string[] = [];
      await act(async () => {
        const promise = result.current.fetchPromptArgCompletion(
          "code-prompt",
          "language",
          "py"
        );
        vi.advanceTimersByTime(400);
        suggestions = await promise;
      });

      expect(completeFn).toHaveBeenCalledWith({
        ref: { type: "ref/prompt", name: "code-prompt" },
        argument: { name: "language", value: "py" },
      });
      expect(suggestions).toEqual(["python", "typescript"]);
    });

    it("returns [] and does not throw when complete() rejects", async () => {
      const completeFn = vi
        .fn()
        .mockRejectedValue(new Error("Server error: method not found"));
      const { result } = renderHook(() =>
        useCompletion({ complete: completeFn, isConnected: true })
      );

      let suggestions: string[] = [];
      await act(async () => {
        const promise = result.current.fetchPromptArgCompletion(
          "my-prompt",
          "lang",
          "py"
        );
        vi.advanceTimersByTime(400);
        suggestions = await promise;
      });

      expect(suggestions).toEqual([]);
    });

    it("debounces rapid calls — only the last one fires", async () => {
      const completeFn = makeCompleteFn(["python"]);
      const { result } = renderHook(() =>
        useCompletion({ complete: completeFn, isConnected: true })
      );

      await act(async () => {
        // Fire 3 calls quickly without advancing timers between them
        result.current.fetchPromptArgCompletion("p", "lang", "p");
        result.current.fetchPromptArgCompletion("p", "lang", "py");
        const last = result.current.fetchPromptArgCompletion(
          "p",
          "lang",
          "pyt"
        );
        // Now let the debounce expire
        vi.advanceTimersByTime(400);
        await last;
      });

      // complete() should only have been called once (for the last value)
      expect(completeFn).toHaveBeenCalledTimes(1);
      expect(completeFn).toHaveBeenCalledWith(
        expect.objectContaining({
          argument: expect.objectContaining({ value: "pyt" }),
        })
      );
    });
  });

  // ── fetchResourceTemplateCompletion ───────────────────────────────────────

  describe("fetchResourceTemplateCompletion", () => {
    it("calls complete() with ref/resource params", async () => {
      const completeFn = makeCompleteFn(["/home/user", "/tmp"]);
      const { result } = renderHook(() =>
        useCompletion({ complete: completeFn, isConnected: true })
      );

      let suggestions: string[] = [];
      await act(async () => {
        const promise = result.current.fetchResourceTemplateCompletion(
          "file:///{path}",
          "path",
          "/ho"
        );
        vi.advanceTimersByTime(400);
        suggestions = await promise;
      });

      expect(completeFn).toHaveBeenCalledWith({
        ref: { type: "ref/resource", uri: "file:///{path}" },
        argument: { name: "path", value: "/ho" },
      });
      expect(suggestions).toEqual(["/home/user", "/tmp"]);
    });

    it("returns [] when not connected", async () => {
      const completeFn = makeCompleteFn(["foo"]);
      const { result } = renderHook(() =>
        useCompletion({ complete: completeFn, isConnected: false })
      );

      let suggestions: string[] = [];
      await act(async () => {
        const promise = result.current.fetchResourceTemplateCompletion(
          "file:///{path}",
          "path",
          "/home"
        );
        vi.advanceTimersByTime(400);
        suggestions = await promise;
      });

      expect(suggestions).toEqual([]);
      expect(completeFn).not.toHaveBeenCalled();
    });

    it("returns [] on server error", async () => {
      const completeFn = vi
        .fn()
        .mockRejectedValue(new Error("completion not supported"));
      const { result } = renderHook(() =>
        useCompletion({ complete: completeFn, isConnected: true })
      );

      let suggestions: string[] = [];
      await act(async () => {
        const promise = result.current.fetchResourceTemplateCompletion(
          "file:///{path}",
          "path",
          "/ho"
        );
        vi.advanceTimersByTime(400);
        suggestions = await promise;
      });

      expect(suggestions).toEqual([]);
    });
  });
});
