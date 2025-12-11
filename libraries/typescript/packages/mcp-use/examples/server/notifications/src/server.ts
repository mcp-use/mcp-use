/**
 * MCP Server Notification Example
 *
 * This example demonstrates bidirectional notifications:
 *
 * SERVER → CLIENT:
 * 1. notifications/tools/list_changed when tools change
 * 2. custom/* notifications (welcome, heartbeat, broadcast)
 *
 * CLIENT → SERVER:
 * 1. notifications/roots/list_changed when client updates roots
 * 2. roots/list request to get client's current roots
 *
 * The "toggle-mode" tool:
 * - Toggles between "ping" and "pong" mode
 * - Sends notifications/tools/list_changed to all clients
 * - Clients with auto-refresh will automatically re-fetch and see updated description
 *
 * How to test:
 *   pnpm run example:notifications
 *
 * Or manually:
 * 1. Start this server: pnpm run example:server:notification
 * 2. In another terminal: tsx examples/client/notification-client.ts
 * 3. Or open the Inspector at http://localhost:3000/inspector
 */

import { MCPServer } from "../../../../dist/src/server/index.js";

// Track current mode
let currentMode: "ping" | "pong" = "ping";

// We'll dynamically update tool descriptions
const getToolDescription = () =>
  `Returns "${currentMode.toUpperCase()}!" - Current mode: ${currentMode}`;

// Create an MCP server
const server = new MCPServer({
  name: "notification-example",
  version: "1.0.0",
  description: "Example server demonstrating bidirectional notifications",
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Handle client roots changes (CLIENT → SERVER notification)
server.onRootsChanged(async (roots) => {
  console.log(
    `\n[Roots] 📁 Client roots updated! Received ${roots.length} root(s):`
  );
  roots.forEach((root) => {
    console.log(`  - ${root.name || "unnamed"}: ${root.uri}`);
  });
});

// The main ping/pong tool - its behavior changes based on mode
server.tool(
  {
    name: "ping-pong",
    description: "Dynamic tool that responds with current mode (ping or pong)",
    inputs: [],
  },
  async () => {
    return {
      content: [
        {
          type: "text",
          text: `${currentMode.toUpperCase()}! Server has ${server.getActiveSessions().length} active session(s)`,
        },
      ],
    };
  }
);

// Toggle mode and send list_changed notification
server.tool(
  {
    name: "toggle-mode",
    description:
      "Toggle between ping and pong mode, then notify all clients to refresh tools",
    inputs: [],
  },
  async () => {
    const oldMode = currentMode;
    currentMode = currentMode === "ping" ? "pong" : "ping";

    // Send notifications/tools/list_changed to all clients
    // Clients with auto-refresh will re-fetch the tools list
    await server.sendNotification("notifications/tools/list_changed", {});

    console.log(
      `[Toggle] Mode changed from "${oldMode}" to "${currentMode}" - sent tools/list_changed`
    );

    return {
      content: [
        {
          type: "text",
          text:
            `Mode toggled from "${oldMode}" to "${currentMode}"!\n\n` +
            `All ${server.getActiveSessions().length} client(s) received tools/list_changed notification.\n` +
            `The ping-pong tool will now respond with "${currentMode.toUpperCase()}!"`,
        },
      ],
    };
  }
);

// Tool to check current mode
server.tool(
  {
    name: "get-mode",
    description: "Check the current ping/pong mode",
    inputs: [],
  },
  async () => {
    return {
      content: [
        {
          type: "text",
          text: `Current mode: ${currentMode}`,
        },
      ],
    };
  }
);

// Broadcast custom notification
server.tool(
  {
    name: "broadcast",
    description: "Send a custom notification to all connected clients",
    inputs: [
      {
        name: "message",
        type: "string",
        description: "The message to broadcast",
        required: true,
      },
    ],
  },
  async ({ message }: { message: string }) => {
    const sessions = server.getActiveSessions();

    await server.sendNotification("custom/broadcast", {
      message,
      timestamp: new Date().toISOString(),
      totalClients: sessions.length,
    });

    return {
      content: [
        {
          type: "text",
          text: `Broadcast sent to ${sessions.length} client(s): "${message}"`,
        },
      ],
    };
  }
);

// Send welcome notification after 5 seconds
setTimeout(async () => {
  const sessions = server.getActiveSessions();

  console.log(`\n[Demo] Found ${sessions.length} connected client(s)`);

  if (sessions.length === 0) {
    console.log(
      "[Demo] No clients connected. Connect via the Inspector to receive notifications."
    );
    console.log(
      `[Demo] Open http://localhost:${PORT}/inspector in your browser`
    );
    return;
  }

  for (let i = 0; i < sessions.length; i++) {
    const sessionId = sessions[i];
    const clientNumber = i + 1;

    await server.sendNotificationToSession(sessionId, "custom/welcome", {
      message: `Hello client #${clientNumber}! Try "toggle-mode" to see tools/list_changed in action.`,
      clientNumber,
      currentMode,
    });

    console.log(`[Welcome] Sent to client #${clientNumber}`);
  }
}, 5000);

// Periodic heartbeat every 15 seconds
let heartbeatCount = 0;
const periodicInterval = setInterval(async () => {
  const sessions = server.getActiveSessions();

  if (sessions.length > 0) {
    heartbeatCount++;
    await server.sendNotification("custom/heartbeat", {
      count: heartbeatCount,
      connectedClients: sessions.length,
      currentMode,
    });
    console.log(
      `[Heartbeat #${heartbeatCount}] Mode: ${currentMode}, ${sessions.length} client(s)`
    );
  }
}, 15000);

process.on("SIGINT", () => {
  clearInterval(periodicInterval);
  process.exit(0);
});

// Start the server
await server.listen(PORT);

console.log(`
🔔 Notification Example Server running on port ${PORT}

═══════════════════════════════════════════════════════════
📋 Bidirectional Notifications Demo
═══════════════════════════════════════════════════════════

To run the full demo:
   pnpm run example:notifications

Or manually:
   1. Start this server: pnpm run example:server:notification
   2. Run the client: tsx examples/client/notification-client.ts
   3. Or open the Inspector: http://localhost:${PORT}/inspector

📤 SERVER → CLIENT notifications:
   - notifications/tools/list_changed (when mode toggles)
   - custom/welcome (5s after connection)
   - custom/heartbeat (every 15s)
   - custom/broadcast (via broadcast tool)

📥 CLIENT → SERVER notifications:
   - notifications/roots/list_changed (when client updates roots)

📊 Endpoints:
   - MCP: http://localhost:${PORT}/mcp
   - Inspector: http://localhost:${PORT}/inspector

🔧 Tools:
   - ping-pong: Responds with current mode (PING! or PONG!)
   - toggle-mode: Switch mode and notify all clients
   - get-mode: Check current mode
   - broadcast: Send custom message to all clients
`);
