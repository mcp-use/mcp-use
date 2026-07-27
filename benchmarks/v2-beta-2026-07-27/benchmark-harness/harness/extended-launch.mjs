import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";

const rounds = Number(process.argv[2] ?? "100");
const warmupRounds = Number(process.argv[3] ?? "10");
const benchmarkRoot = process.env.MCP_BENCH_ROOT;
if (!benchmarkRoot) {
  throw new Error("MCP_BENCH_ROOT must point to the packaged benchmark-harness directory");
}
const node = process.env.NODE_BIN ?? process.execPath;
const entries = {
  mcpUseV2: {
    command: node,
    args: ["server.mjs"],
    cwd: new URL(".", import.meta.url),
    env: { MCP_USE_ANONYMIZED_TELEMETRY: "false" },
  },
  officialV2: {
    command: node,
    args: ["official-v2.mjs"],
    cwd: new URL(".", import.meta.url),
    env: {},
  },
  skybridge: {
    command: node,
    args: ["skybridge.mjs"],
    cwd: new URL(".", import.meta.url),
    env: { SKYBRIDGE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
  },
  mcpUseV1: {
    command: node,
    args: ["mcp-use-v1.mjs"],
    cwd: new URL(".", import.meta.url),
    env: {
      HOST: "0.0.0.0",
      MCP_USE_ANONYMIZED_TELEMETRY: "false",
    },
  },
  officialV1: {
    command: node,
    args: ["official-v1.mjs"],
    cwd: new URL(".", import.meta.url),
    env: {},
  },
  rmcp: {
    command: `${benchmarkRoot}/extended/rmcp/target/release/rmcp-benchmark`,
    args: [],
    cwd: `${benchmarkRoot}/extended/rmcp`,
    env: {},
  },
  tmcp: {
    command: node,
    args: ["server.mjs"],
    cwd: `${benchmarkRoot}/extended/tmcp`,
    env: {},
  },
  xmcp: {
    command: node,
    args: ["dist/http.js"],
    cwd: `${benchmarkRoot}/extended/xmcp`,
    env: {},
  },
  mcpHandler: {
    command: node,
    args: ["server.mjs"],
    cwd: `${benchmarkRoot}/extended/mcp-handler`,
    env: {},
  },
};
const names = Object.keys(entries);
const timings = Object.fromEntries(names.map((name) => [name, []]));
let attempt = 0;

async function connectUntilReady(port, deadline) {
  while (performance.now() < deadline) {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    try {
      await Promise.race([
        once(socket, "connect"),
        once(socket, "error").then(([error]) => Promise.reject(error)),
      ]);
      socket.destroy();
      return;
    } catch {
      socket.destroy();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
  throw new Error(`Server did not listen on port ${port}`);
}

async function sample(name, record) {
  const port = name === "xmcp" ? 43100 : 44000 + (attempt % 1000);
  attempt += 1;
  const entry = entries[name];
  const startedAt = performance.now();
  const child = spawn(entry.command, entry.args, {
    cwd: entry.cwd,
    env: {
      ...process.env,
      ...entry.env,
      PORT: String(port),
      NODE_ENV: "production",
    },
    stdio: "ignore",
  });
  try {
    await connectUntilReady(port, startedAt + 15_000);
    if (record) timings[name].push(performance.now() - startedAt);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
}

for (let round = 0; round < warmupRounds + rounds; round += 1) {
  const offset = round % names.length;
  const order = [...names.slice(offset), ...names.slice(0, offset)];
  for (const name of order) {
    await sample(name, round >= warmupRounds);
  }
}

function percentile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

console.log(
  JSON.stringify({
    runtime: process.version,
    rounds,
    warmupRounds,
    results: Object.fromEntries(
      names.map((name) => {
        const sorted = [...timings[name]].sort(
          (left, right) => left - right
        );
        return [
          name,
          {
            median_ms: Number(percentile(sorted, 0.5).toFixed(3)),
            p25_ms: Number(percentile(sorted, 0.25).toFixed(3)),
            p75_ms: Number(percentile(sorted, 0.75).toFixed(3)),
            min_ms: Number(sorted[0].toFixed(3)),
            max_ms: Number(sorted.at(-1).toFixed(3)),
          },
        ];
      })
    ),
  })
);
