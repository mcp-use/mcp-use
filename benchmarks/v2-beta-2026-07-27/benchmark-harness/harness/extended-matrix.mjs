import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rounds = Number(process.argv[2] ?? "3");
const benchmarkRoot = process.env.MCP_BENCH_ROOT;
if (!benchmarkRoot) {
  throw new Error("MCP_BENCH_ROOT must point to the packaged benchmark-harness directory");
}
const node = process.env.NODE_BIN ?? process.execPath;
const mcpDrillImage = process.env.MCPDRILL_IMAGE ?? "mcpdrill/server:modern";
const workerImage = process.env.MCPDRILL_WORKER_IMAGE ?? "mcpdrill/worker:modern";
const api = "http://127.0.0.1:48080";
const template = JSON.parse(
  await readFile(new URL("./mcpdrill-short.json", import.meta.url), "utf8")
);
const targets = {
  mcpUseV2: {
    command: node,
    args: ["server.mjs"],
    cwd: new URL(".", import.meta.url),
    version: JSON.parse(
      await readFile(
        new URL("./node_modules/mcp-use-v2/package.json", import.meta.url),
        "utf8",
      ),
    ).version,
    protocolVersion: "2026-07-28",
    env: { MCP_USE_ANONYMIZED_TELEMETRY: "false" },
  },
  officialV2: {
    command: node,
    args: ["official-v2.mjs"],
    cwd: new URL(".", import.meta.url),
    version: "2.0.0-beta.5",
    protocolVersion: "2026-07-28",
    env: {},
  },
  skybridge: {
    command: node,
    args: ["skybridge.mjs"],
    cwd: new URL(".", import.meta.url),
    version: "1.2.6",
    protocolVersion: "2025-11-25",
    env: { SKYBRIDGE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
  },
  mcpUseV1: {
    command: node,
    args: ["mcp-use-v1.mjs"],
    cwd: new URL(".", import.meta.url),
    version: JSON.parse(
      await readFile(
        new URL("./node_modules/mcp-use-v1/package.json", import.meta.url),
        "utf8",
      ),
    ).version,
    protocolVersion: "2025-11-25",
    env: { MCP_USE_ANONYMIZED_TELEMETRY: "false", HOST: "0.0.0.0" },
  },
  officialV1: {
    command: node,
    args: ["official-v1.mjs"],
    cwd: new URL(".", import.meta.url),
    version: "1.29.0",
    protocolVersion: "2025-11-25",
    env: {},
  },
  rmcp: {
    command: `${benchmarkRoot}/extended/rmcp/target/release/rmcp-benchmark`,
    args: [],
    cwd: `${benchmarkRoot}/extended/rmcp`,
    version: "2.2.0",
    protocolVersion: "2025-11-25",
    env: {},
  },
  tmcp: {
    command: node,
    args: ["server.mjs"],
    cwd: `${benchmarkRoot}/extended/tmcp`,
    version: "1.19.4",
    protocolVersion: "2025-06-18",
    env: {},
  },
  xmcp: {
    command: node,
    args: ["dist/http.js"],
    cwd: `${benchmarkRoot}/extended/xmcp`,
    version: "0.6.13",
    protocolVersion: "2025-11-25",
    env: {},
  },
  mcpHandler: {
    command: node,
    args: ["server.mjs"],
    cwd: `${benchmarkRoot}/extended/mcp-handler`,
    version: "1.1.0",
    protocolVersion: "2025-11-25",
    env: {},
  },
};
const requestedNames = process.argv[3]?.split(",").filter(Boolean);
const names =
  requestedNames === undefined || requestedNames.length === 0
    ? Object.keys(targets)
    : requestedNames;
const results = Object.fromEntries(names.map((name) => [name, []]));

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function interleavedOrder(round) {
  if (names.length === 2) {
    return round % 2 === 0 ? [...names].reverse() : [...names];
  }
  const offset = ((round - 1) * 3) % names.length;
  const rotated = [...names.slice(offset), ...names.slice(0, offset)];
  return round % 2 === 0 ? rotated.reverse() : rotated;
}

async function waitForPort(port, deadline = performance.now() + 10_000) {
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
      await delay(25);
    }
  }
  throw new Error(`Port ${port} did not become ready`);
}

