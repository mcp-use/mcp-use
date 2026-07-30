import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const planFile = join(root, "v1-release-plan.json");
const distTag = "legacy-v1";
const packageDirectory = join(root, "packages");
const allowedLines = new Map([
  ["mcp-use", /^1\./],
  ["@mcp-use/cli", /^3\./],
  ["@mcp-use/inspector", /^12\./],
  ["create-mcp-use-app", /^0\.14\./],
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`
    );
  }
  return result.stdout.trim();
}

function npmJson(args, fallback) {
  const result = spawnSync("npm", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return fallback;
  const output = result.stdout.trim();
  return output ? JSON.parse(output) : fallback;
}

function manifestAt(revision, relativePath) {
  const result = spawnSync(
    "git",
    ["show", `${revision}:libraries/typescript/${relativePath}`],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  if (result.status !== 0) return undefined;
  return JSON.parse(result.stdout);
}

function currentManifest(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

function packagePathsChangedByReleaseCommit() {
  const paths = run("git", [
    "diff",
    "--relative",
    "--name-only",
    "HEAD^",
    "HEAD",
    "--",
    "packages/*/package.json",
  ])
    .split("\n")
    .filter(Boolean);

  return paths.filter((relativePath) => {
    const before = manifestAt("HEAD^", relativePath);
    const after = currentManifest(relativePath);
    return before?.version !== after.version;
  });
}

function assertMaintenanceState() {
  if (existsSync(join(root, ".changeset", "pre.json"))) {
    throw new Error("v1 releases must not run in Changesets prerelease mode");
  }
  if (process.env.GITHUB_REF && process.env.GITHUB_REF !== "refs/heads/v1") {
    throw new Error(`refusing v1 release from ${process.env.GITHUB_REF}`);
  }
}

function createPlan() {
  assertMaintenanceState();
  const releases = packagePathsChangedByReleaseCommit().map((relativePath) => {
    const manifest = currentManifest(relativePath);
    const line = allowedLines.get(manifest.name);
    if (!line) {
      throw new Error(
        `package ${manifest.name} is not in the v1 release allowlist`
      );
    }
    if (!line.test(manifest.version)) {
      throw new Error(
        `${manifest.name}@${manifest.version} is outside its v1 maintenance line`
      );
    }

    const publishedVersion = npmJson(
      ["view", `${manifest.name}@${manifest.version}`, "version", "--json"],
      undefined
    );
    return {
      name: manifest.name,
      version: manifest.version,
      relativePath,
      published: publishedVersion === manifest.version,
      tagsBefore: npmJson(["view", manifest.name, "dist-tags", "--json"], {}),
    };
  });

  writeFileSync(planFile, `${JSON.stringify({ releases }, null, 2)}\n`);
  console.log(JSON.stringify({ releases }, null, 2));
  return releases;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sameNonMaintenanceTags(before, after) {
  const withoutMaintenanceTag = (tags) =>
    Object.fromEntries(
      Object.entries(tags)
        .filter(([tag]) => tag !== distTag)
        .sort(([left], [right]) => left.localeCompare(right))
    );
  return (
    JSON.stringify(withoutMaintenanceTag(before)) ===
    JSON.stringify(withoutMaintenanceTag(after))
  );
}

async function verifyRelease(release) {
  const attempts = Number.parseInt(process.env.VERIFY_ATTEMPTS ?? "1", 10);
  const delaySeconds = Number.parseInt(
    process.env.VERIFY_DELAY_SECONDS ?? "0",
    10
  );

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const version = npmJson(
      ["view", `${release.name}@${release.version}`, "version", "--json"],
      undefined
    );
    const tags = npmJson(["view", release.name, "dist-tags", "--json"], {});
    if (
      version === release.version &&
      tags[distTag] === release.version &&
      sameNonMaintenanceTags(release.tagsBefore, tags)
    ) {
      return;
    }
    if (attempt === attempts) {
      throw new Error(
        `registry verification failed for ${release.name}@${release.version}: ` +
          JSON.stringify({
            version,
            tagsBefore: release.tagsBefore,
            tagsAfter: tags,
          })
      );
    }
    await sleep(delaySeconds * 1000);
  }
}

function packageTag({ name, version }) {
  return `${name}@${version}`;
}

async function publishPlan() {
  assertMaintenanceState();
  const { releases } = JSON.parse(readFileSync(planFile, "utf8"));
  if (releases.length === 0) {
    console.log(
      "No package versions changed in this commit; nothing to publish."
    );
    return;
  }

  const directory = mkdtempSync(join(tmpdir(), "mcp-use-v1-publish-"));
  try {
    for (const release of releases) {
      if (!release.published) {
        const packed = JSON.parse(
          run("pnpm", [
            "--filter",
            release.name,
            "pack",
            "--pack-destination",
            directory,
            "--json",
          ])
        );
        if (
          packed.name !== release.name ||
          packed.version !== release.version
        ) {
          throw new Error(
            `packed identity mismatch for ${release.name}@${release.version}`
          );
        }
        console.log(
          `publishing ${release.name}@${release.version} under ${distTag}`
        );
        run("npm", [
          "publish",
          packed.filename,
          "--tag",
          distTag,
          "--access",
          "public",
          "--provenance",
        ]);
      }

      await verifyRelease(release);

      const tag = packageTag(release);
      try {
        execFileSync("git", ["rev-parse", "--verify", `refs/tags/${tag}`], {
          cwd: root,
          stdio: "ignore",
        });
      } catch {
        run("git", ["tag", "-a", tag, "-m", tag]);
      }
      run("git", ["push", "origin", `refs/tags/${tag}`]);
      console.log(`verified ${release.name}@${release.version}`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const command = process.argv[2];
if (command === "plan") {
  createPlan();
} else if (command === "publish") {
  await publishPlan();
} else {
  throw new Error("usage: node scripts/v1-release.mjs <plan|publish>");
}
