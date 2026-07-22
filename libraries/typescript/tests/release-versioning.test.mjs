import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const workspaceRoot = new URL("../", import.meta.url).pathname;
const versionScript = new URL(
  "../scripts/version-packages.mjs",
  import.meta.url
).pathname;
const changesetBin = join(workspaceRoot, "node_modules", ".bin", "changeset");
const stableVersions = {
  server: "2.0.0",
  agent: "2.0.0",
  client: "2.0.0",
  cli: "4.0.0",
  inspector: "20.0.0",
  "create-mcp-use-app": "2.0.0",
};
const initialVersions = {
  server: "1.34.3",
  agent: "1.0.0",
  client: "1.0.0",
  cli: "3.6.4",
  inspector: "19.0.0",
  "create-mcp-use-app": "1.0.0",
};

function setup(type, clientVersion) {
  const directory = mkdtempSync(join(tmpdir(), "mcp-use-version-test-"));
  cpSync(workspaceRoot, directory, {
    recursive: true,
    filter: (source) =>
      !source.split("/").includes("node_modules") &&
      !source.split("/").includes("dist"),
  });
  symlinkSync(
    join(workspaceRoot, "node_modules"),
    join(directory, "node_modules")
  );
  for (const file of readdirSync(join(directory, ".changeset"))) {
    if (file.endsWith(".md") && file !== "README.md") {
      rmSync(join(directory, ".changeset", file));
    }
  }
  rmSync(join(directory, ".changeset", "pre.json"), { force: true });
  for (const [packageDirectory, version] of Object.entries(stableVersions)) {
    const file = join(directory, "packages", packageDirectory, "package.json");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    manifest.version = version;
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  writeFileSync(
    join(directory, ".changeset", "synthetic-client.md"),
    `---\n"@mcp-use/client": ${type}\n---\n\nSynthetic Client ${type}.\n`
  );
  execFileSync(changesetBin, ["pre", "enter", "beta"], {
    cwd: directory,
    stdio: "ignore",
  });
  const planFile = join(directory, "synthetic-plan.json");
  writeFileSync(
    planFile,
    JSON.stringify({
      releases: [{ name: "@mcp-use/client", newVersion: clientVersion }],
    })
  );
  return { directory, planFile };
}

function manifest(directory, packageDirectory) {
  return JSON.parse(
    readFileSync(
      join(directory, "packages", packageDirectory, "package.json"),
      "utf8"
    )
  );
}

test("produces the exact initial beta package versions", () => {
  const directory = mkdtempSync(join(tmpdir(), "mcp-use-initial-beta-test-"));
  try {
    cpSync(workspaceRoot, directory, {
      recursive: true,
      filter: (source) =>
        !source.split("/").includes("node_modules") &&
        !source.split("/").includes("dist"),
    });
    symlinkSync(
      join(workspaceRoot, "node_modules"),
      join(directory, "node_modules")
    );
    for (const file of readdirSync(join(directory, ".changeset"))) {
      if (file.endsWith(".md") && file !== "README.md") {
        rmSync(join(directory, ".changeset", file));
      }
    }
    rmSync(join(directory, ".changeset", "pre.json"), { force: true });
    for (const [packageDirectory, version] of Object.entries(initialVersions)) {
      const file = join(
        directory,
        "packages",
        packageDirectory,
        "package.json"
      );
      const packageManifest = JSON.parse(readFileSync(file, "utf8"));
      packageManifest.version = version;
      writeFileSync(file, `${JSON.stringify(packageManifest, null, 2)}\n`);
    }
    writeFileSync(
      join(directory, ".changeset", "initial-v2.md"),
      `---\n"mcp-use": major\n"@mcp-use/agent": major\n"@mcp-use/client": major\n"@mcp-use/cli": major\n"@mcp-use/inspector": major\n"create-mcp-use-app": major\n---\n\nSynthetic initial V2 release.\n`
    );
    execFileSync(changesetBin, ["pre", "enter", "beta"], {
      cwd: directory,
      stdio: "ignore",
    });
    const planFile = join(directory, "initial-plan.json");
    const expected = {
      server: ["mcp-use", "2.0.0-beta.0"],
      agent: ["@mcp-use/agent", "2.0.0-beta.0"],
      client: ["@mcp-use/client", "2.0.0-beta.0"],
      cli: ["@mcp-use/cli", "4.0.0-beta.0"],
      inspector: ["@mcp-use/inspector", "20.0.0-beta.0"],
      "create-mcp-use-app": ["create-mcp-use-app", "2.0.0-beta.0"],
    };
    writeFileSync(
      planFile,
      JSON.stringify({
        releases: Object.values(expected).map(([name, newVersion]) => ({
          name,
          newVersion,
        })),
      })
    );
    execFileSync(process.execPath, [versionScript], {
      cwd: directory,
      env: { ...process.env, CHANGESETS_RELEASE_PLAN_PATH: planFile },
      stdio: "ignore",
    });
    for (const [packageDirectory, [, version]] of Object.entries(expected)) {
      assert.equal(manifest(directory, packageDirectory).version, version);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const scenario of [
  // Inspector is now a regular framework dependency, so its patch release
  // correctly propagates one patch to mcp-use without becoming a false major.
  {
    type: "patch",
    client: "2.0.1-beta.0",
    server: "2.0.1-beta.0",
    inspector: "20.0.1-beta.0",
    inspectorClientPeer: "^2.0.0-alpha.0 || 2.0.1-beta.0",
  },
  {
    type: "minor",
    client: "2.1.0-beta.0",
    server: "2.0.1-beta.0",
    inspector: "20.0.1-beta.0",
    inspectorClientPeer: "^2.0.0-alpha.0 || 2.1.0-beta.0",
  },
  {
    type: "major",
    client: "3.0.0-beta.0",
    server: "3.0.0-beta.0",
    inspector: "21.0.0-beta.0",
    inspectorClientPeer: "^3.0.0-beta.0",
  },
]) {
  test(`avoids false dependent majors for a Client ${scenario.type} beta`, () => {
    const { directory, planFile } = setup(scenario.type, scenario.client);
    try {
      execFileSync(process.execPath, [versionScript], {
        cwd: directory,
        env: { ...process.env, CHANGESETS_RELEASE_PLAN_PATH: planFile },
        stdio: "ignore",
      });
      assert.equal(manifest(directory, "client").version, scenario.client);
      assert.equal(manifest(directory, "server").version, scenario.server);
      assert.equal(
        manifest(directory, "inspector").version,
        scenario.inspector
      );
      assert.equal(
        manifest(directory, "inspector").peerDependencies["@mcp-use/client"],
        scenario.inspectorClientPeer
      );
      if (scenario.type === "minor") {
        execFileSync(changesetBin, ["pre", "exit"], {
          cwd: directory,
          stdio: "ignore",
        });
        execFileSync(process.execPath, [versionScript], {
          cwd: directory,
          stdio: "ignore",
        });
        assert.equal(manifest(directory, "client").version, "2.1.0");
        assert.equal(manifest(directory, "server").version, "2.0.1");
        assert.equal(manifest(directory, "inspector").version, "20.0.1");
        assert.equal(
          manifest(directory, "server").peerDependencies["@mcp-use/client"],
          "^2.0.0-alpha.0"
        );
        assert.equal(
          manifest(directory, "inspector").peerDependencies["@mcp-use/client"],
          "^2.0.0-alpha.0"
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
