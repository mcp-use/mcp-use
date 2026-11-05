import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { test, type Cli } from "../helpers/cli-test.js";
import { organization, session } from "../helpers/cloud-fixtures.js";
import type { FakeCloud } from "../helpers/fake-cloud.js";

/** Poll without sleeping. */
const FAST_POLL = { MCP_USE_POLL_INTERVAL_MS: "0" };

const ORG_ONE = organization({ id: "org_1", slug: "org-one", name: "Org One" });
const ORG_TWO = organization({
  id: "org_2",
  slug: "org-two",
  name: "Org Two",
  role: "member",
});

/** `POST /api/auth/device/code` is not in Cloud's OpenAPI document. */
function deviceCodeIssued(
  cloud: FakeCloud,
  fields: Record<string, unknown> = {}
): void {
  cloud.onUndocumented("POST", "/api/auth/device/code", {
    body: {
      device_code: "device_code_1",
      user_code: "ABCD-EFGH",
      verification_uri: "https://manufact.com/device",
      expires_in: 900,
      interval: 5,
      ...fields,
    },
  });
}

/** `POST /api/auth/device/token` is not in Cloud's OpenAPI document. */
const PENDING = { status: 400, body: { error: "authorization_pending" } };
const APPROVED = {
  body: { access_token: "login_token", token_type: "Bearer" },
};

/** Cloud's answers once the CLI holds a valid key for dev@example.com. */
function keyBelongsToDev(cloud: FakeCloud, organizations = [ORG_ONE]): void {
  cloud.on("GET", "/api/auth/get-session", {
    body: session("dev@example.com"),
  });
  cloud.on("GET", "/api/v1/organizations", { body: { organizations } });
}

function authFile(cli: Cli): string {
  return join(cli.home, ".manufact", "auth.json");
}

async function readAuthFile(cli: Cli): Promise<unknown> {
  return JSON.parse(await readFile(authFile(cli), "utf8"));
}

async function seedAuthFile(cli: Cli, auth: unknown): Promise<void> {
  await mkdir(join(cli.home, ".manufact"), { recursive: true });
  await writeFile(authFile(cli), JSON.stringify(auth));
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  );
}

