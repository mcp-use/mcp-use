import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import semver from "semver";

const groups = [
  {
    file: "docs/typescript/changelog/changelog.mdx",
    versionPackage: "mcp-use",
    includes: (name) => name !== "@mcp-use/inspector",
  },
  {
    file: "docs/inspector/changelog.mdx",
    versionPackage: "@mcp-use/inspector",
    includes: (name) => name === "@mcp-use/inspector",
  },
];

function stableVersion(version) {
  const parsed = semver.parse(version);
  if (!parsed) throw new Error(`Invalid release version: ${version}`);
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

function entries(text) {
  // Comments and examples are not published changelog entries. Preserve a
  // separator so stripping them cannot join fragments into a fabricated tag.
  const content = text
    .replace(/<!--[^]*?-->/g, "\n")
    .replace(/\{\/\*[^]*?\*\/\}/g, "\n")
    .replace(/^```[^]*?^```[^\n]*$/gm, "\n");
  return [...content.matchAll(/<Update\b([^>]*?)>([^]*?)<\/Update>/g)].map(
    ([, attributes, body]) => ({
      version: attributes.match(/\blabel\s*=\s*["']v([^"']+)["']/)?.[1],
      body: body.trim(),
    })
  );
}

export function releaseDocsErrors({
  packages,
  releases,
  documents,
  previousDocuments,
}) {
  const errors = [];
  for (const group of groups) {
    if (!releases.some((release) => group.includes(release.name))) continue;
    const owner = packages.find((pkg) => pkg.name === group.versionPackage);
    if (!owner)
      throw new Error(
        `Missing changelog version package: ${group.versionPackage}`
      );
    const planned = releases.find((release) => release.name === owner.name);
    const version = stableVersion(
      planned?.newVersion || planned?.version || owner.version
    );
    const found = entries(documents[group.file] || "");
    const matching = found.filter((entry) => entry.version === version);
    if (matching.length !== 1 || found[0]?.version !== version) {
      errors.push(
        `${group.file}: prepend exactly one <Update label="v${version}"> entry for this release.`
      );
      continue;
    }
    if (!/^\s*[-*] +\S/m.test(matching[0].body)) {
      errors.push(
        `${group.file}: v${version} needs release-note bullets, not an empty heading.`
      );
    }
    if (previousDocuments) {
      const previous = entries(previousDocuments[group.file] || "").find(
        (entry) => entry.version === version
      );
      if (
        previous?.body.replace(/\s+/g, " ") ===
        matching[0].body.replace(/\s+/g, " ")
      ) {
        errors.push(
          `${group.file}: the v${version} release entry is unchanged from the PR base. Document the release changes on canary before promotion.`
        );
      }
    }
  }
  return errors;
}

export function checkReleaseDocs({
  workspaceRoot = process.cwd(),
  base,
  planFile,
  allowExisting = false,
} = {}) {
  const repoRoot = resolve(workspaceRoot, "../..");
  const packages = readdirSync(join(workspaceRoot, "packages"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = `libraries/typescript/packages/${entry.name}/package.json`;
      return {
        ...JSON.parse(readFileSync(join(repoRoot, file), "utf8")),
        file,
      };
    })
    .filter((pkg) => !pkg.private);
  let plan;
  if (planFile) {
    plan = JSON.parse(readFileSync(planFile, "utf8"));
  } else {
    const temp = mkdtempSync(join(tmpdir(), "release-docs-"));
    try {
      const output = join(temp, "plan.json");
      execFileSync(
        "pnpm",
        ["exec", "changeset", "status", "--output", output],
        {
          cwd: workspaceRoot,
          stdio: "inherit",
        }
      );
      plan = JSON.parse(readFileSync(output, "utf8"));
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
  // Accept a Changesets plan or the immutable publication snapshot.
  const releases = plan.releases.filter((r) =>
    "target" in r ? r.target : r.type !== "none"
  );
  // Before exiting prerelease mode, status can omit already-applied changesets.
  // Their current prerelease versions are still part of stable promotion.
  if (plan.preState) {
    for (const pkg of packages) {
      if (
        semver.prerelease(pkg.version) &&
        !releases.some((r) => r.name === pkg.name)
      ) {
        releases.push({ name: pkg.name, version: pkg.version });
      }
    }
  }
  let previousDocuments;
  if (base) {
    if (!/^[a-f0-9]{40}$/.test(base))
      throw new Error("Expected exact PR base SHA");
    // Already-applied canary changesets can disappear from the release plan.
    // A changed package version still needs notes; tests-only/no-release changes do not.
    for (const pkg of packages) {
      const listing = execFileSync(
        "git",
        ["ls-tree", "--name-only", base, "--", pkg.file],
        { cwd: repoRoot, encoding: "utf8" }
      ).trim();
      const previous = listing
        ? JSON.parse(
            execFileSync("git", ["show", `${base}:${pkg.file}`], {
              cwd: repoRoot,
              encoding: "utf8",
            })
          )
        : undefined;
      if (
        previous?.version !== pkg.version &&
        !releases.some((r) => r.name === pkg.name)
      ) {
        releases.push({ name: pkg.name, version: pkg.version });
      }
    }
    previousDocuments = Object.fromEntries(
      groups.map(({ file }) => {
        let content = "";
        // An absent file on the base is fine; invalid refs/git errors are not.
        const listing = execFileSync(
          "git",
          ["ls-tree", "--name-only", base, "--", file],
          { cwd: repoRoot, encoding: "utf8" }
        ).trim();
        if (listing)
          content = execFileSync("git", ["show", `${base}:${file}`], {
            cwd: repoRoot,
            encoding: "utf8",
          });
        return [file, content];
      })
    );
  }
  const documents = Object.fromEntries(
    groups.map(({ file }) => {
      try {
        return [file, readFileSync(join(repoRoot, file), "utf8")];
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return [file, ""];
      }
    })
  );
  const errors = releaseDocsErrors({
    packages,
    releases,
    documents,
    previousDocuments: allowExisting ? undefined : previousDocuments,
  });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Release docs changelog check passed.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const option = (name) =>
      process.argv.includes(name)
        ? process.argv[process.argv.indexOf(name) + 1]
        : undefined;
    checkReleaseDocs({
      base: option("--base"),
      planFile: option("--plan"),
      allowExisting: process.argv.includes("--allow-existing"),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
