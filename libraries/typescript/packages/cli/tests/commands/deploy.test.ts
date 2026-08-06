import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

const { api, cloudApiForOrganization } = vi.hoisted(() => {
  const api = {
    request: vi.fn(),
    multipartRequest: vi.fn(),
  };
  return {
    api,
    cloudApiForOrganization: vi.fn(async () => ({
      api,
      organizationId: "org_1",
    })),
  };
});

vi.mock("../../src/commands/cloud-api.js", () => ({
  cloudApiForOrganization,
  cloudWebUrl: () => "https://cloud.example.test",
}));

import {
  assertManagedArchiveSize,
  runDeploy,
} from "../../src/commands/deploy.js";

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  api.request.mockReset();
  api.multipartRequest.mockReset();
  cloudApiForOrganization.mockClear();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function project(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mcp-use-deploy-"));
  directories.push(directory);
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify({ name, dependencies: { "mcp-use": "*" } })}\n`
  );
  return directory;
}

function initializeRepository(
  directory: string,
  remote: string | null = "https://github.com/example/project.git"
): void {
  execFileSync("git", ["init", "-b", "main"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: directory,
  });
  execFileSync("git", ["config", "user.name", "CLI Test"], {
    cwd: directory,
  });
  execFileSync("git", ["add", "."], { cwd: directory });
  execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: directory });
  if (remote !== null) {
    execFileSync("git", ["remote", "add", "origin", remote], {
      cwd: directory,
    });
  }
}

describe("deploy agent contract", () => {
  it("shows complete offline help without resolving cloud state", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await expect(runDeploy(["--help"])).resolves.toBe(0);

    const output = stdout.mock.calls.flat().join("");
    for (const option of [
      "--org",
      "--name",
      "--branch",
      "--root-dir",
      "--region",
      "--env",
      "--env-file",
      "--build-command",
      "--start-command",
      "--dockerfile",
      "--watch-paths",
      "--wait-for-ci",
      "--no-github",
      "--new",
      "--open",
      "--yes",
      "--json",
      "--help",
    ]) {
      expect(output).toContain(option);
    }
    expect(output).toContain("--json does not authorize mutations");
    expect(output).toContain("Incompatible combinations:");
    expect(output).toContain("Exit codes:");
    expect(cloudApiForOrganization).not.toHaveBeenCalled();
  });

  it("requires an explicit source mode for a headless gitless project", async () => {
    const directory = await project("headless");
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runDeploy([directory, "--json"])).resolves.toBe(2);

    const output = stderr.mock.calls.flat().join("");
    expect(JSON.parse(output)).toEqual({
      error: {
        code: "deployment_mode_required",
        message:
          "No GitHub origin was found. Choose a deployment mode explicitly.",
        details: {
          nextSteps: [
            {
              description: "Upload local source without GitHub",
              command: "mcp-use deploy --no-github",
            },
            {
              description: "Create a private GitHub repository and push",
              command: "mcp-use deploy --yes",
            },
          ],
        },
      },
    });
    expect(api.multipartRequest).not.toHaveBeenCalled();
  });

  it("requires an explicit source mode for a repository without origin", async () => {
    const directory = await project("no-origin");
    initializeRepository(directory, null);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runDeploy([directory, "--json"])).resolves.toBe(2);

    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: { code: "deployment_mode_required" },
    });
  });

  it("rejects --open in JSON mode before cloud or filesystem work", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runDeploy(["--json", "--open"])).resolves.toBe(2);

    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: {
        code: "invalid_argument_combination",
        details: {
          nextSteps: [
            { command: "mcp-use deploy --json" },
            { command: "mcp-use deploy --open" },
          ],
        },
      },
    });
    expect(cloudApiForOrganization).not.toHaveBeenCalled();
  });

  it("does not replace a linked GitHub server with managed source", async () => {
    const directory = await project("linked-github");
    const linkDirectory = join(directory, ".mcp-use", "cloud");
    await mkdir(linkDirectory, { recursive: true });
    await writeFile(
      join(linkDirectory, "link.json"),
      `${JSON.stringify({
        organizationId: "org_1",
        serverId: "srv_github",
        repository: "example/linked-github",
        sourceType: "github",
      })}\n`
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runDeploy([directory, "--no-github", "--json"])).resolves.toBe(
      2
    );

    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: {
        code: "source_mode_conflict",
        details: {
          serverId: "srv_github",
          nextSteps: [
            { command: "mcp-use deploy" },
            { command: "mcp-use deploy --no-github --new --yes" },
          ],
        },
      },
    });
    expect(api.multipartRequest).not.toHaveBeenCalled();
  });

  it("rejects GitHub trigger options for managed uploads", async () => {
    const directory = await project("managed-trigger-conflict");
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(
      runDeploy([directory, "--no-github", "--watch-paths", "src/**", "--json"])
    ).resolves.toBe(2);

    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: { code: "source_mode_conflict" },
    });
    expect(api.multipartRequest).not.toHaveBeenCalled();
  });

  it("returns a stable usage error for a missing env file", async () => {
    const directory = await project("missing-env-file");
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(
      runDeploy([
        directory,
        "--no-github",
        "--env-file",
        "missing.env",
        "--json",
      ])
    ).resolves.toBe(2);

    const output = stderr.mock.calls.flat().join("");
    expect(output.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(output)).toMatchObject({
      error: {
        code: "usage_error",
        message: expect.stringContaining("missing.env"),
      },
    });
    expect(api.multipartRequest).not.toHaveBeenCalled();
  });

  it("rejects managed source and Dockerfile paths outside the project", async () => {
    const directory = await project("path-containment");
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(
      runDeploy([directory, "--no-github", "--root-dir", "..", "--json"])
    ).resolves.toBe(2);
    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: {
        code: "usage_error",
        message: expect.stringContaining("--root-dir"),
      },
    });

    stderr.mockClear();
    await expect(
      runDeploy([
        directory,
        "--no-github",
        "--dockerfile",
        "../Dockerfile",
        "--json",
      ])
    ).resolves.toBe(2);
    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: {
        code: "usage_error",
        message: expect.stringContaining("--dockerfile"),
      },
    });
    expect(api.multipartRequest).not.toHaveBeenCalled();
  });

  it("creates a managed server from a local source archive", async () => {
    const directory = await project("managed-app");
    await writeFile(join(directory, "index.ts"), "export const ok = true;\n");
    await writeFile(join(directory, ".env"), "SECRET=do-not-upload\n");
    await writeFile(join(directory, ".envrc"), "SECRET=also-do-not-upload\n");
    await mkdir(join(directory, ".pytest_cache"));
    await writeFile(join(directory, ".pytest_cache", "state"), "cache\n");
    await symlink("index.ts", join(directory, "linked-index.ts"));
    await mkdir(join(directory, "src"));
    await writeFile(join(directory, "src", "nested.ts"), "export {};\n");
    const longDirectory = "segment-".repeat(12);
    const longRelativePath = join(
      longDirectory,
      longDirectory,
      "unicode-工具.ts"
    );
    await mkdir(join(directory, longDirectory, longDirectory), {
      recursive: true,
    });
    await writeFile(join(directory, longRelativePath), "export {};\n");
    api.multipartRequest.mockResolvedValue({
      server: { id: "srv_1", slug: "managed-app" },
      deploymentId: "dep_1",
    });
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await expect(
      runDeploy([
        directory,
        "--no-github",
        "--region",
        "US",
        "--build-command",
        "npm run build",
        "--start-command",
        "npm start",
        "--dockerfile",
        "Dockerfile.custom",
        "--json",
      ])
    ).resolves.toBe(0);

    expect(api.multipartRequest).toHaveBeenCalledWith(
      "/servers",
      expect.any(FormData)
    );
    const form = api.multipartRequest.mock.calls[0]![1] as FormData;
    expect(form.get("managed")).toBe("true");
    expect(form.get("name")).toBe("managed-app");
    expect(form.get("region")).toBe("US");
    expect(form.get("buildCommand")).toBe("npm run build");
    expect(form.get("startCommand")).toBe("npm start");
    expect(form.get("dockerfilePath")).toBe("Dockerfile.custom");
    expect(form.get("sourceFile")).toBeInstanceOf(Blob);
    const entries = await archiveEntries(form.get("sourceFile") as Blob);
    expect(entries).toContain("app/index.ts");
    expect(entries).toContain("app/src/nested.ts");
    expect(entries).toContain(`app/${longRelativePath}`);
    expect(entries).not.toContain("app/.env");
    expect(entries).not.toContain("app/.envrc");
    expect(entries).not.toContain("app/.pytest_cache/state");
    expect(entries).not.toContain("app/linked-index.ts");
    expect(entries.every((entry) => !entry.includes("/.mcp-use/"))).toBe(true);
    expect(JSON.parse(stdout.mock.calls.flat().join(""))).toMatchObject({
      sourceType: "managed",
      serverId: "srv_1",
      deploymentId: "dep_1",
    });
    expect(
      JSON.parse(
        await readFile(
          join(directory, ".mcp-use", "cloud", "link.json"),
          "utf8"
        )
      )
    ).toMatchObject({
      organizationId: "org_1",
      serverId: "srv_1",
      sourceType: "managed",
    });
  });

  it("accepts -y as the documented non-interactive consent alias", async () => {
    const directory = await project("short-yes");
    api.multipartRequest.mockResolvedValue({
      server: { id: "srv_short_yes", slug: "short-yes" },
      deploymentId: "dep_short_yes",
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runDeploy([directory, "--no-github", "--new", "-y", "--json"])
    ).resolves.toBe(0);
  });

  it("rejects an unsupported origin with recovery commands", async () => {
    const directory = await project("unsupported-origin");
    initializeRepository(
      directory,
      "https://token-secret@gitlab.com/example/unsupported-origin.git"
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runDeploy([directory, "--json"])).resolves.toBe(1);

    const output = stderr.mock.calls.flat().join("");
    expect(output).not.toContain("token-secret");
    expect(JSON.parse(output)).toMatchObject({
      error: {
        code: "unsupported_remote",
        message: expect.stringContaining("https://[REDACTED]@gitlab.com"),
        details: {
          remote:
            "https://[REDACTED]@gitlab.com/example/unsupported-origin.git",
          nextSteps: [
            { command: expect.stringContaining("git remote set-url origin") },
            { command: "mcp-use deploy --no-github" },
          ],
        },
      },
    });
  });

  it("reports unexpected read-only Git probe failures without guessing state", async () => {
    const directory = await project("probe-failure");
    initializeRepository(directory);
    const bin = join(directory, "fake-bin");
    await mkdir(bin);
    const wrapper = join(bin, "git");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'if [ "$1" = "status" ]; then',
        '  echo "probe exploded" >&2',
        "  exit 42",
        "fi",
        'exec "$MCP_USE_TEST_REAL_GIT" "$@"',
        "",
      ].join("\n")
    );
    await chmod(wrapper, 0o755);
    vi.stubEnv(
      "MCP_USE_TEST_REAL_GIT",
      execFileSync("which", ["git"], { encoding: "utf8" }).trim()
    );
    vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runDeploy([directory, "--json"])).resolves.toBe(1);

    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: {
        code: "git_command_failed",
        message: "git status --porcelain failed: probe exploded",
        details: {
          command: "git status --porcelain",
          exitCode: 42,
          nextSteps: [
            { command: "git status" },
            { command: "mcp-use deploy --no-github" },
          ],
        },
      },
    });
    expect(api.request).not.toHaveBeenCalled();
  });

  it("rejects detached HEAD unless a branch is explicit", async () => {
    const directory = await project("detached-head");
    initializeRepository(directory);
    execFileSync("git", ["checkout", "--detach"], { cwd: directory });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runDeploy([directory, "--json"])).resolves.toBe(1);

    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: {
        code: "detached_head",
        details: {
          nextSteps: [{ command: "mcp-use deploy --branch <branch>" }],
        },
      },
    });
  });

  it("requires explicit consent before committing a dirty repository", async () => {
    const directory = await project("dirty-repository");
    initializeRepository(directory);
    await writeFile(
      join(directory, "changed.ts"),
      "export const changed = true;\n"
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runDeploy([directory, "--json"])).resolves.toBe(2);

    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: {
        code: "git_changes_require_confirmation",
        details: {
          nextSteps: expect.arrayContaining([
            expect.objectContaining({ command: "mcp-use deploy --yes" }),
          ]),
        },
      },
    });
    expect(api.request).not.toHaveBeenCalled();
  });

  it("maps rejected pushes to a stable remediation error", async () => {
    const directory = await project("rejected-push");
    initializeRepository(
      directory,
      "https://github.com/example/rejected-push.git"
    );
    const bareRemote = await mkdtemp(join(tmpdir(), "mcp-use-rejected-"));
    directories.push(bareRemote);
    execFileSync("git", ["init", "--bare"], { cwd: bareRemote });
    const hook = join(bareRemote, "hooks", "pre-receive");
    await writeFile(
      hook,
      "#!/bin/sh\necho 'push rejected by test' >&2\nexit 1\n"
    );
    await chmod(hook, 0o755);
    execFileSync(
      "git",
      ["config", "remote.origin.pushurl", `file://${bareRemote}`],
      { cwd: directory }
    );
    await writeFile(
      join(directory, "changed.ts"),
      "export const changed = true;\n"
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runDeploy([directory, "--yes", "--json"])).resolves.toBe(1);

    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: {
        code: "git_push_rejected",
        details: {
          nextSteps: [
            expect.objectContaining({
              command: expect.stringContaining("git pull --rebase"),
            }),
          ],
        },
      },
    });
    expect(api.request).not.toHaveBeenCalled();
  });

  it("reports a missing GitHub installation without attempting creation", async () => {
    const directory = await project("missing-installation");
    initializeRepository(directory);
    api.request.mockResolvedValue({ installations: [] });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runDeploy([directory, "--json"])).resolves.toBe(1);

    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: {
        code: "github_installation_required",
        details: { nextSteps: expect.any(Array) },
      },
    });
  });

  it("preserves the created repository when Git identity is missing", async () => {
    const directory = await project("missing-identity");
    const emptyGitConfig = join(directory, "empty-gitconfig");
    await writeFile(emptyGitConfig, "");
    const previousGlobal = process.env.GIT_CONFIG_GLOBAL;
    const previousNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
    const identityEnvironment = [
      "GIT_AUTHOR_NAME",
      "GIT_AUTHOR_EMAIL",
      "GIT_COMMITTER_NAME",
      "GIT_COMMITTER_EMAIL",
      "EMAIL",
    ] as const;
    const previousIdentity = Object.fromEntries(
      identityEnvironment.map((key) => [key, process.env[key]])
    );
    process.env.GIT_CONFIG_GLOBAL = emptyGitConfig;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    for (const key of identityEnvironment) process.env[key] = "";
    api.request.mockImplementation(async (path: string) => {
      if (path.startsWith("/github/installations?")) {
        return {
          installations: [
            {
              id: "installation-row",
              installationId: "123",
              account: { login: "example", type: "Organization" },
            },
          ],
        };
      }
      if (path.endsWith("/repos")) {
        return {
          fullName: "example/missing-identity",
          cloneUrl: "https://github.com/example/missing-identity.git",
          htmlUrl: "https://github.com/example/missing-identity",
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    try {
      await expect(runDeploy([directory, "--yes", "--json"])).resolves.toBe(1);
    } finally {
      if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previousGlobal;
      if (previousNoSystem === undefined)
        delete process.env.GIT_CONFIG_NOSYSTEM;
      else process.env.GIT_CONFIG_NOSYSTEM = previousNoSystem;
      for (const key of identityEnvironment) {
        const previous = previousIdentity[key];
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      }
    }

    const identityError = JSON.parse(stderr.mock.calls.flat().join(""));
    expect(identityError, JSON.stringify(identityError)).toMatchObject({
      error: {
        code: "git_identity_required",
        details: {
          repository: "example/missing-identity",
          url: "https://github.com/example/missing-identity",
          nextSteps: expect.arrayContaining([
            expect.objectContaining({ command: "mcp-use deploy --yes" }),
          ]),
        },
      },
    });
    expect(
      execFileSync("git", ["remote", "get-url", "origin"], {
        cwd: directory,
        encoding: "utf8",
      }).trim()
    ).toBe("https://github.com/example/missing-identity.git");
  });

  it("returns a stable repository-creation failure with alternatives", async () => {
    const directory = await project("repo-create-failure");
    api.request.mockImplementation(async (path: string) => {
      if (path.startsWith("/github/installations?")) {
        return {
          installations: [
            {
              id: "installation-row",
              installationId: "123",
              account: { login: "example", type: "Organization" },
            },
          ],
        };
      }
      if (path.endsWith("/repos")) throw new Error("name already exists");
      throw new Error(`Unexpected request: ${path}`);
    });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runDeploy([directory, "--yes", "--json"])).resolves.toBe(1);

    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: {
        code: "github_repository_creation_failed",
        details: {
          account: "example",
          cause: "name already exists",
          nextSteps: [
            { command: "mcp-use deploy --name <unique-name> --yes" },
            { command: "mcp-use deploy --no-github" },
          ],
        },
      },
    });
  });

  it("reports inaccessible GitHub repositories with install and retry steps", async () => {
    const directory = await project("missing-access");
    initializeRepository(directory);
    api.request.mockImplementation(async (path: string) => {
      if (path.startsWith("/github/installations?")) {
        return {
          installations: [
            {
              id: "installation-row",
              installationId: "123",
              account: { login: "example", type: "Organization" },
            },
          ],
        };
      }
      if (path.includes("/access")) return { hasAccess: false };
      throw new Error(`Unexpected request: ${path}`);
    });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runDeploy([directory, "--json"])).resolves.toBe(1);

    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: {
        code: "github_access_required",
        details: {
          repository: "example/project",
          nextSteps: expect.any(Array),
        },
      },
    });
  });

  it("reports when server creation does not start a deployment", async () => {
    const directory = await project("missing-deployment");
    initializeRepository(directory);
    api.request.mockImplementation(
      async (path: string, init?: { body?: string }) => {
        if (path.startsWith("/github/installations?")) {
          return {
            installations: [
              {
                id: "installation-row",
                installationId: "123",
                account: { login: "example", type: "Organization" },
              },
            ],
          };
        }
        if (path.includes("/access")) return { hasAccess: true };
        if (path === "/servers") {
          expect(init?.body).toBeDefined();
          return {
            server: { id: "srv_without_deployment", slug: "missing" },
            deploymentId: null,
          };
        }
        throw new Error(`Unexpected request: ${path}`);
      }
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runDeploy([directory, "--json"])).resolves.toBe(1);

    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: {
        code: "deployment_not_created",
        details: {
          serverId: "srv_without_deployment",
          nextSteps: [
            {
              command: "mcp-use servers get srv_without_deployment",
            },
          ],
        },
      },
    });
  });

  it("enforces the managed 80 MB compressed archive limit", () => {
    expect(() => assertManagedArchiveSize(80 * 1024 * 1024)).not.toThrow();
    expect(() => assertManagedArchiveSize(80 * 1024 * 1024 + 1)).toThrowError(
      expect.objectContaining({
        code: "archive_too_large",
        details: expect.objectContaining({
          maxBytes: 80 * 1024 * 1024,
          nextSteps: expect.any(Array),
        }),
      })
    );
  });

  it("auto-detects and reuses a linked managed server", async () => {
    const directory = await project("managed-redeploy");
    const linkDirectory = join(directory, ".mcp-use", "cloud");
    await mkdir(linkDirectory, { recursive: true });
    await writeFile(
      join(linkDirectory, "link.json"),
      `${JSON.stringify({
        organizationId: "org_1",
        serverId: "srv_existing",
        serverSlug: "existing",
        repository: "managed/hidden",
      })}\n`
    );
    api.request.mockImplementation(async (path: string) => {
      if (path === "/servers/srv_existing") {
        return { connectedRepository: { isManaged: true } };
      }
      if (path === "/deployments") return { id: "dep_redeploy" };
      throw new Error(`Unexpected request: ${path}`);
    });
    api.multipartRequest.mockResolvedValue({ commitSha: "abc123" });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(runDeploy([directory, "--json"])).resolves.toBe(0);

    expect(api.multipartRequest).toHaveBeenCalledWith(
      "/servers/srv_existing/source",
      expect.any(FormData)
    );
    expect(api.request).toHaveBeenCalledWith("/deployments", {
      method: "POST",
      body: JSON.stringify({
        serverId: "srv_existing",
        branch: "main",
        trigger: "redeploy",
      }),
    });
  });

  it("synchronizes configuration before a linked managed redeploy", async () => {
    const directory = await project("managed-config-redeploy");
    const linkDirectory = join(directory, ".mcp-use", "cloud");
    await mkdir(linkDirectory, { recursive: true });
    await writeFile(
      join(linkDirectory, "link.json"),
      `${JSON.stringify({
        organizationId: "org_1",
        serverId: "srv_managed_config",
        sourceType: "managed",
      })}\n`
    );
    api.request.mockImplementation(async (path: string) => {
      if (path === "/servers/srv_managed_config")
        return { id: "srv_managed_config" };
      if (path === "/deployments") return { id: "dep_managed_config" };
      throw new Error(`Unexpected request: ${path}`);
    });
    api.multipartRequest.mockResolvedValue({ commitSha: "abc123" });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runDeploy([
        directory,
        "--region",
        "EU",
        "--root-dir",
        ".",
        "--build-command",
        "npm run build:cloud",
        "--start-command",
        "npm run start:cloud",
        "--dockerfile",
        "Dockerfile.cloud",
        "--json",
      ])
    ).resolves.toBe(0);

    expect(api.request).toHaveBeenCalledWith("/servers/srv_managed_config", {
      method: "PATCH",
      body: JSON.stringify({
        region: "EU",
        config: {
          rootDir: ".",
          buildCommand: "npm run build:cloud",
          startCommand: "npm run start:cloud",
          dockerfilePath: "Dockerfile.cloud",
        },
      }),
    });
  });

  it("uploads the workspace root and preserves managed root-dir configuration", async () => {
    const directory = await project("workspace-root");
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "workspace-root", workspaces: ["apps/*"] })}\n`
    );
    await mkdir(join(directory, "apps", "server"), { recursive: true });
    await writeFile(
      join(directory, "apps", "server", "package.json"),
      `${JSON.stringify({
        name: "workspace-server",
        dependencies: { shared: "workspace:*" },
      })}\n`
    );
    await writeFile(
      join(directory, "apps", "server", "index.ts"),
      "export {};\n"
    );
    api.multipartRequest.mockResolvedValue({
      server: { id: "srv_workspace", slug: "workspace" },
      deploymentId: "dep_workspace",
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runDeploy([
        directory,
        "--no-github",
        "--root-dir",
        "apps/server",
        "--json",
      ])
    ).resolves.toBe(0);

    const form = api.multipartRequest.mock.calls[0]![1] as FormData;
    expect(form.get("rootDir")).toBe("apps/server");
    const entries = await archiveEntries(form.get("sourceFile") as Blob);
    expect(entries).toContain("app/package.json");
    expect(entries).toContain("app/apps/server/package.json");
    expect(entries).toContain("app/apps/server/index.ts");
  });

  it("rejects unresolved workspace dependencies in standalone uploads", async () => {
    const directory = await project("workspace-child");
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify({
        name: "workspace-child",
        dependencies: { shared: "workspace:*" },
      })}\n`
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runDeploy([directory, "--no-github", "--json"])).resolves.toBe(
      1
    );

    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: {
        code: "workspace_dependencies_unresolved",
        details: { dependencies: ["shared"] },
      },
    });
    expect(api.multipartRequest).not.toHaveBeenCalled();
  });

  it("uses the installation row UUID when creating a GitHub server", async () => {
    const directory = await project("github-deploy");
    execFileSync("git", ["init", "-b", "main"], { cwd: directory });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: directory,
    });
    execFileSync("git", ["config", "user.name", "CLI Test"], {
      cwd: directory,
    });
    execFileSync("git", ["add", "."], { cwd: directory });
    execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: directory });
    execFileSync(
      "git",
      [
        "remote",
        "add",
        "origin",
        "https://github.com/example/github-deploy.git",
      ],
      { cwd: directory }
    );
    api.request.mockImplementation(
      async (path: string, init?: { body?: string }) => {
        if (path.startsWith("/github/installations?")) {
          return {
            installations: [
              {
                id: "00000000-0000-4000-8000-000000000001",
                installationId: "12345678",
                account: { login: "example", type: "Organization" },
              },
            ],
          };
        }
        if (path.includes("/access")) return { hasAccess: true };
        if (path === "/servers") {
          expect(JSON.parse(init?.body ?? "{}")).toMatchObject({
            installationId: "00000000-0000-4000-8000-000000000001",
            repoFullName: "example/github-deploy",
            watchPaths: ["apps/server/**", "packages/shared/**"],
            waitForCi: true,
          });
          return {
            server: { id: "srv_github", slug: "github-deploy" },
            deploymentId: "dep_github",
          };
        }
        throw new Error(`Unexpected request: ${path}`);
      }
    );
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runDeploy([
        directory,
        "--watch-paths",
        "apps/server/**",
        "--watch-paths",
        "packages/shared/**",
        "--wait-for-ci",
        "--json",
      ])
    ).resolves.toBe(0);
    expect(
      execFileSync("git", ["status", "--porcelain"], {
        cwd: directory,
        encoding: "utf8",
      }).trim()
    ).toBe("");
  });

  it("synchronizes configuration before a linked GitHub redeploy", async () => {
    const directory = await project("github-config-redeploy");
    initializeRepository(
      directory,
      "https://github.com/example/github-config-redeploy.git"
    );
    await writeFile(join(directory, ".gitignore"), ".mcp-use/\n");
    execFileSync("git", ["add", ".gitignore"], { cwd: directory });
    execFileSync("git", ["commit", "-m", "Ignore local cloud state"], {
      cwd: directory,
    });
    const linkDirectory = join(directory, ".mcp-use", "cloud");
    await mkdir(linkDirectory, { recursive: true });
    await writeFile(
      join(linkDirectory, "link.json"),
      `${JSON.stringify({
        organizationId: "org_1",
        serverId: "srv_github_config",
        repository: "example/github-config-redeploy",
        sourceType: "github",
      })}\n`
    );
    api.request.mockImplementation(async (path: string) => {
      if (path === "/servers/srv_github_config") {
        return { id: "srv_github_config" };
      }
      if (path === "/deployments") return { id: "dep_github_config" };
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runDeploy([
        directory,
        "--region",
        "APAC",
        "--root-dir",
        ".",
        "--build-command",
        "npm run build:cloud",
        "--start-command",
        "npm run start:cloud",
        "--dockerfile",
        "Dockerfile.cloud",
        "--watch-paths",
        "apps/api/**",
        "--wait-for-ci",
        "--json",
      ])
    ).resolves.toBe(0);

    expect(api.request).toHaveBeenCalledWith("/servers/srv_github_config", {
      method: "PATCH",
      body: JSON.stringify({
        region: "APAC",
        watchPaths: ["apps/api/**"],
        waitForCi: true,
        config: {
          rootDir: ".",
          buildCommand: "npm run build:cloud",
          startCommand: "npm run start:cloud",
          dockerfilePath: "Dockerfile.cloud",
        },
      }),
    });
    expect(api.request).toHaveBeenCalledWith("/deployments", {
      method: "POST",
      body: JSON.stringify({
        serverId: "srv_github_config",
        branch: "main",
        trigger: "manual",
      }),
    });
  });
});

