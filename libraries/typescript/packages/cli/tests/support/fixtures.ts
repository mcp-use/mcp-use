import { inject, test } from "vitest";
import { TestScope } from "./scope.js";

export const it = test.extend<{ scope: TestScope; home: string }>({
  // eslint-disable-next-line no-empty-pattern -- Vitest discovers fixture dependencies from destructuring.
  scope: async ({}, use) => {
    const scope = new TestScope(inject("cliExternalScratchRoot"));
    try {
      await use(scope);
    } finally {
      await scope.dispose();
    }
  },
  home: async ({ scope }, use) => {
    scope.preserveEnv("HOME", "USERPROFILE");
    const home = scope.directory("home-");
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    await use(home);
  },
});
