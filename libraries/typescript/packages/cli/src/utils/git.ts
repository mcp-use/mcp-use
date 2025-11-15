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
}

/**
 * Execute git command
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
  const httpsMatch = url.match(/https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);

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
  };
}

/**
 * Check if remote is a GitHub URL
 */
export function isGitHubUrl(url: string): boolean {
  return url.includes("github.com");
}