async function archiveEntries(blob: Blob): Promise<string[]> {
  const entries: string[] = [];
  const archive = gunzipSync(Buffer.from(await blob.arrayBuffer()));
  let offset = 0;
  let paxPath: string | undefined;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const expectedChecksum = Number.parseInt(
      tarString(header, 148, 8) || "0",
      8
    );
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    if (actualChecksum !== expectedChecksum) {
      throw new Error(
        `Invalid tar checksum: expected ${expectedChecksum}, got ${actualChecksum}`
      );
    }
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const size = Number.parseInt(tarString(header, 124, 12) || "0", 8);
    const type = String.fromCharCode(header[156] ?? 0);
    const body = archive.subarray(offset + 512, offset + 512 + size);
    if (type === "x") {
      const match = body.toString("utf8").match(/(?:^|\n)\d+ path=([^\n]+)/);
      paxPath = match?.[1];
    } else {
      entries.push(paxPath ?? (prefix === "" ? name : `${prefix}/${name}`));
      paxPath = undefined;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function tarString(buffer: Buffer, offset: number, length: number): string {
  const end = buffer.indexOf(0, offset);
  return buffer
    .subarray(
      offset,
      end === -1 || end > offset + length ? offset + length : end
    )
    .toString("utf8")
    .trim();
}
