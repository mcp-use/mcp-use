/**
 * `mcp-use link` and `mcp-use unlink`, and the server and organization
 * resolution every project-scoped command shares.
 *
 * The sandbox working directory is an empty folder, not an mcp-use project:
 * linking must work for any project.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect } from "vitest";

import { test } from "../helpers/cli-test.js";
import { server } from "../helpers/cloud-fixtures.js";
import type { FakeCloud } from "../helpers/fake-cloud.js";

const SIGNED_IN = { MCP_USE_API_KEY: "test_key" };

/** Run git in `cwd` without the developer's global config. */
async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } }
  );
  return stdout;
}

/** Five organizations, with org_1 as the account default. */
function signIn(cloud: FakeCloud): void {
  const organization = (n: number, slug: string) => ({
    id: `org_${n}`,
    name: `Org ${n}`,
    slug,
    role: "owner",
  });
  cloud.on("GET", "/api/v1/organizations", {
    body: {
      organizations: [
        organization(1, "org-one"),
        organization(2, "org-two"),
        organization(3, "org-three"),
        organization(4, "org-four"),
        organization(5, "org-five"),
      ],
    },
  });
  cloud.on("GET", "/api/v1/user-preferences", {
    body: { defaultOrganizationId: "org_1" },
  });
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function writeLink(dir: string, link: unknown): Promise<void> {
  await mkdir(join(dir, ".manufact"), { recursive: true });
  await writeFile(
    join(dir, ".manufact", "project.json"),
    `${JSON.stringify(link)}\n`
  );
}

async function writeLegacyLink(dir: string, link: unknown): Promise<void> {
  await mkdir(join(dir, ".mcp-use", "cloud"), { recursive: true });
  await writeFile(
    join(dir, ".mcp-use", "cloud", "link.json"),
    `${JSON.stringify(link)}\n`
  );
}

describe("mcp-use link", () => {
  test("looks the server up and saves its id and organization in .manufact/project.json", async ({
    cloud,
    cli,
  }) => {
    signIn(cloud);
    cloud.on("GET", "/api/v1/servers/weather", {
      body: server({
        id: "srv_1",
        slug: "weather",
        name: "Weather",
        organizationId: "org_1",
      }),
    });

    const result = await cli.run(["link", "--server", "weather", "--json"], {
      env: SIGNED_IN,
    });

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual({
      orgId: "org_1",
      serverId: "srv_1",
      serverSlug: "weather",
      serverName: "Weather",
      linkFile: join(cli.cwd, ".manufact", "project.json"),
    });
    expect(
      await readJsonFile(join(cli.cwd, ".manufact", "project.json"))
    ).toEqual({ orgId: "org_1", serverId: "srv_1" });
    expect(cloud.requestsTo("GET", "/api/v1/servers/weather")).toMatchObject([
      { headers: { "x-api-key": "test_key", "x-profile-id": "org_1" } },
    ]);
  });

  test("saves the organization that owns the server, not the one it was looked up from", async ({
    cloud,
    cli,
  }) => {
    signIn(cloud);
    cloud.on("GET", "/api/v1/servers/srv_1", {
      body: server({ id: "srv_1", organizationId: "org_2" }),
    });

    const result = await cli.run(["link", "--server", "srv_1", "--json"], {
      env: SIGNED_IN,
    });

    expect(result.exitCode).toBe(0);
    expect(
      await readJsonFile(join(cli.cwd, ".manufact", "project.json"))
    ).toEqual({ orgId: "org_2", serverId: "srv_1" });
  });

  test("--path links that directory instead of the working directory", async ({
    cloud,
    cli,
  }) => {
    signIn(cloud);
    cloud.on("GET", "/api/v1/servers/srv_1", {
      body: server({ id: "srv_1", organizationId: "org_1" }),
    });
    await mkdir(join(cli.cwd, "app"));

    const result = await cli.run(
      ["link", "--server", "srv_1", "--path", "app", "--json"],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(0);
    expect(
      await readJsonFile(join(cli.cwd, "app", ".manufact", "project.json"))
    ).toEqual({ orgId: "org_1", serverId: "srv_1" });
    expect(await readFile(join(cli.cwd, "app", ".gitignore"), "utf8")).toBe(
      ".manufact/\n"
    );
    expect(await readdir(cli.cwd)).toEqual(["app"]);
  });

  test.for([
    [404, "server_not_found"],
    [403, "forbidden"],
  ] as const)(
    "a %i for the server fails with %s and writes nothing",
    async ([status, code], { cloud, cli }) => {
      signIn(cloud);
      cloud.on("GET", "/api/v1/servers/srv_1", {
        status,
        body: { error: "no access" },
      });

      const result = await cli.run(["link", "--server", "srv_1", "--json"], {
        env: SIGNED_IN,
      });

      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({ error: { code } });
      expect(await readdir(cli.cwd)).toEqual([]);
    }
  );

  test("without a terminal or a server, fails with a usage error naming --server and sends no request", async ({
    cloud,
    cli,
  }) => {
    const result = await cli.run(["link", "--json"], { env: SIGNED_IN });

    expect(result.exitCode).toBe(2);
    expect(result.json).toMatchObject({
      error: {
        code: "project_not_linked",
        nextSteps: [{ command: "mcp-use link --server <id-or-slug>" }],
      },
    });
    expect(cloud.requests).toEqual([]);
    expect(await readdir(cli.cwd)).toEqual([]);
  });

  test("an --org you are not a member of fails with organization_not_found", async ({
    cloud,
    cli,
  }) => {
    signIn(cloud);

    const result = await cli.run(
      ["link", "--server", "srv_1", "--org", "someone-else", "--json"],
      { env: SIGNED_IN }
    );

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      error: { code: "organization_not_found" },
    });
    expect(await readdir(cli.cwd)).toEqual([]);
  });
});

