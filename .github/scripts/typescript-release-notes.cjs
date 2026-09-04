const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

module.exports = async ({ github, context, core }) => {
  const plan = JSON.parse(
    fs.readFileSync(
      path.join(process.env.RUNNER_TEMP, "release-plan.json"),
      "utf8",
    ),
  );
  const root = path.join(
    process.env.GITHUB_WORKSPACE,
    "libraries/typescript/packages",
  );
  const packages = fs.readdirSync(root).map((dir) => ({
    dir,
    ...JSON.parse(
      fs.readFileSync(path.join(root, dir, "package.json"), "utf8"),
    ),
  }));
  for (const release of plan.releases.filter((item) => item.target)) {
    const tag = `${release.name}@${release.version}`;
    const sha =
      release.sourceSha ||
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    // A recovered package must be tagged at its original published revision.
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`]);
    try {
      const existing = execFileSync(
        "git",
        ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      if (existing !== sha)
        throw new Error(
          `${tag} already points to ${existing}, expected ${sha}`,
        );
    } catch (error) {
      if (error.status !== 128) throw error;
      execFileSync("git", ["tag", "-a", tag, sha, "-m", tag]);
    }
    execFileSync("git", ["push", "origin", `refs/tags/${tag}`]);
    try {
      await github.rest.repos.getReleaseByTag({ ...context.repo, tag });
      core.info(`Release already exists: ${tag}`);
      continue;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    const pkg = packages.find((item) => item.name === release.name);
    let notes = `Release ${release.version} of ${release.name}.`;
    const file = path.join(root, pkg.dir, "CHANGELOG.md");
    if (fs.existsSync(file)) {
      const sections = fs.readFileSync(file, "utf8").split(/^## /m);
      const section = sections.find(
        (value) => value.split(/\r?\n/, 1)[0].trim() === release.version,
      );
      if (section)
        notes = section.slice(section.indexOf("\n") + 1).trim() || notes;
    }
    await github.rest.repos.createRelease({
      ...context.repo,
      tag_name: tag,
      name: tag,
      body: notes,
      prerelease: plan.channel === "canary",
      make_latest:
        plan.channel === "stable" && release.name === "mcp-use"
          ? "true"
          : "false",
    });
  }
};
