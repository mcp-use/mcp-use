import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("optional peer dependency contract", () => {
  it("uses the modern Langfuse adapter compatible with LangChain 1.x", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    );

    expect(manifest.peerDependencies["@langfuse/langchain"]).toBe("~5.9.0");
    expect(manifest.peerDependenciesMeta["@langfuse/langchain"]?.optional).toBe(
      true
    );
    expect(manifest.peerDependencies["langfuse-langchain"]).toBeUndefined();
    expect(manifest.peerDependenciesMeta["langfuse-langchain"]).toBeUndefined();
  });
});
