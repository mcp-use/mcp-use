import { ChatOpenAI } from "@langchain/openai";
import { MCPAgent, MCPClient } from "mcp-use";
import { MCPOrchestrator } from "../src/index.js";

/**
 * Research Workflow Example
 *
 * This workflow demonstrates:
 * - Parallel execution of multiple search agents
 * - Result aggregation from different sources
 * - Sequential synthesis step
 */

async function main() {
    console.log("🔍 Research Multi-Agent Workflow\n");

    const llm = new ChatOpenAI({ modelName: "gpt-4o" });

    // Create client
    const client = MCPClient.fromDict({
        mcpServers: {
            filesystem: {
                command: "npx",
                args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            },
        },
    });

    // Agent 1: GitHub Documentation Searcher
    const githubSearcher = new MCPAgent({
        llm,
        client,
        systemPrompt: `You are a GitHub documentation search specialist.
    Search repositories, issues, and documentation for relevant information.
    Return concise, factual summaries with links.`,
    });

    // Agent 2: Academic Paper Searcher
    const academicSearcher = new MCPAgent({
        llm,
        client,
        systemPrompt: `You are an academic research specialist.
    Find relevant research papers, arxiv preprints, and academic sources.
    Return summaries with citations.`,
    });

    // Agent 3: Web Search Agent
    const webSearcher = new MCPAgent({
        llm,
        client,
        systemPrompt: `You are a web search specialist.
    Find relevant blog posts, tutorials, and documentation from the web.
    Return summaries with URLs.`,
    });

    // Agent 4: Synthesis Agent
    const synthesisAgent = new MCPAgent({
        llm,
        client,
        systemPrompt: `You are a research synthesis specialist.
    Combine findings from multiple sources into a coherent report.
    Identify common themes, contradictions, and key insights.`,
    });

    // Create orchestrator with parallel research workflow
    const orchestrator = new MCPOrchestrator({
        agents: {
            github: githubSearcher,
            academic: academicSearcher,
            web: webSearcher,
            synthesizer: synthesisAgent,
        },
        workflow: {
            name: "parallel-research",
            description: "Research topic using multiple sources in parallel",
            steps: [
                {
                    id: "github-search",
                    agent: "github",
                    outputKey: "githubResults",
                    parallel: ["academic-search", "web-search"], // Run these 3 in parallel
                },
                {
                    id: "academic-search",
                    agent: "academic",
                    outputKey: "academicResults",
                },
                {
                    id: "web-search",
                    agent: "web",
                    outputKey: "webResults",
                },
                {
                    id: "synthesize",
                    agent: "synthesizer",
                    input: (ctx) => `
            Synthesize the following research findings into a comprehensive report:
            
            GitHub Results:
            ${ctx.get("githubResults")}
            
            Academic Results:
            ${ctx.get("academicResults")}
            
            Web Results:
            ${ctx.get("webResults")}
          `,
                },
            ],
            onError: "continue", // Continue even if one source fails
        },
        parallelization: true,
        verbose: true,
    });

    // Run research workflow
    const topic = "Multi-agent systems in AI";
    console.log(`📚 Research Topic: ${topic}\n`);

    const result = await orchestrator.run(topic);

    console.log(`\n📊 Research Complete:`);
    console.log(`   Sources searched: ${result.steps.filter((s) => s.success).length}`);
    console.log(`   Total duration: ${result.totalDurationMs}ms`);
    console.log(`\n📄 Final Report:\n`);
    console.log(result.output);
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
