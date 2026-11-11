import { expect } from "vitest";
import { test } from "../helpers/cli-test.js";

for (const group of [
  "org",
  "servers",
  "deployments",
  "env",
  "domains",
  "github",
  "checklist",
  "alerts",
]) {
  test(`${group} help lists described commands without mixing their options`, async ({
    cli,
    cloud,
  }) => {
    const result = await cli.run([group, "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`Usage: mcp-use ${group} <command>`);
    expect(result.stdout).toContain("Commands:\n");
    expect(result.stdout).toContain("Examples:\n");
    expect(result.stdout).toContain(`${group} <command> --help`);
    expect(result.stdout).not.toMatch(
      /--name|--logo|--file|--reason|--installation/
    );
    expect(cloud.unhandled).toEqual([]);
  });
}

for (const [args, included, excluded] of [
  [["org", "use"], "<id-or-slug>", ["--name", "--logo", "--org"]],
  [["org", "create"], "--slug", ["--logo", "--org"]],
  [["org", "update"], "--logo", ["--role", "--limit"]],
  [["org", "members"], "--limit", ["--name", "--role"]],
  [["org", "invites", "send"], "--role", ["--logo", "--limit"]],
  [["servers", "list"], "--limit", ["--build-command", "--yes"]],
  [["servers", "update"], "--installation", ["--limit", "--yes"]],
  [["deployments", "get"], "<id>", ["--limit", "--branch", "--yes"]],
  [["domains", "rm"], "--yes", ["--branch", "--file"]],
  [["github", "repos"], "--installation", ["--branch", "--yes"]],
  [["env", "set"], "--sensitive", ["--yes", "--file"]],
  [["alerts", "list"], "--limit", ["--file", "--yes"]],
  [["alerts", "create"], "--file", ["--limit", "--yes"]],
  [["checklist", "get"], "<run-id>", ["--branch", "--no-wait", "--limit"]],
] as const) {
  test(`${args.join(" ")} help explains only that operation`, async ({
    cli,
  }) => {
    const result = await cli.run([...args, "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Usage: mcp-use ${args.join(" ")}`);
    expect(result.stdout).toContain(included);
    expect(result.stdout).toContain("Examples:\n");
    expect(result.stdout).not.toContain("Commands:\n");
    for (const flag of excluded) expect(result.stdout).not.toContain(flag);
  });
}

test("missing and malformed arguments show the respective help on stderr", async ({
  cli,
}) => {
  for (const args of [
    ["org", "use"],
    ["org", "use", "Acme", "Corp"],
    ["org", "update", "--unknown"],
    ["org", "invites", "send"],
    ["servers", "update", "--unknown"],
    ["alerts", "create"],
    ["deploy", "--unknown"],
  ]) {
    const helpArgs = args.slice(
      0,
      args[0] === "org" && args[1] === "invites"
        ? 3
        : args[0] === "deploy"
          ? 1
          : 2
    );
    const expected = await cli.run([...helpArgs, "--help"]);
    const result = await cli.run(args);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.trimEnd()).toContain(expected.stdout.trimEnd());
    expect(result.stderr.match(/Usage:/g)).toHaveLength(1);
  }
});

test("unknown organization operations show the group help", async ({ cli }) => {
  const result = await cli.run(["org", "switch", "acme"]);
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("Commands:\n");
  expect(result.stderr).toContain("use <id-or-slug>");
  expect(result.stderr).not.toContain("--logo");
});

test("JSON usage errors stay a single structured document without a help dump", async ({
  cli,
}) => {
  const result = await cli.run(["org", "use", "--json"]);
  expect(result.exitCode).toBe(2);
  expect(result.json).toMatchObject({ error: { code: "usage_error" } });
  expect(result.stderr).toBe("");
  expect(result.stdout).not.toContain("Examples:");
});

test("authentication errors do not print command help", async ({ cli }) => {
  const result = await cli.run(["org", "use", "acme"]);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Not logged in");
  expect(result.stderr).not.toContain("Examples:");
});

test("help command and flag select the same nested page", async ({ cli }) => {
  const flag = await cli.run(["org", "invites", "send", "--help"]);
  const command = await cli.run(["help", "org", "invites", "send"]);
  expect(command.exitCode).toBe(0);
  expect(command.stdout).toBe(flag.stdout);
  const root = await cli.run(["help"]);
  expect(root.stdout).toContain("Cloud projects:\n");
  expect(root.stdout).not.toContain("--with-inspector");
});
