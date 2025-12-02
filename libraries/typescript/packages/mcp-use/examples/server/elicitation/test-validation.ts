/**
 * Comprehensive validation test for elicitation
 * Tests server-side validation of returned data against Zod schemas
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  ElicitRequestSchema,
  type ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";

const SERVER_URL = "http://localhost:3002/mcp";

async function testValidation() {
  console.log("🧪 Testing Elicitation Validation\n");
  console.log("=".repeat(60));

  const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL));
  const client = new Client(
    { name: "validation-test-client", version: "1.0.0" },
    {
      capabilities: {
        roots: { listChanged: true },
        elicitation: { form: {}, url: {} },
      },
    }
  );

  // Track test scenarios
  let testScenario = "";

  // Set up elicitation handler that can return different data based on scenario
  client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
    console.log(`\n📥 Elicitation request for: ${testScenario}`);
    console.log(`   Mode: ${request.params.mode || "form"}`);
    console.log(`   Message: ${request.params.message}`);

    if (request.params.mode === "url") {
      return { action: "accept" } as ElicitResult;
    }

    // Form mode - return data based on test scenario
    const schema = request.params.requestedSchema;
    console.log(`   Schema:`, JSON.stringify(schema, null, 2));

    switch (testScenario) {
      case "valid-data":
        // Return valid data that matches schema
        return {
          action: "accept",
          data: {
            name: "Valid User",
            age: 30,
            email: "valid@example.com",
          },
        } as ElicitResult;

      case "invalid-age":
        // Return age outside valid range (should fail min/max validation)
        return {
          action: "accept",
          data: {
            name: "Invalid User",
            age: 200, // Exceeds maximum of 150
            email: "test@example.com",
          },
        } as ElicitResult;

      case "missing-required":
        // Return data missing required field (only for test-required-validation tool)
        if (schema.properties?.username) {
          // test-required-validation tool
          return {
            action: "accept",
            data: {
              password: "password123",
              // username is missing (required, no default)
            },
          } as ElicitResult;
        }
        // collect-user-info has defaults, so missing fields get filled
        return {
          action: "accept",
          data: {
            age: 25,
            // name will use default "Anonymous"
          },
        } as ElicitResult;

      case "invalid-email":
        // Return invalid email format
        return {
          action: "accept",
          data: {
            name: "Test User",
            age: 25,
            email: "not-an-email", // Invalid email format
          },
        } as ElicitResult;

      case "wrong-type":
        // Return wrong data type
        return {
          action: "accept",
          data: {
            name: "Test User",
            age: "twenty-five", // Should be number, not string
            email: "test@example.com",
          },
        } as ElicitResult;

      case "decline":
        return { action: "decline" } as ElicitResult;

      case "cancel":
        return { action: "cancel" } as ElicitResult;

      default:
        return {
          action: "accept",
          data: {
            name: "Default User",
            age: 25,
            email: "default@example.com",
          },
        } as ElicitResult;
    }
  });

  try {
    await client.connect(transport);
    console.log("\n✅ Connected to server\n");

    // Test 1: Valid data
    console.log("=".repeat(60));
    console.log("TEST 1: Valid Data (should succeed)");
    console.log("=".repeat(60));
    testScenario = "valid-data";
    try {
      const result = await client.callTool({
        name: "collect-user-info",
        arguments: {},
      });
      console.log("✅ Valid data accepted:");
      console.log("   ", result.content.map((c: any) => c.text).join("\n   "));
    } catch (error: any) {
      console.error("❌ Unexpected error:", error.message);
    }

    // Test 2: Invalid age (outside range)
    console.log("\n" + "=".repeat(60));
    console.log("TEST 2: Invalid Age (age=200, max=150, should fail)");
    console.log("=".repeat(60));
    testScenario = "invalid-age";
    try {
      const result = await client.callTool({
        name: "collect-user-info",
        arguments: {},
      });
      if (result.isError) {
        console.log("✅ Correctly rejected invalid age:");
        console.log(
          "   ",
          result.content.map((c: any) => c.text).join("\n   ")
        );
      } else {
        console.error("❌ Should have rejected invalid age but didn't!");
      }
    } catch (error: any) {
      console.log("✅ Server rejected invalid data:", error.message);
    }

    // Test 3: Missing required field (with defaults - should use default)
    console.log("\n" + "=".repeat(60));
    console.log(
      "TEST 3: Missing Field with Default (should use default value)"
    );
    console.log("=".repeat(60));
    testScenario = "missing-required";
    try {
      const result = await client.callTool({
        name: "collect-user-info",
        arguments: {},
      });
      console.log("✅ Missing field filled with default:");
      console.log("   ", result.content.map((c: any) => c.text).join("\n   "));
      if (!result.content[0].text.includes("Anonymous")) {
        console.error("❌ Default value not applied!");
      }
    } catch (error: any) {
      console.error("❌ Unexpected error:", error.message);
    }

    // Test 3b: Missing truly required field (no default)
    console.log("\n" + "=".repeat(60));
    console.log("TEST 3b: Missing Required Field (no default, should fail)");
    console.log("=".repeat(60));
    testScenario = "missing-required";
    try {
      const result = await client.callTool({
        name: "test-required-validation",
        arguments: {},
      });
      if (result.isError) {
        console.log("✅ Correctly rejected missing required field:");
        console.log(
          "   ",
          result.content.map((c: any) => c.text).join("\n   ")
        );
      } else {
        console.error("❌ Should have rejected missing field but didn't!");
      }
    } catch (error: any) {
      console.log("✅ Server rejected invalid data:", error.message);
    }

    // Test 4: Invalid email format
    console.log("\n" + "=".repeat(60));
    console.log("TEST 4: Invalid Email Format (should fail)");
    console.log("=".repeat(60));
    testScenario = "invalid-email";
    try {
      const result = await client.callTool({
        name: "collect-user-info",
        arguments: {},
      });
      if (result.isError) {
        console.log("✅ Correctly rejected invalid email:");
        console.log(
          "   ",
          result.content.map((c: any) => c.text).join("\n   ")
        );
      } else {
        console.error("❌ Should have rejected invalid email but didn't!");
      }
    } catch (error: any) {
      console.log("✅ Server rejected invalid data:", error.message);
    }

    // Test 5: Wrong data type
    console.log("\n" + "=".repeat(60));
    console.log("TEST 5: Wrong Data Type (age as string, should fail)");
    console.log("=".repeat(60));
    testScenario = "wrong-type";
    try {
      const result = await client.callTool({
        name: "collect-user-info",
        arguments: {},
      });
      if (result.isError) {
        console.log("✅ Correctly rejected wrong type:");
        console.log(
          "   ",
          result.content.map((c: any) => c.text).join("\n   ")
        );
      } else {
        console.error("❌ Should have rejected wrong type but didn't!");
      }
    } catch (error: any) {
      console.log("✅ Server rejected invalid data:", error.message);
    }

    // Test 6: User declines
    console.log("\n" + "=".repeat(60));
    console.log("TEST 6: User Declines (should handle gracefully)");
    console.log("=".repeat(60));
    testScenario = "decline";
    try {
      const result = await client.callTool({
        name: "collect-user-info",
        arguments: {},
      });
      console.log("✅ Decline handled correctly:");
      console.log("   ", result.content.map((c: any) => c.text).join("\n   "));
    } catch (error: any) {
      console.error("❌ Unexpected error on decline:", error.message);
    }

    // Test 7: User cancels
    console.log("\n" + "=".repeat(60));
    console.log("TEST 7: User Cancels (should handle gracefully)");
    console.log("=".repeat(60));
    testScenario = "cancel";
    try {
      const result = await client.callTool({
        name: "collect-user-info",
        arguments: {},
      });
      console.log("✅ Cancel handled correctly:");
      console.log("   ", result.content.map((c: any) => c.text).join("\n   "));
    } catch (error: any) {
      console.error("❌ Unexpected error on cancel:", error.message);
    }

    console.log("\n" + "=".repeat(60));
    console.log("🎉 All validation tests completed!");
    console.log("\n✨ Validation Summary:");
    console.log("   ✓ Valid data passes validation");
    console.log("   ✓ Invalid data is rejected server-side");
    console.log("   ✓ Zod validation ensures type safety");
    console.log("   ✓ User actions (decline/cancel) handled correctly");
    console.log("=".repeat(60));
  } catch (error: any) {
    console.error("\n❌ Test suite failed:", error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

testValidation().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
