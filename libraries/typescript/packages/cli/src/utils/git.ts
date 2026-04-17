import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface GitInfo {
  isGitRepo: boolean;
  remoteUrl?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  commitSha?: string;
  commitMessage?: string;
  hasUncommittedChanges?: boolean;
}

/**
 * Read-only git probe. Swallows errors and returns `null` so callers can treat
 * "command failed" identically to "empty output" (e.g. not a repo, no remote).
 *
 * DO NOT use this for state-mutating commands (init/add/commit/push/remote add).
 * Use `gitCommandOrThrow` instead so failures surface to the user.
 */
async function gitCommand(
  command: string,
  cwd: string = process.cwd()
): Promise<string | null> {
  try {
    const { stdout } = await execAsync(command, { cwd });
    return stdout.trim();
  } catch (error) {
    return null;
  }
}

/**
 * Error thrown by `gitCommandOrThrow` when a git command exits non-zero.
 * Carries the command string plus captured stderr/stdout for actionable errors.
 */
export class GitCommandError extends Error {
  readonly command: string;
  readonly stderr: string;
  readonly stdout: string;
  readonly exitCode: number | null;

  constructor(opts: {
    command: string;
    stderr: string;
    stdout: string;
    exitCode: number | null;
  }) {
    const trimmed = opts.stderr.trim() || opts.stdout.trim() || "unknown error";
    super(`git command failed: \`${opts.command}\`\n${trimmed}`);
    this.name = "GitCommandError";
    this.command = opts.command;
    this.stderr = opts.stderr;
    this.stdout = opts.stdout;
    this.exitCode = opts.exitCode;
  }
}

/**
 * Execute a git command that MUST succeed. On non-zero exit, throws
 * `GitCommandError` with captured stderr so the caller can show actionable
 * errors instead of silently continuing.
 */
async function gitCommandOrThrow(
  command: string,
  cwd: string = process.cwd()
): Promise<string> {
  try {
    const { stdout } = await execAsync(command, { cwd });
    return stdout.trim();
  } catch (error) {
    const e = error as {
      stderr?: string;
      stdout?: string;
      code?: number | null;
      message?: string;
    };
    throw new GitCommandError({
      command,
      stderr: (e.stderr ?? "").toString(),
      stdout: (e.stdout ?? "").toString(),
      exitCode: typeof e.code === "number" ? e.code : null,
    });
  }
}

/**
 * Check if directory is a git repository
 */
export async function isGitRepo(cwd: string = process.cwd()): Promise<boolean> {
  const result = await gitCommand("git rev-parse --is-inside-work-tree", cwd);
  return result === "true";
}

/**
 * Get git remote URL
 */
export async function getRemoteUrl(
  cwd: string = process.cwd()
): Promise<string | null> {
  return gitCommand("git config --get remote.origin.url", cwd);
}

/**
 * Parse GitHub owner and repo from remote URL
 */
export function parseGitHubUrl(
  url: string
): { owner: string; repo: string } | null {
  // Handle both SSH and HTTPS URLs
  // SSH: git@github.com:owner/repo.git
  // HTTPS: https://github.com/owner/repo.git
  const sshMatch = url.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  const httpsMatch = url.match(
    /https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/
  );

  const match = sshMatch || httpsMatch;
  if (!match) return null;

  return {
    owner: match[1],
    repo: match[2],
  };
}

/**
 * Get current branch
 */
export async function getCurrentBranch(
  cwd: string = process.cwd()
): Promise<string | null> {
  return gitCommand("git rev-parse --abbrev-ref HEAD", cwd);
}

/**
 * Get current commit SHA
 */
export async function getCommitSha(
  cwd: string = process.cwd()
): Promise<string | null> {
  return gitCommand("git rev-parse HEAD", cwd);
}

/**
 * Get current commit message
 */
export async function getCommitMessage(
  cwd: string = process.cwd()
): Promise<string | null> {
  return gitCommand("git log -1 --pretty=%B", cwd);
}

/**
 * Check if there are uncommitted changes
 */
