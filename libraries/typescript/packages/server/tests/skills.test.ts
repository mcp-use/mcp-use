import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { StandardSchemaV1 } from "@modelcontextprotocol/server";

import { MCPServer, registerSkills, type ServerConfig } from "../src/index.js";
import { discoverConfiguredSkills } from "@mcp-use/cli/internal/skills-loader";
import type { SkillsSnapshot } from "../src/skills/types.js";
import { listenFetch } from "./helpers/listen-fetch.js";

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of dirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function project(): string {
  const directory = join(
    tmpdir(),
    `mcp-use-skills-${process.pid}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(directory, { recursive: true });
  dirs.push(directory);
  return directory;
}

function writeSkill(
  root: string,
  path: string,
  name: string,
  extra = "license: Apache-2.0"
): string {
  const directory = join(root, "skills", path);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: Use the ${name} workflow\n${extra}\n---\n# ${name}\n`
  );
  return directory;
}

async function request(
  server: MCPServer,
  method: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const uri = typeof params["uri"] === "string" ? params["uri"] : undefined;
  const response = await server.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        ...(uri !== undefined && { "mcp-name": uri }),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "skills-test",
              version: "1.0.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    })
  );
  return (await response.json()) as Record<string, unknown>;
}

describe("skill discovery", () => {
  it("auto-enables when skills exists and can be explicitly disabled", () => {
    const cwd = project();
    writeSkill(cwd, "refunds", "refunds");
    expect(discoverConfiguredSkills(undefined, cwd)?.skills).toHaveLength(1);
    expect(discoverConfiguredSkills(false, cwd)).toBeUndefined();
  });

  it("silently disables an absent convention but errors when forced", () => {
    const cwd = project();
    expect(discoverConfiguredSkills(undefined, cwd)).toBeUndefined();
    expect(() => discoverConfiguredSkills(true, cwd)).toThrow(
      /Skills directory not found/
    );
    expect(() => discoverConfiguredSkills({}, cwd)).toThrow(
      /Skills directory not found/
    );
  });

  it("resolves custom and mcp-dir conventions with project path safety", () => {
    const cwd = project();
    writeSkill(join(cwd, "src", "mcp"), "refunds", "refunds");
    expect(
      discoverConfiguredSkills(undefined, cwd, "src/mcp/skills")?.skills
    ).toHaveLength(1);
    expect(
      discoverConfiguredSkills({}, cwd, "src/mcp/skills")?.skills
    ).toHaveLength(1);

    const custom = join(cwd, "manuals", "shipping");
    mkdirSync(custom, { recursive: true });
    writeFileSync(
      join(custom, "SKILL.md"),
      "---\nname: shipping\ndescription: Ship orders\n---\n"
    );
    expect(
      discoverConfiguredSkills({ directory: "manuals" }, cwd)?.skills
    ).toHaveLength(1);
    expect(() =>
      discoverConfiguredSkills({ directory: "../outside" }, cwd)
    ).toThrow(/within the project root/);
  });

  it("preserves frontmatter, nests manifests, hashes bytes, and excludes symlinks", () => {
    const cwd = project();
    const parent = writeSkill(
      cwd,
      "billing",
      "billing",
      "metadata:\n  version: 2"
    );
    const nested = writeSkill(cwd, "billing/refunds", "refunds");
    writeFileSync(join(parent, "policy.md"), "policy\n");
    const binary = Buffer.from([0, 1, 2, 255]);
    writeFileSync(join(nested, "logo.png"), binary);
    symlinkSync(join(parent, "policy.md"), join(parent, "linked.md"));

    const snapshot = discoverConfiguredSkills(undefined, cwd)!;
    expect(snapshot.skills.map((skill) => skill.uri)).toEqual([
      "skill://billing/refunds/SKILL.md",
      "skill://billing/SKILL.md",
    ]);
    const parentSkill = snapshot.skills.find(
      (skill) => skill.uri === "skill://billing/SKILL.md"
    );
    expect(parentSkill?.frontmatter).toMatchObject({
      name: "billing",
      metadata: { version: 2 },
    });
    expect(parentSkill?.resources.map((item) => item.uri)).toContain(
      "skill://billing/refunds/logo.png"
    );
    expect(
      snapshot.resources.some((item) => item.uri.endsWith("linked.md"))
    ).toBe(false);
    expect(
      snapshot.resources.find((item) => item.uri.endsWith("logo.png"))
    ).toMatchObject({
      mimeType: "image/png",
      blob: binary.toString("base64"),
      digest: `sha256:${createHash("sha256").update(binary).digest("hex")}`,
    });
  });

  it("validates YAML and Agent Skills names", () => {
    const cwd = project();
    writeSkill(cwd, "refunds", "wrong-name");
    expect(() => discoverConfiguredSkills(undefined, cwd)).toThrow(
      /must match its parent directory/
    );
  });

  it("can omit invalid skills for a fresh development snapshot", () => {
    const cwd = project();
    const refunds = writeSkill(cwd, "refunds", "refunds");
    writeFileSync(join(refunds, "references.md"), "Refund policy\n");
    const shipping = writeSkill(cwd, "shipping", "not-shipping");
    writeFileSync(join(shipping, "partially-written.md"), "Do not serve\n");
    const errors: string[] = [];

    const snapshot = discoverConfiguredSkills(undefined, cwd, "skills", {
      onInvalidSkill: (error) => errors.push(error.message),
    })!;

    expect(errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/shipping\/SKILL\.md/)])
    );
    expect(snapshot.skills.map((skill) => skill.frontmatter.name)).toEqual([
      "refunds",
    ]);
    expect(snapshot.resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining([
        "skill://refunds/SKILL.md",
        "skill://refunds/references.md",
      ])
    );
    expect(
      snapshot.resources.some((resource) => resource.uri.includes("shipping"))
    ).toBe(false);
    expect(
      snapshot.directories.some((directory) =>
        directory.uri.includes("shipping")
      )
    ).toBe(false);
  });

  it("does not leak an invalid nested skill into its valid parent manifest", () => {
    const cwd = project();
    writeSkill(cwd, "billing", "billing");
    const refunds = writeSkill(cwd, "billing/refunds", "not-refunds");
    writeFileSync(join(refunds, "partial.md"), "Do not serve\n");

    const snapshot = discoverConfiguredSkills(undefined, cwd, "skills", {
      onInvalidSkill: () => {},
    })!;
    const parent = snapshot.skills.find(
      (skill) => skill.uri === "skill://billing/SKILL.md"
    );

    expect(
      parent?.resources.some((resource) => resource.uri.includes("refunds"))
    ).toBe(false);
    expect(
      snapshot.resources.some((resource) => resource.uri.includes("refunds"))
    ).toBe(false);
    expect(
      snapshot.directories.some((directory) =>
        directory.uri.includes("refunds")
      )
    ).toBe(false);
  });

  it("omits a skill when a supporting resource cannot be read", () => {
    const cwd = project();
    writeSkill(cwd, "refunds", "refunds");
    const shipping = writeSkill(cwd, "shipping", "shipping");
    const brokenFile = join(shipping, "references.md");
    writeFileSync(brokenFile, "Unreadable\n");
    const errors: string[] = [];
    const snapshot = discoverConfiguredSkills(undefined, cwd, "skills", {
      onInvalidSkill: (error) => errors.push(error.message),
      readResourceFile: (path) => {
        if (path === brokenFile) throw new Error(`Cannot read ${path}`);
        return readFileSync(path);
      },
    })!;

    expect(errors).toHaveLength(1);
    expect(snapshot.skills.map((skill) => skill.frontmatter.name)).toEqual([
      "refunds",
    ]);
    expect(
      snapshot.resources.some((resource) => resource.uri.includes("shipping"))
    ).toBe(false);
  });

  it("rejects invalid untyped skills configuration", () => {
    expect(
      () =>
        new MCPServer({
          name: "invalid",
          version: "1.0.0",
          skills: "yes",
        } as unknown as ServerConfig)
    ).toThrow(/skills must be a boolean or configuration object/);
  });
});

