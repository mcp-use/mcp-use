import { createServer } from "node:http";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../../src/commands/shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/commands/shared.js")>()),
  readJson: vi.fn(async () => ({})),
}));

import { runDeployments } from "../../src/commands/deployments.js";
import { runIdentity } from "../../src/commands/identity.js";
import { runOrganizations } from "../../src/commands/organizations.js";
import { runServers } from "../../src/commands/servers.js";

// Exercise native fetch failures without contacting the cloud or using credentials.
const server = createServer((_request, response) => response.destroy());
let origin: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP test server.");
  }
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.stubEnv("MCP_USE_CLOUD_API_URL", origin);
  vi.stubEnv("MCP_USE_API_KEY", "test-key");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const commands = [
  {
    name: "servers list",
    run: (args: string[]) => runServers(["list", ...args]),
  },
  {
    name: "deployments list",
    run: (args: string[]) => runDeployments(["list", ...args]),
  },
  {
    name: "org list",
    run: (args: string[]) => runOrganizations(["list", ...args]),
  },
  { name: "whoami", run: (args: string[]) => runIdentity("whoami", args) },
];

describe.each(commands)("$name network failures", ({ run }) => {
  it.each(["MCP_USE_CLOUD_API_URL", "MCP_API_URL"])(
    "reports malformed %s as a usage error before fetching",
    async (variable) => {
      vi.stubEnv("MCP_USE_CLOUD_API_URL", undefined);
      vi.stubEnv(variable, "not a url");
      const fetch = vi.spyOn(globalThis, "fetch");
      const stdout = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      const stderr = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      await expect(run(["--json"])).resolves.toBe(2);

      expect(fetch).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(
        JSON.parse(stderr.mock.calls.map(([text]) => text).join(""))
      ).toEqual({
        error: {
          code: "usage_error",
          message: `${variable} must be a valid absolute URL.`,
        },
      });
    }
  );

  it.each([false, true])("exits 1 with json=%s", async (json) => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(run(json ? ["--json"] : [])).resolves.toBe(1);

    expect(stdout).not.toHaveBeenCalled();
    const output = stderr.mock.calls.map(([text]) => text).join("");
    if (json) {
      expect(output.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(output)).toEqual({
        error: { code: "command_failed", message: "fetch failed" },
      });
    } else {
      expect(output).toBe("fetch failed\n");
    }
  });
});
