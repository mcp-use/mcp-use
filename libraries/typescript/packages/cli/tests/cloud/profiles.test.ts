import { expect } from "vitest";
import { test } from "../helpers/cli-test.js";
import { signIn, SIGNED_IN } from "../helpers/cloud-auth.js";
import { profile, server as serverFixture } from "../helpers/cloud-fixtures.js";
import type { FakeCloud } from "../helpers/fake-cloud.js";

const POLLING = { ...SIGNED_IN, MCP_USE_POLL_INTERVAL_MS: "0" };
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const SESSIONS = "/api/v1/organizations/org_1/profile-sessions";
const SESSION = `${SESSIONS}/${SESSION_ID}`;
const AUTH_URL = `https://manufact.test/cloud/profiles/sign-in/${SESSION_ID}`;
const FUTURE = "2099-01-01T00:00:00Z";

// Cloud redacts static values, but the CLI must not print them anyway.
const STATIC_PROFILE = {
  ...profile({
    id: "profile_static",
    kind: "static",
    sharing: "org",
    canUse: false,
  }),
  static: {
    bearer: { token: "sk_secret_token", tokenType: "Bearer" },
    headers: { "X-Api-Key": "header_secret" },
  },
};

function profiles(cloud: FakeCloud): void {
  signIn(cloud);
  cloud.on("GET", "/api/v1/organizations/org_1/profiles", {
    body: {
      items: [
        profile({
          id: "profile_oauth",
          label: "Staging",
          account: {
            email: "ada@example.com",
            name: "Ada",
            issuerHost: "auth.example.com",
          },
          bindings: [
            {
              id: "binding_1",
              serverId: "srv_1",
              serverName: "Weather",
              target: "branch",
              branch: "feature",
            },
          ],
        }),
        STATIC_PROFILE,
      ],
    },
  });
}

function linkedServer(cloud: FakeCloud): void {
  signIn(cloud);
  cloud.on("GET", "/api/v1/servers/weather", {
    body: serverFixture({
      id: "22222222-2222-4222-8222-222222222222",
      slug: "weather",
      organizationId: "org_1",
    }),
  });
}

function created(cloud: FakeCloud): void {
  cloud.on("POST", SESSIONS, {
    body: {
      sessionId: SESSION_ID,
      status: "pending",
      authenticationUrl: AUTH_URL,
      expiresAt: FUTURE,
    },
  });
}

function session(
  status: "pending" | "authenticated" | "failed" | "expired",
  fields: {
    profileId?: string | null;
    error?: { code: string; message: string } | null;
  } = {}
) {
  return {
    body: {
      sessionId: SESSION_ID,
      organizationId: "org_1",
      status,
      url: "https://weather.example.com/mcp",
      label: "Staging",
      profileId: fields.profileId ?? null,
      error: fields.error ?? null,
      completedAt: status === "pending" ? null : "2026-01-01T00:00:00Z",
      expiresAt: FUTURE,
    },
  };
}

test("profiles list shows metadata and never static secrets", async ({
  cloud,
  cli,
}) => {
  profiles(cloud);
  const json = await cli.run(["profiles", "list", "--json"], {
    env: SIGNED_IN,
  });
  expect(json.exitCode).toBe(0);
  expect(json.json).toEqual({
    items: [
      {
        id: "profile_oauth",
        label: "Staging",
        kind: "oauth",
        status: "active",
        reason: null,
        canUse: true,
        sharing: "owner",
        owner: { id: "user_1", name: "Ada" },
        account: {
          email: "ada@example.com",
          name: "Ada",
          issuerHost: "auth.example.com",
        },
        connectedAt: "2026-01-01T00:00:00Z",
        bindings: [
          {
            serverId: "srv_1",
            serverName: "Weather",
            target: "branch",
            branch: "feature",
          },
        ],
      },
      expect.objectContaining({ id: "profile_static", kind: "static" }),
    ],
  });
  const human = await cli.run(["profiles", "list"], { env: SIGNED_IN });
  expect(human.exitCode).toBe(0);
  expect(human.stdout).toContain("ada@example.com (auth.example.com)");
  expect(human.stdout).toContain("profile_static");
  for (const output of [json.stdout, human.stdout]) {
    expect(output).not.toContain("sk_secret_token");
    expect(output).not.toContain("header_secret");
    expect(output).not.toContain('static":{');
  }
  expect(cloud.unhandled).toEqual([]);
});

test("profiles get selects one profile from the list", async ({
  cloud,
  cli,
}) => {
  profiles(cloud);
  const result = await cli.run(["profiles", "get", "profile_oauth"], {
    env: SIGNED_IN,
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Staging");
  expect(result.stdout).toContain("Weather · branch feature");
  expect(result.stdout).toContain(
    "mcp-use checklist run --profile profile_oauth"
  );
});

test("profiles get reports an unknown profile ID", async ({ cloud, cli }) => {
  profiles(cloud);
  const result = await cli.run(["profiles", "get", "missing", "--json"], {
    env: SIGNED_IN,
  });
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    error: {
      code: "profile_not_found",
      nextSteps: [{ command: "mcp-use profiles list --json" }],
    },
  });
});

