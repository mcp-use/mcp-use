/**
 * Client Capability Matrix Test
 *
 * Tests all MCP features with different client capability combinations to ensure
 * the server handles various client types correctly.
 *
 * Run with:
 *   npx tsx tests/scale/capability-matrix.ts
 */

import { MCPClient } from "../../src/client.js";
import { createTestServer } from "./test-server.js";

interface CapabilityProfile {
  name: string;
  capabilities: Record<string, any>;
  expectedSupport: {
    tools: boolean;
    resources: boolean;
    prompts: boolean;
    sampling: boolean;
    elicitation: boolean;
    notifications: boolean;
  };
}

const capabilityProfiles: CapabilityProfile[] = [
  {
    name: "Minimal Client",
    capabilities: {},
    expectedSupport: {
      tools: true,
      resources: true,
      prompts: true,
      sampling: false,
      elicitation: false,
      notifications: true,
    },
  },
  {
    name: "Sampling-Only Client",
    capabilities: {
      sampling: { tools: true },
    },
    expectedSupport: {
      tools: true,
      resources: true,
      prompts: true,
      sampling: true,
      elicitation: false,
      notifications: true,
    },
  },
  {
    name: "Elicitation-Only Client",
    capabilities: {
      elicitation: { url: true },
    },
    expectedSupport: {
      tools: true,
      resources: true,
      prompts: true,
      sampling: false,
      elicitation: true,
      notifications: true,
    },
  },
  {
    name: "Full-Featured Client",
    capabilities: {
      sampling: { tools: true, context: true },
      elicitation: { url: true, form: true },
      roots: { listChanged: true },
    },
    expectedSupport: {
      tools: true,
      resources: true,
      prompts: true,
      sampling: true,
      elicitation: true,
      notifications: true,
    },
  },
];

async function testCapabilityProfile(
  profile: CapabilityProfile,
  serverPort: number
): Promise<{ profile: string; results: Record<string, any> }> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${profile.name}`);
  console.log(`Capabilities:`, JSON.stringify(profile.capabilities, null, 2));
  console.log(`${"=".repeat(60)}\n`);

  const results: Record<string, any> = {};

  // Create client with specific capabilities
  const client = new MCPClient({
    mcpServers: {
      "test-server": {
        url: `http://localhost:${serverPort}/mcp`,
        transport: "http",
      },
    },
    clientInfo: {
      name: profile.name.toLowerCase().replace(/\s+/g, "-"),
      version: "1.0.0",
    },
    clientCapabilities: profile.capabilities,
  });

  await client.createSession("test-server");
  const session = client.getSession("test-server");

  // Test 1: Basic tools (should always work)
  console.log("[Test] Basic tool calls...");
  try {
    const echoResult = await session.callTool("fast-echo", { message: "test" });
    results.basicTools = {
      success: true,
      result: echoResult,
    };
    console.log("  ✅ Basic tools: PASS");
  } catch (error: any) {
    results.basicTools = {
      success: false,
      error: error.message,
    };
    console.log(`  ❌ Basic tools: FAIL - ${error.message}`);
  }

  // Test 2: CPU-intensive tools
  console.log("[Test] CPU-intensive tools...");
  try {
    const compResult = await session.callTool("slow-computation", {
      iterations: 1000,
    });
    results.cpuTools = {
      success: true,
      result: compResult,
    };
    console.log("  ✅ CPU-intensive tools: PASS");
  } catch (error: any) {
    results.cpuTools = {
      success: false,
      error: error.message,
    };
    console.log(`  ❌ CPU-intensive tools: FAIL - ${error.message}`);
  }

  // Test 3: Resources (should always work)
  console.log("[Test] Resource reads...");
  try {
    const resource = await session.readResource("app://static-data");
    results.resources = {
      success: true,
      result: resource,
    };
    console.log("  ✅ Resources: PASS");
  } catch (error: any) {
    results.resources = {
      success: false,
      error: error.message,
    };
    console.log(`  ❌ Resources: FAIL - ${error.message}`);
  }

  // Test 4: Prompts (should always work)
  console.log("[Test] Prompts...");
  try {
    const prompt = await session.getPrompt("greeting", { name: "Tester" });
    results.prompts = {
      success: true,
      result: prompt,
    };
    console.log("  ✅ Prompts: PASS");
  } catch (error: any) {
    results.prompts = {
      success: false,
      error: error.message,
    };
    console.log(`  ❌ Prompts: FAIL - ${error.message}`);
  }

  // Test 5: Sampling (should work only if client supports it)
  console.log("[Test] Sampling capability...");
  try {
    const samplingResult = await session.callTool("request-sampling", {
      prompt: "Say hello",
      maxTokens: 10,
    });

    results.sampling = {
      success: true,
      supported: profile.expectedSupport.sampling,
      result: samplingResult,
    };

    if (profile.expectedSupport.sampling) {
      console.log("  ✅ Sampling: PASS (feature used successfully)");
    } else {
      console.log(
        "  ⚠️  Sampling: Server handled gracefully despite no client support"
      );
    }
  } catch (error: any) {
    results.sampling = {
      success: false,
      supported: profile.expectedSupport.sampling,
      error: error.message,
    };

    if (
      !profile.expectedSupport.sampling &&
      error.message.includes("does not support sampling")
    ) {
      console.log("  ✅ Sampling: PASS (gracefully declined as expected)");
    } else {
      console.log(`  ❌ Sampling: FAIL - ${error.message}`);
    }
  }

  // Test 6: Elicitation (should work only if client supports it)
  console.log("[Test] Elicitation capability...");
  try {
    const elicitResult = await session.callTool("request-input", {
      question: "Test question",
      mode: "url",
    });

    results.elicitation = {
      success: true,
      supported: profile.expectedSupport.elicitation,
      result: elicitResult,
    };

    if (profile.expectedSupport.elicitation) {
      console.log("  ✅ Elicitation: PASS (feature used successfully)");
    } else {
      console.log(
        "  ⚠️  Elicitation: Server handled gracefully despite no client support"
      );
    }
  } catch (error: any) {
    results.elicitation = {
      success: false,
      supported: profile.expectedSupport.elicitation,
      error: error.message,
    };

    if (
      !profile.expectedSupport.elicitation &&
      error.message.includes("does not support elicitation")
    ) {
      console.log("  ✅ Elicitation: PASS (gracefully declined as expected)");
    } else {
      console.log(`  ❌ Elicitation: FAIL - ${error.message}`);
    }
  }

  // Test 7: Notifications (should always work)
  console.log("[Test] Notifications...");
  const receivedNotifications: any[] = [];

  session.on("notification", (notif) => {
    receivedNotifications.push(notif);
  });

  // Trigger a notification
  try {
    await session.callTool("trigger-notification", {
      type: "custom",
      message: "Test",
    });

    // Wait for notification delivery
    await new Promise((resolve) => setTimeout(resolve, 500));

    results.notifications = {
      success: receivedNotifications.length > 0,
      received: receivedNotifications.length,
    };

    if (receivedNotifications.length > 0) {
      console.log(
        `  ✅ Notifications: PASS (received ${receivedNotifications.length})`
      );
    } else {
      console.log(
        "  ⚠️  Notifications: No notifications received (might be timing issue)"
      );
    }
  } catch (error: any) {
    results.notifications = {
      success: false,
      error: error.message,
    };
    console.log(`  ❌ Notifications: FAIL - ${error.message}`);
  }

  // Cleanup
  await client.closeAllSessions();

  return { profile: profile.name, results };
}

