#!/usr/bin/env node
// Deploy a staged fixture with the in-development CLI to a per-run branch (PLAN.md §18.8.1 step 7, §18.8.8).
//
//   node e2e/manufact/scripts/deploy.mjs --fixture <dir> --variant <v>
//        [--run <id>] [--attempt <n>] [--pr <n>] [--branch <b>] [--fallback] [--execute]
//
// Without --execute it prints the plan (argv and environment it would use) and
// calls nothing, so it is safe locally. With --execute it requires
// MANUFACT_TOKEN and MANUFACT_ORG, waits while >= caps.liveDeployments `r*`
// deployments are live, deploys with the vendored CLI
// (<fixture>/node_modules/.bin/mcp-use, installed with `npm ci`), and asserts
// the deployment's gitCommitSha equals the uploaded commit. Writes
// <fixture>/deployment.json.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  HarnessError,
  branchName,
  commitMessage,
  deployArgv,
  env,
  isJanitorBranch,
  isPrBranch,
  parseArgs,
  readMatrix,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
if (typeof args.fixture !== "string" || typeof args.variant !== "string") {
  console.error(
    "usage: deploy.mjs --fixture <dir> --variant <v> [--run <id>] [--attempt <n>] [--pr <n>] [--branch <b>] [--fallback] [--execute]"
  );
  process.exit(2);
}
const matrix = readMatrix();
const fixtureDir = resolve(args.fixture);
const combo = JSON.parse(readFileSync(join(fixtureDir, "combo.json"), "utf8"));
const runId = String(args.run ?? env("GITHUB_RUN_ID") ?? "0");
const attempt = String(args.attempt ?? env("GITHUB_RUN_ATTEMPT") ?? "1");
// --pr <n> deploys to the PR's dev-space branch `pr<n>-<variant>`, which every
// push to that PR redeploys; without it each run gets its own `r<run>a<att>-` branch.
const pr = typeof args.pr === "string" ? args.pr : undefined;
const branch =
  typeof args.branch === "string"
    ? args.branch
    : branchName({ runId, attempt, variant: args.variant, pr });
const message = commitMessage({
  runId,
  attempt,
  variant: args.variant,
  sha: combo.sha,
  version: combo.mcpUse?.versions?.["mcp-use"],
});
const cli = join(fixtureDir, "node_modules", ".bin", "mcp-use");

// Optional hosts are exported only when non-empty (§18.8.7).
const childEnv = { ...process.env };
for (const [from, to] of [
  ["E2E_CLOUD_API_URL", "MCP_USE_CLOUD_API_URL"],
  ["E2E_CLOUD_WEB_URL", "MCP_USE_CLOUD_WEB_URL"],
]) {
  if (env(from)) childEnv[to] = env(from);
  else if (childEnv[to] === "") delete childEnv[to];
}

const mcpUse = (argv) =>
  JSON.parse(
    execFileSync(cli, argv, {
      cwd: fixtureDir,
      env: childEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    })
  );

function supportsCommitMessage() {
  if (!existsSync(cli)) return false;
  const help = execFileSync(cli, ["deploy", "--help"], {
    env: childEnv,
    encoding: "utf8",
  });
  return help.includes("--commit-message");
}

const argv = deployArgv({
  fixtureDir: ".",
  server: matrix.servers.app,
  branch,
  message,
  fallbackCommands: Boolean(args.fallback),
  supportsCommitMessage: supportsCommitMessage(),
});

if (!args.execute) {
  console.log(
    JSON.stringify(
      { dryRun: true, cli, cwd: fixtureDir, argv, branch, message },
      null,
      2
    )
  );
  process.exit(0);
}

try {
  if (!env("MANUFACT_TOKEN") || !env("MANUFACT_ORG"))
    throw new HarnessError(
      "infra",
      "MANUFACT_TOKEN and MANUFACT_ORG are required with --execute"
    );
  if (!existsSync(cli))
    execFileSync("npm", ["ci", "--no-audit", "--no-fund"], {
      cwd: fixtureDir,
      stdio: "inherit",
    });

  // Live-deployment cap.
  const capDeadline = Date.now() + matrix.caps.capWaitMs;
  for (;;) {
    const listed = mcpUse([
      "deployments",
      "list",
      "--server",
      matrix.servers.app,
      "--json",
    ]);
    const items = Array.isArray(listed)
      ? listed
      : (listed.items ?? listed.deployments ?? []);
    const live = items.filter(
      (d) =>
        // Per-run branches only: PR dev spaces are long-lived and the janitor ages them out.
        isJanitorBranch(d.branch ?? "") &&
        !isPrBranch(d.branch ?? "") &&
        ["running", "building", "pending"].includes(d.status)
    );
    if (live.length < matrix.caps.liveDeployments) break;
    if (Date.now() > capDeadline)
      throw new HarnessError(
        "infra",
        `live deployment cap (${live.length}) did not clear`
      );
    await new Promise((r) => setTimeout(r, 30_000));
  }

  const deployed = mcpUse(argv);
  const deployment = deployed.deployment ?? deployed;
  if (deployment.status !== "running")
    throw new HarnessError(
      "infra",
      `deployment ${deployment.id} ended ${deployment.status}`,
      deployment.failureMeta
    );
  const got = mcpUse(["deployments", "get", deployment.id, "--json"]);
  const uploaded = deployed.commitSha ?? deployment.commitSha;
  if (uploaded && got.gitCommitSha !== uploaded)
    throw new HarnessError(
      "product",
      `gitCommitSha ${got.gitCommitSha} differs from uploaded ${uploaded}`
    );
  writeFileSync(
    join(fixtureDir, "deployment.json"),
    `${JSON.stringify({ branch, ...got }, null, 2)}\n`
  );
  console.log(
    JSON.stringify({
      branch,
      id: got.id,
      url: got.url ?? deployment.url,
      status: got.status,
    })
  );
} catch (error) {
  const failureClass =
    error instanceof HarnessError ? error.failureClass : "infra";
  console.error(`[${failureClass}] ${error.message}`);
  process.exit(1);
}