describe("login without a terminal", () => {
  test.for([[["login"]], [["login", "--json"]]] as const)(
    "%j prints the device code as one JSON document and exits without waiting",
    async ([args], { cloud, cli }) => {
      deviceCodeIssued(cloud, {
        verification_uri_complete:
          "https://manufact.com/device?user_code=ABCD-EFGH",
      });

      const result = await cli.run(args);

      expect(result.exitCode).toBe(0);
      expect(result.json).toEqual({
        user_code: "ABCD-EFGH",
        verification_uri: "https://manufact.com/device",
        verification_uri_complete:
          "https://manufact.com/device?user_code=ABCD-EFGH",
        device_code: "device_code_1",
        expires_in: 900,
        interval: 5,
        nextSteps: [
          {
            description: "Finish the login once the code is approved",
            command: "mcp-use login --device-code device_code_1",
          },
        ],
      });
      // It did not poll: the token route is not registered, so a poll would
      // also fail the test as unhandled.
      expect(cloud.requests.map((request) => request.path)).toEqual([
        "/api/auth/device/code",
      ]);
      expect(await exists(authFile(cli))).toBe(false);
    }
  );

  test("carries --org into the command that finishes the login, and leaves out a missing complete URL", async ({
    cloud,
    cli,
  }) => {
    deviceCodeIssued(cloud);

    const result = await cli.run(["login", "--org", "org-two", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual({
      user_code: "ABCD-EFGH",
      verification_uri: "https://manufact.com/device",
      device_code: "device_code_1",
      expires_in: 900,
      interval: 5,
      nextSteps: [
        {
          description: "Finish the login once the code is approved",
          command: "mcp-use login --device-code device_code_1 --org org-two",
        },
      ],
    });
  });
});

describe("login --device-code", () => {
  test("polls until the code is approved, then stores a new `CLI · <hostname>` key in ~/.manufact/auth.json with mode 0600", async ({
    cloud,
    cli,
  }) => {
    cloud.sequenceUndocumented("POST", "/api/auth/device/token", [
      PENDING,
      PENDING,
      APPROVED,
    ]);
    cloud.on("POST", "/api/auth/api-key/create", {
      body: { id: "key_1", key: "mcp_new_key", name: `CLI · ${hostname()}` },
    });
    keyBelongsToDev(cloud);

    const result = await cli.run(
      ["login", "--device-code", "device_code_1", "--json"],
      { env: FAST_POLL }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.json).toEqual({
      email: "dev@example.com",
      organization: {
        id: "org_1",
        name: "Org One",
        slug: "org-one",
        role: "owner",
      },
      keyName: `CLI · ${hostname()}`,
      credentialPath: authFile(cli),
      nextSteps: [],
    });
    expect(await readAuthFile(cli)).toEqual({
      apiKey: "mcp_new_key",
      keyId: "key_1",
      keyName: `CLI · ${hostname()}`,
      orgId: "org_1",
      orgName: "Org One",
      orgSlug: "org-one",
    });
    if (process.platform !== "win32") {
      expect((await stat(authFile(cli))).mode & 0o777).toBe(0o600);
    }

    const polls = cloud.requestsTo("POST", "/api/auth/device/token");
    expect(polls).toHaveLength(3);
    expect(polls[2]?.body).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: "device_code_1",
      client_id: "mcp-use-cli",
    });
    expect(cloud.requestsTo("POST", "/api/auth/api-key/create")).toMatchObject([
      {
        headers: { authorization: "Bearer login_token" },
        body: { name: `CLI · ${hostname()}`, prefix: "mcp_" },
      },
    ]);
    expect(cloud.requestsTo("GET", "/api/auth/get-session")).toMatchObject([
      { headers: { "x-api-key": "mcp_new_key" } },
    ]);
  });

  test.for([
    ["expired_token", "device_code_expired"],
    ["access_denied", "login_denied"],
  ] as const)(
    "stops polling when Cloud answers %s, fails with %s, and stores nothing",
    async ([cloudError, code], { cloud, cli }) => {
      cloud.sequenceUndocumented("POST", "/api/auth/device/token", [
        PENDING,
        { status: 400, body: { error: cloudError } },
      ]);

      const result = await cli.run(
        ["login", "--device-code", "device_code_1", "--json"],
        { env: FAST_POLL }
      );

      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({ error: { code } });
      expect(cloud.requestsTo("POST", "/api/auth/device/token")).toHaveLength(
        2
      );
      expect(cloud.requestsTo("POST", "/api/auth/api-key/create")).toEqual([]);
      expect(await exists(authFile(cli))).toBe(false);
    }
  );
});

