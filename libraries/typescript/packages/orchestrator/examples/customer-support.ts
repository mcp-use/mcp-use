import { ChatOpenAI } from "@langchain/openai";
import { MCPAgent, MCPClient } from "mcp-use";
import { MCPOrchestrator } from "@mcp-use/orchestrator";

/**
 * Customer Support Workflow Example
 *
 * This workflow demonstrates:
 * - Conditional routing based on ticket classification
 * - Specialized agents for different ticket types
 * - Sequential execution with data passing
 */

async function main() {
    console.log("🎧 Customer Support Multi-Agent Workflow\n");

    // Create MCP client (shared across agents)
    const client = MCPClient.fromDict({
        mcpServers: {
            zendesk: {
                command: "npx",
                args: ["-y", "@mcp-use/server-zendesk"],
            },
            notion: {
                command: "npx",
                args: ["-y", "@mcp-use/server-notion"],
            },
        },
    });

    const llm = new ChatOpenAI({ modelName: "gpt-4o-mini" });

    // Agent 1: Ticket Classifier
    const classifierAgent = new MCPAgent({
        llm,
        client,
        systemPrompt: `You are a ticket classifier. Analyze support tickets and classify them as:
    - "bug" - Software defects
    - "question" - How-to questions
    - "billing" - Payment/subscription issues
    
    Return ONLY the classification word, nothing else.`,
    });

    // Agent 2: Bug Handler (specialist)
    const bugAgent = new MCPAgent({
        llm,
        client,
        systemPrompt: `You are a technical support specialist for software bugs.
    Search the knowledge base for solutions, provide debugging steps, and escalate if needed.`,
    });

    // Agent 3: Question Handler (specialist)
    const questionAgent = new MCPAgent({
        llm,
        client,
        systemPrompt: `You are a helpful support agent for product questions.
    Search documentation and provide clear, step-by-step answers.`,
    });

    // Agent 4: Billing Handler (specialist)
    const billingAgent = new MCPAgent({
        llm,
        client,
        systemPrompt: `You are a billing support specialist.
    Handle payment issues, subscription questions, and refund requests professionally.`,
    });

    // Create orchestrator with multi-agent workflow
    const orchestrator = new MCPOrchestrator({
        agents: {
            classifier: classifierAgent,
            bugHandler: bugAgent,
            questionHandler: questionAgent,
            billingHandler: billingAgent,
        },
        workflow: {
            name: "customer-support",
            description: "Route and handle customer support tickets",
            steps: [
                {
                    id: "classify",
                    agent: "classifier",
                    outputKey: "ticketType",
                },
                {
                    id: "handle-bug",
                    agent: "bugHandler",
                    condition: (ctx) => ctx.get("ticketType")?.toLowerCase().includes("bug"),
                },
                {
                    id: "handle-question",
                    agent: "questionHandler",
                    condition: (ctx) => ctx.get("ticketType")?.toLowerCase().includes("question"),
                },
                {
                    id: "handle-billing",
                    agent: "billingHandler",
                    condition: (ctx) => ctx.get("ticketType")?.toLowerCase().includes("billing"),
                },
            ],
            onError: "stop",
        },
        verbose: true,
    });

    // Test with different ticket types
    const tickets = [
        "My login button isn't working on Chrome. I keep getting a 500 error.",
        "How do I export my data as a CSV file?",
        "I was charged $99 but my plan should only be $49. Please help!",
    ];

    for (const ticket of tickets) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`📋 Ticket: ${ticket}\n`);

        const result = await orchestrator.run(ticket);

        console.log(`\n📊 Result:`);
        console.log(`   Success: ${result.success}`);
        console.log(`   Steps executed: ${result.steps.length}`);
        console.log(`   Duration: ${result.totalDurationMs}ms`);
        console.log(`\n💬 Response:\n${result.output}\n`);
    }
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
