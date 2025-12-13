/**
 * Mixed Workload Load Test
 *
 * Simulates realistic MCP usage with mixed operations:
 * - Tool calls (fast and slow)
 * - Resource reads
 * - Prompt requests
 * - Notifications
 * - Sampling (for capable clients)
 * - Elicitation (for capable clients)
 *
 * Run with:
 *   npx tsx tests/scale/load-mixed-workload.ts --clients=100 --duration=300000
 */

import { MCPClient } from "../../src/client.js";
import { createTestServer } from "./test-server.js";

interface LoadTestConfig {
  clients: number; // Number of concurrent clients
  durationMs: number; // Test duration in milliseconds
  requestsPerMinute: number; // Requests per minute per client
  redisUrl?: string; // Optional Redis URL
}

interface WorkloadMetrics {
  startTime: number;
  endTime: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  operationCounts: Record<string, number>;
  operationLatencies: Record<string, number[]>;
  errors: Array<{ operation: string; error: string; timestamp: number }>;
}

function selectRandomAction(weights: Record<string, number>): string {
  const random = Math.random();
  let sum = 0;

  for (const [action, weight] of Object.entries(weights)) {
    sum += weight;
    if (random < sum) {
      return action;
    }
  }

  return "fastTools"; // Fallback
}

async function mixedWorkloadTest(
  config: LoadTestConfig
): Promise<WorkloadMetrics> {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║         Mixed Workload Load Test Starting                 ║
╠═══════════════════════════════════════════════════════════╣
║  Clients: ${config.clients}                                          ║
║  Duration: ${(config.durationMs / 1000 / 60).toFixed(1)} minutes                             ║
║  Requests/min per client: ${config.requestsPerMinute}                     ║
║  Total expected requests: ~${Math.floor(config.clients * config.requestsPerMinute * (config.durationMs / 60000))}                      ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Start test server
  const port = 3000;
  console.log(`[Load Test] Starting test server on port ${port}...`);
  const _server = await createTestServer(port, config.redisUrl);

  // Initialize metrics
  const metrics: WorkloadMetrics = {
    startTime: Date.now(),
    endTime: 0,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    operationCounts: {},
    operationLatencies: {},
    errors: [],
  };

  // Create clients with varying capabilities
  console.log(
    `[Load Test] Creating ${config.clients} clients with varying capabilities...`
  );
  const clients = await Promise.all(
    Array.from({ length: config.clients }, async (_, i) => {
      const capabilities = {
        sampling: i % 3 === 0 ? { tools: true } : undefined, // 33% support sampling
        elicitation: i % 2 === 0 ? { url: true } : undefined, // 50% support elicitation
      };

      const client = new MCPClient({
        mcpServers: {
          [`test-${i}`]: {
            url: `http://localhost:${port}/mcp`,
            transport: "http",
          },
        },
        clientInfo: {
          name: `load-test-client-${i}`,
          version: "1.0.0",
        },
        clientCapabilities: capabilities,
      });

      await client.createSession(`test-${i}`);
      return { client, serverName: `test-${i}`, capabilities };
    })
  );

  console.log(`[Load Test] ✅ ${clients.length} clients connected`);

  // Workload distribution
  const workloadMix = {
    fastTools: 0.4, // 40% fast echo calls
    slowTools: 0.15, // 15% slow computation
    ioTools: 0.15, // 15% I/O-bound fetch
    resources: 0.15, // 15% resource reads
    prompts: 0.1, // 10% prompts
    notifications: 0.03, // 3% notification triggers
    sampling: 0.01, // 1% sampling (if supported)
    elicitation: 0.01, // 1% elicitation (if supported)
  };

  console.log("[Load Test] Starting mixed workload...\n");

  const endTime = Date.now() + config.durationMs;
  const requestInterval = 60000 / config.requestsPerMinute; // ms between requests

  // Progress reporting
  const progressInterval = setInterval(() => {
    const elapsed = (Date.now() - metrics.startTime) / 1000;
    const rps = metrics.totalRequests / elapsed;
    const errorRate = (
      (metrics.failedRequests / metrics.totalRequests) *
      100
    ).toFixed(2);

    console.log(
      `[Progress] ${elapsed.toFixed(0)}s | Requests: ${metrics.totalRequests} | RPS: ${rps.toFixed(1)} | Errors: ${errorRate}%`
    );
  }, 10000); // Every 10 seconds

  // Run workload
  while (Date.now() < endTime) {
    const batchPromises = clients.map(
      async ({ client, serverName, capabilities }) => {
        const action = selectRandomAction(workloadMix);
        const start = Date.now();

        try {
          switch (action) {
            case "fastTools":
              await client.callTool(serverName, "fast-echo", {
                message: `test-${metrics.totalRequests}`,
              });
              break;

            case "slowTools":
              await client.callTool(serverName, "slow-computation", {
                iterations: 1000,
              });
              break;

            case "ioTools":
              await client.callTool(serverName, "fetch-data", {
                url: "https://example.com",
                delay: 50,
              });
              break;

            case "resources":
              await client.readResource(serverName, "app://dynamic-data");
              break;

            case "prompts":
              await client.getPrompt(serverName, "greeting", {
                name: "LoadTest",
                language: "en",
              });
              break;

            case "notifications":
              await client.callTool(serverName, "trigger-notification", {
                type: Math.random() < 0.5 ? "tools" : "resources",
              });
              break;

            case "sampling":
              if (capabilities.sampling) {
                await client.callTool(serverName, "request-sampling", {
                  prompt: "Say hello",
                  maxTokens: 10,
                });
              }
              break;

            case "elicitation":
              if (capabilities.elicitation) {
                await client.callTool(serverName, "request-input", {
                  question: "Enter your name",
                  mode: "url",
                });
              }
              break;

            default:
              // Unknown action, skip
              break;
          }

          const latency = Date.now() - start;

          metrics.successfulRequests++;
          metrics.operationCounts[action] =
            (metrics.operationCounts[action] || 0) + 1;

          if (!metrics.operationLatencies[action]) {
            metrics.operationLatencies[action] = [];
          }
          metrics.operationLatencies[action].push(latency);
        } catch (error: any) {
          metrics.failedRequests++;
          metrics.errors.push({
            operation: action,
            error: error.message,
            timestamp: Date.now(),
          });
        }

        metrics.totalRequests++;
      }
    );

    await Promise.all(batchPromises);

    // Control request rate
    await new Promise((resolve) => setTimeout(resolve, requestInterval));
  }

  clearInterval(progressInterval);
  metrics.endTime = Date.now();

  // Cleanup
  console.log("\n[Load Test] Cleaning up...");
  await Promise.all(clients.map(({ client }) => client.closeAllSessions()));

  return metrics;
}

