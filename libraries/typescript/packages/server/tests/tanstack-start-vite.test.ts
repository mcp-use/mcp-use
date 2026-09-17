import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
import { mcpUseTanStackStart } from "../src/tanstack-start/vite.js";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
  readdir: mocks.readdir,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.spawn.mockImplementation(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child;
  });
  mocks.readFile.mockResolvedValue(JSON.stringify({ views: {} }));
  mocks.readdir.mockResolvedValue([]);
});

it("builds once on server import, skipping configuration, unrelated modules and client imports", async () => {
  const plugin = mcpUseTanStackStart();
  const configure = plugin.configResolved as (config: { root: string }) => void;
  const load = plugin.load as (
    this: unknown,
    id: string
  ) => Promise<string | undefined>;
  configure({ root: "/tmp/start-app" });
  expect(mocks.spawn).not.toHaveBeenCalled();
  const server = { environment: { config: { consumer: "server" } } };
  const client = { environment: { config: { consumer: "client" } } };
  expect(await load.call(client, "unrelated-module")).toBeUndefined();
  await expect(
    load.call(client, "\0mcp-use:tanstack-start-build")
  ).rejects.toThrow("server route");
  expect(mocks.spawn).not.toHaveBeenCalled();
  const [first, second] = await Promise.all([
    load.call(server, "\0mcp-use:tanstack-start-build"),
    load.call(server, "\0mcp-use:tanstack-start-build"),
  ]);
  expect(mocks.spawn).toHaveBeenCalledOnce();
  expect(mocks.spawn).toHaveBeenCalledWith(
    process.execPath,
    expect.arrayContaining(["build", "--no-views-config"]),
    expect.objectContaining({ cwd: "/tmp/start-app" })
  );
  expect(second).toBe(first);
  const module = await import(
    `data:text/javascript,${encodeURIComponent(first!)}`
  );
  expect((await module.loadTanStackStartBuild()).basePath).toBe("/mcp");
});
