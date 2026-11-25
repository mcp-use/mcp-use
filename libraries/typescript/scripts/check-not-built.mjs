#!/usr/bin/env node
// Lists every remaining notBuilt("WP-nn") skeleton in the Events sources,
// grouped by work package. `--fail` exits 1 when any remain (release gate).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const roots = [
  "packages/server/src/events",
  "packages/client/src/events",
  "packages/events-core/src",
];
const base = fileURLToPath(new URL("..", import.meta.url));
const byWp = new Map();
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts")) {
      for (const m of readFileSync(p, "utf8").matchAll(
        /notBuilt\("(WP-\d+)"\)/g
      )) {
        const list = byWp.get(m[1]) ?? new Set();
        list.add(p.slice(base.length));
        byWp.set(m[1], list);
      }
    }
  }
}
for (const r of roots) walk(join(base, r));
const wps = [...byWp.keys()].sort();
for (const wp of wps)
  console.log(`${wp}: ${[...byWp.get(wp)].sort().join(", ")}`);
console.log(
  `${wps.reduce((n, wp) => n + byWp.get(wp).size, 0)} skeleton files`
);
if (process.argv.includes("--fail") && wps.length > 0) process.exit(1);