describe("the link is git-ignored", () => {
  test.for([
    ["no .gitignore", undefined, ".manufact/\n"],
    ["one without the entry", "node_modules\n", "node_modules\n.manufact/\n"],
    [
      "one without a final newline",
      "node_modules",
      "node_modules\n.manufact/\n",
    ],
    ["one that has .manufact/", "dist\n.manufact/\n", "dist\n.manufact/\n"],
    ["one that has /.manufact", "/.manufact\n", "/.manufact\n"],
  ] as const)(
    "linking a project with %s leaves the right .gitignore",
    async ([, before, after], { cloud, cli }) => {
      signIn(cloud);
      cloud.on("GET", "/api/v1/servers/srv_1", {
        body: server({ id: "srv_1", organizationId: "org_1" }),
      });
      if (before !== undefined) {
        await writeFile(join(cli.cwd, ".gitignore"), before);
      }

      const result = await cli.run(["link", "--server", "srv_1", "--json"], {
        env: SIGNED_IN,
      });

      expect(result.exitCode).toBe(0);
      expect(await readFile(join(cli.cwd, ".gitignore"), "utf8")).toBe(after);
    }
  );
});

describe("the link stays out of Git", () => {
  test("even when the .gitignore edit is discarded", async ({ cloud, cli }) => {
    signIn(cloud);
    cloud.on("GET", "/api/v1/servers/srv_1", {
      body: server({ id: "srv_1", organizationId: "org_1" }),
    });
    await git(cli.cwd, "init", "-q");
    await writeFile(join(cli.cwd, ".gitignore"), "node_modules\n");
    await git(cli.cwd, "add", ".gitignore");
    await git(cli.cwd, "commit", "-q", "-m", "init");

    const result = await cli.run(["link", "--server", "srv_1", "--json"], {
      env: SIGNED_IN,
    });
    expect(result.exitCode).toBe(0);
    expect(await git(cli.cwd, "status", "--porcelain")).toBe(" M .gitignore\n");
    await git(cli.cwd, "checkout", "--", ".gitignore");

    expect(
      await git(cli.cwd, "status", "--porcelain", "--untracked-files=all")
    ).toBe("");
    expect(
      await readJsonFile(join(cli.cwd, ".manufact", "project.json"))
    ).toEqual({ orgId: "org_1", serverId: "srv_1" });
  });
});

describe("server resolution: --server, then MANUFACT_SERVER, then the link", () => {
  test.for([
    [
      "--server",
      ["--server", "srv_flag"],
      { MANUFACT_SERVER: "srv_env" },
      "srv_flag",
    ],
    ["MANUFACT_SERVER", [], { MANUFACT_SERVER: "srv_env" }, "srv_env"],
    ["the link", [], {}, "srv_link"],
  ] as const)(
    "%s wins over everything after it",
    async ([, flags, env, expected], { cloud, cli }) => {
      signIn(cloud);
      // Only the expected server has a route, so a lookup of any other
      // server is unhandled and fails the test.
      cloud.on("GET", `/api/v1/servers/${expected}`, {
        body: server({ id: expected, organizationId: "org_1" }),
      });
      await writeLink(cli.cwd, { orgId: "org_1", serverId: "srv_link" });

      const result = await cli.run(["link", ...flags, "--json"], {
        env: { ...SIGNED_IN, ...env },
      });

      expect(result.exitCode).toBe(0);
      expect(result.json).toMatchObject({ serverId: expected });
      expect(
        cloud.requestsTo("GET", `/api/v1/servers/${expected}`)
      ).toHaveLength(1);
    }
  );
});