async function request(path, init) {
  const response = await fetch(`${api}${path}`, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function resetMcpDrill() {
  await execFileAsync(
    "docker",
    ["stop", "mcpdrill-worker", "mcpdrill-control"]
  ).catch(() => undefined);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { stdout } = await execFileAsync("docker", [
      "ps",
      "-a",
      "--filter",
      "name=^/mcpdrill-(worker|control)$",
      "--format",
      "{{.Names}}",
    ]);
    if (stdout.trim() === "") break;
    await delay(25);
  }
  await execFileAsync("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    "mcpdrill-control",
    "--network",
    "mcp-bench-net",
    "-p",
    "127.0.0.1:48080:8080",
    mcpDrillImage,
    "--addr=:8080",
    "--insecure",
    "--insecure-worker-auth",
    "--rate-limit=0",
    "--max-ops-per-run=1000000",
    "--max-logs-per-run=1000",
    "--max-total-runs=2",
    "--allow-private-discovery",
    "--allow-private-networks=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16",
  ]);
  await execFileAsync("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    "mcpdrill-worker",
    "--network",
    "mcp-bench-net",
    workerImage,
    "--control-plane=http://mcpdrill-control:8080",
    "--allow-private-networks=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16",
  ]);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await request("/runs");
      await delay(1_000);
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error("MCP Drill did not become ready");
}

async function runTarget(name, round, position, order) {
  const target = targets[name];
  const child = spawn(target.command, target.args, {
    cwd: target.cwd,
    env: {
      ...process.env,
      ...target.env,
      PORT: "43100",
      NODE_ENV: "production",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForPort(43100);
    const config = structuredClone(template);
    config.scenario_id = `extended-r${round}-${position}-${name}`;
    config.target.protocol_version = target.protocolVersion;
    const created = await request("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
    });
    await request(`/runs/${created.run_id}/start`, { method: "POST" });
    let state;
    for (let poll = 0; poll < 180; poll += 1) {
      state = await request(`/runs/${created.run_id}`);
      if (state.state === "completed" || state.state === "failed") break;
      await delay(500);
    }
    if (state?.state !== "completed") {
      throw new Error(
        `Run ${created.run_id} ended in ${state?.state}: ${stderr}`
      );
    }
    const metrics = await request(`/runs/${created.run_id}/metrics`);
    const stability = await request(
      `/runs/${created.run_id}/stability`
    ).catch(() => undefined);
    const result = {
      round,
      position,
      order,
      target: name,
      version: target.version,
      protocol_version: target.protocolVersion,
      run_id: created.run_id,
      throughput: metrics.throughput,
      latency_p50_ms: metrics.latency_p50_ms,
      latency_p95_ms: metrics.latency_p95_ms,
      latency_p99_ms: metrics.latency_p99_ms,
      error_rate: metrics.error_rate,
      total_ops: metrics.total_ops,
      failed_ops: metrics.failed_ops,
      stability_score: stability?.stability_score,
    };
    results[name].push(result);
    console.log(JSON.stringify(result));
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
}

for (let round = 1; round <= rounds; round += 1) {
  const order = interleavedOrder(round);
  for (let position = 0; position < order.length; position += 1) {
    await resetMcpDrill();
    await runTarget(order[position], round, position + 1, order);
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

const summary = Object.fromEntries(
  names.map((name) => {
    const samples = results[name];
    return [
      name,
      {
        version: targets[name].version,
        protocol_version: targets[name].protocolVersion,
        samples: samples.length,
        median_throughput: median(samples.map((sample) => sample.throughput)),
        median_p50_ms: median(
          samples.map((sample) => sample.latency_p50_ms)
        ),
        median_p95_ms: median(
          samples.map((sample) => sample.latency_p95_ms)
        ),
        median_p99_ms: median(
          samples.map((sample) => sample.latency_p99_ms)
        ),
        median_error_rate: median(
          samples.map((sample) => sample.error_rate)
        ),
        median_stability_score: median(
          samples.map((sample) => sample.stability_score)
        ),
        run_ids: samples.map((sample) => sample.run_id),
      },
    ];
  })
);
console.log(JSON.stringify({ summary }));
