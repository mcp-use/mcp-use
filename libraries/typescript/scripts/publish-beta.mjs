import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const planFile = join(root, "beta-release-plan.json");
const dryRun = process.argv.includes("--dry-run");
const expectedPackages = new Set([
  "@mcp-use/client",
  "@mcp-use/agent",
  "mcp-use",
  "@mcp-use/cli",
  "@mcp-use/inspector",
  "create-mcp-use-app",
]);
const plan = JSON.parse(readFileSync(planFile, "utf8"));
const releases = plan.releases.filter(({ published }) => !published);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`
    );
  }
  return result.stdout;
}

const plannedPackages = new Set(plan.releases.map(({ name }) => name));
if (
  plannedPackages.size !== expectedPackages.size ||
  [...expectedPackages].some((name) => !plannedPackages.has(name))
) {
  throw new Error("beta release plan does not match the package allowlist");
}

const directory = mkdtempSync(join(tmpdir(), "mcp-use-beta-publish-"));

try {
  for (const { name, version } of releases) {
    const packed = JSON.parse(
      run("pnpm", [
        "--config.node-linker=hoisted",
        "--filter",
        name,
        "pack",
        "--pack-destination",
        directory,
        "--json",
      ])
    );
    if (packed.name !== name || packed.version !== version) {
      throw new Error(
        `packed identity mismatch: expected ${name}@${version}, received ${packed.name}@${packed.version}`
      );
    }

    const publishArgs = [
      "publish",
      packed.filename,
      "--tag",
      "beta",
      "--access",
      "public",
      "--provenance",
    ];
    if (dryRun) publishArgs.push("--dry-run");
    console.log(`${dryRun ? "dry-running" : "publishing"} ${name}@${version}`);
    console.log(run("npm", publishArgs));
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