async function runCapabilityMatrixTest() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║         Client Capability Matrix Test                     ║
╠═══════════════════════════════════════════════════════════╣
║  Testing ${capabilityProfiles.length} different client capability profiles             ║
║  Each profile tests all MCP features                      ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Start test server
  const port = 3000;
  const redisUrl = process.env.REDIS_URL;

  console.log(`[Capability Matrix] Starting test server on port ${port}...`);
  const _server = await createTestServer(port, redisUrl);

  // Test each profile
  const allResults = [];

  for (const profile of capabilityProfiles) {
    const result = await testCapabilityProfile(profile, port);
    allResults.push(result);
  }

  // Generate summary report
  console.log(`\n\n${"=".repeat(60)}`);
  console.log("CAPABILITY MATRIX TEST SUMMARY");
  console.log(`${"=".repeat(60)}\n`);

  const summaryTable: any[] = [];

  for (const { profile, results } of allResults) {
    summaryTable.push({
      Profile: profile,
      Tools: results.basicTools?.success ? "✅" : "❌",
      Resources: results.resources?.success ? "✅" : "❌",
      Prompts: results.prompts?.success ? "✅" : "❌",
      Sampling: results.sampling?.success
        ? "✅"
        : results.sampling?.supported === false
          ? "⊘"
          : "❌",
      Elicitation: results.elicitation?.success
        ? "✅"
        : results.elicitation?.supported === false
          ? "⊘"
          : "❌",
      Notifications: results.notifications?.success ? "✅" : "⚠️",
    });
  }

  console.table(summaryTable);

  console.log("\nLegend:");
  console.log("  ✅ = Feature works correctly");
  console.log("  ❌ = Feature failed unexpectedly");
  console.log("  ⊘ = Feature not supported by client (expected)");
  console.log("  ⚠️  = Feature partially working or timing issue\n");

  // Determine overall pass/fail
  const allPassed = allResults.every(({ results }) => {
    return (
      results.basicTools?.success &&
      results.resources?.success &&
      results.prompts?.success
    );
    // Don't require sampling/elicitation as they depend on capabilities
  });

  if (allPassed) {
    console.log(
      "✅ Capability matrix test PASSED - All core features work across all client types\n"
    );
    return true;
  } else {
    console.log(
      "❌ Capability matrix test FAILED - Some core features not working\n"
    );
    return false;
  }
}

// Main execution
async function main() {
  try {
    const passed = await runCapabilityMatrixTest();
    process.exit(passed ? 0 : 1);
  } catch (error) {
    console.error("Capability matrix test failed:", error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { runCapabilityMatrixTest, capabilityProfiles };
