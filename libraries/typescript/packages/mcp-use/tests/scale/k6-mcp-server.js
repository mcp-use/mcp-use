/**
 * k6 Load Test Script for MCP Server
 *
 * Tests MCP server under various load scenarios with full protocol support.
 *
 * Installation:
 *   brew install k6  # macOS
 *   # or download from https://k6.io/
 *
 * Run examples:
 *   # Quick test (100 VUs for 1 minute)
 *   k6 run --vus=100 --duration=1m tests/scale/k6-mcp-server.js
 *
 *   # Moderate load (1000 VUs for 10 minutes)
 *   k6 run --vus=1000 --duration=10m tests/scale/k6-mcp-server.js
 *
 *   # Full test suite with scenarios
 *   k6 run tests/scale/k6-mcp-server.js
 *
 *   # With output to JSON
 *   k6 run --out json=results.json tests/scale/k6-mcp-server.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Counter, Trend, Rate } from "k6/metrics";

// Custom metrics for MCP operations
const toolCallDuration = new Trend("mcp_tool_call_duration", true);
const resourceReadDuration = new Trend("mcp_resource_read_duration", true);
const promptGetDuration = new Trend("mcp_prompt_get_duration", true);
const initializeDuration = new Trend("mcp_initialize_duration", true);
const notificationCount = new Counter("mcp_notifications_sent");
const sessionErrors = new Counter("mcp_session_errors");
const errorRate = new Rate("mcp_error_rate");

// Test configuration
export const options = {
  scenarios: {
    // Baseline: Constant moderate load
    baseline: {
      executor: "constant-vus",
      vus: 50,
      duration: "5m",
      tags: { scenario: "baseline" },
    },

    // Ramping: Gradual increase to find limits
    ramping: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 100 },
        { duration: "3m", target: 500 },
        { duration: "2m", target: 1000 },
        { duration: "3m", target: 1000 },
        { duration: "1m", target: 0 },
      ],
      startTime: "6m",
      tags: { scenario: "ramping" },
    },

    // Spike: Sudden traffic burst
    spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 2000 }, // Sudden spike
        { duration: "1m", target: 2000 }, // Hold
        { duration: "10s", target: 100 }, // Drop to baseline
        { duration: "3m", target: 100 }, // Sustain
        { duration: "10s", target: 0 }, // Ramp down
      ],
      startTime: "16m",
      tags: { scenario: "spike" },
    },
  },

  // Performance thresholds
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"], // 95% under 500ms, 99% under 1s
    http_req_failed: ["rate<0.01"], // Less than 1% errors
    mcp_tool_call_duration: ["p(95)<200", "p(99)<500"], // Tool calls fast
    mcp_resource_read_duration: ["p(95)<100", "p(99)<300"], // Resource reads faster
    mcp_initialize_duration: ["p(95)<300", "p(99)<600"], // Initialize acceptable
    mcp_error_rate: ["rate<0.01"], // Low error rate
  },
};

// eslint-disable-next-line no-undef
const BASE_URL = __ENV.MCP_SERVER_URL || "http://localhost:3000";

export default function () {
  let sessionId;
  // eslint-disable-next-line no-undef
  const vuId = __VU;

  // Initialize session
  group("MCP Session Initialization", function () {
    const startInit = Date.now();

    const initRes = http.post(
      `${BASE_URL}/mcp`,
      JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          clientInfo: {
            name: "k6-load-test",
            version: "1.0.0",
          },
          capabilities: {
            // Vary capabilities across virtual users
            sampling: vuId % 3 === 0 ? { tools: true } : undefined,
            elicitation: vuId % 2 === 0 ? { url: true } : undefined,
          },
        },
        id: 1,
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    initializeDuration.add(Date.now() - startInit);

    const initSuccess = check(initRes, {
      "initialization successful": (r) => r.status === 200,
      "has session ID": (r) => r.headers["Mcp-Session-Id"] !== undefined,
      "returns server info": (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.result && body.result.serverInfo;
        } catch {
          return false;
        }
      },
    });

    if (!initSuccess) {
      sessionErrors.add(1);
      errorRate.add(1);
      return; // Skip rest of iteration if init fails
    }

    sessionId = initRes.headers["Mcp-Session-Id"];
  });

  // Tool calls - mixed fast and slow
  group("Tool Calls", function () {
    // Fast echo tool (most common - 60% of operations)
    for (let i = 0; i < 3; i++) {
      const startTool = Date.now();

      const toolRes = http.post(
        `${BASE_URL}/mcp`,
        JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "fast-echo",
            arguments: {
              message: `Load test from VU ${vuId} iteration ${i}`,
            },
          },
          id: 10 + i,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Mcp-Session-Id": sessionId,
          },
        }
      );

      toolCallDuration.add(Date.now() - startTool);

      const success = check(toolRes, {
        "tool call successful": (r) => r.status === 200,
        "has result": (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.result && body.result.content;
          } catch {
            return false;
          }
        },
      });

      if (!success) {
        errorRate.add(1);
      } else {
        errorRate.add(0);
      }
    }

    // Slow computation (10% of operations)
    if (Math.random() < 0.1) {
      const startSlow = Date.now();

      http.post(
        `${BASE_URL}/mcp`,
        JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "slow-computation",
            arguments: { iterations: 5000 },
          },
          id: 20,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Mcp-Session-Id": sessionId,
          },
          timeout: "10s",
        }
      );

      toolCallDuration.add(Date.now() - startSlow);
    }

    // I/O-bound tool (15% of operations)
    if (Math.random() < 0.15) {
      http.post(
        `${BASE_URL}/mcp`,
        JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "fetch-data",
            arguments: { url: "https://example.com", delay: 50 },
          },
          id: 21,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Mcp-Session-Id": sessionId,
          },
        }
      );
    }
  });

  // Resource reads (15% of operations)
  if (Math.random() < 0.15) {
    group("Resource Operations", function () {
      const startRes = Date.now();

      const resRes = http.post(
        `${BASE_URL}/mcp`,
        JSON.stringify({
          jsonrpc: "2.0",
          method: "resources/read",
          params: { uri: "app://dynamic-data" },
          id: 30,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Mcp-Session-Id": sessionId,
          },
        }
      );

      resourceReadDuration.add(Date.now() - startRes);

      check(resRes, {
        "resource read successful": (r) => r.status === 200,
      });
    });
  }

  // Prompt operations (10% of operations)
  if (Math.random() < 0.1) {
    group("Prompt Operations", function () {
      const startPrompt = Date.now();

      http.post(
        `${BASE_URL}/mcp`,
        JSON.stringify({
          jsonrpc: "2.0",
          method: "prompts/get",
          params: {
            name: "greeting",
            arguments: { name: `User${vuId}`, language: "en" },
          },
          id: 40,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Mcp-Session-Id": sessionId,
          },
        }
      );

      promptGetDuration.add(Date.now() - startPrompt);
    });
  }

  // Trigger notifications occasionally (2% of operations)
  if (Math.random() < 0.02) {
    group("Notifications", function () {
      http.post(
        `${BASE_URL}/mcp`,
        JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "trigger-notification",
            arguments: { type: "tools" },
          },
          id: 50,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Mcp-Session-Id": sessionId,
          },
        }
      );

      notificationCount.add(1);
    });
  }

  // Think time between iterations
  sleep(Math.random() * 2 + 1); // 1-3 seconds
}

export function handleSummary(data) {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      checks_passed: data.metrics.checks.values.passes,
      checks_failed: data.metrics.checks.values.fails,
      vus_max: data.metrics.vus_max.values.max,
      iterations: data.metrics.iterations.values.count,
      http_reqs: data.metrics.http_reqs.values.count,
      http_req_duration_p95: data.metrics.http_req_duration.values["p(95)"],
      http_req_duration_p99: data.metrics.http_req_duration.values["p(99)"],
      http_req_failed_rate: data.metrics.http_req_failed.values.rate,
    },
    mcp_metrics: {
      tool_calls_p95: data.metrics.mcp_tool_call_duration?.values["p(95)"] || 0,
      resource_reads_p95:
        data.metrics.mcp_resource_read_duration?.values["p(95)"] || 0,
      initialize_p95:
        data.metrics.mcp_initialize_duration?.values["p(95)"] || 0,
      notifications_sent:
        data.metrics.mcp_notifications_sent?.values.count || 0,
      error_rate: data.metrics.mcp_error_rate?.values.rate || 0,
    },
  };

  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }),
    "summary.json": JSON.stringify(report, null, 2),
  };
}

function textSummary(data, options) {
  const indent = options.indent || "";
  const colors = options.enableColors;

  return `
${indent}╔════════════════════════════════════════════════════════════╗
${indent}║              k6 MCP Load Test Results                      ║
${indent}╠════════════════════════════════════════════════════════════╣
${indent}║  Checks: ${data.metrics.checks.values.passes} passed / ${data.metrics.checks.values.fails} failed                           ║
${indent}║  Iterations: ${data.metrics.iterations.values.count}                                      ║
${indent}║  HTTP Requests: ${data.metrics.http_reqs.values.count}                                  ║
${indent}║  Error Rate: ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%                                  ║
${indent}╠════════════════════════════════════════════════════════════╣
${indent}║  HTTP Request Duration:                                    ║
${indent}║    p(50): ${data.metrics.http_req_duration.values["p(50)"].toFixed(2)}ms                                       ║
${indent}║    p(95): ${data.metrics.http_req_duration.values["p(95)"].toFixed(2)}ms                                       ║
${indent}║    p(99): ${data.metrics.http_req_duration.values["p(99)"].toFixed(2)}ms                                       ║
${indent}╠════════════════════════════════════════════════════════════╣
${indent}║  MCP Operations:                                           ║
${indent}║    Tool Calls p95: ${(data.metrics.mcp_tool_call_duration?.values["p(95)"] || 0).toFixed(2)}ms                       ║
${indent}║    Resource Reads p95: ${(data.metrics.mcp_resource_read_duration?.values["p(95)"] || 0).toFixed(2)}ms                  ║
${indent}║    Initialize p95: ${(data.metrics.mcp_initialize_duration?.values["p(95)"] || 0).toFixed(2)}ms                      ║
${indent}║    Notifications: ${data.metrics.mcp_notifications_sent?.values.count || 0}                                ║
${indent}╚════════════════════════════════════════════════════════════╝
`;
}
