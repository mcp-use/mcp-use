import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function readAgentManifest() {
  return JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );
}

describe("optional peer dependency contract", () => {
  it("uses the modern Langfuse adapter compatible with LangChain 1.x", async () => {
    const manifest = await readAgentManifest();

    expect(manifest.peerDependencies["@langfuse/langchain"]).toBe("~5.9.0");
    expect(manifest.peerDependenciesMeta["@langfuse/langchain"]?.optional).toBe(
      true
    );
    expect(manifest.peerDependencies["langfuse-langchain"]).toBeUndefined();
    expect(manifest.peerDependenciesMeta["langfuse-langchain"]).toBeUndefined();
  });
});

describe("integration test tooling contract", () => {
  it("declares tsx so integration tests can spawn the local test servers", async () => {
    const manifest = await readAgentManifest();

    // Integration tests pass "tsx" as the server command in mcpServers config;
    // knip cannot see that string usage, so guard against it being removed.
    expect(manifest.devDependencies.tsx).toBeDefined();
  });
});
