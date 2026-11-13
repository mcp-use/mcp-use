import { execFile } from "node:child_process";
import { lstat, opendir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import ignore, { type Ignore } from "ignore";

const exec = promisify(execFile);

/** Project-level ignore rules layered on top of Git's. */
export const MANUFACT_IGNORE_FILE = ".manufactignore";

/** Directories never uploaded, whatever the ignore files say. */
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".vercel",
  ".cache",
  ".parcel-cache",
  ".pytest_cache",
  ".ruff_cache",
  ".mypy_cache",
  "__pycache__",
  ".venv",
  "venv",
  "coverage",
  ".nyc_output",
  ".output",
  "out",
  "target",
  ".mcp-use",
  ".manufact",
]);

/** Operating-system clutter never uploaded. */
const EXCLUDED_FILENAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/**
 * Credential files never uploaded, whatever the ignore files say: `.env*`,
 * private keys and certificates, keystores, and SSH keys. Skipped files are
 * reported so a missing file is never a mystery.
 */
const SENSITIVE_FILENAMES = [
  /^\.env/,
  /\.(pem|key|p12|pfx)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.|$)/,
];

/** A regular file selected for upload. */
export interface ProjectFile {
  /** POSIX path relative to the project root. */
  path: string;
  size: number;
  mode: number;
  mtimeMs: number;
}

/** The files an upload sends and the ones it deliberately leaves out. */
export interface ProjectFileSelection {
  files: ProjectFile[];
  skipped: {
    /** Credential files matched by the built-in denylist. */
    sensitive: string[];
    /** Symbolic links, which uploads never include. */
    symlinks: string[];
  };
}

/** Paths Git (or the fallback rules) would keep, and the ones it ignores. */
interface Listing {
  included: string[];
  ignored: string[];
}

/**
 * Choose the files to upload from `projectRoot`.
 *
 * Inside a Git work tree, Git decides: every file it tracks or would track,
 * applying all of its ignore sources (every `.gitignore` up to the
 * repository root and below, `.git/info/exclude`, and `core.excludesFile`).
 * Outside one, only the project's own `.gitignore` applies.
 *
 * `.manufactignore` in the project root then excludes more paths, and its
 * `!` patterns can bring back Git-ignored files. The built-in denylists apply
 * last and cannot be overridden.
 */
export async function selectProjectFiles(
  projectRoot: string
): Promise<ProjectFileSelection> {
  const manufact = await loadIgnoreFile(
    join(projectRoot, MANUFACT_IGNORE_FILE)
  );
  const reinclude = manufact?.hasNegation ?? false;
  const listing =
    (await listGitFiles(projectRoot, reinclude)) ??
    (await walkFiles(projectRoot, reinclude));

  const candidates = new Set(
    listing.included.filter((path) => !manufact?.rules.ignores(path))
  );
  if (manufact !== undefined && reinclude) {
    for (const path of listing.ignored)
      if (manufact.rules.test(path).unignored) candidates.add(path);
  }

  const selection: ProjectFileSelection = {
    files: [],
    skipped: { sensitive: [], symlinks: [] },
  };
  for (const path of [...candidates].sort(comparePaths)) {
    const kind = classify(path);
    if (kind === "sensitive") selection.skipped.sensitive.push(path);
    if (kind !== "upload") continue;
    let stats;
    try {
      stats = await lstat(join(projectRoot, path));
    } catch (error) {
      // Tracked files deleted from the working tree are not uploaded.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      // A link can escape the project root or point back into an excluded
      // secret or dependency directory, and archive runtimes extract links
      // differently.
      selection.skipped.symlinks.push(path);
      continue;
    }
    if (!stats.isFile()) continue;
    selection.files.push({
      path,
      size: stats.size,
      mode: stats.mode & 0o777,
      mtimeMs: stats.mtimeMs,
    });
  }
  return selection;
}

/** Order paths byte-wise so each directory precedes its contents. */
export function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function classify(path: string): "upload" | "excluded" | "sensitive" {
  const segments = path.split("/");
  const filename = segments.at(-1) ?? "";
  if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment)))
    return "excluded";
  if (EXCLUDED_FILENAMES.has(filename)) return "excluded";
  if (SENSITIVE_FILENAMES.some((pattern) => pattern.test(filename)))
    return "sensitive";
  return "upload";
}

async function loadIgnoreFile(
  path: string
): Promise<{ rules: Ignore; hasNegation: boolean } | undefined> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
  return {
    rules: ignore({ ignorecase: false }).add(content),
    hasNegation: content
      .split(/\r?\n/)
      .some((line) => line.trimStart().startsWith("!")),
  };
}

/**
 * Let Git list the files, or return `undefined` when `projectRoot` is not in
 * a work tree or Git is not installed. Submodules are listed recursively.
 */
async function listGitFiles(
  projectRoot: string,
  withIgnored: boolean
): Promise<Listing | undefined> {
  try {
    const { stdout } = await exec(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      {
        cwd: projectRoot,
      }
    );
    if (stdout.trim() !== "true") return undefined;
  } catch {
    return undefined;
  }
  const listing: Listing = {
    included: [],
    ignored: withIgnored
      ? await gitPaths(projectRoot, [
          "--others",
          "--ignored",
          "--exclude-standard",
        ])
      : [],
  };
  for (const path of await gitPaths(projectRoot, [
    "--cached",
    "--others",
    "--exclude-standard",
  ])) {
    const absolute = join(projectRoot, path);
    const stats = await lstat(absolute).catch(() => undefined);
    if (stats?.isDirectory()) {
      // A directory in the index is a submodule; it is its own work tree.
      if (!(await lstat(join(absolute, ".git")).catch(() => undefined)))
        continue;
      const nested = await listGitFiles(absolute, withIgnored);
      if (nested === undefined) continue;
      listing.included.push(...nested.included.map((p) => `${path}/${p}`));
      listing.ignored.push(...nested.ignored.map((p) => `${path}/${p}`));
      continue;
    }
    listing.included.push(path);
  }
  return listing;
}

async function gitPaths(cwd: string, args: string[]): Promise<string[]> {
  const { stdout } = await exec("git", ["ls-files", "-z", ...args], {
    cwd,
    maxBuffer: 256 * 1024 * 1024,
  });
  return [...new Set(stdout.split("\0").filter(Boolean))];
}

/** Without Git, apply only the project's own `.gitignore`. */
async function walkFiles(
  projectRoot: string,
  withIgnored: boolean
): Promise<Listing> {
  const gitignore = (await loadIgnoreFile(join(projectRoot, ".gitignore")))
    ?.rules;
  const listing: Listing = { included: [], ignored: [] };
  const visit = async (relative: string, parentIgnored: boolean) => {
    const directory = await opendir(
      relative === "" ? projectRoot : join(projectRoot, relative)
    );
    for await (const entry of directory) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      const isDirectory = entry.isDirectory();
      if (isDirectory && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const ignored =
        parentIgnored ||
        (gitignore?.ignores(isDirectory ? `${path}/` : path) ?? false);
      if (isDirectory) {
        if (!ignored || withIgnored) await visit(path, ignored);
      } else {
        (ignored ? listing.ignored : listing.included).push(path);
      }
    }
  };
  await visit("", false);
  return listing;
}
