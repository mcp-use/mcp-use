import { describe, expect, it } from "vitest";

/**
 * Test the multi-line import parsing logic from generate.ts
 * This tests the stateful scanner that handles imports spanning multiple lines
 */
describe("multi-line import handling", () => {
  // Simulate the logic from generate.ts
  function extractImportsAndBody(code: string): {
    imports: string[];
    body: string;
  } {
    const lines = code.split("\n");
    let bodyStartIndex = 0;
    let inImport = false;
    const currentImportLines: string[] = [];
    const importLines = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const trimmed = line.trim();

      if (trimmed.startsWith("import ")) {
        inImport = true;
        currentImportLines.push(line);

        if (trimmed.endsWith(";")) {
          importLines.add(currentImportLines.join("\n"));
          currentImportLines.length = 0;
          inImport = false;
        }
      } else if (inImport) {
        currentImportLines.push(line);

        if (trimmed.endsWith(";")) {
          importLines.add(currentImportLines.join("\n"));
          currentImportLines.length = 0;
          inImport = false;
        }
      } else if (trimmed && !trimmed.startsWith("//")) {
        bodyStartIndex = i;
        break;
      }
    }

    const body = lines.slice(bodyStartIndex).join("\n").trim();
    return { imports: Array.from(importLines), body };
  }

  it("handles single-line imports correctly", () => {
    const code = `import { describe, it } from "vitest";
import { expect } from "vitest";

describe("test", () => {
  it("works", () => {});
});`;

    const result = extractImportsAndBody(code);
    expect(result.imports).toHaveLength(2);
    expect(result.imports).toContain('import { describe, it } from "vitest";');
    expect(result.imports).toContain('import { expect } from "vitest";');
    expect(result.body).toContain('describe("test"');
  });

  it("handles multi-line imports with multiple named imports", () => {
    const code = `import {
  describe,
  it,
  expect,
  beforeAll
} from "vitest";

describe("test", () => {
  it("works", () => {});
});`;

    const result = extractImportsAndBody(code);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]).toContain("describe");
    expect(result.imports[0]).toContain("expect");
    expect(result.imports[0]).toContain("beforeAll");
    expect(result.body).toContain('describe("test"');
    expect(result.body).not.toContain("import");
  });

  it("handles mix of single-line and multi-line imports", () => {
    const code = `import { describe, it } from "vitest";
import {
  createEvalAgent,
  judge
} from "@mcp-use/evals";
import type { EvalAgent } from "@mcp-use/evals";

describe("test", () => {});`;

    const result = extractImportsAndBody(code);
    expect(result.imports).toHaveLength(3);
    expect(result.body).toContain('describe("test"');
    expect(result.body).not.toContain("import");
  });

  it("handles type-only imports", () => {
    const code = `import type {
  EvalAgent,
  TokenUsage
} from "@mcp-use/evals";

const agent: EvalAgent = null as any;`;

    const result = extractImportsAndBody(code);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]).toContain("type");
    expect(result.imports[0]).toContain("EvalAgent");
    expect(result.body).toContain("const agent");
  });

  it("ignores comments before body", () => {
    const code = `import { describe } from "vitest";

// This is a comment
// Another comment

describe("test", () => {});`;

    const result = extractImportsAndBody(code);
    expect(result.imports).toHaveLength(1);
    expect(result.body).toContain('describe("test"');
  });

  it("handles imports with inline comments", () => {
    const code = `import {
  describe, // test framework
  it,
  expect // assertions
} from "vitest";

describe("test", () => {});`;

    const result = extractImportsAndBody(code);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]).toContain("describe");
    expect(result.body).toContain('describe("test"');
  });

  it("handles empty lines between imports", () => {
    const code = `import { describe } from "vitest";

import { expect } from "vitest";

describe("test", () => {});`;

    const result = extractImportsAndBody(code);
    expect(result.imports).toHaveLength(2);
    expect(result.body).toContain('describe("test"');
  });

  it("handles deeply nested multi-line import", () => {
    const code = `import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi
} from "vitest";

describe("test", () => {});`;

    const result = extractImportsAndBody(code);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]).toMatch(/vi.*vitest/s); // 's' flag for multiline
    expect(result.body).toContain('describe("test"');
  });
});
