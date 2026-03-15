import { MCPClient } from "mcp-use/client";

async function main() {
  console.log("Connecting to aggregator...");
  const client = new MCPClient({
    mcpServers: {
      aggregator: {
        url: "http://localhost:3000/mcp",
      },
    },
    onSampling: async (params) => {
      console.log(
        "Received sampling request:",
        JSON.stringify(params, null, 2)
      );
      return {
        role: "assistant",
        model: "mock-model",
        content: { type: "text", text: "Mock sampled response from client" },
      };
    },
    onElicitation: async (params) => {
      console.log(
        "Received elicitation request:",
        JSON.stringify(params, null, 2)
      );
      return {
        action: "submit",
        content: { field1: "mock value", form_field: "test" },
      };
    },
  });

  const session = await client.createSession("aggregator");
  console.log("Connected.");

  session.on("notification", (notification) => {
    console.log(
      "Received notification:",
      notification.method,
      notification.params
    );
  });

  console.log("Listing tools...");
  const tools = await session.listTools();
  console.log(
    "Available tools:",
    tools.map((t) => t.name)
  );

  console.log("Calling fastmcp_hello_from_fastmcp...");
  const fastmcpResult = await session.callTool("fastmcp_hello_from_fastmcp", {
    name: "MCP User",
  });
  console.log("FastMCP Result:", fastmcpResult);

  console.log("Calling conformance_test_sampling...");
  try {
    const samplingResult = await session.callTool("conformance_test_sampling", {
      prompt: "Test prompt",
    });
    console.log("Sampling Result:", samplingResult);
  } catch (e) {
    console.error("Sampling error:", e);
  }

  console.log("Calling conformance_test_elicitation...");
  try {
    const elicitationResult = await session.callTool(
      "conformance_test_elicitation",
      { title: "Test Form", description: "Fill this out" }
    );
    console.log("Elicitation Result:", elicitationResult);
  } catch (e) {
    console.error("Elicitation error:", e);
  }

  console.log("Calling conformance_test_tool_with_progress...");
  try {
    const progressResult = await session.callTool(
      "conformance_test_tool_with_progress",
      { steps: 3 }
    );
    console.log("Progress Result:", progressResult);
  } catch (e) {
    console.error("Progress error:", e);
  }

  console.log("Calling manufact_SearchMcpUse...");
  try {
    const manufactResult = await session.callTool("manufact_SearchMcpUse", {
      query: "proxy",
    });
    console.log("Manufact Result:", manufactResult);
  } catch (e) {
    console.error("Manufact error:", e);
  }

  process.exit(0);
}

main().catch(console.error);
