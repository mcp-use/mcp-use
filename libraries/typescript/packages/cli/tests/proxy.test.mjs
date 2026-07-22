import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("runs the prebuilt CLI with the framework version", async () => {
  const serverPackage = JSON.parse(
    await readFile(
      new URL("../../server/package.json", import.meta.url),
      "utf8"
    )
  );
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [fileURLToPath(new URL("../dist/bin.js", import.meta.url)), "--version"],
    { cwd: fileURLToPath(new URL("..", import.meta.url)) }
  );

  assert.equal(stderr, "");
  assert.equal(stdout.trim(), serverPackage.version);
});
