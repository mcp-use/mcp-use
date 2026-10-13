#!/usr/bin/env node
/** Workspace smoke test: Start + opaque-origin MCP iframe share React HMR. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MCPClient } from "@mcp-use/client";

const production = process.argv.includes("--production");
const examples = dirname(fileURLToPath(import.meta.url));
const example = join(examples, "tanstack-start");
const requireExample = createRequire(join(example, "package.json"));
const requireInspector = createRequire(
  join(examples, "../../inspector/package.json")
);
const { chromium } = requireInspector("@playwright/test");
const portServer = createServer();
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const root = await mkdtemp(join(example, ".verify-dev-"));
let child, browser, client;
let logs = "";
async function retry(check, timeout = 20000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
try {
  for (const file of [
    "src",
    "public",
    "vite.config.ts",
    "tsconfig.json",
    "package.json",
  ]) {
    await cp(join(example, file), join(root, file), { recursive: true });
  }
  const componentPath = join(root, "src/components/StatusCard.tsx");
  const component = (await readFile(componentPath, "utf8"))
    .replace(
      'import type { ReactNode } from "react";',
      'import { useState, type ReactNode } from "react";\nimport "./card.css";'
    )
    .replace(
      "  return (",
      "  const [count, setCount] = useState(0);\n  return ("
    )
    .replace(
      "<h2>{title}</h2>",
      '<h2>{title}</h2><button className="hmr-counter" onClick={() => setCount(count + 1)}>Clicks {count}</button>'
    );
  await writeFile(componentPath, component);
  if (production) {
    await writeFile(
      componentPath,
      component
        .replace(
          'import "./card.css";',
          'import "./card.css";\nimport artwork from "./artwork.svg";\nimport { lazy, Suspense } from "react";\nconst LazyBadge = lazy(() => import("./LazyBadge"));'
        )
        .replace(
          "<h2>{title}</h2>",
          '<h2>{title}</h2><img src={artwork} alt="Imported asset"/><Suspense><LazyBadge/></Suspense>'
        )
    );
    await writeFile(
      join(root, "src/components/artwork.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'
    );
    await writeFile(
      join(root, "src/components/LazyBadge.tsx"),
      "export default function LazyBadge() { return <p>Lazy production chunk</p>; }"
    );
    const viteConfig = await readFile(join(root, "vite.config.ts"), "utf8");
    await writeFile(
      join(root, "vite.config.ts"),
      viteConfig.replace(
        "defineConfig({",
        "defineConfig({ build: { assetsInlineLimit: 0 },"
      )
    );
  }
  await writeFile(
    join(root, "src/components/card.css"),
    ".hmr-counter { color: rgb(255, 0, 0); }"
  );
  const viteBin = join(
    dirname(requireExample.resolve("vite/package.json")),
    "bin/vite.js"
  );
  if (production) {
    const build = spawn(process.execPath, [viteBin, "build"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    build.stdout.on("data", (value) => {
      logs += value;
    });
    build.stderr.on("data", (value) => {
      logs += value;
    });
    await new Promise((resolve, reject) =>
      build.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`Build failed: ${code}`))
      )
    );
    await cp(join(root, ".output"), join(root, "deployment"), {
      recursive: true,
    });
    for (const path of ["src", "public", ".output", ".mcp-use"])
      await rm(join(root, path), { recursive: true, force: true });
    child = spawn(
      process.execPath,
      [join(root, "deployment/server/index.mjs")],
      {
        cwd: join(root, "deployment"),
        env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
  } else {
    child = spawn(
      process.execPath,
      [viteBin, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] }
    );
  }
  child.stdout.on("data", (value) => {
    logs += value;
  });
  child.stderr.on("data", (value) => {
    logs += value;
  });
  await retry(async () => assert.equal((await fetch(origin)).status, 200));
  client = new MCPClient({
    mcpServers: {
      test: { url: `${origin}/api/mcp`, protocolNegotiation: "modern" },
    },
  });
  const connection = await client.createSession("test");
  const tools = await connection.listTools();
  const uri = tools.find((tool) => tool.name === "show-status-card")._meta.ui
    .resourceUri;
  const resource = await connection.readResource(uri);
  const document = resource.contents.map((item) => item.text ?? "").join("\n");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Clicks 0" }).waitFor();
  await page.evaluate((document) => {
    const frame = window.document.createElement("iframe");
    frame.id = "mcp-view";
    frame.sandbox = "allow-scripts";
    frame.srcdoc = document;
    window.document.body.append(frame);
  }, document);
  const frame = page.frameLocator("#mcp-view");
  try {
    await frame
      .getByRole("button", { name: "Clicks 0" })
      .waitFor({ timeout: 20000 });
  } catch (error) {
    throw new Error(`${error.message}\nBrowser errors:\n${errors.join("\n")}`);
  }
  await page.getByRole("button", { name: "Clicks 0", exact: true }).click();
  await page.getByRole("button", { name: "Clicks 1" }).waitFor();
  await frame.getByRole("button", { name: "Clicks 0" }).click();
  await frame.getByRole("button", { name: "Clicks 1" }).waitFor();
  if (production) {
    await frame.getByText("Lazy production chunk").waitFor();
    await retry(async () =>
      assert.equal(
        await frame
          .getByAltText("Imported asset")
          .evaluate((image) => image.complete && image.naturalWidth > 0),
        true
      )
    );
    assert.equal(
      await frame
        .getByRole("button", { name: "Clicks 1" })
        .evaluate((node) => getComputedStyle(node).color),
      "rgb(255, 0, 0)"
    );
    console.log(
      "✓ Production MCP iframe: embedded CSS, imported assets, lazy chunks, and source-free deployment"
    );
  } else {
    await writeFile(
      componentPath,
      component.replace("mcp-use · TanStack Start", "Shared HMR updated")
    );
    await page.getByText("Shared HMR updated", { exact: true }).waitFor();
    await frame.getByText("Shared HMR updated", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Clicks 1" }).count(),
      1
    );
    assert.equal(
      await frame.getByRole("button", { name: "Clicks 1" }).count(),
      1
    );
    await writeFile(
      join(root, "src/components/card.css"),
      ".hmr-counter { color: rgb(0, 128, 0); }"
    );
    await retry(async () => {
      assert.equal(
        await frame
          .getByRole("button", { name: "Clicks 1" })
          .evaluate((node) => getComputedStyle(node).color),
        "rgb(0, 128, 0)"
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Clicks 1" })
          .evaluate((node) => getComputedStyle(node).color),
        "rgb(0, 128, 0)"
      );
    });
    const serverPath = join(root, "src/mcp/server.ts");
    const server = await readFile(serverPath, "utf8");
    await writeFile(serverPath, server.replace("Hello,", "Updated hello,"));
    await retry(async () => {
      const result = await connection.callTool("greet", { name: "HMR" });
      assert.match(JSON.stringify(result), /Updated hello, HMR/);
    });
    assert.equal(
      await frame.getByRole("button", { name: "Clicks 1" }).count(),
      1
    );
    await writeFile(serverPath, "export default ;");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.match(
      JSON.stringify(await connection.callTool("greet", { name: "HMR" })),
      /Updated hello, HMR/
    );
    await writeFile(serverPath, server);
    await retry(async () =>
      assert.match(
        JSON.stringify(await connection.callTool("greet", { name: "HMR" })),
        /Hello, HMR/
      )
    );
    console.log(
      "✓ Start + MCP iframe: shared component state, CSS HMR, server updates, syntax-error recovery"
    );
  }
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await client?.closeAllSessions().catch(() => {});
  await browser?.close();
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await rm(root, { recursive: true, force: true });
}
