#!/usr/bin/env node
/**
 * Runtime report: MCP_URL, MCP_ASSETS_URL, CSP_URLS, per-category CSP env vars.
 * Run from repo after packing: node scripts/env-url-csp-runtime-test.mjs
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PKG = join(__dirname, "..");
const FIXTURE = join(SERVER_PKG, "tests/cli/fixtures/views");
const WORK = "/tmp/mcp-env-url-csp-test";
const BUILD_DIR = join(WORK, ".mcp-use/build");

const UI_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "env-test", version: "0.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {
    extensions: {
      "io.modelcontextprotocol/ui": {
        mimeTypes: ["text/html;profile=mcp-app"],
      },
    },
  },
};

const report = [];

function hasExactDomain(domains, expected) {
  return new Set(domains ?? []).has(expected);
}

function hasUrlLocation(value, expectedOrigin, expectedPathPrefix) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.origin === expectedOrigin &&
      parsed.pathname.startsWith(expectedPathPrefix)
    );
  } catch {
    return false;
  }
}

function rebaseUrl(value, origin) {
  if (!value) return undefined;
  const parsed = new URL(value);
  const target = new URL(origin);
  parsed.protocol = target.protocol;
  parsed.host = target.host;
  return parsed.toString();
}

function log(section, data) {
  report.push({ section, ...data });
  console.log(`\n## ${section}`);
  console.log(data.pass ? "PASS" : "FAIL");
  for (const [k, v] of Object.entries(data)) {
    if (k === "section" || k === "pass") continue;
    console.log(
      `  ${k}: ${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`
    );
  }
}

async function mcpJson(
  handler,
  method,
  params = {},
  extraHeaders = {},
  basePath = "/mcp"
) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
    ...extraHeaders,
  };
  if (typeof params.uri === "string") headers["mcp-name"] = params.uri;

  const res = await handler(
    new Request(`http://127.0.0.1:3000${basePath}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: { ...params, _meta: UI_META },
      }),
    })
  );
  return res.json();
}

function extractUrls(html) {
  const script = html.match(/<script type="module" src="([^"]+)"/)?.[1];
  const css = html.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1];
  const publicBase = html.match(
    /__mcpUseViewConfig=\{"publicBase":"([^"]+)"/
  )?.[1];
  return { script, css, publicBase };
}

function clearEnv() {
  delete process.env.MCP_URL;
  delete process.env.MCP_ASSETS_URL;
  delete process.env.CSP_URLS;
  delete process.env.CSP_CONNECT_DOMAINS;
  delete process.env.CSP_RESOURCE_DOMAINS;
  delete process.env.CSP_FRAME_DOMAINS;
  delete process.env.CSP_BASE_URI_DOMAINS;
}

function patchEntryBasePath(basePath) {
  const entry = join(WORK, "src/index.ts");
  const src = readFileSync(entry, "utf8");
  writeFileSync(
    entry,
    src.replace(
      'new MCPServer({ name: "fixture-views", version: "1.0.0" })',
      `new MCPServer({ name: "fixture-views", version: "1.0.0", basePath: "${basePath}" })`
    )
  );
}

function setupProject({ basePath } = {}) {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  cpSync(FIXTURE, WORK, { recursive: true });
  if (basePath) patchEntryBasePath(basePath);
  writeFileSync(
    join(WORK, "package.json"),
    JSON.stringify(
      {
        name: "env-url-csp-test",
        type: "module",
        dependencies: {
          "mcp-use": `file:${SERVER_PKG}`,
          react: "^19.2.4",
          "react-dom": "^19.2.4",
          zod: "^4.4.3",
        },
      },
      null,
      2
    )
  );
  const npm = spawnSync("npm", ["install"], { cwd: WORK, encoding: "utf8" });
  if (npm.status !== 0) throw new Error(`npm install failed: ${npm.stderr}`);
  const build = spawnSync("npx", ["mcp-use", "build"], {
    cwd: WORK,
    encoding: "utf8",
    env: { ...process.env },
  });
  if (build.status !== 0) throw new Error(`build failed: ${build.stderr}`);
}

async function loadHandler() {
  process.chdir(WORK);
  const entry = join(BUILD_DIR, "index.js");
  // Bust ESM import cache between scenario rebuilds (same file path).
  return (await import(`${pathToFileURL(entry).href}?v=${Date.now()}`)).default
    .fetch;
}

async function readView(handler, extraHeaders = {}, basePath = "/mcp") {
  const body = await mcpJson(
    handler,
    "resources/read",
    { uri: "ui://views/product-search-result.html" },
    extraHeaders,
    basePath
  );
  const content = body.result.contents[0];
  const html = content.text;
  const csp = content._meta?.ui?.csp;
  return { html, csp, urls: extractUrls(html) };
}

async function main() {
  const build = spawnSync("pnpm", ["run", "build"], {
    cwd: SERVER_PKG,
    encoding: "utf8",
  });
  if (build.status !== 0) throw new Error(`pnpm build failed: ${build.stderr}`);

  clearEnv();
  setupProject();
  let handler = await loadHandler();

  {
    clearEnv();
    const { urls, csp } = await readView(handler);
    const localScript = rebaseUrl(urls.script, "http://127.0.0.1:3000");
    const status = localScript
      ? (await handler(new Request(localScript))).status
      : 0;
    log("Default (no env)", {
      pass:
        hasUrlLocation(urls.script, "http://127.0.0.1:3000", "/mcp/") &&
        hasExactDomain(csp?.connectDomains, "http://127.0.0.1:3000") &&
        status === 200,
      scriptUrl: urls.script,
      publicBase: urls.publicBase,
      connectDomains: csp?.connectDomains,
      resourceDomains: csp?.resourceDomains,
      assetHttpStatus: status,
    });
  }

  {
    clearEnv();
    process.env.MCP_URL = "https://server.example.com/mcp";
    const { urls, csp } = await readView(handler);
    log("MCP_URL only (server origin)", {
      pass:
        hasUrlLocation(urls.script, "https://server.example.com", "/mcp/") &&
        hasExactDomain(csp?.connectDomains, "https://server.example.com") &&
        hasExactDomain(csp?.resourceDomains, "https://server.example.com"),
      scriptUrl: urls.script,
      connectDomains: csp?.connectDomains,
      resourceDomains: csp?.resourceDomains,
    });
  }

  {
    clearEnv();
    process.env.MCP_URL = "https://server.example.com/mcp";
    process.env.MCP_ASSETS_URL =
      "https://cdn.example.com/storage/v1/object/public/widgets";
    const { urls, csp } = await readView(handler);
    log("Split MCP_URL + MCP_ASSETS_URL", {
      pass:
        hasUrlLocation(urls.script, "https://cdn.example.com", "/") &&
        hasExactDomain(csp?.connectDomains, "https://server.example.com") &&
        hasExactDomain(csp?.resourceDomains, "https://cdn.example.com") &&
        !hasExactDomain(csp?.resourceDomains, "https://server.example.com"),
      scriptUrl: urls.script,
      publicBase: urls.publicBase,
      connectDomains: csp?.connectDomains,
      resourceDomains: csp?.resourceDomains,
    });
  }

  {
    clearEnv();
    process.env.CSP_URLS = "https://supabase.co,https://api.example.com";
    const { csp } = await readView(handler);
    const allHave = (cat) =>
      hasExactDomain(csp?.[cat], "https://supabase.co") &&
      hasExactDomain(csp?.[cat], "https://api.example.com");
    log("CSP_URLS shortcut (all four categories)", {
      pass:
        allHave("connectDomains") &&
        allHave("resourceDomains") &&
        allHave("frameDomains") &&
        allHave("baseUriDomains"),
      csp,
    });
  }

  {
    clearEnv();
    process.env.CSP_URLS = "https://server.example.com";
    process.env.MCP_URL = "https://server.example.com";
    const { csp } = await readView(handler);
    const connect = csp?.connectDomains ?? [];
    log("CSP_URLS precedence over MCP auto-append", {
      pass:
        connect.filter((d) => d === "https://server.example.com").length ===
          1 && connect[0] === "https://server.example.com",
      connectDomains: connect,
    });
  }

  {
    clearEnv();
    process.env.CSP_URLS = "https://a.com,https://b.com";
    process.env.CSP_CONNECT_DOMAINS = "https://connect-only.example.com";
    const { csp } = await readView(handler);
    log("Per-category CSP_CONNECT_DOMAINS override", {
      pass:
        hasExactDomain(
          csp?.connectDomains,
          "https://connect-only.example.com"
        ) &&
        !hasExactDomain(csp?.connectDomains, "https://a.com") &&
        hasExactDomain(csp?.frameDomains, "https://a.com"),
      connectDomains: csp?.connectDomains,
      frameDomains: csp?.frameDomains,
    });
  }

  {
    clearEnv();
    const { urls, csp } = await readView(handler, {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "fruit.example.com",
    });
    log("X-Forwarded-* (no MCP_URL)", {
      pass:
        hasUrlLocation(urls.script, "https://fruit.example.com", "/mcp/") &&
        hasExactDomain(csp?.resourceDomains, "https://fruit.example.com"),
      scriptUrl: urls.script,
      resourceDomains: csp?.resourceDomains,
    });
  }

  {
    clearEnv();
    process.env.MCP_ASSETS_URL =
      "https://cdn.example.com/storage/v1/object/public/widgets";
    rmSync(WORK, { recursive: true, force: true });
    setupProject();
    handler = await loadHandler();
    const { urls } = await readView(handler);
    log("Build with MCP_ASSETS_URL (CDN manifest)", {
      pass: hasUrlLocation(urls.script, "https://cdn.example.com", "/"),
      scriptUrl: urls.script,
    });
  }

  {
    clearEnv();
    const customBasePath = "/api/mcp";
    rmSync(WORK, { recursive: true, force: true });
    setupProject({ basePath: customBasePath });
    const customHandler = await loadHandler();
    const { urls, csp } = await readView(customHandler, {}, customBasePath);
    const localScript = rebaseUrl(urls.script, "http://127.0.0.1:3000");
    const status = localScript
      ? (await customHandler(new Request(localScript))).status
      : 0;
    log("Custom basePath (/api/mcp)", {
      pass:
        hasUrlLocation(
          urls.script,
          "http://127.0.0.1:3000",
          "/api/mcp/_mcp-use/views/"
        ) &&
        hasUrlLocation(
          urls.publicBase,
          "http://127.0.0.1:3000",
          "/api/mcp/_mcp-use/public/"
        ) &&
        hasExactDomain(csp?.connectDomains, "http://127.0.0.1:3000") &&
        status === 200,
      basePath: customBasePath,
      scriptUrl: urls.script,
      publicBase: urls.publicBase,
      connectDomains: csp?.connectDomains,
      assetHttpStatus: status,
    });
  }

  const passed = report.filter((r) => r.pass).length;
  writeFileSync(
    join(WORK, "RUNTIME-ENV-REPORT.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  console.log(`\n--- ${passed}/${report.length} scenarios passed ---`);
  console.log(`Report: ${join(WORK, "RUNTIME-ENV-REPORT.json")}`);
  if (passed < report.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
