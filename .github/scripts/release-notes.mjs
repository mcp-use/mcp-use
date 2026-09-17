import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const changelogs = [
  "docs/typescript/changelog/changelog.mdx",
  "docs/inspector/changelog.mdx",
];

function changelogEntries(content) {
  // Ignore comments and frontmatter. Mask code examples so literal Update tags
  // cannot create entries, but code changes inside real entries still count.
  const visible = content
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .replace(
      /<!--[\s\S]*?-->|\{\/\*[\s\S]*?\*\/\}|^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*\r?$|(`+)[\s\S]*?\2/gm,
      (block) =>
        block.startsWith("<!--") || block.startsWith("{/*")
          ? ""
          : block.replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    );
  return [...visible.matchAll(/<Update\b[^>]*>([\s\S]*?)<\/Update>/g)]
    .map((match) => match[1].replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// Package code, shipped assets/templates, and build configuration affect releases.
// Keep the workflow unfiltered so unrelated PRs still report a successful check.
export function isSdkPath(path) {
  const match = /^libraries\/typescript\/packages\/[^/]+\/(.+)$/.exec(path);
  if (!match) return false;
  const relative = match[1];
  // Generator templates are shipped assets, including their docs and examples.
  if (relative.startsWith("src/templates/")) return true;
  if (
    /(^|\/)(?:docs?|examples?|tests?|__tests__|__mocks__|__snapshots__|fixtures|e2e|coverage)(?:\/|$)/.test(
      relative,
    )
  )
    return false;
  if (/\.(?:test|spec|stories)\.[^/]+$/.test(relative)) return false;
  if (/\.(?:md|mdx|rst)$/.test(relative)) return false;
  if (
    /^(?:(?:vitest|playwright|jest|eslint|typedoc|tsdoc|doctor)\.config\.|(?:typedoc|tsdoc)\.json$|tsconfig\.test\.json$|test-)/.test(
      relative,
    )
  )
    return false;
  if (
    /^(?:pnpm-lock\.yaml|yarn\.lock|package-lock\.json|\.[^/]+)$/.test(relative)
  )
    return false;
  return true;
}

export function checkReleaseNotes({ base, head, baseBranch, headBranch, cwd }) {
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const ancestor = git("merge-base", base, head);
  const read = (ref, path) => git("show", `${ref}:${path}`);
  // Missing paths are expected when introducing a changelog. Other Git errors
  // still throw; do not turn repository failures into an empty baseline.
  const readIfPresent = (ref, path) =>
    git("ls-tree", "--name-only", ref, "--", path) ? read(ref, path) : "";

  const promotion = baseBranch === "main" && headBranch === "canary";
  const changed = git(
    "diff",
    "--no-renames",
    "--name-only",
    "-z",
    ancestor,
    head,
  ).split("\0");
  const sdkPaths = changed.filter(isSdkPath);
  // Stable version PRs are generated after promotion and consume changesets.
  // Only exempt package metadata; source changes on these branches still count.
  const versionPr =
    baseBranch === "main" && /^release\/exit-prerelease-\d+$/.test(headBranch);
  const sdkChanged = sdkPaths.some((path) => {
    if (!/^libraries\/typescript\/packages\/[^/]+\/package\.json$/.test(path))
      return true;
    if (versionPr) return false;
    const manifest = (ref) => {
      // Added/deleted packages must count even when one side has no manifest.
      if (!git("ls-tree", "--name-only", ref, "--", path)) return null;
      const {
        version,
        scripts,
        devDependencies,
        description,
        keywords,
        ...published
      } = JSON.parse(read(ref, path));
      return published;
    };
    return (
      JSON.stringify(manifest(ancestor)) !== JSON.stringify(manifest(head))
    );
  });

  if (!promotion && sdkChanged) {
    // Existing changesets on the target branch do not belong to this PR.
    const added = git(
      "diff",
      "--find-renames",
      "--diff-filter=A",
      "--name-only",
      "-z",
      ancestor,
      head,
      "--",
      "libraries/typescript/.changeset/",
    )
      .split("\0")
      .filter((path) =>
        /^libraries\/typescript\/\.changeset\/(?!README\.md$)[^/]+\.md$/.test(
          path,
        ),
      );
    const valid = added.some((path) => {
      const content = read(head, path).replace(/\r\n/g, "\n");
      // SDK changes require a release entry; an empty changeset is insufficient.
      const match = /^---\n([\s\S]*?)\n?---(?:\n|$)([\s\S]*)$/.exec(content);
      if (!match) return false;
      const releases = match[1].trim();
      return (
        Boolean(releases) &&
        releases
          .split("\n")
          .every((line) =>
            /^\s*["'][^"']+["']:\s*(major|minor|patch)\s*$/.test(line),
          ) &&
        Boolean(match[2].trim())
      );
    });
    return valid
      ? []
      : [
          "This PR changes TypeScript SDK packages. Add a new release changeset: cd libraries/typescript && pnpm changeset. Empty, existing, or edited changesets do not count.",
        ];
  }

  if (promotion) {
    return changelogs.flatMap((path) => {
      const previous = new Set(changelogEntries(readIfPresent(ancestor, path)));
      const updated = changelogEntries(readIfPresent(head, path)).some(
        (entry) => !previous.has(entry),
      );
      return updated
        ? []
        : [
            `Add or update a non-empty release <Update> entry in ${path} before merging canary into main. Package CHANGELOG.md files do not satisfy this check.`,
          ];
    });
  }
  return [];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const errors = checkReleaseNotes({
      base: process.env.BASE_SHA,
      head: process.env.HEAD_SHA,
      baseBranch: process.env.BASE_BRANCH,
      headBranch: process.env.HEAD_BRANCH,
    });
    for (const error of errors) console.error(error);
    process.exitCode = errors.length ? 1 : 0;
    if (!errors.length) console.log("Release notes check passed.");
  } catch (error) {
    console.error(`Release notes check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
