import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const packageRoot = resolve(import.meta.dirname, "../..");
const manifestPath = join(packageRoot, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

test("client package declares and exports the provider-utils adapter", () => {
  assert.equal(manifest.dependencies["@ai-sdk/provider-utils"], "^4.0.19");
  assert.equal(manifest.peerDependencies["@ai-sdk/provider-utils"], undefined);
  assert.equal(manifest.dependencies.ai, undefined);
  assert.equal(manifest.peerDependencies.ai, undefined);
  assert.equal(manifest.dependencies["@modelcontextprotocol/sdk"], undefined);
  assert.equal(manifest.exports["."]["node"].import, "./dist/index.js");
  assert.equal(
    manifest.exports["."]["browser"].import,
    "./dist/index-browser.js"
  );
});

test("built Node and browser declarations expose the adapter", () => {
  const nodeDeclaration = join(packageRoot, "dist/index.d.ts");
  const browserDeclaration = join(packageRoot, "dist/index-browser.d.ts");
  const adapterDeclaration = join(packageRoot, "dist/adapters/ai-sdk.d.ts");
  assert.ok(existsSync(nodeDeclaration), "run the client build first");
  assert.ok(existsSync(browserDeclaration), "run the client build first");
  assert.ok(existsSync(adapterDeclaration), "run the client build first");
  assert.match(readFileSync(nodeDeclaration, "utf8"), /adapters\/ai-sdk/);
  assert.match(readFileSync(browserDeclaration, "utf8"), /adapters\/ai-sdk/);
  assert.match(readFileSync(adapterDeclaration, "utf8"), /createAiSdkTools/);
});

test("packed client imports without the full ai package", () => {
  const scratch = mkdtempSync(join(tmpdir(), "mcp-use-client-pack-"));
  const artifactDirectory = join(scratch, "artifact");
  const consumerDirectory = join(scratch, "consumer");

  try {
    mkdirSync(artifactDirectory);
    mkdirSync(consumerDirectory);
    writeFileSync(
      join(consumerDirectory, "package.json"),
      JSON.stringify({
        name: "mcp-use-client-packed-consumer",
        private: true,
        type: "module",
      })
    );
    const packOutput = execFileSync(
      "pnpm",
      ["pack", "--pack-destination", artifactDirectory, "--json"],
      { cwd: packageRoot, encoding: "utf8" }
    );
    const packed = JSON.parse(packOutput);
    const artifact = Array.isArray(packed)
      ? packed[0]?.filename
      : packed.filename;
    assert.ok(artifact, "pnpm pack did not return an artifact");

    execFileSync(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        artifact,
      ],
      { cwd: consumerDirectory, stdio: "pipe" }
    );

    const importedType = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'const client = await import("@mcp-use/client"); if (typeof client.createAiSdkTools !== "function") process.exit(1); console.log("ok")',
      ],
      { cwd: consumerDirectory, encoding: "utf8" }
    ).trim();
    assert.equal(existsSync(join(consumerDirectory, "node_modules/ai")), false);
    assert.equal(
      existsSync(
        join(consumerDirectory, "node_modules/@ai-sdk/provider-utils")
      ),
      true
    );
    assert.equal(importedType, "ok");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
