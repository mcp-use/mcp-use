/**
 * MCP Client Notification Example (Node)
 *
 * Demonstrates bidirectional notifications:
 *
 * 1. **Server → Client**: Receives notifications from the server:
 *    - notifications/tools/list_changed (auto-handled + logged)
 *    - notifications/resources/list_changed (auto-handled + logged)
 *    - notifications/prompts/list_changed (auto-handled + logged)
 *    - custom/* notifications (logged)
 *
 * 2. **Client → Server**: Sends notifications to the server:
 *    - notifications/roots/list_changed (via session.setRoots())
 *
 * Run:
 *   pnpm run example:client:notification
 *   pnpm run example:notifications   (starts server then client)
 *
 * Manually:
 *   1. Start the notification server: pnpm run example:server:notification
 *   2. Run this client: tsx examples/client/node/communication/notification-client.ts
 */

import {
  HttpConnector,
  MCPSession,
  type Notification,
  type Root,
} from "@mcp-use/client";

const SERVER_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3000/mcp";

async function main() {
  console.log("🔔 MCP Notification Client Example");
  console.log("═".repeat(50));
  console.log();

  const initialRoots: Root[] = [
    { uri: "file:///home/user/projects", name: "Projects" },
  ];

  console.log("[Setup] Creating HTTP connector...");
  const connector = new HttpConnector(SERVER_URL, {
    clientInfo: { name: "notification-client", version: "1.0.0" },
    roots: initialRoots,
  });

  const session = new MCPSession(connector, false);

  session.on("notification", async (notification: Notification) => {
    const timestamp = new Date().toISOString().split("T")[1].split(".")[0];

    switch (notification.method) {
      case "notifications/tools/list_changed":
        console.log(`\n[${timestamp}] ⚡ NOTIFICATION: tools/list_changed`);
        console.log("  → Tools cache will be auto-refreshed");
        setTimeout(() => {
          try {
            const tools = session.tools;
            console.log(`  ✓ Tools refreshed: ${tools.length} tool(s)`);
            tools.forEach((t) => console.log(`    - ${t.name}`));
          } catch {
            console.log("  (tools not yet initialized)");
          }
        }, 100);
        break;

      case "notifications/resources/list_changed":
        console.log(`\n[${timestamp}] 📁 NOTIFICATION: resources/list_changed`);
        console.log("  → Resources list has changed on the server");
        break;

      case "notifications/prompts/list_changed":
        console.log(`\n[${timestamp}] 💬 NOTIFICATION: prompts/list_changed`);
        console.log("  → Prompts list has changed on the server");
        break;

      case "custom/welcome":
        console.log(`\n[${timestamp}] 👋 NOTIFICATION: custom/welcome`);
        console.log(
          `  → ${(notification.params as any)?.message || "Welcome!"}`
        );
        break;

      case "custom/heartbeat": {
        const hb = notification.params as any;
        console.log(
          `\n[${timestamp}] 💓 NOTIFICATION: custom/heartbeat #${hb?.count}`
        );
        console.log(
          `  → Mode: ${hb?.currentMode}, Clients: ${hb?.connectedClients}`
        );
        break;
      }

      case "custom/broadcast": {
        const bc = notification.params as any;
        console.log(`\n[${timestamp}] 📢 NOTIFICATION: custom/broadcast`);
        console.log(`  → Message: "${bc?.message}"`);
        break;
      }

      default:
        console.log(`\n[${timestamp}] 📨 NOTIFICATION: ${notification.method}`);
        console.log(`  → Params:`, notification.params);
    }
  });

  console.log(`[Connect] Connecting to ${SERVER_URL}...`);
  try {
    await session.connect();
    console.log("[Connect] ✓ Connected successfully!\n");
  } catch (error) {
    console.error("[Connect] ✗ Failed to connect:", error);
    console.log("\nMake sure the notification server is running:");
    console.log("  pnpm run example:server:notification\n");
    process.exit(1);
  }

  console.log("[Init] Initializing session...");
  await session.initialize();

  const serverInfo = session.serverInfo;
  console.log(`[Init] ✓ Server: ${serverInfo?.name} v${serverInfo?.version}`);

  const tools = session.tools;
  console.log(`[Init] ✓ Initial tools: ${tools.length}`);
  tools.forEach((t) => console.log(`  - ${t.name}: ${t.description}`));

  const roots = session.getRoots();
  console.log(`[Init] ✓ Initial roots: ${roots.length}`);
  roots.forEach((r) => console.log(`  - ${r.name || "unnamed"}: ${r.uri}`));

  console.log("\n" + "═".repeat(50));
  console.log("📋 Demonstration Flow");
  console.log("═".repeat(50));

  console.log("\n[Demo] Waiting for server welcome notification...");
  await sleep(6000);

  console.log("\n[Demo] 📤 CLIENT → SERVER: Setting new roots...");
  const newRoots: Root[] = [
    { uri: "file:///home/user/projects", name: "Projects" },
    { uri: "file:///home/user/documents", name: "Documents" },
    { uri: "file:///tmp/workspace", name: "Temp Workspace" },
  ];
  await session.setRoots(newRoots);
  console.log(
    `[Demo] ✓ Sent roots/list_changed notification with ${newRoots.length} roots`
  );
  newRoots.forEach((r) => console.log(`  - ${r.name}: ${r.uri}`));

  await sleep(2000);

  console.log(
    "\n[Demo] 🔧 Calling 'toggle-mode' tool (triggers tools/list_changed)..."
  );
  try {
    const result = await session.callTool("toggle-mode", {});
    const text = (result.content[0] as any)?.text || "No response";
    console.log(`[Demo] ✓ Response: ${text.split("\n")[0]}`);
  } catch (error) {
    console.error("[Demo] ✗ Tool call failed:", error);
  }

  await sleep(1000);

  console.log("\n[Demo] 🏓 Calling 'ping-pong' tool to verify mode change...");
  try {
    const result = await session.callTool("ping-pong", {});
    const text = (result.content[0] as any)?.text || "No response";
    console.log(`[Demo] ✓ Response: ${text}`);
  } catch (error) {
    console.error("[Demo] ✗ Tool call failed:", error);
  }

  console.log("\n" + "═".repeat(50));
  console.log("🔄 Listening for notifications (Ctrl+C to exit)");
  console.log("═".repeat(50));
  console.log("\nThe server sends heartbeat notifications every 15 seconds.");
  console.log(
    "You can also use the Inspector to trigger more notifications.\n"
  );

  process.on("SIGINT", async () => {
    console.log("\n[Shutdown] Disconnecting...");
    await session.disconnect();
    console.log("[Shutdown] Goodbye!");
    process.exit(0);
  });

  await new Promise(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(console.error);
