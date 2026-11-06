import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { describe, expect } from "vitest";
import { test } from "../helpers/cli-test.js";
import { signIn, SIGNED_IN } from "../helpers/cloud-auth.js";
import { deployment, server } from "../helpers/cloud-fixtures.js";

const exec = promisify(execFile);

const CONNECTED_REPOSITORY = {
  isManaged: false,
  productionBranch: "main",
  repoFullName: "example/weather",
  githubInstallationId: "inst_record",
  watchPaths: [],
  deployBranchPatterns: [],
  waitForCi: false,
};

const VARIABLE_METADATA = {
  serverId: "srv_1",
  phase: "both",
  sensitive: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

async function link(cwd: string): Promise<void> {
  await mkdir(join(cwd, ".manufact"), { recursive: true });
  await writeFile(
    join(cwd, ".manufact", "project.json"),
    JSON.stringify({ orgId: "org_1", serverId: "srv_1" })
  );
}

async function repository(cwd: string, branch = "main"): Promise<void> {
  await writeFile(join(cwd, "weather.py"), "print('weather')\n");
  await writeFile(join(cwd, ".gitignore"), ".manufact/\n");
  for (const args of [
    ["init", "-b", branch],
    ["config", "user.email", "fixture@example.test"],
    ["config", "user.name", "Fixture"],
    ["add", "."],
    ["commit", "-m", "Fixture"],
    ["remote", "add", "origin", "https://github.com/example/weather.git"],
  ])
    await exec("git", args, { cwd });
}

describe("deploy", () => {
  for (const step of ["create", "start", "wait"] as const) {
    test(`a timeout during ${step} explains recovery without retrying creation`, async ({
      cli,
      cloud,
    }) => {
      signIn(cloud);
      await repository(cli.cwd);
      if (step === "start") {
        await link(cli.cwd);
        cloud.on("GET", "/api/v1/servers/srv_1", {
          body: server({
            id: "srv_1",
            connectedRepository: { ...CONNECTED_REPOSITORY },
          }),
        });
        cloud.on("POST", "/api/v1/deployments", {
          status: 504,
          body: { error: "Raw proxy timeout" },
        });
      } else {
        cloud.on("GET", "/api/v1/github/installations", {
          body: {
            installations: [
              {
                id: "inst_record",
                installationId: "123",
                organizationId: "org_1",
                isActive: true,
                account: { login: "example", type: "Organization" },
              },
            ],
          },
        });
        cloud.on(
          "GET",
          "/api/v1/github/installations/123/repos/example/weather/access",
          { body: { hasAccess: true } }
        );
        if (step === "create")
          cloud.on("POST", "/api/v1/servers", {
            status: 524,
            body: { error: "Raw proxy timeout" },
          });
        else {
          cloud.on("POST", "/api/v1/servers", {
            body: {
              server: { id: "srv_1", slug: "weather" },
              deploymentId: "dep_1",
            },
          });
          cloud.on("GET", "/api/v1/deployments/dep_1", {
            status: 504,
            body: { error: "Raw proxy timeout" },
          });
        }
      }
      const result = await cli.run(["deploy", "--json"], { env: SIGNED_IN });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.json).toMatchObject({
        error: {
          code: "cloud_timeout",
          message: expect.stringContaining(
            step === "create"
              ? "creating the server"
              : step === "start"
                ? "starting the deployment"
                : "checking deployment dep_1"
          ),
        },
      });
      expect(result.stdout).not.toContain("Raw proxy timeout");
      expect(
        cloud.requestsTo(
          "POST",
          step === "start" ? "/api/v1/deployments" : "/api/v1/servers"
        )
      ).toHaveLength(1);
      if (step === "wait")
        expect(
          JSON.parse(
            await readFile(join(cli.cwd, ".manufact/project.json"), "utf8")
          )
        ).toEqual({ orgId: "org_1", serverId: "srv_1" });
      if (step === "create")
        await expect(
          readFile(join(cli.cwd, ".manufact/project.json"), "utf8")
        ).rejects.toMatchObject({ code: "ENOENT" });
    });
  }

  test("help and malformed flags make no Cloud requests", async ({
    cli,
    cloud,
  }) => {
    const help = await cli.run(["deploy", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("--no-wait");
    expect(help.stdout).toContain("--external-url");
    const invalid = await cli.run(["deploy", "--unknown", "--json"]);
    expect(invalid.exitCode).toBe(2);
    expect(invalid.json).toMatchObject({ error: { code: "usage_error" } });
    expect(cloud.requests).toEqual([]);
  });

  test("uploads a non-Node project and --no-wait returns one document and saves the link", async ({
    cli,
    cloud,
  }) => {
    signIn(cloud);
    await writeFile(join(cli.cwd, "weather.py"), "print('weather')\n");
    await writeFile(join(cli.cwd, ".env"), "SECRET=do-not-upload\n");
    await mkdir(join(cli.cwd, ".manufact"), { recursive: true });
    await writeFile(join(cli.cwd, ".manufact", "auth.json"), "private-token");
    cloud.on("POST", "/api/v1/servers", {
      body: { server: { id: "srv_1", slug: "weather" }, deploymentId: "dep_1" },
    });
    const result = await cli.run(
      ["deploy", "--no-github", "--name", "weather", "--no-wait", "--json"],
      { env: SIGNED_IN }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.json).toEqual({
      sourceType: "managed",
      serverId: "srv_1",
      deploymentId: "dep_1",
      status: "pending",
      dashboardUrl: "https://manufact.com/cloud/org-one/servers/srv_1/overview",
    });
    expect(
      JSON.parse(
        await readFile(join(cli.cwd, ".manufact", "project.json"), "utf8")
      )
    ).toEqual({ orgId: "org_1", serverId: "srv_1" });
    const requests = cloud.requestsTo("POST", "/api/v1/servers");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers).toMatchObject({
      "x-api-key": "test_key",
      "x-profile-id": "org_1",
    });
    const request = requests[0]!;
    const boundary =
      request.headers["content-type"]!.match(/boundary=(.+)$/)![1]!;
    const start = request.rawBody.indexOf("\r\n\r\n") + 4;
    const end = request.rawBody.indexOf(`\r\n--${boundary}`, start);
    const archive = gunzipSync(request.rawBody.subarray(start, end)).toString();
    expect(archive).toContain("app/weather.py");
    expect(archive).not.toContain("do-not-upload");
    expect(archive).not.toContain("private-token");
    expect(cloud.requestsTo("GET", "/api/v1/deployments/dep_1")).toEqual([]);
  });

  test("waits by default through pending to running and emits only the final result", async ({
    cli,
    cloud,
  }) => {
    signIn(cloud);
    await writeFile(join(cli.cwd, "server.py"), "pass\n");
    cloud.on("POST", "/api/v1/servers", {
      body: { server: { id: "srv_1", slug: null }, deploymentId: "dep_1" },
    });
    cloud.sequence("GET", "/api/v1/deployments/dep_1", [
      { body: deployment({ id: "dep_1", status: "building" }) },
      {
        body: deployment({
          id: "dep_1",
          status: "running",
          mcpUrl: "https://weather.example/mcp",
        }),
      },
    ]);
    const result = await cli.run(["deploy", "--no-github", "--json"], {
      env: { ...SIGNED_IN, MCP_USE_POLL_INTERVAL_MS: "0" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.json).toMatchObject({
      serverId: "srv_1",
      deploymentId: "dep_1",
      status: "running",
      mcpUrl: "https://weather.example/mcp",
    });
    expect(cloud.requestsTo("GET", "/api/v1/deployments/dep_1")).toHaveLength(
      2
    );
  });

  test("a failed deployment exits 1 with a logs next step", async ({
    cli,
    cloud,
  }) => {
    signIn(cloud);
    cloud.on("POST", "/api/v1/servers", {
      body: { server: { id: "srv_1", slug: null }, deploymentId: "dep_1" },
    });
    cloud.on("GET", "/api/v1/deployments/dep_1", {
      body: deployment({ id: "dep_1", status: "failed" }),
    });
    const result = await cli.run(["deploy", "--no-github", "--json"], {
      env: SIGNED_IN,
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      error: {
        code: "deployment_failed",
        nextSteps: [{ command: "mcp-use logs dep_1 --build --json" }],
      },
    });
  });

  test.for([
    ["main", null, "production"],
    ["feature-weather", "feature-weather", "preview"],
  ] as const)(
    "scopes --env on %s to the deployment environment",
    async ([branch, scope, environment], { cli, cloud }) => {
      signIn(cloud);
      await repository(cli.cwd, branch);
      await link(cli.cwd);
      cloud.on("GET", "/api/v1/servers/srv_1", {
        body: server({
          id: "srv_1",
          connectedRepository: { ...CONNECTED_REPOSITORY },
        }),
      });
      cloud.on("GET", "/api/v1/servers/srv_1/env-variables", { body: [] });
      cloud.on("POST", "/api/v1/servers/srv_1/env-variables", {
        body: {
          ...VARIABLE_METADATA,
          id: "var_1",
          key: "KEY",
          branch: null,
          environments: ["production"],
        },
      });
      cloud.on("POST", "/api/v1/deployments", { body: { id: "dep_1" } });
      const result = await cli.run(
        ["deploy", "--env", "WEATHER_KEY=secret", "--no-wait", "--json"],
        { env: SIGNED_IN }
      );
      expect(result.exitCode).toBe(0);
      expect(
        cloud.requestsTo("POST", "/api/v1/servers/srv_1/env-variables")
      ).toMatchObject([
        {
          body: {
            key: "WEATHER_KEY",
            value: "secret",
            branch: scope,
            environments: [environment],
          },
        },
      ]);
      expect(cloud.requestsTo("POST", "/api/v1/deployments")).toMatchObject([
        { body: { serverId: "srv_1", branch, trigger: "manual" } },
      ]);
    }
  );

  test("--branch deploys a preview without repointing the saved production branch, and rotations preserve sensitive", async ({
    cli,
    cloud,
  }) => {
    signIn(cloud);
    await repository(cli.cwd);
    await link(cli.cwd);
    cloud.on("GET", "/api/v1/servers/srv_1", {
      body: server({
        id: "srv_1",
        connectedRepository: { ...CONNECTED_REPOSITORY },
      }),
    });
    cloud.on("GET", "/api/v1/servers/srv_1/env-variables", {
      body: [
        {
          ...VARIABLE_METADATA,
          sensitive: true,
          id: "var_1",
          key: "KEY",
          branch: "feature",
          environments: ["preview"],
        },
      ],
    });
    cloud.on("PATCH", "/api/v1/servers/srv_1/env-variables/var_1", {
      body: {
        ...VARIABLE_METADATA,
        id: "var_1",
        key: "KEY",
        branch: null,
        environments: ["production"],
      },
    });
    cloud.on("POST", "/api/v1/deployments", { body: { id: "dep_1" } });
    const result = await cli.run(
      [
        "deploy",
        "--branch",
        "feature",
        "--env",
        "KEY=rotated",
        "--no-wait",
        "--json",
      ],
      { env: SIGNED_IN }
    );
    expect(result.exitCode).toBe(0);
    expect(cloud.requestsTo("PATCH", "/api/v1/servers/srv_1")).toEqual([]);
    expect(
      cloud.requestsTo("PATCH", "/api/v1/servers/srv_1/env-variables/var_1")
    ).toMatchObject([
      {
        body: {
          value: "rotated",
          branch: "feature",
          environments: ["preview"],
        },
      },
    ]);
    expect(
      cloud.requestsTo("PATCH", "/api/v1/servers/srv_1/env-variables/var_1")[0]!
        .body
    ).not.toHaveProperty("sensitive");
  });

  test("new GitHub deploy checks installation access and creates a server with build settings", async ({
    cli,
    cloud,
  }) => {
    signIn(cloud);
    await repository(cli.cwd);
    cloud.on("GET", "/api/v1/github/installations", {
      body: {
        installations: [
          {
            id: "inst_record",
            installationId: "123",
            organizationId: "org_1",
            isActive: true,
            account: { login: "example", type: "Organization" },
          },
        ],
      },
    });
    cloud.on(
      "GET",
      "/api/v1/github/installations/123/repos/example/weather/access",
      { body: { hasAccess: true } }
    );
    cloud.on("POST", "/api/v1/servers", {
      body: { server: { id: "srv_1", slug: "weather" }, deploymentId: "dep_1" },
    });
    const result = await cli.run(
      [
        "deploy",
        "--build-command",
        "python build.py",
        "--start-command",
        "python weather.py",
        "--region",
        "EU",
        "--no-wait",
        "--json",
      ],
      { env: SIGNED_IN }
    );
    expect(result.exitCode).toBe(0);
    expect(cloud.requestsTo("POST", "/api/v1/servers")).toMatchObject([
      {
        body: {
          type: "github",
          organizationId: "org_1",
          installationId: "inst_record",
          repoFullName: "example/weather",
          branch: "main",
          buildCommand: "python build.py",
          startCommand: "python weather.py",
          region: "EU",
        },
      },
    ]);
  });

  test("a server API error cannot disclose an --env secret", async ({
    cli,
    cloud,
  }) => {
    signIn(cloud);
    cloud.on("POST", "/api/v1/servers", {
      status: 400,
      body: {
        error: "Rejected WEATHER_KEY=top-secret",
        code: "invalid",
        details: null,
      },
    });
    const result = await cli.run(
      ["deploy", "--no-github", "--env", "WEATHER_KEY=top-secret", "--json"],
      { env: SIGNED_IN }
    );
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({ error: { code: "validation_error" } });
    expect(result.stdout).not.toContain("top-secret");
    expect(result.stderr).not.toContain("top-secret");
  });

  test("external URLs reject conflicting flags and insecure URLs before Cloud auth", async ({
    cli,
    cloud,
  }) => {
    for (const args of [
      ["--external-url", "http://example.test/mcp"],
      ["--external-url", "https://example.test/mcp", "--no-github"],
    ]) {
      const result = await cli.run(["deploy", ...args, "--json"]);
      expect(result.exitCode).toBe(2);
      expect(result.json).toHaveProperty("error");
    }
    expect(cloud.requests).toEqual([]);
  });

  test("registers an HTTPS MCP endpoint after a real handshake and updates the linked external server", async ({
    cli,
    cloud,
  }) => {
    const cert = join(cli.home, "cert.pem");
    const key = join(cli.home, "key.pem");
    await exec("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ]);
    const methods: string[] = [];
    let invalidMcp = false;
    const endpoint = createServer(
      { key: await readFile(key), cert: await readFile(cert) },
      (request, response) => {
        if (invalidMcp) {
          response
            .writeHead(200, { "Content-Type": "text/html" })
            .end("<html>A website</html>");
          return;
        }
        if (request.method !== "POST") {
          response.writeHead(405).end();
          return;
        }
        let body = "";
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          const message = JSON.parse(body) as {
            id?: number;
            method: string;
            params?: { protocolVersion: string };
          };
          methods.push(message.method);
          if (message.id === undefined) {
            response.writeHead(202).end();
            return;
          }
          const result =
            message.method === "initialize"
              ? {
                  protocolVersion: message.params!.protocolVersion,
                  capabilities: {},
                  serverInfo: { name: "weather", version: "1" },
                }
              : message.method === "tools/list"
                ? { tools: [] }
                : { resources: [] };
          response
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
        });
      }
    );
    await new Promise<void>((resolve) =>
      endpoint.listen(0, "127.0.0.1", resolve)
    );
    try {
      const url = `https://127.0.0.1:${(endpoint.address() as { port: number }).port}/mcp`;
      signIn(cloud);
      cloud.on("POST", "/api/v1/servers", {
        body: { server: { id: "srv_1", slug: "weather" }, deploymentId: null },
      });
      const env = { ...SIGNED_IN, NODE_EXTRA_CA_CERTS: cert };
      const created = await cli.run(
        ["deploy", "--external-url", url, "--json"],
        { env }
      );
      expect(created.exitCode).toBe(0);
      expect(created.json, created.stdout).toMatchObject({
        sourceType: "external",
        serverId: "srv_1",
        status: "registered",
        externalUrl: url,
      });
      expect(methods).toContain("initialize");
      cloud.on("GET", "/api/v1/servers/srv_1", {
        body: server({ id: "srv_1", isExternal: true }),
      });
      cloud.on("PATCH", "/api/v1/servers/srv_1", {
        body: server({ id: "srv_1", slug: "weather", name: "renamed" }),
      });
      const updated = await cli.run(
        ["deploy", "--external-url", url, "--name", "renamed", "--json"],
        { env }
      );
      expect(updated.exitCode).toBe(0);
      expect(cloud.requestsTo("POST", "/api/v1/servers")).toHaveLength(1);
      expect(cloud.requestsTo("PATCH", "/api/v1/servers/srv_1")).toMatchObject([
        { body: { externalUrl: url, name: "renamed" } },
      ]);
      const requestsBeforeInvalid = cloud.requests.length;
      invalidMcp = true;
      const invalid = await cli.run(
        ["deploy", "--external-url", url, "--new", "--json"],
        { env }
      );
      expect(invalid.exitCode).toBe(1);
      expect(invalid.json).toMatchObject({
        error: { code: "invalid_mcp_server" },
      });
      expect(cloud.requests).toHaveLength(requestsBeforeInvalid);
    } finally {
      endpoint.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        endpoint.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
