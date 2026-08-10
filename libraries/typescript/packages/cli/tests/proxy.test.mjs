import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("runs the standalone prebuilt CLI with its own version", async () => {
  const cliPackage = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [fileURLToPath(new URL("../dist/bin.js", import.meta.url)), "--version"],
    { cwd: fileURLToPath(new URL("..", import.meta.url)) }
  );

  assert.equal(stderr, "");
  assert.equal(stdout.trim(), cliPackage.version);
});

test("runs the mcp-use compatibility bin with the framework version", async () => {
  const cliPackage = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );
  const serverPackageUrl = new URL(
    "../../server/package.json",
    import.meta.url
  );
  const serverPackage = JSON.parse(await readFile(serverPackageUrl, "utf8"));

  assert.deepEqual(serverPackage.bin, { "mcp-use": "./dist/bin.js" });
  assert.deepEqual(cliPackage.bin, { "mcp-use": "./dist/bin.js" });

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      fileURLToPath(new URL("../../server/dist/bin.js", import.meta.url)),
      "--version",
    ],
    { cwd: fileURLToPath(new URL("../../server", import.meta.url)) }
  );

  assert.equal(stderr, "");
  assert.equal(stdout.trim(), serverPackage.version);
});

test(
  "packed npm bin reports the owning framework version",
  { skip: process.platform === "win32" },
  async (t) => {
    const cliRoot = fileURLToPath(new URL("..", import.meta.url));
    const serverRoot = fileURLToPath(new URL("../../server", import.meta.url));
    const scratch = await mkdtemp(join(tmpdir(), "mcp-use-cli-bin-"));
    const artifacts = join(scratch, "artifacts");
    const consumer = join(scratch, "consumer");
    t.after(() => rm(scratch, { recursive: true, force: true }));
    await mkdir(artifacts);
    await mkdir(consumer);
    await writeFile(
      join(consumer, "package.json"),
      `${JSON.stringify({ name: "packed-bin-test", private: true })}\n`
    );

    const pack = async (cwd) => {
      const { stdout } = await execFileAsync(
        "pnpm",
        ["pack", "--pack-destination", artifacts, "--json"],
        { cwd }
      );
      return JSON.parse(stdout).filename;
    };
    const cliTarball = await pack(cliRoot);
    const serverTarball = await pack(serverRoot);
    await execFileAsync(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        cliTarball,
        serverTarball,
      ],
      { cwd: consumer }
    );

    const cliPackage = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    );
    const serverPackage = JSON.parse(
      await readFile(
        new URL("../../server/package.json", import.meta.url),
        "utf8"
      )
    );
    const npmBin = join(consumer, "node_modules", ".bin", "mcp-use");
    const installedCliBin = join(
      consumer,
      "node_modules",
      "@mcp-use",
      "cli",
      "dist",
      "bin.js"
    );
    const linked = await execFileAsync(npmBin, ["--version"], {
      cwd: consumer,
    });
    const collided = await execFileAsync(
      process.execPath,
      [installedCliBin, "--version"],
      { cwd: consumer }
    );

    assert.notEqual(cliPackage.version, serverPackage.version);
    assert.equal(linked.stderr, "");
    assert.equal(linked.stdout.trim(), serverPackage.version);
    assert.equal(collided.stderr, "");
    assert.equal(collided.stdout.trim(), serverPackage.version);
  }
);
