/**
 * Notification Stress Test
 *
 * Tests notification delivery to many concurrent SSE clients.
 * Verifies that Redis Pub/Sub can handle high notification throughput.
 *
 * Run with:
 *   REDIS_URL=redis://... npx tsx tests/scale/notification-stress.ts --clients=1000
 */

import { MCPClient } from "../../src/client.js";
import { createTestServer } from "./test-server.js";

interface NotificationStressConfig {
  clients: number; // Number of SSE clients
  notificationsPerBatch: number; // Notifications to send in each batch
  batchCount: number; // Number of batches
  batchDelayMs: number; // Delay between batches
  redisUrl?: string;
}

async function notificationStressTest(config: NotificationStressConfig) {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║        Notification Stress Test Starting                  ║
╠═══════════════════════════════════════════════════════════╣
║  SSE Clients: ${config.clients}                                        ║
║  Notifications per batch: ${config.notificationsPerBatch}                          ║
║  Total batches: ${config.batchCount}                                      ║
║  Total notifications: ${config.notificationsPerBatch * config.batchCount}                                 ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Start test server
  const port = 3000;
  console.log(`[Notification Stress] Starting test server on port ${port}...`);
  const server = await createTestServer(port, config.redisUrl);

  // Track notifications received by each client
  const clientNotifications = new Map<string, any[]>();
  const clientLatencies = new Map<string, number[]>();

  // Create SSE clients
  console.log(
    `[Notification Stress] Creating ${config.clients} SSE clients...`
  );
  const clients = await Promise.all(
    Array.from({ length: config.clients }, async (_, i) => {
      const client = new MCPClient({
        mcpServers: {
          [`test-${i}`]: {
            url: `http://localhost:${port}/mcp`,
            transport: "http", // Will use SSE for notifications
          },
        },
        clientInfo: {
          name: `notification-client-${i}`,
          version: "1.0.0",
        },
      });

      const session = await client.createSession(`test-${i}`);

      // Track notifications
      const notifications: any[] = [];
      clientNotifications.set(`test-${i}`, notifications);
      clientLatencies.set(`test-${i}`, []);

      // Set up notification handler
      session.on("notification", (notification) => {
        const now = Date.now();
        notifications.push(notification);

        // Calculate latency if notification has timestamp
        if (notification.params?.timestamp) {
          const latency = now - notification.params.timestamp;
          clientLatencies.get(`test-${i}`)!.push(latency);
        }
      });

      return { client, serverName: `test-${i}`, session };
    })
  );

  console.log(`[Notification Stress] ✅ ${clients.length} clients connected\n`);

  // Wait for all SSE connections to stabilize
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Send notifications in batches
  console.log("[Notification Stress] Sending notifications...\n");

  const batchResults: any[] = [];

  for (let batch = 0; batch < config.batchCount; batch++) {
    const batchStart = Date.now();

    console.log(
      `[Batch ${batch + 1}/${config.batchCount}] Sending ${config.notificationsPerBatch} notifications...`
    );

    // Send notifications rapidly
    for (let i = 0; i < config.notificationsPerBatch; i++) {
      await server.sendNotification("custom/stress-test", {
        batchId: batch,
        notificationId: i,
        timestamp: Date.now(),
        message: `Stress test notification ${batch}-${i}`,
      });
    }

    const sendDuration = Date.now() - batchStart;
    console.log(`[Batch ${batch + 1}] Sent in ${sendDuration}ms`);

    // Wait for delivery
    await new Promise((resolve) => setTimeout(resolve, config.batchDelayMs));

    // Check delivery status
    let totalReceived = 0;
    for (const notifications of clientNotifications.values()) {
      totalReceived += notifications.length;
    }

    const expectedTotal =
      (batch + 1) * config.notificationsPerBatch * config.clients;
    const deliveryRate = ((totalReceived / expectedTotal) * 100).toFixed(2);

    batchResults.push({
      batchId: batch,
      sendDurationMs: sendDuration,
      expectedDeliveries: config.notificationsPerBatch * config.clients,
      actualDeliveries:
        totalReceived - batch * config.notificationsPerBatch * config.clients,
      deliveryRate: parseFloat(deliveryRate),
    });

    console.log(`[Batch ${batch + 1}] Delivery rate: ${deliveryRate}%\n`);
  }

  // Final analysis
  console.log("[Notification Stress] Test complete. Analyzing results...\n");

  // Calculate statistics
  let totalReceived = 0;
  let minReceived = Infinity;
  let maxReceived = 0;
  const allLatencies: number[] = [];

  for (const [clientName, notifications] of clientNotifications) {
    const count = notifications.length;
    totalReceived += count;
    minReceived = Math.min(minReceived, count);
    maxReceived = Math.max(maxReceived, count);

    const latencies = clientLatencies.get(clientName)!;
    allLatencies.push(...latencies);
  }

  const expectedTotal =
    config.notificationsPerBatch * config.batchCount * config.clients;
  const deliveryRate = ((totalReceived / expectedTotal) * 100).toFixed(2);

  // Latency statistics
  allLatencies.sort((a, b) => a - b);
  const avgLatency =
    allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length;
  const p50Latency = allLatencies[Math.floor(allLatencies.length * 0.5)];
  const p95Latency = allLatencies[Math.floor(allLatencies.length * 0.95)];
  const p99Latency = allLatencies[Math.floor(allLatencies.length * 0.99)];

  // Print results
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           Notification Stress Test Results                 ║
╠════════════════════════════════════════════════════════════╣
║  Clients: ${config.clients}                                               ║
║  Total notifications sent: ${expectedTotal}                           ║
║  Total notifications received: ${totalReceived}                        ║
║  Overall delivery rate: ${deliveryRate}%                            ║
╠════════════════════════════════════════════════════════════╣
║  Per-client distribution:                                  ║
║    Min received: ${minReceived}                                          ║
║    Max received: ${maxReceived}                                          ║
║    Avg received: ${(totalReceived / config.clients).toFixed(1)}                                   ║
╠════════════════════════════════════════════════════════════╣
║  Latency (send to receive):                                ║
║    Avg: ${avgLatency.toFixed(1)}ms                                          ║
║    p50: ${p50Latency.toFixed(1)}ms                                          ║
║    p95: ${p95Latency.toFixed(1)}ms                                          ║
║    p99: ${p99Latency.toFixed(1)}ms                                          ║
╠════════════════════════════════════════════════════════════╣
║  Batch Results:                                            ║
  `);

  for (const batch of batchResults) {
    console.log(
      `║    Batch ${batch.batchId + 1}: ${batch.deliveryRate.toFixed(1)}% delivered (${batch.sendDurationMs}ms send time)       ║`
    );
  }

  console.log(
    `╚════════════════════════════════════════════════════════════╝\n`
  );

  // Cleanup
  console.log("[Notification Stress] Cleaning up...");
  await Promise.all(clients.map(({ client }) => client.closeAllSessions()));

  // Determine pass/fail
  const passed = parseFloat(deliveryRate) >= 99.0 && p95Latency < 500;

  if (passed) {
    console.log("✅ Notification stress test PASSED");
  } else {
    console.log("❌ Notification stress test FAILED");
    console.log(`   Delivery rate: ${deliveryRate}% (target: >= 99%)`);
    console.log(`   p95 latency: ${p95Latency.toFixed(1)}ms (target: < 500ms)`);
  }

  return passed;
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  const config: NotificationStressConfig = {
    clients: parseInt(
      args.find((a) => a.startsWith("--clients="))?.split("=")[1] || "100"
    ),
    notificationsPerBatch: parseInt(
      args.find((a) => a.startsWith("--per-batch="))?.split("=")[1] || "10"
    ),
    batchCount: parseInt(
      args.find((a) => a.startsWith("--batches="))?.split("=")[1] || "5"
    ),
    batchDelayMs: parseInt(
      args.find((a) => a.startsWith("--delay="))?.split("=")[1] || "1000"
    ),
    redisUrl: process.env.REDIS_URL,
  };

  if (!config.redisUrl) {
    console.warn(
      "⚠️  WARNING: Running without Redis. Notifications limited to single server instance."
    );
    console.warn(
      "   Set REDIS_URL environment variable for distributed testing.\n"
    );
  }

  try {
    const passed = await notificationStressTest(config);
    process.exit(passed ? 0 : 1);
  } catch (error) {
    console.error("Notification stress test failed:", error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { notificationStressTest };
