import { execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import { CommandError } from "../../core/errors.js";
import { CommandUsageError } from "../errors.js";
import { ignoreLinkDirectory } from "../project/link-file.js";
import type { DeployValues } from "./types.js";
const exec = promisify(execFile);
interface GitProbe {
  isRepository: boolean;
  root?: string;
  remote?: string;
  branch?: string;
  dirty?: boolean;
  unavailable?: boolean;
}

/** Require an explicit choice before creating and pushing a GitHub repository. */
export async function authorizeRepositoryBootstrap(
  values: DeployValues,
  json: boolean
): Promise<void> {
  if (values.yes === true) return;
  if (json || !process.stdin.isTTY) {
    throw new CommandUsageError(
      "deployment_mode_required",
      "No GitHub origin was found. Choose a deployment mode explicitly.",
      {
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
      }
    );
  }
  const accepted = await promptYesNo(
    "No GitHub origin was found. Create a private repository and push this project?",
    true
  );
  if (!accepted) {
    throw new CommandUsageError(
      "deployment_mode_required",
      "Deployment cancelled. Choose a deployment mode.",
      {
        nextSteps: [
          {
            description: "Upload local source without GitHub",
            command: "mcp-use deploy --no-github",
          },
          {
            description: "Retry GitHub setup",
            command: "mcp-use deploy",
          },
        ],
      }
    );
  }
}

/** Connect a newly created repository and push the initial source. */
export async function bootstrapRepository(
  cwd: string,
  probe: GitProbe,
  cloneUrl: string
): Promise<void> {
  try {
    await ignoreLinkDirectory(cwd);
    if (!probe.isRepository) {
      await mutateGit(cwd, ["init"]);
    }
    // Persist the created repository identity before committing. If identity,
    // commit, or push fails, the next deploy sees origin and reuses this repo
    // instead of creating another one.
    await mutateGit(cwd, ["remote", "add", "origin", cloneUrl]);
    await mutateGit(cwd, ["add", "."]);
    const staged = await readGit(cwd, ["diff", "--cached", "--quiet"]);
    if (!staged.ok) {
      await mutateGit(cwd, ["commit", "-m", "Initial commit"]);
    }
    await mutateGit(cwd, ["branch", "-M", "main"]);
    await mutateGit(cwd, ["push", "-u", "origin", "main"]);
  } catch (error) {
    throw normalizeGitMutationError(error, cwd);
  }
}

/** Commit and push working changes only with explicit authorization. */
export async function handleDirtyRepository(
  cwd: string,
  branch: string,
  values: DeployValues,
  json: boolean
): Promise<void> {
  if (values.yes !== true) {
    if (json || !process.stdin.isTTY) {
      throw new CommandUsageError(
        "git_changes_require_confirmation",
        "The repository has uncommitted changes.",
        {
          nextSteps: [
            {
              description: "Authorize committing and pushing the changes",
              command: "mcp-use deploy --yes",
            },
            {
              description: "Commit the changes yourself",
              command: "git add . && git commit && git push",
            },
          ],
        }
      );
    }
    const accepted = await promptYesNo(
      "Commit and push the current changes before deploying?",
      true
    );
    if (!accepted) return;
  }
  try {
    await mutateGit(cwd, ["add", "."]);
    await mutateGit(cwd, ["commit", "-m", "Deploy changes"]);
    await mutateGit(cwd, ["push", "origin", branch]);
  } catch (error) {
    throw normalizeGitMutationError(error, cwd);
  }
}

/** Read the repository origin, branch, and working-tree state. */
export async function probeGit(cwd: string): Promise<GitProbe> {
  const inside = await readGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok) {
    if (inside.unavailable !== true && !isNotGitRepository(inside)) {
      throw gitProbeError("git rev-parse --is-inside-work-tree", inside);
    }
    return {
      isRepository: false,
      ...(inside.unavailable !== undefined
        ? { unavailable: inside.unavailable }
        : {}),
    };
  }
  const [root, remote, branch, status] = await Promise.all([
    readGit(cwd, ["rev-parse", "--show-toplevel"]),
    readGit(cwd, ["remote", "get-url", "origin"]),
    readGit(cwd, ["branch", "--show-current"]),
    readGit(cwd, ["status", "--porcelain"]),
  ]);
  if (!root.ok || root.stdout === "") {
    throw gitProbeError("git rev-parse --show-toplevel", root);
  }
  if (!remote.ok && !isMissingOrigin(remote)) {
    throw gitProbeError("git remote get-url origin", remote);
  }
  if (!branch.ok) {
    throw gitProbeError("git branch --show-current", branch);
  }
  if (!status.ok) {
    throw gitProbeError("git status --porcelain", status);
  }
  return {
    isRepository: true,
    root: root.stdout,
    ...(remote.ok && remote.stdout !== "" ? { remote: remote.stdout } : {}),
    ...(branch.ok ? { branch: branch.stdout } : {}),
    dirty: status.ok && status.stdout !== "",
  };
}

