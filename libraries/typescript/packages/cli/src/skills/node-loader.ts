import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { parseDocument } from "./vendor/yaml-2.8.3.min.js";

import type {
  SkillResourceSnapshot,
  SkillsOptions,
  SkillsSnapshot,
} from "./types.js";

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertSafeDirectory(projectRoot: string, directory: string): string {
  if (directory.trim() === "" || isAbsolute(directory)) {
    throw new TypeError(
      "skills.directory must be a non-empty project-relative path"
    );
  }
  const root = resolve(projectRoot);
  const resolved = resolve(root, directory);
  const rel = relative(root, resolved);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new TypeError("skills.directory must stay within the project root");
  }
  return resolved;
}

/** Resolve the effective directory watched and read by CLI tooling. */
export function resolveConfiguredSkillsDirectory(
  config: boolean | SkillsOptions | undefined,
  projectRoot: string,
  conventionalDirectory = "skills"
): string | undefined {
  if (config === false) return undefined;
  const directory =
    typeof config === "object" && config?.directory !== undefined
      ? config.directory
      : conventionalDirectory;
  return assertSafeDirectory(projectRoot, directory);
}

function mimeType(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return (
    (
      {
        md: "text/markdown",
        txt: "text/plain",
        json: "application/json",
        yaml: "application/yaml",
        yml: "application/yaml",
        js: "text/javascript",
        mjs: "text/javascript",
        cjs: "text/javascript",
        ts: "text/typescript",
        py: "text/x-python",
        sh: "text/x-shellscript",
        html: "text/html",
        css: "text/css",
        csv: "text/csv",
        xml: "application/xml",
        svg: "image/svg+xml",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        pdf: "application/pdf",
        zip: "application/zip",
      } as Record<string, string>
    )[extension] ?? "application/octet-stream"
  );
}

function isTextMime(value: string): boolean {
  return (
    value.startsWith("text/") ||
    value === "application/json" ||
    value === "application/yaml" ||
    value === "application/xml" ||
    value === "image/svg+xml"
  );
}

function walk(root: string): { files: string[]; directories: string[] } {
  const files: string[] = [];
  const directories: string[] = [root];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name)
    )) {
      const path = resolve(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        directories.push(path);
        visit(path);
      } else if (stat.isFile()) files.push(path);
    }
  };
  visit(root);
  return { files, directories };
}

function skillUri(skillsRoot: string, skillRoot: string, file: string): string {
  const skillSegments = relative(skillsRoot, skillRoot)
    .split(sep)
    .map(encodeURIComponent);
  const fileSegments = relative(skillRoot, file)
    .split(sep)
    .map(encodeURIComponent);
  const [authority, ...path] = [...skillSegments, ...fileSegments];
  return `skill://${authority ?? ""}/${path.join("/")}`;
}