test("profiles create signs in at the linked server and waits for the profile", async ({
  cloud,
  cli,
}) => {
  linkedServer(cloud);
  created(cloud);
  cloud.sequence("GET", SESSION, [
    session("pending"),
    session("authenticated", { profileId: "profile_new" }),
  ]);
  const result = await cli.run(
    ["profiles", "create", "--server", "weather", "--name", " Staging "],
    { env: POLLING }
  );
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain(`Open this page to sign in: ${AUTH_URL}`);
  expect(result.stdout).toContain("✓ Signed in. Profile profile_new (Staging)");
  expect(result.stdout).toContain(
    "mcp-use checklist run --profile profile_new"
  );
  expect(result.stdout).toContain("mcp-use evals run --profile profile_new");
  expect(cloud.requestsTo("POST", SESSIONS)).toMatchObject([
    {
      body: {
        label: "Staging",
        serverId: "22222222-2222-4222-8222-222222222222",
      },
    },
  ]);
  expect(cloud.unhandled).toEqual([]);
});

test("profiles create --url signs in at that URL without a linked server", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  created(cloud);
  cloud.sequence("GET", SESSION, [
    session("authenticated", { profileId: "profile_new" }),
  ]);
  const result = await cli.run(
    [
      "profiles",
      "create",
      "--url",
      "https://preview.example.com/mcp",
      "--json",
    ],
    { env: POLLING }
  );
  expect(result.exitCode).toBe(0);
  // The URL reaches stderr before waiting, even with --json.
  expect(result.stderr).toContain(AUTH_URL);
  expect(result.json).toEqual({
    profileId: "profile_new",
    sessionId: SESSION_ID,
    label: "Staging",
    url: "https://weather.example.com/mcp",
    completedAt: "2026-01-01T00:00:00Z",
  });
  const [request] = cloud.requestsTo("POST", SESSIONS);
  expect(request?.body).toEqual({ url: "https://preview.example.com/mcp" });
});

test("profiles create --no-wait returns the session without polling", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  created(cloud);
  const result = await cli.run(
    [
      "profiles",
      "create",
      "--url",
      "https://preview.example.com/mcp",
      "--no-wait",
      "--json",
    ],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toEqual({
    sessionId: SESSION_ID,
    status: "pending",
    authenticationUrl: AUTH_URL,
    expiresAt: FUTURE,
  });
  expect(cloud.requestsTo("GET", SESSION)).toEqual([]);
});

for (const [url, message] of [
  ["http://preview.example.com/mcp", "https"],
  ["https://user:pass@preview.example.com/mcp", "username or password"],
  ["not a url", "https"],
] as const) {
  test(`profiles create rejects --url ${url} before calling Cloud`, async ({
    cloud,
    cli,
  }) => {
    const result = await cli.run(
      ["profiles", "create", "--url", url, "--json"],
      { env: SIGNED_IN }
    );
    expect(result.exitCode).toBe(2);
    expect(result.json).toMatchObject({
      error: { code: "usage_error", message: expect.stringContaining(message) },
    });
    expect(cloud.requests).toEqual([]);
  });
}

for (const [reply, code] of [
  [
    session("failed", {
      error: { code: "cancelled", message: "Sign-in was cancelled." },
    }),
    "profile_sign_in_cancelled",
  ],
  [
    session("failed", {
      error: {
        code: "sign_in_failed",
        message: "The authorization server rejected the client.",
      },
    }),
    "profile_sign_in_failed",
  ],
  [session("expired"), "profile_sign_in_expired"],
  [{ status: 404, body: { error: "Not found" } }, "profile_sign_in_expired"],
] as const) {
  test(`profiles create fails with ${code} on ${"status" in reply ? "HTTP 404" : reply.body.status}`, async ({
    cloud,
    cli,
  }) => {
    signIn(cloud);
    created(cloud);
    cloud.sequence("GET", SESSION, [reply]);
    const result = await cli.run(
      [
        "profiles",
        "create",
        "--url",
        "https://preview.example.com/mcp",
        "--json",
      ],
      { env: POLLING }
    );
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({ error: { code } });
  });
}

test("profiles create stops waiting once a pending session passes expiresAt", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  created(cloud);
  const pending = session("pending");
  cloud.sequence("GET", SESSION, [
    { body: { ...pending.body, expiresAt: "2020-01-01T00:00:00Z" } },
  ]);
  const result = await cli.run(
    [
      "profiles",
      "create",
      "--url",
      "https://preview.example.com/mcp",
      "--json",
    ],
    { env: POLLING }
  );
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    error: { code: "profile_sign_in_expired" },
  });
  expect(cloud.unhandled).toEqual([]);
});

test("profiles create without --url needs a linked server", async ({
  cloud,
  cli,
}) => {
  const result = await cli.run(["profiles", "create", "--json"], {
    env: SIGNED_IN,
  });
  expect(result.exitCode).toBe(2);
  expect(result.json).toMatchObject({ error: { code: "project_not_linked" } });
  expect(cloud.requests).toEqual([]);
});