describe("Skills over MCP wire", () => {
  function serverWith(snapshot: SkillsSnapshot | undefined): MCPServer {
    const server = new MCPServer({ name: "skills", version: "1.0.0" });
    server[registerSkills](snapshot);
    return server;
  }

  it("serves list, get, text/binary reads, and non-recursive directories", async () => {
    const cwd = project();
    const directory = writeSkill(cwd, "refunds", "refunds");
    mkdirSync(join(directory, "templates", "regional"), { recursive: true });
    mkdirSync(join(directory, "templates", "empty"), { recursive: true });
    writeFileSync(join(directory, "templates", "email.md"), "hello\n");
    writeFileSync(join(directory, "templates", "regional", "eu.md"), "eu\n");
    writeFileSync(join(directory, "image.png"), Buffer.from([0, 255]));
    const server = serverWith(discoverConfiguredSkills(undefined, cwd));

    const listed = await request(server, "skills/list");
    expect(listed).toMatchObject({
      result: {
        skills: [
          {
            uri: "skill://refunds/SKILL.md",
            frontmatter: { name: "refunds" },
          },
        ],
      },
    });
    expect(
      await request(server, "skills/get", { uri: "skill://refunds/SKILL.md" })
    ).toMatchObject({
      result: { skill: { uri: "skill://refunds/SKILL.md" } },
    });
    expect(
      await request(server, "resources/read", {
        uri: "skill://refunds/templates/email.md",
      })
    ).toMatchObject({
      result: { contents: [{ mimeType: "text/markdown", text: "hello\n" }] },
    });
    expect(
      await request(server, "resources/read", {
        uri: "skill://refunds/image.png",
      })
    ).toMatchObject({ result: { contents: [{ blob: "AP8=" }] } });
    expect(
      await request(server, "resources/directory/read", {
        uri: "skill://refunds/templates",
      })
    ).toMatchObject({
      result: {
        resources: [
          { name: "email.md", mimeType: "text/markdown" },
          { name: "empty", mimeType: "inode/directory" },
          { name: "regional", mimeType: "inode/directory" },
        ],
      },
    });
    expect(
      await request(server, "resources/directory/read", {
        uri: "skill://refunds/templates/empty",
      })
    ).toMatchObject({ result: { resources: [] } });
  });

  it("serves same-named files from multiple skills", async () => {
    const cwd = project();
    writeSkill(cwd, "refunds", "refunds");
    writeSkill(cwd, "shipping", "shipping");
    const server = serverWith(discoverConfiguredSkills(undefined, cwd));

    expect(
      await request(server, "resources/read", {
        uri: "skill://refunds/SKILL.md",
      })
    ).toMatchObject({ result: { contents: [{ text: expect.any(String) }] } });
    expect(
      await request(server, "resources/read", {
        uri: "skill://shipping/SKILL.md",
      })
    ).toMatchObject({ result: { contents: [{ text: expect.any(String) }] } });
  });

  it("negotiates the extension and custom methods through the official v2 client", async () => {
    const snapshot: SkillsSnapshot = {
      skills: [
        {
          uri: "skill://refunds/SKILL.md",
          frontmatter: { name: "refunds", description: "Refund orders" },
          resources: [
            {
              uri: "skill://refunds/SKILL.md",
              digest: `sha256:${"0".repeat(64)}`,
            },
          ],
        },
      ],
      resources: [
        {
          uri: "skill://refunds/SKILL.md",
          name: "SKILL.md",
          mimeType: "text/markdown",
          digest: `sha256:${"0".repeat(64)}`,
          text: "---\nname: refunds\ndescription: Refund orders\n---\n",
        },
      ],
      directories: [{ uri: "skill://refunds", name: "refunds" }],
    };
    const server = serverWith(snapshot);
    const listening = await listenFetch(server.fetch);
    const client = new Client(
      { name: "skills-client", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    const resultSchema: StandardSchemaV1<unknown, { skills: unknown[] }> = {
      "~standard": {
        version: 1,
        vendor: "skills-test",
        validate(value) {
          const skills =
            typeof value === "object" && value !== null
              ? (value as { skills?: unknown }).skills
              : undefined;
          return Array.isArray(skills)
            ? { value: { skills } }
            : { issues: [{ message: "skills must be an array" }] };
        },
      },
    };
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL("/mcp", listening.url))
      );
      expect(client.getServerCapabilities()?.extensions).toMatchObject({
        "io.modelcontextprotocol/skills": { directoryRead: true },
      });
      const result = await client.request(
        { method: "skills/list", params: {} },
        resultSchema
      );
      expect(result.skills).toHaveLength(1);
    } finally {
      await client.close();
      await listening.close();
    }
  });

  it("returns -32602 for unknown skills and does not expose an index resource", async () => {
    const server = serverWith({ skills: [], resources: [], directories: [] });
    expect(
      await request(server, "skills/get", { uri: "skill://missing/SKILL.md" })
    ).toMatchObject({
      error: { code: -32602 },
    });
    expect(
      await request(server, "resources/read", { uri: "skill://index.json" })
    ).toHaveProperty("error");
  });

  it("auto-discovers during direct Node serving and honors false", async () => {
    const cwd = project();
    writeSkill(cwd, "refunds", "refunds");
    const previous = process.cwd();
    process.chdir(cwd);
    try {
      const automatic = new MCPServer({ name: "auto", version: "1.0.0" });
      expect(await request(automatic, "skills/list")).toMatchObject({
        result: { skills: [{ uri: "skill://refunds/SKILL.md" }] },
      });

      const disabled = new MCPServer({
        name: "disabled",
        version: "1.0.0",
        skills: false,
      });
      expect(await request(disabled, "skills/list")).toMatchObject({
        error: { code: -32601 },
      });
    } finally {
      process.chdir(previous);
    }
  });
});

const configExamples: ServerConfig[] = [
  { name: "auto", version: "1.0.0" },
  { name: "off", version: "1.0.0", skills: false },
  { name: "forced", version: "1.0.0", skills: true },
  {
    name: "custom",
    version: "1.0.0",
    skills: { directory: "server-skills" },
  },
];
void configExamples;
