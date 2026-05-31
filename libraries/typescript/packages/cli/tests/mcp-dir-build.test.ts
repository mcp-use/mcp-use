import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI_PATH = join(__dirname, "../dist/index.cjs");

function runCLI(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("Command timeout"));
    }, 60000);
    proc.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe("mcp-use build --mcp-dir", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `mcp-cli-mcp-dir-build-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );

    mkdirSync(join(projectDir, "src", "mcp"), { recursive: true });
    mkdirSync(join(projectDir, "src", "lib"), { recursive: true });

    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify(
        {
          name: "mcp-dir-build-fixture",
          version: "0.0.0",
          dependencies: {
            next: "^16.0.0",
          },
        },
        null,
        2
      )
    );

    writeFileSync(
      join(projectDir, "tsconfig.json"),
      `{
  // Next.js projects commonly use JSONC tsconfig files.
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
    },
    "skipLibCheck": true,
  },
}
`
    );

    writeFileSync(
      join(projectDir, "src", "lib", "server-data.ts"),
      `import { cookies } from "next/headers";

export function readSessionCookie() {
  return cookies().get("session")?.value ?? "anonymous";
}
`
    );

    writeFileSync(
      join(projectDir, "src", "mcp", "index.ts"),
      `import { readSessionCookie } from "@/lib/server-data";

export const session = readSessionCookie();
console.log(session);
`
    );
  });

  afterEach(() => {
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("builds a CommonJS artifact for a CommonJS-default host and shims Next server imports", async () => {
    // The fixture's package.json has no "type" field, so Node treats it as
    // CommonJS — the build should emit a .cjs artifact accordingly.
    const result = await runCLI(["build", "--mcp-dir", "src/mcp"], projectDir);
    const combined = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(combined).toMatch(/MCP server built to dist[/\\]mcp[/\\]index\.cjs/);
    expect(combined).toMatch(/Replaced 1 Next\.js server-runtime import/);
    expect(combined).toMatch(/next\/headers/);
    expect(combined).toMatch(/src[/\\]lib[/\\]server-data\.ts/);

    const serverOutput = join(projectDir, "dist", "mcp", "index.cjs");
    expect(existsSync(serverOutput)).toBe(true);
    const output = readFileSync(serverOutput, "utf-8");
    expect(output).toContain("function cookies()");
    expect(output).not.toMatch(/from\s+["']next\/headers["']/);
    expect(output).not.toMatch(/require\(["']next\/headers["']\)/);

    const manifest = JSON.parse(
      readFileSync(join(projectDir, "dist", "mcp-use.json"), "utf-8")
    );
    expect(manifest.entryPoint).toBe("dist/mcp/index.cjs");
  }, 90000);

  it("builds an ESM artifact when the host package.json is type: module", async () => {
    // Output format must follow the host's runtime module system (package.json
    // "type"), not tsconfig "module" — so a type:module host yields .mjs.
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify(
        {
          name: "mcp-dir-build-fixture",
          version: "0.0.0",
          type: "module",
          dependencies: { next: "^16.0.0" },
        },
        null,
        2
      )
    );

    const result = await runCLI(["build", "--mcp-dir", "src/mcp"], projectDir);
    const combined = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(combined).toMatch(/MCP server built to dist[/\\]mcp[/\\]index\.mjs/);

    const serverOutput = join(projectDir, "dist", "mcp", "index.mjs");
    expect(existsSync(serverOutput)).toBe(true);

    const manifest = JSON.parse(
      readFileSync(join(projectDir, "dist", "mcp-use.json"), "utf-8")
    );
    expect(manifest.entryPoint).toBe("dist/mcp/index.mjs");
  }, 90000);
});
