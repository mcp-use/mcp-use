import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const helper = new URL("./dev-server-smoke.mjs", import.meta.url);
const fixture = `
const { spawn } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const { createServer } = require('node:http');
appendFileSync('pids', process.pid + '\\n');
process.on('SIGTERM', () => {}); // Verify forceful cleanup of stubborn children.
const mode = process.env.FIXTURE_MODE;
const role = process.argv[2];
if (!role) {
  if (mode === 'exit-zero') process.exit(0);
  if (mode === 'crash') {
    console.error('fixture startup failed');
    process.exit(23);
  }
  if (mode === 'timeout') console.error('fixture never became ready');
  const child = spawn(process.execPath, [__filename, 'worker'], { stdio: 'inherit' });
  if (mode === 'orphan') {
    child.unref();
    setTimeout(() => process.exit(17), 300);
  }
} else if (role === 'worker') {
  // This intermediate process exits in the orphan case. Its child must still
  // be cleaned up after the package manager has exited.
  const child = spawn(process.execPath, [__filename, 'leaf'], { stdio: 'inherit' });
  if (mode === 'orphan') { child.unref(); setTimeout(() => process.exit(0), 100); }
} else if (mode !== 'timeout' && mode !== 'orphan') {
  createServer((req, res) => {
    if (mode === 'hang') return;
    res.writeHead(mode === 'wrong-status' ? 503 : 204);
    res.end();
    if (mode === 'ready-then-crash') setTimeout(() => process.exit(19), 50);
  }).listen(Number(process.env.PORT), '127.0.0.1', () => console.log('fixture listening'));
}
setInterval(() => {}, 1000);
`;

async function runFixture(
  t,
  mode,
  { direct = false, abort = false, command, pm = "npm" } = {},
) {
  // Spaces exercise Windows command/path handling too.
  const cwd = mkdtempSync(join(tmpdir(), "mcp smoke fixture "));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "dev-smoke-fixture",
      private: true,
      scripts: { dev: command ?? "node fixture.cjs" },
    }),
  );
  writeFileSync(join(cwd, "fixture.cjs"), fixture);
  const code = `
    import { smokeTest } from ${JSON.stringify(helper.href)};
    const controller = new AbortController();
    ${abort ? "setTimeout(() => controller.abort(new Error('fixture interruption')), 3500);" : ""}
    try {
      await smokeTest({ pm: ${JSON.stringify(pm)}, timeoutMs: 5000, stableMs: 600, signal: controller.signal });
      console.log('SMOKE PASSED');
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  `;
  const child = spawn(
    process.execPath,
    direct
      ? [fileURLToPath(helper), pm]
      : ["--input-type=module", "--eval", code],
    {
      cwd,
      env: { ...process.env, FIXTURE_MODE: mode },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Smoke helper hung:\n${output}`));
    }, 20_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, output });
    });
  });
  // Check descendants individually; closed output pipes alone do not prove
  // that children which close/redirect their output have stopped.
  if (existsSync(join(cwd, "pids"))) {
    const pids = readFileSync(join(cwd, "pids"), "utf8")
      .trim()
      .split("\n")
      .map(Number);
    for (const pid of pids) {
      const deadline = Date.now() + 5000;
      while (alive(pid) && Date.now() < deadline) await delay(50);
      assert.equal(
        alive(pid),
        false,
        `Leaked fixture process ${pid}\n${output}`,
      );
    }
  }
  return result;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

for (const pm of (process.env.SMOKE_TEST_PACKAGE_MANAGERS ?? "npm").split(
  ",",
)) {
  test(`${pm}: a real ready server passes and cleans up children/grandchildren`, async (t) => {
    const unrelated = createServer((req, res) => {
      res.writeHead(204);
      res.end();
    });
    await new Promise((resolve) => unrelated.listen(0, "127.0.0.1", resolve));
    t.after(() => unrelated.close());
    const url = `http://127.0.0.1:${unrelated.address().port}`;
    const result = await runFixture(t, "ready", { pm, direct: true });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /became ready.*cleaned up successfully/);
    assert.equal(
      (await fetch(url)).status,
      204,
      "unrelated listener must survive",
    );
  });
}

test("a missing executable fails the actual CLI with useful logs", async (t) => {
  const result = await runFixture(t, "unused", {
    direct: true,
    command: "mcp-use-intentionally-missing",
  });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Dev command exited/);
  assert.match(result.output, /mcp-use-intentionally-missing/);
  assert.match(result.output, /dev server logs/);
  assert.doesNotMatch(result.output, /cleaned up successfully/);
});

for (const mode of ["crash", "exit-zero", "orphan"]) {
  test(`${mode}: early exit fails and orphaned descendants are cleaned up`, async (t) => {
    const result = await runFixture(t, mode);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Dev command exited/);
    if (mode === "crash") assert.match(result.output, /fixture startup failed/);
  });
}

for (const mode of ["timeout", "wrong-status", "hang", "ready-then-crash"]) {
  test(`${mode}: readiness must remain healthy within the deadline`, async (t) => {
    const result = await runFixture(t, mode);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Readiness timeout/);
    if (mode === "wrong-status") assert.match(result.output, /HTTP 503/);
    if (mode === "timeout")
      assert.match(result.output, /fixture never became ready/);
  });
}

test("interruption fails and cleans up the process tree", async (t) => {
  const result = await runFixture(t, "timeout", { abort: true });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /fixture interruption/);
});

test("a missing package manager fails rather than timing out", async (t) => {
  const previous = process.env.PATH;
  process.env.PATH = "";
  try {
    const result = await runFixture(t, "unused");
    assert.equal(result.code, 1, result.output);
    // On Windows the native supervisor cannot be resolved with an empty PATH.
    assert.match(result.output, /launch error|Dev command exited/);
    assert.doesNotMatch(result.output, /Readiness timeout/);
  } finally {
    process.env.PATH = previous;
  }
});