describe("organization resolution: --org, MANUFACT_ORG, the link, the active organization, the account default", () => {
  test.for([
    [
      "--org (by slug)",
      { flag: "org-two", env: "org_3", link: "org_4", active: "org_5" },
      "org_2",
    ],
    ["MANUFACT_ORG", { env: "org_3", link: "org_4", active: "org_5" }, "org_3"],
    ["the link's organization", { link: "org_4", active: "org_5" }, "org_4"],
    ["the active organization", { active: "org_5" }, "org_5"],
    ["the account default", {}, "org_1"],
  ] as const)(
    "%s wins over everything after it",
    async ([, given, expected], { cloud, cli }) => {
      signIn(cloud);
      cloud.on("GET", "/api/v1/servers/srv_1", {
        body: server({ id: "srv_1", organizationId: "org_1" }),
      });
      const sources = given as {
        flag?: string;
        env?: string;
        link?: string;
        active?: string;
      };
      if (sources.link !== undefined) {
        await writeLink(cli.cwd, { orgId: sources.link, serverId: "srv_1" });
      }
      if (sources.active !== undefined) {
        await mkdir(join(cli.home, ".mcp-use"), { recursive: true });
        await writeFile(
          join(cli.home, ".mcp-use", "config.json"),
          JSON.stringify({ orgId: sources.active })
        );
      }

      const result = await cli.run(
        [
          "link",
          "--server",
          "srv_1",
          ...(sources.flag !== undefined ? ["--org", sources.flag] : []),
          "--json",
        ],
        {
          env: {
            ...SIGNED_IN,
            ...(sources.env !== undefined ? { MANUFACT_ORG: sources.env } : {}),
          },
        }
      );

      expect(result.exitCode).toBe(0);
      expect(cloud.requestsTo("GET", "/api/v1/servers/srv_1")).toMatchObject([
        { headers: { "x-profile-id": expected } },
      ]);
    }
  );
});

describe("links written by older CLIs", () => {
  test("a link in .mcp-use/cloud/link.json is used and moved to .manufact/project.json", async ({
    cloud,
    cli,
  }) => {
    signIn(cloud);
    cloud.on("GET", "/api/v1/servers/srv_old", {
      body: server({ id: "srv_old", organizationId: "org_2" }),
    });
    await writeLegacyLink(cli.cwd, {
      organizationId: "org_2",
      serverId: "srv_old",
      serverSlug: "old",
      repository: "acme/app",
      sourceType: "github",
    });

    const result = await cli.run(["link", "--json"], { env: SIGNED_IN });

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(cloud.requestsTo("GET", "/api/v1/servers/srv_old")).toMatchObject([
      { headers: { "x-profile-id": "org_2" } },
    ]);
    expect(
      await readJsonFile(join(cli.cwd, ".manufact", "project.json"))
    ).toEqual({ orgId: "org_2", serverId: "srv_old" });
    expect(await exists(join(cli.cwd, ".mcp-use", "cloud", "link.json"))).toBe(
      false
    );
  });

  test("an existing .manufact/project.json wins and the old link is left alone", async ({
    cloud,
    cli,
  }) => {
    signIn(cloud);
    cloud.on("GET", "/api/v1/servers/srv_new", {
      body: server({ id: "srv_new", organizationId: "org_1" }),
    });
    await writeLink(cli.cwd, { orgId: "org_1", serverId: "srv_new" });
    await writeLegacyLink(cli.cwd, {
      organizationId: "org_2",
      serverId: "srv_old",
    });

    const result = await cli.run(["link", "--json"], { env: SIGNED_IN });

    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({ serverId: "srv_new" });
    expect(
      await readJsonFile(join(cli.cwd, ".mcp-use", "cloud", "link.json"))
    ).toEqual({ organizationId: "org_2", serverId: "srv_old" });
  });
});

describe("mcp-use unlink", () => {
  test("removes the link and the empty .manufact folder, and keeps .gitignore", async ({
    cli,
  }) => {
    await writeLink(cli.cwd, { orgId: "org_1", serverId: "srv_1" });
    await writeFile(join(cli.cwd, ".gitignore"), ".manufact/\n");

    const result = await cli.run(["unlink", "--json"]);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual({ unlinked: true });
    expect(await readdir(cli.cwd)).toEqual([".gitignore"]);
    expect(await readFile(join(cli.cwd, ".gitignore"), "utf8")).toBe(
      ".manufact/\n"
    );
  });

  test("keeps .manufact when it holds other files", async ({ cli }) => {
    await writeLink(cli.cwd, { orgId: "org_1", serverId: "srv_1" });
    await writeFile(join(cli.cwd, ".manufact", "notes.txt"), "keep me\n");

    const result = await cli.run(["unlink", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(
      (await readdir(join(cli.cwd, ".manufact"))).filter(
        (name) => name !== ".gitignore"
      )
    ).toEqual(["notes.txt"]);
  });

  test("removes a link written by an older CLI", async ({ cli }) => {
    await writeLegacyLink(cli.cwd, {
      organizationId: "org_1",
      serverId: "srv_1",
    });

    const result = await cli.run(["unlink", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual({ unlinked: true });
    expect(await exists(join(cli.cwd, ".mcp-use", "cloud", "link.json"))).toBe(
      false
    );
  });

  test("succeeds and reports it when the project was not linked", async ({
    cli,
  }) => {
    const result = await cli.run(["unlink", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual({ unlinked: false });
  });
});
