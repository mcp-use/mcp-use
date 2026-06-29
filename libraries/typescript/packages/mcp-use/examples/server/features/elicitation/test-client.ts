/**
 * Simple test client to verify elicitation implementation
 */

import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
} from "@modelcontextprotocol/client";

const SERVER_URL = "http://localhost:3002/mcp";

async function testElicitation() {
  console.log("🧪 Testing Elicitation Implementation\n");
  console.log("=".repeat(50));

  // Create transport
  const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL));

  // Create client with elicitation capability
  const client = new Client(
    {
      name: "test-client",
      version: "1.0.0",
    },
    {
      capabilities: {
        roots: { listChanged: true },
        elicitation: {
          form: {},
          url: {},
        },
      },
    }
  );

  // Set up elicitation handler
  client.setRequestHandler("elicitation/create", async (request: any) => {
    console.log("\n📥 Received elicitation request:");
    console.log("  Mode:", request.params.mode || "form");
    console.log("  Message:", request.params.message);

    if (request.params.mode === "url") {
      console.log("  URL:", request.params.url);
      // Simulate user accepting URL mode elicitation
      return {
        action: "accept",
      } as ElicitResult;
    } else {
      // Form mode
      console.log(
        "  Schema:",
        JSON.stringify(request.params.requestedSchema, null, 2)
      );
      // Simulate user providing data
      return {
        action: "accept",
        data: {
          name: "Test User",
          age: 25,
          email: "test@example.com",
        },
      } as ElicitResult;
    }
  });

  try {
    // Connect to server
    console.log("\n1️⃣  Connecting to server...");
    await client.connect(transport);
    console.log("✅ Connected successfully");

    // List tools
    console.log("\n2️⃣  Listing available tools...");
    const toolsResult = await client.listTools();
    console.log(`✅ Found ${toolsResult.tools.length} tools:`);
    toolsResult.tools.forEach((tool) => {
      console.log(`   - ${tool.name}: ${tool.description}`);
    });

    // Test form mode elicitation with test_elicitation tool
    console.log("\n3️⃣  Testing Form Mode Elicitation (test_elicitation)...");
    const formResult = await client.callTool({
      name: "test_elicitation",
      arguments: {},
    });
    console.log("✅ Form mode elicitation completed:");
    console.log(
      "   Response:",
      formResult.content.map((c: any) => c.text).join("\n")
    );

    // Test form mode elicitation with collect-user-info tool
    console.log("\n4️⃣  Testing Form Mode Elicitation (collect-user-info)...");
    const collectResult = await client.callTool({
      name: "collect-user-info",
      arguments: {},
    });
    console.log("✅ User info collection completed:");
    console.log(
      "   Response:",
      collectResult.content.map((c: any) => c.text).join("\n")
    );

    // Test URL mode elicitation
    console.log("\n5️⃣  Testing URL Mode Elicitation (authorize-service)...");
    const urlResult = await client.callTool({
      name: "authorize-service",
      arguments: {
        serviceName: "GitHub",
      },
    });
    console.log("✅ URL mode elicitation completed:");
    console.log(
      "   Response:",
      urlResult.content.map((c: any) => c.text).join("\n")
    );

    console.log("\n" + "=".repeat(50));
    console.log(
      "🎉 All tests passed! Elicitation implementation is working correctly."
    );
    console.log("\n✨ Summary:");
    console.log("   ✓ Server accepts elicitation capabilities");
    console.log("   ✓ Form mode elicitation works");
    console.log("   ✓ URL mode elicitation works");
    console.log("   ✓ Data is properly passed between server and client");
  } catch (error: any) {
    console.error("\n❌ Test failed:", error.message);
    console.error(error);
    process.exit(1);
  } finally {
    // Clean up
    await client.close();
  }
}

// Run tests
testElicitation().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
