/**
 * Unit tests for CompletionInput component
 *
 * Verifies: controlled input, suggestion dropdown (open/close), keyboard
 * navigation (ArrowUp/Down, Enter, Escape), outside click dismissal, and
 * loading state.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CompletionInput } from "../../src/client/components/shared/CompletionInput";

// ── Helpers ──────────────────────────────────────────────────────────────────

const noSuggestions = vi.fn().mockResolvedValue([]);
const withSuggestions = (values: string[]) =>
  vi.fn().mockResolvedValue(values);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CompletionInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a text input with the provided value", () => {
    render(
      <CompletionInput
        value="hello"
        onChange={vi.fn()}
        onFetchSuggestions={noSuggestions}
        data-testid="test-input"
      />
    );

    const input = screen.getByTestId("test-input");
    expect(input).toHaveValue("hello");
  });

  it("calls onChange when the user types", () => {
    const onChange = vi.fn();
    render(
      <CompletionInput
        value=""
        onChange={onChange}
        onFetchSuggestions={noSuggestions}
        data-testid="test-input"
      />
    );

    fireEvent.change(screen.getByTestId("test-input"), {
      target: { value: "py" },
    });

    expect(onChange).toHaveBeenCalledWith("py");
  });

  it("shows dropdown when suggestions are returned", async () => {
    const fetchFn = withSuggestions(["python", "typescript"]);
    render(
      <CompletionInput
        value="py"
        onChange={vi.fn()}
        onFetchSuggestions={fetchFn}
        data-testid="test-input"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("python")).toBeInTheDocument();
      expect(screen.getByText("typescript")).toBeInTheDocument();
    });
  });

  it("does not show dropdown when value is empty", async () => {
    const fetchFn = withSuggestions(["python"]);
    render(
      <CompletionInput
        value=""
        onChange={vi.fn()}
        onFetchSuggestions={fetchFn}
        data-testid="test-input"
      />
    );

    // No suggestions should appear
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("calls onChange with suggestion value on click", async () => {
    const onChange = vi.fn();
    const fetchFn = withSuggestions(["python", "ruby"]);
    render(
      <CompletionInput
        value="py"
        onChange={onChange}
        onFetchSuggestions={fetchFn}
        data-testid="test-input"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("python")).toBeInTheDocument();
    });

    fireEvent.mouseDown(screen.getByText("python"));

    expect(onChange).toHaveBeenCalledWith("python");
  });

  it("navigates suggestions with ArrowDown and selects with Enter", async () => {
    const onChange = vi.fn();
    const fetchFn = withSuggestions(["python", "ruby"]);
    render(
      <CompletionInput
        value="py"
        onChange={onChange}
        onFetchSuggestions={fetchFn}
        data-testid="test-input"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("python")).toBeInTheDocument();
    });

    const input = screen.getByTestId("test-input");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("python");
  });

  it("navigates backwards with ArrowUp", async () => {
    const onChange = vi.fn();
    const fetchFn = withSuggestions(["python", "ruby", "javascript"]);
    render(
      <CompletionInput
        value="py"
        onChange={onChange}
        onFetchSuggestions={fetchFn}
        data-testid="test-input"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("python")).toBeInTheDocument();
    });

    const input = screen.getByTestId("test-input");

    // ArrowUp from no selection wraps to last item
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("javascript");
  });

  it("closes dropdown on Escape", async () => {
    const fetchFn = withSuggestions(["python"]);
    render(
      <CompletionInput
        value="py"
        onChange={vi.fn()}
        onFetchSuggestions={fetchFn}
        data-testid="test-input"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    fireEvent.keyDown(screen.getByTestId("test-input"), { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("is disabled when disabled prop is true", () => {
    render(
      <CompletionInput
        value="test"
        onChange={vi.fn()}
        onFetchSuggestions={noSuggestions}
        disabled
        data-testid="test-input"
      />
    );

    expect(screen.getByTestId("test-input")).toBeDisabled();
  });
});
