/**
 * Node entry for telemetry: installs filesystem persistence, then re-exports
 * the shared Telemetry singleton. `node:fs` stays here so it never enters
 * browser bundles.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import {
  configureTelemetryStorage,
  Tel,
  Telemetry,
  setTelemetrySource,
  type TelemetryStorage,
} from "./telemetry.js";

function getCacheHome(
  os: typeof import("node:os"),
  path: typeof import("node:path")
): string {
  const envVar = process.env.XDG_CACHE_HOME;
  if (envVar && path.isAbsolute(envVar)) {
    return envVar;
  }

  const homeDir = os.homedir();
  if (process.platform === "win32") {
    const appdata = process.env.LOCALAPPDATA || process.env.APPDATA;
    if (appdata) return appdata;
    return path.join(homeDir, "AppData", "Local");
  }
  if (process.platform === "darwin") {
    return path.join(homeDir, "Library", "Caches");
  }
  return path.join(homeDir, ".cache");
}

function createFsStorage(): TelemetryStorage {
  let fs: typeof import("node:fs");
  let os: typeof import("node:os");
  let path: typeof import("node:path");
  try {
    fs = require("node:fs");
    os = require("node:os");
    path = require("node:path");
  } catch {
    return {
      getUserId: () => null,
      setUserId: () => undefined,
      getDownloadedVersion: () => null,
      setDownloadedVersion: () => undefined,
    };
  }

  const cacheHome = getCacheHome(os, path);
  const userIdPath = path.join(cacheHome, "mcp_use_3", "telemetry_user_id");
  const versionPath = path.join(cacheHome, "mcp_use", "download_version");

  return {
    getUserId() {
      try {
        if (!fs.existsSync(userIdPath)) return null;
        return fs.readFileSync(userIdPath, "utf-8").trim() || null;
      } catch {
        return null;
      }
    },
    setUserId(id: string) {
      try {
        fs.mkdirSync(path.dirname(userIdPath), { recursive: true });
        fs.writeFileSync(userIdPath, id);
      } catch {
        // ignore
      }
    },
    getDownloadedVersion() {
      try {
        if (!fs.existsSync(versionPath)) return null;
        return fs.readFileSync(versionPath, "utf-8").trim() || null;
      } catch {
        return null;
      }
    },
    setDownloadedVersion(version: string) {
      try {
        fs.mkdirSync(path.dirname(versionPath), { recursive: true });
        fs.writeFileSync(versionPath, version);
      } catch {
        // ignore
      }
    },
  };
}

configureTelemetryStorage(createFsStorage());

export { Telemetry, Tel, setTelemetrySource };
