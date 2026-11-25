#!/usr/bin/env node
// Resolve already-published mcp-use packages into a bundle (PLAN.md §18.8.1,
// sources `canary` and `pr`; the `pack` source is build-variant.mjs).
//
//   node e2e/manufact/scripts/resolve-published.mjs canary --out <dir> [--tag canary]
//   node e2e/manufact/scripts/resolve-published.mjs pr --ref <sha> --out <dir> [--wait-ms <n>]
//        [--registry <url>] [--preview-base <url>] [--attempt <n>]
//
// canary: reads npm packuments; mcp-use@<tag> anchors the set (resolveCanary).
// pr:     downloads the pkg.pr.new preview of each package at commit <sha>
//         (per-commit URL, D83), waits up to --wait-ms for mcp-use to appear,
//         records each tarball's SHA-256 and reads versions and the SDK pins
//         from the tarballs' package.json.
// Writes <out>/combo.json and <out>/sdk-variant.json; stage-fixture.mjs takes
// the bundle like a packed one. No vendor/ directory: the fixture installs the
// exact versions or preview URLs. Unpublished packages (events-core before it
// ships) are skipped and listed.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  HarnessError,
  PUBLISHED_PACKAGES,
  env,
  parseArgs,
  previewUrl,
  resolveCanary,
  sdkFromDependencies,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const source = args._[0];
if (
  !["canary", "pr"].includes(source) ||
  typeof args.out !== "string" ||
  (source === "pr" && typeof args.ref !== "string")
) {
  console.error(
    "usage: resolve-published.mjs canary --out <dir> [--tag canary]\n" +
      "       resolve-published.mjs pr --ref <sha> --out <dir> [--wait-ms <n>]"
  );
  process.exit(2);
}
const out = resolve(args.out);
const registry = String(
  args.registry ?? env("npm_config_registry") ?? "https://registry.npmjs.org"
).replace(/\/$/, "");
const previewBase = String(
  args["preview-base"] ?? "https://pkg.pr.new"
).replace(/\/$/, "");
const attempt = Number(args.attempt ?? env("GITHUB_RUN_ATTEMPT") ?? 1);

async function get(url) {
  let res;
  try {
    res = await fetch(url, { headers: { accept: "*/*" } });
  } catch (error) {
    throw new HarnessError("infra", `GET ${url} failed`, String(error));
  }
  if (res.status === 404) return undefined;
  if (!res.ok)
    throw new HarnessError("infra", `GET ${url} answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function resolveCanarySource() {
  const tag = typeof args.tag === "string" ? args.tag : "canary";
  const packuments = {};
  for (const { name } of PUBLISHED_PACKAGES) {
    const body = await get(`${registry}/${name.replace("/", "%2f")}`);
    if (body) packuments[name] = JSON.parse(body.toString("utf8"));
  }
  const r = resolveCanary(packuments, { tag });
  return {
    combo: {
      variant: "canary",
      source: "canary",
      tag,
      mcpUse: {
        versions: r.versions,
        specs: r.versions,
        integrity: r.integrity,
      },
      sdk: { ...r.sdk, requested: r.sdk },
      skipped: r.skipped,
    },
  };
}

function manifestOf(tgz) {
  const dir = mkdtempSync(join(tmpdir(), "ev-e2e-preview-"));
  const file = join(dir, "pkg.tgz");
  writeFileSync(file, tgz);
  return JSON.parse(
    execFileSync("tar", ["-xzOf", file, "package/package.json"], {
      encoding: "utf8",
    })
  );
}

async function resolvePrSource() {
  const ref = args.ref;
  const waitMs = Number(args["wait-ms"] ?? 0);
  const deadline = Date.now() + waitMs;
  const versions = {};
  const specs = {};
  const tarballSha256 = {};
  const skipped = [];
  let sdk;
  for (const { name } of PUBLISHED_PACKAGES) {
    const url = previewUrl(name, ref, previewBase);
    let body = await get(url);
    // The preview publish may still be running: only mcp-use itself is waited for.
    while (!body && name === "mcp-use" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, Math.min(15_000, waitMs)));
      body = await get(url);
    }
    if (!body) {
      if (name === "mcp-use")
        throw new HarnessError(
          "infra",
          `no pkg.pr.new preview of mcp-use at ${ref} (${url})`
        );
      skipped.push(name);
      continue;
    }
    const manifest = manifestOf(body);
    specs[name] = url;
    versions[name] = manifest.version;
    tarballSha256[name] = createHash("sha256").update(body).digest("hex");
    if (name === "mcp-use") sdk = sdkFromDependencies(manifest.dependencies);
  }
  return {
    combo: {
      sha: ref,
      variant: "pr",
      source: "pr",
      mcpUse: { versions, specs, tarballSha256 },
      sdk: { ...sdk, requested: sdk },
      skipped,
    },
  };
}

try {
  const { combo } =
    source === "canary" ? await resolveCanarySource() : await resolvePrSource();
  const full = {
    ...combo,
    attempt,
    extAppsPeerOverride: false,
    agentV1Sdk: null,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "combo.json"), `${JSON.stringify(full, null, 2)}\n`);
  writeFileSync(
    join(out, "sdk-variant.json"),
    `${JSON.stringify(
      {
        leg: "as-published",
        requested: combo.sdk.requested,
        resolved: {
          server: combo.sdk.server,
          client: combo.sdk.client,
          core: combo.sdk.core,
        },
        peerOverride: false,
      },
      null,
      2
    )}\n`
  );
  for (const name of combo.skipped)
    console.warn(`skip ${name}: not published for this ${source} source`);
  console.log(JSON.stringify(full, null, 2));
} catch (error) {
  const failureClass =
    error instanceof HarnessError ? error.failureClass : "infra";
  console.error(`[${failureClass}] ${error.message}`);
  process.exitCode = 1;
}
