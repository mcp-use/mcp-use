import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "../../src/bin/main.js";
import { runDeployments } from "../../src/commands/deployments.js";
import { runIdentity } from "../../src/commands/identity.js";
import { runOrganizations } from "../../src/commands/organizations.js";
import { runScreenshot } from "../../src/commands/screenshot.js";
import { runServers } from "../../src/commands/servers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("offline help contract", () => {
  it.each([
    ["login", () => runIdentity("login", ["--help"])],
    ["logout", () => runIdentity("logout", ["--help"])],
    ["whoami", () => runIdentity("whoami", ["-h"])],
    ["org", () => runOrganizations(["--help"])],
    ["org list", () => runOrganizations(["list", "--help"])],
    ["org current", () => runOrganizations(["current", "--help"])],
    ["org use", () => runOrganizations(["use", "--help"])],
    ["servers", () => runServers(["--help"])],
    ["servers list", () => runServers(["list", "--help"])],
    ["servers get", () => runServers(["get", "--help"])],
    ["servers update", () => runServers(["update", "--help"])],
    ["servers delete", () => runServers(["delete", "--help"])],
    ["servers env", () => runServers(["env", "--help"])],
    ["servers env list", () => runServers(["env", "list", "--help"])],
    ["servers env set", () => runServers(["env", "set", "-h"])],
    ["servers env unset", () => runServers(["env", "unset", "--help"])],
    ["deployments", () => runDeployments(["--help"])],
    ["deployments list", () => runDeployments(["list", "--help"])],
    ["deployments get", () => runDeployments(["get", "--help"])],
    ["deployments logs", () => runDeployments(["logs", "-h"])],
    ["deployments restart", () => runDeployments(["restart", "--help"])],
    ["deployments stop", () => runDeployments(["stop", "--help"])],
    ["deployments delete", () => runDeployments(["delete", "--help"])],
    ["screenshot", () => runScreenshot(["--help"])],
  ])("%s prints help locally", async (_name, run) => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(run()).resolves.toBe(0);

    expect(stdout.mock.calls.flat().join("")).toContain("Usage:");
    expect(stderr).not.toHaveBeenCalled();
  });

  it.each(["dev", "build", "typecheck", "start"])(
    "%s has command-specific help",
    async (command) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await expect(main([command, "--help"])).resolves.toBe(0);

      const output = log.mock.calls.flat().join("\n");
      expect(output).toContain(`Usage: mcp-use ${command}`);
      expect(output).not.toContain("Commands:\n  dev");
    }
  );
});
