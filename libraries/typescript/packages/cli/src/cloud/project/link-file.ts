/**
 * The project link: which Manufact Cloud server a project directory deploys
 * to. It lives in `.manufact/project.json` at the project root, holds only
 * `{ orgId, serverId }`, and is never committed: the folder carries its own
 * `.gitignore` that ignores everything in it, so it stays out of Git in any
 * repository layout and never leaves the working tree dirty, and `link` also
 * adds `.manufact/` to the project's `.gitignore`.
 *
 * `.manufact/` is Cloud state and is separate from `.mcp-use/`, the build
 * folder, which is deleted and recreated. Older CLIs kept the link in
 * `.mcp-use/cloud/link.json`; reading a link moves that file across.
 */
import { readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { CommandError } from "../../core/errors.js";
import { pathExists, readJson, writePrivateJson } from "../../core/fs.js";

/** A project's link to one Cloud server. */
export interface ProjectLink {
  /** Organization that owns the server. */
  orgId: string;
  /** Server id (never a slug). */
  serverId: string;
}

const LINK_DIRECTORY = ".manufact";
const LINK_FILE = "project.json";
const GITIGNORE_ENTRY = ".manufact/";
/** The `.gitignore` inside `.manufact/`; `*` matches itself too. */
const SELF_IGNORE = "# Created by mcp-use. Local Manufact Cloud state.\n*\n";

/** The link file older CLIs wrote, relative to the project root. */
const LEGACY_LINK = [".mcp-use", "cloud", "link.json"] as const;

/** The project root: `--path` when given, else the working directory. */
export function projectRoot(path?: string): string {
  return resolve(process.cwd(), path ?? ".");
}

/** Where the link file lives in `root`. */
export function linkFilePath(root: string): string {
  return join(root, LINK_DIRECTORY, LINK_FILE);
}

/**
 * Read the project's link, or `null` when the project is not linked. A link
 * left by an older CLI is moved to `.manufact/project.json` first.
 */
export async function readProjectLink(
  root: string
): Promise<ProjectLink | null> {
  await migrateLegacyLink(root);
  const path = linkFilePath(root);
  const value = await readJson<unknown>(path, null);
  if (value === null) return null;
  if (!isProjectLink(value)) {
    throw new CommandError(
      "invalid_project_link",
      `${path} is not a valid project link.`,
      undefined,
      [
        { description: "Remove the broken link", command: "mcp-use unlink" },
        {
          description: "Then link the project again",
          command: "mcp-use link --server <id-or-slug>",
        },
      ]
    );
  }
  return { orgId: value.orgId, serverId: value.serverId };
}

/** Save the project's link. */
export async function writeProjectLink(
  root: string,
  link: ProjectLink
): Promise<void> {
  await writePrivateJson(linkFilePath(root), {
    orgId: link.orgId,
    serverId: link.serverId,
  } satisfies ProjectLink);
  await writeFile(join(root, LINK_DIRECTORY, ".gitignore"), SELF_IGNORE);
}

/**
 * Remove the project's link, and `.manufact/` when nothing else is in it.
 * Returns whether there was a link to remove.
 */
export async function removeProjectLink(root: string): Promise<boolean> {
  const legacy = join(root, ...LEGACY_LINK);
  const path = linkFilePath(root);
  const linked = (await pathExists(path)) || (await pathExists(legacy));
  await rm(path, { force: true });
  await rm(legacy, { force: true });
  const directory = join(root, LINK_DIRECTORY);
  const left = await readdir(directory).catch(() => null);
  if (left !== null && left.every((name) => name === ".gitignore")) {
    await rm(directory, { recursive: true, force: true });
  }
  return linked;
}

async function migrateLegacyLink(root: string): Promise<void> {
  const legacy = join(root, ...LEGACY_LINK);
  if ((await pathExists(linkFilePath(root))) || !(await pathExists(legacy))) {
    return;
  }
  const value = await readJson<unknown>(legacy, null);
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as Record<string, unknown>)["organizationId"] !== "string" ||
    typeof (value as Record<string, unknown>)["serverId"] !== "string"
  ) {
    return;
  }
  const { organizationId, serverId } = value as {
    organizationId: string;
    serverId: string;
  };
  await writeProjectLink(root, { orgId: organizationId, serverId });
  await rm(legacy, { force: true });
  await removeIfEmpty(join(root, LEGACY_LINK[0], LEGACY_LINK[1]));
}

/**
 * Add `.manufact/` to the project's `.gitignore`, creating the file when
 * there is none. Leaves the file alone when it already ignores the folder.
 */
export async function ignoreLinkDirectory(root: string): Promise<void> {
  const path = join(root, ".gitignore");
  let contents = "";
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const ignored = contents
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\//, "").replace(/\/$/, ""))
    .includes(LINK_DIRECTORY);
  if (ignored) return;
  const separator = contents === "" || contents.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${contents}${separator}${GITIGNORE_ENTRY}\n`);
}

async function removeIfEmpty(directory: string): Promise<void> {
  try {
    if ((await readdir(directory)).length === 0) await rmdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function isProjectLink(value: unknown): value is ProjectLink {
  if (value === null || typeof value !== "object") return false;
  const { orgId, serverId } = value as Record<string, unknown>;
  return (
    typeof orgId === "string" &&
    orgId !== "" &&
    typeof serverId === "string" &&
    serverId !== ""
  );
}
