/**
 * Unit tests for WorkflowContext
 */

import { describe, expect, it } from "vitest";
import { WorkflowContext } from "../../../src/orchestrator/context.js";

describe("WorkflowContext", () => {
    it("should initialize with empty data", () => {
        const context = new WorkflowContext();
        expect(context.getAll()).toEqual({});
    });

    it("should initialize with initial data", () => {
        const context = new WorkflowContext({ foo: "bar", num: 42 });
        expect(context.get("foo")).toBe("bar");
        expect(context.get("num")).toBe(42);
    });

    it("should set and get values", () => {
        const context = new WorkflowContext();
        context.set("key", "value");
        expect(context.get("key")).toBe("value");
    });

    it("should check if key exists", () => {
        const context = new WorkflowContext({ existing: "value" });
        expect(context.has("existing")).toBe(true);
        expect(context.has("nonexistent")).toBe(false);
    });

    it("should get all data", () => {
        const context = new WorkflowContext();
        context.set("a", 1);
        context.set("b", 2);
        context.set("c", 3);

        const all = context.getAll();
        expect(all).toEqual({ a: 1, b: 2, c: 3 });
    });

    it("should clear all data", () => {
        const context = new WorkflowContext({ foo: "bar" });
        expect(context.has("foo")).toBe(true);

        context.clear();
        expect(context.has("foo")).toBe(false);
        expect(context.getAll()).toEqual({});
    });

    it("should overwrite existing values", () => {
        const context = new WorkflowContext({ key: "old" });
        expect(context.get("key")).toBe("old");

        context.set("key", "new");
        expect(context.get("key")).toBe("new");
    });

    it("should handle complex data types", () => {
        const context = new WorkflowContext();
        const obj = { nested: { value: 123 } };
        const arr = [1, 2, 3];

        context.set("object", obj);
        context.set("array", arr);

        expect(context.get("object")).toEqual(obj);
        expect(context.get("array")).toEqual(arr);
    });
});
