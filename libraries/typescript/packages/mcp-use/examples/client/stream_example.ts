/**
 * This example demonstrates how to use the stream method of MCPAgent to get
 * intermediate steps and observe the agent's reasoning process in real-time.
 *
 * The stream method returns an AsyncGenerator that yields AgentStep objects
 * for each intermediate step, and finally returns the complete result.
 *
 * This example also demonstrates the streamEvents method which yields
 * LangChain StreamEvent objects for more granular, token-level streaming.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { config } from "dotenv";
import { MCPAgent, MCPClient } from "../../index.js";

// Load environment variables from .env file
config();

const everythingServer = {
  mcpServers: {
    everything: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
    },
  },
};

async function streamingExample() {
  console.log("🚀 Starting streaming example...\n");

  // Initialize MCP client and agent
  const client = new MCPClient(everythingServer);
  const llm = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    temperature: 0,
  });
  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 10,
    verbose: true,
  });

  const query = `Please help me understand what capabilities you have:
1. List all available tools
2. Try using a few different tools to demonstrate their functionality
3. Show me what resources and prompts are available
4. Create a simple example to showcase your abilities`;

  console.log(`📝 Query: ${query}\n`);
  console.log("🔄 Starting to stream agent steps...\n");

  try {
    // Use the stream method to get intermediate steps
    const stream = agent.stream(query);

    let stepNumber = 1;

    // Iterate through the async generator to get intermediate steps
    for await (const step of stream) {
      console.log(`\n--- Step ${stepNumber} ---`);
      console.log(`🔧 Tool: ${step.action.tool}`);
      console.log(
        `📥 Input: ${JSON.stringify(step.action.toolInput, null, 2)}`
      );
      console.log(`📤 Output: ${step.observation}`);
      console.log("---\n");

      stepNumber++;
    }

    // The final result is the return value when the generator is done
    // Note: In the loop above, we don't get the final result directly
    // To get it, we need to manually handle the generator
  } catch (error) {
    console.error("❌ Error during streaming:", error);
  }

  console.log("\n🎉 Streaming complete!");
}

async function streamingExampleWithFinalResult() {
  console.log(
    "\n\n🚀 Starting streaming example with final result capture...\n"
  );

  // Initialize MCP client and agent
  const client = new MCPClient(everythingServer);
  const llm = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    temperature: 0,
  });
  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 8,
    verbose: false, // Less verbose for cleaner output
  });

  const query = `What tools do you have access to? Please test 2-3 of them to show me what they can do.`;

  console.log(`📝 Query: ${query}\n`);
  console.log("🔄 Processing with intermediate steps...\n");

  try {
    // Create the stream generator
    const stream = agent.stream(query);

    let stepNumber = 1;
    let result: string = "";

    // Manually iterate through the generator to capture both steps and final result
    while (true) {
      const { done, value } = await stream.next();

      if (done) {
        // Generator is complete, value contains the final result
        result = value;
        break;
      } else {
        // value is an AgentStep
        console.log(`\n🔧 Step ${stepNumber}: ${value.action.tool}`);
        console.log(`   Input: ${JSON.stringify(value.action.toolInput)}`);
        console.log(
          `   Result: ${value.observation.slice(0, 100)}${value.observation.length > 100 ? "..." : ""}`
        );

        stepNumber++;
      }
    }

    console.log(`\n${"=".repeat(50)}`);
    console.log("🎯 FINAL RESULT:");
    console.log("=".repeat(50));
    console.log(result);
  } catch (error) {
    console.error("❌ Error during streaming:", error);
  } finally {
    // Clean up
    await client.closeAllSessions();
  }

  console.log("\n✅ Example complete!");
}

async function streamEventsExample() {
  console.log(
    "\n\n🚀 Starting streamEvents example (token-level streaming)...\n"
  );

  // Initialize MCP client and agent
  const client = new MCPClient(everythingServer);
  const llm = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    temperature: 0,
  });
  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 5,
    verbose: false,
  });

  const query = `What's the current time and date? Also create a simple text file with today's date.`;

  console.log(`📝 Query: ${query}\n`);
  console.log("🔄 Streaming fine-grained events...\n");

  try {
    // Use streamEvents for token-level streaming
    const eventStream = agent.streamEvents(query);

    let eventCount = 0;
    let currentToolCall: string | null = null;

    for await (const event of eventStream) {
      eventCount++;

      // Log different types of events
      switch (event.event) {
        case "on_chain_start":
          if (event.name === "AgentExecutor") {
            console.log("🏁 Agent execution started");
          }
          break;

        case "on_tool_start":
          currentToolCall = event.name;
          console.log(`\n🔧 Tool started: ${event.name}`);
          if (event.data?.input) {
            console.log(`   Input: ${JSON.stringify(event.data.input)}`);
          }
          break;

        case "on_tool_end":
          if (event.name === currentToolCall) {
            console.log(`✅ Tool completed: ${event.name}`);
            if (event.data?.output) {
              const output =
                typeof event.data.output === "string"
                  ? event.data.output
                  : JSON.stringify(event.data.output);
              console.log(
                `   Output: ${output.slice(0, 100)}${output.length > 100 ? "..." : ""}`
              );
            }
            currentToolCall = null;
          }
          break;

        case "on_chat_model_stream":
          // This shows token-by-token streaming from the LLM
          if (event.data?.chunk?.text) {
            const textContent = event.data.chunk.text;
            if (typeof textContent === "string" && textContent.length > 0) {
              process.stdout.write(textContent);
            }
          }
          break;

        case "on_chain_end":
          if (event.name === "AgentExecutor") {
            console.log("\n\n🏁 Agent execution completed");
          }
          break;

        // You can handle many more event types:
        // - on_llm_start, on_llm_end
        // - on_parser_start, on_parser_end
        // - on_retriever_start, on_retriever_end
        // - etc.
      }

      // Limit output for demo purposes
      if (eventCount > 200) {
        console.log("\n... (truncated for demo)");
        break;
      }
    }

    console.log(`\n\n📊 Total events emitted: ${eventCount}`);
  } catch (error) {
    console.error("❌ Error during event streaming:", error);
  } finally {
    await client.closeAllSessions();
  }

  console.log("\n✅ StreamEvents example complete!");
}

// Run all examples
async function runAllExamples() {
  await streamingExample();
  await streamingExampleWithFinalResult();
  await streamEventsExample();
}

// Run the examples
runAllExamples().catch(console.error);
