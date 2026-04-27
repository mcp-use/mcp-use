import { describe, it, expect } from "vitest";
import { sanitizePackageName, isSafeEntry } from "../utils.js";

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
    // e.g., basename of /home/user/My Project Dir
    expect(sanitizePackageName("My Project Dir")).toBe("my-project-dir");
  });

  it("handles already-valid names unchanged", () => {
    expect(sanitizePackageName("my-app")).toBe("my-app");
    expect(sanitizePackageName("my_app")).toBe("my_app");
    expect(sanitizePackageName("myapp123")).toBe("myapp123");
  });
});

describe("isSafeEntry", () => {
  it("recognizes .git as safe", () => {
    expect(isSafeEntry(".git")).toBe(true);
  });

  it("recognizes .gitignore as safe", () => {
    expect(isSafeEntry(".gitignore")).toBe(true);
  });

  it("recognizes LICENSE as safe", () => {
    expect(isSafeEntry("LICENSE")).toBe(true);
  });

  it("recognizes README and README.md as safe", () => {
    expect(isSafeEntry("README")).toBe(true);
    expect(isSafeEntry("README.md")).toBe(true);
    expect(isSafeEntry("README.txt")).toBe(true);
  });

  it("recognizes .DS_Store as safe", () => {
    expect(isSafeEntry(".DS_Store")).toBe(true);
  });

  it("recognizes IDE directories as safe", () => {
    expect(isSafeEntry(".idea")).toBe(true);
    expect(isSafeEntry(".vscode")).toBe(true);
  });

  it("recognizes Thumbs.db as safe", () => {
    expect(isSafeEntry("Thumbs.db")).toBe(true);
  });

  it("rejects project files as unsafe", () => {
    expect(isSafeEntry("package.json")).toBe(false);
    expect(isSafeEntry("index.ts")).toBe(false);
    expect(isSafeEntry("node_modules")).toBe(false);
    expect(isSafeEntry("src")).toBe(false);
  });
});
