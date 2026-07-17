#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = join(__dirname, "..");
const templatesDir = join(packageDir, "src", "templates");
const templateNames = ["blank", "starter", "mcp-apps"];
const tempRoot = mkdtempSync(join(tmpdir(), "create-mcp-use-app-templates-"));

function runNode(script, args, cwd) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${basename(script)} ${args.join(" ")} failed in ${cwd}`);
  }
}

async function smokeStart(appDir) {
  const buildDir = join(appDir, ".mcp-use", "build");
  const manifest = JSON.parse(
    readFileSync(join(buildDir, "manifest.json"), "utf8")
  );
  const entry = await import(
    pathToFileURL(join(buildDir, manifest.entryPoint))
  );
  const server = entry.default;

  try {
    const result = await server.listen(0);
    if (typeof result?.port !== "number" || result.port <= 0) {
      throw new Error("generated server did not bind an ephemeral port");
    }
  } finally {
    await server.close();
  }
}

try {
  for (const templateName of templateNames) {
    const templateDir = join(templatesDir, templateName);
    const appDir = join(tempRoot, templateName);

    cpSync(templateDir, appDir, {
      recursive: true,
      filter: (source) =>
        !["node_modules", ".mcp-use", "dist"].includes(basename(source)),
    });
    symlinkSync(
      join(templateDir, "node_modules"),
      join(appDir, "node_modules"),
      "junction"
    );

    const packageJsonPath = join(appDir, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    packageJson.name = `template-test-${templateName}`;
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

    const indexPath = join(appDir, "index.ts");
    const index = readFileSync(indexPath, "utf8").replaceAll(
      "{{PROJECT_NAME}}",
      `template-test-${templateName}`
    );
    writeFileSync(indexPath, index);

    console.log(`Typechecking generated ${templateName} template...`);
    runNode(
      join(templateDir, "node_modules", "typescript", "bin", "tsc"),
      ["--project", "tsconfig.json", "--noEmit", "--incremental", "false"],
      appDir
    );

    console.log(`Building generated ${templateName} template...`);
    runNode(
      join(templateDir, "node_modules", "mcp-use", "dist", "bin.js"),
      ["build"],
      appDir
    );

    console.log(`Starting generated ${templateName} template...`);
    await smokeStart(appDir);
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
