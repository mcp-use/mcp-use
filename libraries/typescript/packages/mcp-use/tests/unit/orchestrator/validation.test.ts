/**
 * Unit tests for workflow validation
 */

import { describe, expect, it } from "vitest";
import { validateWorkflow } from "../../../src/orchestrator/validation.js";
import type { WorkflowDefinition } from "../../../src/orchestrator/types.js";

describe("validateWorkflow", () => {
    it("should validate a simple workflow", () => {
        const workflow: WorkflowDefinition = {
            name: "simple",
            steps: [
                { id: "step1", agent: "agent1" },
                { id: "step2", agent: "agent2" },
            ],
        };

        const agents = {
            agent1: {} as any,
            agent2: {} as any,
        };

        expect(() => validateWorkflow(workflow, agents)).not.toThrow();
    });

    it("should throw on duplicate step IDs", () => {
        const workflow: WorkflowDefinition = {
            name: "duplicate-steps",
            steps: [
                { id: "step1", agent: "agent1" },
                { id: "step1", agent: "agent2" }, // Duplicate ID
            ],
        };

        const agents = {
            agent1: {} as any,
            agent2: {} as any,
        };

        expect(() => validateWorkflow(workflow, agents)).toThrow(/duplicate step id/i);
    });

    it("should throw on missing agent", () => {
        const workflow: WorkflowDefinition = {
            name: "missing-agent",
            steps: [{ id: "step1", agent: "nonexistent" }],
        };

        const agents = {
            agent1: {} as any,
        };

        expect(() => validateWorkflow(workflow, agents)).toThrow(/agent.*not found/i);
    });

    it("should throw on invalid parallel reference", () => {
        const workflow: WorkflowDefinition = {
            name: "invalid-parallel",
            steps: [
                { id: "step1", agent: "agent1", parallel: ["nonexistent"] },
            ],
        };

        const agents = {
            agent1: {} as any,
        };

        expect(() => validateWorkflow(workflow, agents)).toThrow(/parallel step.*not found/i);
    });

    it("should throw on empty steps array", () => {
        const workflow: WorkflowDefinition = {
            name: "empty",
            steps: [],
        };

        const agents = {
            agent1: {} as any,
        };

        expect(() => validateWorkflow(workflow, agents)).toThrow(/must have at least one step/i);
    });

    it("should validate workflow with parallel steps", () => {
        const workflow: WorkflowDefinition = {
            name: "parallel",
            steps: [
                { id: "step1", agent: "agent1", parallel: ["step2", "step3"] },
                { id: "step2", agent: "agent2" },
                { id: "step3", agent: "agent3" },
            ],
        };

        const agents = {
            agent1: {} as any,
            agent2: {} as any,
            agent3: {} as any,
        };

        expect(() => validateWorkflow(workflow, agents)).not.toThrow();
    });

    it("should validate workflow with fallback agent", () => {
        const workflow: WorkflowDefinition = {
            name: "fallback",
            steps: [
                { id: "step1", agent: "agent1", fallbackAgent: "agent2" },
            ],
        };

        const agents = {
            agent1: {} as any,
            agent2: {} as any,
        };

        expect(() => validateWorkflow(workflow, agents)).not.toThrow();
    });

    it("should throw on invalid fallback agent", () => {
        const workflow: WorkflowDefinition = {
            name: "invalid-fallback",
            steps: [
                { id: "step1", agent: "agent1", fallbackAgent: "nonexistent" },
            ],
        };

        const agents = {
            agent1: {} as any,
        };

        expect(() => validateWorkflow(workflow, agents)).toThrow(/fallback agent.*not found/i);
    });
});
