import chalk from "chalk";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const CACHE_DIR = path.join(os.homedir(), ".mcp-use");
const CACHE_FILE = path.join(CACHE_DIR, "update-check.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 3000;
const PACKAGE_NAME = "mcp-use";

interface UpdateCache {
  lastChecked: string;
  latestVersion: string;
}

/**
 * Parse a semver string into numeric parts for comparison.
 * Returns null for any string that doesn't look like X.Y.Z.
 */
function parseSemver(version: string): [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [
    parseInt(match[1], 10),
    parseInt(match[2], 10),
    parseInt(match[3], 10),
  ];
}

/** Returns true when `candidate` is strictly newer than `current`. */
function isNewer(current: string, candidate: string): boolean {
  const a = parseSemver(current);
  const b = parseSemver(candidate);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return true;
    if (b[i] < a[i]) return false;
  }
  return false;
}

async function readCache(): Promise<UpdateCache | null> {
  try {
    const content = await readFile(CACHE_FILE, "utf-8");
    return JSON.parse(content) as UpdateCache;
  } catch {
    return null;
  }
}

async function writeCache(latestVersion: string): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const cache: UpdateCache = {
      lastChecked: new Date().toISOString(),
      latestVersion,
    };
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
  } catch {
    // Non-fatal — ignore write errors
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
        {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        }
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { version?: string };
      return data.version ?? null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

async function getLatestVersion(): Promise<string | null> {
  const cache = await readCache();
  if (cache) {
    const age = Date.now() - new Date(cache.lastChecked).getTime();
    if (age < CACHE_TTL_MS) {
      return cache.latestVersion;
    }
  }
  const latest = await fetchLatestVersion();
  if (latest) {
    await writeCache(latest);
  }
  return latest;
}

/**
 * Resolve the version of `mcp-use` installed in the user's project.
 * Falls back to the CLI's own bundled copy for monorepo / global installs.
 */
function resolveInstalledVersion(
  projectPath: string | undefined
): string | null {
  const attempts: (() => string)[] = [];

  if (projectPath) {
    attempts.push(() => {
      const projectRequire = createRequire(
        path.join(projectPath, "package.json")
      );
      return projectRequire.resolve(`${PACKAGE_NAME}/package.json`);
    });
  }

  // Monorepo / global fallback: bundled alongside the CLI
  attempts.push(() => path.join(__dirname, "../../mcp-use/package.json"));

  for (const attempt of attempts) {
    try {
      const pkgPath = attempt();
      const json = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (typeof json.version === "string") return json.version as string;
    } catch {
      // Try next
    }
  }
  return null;
}

/**
 * Check npm for a newer version of `mcp-use` and print a notification when
 * one is available. Runs silently on any error so it never interrupts the CLI.
 */
export async function notifyIfUpdateAvailable(
  projectPath: string | undefined
): Promise<void> {
  try {
    const installed = resolveInstalledVersion(projectPath);
    if (!installed) return;

    const latest = await getLatestVersion();
    if (!latest) return;

    if (isNewer(installed, latest)) {
      console.log(
        chalk.yellow(
          `\nA new release of ${chalk.bold(PACKAGE_NAME)} is available: ` +
            `${chalk.dim(installed)} → ${chalk.cyan.bold(latest)}`
        )
      );
      console.log(
        chalk.gray(
          `Run ${chalk.white(`npm install ${PACKAGE_NAME}@latest`)} to update\n`
        )
      );
    }
  } catch {
    // Never surface errors from the update check
  }
}
