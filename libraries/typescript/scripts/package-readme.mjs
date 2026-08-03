import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryReadme = resolve(scriptDirectory, "../../../README.md");
const packageReadme = resolve(scriptDirectory, "../packages/server/README.md");

if (process.argv[2] !== "verify") {
  throw new Error(`Expected "verify", received: ${process.argv[2]}`);
}

if (
  readFileSync(repositoryReadme, "utf8") !== readFileSync(packageReadme, "utf8")
) {
  throw new Error(
    "The mcp-use package README is out of sync with the repository README."
  );
}
