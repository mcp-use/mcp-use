/**
 * Integration tests for MCPOrchestrator
 *
 * Tests the orchestrator with real agents performing workflows
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatOpenAI } from "@langchain/openai";
import { beforeAll, describe, expect, it } from "vitest";
import { MCPAgent } from "../../../src/agents/mcp_agent.js";
import { MCPClient } from "../../../src/client.js";
import { MCPOrchestrator } from "../../../src/orchestrator/orchestrator.js";
import { logger } from "../../../src/logging.js";
import { OPENAI_MODEL } from "./constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("MCPOrchestrator integration tests", () => {
    // Disable telemetry for tests to avoid localStorage issues
    beforeAll(() => {
        process.env.MCP_USE_DISABLE_TELEMETRY = "true";
    });

    it("should execute sequential workflow", async () => {
        const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");

        const client = MCPClient.fromDict({
            mcpServers: {
                simple: {
                    command: "tsx",
                    args: [serverPath],
                },
            },
        });

        const llm = new ChatOpenAI({ model: OPENAI_MODEL, temperature: 0 });

        // Create two agents
        const agent1 = new MCPAgent({
            llm,
            client,
            systemPrompt: "You are a calculator. Use the add tool to perform additions.",
        });

        const agent2 = new MCPAgent({
            llm,
            client,
            systemPrompt: "You are a calculator. Use the multiply tool to perform multiplications.",
        });

        const orchestrator = new MCPOrchestrator({
            agents: {
                adder: agent1,
                multiplier: agent2,
            },
            workflow: {
                name: "sequential-math",
                description: "Add then multiply",
                steps: [
                    {
                        id: "add",
                        agent: "adder",
                        input: "Add 10 and 20",
                        outputKey: "sum",
                    },
                    {
                        id: "multiply",
                        agent: "multiplier",
                        input: (ctx) => `Multiply ${ctx.get("sum")} by 2`,
                        outputKey: "result",
                    },
                ],
            },
            verbose: true,
        });

        try {
            logger.info("\n" + "=".repeat(80));
            logger.info("TEST: Sequential Workflow");
            logger.info("=".repeat(80));

            const result = await orchestrator.run("Start the calculation");

            logger.info(`Result: ${JSON.stringify(result, null, 2)}`);
            logger.info("=".repeat(80) + "\n");

            expect(result.success).toBe(true);
            expect(result.steps.length).toBe(2);
            expect(result.steps[0].stepId).toBe("add");
            expect(result.steps[1].stepId).toBe("multiply");
            expect(result.context.sum).toBeDefined();
            expect(result.context.result).toBeDefined();
        } finally {
            await agent1.close();
            await agent2.close();
        }
    }, 90000);

    it("should execute parallel workflow", async () => {
        const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");

        const client = MCPClient.fromDict({
            mcpServers: {
                simple: {
                    command: "tsx",
                    args: [serverPath],
                },
            },
        });

        const llm = new ChatOpenAI({ model: OPENAI_MODEL, temperature: 0 });

        const agent1 = new MCPAgent({
            llm,
            client,
            systemPrompt: "You are a calculator. Use the add tool.",
        });

        const agent2 = new MCPAgent({
            llm,
            client,
            systemPrompt: "You are a calculator. Use the multiply tool.",
        });

        const orchestrator = new MCPOrchestrator({
            agents: {
                adder: agent1,
                multiplier: agent2,
            },
            workflow: {
                name: "parallel-math",
                description: "Add and multiply in parallel",
                steps: [
                    {
                        id: "add",
                        agent: "adder",
                        input: "Add 5 and 10",
                        outputKey: "sum",
                        parallel: ["multiply"],
                    },
                    {
                        id: "multiply",
                        agent: "multiplier",
                        input: "Multiply 3 by 4",
                        outputKey: "product",
                    },
                ],
            },
            parallelization: true,
            verbose: true,
        });

        try {
            logger.info("\n" + "=".repeat(80));
            logger.info("TEST: Parallel Workflow");
            logger.info("=".repeat(80));

            const result = await orchestrator.run("Start the calculation");

            logger.info(`Result: ${JSON.stringify(result, null, 2)}`);
            logger.info("=".repeat(80) + "\n");

            expect(result.success).toBe(true);
            expect(result.steps.length).toBe(2);
            expect(result.context.sum).toBeDefined();
            expect(result.context.product).toBeDefined();
        } finally {
            await agent1.close();
            await agent2.close();
        }
    }, 90000);

    it("should handle conditional steps", async () => {
        const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");

        const client = MCPClient.fromDict({
            mcpServers: {
                simple: {
                    command: "tsx",
                    args: [serverPath],
                },
            },
        });

        const llm = new ChatOpenAI({ model: OPENAI_MODEL, temperature: 0 });

        const classifierAgent = new MCPAgent({
            llm,
            client,
            systemPrompt: "Respond with ONLY the word 'add' or 'multiply', nothing else.",
        });

        const adderAgent = new MCPAgent({
            llm,
            client,
            systemPrompt: "Use the add tool to perform additions.",
        });

        const multiplierAgent = new MCPAgent({
            llm,
            client,
            systemPrompt: "Use the multiply tool to perform multiplications.",
        });

        const orchestrator = new MCPOrchestrator({
            agents: {
                classifier: classifierAgent,
                adder: adderAgent,
                multiplier: multiplierAgent,
            },
            workflow: {
                name: "conditional-math",
                description: "Route based on classification",
                steps: [
                    {
                        id: "classify",
                        agent: "classifier",
                        input: "Should we add or multiply?",
                        outputKey: "operation",
                    },
                    {
                        id: "add",
                        agent: "adder",
                        input: "Add 10 and 20",
                        condition: (ctx) => ctx.get("operation")?.toLowerCase().includes("add"),
                    },
                    {
                        id: "multiply",
                        agent: "multiplier",
                        input: "Multiply 5 by 6",
                        condition: (ctx) => ctx.get("operation")?.toLowerCase().includes("multiply"),
                    },
                ],
            },
            verbose: true,
        });

        try {
            logger.info("\n" + "=".repeat(80));
            logger.info("TEST: Conditional Workflow");
            logger.info("=".repeat(80));

            const result = await orchestrator.run("Start");

            logger.info(`Result: ${JSON.stringify(result, null, 2)}`);
            logger.info("=".repeat(80) + "\n");

            expect(result.success).toBe(true);
            expect(result.steps.length).toBeGreaterThanOrEqual(2); // Classifier + one operation
            expect(result.context.operation).toBeDefined();
        } finally {
            await classifierAgent.close();
            await adderAgent.close();
            await multiplierAgent.close();
        }
    }, 90000);

    it("should pass context between steps", async () => {
        const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");

        const client = MCPClient.fromDict({
            mcpServers: {
                simple: {
                    command: "tsx",
                    args: [serverPath],
                },
            },
        });

        const llm = new ChatOpenAI({ model: OPENAI_MODEL, temperature: 0 });

        const agent = new MCPAgent({
            llm,
            client,
            systemPrompt: "Use the add tool to perform additions.",
        });

        const orchestrator = new MCPOrchestrator({
            agents: {
                calculator: agent,
            },
            workflow: {
                name: "context-passing",
                description: "Pass results through context",
                steps: [
                    {
                        id: "step1",
                        agent: "calculator",
                        input: "Add 5 and 10",
                        outputKey: "result1",
                    },
                    {
                        id: "step2",
                        agent: "calculator",
                        input: (ctx) => {
                            const prev = ctx.get("result1");
                            return `The previous result was: ${prev}. Now add 3 and 7.`;
                        },
                        outputKey: "result2",
                    },
                ],
            },
            verbose: true,
        });

        try {
            logger.info("\n" + "=".repeat(80));
            logger.info("TEST: Context Passing");
            logger.info("=".repeat(80));

            const result = await orchestrator.run("Start");

            logger.info(`Result: ${JSON.stringify(result, null, 2)}`);
            logger.info("=".repeat(80) + "\n");

            expect(result.success).toBe(true);
            expect(result.steps.length).toBe(2);
            expect(result.context.result1).toBeDefined();
            expect(result.context.result2).toBeDefined();
            // Step 2 should have received result from step 1
            expect(result.steps[1].input).toContain("previous");
        } finally {
            await agent.close();
        }
    }, 90000);

    it("should handle errors with continue strategy", async () => {
        const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");

        const client = MCPClient.fromDict({
            mcpServers: {
                simple: {
                    command: "tsx",
                    args: [serverPath],
                },
            },
        });

        const llm = new ChatOpenAI({ model: OPENAI_MODEL, temperature: 0 });

        const goodAgent = new MCPAgent({
            llm,
            client,
            systemPrompt: "Use the add tool to perform additions.",
        });

        const badAgent = new MCPAgent({
            llm,
            client,
            systemPrompt: "Always say 'I cannot help with that' and refuse to use tools.",
            maxSteps: 1, // Limit steps so it fails quickly
        });

        const orchestrator = new MCPOrchestrator({
            agents: {
                good: goodAgent,
                bad: badAgent,
            },
            workflow: {
                name: "error-continue",
                description: "Continue despite errors",
                steps: [
                    {
                        id: "good-step",
                        agent: "good",
                        input: "Add 1 and 2",
                        outputKey: "result1",
                    },
                    {
                        id: "bad-step",
                        agent: "bad",
                        input: "This will likely fail",
                        outputKey: "result2",
                    },
                    {
                        id: "recovery-step",
                        agent: "good",
                        input: "Add 3 and 4",
                        outputKey: "result3",
                    },
                ],
                onError: "continue", // Continue even if steps fail
            },
            verbose: true,
        });

        try {
            logger.info("\n" + "=".repeat(80));
            logger.info("TEST: Error Continue Strategy");
            logger.info("=".repeat(80));

            const result = await orchestrator.run("Start");

            logger.info(`Result: ${JSON.stringify(result, null, 2)}`);
            logger.info("=".repeat(80) + "\n");

            // Workflow should complete even if one step fails
            expect(result.steps.length).toBe(3);
            expect(result.context.result1).toBeDefined();
            expect(result.context.result3).toBeDefined();
        } finally {
            await goodAgent.close();
            await badAgent.close();
        }
    }, 90000);

    it("should stop on error with stop strategy", async () => {
        const serverPath = path.resolve(__dirname, "../../servers/simple_server.ts");

        const client = MCPClient.fromDict({
            mcpServers: {
                simple: {
                    command: "tsx",
                    args: [serverPath],
                },
            },
        });

        const llm = new ChatOpenAI({ model: OPENAI_MODEL, temperature: 0 });

        const goodAgent = new MCPAgent({
            llm,
            client,
            systemPrompt: "Use the add tool.",
        });

        const badAgent = new MCPAgent({
            llm,
            client,
            systemPrompt: "Always refuse to use tools.",
            maxSteps: 1,
        });

        const orchestrator = new MCPOrchestrator({
            agents: {
                good: goodAgent,
                bad: badAgent,
            },
            workflow: {
                name: "error-stop",
                description: "Stop on errors",
                steps: [
                    {
                        id: "good-step",
                        agent: "good",
                        input: "Add 1 and 2",
                    },
                    {
                        id: "bad-step",
                        agent: "bad",
                        input: "This will fail",
                    },
                    {
                        id: "should-not-run",
                        agent: "good",
                        input: "This should not execute",
                    },
                ],
                onError: "stop",
            },
            errorRecovery: "skip", // Don't retry
            verbose: true,
        });

        try {
            logger.info("\n" + "=".repeat(80));
            logger.info("TEST: Error Stop Strategy");
            logger.info("=".repeat(80));

            const result = await orchestrator.run("Start");

            logger.info(`Result: ${JSON.stringify(result, null, 2)}`);
            logger.info("=".repeat(80) + "\n");

            // Should fail and not execute all steps
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        } finally {
            await goodAgent.close();
            await badAgent.close();
        }
    }, 90000);
});
