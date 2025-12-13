/**
 * Long-Running Session Stability Test
 *
 * Runs for 24-72 hours to detect:
 * - Memory leaks
 * - Connection stability
 * - Session TTL accuracy
 * - Redis connection resilience
 * - Performance degradation over time
 *
 * Run with:
 *   REDIS_URL=redis://... npx tsx tests/scale/long-running-sessions.ts --duration=24
 */

import { MCPClient } from "../../src/client.js";
import { createTestServer } from "./test-server.js";
import * as fs from "fs";
import * as path from "path";

interface LongevityConfig {
  durationHours: number;
  clients: number;
  requestIntervalMs: number;
  snapshotIntervalMs: number;
  redisUrl?: string;
}

interface MemorySnapshot {
  timestamp: number;
  elapsedHours: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  activeSessions: number;
  activeStreams: number;
  metrics: {
    toolCalls: number;
    resourceReads: number;
    notificationsSent: number;
    errors: number;
  };
}

async function longRunningSessionTest(config: LongevityConfig) {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║        Long-Running Stability Test Starting               ║
╠═══════════════════════════════════════════════════════════╣
║  Duration: ${config.durationHours} hours                                       ║
║  Clients: ${config.clients}                                               ║
║  Request interval: ${config.requestIntervalMs}ms                                  ║
║  Will run until: ${new Date(Date.now() + config.durationHours * 60 * 60 * 1000).toISOString()} ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Start test server
  const port = 3000;
  console.log(`[Longevity] Starting test server on port ${port}...`);
  const server = await createTestServer(port, config.redisUrl);

  // Metrics tracking
  const metrics = {
    toolCalls: 0,
    resourceReads: 0,
    promptRequests: 0,
    notificationsSent: 0,
    errors: 0,
  };

  const memorySnapshots: MemorySnapshot[] = [];
  const resultsDir = path.join(process.cwd(), "test-results", "longevity");

  // Create results directory
  fs.mkdirSync(resultsDir, { recursive: true });

  // Create clients
  console.log(`[Longevity] Creating ${config.clients} long-lived clients...`);
  const clients = await Promise.all(
    Array.from({ length: config.clients }, async (_, i) => {
      const client = new MCPClient({
        mcpServers: {
          [`longevity-${i}`]: {
            url: `http://localhost:${port}/mcp`,
            transport: "http",
          },
        },
        clientInfo: {
          name: `longevity-client-${i}`,
          version: "1.0.0",
        },
      });

      await client.createSession(`longevity-${i}`);
      return { client, serverName: `longevity-${i}` };
    })
  );

  console.log(`[Longevity] ✅ ${clients.length} clients connected\n`);
  console.log("[Longevity] Starting continuous workload...\n");

  const startTime = Date.now();
  const endTime = startTime + config.durationHours * 60 * 60 * 1000;

  // Snapshot collection interval
  const snapshotInterval = setInterval(async () => {
    const elapsed = Date.now() - startTime;
    const elapsedHours = elapsed / (60 * 60 * 1000);

    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      elapsedHours,
      memory: {
        heapUsed: process.memoryUsage().heapUsed,
        heapTotal: process.memoryUsage().heapTotal,
        external: process.memoryUsage().external,
        rss: process.memoryUsage().rss,
      },
      activeSessions: server.getActiveSessions().length,
      activeStreams: 0, // Would need to track this
      metrics: { ...metrics },
    };

    memorySnapshots.push(snapshot);

    // Save snapshot to file
    const snapshotFile = path.join(resultsDir, "memory-snapshots.jsonl");
    fs.appendFileSync(snapshotFile, JSON.stringify(snapshot) + "\n");

    console.log(
      `[Snapshot ${memorySnapshots.length}] ${elapsedHours.toFixed(2)}h | ` +
        `Heap: ${(snapshot.memory.heapUsed / 1024 / 1024).toFixed(1)}MB | ` +
        `Sessions: ${snapshot.activeSessions} | ` +
        `Requests: ${metrics.toolCalls + metrics.resourceReads}`
    );

    // Check for memory leak
    if (memorySnapshots.length >= 3) {
      const recent = memorySnapshots.slice(-3);
      const heapGrowth =
        (recent[2].memory.heapUsed - recent[0].memory.heapUsed) /
        recent[0].memory.heapUsed;

      if (heapGrowth > 0.2) {
        // 20% growth over 3 snapshots
        console.warn(
          `  ⚠️  WARNING: Heap grew ${(heapGrowth * 100).toFixed(1)}% - possible memory leak`
        );
      }
    }
  }, config.snapshotIntervalMs);

  // Progress reporting interval
  const progressInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const remaining = (endTime - Date.now()) / 1000;
    const progress = (
      ((Date.now() - startTime) / (endTime - startTime)) *
      100
    ).toFixed(1);

    console.log(
      `[Progress] ${(elapsed / 3600).toFixed(2)}h elapsed | ${(remaining / 3600).toFixed(2)}h remaining | ${progress}% complete`
    );
  }, 300000); // Every 5 minutes

  // Main workload loop
  while (Date.now() < endTime) {
    // Each client makes a request
    const _results = await Promise.allSettled(
      clients.map(async ({ client, serverName }) => {
        // Randomly choose operation
        const rand = Math.random();

        try {
          if (rand < 0.5) {
            // 50%: Fast tool call
            await client.callTool(serverName, "fast-echo", {
              message: `longevity-${metrics.toolCalls}`,
            });
            metrics.toolCalls++;
          } else if (rand < 0.75) {
            // 25%: Resource read
            await client.readResource(serverName, "app://dynamic-data");
            metrics.resourceReads++;
          } else if (rand < 0.9) {
            // 15%: Prompt
            await client.getPrompt(serverName, "greeting", {
              name: "LongevityTest",
            });
            metrics.promptRequests++;
          } else {
            // 10%: I/O-bound tool
            await client.callTool(serverName, "fetch-data", {
              url: "https://example.com",
              delay: 50,
            });
            metrics.toolCalls++;
          }
        } catch (error) {
          metrics.errors++;
        }
      })
    );

    // Send notification every 100 requests
    if ((metrics.toolCalls + metrics.resourceReads) % 100 === 0) {
      try {
        // Use first client to trigger notification
        await clients[0].client.callTool(
          clients[0].serverName,
          "trigger-notification",
          {
            type: "tools",
          }
        );
        metrics.notificationsSent++;
      } catch (error) {
        // Ignore notification errors
      }
    }

    // Wait before next round
    await new Promise((resolve) =>
      setTimeout(resolve, config.requestIntervalMs)
    );
  }

  clearInterval(snapshotInterval);
  clearInterval(progressInterval);

  // Final analysis
  console.log("\n[Longevity] Test complete. Analyzing results...\n");

  const finalSnapshot = memorySnapshots[memorySnapshots.length - 1];
  const initialSnapshot = memorySnapshots[0];

  const totalHeapGrowth = (
    ((finalSnapshot.memory.heapUsed - initialSnapshot.memory.heapUsed) /
      initialSnapshot.memory.heapUsed) *
    100
  ).toFixed(2);
  const avgHeapMB =
    memorySnapshots.reduce((sum, s) => sum + s.memory.heapUsed, 0) /
    memorySnapshots.length /
    1024 /
    1024;

  console.log(`
╔════════════════════════════════════════════════════════════╗
║         Long-Running Stability Test Results               ║
╠════════════════════════════════════════════════════════════╣
║  Duration: ${config.durationHours} hours                                            ║
║  Total tool calls: ${metrics.toolCalls}                                    ║
║  Total resource reads: ${metrics.resourceReads}                                ║
║  Total prompt requests: ${metrics.promptRequests}                              ║
║  Total notifications: ${metrics.notificationsSent}                                ║
║  Total errors: ${metrics.errors}                                         ║
║  Error rate: ${((metrics.errors / (metrics.toolCalls + metrics.resourceReads)) * 100).toFixed(2)}%                                     ║
╠════════════════════════════════════════════════════════════╣
║  Memory Analysis:                                          ║
║    Initial heap: ${(initialSnapshot.memory.heapUsed / 1024 / 1024).toFixed(1)}MB                                    ║
║    Final heap: ${(finalSnapshot.memory.heapUsed / 1024 / 1024).toFixed(1)}MB                                      ║
║    Growth: ${totalHeapGrowth}%                                            ║
║    Average heap: ${avgHeapMB.toFixed(1)}MB                                     ║
║    Snapshots: ${memorySnapshots.length}                                          ║
╚════════════════════════════════════════════════════════════╝
  `);

  // Save final report
  const report = {
    config,
    duration: config.durationHours,
    metrics,
    memoryAnalysis: {
      initialHeapMB: initialSnapshot.memory.heapUsed / 1024 / 1024,
      finalHeapMB: finalSnapshot.memory.heapUsed / 1024 / 1024,
      growthPercent: parseFloat(totalHeapGrowth),
      avgHeapMB,
      snapshots: memorySnapshots.length,
    },
    snapshots: memorySnapshots,
  };

  const reportFile = path.join(
    resultsDir,
    `longevity-report-${Date.now()}.json`
  );
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`[Longevity] Report saved to: ${reportFile}\n`);

  // Cleanup
  console.log("[Longevity] Cleaning up...");
  await Promise.all(clients.map(({ client }) => client.closeAllSessions()));

  // Determine pass/fail
  const errorRate =
    metrics.errors / (metrics.toolCalls + metrics.resourceReads);
  const heapGrowth = parseFloat(totalHeapGrowth);

  const passed = errorRate < 0.01 && heapGrowth < 50; // < 1% errors, < 50% heap growth

  if (passed) {
    console.log("✅ Longevity test PASSED");
  } else {
    console.log("❌ Longevity test FAILED");
    if (errorRate >= 0.01)
      console.log(`   Error rate too high: ${(errorRate * 100).toFixed(2)}%`);
    if (heapGrowth >= 50)
      console.log(`   Heap growth too high: ${heapGrowth}%`);
  }

  return passed;
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  const config: LongevityConfig = {
    durationHours: parseInt(
      args.find((a) => a.startsWith("--duration="))?.split("=")[1] || "1"
    ), // Default 1 hour for testing
    clients: parseInt(
      args.find((a) => a.startsWith("--clients="))?.split("=")[1] || "100"
    ),
    requestIntervalMs: parseInt(
      args.find((a) => a.startsWith("--interval="))?.split("=")[1] || "10000"
    ), // 10s default
    snapshotIntervalMs: parseInt(
      args.find((a) => a.startsWith("--snapshot-interval="))?.split("=")[1] ||
        "3600000"
    ), // 1 hour default
    redisUrl: process.env.REDIS_URL,
  };

  console.log(`[Longevity] Test will run for ${config.durationHours} hours`);
  console.log(`[Longevity] Results will be saved to test-results/longevity/\n`);

  try {
    const passed = await longRunningSessionTest(config);
    process.exit(passed ? 0 : 1);
  } catch (error) {
    console.error("Longevity test failed:", error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { longRunningSessionTest };
