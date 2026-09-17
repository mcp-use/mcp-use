import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const changelogs = [
  "docs/typescript/changelog/changelog.mdx",
  "docs/inspector/changelog.mdx",
];

export function checkReleaseNotes({ base, head, baseBranch, headBranch, cwd }) {
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const ancestor = git("merge-base", base, head);
  const read = (ref, path) => git("show", `${ref}:${path}`);

  if (baseBranch === "canary") {
    // Existing prerelease changesets on canary do not belong to this PR.
    const added = git(
      "diff",
      "--no-renames",
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
      // Empty changesets (--- / ---) explicitly mark non-release work.
      const match = /^---\n([\s\S]*?)\n?---(?:\n|$)([\s\S]*)$/.exec(content);
      if (!match) return false;
      const releases = match[1].trim();
      return (
        !releases ||
        (releases
          .split("\n")
          .every((line) =>
            /^\s*["'][^"']+["']:\s*(major|minor|patch)\s*$/.test(line),
          ) &&
          Boolean(match[2].trim()))
      );
    });
    return valid
      ? []
      : [
          "Add a new changeset for this PR: cd libraries/typescript && pnpm changeset. For docs, tests, or internal-only work, use pnpm changeset --empty. Existing or edited changesets do not count.",
        ];
  }

  if (baseBranch === "main" && headBranch === "canary") {
    const entries = (content) =>
      [...content.matchAll(/<Update\b[^>]*>([\s\S]*?)<\/Update>/g)]
        .map((match) => match[1].replace(/\s+/g, " ").trim())
        .filter(Boolean);
    return changelogs.flatMap((path) => {
      const previous = new Set(entries(read(ancestor, path)));
      const updated = entries(read(head, path)).some(
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
