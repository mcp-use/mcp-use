import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { it as base } from "./fixtures.js";
import { execFileSync } from "./process.mjs";
import type { TestScope } from "./scope.js";

class GitProjects {
  constructor(private readonly scope: TestScope) {}

  project(name: string): string {
    const cwd = this.scope.directory("deploy-");
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({ name, dependencies: { "mcp-use": "*" } })}\n`
    );
    return cwd;
  }

  init(
    cwd: string,
    remote: string | null = "https://github.com/example/project.git"
  ): void {
    this.run(cwd, "init", "-b", "main");
    this.run(cwd, "config", "user.email", "test@example.com");
    this.run(cwd, "config", "user.name", "CLI Test");
    this.run(cwd, "config", "commit.gpgsign", "false");
    this.run(cwd, "add", ".");
    this.run(cwd, "commit", "-m", "Initial commit");
    if (remote) this.run(cwd, "remote", "add", "origin", remote);
  }

  bare(): string {
    const cwd = this.scope.directory("remote-");
    this.run(cwd, "init", "--bare");
    return cwd;
  }

  run(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8" });
  }
}

export const it = base.extend<{ git: GitProjects }>({
  git: async ({ scope }, use) => {
    await use(new GitProjects(scope));
  },
});