describe("login --api-key", () => {
  test("stores the given key as is, without creating a new one", async ({
    cloud,
    cli,
  }) => {
    keyBelongsToDev(cloud);

    const result = await cli.run([
      "login",
      "--api-key",
      "mcp_existing",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      email: "dev@example.com",
      keyName: null,
    });
    expect(await readAuthFile(cli)).toEqual({
      apiKey: "mcp_existing",
      orgId: "org_1",
      orgName: "Org One",
      orgSlug: "org-one",
    });
    expect(cloud.requestsTo("GET", "/api/v1/organizations")).toMatchObject([
      { headers: { "x-api-key": "mcp_existing" } },
    ]);
  });

  test("fails with not_authenticated for a key Cloud rejects, and stores nothing", async ({
    cloud,
    cli,
  }) => {
    cloud.on("GET", "/api/auth/get-session", {
      status: 403,
      body: { message: "Invalid API key." },
    });
    cloud.on("GET", "/api/v1/organizations", {
      status: 401,
      body: { error: "Unauthorized" },
    });

    const result = await cli.run(["login", "--api-key", "mcp_bad", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({ error: { code: "not_authenticated" } });
    expect(await exists(authFile(cli))).toBe(false);
  });

  test("--org chooses the active organization by slug", async ({
    cloud,
    cli,
  }) => {
    keyBelongsToDev(cloud, [ORG_ONE, ORG_TWO]);

    const result = await cli.run([
      "login",
      "--api-key",
      "mcp_existing",
      "--org",
      "org-two",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      organization: { id: "org_2", slug: "org-two" },
    });
    expect(await readAuthFile(cli)).toMatchObject({ orgId: "org_2" });
  });

  test("without --org, a user in several organizations gets their dashboard default", async ({
    cloud,
    cli,
  }) => {
    keyBelongsToDev(cloud, [ORG_ONE, ORG_TWO]);
    cloud.on("GET", "/api/v1/user-preferences", {
      body: { defaultOrganizationId: "org_2" },
    });

    const result = await cli.run([
      "login",
      "--api-key",
      "mcp_existing",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(await readAuthFile(cli)).toMatchObject({ orgId: "org_2" });
  });
});

describe("--api-key and --device-code", () => {
  test("can't be combined: usage error, exit 2, no request", async ({
    cloud,
    cli,
  }) => {
    const result = await cli.run([
      "login",
      "--api-key",
      "mcp_existing",
      "--device-code",
      "device_code_1",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.json).toMatchObject({ error: { code: "usage_error" } });
    expect(cloud.requests).toEqual([]);
  });
});

describe("whoami", () => {
  test("shows the email, the active organization, the key's name and the file it is stored in", async ({
    cloud,
    cli,
  }) => {
    await seedAuthFile(cli, {
      apiKey: "mcp_stored",
      keyId: "key_1",
      keyName: "CLI · laptop",
      orgId: "org_2",
    });
    keyBelongsToDev(cloud, [ORG_ONE, ORG_TWO]);

    const result = await cli.run(["whoami", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual({
      email: "dev@example.com",
      organization: {
        id: "org_2",
        name: "Org Two",
        slug: "org-two",
        role: "member",
      },
      keyName: "CLI · laptop",
      credential: { type: "file", path: authFile(cli) },
    });
    expect(cloud.requestsTo("GET", "/api/auth/get-session")).toMatchObject([
      { headers: { "x-api-key": "mcp_stored" } },
    ]);
  });

  test.for([
    [{ MANUFACT_TOKEN: "env_key" }, "MANUFACT_TOKEN"],
    [{ MCP_USE_API_KEY: "env_key" }, "MCP_USE_API_KEY"],
    [
      { MANUFACT_TOKEN: "env_key", MCP_USE_API_KEY: "other_key" },
      "MANUFACT_TOKEN",
    ],
  ] as const)(
    "with %j, uses that key over the stored one and names %s as its source",
    async ([env, variable], { cloud, cli }) => {
      await seedAuthFile(cli, {
        apiKey: "mcp_stored",
        keyName: "CLI · laptop",
        orgId: "org_1",
      });
      keyBelongsToDev(cloud);

      const result = await cli.run(["whoami", "--json"], { env });

      expect(result.exitCode).toBe(0);
      expect(result.json).toMatchObject({
        keyName: null,
        credential: { type: "env", variable },
      });
      expect(cloud.requestsTo("GET", "/api/v1/organizations")).toMatchObject([
        { headers: { "x-api-key": "env_key" } },
      ]);
    }
  );

  test("fails with not_authenticated, without calling Cloud, when there is no credential", async ({
    cloud,
    cli,
  }) => {
    const result = await cli.run(["whoami", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({ error: { code: "not_authenticated" } });
    expect(cloud.requests).toEqual([]);
  });
});

describe("credentials from earlier CLI versions", () => {
  test("move from ~/.mcp-use/config.json to ~/.manufact/auth.json, and the old file is deleted", async ({
    cloud,
    cli,
  }) => {
    const legacy = join(cli.home, ".mcp-use", "config.json");
    await mkdir(join(cli.home, ".mcp-use"), { recursive: true });
    await writeFile(
      legacy,
      JSON.stringify({
        apiKey: "mcp_legacy",
        orgId: "org_1",
        orgName: "Org One",
        orgSlug: "org-one",
      })
    );
    keyBelongsToDev(cloud);

    const result = await cli.run(["whoami", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(await readAuthFile(cli)).toEqual({
      apiKey: "mcp_legacy",
      orgId: "org_1",
      orgName: "Org One",
      orgSlug: "org-one",
    });
    expect(await exists(legacy)).toBe(false);
    expect(cloud.requestsTo("GET", "/api/auth/get-session")).toMatchObject([
      { headers: { "x-api-key": "mcp_legacy" } },
    ]);
  });

  test("are left alone when ~/.manufact/auth.json already exists", async ({
    cloud,
    cli,
  }) => {
    const legacy = join(cli.home, ".mcp-use", "config.json");
    await mkdir(join(cli.home, ".mcp-use"), { recursive: true });
    await writeFile(legacy, JSON.stringify({ apiKey: "mcp_legacy" }));
    await seedAuthFile(cli, { apiKey: "mcp_stored", orgId: "org_1" });
    keyBelongsToDev(cloud);

    const result = await cli.run(["whoami", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(await readAuthFile(cli)).toEqual({
      apiKey: "mcp_stored",
      orgId: "org_1",
    });
    expect(await exists(legacy)).toBe(true);
    expect(cloud.requestsTo("GET", "/api/auth/get-session")).toMatchObject([
      { headers: { "x-api-key": "mcp_stored" } },
    ]);
  });
});

describe("logout", () => {
  test("revokes the key login created, then deletes the stored credential", async ({
    cloud,
    cli,
  }) => {
    await seedAuthFile(cli, {
      apiKey: "mcp_stored",
      keyId: "key_1",
      keyName: "CLI · laptop",
      orgId: "org_1",
    });
    cloud.on("POST", "/api/auth/api-key/delete", { body: { success: true } });

    const result = await cli.run(["logout", "--yes", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual({
      loggedOut: true,
      revoked: true,
      warnings: [],
    });
    expect(cloud.requestsTo("POST", "/api/auth/api-key/delete")).toMatchObject([
      { headers: { "x-api-key": "mcp_stored" }, body: { keyId: "key_1" } },
    ]);
    expect(await exists(authFile(cli))).toBe(false);
  });

  test("still deletes the stored credential when the revoke fails, and warns with key_revoke_failed", async ({
    cloud,
    cli,
  }) => {
    await seedAuthFile(cli, { apiKey: "mcp_stored", keyId: "key_1" });
    cloud.on("POST", "/api/auth/api-key/delete", {
      status: 500,
      body: { message: "Internal error" },
    });

    const result = await cli.run(["logout", "--yes", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      loggedOut: true,
      revoked: false,
      warnings: [{ code: "key_revoke_failed" }],
    });
    expect(cloud.requestsTo("POST", "/api/auth/api-key/delete")).toHaveLength(
      1
    );
    expect(await exists(authFile(cli))).toBe(false);
  });

  test("leaves a key login did not create active on Cloud, and says so with key_not_revoked", async ({
    cloud,
    cli,
  }) => {
    await seedAuthFile(cli, { apiKey: "mcp_existing", orgId: "org_1" });

    const result = await cli.run(["logout", "--yes", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual({
      loggedOut: true,
      revoked: false,
      warnings: [
        {
          code: "key_not_revoked",
          message: expect.any(String),
        },
      ],
    });
    expect(cloud.requests).toEqual([]);
    expect(await exists(authFile(cli))).toBe(false);
  });

  test("without --yes and without a terminal, asks for --yes and keeps the credential", async ({
    cloud,
    cli,
  }) => {
    await seedAuthFile(cli, { apiKey: "mcp_stored", keyId: "key_1" });

    const result = await cli.run(["logout", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(result.json).toMatchObject({ error: { code: "usage_error" } });
    expect(cloud.requests).toEqual([]);
    expect(await readAuthFile(cli)).toEqual({
      apiKey: "mcp_stored",
      keyId: "key_1",
    });
  });
});
