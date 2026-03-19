/**
 * Tests for the ModelContext system:
 *
 * - Tree serialization (buildDescriptionString)
 * - modelContext imperative API (set / remove / clear)
 * - registerModelContextFlush (handler registration and deregistration)
 * - Batched flush via queueMicrotask
 * - Content passed to the registered flush handler
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  modelContext,
  registerModelContextFlush,
  _resetModelContextForTesting,
  _getDescriptionForTesting,
} from "../../../src/react/model-context.js";

beforeEach(() => {
  _resetModelContextForTesting();
});

afterEach(() => {
  _resetModelContextForTesting();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Drain the microtask queue so batched flushes run synchronously. */
async function flushMicrotasks() {
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Tree serialization
// ---------------------------------------------------------------------------

describe("buildDescriptionString", () => {
  it("returns empty string when no nodes are registered", () => {
    expect(_getDescriptionForTesting()).toBe("");
  });

  it("returns a single root entry", () => {
    modelContext.set("a", "User is browsing the dashboard");
    expect(_getDescriptionForTesting()).toBe(
      "- User is browsing the dashboard"
    );
  });

  it("trims whitespace from content", () => {
    modelContext.set("a", "  Some content  ");
    expect(_getDescriptionForTesting()).toBe("- Some content");
  });

  it("skips entries with blank content", () => {
    modelContext.set("a", "  ");
    expect(_getDescriptionForTesting()).toBe("");
  });

  it("produces a flat list for multiple root entries, sorted by id", () => {
    modelContext.set("b", "Second");
    modelContext.set("a", "First");
    modelContext.set("c", "Third");
    const result = _getDescriptionForTesting();
    expect(result).toBe("- First\n- Second\n- Third");
  });

  it("overwrites a previous entry when set with the same key", () => {
    modelContext.set("item", "Old content");
    modelContext.set("item", "New content");
    expect(_getDescriptionForTesting()).toBe("- New content");
  });

  it("returns empty string after removing the only entry", () => {
    modelContext.set("a", "Some content");
    modelContext.remove("a");
    expect(_getDescriptionForTesting()).toBe("");
  });

  it("returns empty string after clear()", () => {
    modelContext.set("a", "First");
    modelContext.set("b", "Second");
    modelContext.clear();
    expect(_getDescriptionForTesting()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// modelContext imperative API
// ---------------------------------------------------------------------------

describe("modelContext.set / remove", () => {
  it("set adds a root-level entry (parentId: null)", () => {
    modelContext.set("my-key", "Some annotation");
    expect(_getDescriptionForTesting()).toBe("- Some annotation");
  });

  it("remove deletes the entry", () => {
    modelContext.set("k", "Hello");
    modelContext.remove("k");
    expect(_getDescriptionForTesting()).toBe("");
  });

  it("remove is a no-op for a non-existent key", () => {
    expect(() => modelContext.remove("does-not-exist")).not.toThrow();
  });

  it("set is idempotent — last write wins", () => {
    modelContext.set("k", "v1");
    modelContext.set("k", "v2");
    modelContext.set("k", "v3");
    expect(_getDescriptionForTesting()).toBe("- v3");
  });

  it("clear removes all entries", () => {
    modelContext.set("a", "A");
    modelContext.set("b", "B");
    modelContext.clear();
    expect(_getDescriptionForTesting()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// registerModelContextFlush
// ---------------------------------------------------------------------------

describe("registerModelContextFlush", () => {
  it("calls the handler immediately with the current description on registration", () => {
    modelContext.set("a", "Existing content");
    const handler = vi.fn();
    registerModelContextFlush(handler);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith("- Existing content");
  });

  it("calls the handler with empty string when no nodes exist", () => {
    const handler = vi.fn();
    registerModelContextFlush(handler);
    expect(handler).toHaveBeenCalledWith("");
  });

  it("deregistration prevents further calls", async () => {
    const handler = vi.fn();
    const deregister = registerModelContextFlush(handler);
    handler.mockClear();

    deregister();
    modelContext.set("a", "After deregister");
    await flushMicrotasks();

    expect(handler).not.toHaveBeenCalled();
  });

  it("deregistration only affects the registered handler", async () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    const deregisterA = registerModelContextFlush(handlerA);
    handlerA.mockClear();

    // Replace with handlerB
    registerModelContextFlush(handlerB);
    handlerB.mockClear();

    deregisterA(); // deregistering A should not affect B

    modelContext.set("a", "Hello");
    await flushMicrotasks();

    expect(handlerB).toHaveBeenCalledWith("- Hello");
    expect(handlerA).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Batched flush
// ---------------------------------------------------------------------------

describe("batched flush via queueMicrotask", () => {
  it("coalesces multiple synchronous set() calls into one handler invocation", async () => {
    const handler = vi.fn();
    registerModelContextFlush(handler);
    handler.mockClear();

    // Three synchronous mutations
    modelContext.set("a", "First");
    modelContext.set("b", "Second");
    modelContext.set("c", "Third");

    // Handler not called yet (microtask still pending)
    expect(handler).not.toHaveBeenCalled();

    await flushMicrotasks();

    // Only one call with the final state
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith("- First\n- Second\n- Third");
  });

  it("coalesces set followed by remove into one call with updated content", async () => {
    const handler = vi.fn();
    registerModelContextFlush(handler);
    handler.mockClear();

    modelContext.set("a", "Will be removed");
    modelContext.remove("a");

    await flushMicrotasks();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith("");
  });

  it("delivers the final description after multiple sets to the same key", async () => {
    const handler = vi.fn();
    registerModelContextFlush(handler);
    handler.mockClear();

    modelContext.set("k", "v1");
    modelContext.set("k", "v2");
    modelContext.set("k", "v3");

    await flushMicrotasks();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith("- v3");
  });
});

// ---------------------------------------------------------------------------
// Context passed to the model — integration of set + flush
// ---------------------------------------------------------------------------

describe("context state passed to the model", () => {
  it("a single annotation produces the correct string", async () => {
    const received: string[] = [];
    registerModelContextFlush((d) => received.push(d));

    modelContext.set("tab", "User is on the Overview tab");
    await flushMicrotasks();

    expect(received.at(-1)).toBe("- User is on the Overview tab");
  });

  it("multiple annotations are all included in the sent string", async () => {
    const received: string[] = [];
    registerModelContextFlush((d) => received.push(d));

    modelContext.set("a-section", "Revenue section visible");
    modelContext.set("b-section", "Users section visible");
    await flushMicrotasks();

    expect(received.at(-1)).toBe(
      "- Revenue section visible\n- Users section visible"
    );
  });

  it("removing an annotation removes it from the next flush", async () => {
    const received: string[] = [];
    registerModelContextFlush((d) => received.push(d));

    modelContext.set("hover", "Hovering product: Keyboard");
    await flushMicrotasks();
    expect(received.at(-1)).toBe("- Hovering product: Keyboard");

    modelContext.remove("hover");
    await flushMicrotasks();
    expect(received.at(-1)).toBe("");
  });

  it("updating an annotation sends the new value on the next flush", async () => {
    const received: string[] = [];
    registerModelContextFlush((d) => received.push(d));

    modelContext.set("tab", "User is on the Overview tab");
    await flushMicrotasks();

    modelContext.set("tab", "User is on the Reviews tab");
    await flushMicrotasks();

    expect(received.at(-1)).toBe("- User is on the Reviews tab");
    // Previous value was sent earlier
    expect(received).toContain("- User is on the Overview tab");
  });

  it("clear sends an empty string", async () => {
    const received: string[] = [];
    registerModelContextFlush((d) => received.push(d));

    modelContext.set("a", "Something");
    await flushMicrotasks();

    modelContext.clear();
    await flushMicrotasks();

    expect(received.at(-1)).toBe("");
  });
});
