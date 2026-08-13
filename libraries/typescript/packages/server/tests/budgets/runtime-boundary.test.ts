import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const loader = fileURLToPath(
  new URL("./module-trace-loader.mjs", import.meta.url)
);
const entry = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

interface Resolution {
  url: string;
  parentURL: string | null;
}

describe("runtime package boundaries", () => {
  it("loads the edge entry without Node builtins under workerd conditions", async () => {
    const resolutions = await traceImport(["--conditions=workerd"]);

    expect(builtinResolutions(resolutions)).toEqual([]);
    expect(
      resolutions.some(({ url }) => url.includes("shimsWorkerd.mjs"))
    ).toBe(true);
    expectForbiddenRuntimeModules(resolutions);
  });

  it("loads only the SDK process shim and listen HTTP adapter under Node conditions", async () => {
    const resolutions = await traceImport([]);
    const builtins = builtinResolutions(resolutions);

    // Sorted: the case asserts which builtins load, and resolution order is
    // not guaranteed between them.
    expect(builtins.map(({ url }) => url).sort()).toEqual([
      "node:http",
      "node:process",
    ]);
    expect(
      builtins.find(({ url }) => url === "node:process")?.parentURL
    ).toMatch(/@modelcontextprotocol\/server\/dist\/shimsNode\.mjs$/);
    expect(builtins.find(({ url }) => url === "node:http")?.parentURL).toMatch(
      /dist\/internal\/node-http\.js$/
    );
    expectForbiddenRuntimeModules(resolutions);
  });
});

async function traceImport(extraArgs: string[]): Promise<Resolution[]> {
  const { stderr } = await execFileAsync(
    process.execPath,
    [...extraArgs, "--experimental-loader", loader, entry],
    {
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      maxBuffer: 10 * 1024 * 1024,
    }
  );
  return stderr
    .split("\n")
    .filter((line) => line.startsWith("MCP_USE_RESOLVE "))
    .map(
      (line) => JSON.parse(line.slice("MCP_USE_RESOLVE ".length)) as Resolution
    );
}

function builtinResolutions(resolutions: Resolution[]): Resolution[] {
  const unique = new Map<string, Resolution>();
  for (const resolution of resolutions) {
    if (resolution.url.startsWith("node:")) {
      unique.set(resolution.url, resolution);
    }
  }
  return [...unique.values()];
}

function expectForbiddenRuntimeModules(resolutions: Resolution[]): void {
  const forbidden = resolutions
    .map(({ url }) => url)
    .filter((url) =>
      /@mcp-use\/client|@modelcontextprotocol\/sdk|\/node_modules\/(?:vite|@vitejs)\//.test(
        url
      )
    );
  expect(forbidden).toEqual([]);
}
