import { createServer, type Server } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDoctorReport } from "../src/commands/doctor.js";

async function makeProject(): Promise<string> {
  const projectDir = path.join(
    tmpdir(),
    `mcp-doctor-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(projectDir, { recursive: true });
  return projectDir;
}

async function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address.");
      }
      resolve(address.port);
    });
  });
}

describe("doctor diagnostics", () => {
  const cleanup: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
    );
  });

  it("reports config, workspace, dependencies, build manifest, and placeholders", async () => {
    const projectDir = await makeProject();
    cleanup.push(projectDir);
    await mkdir(path.join(projectDir, "src"), { recursive: true });
    await mkdir(path.join(projectDir, "resources"), { recursive: true });
    await mkdir(path.join(projectDir, ".mcp-use", "build"), {
      recursive: true,
    });
    await writeFile(
      path.join(projectDir, "mcp-use.json"),
      JSON.stringify({
        version: 1,
        entry: "src/server.ts",
        viewsDir: "resources",
      })
    );
    await writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({
        dependencies: {
          "mcp-use": "workspace:*",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
      })
    );
    await writeFile(
      path.join(projectDir, ".mcp-use", "build", "manifest.json"),
      JSON.stringify({
        buildId: "build_123",
        entryPoint: ".mcp-use/build/server/index.js",
        widgets: {
          dashboard: {},
        },
      })
    );

    const report = await createDoctorReport({
      projectRoot: projectDir,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(report.ok).toBe(true);
    expect(report.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(report.sections.config.status).toBe("ok");
    expect(report.sections.workspace.status).toBe("ok");
    expect(report.sections.packageDeps.status).toBe("ok");
    expect(report.sections.build.checks[0]).toMatchObject({
      status: "ok",
      path: ".mcp-use/build/manifest.json",
      details: {
        buildId: "build_123",
        entryPoint: ".mcp-use/build/server/index.js",
        widgetCount: 1,
      },
    });
    expect(report.sections.inspector.status).toBe("skipped");
    expect(report.sections.apps.status).toBe("todo");
    expect(report.sections.oauth.status).toBe("todo");
    expect(report.sections.schema.status).toBe("todo");
    expect(report.sections.security.status).toBe("todo");
  });

  it("keeps going when mcp-use.json is invalid", async () => {
    const projectDir = await makeProject();
    cleanup.push(projectDir);
    await writeFile(path.join(projectDir, "mcp-use.json"), "{ nope");
    await writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({
        dependencies: {
          "mcp-use": "workspace:*",
        },
      })
    );

    const report = await createDoctorReport({ projectRoot: projectDir });

    expect(report.ok).toBe(false);
    expect(report.sections.config.status).toBe("error");
    expect(report.sections.config.checks[0].message).toMatch(
      /Invalid mcp-use\.json/
    );
    expect(report.sections.packageDeps.status).toBe("ok");
    expect(report.sections.build.status).toBe("warning");
  });

  it("checks inspector health when a URL is provided", async () => {
    const projectDir = await makeProject();
    cleanup.push(projectDir);
    await writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({
        dependencies: {
          "mcp-use": "workspace:*",
        },
      })
    );

    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const port = await listen(server);

    try {
      const report = await createDoctorReport({
        projectRoot: projectDir,
        inspectorHealthUrl: `http://127.0.0.1:${port}/inspector/health`,
      });

      expect(report.sections.inspector.status).toBe("ok");
      expect(report.sections.inspector.checks[0].details).toMatchObject({
        status: 200,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
