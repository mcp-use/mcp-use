import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
const packageDir = join(__dirname, "..");

describe("mcp-use/browser optional peer boundary", () => {
  it("does not statically re-export LangChain-backed modules from the browser entry", () => {
    const browserSource = readFileSync(
      join(packageDir, "src", "browser.ts"),
      "utf-8"
    );

    const forbiddenExports: Array<{ name: string; re: RegExp }> = [
      {
        name: "MCPAgent from ./agents/mcp_agent.js",
        re: /export\s*\{[^}]*\bMCPAgent\b[^}]*\}\s*from\s*["']\.\/agents\/mcp_agent\.js["']/,
      },
      {
        name: "adapter barrel from ./adapters/index.js",
        re: /from\s*["']\.\/adapters\/index\.js["']/,
      },
      {
        name: "agent utility barrel from ./agents/utils/index.js",
        re: /export\s+\*\s+from\s*["']\.\/agents\/utils\/index\.js["']/,
      },
      {
        name: "observability barrel from ./observability/index.js",
        re: /from\s*["']\.\/observability\/index\.js["']/,
      },
    ];

    const failures = forbiddenExports
      .filter(({ re }) => re.test(browserSource))
      .map(({ name }) => name);

    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("provides a dedicated browser agent subpath for LangChain-backed exports", () => {
    const pkgJson = JSON.parse(
      readFileSync(join(packageDir, "package.json"), "utf-8")
    );

    expect(pkgJson.exports["./browser/agent"]).toEqual({
      types: "./dist/src/browser-agent.d.ts",
      import: "./dist/src/browser-agent.js",
      require: "./dist/src/browser-agent.cjs",
    });

    const browserAgentSource = readFileSync(
      join(packageDir, "src", "browser-agent.ts"),
      "utf-8"
    );
    expect(browserAgentSource).toMatch(/\bMCPAgent\b/);
    expect(browserAgentSource).toMatch(/\bRemoteAgent\b/);
    expect(browserAgentSource).toMatch(/\bObservabilityManager\b/);
  });

  it("built browser entries and declarations have no optional peer imports", () => {
    const browserEntry = join(packageDir, "dist", "src", "browser.js");
    const browserCjsEntry = join(packageDir, "dist", "src", "browser.cjs");
    const browserDtsEntry = join(packageDir, "dist", "src", "browser.d.ts");
    if (!existsSync(browserEntry) || !existsSync(browserCjsEntry)) {
      throw new Error("Built browser JS entries not found. Run build first.");
    }
    if (!existsSync(browserDtsEntry)) {
      throw new Error("Built browser declarations not found. Run build first.");
    }

    const dependencyFiles = [
      ...collectDependencyFiles(browserEntry),
      browserCjsEntry,
    ];
    const failures: string[] = [];

    for (const file of dependencyFiles) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (const [index, line] of lines.entries()) {
        if (hasOptionalPeerBoundarySpecifier(line)) {
          failures.push(`${relative(file)}:${index + 1}: ${line.trim()}`);
        }
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);

    const browserDts = readFileSync(browserDtsEntry, "utf-8");
    expect(browserDts).not.toMatch(/from\s*["']@langchain\//);
    expect(browserDts).not.toMatch(/from\s*["']langchain(?:["'/])/);
    expect(browserDts).not.toMatch(/from\s*["']langfuse(?:["'/])/);
    expect(browserDts).not.toMatch(/\bexport\b[^;]*\bMCPAgent\b/);
    expect(browserDts).not.toMatch(/\bexport\b[^;]*\bLangChainAdapter\b/);
    expect(browserDts).not.toMatch(/\bexport\b[^;]*\bObservabilityManager\b/);
  });

  it("built browser entry omits MCPAgent and browser agent subpath keeps it available", async () => {
    const browserCjsEntry = join(packageDir, "dist", "src", "browser.cjs");
    const browserAgentEntry = join(
      packageDir,
      "dist",
      "src",
      "browser-agent.js"
    );
    const browserAgentCjsEntry = join(
      packageDir,
      "dist",
      "src",
      "browser-agent.cjs"
    );
    if (
      !existsSync(browserCjsEntry) ||
      !existsSync(browserAgentEntry) ||
      !existsSync(browserAgentCjsEntry)
    ) {
      throw new Error(
        "Built browser agent entries not found. Run build first."
      );
    }

    const browser = require(browserCjsEntry);
    expect(browser.MCPAgent).toBeUndefined();
    expect(browser.ObservabilityManager).toBeUndefined();
    expect(browser.MCPClient).toBeDefined();
    expect(browser.RemoteAgent).toBeUndefined();
    expect(browser.BaseAdapter).toBeUndefined();

    const browserAgent = await import(pathToFileURL(browserAgentEntry).href);
    expect(browserAgent.MCPAgent).toBeDefined();
    expect(browserAgent.RemoteAgent).toBeDefined();
    expect(browserAgent.ObservabilityManager).toBeDefined();

    const browserAgentCjs = require(browserAgentCjsEntry);
    expect(browserAgentCjs.MCPAgent).toBeDefined();
    expect(browserAgentCjs.RemoteAgent).toBeDefined();
    expect(browserAgentCjs.ObservabilityManager).toBeDefined();
  });
});

function hasOptionalPeerBoundarySpecifier(line: string): boolean {
  return (
    /(?:from\s*|import\(\s*|(?:__)?require\(\s*)["']@langchain\//.test(line) ||
    /(?:from\s*|import\(\s*|(?:__)?require\(\s*)["']langchain(?:["'/])/.test(
      line
    ) ||
    /(?:from\s*|import\(\s*|(?:__)?require\(\s*)["']langfuse(?:["'/])/.test(
      line
    )
  );
}

function collectDependencyFiles(
  entryFile: string,
  visited: Set<string> = new Set()
): string[] {
  if (visited.has(entryFile)) {
    return [];
  }
  visited.add(entryFile);

  const files = [entryFile];
  const content = readFileSync(entryFile, "utf-8");
  const specifiers = extractModuleSpecifiers(content);

  for (const specifier of specifiers) {
    if (!specifier.startsWith(".") && !specifier.startsWith("../")) {
      continue;
    }

    const resolved = resolveRelativeJsFile(entryFile, specifier);
    if (!resolved) {
      continue;
    }

    files.push(...collectDependencyFiles(resolved, visited));
  }

  return files;
}

function extractModuleSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const importExportPattern =
    /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  const requirePattern = /(?:__)?require\(\s*["']([^"']+)["']\s*\)/g;
  const dynamicImportPattern = /import\(\s*["']([^"']+)["']\s*\)/g;

  for (const pattern of [
    importExportPattern,
    requirePattern,
    dynamicImportPattern,
  ]) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

function resolveRelativeJsFile(
  fromFile: string,
  specifier: string
): string | null {
  const base = join(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.cjs`,
    join(base, "index.js"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function relative(path: string): string {
  return path.replace(`${packageDir}/`, "");
}
