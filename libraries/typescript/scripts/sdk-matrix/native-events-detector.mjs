#!/usr/bin/env node
// Native-Events release detector (PLAN.md D75, §18.7.4, WP-38).
//
// mcp-use owns `events/*`; no code path depends on the SDK shipping Events.
// This script only reports drift:
//
//   native-events-detector.mjs                    exit 1 and print a report when
//                                                 a published SDK version (latest
//                                                 or a newer prerelease) exports
//                                                 `./ext/events`; exit 0 otherwise
//   native-events-detector.mjs --installed <dir>  exit 0 when the SDK resolved
//                                                 from <dir> exports `./ext/events`
//                                                 (the interop suite applies),
//                                                 1 when it does not
//   native-events-detector.mjs --prerelease-available
//                                                 exit 0 when npm has a prerelease
//                                                 newer than `latest`, 1 when not
//                                                 (the matrix skips the leg with
//                                                 reason `no-newer-prerelease`)
//
// Versions are compared only here, in CI tooling; the library never branches on
// SDK versions (D79).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SDK_PACKAGES = [
  "@modelcontextprotocol/server",
  "@modelcontextprotocol/client",
  "@modelcontextprotocol/core",
];
export const EVENTS_SUBPATH = "./ext/events";

/** True when a package.json `exports` map exposes the Events extension. */
export function exportsNativeEvents(manifest) {
  const exp = manifest?.exports;
  if (!exp || typeof exp !== "object") return false;
  return Object.prototype.hasOwnProperty.call(exp, EVENTS_SUBPATH);
}

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v);
  if (!m) return null;
  return { nums: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split(".") : [] };
}

/** semver precedence compare; returns <0, 0, >0. Unparseable sorts lowest. */
export function compareVersions(a, b) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  for (let i = 0; i < 3; i++)
    if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && +p !== +q) return +p - +q;
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** The highest prerelease strictly newer than `latest`, or null. */
export function newerPrerelease(versions, latest) {
  const pre = versions
    .filter((v) => parse(v)?.pre.length)
    .filter((v) => compareVersions(v, latest) > 0)
    .sort(compareVersions);
  return pre.at(-1) ?? null;
}

function npmView(spec, field) {
  const out = execFileSync("npm", ["view", spec, field, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
  return out ? JSON.parse(out) : null;
}

function installedManifest(dir, name) {
  const req = createRequire(join(dir, "package.json"));
  // `exports` blocks ./package.json, so walk up from the resolved entry.
  let d = dirname(req.resolve(name));
  for (;;) {
    try {
      const m = JSON.parse(readFileSync(join(d, "package.json"), "utf8"));
      if (m.name === name) return m;
    } catch {
      // keep walking
    }
    const up = dirname(d);
    if (up === d) throw new Error(`cannot find package.json for ${name}`);
    d = up;
  }
}

function main(argv) {
  if (argv[0] === "--installed") {
    const dir = argv[1] ?? process.cwd();
    const m = installedManifest(dir, "@modelcontextprotocol/server");
    const native = exportsNativeEvents(m);
    console.log(
      JSON.stringify({ server: m.version, nativeEvents: native }, null, 0)
    );
    return native ? 0 : 1;
  }
  const server = SDK_PACKAGES[0];
  const latest = npmView(server, "dist-tags.latest");
  const versions = npmView(server, "versions") ?? [];
  const pre = newerPrerelease(versions, latest);
  if (argv[0] === "--prerelease-available") {
    console.log(JSON.stringify({ latest, prerelease: pre }));
    return pre ? 0 : 1;
  }
  const report = [];
  for (const v of [latest, pre].filter(Boolean)) {
    for (const name of SDK_PACKAGES) {
      const exp = npmView(`${name}@${v}`, "exports");
      report.push({
        package: name,
        version: v,
        nativeEvents: exportsNativeEvents({ exports: exp }),
      });
    }
  }
  console.log(JSON.stringify({ latest, prerelease: pre, report }, null, 2));
  const found = report.filter((r) => r.nativeEvents);
  if (found.length) {
    console.error(
      `Native Events detected in ${found.map((r) => `${r.package}@${r.version}`).join(", ")}: ` +
        "run the pr-3209/interop suites against it and review D75/D84 drift."
    );
    return 1;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  }
}