async function readGit(
  cwd: string,
  args: string[]
): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  unavailable?: boolean;
  code?: number | string;
}> {
  try {
    const result = await exec("git", args, { cwd });
    return {
      ok: true,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };
    return {
      ok: false,
      stdout: String(failure.stdout ?? "").trim(),
      stderr: String(failure.stderr ?? failure.message ?? "").trim(),
      ...(failure.code === "ENOENT" ? { unavailable: true } : {}),
      ...(failure.code !== undefined ? { code: failure.code } : {}),
    };
  }
}

function isNotGitRepository(result: {
  stdout: string;
  stderr: string;
}): boolean {
  return /not a git repository|not inside a work tree/i.test(
    `${result.stderr}\n${result.stdout}`
  );
}

function isMissingOrigin(result: { stdout: string; stderr: string }): boolean {
  return /no such remote(?:\s+['"]?origin)?/i.test(
    `${result.stderr}\n${result.stdout}`
  );
}

function gitProbeError(
  command: string,
  result: { stdout: string; stderr: string; code?: number | string }
): CommandError {
  const cause = redactGitDiagnostic(
    result.stderr || result.stdout || "Git returned no diagnostics."
  );
  return new CommandError("git_command_failed", `${command} failed: ${cause}`, {
    command,
    ...(result.code !== undefined ? { exitCode: result.code } : {}),
    nextSteps: [
      {
        description: "Verify the repository with Git",
        command: "git status",
      },
      {
        description: "Deploy without GitHub",
        command: "mcp-use deploy --no-github",
      },
    ],
  });
}

async function mutateGit(cwd: string, args: string[]): Promise<void> {
  try {
    await exec("git", args, { cwd });
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    throw new GitMutationError(
      `git ${args.join(" ")}`,
      String(failure.stderr ?? failure.stdout ?? ""),
      failure.code
    );
  }
}

class GitMutationError extends Error {
  constructor(
    readonly command: string,
    readonly output: string,
    readonly exitCode: number | string | undefined
  ) {
    super(output.trim() || `${command} failed`);
  }
}

function normalizeGitMutationError(error: unknown, cwd: string): CommandError {
  if (!(error instanceof GitMutationError)) {
    return new CommandError(
      "git_command_failed",
      error instanceof Error ? error.message : String(error)
    );
  }
  if (
    /tell me who you are|author identity unknown|unable to auto-detect email address|empty ident (?:name|email)|user\.email|user\.name/i.test(
      error.output
    )
  ) {
    const command = redactGitDiagnostic(error.command);
    return new CommandError(
      "git_identity_required",
      "Git needs a user name and email before it can create a commit.",
      {
        command,
        nextSteps: [
          {
            description: "Set the email for this project",
            command: `git -C ${JSON.stringify(cwd)} config user.email "you@example.com"`,
          },
          {
            description: "Set the name for this project",
            command: `git -C ${JSON.stringify(cwd)} config user.name "Your Name"`,
          },
          { description: "Retry deployment", command: "mcp-use deploy --yes" },
        ],
      }
    );
  }
  if (/non-fast-forward|rejected|unrelated histories/i.test(error.output)) {
    const command = redactGitDiagnostic(error.command);
    return new CommandError(
      "git_push_rejected",
      "GitHub rejected the push because the remote branch contains other commits.",
      {
        command,
        nextSteps: [
          {
            description: "Reconcile the remote branch",
            command:
              "git pull --rebase origin main --allow-unrelated-histories && git push -u origin main",
          },
        ],
      }
    );
  }
  const command = redactGitDiagnostic(error.command);
  const output = redactGitDiagnostic(error.output.trim());
  return new CommandError(
    "git_command_failed",
    `${command} failed${output === "" ? "." : `: ${output}`}`,
    { command, exitCode: error.exitCode }
  );
}

/** Parse a GitHub owner and repository from a supported Git remote. */
export function parseGitHubRepository(remote: string): string {
  let repository: string | undefined;

  // Check the original Git URL syntax before URL normalizes separators or paths.
  const rawPath = remote.match(
    /^[a-z][a-z\d+.-]*:\/\/[^/?#\\\s]+(\/[^?#\\\s]*)$/i
  )?.[1];

  try {
    const url = new URL(remote);
    if (
      rawPath !== undefined &&
      ["http:", "https:", "ssh:", "git:"].includes(url.protocol) &&
      url.hostname.toLowerCase() === "github.com" &&
      url.port === "" &&
      url.search === "" &&
      url.hash === "" &&
      !hasExplicitUrlPort(remote)
    ) {
      repository = gitHubRepositoryFromPath(rawPath);
    }
  } catch {
    // Git's SCP-like remotes (for example git@github.com:owner/repo.git)
    // are not valid URLs and are handled below.
  }

  if (repository === undefined) {
    const scpLike = remote.match(/^(?:[^@/\s]+@)?github\.com:(.+)$/i);
    if (scpLike?.[1] !== undefined) {
      repository = gitHubRepositoryFromPath(`/${scpLike[1]}`);
    }
  }

  if (repository === undefined) {
    const safeRemote = redactGitDiagnostic(remote);
    throw new CommandError(
      "unsupported_remote",
      `The origin remote is not a supported GitHub repository: ${safeRemote}`,
      {
        remote: safeRemote,
        nextSteps: [
          {
            description: "Set a GitHub origin",
            command:
              "git remote set-url origin https://github.com/<owner>/<repo>.git",
          },
          {
            description: "Deploy without GitHub",
            command: "mcp-use deploy --no-github",
          },
        ],
      }
    );
  }
  return repository;
}

function gitHubRepositoryFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[1] === "." ||
    match[1] === ".." ||
    match[2] === "." ||
    match[2] === ".."
  ) {
    return undefined;
  }
  return `${match[1]}/${match[2]}`;
}

function hasExplicitUrlPort(remote: string): boolean {
  const authority = remote.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#\s]+)/i)?.[1];
  if (authority === undefined) return false;
  const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
  return hostAndPort.includes(":");
}

function redactGitDiagnostic(value: string): string {
  return value.replace(
    /\b(https?:\/\/)[^/@\s]+(?::[^@\s]*)?@/gi,
    "$1[REDACTED]@"
  );
}

/** Choose a GitHub-safe repository name from the project name. */
export function sanitizeRepositoryName(name: string): string {
  const result = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return result || "mcp-server";
}

async function promptYesNo(
  question: string,
  defaultValue: boolean
): Promise<boolean> {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question(
      `${question} ${defaultValue ? "[Y/n]" : "[y/N]"} `
    );
    const normalized = answer.trim().toLowerCase();
    if (normalized === "") return defaultValue;
    return normalized === "y" || normalized === "yes";
  } finally {
    prompt.close();
  }
}
