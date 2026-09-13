import { existsSync, readdirSync } from "node:fs";
import { afterAll, expect } from "vitest";
import { emptyTest, it } from "./fixtures.js";
import { getFreePort, occupyPort } from "./helpers.js";
import { TestProjects, type FixtureKind } from "./project.js";
import { createScratchRun, removeScratchRun } from "./scratch.js";

const failedProjects: string[] = [];
const failedPorts: number[] = [];
let failedServerStarted: boolean | undefined;

// These checks run after fixture teardown, rather than manually invoking it.
afterAll(async () => {
  if (failedServerStarted !== undefined) expect(failedServerStarted).toBe(true);
  if (process.env.KEEP_TEST_PROJECTS !== "1") {
    for (const cwd of failedProjects) expect(existsSync(cwd)).toBe(false);
  }
  for (const port of failedPorts) {
    const server = await occupyPort(port);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

it.fails(
  "stops the server and removes its project after an assertion fails",
  async ({ project }) => {
    failedServerStarted = false;
    failedProjects.push(project.cwd);
    const server = await project.startDev({ inspector: false });
    failedServerStarted = true;
    failedPorts.push(Number(new URL(server.url).port));
    project.writeFile("generated/nested.txt", "throwaway output");
    expect("deliberate assertion failure").toBe("success");
  }
);

emptyTest.fails(
  "removes a project when test setup throws",
  async ({ project }) => {
    failedProjects.push(project.cwd);
    project.writeFile("partial/setup.txt", "created before failure");
    throw new Error("deliberate setup failure");
  }
);

it("releases the listener when CLI startup fails", async ({ project }) => {
  const port = await getFreePort();
  project.writeFile(
    "src/index.ts",
    'throw new Error("fixture startup failure");\n'
  );
  await expect(project.startDev({ port, inspector: false })).rejects.toThrow(
    "fixture startup failure"
  );
  const listener = await occupyPort(port);
  await new Promise<void>((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  });
});

emptyTest(
  "owns directories even when copying a fixture fails",
  async ({ project }) => {
    const projects = new TestProjects(project.cwd);
    project.defer(() => projects.dispose());
    expect(() => projects.create("missing" as FixtureKind)).toThrow();
    expect(readdirSync(project.cwd)).toHaveLength(1);
    await projects.dispose();
    if (process.env.KEEP_TEST_PROJECTS !== "1") {
      expect(readdirSync(project.cwd)).toEqual([]);
    }
  }
);

emptyTest(
  "awaits resources before removing projects and reports cleanup errors",
  async ({ project }) => {
    const projects = new TestProjects(project.cwd);
    const first = projects.create("empty");
    const second = projects.create("empty");
    const order: string[] = [];
    first.defer(() => {
      expect(existsSync(first.cwd)).toBe(true);
      expect(existsSync(second.cwd)).toBe(true);
      order.push("first");
    });
    second.defer(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      second.writeFile("last-write.txt", "shutdown finished");
      order.push("second");
      throw new Error("resource failed to close");
    });
    const disposal = projects.dispose();
    expect(projects.dispose()).toBe(disposal);
    await expect(disposal).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: "resource failed to close" }),
      ],
    });
    expect(order).toEqual(["second", "first"]);
    if (process.env.KEEP_TEST_PROJECTS !== "1") {
      expect(existsSync(first.cwd)).toBe(false);
      expect(existsSync(second.cwd)).toBe(false);
    }
  }
);

emptyTest(
  "removing one run leaves another run's projects intact",
  async ({ project }) => {
    const first = createScratchRun();
    project.defer(() => removeScratchRun(first));
    const second = createScratchRun();
    project.defer(() => removeScratchRun(second));
    expect(first).not.toBe(second);
    await removeScratchRun(first);
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(true);
  }
);