function generateReport(metrics: WorkloadMetrics): void {
  const durationSec = (metrics.endTime - metrics.startTime) / 1000;
  const successRate = (
    (metrics.successfulRequests / metrics.totalRequests) *
    100
  ).toFixed(2);
  const avgRps = (metrics.totalRequests / durationSec).toFixed(2);

  console.log(`
╔════════════════════════════════════════════════════════════╗
║                    Load Test Results                       ║
╠════════════════════════════════════════════════════════════╣
║  Duration: ${durationSec.toFixed(1)}s                                       ║
║  Total Requests: ${metrics.totalRequests}                                  ║
║  Successful: ${metrics.successfulRequests} (${successRate}%)                            ║
║  Failed: ${metrics.failedRequests}                                        ║
║  Avg RPS: ${avgRps}                                             ║
╠════════════════════════════════════════════════════════════╣
║  Operation Breakdown:                                      ║
  `);

  for (const [operation, count] of Object.entries(metrics.operationCounts)) {
    const latencies = metrics.operationLatencies[operation];
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const sorted = latencies.sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];

    console.log(
      `║    ${operation.padEnd(20)} ${count.toString().padStart(6)} calls`
    );
    console.log(
      `║      → Avg: ${avg.toFixed(1)}ms | p95: ${p95.toFixed(1)}ms | p99: ${p99.toFixed(1)}ms`
    );
  }

  console.log(`╚════════════════════════════════════════════════════════════╝`);

  if (metrics.errors.length > 0) {
    console.log("\n❌ Errors encountered:");
    const errorSummary = metrics.errors.reduce(
      (acc, err) => {
        const key = `${err.operation}: ${err.error}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    for (const [error, count] of Object.entries(errorSummary)) {
      console.log(`  ${count}x ${error}`);
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const config: LoadTestConfig = {
    clients: parseInt(
      args.find((a) => a.startsWith("--clients="))?.split("=")[1] || "100"
    ),
    durationMs: parseInt(
      args.find((a) => a.startsWith("--duration="))?.split("=")[1] || "300000"
    ),
    requestsPerMinute: parseInt(
      args.find((a) => a.startsWith("--rpm="))?.split("=")[1] || "10"
    ),
    redisUrl: process.env.REDIS_URL,
  };

  try {
    const metrics = await mixedWorkloadTest(config);
    generateReport(metrics);
    process.exit(0);
  } catch (error) {
    console.error("Load test failed:", error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { mixedWorkloadTest, generateReport };
