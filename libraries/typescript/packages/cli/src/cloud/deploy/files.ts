import { execFile } from "node:child_process";
import { lstat, opendir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import ignore, { type Ignore } from "ignore";
import { CommandError } from "../../core/errors.js";

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
 * Credential filename patterns never uploaded, whatever the ignore files say.
 * This is a filename denylist, not a scan for arbitrary credential contents.
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
  const skippedLinks = new Set<string>();
  const checkedDirectories = new Map<string, boolean>();
  for (const path of [...candidates].sort(comparePaths)) {
    const kind = classify(path);
    if (kind === "sensitive") selection.skipped.sensitive.push(path);
    if (kind !== "upload") continue;
    const linkedParent = await symlinkAncestor(
      projectRoot,
      path,
      checkedDirectories
    );
    if (linkedParent !== undefined) {
      skippedLinks.add(linkedParent);
      continue;
    }
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
      skippedLinks.add(path);
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
  selection.skipped.symlinks = [...skippedLinks].sort(comparePaths);
  return selection;
}

/** lstat on a file still follows links in its parents; check parents first. */
async function symlinkAncestor(
  root: string,
  path: string,
  checked: Map<string, boolean>
): Promise<string | undefined> {
  const segments = path.split("/");
  for (let depth = 1; depth < segments.length; depth++) {
    const parent = segments.slice(0, depth).join("/");
    if (!checked.has(parent)) {
      try {
        checked.set(parent, (await lstat(join(root, parent))).isSymbolicLink());
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
    }
    if (checked.get(parent)) return parent;
  }
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
        env: { ...process.env, LC_ALL: "C" },
      }
    );
    if (stdout.trim() !== "true") return undefined;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    if (failure.code === "ENOENT") return undefined;
    if (
      failure.stderr?.includes("not a git repository (or any") &&
      !(await hasGitMetadata(projectRoot))
    )
      return undefined;
    throw new CommandError(
      "git_error",
      `Cannot determine Git upload exclusions: ${failure.stderr?.trim() || failure.message}`
    );
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
      const prefix = path.replace(/\/$/, "");
      listing.included.push(...nested.included.map((p) => `${prefix}/${p}`));
      listing.ignored.push(...nested.ignored.map((p) => `${prefix}/${p}`));
      continue;
    }
    listing.included.push(path);
  }
  return listing;
}

/** A broken repository must not be mistaken for a directory outside Git. */
async function hasGitMetadata(directory: string): Promise<boolean> {
  for (let current = resolve(directory); ; current = dirname(current)) {
    try {
      await lstat(join(current, ".git"));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (dirname(current) === current) return false;
  }
}

async function gitPaths(cwd: string, args: string[]): Promise<string[]> {
  // Pathspec exclusions prune hard-denied trees before Git enumerates their
  // contents, including when a .manufactignore negation requests ignored files.
  const excluded = [...EXCLUDED_DIRECTORIES].map(
    (directory) => `:(glob,exclude)**/${directory}/**`
  );
  const { stdout } = await exec(
    "git",
    ["ls-files", "-z", ...args, "--", ".", ...excluded],
    { cwd, maxBuffer: 256 * 1024 * 1024 }
  );
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
