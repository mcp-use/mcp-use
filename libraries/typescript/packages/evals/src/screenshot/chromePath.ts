import { accessSync, constants } from "node:fs";
import path from "node:path";

const ENV_VAR_NAMES = [
  "MCP_USE_CHROME_PATH",
  "PUPPETEER_EXECUTABLE_PATH",
  "CHROME_PATH",
] as const;

const DARWIN_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

const LINUX_BINARIES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
  "microsoft-edge",
  "microsoft-edge-stable",
  "brave-browser",
];

const WIN_SUBPATHS = [
  "Google\\Chrome\\Application\\chrome.exe",
  "Microsoft\\Edge\\Application\\msedge.exe",
  "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  "Chromium\\Application\\chrome.exe",
];

function isAccessible(p: string): boolean {
  try {
    accessSync(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(binary: string): string | null {
  const PATH = process.env.PATH ?? "";
  for (const dir of PATH.split(":")) {
    if (!dir) continue;
    const candidate = path.posix.join(dir, binary);
    if (isAccessible(candidate)) return candidate;
  }
  return null;
}

/**
 * Locate a Chrome-family browser executable.
 *
 * Priority: MCP_USE_CHROME_PATH → PUPPETEER_EXECUTABLE_PATH → CHROME_PATH →
 * platform-specific install paths (Chrome → Canary → Chromium → Edge → Brave).
 *
 * Returns the absolute path to the executable, or null if none was found.
 */
export function findChrome(): string | null {
  for (const name of ENV_VAR_NAMES) {
    const v = process.env[name];
    if (v && isAccessible(v)) return v;
  }

  if (process.platform === "darwin") {
    for (const p of DARWIN_PATHS) {
      if (isAccessible(p)) return p;
    }
    return null;
  }

  if (process.platform === "linux") {
    for (const bin of LINUX_BINARIES) {
      const p = findOnPath(bin);
      if (p) return p;
    }
    return null;
  }

  if (process.platform === "win32") {
    const dirs = [
      process.env["ProgramFiles"],
      process.env["ProgramFiles(x86)"],
      process.env["LocalAppData"],
    ].filter((d): d is string => Boolean(d));

    for (const dir of dirs) {
      for (const sub of WIN_SUBPATHS) {
        const candidate = path.join(dir, sub);
        if (isAccessible(candidate)) return candidate;
      }
    }
    return null;
  }

  return null;
}

/**
 * Like findChrome, but throws a user-facing error with install hints.
 */
export function resolveChromePath(): string {
  const found = findChrome();
  if (found) return found;
  throw new Error(
    "Could not find Chrome, Chromium, Edge, or Brave on this system. " +
      "Install Chrome from https://google.com/chrome, or set MCP_USE_CHROME_PATH " +
      "(or PUPPETEER_EXECUTABLE_PATH / CHROME_PATH) to a browser executable."
  );
}
