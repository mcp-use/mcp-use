import { inject } from "vitest";
import { it as test } from "../support/fixtures.js";
import { TestProjects, type FixtureKind, type TestProject } from "./project.js";

/** Shared lifecycle for CLI projects; no resources are allocated for pure unit tests. */
export const it = test.extend<{
  fixtureKind: FixtureKind;
  projects: TestProjects;
  project: TestProject;
}>({
  fixtureKind: "basic",
  projects: async ({ scope }, use) => {
    await use(new TestProjects(inject("cliScratchRoot"), scope));
  },
  project: async ({ projects, fixtureKind }, use) => {
    await use(projects.create(fixtureKind));
  },
});

/** The same lifecycle with the runnable views fixture. */
export const viewsTest = it.extend({ fixtureKind: "views" as FixtureKind });

/** The same lifecycle for tests that only need files, without framework dependencies. */
export const emptyTest = it.extend({ fixtureKind: "empty" as FixtureKind });
