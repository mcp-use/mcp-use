import { afterEach, describe, expect, it, vi } from "vitest";

const {
  clearCloudConfig,
  closePrompt,
  createInterface,
  identity,
  question,
  writeCloudConfig,
  withApiKey,
} = vi.hoisted(() => {
  const identity = {
    userId: "user_1",
    email: "person@example.com",
    organizations: [
      {
        id: "org_1",
        name: "Acme",
        slug: "acme",
        role: "admin",
      },
    ],
    defaultOrganizationId: "org_1" as string | null,
  };
  return {
    clearCloudConfig: vi.fn(),
    closePrompt: vi.fn(),
    createInterface: vi.fn(),
    identity,
    question: vi.fn(),
    writeCloudConfig: vi.fn(async () => {}),
    withApiKey: vi.fn(() => ({ identity: async () => identity })),
  };
});

vi.mock("node:readline/promises", () => ({ createInterface }));

vi.mock("../../src/commands/cloud-api.js", () => ({
  cloudAuthUrl: () => "https://cloud.example.test",
  CloudApi: { withApiKey },
  clearCloudConfig,
  readCloudConfig: vi.fn(),
  resolveOrganization: (
    organizations: Array<{ id: string; slug: string | null }>,
    selector: string
  ) =>
    organizations.find(
      (organization) =>
        organization.id === selector || organization.slug === selector
    ),
  writeCloudConfig,
}));

import { runIdentity } from "../../src/commands/identity.js";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.MCP_USE_API_KEY;
const originalStdinTty = Object.getOwnPropertyDescriptor(
  process.stdin,
  "isTTY"
);

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.MCP_USE_API_KEY;
  else process.env.MCP_USE_API_KEY = originalApiKey;
  if (originalStdinTty === undefined) {
    Reflect.deleteProperty(process.stdin, "isTTY");
  } else {
    Object.defineProperty(process.stdin, "isTTY", originalStdinTty);
  }
  writeCloudConfig.mockClear();
  withApiKey.mockClear();
  clearCloudConfig.mockClear();
  closePrompt.mockClear();
  createInterface.mockReset();
  question.mockReset();
  identity.organizations.splice(0, identity.organizations.length, {
    id: "org_1",
    name: "Acme",
    slug: "acme",
    role: "admin",
  });
  identity.defaultOrganizationId = "org_1";
  vi.restoreAllMocks();
});

