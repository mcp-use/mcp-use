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
  it("recognizes git artifacts as safe", () => {
    expect(isSafeEntry(".git")).toBe(true);
    expect(isSafeEntry(".gitignore")).toBe(true);
    expect(isSafeEntry(".gitattributes")).toBe(true);
    expect(isSafeEntry(".gitlab-ci.yml")).toBe(true);
  });

  it("recognizes mercurial artifacts as safe", () => {
    expect(isSafeEntry(".hg")).toBe(true);
    expect(isSafeEntry(".hgcheck")).toBe(true);
    expect(isSafeEntry(".hgignore")).toBe(true);
  });

  it("recognizes editor and AI tool directories as safe", () => {
    expect(isSafeEntry(".idea")).toBe(true);
    expect(isSafeEntry(".vscode")).toBe(true);
    expect(isSafeEntry(".zed")).toBe(true);
    expect(isSafeEntry(".claude")).toBe(true);
    expect(isSafeEntry(".cursor")).toBe(true);
  });

  it("recognizes OS-generated files as safe", () => {
    expect(isSafeEntry(".DS_Store")).toBe(true);
    expect(isSafeEntry("Thumbs.db")).toBe(true);
  });

  it("recognizes CI / package manager artifacts as safe", () => {
    expect(isSafeEntry(".travis.yml")).toBe(true);
    expect(isSafeEntry(".npmignore")).toBe(true);
    expect(isSafeEntry("yarnrc.yml")).toBe(true);
    expect(isSafeEntry(".yarn")).toBe(true);
    expect(isSafeEntry("npm-debug.log")).toBe(true);
    expect(isSafeEntry("yarn-debug.log")).toBe(true);
    expect(isSafeEntry("yarn-error.log")).toBe(true);
  });

  it("recognizes docs artifacts as safe", () => {
    expect(isSafeEntry("LICENSE")).toBe(true);
    expect(isSafeEntry("docs")).toBe(true);
    expect(isSafeEntry("mkdocs.yml")).toBe(true);
  });

  it("rejects project files as unsafe", () => {
    expect(isSafeEntry("package.json")).toBe(false);
    expect(isSafeEntry("index.ts")).toBe(false);
    expect(isSafeEntry("node_modules")).toBe(false);
    expect(isSafeEntry("src")).toBe(false);
  });

  it("rejects README (not on the allow list)", () => {
    expect(isSafeEntry("README")).toBe(false);
    expect(isSafeEntry("README.md")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(isSafeEntry("license")).toBe(false);
    expect(isSafeEntry(".DS_STORE")).toBe(false);
  });
});
