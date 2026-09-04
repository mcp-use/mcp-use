/**
 * Prepared fixture projects for the CLI integration tests.
 *
 * The tests stand up a small customer project and run `mcp-use dev`, `build`
 * or `typecheck` against it. That project has to resolve `mcp-use`, `zod` and
 * friends from its own location, so it needs a real installation rather than
 * whatever happens to sit above it on disk.
 *
 * Installing per test would cost about 13s each, so one template per fixture
 * is installed here in `globalSetup` and reused. Copies are made from the
 * template by {@link copyFixture}.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(here, "..", "..", "..", "..");

/** Fixtures that are installed and copied for the integration tests. */
export const FIXTURE_KINDS = ["basic", "views"] as const;

/** One of the committed fixture projects under `tests/cli/fixtures`. */
export type FixtureKind = (typeof FIXTURE_KINDS)[number];

/** Environment variable carrying a prepared template path to the workers. */
export function templateEnvVar(kind: FixtureKind): string {
  return `MCP_USE_CLI_FIXTURE_${kind.toUpperCase()}`;
}

/**
 * Pack the local framework so fixtures install the code under test.
 *
 * @param destination - Directory the tarball is written to.
 * @returns Absolute path to the packed tarball.
 */
function packFramework(destination: string): string {
  const packed = run(
    "pnpm",
    [
      "--filter",
      "mcp-use",
      "pack",
      "--pack-destination",
      destination,
      "--json",
    ],
    workspaceRoot
  );
  const { filename } = JSON.parse(packed) as { filename: string };
  return filename;
}

/** Quote a `cmd.exe` argument, for temp paths that can contain spaces. */
function quoteForCmd(value: string): string {
  return /[\s"^&|<>]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Run a package manager and fail with its output rather than an exit status.
 *
 * @param command - Executable name, without the Windows extension.
 * @param args - Arguments passed through unshelled.
 * @param cwd - Working directory for the child.
 * @returns The child's stdout.
 */
function run(command: string, args: readonly string[], cwd: string): string {
  // npm and pnpm are .cmd shims on Windows, and since the fix for
  // CVE-2024-27980 node refuses to spawn those without a shell: bare `pnpm`
  // is ENOENT and `pnpm.cmd` is EINVAL. Going through cmd.exe means quoting
  // the arguments, which the array form does not do.
  const windows = process.platform === "win32";
  const result = windows
    ? spawnSync(`${command} ${args.map(quoteForCmd).join(" ")}`, {
        cwd,
        shell: true,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 20 * 1024 * 1024,
      })
    : spawnSync(command, [...args], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 20 * 1024 * 1024,
      });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed in ${cwd}\n${result.stderr || result.stdout}`
    );
  }
  return result.stdout;
}

/**
 * Copy one fixture, point its `mcp-use` dependency at the packed tarball, and
 * install everything it declares.
 *
 * The fixture manifest is the single list of what the project needs. Only the
 * framework entry is rewritten, so the tests exercise the local build instead
 * of whatever version the registry would hand back for `mcp-use`.
 *
 * @param kind - Fixture to prepare.
 * @param tarball - Packed framework tarball.
 * @param root - Directory the template is created under.
 * @returns Absolute path to the installed template project.
 */
function installTemplate(
  kind: FixtureKind,
  tarball: string,
  root: string
): string {
  const template = join(root, kind);
  mkdirSync(template, { recursive: true });
  cpSync(join(here, "fixtures", kind), template, { recursive: true });

  const manifestPath = join(template, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    dependencies: Record<string, string>;
  };
  manifest.dependencies["mcp-use"] = `file:${tarball}`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  run("npm", ["install", "--no-audit", "--no-fund"], template);
  return template;
}

/**
 * Install every fixture template and publish their paths to the test workers.
 *
 * @returns Teardown that removes the prepared projects.
 */
export function prepareFixtureProjects(): () => void {
  const root = mkdtempSync(join(tmpdir(), "mcp-use-cli-fixtures-"));
  const startedAt = Date.now();
  const tarball = packFramework(root);
  for (const kind of FIXTURE_KINDS) {
    process.env[templateEnvVar(kind)] = installTemplate(kind, tarball, root);
  }
  console.log(
    `[cli-tests] prepared ${FIXTURE_KINDS.length} fixture projects in ${Math.round(
      (Date.now() - startedAt) / 1000
    )}s`
  );

  return () => {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    // Backstop for copies whose worker died before its exit handler ran.
    rmSync(join(tmpdir(), "mcp-use-cli-tests"), {
      recursive: true,
      force: true,
      maxRetries: 5,
    });
  };
}
