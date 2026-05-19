import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveProjectInfo,
  findUnsafeEntries,
  isSafeEntry,
  sanitizePackageName,
  updateIndexTs,
  updatePackageJson,
} from "../utils.js";

describe("sanitizePackageName", () => {
  it("lowercases uppercase names", () => {
    expect(sanitizePackageName("My-Project")).toBe("my-project");
  });

  it("replaces spaces with hyphens", () => {
    expect(sanitizePackageName("my cool project")).toBe("my-cool-project");
  });

  it("replaces special characters with hyphens", () => {
    expect(sanitizePackageName("my@project!name")).toBe("my-project-name");
  });

  it("trims leading dots and dashes", () => {
    expect(sanitizePackageName("..my-project")).toBe("my-project");
    expect(sanitizePackageName("--my-project")).toBe("my-project");
    expect(sanitizePackageName(".-my-project")).toBe("my-project");
  });

  it("trims trailing dots and dashes", () => {
    expect(sanitizePackageName("my-project..")).toBe("my-project");
    expect(sanitizePackageName("my-project--")).toBe("my-project");
  });

  it("preserves valid npm name characters", () => {
    expect(sanitizePackageName("my-project_v1.0")).toBe("my-project_v1.0");
  });

  it("returns fallback for names that become empty", () => {
    expect(sanitizePackageName("...")).toBe("my-app");
    expect(sanitizePackageName("@@@")).toBe("my-app");
  });

  it("handles typical basename from cwd", () => {
    expect(sanitizePackageName("My Project Dir")).toBe("my-project-dir");
  });

  it("handles already-valid names unchanged", () => {
    expect(sanitizePackageName("my-app")).toBe("my-app");
    expect(sanitizePackageName("my_app")).toBe("my_app");
    expect(sanitizePackageName("myapp123")).toBe("myapp123");
  });

  it("strips characters that would break a TS string literal", () => {
    // The contract is "safe to embed inside a double-quoted TS string literal".
    // Asserting that property keeps the test resilient to regex-order tweaks.
    for (const raw of ['proj "copy"', "proj\\foo", "proj\nfoo"]) {
      const out = sanitizePackageName(raw);
      expect(out).toMatch(/^[a-z0-9_.-]+$/);
      expect(out).not.toContain('"');
      expect(out).not.toContain("\\");
      expect(out).not.toContain("\n");
    }
  });
});

describe("isSafeEntry", () => {
  // Spot-check; exhaustive enumeration would just re-test the contents of
  // SAFE_DIR_ENTRIES, which is data, not behavior.
  it("recognizes representative safe entries", () => {
    for (const name of [".git", ".vscode", ".DS_Store", "LICENSE"]) {
      expect(isSafeEntry(name)).toBe(true);
    }
  });

  it("rejects project files (would clash with the template)", () => {
    for (const name of ["package.json", "index.ts", "node_modules", "src"]) {
      expect(isSafeEntry(name)).toBe(false);
    }
    // README is intentionally not on the allow list.
    expect(isSafeEntry("README.md")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(isSafeEntry("license")).toBe(false);
    expect(isSafeEntry(".DS_STORE")).toBe(false);
  });
});

describe("findUnsafeEntries (real tmpdirs)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "create-mcp-use-app-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns [] for an empty directory", () => {
    expect(findUnsafeEntries(dir)).toEqual([]);
  });

  it("returns [] when only safe entries are present", () => {
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".gitignore"), "");
    writeFileSync(join(dir, "LICENSE"), "MIT");
    writeFileSync(join(dir, ".DS_Store"), "");
    expect(findUnsafeEntries(dir)).toEqual([]);
  });

  it("returns unsafe entries sorted, alongside safe ones", () => {
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, "package.json"), "{}");
    writeFileSync(join(dir, "README.md"), "");
    mkdirSync(join(dir, "src"));
    expect(findUnsafeEntries(dir)).toEqual([
      "README.md",
      "package.json",
      "src",
    ]);
  });
});

describe("deriveProjectInfo", () => {
  it("treats '.' as use-current-directory", () => {
    const info = deriveProjectInfo(".", "/tmp/My Project");
    expect(info.useCurrentDir).toBe(true);
    expect(info.projectPath).toBe("/tmp/My Project");
    expect(info.displayName).toBe("My Project");
    // Sanitized so package.json + index.ts string literal stay valid
    expect(info.packageName).toBe("my-project");
  });

  it("treats a normal name as a subdirectory", () => {
    const info = deriveProjectInfo("my-app", "/tmp");
    expect(info.useCurrentDir).toBe(false);
    expect(info.projectPath).toBe("/tmp/my-app");
    expect(info.displayName).toBe("my-app");
    expect(info.packageName).toBe("my-app");
  });
});

// End-to-end: simulates the actual file-mutation step the CLI runs against a
// scratch directory shaped like a copied template. Verifies that the value
// flowed into both files is npm-safe and produces a parseable index.ts.
describe("template file updates against a tmpdir fixture", () => {
  let dir: string;

  const writeFixture = () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "placeholder", description: "" }, null, 2)
    );
    writeFileSync(
      join(dir, "index.ts"),
      `export const server = {\n  name: "{{PROJECT_NAME}}",\n  title: "{{PROJECT_NAME}}",\n};\n`
    );
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "create-mcp-use-app-fixture-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("'.' end-to-end: derives info, writes package.json + index.ts with the sanitized name", () => {
    const info = deriveProjectInfo(".", "/scratch/My App!");
    expect(info.packageName).toBe("my-app");

    writeFixture();
    updatePackageJson(dir, info.packageName);
    updateIndexTs(dir, info.packageName);

    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkg.name).toBe("my-app");
    expect(pkg.description).toBe("MCP server: my-app");

    const indexContent = readFileSync(join(dir, "index.ts"), "utf-8");
    expect(indexContent).toContain('name: "my-app"');
    expect(indexContent).toContain('title: "my-app"');
    expect(indexContent).not.toContain("{{PROJECT_NAME}}");
  });

  it("regression: a basename with quotes flows the sanitized name into index.ts (not the raw one)", () => {
    // Before the fix, updateIndexTs received the raw displayName, so a cwd
    // basename like 'My "App"' produced index.ts content `name: "My "App""` —
    // invalid TypeScript. The sanitized packageName must be used instead.
    const info = deriveProjectInfo(".", '/scratch/My "App"');
    expect(info.displayName).toBe('My "App"');
    expect(info.packageName).not.toContain('"');

    writeFixture();
    updateIndexTs(dir, info.packageName);

    const indexContent = readFileSync(join(dir, "index.ts"), "utf-8");
    const match = indexContent.match(/name: "([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(info.packageName);
  });
});
