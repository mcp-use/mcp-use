import { copyFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

const serverManifest = realpathSync(
  fileURLToPath(
    new URL(
      "../node_modules/@modelcontextprotocol/server/package.json",
      import.meta.url
    )
  )
);
const targetDirectory = fileURLToPath(
  new URL("../dist/third-party-licenses/", import.meta.url)
);
const requireFromServer = createRequire(serverManifest);

const packageRoots = new Map([
  ["@modelcontextprotocol/server", dirname(serverManifest)],
  [
    "@modelcontextprotocol/core",
    resolvePackageRoot("@modelcontextprotocol/core"),
  ],
  ["zod", resolvePackageRoot("zod")],
]);

mkdirSync(targetDirectory, { recursive: true });
for (const [name, root] of packageRoots) {
  const slug = name.replace(/^@/, "").replaceAll("/", "-");
  copyFileSync(join(root, "LICENSE"), join(targetDirectory, `${slug}-LICENSE`));
}

function resolvePackageRoot(name) {
  let directory = dirname(requireFromServer.resolve(name));
  const root = parse(directory).root;
  while (directory !== root) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(directory, "package.json"), "utf8")
      );
      if (manifest.name === name) return directory;
    } catch {
      // Continue upward until the resolved dependency root is found.
    }
    directory = dirname(directory);
  }
  throw new Error(`Could not locate package root for ${name}`);
}