function frontmatter(path: string): Record<string, unknown> {
  const source = readFileSync(path, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (match?.[1] === undefined) {
    throw new Error(`${path}: SKILL.md must begin with YAML frontmatter`);
  }
  const document = parseDocument(match[1], { prettyErrors: true });
  if (document.errors.length > 0) {
    throw new Error(
      `${path}: invalid YAML frontmatter: ${document.errors[0]?.message}`
    );
  }
  let value: unknown;
  try {
    value = document.toJSON();
  } catch (error) {
    throw new Error(
      `${path}: invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path}: frontmatter must be a YAML mapping`);
  }
  const result = value as Record<string, unknown>;
  const name = result["name"];
  const description = result["description"];
  if (
    typeof name !== "string" ||
    name.length < 1 ||
    name.length > 64 ||
    !SKILL_NAME.test(name)
  ) {
    throw new Error(
      `${path}: name must be 1-64 lowercase letters, digits, or single hyphens`
    );
  }
  if (name !== basename(resolve(path, ".."))) {
    throw new Error(
      `${path}: frontmatter name must match its parent directory`
    );
  }
  if (
    typeof description !== "string" ||
    description.trim() === "" ||
    description.length > 1024
  ) {
    throw new Error(
      `${path}: description must be a non-empty string of at most 1024 characters`
    );
  }
  return result;
}

/**
 * Discover and validate a static Skills over MCP snapshot from disk.
 *
 * @param config - Convention, explicit disable, or directory override.
 * @param projectRoot - Root against which the directory is resolved.
 * @returns A snapshot, or `undefined` when convention discovery finds no directory.
 * @throws When forced discovery is missing or any discovered skill is invalid.
 *
 * @internal
 */
export function discoverConfiguredSkills(
  config: boolean | SkillsOptions | undefined,
  projectRoot: string,
  conventionalDirectory = "skills"
): SkillsSnapshot | undefined {
  if (config === false) return undefined;
  const forced =
    config === true || (typeof config === "object" && config !== null);
  const skillsRoot = resolveConfiguredSkillsDirectory(
    config,
    projectRoot,
    conventionalDirectory
  )!;
  if (!existsSync(skillsRoot)) {
    if (!forced) return undefined;
    throw new Error(`Skills directory not found: ${skillsRoot}`);
  }
  if (!lstatSync(skillsRoot).isDirectory()) {
    throw new Error(`Skills path is not a directory: ${skillsRoot}`);
  }

  const { files: allFiles, directories: allDirectories } = walk(skillsRoot);
  const skillFiles = allFiles.filter((file) => basename(file) === "SKILL.md");
  if (skillFiles.length === 0) {
    console.warn(`[mcp-use] Skills directory is empty: ${skillsRoot}`);
  }
  const resourcesByUri = new Map<string, SkillResourceSnapshot>();
  const directoriesByUri = new Map<string, { uri: string; name: string }>();
  const skills = skillFiles.map((skillFile) => {
    const skillRoot = resolve(skillFile, "..");
    if (skillRoot === skillsRoot) {
      throw new Error(
        `${skillFile}: SKILL.md must be inside a named child directory`
      );
    }
    const metadata = frontmatter(skillFile);
    const files = allFiles.filter((file) =>
      file.startsWith(`${skillRoot}${sep}`)
    );
    const resources = files.map((file) => {
      const bytes = readFileSync(file);
      const uri = skillUri(skillsRoot, skillRoot, file);
      const type = mimeType(file);
      const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (!resourcesByUri.has(uri)) {
        resourcesByUri.set(uri, {
          uri,
          name: basename(file),
          mimeType: type,
          digest,
          ...(isTextMime(type)
            ? { text: bytes.toString("utf8") }
            : { blob: bytes.toString("base64") }),
        });
      }
      return { uri, digest };
    });
    const root = skillUri(skillsRoot, skillRoot, skillFile).replace(
      /\/SKILL\.md$/,
      ""
    );
    for (const directoryPath of allDirectories.filter(
      (directoryPath) =>
        directoryPath === skillRoot ||
        directoryPath.startsWith(`${skillRoot}${sep}`)
    )) {
      const rel = relative(skillRoot, directoryPath);
      const uri =
        rel === ""
          ? root
          : `${root}/${rel.split(sep).map(encodeURIComponent).join("/")}`;
      directoriesByUri.set(uri, {
        uri,
        name: rel === "" ? basename(skillRoot) : basename(directoryPath),
      });
    }
    return {
      uri: skillUri(skillsRoot, skillRoot, skillFile),
      frontmatter: metadata,
      resources,
    };
  });
  skills.sort((left, right) => left.uri.localeCompare(right.uri));
  return {
    skills,
    resources: [...resourcesByUri.values()].sort((left, right) =>
      left.uri.localeCompare(right.uri)
    ),
    directories: [...directoriesByUri.values()].sort((left, right) =>
      left.uri.localeCompare(right.uri)
    ),
  };
}
