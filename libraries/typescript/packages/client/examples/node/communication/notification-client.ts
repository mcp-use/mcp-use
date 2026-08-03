/**
 * Legacy asynchronous resource notifications and roots/list_changed.
 *
 *   cd ../../_demo-servers && pnpm ours:v1
 *   pnpm exec tsx examples/node/communication/notification-client.ts
 */
import {
  MCPClient,
  type OnNotificationCallback,
  type Root,
} from "@mcp-use/client";

const SERVER_URL = process.env.MCP_SERVER_URL ?? "http://127.0.0.1:3103/mcp";

let resolveUpdated!: () => void;
const resourceUpdated = new Promise<void>((resolve) => {
  resolveUpdated = resolve;
});

const onNotification: OnNotificationCallback = (notification) => {
  console.log("notification:", notification.method);
  if (notification.method === "notifications/resources/updated") {
    resolveUpdated();
  }
};

const client = new MCPClient({
  mcpServers: {
    "mcp-use-v1": {
      url: SERVER_URL,
      roots: [{ uri: "file:///tmp/mcp-use-demo", name: "Demo root" }],
      onNotification,
    },
  },
});

try {
  const connection = await client.connect("mcp-use-v1");

  const roots: Root[] = [
    { uri: "file:///tmp/mcp-use-demo", name: "Demo root" },
    { uri: "file:///tmp/mcp-use-second", name: "Second root" },
  ];
  await connection.setRoots(roots);
  console.log(
    "roots:",
    connection.getRoots().map((root) => root.uri)
  );

  await connection.subscribeToResource("test://subscribable");
  await connection.callTool("update_subscribable_resource", {
    newValue: "updated by notification example",
  });

  await Promise.race([
    resourceUpdated,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Timed out waiting for resource notification")),
        3_000
      )
    ),
  ]);
} finally {
  await client.close();
}