describe("logout UX", () => {
  it("asks only whether to log out and then confirms completion", async () => {
    question.mockResolvedValue("y");
    createInterface.mockReturnValue({
      close: closePrompt,
      question,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await expect(runIdentity("logout", [])).resolves.toBe(0);

    expect(question).toHaveBeenCalledWith("Log out? [y/N] ");
    expect(clearCloudConfig).toHaveBeenCalledOnce();
    expect(stdout.mock.calls.flat().join("")).toBe("Logged out.\n");
  });
});

describe("login --device-code", () => {
  it("redeems a pre-approved code, validates the resulting key, and never prints either secret", async () => {
    const deviceCode = "device-secret";
    const apiKey = "mcp_secret";
    const requests: Request[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      requests.push(new Request(input, init));
      if (String(input).endsWith("/device/token")) {
        return Response.json({ access_token: "access-secret" });
      }
      return Response.json({ key: apiKey });
    });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await expect(
      runIdentity("login", ["--device-code", deviceCode])
    ).resolves.toBe(0);

    expect(requests).toHaveLength(2);
    expect(await requests[0]!.json()).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: "mcp-use-cli",
    });
    expect(requests[1]!.headers.get("authorization")).toBe(
      "Bearer access-secret"
    );
    expect(withApiKey).toHaveBeenCalledWith(apiKey);
    expect(writeCloudConfig).toHaveBeenCalledWith({
      apiKey,
      orgId: "org_1",
      orgName: "Acme",
      orgSlug: "acme",
    });
    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalledWith(
      expect.stringContaining(deviceCode)
    );
    expect(stdout).not.toHaveBeenCalledWith(expect.stringContaining(apiKey));
  });

  it("prefers an explicit device code over MCP_USE_API_KEY", async () => {
    process.env.MCP_USE_API_KEY = "mcp_env_secret";
    globalThis.fetch = vi.fn(async (input) =>
      String(input).endsWith("/device/token")
        ? Response.json({ access_token: "access-secret" })
        : Response.json({ key: "mcp_device_secret" })
    );
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runIdentity("login", ["--device-code", "device-secret"])
    ).resolves.toBe(0);

    expect(withApiKey).toHaveBeenCalledWith("mcp_device_secret");
  });

  it("reports an expired code as a structured error without reflecting the secret", async () => {
    const deviceCode = "do-not-print-me";
    globalThis.fetch = vi.fn(async () =>
      Response.json({ error: "expired_token" })
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(
      runIdentity("login", ["--device-code", deviceCode, "--json"])
    ).resolves.toBe(1);

    expect(stderr).toHaveBeenCalledWith(
      `${JSON.stringify({ error: { code: "login_failed", message: "Device code has expired." } })}\n`
    );
    expect(stderr).not.toHaveBeenCalledWith(
      expect.stringContaining(deviceCode)
    );
    expect(writeCloudConfig).not.toHaveBeenCalled();
  });

  it("redacts server diagnostics for an invalid code", async () => {
    const deviceCode = "do-not-print-me";
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        error: "invalid_grant",
        error_description: `bad ${deviceCode}`,
      })
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(
      runIdentity("login", ["--device-code", deviceCode])
    ).resolves.toBe(1);

    expect(stderr).toHaveBeenCalledWith(
      "Device code is invalid, expired, or has already been redeemed.\n"
    );
    expect(stderr).not.toHaveBeenCalledWith(
      expect.stringContaining(deviceCode)
    );
  });

  it("rejects empty and conflicting credentials", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(
      runIdentity("login", ["--device-code", "   ", "--json"])
    ).resolves.toBe(2);
    await expect(
      runIdentity("login", [
        "--api-key",
        "key",
        "--device-code",
        "code",
        "--json",
      ])
    ).resolves.toBe(2);

    expect(stderr).toHaveBeenNthCalledWith(
      1,
      `${JSON.stringify({ error: { code: "usage_error", message: "--device-code must not be empty." } })}\n`
    );
    expect(stderr).toHaveBeenNthCalledWith(
      2,
      `${JSON.stringify({ error: { code: "usage_error", message: "--api-key and --device-code cannot be used together." } })}\n`
    );
  });

  it("lists the option in login help", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await expect(runIdentity("login", ["--help"])).resolves.toBe(0);

    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining("--device-code <code>")
    );
  });

  it("requires an explicit organization for headless login without a default", async () => {
    identity.organizations.splice(
      0,
      identity.organizations.length,
      {
        id: "org_1",
        name: "Acme",
        slug: "acme",
        role: "admin",
      },
      {
        id: "org_2",
        name: "Beta",
        slug: "beta",
        role: "member",
      }
    );
    identity.defaultOrganizationId = null;
    process.env.MCP_USE_API_KEY = "mcp_agent";
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runIdentity("login", ["--json"])).resolves.toBe(2);

    expect(writeCloudConfig).toHaveBeenCalledWith({ apiKey: "mcp_agent" });
    expect(JSON.parse(stderr.mock.calls.flat().join(""))).toMatchObject({
      error: {
        code: "organization_required",
        details: {
          organizations: [
            { id: "org_1", name: "Acme", slug: "acme" },
            { id: "org_2", name: "Beta", slug: "beta" },
          ],
          nextSteps: [
            {
              command: "mcp-use org use <id-or-slug>",
            },
            {
              command: "mcp-use login --org <id-or-slug>",
            },
          ],
        },
      },
    });
  });

  it("selects an organization explicitly for headless agents", async () => {
    identity.organizations.splice(
      0,
      identity.organizations.length,
      {
        id: "org_1",
        name: "Acme",
        slug: "acme",
        role: "admin",
      },
      {
        id: "org_2",
        name: "Beta",
        slug: "beta",
        role: "member",
      }
    );
    identity.defaultOrganizationId = null;
    process.env.MCP_USE_API_KEY = "mcp_agent";
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runIdentity("login", ["--org", "beta", "--json"])
    ).resolves.toBe(0);

    expect(writeCloudConfig).toHaveBeenCalledWith({
      apiKey: "mcp_agent",
      orgId: "org_2",
      orgName: "Beta",
      orgSlug: "beta",
    });
  });

  it("prompts an interactive user to select among multiple organizations", async () => {
    identity.organizations.splice(
      0,
      identity.organizations.length,
      {
        id: "org_1",
        name: "Acme",
        slug: "acme",
        role: "admin",
      },
      {
        id: "org_2",
        name: "Beta",
        slug: "beta",
        role: "member",
      }
    );
    identity.defaultOrganizationId = null;
    process.env.MCP_USE_API_KEY = "mcp_human";
    question.mockResolvedValue("2");
    createInterface.mockReturnValue({
      close: closePrompt,
      question,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await expect(runIdentity("login", [])).resolves.toBe(0);

    expect(question).toHaveBeenCalledWith("Organization [1]: ");
    expect(writeCloudConfig).toHaveBeenCalledWith({
      apiKey: "mcp_human",
      orgId: "org_2",
      orgName: "Beta",
      orgSlug: "beta",
    });
    expect(stdout.mock.calls.flat().join("")).toContain(
      "Logged in as person@example.com (Beta)."
    );
  });
});