export async function hasUncommittedChanges(
  cwd: string = process.cwd()
): Promise<boolean> {
  const result = await gitCommand("git status --porcelain", cwd);
  return result !== null && result.length > 0;
}

/**
 * Get all git info for current directory
 */
export async function getGitInfo(
  cwd: string = process.cwd()
): Promise<GitInfo> {
  const isRepo = await isGitRepo(cwd);

  if (!isRepo) {
    return { isGitRepo: false };
  }

  const remoteUrl = await getRemoteUrl(cwd);
  const branch = await getCurrentBranch(cwd);
  const commitSha = await getCommitSha(cwd);
  const commitMessage = await getCommitMessage(cwd);
  const uncommittedChanges = await hasUncommittedChanges(cwd);

  let owner: string | undefined;
  let repo: string | undefined;

  if (remoteUrl) {
    const parsed = parseGitHubUrl(remoteUrl);
    if (parsed) {
      owner = parsed.owner;
      repo = parsed.repo;
    }
  }

  return {
    isGitRepo: true,
    remoteUrl: remoteUrl || undefined,
    owner,
    repo,
    branch: branch || undefined,
    commitSha: commitSha || undefined,
    commitMessage: commitMessage || undefined,
    hasUncommittedChanges: uncommittedChanges,
  };
}

/**
 * Escape a commit message for safe inclusion in a shell-quoted `git commit -m`.
 * Double quotes are handled by escaping `"` and `\` and wrapping in `"..."`.
 */
function shellQuote(message: string): string {
  return `"${message.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Initialize a git repo, add all files, commit, and normalize branch to `main`.
 *
 * Throws `GitCommandError` (typed Error) on any failure so callers can surface
 * the real stderr instead of silently continuing (previous behavior left the
 * repo in a half-baked state and the CLI still printed "Code pushed").
 */
export async function gitInit(
  cwd: string,
  message: string = "Initial commit"
): Promise<void> {
  await gitCommandOrThrow("git init", cwd);
  await gitCommandOrThrow("git add .", cwd);
  await gitCommandOrThrow(`git commit -m ${shellQuote(message)}`, cwd);
  // Normalize branch name so a subsequent `git push -u origin main` always
  // matches, regardless of the user's `init.defaultBranch` config.
  await gitCommandOrThrow("git branch -M main", cwd);
  // Guard: commit must exist before we try to push.
  await gitCommandOrThrow("git rev-parse HEAD", cwd);
}

/**
 * Add a remote and push to it. Throws `GitCommandError` on failure.
 */
export async function gitAddRemoteAndPush(
  cwd: string,
  cloneUrl: string,
  branch: string = "main"
): Promise<void> {
  await gitCommandOrThrow(`git remote add origin ${cloneUrl}`, cwd);
  await gitCommandOrThrow(`git push -u origin ${branch}`, cwd);
}

/**
 * Commit all changes and push. Throws `GitCommandError` on failure.
 */
export async function gitCommitAndPush(
  cwd: string,
  message: string,
  branch: string = "main"
): Promise<void> {
  await gitCommandOrThrow("git add .", cwd);
  await gitCommandOrThrow(`git commit -m ${shellQuote(message)}`, cwd);
  await gitCommandOrThrow(`git push origin ${branch}`, cwd);
}

/**
 * Check if remote is a GitHub URL
 */
export function isGitHubUrl(url: string): boolean {
  try {
    // Handle HTTP(S) URLs
    const parsedUrl = new URL(url);
    return (
      parsedUrl.hostname === "github.com" ||
      parsedUrl.hostname === "www.github.com"
    );
  } catch {
    // Handle SSH/shortened git URLs: git@github.com:user/repo.git
    // Extract the host before the ":" or "/" (if git@host:repo or git@host/repo)
    const sshMatch = url.match(/^git@([^:/]+)[:/]/);
    if (sshMatch) {
      const host = sshMatch[1];
      return host === "github.com" || host === "www.github.com";
    }
  }
  return false;
}
