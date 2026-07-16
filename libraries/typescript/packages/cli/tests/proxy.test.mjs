import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("delegates the compatibility binary to mcp-use", async () => {
  const serverPackage = JSON.parse(
    await readFile(
      new URL("../../server/package.json", import.meta.url),
      "utf8"
    )
  );
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [new URL("../dist/index.js", import.meta.url).pathname, "--version"],
    { cwd: new URL("..", import.meta.url) }
  );

  assert.equal(stderr, "");
  assert.equal(stdout.trim(), serverPackage.version);
});
